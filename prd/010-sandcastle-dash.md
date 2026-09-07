# PRD 010: sandcastle-dash — a terminal dashboard for the goal-template loop

Date: 2026-09-06

## Problem

Watching the loop means reading a scrolling terminal, or opening the
web control panel a dogfooding repo grew for its VPS (a Node server plus
a browser tab). With the loop running on the owner's own machine the
browser is the wrong shape: the owner lives in a terminal, and the
question is always the same three things — _what is running right now,
what just finished and how did it go, and what is queued and why is it
waiting._ The panel answers them, but only through HTTP, only from a
browser, and with logic nobody can unit-test.

## Goals

- One full-screen terminal app, `sandcastle-dash`, that answers those
  three questions at a glance and refreshes on its own.
- Reads what the goal template already writes — `.sandcastle/logs/*.log`
  and `timings.jsonl` — plus `gh` and `git`, from the local checkout.
  Nothing needs to be running for it to work.
- Same stack, look and structure as `claude-usage-tui`: Python ≥ 3.12,
  Textual, the gruvbox theme, numbered collapsible sections, per-section
  refresh timers, a `--once` plain-text snapshot, pure analysis modules
  under a thin app, pytest over fixtures.
- Ships in this fork under `dash/` as its own uv-installable package,
  independent of the TypeScript library.

## Non-goals

- Starting or stopping the loop. Read-only in v1.
- Remote repositories. It reads the filesystem it runs on; a VPS is
  watched over ssh with the same command.
- A log viewer. Each live agent shows its last log line; the log file
  path is printed so `tail -f` is one paste away.
- Replacing the web control panel. It stays for the VPS deployment.
- Templates other than the goal template. The log names and timings
  phases parsed here are that template's; others degrade to "no runs".

## Requirements

### Locating the repo

1. With no arguments, walk up from the current directory to the first
   ancestor containing `.sandcastle/logs`. `--repo <path>` overrides.
   No such directory: the Now section says so and every other section
   shows what it can (the queue still works from `gh`).

### Run records (`logs.py`)

2. A run is one `--- Run started: <iso> ---` block of a log file; a
   file with content but no marker is one block. The log name gives the
   role and issue: `sandcastle-issue-<n>-<role>.log`,
   `main-<role>.log`, anything else is role = stem, no issue.
3. A run matches the `timings.jsonl` entry with the same phase and
   issue whose start (`ts - ms`) is within 15 s of the block's start.
   The issue check is load-bearing: parallel lanes start the same phase
   seconds apart.
4. Status, in this order: a matched timing entry decides success or
   failure and supplies the end time; else a `Run complete|failed|
aborted` line decides; else a trailing `Node.js v…` crash dump is
   failed; else the last block of a file modified within the last three
   minutes is running; else interrupted. End time falls back to the last
   `[HH:MM:SS]` stamp resolved against the block's start date with
   midnight rollover.
5. Each record carries: file, block index, role, issue, status, started,
   ended, duration, the last `Iteration i/n`, the last `Context window`,
   the last non-empty line (trimmed to 220 chars), last-activity instant
   (mtime while running), and for failed or interrupted runs the first
   line that looks like an error (`FooError`, `error:`, `failed:`).
6. ANSI escapes are stripped before parsing. Unreadable files are
   skipped, never fatal.

### Time breakdown (`breakdown.py`)

7. Every stamped line of a run is an event whose duration is the gap to
   the next stamp (the last event of an unfinished run extends to now,
   capped at 30 min). Events are categorized exactly as the panel does:
   `verify` (validate, playwright, vitest, npm test, typecheck, tsc),
   `edit` (Edit/Write/MultiEdit/NotebookEdit), `explore` (Read/Grep/Glob
   and read-only shell commands), `git` (git, gh), `other` (lifecycle
   lines: Iteration, Reusing, Agent started/stopped, Capturing, Syncing,
   Collecting, Run complete, Context window, Agent signaled), and
   `think` for everything else (narration between tool calls).

### Orchestrator (`orchestrator.py`)

8. The loop is running when a process whose command line contains
   `.sandcastle/main.ts` exists; its start time comes from `ps`. The
   current iteration is the count of planner runs started since that
   instant (1 if none yet). When not running, the most recent run of
   any role gives "last activity".

### GitHub (`gh.py`)

