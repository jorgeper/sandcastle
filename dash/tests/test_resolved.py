from datetime import datetime, timedelta, timezone
from pathlib import Path

from sandcastle_dash.config import parse_config
from sandcastle_dash.gh import Issue, Merge, parse_issues
from sandcastle_dash.resolved import build_resolved

FIXTURES = Path(__file__).parent / "fixtures"
UTC = timezone.utc
CFG = parse_config((FIXTURES / "config.mts").read_text())
T0 = datetime(2026, 9, 6, 8, 0, tzinfo=UTC)


def _closed(n: int, when: datetime, labels=("sandcastle",)) -> Issue:
    return Issue(n, f"issue {n}", "CLOSED", f"u/{n}", when - timedelta(days=1), when, labels, None, (), when)


def test_fixture_closed_issue_is_listed_with_its_merge() -> None:
    issues = parse_issues((FIXTURES / "issues.json").read_text())
    merges = [Merge(T0 - timedelta(minutes=5), (302, 301), "RALPH: merge issues #302 #301")]
    (row,) = build_resolved(issues, merges, CFG)
    assert row.number == 302 and row.closed == T0
    assert row.merged == T0 - timedelta(minutes=5)
    assert row.merge_subject.startswith("RALPH")
    assert row.tier == "normal"
    assert row.merge_issues == (302, 301)


def test_newest_first_limited_and_only_trigger_labeled() -> None:
    issues = [_closed(n, T0 + timedelta(hours=n)) for n in range(1, 15)]
    issues.append(_closed(99, T0 + timedelta(days=9), labels=("bug",)))
    issues.append(Issue(50, "open", "OPEN", "u", T0, T0, ("sandcastle",), None, ()))
    rows = build_resolved(issues, [], CFG)
    assert [r.number for r in rows] == list(range(14, 4, -1))
    assert all(r.merged is None and r.merge_subject == "" for r in rows)
