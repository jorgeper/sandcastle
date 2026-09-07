"""The Textual app: four collapsible sections, each refreshed by its own
timer in a worker thread. Loading never raises into the UI — a failed
source keeps its last content and names the error in the section title."""

from __future__ import annotations

import argparse
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from importlib.metadata import version
from pathlib import Path

from rich.console import RenderableType
from rich.text import Text
from textual.app import App, ComposeResult
from textual.containers import VerticalScroll
from textual.timer import Timer
from textual.widgets import Collapsible, Footer, Static

from sandcastle_dash import gh
from sandcastle_dash.config import TemplateConfig, load_config
from sandcastle_dash.limits import (
    POLL_SECONDS,
    Limit,
    describe_error,
    fetch_limits,
    next_poll_delay,
    project_exhaustion,
)
from sandcastle_dash.logs import Run, load_runs, read_timings
from sandcastle_dash.orchestrator import derive_state, find_loop_process
from sandcastle_dash.links import issue_url
from sandcastle_dash.orchestrator import LoopState
from sandcastle_dash.panels import (
    limits_view,
    now_table,
    queue_table,
    resolved_table,
    runs_table,
    stats_view,
)
from sandcastle_dash.queue import Row, branch_name, build_queue
from sandcastle_dash.repo import find_repo, logs_dir
from sandcastle_dash.resolved import Resolved, build_resolved
from sandcastle_dash.snapshot import snapshot_text
from sandcastle_dash.stats import PhaseStat, category_totals, per_day, phase_stats
from sandcastle_dash.usage import DEFAULT_ROOT, Burn, burn_rate, scan_recent

# (id, title, refresh seconds); limits polls on its own backoff timer.
SECTIONS = [
    ("limits", "Rate limits", None),
    ("now", "Now", 5),
    ("runs", "Recent runs (24h)", 5),
    ("queue", "Issue queue", 45),
    ("resolved", "Resolved (last 10)", 45),
    ("stats", "Stats (7d)", 120),
]
TICK_SECONDS = 0.5  # heartbeat fade cadence while agents run

NO_CONFIG = TemplateConfig(None, None, None)


@dataclass
class GhState:
    """Last good GitHub/git values, kept across failures (Req 10)."""

    issues: list[gh.Issue] = field(default_factory=list)
    prs: list[gh.Pr] = field(default_factory=list)
    merges: list[gh.Merge] = field(default_factory=list)
    error: str | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def load_queue_rows(
    repo: Path | None, runs: list[Run], cfg: TemplateConfig, state: GhState, now: datetime
) -> list[Row]:
    if repo is None:
        return []
    try:
        state.issues = gh.fetch_issues(repo)
        state.prs = gh.fetch_prs(repo)
        state.error = None
    except gh.SourceError as exc:
        state.error = str(exc)
    base = gh.default_branch(repo)
    open_numbers = [i.number for i in state.issues if i.state == "OPEN"]
    ahead = gh.branch_commit_counts(repo, base, [branch_name(n) for n in open_numbers])
    spec_dir = repo / (cfg.spec_dir or "issue-specs")
    return build_queue(
        state.issues, state.prs, runs, cfg, now, ahead,
        lambda n: (spec_dir / f"issue-{n}.md").exists(),
    )


def load_resolved_rows(repo: Path | None, cfg: TemplateConfig, state: GhState) -> list[Resolved]:
    """Closed issues joined to merges; reuses the issues load_queue_rows fetched."""
    if repo is None:
        return []
    try:
        state.merges = gh.fetch_merges(repo, gh.default_branch(repo))
    except gh.SourceError:
        pass  # keep the last merges; the queue title already names gh errors
    return build_resolved(state.issues, state.merges, cfg)


class Panel(Static):
    def show(self, renderable: RenderableType) -> None:
        self.update(renderable)