9. Issues come from one GraphQL query (the panel's): number, title,
   state, url, timestamps, labels, parent, sub-issues — newest updated
   first, 100 max. PRs from `gh pr list --state all --limit 50` with
   linked issues parsed from `issue-<n>` in the branch and `#<n>` in
   the title. Merges from `git log --since=14 days --first-parent` on
   the default branch, subjects matching `merge issue(s) #`.
10. Every `gh`/`git` call has a timeout. A failure keeps the previous
    value and reports the error in the section title; it never blanks a
    list the user already had.

### Configuration (`config.py`)

11. `EFFORT_TIERS`, `AGENT_TIERS` and `SPEC_DIR` are read from
    `.sandcastle/config.mts` by regex over their literal blocks. Any
    miss yields `None`; consumers then show tiers from labels only and
    "held" as unknown. Never executes the config.

### Issue queue (`queue.py`)

12. Rows are the open issues carrying the trigger label `sandcastle`,
    plus `sandcastle:requires-prd` parents with their open sub-issues
    nested one level. Each row: number, title (trimmed), effort tier
    (highest `sandcastle:effort-<tier>` label, else the first configured
    tier, else "—"), flags (`pr` for require-pr / agent-approve, `prd`,
    `release`), age since creation, stage.
13. Stage is the first that applies: **held** — the tier the issue
    needs is above what any issue-path agent (spec-writer, implementer,
    reviewer, merger, conflict-resolver; plus pr-reviewer, addresser for
    pr-flagged issues) is configured at; **working <role>** — a running
    run names the issue; **ready to merge** — label
    `sandcastle:ready-to-merge`; **PR <status>** — an open PR links the
    issue, status from its `sandcastle:in-review|ready|needs-decision`
    label or `approved` from `sandcastle:approved`; **implemented** —
    the local branch `sandcastle/issue-<n>` has commits ahead of the
    default branch; **spec'd** — `<SPEC_DIR>/issue-<n>.md` exists;
    **queued** otherwise. Failed last run on the issue appends `✗ <role>`.
14. Order: working first, then held, then everything else by issue
    number ascending.

### Stats (`stats.py`)

15. From `timings.jsonl` over the last 7 days, per phase: runs, success
    rate, median and max duration. From run records over the last 24 h:
    category totals as a percentage bar. Per day for 7 days: runs
    started and issues merged (from merge commits), as a two-row text
    strip.

### The app (`app.py`)

16. Four `Collapsible` sections in a `VerticalScroll`, gruvbox theme,
    Footer with bindings: `1`–`4` toggle, `r` refresh all, `q`/`Esc`
    quit. Each title reads `<name> · <summary> · updated HH:MM:SS`, with
    `· <error>` appended when its source failed.
17. **Now** (5 s): status line — `● running · iteration N · since HH:MM
(Xm ago)` or `○ idle · last run <role> #<issue> <status> Xm ago` —
    then one row per running run: role, `#issue title`, elapsed,
    iteration, context window, last line; and the log path below the
    table in dim text.
18. **Recent runs (24h)** (5 s): newest first, 40 rows max: glyph
    (✓ ✗ ● ○ for success, failed, running, interrupted), role, issue,
    started `HH:MM`, duration, and the error line for failures in red.
19. **Issue queue** (45 s): the rows of Req 12–14 as a table; sub-issues
    indented under their parent; held rows in yellow with the short
    agents named; working rows in green.
20. **Stats (7d)** (120 s), collapsed by default: the phase table, the
    breakdown bar with a legend, and the per-day strip.
21. Loads run in threads (`run_worker(thread=True, exclusive=True)`),
    one group per section, results applied with `call_from_thread`. A
    section that fails to load keeps its last content.

### Snapshot

22. `sandcastle-dash --once` prints Now, Recent runs and Issue queue as
    plain text (Rich console, width 110) and exits 0. `--version`
    prints the package version.

### Packaging and tests

23. `dash/pyproject.toml`: name `sandcastle-dash`, `textual>=1.0`,
    script `sandcastle-dash = sandcastle_dash.app:main`, hatchling,
    `requires-python >= 3.12`, dev group `pytest>=8`. Install with
    `uv tool install --editable ./dash`.
24. `dash/tests/` covers every pure module with fixture logs under
    `dash/tests/fixtures/` (sanitized excerpts of real goal-template
    logs: a successful implementer, a failed planner, a running block
    without markers, a crash dump, a midnight rollover), a timings
    excerpt, a GraphQL issues payload, and a config.mts excerpt.
25. `dash/README.md` documents install, keys, sections, data sources,
    and what is deliberately not there (Non-goals). README-FORK.md gains
    a section naming `feat/dash`; FORK-MANUAL.md's cheat sheet gains the
    command.

## Open questions

None. Decisions taken: 24 h run window and 7 d stats window; Stats
collapsed by default; a `--once` mode; no start/stop; last line only.
