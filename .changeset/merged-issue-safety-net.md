---
"@ai-hero/sandcastle": patch
---

Goal template: a merged-but-unclosed issue no longer re-dispatches forever. When the goal judge verifies work as done with zero new commits and the branch is fully merged, the orchestrator closes the issue deterministically (the failure mode was a merger run that merged the branch but missed the close, so the classifier re-ran the implementer — and its full verify gate — every cycle). The merge phase now also verifies each merged issue was actually closed. PR-mode issues whose commits came from prior attempts now still get their PR opened (shippable work is the branch delta vs the target, not the current run's commits).
