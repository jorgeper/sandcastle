# sandcastle-dash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `sandcastle-dash`, a Textual terminal dashboard that shows what the goal-template loop is running, what recently ran and how it went, what is queued and why, and 7-day stats — from `.sandcastle/logs`, `gh` and `git` on the local checkout.

**Architecture:** A Python package under `dash/` with the same layered shape as `claude-usage-tui`: pure parsers (`logs`, `breakdown`, `config`, `gh` parsing) and pure analysis (`queue`, `stats`, `orchestrator.derive_state`) that take data in and return dataclasses, all unit-tested over fixtures; one thin Textual `app.py` that loads in worker threads and renders Rich tables; a `snapshot.py` for `--once`. No TypeScript is touched.

**Tech Stack:** Python ≥ 3.12, Textual ≥ 1.0 (Rich comes with it), hatchling, uv, pytest ≥ 8. Subprocess calls to `gh`, `git`, `ps`.

**Spec:** `prd/010-sandcastle-dash.md`

## Global Constraints

- Package name `sandcastle-dash`, import name `sandcastle_dash`, script `sandcastle-dash = sandcastle_dash.app:main`, `requires-python = ">=3.12"`, `dependencies = ["textual>=1.0"]`, dev group `pytest>=8`.
- Everything lives under `dash/`; `dash/pyproject.toml` is its own project. Run tests with `cd dash && uv run pytest -q`.
- Pure modules never import `subprocess`, `textual` or `rich`; they take data as arguments. Only `gh.py`, `orchestrator.find_loop_process`, `repo.py`, `app.py`, `snapshot.py` touch the outside world.
- All datetimes are timezone-aware UTC; render in local time only in `format.py`/panels.
- Log-name shapes: `sandcastle-issue-<n>-<role>.log` → scope `issue`; `main-<role>.log` → scope `main`; else scope `other`, role = stem.
- Running window: 3 minutes. Timing match window: 15 s. Last-line trim: 220 chars. Recent runs: 24 h, 40 rows. Stats: 7 days. Breakdown: 24 h. Refresh: Now/Recent 5 s, Queue 45 s, Stats 120 s.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. lint-staged runs prettier on `.md`/`.json` — never fight it. Working branch: `feat/dash` (PRD already committed).
- Gruvbox accents: green `#b8bb26`, yellow `#fabd2f`, red `#fb4934`, aqua `#8ec07c`, blue `#83a598`, purple `#d3869b`, orange `#fe8019`, gray `#928374`, track `#504945`, bg `#1d2021`, panel `#282828`.

---

### Task 1: Package skeleton, repo discovery, formatting helpers

**Files:**

- Create: `dash/pyproject.toml`, `dash/.gitignore`, `dash/src/sandcastle_dash/__init__.py`, `dash/src/sandcastle_dash/repo.py`, `dash/src/sandcastle_dash/format.py`
- Test: `dash/tests/test_repo.py`, `dash/tests/test_format.py`

**Interfaces:**

- Produces: `repo.find_repo(start: Path | None = None) -> Path | None`, `repo.logs_dir(repo: Path) -> Path`, `format.GRUVBOX: dict[str, str]`, `format.fmt_duration(ms: float | None) -> str`, `format.fmt_ago(moment: datetime | None, now: datetime) -> str`, `format.fmt_clock(moment: datetime | None) -> str`, `format.STATUS_GLYPH: dict[str, str]`, `format.status_style(status: str) -> str`, `format.segment_bar(parts: list[tuple[str, float, str]], width: int) -> Text`.

- [ ] **Step 1: Create the project files**

`dash/pyproject.toml`:

```toml
[project]
name = "sandcastle-dash"
version = "0.1.0"
description = "Terminal dashboard for the Sandcastle goal-template loop: live agents, recent runs, issue queue, stats"
requires-python = ">=3.12"
dependencies = ["textual>=1.0"]

[project.scripts]
sandcastle-dash = "sandcastle_dash.app:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/sandcastle_dash"]

[dependency-groups]
dev = ["pytest>=8"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`dash/.gitignore`:

```
.venv/
__pycache__/
*.egg-info/
.pytest_cache/
```

`dash/src/sandcastle_dash/__init__.py`: empty file.

- [ ] **Step 2: Write the failing tests**

`dash/tests/test_repo.py`:

```python
from pathlib import Path

from sandcastle_dash.repo import find_repo, logs_dir


def test_find_repo_walks_up_to_the_logs_dir(tmp_path: Path) -> None:
    (tmp_path / ".sandcastle" / "logs").mkdir(parents=True)
    deep = tmp_path / "src" / "lib"
    deep.mkdir(parents=True)
    assert find_repo(deep) == tmp_path.resolve()
    assert logs_dir(tmp_path) == tmp_path / ".sandcastle" / "logs"


def test_find_repo_returns_none_without_logs(tmp_path: Path) -> None:
    assert find_repo(tmp_path) is None
```

`dash/tests/test_format.py`:

```python
from datetime import datetime, timedelta, timezone

from sandcastle_dash.format import fmt_ago, fmt_duration, segment_bar, status_style


def test_fmt_duration_scales() -> None:
    assert fmt_duration(None) == "—"
    assert fmt_duration(900) == "0.9s"
    assert fmt_duration(42_000) == "42s"
    assert fmt_duration(152_210) == "2m 32s"
    assert fmt_duration(3_725_000) == "1h 02m"


def test_fmt_ago_is_coarse() -> None:
    now = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
    assert fmt_ago(None, now) == "—"
    assert fmt_ago(now - timedelta(seconds=20), now) == "20s ago"
    assert fmt_ago(now - timedelta(minutes=7, seconds=30), now) == "7m ago"
    assert fmt_ago(now - timedelta(hours=3, minutes=5), now) == "3h 05m ago"
    assert fmt_ago(now - timedelta(days=2, hours=1), now) == "2d 1h ago"


def test_status_style_names_a_color_per_status() -> None:
    assert status_style("success") != status_style("failed")
    assert status_style("unknown") == status_style("interrupted")


def test_segment_bar_fills_the_width() -> None:
    bar = segment_bar([("a", 50, "red"), ("b", 50, "green")], width=10)
    assert bar.plain == "█████" + "█████"
    assert segment_bar([], width=10).plain == "░" * 10
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd dash && uv run pytest -q`
Expected: import errors for `sandcastle_dash.repo` and `sandcastle_dash.format`.

- [ ] **Step 4: Implement**

`dash/src/sandcastle_dash/repo.py`:

```python
"""Locate the repository whose .sandcastle/logs the dashboard reads."""

from __future__ import annotations

from pathlib import Path


def find_repo(start: Path | None = None) -> Path | None:
    """First ancestor (inclusive) of `start` that has a .sandcastle/logs dir."""
    here = (start or Path.cwd()).resolve()
    for candidate in (here, *here.parents):
        if (candidate / ".sandcastle" / "logs").is_dir():
            return candidate
    return None


def logs_dir(repo: Path) -> Path:
    return repo / ".sandcastle" / "logs"
```

`dash/src/sandcastle_dash/format.py`:

```python
"""Formatting helpers shared by the panels and the --once snapshot."""

from __future__ import annotations

from datetime import datetime

from rich.text import Text

# Gruvbox (dark) accents for Rich renderables; the app chrome uses Textual's
# built-in "gruvbox" theme.
GRUVBOX = {
    "green": "#b8bb26",
    "yellow": "#fabd2f",
    "red": "#fb4934",
    "aqua": "#8ec07c",
    "blue": "#83a598",
    "purple": "#d3869b",
    "orange": "#fe8019",
    "gray": "#928374",
    "track": "#504945",
}

STATUS_GLYPH = {"success": "✓", "failed": "✗", "running": "●", "interrupted": "○"}

_STATUS_COLOR = {
    "success": GRUVBOX["green"],
    "failed": GRUVBOX["red"],
    "running": GRUVBOX["aqua"],
    "interrupted": GRUVBOX["gray"],
}


def status_style(status: str) -> str:
    return _STATUS_COLOR.get(status, _STATUS_COLOR["interrupted"])


def fmt_duration(ms: float | None) -> str:
    if ms is None:
        return "—"
    secs = ms / 1000
    if secs < 1:
        return f"{secs:.1f}s"
    if secs < 60:
        return f"{int(secs)}s"
    minutes, rem = divmod(int(secs), 60)
    if minutes < 60:
        return f"{minutes}m {rem:02d}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes:02d}m"


def fmt_ago(moment: datetime | None, now: datetime) -> str:
    if moment is None:
        return "—"
    secs = max(0, int((now - moment).total_seconds()))
    if secs < 60:
        return f"{secs}s ago"
    minutes, _ = divmod(secs, 60)
    if minutes < 60:
        return f"{minutes}m ago"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes:02d}m ago"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h ago"


def fmt_clock(moment: datetime | None) -> str:
    return "—" if moment is None else f"{moment.astimezone():%H:%M}"


def segment_bar(parts: list[tuple[str, float, str]], width: int) -> Text:
    """Stacked bar: parts are (key, percent, color). Rounds so the bar always
    fills `width`; an empty list renders an empty track."""
    text = Text()
    total = sum(p for _, p, _ in parts)
    if total <= 0:
        text.append("░" * width, style=GRUVBOX["track"])
        return text
    used = 0
    for i, (_, percent, color) in enumerate(parts):
        cells = width - used if i == len(parts) - 1 else round(width * percent / total)
        text.append("█" * cells, style=color)
        used += cells
    return text
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd dash && uv sync && uv run pytest -q`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add dash/pyproject.toml dash/.gitignore dash/src/sandcastle_dash/__init__.py dash/src/sandcastle_dash/repo.py dash/src/sandcastle_dash/format.py dash/tests/test_repo.py dash/tests/test_format.py dash/uv.lock
git commit -m "dash: package skeleton, repo discovery, formatting helpers (prd/010)"
```

---

### Task 2: Run records from logs and timings (`logs.py`)

**Files:**

- Create: `dash/src/sandcastle_dash/logs.py`
- Create fixtures: `dash/tests/fixtures/logs/sandcastle-issue-31-implementer.log`, `dash/tests/fixtures/logs/main-planner.log`, `dash/tests/fixtures/logs/sandcastle-issue-40-reviewer.log`, `dash/tests/fixtures/logs/sandcastle-issue-41-spec-writer.log`, `dash/tests/fixtures/logs/timings.jsonl`
- Test: `dash/tests/test_logs.py`

**Interfaces:**

