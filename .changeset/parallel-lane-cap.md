---
"@ai-hero/sandcastle": minor
---

Goal template: `MAX_PARALLEL_LANES` in `.sandcastle/config.mts` caps how
many implementer lanes run concurrently per cycle (default 2). Issues
beyond the cap stay open and re-enter as candidates on the next iteration,
so nothing is dropped — sized for the host rather than for the planner's
output.
