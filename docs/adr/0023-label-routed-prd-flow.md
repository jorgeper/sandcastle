# 23. Humans file entry-point issues; one orchestrator runs every lane

Date: 2026-08-01

## Status

Accepted

## Context

The conversational-prd path (ADR 0022, prd/004/005) reaches PRDs through
agent-filed issues and three separate scripts (issue/design/decompose).
The fork owner's operating principles have since firmed up: the human
files every entry-point issue, and `npm run sandcastle` is the single
orchestration command. Interactive grilling belongs in the owner's
Claude Code session, not in a sandboxed chat gateway.

## Decision

Add a label-routed PRD lane (prd/008) to the goal template:
`sandcastle:requires-prd` on an owner-filed issue routes it through
PRD-PR → approval → autonomous decompose → sub-issues, all driven by
`main.mts` from pure GitHub state (branch convention
`prd/issue-<N>-<slug>`; no conversation store). The PRD itself is
produced interactively by the scaffolded issue-anchored `/new-prd`
skill, which wraps the owner's grilling skill. Agents create only
derived issues (the decomposer's sub-issues); PRD approval on the PR is
the lane's only human gate.

## Consequences

- The conversational-prd template remains as a parallel path, unchanged.
- The PRD-PR link is a branch-name convention: renaming the branch breaks
  the chain (deliberate — stateless detection beats stored state).
- Decomposition quality is unreviewed by design; the recourse is editing
  the sub-issues, not a second gate.
