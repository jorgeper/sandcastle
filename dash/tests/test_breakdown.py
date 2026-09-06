from datetime import datetime, timezone
from pathlib import Path

from sandcastle_dash.breakdown import CATEGORIES, categorize, run_breakdown
from sandcastle_dash.logs import Run, parse_runs, read_timings

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
        "sandcastle-issue-31-implementer.log",
        content,
        now,
        read_timings(FIXTURES / "timings.jsonl"),
        now,
    )
    totals = run_breakdown(first, now)
    assert set(totals) == {k for k, _ in CATEGORIES}
    # cat 18:54:54 → Read 18:55:04 = 10s + Read → Edit 18:56:10 = 66s explore;
    # Edit → verify at 18:56:40 = 30s edit; verify → git at 18:57:20 = 40s verify
    assert totals["explore"] == 76
    assert totals["edit"] == 30
    assert totals["verify"] == 40
    # a running block extends its last event to now (19:20:09 → 19:21:00 = 51s)
    running = run_breakdown(second, now)
    assert running["think"] == 51


def test_breakdown_needs_two_events() -> None:
    stamp = datetime.now(UTC)
    run = Run(
        "x.log", 0, "r", "other", None, "success", None, None, None, None, None, "", stamp, None,
        "[10:00:00] only\n",
    )
    assert all(v == 0 for v in run_breakdown(run, stamp).values())
