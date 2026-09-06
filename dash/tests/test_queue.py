from datetime import datetime, timedelta, timezone
from pathlib import Path

from sandcastle_dash.config import TemplateConfig, parse_config
from sandcastle_dash.gh import Issue, Pr, parse_issues
from sandcastle_dash.logs import Run
from sandcastle_dash.queue import build_queue, held_agents, required_tier

FIXTURES = Path(__file__).parent / "fixtures"
UTC = timezone.utc
NOW = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)
CFG = parse_config((FIXTURES / "config.mts").read_text())
ALL_HARD = TemplateConfig(CFG.tiers, {k: "hard" for k in CFG.agent_tiers or {}}, "issue-specs")


def _run(issue: str, role: str, status: str, when: datetime = NOW) -> Run:
    return Run(
        f"sandcastle-issue-{issue}-{role}.log", 0, role, "issue", issue, status, when, when, 1,
        None, None, "", when, None, "",
    )


def _issues() -> list[Issue]:
    return parse_issues((FIXTURES / "issues.json").read_text())


def test_required_tier_prefers_the_strongest_label() -> None:
    assert required_tier(("sandcastle",), CFG.tiers) == "normal"
    assert required_tier(("sandcastle:effort-hard", "sandcastle:effort-normal"), CFG.tiers) == "hard"
    assert required_tier(("sandcastle:effort-hard",), None) == "hard"
    assert required_tier(("sandcastle",), None) is None


def test_held_agents_names_the_short_ones() -> None:
    assert held_agents("hard", CFG, pr_flag=False) == ["reviewer", "merger", "conflict-resolver"]
    assert held_agents("hard", CFG, pr_flag=True) == [
        "reviewer", "merger", "conflict-resolver", "pr-reviewer", "addresser",
    ]
    assert held_agents("normal", CFG, pr_flag=False) == []
    assert held_agents("hard", TemplateConfig(None, None, None), pr_flag=False) is None


def test_build_queue_stages_and_order() -> None:
    prs = [Pr(9, "Queue #310", "OPEN", "sandcastle/issue-310", False, ("sandcastle:ready",), (310,))]
    rows = build_queue(_issues(), prs, [], CFG, NOW, {}, lambda n: False)
    by = {r.number: r for r in rows}
    # the PRD group holds the held child, so it sorts first; children stay under their parent
    assert [r.number for r in rows] == [300, 301, 310]
    assert by[301].stage == "held" and by[301].tone == "held" and "reviewer" in by[301].detail
    assert by[301].depth == 1 and by[300].depth == 0
    assert by[300].stage == "prd" and by[300].detail == "1/2 open"
    assert by[310].stage == "PR ready" and by[310].flags == ("pr",)
    assert 302 not in by  # closed sub-issue never listed


def test_build_queue_working_beats_everything_and_failures_show() -> None:
    runs = [
        _run("310", "implementer", "running"),
        _run("301", "spec-writer", "failed", NOW - timedelta(minutes=5)),
    ]
    rows = build_queue(
        _issues(), [], runs, ALL_HARD, NOW, {"sandcastle/issue-301": 2}, lambda n: n == 301
    )
    by = {r.number: r for r in rows}
    assert rows[0].number == 310
    assert rows[0].stage == "working implementer" and rows[0].tone == "working"
    assert by[301].stage == "implemented"
    assert by[301].detail == "2 commits · ✗ spec-writer" and by[301].tone == "failed"


def test_build_queue_spec_and_ready_to_merge() -> None:
    rows = build_queue(_issues(), [], [], ALL_HARD, NOW, {}, lambda n: n == 310)
    assert {r.number: r for r in rows}[310].stage == "spec'd"
    marked = [i for i in _issues() if i.number != 310] + [
        Issue(310, "x", "OPEN", "", NOW, NOW, ("sandcastle", "sandcastle:ready-to-merge"), None, ())
    ]
    rows = build_queue(marked, [], [], ALL_HARD, NOW, {}, lambda n: False)
    assert {r.number: r for r in rows}[310].stage == "ready to merge"
