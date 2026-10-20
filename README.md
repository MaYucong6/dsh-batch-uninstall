# dsh-batch-uninstall

[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-blue.svg)](https://github.com/deepseek-ai)
[![npm](https://img.shields.io/npm/v/dsh-batch-uninstall)](https://www.npmjs.com/package/dsh-batch-uninstall)

**Geek 风格的 DeepSeek Harness (DSH) 批量清理工具箱。**

一个规范的 DSH 插件（Cordis bundle + client 设置页）。安装后在 **DSH 设置 → 批量卸载** 打开，三个标签页分别处理插件、工作区与回收站。

```
Geek Uninstaller  ·  v1.3.0
 [插件]  [工作区]  [回收站]
────────────────────────────────────────────────────────
 共 15   可卸载 5   锁定 10   已勾选 0
                        [刷新] [全选] [全不选] [卸载选中项]

 🔒 @deepseek-ai/dsh-base        0.2.1-rc.2   🔒 核心
 🔒 @deepseek-ai/dsh-web-app     0.2.1-rc.2   🔒 核心
 ☐  dsh-our-free-model           2.3.0        ○ 低
 ☐  dshmarket                    1.66.35      ○ 低
 ☐  dsh-cost-meter               1.8.31       ○ 低
 ☐  dsh-batch-uninstall          1.3.0        ○ 低
```

## 功能

### 插件标签页

- **多选批量卸载** — 逐个勾选、全选、全不选，一次卸载任意多个
- **核心保护** — `@deepseek-ai/dsh-*` 等系统 bundle 锁定置灰，无法勾选
- **风险分级** — 高 / 中 / 低三档提示

### 工作区标签页

- **批量删除工作区** — 勾选多个 Workspace 一次性移除
- **软删除** — 只取消注册并把会话目录移入回收站，**数据不丢失**
- 显示每个工作区的路径与会话数

### 回收站标签页

- **可恢复** — 把移入回收站的会话目录还原回 `~/.dsh/sessions/`
- **一键清空** — 永久删除回收站全部内容（带二次确认）

### 通用

- **内置设置页** — 不需浏览器地址、不需 Python、不需任何外部文件
- **二次确认** — 红色确认框列出全部目标，防误删
- **实时进度** — 进度条 + 逐条成功/失败日志
- **主题自适应** — 跟随 DSH 浅色 / 深色主题
- **中英双语** — 跟随 DSH 语言设置

## 安装

```bash
# npm（推荐）
dsh plugin --profile <你的 profile> add dsh-batch-uninstall

# 或 GitHub
dsh plugin --profile <你的 profile> add github:MaYucong6/dsh-batch-uninstall
```

或在 DSH 插件市场搜索 `dsh-batch-uninstall`。

安装后重启 DSH（或刷新页面），设置左侧会出现 **「批量卸载」** 入口。

## 架构

```
┌──────────────────────────────────────────────────────┐
│  client/client.js  (Client 半 · 设置页 UI)           │
│  Shell: [插件] [工作区] [回收站] 三个 tab            │
│  PluginsPanel · WorkspacesPanel · TrashPanel          │
└───────────────┬──────────────────────────────────────┘
                │ HTTP (localhost)
                ▼
┌──────────────────────────────────────────────────────┐
│  lib/index.js  (Host 半 · HTTP API)                  │
│  GET  /dsh-batch-uninstall/bundles.json              │
│  POST /dsh-batch-uninstall/remove                    │
│  GET  /dsh-batch-uninstall/workspaces.json           │
│  POST /dsh-batch-uninstall/workspaces/delete         │
│  GET  /dsh-batch-uninstall/trash.json                │
│  POST /dsh-batch-uninstall/trash/restore             │
│  POST /dsh-batch-uninstall/trash/empty               │
└───────────────┬──────────────────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
┌──────────────────┐  ┌────────────────────────────┐
│ pluginManager    │  │ workspaceRegistry + fs     │
│ listBundles()    │  │ list() / delete() + 目录移动│
│ removeBundle()   │  │ ~/.dsh/sessions ↔ .trash    │
└──────────────────┘  └────────────────────────────┘
```

Host 半走 DSH 自己的服务（`pluginManager`、`workspaceRegistry`），与内置管理器同一套护栏；Client 半只注入 `slots`（真实服务），样式内联且不依赖主题变量名，`apply()` 全程异常隔离，插件失效也**绝不会**影响 DSH 启动。

## 回收站是怎么工作的

删除工作区时执行两步：

1. `workspaceRegistry.delete(id)` — DSH 移除该工作区的注册（侧边栏里消失）
2. 把 `~/.dsh/sessions/<编码后的路径>/` 整个移到 `~/.dsh/.trash/<时间戳>__<编码>/`

**只移动，不删除** —— 所以回收站里能原样恢复。点「一键清空回收站」才真正 `rm -rf`。

> 会话目录名由工作区路径编码而来：分隔符 `:` `\` `/` 折叠为 `-`，非 ASCII 字符转为 `~XXXX`，整体包裹为 `--…--`。

## 核心保护

以下 Bundle 无法被卸载（Host 与 Client 双层锁定）：

| 保护对象 | 说明 |
|----------|------|
| `@deepseek-ai/dsh-base` | 核心基础层 |
| `@deepseek-ai/dsh-web-app` | Web 应用层 |
| `@deepseek-ai/dsh-sdk-*` | SDK 配置 |
| `@deepseek-ai/dsh-headless` / `acp-app` | 其他官方 profile |
| 所有 `removable: false` 的 Bundle | 系统声明不可移除 |

## 文件说明

| 文件 | 说明 |
|------|------|
| `lib/index.js` | Host 半：HTTP API（插件 / 工作区 / 回收站） |
| `client/client.js` | Client 半：DSH 设置页三 tab 界面 |
| `cordis.patch.yml` | Bundle 挂载补丁 |
| `package.json` | npm 包清单（含 `dsh.bundle` + `dsh.client`） |
| `dsh_geek_uninstall.py` | 可选：独立的 Python TUI 客户端（走同一套 HTTP API） |
| `dsh_plugins.json` | 示例数据 |

Python TUI 是可选的命令行替代界面，需要 `pip install rich`：

```bash
python dsh_geek_uninstall.py
```

## 版本历史

| 版本 | 变更 |
|------|------|
| **v1.3.0** | 新增工作区批量删除（软删除到回收站）与回收站管理，设置页改为三 tab |
| v1.2.3 | 用 `slots.inject` 等待 `settings.section` 就绪再注册 |
| v1.2.2 | 版本号对齐发布 |
| v1.2.1 | 修复文字在浅色主题下隐形 |
| v1.2.0 | 内置 DSH 设置页 |
| v1.0.0 | 规范 DSH 插件形态 |

## 开发

```bash
node --check lib/index.js
node --check client/client.js
```

## License

MIT
