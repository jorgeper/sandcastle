from datetime import datetime, timedelta, timezone

from sandcastle_dash.logs import Run
from pathlib import Path

from sandcastle_dash.orchestrator import (
    LoopProcess,
    derive_state,
    parse_lsof_cwd,
    parse_ps,
    select_for_repo,
)

UTC = timezone.utc
PS = """\
  412 Sun Sep  6 09:00:00 2026 /sbin/launchd
33459 Sun Sep  6 11:59:12 2026 npm exec tsx .sandcastle/main.ts
33485 Sun Sep  6 11:59:13 2026 node /Users/me/src/app/node_modules/.bin/tsx .sandcastle/main.ts
33500 Sun Sep  6 12:10:00 2026 grep .sandcastle/main.ts
"""


def _run(role: str, started: datetime, status: str = "success", issue: str | None = None) -> Run:
    return Run(
        f"{role}.log", 0, role, "main", issue, status, started, started, 1000, None, None, "",
        started, None, "",
    )


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
    runs = [
        _run("merger", datetime(2026, 9, 6, 10, 0, tzinfo=UTC)),
        _run("planner", datetime(2026, 9, 6, 9, 0, tzinfo=UTC)),
    ]
    state = derive_state(None, runs)
    assert not state.running and state.iteration is None
    assert state.last_run is not None and state.last_run.role == "merger"
    assert derive_state(None, []).last_run is None


def test_derive_state_iteration_is_one_before_the_first_planner() -> None:
    assert derive_state(LoopProcess(1, datetime.now(UTC)), []).iteration == 1


def test_parse_lsof_cwd_reads_the_n_line() -> None:
    assert parse_lsof_cwd("p37656\nfcwd\nn/Users/x/src/marky-mark\n") == Path("/Users/x/src/marky-mark")
    assert parse_lsof_cwd("") is None


def test_select_for_repo_keeps_only_loops_in_that_repo(tmp_path: Path) -> None:
    now = datetime.now(UTC)
    repo = tmp_path / "a"
    other = tmp_path / "b"
    (repo / ".sandcastle" / "worktrees" / "w").mkdir(parents=True)
    other.mkdir()
    early = LoopProcess(1, now - timedelta(hours=2))
    mine = LoopProcess(2, now - timedelta(hours=1))
    unknown = LoopProcess(3, now - timedelta(minutes=5))
    in_worktree = LoopProcess(4, now - timedelta(minutes=30))
    candidates = [(early, other), (mine, repo), (unknown, None), (in_worktree, repo / ".sandcastle" / "worktrees" / "w")]
    assert select_for_repo(candidates, repo) == mine  # earliest of mine/in_worktree/unknown
    assert select_for_repo([(early, other)], repo) is None
    assert select_for_repo([(early, other)], None) == early
    assert select_for_repo([(unknown, None)], repo) == unknown  # unreadable cwd: keep
