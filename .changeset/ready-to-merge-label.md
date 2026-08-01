---
"@ai-hero/sandcastle": patch
---

Goal template: a verified branch survives a crash without re-implementation. When an implementer's goal is judged met (legacy path), the orchestrator applies a `sandcastle:ready-to-merge` status label to the issue. If the run dies before the merge phase (crash, Ctrl-C), the next cycle routes labeled issues straight to the merger instead of dispatching a fresh implementer attempt — which re-ran the full verify gate just to re-prove finished work. Labeled issues whose branch is already fully merged are closed directly.
