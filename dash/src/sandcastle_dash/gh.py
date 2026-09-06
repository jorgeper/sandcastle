"""GitHub (via gh) and git sources. Parsers are pure; fetchers shell out
with timeouts and raise SourceError so the app can keep its last value."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ISSUES_QUERY = """query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    issues(first:100,orderBy:{field:UPDATED_AT,direction:DESC}){
      nodes{
        number title state url createdAt updatedAt closedAt
        labels(first:20){nodes{name}}
        parent{number}
        subIssues(first:100){nodes{number}}
      }
    }
  }
}"""


class SourceError(Exception):
    """A gh/git call failed; the message is one line for a section title."""


@dataclass(frozen=True)
class Issue:
    number: int
    title: str
    state: str
    url: str
    created: datetime
    updated: datetime
    labels: tuple[str, ...]
    parent: int | None
    sub_issues: tuple[int, ...]


@dataclass(frozen=True)
class Pr:
    number: int
    title: str
    state: str
    branch: str
    is_draft: bool
    labels: tuple[str, ...]
    linked: tuple[int, ...]


@dataclass(frozen=True)
class Merge:
    ts: datetime
    issues: tuple[int, ...]
    subject: str


def _iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _run(args: list[str], cwd: Path, timeout: float = 30) -> str:
    try:
        done = subprocess.run(
            args, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SourceError(f"{args[0]}: {exc.__class__.__name__}") from exc
    if done.returncode != 0:
        first = (done.stderr or done.stdout).strip().splitlines()
        raise SourceError(f"{args[0]}: {first[0] if first else f'exit {done.returncode}'}")
    return done.stdout


def parse_issues(text: str) -> list[Issue]:
    try:
        nodes = json.loads(text)["data"]["repository"]["issues"]["nodes"]
    except (ValueError, KeyError, TypeError) as exc:
        raise SourceError(f"issues: unexpected payload ({exc.__class__.__name__})") from exc
    return [
        Issue(
            number=int(n["number"]),
            title=str(n.get("title", "")),
            state=str(n.get("state", "")),
            url=str(n.get("url", "")),
            created=_iso(n["createdAt"]),
            updated=_iso(n["updatedAt"]),
            labels=tuple(l["name"] for l in n.get("labels", {}).get("nodes", [])),
            parent=int(n["parent"]["number"]) if n.get("parent") else None,
            sub_issues=tuple(int(s["number"]) for s in n.get("subIssues", {}).get("nodes", [])),
        )
        for n in nodes
    ]


def parse_prs(text: str) -> list[Pr]:
    try:
        raw = json.loads(text)
    except ValueError as exc:
        raise SourceError("prs: unexpected payload") from exc
    prs: list[Pr] = []
    for p in raw:
        branch = str(p.get("headRefName", ""))
        linked: list[int] = []
        m = re.search(r"issue-(\d+)", branch)
        if m:
            linked.append(int(m.group(1)))
        for t in re.finditer(r"#(\d+)", str(p.get("title", ""))):
            n = int(t.group(1))
            if n not in linked:
                linked.append(n)
        prs.append(
            Pr(
                number=int(p["number"]),
                title=str(p.get("title", "")),
                state=str(p.get("state", "")),
                branch=branch,
                is_draft=bool(p.get("isDraft")),
                labels=tuple(l["name"] for l in p.get("labels", [])),
                linked=tuple(linked),
            )
        )
    return prs


def parse_merges(text: str) -> list[Merge]:
    merges: list[Merge] = []
    for line in text.splitlines():
        bar = line.find("|")
        if bar < 0:
            continue
        ts, subject = line[:bar], line[bar + 1 :]
        if not re.search(r"\bmerge issues? #", subject, re.I):
            continue
        issues = tuple(int(m.group(1)) for m in re.finditer(r"#(\d+)", subject))
        if issues:
            merges.append(Merge(_iso(ts), issues, subject))
    return merges


def parse_branches(text: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].isdigit():
            out[parts[0]] = int(parts[1])
    return out


def fetch_issues(repo: Path) -> list[Issue]:
    return parse_issues(
        _run(
            [
                "gh", "api", "graphql",
                "-F", "owner={owner}", "-F", "name={repo}",
                "-f", f"query={ISSUES_QUERY}",
            ],
            repo,
        )
    )


def fetch_prs(repo: Path) -> list[Pr]:
    return parse_prs(
        _run(
            [
                "gh", "pr", "list", "--state", "all", "--limit", "50",
                "--json", "number,title,state,headRefName,isDraft,labels",
            ],
            repo,
        )
    )


def default_branch(repo: Path) -> str:
    try:
        ref = _run(
            ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repo, timeout=5
        ).strip()
        return ref.split("/", 1)[1] if "/" in ref else ref
    except SourceError:
        return "main"


def fetch_merges(repo: Path, base: str) -> list[Merge]:
    return parse_merges(
        _run(
            ["git", "log", "--since=14 days ago", "--first-parent", "--pretty=%cI|%s", base],
            repo,
            timeout=10,
        )
    )


def branch_commit_counts(repo: Path, base: str, branches: list[str]) -> dict[str, int]:
    """Commits on each branch not in `base`; branches that do not exist are absent."""
    counts: dict[str, int] = {}
    for branch in branches:
        try:
            out = _run(["git", "rev-list", "--count", f"{base}..{branch}"], repo, timeout=5).strip()
        except SourceError:
            continue
        if out.isdigit():
            counts[branch] = int(out)
    return counts
