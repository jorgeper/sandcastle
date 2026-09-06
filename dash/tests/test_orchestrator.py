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
