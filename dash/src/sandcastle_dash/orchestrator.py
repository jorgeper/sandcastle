"""Is the loop running, and where is it? The loop is `tsx .sandcastle/main.ts`;
`ps` gives its start time, and planner runs started since then count its
iterations (the planner opens every iteration)."""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone

from sandcastle_dash.logs import Run

_PS_LINE = re.compile(r"^\s*(\d+)\s+(\w{3} \w{3}\s+\d+ \d\d:\d\d:\d\d \d{4})\s+(.*)$")
_LOOP = re.compile(r"(?:^|\s)(?:node|tsx|npm)\b.*\.sandcastle/main\.(?:m?ts)\b")


@dataclass(frozen=True)
class LoopProcess:
    pid: int
    started: datetime


@dataclass(frozen=True)
class LoopState:
    running: bool
    pid: int | None
    started: datetime | None
    iteration: int | None
    last_run: Run | None


def parse_ps(text: str, now: datetime) -> LoopProcess | None:
    """The earliest-started process running the loop script, or None."""
    found: list[LoopProcess] = []
    for line in text.splitlines():
        m = _PS_LINE.match(line)
        if not m or not _LOOP.search(m.group(3)):
            continue
        try:
            local = datetime.strptime(m.group(2), "%a %b %d %H:%M:%S %Y")
        except ValueError:
            continue
        started = local.replace(tzinfo=now.astimezone().tzinfo).astimezone(timezone.utc)
        found.append(LoopProcess(int(m.group(1)), started))
    return min(found, key=lambda p: p.started) if found else None


def find_loop_process(now: datetime | None = None) -> LoopProcess | None:
    now = now or datetime.now(timezone.utc)
    try:
        out = subprocess.run(
            ["ps", "-axo", "pid=,lstart=,command="],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_ps(out, now)


def derive_state(proc: LoopProcess | None, runs: list[Run]) -> LoopState:
    last = max(runs, key=lambda r: r.last_activity, default=None)
    if proc is None:
        return LoopState(False, None, None, None, last)
    planners = sum(
        1 for r in runs if r.role == "planner" and r.started and r.started >= proc.started
    )
    return LoopState(True, proc.pid, proc.started, max(1, planners), last)
