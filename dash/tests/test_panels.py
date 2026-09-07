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
    text = snapshot_text(
        derive_state(None, runs), runs, [], [], datetime.now(UTC), tmp_path, BASE
    )
    assert "idle" in text and "Recent runs" in text and "Issue queue" in text
    assert "Resolved (last 10)" in text and f"links: {BASE}/issues/<n>" in text


BASE = "https://github.com/jorgeper/marky-mark"


def _links(renderable) -> set[str]:
    console = Console(width=120, file=io.StringIO(), force_terminal=True)
    return {
        seg.style.link
        for seg in console.render(renderable)
        if seg.style and seg.style.link
    }


def test_runs_table_defaults_to_fifteen_rows() -> None:
    now = datetime(2026, 9, 6, 19, 30, tzinfo=UTC)
    from sandcastle_dash.logs import Run

    runs = [
        Run(f"sandcastle-issue-{n}-implementer.log", 0, "implementer", "issue", str(n), "success",
            now - timedelta(minutes=n), now, 1000, None, None, "", now - timedelta(minutes=n), None, "")
        for n in range(1, 31)
    ]
    renderable, summary = runs_table(runs, now, base_url=BASE)
    text = _render(renderable)
    assert summary == "30 runs"
    assert "#15" in text and "#16" not in text
    assert f"{BASE}/issues/1" in _links(renderable)


def test_queue_table_links_issues_and_prs() -> None:
    cfg = parse_config((FIXTURES / "config.mts").read_text())
    from sandcastle_dash.gh import Pr

    prs = [Pr(7, "fix", "OPEN", "sandcastle/issue-310", False, ("sandcastle:ready",), (310,))]
    rows = build_queue(
        parse_issues((FIXTURES / "issues.json").read_text()), prs, [], cfg,
        datetime(2026, 9, 6, 12, 0, tzinfo=UTC), {}, lambda n: False,
    )
    renderable, _ = queue_table(rows, base_url=BASE)
    links = _links(renderable)
    assert f"{BASE}/issues/310" in links and f"{BASE}/pull/7" in links


def test_resolved_table_lists_closed_issues() -> None:
    from sandcastle_dash.panels import resolved_table
    from sandcastle_dash.resolved import Resolved

    now = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)
    rows = [Resolved(302, "closed one", "normal", now - timedelta(hours=4), now - timedelta(hours=4, minutes=5), "RALPH: merge issues #302 #301", (302, 301))]
    renderable, summary = resolved_table(rows, now, base_url=BASE)
    text = _render(renderable)
    assert summary == "1 resolved"
    assert "#302" in text and "closed one" in text and "4h" in text and "merged" in text and "with #301" in text
    assert f"{BASE}/issues/302" in _links(renderable)
    empty, summary = resolved_table([], now)
    assert summary == "0 resolved" and "nothing" in _render(empty)


def test_now_table_animates_running_agents(tmp_path: Path) -> None:
    runs = _runs(tmp_path)
    now = datetime.now(UTC)
    state = derive_state(LoopProcess(1, now - timedelta(hours=3)), runs)
    a = _render(now_table(state, runs, now, frame=0)[0])
    b = _render(now_table(state, runs, now, frame=1)[0])
    assert a != b
    assert "▁" in a or "█" in a  # the wave under the active row
    # idle: no spinner, frame changes nothing
    idle = derive_state(None, runs)
    assert _render(now_table(idle, [r for r in runs if r.status != "running"], now, frame=0)[0]) == _render(
        now_table(idle, [r for r in runs if r.status != "running"], now, frame=3)[0]
    )
