---
"@ai-hero/sandcastle": patch
---

parallel-planner-goal-with-pr-review: the merge phase now derives its input from git state, not just the current cycle's results. Previously, if a run died between implementing and merging, the next run's implementer verified the work as already done (goal met, zero new commits), the commit-count filter excluded the branch, and the issue re-classified as `implement` forever. Legacy branches ahead of the target branch now merge even when the cycle produced no new commits; PR-mode branches still never merge locally.
