---
"sandcastle-local": minor
---

Support Copilot native session capture/resume and durable conversations.
Add opt-in goal mode with an explicit independent verifier model, bounded
autopilot continuations, and fail-closed verdict handling. Preserve worker
sessions before verification, use current reasoning/permission flags, and
reject unsupported session forking. Include an offline native-CLI smoke
test for persistence and cross-home resume without account credentials.
