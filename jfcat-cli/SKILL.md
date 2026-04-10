---
name: jfcat-cli
description: >-
  本地 jfcat-cli：按 profile 使用独立 Chrome 数据目录（~/.chromedata/<name>），可选 remote-debugging-port，
  browser stop 结束进程。用于本机调试、CDP、与扩展/自动化配合。
metadata:
  openclaw:
    emoji: 🖥️
---

# jfcat-cli

## 何时使用

需要**固定 Chrome profile**、用 **`-p` 打开远程调试端口**，或 **`browser stop`** 结束该 profile 对应进程时。

## 命令

| 命令 | 说明 |
|------|------|
| `jfcat-cli -h` / `--help` | 帮助 |
| `jfcat-cli -v` / `--version` | 版本 |
| `jfcat-cli browser start <profile> [-p <端口>]` | 启动；仅当给出 `-p` 时启用调试端口 |
| `jfcat-cli browser stop <profile>` | 结束使用该数据目录的 Chrome |

**实现**：`bin/jfcat-cli`。**总入口**：同目录的 `jfcat-cli`（加入 PATH 或符号链接后可直接打 `jfcat-cli`）。

## 环境变量

`JFCAT_CHROMEDATA_ROOT`（数据根目录）、`JFCAT_CHROME`（浏览器可执行文件，可选）。未设置 `JFCAT_CHROME` 时按系统探测 Chrome/Chromium。

## 标签恢复

脚本带 `--restore-last-session`；若仍常开空白页，在 Chrome **设置 → 启动时** 选 **继续浏览上次打开的网页**。

克隆本仓库时，人类可阅读 **`skills/README.md`**（合集规范、与 `anthropics/skills` 布局对应、openskills 用法）；该文件不在 openskills 安装副本中。
