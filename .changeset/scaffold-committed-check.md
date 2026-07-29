---
"@ai-hero/sandcastle": patch
---

goal template: the doctor now checks that the implementer skill is committed, and the main loop warns at startup when it isn't. Sandbox worktrees branch from committed history, so an uncommitted `.claude/skills/sandcastle-implementer/SKILL.md` silently strips goal-mode implementers of their process rules (single 🏰 comment when complete, prior-attempt awareness) — init said "commit it" once and nothing ever checked again. The doctor distinguishes "exists but uncommitted" from "missing" with the exact fix commands; the main-loop warning is a nudge, never a gate.
