---
"@ai-hero/sandcastle": minor
---

Agent-approved PRs in the goal template: label an issue
`sandcastle:agent-approve` (implies PR mode) and the `pr-reviewer` agent
signs off in your place — it posts a marked approval comment and adds
`sandcastle:approved` once it has nothing outstanding and every review
thread is resolved, so the next run merges without waiting for you.
Deadlocked threads still escalate to `sandcastle:needs-decision`, and
GitHub review approvals remain forbidden in every mode. Both reviewers now
apply one shared review bar (`.sandcastle/review-checklist.md`), referenced
by `review-prompt.md` and `pr-review-prompt.md`, so a PR review and a
branch review check for the same things. `npm run sandcastle:init`
provisions the new label.
