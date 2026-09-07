---
"@ai-hero/sandcastle": minor
---

`sandcastle-dash`: a terminal dashboard for any repo running the goal
template, shipped under `dash/` and installed with
`uv tool install --editable ./dash`. Six auto-refreshing sections: rate
limits (Session/Week meters, reset countdowns, last-hour burn), the running
loop and its agents (heartbeat, elapsed vs the phase median, a category-
colored activity sparkline and the last log lines), the newest 15 runs with
outcomes and errors, the issue queue with effort tiers and a stage per
issue, the last 10 resolved issues with their merge commits, and 7-day
stats. Issue and PR numbers are clickable. Reads `.sandcastle/logs` plus
`gh`/`git`; `--once` prints a plain-text snapshot. See `dash/README.md`.
