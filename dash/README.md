# sandcastle-dash

A gruvbox-themed terminal dashboard for the Sandcastle goal-template loop.
One screen, six collapsible sections, auto-refreshing. It answers four
questions at a glance: _how much of my rate limits are left, what is running
right now, what just finished and how did it go, and what is queued and why
is it waiting._

```
▼ Now · running · 2 agents · updated 12:24:51
  ● running · iteration 3 · since 11:59 (25m ago)
  agent        issue  elapsed  attempt        ctx  last line
  reviewer     #319    2m 20s  Iteration 1/1    —  [19:25:02] Bash(grep -n '"lint' package.json)
  implementer  #320   11m 04s  Iteration 1/4  61k  Edit(src/lib/settings.ts)

▼ Recent runs (24h) · 204 runs · 1 failed · updated 12:24:51
     agent        issue  started     took
  ●  reviewer     #319     12:23  running  Iteration 1/1
  ✓  implementer  #318     12:01  20m 33s  Iteration 1/4
  ✗  planner      main     09:12      12s  Git worktree operation failed: …
```

## Sections

| Key | Section                | Shows                                                                                                                                                                                                                                                                                    | Refresh                                   |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `1` | **Rate limits**        | The account's meters from the OAuth usage endpoint (Session 5h, Week all models, Week Opus/Fable) with reset countdowns, a warning when a meter is on pace to hit 100% before it resets, and the last hour's burn (output tokens/min, API-equivalent $/h, calls) from local transcripts. | 30 min, backing off to 2 h after failures |
| `2` | **Now**                | Whether the loop is running (iteration, since when) and every agent in flight: role, issue, elapsed, attempt, context window, last log line.                                                                                                                                             | 5 s                                       |
| `3` | **Recent runs (24h)**  | The newest 15 agent runs of the last day: outcome, role, issue, start, duration, and the error line for failures. The title counts the whole day.                                                                                                                                        | 5 s                                       |
| `4` | **Issue queue**        | Open `sandcastle` issues with effort tier, flags, age and stage: held, working, ready to merge, PR status, implemented, spec'd, queued.                                                                                                                                                  | 45 s                                      |
| `5` | **Resolved (last 10)** | The ten most recently closed `sandcastle` issues, newest first, with tier, how long ago they closed, and the merge commit that landed them (and which issues merged alongside).                                                                                                          | 45 s                                      |
| `6` | **Stats (7d)**         | Per-phase runs, success rate, median and max; where agent time went in the last 24 h; runs and merges per day. Collapsed by default.                                                                                                                                                     | 120 s                                     |

Other keys: **Esc**/`q` quit · `r` refresh everything now · `o` open the
newest run's issue in the browser.

While an agent is in flight the **Now** section shows three signals, each
derived from data rather than a clock: a heartbeat dot that lights when a log
line lands and fades to hollow after ten seconds of silence; the elapsed time
as a bar against that phase's 7-day median (yellow once past the median, red
past the max); and, under the table, a five-minute sparkline of log lines per
30 seconds followed by the agent's last three log lines. It redraws from
cached data twice a second and reads nothing from disk between reloads.

The Now section uses the same category colors as the Stats bar, so olive
always means tests, teal reading, yellow editing, pink git, orange thinking:
each sparkline cell takes the color of that half-minute's dominant category,
each recent log line is colored by its own category, and a "doing" label after
the sparkline names the newest line's category and how long ago it landed
("thinking 2m 10s" is the one to watch). A legend sits under the block.

### Clickable issues and PRs

Every `#123` in the tables is a link, two ways at once:

- **Click it.** Textual handles the mouse itself, so a plain click opens the
  issue (or PR) in your browser in any terminal with mouse support.
- **Cmd/Ctrl+click it.** The same text carries an OSC 8 hyperlink, which
  iTerm2, Kitty, WezTerm and Ghostty underline on hover and open natively.

The repository URL comes from `git remote get-url origin`; with no remote the
numbers render as plain text. `--once` output is plain text and cannot carry
links, so it prints the URL pattern once at the end instead.

## Install

Requires Python ≥ 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
uv tool install --editable ./dash      # from the sandcastle checkout
sandcastle-dash                        # inside any repo with .sandcastle/logs
sandcastle-dash --repo ~/src/my-app    # or point it somewhere
sandcastle-dash --once                 # plain-text snapshot, script friendly
```

## Data sources

- **Runs** are parsed from `.sandcastle/logs/*.log` (`--- Run started ---`
  blocks; the file name gives role and issue) and matched to
  `timings.jsonl`, the loop's authority on outcome and duration. A block
  with no outcome whose file changed in the last three minutes is
  _running_; older ones are _interrupted_.
- **The loop** is a `tsx .sandcastle/main.ts` process; `ps` gives its
  start time and planner runs since then count iterations.
- **Issues and PRs** come from `gh` (one GraphQL query for issues with
  sub-issues; `gh pr list`); merges from `git log`. A failed call keeps the
  last good value and names the error in the section title.
- **Effort tiers** are read from `.sandcastle/config.mts` by regex
  (`EFFORT_TIERS`, `AGENT_TIERS`, `SPEC_DIR`); the file is never executed.
- **Rate limits** come from `https://api.anthropic.com/api/oauth/usage`,
  authenticated with the Claude Code OAuth token read from the macOS keychain
  (`security find-generic-password -s "Claude Code-credentials"`), the same
  call Claude Code makes for its own `/usage`. Polled every 30 minutes,
  doubling up to 2 hours after a failure; a failure keeps the last meters and
  names the error in the title. The exhaustion warning extrapolates the last
  eight samples linearly.
- **Burn** reads `~/.claude/projects/**/*.jsonl` transcripts, but only files
  modified in the last 65 minutes, and prices them at API rates (table cached
  2026-09). Agents run in containers, so their sessions show up here once
  Sandcastle captures them to this machine, not mid-flight.

Everything is local. Nothing leaves the machine except the `gh` calls and the
usage-endpoint call Claude Code already makes.

## Not here on purpose

No start/stop of the loop, no log viewer (each live agent prints a
`tail -f` line), no remote mode (ssh in and run it there).

## Develop

```bash
cd dash && uv run pytest -q
uv run sandcastle-dash --repo ~/src/some-repo
```

Layered like `claude-usage-tui`: `logs.py` / `config.py` / `gh.py` parse,
`breakdown.py` / `orchestrator.py` / `queue.py` / `stats.py` analyse (all
pure, all unit-tested over `tests/fixtures/`), `panels.py` renders,
`app.py` is the Textual shell and `snapshot.py` the `--once` output.
