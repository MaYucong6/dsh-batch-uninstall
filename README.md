# DSH Geek Uninstaller — 交互式插件卸载器

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Rich](https://img.shields.io/badge/UI-Rich-orange.svg)](https://github.com/Textualize/rich)

**Geek 风格交互式 DSH 插件卸载器**，风格致敬 Geek Uninstaller / Bulk Crap Uninstaller。

在 DeepSeek Harness (DSH) 环境下，通过终端 TUI 交互式勾选、批量卸载插件，核心系统插件自动锁定保护。

```
╭──────────────────────────────────────────────────────────╮
│            DSH Geek Uninstaller  v2.0                    │
│            交互式插件卸载器 · Geek 风格                  │
╰──────────────────────────────────────────────────────────╯

📦 DSH 插件管理
共 9 个  |  可卸载 3  |  🔒 核心保护 6  |  已勾选 0

  🔒  @deepseek-ai/dsh-base                系统    ⚠ 高
  🔒  @deepseek-ai/dsh-web-app             系统    ⚠ 高
▶ ☐  dsh-our-free-model                   活跃    ○ 低
  ☐  dsh-boot-animation                   活跃    ○ 低
  ☐  dshmarket                            活跃    ○ 低
  🔒  @deepseek-ai/dsh-experimental-...    系统    ◉ 中

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ↑↓ 移动  Space 勾选  Ctrl+A 全选/反选  Enter 确认  Q 退出
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 功能特性

- 🎨 **Geek 风格 TUI** — Rich 渲染的交互式终端界面
- ✅ **勾选交互** — ↑↓ 移动、Space 勾选、Ctrl+A 全选/反选
- 🔒 **核心保护** — 系统插件自动锁定、置灰、不可勾选
- ⚠ **风险分级** — 高/中/低 三级卸载风险提示
- 🛡 **二次确认** — 红色 Danger Zone 面板，防止误删
- 📊 **实时进度** — 进度条 + 彩色日志输出

## 依赖安装

```bash
pip install rich
```

## 使用方式

```bash
# 使用内置示例数据体验
python dsh_geek_uninstall.py

# 从 JSON 文件加载
python dsh_geek_uninstall.py --json dsh_plugins.json

# 从 DSH REST API 自动获取（DSH 需在运行中）
python dsh_geek_uninstall.py --fetch

# 查看帮助
python dsh_geek_uninstall.py --help
```

## 交互操作

| 按键 | 功能 |
|------|------|
| `↑` `↓` | 移动光标（自动跳过 🔒 锁定行） |
| `Space` | 勾选 / 取消勾选当前插件 |
| `Ctrl`+`A` | 全选 / 反选所有可卸载插件 |
| `Enter` | 确认选择 → 弹出二次确认面板 |
| `Q` | 安全退出 |

## 文件说明

| 文件 | 说明 |
|------|------|
| `dsh_geek_uninstall.py` | ⭐ 主脚本 — Geek 风格交互式卸载器 |
| `dsh_batch_uninstall.py` | 旧版纯序号输入版本（备用） |
| `dsh_plugins.json` | 插件数据模板（JSON 格式示例） |

## 如何获取真实插件数据

**方式一：DSH REST API**
```bash
python dsh_geek_uninstall.py --fetch
```

**方式二：保存为 JSON 文件**

在 DSH 对话中让 AI Agent 调用 `plugin_manager action: list_bundles`，将结果保存为 `dsh_plugins.json`。

**方式三：编辑 JSON 文件**

参照 `dsh_plugins.json` 模板格式，手工填入实际安装的插件信息。

## JSON 数据格式

```json
{
  "entries": [
    {
      "name": "dshmarket",
      "version": "1.66.17",
      "description": "DSH 可视化插件市场",
      "enabled": true,
      "installed": true,
      "removable": true
    }
  ],
  "total": 1
}
```

核心字段：
- `name` — 插件包名称
- `removable` — `true` 可卸载，`false` 则被锁定
- `enabled` / `installed` — 控制状态图标显示

## 许可证

MIT