---
"@ai-hero/sandcastle": patch
---

Goal template: while any timed phase is active, the console prints a "⏳ still running: implementer(issue=22) 12.3m, …" heartbeat every two minutes. Long parallel phases previously left the console silent for 20+ minutes, which reads as a hang.
