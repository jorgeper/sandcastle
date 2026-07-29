---
"@ai-hero/sandcastle": patch
---

Agents now read the full issue thread, not just the body snapshot: the conversational-prd filer starts by running `gh issue view --comments` (human replies filed after capture — repro details, logs, screenshots — were previously invisible to it), and the goal template's spec writer fetches the issue with `--comments` (the plain `gh issue view` it used drops comments). Both prompts note that image attachments may not download from the sandbox, so the filer asks what a load-bearing screenshot shows instead of guessing.
