---
"@ai-hero/sandcastle": minor
---

Goal mode: `run()` and `createSandbox().run()` accept `goal` (a completion condition judged after every turn by Claude Code's native `/goal` engine) plus `goalMaxTurns` (inner turn bound per iteration, default 25), and results carry `goalMet`. Each iteration becomes a full autonomous, self-verifying attempt; Sandcastle's fresh-context reset still applies between attempts (ADR 0021). `goal` is mutually exclusive with `prompt`/`promptFile`; providers without native goal support throw `GoalNotSupportedError`. Ships with the `parallel-planner-goal-with-pr-review` template, where a spec writer distills each issue into a committed spec + goal statement and the implementer runs against it in goal mode.
