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
    text = (
        '[{"number":7,"title":"Fix #31 and #32","state":"OPEN","headRefName":"sandcastle/issue-31",'
        '"isDraft":false,"labels":[{"name":"sandcastle:ready"}]}]'
    )
    (pr,) = parse_prs(text)
    assert pr.linked == (31, 32)
    assert pr.labels == ("sandcastle:ready",)


def test_parse_merges_keeps_only_issue_merges() -> None:
    text = (
        "2026-09-06T11:00:00+00:00|sandcastle: merge issues #31 #32 into main\n"
        "2026-09-06T10:00:00+00:00|docs: typo\n"
        "2026-09-05T10:00:00+00:00|RALPH: merge issue #30\n"
    )
    merges = parse_merges(text)
    assert [m.issues for m in merges] == [(31, 32), (30,)]


def test_parse_branches_reads_name_and_count() -> None:
    assert parse_branches("sandcastle/issue-31 3\nsandcastle/issue-32 0\n") == {
        "sandcastle/issue-31": 3,
        "sandcastle/issue-32": 0,
    }