class DashApp(App):
    TITLE = "Sandcastle"
    BINDINGS = [
        ("escape", "quit", "Quit"),
        ("q", "quit", "Quit"),
        ("r", "refresh", "Refresh"),
        ("o", "open_latest", "Open issue"),
    ] + [
        (str(i + 1), f"toggle('{cid}')", title.split(" (")[0])
        for i, (cid, title, _) in enumerate(SECTIONS)
    ]
    CSS = """
    Screen { padding: 0 1; background: #1d2021; }
    VerticalScroll { background: #1d2021; }
    Collapsible { border: none; background: #282828; margin-bottom: 1; }
    CollapsibleTitle { color: $accent; text-style: bold; }
    Contents Static { padding: 0 2 1 2; height: auto; }
    """

    def __init__(
        self,
        repo: Path | None,
        fetch: Callable[[], list[Limit]] = fetch_limits,
        transcripts: Path = DEFAULT_ROOT,
    ) -> None:
        super().__init__()
        self.repo = repo
        self._fetch_limits = fetch
        self._transcripts = transcripts
        self._limit_samples: dict[str, deque[tuple[datetime, float]]] = {}
        self._limits_delay: float = POLL_SECONDS
        self._limits_timer: Timer | None = None
        self._cfg = load_config(repo) if repo else NO_CONFIG
        self._gh = GhState()
        self._runs: list[Run] = []
        self.base_url = gh.remote_url(repo) if repo else None
        self._live: tuple[LoopState, list[Run], dict[str, PhaseStat]] | None = None

    def compose(self) -> ComposeResult:
        with VerticalScroll():
            for cid, title, _ in SECTIONS:
                with Collapsible(title=title, collapsed=(cid == "stats"), id=f"sec-{cid}"):
                    yield Panel(id=f"panel-{cid}")
        yield Footer()

    def on_mount(self) -> None:
        self.theme = "gruvbox"
        self.sub_title = str(self.repo) if self.repo else "no .sandcastle/logs found — pass --repo"
        self.refresh_limits()
        self.refresh_live()
        self.refresh_queue()
        self.refresh_stats()
        for cid, _, seconds in SECTIONS:
            if cid == "now":
                self.set_interval(seconds, self.refresh_live)
            elif cid == "queue":
                self.set_interval(seconds, self.refresh_queue)
            elif cid == "stats":
                self.set_interval(seconds, self.refresh_stats)
        self.set_interval(TICK_SECONDS, self._tick)

    # ---- bindings -------------------------------------------------------
    def action_toggle(self, cid: str) -> None:
        section = self.query_one(f"#sec-{cid}", Collapsible)
        section.collapsed = not section.collapsed

    def action_open(self, url: str) -> None:
        """Target of the @click links in every table."""
        self.open_url(url)

    def action_open_latest(self) -> None:
        """Keyboard fallback: open the issue of the newest run."""
        latest = next((r for r in self._runs if r.issue), None)
        url = issue_url(self.base_url, latest.issue) if latest else None
        if url:
            self.open_url(url)
        else:
            self.notify("no issue to open", severity="warning", timeout=3)

    def action_refresh(self) -> None:
        if self.repo:
            self._cfg = load_config(self.repo)
        self.refresh_limits()
        self.refresh_live()
        self.refresh_queue()
        self.refresh_stats()

    # ---- workers ---------------------------------------------------------
    def refresh_limits(self) -> None:
        # A manual `r` or the timer firing: drop any pending timer so the poll
        # is never double-scheduled.
        if self._limits_timer:
            self._limits_timer.stop()
            self._limits_timer = None
        self.run_worker(self._load_limits, thread=True, exclusive=True, group="limits")

    def refresh_live(self) -> None:
        self.run_worker(self._load_live, thread=True, exclusive=True, group="live")

    def refresh_queue(self) -> None:
        self.run_worker(self._load_queue, thread=True, exclusive=True, group="queue")

    def refresh_stats(self) -> None:
        self.run_worker(self._load_stats, thread=True, exclusive=True, group="stats")

    def _stamp(
        self, cid: str, summary: str, error: str | None = None, next_at: datetime | None = None
    ) -> None:
        base = next(title for c, title, _ in SECTIONS if c == cid)
        parts = [base, summary, f"updated {datetime.now().astimezone():%H:%M:%S}"]
        if next_at:
            parts.append(f"next {next_at.astimezone():%H:%M}")
        if error:
            parts.append(error)
        self.query_one(f"#sec-{cid}", Collapsible).title = " · ".join(p for p in parts if p)

    def _show_limits(
        self, failed: bool, renderable: RenderableType | None, summary: str, error: str | None
    ) -> None:
        """Arm the next poll (backing off after failures, e.g. HTTP 429) and
        stamp the title with when it fires. A failure keeps the last meters."""
        self._limits_delay = next_poll_delay(self._limits_delay, failed)
        self._limits_timer = self.set_timer(self._limits_delay, self.refresh_limits)
        next_at = datetime.now(timezone.utc) + timedelta(seconds=self._limits_delay)
        if renderable is not None:
            self.query_one("#panel-limits", Panel).show(renderable)
        self._stamp("limits", summary, error, next_at)

    def _show(
        self, cid: str, renderable: RenderableType, summary: str, error: str | None = None
    ) -> None:
        self.query_one(f"#panel-{cid}", Panel).show(renderable)
        self._stamp(cid, summary, error)

    def _load_limits(self) -> None:
        now = _now()
        try:
            limits = self._fetch_limits()
        except Exception as exc:  # degrade, never crash the section
            self.call_from_thread(self._show_limits, True, None, "", f"unavailable: {describe_error(exc)}")
            return
        projections: dict[str, datetime] = {}
        for limit in limits:
            samples = self._limit_samples.setdefault(limit.kind, deque(maxlen=8))
            samples.append((now, limit.percent))
            eta = project_exhaustion(list(samples), now)
            if eta:
                projections[limit.kind] = eta
        burn = burn_rate(scan_recent(self._transcripts, now))
        view, summary = limits_view(limits, now, projections, burn)
        self.call_from_thread(self._show_limits, False, view, f"live · {summary}", None)

    def _tick(self) -> None:
        """Redraw the Now section from cached data at a fresh `now`, so the
        heartbeats fade between log reloads. Pure and cheap; only runs while
        an agent is in flight."""
        if not self._live:
            return
        state, runs, phases = self._live
        if not any(r.status == "running" for r in runs):
            return
        table, _ = now_table(state, runs, _now(), self.base_url, phases)
        self.query_one("#panel-now", Panel).show(table)

    def _load_live(self) -> None:
        now = _now()
        runs = load_runs(logs_dir(self.repo), now) if self.repo else []
        self._runs = runs
        state = derive_state(find_loop_process(now), runs)
        phases: dict[str, PhaseStat] = {}
        if self.repo:
            timings = read_timings(logs_dir(self.repo) / "timings.jsonl")
            phases = {p.phase: p for p in phase_stats(timings, now)}
        self._live = (state, runs, phases)
        error = None if self.repo else "no .sandcastle/logs under the current directory"
        table, summary = now_table(state, runs, now, self.base_url, phases)
        self.call_from_thread(self._show, "now", table, summary, error)
        table, summary = runs_table(runs, now, base_url=self.base_url)
        self.call_from_thread(self._show, "runs", table, summary)

    def _load_queue(self) -> None:
        now = _now()
        rows = load_queue_rows(self.repo, self._runs, self._cfg, self._gh, now)
        table, summary = queue_table(rows, self.base_url)
        self.call_from_thread(self._show, "queue", table, summary, self._gh.error)
        done = load_resolved_rows(self.repo, self._cfg, self._gh)
        table, summary = resolved_table(done, now, self.base_url)
        self.call_from_thread(self._show, "resolved", table, summary, self._gh.error)

    def _load_stats(self) -> None:
        now = _now()
        if not self.repo:
            self.call_from_thread(self._show, "stats", Text("  no repo", style="dim"), "")
            return
        timings = read_timings(logs_dir(self.repo) / "timings.jsonl")
        try:
            self._gh.merges = gh.fetch_merges(self.repo, gh.default_branch(self.repo))
            error = None
        except gh.SourceError as exc:
            error = str(exc)
        runs = self._runs or load_runs(logs_dir(self.repo), now)
        view, summary = stats_view(
            phase_stats(timings, now),
            category_totals(runs, now),
            per_day(timings, self._gh.merges, now),
        )
        self.call_from_thread(self._show, "stats", view, summary, error)


