import io
import os
import shutil
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
    console = Console(record=True, width=120, file=io.StringIO())
    console.print(renderable)
    return console.export_text()


def _runs(tmp_path: Path):
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
    # the tail -f path is allowed to wrap: it must stay copyable, not truncated
    assert "sandcastle-issue-31-implementer.log" in text.replace("\n", "")


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
    rows = build_queue(
        parse_issues((FIXTURES / "issues.json").read_text()), [], [], cfg,
        datetime(2026, 9, 6, 12, 0, tzinfo=UTC), {}, lambda n: False,
    )
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
