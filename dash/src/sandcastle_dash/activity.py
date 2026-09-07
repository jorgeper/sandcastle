"""Per-agent signals for the Now section, each derived from data rather
than a clock: a heartbeat that fades since the last log line, a sparkline of
log lines per bucket, and a bar of elapsed time against the phase's usual
duration. Pure."""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from rich.text import Text

from sandcastle_dash.breakdown import CATEGORIES, categorize
from sandcastle_dash.format import CATEGORY_COLOR, GRUVBOX
from sandcastle_dash.logs import _STAMP, LAST_LINE_CHARS, Run, resolve_clock
from sandcastle_dash.stats import PhaseStat

FADE = timedelta(seconds=10)
SPARK_CELLS = 10
SPARK_SECONDS = 30  # per cell → the strip covers five minutes
BAR_WIDTH = 10
RECENT_LINES = 3
_BLOCKS = "▁▂▃▄▅▆▇█"
_STAMPED = re.compile(r"^\[(\d\d:\d\d:\d\d)\] ?(.*)$", re.M)
_LABEL = dict(CATEGORIES)


def recent_lines(run: Run, count: int = RECENT_LINES) -> list[str]:
    """The last `count` non-blank lines of the run's block, newest last,
    each cut to LAST_LINE_CHARS like Run.last_line."""
    lines = [
        l.rstrip() for l in run.text.splitlines()
        if l.strip() and not l.startswith("--- Run started")
    ]
    return [
        l if len(l) <= LAST_LINE_CHARS else l[:LAST_LINE_CHARS] + "…" for l in lines[-count:]
    ]


def line_stamps(run: Run) -> list[datetime]:
    """UTC moments of every `[HH:MM:SS]`-stamped line in the run's block."""
    if run.started is None:
        return []
    return [resolve_clock(run.started, hms) for hms in _STAMP.findall(run.text)]


def stamped_lines(run: Run) -> list[tuple[datetime, str]]:
    """(moment, category) for every stamped line, in log order."""
    if run.started is None:
        return []
    return [
        (resolve_clock(run.started, hms), categorize(rest))
        for hms, rest in _STAMPED.findall(run.text)
    ]


def line_category(line: str) -> str:
    """Category of a raw log line, stamp or not."""
    m = _STAMPED.match(line)
    return categorize(m.group(2) if m else line)


def doing(run: Run, now: datetime) -> tuple[str, timedelta] | None:
    """What the agent is on right now: the newest stamped line's category
    label and how long ago that line landed. None without stamps."""
    stamped = stamped_lines(run)
    if not stamped:
        return None
    moment, cat = stamped[-1]
    return _LABEL.get(cat, cat), max(timedelta(0), now - moment)


def activity_buckets(
    stamps: list[datetime], now: datetime, cells: int = SPARK_CELLS, seconds: int = SPARK_SECONDS
) -> list[int]:
    """Log lines per `seconds`-wide bucket over the last `cells` buckets, oldest first."""
    counts = [0] * cells
    span = timedelta(seconds=seconds)
    for stamp in stamps:
        age = now - stamp
        if age < timedelta(0):
            continue
        idx = cells - 1 - int(age / span)
        if 0 <= idx < cells:
            counts[idx] += 1
    return counts


def bucket_categories(
    stamped: list[tuple[datetime, str]],
    now: datetime,
    cells: int = SPARK_CELLS,
    seconds: int = SPARK_SECONDS,
) -> list[str | None]:
    """The most frequent category per bucket (ties → the earlier category in
    CATEGORIES order), None for empty buckets."""
    tallies: list[dict[str, int]] = [{} for _ in range(cells)]
    span = timedelta(seconds=seconds)
    for moment, cat in stamped:
        age = now - moment
        if age < timedelta(0):
            continue
        idx = cells - 1 - int(age / span)
        if 0 <= idx < cells:
            tallies[idx][cat] = tallies[idx].get(cat, 0) + 1
    order = [k for k, _ in CATEGORIES]
    return [
        max(t, key=lambda c: (t[c], -order.index(c) if c in order else -99)) if t else None
        for t in tallies
    ]


def sparkline(counts: list[int], categories: list[str | None] | None = None) -> Text:
    """Block glyphs scaled to the busiest bucket; empty buckets are dim. With
    `categories`, each cell takes its dominant category's color."""
    top = max(counts, default=0)
    text = Text()
    for i, n in enumerate(counts):
        if n <= 0 or top <= 0:
            text.append(_BLOCKS[0], style=GRUVBOX["track"])
            continue
        cat = categories[i] if categories and i < len(categories) else None
        color = CATEGORY_COLOR.get(cat, GRUVBOX["aqua"]) if cat else GRUVBOX["aqua"]
        text.append(_BLOCKS[min(len(_BLOCKS) - 1, round(n / top * (len(_BLOCKS) - 1)))], style=color)
    return text


def heartbeat(last_activity: datetime, now: datetime) -> Text:
    """A dot that is bright the moment a line lands and fades over FADE."""
    age = now - last_activity
    if age < FADE / 4:
        return Text("●", style=f"bold {GRUVBOX['green']}")
    if age < FADE / 2:
        return Text("●", style=GRUVBOX["green"])
    if age < FADE * 3 / 4:
        return Text("●", style=GRUVBOX["aqua"])
    if age < FADE:
        return Text("●", style=GRUVBOX["gray"])
    return Text("○", style=GRUVBOX["track"])


def duration_bar(elapsed_ms: float | None, stat: PhaseStat | None, width: int = BAR_WIDTH) -> Text:
    """Fill grows toward the phase's median; yellow past it, red past its max.
    No stat (first run of a phase) or no start: an empty track."""
    if elapsed_ms is None or stat is None or stat.median_ms <= 0:
        return Text("░" * width, style=GRUVBOX["track"])
    ratio = elapsed_ms / stat.median_ms
    filled = min(width, int(ratio * width))
    if elapsed_ms > stat.max_ms:
        color = GRUVBOX["red"]
    elif ratio >= 1:
        color = GRUVBOX["yellow"]
    else:
        color = GRUVBOX["green"]
    text = Text()
    text.append("█" * filled, style=color)
    text.append("░" * (width - filled), style=GRUVBOX["track"])
    return text
