# jfcat skills

本仓库是 **jfcat 官方技能合集**：每个子目录 = 一个技能包，根文件为 **`SKILL.md`**，供 **Claude Code、Cursor、OpenClaw** 等通过「读 SKILL + 可选脚本」增强 Agent 能力。

**用途概览**

- 描述本机工具链（如 **`jfcat-cli`**：独立 Chrome profile、远程调试端口）。
- 与 **jfcat 浏览器扩展 / API / OpenClaw MCP** 协作时，给模型可检索的操作约定（**`jfcat-plugin`** 预留）。


| 技能 | 说明 |
|------|------|
| **jfcat-cli** | 本机 Chrome 多 profile / 可选 `--remote-debugging-port` |
| **jfcat-plugin** | 配合JFCAT CHROME V3插件：扩展侧（`content/`、心跳、与 API 对照等） |

---

## 各工具如何接入（Claude / Cursor / OpenClaw）

| 工具 / 场景 | 做法 |
|-------------|------|
| **openskills + Claude Code** | 默认装到项目 **`.claude/skills/<技能名>/`**，与 Claude Code 技能目录一致。 |
| **openskills + 通用 AGENTS** | 加 **`-u`** 装到 **`.agent/skills/`**，再用 `openskills sync` 更新 **`AGENTS.md`**，便于 Cursor 等读项目级说明。 |
| **Cursor（项目技能）** | 将 **`jfcat-cli`** 等目录 **符号链接或复制** 到 **`.cursor/skills/<技能名>/`**，或依赖上述 **`AGENTS.md`**。 |
| **OpenClaw 网关** | 将 **`jfcat-cli`** 等目录 **复制或符号链接** 到 **`~/.openclaw/skills/<技能名>/`**|

以上可同时使用：例如 openskills 管 Claude/AGENTS，OpenClaw 将技能放进 **`~/.openclaw/skills`** 并在 `extraDirs` 中注册该目录。

---

## openskills（从 GitHub 安装）

需已安装 [openskills](https://www.npmjs.com/package/openskills)（如 `npm i -g openskills`）。在**目标项目根目录**执行：

```bash
# 安装本仓库内全部技能（多包时 -y 表示全选）
openskills install seyo816/jfcat-skills -y

# 装到 .agent/skills，便于 sync 生成 AGENTS.md（Cursor / 通用）
openskills install seyo816/jfcat-skills -u -y

# 只装某一个（子路径）
openskills install seyo816/jfcat-skills/jfcat-cli -y

openskills list
openskills sync -o AGENTS.md -y   # 可选
```

`-y`：跳过交互；`-u`：**universal**，写入 `.agent/skills`。

---

## 不经过 openskills（复制 / 链目录）

把克隆下来的 **`jfcat-cli`**（或任意 `/<技能名>`）**复制**（`cp -a`）或**符号链接**（`ln -sf`）到对应目录即可：

```bash
# Cursor（路径按本机修改）
ln -sf /path/to/jfcat-skills/jfcat-cli /path/to/project/.cursor/skills/jfcat-cli

# Claude Code
ln -sf /path/to/jfcat-skills/jfcat-cli /path/to/project/.claude/skills/jfcat-cli

# OpenClaw：放到用户目录下，再在 openclaw.json 的 extraDirs 里加入本目录的绝对路径
mkdir -p ~/.openclaw/skills
ln -sf /path/to/jfcat-skills/jfcat-cli ~/.openclaw/skills/jfcat-cli
# 示例：在 skills.load.extraDirs 中增加一项（请换成你本机展开后的路径）
# "/Users/你的用户名/.openclaw/skills"
```

也可用 **`cp -a /path/to/jfcat-skills/jfcat-cli ~/.openclaw/skills/`** 做物理复制（不依赖原克隆路径）。

---

## jfcat-cli（命令行）

```bash
export PATH="/path/to/本仓库/jfcat-cli:$PATH"
# 或：ln -s /path/to/本仓库/jfcat-cli/jfcat-cli /usr/local/bin/jfcat-cli

jfcat-cli -h
jfcat-cli browser start <profile> [-p <端口>]
jfcat-cli browser stop <profile>
```

- 数据：`~/.chromedata/<profile>`（`JFCAT_CHROMEDATA_ROOT`）；`-p` 才开远程调试。  
- `JFCAT_CHROME`：可选，指定浏览器可执行文件。

---

## 新增技能

新建 **`/<name>/SKILL.md`**（及脚本），提交到本仓库；他人通过 **`openskills install seyo816/jfcat-skills`** 或子路径安装，或复制/链到 **`.cursor/skills`**、**`.claude/skills`**、**`~/.openclaw/skills`** 。
