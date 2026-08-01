---
"@ai-hero/sandcastle": minor
---

Run-performance analysis skill and tiered verification for the goal template. `sandcastle init` now scaffolds a `sandcastle-analyze` skill that reads `.sandcastle/logs/timings.jsonl` and the timestamped agent logs, computes where wall-clock time went (phase totals, slowest steps, test-run census, sandbox overhead, install waste), and proposes config/Dockerfile changes with evidence. New `QUICK_VERIFY_COMMANDS` knob in `config.mts`: a fast inner-loop subset agents run while iterating, with the full `VERIFY_COMMANDS` reserved for a single gate before work is declared done (empty list = no tiering, previous behavior). Doctor validates the quick list's scripts too.