- Produces:
  - `@dataclass(frozen=True) Timing(ts: datetime, phase: str, ms: int, ok: bool, issue: str | None, extra: dict)`
  - `@dataclass Run(file: str, index: int, role: str, scope: str, issue: str | None, status: str, started: datetime | None, ended: datetime | None, duration_ms: int | None, iteration: str | None, context_window: str | None, last_line: str, last_activity: datetime, error: str | None, text: str, path: Path | None)`
  - `strip_ansi(text) -> str`, `parse_log_name(name) -> tuple[str, str | None, str]` (scope, issue, role), `read_timings(path) -> list[Timing]`, `parse_timings(text) -> list[Timing]`, `resolve_clock(start, hms) -> datetime`, `extract_error(text) -> str | None`, `parse_runs(name, content, mtime, timings, now, path=None) -> list[Run]`, `load_runs(logs: Path, now: datetime | None = None) -> list[Run]`.
  - Constants `RUNNING_WINDOW = timedelta(minutes=3)`, `MATCH_WINDOW = timedelta(seconds=15)`.

- [ ] **Step 1: Write the fixtures**

`dash/tests/fixtures/logs/sandcastle-issue-31-implementer.log` (two blocks: a finished one that matches a timing, then a running one with no markers):

```
--- Run started: 2026-09-06T18:54:50.078Z ---
[18:54:50] Iteration 1/4
[18:54:50] Reusing live sandbox (setup already done)
[18:54:50] Agent started
[18:54:52] I'll start by invoking the implementer process skill and reading the spec.
[18:54:54] Bash(cat issue-specs/issue-31.md && git log -n 10 --oneline)
[18:55:04] Read(src/lib/settings.ts)
[18:56:10] Edit(src/lib/settings.ts)
[18:56:40] Bash(npm run typecheck && npm run test:unit)
[18:57:20] Bash(git add -A && git commit -m "RALPH: issue #31 — settings" )
[18:57:21] Syncing 1 commit to host
[18:57:21] Syncing 1 commit to host done (0.0s)
[18:57:21] Iteration 1 finished in 151.0s
[18:57:21] Agent signaled completion after 1 iteration(s).
[18:57:21] Run complete: agent finished after 1 iteration(s).
[18:57:21] Context window: 74k

--- Run started: 2026-09-06T19:20:00.000Z ---
[19:20:00] Iteration 2/4
[19:20:00] Agent started
[19:20:03] Bash(sed -n 1,40p src/App.tsx)
[19:20:09] Let me look at the failing test.
```

`dash/tests/fixtures/logs/main-planner.log` (a failed run with an error line, matched by an ok:false timing):

```
--- Run started: 2026-09-06T18:03:41.835Z ---
[18:03:41] Sandcastle Run
  Agent: planner
  Sandbox: docker
  Max iterations: 1
[18:03:41] Iteration 1/1
[18:03:41] Git worktree operation failed: Provider 'docker' create failed: Image 'sandcastle:marky-mark' not found locally.
[18:03:42] Run failed: sandbox could not start.
```

`dash/tests/fixtures/logs/sandcastle-issue-40-reviewer.log` (crash dump, no completion line, no timing):

```
--- Run started: 2026-09-06T17:00:00.000Z ---
[17:00:00] Iteration 1/1
[17:00:00] Agent started
[17:00:05] Bash(npm run validate:quick)
node:internal/process/promises:391
    triggerUncaughtException(err, true /* fromPromise */);
    ^
TypeError: Cannot read properties of undefined (reading 'branch')
    at file:///workspace/.sandcastle/main.ts:1201:30

Node.js v22.23.1
```

`dash/tests/fixtures/logs/sandcastle-issue-41-spec-writer.log` (completes after midnight, no timing):

```
--- Run started: 2026-09-05T23:59:50.000Z ---
[23:59:50] Iteration 1/1
[23:59:50] Agent started
[00:01:10] Write(issue-specs/issue-41.md)
[00:01:12] Run complete: agent finished after 1 iteration(s).
```

`dash/tests/fixtures/logs/timings.jsonl`:

```
{"ts":"2026-09-06T18:03:42.100Z","phase":"planner","ms":265,"ok":false,"candidates":2}
{"ts":"2026-09-06T18:57:21.300Z","phase":"implementer","ms":151222,"ok":true,"issue":"31"}
{"ts":"2026-09-06T18:57:25.000Z","phase":"implementer","ms":155000,"ok":false,"issue":"32"}
```

- [ ] **Step 2: Write the failing tests**

`dash/tests/test_logs.py`:

```python
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from sandcastle_dash.logs import (
    extract_error,
    load_runs,
    parse_log_name,
    parse_runs,
    read_timings,
    resolve_clock,
    strip_ansi,
)

FIXTURES = Path(__file__).parent / "fixtures" / "logs"
UTC = timezone.utc
NOW = datetime(2026, 9, 6, 19, 21, 0, tzinfo=UTC)


def _runs(name: str, mtime: datetime, now: datetime = NOW):
    content = (FIXTURES / name).read_text()
    return parse_runs(name, content, mtime, read_timings(FIXTURES / "timings.jsonl"), now)


def test_parse_log_name_shapes() -> None:
    assert parse_log_name("sandcastle-issue-31-implementer.log") == ("issue", "31", "implementer")
    assert parse_log_name("main-planner.log") == ("main", None, "planner")
    assert parse_log_name("prd-issue-56-decomposer.log") == ("other", None, "prd-issue-56-decomposer")


def test_strip_ansi_removes_escapes() -> None:
    assert strip_ansi("\x1b[32mok\x1b[0m done\r") == "ok done"


def test_resolve_clock_rolls_over_midnight() -> None:
    start = datetime(2026, 9, 5, 23, 59, 50, tzinfo=UTC)
    assert resolve_clock(start, "00:01:12") == datetime(2026, 9, 6, 0, 1, 12, tzinfo=UTC)
    assert resolve_clock(start, "23:59:55") == datetime(2026, 9, 5, 23, 59, 55, tzinfo=UTC)


def test_extract_error_finds_the_first_error_line() -> None:
    text = "[18:03:41] Iteration 1/1\n[18:03:41] Git worktree operation failed: Provider 'docker' create failed\n[18:03:42] Run failed: x\n"
    assert extract_error(text) == "Git worktree operation failed: Provider 'docker' create failed"
    assert extract_error("[1:1:1] all good\n") is None


def test_finished_block_matches_its_timing_and_the_last_block_runs() -> None:
    mtime = NOW - timedelta(seconds=30)
    first, second = _runs("sandcastle-issue-31-implementer.log", mtime)
    assert (first.role, first.issue, first.scope) == ("implementer", "31", "issue")
    assert first.status == "success"
    assert first.duration_ms == 151222
    assert first.ended == datetime(2026, 9, 6, 18, 57, 21, 300000, tzinfo=UTC)
    assert first.iteration == "Iteration 1/4"
    assert first.context_window == "74k"
    assert first.error is None
    assert second.status == "running"
    assert second.iteration == "Iteration 2/4"
    assert second.last_line == "[19:20:09] Let me look at the failing test."
    assert second.last_activity == mtime
    assert second.duration_ms is None


def test_a_stale_last_block_is_interrupted() -> None:
    mtime = NOW - timedelta(minutes=10)
    _, second = _runs("sandcastle-issue-31-implementer.log", mtime)
    assert second.status == "interrupted"


def test_timing_decides_failure_and_error_is_extracted() -> None:
    (run,) = _runs("main-planner.log", NOW - timedelta(hours=1))
    assert run.status == "failed"
    assert run.scope == "main" and run.issue is None
    assert run.error is not None and run.error.startswith("Git worktree operation failed")
    assert run.duration_ms == 265


def test_a_crash_dump_is_failed_even_when_fresh() -> None:
    (run,) = _runs("sandcastle-issue-40-reviewer.log", NOW - timedelta(seconds=10))
    assert run.status == "failed"
    assert run.error is not None and run.error.startswith("TypeError")


def test_completion_line_without_timing_resolves_end_across_midnight() -> None:
    (run,) = _runs("sandcastle-issue-41-spec-writer.log", NOW - timedelta(hours=19))
    assert run.status == "success"
    assert run.ended == datetime(2026, 9, 6, 0, 1, 12, tzinfo=UTC)
    assert run.duration_ms == 82_000


def test_timing_match_requires_the_same_issue() -> None:
    # Issue 32's ok:false entry starts within 15s of issue 31's block; it must not be adopted.
    first, _ = _runs("sandcastle-issue-31-implementer.log", NOW)
    assert first.status == "success"


def test_load_runs_orders_running_first_then_recent(tmp_path: Path) -> None:
    import shutil

    for name in ("sandcastle-issue-31-implementer.log", "main-planner.log", "timings.jsonl"):
        shutil.copy(FIXTURES / name, tmp_path / name)
    runs = load_runs(tmp_path, now=datetime.now(UTC))
    assert runs[0].status == "running"
    assert [r.file for r in runs].count("main-planner.log") == 1
    assert runs[0].path == tmp_path / "sandcastle-issue-31-implementer.log"


def test_load_runs_survives_a_missing_dir(tmp_path: Path) -> None:
    assert load_runs(tmp_path / "nope") == []
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd dash && uv run pytest tests/test_logs.py -q`
Expected: ImportError on `sandcastle_dash.logs`.

- [ ] **Step 4: Implement**

`dash/src/sandcastle_dash/logs.py`:

```python
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


def _match_timing(role: str, issue: str | None, started: datetime, timings: list[Timing]) -> Timing | None:
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
        duration_ms = timing.ms if timing else (
            int((ended - started).total_seconds() * 1000) if started and ended else None
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd dash && uv run pytest tests/test_logs.py -q`
Expected: 12 passed.

- [ ] **Step 6: Commit**

```bash
git add dash/src/sandcastle_dash/logs.py dash/tests/test_logs.py dash/tests/fixtures/logs
git commit -m "dash: run records from logs and timings (prd/010 Req 2-6)"
```

---

### Task 3: Time breakdown per run (`breakdown.py`)

**Files:**

- Create: `dash/src/sandcastle_dash/breakdown.py`
- Test: `dash/tests/test_breakdown.py`

**Interfaces:**

- Consumes: `logs.Run` (uses `.text`, `.started`, `.status`).
- Produces: `CATEGORIES: list[tuple[str, str]]` (key, label) in fixed order `verify, edit, explore, git, think, other`; `categorize(line: str) -> str`; `run_breakdown(run: Run, now: datetime) -> dict[str, float]` seconds per category (every key present).

- [ ] **Step 1: Write the failing tests**

`dash/tests/test_breakdown.py`:

