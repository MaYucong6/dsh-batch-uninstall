# dsh-batch-uninstall

[![npm](https://img.shields.io/npm/v/dsh-batch-uninstall)](https://www.npmjs.com/package/dsh-batch-uninstall)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Geek Uninstaller 风格的 DeepSeek Harness (DSH) 批量插件卸载器。**

一个规范的 DSH 插件（npm + Cordis），暴露本地 HTTP API，配合内置的 Python TUI 实现「勾选 → 二次确认 → 批量卸载」的交互式体验。核心系统插件自动锁定，防止误删。

```
╭──────────────────────────────────────────────────────────────╮
│            DSH Geek Uninstaller  v2.0                        │
│            交互式插件卸载器 · Geek 风格                      │
╰──────────────────────────────────────────────────────────────╯

📦 DSH 插件管理
共 9 个  |  可卸载 3  |  🔒 核心保护 6  |  已勾选 0

  🔒  @deepseek-ai/dsh-base                系统    ⚠ 高
  🔒  @deepseek-ai/dsh-web-app             系统    ⚠ 高
▶ ☐  dsh-our-free-model                   活跃    ○ 低
  ☐  dsh-boot-animation                   活跃    ○ 低
  ☐  dshmarket                            活跃    ○ 低

  ↑↓ 移动  Space 勾选  Ctrl+A 全选/反选  Enter 确认  Q 退出
```

## 安装

```bash
# 方式一：通过 DSH 插件市场 / CLI 安装
dsh plugin add dsh-batch-uninstall

# 方式二：本地开发安装
cd <你的 profile 目录>
npm install dsh-batch-uninstall
```

安装后重启 DSH，插件会挂载 HTTP API（`/dsh-batch-uninstall/*`）。

## 使用

```bash
# 运行 Python TUI（自动连接插件 API 获取真实插件列表）
python dsh_geek_uninstall.py

# 强制使用内置示例数据（插件未运行时）
python dsh_geek_uninstall.py --json dsh_plugins.json
```

### 交互操作

| 按键 | 功能 |
|------|------|
| `↑` `↓` | 移动光标（自动跳过 🔒 锁定行） |
| `Space` | 勾选 / 取消勾选 |
| `Ctrl`+`A` | 全选 / 反选 |
| `Enter` | 确认 → 二次确认 → 批量卸载 |
| `Q` | 退出 |

## 架构

```
┌─────────────────────────────────────────────┐
│  dsh_geek_uninstall.py (Python TUI)         │
│  交互式勾选 · 二次确认 · 进度条              │
└──────────────┬──────────────────────────────┘
               │ HTTP (localhost:19387)
               ▼
┌─────────────────────────────────────────────┐
│  lib/index.js (Host 插件)                   │
│  GET  /dsh-batch-uninstall/bundles.json     │
│  POST /dsh-batch-uninstall/remove           │
└──────────────┬──────────────────────────────┘
               │ ctx.get('pluginManager')
               ▼
┌─────────────────────────────────────────────┐
│  DSH pluginManager 服务                     │
│  listBundles() / removeBundle(name)         │
└─────────────────────────────────────────────┘
```

## 核心保护

以下 Bundle 无法被卸载（Host 与 TUI 双层锁定）：

| 保护对象 | 说明 |
|----------|------|
| `@deepseek-ai/dsh-base` | 核心基础层 |
| `@deepseek-ai/dsh-web-app` | Web 应用层 |
| `@deepseek-ai/dsh-sdk-*` | SDK 配置 |
| 所有 `removable: false` 的 Bundle | 系统声明不可移除 |

## 文件说明

| 文件 | 说明 |
|------|------|
| `lib/index.js` | Host 插件入口（暴露 HTTP API） |
| `cordis.patch.yml` | Bundle 挂载补丁 |
| `package.json` | npm 包清单（含 `dsh` 元数据） |
| `dsh_geek_uninstall.py` | Python TUI 客户端 |
| `dsh_batch_uninstall.py` | 旧版纯序号版本 |
| `dsh_plugins.json` | 示例数据 |

## 开发

```bash
# 语法检查
node --check lib/index.js
python -m py_compile dsh_geek_uninstall.py
```

## License

MIT
