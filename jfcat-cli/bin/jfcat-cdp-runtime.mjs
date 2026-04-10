#!/usr/bin/env node
/**
 * jfcat-cli cdp：通过 Chrome remote-debugging-port 走 CDP，
 * 与 src/background/index.ts 中 executeBbBrowserAction 的 CDP 原子操作对齐（蛇形 params）。
 * 需 Node 18+（http + crypto）；WebSocket 为自实现 ws:// 客户端（无 npm 依赖）。
 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { stdin as inputStdin } from 'node:process';

const CDP_VER = '1';

function httpJson(host, port, path) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host, port: Number(port), path, method: 'GET', timeout: 15000 },
            (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`JSON 解析失败: ${e.message}`));
                    }
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('HTTP 超时'));
        });
        req.end();
    });
}

function parseBackendNodeId(ref) {
    const s = String(ref ?? '').trim();
    if (!s) throw new Error('缺少 ref');
    const m = s.match(/^@(\d+)$/);
    if (m) return parseInt(m[1], 10);
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) throw new Error('ref 须为 @backendNodeId 或数字');
    return n;
}

function modifiersFromStrings(modifiers) {
    if (!Array.isArray(modifiers)) return 0;
    let f = 0;
    for (const m of modifiers) {
        const x = String(m);
        if (x === 'Alt') f |= 1;
        else if (x === 'Control') f |= 2;
        else if (x === 'Meta') f |= 4;
        else if (x === 'Shift') f |= 8;
    }
    return f;
}

function encodeClientTextFrame(str) {
    const payload = Buffer.from(str, 'utf8');
    const len = payload.length;
    const mask = crypto.randomBytes(4);
    let headerSize = 6;
    if (len >= 126 && len < 65536) headerSize = 8;
    else if (len >= 65536) headerSize = 14;
    const buf = Buffer.alloc(headerSize + len);
    let i = 0;
    buf[i++] = 0x81;
    if (len < 126) {
        buf[i++] = 0x80 | len;
    } else if (len < 65536) {
        buf[i++] = 0x80 | 126;
        buf.writeUInt16BE(len, i);
        i += 2;
    } else {
        buf[i++] = 0x80 | 127;
        buf.writeBigUInt64BE(BigInt(len), i);
        i += 8;
    }
    mask.copy(buf, i);
    i += 4;
    for (let j = 0; j < len; j++) buf[i + j] = payload[j] ^ mask[j % 4];
    return buf;
}

function tryParseOneServerFrame(buf) {
    if (buf.length < 2) return { needMore: true };
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
        if (buf.length < 4) return { needMore: true };
        len = buf.readUInt16BE(2);
        off = 4;
    } else if (len === 127) {
        if (buf.length < 10) return { needMore: true };
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < off + maskLen + len) return { needMore: true };
    const mask = masked ? buf.subarray(off, off + 4) : null;
    off += maskLen;
    let payload = Buffer.from(buf.subarray(off, off + len));
    const rest = buf.subarray(off + len);
    if (mask) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    return { opcode, payload, rest };
}

class CdpWsSession {
    constructor(socket, initialBuf = Buffer.alloc(0)) {
        this.socket = socket;
        this.buf = initialBuf.length ? Buffer.from(initialBuf) : Buffer.alloc(0);
        this.nextId = 1;
        this.pending = new Map();
        this.socket.on('data', (chunk) => this.onRaw(chunk));
        this.socket.on('error', (e) => this.failAll(e));
        this.socket.on('close', () => this.failAll(new Error('WebSocket 已关闭')));
        if (this.buf.length) this.drainFrames();
    }

    failAll(err) {
        for (const [, { reject }] of this.pending) {
            try {
                reject(err);
            } catch {
                /* ignore */
            }
        }
        this.pending.clear();
    }

    onRaw(chunk) {
        this.buf = Buffer.concat([this.buf, chunk]);
        this.drainFrames();
    }

    drainFrames() {
        while (true) {
            const r = tryParseOneServerFrame(this.buf);
            if (r.needMore) return;
            this.buf = r.rest;
            if (r.opcode === 0x8) {
                this.socket.end();
                return;
            }
            if (r.opcode === 0x1) {
                let msg;
                try {
                    msg = JSON.parse(r.payload.toString('utf8'));
                } catch {
                    continue;
                }
                if (msg.id != null && this.pending.has(msg.id)) {
                    const { resolve, reject } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) {
                        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                    } else {
                        resolve(msg.result);
                    }
                }
            }
        }
    }

    send(method, params = {}) {
        const id = this.nextId++;
        const line = JSON.stringify({ id, method, params });
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            try {
                this.socket.write(encodeClientTextFrame(line));
            } catch (e) {
                this.pending.delete(id);
                reject(e);
            }
        });
    }

    close() {
        try {
            this.socket.end();
        } catch {
            /* ignore */
        }
    }
}

