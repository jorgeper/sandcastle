---
"@ai-hero/sandcastle": patch
---

Goal-template loop efficiency: the merger skips re-verifying fast-forward merges (the tree is identical to the already-gated branch tip), the planner is skipped when there is exactly one candidate issue, and the implementer skill requires the final verify gate to run in the foreground (backgrounding it and ending the turn orphaned the suite and wasted the attempt).
