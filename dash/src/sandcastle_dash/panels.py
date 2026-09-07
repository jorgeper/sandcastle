"""Rich renderables for the four sections. Pure given the data; the app
and the --once snapshot both use them."""

from __future__ import annotations

from datetime import datetime, timedelta

from rich.console import Group, RenderableType
from rich.table import Table
from rich.text import Text

from sandcastle_dash.breakdown import CATEGORIES
from sandcastle_dash.format import (
    GRUVBOX,
    STATUS_GLYPH,
    fmt_ago,
    fmt_clock,
    fmt_duration,
    segment_bar,
    status_style,
)
from sandcastle_dash.links import issue_link, link_text, pr_url
from sandcastle_dash.logs import Run
from sandcastle_dash.orchestrator import LoopState
from sandcastle_dash.queue import Row
from sandcastle_dash.resolved import Resolved
from sandcastle_dash.stats import Day, PhaseStat

RUNS_LIMIT = 15
# Animation frames for the Now section (Req: active agents move). The app
# advances `frame` on a fast timer while anything is running.
SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
PULSE = "●◐◑◒◓"
_WAVE_CELLS = "▁▂▃▄▅▆▇█▇▆▅▄▃▂"
WAVE_WIDTH = 12

_CAT_COLOR = {
    "verify": GRUVBOX["green"],
    "edit": GRUVBOX["yellow"],
    "explore": GRUVBOX["blue"],
    "git": GRUVBOX["purple"],
    "think": GRUVBOX["orange"],
    "other": GRUVBOX["gray"],
}
_TONE = {
    "working": GRUVBOX["green"],
    "held": GRUVBOX["yellow"],
    "failed": GRUVBOX["red"],
    "plain": "",
}


def _issue_label(run: Run, base_url: str | None = None, style: str = "") -> Text:
    return issue_link(run.issue, base_url, style, fallback=run.scope)


def spinner(frame: int) -> str:
    return SPINNER[frame % len(SPINNER)]


def wave(frame: int, width: int = WAVE_WIDTH) -> Text:
    """A band of block glyphs that slides one cell per frame."""
    cells = _WAVE_CELLS
    text = Text()
    for i in range(width):
        text.append(cells[(i - frame) % len(cells)], style=GRUVBOX["aqua"])
    return text


def _age(delta: timedelta) -> str:
    """Compact age for the queue: '3h', '2d', '45m'."""
    secs = max(0, int(delta.total_seconds()))
    if secs < 3600:
        return f"{secs // 60}m"
    if secs < 86400:
        return f"{secs // 3600}h"
    return f"{secs // 86400}d"


def now_table(
    state: LoopState,
    runs: list[Run],
    now: datetime,
    base_url: str | None = None,
    frame: int = 0,
) -> tuple[RenderableType, str]:
    running = [r for r in runs if r.status == "running"]
    head = Text()
    if state.running:
        pulse = PULSE[frame % len(PULSE)] if running else PULSE[0]
        head.append(f"{pulse} running", style=f"bold {GRUVBOX['green']}")
        head.append(
            f" · iteration {state.iteration} · since {fmt_clock(state.started)}"
            f" ({fmt_ago(state.started, now)})",
            style="dim",
        )
        summary = f"running · {len(running)} agent{'s' if len(running) != 1 else ''}"
    else:
        head.append("○ idle", style=f"bold {GRUVBOX['gray']}")
        last = state.last_run
        if last:
            head.append(
                f" · last run {last.role} ", style="dim"
            )
            head.append(_issue_label(last, base_url, "dim"))
            head.append(f" {last.status} {fmt_ago(last.last_activity, now)}", style="dim")
        summary = "idle"
    parts: list[RenderableType] = [head]
    if running:
        table = Table.grid(padding=(0, 2), expand=True)
        table.add_column(no_wrap=True)
        table.add_column(style="bold", no_wrap=True)
        table.add_column(no_wrap=True)
        table.add_column(justify="right", no_wrap=True)
        table.add_column(no_wrap=True)
        table.add_column(justify="right", no_wrap=True)
        table.add_column(style="dim", overflow="ellipsis", no_wrap=True, ratio=1)
        table.add_row("", "agent", "issue", "elapsed", "attempt", "ctx", "last line")
        for i, run in enumerate(running):
            elapsed = (now - run.started).total_seconds() * 1000 if run.started else None
            table.add_row(
                Text(spinner(frame + 3 * i), style=GRUVBOX["green"]),
                Text(run.role, style=GRUVBOX["aqua"]),
                _issue_label(run, base_url),
                fmt_duration(elapsed),
                run.iteration or "—",
                run.context_window or "—",
                run.last_line,
            )
        parts.append(table)
        for i, run in enumerate(running):
            if run.path:
                line = Text("  ")
                line.append_text(wave(frame + 4 * i))
                line.append(f"  tail -f {run.path}", style="dim")
                parts.append(line)
    elif state.running:
        parts.append(Text("  no agent in flight (between phases)", style="dim"))
    return Group(*parts), summary