function connectWsRaw(wsUrl) {
    const u = new URL(wsUrl);
    if (u.protocol !== 'ws:') {
        return Promise.reject(new Error('仅支持 ws://（本地 CDP）'));
    }
    const key = crypto.randomBytes(16).toString('base64');
    const port = u.port ? Number(u.port) : 80;
    const path = `${u.pathname}${u.search || ''}` || '/';
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, u.hostname, () => {
            socket.write(
                `GET ${path} HTTP/1.1\r\n` +
                    `Host: ${u.hostname}:${port}\r\n` +
                    `Upgrade: websocket\r\n` +
                    `Connection: Upgrade\r\n` +
                    `Sec-WebSocket-Key: ${key}\r\n` +
                    `Sec-WebSocket-Version: 13\r\n` +
                    `\r\n`
            );
        });
        let buf = Buffer.alloc(0);
        const onErr = (e) => reject(e);
        socket.once('error', onErr);
        socket.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            const idx = buf.indexOf('\r\n\r\n');
            if (idx === -1) return;
            const head = buf.subarray(0, idx).toString();
            if (!/^HTTP\/1\.1 101 /m.test(head.split('\r\n')[0] || '')) {
                socket.destroy();
                reject(new Error('WebSocket 握手失败: ' + (head.split('\r\n')[0] || head)));
                return;
            }
            buf = buf.subarray(idx + 4);
            socket.off('error', onErr);
            resolve(new CdpWsSession(socket, buf));
        });
    });
}

async function pickPageTarget(list, pick) {
    const pages = (list || []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!pages.length) throw new Error('json/list 中无可用 page 目标');
    const p = String(pick || '0').trim();
    if (/^\d+$/.test(p)) {
        const i = parseInt(p, 10);
        if (i < 0 || i >= pages.length) throw new Error(`--pick 越界: ${i}（共 ${pages.length} 个 page）`);
        return pages[i];
    }
    const sub = p.toLowerCase();
    const found = pages.find((t) => (t.url || '').toLowerCase().includes(sub));
    if (!found) throw new Error(`未找到 URL 包含 "${p}" 的标签页`);
    return found;
}

async function enableDomains(s, domains) {
    for (const d of domains) {
        await s.send(`${d}.enable`, {});
    }
}

async function pointerOnBackendNode(s, backendNodeId, click) {
    const box = await s.send('DOM.getBoxModel', { backendNodeId });
    const c = box?.model?.content;
    if (!c || c.length < 8) throw new Error('无法取得元素盒模型（可能不可见）');
    const xs = [c[0], c[2], c[4], c[6]];
    const ys = [c[1], c[3], c[5], c[7]];
    const x = xs.reduce((a, b) => a + b, 0) / 4;
    const y = ys.reduce((a, b) => a + b, 0) / 4;
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    if (click) {
        await s.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            clickCount: 1,
        });
        await s.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            clickCount: 1,
        });
    }
}

async function insertTextIntoNode(s, backendNodeId, text, clearFirst) {
    const resolved = await s.send('DOM.resolveNode', { backendNodeId });
    const objectId = resolved?.object?.objectId;
    if (!objectId) throw new Error('DOM.resolveNode 失败');
    const fn = clearFirst
        ? `function(t){ this.focus(); this.value=''; for(let i=0;i<t.length;i++){ document.execCommand('insertText', false, t[i]); } }`
        : `function(t){ this.focus(); for(let i=0;i<t.length;i++){ document.execCommand('insertText', false, t[i]); } }`;
    await s.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: fn,
        arguments: [{ value: text }],
        returnByValue: true,
    });
}

async function dispatchKeyEvent(s, type, options) {
    await s.send('Input.dispatchKeyEvent', { type, ...options });
}

async function pressKeyCdp(s, key, modifierFlags) {
    const keyCodeMap = {
        Enter: 13,
        Tab: 9,
        Backspace: 8,
        Escape: 27,
        ArrowUp: 38,
        ArrowDown: 40,
        ArrowLeft: 37,
        ArrowRight: 39,
        Delete: 46,
        Home: 36,
        End: 35,
        PageUp: 33,
        PageDown: 34,
    };
    const keyCode = keyCodeMap[key] || (key.length === 1 ? key.charCodeAt(0) : 0);
    await dispatchKeyEvent(s, 'rawKeyDown', {
        key,
        code: key,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers: modifierFlags,
    });
    if (key.length === 1) {
        await dispatchKeyEvent(s, 'char', { text: key, key, modifiers: modifierFlags });
    }
    await dispatchKeyEvent(s, 'keyUp', {
        key,
        code: key,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
        modifiers: modifierFlags,
    });
}

