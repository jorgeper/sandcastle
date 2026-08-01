# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Routing labels (conversational lanes)

Canonical labels that route an issue to a pipeline lane (prd/005). The label
picks the agent; the lane's script picks up its labeled issues:

| Label                     | Meaning                                             | Picked up by                                           |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `sandcastle:design`       | Needs a PRD; grill the owner                        | `design.ts` (conversational-prd)                       |
| `sandcastle:decompose`    | Merged PRD needs an issue breakdown                 | `decompose.ts` (conversational-prd)                    |
| `Sandcastle`              | Implementer-ready work item                         | the main loop                                          |
| `sandcastle:requires-prd` | Needs an approved PRD PR before decompose/implement | `main.mts` PRD lane (goal template) + `/new-prd` skill |

Routing labels only — no state labels. GitHub-native state (issue open/closed,
PR merged, `Closes #N`) carries progress.

---

When triaging or implementing requests for new agent CLI support (e.g. gemini-cli, cursor), see `docs/agents/adding-an-agent-provider.md` — it lists the CLI/output capabilities a new agent must satisfy and the files to touch.
