#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════╗
║          DSH Plugin Batch Uninstaller  v1.0                ║
║     交互式批量卸载 DSH 插件管理脚本                         ║
╚══════════════════════════════════════════════════════════════╝

功能：
  1. 自动获取已安装的 DSH 插件列表并展示
  2. 交互式多选（勾选/序号）想要卸载的插件
  3. 二次确认提示，自动拦截核心系统插件
  4. 执行批量卸载并展示实时进度

用法：
  python dsh_batch_uninstall.py              # 从 JSON 文件读取插件列表
  python dsh_batch_uninstall.py --fetch      # 尝试从 DSH REST API 自动获取
  python dsh_batch_uninstall.py --help       # 查看帮助

依赖安装：
  pip install rich
"""

import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

# ─── Rich 库检测 ─────────────────────────────────────────────
try:
    from rich.console import Console
    from rich.table import Table
    from rich.prompt import Prompt, Confirm
    from rich.progress import (
        Progress,
        SpinnerColumn,
        TextColumn,
        BarColumn,
        TaskProgressColumn,
        TimeElapsedColumn,
    )
    from rich.panel import Panel
    from rich.text import Text
    from rich.align import Align
    from rich.columns import Columns
    from rich import box
    from rich.layout import Layout
except ImportError:
    print("[!] 缺少依赖库 rich，请先安装：")
    print("    pip install rich")
    sys.exit(1)

console = Console()

# ═══════════════════════════════════════════════════════════════
#  配置常量
# ═══════════════════════════════════════════════════════════════

# DSH REST API 地址（默认本地）
DSH_API_BASE = os.environ.get("DSH_API_URL", "http://127.0.0.1:19387")

# 默认插件数据文件
PLUGIN_DATA_FILE = Path(os.environ.get("DSH_PLUGIN_FILE", "dsh_plugins.json"))

# 核心系统保护列表 —— 这些 bundle 绝对不能被卸载
# 基于 DSH v0.2.0-rc.2 架构分析
CORE_PROTECTED_BUNDLES = {
    "@deepseek-ai/dsh-base",          # 核心基础层
    "@deepseek-ai/dsh-web-app",       # Web 应用层
    "@deepseek-ai/dsh-sdk-minimal",   # 最小 SDK 配置
    "@deepseek-ai/dsh-sdk-app",       # SDK 应用配置
    "@deepseek-ai/dsh-acp-app",       # ACP 配置
    "@deepseek-ai/dsh-headless",      # Headless 配置
}

# 核心系统 entryId 前缀保护 —— 以这些开头的条目单独禁用需谨慎
CORE_ENTRY_PREFIXES = (
    "include:plugin-manager",
    "include:timer",
    "include:llm",
    "include:session",
    "include:agent",
    "include:tools",
    "include:system-prompt",
    "include:agent-loop",
    "include:fs-sandbox",
    "include:sandbox",
    "include:webserver",
    "include:modules",
    "include:connection",
    "include:hmr",
    "include:settings",
    "include:authorization",
    "include:credentials",
    "include:typert",
    "include:web",
    "include:subprocess",
    "include:storage",
    "include:compaction",
    "include:goal",
)

# ═══════════════════════════════════════════════════════════════
#  数据获取
# ═══════════════════════════════════════════════════════════════

def fetch_from_rest_api() -> Optional[dict]:
    """
    尝试从 DSH REST API 获取 Bundle 列表。
    返回 JSON 解析后的数据，失败返回 None。
    """
    url = f"{DSH_API_BASE}/api/plugin-manager/bundles"
    try:
        req = urllib.request.Request(url)
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        console.print(f"[yellow]  ⚠ REST API 返回 HTTP {e.code}（可能需要认证）[/]")
    except urllib.error.URLError as e:
        console.print(f"[yellow]  ⚠ 无法连接到 DSH REST API: {e.reason}[/]")
    except Exception as e:
        console.print(f"[yellow]  ⚠ 获取失败: {e}[/]")
    return None


def load_from_file(filepath: Path) -> Optional[dict]:
    """从本地 JSON 文件加载插件数据。"""
    if not filepath.exists():
        return None
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        console.print(f"[red]  ✗ 读取文件失败: {e}[/]")
        return None


def load_plugins() -> list[dict]:
    """
    加载插件列表。优先级：
    1. REST API 自动获取 (--fetch)
    2. 本地 JSON 文件
    3. 内置示例数据（来自 DSH v0.2.0-rc.2）
    """
    plugins = None
    source = ""

    # 尝试 API
    if "--fetch" in sys.argv:
        console.print("[cyan]  正在从 DSH REST API 获取插件列表...[/]")
        plugins = fetch_from_rest_api()
        source = "REST API"
    else:
        # 尝试本地文件
        plugins = load_from_file(PLUGIN_DATA_FILE)
        source = f"本地文件 ({PLUGIN_DATA_FILE})"

    if plugins is None:
        # 回退：使用内置示例数据
        console.print(
            "[yellow]  ⚠ 未能从外部获取插件数据，使用内置示例数据。[/]"
        )
        console.print(
            "[dim]    提示: 请将插件列表保存为 dsh_plugins.json 或使用 --fetch[/]"
        )
        plugins = _get_builtin_plugin_data()
        source = "内置示例数据"

    # 提取 bundle 列表
    bundles = _extract_bundles(plugins)
    console.print(f"[dim]  数据来源: {source} | 共 {len(bundles)} 个 Bundle[/]")
    return bundles


def _extract_bundles(raw: dict) -> list[dict]:
    """
    从 plugin_manager list_bundles 的原始响应中提取 bundle 列表。
    支持格式：
      - {"entries": [ {...}, {...} ], "total": N}   (list_bundles)
      - {"bundles": [ {...}, {...} ]}                 (自定义格式)
      - [ {...}, {...} ]                               (纯列表)
    """
    if isinstance(raw, list):
        entries = raw
    elif isinstance(raw, dict):
        entries = raw.get("entries") or raw.get("bundles") or []
    else:
        entries = []

    # 过滤：只保留有实际信息的 bundle
    result = []
    for e in entries:
        if isinstance(e, dict) and "name" in e:
            result.append(e)
    return result


def _get_builtin_plugin_data() -> dict:
    """
    内置示例数据 —— 从 DSH v0.2.0-rc.2 预装插件列表截取。
    用户应当替换为实际环境的数据。
    """
    return {
        "entries": [
            {
                "name": "@deepseek-ai/dsh-base",
                "version": "0.2.0-rc.2",
                "description": "The shared dsh core as a profile bundle",
                "enabled": True,
                "installed": False,
                "optional": False,
                "removable": False,
            },
            {
                "name": "@deepseek-ai/dsh-web-app",
                "version": "0.2.0-rc.2",
                "description": "The dsh browser-surface bundle",
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
                "description": "DSH 片头开机动画",
                "enabled": True,
                "installed": True,
                "removable": True,
            },
            {
                "name": "dshmarket",
                "version": "1.66.17",
                "description": "DSH 可视化插件市场",
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
                "name": "@deepseek-ai/dsh-experimental-schedule-bundle",
                "version": "0.2.0-rc.2",
                "description": "定时任务实验性插件",
                "enabled": False,
                "installed": False,
                "optional": True,
                "removable": False,
            },
            {
                "name": "@deepseek-ai/dsh-experimental-voice-input-bundle",
                "version": "0.2.0-rc.2",
                "description": "语音输入实验性插件",
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
        ],
        "total": 9,
    }


# ═══════════════════════════════════════════════════════════════
#  核心判断逻辑
# ═══════════════════════════════════════════════════════════════

def is_core_bundle(bundle: dict) -> bool:
    """判断是否为不可卸载的核心系统 Bundle。"""
    name = bundle.get("name", "")
    # 1. 直接匹配核心保护列表
    if name in CORE_PROTECTED_BUNDLES:
        return True
    # 2. 检查 removable 标记
    if bundle.get("removable") is False:
        return True
    # 3. @deepseek-ai/dsh- 前缀的 bundle 且非 optional
    if name.startswith("@deepseek-ai/dsh-") and not bundle.get("optional", False):
        return True
    return False


def is_installed(bundle: dict) -> bool:
    """判断 bundle 是否已安装（而非仅内置）。"""
    return bundle.get("installed", False) or bundle.get("enabled", False)


def can_uninstall(bundle: dict) -> bool:
    """判断 bundle 是否可以被卸载。"""
    return bundle.get("removable", False) and not is_core_bundle(bundle)


# ═══════════════════════════════════════════════════════════════
#  显示函数
# ═══════════════════════════════════════════════════════════════

def show_banner():
    """显示欢迎横幅。"""
    banner = r"""
  ██████╗ ███████╗██╗  ██╗    ██████╗ ██╗     ██╗   ██╗ ██████╗ ██╗███╗   ██╗
  ██╔══██╗██╔════╝██║  ██║    ██╔══██╗██║     ██║   ██║██╔════╝ ██║████╗  ██║
  ██║  ██║███████╗███████║    ██████╔╝██║     ██║   ██║██║  ███╗██║██╔██╗ ██║
  ██║  ██║╚════██║██╔══██║    ██╔═══╝ ██║     ██║   ██║██║   ██║██║██║╚██╗██║
  ██████╔╝███████║██║  ██║    ██║     ███████╗╚██████╔╝╚██████╔╝██║██║ ╚████║
  ╚═════╝ ╚══════╝╚═╝  ╚═╝    ╚═╝     ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝╚═╝  ╚═══╝
              Batch Uninstaller  —  交互式批量卸载工具