function trimAxNodes(nodes, maxDepth, depth = 0) {
    if (depth >= maxDepth) return '[maxDepth]';
    if (!Array.isArray(nodes)) return nodes;
    return nodes.slice(0, 400).map((x) => {
        if (x && typeof x === 'object') {
            const o = { ...x };
            if (Array.isArray(o.children)) {
                o.children = trimAxNodes(o.children, maxDepth, depth + 1);
            }
            return o;
        }
        return x;
    });
}

async function runAction(host, port, pick, action, params) {
    const list = await httpJson(host, port, '/json/list');
    const target = await pickPageTarget(list, pick);
    const session = await connectWsRaw(target.webSocketDebuggerUrl);
    try {
        const a = String(action || '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_');
        const p = params && typeof params === 'object' ? params : {};

        switch (a) {
            case 'eval': {
                const script = String(p.script || '').trim();
                if (!script) throw new Error('eval 需要 params.script');
                await enableDomains(session, ['Page', 'Runtime']);
                const ev = await session.send('Runtime.evaluate', {
                    expression: script,
                    awaitPromise: true,
                    returnByValue: true,
                    userGesture: true,
                });
                if (ev.exceptionDetails) {
                    throw new Error(ev.exceptionDetails.text || 'Runtime.evaluate 异常');
                }
                return { value: ev.result?.value };
            }
            case 'screenshot': {
                await enableDomains(session, ['Page']);
                const shot = await session.send('Page.captureScreenshot', {
                    format: 'png',
                    fromSurface: true,
                });
                return { dataUrl: `data:image/png;base64,${shot.data || ''}` };
            }
            case 'snapshot': {
                const interactive = p.interactive === true || p.interactive === 'true';
                const compact = p.compact === true || p.compact === 'true';
                const maxDepth =
                    p.maxDepth != null ? Math.min(50, Math.max(1, Number(p.maxDepth))) : 12;
                await enableDomains(session, ['Page', 'Accessibility', 'DOM', 'Runtime']);
                const ax = await session.send('Accessibility.getFullAXTree', {});
                let nodes = ax.nodes || [];
                if (interactive) {
                    nodes = nodes.filter((n) => !n.ignored);
                }
                const trimmed = trimAxNodes(nodes, maxDepth);
                return {
                    title: target.title,
                    url: target.url,
                    snapshotData: {
                        interactive,
                        compact,
                        maxDepth,
                        axTreeNodes: compact ? trimmed.slice(0, 200) : trimmed,
                    },
                };
            }
            case 'click':
            case 'hover': {
                const bid = parseBackendNodeId(p.ref);
                const doClick = a === 'click';
                await enableDomains(session, ['DOM', 'Input']);
                await pointerOnBackendNode(session, bid, doClick);
                return {};
            }
            case 'fill':
            case 'type': {
                const bid = parseBackendNodeId(p.ref);
                const text = p.text != null ? String(p.text) : '';
                const clearFirst = a === 'fill';
                await enableDomains(session, ['DOM', 'Runtime']);
                await insertTextIntoNode(session, bid, text, clearFirst);
                return { value: text };
            }
            case 'check':
            case 'uncheck': {
                const bid = parseBackendNodeId(p.ref);
                const desired = a === 'check';
                await enableDomains(session, ['DOM', 'Runtime']);
                const resolved = await session.send('DOM.resolveNode', { backendNodeId: bid });
                const objectId = resolved?.object?.objectId;
                if (!objectId) throw new Error('resolveNode 失败');
                await session.send('Runtime.callFunctionOn', {
                    objectId,
                    functionDeclaration: `function(){ this.checked=${desired}; this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }`,
                    returnByValue: true,
                });
                return {};
            }
            case 'select': {
                const bid = parseBackendNodeId(p.ref);
                const value = p.value != null ? String(p.value) : '';
                await enableDomains(session, ['DOM', 'Runtime']);
                const resolved = await session.send('DOM.resolveNode', { backendNodeId: bid });
                const objectId = resolved?.object?.objectId;
                if (!objectId) throw new Error('resolveNode 失败');
                await session.send('Runtime.callFunctionOn', {
                    objectId,
                    functionDeclaration: `function(v){ this.value=v; this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }`,
                    arguments: [{ value }],
                    returnByValue: true,
                });
                return { value };
            }
            case 'get': {
                const attr = String(p.attribute || '').trim();
                if (!attr) throw new Error('get 需要 attribute');
                await enableDomains(session, ['DOM', 'Runtime']);
                if (attr === 'url' && !p.ref) {
                    const u = await session.send('Runtime.evaluate', {
                        expression: 'location.href',
                        returnByValue: true,
                    });
                    return { value: u.result?.value };
                }
                if (attr === 'title' && !p.ref) {
                    const t = await session.send('Runtime.evaluate', {
                        expression: 'document.title',
                        returnByValue: true,
                    });
                    return { value: t.result?.value };
                }
                const bid = parseBackendNodeId(p.ref);
                const resolved = await session.send('DOM.resolveNode', { backendNodeId: bid });
                const objectId = resolved?.object?.objectId;
                if (!objectId) throw new Error('resolveNode 失败');
                const g = await session.send('Runtime.callFunctionOn', {
                    objectId,
                    functionDeclaration: `function(a){ if(a==='text'||a==='textContent') return this.textContent; if(a==='value') return this.value; return this.getAttribute(a); }`,
                    arguments: [{ value: attr }],
                    returnByValue: true,
                });
                return { value: g.result?.value };
            }
            case 'press': {
                const key = String(p.key || '');
                if (!key) throw new Error('press 需要 key');
                const modifiers = Array.isArray(p.modifiers) ? p.modifiers : [];
                const modifierFlags = modifiersFromStrings(modifiers);
                await enableDomains(session, ['Input']);
                await pressKeyCdp(session, key, modifierFlags);
                const displayKey =
                    modifiers.length > 0 ? `${modifiers.map(String).join('+')}+${key}` : key;
                return { key: displayKey };
            }
            case 'scroll': {
                const dir = String(p.direction || 'down');
                const pixels = Math.min(10000, Math.max(1, Number(p.pixels) || 300));
                const dy = dir === 'up' ? -pixels : dir === 'down' ? pixels : 0;
                const dx = dir === 'left' ? -pixels : dir === 'right' ? pixels : 0;
                await enableDomains(session, ['Runtime']);
                await session.send('Runtime.evaluate', {
                    expression: `window.scrollBy(${dx}, ${dy}); [window.scrollX, window.scrollY]`,
                    returnByValue: true,
                });
                return { direction: dir, pixels, dx, dy };
            }
            case 'dialog': {
                const resp = String(p.dialogResponse || 'accept') === 'dismiss' ? false : true;
                const promptText = p.promptText != null ? String(p.promptText) : undefined;
                await enableDomains(session, ['Page']);
                await session.send('Page.handleJavaScriptDialog', {
                    accept: resp,
                    promptText,
                });
                return { dialogResponse: resp ? 'accept' : 'dismiss' };
            }
            case 'wait': {
                const ms = Math.min(120000, Math.max(0, Number(p.ms) || 0));
                await new Promise((r) => setTimeout(r, ms));
                return { waitedMs: ms };
            }
            case 'refresh': {
                await enableDomains(session, ['Page']);
                await session.send('Page.reload', { ignoreCache: false });
                return { tabId: target.id };
            }
            case 'open':
            case 'navigate': {
                const url = String(p.url || '').trim();
                if (!url) throw new Error('缺少 url');
                await enableDomains(session, ['Page']);
                await session.send('Page.navigate', { url });
                return { url, tabId: target.id };
            }
            case 'back': {
                await enableDomains(session, ['Page']);
                const hist = await session.send('Page.getNavigationHistory', {});
                const cur = hist.currentIndex;
                if (cur <= 0) return { tabId: target.id, navigated: false };
                const entry = hist.entries[cur - 1];
                await session.send('Page.navigateToHistoryEntry', { entryId: entry.id });
                return { tabId: target.id, navigated: true };
            }
            case 'forward': {
                await enableDomains(session, ['Page']);
                const hist = await session.send('Page.getNavigationHistory', {});
                const cur = hist.currentIndex;
                if (cur >= hist.entries.length - 1) return { tabId: target.id, navigated: false };
                const entry = hist.entries[cur + 1];
                await session.send('Page.navigateToHistoryEntry', { entryId: entry.id });
                return { tabId: target.id, navigated: true };
            }
            case 'raw': {
                const method = String(p.method || '').trim();
                if (!method) throw new Error('raw 需要 params.method');
                const rawParams = p.params && typeof p.params === 'object' ? p.params : {};
                return await session.send(method, rawParams);
            }
            default:
                throw new Error(
                    `不支持的 action: ${action}（见 jfcat-cli cdp help-actions）`
                );
        }
    } finally {
        session.close();
    }
}

