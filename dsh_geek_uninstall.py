#!/usr/bin/env python3
"""
╔════════════════════════════════════════════════════════════════╗
║        DSH Geek Uninstaller  —  交互式插件卸载器 v2          ║
║          风格致敬 Geek Uninstaller / Bulk Crap Uninstaller    ║
╚════════════════════════════════════════════════════════════════╝

功能：
  ● 启动后自动获取已安装插件列表，渲染成交互式勾选表格
  ● 方向键 ↑↓ 移动光标、空格键 Space 勾选/取消、Ctrl+A 全选/反选
  ● 核心系统插件 🔒 锁定不可勾选、置灰显示
  ● 回车 Enter 确认后弹出二次确认面板
  ● 实时进度条 + 彩色日志输出

用法：
  python dsh_geek_uninstall.py                     # 从 JSON 文件读取
  python dsh_geek_uninstall.py --fetch              # 从 DSH REST API 获取
  python dsh_geek_uninstall.py --json plugins.json  # 指定 JSON 文件
  python dsh_geek_uninstall.py --help               # 查看帮助

依赖：
  pip install rich
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

# ═══════════════════════════════════════════════════════════
#  Rich 库检测
# ═══════════════════════════════════════════════════════════
try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.text import Text
    from rich.align import Align
    from rich.live import Live
    from rich.layout import Layout
    from rich.columns import Columns
    from rich import box
    from rich.progress import (
        Progress,
        SpinnerColumn,
        TextColumn,
        BarColumn,
        TaskProgressColumn,
        TimeElapsedColumn,
    )
    from rich.prompt import Confirm
except ImportError:
    print("[!] 缺少依赖库 rich，请先安装：")
    print("    pip install rich")
    sys.exit(1)

console = Console()

# ═══════════════════════════════════════════════════════════
#  跨平台按键捕获
# ═══════════════════════════════════════════════════════════
_KEY_UP = "UP"
_KEY_DOWN = "DOWN"
_KEY_SPACE = "SPACE"
_KEY_ENTER = "ENTER"
_KEY_CTRL_A = "CTRL_A"
_KEY_CTRL_C = "CTRL_C"
_KEY_Q = "Q"
_KEY_UNKNOWN = "UNKNOWN"


def get_key() -> str:
    """
    跨平台读取单个按键，返回语义化字符串。
    Windows: 使用 msvcrt
    Unix:    使用 tty + termios + sys.stdin
    """
    try:
        # ── Windows ──
        import msvcrt

        ch = msvcrt.getwch()
        # 功能键 / 方向键：先来一个 \xe0 或 \x00
        if ch in ("\xe0", "\x00"):
            ch2 = msvcrt.getwch()
            mapping = {"H": _KEY_UP, "P": _KEY_DOWN, "K": _KEY_UP, "M": _KEY_ENTER}
            return mapping.get(ch2, _KEY_UNKNOWN)
        # Ctrl+A = \x01, Ctrl+C = \x03
        if ch == "\x01":
            return _KEY_CTRL_A
        if ch == "\x03":
            return _KEY_CTRL_C
        if ch == "\r" or ch == "\n":
            return _KEY_ENTER
        if ch == " ":
            return _KEY_SPACE
        if ch.lower() == "q":
            return _KEY_Q
        return ch.upper() if len(ch) == 1 else _KEY_UNKNOWN
    except ImportError:
        pass

    # ── Unix ──
    try:
        import tty
        import termios

        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            ch = sys.stdin.read(1)
            if ch == "\x1b":
                # 转义序列 ESC [ ...
                seq = sys.stdin.read(2)
                if seq == "[A":
                    return _KEY_UP
                if seq == "[B":
                    return _KEY_DOWN
                # ESC 本身
                return _KEY_Q
            if ch == "\x01":
                return _KEY_CTRL_A
            if ch == "\x03":
                return _KEY_CTRL_C
            if ch == "\r" or ch == "\n":
                return _KEY_ENTER
            if ch == " ":
                return _KEY_SPACE
            if ch.lower() == "q":
                return _KEY_Q
            return ch.upper() if len(ch) == 1 else _KEY_UNKNOWN
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
    except (ImportError, termios.error):
        # 回退：行缓冲模式
        try:
            line = input()
            if line.lower() in ("q", "quit", "exit"):
                return _KEY_Q
            return _KEY_ENTER
        except (EOFError, KeyboardInterrupt):
            return _KEY_CTRL_C

    return _KEY_UNKNOWN


# ═══════════════════════════════════════════════════════════
#  配置常量
# ═══════════════════════════════════════════════════════════
DSH_API_BASE = os.environ.get("DSH_API_URL", "http://127.0.0.1:19387")
DEFAULT_PLUGIN_FILE = Path("dsh_plugins.json")

# 核心保护列表 —— 这几个绝对不能卸载
CORE_PROTECTED = {
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "@deepseek-ai/dsh-sdk-minimal",
    "@deepseek-ai/dsh-sdk-app",
    "@deepseek-ai/dsh-acp-app",
    "@deepseek-ai/dsh-headless",
}

# 值越大=越危险，用于警告颜色分级
RISK_LOW = "low"
RISK_MEDIUM = "medium"
RISK_HIGH = "high"


def classify_risk(bundle: dict) -> str:
    """评估卸载风险等级。"""
    name = bundle.get("name", "")
    if (
        name.startswith("@deepseek-ai/dsh-")
        and not bundle.get("optional", False)
    ):
        return RISK_HIGH
    if name in CORE_PROTECTED:
        return RISK_HIGH
    if name.startswith("@deepseek-ai/"):
        return RISK_MEDIUM
    return RISK_LOW


def is_core(bundle: dict) -> bool:
    """是否为核心系统 Bundle，不可卸载。"""
    name = bundle.get("name", "")
    if name in CORE_PROTECTED:
        return True
    if bundle.get("removable") is False:
        return True
    if name.startswith("@deepseek-ai/dsh-") and not bundle.get("optional", False):
        return True
    return False


def is_removable(bundle: dict) -> bool:
    """是否可以被卸载。"""
    return not is_core(bundle) and bundle.get("removable", False) is not False


# ═══════════════════════════════════════════════════════════
#  数据加载
# ═══════════════════════════════════════════════════════════

def fetch_bundles_api() -> Optional[dict]:
    """从 DSH REST API 获取 Bundle 列表。"""
    url = f"{DSH_API_BASE}/api/plugin-manager/bundles"
    try:
        req = urllib.request.Request(url)
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def load_bundles_file(path: Path) -> Optional[dict]:
    """从 JSON 文件加载 Bundle 数据。"""
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def parse_bundles(raw: dict | list) -> list[dict]:
    """从原始数据中提取 Bundle 列表。"""
    if isinstance(raw, list):
        entries = raw
    elif isinstance(raw, dict):
        entries = raw.get("entries") or raw.get("bundles") or []
    else:
        entries = []
    return [e for e in entries if isinstance(e, dict) and "name" in e]


def builtin_data() -> dict:
    """内置示例数据。"""
    return {
        "entries": [
            {
                "name": "@deepseek-ai/dsh-base",
                "version": "0.2.0-rc.2",
                "description": "DSH 核心基础层 (Cordis 框架)",
                "enabled": True,
                "installed": False,
                "optional": False,
                "removable": False,
            },
            {
                "name": "@deepseek-ai/dsh-web-app",
                "version": "0.2.0-rc.2",
                "description": "DSH Web 应用壳 & 路由",
                "enabled": True,
                "installed": False,
                "optional": False,
                "removable": False,
            },
            {
                "name": "dsh-our-free-model",
                "version": "2.3.0",
                "description": "Our Free Model — 多模型免费接入插件",
                "enabled": True,
                "installed": True,
                "removable": True,
            },
            {
                "name": "dsh-boot-animation",
                "version": "0.4.2",
                "description": "DSH 片头开机动画 — 全屏启动影片",
                "enabled": True,
                "installed": True,
                "removable": True,
            },
            {
                "name": "dshmarket",
                "version": "1.66.17",
                "description": "DSH 可视化插件市场 — 逛一逛、点一下、装好",
                "enabled": True,
                "installed": True,
                "removable": True,
            },
            {
                "name": "@deepseek-ai/dsh-experimental-agent-team-profile",
                "version": "0.2.0-rc.2",
                "description": "Agent Teams 协作实验性插件",
                "enabled": False,
                "installed": False,
                "optional": True,
                "removable": False,
            },
            {
                "name": "@deepseek-ai/dsh-experimental-voice-input-bundle",
                "version": "0.2.0-rc.2",
                "description": "语音输入 (SenseVoice) 实验性插件",
                "enabled": False,
                "installed": False,
                "optional": True,
                "removable": False,
            },
            {
                "name": "@deepseek-ai/dsh-experimental-auto-review",
                "version": "0.2.0-rc.2",
                "description": "Auto 权限 LLM 审查实验性插件",
                "enabled": False,
                "installed": False,
                "optional": True,
                "removable": False,
            },
            {
                "name": "@deepseek-ai/dsh-experimental-schedule-bundle",
                "version": "0.2.0-rc.2",
                "description": "定时任务实验性插件",
                "enabled": False,
                "installed": False,
                "optional": True,
                "removable": False,
            },
        ],
        "total": 9,
    }


def load_all_bundles() -> list[dict]:
    """加载 Bundle 列表（API → 文件 → 内置）。"""
    source = ""

    if "--fetch" in sys.argv:
        console.print("[cyan]  ⟳  正在从 DSH REST API 获取插件列表...[/]", end="\r")
        raw = fetch_bundles_api()
        if raw is not None:
            source = "DSH REST API"
        else:
            console.print("[yellow]  ⚠  REST API 不可用，回退到本地数据     [/]")
            raw = None
    else:
        raw = None
        for i, a in enumerate(sys.argv):
            if a == "--json" and i + 1 < len(sys.argv):
                raw = load_bundles_file(Path(sys.argv[i + 1]))
                source = f"JSON 文件 ({sys.argv[i + 1]})"
                break
        if raw is None:
            raw = load_bundles_file(DEFAULT_PLUGIN_FILE)
            source = f"JSON 文件 ({DEFAULT_PLUGIN_FILE})"

    if raw is None:
        raw = builtin_data()
        source = "内置示例数据"

    bundles = parse_bundles(raw)

    # 修复：标记核心
    for b in bundles:
        b["_core"] = is_core(b)
        b["_risk"] = classify_risk(b)

    console.print(f"[dim]  数据来源: {source}  |  {len(bundles)} 个 Bundle 已加载[/]")
    time.sleep(0.4)
    return bundles


# ═══════════════════════════════════════════════════════════
#  卸载执行
# ═══════════════════════════════════════════════════════════

def uninstall_one(name: str) -> tuple[bool, str]:
    """尝试卸载单个插件，返回 (成功, 消息)。"""
    # 方式 1: REST API DELETE
    url = f"{DSH_API_BASE}/api/plugin-manager/bundles/{name}"
    try:
        data = json.dumps({"action": "remove"}).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="DELETE")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return True, f"API: {resp.status}"
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            pass  # 需要认证，回退
        elif e.code == 404:
            return False, f"插件不存在 (HTTP 404)"
        else:
            return False, f"HTTP {e.code}"
    except Exception:
        pass

    # 方式 2: dsh CLI
    cli = os.environ.get("DSH_CLI", "dsh")
    try:
        r = subprocess.run(
            [cli, "plugin", "remove", name],
            capture_output=True, text=True, timeout=30,
        )
        if r.returncode == 0:
            return True, r.stdout.strip()[:100]
        else:
            return False, r.stderr.strip()[:120]
    except FileNotFoundError:
        pass
    except Exception:
        pass

    # 方式 3: 回退——提示手工操作
    return False, "请通过 DSH 设置 → 插件管理 手工卸载"


# ═══════════════════════════════════════════════════════════
#  终端 UI 渲染
# ═══════════════════════════════════════════════════════════

def _icon(bundle: dict) -> str:
    """返回 Bundle 的状态图标。"""
    if bundle["_core"]:
        return "[red]🔒[/]"
    if bundle.get("optional") and not bundle.get("enabled"):
        return "[dim]⏻[/]"
    if bundle.get("enabled"):
        return "[green]●[/]"
    return "[yellow]◐[/]"


def _name_cell(bundle: dict, checked: bool) -> str:
    """格式化名称列。"""
    name = bundle.get("name", "?")
    version = bundle.get("version", "")

    if checked:
        prefix = "[bold yellow]☒[/]"
    else:
        prefix = "[dim]☐[/]"

    if bundle["_core"]:
        display = f"{prefix} [dim]{name}[/]"
    elif checked:
        display = f"{prefix} [bold yellow]{name}[/]"
    else:
        display = f"{prefix} {name}"

    if version:
        display += f"  [dim]{version}[/]"
    return display


def render_checklist(
    bundles: list[dict],
    checked: set[int],
    cursor: int,
    title: str = "📦 DSH 插件管理",
) -> str:
    """
    渲染交互式勾选列表。

    返回一个 Rich 可渲染的字符串，每次按键后重新生成，
    配合 `Live` 实现实时刷新。
    """

    # ── 顶部统计 ──
    total = len(bundles)
    removable = sum(1 for b in bundles if not b["_core"])
    protected = sum(1 for b in bundles if b["_core"])
    selected = len(checked)

    stats_line = (
        f"[dim]共 [bold]{total}[/] 个  |  "
        f"[green]可卸载 {removable}[/]  |  "
        f"[red]🔒 核心保护 {protected}[/]  |  "
        f"[yellow]已勾选 [bold]{selected}[/]" if selected else "[dim]已勾选 0"
    )
    stats_line += "[/]"

    # ── 表头 ──
    header = (
        f"  [dim]  [/] "
        f"[bold white]{'插件名称':<42s}[/]  "
        f"[bold white]{'状态':<6s}[/]  "
        f"[bold white]{'风险':<8s}[/]  "
        f"[bold white]{'说明'}"
    )

    lines = [f"[bold cyan]{title}[/]", stats_line, "", header, ""]

    # ── 数据行 ──
    for i, b in enumerate(bundles):
        is_checked = i in checked
        is_current = i == cursor
        name = b.get("name", "?")
        desc = (b.get("description") or "-")[:48]

        # 风险标签
        risk = b.get("_risk", RISK_LOW)
        if risk == RISK_HIGH:
            risk_tag = "[red]⚠ 高[/]"
        elif risk == RISK_MEDIUM:
            risk_tag = "[yellow]◉ 中[/]"
        else:
            risk_tag = "[dim]○ 低[/]"

        # 勾选标记
        if b["_core"]:
            check_mark = "[red]🔒[/]"
        elif is_checked:
            check_mark = "[bold yellow]☒[/]"
        else:
            check_mark = "[dim]☐[/]"

        # 状态
        if b["_core"]:
            status = "[dim]系统[/]"
        elif b.get("enabled"):
            status = "[green]活跃[/]"
        else:
            status = "[dim]停用[/]"

        # 光标高亮
        if is_current:
            cursor_marker = "[bold white on #3A3A3A]▶[/]"
        else:
            cursor_marker = " "

        # 名称显示
        if b["_core"]:
            name_display = f"[dim]{name:<42s}[/]"
        elif is_checked:
            name_display = f"[bold yellow]{name:<42s}[/]"
        elif is_current:
            name_display = f"[bold white on #3A3A3A]{name:<42s}[/]"
        else:
            name_display = f"{name:<42s}"

        row = (
            f"{cursor_marker} {check_mark}  "
            f"{name_display}  "
            f"{status:<8s}  "
            f"{risk_tag:<10s}  "
            f"[dim]{desc}[/]"
        )
        lines.append(row)

    # ── 底部快捷键 ──
    lines.append("")
    lines.append(
        "[dim]━[/]" * 65
    )
    lines.append(
        "  [bold white]↑↓[/] 移动  "
        "[bold white]Space[/] 勾选  "
        "[bold white]Ctrl+A[/] 全选/反选  "
        "[bold white]Enter[/] 确认卸载  "
        "[bold white]Q[/] 退出"
    )
    lines.append(
        "[dim]━[/]" * 65
    )

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════
#  交互式勾选主循环
# ═══════════════════════════════════════════════════════════

def interactive_select(bundles: list[dict]) -> list[dict] | None:
    """
    交互式多选勾选菜单。
    返回用户选中的 Bundle 列表，None 表示退出。
    """

    checked: set[int] = set()
    cursor = 0
    n = len(bundles)

    # 初始光标定位到第一个可卸载的
    for i, b in enumerate(bundles):
        if not b["_core"]:
            cursor = i
            break

    console.clear()
    console.print("\n")
    console.print(Panel(
        "[bold]Geek Uninstaller[/] — DSH 插件管理\n"
        "[dim]空格勾选 | 方向键移动 | Ctrl+A 全选/反选 | Enter 确认 | Q 退出[/]",
        border_style="cyan",
        padding=(0, 2),
    ))

    last_render = ""

    with Live(console=console, refresh_per_second=30, screen=False, auto_refresh=False) as live:
        while True:
            content = render_checklist(bundles, checked, cursor)
            if content != last_render:
                live.update(Panel(content, border_style="cyan", padding=(1, 1)), refresh=True)
                last_render = content

            key = get_key()

            if key == _KEY_UP:
                # 找上一个非核心行
                for _ in range(n):
                    cursor = (cursor - 1) % n
                    if not bundles[cursor]["_core"]:
                        break

            elif key == _KEY_DOWN:
                for _ in range(n):
                    cursor = (cursor + 1) % n
                    if not bundles[cursor]["_core"]:
                        break

            elif key == _KEY_SPACE:
                if not bundles[cursor]["_core"]:
                    if cursor in checked:
                        checked.discard(cursor)
                    else:
                        checked.add(cursor)

            elif key == _KEY_CTRL_A:
                # 全选/反选所有可卸载的
                all_removable = {i for i, b in enumerate(bundles) if not b["_core"]}
                if checked == all_removable:
                    checked.clear()
                else:
                    checked = all_removable.copy()

            elif key == _KEY_ENTER:
                selected = [bundles[i] for i in sorted(checked)]
                if not selected:
                    # 没选任何东西，提示一下
                    live.update(Panel(
                        render_checklist(bundles, checked, cursor)
                        + "\n\n[yellow]  ⚠  尚未勾选任何插件，请用 [bold]Space[/] 勾选后再按 Enter[/]",
                        border_style="yellow",
                        padding=(1, 1),
                    ), refresh=True)
                    time.sleep(1.2)
                    continue
                return selected

            elif key == _KEY_CTRL_C or key == _KEY_Q:
                return None

            elif key == _KEY_UNKNOWN:
                pass  # 忽略未知按键


# ═══════════════════════════════════════════════════════════
#  二次确认
# ═══════════════════════════════════════════════════════════

def confirm_deletion(selected: list[dict]) -> bool:
    """显示确认面板。"""
    console.clear()
    console.print("\n")

    names = "\n    ".join(
        f"[bold red]●[/] {b['name']}  [dim]{b.get('version', '')}[/]"
        for b in selected
    )

    console.print(Panel(
        f"[bold]即将卸载以下 [red]{len(selected)}[/] 个插件：[/]\n\n"
        f"    {names}\n\n"
        f"[red bold]⚠  此操作不可撤销！[/]",
        title="[bold red]⚠  DANGER ZONE  —  确认卸载[/]",
        border_style="red",
        padding=(1, 2),
    ))

    console.print()
    return Confirm.ask(
        f"[bold yellow]确定要永久删除这 {len(selected)} 个插件吗？[/]",
        default=False,
        show_default=True,
    )


# ═══════════════════════════════════════════════════════════
#  进度条 & 卸载执行
# ═══════════════════════════════════════════════════════════

def execute_with_progress(selected: list[dict]) -> dict[str, tuple[bool, str]]:
    """执行批量卸载，带 Rich 动态进度条。"""
    results: dict[str, tuple[bool, str]] = {}
    console.clear()
    console.print("\n")

    panel_title = "[bold cyan]🗑  正在卸载插件...[/]"

    with Progress(
        SpinnerColumn(spinner_name="dots"),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(bar_width=40, style="cyan", complete_style="green"),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=console,
        expand=False,
    ) as progress:
        task = progress.add_task(
            f"[cyan]共 {len(selected)} 个待卸载", total=len(selected)
        )

        for i, b in enumerate(selected, 1):
            name = b["name"]
            progress.update(task, description=f"[cyan]{i}/{len(selected)} [bold]{name}[/]")

            ok, msg = uninstall_one(name)
            results[name] = (ok, msg)

            if ok:
                progress.console.print(
                    f"    [green]✓[/] {name} [dim]— 卸载成功[/]"
                )
            else:
                progress.console.print(
                    f"    [red]✗[/] {name} [dim]— {msg}[/]"
                )

            progress.advance(task)
            time.sleep(0.15)  # 略微延迟让进度条可见

    return results


# ═══════════════════════════════════════════════════════════
#  结果汇总
# ═══════════════════════════════════════════════════════════

def show_summary(results: dict[str, tuple[bool, str]]):
    """显示卸载结果汇总。"""
    console.print()
    ok_count = sum(1 for ok, _ in results.values() if ok)
    fail_count = len(results) - ok_count

    if ok_count > 0:
        ok_lines = "\n".join(
            f"  [green]✓[/] {n}" for n, (ok, _) in results.items() if ok
        )
        console.print(Panel(ok_lines, title="[green]✅ 卸载成功[/]", border_style="green"))

    if fail_count > 0:
        fail_lines = []
        for n, (ok, msg) in results.items():
            if not ok:
                fail_lines.append(f"  [red]✗[/] {n}")
                fail_lines.append(f"     [dim]原因: {msg}[/]")
        console.print(Panel("\n".join(fail_lines), title="[red]❌ 卸载失败[/]", border_style="red"))

        # 手工指引
        console.print(Panel(
            "[bold]🛠  手工卸载指引：[/]\n\n"
            "  方法一：DSH → 设置 → 插件管理 → 找到对应插件 → 卸载\n"
            "  方法二：在 DSH 对话中告诉 AI：\n"
            '          [dim]"请用 plugin_manager 帮我卸载 <插件名>"[/]\n'
            "  方法三：删除插件包目录后重启 DSH\n"
            f"          [dim]{Path.home()}\\.dsh\\profiles\\<profile>\\node_modules\\<插件>\\[/]",
            title="[bold yellow]💡 提示[/]",
            border_style="yellow",
        ))

    console.print(f"\n[bold]总计: [green]{ok_count} ✓[/]  [red]{fail_count} ✗[/][/]")
    console.print("[dim]💡 卸载完成后建议重启 DSH 使变更完全生效。[/]")


# ═══════════════════════════════════════════════════════════
#  Banner
# ═══════════════════════════════════════════════════════════

def show_banner():
    """启动欢迎画面。"""
    console.clear()
    console.print("\n")
    art = r"""
   ╔══════════════════════════════════════════════════╗
   ║     ██████╗ ███████╗███████╗██╗  ██╗           ║
   ║    ██╔════╝ ██╔════╝██╔════╝██║  ██║           ║
   ║    ██║  ███╗█████╗  █████╗  ███████║           ║
   ║    ██║   ██║██╔══╝  ██╔══╝  ██╔══██║           ║
   ║    ╚██████╔╝███████╗███████╗██║  ██║           ║
   ║     ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝           ║
   ╠══════════════════════════════════════════════════╣
   ║     DSH Geek Uninstaller  v2.0                  ║
   ║     交互式插件卸载器 · Geek 风格                ║
   ╚══════════════════════════════════════════════════╝
