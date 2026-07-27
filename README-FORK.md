# Fork changes

This is [jorgeper/sandcastle](https://github.com/jorgeper/sandcastle), a fork
of [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle). This
file records every functional change the fork carries on top of upstream —
one section per change, newest first. Each section names the `feat/*` branch
that implemented it, so any change can be proposed upstream from its branch.

## /new-prd offers to install grilling skills (`feat/new-prd-grilling-install`)

Follow-up to the PRD-driven workflow: when no `/grilling` or `/grill-me`
skill is installed, the scaffolded `/new-prd` skill now tells the user those
come from [mattpocock/skills](https://github.com/mattpocock/skills) and
offers to install the collection for them on a yes, running the
non-interactive Claude Code plugin commands
(`claude plugin marketplace add mattpocock/skills` followed by
`claude plugin install mattpocock-skills@mattpocock`). Since plugin skills
may not be visible until the next session, the skill still conducts the
interview inline this time either way.

## PRD-driven workflow (`feat/prd-integration`)

Adds the missing front half of the pipeline: a defined path from _idea_ to
_Sandcastle-labeled issues_. Upstream starts at "open labeled issues";
this change defines how those issues come to exist.

**What was added**

- `src/PrdWorkflow.ts` — scaffold module holding a PRD template and two
  Claude Code project skills as content constants, written into the user's
  repo by `sandcastle init` (never overwriting existing files). Delivered
  through init because that is sandcastle's only hook into a user repo — the
  template copier only targets `.sandcastle/`, while skills must land at
  `.claude/skills/`. Scaffolded only for `parallel-planner-with-review` +
  GitHub Issues + label creation enabled.
- `/new-prd` skill — wraps a grilling interview: invokes the user's
  `/grilling` / `/grill-me` skill when installed (it is a per-machine plugin,
  so the scaffolded skill cannot depend on it), otherwise inlines equivalent
  one-question-at-a-time interview instructions. Output: `prd/NNN-slug.md`
  from `prd/TEMPLATE.md`, committed.
- `/decompose-prd` skill — reads a PRD, proposes a breakdown in-session,
  and only after explicit approval creates **one parent issue** (links the
  PRD, never labeled `Sandcastle`) plus **N ≥ 1 sub-issues** (labeled,
  acceptance criteria, `Blocked by #N` edges, `**Parent:** / **PRD:**` body
  lines, linked via GitHub's sub-issues API). The label on children is the
  release gate; the parent is the human-facing progress tracker.
- Prompt updates: the implementer resolves the PRD deterministically from the
  `**PRD:**` body line; the merger closes a parent once all its sub-issues
  are closed.

**The workflow end to end**

1. Interactive grill session: `/new-prd` interviews you about the idea.
2. Once you are happy, the PRD is committed to `prd/NNN-slug.md`.
3. `/decompose-prd prd/NNN-slug.md` proposes the issue tree; after your
   interactive approval it creates the parent issue and labeled sub-issues.
4. `npm run sandcastle` implements: the planner works only unblocked labeled
   children, dependency edges stage the rest across merge rounds, and the
   orchestrator is completely unchanged.

Design: `prd/001-prd-driven-workflow.md`. Plan:
`plans/2026-07-26-prd-driven-workflow.md`.

## Issue audit trail (`feat/issue-audit-trail`)

Each agent in `parallel-planner-with-review` now records what it did as a
comment on the GitHub issue it worked, giving every issue a full trace of the
automated work done on it (commit `524c27c`):

- Adds a `COMMENT_TASK_COMMAND` placeholder to the issue-tracker registry
  (github-issues, beads, custom) alongside VIEW/CLOSE.
- Implementer: one concise summary comment on completion (done / decisions /
  files). Reviewer: one comment (changed / no changes needed) — the reviewer
  now receives `TASK_ID` so it can target the right issue. Merger: a
  per-issue merge summary comment before closing.
- Custom-tracker setup doc and InitService tests updated for the new command.
