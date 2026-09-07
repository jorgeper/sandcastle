"""One-shot plain-text report for `sandcastle-dash --once`."""

from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path

from rich.console import Console

from sandcastle_dash.limits import Limit
from sandcastle_dash.logs import Run
from sandcastle_dash.orchestrator import LoopState
from sandcastle_dash.panels import limits_view, now_table, queue_table, resolved_table, runs_table
from sandcastle_dash.queue import Row
from sandcastle_dash.resolved import Resolved
from sandcastle_dash.stats import PhaseStat
from sandcastle_dash.usage import Burn


def snapshot_text(
    state: LoopState,
    runs: list[Run],
    rows: list[Row],
    done: list[Resolved],
    now: datetime,
    repo: Path | None,
    base_url: str | None = None,
    phases: dict[str, PhaseStat] | None = None,
    limits: list[Limit] | None = None,
    limits_error: str | None = None,
    burn: Burn | None = None,
) -> str:
    console = Console(record=True, width=110, file=io.StringIO())
    where = repo or "no .sandcastle/logs found"
    console.print(f"[dim]sandcastle-dash · {where} · {now.astimezone():%H:%M:%S}[/]")
    meters, meters_summary = limits_view(limits, now, burn=burn)
    for title, (renderable, summary) in (
        ("Rate limits", (meters, limits_error or meters_summary)),
        ("Now", now_table(state, runs, now, phases=phases)),
        ("Recent runs (24h)", runs_table(runs, now)),
        ("Issue queue", queue_table(rows)),
        ("Resolved (last 10)", resolved_table(done, now)),
    ):
        console.print(f"\n[bold]{title}[/] · {summary}")
        console.print(renderable)
    if base_url:
        # plain text cannot carry links: name the pattern once instead
        console.print(f"\n[dim]links: {base_url}/issues/<n> · {base_url}/pull/<n>[/]")
    return console.export_text()