async function cmdList(host, port) {
    const list = await httpJson(host, port, '/json/list');
    return list;
}

async function cmdRawRpc(host, port, pick, method, paramsJson) {
    const list = await httpJson(host, port, '/json/list');
    const target = await pickPageTarget(list, pick);
    const session = await connectWsRaw(target.webSocketDebuggerUrl);
    try {
        let params = {};
        if (paramsJson && paramsJson !== '{}') {
            params = JSON.parse(paramsJson);
        }
        return await session.send(method, params);
    } finally {
        session.close();
    }
}

function readStdinUtf8() {
    return new Promise((resolve, reject) => {
        let d = '';
        inputStdin.setEncoding('utf8');
        inputStdin.on('data', (c) => (d += c));
        inputStdin.on('end', () => resolve(d));
        inputStdin.on('error', reject);
    });
}

async function main() {
    const argv = process.argv.slice(2);
    const sub = argv[0] || '';
    if (sub === 'help-actions' || sub === '--help-actions') {
        console.log(`与 jfcat/src/background/index.ts executeBbBrowserAction 对齐的 CDP 子集（蛇形 params）：
  eval          script
  snapshot      interactive?, compact?, maxDepth?
  screenshot    —
  click|hover   ref (@backendNodeId 或数字)
  fill|type     ref, text（fill 会先清空）
  check|uncheck ref
  select        ref, value
  get           attribute, ref?（url/title 可无 ref）
  press         key, modifiers?
  scroll        direction?, pixels?
  dialog        dialogResponse?, promptText?
  wait          ms
  refresh       —
  open|navigate url
  back|forward  —
  raw           method, params（任意 CDP 方法）
扩展未实现：tab_* / history / network 路由 / console / errors / trace / frame（依赖扩展 API）`);
        return;
    }
    if (sub === 'list') {
        const port = argv[1];
        const host = argv[2] || '127.0.0.1';
        if (!port) {
            console.error('用法: jfcat-cdp-runtime.mjs list <port> [host]');
            process.exit(1);
        }
        const out = await cmdList(host, port);
        console.log(JSON.stringify(out, null, 2));
        return;
    }
    if (sub === 'raw') {
        const port = argv[1];
        const pick = argv[2] ?? '0';
        const method = argv[3];
        let paramsJson = argv[4];
        const host = argv[5] || '127.0.0.1';
        if (!port || !method) {
            console.error(
                '用法: jfcat-cdp-runtime.mjs raw <port> <pick> <CDP.method> [params-json] [host]'
            );
            process.exit(1);
        }
        if (paramsJson === '-') {
            paramsJson = await readStdinUtf8();
        }
        paramsJson = paramsJson || '{}';
        const out = await cmdRawRpc(host, port, pick, method, paramsJson.trim());
        console.log(JSON.stringify(out, null, 2));
        return;
    }
    if (sub === 'run') {
        const port = argv[1];
        const pick = argv[2] ?? '0';
        const action = argv[3];
        let paramsJson = argv[4];
        const host = argv[5] || '127.0.0.1';
        if (!port || !action) {
            console.error(
                '用法: jfcat-cdp-runtime.mjs run <port> <pick> <action> [params-json|@file|-] [host]'
            );
            process.exit(1);
        }
        if (!paramsJson || paramsJson === '{}') {
            paramsJson = '{}';
        } else if (paramsJson === '-') {
            paramsJson = await readStdinUtf8();
        } else if (paramsJson.startsWith('@')) {
            const { readFileSync } = await import('node:fs');
            paramsJson = readFileSync(paramsJson.slice(1), 'utf8');
        }
        const params = JSON.parse(paramsJson);
        const out = await runAction(host, port, pick, action, params);
        console.log(JSON.stringify(out, null, 2));
        return;
    }
    console.error(`jfcat-cdp-runtime ${CDP_VER}
用法:
  node jfcat-cdp-runtime.mjs list <port> [host]
  node jfcat-cdp-runtime.mjs run <port> <pick> <action> [params-json] [host]
  node jfcat-cdp-runtime.mjs raw <port> <pick> <CDP.method> [params-json] [host]
  node jfcat-cdp-runtime.mjs help-actions`);
    process.exit(1);
}

main().catch((e) => {
    console.error(e.message || String(e));
    process.exit(1);
});
