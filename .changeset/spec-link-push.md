---
"@ai-hero/sandcastle": patch
---

goal template: the spec writer's SHA-pinned issue link no longer 404s for non-PR issues. The spec commit was pushed immediately only in PR mode; plain auto-merge issues merge locally and only reach origin at the end of a successful run — never when the goal isn't met — leaving the `blob/<sha>` link dead for the whole window (or forever). The spec commit's branch is now pushed right after the spec step in every mode, matching the comment's stated intent.
