"""Where a run's wall-clock time went, by category of the step in flight.

Every stamped log line is an event; its duration is the gap to the next
stamp. The categories and their order are the control panel's, so the two
views agree.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from sandcastle_dash.logs import Run

CATEGORIES: list[tuple[str, str]] = [
    ("verify", "tests / verify"),
    ("edit", "edit / write"),
    ("explore", "read / search"),
    ("git", "git / github"),
    ("think", "thinking"),
    ("other", "other / sync"),
]

_EVENT = re.compile(r"^\[(\d\d):(\d\d):(\d\d)\] ?(.*)$", re.M)
_FINISHED = re.compile(r"\bRun (complete|failed|aborted)\b")
_TAIL_CAP = timedelta(minutes=30)
_READ_ONLY = {
    "grep", "rg", "sed", "cat", "ls", "find", "head", "tail", "wc", "tree", "diff", "awk", "stat",
}
_LIFECYCLE = re.compile(
    r"^(Iteration |Reusing |Agent (started|stopped)|Capturing |Syncing |Collecting "
    r"|Run complete|Context window|Agent signaled)"
)


def categorize(line: str) -> str:
    bash = re.match(r"^Bash\((.*)", line)
    if bash:
        cmd = bash.group(1)
        if re.search(r"validate|playwright|vitest|npm test|typecheck|\btsc\b", cmd):
            return "verify"
        head = re.match(r"^[\s(]*([\w./-]+)", cmd)
        tok = head.group(1) if head else ""
        if tok in ("git", "gh"):
            return "git"
        if tok in _READ_ONLY:
            return "explore"
        return "other"
    if re.match(r"^(Edit|Write|MultiEdit|NotebookEdit)\(", line):
        return "edit"
    if re.match(r"^(Read|Grep|Glob)\(", line):
        return "explore"
    if _LIFECYCLE.match(line):
        return "other"
    return "think"


def run_breakdown(run: Run, now: datetime) -> dict[str, float]:
    totals = {key: 0.0 for key, _ in CATEGORIES}
    events: list[tuple[int, str]] = []
    prev: int | None = None
    day_offset = 0
    for m in _EVENT.finditer(run.text):
        sec = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + day_offset
        if prev is not None and sec < prev - 5:
            day_offset += 86400
            sec += 86400
        prev = sec
        events.append((sec, categorize(m.group(4))))
    if len(events) < 2:
        return totals
    last_end: float = events[-1][0]
    if run.started and not _FINISHED.search(run.text):
        elapsed = (now - run.started).total_seconds()
        tail = elapsed - (last_end - events[0][0])
        if 0 < tail < _TAIL_CAP.total_seconds():
            last_end += tail
    for i, (sec, cat) in enumerate(events):
        end = events[i + 1][0] if i + 1 < len(events) else last_end
        totals[cat] += max(0.0, end - sec)
    return totals
