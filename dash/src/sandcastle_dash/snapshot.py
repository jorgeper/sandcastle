"""One-shot plain-text report for `sandcastle-dash --once`."""

from __future__ import annotations

import io
from datetime import datetime
from pathlib import Path

from rich.console import Console

from sandcastle_dash.logs import Run
from sandcastle_dash.orchestrator import LoopState
from sandcastle_dash.panels import now_table, queue_table, runs_table
from sandcastle_dash.queue import Row


def snapshot_text(
    state: LoopState, runs: list[Run], rows: list[Row], now: datetime, repo: Path | None
) -> str:
    console = Console(record=True, width=110, file=io.StringIO())
    where = repo or "no .sandcastle/logs found"
    console.print(f"[dim]sandcastle-dash · {where} · {now.astimezone():%H:%M:%S}[/]")
    for title, (renderable, summary) in (
        ("Now", now_table(state, runs, now)),
        ("Recent runs (24h)", runs_table(runs, now)),
        ("Issue queue", queue_table(rows)),
    ):
        console.print(f"\n[bold]{title}[/] · {summary}")
        console.print(renderable)
    return console.export_text()
