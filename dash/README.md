# sandcastle-dash

A gruvbox-themed terminal dashboard for the Sandcastle goal-template loop.
One screen, four collapsible sections, auto-refreshing. It answers three
questions at a glance: _what is running right now, what just finished and
how did it go, and what is queued and why is it waiting._

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

| Key | Section               | Shows                                                                                                                                        | Refresh |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `1` | **Now**               | Whether the loop is running (iteration, since when) and every agent in flight: role, issue, elapsed, attempt, context window, last log line. | 5 s     |
| `2` | **Recent runs (24h)** | Every agent run of the last day: outcome, role, issue, start, duration, and the error line for failures.                                     | 5 s     |
| `3` | **Issue queue**       | Open `sandcastle` issues with effort tier, flags, age and stage: held, working, ready to merge, PR status, implemented, spec'd, queued.      | 45 s    |
| `4` | **Stats (7d)**        | Per-phase runs, success rate, median and max; where agent time went in the last 24 h; runs and merges per day. Collapsed by default.         | 120 s   |

Other keys: **Esc**/`q` quit · `r` refresh everything now.

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

Everything is local. Nothing leaves the machine except the `gh` calls you
already make.

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