def run_once(repo: Path | None) -> None:
    now = _now()
    limits: list[Limit] | None = None
    limits_error: str | None = None
    burn: Burn | None = None
    try:
        limits = fetch_limits()
        burn = burn_rate(scan_recent(DEFAULT_ROOT, now))
    except Exception as exc:
        limits_error = f"unavailable: {describe_error(exc)}"
    runs = load_runs(logs_dir(repo), now) if repo else []
    state = derive_state(find_loop_process(now), runs)
    cfg = load_config(repo) if repo else NO_CONFIG
    gh_state = GhState()
    rows = load_queue_rows(repo, runs, cfg, gh_state, now)
    done = load_resolved_rows(repo, cfg, gh_state)
    base_url = gh.remote_url(repo) if repo else None
    phases: dict[str, PhaseStat] = {}
    if repo:
        timings = read_timings(logs_dir(repo) / "timings.jsonl")
        phases = {p.phase: p for p in phase_stats(timings, now)}
    print(
        snapshot_text(state, runs, rows, done, now, repo, base_url, phases, limits, limits_error, burn),
        end="",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="sandcastle-dash",
        description="Terminal dashboard for the Sandcastle goal-template loop: live agents, "
        "rate limits, live agents, recent runs, issue queue, resolved issues, 7-day stats. "
        "Reads .sandcastle/logs plus gh/git from the local checkout, and the OAuth usage "
        "endpoint for the meters. Esc/q quits, r refreshes, o opens the newest run's issue, "
        "1-6 toggle sections. Issue and PR numbers are clickable.",
    )
    parser.add_argument(
        "--repo", type=Path, help="repository checkout to watch (default: walk up from the cwd)"
    )
    parser.add_argument(
        "--once", action="store_true", help="print a one-shot snapshot to stdout and exit"
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {version('sandcastle-dash')}"
    )
    args = parser.parse_args()
    repo = find_repo(args.repo) if args.repo else find_repo()
    if args.once:
        run_once(repo)
    else:
        DashApp(repo).run()


if __name__ == "__main__":
    main()
