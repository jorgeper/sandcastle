---
"@ai-hero/sandcastle": patch
---

Tiered verification: attempt-start baselines use the quick tier only. Implementers were running the full `VERIFY_COMMANDS` suite at the start of each attempt to assess inherited state, doubling full-suite cost per attempt. The implementer skill and spec prompt now reserve the full suite exclusively for the single pre-completion gate.
