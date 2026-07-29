---
"@ai-hero/sandcastle": patch
---

conversational-prd template: a dictated paragraph no longer becomes an issue title verbatim. Both filing paths (design.ts topics — which previously applied no limit at all — and issue.ts captures) derive the title through a shared `summarizeTitle` helper: whitespace collapsed, first sentence when it fits, otherwise a word-boundary truncation with an ellipsis (the full report still lands in the body). The designer is additionally instructed to retitle the issue with a concise feature name once it understands the work — the mechanical summary is only the placeholder until the agent's better one.