```python
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sandcastle_dash.breakdown import CATEGORIES, categorize, run_breakdown
from sandcastle_dash.logs import parse_runs, read_timings

FIXTURES = Path(__file__).parent / "fixtures" / "logs"
UTC = timezone.utc


def test_categorize_matches_the_panel_rules() -> None:
    assert categorize("Bash(npm run typecheck && npm run test:unit)") == "verify"
    assert categorize("Bash(npx playwright test -g 'E12')") == "verify"
    assert categorize("Bash(git add -A && git commit -m x)") == "git"
    assert categorize("Bash(gh issue view 31)") == "git"
    assert categorize("Bash(sed -n 1,40p src/App.tsx)") == "explore"
    assert categorize("Bash(node scripts/map.mjs)") == "other"
    assert categorize("Edit(src/lib/settings.ts)") == "edit"
    assert categorize("Write(issue-specs/issue-41.md)") == "edit"
    assert categorize("Read(src/lib/settings.ts)") == "explore"
    assert categorize("Iteration 1/4") == "other"
    assert categorize("Syncing 1 commit to host") == "other"
    assert categorize("Let me look at the failing test.") == "think"


def test_run_breakdown_sums_gaps_between_stamps() -> None:
    content = (FIXTURES / "sandcastle-issue-31-implementer.log").read_text()
    now = datetime(2026, 9, 6, 19, 21, 0, tzinfo=UTC)
    first, second = parse_runs(
        "sandcastle-issue-31-implementer.log", content, now, read_timings(FIXTURES / "timings.jsonl"), now
    )
    totals = run_breakdown(first, now)
    assert set(totals) == {k for k, _ in CATEGORIES}
    # 18:54:52 narration → 18:54:54 = 2s think; Read 18:55:04 → Edit 18:56:10 = 66s explore
    assert totals["explore"] == 66
    assert totals["edit"] == 30
    assert totals["verify"] == 40
    # a running block extends its last event to now (60s after 19:20:09 → 19:21:00 = 51s)
    running = run_breakdown(second, now)
    assert running["think"] == 51


def test_breakdown_needs_two_events() -> None:
    from sandcastle_dash.logs import Run

    run = Run("x.log", 0, "r", "other", None, "success", None, None, None, None, None, "", datetime.now(UTC), None, "[10:00:00] only\n")
    assert all(v == 0 for v in run_breakdown(run, datetime.now(UTC)).values())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dash && uv run pytest tests/test_breakdown.py -q`
Expected: ImportError.

- [ ] **Step 3: Implement**

`dash/src/sandcastle_dash/breakdown.py`:

```python
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
_READ_ONLY = {"grep", "rg", "sed", "cat", "ls", "find", "head", "tail", "wc", "tree", "diff", "awk", "stat"}


def categorize(line: str) -> str:
    bash = re.match(r"^Bash\((.*)", line)
    if bash:
        cmd = bash.group(1)
        if re.search(r"validate|playwright|vitest|npm test|typecheck|\btsc\b", cmd):
            return "verify"
        tok = (re.match(r"^[\s(]*([\w./-]+)", cmd) or [None, ""])[1] or ""
        if tok in ("git", "gh"):
            return "git"
        if tok in _READ_ONLY:
            return "explore"
        return "other"
    if re.match(r"^(Edit|Write|MultiEdit|NotebookEdit)\(", line):
        return "edit"
    if re.match(r"^(Read|Grep|Glob)\(", line):
        return "explore"
    if re.match(
        r"^(Iteration |Reusing |Agent (started|stopped)|Capturing |Syncing |Collecting |Run complete|Context window|Agent signaled)",
        line,
    ):
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
    last_end = events[-1][0]
    if run.started and not _FINISHED.search(run.text):
        elapsed = (now - run.started).total_seconds()
        tail = elapsed - (last_end - events[0][0])
        if 0 < tail < _TAIL_CAP.total_seconds():
            last_end += tail
    for i, (sec, cat) in enumerate(events):
        end = events[i + 1][0] if i + 1 < len(events) else last_end
        totals[cat] += max(0.0, end - sec)
    return totals
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dash && uv run pytest tests/test_breakdown.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add dash/src/sandcastle_dash/breakdown.py dash/tests/test_breakdown.py
git commit -m "dash: per-run time breakdown (prd/010 Req 7)"
```

---

### Task 4: Orchestrator state (`orchestrator.py`)

**Files:**

- Create: `dash/src/sandcastle_dash/orchestrator.py`
- Test: `dash/tests/test_orchestrator.py`

**Interfaces:**

- Consumes: `logs.Run`.
- Produces: `@dataclass(frozen=True) LoopProcess(pid: int, started: datetime)`; `parse_ps(text: str, now: datetime) -> LoopProcess | None` (pure; `text` is `ps -axo pid=,lstart=,command=` output); `find_loop_process(now) -> LoopProcess | None` (runs ps); `@dataclass(frozen=True) LoopState(running: bool, pid: int | None, started: datetime | None, iteration: int | None, last_run: Run | None)`; `derive_state(proc: LoopProcess | None, runs: list[Run]) -> LoopState`.

- [ ] **Step 1: Write the failing tests**

`dash/tests/test_orchestrator.py`:

```python
from datetime import datetime, timezone

from sandcastle_dash.logs import Run
from sandcastle_dash.orchestrator import LoopProcess, derive_state, parse_ps

UTC = timezone.utc
PS = """\
  412 Sun Sep  6 09:00:00 2026 /sbin/launchd
33459 Sun Sep  6 11:59:12 2026 npm exec tsx .sandcastle/main.ts
33485 Sun Sep  6 11:59:13 2026 node /Users/me/src/app/node_modules/.bin/tsx .sandcastle/main.ts
33500 Sun Sep  6 12:10:00 2026 grep .sandcastle/main.ts
"""


def _run(role: str, started: datetime, status: str = "success", issue: str | None = None) -> Run:
    return Run(f"{role}.log", 0, role, "main", issue, status, started, started, 1000, None, None, "", started, None, "")


def test_parse_ps_picks_the_earliest_real_loop_process() -> None:
    proc = parse_ps(PS, datetime.now(UTC))
    assert proc is not None
    assert proc.pid == 33459
    local = proc.started.astimezone()
    assert (local.hour, local.minute, local.second) == (11, 59, 12)


def test_parse_ps_ignores_unrelated_lines() -> None:
    assert parse_ps("  412 Sun Sep  6 09:00:00 2026 /sbin/launchd\n", datetime.now(UTC)) is None


def test_derive_state_counts_planner_runs_since_start() -> None:
    start = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)
    runs = [
        _run("planner", datetime(2026, 9, 6, 11, 0, tzinfo=UTC)),  # before this loop
        _run("planner", datetime(2026, 9, 6, 12, 5, tzinfo=UTC)),
        _run("planner", datetime(2026, 9, 6, 12, 40, tzinfo=UTC)),
        _run("implementer", datetime(2026, 9, 6, 12, 41, tzinfo=UTC), "running", "31"),
    ]
    state = derive_state(LoopProcess(1, start), runs)
    assert state.running and state.pid == 1 and state.iteration == 2
    assert state.last_run is not None and state.last_run.role == "implementer"


def test_derive_state_idle_reports_the_latest_run() -> None:
    runs = [_run("merger", datetime(2026, 9, 6, 10, 0, tzinfo=UTC)), _run("planner", datetime(2026, 9, 6, 9, 0, tzinfo=UTC))]
    state = derive_state(None, runs)
    assert not state.running and state.iteration is None
    assert state.last_run is not None and state.last_run.role == "merger"
    assert derive_state(None, []).last_run is None


def test_derive_state_iteration_is_one_before_the_first_planner() -> None:
    assert derive_state(LoopProcess(1, datetime.now(UTC)), []).iteration == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dash && uv run pytest tests/test_orchestrator.py -q`
Expected: ImportError.

- [ ] **Step 3: Implement**

`dash/src/sandcastle_dash/orchestrator.py`:

```python
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
            ["ps", "-axo", "pid=,lstart=,command="], capture_output=True, text=True, timeout=5, check=False
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_ps(out, now)


def derive_state(proc: LoopProcess | None, runs: list[Run]) -> LoopState:
    last = max(runs, key=lambda r: r.last_activity, default=None)
    if proc is None:
        return LoopState(False, None, None, None, last)
    planners = sum(1 for r in runs if r.role == "planner" and r.started and r.started >= proc.started)
    return LoopState(True, proc.pid, proc.started, max(1, planners), last)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dash && uv run pytest tests/test_orchestrator.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add dash/src/sandcastle_dash/orchestrator.py dash/tests/test_orchestrator.py
git commit -m "dash: orchestrator state from ps and planner runs (prd/010 Req 8)"
```

---

### Task 5: GitHub and git sources (`gh.py`)

**Files:**

- Create: `dash/src/sandcastle_dash/gh.py`
- Create fixture: `dash/tests/fixtures/issues.json`
- Test: `dash/tests/test_gh.py`

**Interfaces:**

- Produces: `@dataclass(frozen=True) Issue(number: int, title: str, state: str, url: str, created: datetime, updated: datetime, labels: tuple[str, ...], parent: int | None, sub_issues: tuple[int, ...])`; `@dataclass(frozen=True) Pr(number: int, title: str, state: str, branch: str, is_draft: bool, labels: tuple[str, ...], linked: tuple[int, ...])`; `@dataclass(frozen=True) Merge(ts: datetime, issues: tuple[int, ...], subject: str)`; pure parsers `parse_issues(text) -> list[Issue]`, `parse_prs(text) -> list[Pr]`, `parse_merges(text) -> list[Merge]`, `parse_branches(text) -> dict[str, int]`; fetchers `fetch_issues(repo)`, `fetch_prs(repo)`, `fetch_merges(repo, base)`, `default_branch(repo) -> str`, `branch_commit_counts(repo, base, branches: list[str]) -> dict[str, int]`; `class SourceError(Exception)`.

- [ ] **Step 1: Write the fixture and failing tests**

`dash/tests/fixtures/issues.json`:

```json
{
  "data": {
    "repository": {
      "issues": {
        "nodes": [
          {
            "number": 300,
            "title": "PRD: comments split",
            "state": "OPEN",
            "url": "https://github.com/o/r/issues/300",
            "createdAt": "2026-09-01T10:00:00Z",
            "updatedAt": "2026-09-06T10:00:00Z",
            "closedAt": null,
            "labels": {
              "nodes": [
                { "name": "sandcastle" },
                { "name": "sandcastle:requires-prd" }
              ]
            },
            "parent": null,
            "subIssues": { "nodes": [{ "number": 301 }, { "number": 302 }] }
          },
          {
            "number": 301,
            "title": "Child one",
            "state": "OPEN",
            "url": "https://github.com/o/r/issues/301",
            "createdAt": "2026-09-05T10:00:00Z",
            "updatedAt": "2026-09-06T09:00:00Z",
            "closedAt": null,
            "labels": {
              "nodes": [
                { "name": "sandcastle" },
                { "name": "sandcastle:effort-hard" }
              ]
            },
            "parent": { "number": 300 },
            "subIssues": { "nodes": [] }
          },
          {
            "number": 302,
            "title": "Child two (done)",
            "state": "CLOSED",
            "url": "https://github.com/o/r/issues/302",
            "createdAt": "2026-09-05T10:00:00Z",
            "updatedAt": "2026-09-06T08:00:00Z",
            "closedAt": "2026-09-06T08:00:00Z",
            "labels": { "nodes": [{ "name": "sandcastle" }] },
            "parent": { "number": 300 },
            "subIssues": { "nodes": [] }
          },
          {
            "number": 310,
            "title": "Plain queued issue",
            "state": "OPEN",
            "url": "https://github.com/o/r/issues/310",
            "createdAt": "2026-09-06T06:00:00Z",
            "updatedAt": "2026-09-06T06:00:00Z",
            "closedAt": null,
            "labels": {
              "nodes": [
                { "name": "sandcastle" },
                { "name": "sandcastle:require-pr" }
              ]
            },
            "parent": null,
            "subIssues": { "nodes": [] }
          }
        ]
      }
    }
  }
}
```

