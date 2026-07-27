# PRD 001: PRD-driven workflow for sandcastle

**Status:** Draft — pending review
**Date:** 2026-07-26
**Target:** `src/templates/parallel-planner-with-review` (ships via `sandcastle init`)

## Problem

Sandcastle's parallel-planner template starts at "open GitHub issues with the
`Sandcastle` label" and goes straight to implementation. There is no defined
path from _idea_ to _labeled issues_. In practice a feature starts as a
conversation: iterate on a PRD in markdown with an agent, reach shared
understanding, then implement. That front half of the workflow is currently
ad hoc — nothing encodes where PRDs live, how they decompose into issues, or
how the human approves the breakdown before the (expensive) parallel
implementers fan out.

## Goals

- A repeatable path: idea → grilled PRD → reviewed issue breakdown → sandcastle
  runs unchanged.
- Human approval gates at the two highest-leverage points: PRD content and
  issue decomposition. Both happen interactively in a Claude Code session,
  where iteration bandwidth is highest.
- Zero changes to the orchestrator (`main.mts`). The pipeline's contract stays
  "open issues labeled `Sandcastle`"; it does not care who created them.
- Uniform structure regardless of feature size: simple features are the N=1
  degenerate case, not a special mode.

## Non-goals

- No autonomous "designer" or "decomposer" agent inside the pipeline. AFK
  decomposition of tagged epics is a documented future extension (see below),
  not part of this design.
- No re-decomposition machinery (adjusting remaining issues after a round of
  implementation teaches something). That remains a human act, done
  interactively — e.g. by updating the PRD and re-running `/decompose-prd`
  for the remaining scope.

## The workflow

### Phase A — Grill (interactive): `/new-prd`

A project skill that composes Matt Pocock's `grilling` skill the same way
`grill-me` does (that skill is one line: "Run a `/grilling` session"):

1. Run a `/grilling` session about the feature idea — relentless
   one-question-at-a-time interview until shared understanding.
2. Write the PRD to `prd/NNN-slug.md` (next free number) following the PRD
   template (problem, goals, non-goals, requirements, open questions).
3. Commit it.

The upstream `grilling`/`grill-me` skills are not modified; the convention
lives in the project skill, versioned next to the `prd/` folder it describes.

### Phase B — Decompose (interactive): `/decompose-prd <path>`

A project skill that turns a committed PRD into a reviewed issue tree:

1. Read the PRD. Propose the full breakdown **as text in the session**:
   parent issue title/body, each child's title and body, and the dependency
   edges. The user iterates conversationally ("merge 2 and 3", "that edge is
   wrong").
2. Only on explicit approval, create in GitHub:
   - **1 parent issue** — links the PRD file, summarizes the feature,
     **never labeled `Sandcastle`**. Human-facing tracker; GitHub's sub-issue
     progress bar shows feature completion.
   - **N ≥ 1 child issues** — each with: the `Sandcastle` label, acceptance
     criteria lifted from the PRD, `Blocked by #N` edges between siblings, and
     a `**Parent:** #X / **PRD:** prd/NNN-slug.md` line in the body. Linked as
     GitHub sub-issues via `gh api repos/{owner}/{repo}/issues/{parent}/sub_issues`
     (no `--parent` flag on `gh issue create` yet).
3. Labels are applied at creation by default — in-session approval _is_ the
   release gate. Escape hatch: ask to hold labels during approval, then tag in
   GitHub later (e.g. to release children in waves). The pipeline is
   indifferent to which is used.

The sub-issue link is for humans; the `**Parent:** / **PRD:**` body line is
for agents. Redundant on purpose — `gh issue view` is not relied on to
display sub-issue linkage.

### Phase C — Implement (AFK): `npm run sandcastle`, unchanged

The existing orchestrator runs as-is:

- The planner sees only labeled children (parents are invisible — they never
  carry the label), builds the dependency graph, and works unblocked issues in
  parallel.
- Multi-part features stage themselves across loop iterations via the
  `Blocked by` edges: each merge round unblocks the next wave. Decomposition
  timing does not handle complexity; dependency metadata does.
- Cardinality: 1 PRD file : 1 parent issue : N≥1 labeled children :
  N branches × M commits.

## Deliverables

| #   | Artifact                                                                                                                                      | Location                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `prd/` folder convention + PRD template                                                                                                       | template scaffold                                  |
| 2   | `/new-prd` skill (grill → PRD by convention)                                                                                                  | template scaffold, `.claude/skills/new-prd/`       |
| 3   | `/decompose-prd` skill (propose → approve → create issue tree)                                                                                | template scaffold, `.claude/skills/decompose-prd/` |
| 4   | `implement-prompt.md` touch-up: replace "If it has a parent PRD, pull that in too" with a deterministic reference to the `**PRD:**` body line | `src/templates/parallel-planner-with-review/`      |
| 5   | `merge-prompt.md` touch-up: after closing child issues, close the parent if all its sub-issues are now closed                                 | `src/templates/parallel-planner-with-review/`      |

Items 4–5 are prompt-only; no orchestrator code changes anywhere.

## Design decisions and rationale

- **Decompose in-session, not in the pipeline.** The breakdown happens seconds
  after the grill interview with the full conversation in context — nuances
  that never made it into PRD prose enrich the issue bodies, which is exactly
  what the implementers consume. And the review asymmetry favors it: eyeballing
  a breakdown costs minutes; a bad breakdown fans out into parallel
  100-iteration implementers with overlapping edits.
- **Parent never labeled.** Single invariant that prevents the planner from
  handing an entire PRD to one implementer.
- **Uniform N≥1 structure.** No "simple mode" special-casing in any prompt or
  skill; a small feature is a parent with one child.
- **Wrap, don't modify, upstream skills.** `grilling` stays generic; project
  conventions live in project skills.

## Future extensions (explicitly out of scope)

- **AFK decomposer phase (the "option 2" upgrade).** A `maxIterations: 1`
  agent run before the planner: find epics labeled `prd-approved`, read the
  PRD from the repo, create the child tree, then flip the label to
  `decomposed` (label-swap makes it idempotent across killed runs). Additive —
  both paths converge on the same artifact contract (labeled children with
  deps and a parent/PRD reference), so nothing in this design changes.
- **Parent auto-close in merger** is deliverable 5; extending the merger to
  comment a progress summary on the parent is a possible follow-up.

## Resolved questions

- _Where does PRD iteration happen?_ Interactively, via grilling — not via
  issue comments, not via an autonomous designer agent.
- _One issue per PRD or many?_ Many (N≥1), with dependency edges; the
  planner's existing graph logic does the staging.
- _Parent/child issues?_ Yes — native GitHub sub-issues, parent as tracker.
- _Where is decompose output verified?_ In-session, before anything is
  created in GitHub. Creation is the commit point.
