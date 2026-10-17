# dsh-batch-uninstall

[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-blue.svg)](https://github.com/deepseek-ai)

**Geek Uninstaller 风格的 DeepSeek Harness (DSH) 批量插件卸载器。**

一个规范的 DSH 插件（Cordis bundle + client 设置页）。安装后在 **DSH 设置 → 批量卸载** 打开，勾选多个插件一次性移除。核心系统插件自动锁定，防止误删。

```
Geek Uninstaller — 批量插件卸载器
勾选要卸载的插件后批量移除。核心系统插件已锁定保护。 · v1.2.2

  共 15   可卸载 5   锁定 10   已勾选 0     [刷新] [全选] [全不选] [卸载选中项]

  🔒 @deepseek-ai/dsh-base        0.2.0-rc.2   🔒 核心
  🔒 @deepseek-ai/dsh-web-app     0.2.0-rc.2   🔒 核心
  ☐  dsh-our-free-model           2.3.0        ○ 低
  ☐  dshmarket                    1.66.27      ○ 低
  ☐  dsh-cost-meter               1.8.31       ○ 低
  ☐  dsh-batch-uninstall          1.2.2        ○ 低
```

## 功能

- **内置设置页** — 不需浏览器地址、不需 Python、不需任何外部文件，装在 DSH 里直接用
- **多选批量卸载** — 逐个勾选、全选、全不选，一次卸载任意多个
- **二次确认** — 红色确认框列出全部目标，防误删
- **实时进度** — 进度条 + 逐条成功/失败日志
- **核心保护** — `@deepseek-ai/dsh-*` 等系统 bundle 锁定置灰，无法勾选
- **风险分级** — 高 / 中 / 低三档提示
- **主题自适应** — 跟随 DSH 浅色 / 深色主题
- **中英双语** — 跟随 DSH 语言设置

## 安装

```bash
dsh plugin --profile <你的 profile> add github:MaYucong6/dsh-batch-uninstall
```

或在 DSH 插件市场搜索 `dsh-batch-uninstall`。

安装后重启 DSH（或刷新页面），设置左侧会出现 **「批量卸载」** 入口。

## 架构

```
┌─────────────────────────────────────────────────────┐
│  client/client.js  (Client 半 · 设置页 UI)          │
│  勾选 · 全选 · 二次确认 · 进度条 · 日志              │
└───────────────┬─────────────────────────────────────┘
                │ HTTP (localhost)
                ▼
┌─────────────────────────────────────────────────────┐
│  lib/index.js  (Host 半 · HTTP API)                 │
│  GET  /dsh-batch-uninstall/bundles.json             │
│  POST /dsh-batch-uninstall/remove                   │
└───────────────┬─────────────────────────────────────┘
                │ ctx.get('pluginManager')
                ▼
┌─────────────────────────────────────────────────────┐
│  DSH pluginManager 服务                             │
│  listBundles() / removeBundle(name)                 │
└─────────────────────────────────────────────────────┘
```

Host 半走 DSH 自己的 `pluginManager` 服务，与内置插件管理器同一套护栏；Client 半只注入 `slots`（真实服务），样式内联且不依赖主题变量名，任何异常都被隔离，插件失效也**绝不会**影响 DSH 启动。

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
| `lib/index.js` | Host 半：HTTP API，调用 `pluginManager` |
| `client/client.js` | Client 半：DSH 设置页里的批量卸载界面 |
| `cordis.patch.yml` | Bundle 挂载补丁 |
| `package.json` | npm 包清单（含 `dsh.bundle` + `dsh.client`） |
| `dsh_geek_uninstall.py` | 可选：独立的 Python TUI 客户端（走同一套 HTTP API） |
| `dsh_plugins.json` | 示例数据 |

Python TUI 是可选的命令行替代界面，需要 `pip install rich`：

```bash
python dsh_geek_uninstall.py
```

## 开发

```bash
node --check lib/index.js
node --check client/client.js
```

## License

MIT