`dash/tests/test_gh.py`:

```python
from datetime import datetime, timezone
from pathlib import Path

from sandcastle_dash.gh import parse_branches, parse_issues, parse_merges, parse_prs

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_issues_reads_labels_parent_and_children() -> None:
    issues = parse_issues((FIXTURES / "issues.json").read_text())
    by = {i.number: i for i in issues}
    assert by[300].sub_issues == (301, 302)
    assert by[301].parent == 300
    assert "sandcastle:effort-hard" in by[301].labels
    assert by[302].state == "CLOSED"
    assert by[310].created == datetime(2026, 9, 6, 6, 0, tzinfo=timezone.utc)


def test_parse_prs_links_issues_from_branch_and_title() -> None:
    text = '[{"number":7,"title":"Fix #31 and #32","state":"OPEN","headRefName":"sandcastle/issue-31","isDraft":false,"labels":[{"name":"sandcastle:ready"}]}]'
    (pr,) = parse_prs(text)
    assert pr.linked == (31, 32)
    assert pr.labels == ("sandcastle:ready",)


def test_parse_merges_keeps_only_issue_merges() -> None:
    text = "2026-09-06T11:00:00+00:00|sandcastle: merge issues #31 #32 into main\n2026-09-06T10:00:00+00:00|docs: typo\n2026-09-05T10:00:00+00:00|RALPH: merge issue #30\n"
    merges = parse_merges(text)
    assert [m.issues for m in merges] == [(31, 32), (30,)]


def test_parse_branches_reads_name_and_count() -> None:
    assert parse_branches("sandcastle/issue-31 3\nsandcastle/issue-32 0\n") == {"sandcastle/issue-31": 3, "sandcastle/issue-32": 0}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dash && uv run pytest tests/test_gh.py -q`
Expected: ImportError.

- [ ] **Step 3: Implement**

`dash/src/sandcastle_dash/gh.py`:

```python
"""GitHub (via gh) and git sources. Parsers are pure; fetchers shell out
with timeouts and raise SourceError so the app can keep its last value."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ISSUES_QUERY = """query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    issues(first:100,orderBy:{field:UPDATED_AT,direction:DESC}){
      nodes{
        number title state url createdAt updatedAt closedAt
        labels(first:20){nodes{name}}
        parent{number}
        subIssues(first:100){nodes{number}}
      }
    }
  }
}"""


class SourceError(Exception):
    """A gh/git call failed; the message is one line for a section title."""


@dataclass(frozen=True)
class Issue:
    number: int
    title: str
    state: str
    url: str
    created: datetime
    updated: datetime
    labels: tuple[str, ...]
    parent: int | None
    sub_issues: tuple[int, ...]


@dataclass(frozen=True)
class Pr:
    number: int
    title: str
    state: str
    branch: str
    is_draft: bool
    labels: tuple[str, ...]
    linked: tuple[int, ...]


@dataclass(frozen=True)
class Merge:
    ts: datetime
    issues: tuple[int, ...]
    subject: str


def _iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _run(args: list[str], cwd: Path, timeout: float = 30) -> str:
    try:
        done = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise SourceError(f"{args[0]}: {exc.__class__.__name__}") from exc
    if done.returncode != 0:
        first = (done.stderr or done.stdout).strip().splitlines()
        raise SourceError(f"{args[0]}: {first[0] if first else f'exit {done.returncode}'}")
    return done.stdout


def parse_issues(text: str) -> list[Issue]:
    try:
        nodes = json.loads(text)["data"]["repository"]["issues"]["nodes"]
    except (ValueError, KeyError, TypeError) as exc:
        raise SourceError(f"issues: unexpected payload ({exc.__class__.__name__})") from exc
    return [
        Issue(
            number=int(n["number"]),
            title=str(n.get("title", "")),
            state=str(n.get("state", "")),
            url=str(n.get("url", "")),
            created=_iso(n["createdAt"]),
            updated=_iso(n["updatedAt"]),
            labels=tuple(l["name"] for l in n.get("labels", {}).get("nodes", [])),
            parent=int(n["parent"]["number"]) if n.get("parent") else None,
            sub_issues=tuple(int(s["number"]) for s in n.get("subIssues", {}).get("nodes", [])),
        )
        for n in nodes
    ]


def parse_prs(text: str) -> list[Pr]:
    try:
        raw = json.loads(text)
    except ValueError as exc:
        raise SourceError("prs: unexpected payload") from exc
    prs: list[Pr] = []
    for p in raw:
        branch = str(p.get("headRefName", ""))
        linked: list[int] = []
        m = re.search(r"issue-(\d+)", branch)
        if m:
            linked.append(int(m.group(1)))
        for t in re.finditer(r"#(\d+)", str(p.get("title", ""))):
            n = int(t.group(1))
            if n not in linked:
                linked.append(n)
        prs.append(
            Pr(
                number=int(p["number"]),
                title=str(p.get("title", "")),
                state=str(p.get("state", "")),
                branch=branch,
                is_draft=bool(p.get("isDraft")),
                labels=tuple(l["name"] for l in p.get("labels", [])),
                linked=tuple(linked),
            )
        )
    return prs


def parse_merges(text: str) -> list[Merge]:
    merges: list[Merge] = []
    for line in text.splitlines():
        bar = line.find("|")
        if bar < 0:
            continue
        ts, subject = line[:bar], line[bar + 1 :]
        if not re.search(r"\bmerge issues? #", subject, re.I):
            continue
        issues = tuple(int(m.group(1)) for m in re.finditer(r"#(\d+)", subject))
        if issues:
            merges.append(Merge(_iso(ts), issues, subject))
    return merges


def parse_branches(text: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].isdigit():
            out[parts[0]] = int(parts[1])
    return out


def fetch_issues(repo: Path) -> list[Issue]:
    return parse_issues(
        _run(["gh", "api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", f"query={ISSUES_QUERY}"], repo)
    )


def fetch_prs(repo: Path) -> list[Pr]:
    return parse_prs(
        _run(
            ["gh", "pr", "list", "--state", "all", "--limit", "50", "--json", "number,title,state,headRefName,isDraft,labels"],
            repo,
        )
    )


def default_branch(repo: Path) -> str:
    try:
        ref = _run(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo, timeout=5).strip()
        return ref.split("/", 1)[1] if "/" in ref else ref
    except SourceError:
        return "main"


def fetch_merges(repo: Path, base: str) -> list[Merge]:
    return parse_merges(
        _run(["git", "log", "--since=14 days ago", "--first-parent", "--pretty=%cI|%s", base], repo, timeout=10)
    )


def branch_commit_counts(repo: Path, base: str, branches: list[str]) -> dict[str, int]:
    """Commits on each branch not in `base`; branches that do not exist are absent."""
    counts: dict[str, int] = {}
    for branch in branches:
        try:
            out = _run(["git", "rev-list", "--count", f"{base}..{branch}"], repo, timeout=5).strip()
        except SourceError:
            continue
        if out.isdigit():
            counts[branch] = int(out)
    return counts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dash && uv run pytest tests/test_gh.py -q`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add dash/src/sandcastle_dash/gh.py dash/tests/test_gh.py dash/tests/fixtures/issues.json
git commit -m "dash: gh and git sources with pure parsers (prd/010 Req 9-10)"
```

---

### Task 6: Template config (`config.py`)

**Files:**

- Create: `dash/src/sandcastle_dash/config.py`
- Create fixture: `dash/tests/fixtures/config.mts`
- Test: `dash/tests/test_config.py`

**Interfaces:**

- Produces: `@dataclass(frozen=True) TemplateConfig(tiers: tuple[tuple[str, str], ...] | None, agent_tiers: dict[str, str] | None, spec_dir: str | None)`; `parse_config(text: str) -> TemplateConfig`; `load_config(repo: Path) -> TemplateConfig` (missing file → all None).

- [ ] **Step 1: Write the fixture and failing tests**

`dash/tests/fixtures/config.mts`:

```ts
export const SPEC_DIR = "issue-specs";
export const MAX_ITERATIONS = 10;

// Effort tiers, ordered weakest → strongest.
export const EFFORT_TIERS = [
  { name: "normal", model: "claude-opus-5" },
  { name: "hard", model: "claude-fable-5-1" },
] as const;

export const AGENT_TIERS = {
  // The loop (main.ts)
  planner: "normal",
  "spec-writer": "hard",
  implementer: "hard",
  reviewer: "normal",
  merger: "normal",
  "conflict-resolver": "normal",
  decomposer: "normal",
  "pr-reviewer": "normal",
  addresser: "normal",
  designer: "normal",
  filer: "normal",
} as const satisfies Record<string, (typeof EFFORT_TIERS)[number]["name"]>;
```

`dash/tests/test_config.py`:

```python
from pathlib import Path

from sandcastle_dash.config import load_config, parse_config

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_config_reads_the_three_blocks() -> None:
    cfg = parse_config((FIXTURES / "config.mts").read_text())
    assert cfg.spec_dir == "issue-specs"
    assert cfg.tiers == (("normal", "claude-opus-5"), ("hard", "claude-fable-5-1"))
    assert cfg.agent_tiers is not None
    assert cfg.agent_tiers["spec-writer"] == "hard"
    assert cfg.agent_tiers["planner"] == "normal"
    assert len(cfg.agent_tiers) == 11


def test_parse_config_degrades_to_none() -> None:
    cfg = parse_config('export const SPEC_DIR = "specs";\n')
    assert cfg.spec_dir == "specs" and cfg.tiers is None and cfg.agent_tiers is None


