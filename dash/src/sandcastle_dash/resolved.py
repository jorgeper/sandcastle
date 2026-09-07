"""The resolved list: the most recently closed trigger-labeled issues,
newest first, each joined to the merge commit that landed it when the git
log names one. Pure."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sandcastle_dash.config import TemplateConfig
from sandcastle_dash.gh import Issue, Merge
from sandcastle_dash.queue import TRIGGER, required_tier

LIMIT = 10


@dataclass(frozen=True)
class Resolved:
    number: int
    title: str
    tier: str
    closed: datetime
    merged: datetime | None
    merge_subject: str
    merge_issues: tuple[int, ...] = ()


def build_resolved(
    issues: list[Issue], merges: list[Merge], cfg: TemplateConfig, limit: int = LIMIT
) -> list[Resolved]:
    closed = [i for i in issues if i.state == "CLOSED" and i.closed and TRIGGER in i.labels]
    closed.sort(key=lambda i: (i.closed, i.number), reverse=True)
    out: list[Resolved] = []
    for issue in closed[:limit]:
        merge = next((m for m in merges if issue.number in m.issues), None)
        out.append(
            Resolved(
                number=issue.number,
                title=issue.title,
                tier=required_tier(issue.labels, cfg.tiers) or "—",
                closed=issue.closed,  # type: ignore[arg-type]
                merged=merge.ts if merge else None,
                merge_subject=merge.subject if merge else "",
                merge_issues=merge.issues if merge else (),
            )
        )
    return out
