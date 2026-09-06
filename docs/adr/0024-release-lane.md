# 24. Releases are issues; the cut runs in the owner's session

Date: 2026-09-06

## Status

Accepted

## Context

The goal template's lanes all share a shape: an owner-filed, labeled
issue; pure classification from GitHub state; phase transitions logged
on the issue; a human label as the only approval. Releases were the
exception — a hand-run checklist with no trail, which once cut a version
behind the newest tag. A first port ran the cut as a sandboxed lane and
retired it: the full gate and CI watches exceed a sandbox turn, and the
publish hand-off wants a human in the loop anyway.

## Decision

Add a release lane (prd/009) to the goal template with the executor in
the owner's Claude Code session, not a sandbox:

- `release-lane.mts` is the one parser and classifier — pure functions
  over the issue body, tag list, release list and comment markers — and
  the source of every phase-marker string.
- Two scaffolded project skills: `/new-release` (interview → approved
  changelog → `sandcastle:release` issue) and `/cut-release` (preflight
  via the module, then a phased runbook that resumes from markers).
- Repo-specific mechanics live in a single `release-facts` block in the
  scaffolded `/cut-release` skill, seeded with `TODO(sandcastle)`
  sentinels that stop the cut until filled. Init never overwrites it.
- The orchestrator only nudges (prd/009 R4). `release/*` branches are
  permanent; `mergePrArgs`/`isPermanentBranch` is the single guard,
  mirrored in the conversational-prd overlay because templates cannot
  import across each other in the source tree.

## Consequences

- Releases gain the same audit trail as every other lane, and cutting
  backwards is refused by code, not convention.
- A repo with no release CI still works: the skill creates the draft
  itself and verifies whatever assets the owner declared.
- The two skills are prose that drives a typed module; tests in
  `ReleaseWorkflow.test.ts` hold the embedded body template and the
  marker names to the module so neither side drifts silently.
- Nothing runs unattended: the owner invokes both skills. That is the
  point — publishing and its immediate approach stay a human act.