def test_load_config_without_a_file(tmp_path: Path) -> None:
    cfg = load_config(tmp_path)
    assert cfg == parse_config("")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dash && uv run pytest tests/test_config.py -q`
Expected: ImportError.

- [ ] **Step 3: Implement**

`dash/src/sandcastle_dash/config.py`:

```python
"""The few knobs of .sandcastle/config.mts the dashboard needs, read by
regex over their literal blocks. Never executes the file; a miss is None."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_SPEC_DIR = re.compile(r'export const SPEC_DIR\s*=\s*"([^"]+)"')
_TIERS_BLOCK = re.compile(r"export const EFFORT_TIERS\s*=\s*\[(.*?)\]", re.S)
_TIER = re.compile(r'\{\s*name:\s*"([^"]+)"\s*,\s*model:\s*"([^"]+)"\s*\}')
_AGENTS_BLOCK = re.compile(r"export const AGENT_TIERS\s*=\s*\{(.*?)\}", re.S)
_AGENT = re.compile(r'^\s*"?([\w-]+)"?\s*:\s*"([^"]+)"', re.M)


@dataclass(frozen=True)
class TemplateConfig:
    tiers: tuple[tuple[str, str], ...] | None
    agent_tiers: dict[str, str] | None
    spec_dir: str | None


def parse_config(text: str) -> TemplateConfig:
    spec = _SPEC_DIR.search(text)
    tiers_block = _TIERS_BLOCK.search(text)
    tiers = tuple(_TIER.findall(tiers_block.group(1))) if tiers_block else None
    agents_block = _AGENTS_BLOCK.search(text)
    agents = None
    if agents_block:
        body = re.sub(r"//[^\n]*", "", agents_block.group(1))
        agents = {role: tier for role, tier in _AGENT.findall(body)}
    return TemplateConfig(
        tiers=tiers or None,
        agent_tiers=agents or None,
        spec_dir=spec.group(1) if spec else None,
    )


def load_config(repo: Path) -> TemplateConfig:
    try:
        return parse_config((repo / ".sandcastle" / "config.mts").read_text(encoding="utf-8"))
    except OSError:
        return parse_config("")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dash && uv run pytest tests/test_config.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add dash/src/sandcastle_dash/config.py dash/tests/test_config.py dash/tests/fixtures/config.mts
git commit -m "dash: read tiers, agent tiers and spec dir from config.mts (prd/010 Req 11)"
```

---

### Task 7: Issue queue (`queue.py`)

**Files:**

- Create: `dash/src/sandcastle_dash/queue.py`
- Test: `dash/tests/test_queue.py`

**Interfaces:**

- Consumes: `gh.Issue`, `gh.Pr`, `logs.Run`, `config.TemplateConfig`.
- Produces: `ISSUE_PATH = ("spec-writer", "implementer", "reviewer", "merger", "conflict-resolver")`, `PR_PATH = ("pr-reviewer", "addresser")`; `required_tier(labels, tiers) -> str | None`; `held_agents(required, cfg, pr_flag) -> list[str] | None` (None = unknown, [] = not held); `@dataclass(frozen=True) Row(number, title, tier, flags: tuple[str, ...], age: timedelta, stage: str, detail: str, depth: int, tone: str)` where `tone` is `"working" | "held" | "failed" | "plain"`; `build_queue(issues, prs, runs, cfg, now, branch_ahead: dict[str, int], spec_exists: Callable[[int], bool]) -> list[Row]`; `branch_name(n: int) -> str`.

- [ ] **Step 1: Write the failing tests**

`dash/tests/test_queue.py`:

```python
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sandcastle_dash.config import TemplateConfig, parse_config
from sandcastle_dash.gh import Pr, parse_issues
from sandcastle_dash.logs import Run
from sandcastle_dash.queue import build_queue, held_agents, required_tier

FIXTURES = Path(__file__).parent / "fixtures"
UTC = timezone.utc
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)
CFG = parse_config((FIXTURES / "config.mts").read_text())
ALL_HARD = TemplateConfig(CFG.tiers, {k: "hard" for k in CFG.agent_tiers or {}}, "issue-specs")


def _run(issue: str, role: str, status: str, when: datetime = NOW) -> Run:
    return Run(f"sandcastle-issue-{issue}-{role}.log", 0, role, "issue", issue, status, when, when, 1, None, None, "", when, None, "")


def test_required_tier_prefers_the_strongest_label() -> None:
    assert required_tier(("sandcastle",), CFG.tiers) == "normal"
    assert required_tier(("sandcastle:effort-hard", "sandcastle:effort-normal"), CFG.tiers) == "hard"
    assert required_tier(("sandcastle:effort-hard",), None) == "hard"
    assert required_tier(("sandcastle",), None) is None


def test_held_agents_names_the_short_ones() -> None:
    assert held_agents("hard", CFG, pr_flag=False) == ["reviewer", "merger", "conflict-resolver"]
    assert held_agents("hard", CFG, pr_flag=True) == ["reviewer", "merger", "conflict-resolver", "pr-reviewer", "addresser"]
    assert held_agents("normal", CFG, pr_flag=False) == []
    assert held_agents("hard", TemplateConfig(None, None, None), pr_flag=False) is None


def test_build_queue_stages_and_order() -> None:
    issues = parse_issues((FIXTURES / "issues.json").read_text())
    prs = [Pr(9, "Queue #310", "OPEN", "sandcastle/issue-310", False, ("sandcastle:ready",), (310,))]
    rows = build_queue(issues, prs, [], CFG, NOW, {}, lambda n: False)
    by = {r.number: r for r in rows}
    assert [r.number for r in rows] == [301, 300, 310]  # held first, then by number
    assert by[301].stage == "held" and by[301].tone == "held" and "reviewer" in by[301].detail
    assert by[301].depth == 1 and by[300].depth == 0
    assert by[300].stage == "prd" and by[300].detail == "1/2 open"
    assert by[310].stage == "PR ready" and by[310].flags == ("pr",)
    assert 302 not in by  # closed sub-issue never listed


def test_build_queue_working_beats_everything_and_failures_show() -> None:
    issues = parse_issues((FIXTURES / "issues.json").read_text())
    runs = [_run("310", "implementer", "running"), _run("301", "spec-writer", "failed", NOW - timedelta(minutes=5))]
    rows = build_queue(issues, [], runs, ALL_HARD, NOW, {"sandcastle/issue-301": 2}, lambda n: n == 301)
    by = {r.number: r for r in rows}
    assert rows[0].number == 310 and rows[0].stage == "working implementer" and rows[0].tone == "working"
    assert by[301].stage == "implemented" and by[301].detail == "2 commits · ✗ spec-writer" and by[301].tone == "failed"


def test_build_queue_spec_and_ready_to_merge() -> None:
    issues = parse_issues((FIXTURES / "issues.json").read_text())
    rows = build_queue(issues, [], [], ALL_HARD, NOW, {}, lambda n: n == 310)
    by = {r.number: r for r in rows}
    assert by[310].stage == "spec'd"
    marked = [i for i in issues if i.number != 310] + [
        type(issues[0])(310, "x", "OPEN", "", NOW, NOW, ("sandcastle", "sandcastle:ready-to-merge"), None, ())
    ]
    assert {r.number: r for r in build_queue(marked, [], [], ALL_HARD, NOW, {}, lambda n: False)}[310].stage == "ready to merge"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dash && uv run pytest tests/test_queue.py -q`
Expected: ImportError.

- [ ] **Step 3: Implement**

`dash/src/sandcastle_dash/queue.py`:

```python
"""The issue queue: every open trigger-labeled issue with its effort tier
and the one stage that explains what it is waiting on. Pure."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sandcastle_dash.config import TemplateConfig
from sandcastle_dash.gh import Issue, Pr
from sandcastle_dash.logs import Run

TRIGGER = "sandcastle"
PRD_LABEL = "sandcastle:requires-prd"
EFFORT_PREFIX = "sandcastle:effort-"
ISSUE_PATH = ("spec-writer", "implementer", "reviewer", "merger", "conflict-resolver")
PR_PATH = ("pr-reviewer", "addresser")
_PR_STATUS = ("sandcastle:in-review", "sandcastle:ready", "sandcastle:needs-decision")


@dataclass(frozen=True)
class Row:
    number: int
    title: str
    tier: str
    flags: tuple[str, ...]
    age: timedelta
    stage: str
    detail: str
    depth: int
    tone: str  # working | held | failed | plain


def branch_name(n: int) -> str:
    return f"sandcastle/issue-{n}"


def required_tier(labels: tuple[str, ...], tiers: tuple[tuple[str, str], ...] | None) -> str | None:
    names = [t[0] for t in tiers] if tiers else None
    best: str | None = None
    for label in labels:
        if not label.startswith(EFFORT_PREFIX):
            continue
        tier = label[len(EFFORT_PREFIX) :]
        if names is None:
            best = tier if best is None else best
        elif tier in names and (best is None or names.index(tier) > names.index(best)):
            best = tier
    if best is None and names:
        return names[0]
    return best


def held_agents(required: str | None, cfg: TemplateConfig, pr_flag: bool) -> list[str] | None:
    if required is None or cfg.tiers is None or cfg.agent_tiers is None:
        return None
    names = [t[0] for t in cfg.tiers]
    if required not in names:
        return None
    needed = names.index(required)
    short: list[str] = []
    for role in ISSUE_PATH + (PR_PATH if pr_flag else ()):
        tier = cfg.agent_tiers.get(role, names[0])
        if tier not in names or names.index(tier) < needed:
            short.append(role)
    return short


def _flags(labels: tuple[str, ...]) -> tuple[str, ...]:
    flags: list[str] = []
    if "sandcastle:require-pr" in labels or "sandcastle:agent-approve" in labels:
        flags.append("pr")
    if PRD_LABEL in labels:
        flags.append("prd")
    if "sandcastle:release" in labels:
        flags.append("release")
    return tuple(flags)


def _stage(
    issue: Issue,
    prs: list[Pr],
    runs: list[Run],
    cfg: TemplateConfig,
    branch_ahead: dict[str, int],
    spec_exists: Callable[[int], bool],
) -> tuple[str, str, str]:
    """(stage, detail, tone) for one issue."""
    n = issue.number
    key = str(n)
    mine = [r for r in runs if r.issue == key]
    failed = next((r for r in sorted(mine, key=lambda r: r.last_activity, reverse=True) if r.status in ("failed", "interrupted")), None)
    fail_note = f"✗ {failed.role}" if failed and failed.status == "failed" else ""

    def done(stage: str, detail: str = "", tone: str = "plain") -> tuple[str, str, str]:
        if fail_note:
            detail = f"{detail} · {fail_note}" if detail else fail_note
            tone = "failed" if tone == "plain" else tone
        return stage, detail, tone

    short = held_agents(required_tier(issue.labels, cfg.tiers), cfg, "pr" in _flags(issue.labels))
    if short:
        return done("held", ", ".join(short) + " below tier", "held")
    running = next((r for r in mine if r.status == "running"), None)
    if running:
        return done(f"working {running.role}", running.iteration or "", "working")
    if "sandcastle:ready-to-merge" in issue.labels:
        return done("ready to merge")
    pr = next((p for p in prs if p.state == "OPEN" and n in p.linked), None)
    if pr:
        status = next((l.split(":", 1)[1] for l in pr.labels if l in _PR_STATUS), None)
        if "sandcastle:approved" in pr.labels:
            status = "approved"
        return done(f"PR {status or 'open'}", f"#{pr.number}")
    ahead = branch_ahead.get(branch_name(n), 0)
    if ahead > 0:
        return done("implemented", f"{ahead} commit{'s' if ahead != 1 else ''}")
    if spec_exists(n):
        return done("spec'd")
    return done("queued")


