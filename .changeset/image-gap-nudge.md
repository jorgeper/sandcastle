---
"@ai-hero/sandcastle": minor
---

goal template: image-gap nudge (prd/006). At the end of each main-loop run, this run's logs are scanned for expensive in-sandbox installs (Playwright browsers, apt/apk/dnf/yum packages, global npm installs — never plain worktree `npm install`), tallied per signature across runs in `.sandcastle/install-tally.json`, and surfaced as one warning line per install naming the Dockerfile fix. The doctor gains an "image gaps" check merging the tally with a live scan of all logs, so interrupted or still-running loops can't hide the evidence. Rebuilding the image resets the tally (tracked by image id) — the rebuild is the fix, so stale counts never nag. Conversation logs are excluded (keep-alive sandboxes amortize installs across turns). Best-effort and nudge-only: scan failures are swallowed, nothing blocks, nothing edits the Dockerfile.
