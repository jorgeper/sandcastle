from datetime import datetime, timedelta, timezone

from sandcastle_dash.gh import Merge
from sandcastle_dash.logs import Run, Timing
from sandcastle_dash.stats import category_totals, per_day, phase_stats

UTC = timezone.utc
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)


def _t(phase: str, ms: int, ok: bool, ago: timedelta) -> Timing:
    return Timing(NOW - ago, phase, ms, ok, None)


def _run(file: str, issue: str, started: datetime, text: str) -> Run:
    return Run(
        file, 0, "implementer", "issue", issue, "success", started, NOW, 1, None, None, "",
        started, None, text,
    )


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
    recent = _run("a.log", "1", NOW - timedelta(hours=1), text)
    old = _run("b.log", "2", NOW - timedelta(days=2), text)
    totals = category_totals([recent, old], NOW)
    assert totals["edit"] == 10 and totals["verify"] == 30


def test_per_day_counts_runs_and_merges() -> None:
    timings = [
        _t("planner", 1, True, timedelta(hours=1)),
        _t("merger", 1, True, timedelta(days=1, hours=1)),
    ]
    merges = [
        Merge(NOW - timedelta(hours=2), (1, 2), "merge issues #1 #2"),
        Merge(NOW - timedelta(days=9), (3,), "old"),
    ]
    days = per_day(timings, merges, NOW)
    assert len(days) == 7
    assert days[-1].runs == 1 and days[-1].merged == 2
    assert days[-2].runs == 1 and days[-2].merged == 0
    assert days[0].date < days[-1].date
