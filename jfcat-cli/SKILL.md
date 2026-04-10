---
name: jfcat-cli
description: >-
  仅针对本机浏览器 / 本地浏览器：jfcat-cli 在**当前机器**上启停 Chrome、管理 ~/.chromedata/<实例名>。
  调试或自动化操作**本地**页面时用 browser start <实例名> -p。CDP 子命令（cdp list/run/raw）需 Node 18+，连本机调试端口，原子操作与 jfcat 扩展 background/index.ts 中 bb-browser 对齐。
  另有一套 jfcat（扩展/API 等）可控制**远程浏览器**——远端任务勿用本技能在本机乱启 Chrome，以免干扰。
metadata:
  openclaw:
    emoji: 🖥️
---

# jfcat-cli

## 本机 / 本地浏览器 vs 远程浏览器（勿混用）

| 场景 | 用谁 |
|------|------|
| 操作**本机浏览器**、**本地浏览器**（当前执行命令的这台电脑上的 Chrome） | **本技能：`jfcat-cli`** — 启停进程、本机数据目录、本机 CDP 端口 |
| 控制**远程浏览器**（页面跑在别的机器 / 云端 / 网关后面的浏览器） | **jfcat 其它能力**（如扩展、API、OpenClaw/MCP 等，以项目文档为准）— **不要**用 `jfcat-cli` 在本机再开一套 Chrome 冒充「远程」 |

**原则**：先判断目标页面在哪台机器上。远端用 jfcat 遥控链路；只有明确要动**本机 / 本地** Chrome 时才用 `jfcat-cli`，避免两套方案互相抢焦点、占端口或改错环境。

## 概念：实例

- **实例**：本机上一份独立 Chrome **用户数据目录**，路径 `~/.chromedata/<实例名>`（可用 `JFCAT_CHROMEDATA_ROOT` 改数据根）。即「本机浏览器」的一个隔离配置。
- 命令行帮助里参数仍写作 `profile`，与 **实例名** 同一含义（如 `ks1`、`work`）。
- 多实例互不共享书签/登录态；换实例 = 换目录名。

## Agent 决策（何时用、怎么用）

1. **要调试本机浏览器 / 本地浏览器，或在本机用 CDP、自动化连接已开的 Chrome**  
   → `jfcat-cli browser start <实例名> -p`  
   - `-p` 不带数字：在默认端口段内**自动选一个空闲端口**并启用 `--remote-debugging-port`。  
   - `-p <端口>`：固定端口。  
   - **不要用**「只 start、不加 `-p`」来做本机调试/遥控，那样没有调试端口。

2. **仅需人类在本机手动点浏览器、不需要 CDP**  
   → `jfcat-cli browser start <实例名>`（无 `-p`）。

3. **本机该实例已有 Chrome 在用同一数据目录**  
   → 再次 `start` 会**跳过启动**（成功退出），直接用已打开的本地窗口；若需调试端口而当时未开 `-p`，应先 `browser stop <实例名>` 再 `start … -p`，或按脚本约定处理。

4. **结束本机该实例对应的 Chrome 进程**  
   → `jfcat-cli browser stop <实例名>`。

5. **查看本机哪些实例在跑、本地调试端口多少**  
   → `jfcat-cli browser online -all`（含 `debug=<端口>` 或 `debug=-`）；`browser list -all` 列出数据根下全部项及在线信息。

6. **在本机通过 CDP 做页面原子操作（click、fill、eval、截图等）或透传任意 CDP 方法**  
   → 先 `browser start <实例名> -p` 拿到 **debug 端口**，再 `jfcat-cli cdp …`（需 Node 18+）。详见下文 **CDP** 一节。

## CDP（Chrome DevTools Protocol）

**前提**：本机 Chrome 已带 `--remote-debugging-port`（用 `jfcat-cli browser start <实例名> -p`）；本机已安装 **Node.js 18+**（`cdp` 由 `bin/jfcat-cdp-runtime.mjs` 执行，无 npm 依赖）。

