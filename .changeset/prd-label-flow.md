---
"@ai-hero/sandcastle": minor
---

Label-routed PRD lane in the goal template: label an issue
`sandcastle:requires-prd` and the main loop nudges you to run the new
issue-anchored `/new-prd` skill (grills you, opens a PRD PR on
`prd/issue-<N>-<slug>`), merges the PR once you approve it, autonomously
decomposes the PRD into `Sandcastle` sub-issues, and closes the parent
when they all finish. `npm run sandcastle:init` provisions the new label.