def build_queue(
    issues: list[Issue],
    prs: list[Pr],
    runs: list[Run],
    cfg: TemplateConfig,
    now: datetime,
    branch_ahead: dict[str, int],
    spec_exists: Callable[[int], bool],
) -> list[Row]:
    open_by = {i.number: i for i in issues if i.state == "OPEN"}
    trigger = [i for i in open_by.values() if TRIGGER in i.labels]
    rows: list[Row] = []

    def row(issue: Issue, depth: int, stage: str, detail: str, tone: str) -> Row:
        return Row(
            number=issue.number,
            title=issue.title,
            tier=required_tier(issue.labels, cfg.tiers) or "—",
            flags=_flags(issue.labels),
            age=now - issue.created,
            stage=stage,
            detail=detail,
            depth=depth,
            tone=tone,
        )

    parents = [i for i in trigger if PRD_LABEL in i.labels]
    child_numbers = {c for p in parents for c in p.sub_issues}
    for issue in trigger:
        if issue.number in child_numbers and issue.parent in open_by:
            continue  # rendered under its parent
        if PRD_LABEL in issue.labels:
            open_children = [open_by[c] for c in issue.sub_issues if c in open_by]
            rows.append(row(issue, 0, "prd", f"{len(open_children)}/{len(issue.sub_issues)} open", "plain"))
            for child in sorted(open_children, key=lambda c: c.number):
                rows.append(row(child, 1, *_stage(child, prs, runs, cfg, branch_ahead, spec_exists)))
            continue
        rows.append(row(issue, 0, *_stage(issue, prs, runs, cfg, branch_ahead, spec_exists)))

    rank = {"working": 0, "held": 1}

    def key(r: Row) -> tuple[int, int]:
        return (rank.get(r.tone, 2), r.number)

    # Keep children directly under their parent: sort parents' groups as units.
    groups: list[list[Row]] = []
    for r in rows:
        if r.depth == 0:
            groups.append([r])
        else:
            groups[-1].append(r)
    groups.sort(key=lambda g: min(key(r) for r in g))
    return [r for g in groups for r in g]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dash && uv run pytest tests/test_queue.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add dash/src/sandcastle_dash/queue.py dash/tests/test_queue.py
git commit -m "dash: issue queue stages and ordering (prd/010 Req 12-14)"
```

---

### Task 8: Stats (`stats.py`)

**Files:**

- Create: `dash/src/sandcastle_dash/stats.py`
- Test: `dash/tests/test_stats.py`

**Interfaces:**

- Consumes: `logs.Timing`, `logs.Run`, `gh.Merge`, `breakdown.run_breakdown`.
- Produces: `@dataclass(frozen=True) PhaseStat(phase: str, runs: int, ok: int, median_ms: int, max_ms: int)`; `phase_stats(timings, now, days=7) -> list[PhaseStat]` (by runs desc); `category_totals(runs, now, hours=24) -> dict[str, float]`; `@dataclass(frozen=True) Day(date: date, runs: int, merged: int)`; `per_day(timings, merges, now, days=7) -> list[Day]` (oldest first, local dates).

- [ ] **Step 1: Write the failing tests**

`dash/tests/test_stats.py`:

```python
from datetime import datetime, timedelta, timezone

from sandcastle_dash.gh import Merge
from sandcastle_dash.logs import Run, Timing
from sandcastle_dash.stats import category_totals, per_day, phase_stats

UTC = timezone.utc
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)


def _t(phase: str, ms: int, ok: bool, ago: timedelta) -> Timing:
    return Timing(NOW - ago, phase, ms, ok, None)


def test_phase_stats_median_max_and_window() -> None:
    timings = [
        _t("implementer", 100, True, timedelta(hours=1)),
        _t("implementer", 300, False, timedelta(hours=2)),
        _t("implementer", 200, True, timedelta(days=2)),
        _t("implementer", 999, True, timedelta(days=8)),  # outside 7d
        _t("planner", 50, True, timedelta(hours=1)),
    ]
    stats = phase_stats(timings, NOW)
    assert [s.phase for s in stats] == ["implementer", "planner"]
    impl = stats[0]
    assert (impl.runs, impl.ok, impl.median_ms, impl.max_ms) == (3, 2, 200, 300)


def test_category_totals_only_counts_recent_runs() -> None:
    text = "[10:00:00] Edit(a)\n[10:00:10] Bash(npm run typecheck)\n[10:00:40] Run complete: x\n"
    recent = Run("a.log", 0, "implementer", "issue", "1", "success", NOW - timedelta(hours=1), NOW, 1, None, None, "", NOW - timedelta(hours=1), None, text)
    old = Run("b.log", 0, "implementer", "issue", "2", "success", NOW - timedelta(days=2), NOW, 1, None, None, "", NOW - timedelta(days=2), None, text)
    totals = category_totals([recent, old], NOW)
    assert totals["edit"] == 10 and totals["verify"] == 30


def test_per_day_counts_runs_and_merges() -> None:
    timings = [_t("planner", 1, True, timedelta(hours=1)), _t("merger", 1, True, timedelta(days=1, hours=1))]
    merges = [Merge(NOW - timedelta(hours=2), (1, 2), "merge issues #1 #2"), Merge(NOW - timedelta(days=9), (3,), "old")]
    days = per_day(timings, merges, NOW)
    assert len(days) == 7
    assert days[-1].runs == 1 and days[-1].merged == 2
    assert days[-2].runs == 1 and days[-2].merged == 0
    assert days[0].date < days[-1].date
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dash && uv run pytest tests/test_stats.py -q`
Expected: ImportError.

- [ ] **Step 3: Implement**

`dash/src/sandcastle_dash/stats.py`:

```python
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


def per_day(timings: list[Timing], merges: list[Merge], now: datetime, days: int = 7) -> list[Day]:
    today = now.astimezone().date()
    window = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
    started: Counter[date] = Counter()
    for t in timings:
        started[(t.ts - timedelta(milliseconds=t.ms)).astimezone().date()] += 1
    merged: Counter[date] = Counter()
    for m in merges:
        merged[m.ts.astimezone().date()] += len(m.issues)
    return [Day(d, started[d], merged[d]) for d in window]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dash && uv run pytest tests/test_stats.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add dash/src/sandcastle_dash/stats.py dash/tests/test_stats.py
git commit -m "dash: phase, category and per-day stats (prd/010 Req 15)"
```

---

### Task 9: Panels, snapshot, and the Textual app (`panels.py`, `snapshot.py`, `app.py`)

**Files:**

- Create: `dash/src/sandcastle_dash/panels.py` (Rich renderables, pure given data), `dash/src/sandcastle_dash/snapshot.py`, `dash/src/sandcastle_dash/app.py`
- Test: `dash/tests/test_panels.py`

**Interfaces:**

- Consumes: everything above.
- Produces in `panels.py`: `now_table(state: LoopState, runs: list[Run], now: datetime) -> tuple[RenderableType, str]` (renderable, title summary); `runs_table(runs, now, hours=24, limit=40) -> tuple[RenderableType, str]`; `queue_table(rows: list[Row]) -> tuple[RenderableType, str]`; `stats_view(phases: list[PhaseStat], totals: dict[str, float], days: list[Day]) -> tuple[RenderableType, str]`. Each summary is the short text for the Collapsible title (e.g. `2 running`, `12 runs · 1 failed`, `9 queued · 3 held`, `41 runs · 90% ok`).
- `snapshot.py`: `snapshot_text(state, runs, rows, now, repo: Path | None) -> str`.
- `app.py`: `class DashApp(App)` with `repo: Path | None`; `main() -> None`.

- [ ] **Step 1: Write the failing tests**

`dash/tests/test_panels.py`:

```python
from datetime import datetime, timedelta, timezone
from pathlib import Path

from rich.console import Console

from sandcastle_dash.config import parse_config
from sandcastle_dash.gh import parse_issues
from sandcastle_dash.logs import load_runs
from sandcastle_dash.orchestrator import LoopProcess, derive_state
from sandcastle_dash.panels import now_table, queue_table, runs_table, stats_view
from sandcastle_dash.queue import build_queue
from sandcastle_dash.snapshot import snapshot_text
from sandcastle_dash.stats import Day, PhaseStat

FIXTURES = Path(__file__).parent / "fixtures"
UTC = timezone.utc


def _render(renderable) -> str:
    console = Console(record=True, width=120, file=open("/dev/null", "w"))
    console.print(renderable)
    return console.export_text()


def _runs(tmp_path: Path):
    import os
    import shutil

    for name in ("sandcastle-issue-31-implementer.log", "main-planner.log", "timings.jsonl"):
        shutil.copy(FIXTURES / "logs" / name, tmp_path / name)
    os.utime(tmp_path / "sandcastle-issue-31-implementer.log")  # fresh → last block running
    return load_runs(tmp_path, now=datetime.now(UTC))


def test_now_table_lists_running_agents(tmp_path: Path) -> None:
    runs = _runs(tmp_path)
    now = datetime.now(UTC)
    state = derive_state(LoopProcess(1, now - timedelta(hours=3)), runs)
    renderable, summary = now_table(state, runs, now)
    text = _render(renderable)
    assert summary == "running · 1 agent"
    assert "implementer" in text and "#31" in text and "Iteration 2/4" in text
    assert "sandcastle-issue-31-implementer.log" in text


def test_now_table_idle(tmp_path: Path) -> None:
    runs = _runs(tmp_path)
    _, summary = now_table(derive_state(None, runs), runs, datetime.now(UTC))
    assert summary == "idle"


def test_runs_table_counts_and_shows_errors(tmp_path: Path) -> None:
    runs = _runs(tmp_path)
    now = datetime(2026, 9, 6, 19, 30, tzinfo=UTC)
    renderable, summary = runs_table(runs, now)
    text = _render(renderable)
    assert summary == "3 runs · 1 failed"
    assert "Git worktree operation failed" in text


def test_queue_table_summarises_held() -> None:
    cfg = parse_config((FIXTURES / "config.mts").read_text())
    rows = build_queue(parse_issues((FIXTURES / "issues.json").read_text()), [], [], cfg, datetime(2026, 9, 6, 12, 0, tzinfo=UTC), {}, lambda n: False)
    renderable, summary = queue_table(rows)
    text = _render(renderable)
    assert summary == "3 open · 1 held"
    assert "#301" in text and "held" in text and "  └ " in text


def test_stats_view_renders_everything() -> None:
    renderable, summary = stats_view(
        [PhaseStat("implementer", 10, 9, 120_000, 400_000)],
        {"verify": 100, "edit": 50, "explore": 0, "git": 0, "think": 50, "other": 0},
        [Day(datetime(2026, 9, 6).date(), 3, 2)],
    )
    text = _render(renderable)
    assert summary == "10 runs · 90% ok"
    assert "implementer" in text and "2m 00s" in text and "tests / verify" in text


