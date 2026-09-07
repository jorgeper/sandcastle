"""The issue queue: every open trigger-labeled issue with its effort tier
and the one stage that explains what it is waiting on. Pure."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sandcastle_dash.config import TemplateConfig
from sandcastle_dash.gh import Issue, Pr
from sandcastle_dash.logs import Run

TRIGGER = "sandcastle"
PRD_LABEL = "sandcastle:requires-prd"
EFFORT_PREFIX = "sandcastle:effort-"
ISSUE_PATH = ("spec-writer", "implementer", "reviewer", "merger", "conflict-resolver")
PR_PATH = ("pr-reviewer", "addresser")
_PR_STATUS = ("sandcastle:in-review", "sandcastle:ready", "sandcastle:needs-decision")


@dataclass(frozen=True)
class Row:
    number: int
    title: str
    tier: str
    flags: tuple[str, ...]
    age: timedelta
    stage: str
    detail: str
    depth: int
    tone: str  # working | held | failed | plain


def branch_name(n: int) -> str:
    return f"sandcastle/issue-{n}"


def required_tier(
    labels: tuple[str, ...], tiers: tuple[tuple[str, str], ...] | None
) -> str | None:
    names = [t[0] for t in tiers] if tiers else None
    best: str | None = None
    for label in labels:
        if not label.startswith(EFFORT_PREFIX):
            continue
        tier = label[len(EFFORT_PREFIX) :]
        if names is None:
            best = tier if best is None else best
        elif tier in names and (best is None or names.index(tier) > names.index(best)):
            best = tier
    if best is None and names:
        return names[0]
    return best


def held_agents(required: str | None, cfg: TemplateConfig, pr_flag: bool) -> list[str] | None:
    """Agents on the issue's path configured below `required`; None = unknown."""
    if required is None or cfg.tiers is None or cfg.agent_tiers is None:
        return None
    names = [t[0] for t in cfg.tiers]
    if required not in names:
        return None
    needed = names.index(required)
    short: list[str] = []
    for role in ISSUE_PATH + (PR_PATH if pr_flag else ()):
        tier = cfg.agent_tiers.get(role, names[0])
        if tier not in names or names.index(tier) < needed:
            short.append(role)
    return short


def _flags(labels: tuple[str, ...]) -> tuple[str, ...]:
    flags: list[str] = []
    if "sandcastle:require-pr" in labels or "sandcastle:agent-approve" in labels:
        flags.append("pr")
    if PRD_LABEL in labels:
        flags.append("prd")
    if "sandcastle:release" in labels:
        flags.append("release")
    return tuple(flags)


def _stage(
    issue: Issue,
    prs: list[Pr],
    runs: list[Run],
    cfg: TemplateConfig,
    branch_ahead: dict[str, int],
    spec_exists: Callable[[int], bool],
) -> tuple[str, str, str]:
    """(stage, detail, tone) for one issue."""
    n = issue.number
    mine = [r for r in runs if r.issue == str(n)]
    newest_first = sorted(mine, key=lambda r: r.last_activity, reverse=True)
    failed = next((r for r in newest_first if r.status == "failed"), None)
    fail_note = f"✗ {failed.role}" if failed else ""

    def done(stage: str, detail: str = "", tone: str = "plain") -> tuple[str, str, str]:
        if fail_note:
            detail = f"{detail} · {fail_note}" if detail else fail_note
            tone = "failed" if tone == "plain" else tone
        return stage, detail, tone

    short = held_agents(
        required_tier(issue.labels, cfg.tiers), cfg, "pr" in _flags(issue.labels)
    )
    if short:
        return done("held", ", ".join(short) + " below tier", "held")
    running = next((r for r in mine if r.status == "running"), None)
    if running:
        return done(f"working {running.role}", running.iteration or "", "working")
    if "sandcastle:ready-to-merge" in issue.labels:
        return done("ready to merge")
    pr = next((p for p in prs if p.state == "OPEN" and n in p.linked), None)
    if pr:
        status = next((l.split(":", 1)[1] for l in pr.labels if l in _PR_STATUS), None)
        if "sandcastle:approved" in pr.labels:
            status = "approved"
        return done(f"PR {status or 'open'}", f"#{pr.number}")
    ahead = branch_ahead.get(branch_name(n), 0)
    if ahead > 0:
        return done("implemented", f"{ahead} commit{'s' if ahead != 1 else ''}")
    if spec_exists(n):
        return done("spec'd")
    return done("queued")


def build_queue(
    issues: list[Issue],
    prs: list[Pr],
    runs: list[Run],
    cfg: TemplateConfig,
    now: datetime,
    branch_ahead: dict[str, int],
    spec_exists: Callable[[int], bool],
) -> list[Row]:
    open_by = {i.number: i for i in issues if i.state == "OPEN"}
    trigger = [i for i in open_by.values() if TRIGGER in i.labels]

    def row(issue: Issue, depth: int, stage: str, detail: str, tone: str) -> Row:
        return Row(
            number=issue.number,
            title=issue.title,
            tier=required_tier(issue.labels, cfg.tiers) or "—",
            flags=_flags(issue.labels),
            age=now - issue.created,
            stage=stage,
            detail=detail,
            depth=depth,
            tone=tone,
        )

    parents = [i for i in trigger if PRD_LABEL in i.labels]
    child_numbers = {c for p in parents for c in p.sub_issues}
    # Groups keep a PRD parent and its open children together; sorting
    # happens between groups, by the group's most urgent row.
    groups: list[list[Row]] = []
    for issue in sorted(trigger, key=lambda i: i.number):
        if issue.number in child_numbers and issue.parent in open_by:
            continue  # rendered under its parent
        if PRD_LABEL in issue.labels:
            open_children = [open_by[c] for c in issue.sub_issues if c in open_by]
            group = [row(issue, 0, "prd", f"{len(open_children)}/{len(issue.sub_issues)} open", "plain")]
            for child in sorted(open_children, key=lambda c: c.number):
                group.append(row(child, 1, *_stage(child, prs, runs, cfg, branch_ahead, spec_exists)))
            groups.append(group)
            continue
        groups.append([row(issue, 0, *_stage(issue, prs, runs, cfg, branch_ahead, spec_exists))])

    rank = {"working": 0, "held": 1}

    def key(r: Row) -> tuple[int, int]:
        return (rank.get(r.tone, 2), r.number)

    groups.sort(key=lambda g: min(key(r) for r in g))
    return [r for g in groups for r in g]
