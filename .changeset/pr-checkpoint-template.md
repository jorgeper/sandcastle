---
"@ai-hero/sandcastle": minor
---

New `parallel-planner-with-pr-review` template: issues labeled `sandcastle:require-pr` publish a GitHub PR (description written by the implementer's own resumed session) and enter an outer `pr-reviewer` ⇄ `addresser` agent debate in the PR's review threads, with every agent action attributed via `**[agent · harness · model]**` markers. Everything runs as the owner's single identity; the merge gate is code-enforced — the owner adds the `sandcastle:approved` label and all review threads must be resolved before the orchestrator squash-merges and closes the issue. Deadlocked debates escalate as `⚠️ NEEDS-DECISION` threads for the owner to arbitrate. Unlabeled `sandcastle` issues keep the `parallel-planner-with-review` flow (inner reviewer + local merge). The template's `main.mts` also gains `--init` (label vocabulary), `--doctor` (env/auth/docker/label checks), and `--help` commands.
