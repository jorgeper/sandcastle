from datetime import datetime, timedelta, timezone
from pathlib import Path

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
    text = (
        "[18:03:41] Iteration 1/1\n"
        "[18:03:41] Git worktree operation failed: Provider 'docker' create failed\n"
        "[18:03:42] Run failed: x\n"
    )
    assert extract_error(text) == "Git worktree operation failed: Provider 'docker' create failed"
    assert extract_error("[1:1:1] all good\n") is None


def test_finished_block_matches_its_timing_and_the_last_block_runs() -> None:
    mtime = NOW - timedelta(seconds=30)
    first, second = _runs("sandcastle-issue-31-implementer.log", mtime)
    assert (first.role, first.issue, first.scope) == ("implementer", "31", "issue")
    assert first.status == "success"
    assert first.duration_ms == 151222
    # A completion line plus a stamp fixes the end at the stamp; the timing only fills a missing end.
    assert first.ended == datetime(2026, 9, 6, 18, 57, 21, tzinfo=UTC)
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
