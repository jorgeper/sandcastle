---
"@ai-hero/sandcastle": patch
---

Goal template: a locally missing branch is never treated as "merged". A
`sandcastle:ready-to-merge` issue whose branch does not exist in the host
checkout (the lane died before its work synced back) is re-queued for a
fresh implementation instead of being carried to merge and closed, and the
post-merge close safety net skips issues whose branch has vanished.
