"""Seven-day statistics over timings.jsonl, run records and merge commits. Pure."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from statistics import median

from sandcastle_dash.breakdown import CATEGORIES, run_breakdown
from sandcastle_dash.gh import Merge
from sandcastle_dash.logs import Run, Timing


@dataclass(frozen=True)
class PhaseStat:
    phase: str
    runs: int
    ok: int
    median_ms: int
    max_ms: int


@dataclass(frozen=True)
class Day:
    date: date
    runs: int
    merged: int


def phase_stats(timings: list[Timing], now: datetime, days: int = 7) -> list[PhaseStat]:
    since = now - timedelta(days=days)
    by: dict[str, list[Timing]] = defaultdict(list)
    for t in timings:
        if t.ts >= since:
            by[t.phase].append(t)
    stats = [
        PhaseStat(
            phase=phase,
            runs=len(ts),
            ok=sum(1 for t in ts if t.ok),
            median_ms=int(median(t.ms for t in ts)),
            max_ms=max(t.ms for t in ts),
        )
        for phase, ts in by.items()
    ]
    return sorted(stats, key=lambda s: (-s.runs, s.phase))


def category_totals(runs: list[Run], now: datetime, hours: int = 24) -> dict[str, float]:
    since = now - timedelta(hours=hours)
    totals = {key: 0.0 for key, _ in CATEGORIES}
    for run in runs:
        if run.started is None or run.started < since:
            continue
        for key, secs in run_breakdown(run, now).items():
            totals[key] += secs
    return totals


def per_day(
    timings: list[Timing], merges: list[Merge], now: datetime, days: int = 7
) -> list[Day]:
    today = now.astimezone().date()
    window = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
    started: Counter[date] = Counter()
    for t in timings:
        started[(t.ts - timedelta(milliseconds=t.ms)).astimezone().date()] += 1
    merged: Counter[date] = Counter()
    for m in merges:
        merged[m.ts.astimezone().date()] += len(m.issues)
    return [Day(d, started[d], merged[d]) for d in window]
