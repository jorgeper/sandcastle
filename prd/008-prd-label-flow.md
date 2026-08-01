# Label-routed PRD flow: humans file issues, one orchestrator runs everything

**Date:** 2026-08-01
**Status:** Approved design, pre-implementation
**Branch:** `feat/prd-label-flow`

## Motivation

The conversational-prd path (prd/004, prd/005) works, but it has two
properties the owner no longer wants as the default:

1. **Agents create entry-point issues.** `design.ts "idea"` files the
   design issue on the owner's behalf. The owner's principle going forward:
   the human files every entry-point issue; agents only create derived
   issues (the decomposer's sub-issues).
2. **Orchestration is spread over three scripts.** Getting a feature from
   idea to implemented means running `sandcastle:design`,
   `sandcastle:decompose`, and `npm run sandcastle` in the right order.
   The owner wants exactly one orchestration command — `npm run
sandcastle` — with every lane's state visible from that one run.

This PRD adds a **parallel path** (the conversational-prd scripts are
untouched and keep working) built from two pieces:

- A rewritten **`/new-prd` Claude Code skill** — interactive grilling
  happens in Claude Code on the owner's machine, wrapping the
  `/grilling` / `/grill-me` skill, anchored to an issue the owner already
  filed. Its output is a PRD PR linked to that issue.
- A **PRD lane in the goal-template main loop** — `main.mts` classifies
  every `sandcastle:requires-prd` issue from pure GitHub state and does the
  one mechanical thing that state calls for: nudge, merge, decompose, or
  close. No conversation store involvement.

## Label taxonomy

One new label, alongside the existing family:

| Label                            | On    | Meaning                                          |
| -------------------------------- | ----- | ------------------------------------------------ |
| `sandcastle:requires-prd`        | issue | Needs an approved PRD before decompose/implement |
| `Sandcastle` (existing)          | issue | Implementer may pick up                          |
| `sandcastle:approved` (existing) | PR    | Owner approval; the script merges                |

The owner labels a feature issue `Sandcastle` + `sandcastle:requires-prd`.
An issue carrying `sandcastle:requires-prd` is **never implemented
directly** — the implementer's pickup query excludes it, whatever other
labels it has. The label is provisioned by `npm run sandcastle:init` (it
joins the template's `ALL_LABEL_DEFS`); human-applied labels are never
created behind the owner's back.

## The state machine (PRD lane in `main.mts`)

Every run, before implementation, the main loop classifies each open issue
labeled `sandcastle:requires-prd` from GitHub state alone:

| State                                                                 | Action                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| No PRD PR                                                             | Nudge: "issue #N needs a PRD — run `/new-prd` in Claude Code" |
| Open PRD PR, not approved                                             | Nudge: "awaiting your review of <PR url>"                     |
| Open PRD PR with `sandcastle:approved` label (or an approving review) | Squash-merge the PR (delete branch), then decompose           |
| PRD PR merged, no sub-issues                                          | Decompose (also the crash-recovery path)                      |
| Sub-issues exist, some open                                           | Nothing — sub-issues flow through the normal implement lane   |
| Sub-issues exist, all closed                                          | Close the parent with a marker comment                        |

Rules:

- **PRD approval is the only human gate.** Decompose runs autonomously
  once the PRD PR is approved; the decomposition is not separately
  approved. (The conversational `decompose.ts` keeps its APPROVED gate;
  this lane deliberately drops it.)
- **Merge convention unchanged:** the owner labels, the script merges.
  Never the agent, never the human by hand.
- **Auto-close closes once.** The parent is closed only when at least one
  sub-issue exists and all are closed, and only if the marker close
  comment is not already present — a manually-reopened parent is left
  alone.
- Nudges are collected and printed with the run's other guidance; the lane
  never blocks implementation of unrelated `Sandcastle` issues.

## PR ↔ issue linkage

Detection is the **head branch name**: a PRD PR for issue `#N` lives on
branch `prd/issue-<N>-<slug>`. The main loop finds an issue's PRD PR by
listing PRs in any state whose head ref matches `prd/issue-<N>-`.
Stateless, deterministic, crash-safe, no comment parsing. (Note the PRD
_file_ keeps its own independent `prd/NNN-` numbering; branch `N` is the
issue number.)

The PR body says "PRD for #N" — deliberately **not** `Closes #N`: the
issue must outlive the merge to become the decompose parent. The skill
also comments the PR URL on the issue, but that comment is for humans;
detection never depends on it.

## The `/new-prd` skill (rewritten, issue-anchored)

Scaffolded by `PrdWorkflow.ts` into `.claude/skills/new-prd/SKILL.md` for
the `parallel-planner-goal-with-pr-review` template (GitHub tracker +
label created, same gating as today's scaffold). The existing local-only
`/new-prd` content continues to ship unchanged for
`parallel-planner-with-review`.

Skill flow:

1. **Target resolution.** With an argument (issue number or URL), use that
   issue. With no argument, list open `sandcastle:requires-prd` issues
   that have no PRD PR (branch probe above) and offer a picker.
2. **De-escalation check.** If early grilling shows no PRD is needed,
   offer to remove `sandcastle:requires-prd` so the plain implement lane
   takes the issue. On agreement: remove the label, comment why, stop.
3. **Grill.** Invoke `/grilling` or `/grill-me` if available. If not,
   offer to install Matt Pocock's skills plugin (same instructions as the
   current skill); after installing — or on decline — grill inline:
   relentless one-question-at-a-time interview, recommended answer first,
   facts from the repo, only decisions to the human.
4. **Write.** `prd/NNN-<kebab-slug>.md` (next free NNN, `prd/TEMPLATE.md`
   structure, every section filled) on branch `prd/issue-<N>-<slug>`.
5. **Open the PR.** Title "PRD NNN: <title>"; body: one-paragraph summary
   plus the "PRD for #N" line (never `Closes`). Push, open PR, comment the
   PR URL on the issue.
6. **Hand off.** Tell the owner: review the PR; approve with
   `gh pr edit <url> --add-label "sandcastle:approved"`; then run
   `npm run sandcastle` — it merges, decomposes, and the sub-issues flow
   from there.

**Feedback mode:** pointed at an issue that already has an _open_ PRD PR,
the skill switches to addressing feedback — fetch the PR's comments and
reviews, revise the PRD, push to the same branch, reply on the threads.
The PR thread is the memory; no conversation store. Pointed at an issue
whose PRD PR is already _merged_, the skill does nothing but say so and
point at `npm run sandcastle` (decompose is the orchestrator's job).

## Decomposer step (inline, autonomous)

A sandboxed agent step in `main.mts` (same mechanics as the spec-writer:
non-interactive, prompt file + args, own commit-free run). Input: parent
issue number + merged PRD path (recovered from the merged PR's changed
files). The agent itself creates the issues via `gh` — per the owner's
principle, derived issues are the one thing agents may file:

- One sub-issue per implementable unit, labeled `Sandcastle`, acceptance
  criteria lifted from the PRD's numbered Requirements, body carrying the
  load-bearing `**Parent:** #N` and `**PRD:** prd/NNN-<slug>.md` lines,
  `Blocked by #<sibling>` edges in dependency order.
- Each sub-issue linked to the parent via the GitHub sub-issue API.
- A marker comment on the parent listing what was created.
- **No new parent** — the owner's issue is the parent (difference from
  `decompose.ts`, whose prompt creates one).
- Sub-issues must be independently landable on main: per-sub-issue
  branches and PRs, the existing implement flow, no integration branch.
  Ordering (`Blocked by`) is the tool for keeping main coherent —
  user-visible wiring lands last.

Idempotency: the step runs only when the parent has no sub-issues; a
crashed run re-enters through the same state check.

## Idempotency & crash recovery

Every action is derivable and re-runnable from GitHub state:

- Merge: approved + open → merge; already merged → skip to decompose.
- Decompose: merged + no sub-issues → run; sub-issues present → skip.
- Auto-close: all sub-issues closed + no close marker → close; marker
  present → never touch again.
- Skill: PR already open for the issue → feedback mode, never a second PR.

## Error handling

- Merge failure (conflict, checks): report in the run's guidance
  ("resolve and re-run"), continue with other lanes.
- Decomposer agent failure: no sub-issues created → next run retries;
  partial creation → next run sees sub-issues present and skips (the
  marker comment tells the owner what exists; they add missing pieces or
  delete and re-run).
- Branch-probe API errors: treat the issue as "state unknown", report,
  never guess.

## Testing

- Pure state-classification helper (labels + PR states + sub-issue counts
  → action) unit-tested exhaustively; colocated `*.test.mts` in the goal
  template, following `labels.test.mts` / `state.test.mts` precedent.
- `PrdWorkflow` scaffold tests extended: new skill content scaffolded for
  the goal template, old content untouched for `parallel-planner-with-review`,
  never overwrites.
- Branch-name convention helpers (compose/parse `prd/issue-<N>-<slug>`)
  unit-tested.

## Documentation

- Changeset (`minor` — new feature, pre-1.0).
- README: goal-template section gains the PRD-lane description.
- `docs/agents/triage.md`: register `sandcastle:requires-prd` as canonical.
- Short ADR: "humans file entry-point issues; one orchestrator" —
  records the principle and the relationship to the conversational path.
- `FORK-MANUAL.md`: the new lane from the operator's point of view.
- `README-FORK.md` entry (separate commit, per fork workflow).

## Out of scope

- Removing or changing `issue.ts` / `design.ts` / `decompose.ts` — the
  conversational path stays as-is; this is a parallel route.
- Integration/feature branches per PRD (revisit only if a concrete PRD
  needs isolation; per-sub-issue PRs to main are the model).
- Grilling inside the orchestrator or over issue comments — interactive
  work stays in Claude Code.
- Auto-reopening or re-closing a manually-reopened parent.
- Telegram or any new gateway.