def test_snapshot_text_is_plain(tmp_path: Path) -> None:
    runs = _runs(tmp_path)
    text = snapshot_text(derive_state(None, runs), runs, [], datetime.now(UTC), tmp_path)
    assert "idle" in text and "Recent runs" in text and "Issue queue" in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dash && uv run pytest tests/test_panels.py -q`
Expected: ImportError.

- [ ] **Step 3: Implement `panels.py`**

```python
"""Rich renderables for the four sections. Pure given the data; the app
and the --once snapshot both use them."""

from __future__ import annotations

from datetime import datetime, timedelta

from rich.console import Group, RenderableType
from rich.table import Table
from rich.text import Text

from sandcastle_dash.breakdown import CATEGORIES
from sandcastle_dash.format import GRUVBOX, STATUS_GLYPH, fmt_ago, fmt_clock, fmt_duration, segment_bar, status_style
from sandcastle_dash.logs import Run
from sandcastle_dash.orchestrator import LoopState
from sandcastle_dash.queue import Row
from sandcastle_dash.stats import Day, PhaseStat

_CAT_COLOR = {
    "verify": GRUVBOX["green"],
    "edit": GRUVBOX["yellow"],
    "explore": GRUVBOX["blue"],
    "git": GRUVBOX["purple"],
    "think": GRUVBOX["orange"],
    "other": GRUVBOX["gray"],
}
_TONE = {"working": GRUVBOX["green"], "held": GRUVBOX["yellow"], "failed": GRUVBOX["red"], "plain": ""}


def _issue_label(run: Run) -> str:
    return f"#{run.issue}" if run.issue else run.scope


def now_table(state: LoopState, runs: list[Run], now: datetime) -> tuple[RenderableType, str]:
    running = [r for r in runs if r.status == "running"]
    head = Text()
    if state.running:
        head.append("● running", style=f"bold {GRUVBOX['green']}")
        head.append(f" · iteration {state.iteration} · since {fmt_clock(state.started)} ({fmt_ago(state.started, now)})", style="dim")
        summary = f"running · {len(running)} agent{'s' if len(running) != 1 else ''}"
    else:
        head.append("○ idle", style=f"bold {GRUVBOX['gray']}")
        last = state.last_run
        if last:
            head.append(
                f" · last run {last.role} {_issue_label(last)} {last.status} {fmt_ago(last.last_activity, now)}", style="dim"
            )
        summary = "idle"
    parts: list[RenderableType] = [head]
    if running:
        table = Table.grid(padding=(0, 2))
        table.add_column(style="bold")
        table.add_column()
        table.add_column(justify="right")
        table.add_column()
        table.add_column(justify="right")
        table.add_column(style="dim", overflow="ellipsis", no_wrap=True)
        table.add_row("agent", "issue", "elapsed", "attempt", "ctx", "last line")
        for run in running:
            table.add_row(
                Text(run.role, style=GRUVBOX["aqua"]),
                _issue_label(run),
                fmt_duration((now - run.started).total_seconds() * 1000) if run.started else "—",
                run.iteration or "—",
                run.context_window or "—",
                run.last_line,
            )
        parts.append(table)
        for run in running:
            if run.path:
                parts.append(Text(f"  tail -f {run.path}", style="dim"))
    elif state.running:
        parts.append(Text("  no agent in flight (between phases)", style="dim"))
    return Group(*parts), summary


def runs_table(runs: list[Run], now: datetime, hours: int = 24, limit: int = 40) -> tuple[RenderableType, str]:
    since = now - timedelta(hours=hours)
    recent = [r for r in runs if r.last_activity >= since][:limit]
    failed = sum(1 for r in recent if r.status == "failed")
    summary = f"{len(recent)} runs" + (f" · {failed} failed" if failed else "")
    if not recent:
        return Text("  nothing in the last 24h", style="dim"), summary
    table = Table.grid(padding=(0, 2))
    table.add_column()
    table.add_column(style="bold")
    table.add_column()
    table.add_column(justify="right")
    table.add_column(justify="right")
    table.add_column(overflow="ellipsis", no_wrap=True)
    table.add_row("", "agent", "issue", "started", "took", "")
    for run in recent:
        style = status_style(run.status)
        note = Text(run.error or "", style=GRUVBOX["red"]) if run.status == "failed" else Text(run.iteration or "", style="dim")
        table.add_row(
            Text(STATUS_GLYPH.get(run.status, "?"), style=style),
            run.role,
            _issue_label(run),
            fmt_clock(run.started),
            fmt_duration(run.duration_ms) if run.status != "running" else Text("running", style=style),
            note,
        )
    return table, summary


def queue_table(rows: list[Row]) -> tuple[RenderableType, str]:
    held = sum(1 for r in rows if r.tone == "held")
    summary = f"{len(rows)} open" + (f" · {held} held" if held else "")
    if not rows:
        return Text("  no open issues labeled sandcastle", style="dim"), summary
    table = Table.grid(padding=(0, 2))
    table.add_column(justify="right")
    table.add_column(overflow="ellipsis", no_wrap=True, max_width=60)
    table.add_column()
    table.add_column()
    table.add_column(justify="right", style="dim")
    table.add_column()
    table.add_column(style="dim", overflow="ellipsis", no_wrap=True)
    table.add_row("#", "title", "tier", "flags", "age", "stage", "")
    for r in rows:
        tone = _TONE[r.tone]
        prefix = "  └ " if r.depth else ""
        table.add_row(
            Text(f"#{r.number}", style="bold"),
            Text(prefix + r.title, style=tone),
            r.tier,
            " ".join(r.flags),
            fmt_ago(datetime.now(tz=None).astimezone() - r.age, datetime.now(tz=None).astimezone()).replace(" ago", ""),
            Text(r.stage, style=tone),
            r.detail,
        )
    return table, summary


def stats_view(phases: list[PhaseStat], totals: dict[str, float], days: list[Day]) -> tuple[RenderableType, str]:
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
        table.add_row(p.phase, str(p.runs), Text(f"{pct}%", style=GRUVBOX["green"] if pct >= 80 else GRUVBOX["yellow"]), fmt_duration(p.median_ms), fmt_duration(p.max_ms))
    parts.append(table)

    total = sum(totals.values())
    bar_parts = [(k, 100 * totals[k] / total if total else 0, _CAT_COLOR[k]) for k, _ in CATEGORIES if totals.get(k, 0) > 0]
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
```

- [ ] **Step 4: Implement `snapshot.py`**

```python
"""One-shot plain-text report for `sandcastle-dash --once`."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from rich.console import Console

from sandcastle_dash.logs import Run
from sandcastle_dash.orchestrator import LoopState
from sandcastle_dash.panels import now_table, queue_table, runs_table
from sandcastle_dash.queue import Row


def snapshot_text(state: LoopState, runs: list[Run], rows: list[Row], now: datetime, repo: Path | None) -> str:
    console = Console(record=True, width=110, file=open("/dev/null", "w"))
    console.print(f"[dim]sandcastle-dash · {repo or 'no .sandcastle/logs found'} · {now.astimezone():%H:%M:%S}[/]")
    for title, (renderable, summary) in (
        ("Now", now_table(state, runs, now)),
        ("Recent runs (24h)", runs_table(runs, now)),
        ("Issue queue", queue_table(rows)),
    ):
        console.print(f"\n[bold]{title}[/] · {summary}")
        console.print(renderable)
    return console.export_text()
```

- [ ] **Step 5: Implement `app.py`**

```python
"""The Textual app: four collapsible sections, each refreshed by its own
timer in a worker thread. Loading never raises into the UI — a failed
source keeps its last content and names the error in the section title."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path

from rich.console import RenderableType
from rich.text import Text
from textual.app import App, ComposeResult
from textual.containers import VerticalScroll
from textual.widgets import Collapsible, Footer, Static

from sandcastle_dash import gh
from sandcastle_dash.config import TemplateConfig, load_config
from sandcastle_dash.logs import Run, load_runs, read_timings
from sandcastle_dash.orchestrator import LoopState, derive_state, find_loop_process
from sandcastle_dash.panels import now_table, queue_table, runs_table, stats_view
from sandcastle_dash.queue import Row, branch_name, build_queue
from sandcastle_dash.repo import find_repo, logs_dir
from sandcastle_dash.snapshot import snapshot_text
from sandcastle_dash.stats import category_totals, per_day, phase_stats

SECTIONS = [
    ("now", "Now", 5),
    ("runs", "Recent runs (24h)", 5),
    ("queue", "Issue queue", 45),
    ("stats", "Stats (7d)", 120),
]


@dataclass
class GhState:
    """Last good GitHub/git values, kept across failures (Req 10)."""

    issues: list[gh.Issue] = field(default_factory=list)
    prs: list[gh.Pr] = field(default_factory=list)
    merges: list[gh.Merge] = field(default_factory=list)
    error: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def load_queue_rows(repo: Path | None, runs: list[Run], cfg: TemplateConfig, state: GhState, now: datetime) -> list[Row]:
    if repo is None:
        return []
    try:
        state.issues = gh.fetch_issues(repo)
        state.prs = gh.fetch_prs(repo)
        state.error = None
    except gh.SourceError as exc:
        state.error = str(exc)
    base = gh.default_branch(repo)
    open_numbers = [i.number for i in state.issues if i.state == "OPEN"]
    ahead = gh.branch_commit_counts(repo, base, [branch_name(n) for n in open_numbers])
    spec_dir = repo / (cfg.spec_dir or "issue-specs")
    return build_queue(state.issues, state.prs, runs, cfg, now, ahead, lambda n: (spec_dir / f"issue-{n}.md").exists())


class Panel(Static):
    def show(self, renderable: RenderableType) -> None:
        self.update(renderable)


