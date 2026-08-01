---
"@ai-hero/sandcastle": minor
---

Timing instrumentation for diagnosing slow runs. File logs now prefix every line with a `[HH:MM:SS]` UTC timestamp, so the gap between consecutive entries (tool calls, status lines, streamed prose) reads as the duration of the step between them. The orchestrator logs `Agent stopped after Xs` and `Iteration N finished in Xs` per attempt. The goal template wraps every agent run (planner, spec-writer, implementer, reviewer, pr-writer, pr-reviewer, addresser, conflict-resolver, merger) in a `timed()` helper that prints timestamped start/finish lines and appends a JSON line per phase to `.sandcastle/logs/timings.jsonl` for offline analysis.
