---
"@ai-hero/sandcastle": minor
---

`parallel-planner-with-review` + GitHub Issues now scaffolds a PRD-driven workflow: a `prd/TEMPLATE.md`, and `/new-prd` + `/decompose-prd` Claude Code project skills that take a feature from grilled PRD to a parent issue with Sandcastle-labeled, dependency-ordered sub-issues. The implement prompt reads the PRD via a `**PRD:**` body line, and the merger closes a parent once all its sub-issues are closed.