**与代码对齐**：高阶 `cdp run <action>` 的语义与 **`jfcat/src/background/index.ts`** 里 `executeBbBrowserAction` 的 **纯 CDP 路径**一致（蛇形 JSON `params`，如 `ref` 用 `@<backendNodeId>` 或数字）。扩展里依赖 `chrome.tabs` / `chrome.history` / content 注入 的能力 **不在** CLI 里复刻（见 `cdp help-actions` 文末说明）。

| 子命令 | 作用 |
|--------|------|
| `jfcat-cli cdp list [-p <端口> \| <端口>] [-H <host>]` | `GET /json/list`，含 `webSocketDebuggerUrl` |
| `jfcat-cli cdp run -p <端口> [-i <pick>] [-H <host>] <action> [params]` | 高阶 action：`click`、`hover`、`fill`、`type`、`select`、`check`、`uncheck`、`get`、`press`、`scroll`、`eval`、`screenshot`、`snapshot`、`dialog`、`wait`、`refresh`、`open`/`navigate`、`back`、`forward`、`raw`；`params` 可为 JSON 字符串、`@文件` 或 `-`（stdin） |
| `jfcat-cli cdp raw -p <端口> [-i <pick>] [-H <host>] <Domain.method> [params]` | 透传任意 CDP，如 `Runtime.evaluate`、`Page.navigate`；`params` 同上 |
| `jfcat-cli cdp help-actions` | 打印全部 action 与 params 字段说明 |

**`-i`（pick）**：在 `type===page` 的目标里选第几个（从 0 起），或传 **当前页 URL 子串** 匹配。

**示例**：

```bash
jfcat-cli cdp list 9222
jfcat-cli cdp run -p 9222 -i 0 select '{"ref":"@12345","value":"opt"}'
jfcat-cli cdp raw -p 9222 -i 0 Runtime.evaluate '{"expression":"1+1","returnByValue":true}'
```

## 命令速查

| 命令 | 说明 |
|------|------|
| `jfcat-cli -h` / `--help` | 帮助 |
| `jfcat-cli -v` / `--version` | 版本 |
| `jfcat-cli browser start <实例名> [-p [端口]]` | 在本机启动**本地浏览器**；调试本机页面务必加 `-p`。默认后台，终端立即返回 |
| `jfcat-cli browser stop <实例名>` | 结束本机使用该数据目录的 Chrome |
| `jfcat-cli browser list` / `list -all` | 默认等同列数据根；`-all` 含 online、pids、`debug`、opened、last_closed 等 |
| `jfcat-cli browser online` / `online -all` | 默认每行一个实例名；`-all` 含详情与 **`debug=`** 端口列 |
| `jfcat-cli cdp list` / `cdp run` / `cdp raw` / `cdp help-actions` | 本机 CDP；需 **Node 18+** 与已开启的调试端口，见上文 **CDP** 节 |

**实现路径**：`bin/jfcat-cli`；CDP 运行时 **`bin/jfcat-cdp-runtime.mjs`**。**入口**：同目录 `jfcat-cli`（加入 PATH 或符号链接后可直接执行 `jfcat-cli`）。

## 环境变量

| 变量 | 作用 |
|------|------|
| `JFCAT_CHROMEDATA_ROOT` | 数据根目录（默认 `~/.chromedata`） |
| `JFCAT_CHROME` | 浏览器可执行文件（可选；不设则自动探测） |
| `JFCAT_BROWSER_FOREGROUND` | 设为 `1` 时 `start` 前台 `exec`（便于看 Chrome 日志） |
| `JFCAT_DEBUG_PORT_MIN` / `JFCAT_DEBUG_PORT_MAX` | `start -p` 自动选端口范围（默认约 9222～9322） |

## 标签恢复

脚本含 `--restore-last-session`；若仍常空白页，在 Chrome **设置 → 启动时** 选 **继续浏览上次打开的网页**。

克隆本仓库时，人类可阅读 **`skills/README.md`**（合集规范、openskills 用法）；该文件不在 openskills 安装副本中。
