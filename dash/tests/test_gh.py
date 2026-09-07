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


def test_parse_merges_reads_branch_style_subjects() -> None:
    text = (
        "2026-09-06T11:00:00+00:00|RALPH: merge sandcastle/issue-261 and sandcastle/issue-255\n"
        "2026-09-06T10:00:00+00:00|Merge branch 'sandcastle/issue-253'\n"
        "2026-09-06T09:00:00+00:00|RALPH: issue #250 — the Names section (spec issue-specs/issue-250.md)\n"
        "2026-09-06T08:00:00+00:00|RALPH: issue #306 — bump issue #309's E564: it collided after the parallel merge\n"
    )
    assert [m.issues for m in parse_merges(text)] == [(261, 255), (253,)]


def test_parse_branches_reads_name_and_count() -> None:
    assert parse_branches("sandcastle/issue-31 3\nsandcastle/issue-32 0\n") == {
        "sandcastle/issue-31": 3,
        "sandcastle/issue-32": 0,
    }


def test_parse_issues_reads_closed_at() -> None:
    by = {i.number: i for i in parse_issues((FIXTURES / "issues.json").read_text())}
    assert by[302].closed == datetime(2026, 9, 6, 8, 0, tzinfo=timezone.utc)
    assert by[301].closed is None


def test_parse_remote_url_maps_ssh_and_https_to_browser_urls() -> None:
    from sandcastle_dash.gh import parse_remote_url

    assert parse_remote_url("git@github.com:jorgeper/marky-mark.git\n") == "https://github.com/jorgeper/marky-mark"
    assert parse_remote_url("https://github.com/jorgeper/marky-mark.git") == "https://github.com/jorgeper/marky-mark"
    assert parse_remote_url("https://github.com/jorgeper/marky-mark") == "https://github.com/jorgeper/marky-mark"
    assert parse_remote_url("ssh://git@github.com/jorgeper/marky-mark.git") == "https://github.com/jorgeper/marky-mark"
    assert parse_remote_url("not a remote") is None