def runs_table(
    runs: list[Run],
    now: datetime,
    hours: int = 24,
    limit: int = RUNS_LIMIT,
    base_url: str | None = None,
) -> tuple[RenderableType, str]:
    since = now - timedelta(hours=hours)
    window = [r for r in runs if r.last_activity >= since]
    recent = window[:limit]
    failed = sum(1 for r in window if r.status == "failed")
    summary = f"{len(window)} runs" + (f" · {failed} failed" if failed else "")
    if not recent:
        return Text("  nothing in the last 24h", style="dim"), summary
    table = Table.grid(padding=(0, 2), expand=True)
    table.add_column(no_wrap=True)
    table.add_column(style="bold", no_wrap=True)
    table.add_column(no_wrap=True)
    table.add_column(justify="right", no_wrap=True)
    table.add_column(justify="right", no_wrap=True)
    table.add_column(overflow="ellipsis", no_wrap=True, ratio=1)
    table.add_row("", "agent", "issue", "started", "took", "")
    for run in recent:
        style = status_style(run.status)
        if run.status == "failed":
            note: RenderableType = Text(run.error or "", style=GRUVBOX["red"])
        else:
            note = Text(run.iteration or "", style="dim")
        took: RenderableType = (
            Text("running", style=style) if run.status == "running" else fmt_duration(run.duration_ms)
        )
        table.add_row(
            Text(STATUS_GLYPH.get(run.status, "?"), style=style),
            run.role,
            _issue_label(run, base_url),
            fmt_clock(run.started),
            took,
            note,
        )
    return table, summary


def queue_table(rows: list[Row], base_url: str | None = None) -> tuple[RenderableType, str]:
    held = sum(1 for r in rows if r.tone == "held")
    summary = f"{len(rows)} open" + (f" · {held} held" if held else "")
    if not rows:
        return Text("  no open issues labeled sandcastle", style="dim"), summary
    table = Table.grid(padding=(0, 2), expand=True)
    table.add_column(justify="right", no_wrap=True)
    table.add_column(overflow="ellipsis", no_wrap=True, ratio=3)
    table.add_column(no_wrap=True)
    table.add_column(no_wrap=True)
    table.add_column(justify="right", style="dim", no_wrap=True)
    table.add_column(no_wrap=True)
    table.add_column(style="dim", overflow="ellipsis", no_wrap=True, ratio=2)
    table.add_row("#", "title", "tier", "flags", "age", "stage", "")
    for r in rows:
        tone = _TONE[r.tone]
        prefix = "  └ " if r.depth else ""
        detail: Text = Text(r.detail)
        if r.stage.startswith("PR ") and r.detail.startswith("#"):
            pr_number, _, rest = r.detail[1:].partition(" ")
            detail = link_text(f"#{pr_number}", pr_url(base_url, pr_number))
            detail.append(f" {rest}" if rest else "")
        table.add_row(
            issue_link(r.number, base_url, "bold"),
            Text(prefix + r.title, style=tone),
            r.tier,
            " ".join(r.flags),
            _age(r.age),
            Text(r.stage, style=tone),
            detail,
        )
    return table, summary


def resolved_table(
    rows: list[Resolved], now: datetime, base_url: str | None = None
) -> tuple[RenderableType, str]:
    summary = f"{len(rows)} resolved"
    if not rows:
        return Text("  nothing closed yet", style="dim"), summary
    table = Table.grid(padding=(0, 2), expand=True)
    table.add_column(justify="right", no_wrap=True)
    table.add_column(overflow="ellipsis", no_wrap=True, ratio=3)
    table.add_column(no_wrap=True)
    table.add_column(justify="right", style="dim", no_wrap=True)
    table.add_column(style="dim", overflow="ellipsis", no_wrap=True, ratio=2)
    table.add_row("#", "title", "tier", "closed", "merge")
    for r in rows:
        if r.merged:
            others = [f"#{n}" for n in r.merge_issues if n != r.number]
            merged = f"merged {fmt_clock(r.merged)}" + (f" with {' '.join(others)}" if others else "")
        else:
            merged = "no merge commit found"
        table.add_row(
            issue_link(r.number, base_url, "bold"),
            Text(r.title, style=GRUVBOX["green"]),
            r.tier,
            _age(now - r.closed),
            merged,
        )
    return table, summary


def stats_view(
    phases: list[PhaseStat], totals: dict[str, float], days: list[Day]
) -> tuple[RenderableType, str]:
    total_runs = sum(p.runs for p in phases)
    total_ok = sum(p.ok for p in phases)
    summary = f"{total_runs} runs" + (f" · {100 * total_ok // total_runs}% ok" if total_runs else "")
    parts: list[RenderableType] = []

    table = Table.grid(padding=(0, 2))
    table.add_column(style="bold")
    for _ in range(4):
        table.add_column(justify="right")
    table.add_row("phase", "runs", "ok", "median", "max")
    for p in phases:
        pct = 100 * p.ok // p.runs if p.runs else 0
        table.add_row(
            p.phase,
            str(p.runs),
            Text(f"{pct}%", style=GRUVBOX["green"] if pct >= 80 else GRUVBOX["yellow"]),
            fmt_duration(p.median_ms),
            fmt_duration(p.max_ms),
        )
    parts.append(table)

    total = sum(totals.values())
    bar_parts = [
        (k, 100 * totals[k] / total if total else 0, _CAT_COLOR[k])
        for k, _ in CATEGORIES
        if totals.get(k, 0) > 0
    ]
    legend = Text("  ")
    for key, label in CATEGORIES:
        if totals.get(key, 0) > 0:
            legend.append("■ ", style=_CAT_COLOR[key])
            legend.append(f"{label} {100 * totals[key] / total:.0f}%  ", style="dim")
    parts.append(Text(""))
    parts.append(Text("last 24h, where agent time went:", style="dim"))
    parts.append(segment_bar(bar_parts, width=60))
    parts.append(legend)

    if days:
        strip = Table.grid(padding=(0, 1))
        strip.add_column(style="dim")
        for _ in days:
            strip.add_column(justify="right", min_width=5)
        strip.add_row("", *[f"{d.date:%a}" for d in days])
        strip.add_row("runs", *[str(d.runs) for d in days])
        strip.add_row("merged", *[str(d.merged) for d in days])
        parts.append(Text(""))
        parts.append(strip)
    return Group(*parts), summary
