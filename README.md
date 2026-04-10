# jfcat 仓库 · `skills/` 说明

本目录存放 **可给 Agent 使用的技能包**（每个子目录一个独立包，根文件为 `SKILL.md`）。

| 技能 | 说明 |
|------|------|
| **jfcat-cli** | 已实现：本机 Chrome 多 profile / 远程调试 CLI |
| **jfcat-plugin** | **预留**：浏览器扩展（plugin）相关说明，待补充具体内容 |

> **与 openskills 的关系**：执行 `openskills install ./skills/jfcat-cli` 时，工具会**递归复制整个 `skills/jfcat-cli/`** 到 `.claude/skills` 或 `.agent/skills`。  
> **本文件 `skills/README.md` 位于技能包上一级**，不会被复制进上述安装目录；完整人机说明写在这里，避免污染 Agent 技能目录。

### 为何不要在 `skills/` 根目录放 `SKILL.md`？

openskills 规则是：

- **`skills/SKILL.md` 若存在**：整份 `skills/` 会被当作 **一个** 技能包装进去（名称取自 frontmatter），**不再**扫描子目录里的 `jfcat-cli`、`jfcat-plugin` 等，你会失去「多包一次装」的行为。
- **`skills/SKILL.md` 不存在**：`openskills install ./skills` 会 **递归发现** 每个子目录里的 `SKILL.md`，一次装上 **全部** 技能（多选或 `-y` 全选）。

因此：**「一次性总安装」= 不要建根级 `SKILL.md`，直接执行：**

```bash
cd /path/to/jfcat
openskills install ./skills -y
```

人类可读的总说明用 **`README.md`**（当前文件）即可，不要用 `SKILL.md` 代替。

---

## jfcat 项目上下文（简要）

| 区域 | 说明 |
|------|------|
| 浏览器扩展 | `content/`、`release/` 等，抖店等页面自动化 |
| 后端 API | 独立仓库 `jfcat-api`，含 AI、XMAD、MCP 公钥接口等 |
| OpenClaw | `openclaw-mcp/`、`openclaw-skill-extension-registry/`（网关 MCP、技能索引，**勿**把整个 jfcat 根目录当作 OpenClaw `extraDirs`） |
| 本 CLI | `jfcat-cli`：本机 Chrome 多 profile / 远程调试，与扩展、CDP、本地脚本配合 |

---

## jfcat-plugin（预留）

`skills/jfcat-plugin/` 目前仅 **`SKILL.md`**，用于将来集中写 **浏览器扩展（plugin）** 侧约定（`content/`、构建、与 API/OpenClaw 对照等）。安装方式与 `jfcat-cli` 相同：直接符号链接到 `.cursor/skills` / `.claude/skills`，或 `openskills install ./skills/jfcat-plugin -y`。

---

## jfcat-cli

### 目录布局

```
skills/jfcat-cli/
├── SKILL.md      # Agent 用：核心行为（精简）
├── jfcat-cli     # 可执行总入口（转发到 bin/jfcat-cli）
└── bin/jfcat-cli # Bash 实现（browser start/stop、Chrome 探测等）
```

### 用法摘要

```bash
# 将本 skill 目录加入 PATH（示例）
export PATH="/path/to/jfcat/skills/jfcat-cli:$PATH"

jfcat-cli -h
jfcat-cli -v
jfcat-cli browser start <profile> [-p <端口>]
jfcat-cli browser stop <profile>
```

- **数据目录**：`~/.chromedata/<profile>`（可用 `JFCAT_CHROMEDATA_ROOT` 改根路径）。
- **`-p`**：启用 `remote-debugging-port`；不传则不开调试端口。
- **Chrome 路径**：未设置 `JFCAT_CHROME` 时自动探测 macOS / Linux / Windows（Git Bash）；仍失败则手动指定可执行文件路径。

### 环境变量

| 变量 | 含义 |
|------|------|
| `JFCAT_CHROMEDATA_ROOT` | 用户数据根目录，默认 `$HOME/.chromedata` |
| `JFCAT_CHROME` | Chrome/Chromium 可执行文件（可选） |

---

## 直接安装（不经过 openskills）

把本仓库里的 skill **复制**或**符号链接**到各工具约定的目录即可，无需安装 Node / openskills。下面路径请把 `/path/to/jfcat` 换成你本机克隆根目录。

### Cursor（项目内技能）

```bash
mkdir -p /path/to/your-project/.cursor/skills
ln -sf /path/to/jfcat/skills/jfcat-cli /path/to/your-project/.cursor/skills/jfcat-cli
# 或复制：cp -a /path/to/jfcat/skills/jfcat-cli /path/to/your-project/.cursor/skills/
```

### Claude Code（`.claude/skills`）

```bash
mkdir -p /path/to/your-project/.claude/skills
ln -sf /path/to/jfcat/skills/jfcat-cli /path/to/your-project/.claude/skills/jfcat-cli
```

### 通用 `.agent/skills`（若你的工作流会读该目录）

```bash
mkdir -p /path/to/your-project/.agent/skills
ln -sf /path/to/jfcat/skills/jfcat-cli /path/to/your-project/.agent/skills/jfcat-cli
```

### OpenClaw

无需复制 skill 目录：在 `~/.openclaw/openclaw.json` 的 `skills.load.extraDirs` 里加入 **`/path/to/jfcat/skills/jfcat-cli` 的绝对路径**（与 `openclaw-skill-extension-registry` 并列）。网关会扫描该目录下的 `SKILL.md`。

### jfcat-cli 命令行（终端里直接敲 `jfcat-cli`）

与「技能安装」无关，只要把可执行入口加入 PATH 或做全局链接：

```bash
chmod +x /path/to/jfcat/skills/jfcat-cli/jfcat-cli
ln -sf /path/to/jfcat/skills/jfcat-cli/jfcat-cli /usr/local/bin/jfcat-cli
# 或：export PATH="/path/to/jfcat/skills/jfcat-cli:$PATH"
```

---

## 通过 openskills 安装（可选）

在 **jfcat 仓库根**执行（需已 `npm i -g openskills`）。`-y` 跳过交互；`-u` 装到 `./.agent/skills`。

```bash
cd /path/to/jfcat
openskills install ./skills/jfcat-cli -y          # → ./.claude/skills/jfcat-cli
openskills install ./skills/jfcat-cli -u -y       # → ./.agent/skills/jfcat-cli
openskills list
openskills sync -o AGENTS.md -y
```

安装副本中含 `SKILL.md`、`bin/jfcat-cli`、`jfcat-cli` 入口；**不含** `skills/README.md`。

### Cursor（与 openskills 二选一）

可用上面「直接安装」链到 `.cursor/skills`，或依赖 `openskills sync` 生成的 `AGENTS.md`。

---

## 新增技能包

新建 `skills/<name>/SKILL.md`（及所需脚本）。安装任选其一：**直接**把 `skills/<name>` 链到 `.cursor/skills/` / `.claude/skills/`（见上文「直接安装」），或在仓库根执行 `openskills install ./skills/<name> -y`。约定以 [openskills](https://www.npmjs.com/package/openskills) 为准。