"""
    console.print(banner, style="bold cyan", highlight=False)
    console.print(
        Panel(
            "该工具帮助您在 DSH 环境下安全、批量地卸载插件。\n"
            "核心系统插件已自动加锁保护，防止误删。",
            title="[bold]🔧 说明[/]",
            border_style="dim",
        )
    )
    console.print()


def display_plugins_table(bundles: list[dict]):
    """用 Rich 表格展示插件列表。"""
    table = Table(
        title=f"\n📦 已发现 {len(bundles)} 个 Bundle",
        box=box.ROUNDED,
        header_style="bold white",
        border_style="cyan",
        row_styles=["", "dim"],
        show_lines=False,
        expand=True,
    )

    table.add_column("#", style="dim cyan", width=4, justify="right")
    table.add_column("Bundle 名称", style="bold", min_width=30, no_wrap=False)
    table.add_column("版本", style="dim", width=14)
    table.add_column("状态", width=10, justify="center")
    table.add_column("可卸载", width=8, justify="center")
    table.add_column("说明", style="dim", min_width=20, no_wrap=False)

    for i, b in enumerate(bundles, 1):
        name = b.get("name", "?")
        version = b.get("version", "-")
        desc = (b.get("description") or "-")[:60]

        # 状态
        enabled = b.get("enabled", False)
        installed = b.get("installed", False)
        if enabled:
            status = "[green]● 启用[/]"
        elif installed:
            status = "[yellow]◐ 已装[/]"
        else:
            status = "[dim]○ 停用[/]"

        # 可卸载标记
        removable = can_uninstall(b)
        if is_core_bundle(b):
            can_flag = "[red]🔒 核心[/]"
        elif removable:
            can_flag = "[green]✓ 是[/]"
        else:
            can_flag = "[dim]✗ 否[/]"

        # 🔒 核心插件整行变暗
        if is_core_bundle(b):
            name_display = f"[dim]{name}[/]"
        else:
            name_display = name

        table.add_row(str(i), name_display, version, status, can_flag, desc)

    console.print(table)
    console.print()


def show_legend():
    """显示图例。"""
    legend = Columns(
        [
            "[green]● 启用[/]  [yellow]◐ 已装停用[/]  [dim]○ 未启用[/]",
            "[red]🔒 核心[/] 系统保护  [green]✓ 是[/] 可卸载  [dim]✗ 否[/] 不可卸载",
        ],
        equal=True,
    )
    console.print(legend)
    console.print()


# ═══════════════════════════════════════════════════════════════
#  卸载执行
# ═══════════════════════════════════════════════════════════════

def uninstall_bundle_direct(bundle_name: str) -> tuple[bool, str]:
    """
    通过直接调用 DSH 内部机制卸载 Bundle。
    方式：
      1. 尝试通过 DSH REST API 发送 POST 请求
      2. 回退：尝试通过 dsh CLI 命令
      3. 回退：模拟卸载并给出手工操作指引
    """
    # ── 方式 1：REST API ──
    url = f"{DSH_API_BASE}/api/plugin-manager/bundles/{bundle_name}"
    try:
        data = json.dumps({"action": "remove"}).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, method="DELETE"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return True, f"REST API: {result}"
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        # 401/403 继续尝试方式2
        if e.code not in (401, 403, 405):
            return False, f"HTTP {e.code}: {body[:120]}"
    except Exception as e:
        pass  # 回退到方式2

    # ── 方式 2：DSH CLI ──
    dsh_cli = os.environ.get("DSH_CLI", "dsh")
    try:
        result = subprocess.run(
            [dsh_cli, "plugin", "remove", bundle_name],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            return True, f"CLI: {result.stdout.strip()[:100]}"
        else:
            return False, f"CLI: {result.stderr.strip()[:120]}"
    except FileNotFoundError:
        pass
    except Exception as e:
        pass

    # ── 方式 3：回退 ──
    return False, "无法自动连接DSH，请手工操作"


def uninstall_bundle_via_plugin_manager(bundle_name: str) -> tuple[bool, str]:
    """
    备用卸载方式：输出可供 agent 调用的 plugin_manager 指令。
    该方法适用于在 DSH 会话内由 AI Agent 协助卸载。
    """
    msg = (
        f"请在 DSH 中执行: plugin_manager\n"
        f"  action: remove_bundle\n"
        f"  target: {bundle_name}"
    )
    return False, msg


# ═══════════════════════════════════════════════════════════════
#  交互式主流程
# ═══════════════════════════════════════════════════════════════

def select_plugins(bundles: list[dict]) -> list[dict]:
    """
    交互式选择要卸载的插件。
    支持：多序号（1,3,5-7）、all、空格分隔。
    """
    # 筛选出可卸载的
    removable = [b for b in bundles if can_uninstall(b)]
    locked = [b for b in bundles if not can_uninstall(b)]

    if not removable:
        console.print("[yellow]  ⚠ 没有找到可卸载的插件。[/]")
        if locked:
            console.print(f"  [dim]{len(locked)} 个核心/系统插件已自动保护。[/]")
        return []

    # 显示可选列表
    console.print(f"\n[bold]可卸载的插件 ({len(removable)} 个)：[/]")
    opt_table = Table(box=box.SIMPLE, border_style="green", show_header=False)
    opt_table.add_column("#", style="green", width=4)
    opt_table.add_column("名称", style="bold")
    opt_table.add_column("描述", style="dim")
    for i, b in enumerate(removable, 1):
        opt_table.add_row(
            f"[green]{i}[/]",
            f"[bold]{b['name']}[/]",
            (b.get("description") or "-")[:60],
        )
    console.print(opt_table)
    if locked:
        console.print(
            f"\n[dim]🔒 {len(locked)} 个核心插件已自动保护，不在可选列表中。[/]"
        )

    # 输入
    console.print()
    console.print(
        "[dim]输入示例: 1,3,5-7  或  all  或  q 退出[/]"
    )
    raw = Prompt.ask("[bold yellow]请选择要卸载的插件序号[/]")

    raw = raw.strip()
    if raw.lower() in ("q", "quit", "exit", "取消"):
        console.print("[dim]  已取消。[/]")
        return []

    if raw.lower() == "all":
        selected = removable[:]
    else:
        indices = _parse_indices(raw, len(removable))
        selected = [removable[i] for i in indices]

    return selected


def _parse_indices(raw: str, max_n: int) -> list[int]:
    """解析用户输入的序号，支持 1,3,5-7 格式。返回 0-based 索引列表。"""
    indices = set()
    parts = raw.replace("，", ",").split(",")
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            try:
                a, b = part.split("-", 1)
                start, end = int(a.strip()), int(b.strip())
                for x in range(start, end + 1):
                    if 1 <= x <= max_n:
                        indices.add(x - 1)
            except ValueError:
                console.print(f"  [yellow]⚠ 忽略无效范围: {part}[/]")
        else:
            try:
                x = int(part)
                if 1 <= x <= max_n:
                    indices.add(x - 1)
            except ValueError:
                console.print(f"  [yellow]⚠ 忽略无效序号: {part}[/]")
    return sorted(indices)


def confirm_uninstall(selected: list[dict]) -> bool:
    """二次确认卸载操作。"""
    console.print()
    names = [f"[bold red]{b['name']}[/]" for b in selected]
    names_list = "\n    ".join(names)

    panel = Panel(
        f"即将卸载以下 {len(selected)} 个插件：\n\n    {names_list}\n\n"
        f"[red bold]⚠ 此操作不可撤销！[/]",
        title="[bold red]⚠ 危险操作确认[/]",
        border_style="red",
    )
    console.print(panel)

    return Confirm.ask(
        f"[bold yellow]确认要卸载这 {len(selected)} 个插件吗？[/]",
        default=False,
    )


def execute_uninstall(selected: list[dict]) -> dict[str, tuple[bool, str]]:
    """执行批量卸载，展示进度条。"""
    results: dict[str, tuple[bool, str]] = {}

    console.print("\n[bold]正在执行卸载...[/]")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task(
            "[cyan]卸载进度", total=len(selected)
        )

        for b in selected:
            name = b["name"]
            progress.update(
                task, description=f"[cyan]正在卸载: {name}[/]"
            )

            success, message = uninstall_bundle_direct(name)

            if success:
                progress.console.print(f"  [green]✓[/] {name}")
            else:
                progress.console.print(f"  [red]✗[/] {name} — {message}")

            results[name] = (success, message)
            progress.advance(task)

    return results


def show_summary(results: dict[str, tuple[bool, str]]):
    """显示卸载结果汇总。"""
    console.print()
    success_count = sum(1 for ok, _ in results.values() if ok)
    fail_count = len(results) - success_count

    if success_count > 0:
        ok_names = "\n  ".join(
            f"[green]✓[/] {n}" for n, (ok, _) in results.items() if ok
        )
        console.print(Panel(ok_names, title="[green]✅ 卸载成功[/]", border_style="green"))

    if fail_count > 0:
        fail_lines = []
        for n, (ok, msg) in results.items():
            if not ok:
                fail_lines.append(f"[red]✗[/] {n}")
                fail_lines.append(f"    原因: {msg}")
        console.print(
            Panel(
                "\n".join(fail_lines),
                title="[red]❌ 卸载失败[/]",
                border_style="red",
            )
        )

    # 如果全部通过手工方式卸载，给出通用指引
    if fail_count > 0:
        console.print()
        console.print(
            Panel(
                "[bold]手工卸载指引：[/]\n\n"
                "方法一：在 DSH 设置 → 插件管理 → 已安装 → 找到对应插件 → 卸载\n\n"
                "方法二：在 DSH 对话中告诉 AI：\n"
                '  "请用 plugin_manager 帮我卸载 <插件名>"\n\n'
                "方法三：删除插件包目录（需重启 DSH）：\n"
                f"  {Path.home()}\\.dsh\\profiles\\<profile>\\node_modules\\<插件名>\\\n\n"
                "[dim]卸载后请重启 DSH 使变更生效。[/]",
                title="[bold]🛠 手动操作指引[/]",
                border_style="yellow",
            )
        )

    console.print(
        f"\n[bold]总计: [green]{success_count} 成功[/], [red]{fail_count} 失败[/][/]"
    )


# ═══════════════════════════════════════════════════════════════
#  main
# ═══════════════════════════════════════════════════════════════

def main():
    global PLUGIN_DATA_FILE

    # 命令行参数
    if "--help" in sys.argv or "-h" in sys.argv:
        console.print(__doc__)
        console.print(
            "\n[bold]可选参数：[/]\n"
            "  --fetch    尝试从 DSH REST API 自动获取插件列表\n"
            "  --help     显示此帮助信息\n"
            "  --json FILE 从指定 JSON 文件加载插件列表\n"
        )
        sys.exit(0)

    # 自定义 JSON 文件
    json_file = PLUGIN_DATA_FILE
    for i, arg in enumerate(sys.argv):
        if arg == "--json" and i + 1 < len(sys.argv):
            json_file = Path(sys.argv[i + 1])
            break

    PLUGIN_DATA_FILE = json_file

    # ── 开始 ──
    show_banner()

    # 1. 加载插件列表
    console.print("[bold]📋 步骤 1: 获取插件列表[/]")
    bundles = load_plugins()

    if not bundles:
        console.print("[red]  ✗ 没有找到任何插件数据，退出。[/]")
        sys.exit(1)

    # 2. 展示插件列表
    console.print("\n[bold]📋 步骤 2: 查看当前插件[/]")
    display_plugins_table(bundles)
    show_legend()

    # 统计
    total = len(bundles)
    installed_count = sum(1 for b in bundles if is_installed(b))
    removable_count = sum(1 for b in bundles if can_uninstall(b))
    locked_count = sum(1 for b in bundles if is_core_bundle(b))

    console.print(
        f"  共 [bold]{total}[/] 个 Bundle | "
        f"[green]{installed_count} 已安装[/] | "
        f"[yellow]{removable_count} 可卸载[/] | "
        f"[red]{locked_count} 核心保护[/]"
    )

    # 3. 选择要卸载的插件
    console.print("\n[bold]📋 步骤 3: 选择要卸载的插件[/]")
    selected = select_plugins(bundles)

    if not selected:
        console.print("[dim]  没有选择任何插件，退出。[/]")
        sys.exit(0)

    # 4. 二次确认
    console.print("\n[bold]📋 步骤 4: 确认操作[/]")
    if not confirm_uninstall(selected):
        console.print("[dim]  已取消卸载操作。[/]")
        sys.exit(0)

    # 5. 执行卸载
    console.print("\n[bold]📋 步骤 5: 执行批量卸载[/]")
    results = execute_uninstall(selected)

    # 6. 显示结果
    console.print("\n[bold]📋 步骤 6: 卸载结果[/]")
    show_summary(results)

    console.print(
        "\n[dim]💡 提示: 卸载后建议重启 DSH 以完全生效。[/]"
    )


if __name__ == "__main__":
    main()