"""
    console.print(art, style="bold cyan", highlight=False)
    time.sleep(0.8)
    console.print(
        "[dim]  ↑↓ 移动  Space 勾选  Ctrl+A 全选/反选  Enter 确认  Q 退出\n[/]"
    )


# ═══════════════════════════════════════════════════════════
#  main
# ═══════════════════════════════════════════════════════════

def main():
    if "--help" in sys.argv or "-h" in sys.argv:
        console.print(__doc__)
        sys.exit(0)

    show_banner()

    # 1. 加载
    console.print("[bold]⟳  步骤 1/5[/]  获取插件列表...")
    bundles = load_all_bundles()
    if not bundles:
        console.print("[red]✗ 没有找到任何插件数据，退出。[/]")
        sys.exit(1)

    # 2. 交互式选择
    console.print("[bold]⟳  步骤 2/5[/]  启动交互式选择界面...")
    time.sleep(0.3)
    selected = interactive_select(bundles)

    if selected is None:
        console.clear()
        console.print("\n[dim]  已取消，没有卸载任何插件。[/]\n")
        sys.exit(0)

    # 3. 二次确认
    console.print("[bold]⟳  步骤 3/5[/]  二次确认...")
    time.sleep(0.2)
    if not confirm_deletion(selected):
        console.print("\n[dim]  已取消卸载操作。安全退出。[/]\n")
        sys.exit(0)

    # 4. 执行
    console.print("[bold]⟳  步骤 4/5[/]  执行批量卸载...")
    time.sleep(0.2)
    results = execute_with_progress(selected)

    # 5. 汇总
    console.print("[bold]⟳  步骤 5/5[/]  卸载结果汇总")
    show_summary(results)
    console.print("\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        console.print("\n\n[dim]  用户中断。安全退出。[/]\n")
        sys.exit(0)
    except Exception as e:
        console.print(f"\n[red]✗ 发生错误: {e}[/]\n")
        sys.exit(1)