class DashApp(App):
    TITLE = "Sandcastle"
    BINDINGS = [("escape", "quit", "Quit"), ("q", "quit", "Quit"), ("r", "refresh", "Refresh")] + [
        (str(i + 1), f"toggle('{cid}')", title.split(" (")[0]) for i, (cid, title, _) in enumerate(SECTIONS)
    ]
    CSS = """
    Screen { padding: 0 1; background: #1d2021; }
    VerticalScroll { background: #1d2021; }
    Collapsible { border: none; background: #282828; margin-bottom: 1; }
    CollapsibleTitle { color: $accent; text-style: bold; }
    Contents Static { padding: 0 2 1 2; height: auto; }
    """

    def __init__(self, repo: Path | None) -> None:
        super().__init__()
        self.repo = repo
        self._cfg = load_config(repo) if repo else TemplateConfig(None, None, None)
        self._gh = GhState()
        self._runs: list[Run] = []

    def compose(self) -> ComposeResult:
        with VerticalScroll():
            for cid, title, _ in SECTIONS:
                with Collapsible(title=title, collapsed=(cid == "stats"), id=f"sec-{cid}"):
                    yield Panel(id=f"panel-{cid}")
        yield Footer()

    def on_mount(self) -> None:
        self.theme = "gruvbox"
        self.sub_title = str(self.repo) if self.repo else "no .sandcastle/logs found — pass --repo"
        self.refresh_live()
        self.refresh_queue()
        self.refresh_stats()
        self.set_interval(5, self.refresh_live)
        self.set_interval(45, self.refresh_queue)
        self.set_interval(120, self.refresh_stats)

    # ---- bindings -------------------------------------------------------
    def action_toggle(self, cid: str) -> None:
        section = self.query_one(f"#sec-{cid}", Collapsible)
        section.collapsed = not section.collapsed

    def action_refresh(self) -> None:
        self._cfg = load_config(self.repo) if self.repo else self._cfg
        self.refresh_live()
        self.refresh_queue()
        self.refresh_stats()

    # ---- workers ---------------------------------------------------------
    def refresh_live(self) -> None:
        self.run_worker(self._load_live, thread=True, exclusive=True, group="live")

    def refresh_queue(self) -> None:
        self.run_worker(self._load_queue, thread=True, exclusive=True, group="queue")

    def refresh_stats(self) -> None:
        self.run_worker(self._load_stats, thread=True, exclusive=True, group="stats")

    def _stamp(self, cid: str, summary: str, error: str | None = None) -> None:
        base = next(title for c, title, _ in SECTIONS if c == cid)
        parts = [base, summary, f"updated {datetime.now().astimezone():%H:%M:%S}"]
        if error:
            parts.append(error)
        self.query_one(f"#sec-{cid}", Collapsible).title = " · ".join(p for p in parts if p)

    def _show(self, cid: str, renderable: RenderableType, summary: str, error: str | None = None) -> None:
        self.query_one(f"#panel-{cid}", Panel).show(renderable)
        self._stamp(cid, summary, error)

    def _load_live(self) -> None:
        now = _now()
        runs = load_runs(logs_dir(self.repo), now) if self.repo else []
        self._runs = runs
        state = derive_state(find_loop_process(now), runs)
        error = None if self.repo else "no .sandcastle/logs under the current directory"
        table, summary = now_table(state, runs, now)
        self.call_from_thread(self._show, "now", table, summary, error)
        table, summary = runs_table(runs, now)
        self.call_from_thread(self._show, "runs", table, summary)

    def _load_queue(self) -> None:
        now = _now()
        rows = load_queue_rows(self.repo, self._runs, self._cfg, self._gh, now)
        table, summary = queue_table(rows)
        self.call_from_thread(self._show, "queue", table, summary, self._gh.error)

    def _load_stats(self) -> None:
        now = _now()
        if not self.repo:
            self.call_from_thread(self._show, "stats", Text("  no repo", style="dim"), "")
            return
        timings = read_timings(logs_dir(self.repo) / "timings.jsonl")
        try:
            self._gh.merges = gh.fetch_merges(self.repo, gh.default_branch(self.repo))
            error = None
        except gh.SourceError as exc:
            error = str(exc)
        runs = self._runs or load_runs(logs_dir(self.repo), now)
        view, summary = stats_view(phase_stats(timings, now), category_totals(runs, now), per_day(timings, self._gh.merges, now))
        self.call_from_thread(self._show, "stats", view, summary, error)


def run_once(repo: Path | None) -> None:
    now = _now()
    runs = load_runs(logs_dir(repo), now) if repo else []
    state = derive_state(find_loop_process(now), runs)
    cfg = load_config(repo) if repo else TemplateConfig(None, None, None)
    rows = load_queue_rows(repo, runs, cfg, GhState(), now)
    print(snapshot_text(state, runs, rows, now, repo), end="")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="sandcastle-dash",
        description="Terminal dashboard for the Sandcastle goal-template loop: live agents, recent runs, "
        "issue queue, 7-day stats. Reads .sandcastle/logs plus gh/git from the local checkout. "
        "Esc/q quits, r refreshes, 1-4 toggle sections.",
    )
    parser.add_argument("--repo", type=Path, help="repository checkout to watch (default: walk up from the cwd)")
    parser.add_argument("--once", action="store_true", help="print a one-shot snapshot to stdout and exit")
    parser.add_argument("--version", action="version", version=f"%(prog)s {version('sandcastle-dash')}")
    args = parser.parse_args()
    repo = find_repo(args.repo) if args.repo else find_repo()
    if args.once:
        run_once(repo)
    else:
        DashApp(repo).run()


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run all tests**

Run: `cd dash && uv run pytest -q`
Expected: all pass (~43 tests).

- [ ] **Step 7: Smoke-run against a real checkout**

Run: `cd dash && uv run sandcastle-dash --repo ~/src/marky-mark --once | head -40` — expect a Now line, the recent runs table and the queue. Then `uv run sandcastle-dash --repo ~/src/marky-mark` interactively: sections render, `1`-`4` toggle, `r` refreshes, `q` quits.

- [ ] **Step 8: Commit**

```bash
git add dash/src/sandcastle_dash/panels.py dash/src/sandcastle_dash/snapshot.py dash/src/sandcastle_dash/app.py dash/tests/test_panels.py
git commit -m "dash: panels, --once snapshot and the Textual app (prd/010 Req 16-22)"
```

---

### Task 10: README, fork docs, install

**Files:**

- Create: `dash/README.md`
- Modify: `README-FORK.md` (new top section), `FORK-MANUAL.md` (cheat sheet line)

- [ ] **Step 1: Write `dash/README.md`**

````markdown
# sandcastle-dash

A gruvbox-themed terminal dashboard for the Sandcastle goal-template loop.
One screen, four collapsible sections, auto-refreshing. It answers three
questions at a glance: _what is running right now, what just finished and
how did it go, and what is queued and why is it waiting._

## Sections

| Key | Section               | Shows                                                                                                                                        | Refresh |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `1` | **Now**               | Whether the loop is running (iteration, since when) and every agent in flight: role, issue, elapsed, attempt, context window, last log line. | 5 s     |
| `2` | **Recent runs (24h)** | Every agent run of the last day: outcome, role, issue, start, duration, and the error line for failures.                                     | 5 s     |
| `3` | **Issue queue**       | Open `sandcastle` issues with effort tier, flags, age and stage: held, working, ready to merge, PR status, implemented, spec'd, queued.      | 45 s    |
| `4` | **Stats (7d)**        | Per-phase runs, success rate, median and max; where agent time went in the last 24 h; runs and merges per day. Collapsed by default.         | 120 s   |

Other keys: **Esc**/`q` quit · `r` refresh everything now.

## Install

Requires Python ≥ 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
uv tool install --editable ./dash      # from the sandcastle checkout
sandcastle-dash                        # inside any repo with .sandcastle/logs
sandcastle-dash --repo ~/src/my-app    # or point it somewhere
sandcastle-dash --once                 # plain-text snapshot, script friendly
```
````

## Data sources

- **Runs** are parsed from `.sandcastle/logs/*.log` (`--- Run started ---`
  blocks; the file name gives role and issue) and matched to
  `timings.jsonl`, the loop's authority on outcome and duration. A block
  with no outcome whose file changed in the last three minutes is
  _running_; older ones are _interrupted_.
- **The loop** is a `tsx .sandcastle/main.ts` process; `ps` gives its
  start time and planner runs since then count iterations.
- **Issues and PRs** come from `gh` (one GraphQL query for issues with
  sub-issues; `gh pr list`); merges from `git log`. A failed call keeps the
  last good value and names the error in the section title.
- **Effort tiers** are read from `.sandcastle/config.mts` by regex
  (`EFFORT_TIERS`, `AGENT_TIERS`, `SPEC_DIR`); the file is never executed.

Everything is local. Nothing leaves the machine except the `gh` calls you
already make.

## Not here on purpose

No start/stop of the loop, no log viewer (each live agent prints a
`tail -f` line), no remote mode (ssh in and run it there).

## Develop

```bash
cd dash && uv run pytest -q
uv run sandcastle-dash --repo ~/src/some-repo
```

Layered like `claude-usage-tui`: `logs.py` / `config.py` / `gh.py` parse,
`breakdown.py` / `orchestrator.py` / `queue.py` / `stats.py` analyse (all
pure, all unit-tested over `tests/fixtures/`), `panels.py` renders,
`app.py` is the Textual shell and `snapshot.py` the `--once` output.

````

- [ ] **Step 2: Add the README-FORK.md section** — insert right after the intro paragraph (before the first `## ` heading):

```markdown
## Terminal dashboard: `sandcastle-dash` (`feat/dash`)

Implements prd/010. A Python/Textual TUI under `dash/`, installed with
`uv tool install --editable ./dash`, that watches a goal-template checkout
from the terminal: the running loop and its agents, the last 24 h of runs
with outcomes and errors, the issue queue with effort tiers and a stage per
issue, and 7-day stats. Read-only, local files plus `gh`/`git`; the
TypeScript library is untouched. See `dash/README.md`.
````

- [ ] **Step 3: Add the FORK-MANUAL.md cheat-sheet line** — find the cheat sheet section (`grep -n "cheat" FORK-MANUAL.md`) and add one bullet: `` `sandcastle-dash` — terminal dashboard: what's running, what just ran, what's queued (`dash/README.md`). ``

- [ ] **Step 4: Install and verify**

Run: `cd ~/src/sandcastle && uv tool install --editable ./dash && cd ~/src/marky-mark && sandcastle-dash --once | head -30`
Expected: the snapshot prints from the marky-mark checkout.

- [ ] **Step 5: Commit**

```bash
git add dash/README.md README-FORK.md FORK-MANUAL.md
git commit -m "dash: README, fork docs (prd/010 Req 23-25)"
```

---

## Self-review

- **Spec coverage:** Req 1 → Task 1 + app `find_repo`/`--repo`; Req 2–6 → Task 2; Req 7 → Task 3; Req 8 → Task 4; Req 9–10 → Task 5 + `GhState` in Task 9; Req 11 → Task 6; Req 12–14 → Task 7; Req 15 → Task 8; Req 16–21 → Task 9 (`app.py`, `panels.py`); Req 22 → Task 9 (`snapshot.py`, `--once`, `--version`); Req 23 → Task 1; Req 24 → fixtures in Tasks 2, 5, 6; Req 25 → Task 10.
- **Type consistency:** `Run` has 16 fields in the order `file, index, role, scope, issue, status, started, ended, duration_ms, iteration, context_window, last_line, last_activity, error, text, path`; every positional construction in tests follows it (path defaults). `TemplateConfig(tiers, agent_tiers, spec_dir)` positional order is used in Tasks 7 and 9. `LoopProcess(pid, started)`; `Row` fields as declared; `PhaseStat(phase, runs, ok, median_ms, max_ms)`; `Day(date, runs, merged)`.
- **Placeholders:** none.
