"""Run records from the goal template's per-agent logs and timings.jsonl.

A log file holds one block per `--- Run started: <iso> ---` delimiter; the
file name carries the role and issue. The loop appends one JSON line per
finished phase to timings.jsonl, which is the authority on outcome and
duration when a block can be matched to it (same phase, same issue, start
within 15 s). Pure: takes content, mtimes and `now` as arguments.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

RUNNING_WINDOW = timedelta(minutes=3)
MATCH_WINDOW = timedelta(seconds=15)
LAST_LINE_CHARS = 220

_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")
_RUN_MARKER = re.compile(r"^--- Run started: (.+?) ---$", re.M)
_STAMP = re.compile(r"^\[(\d\d:\d\d:\d\d)\]", re.M)
_COMPLETE = re.compile(r"\bRun (complete|failed|aborted)\b")
_ITERATION = re.compile(r"Iteration \d+/\d+")
_CONTEXT = re.compile(r"Context window: (\S+)")
_CRASH = re.compile(r"^Node\.js v\d")
_ERROR = re.compile(r"^[A-Z][A-Za-z]*Error\b|\berror:|\bfailed:", re.I)
_STAMP_PREFIX = re.compile(r"^\[\d\d:\d\d:\d\d\]\s*")


@dataclass(frozen=True)
class Timing:
    ts: datetime
    phase: str
    ms: int
    ok: bool
    issue: str | None
    extra: dict = field(default_factory=dict)


@dataclass
class Run:
    file: str
    index: int
    role: str
    scope: str
    issue: str | None
    status: str  # success | failed | running | interrupted
    started: datetime | None
    ended: datetime | None
    duration_ms: int | None
    iteration: str | None
    context_window: str | None
    last_line: str
    last_activity: datetime
    error: str | None
    text: str
    path: Path | None = None


def strip_ansi(text: str) -> str:
    return _ANSI.sub("", text).replace("\r", "")


def parse_log_name(name: str) -> tuple[str, str | None, str]:
    m = re.match(r"^sandcastle-issue-(\d+)-(.+)\.log$", name)
    if m:
        return "issue", m.group(1), m.group(2)
    m = re.match(r"^main-(.+)\.log$", name)
    if m:
        return "main", None, m.group(1)
    return "other", None, re.sub(r"\.log$", "", name)


def _iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def parse_timings(text: str) -> list[Timing]:
    out: list[Timing] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            raw = json.loads(line)
            ts = _iso(str(raw["ts"]))
        except (ValueError, KeyError, TypeError):
            continue
        known = {"ts", "phase", "ms", "ok", "issue"}
        out.append(
            Timing(
                ts=ts,
                phase=str(raw.get("phase", "")),
                ms=int(raw.get("ms") or 0),
                ok=bool(raw.get("ok")),
                issue=None if raw.get("issue") is None else str(raw["issue"]),
                extra={k: v for k, v in raw.items() if k not in known},
            )
        )
    return out


def read_timings(path: Path) -> list[Timing]:
    try:
        return parse_timings(path.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return []


def resolve_clock(start: datetime, hms: str) -> datetime:
    """A `[HH:MM:SS]` stamp against the run's start date (UTC), rolling to
    the next day when the clock went past midnight."""
    hour, minute, second = (int(p) for p in hms.split(":"))
    moment = start.replace(hour=hour, minute=minute, second=second, microsecond=0)
    if moment < start - timedelta(seconds=5):
        moment += timedelta(days=1)
    return moment


def extract_error(text: str) -> str | None:
    for raw in text.splitlines():
        line = _STAMP_PREFIX.sub("", raw).strip()
        if not line or line.startswith("--- Run started") or _COMPLETE.search(line):
            continue
        if _ERROR.search(line):
            return line if len(line) <= 300 else line[:300] + "…"
    return None


def _match_timing(
    role: str, issue: str | None, started: datetime, timings: list[Timing]
) -> Timing | None:
    for t in timings:
        if t.phase != role or (t.issue or "") != (issue or ""):
            continue
        entry_start = t.ts - timedelta(milliseconds=t.ms)
        if abs(entry_start - started) < MATCH_WINDOW:
            return t
    return None


def parse_runs(
    name: str,
    content: str,
    mtime: datetime,
    timings: list[Timing],
    now: datetime,
    path: Path | None = None,
) -> list[Run]:
    scope, issue_from_name, role = parse_log_name(name)
    content = strip_ansi(content)
    starts = [(m.group(1), m.start()) for m in _RUN_MARKER.finditer(content)]
    if not starts and content.strip():
        starts = [(None, 0)]
    runs: list[Run] = []
    for i, (iso, begin) in enumerate(starts):
        end = starts[i + 1][1] if i + 1 < len(starts) else len(content)
        text = content[begin:end]
        is_last = i == len(starts) - 1
        started = _iso(iso) if iso else None
        complete_line = next((l for l in text.splitlines() if _COMPLETE.search(l)), None)
        stamps = _STAMP.findall(text)
        ended: datetime | None = None
        if complete_line and started and stamps:
            ended = resolve_clock(started, stamps[-1])
        timing = _match_timing(role, issue_from_name, started, timings) if started else None
        if timing and ended is None:
            ended = timing.ts
        lines = [l for l in text.splitlines() if l.strip()]
        tail = lines[-1] if lines else ""
        crashed = bool(_CRASH.match(tail.strip()))

        if timing:
            status = "success" if timing.ok else "failed"
        elif complete_line:
            status = "failed" if re.search(r"failed|aborted", complete_line) else "success"
        elif crashed:
            status = "failed"
        elif is_last and now - mtime < RUNNING_WINDOW:
            status = "running"
        else:
            status = "interrupted"

        iterations = _ITERATION.findall(text)
        ctx = _CONTEXT.findall(text)
        issue = issue_from_name or (timing.issue if timing else None)
        if status == "running":
            last_activity = mtime
        else:
            last_activity = ended or started or mtime
        duration_ms = (
            timing.ms
            if timing
            else (int((ended - started).total_seconds() * 1000) if started and ended else None)
        )
        error = extract_error(text) if status in ("failed", "interrupted") else None
        runs.append(
            Run(
                file=name,
                index=i,
                role=role,
                scope=scope,
                issue=issue,
                status=status,
                started=started,
                ended=ended,
                duration_ms=duration_ms,
                iteration=iterations[-1] if iterations else None,
                context_window=ctx[-1] if ctx else None,
                last_line=tail if len(tail) <= LAST_LINE_CHARS else tail[:LAST_LINE_CHARS] + "…",
                last_activity=last_activity,
                error=error,
                text=text,
                path=path,
            )
        )
    return runs


def load_runs(logs: Path, now: datetime | None = None) -> list[Run]:
    """Every run in every *.log under `logs`, running first, then newest."""
    now = now or datetime.now(timezone.utc)
    try:
        files = sorted(p for p in logs.iterdir() if p.suffix == ".log")
    except OSError:
        return []
    timings = read_timings(logs / "timings.jsonl")
    runs: list[Run] = []
    for path in files:
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            content = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        runs.extend(parse_runs(path.name, content, mtime, timings, now, path))
    runs.sort(key=lambda r: (r.status != "running", -r.last_activity.timestamp()))
    return runs
