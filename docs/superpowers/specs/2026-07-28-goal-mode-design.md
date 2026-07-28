# Goal mode for the implementer

**Date:** 2026-07-28
**Status:** Approved design, pre-implementation
**Branch:** `feat/goal-mode`

## Motivation

The current implementer iteration loop has four weaknesses:

1. **False completions.** Completion is a substring match on the agent's own
   output (`<promise>COMPLETE</promise>`, `Orchestrator.ts`). The worker
   declares itself done; nothing verifies it.
2. **Silent stalls.** An implementer making no progress burns all
   `maxIterations` (100 in the templates) with no course correction.
3. **Cost.** Every iteration spawns a fresh agent that re-explores the repo
   from scratch.
4. **Engine complexity.** Completion signals, completion timeouts, and
   high iteration caps exist to compensate for 1–3.

Claude Code's native `/goal` command (v2.1.139+) addresses all four inside a
single invocation: it runs a turn loop in one continuous session, and after
every turn an independent evaluator model (the "judge", Haiku by default)
scores the transcript against the goal condition and either ends the run or
feeds "not met, because X" back to the worker.

What `/goal` does **not** provide is Sandcastle's fresh-context-per-iteration
reset (memory-through-git, no context rot). This design combines both.

## Architecture: hybrid loop

```
OUTER: Sandcastle iteration loop (fresh spawn per attempt, maxIterations ~4)
  ITERATION 1: claude -p "/goal <condition, turn-bounded>"
     └─ native turn loop: work → judge evaluates → continue or stop
     └─ exits: goal met → outer loop returns | turn bound hit → next iteration
  ITERATION 2: fresh context; memory carried via git commits, issue
     comments, and the committed spec file
  ...
```

- `/goal` replaces the inner churn: self-verification and course correction
  within an attempt.
- The outer loop keeps the fresh-context reset between attempts.
- ADR 0010's stance ("the loop lives in the consumer") is scoped, not
  superseded: the _outer_ loop stays in the consumer; the _inner_ turn loop
  is delegated to the agent runtime.

## Engine API

### `RunOptions`

- `goal?: string` — a completion condition. Mutually exclusive with
  `prompt`/`promptFile` (validated at `run()` entry, like the existing
  `resumeSession` + `maxIterations > 1` guard). In goal mode the composed
  `/goal` command **is** the entire prompt for each iteration.
- `goalMaxTurns?: number` (default 25) — inner turn bound per iteration.
  The provider appends "or stop after N turns" to the condition. This is
  load-bearing: without it the outer hybrid loop never gets a second
  fresh-context attempt.
- `maxIterations` keeps its existing meaning: outer fresh-context attempts.
  Goal-mode callers should use small values (~4), not 100.
- Validation: composed condition must fit Claude Code's 4,000-char goal
  limit; `goal` is rejected if empty or if composition would exceed the cap.

### `RunResult`

- `goalMet?: boolean` — `true` when the run ended because the judge passed
  the condition; `false` when iterations were exhausted. `undefined` for
  non-goal runs.

### Provider contract

`goal` is part of the generic provider contract, not a Claude-Code-ism.
Templates express intent; the provider decides how to realize it:

- `claudeCode`: composes the native invocation (see below). Composition
  lives in `AgentProvider.ts` behind the provider interface, not in
  `Orchestrator.ts`.
- All other providers: throw `GoalNotSupportedError` with a message naming
  the option and provider. Future work (out of scope): simulate goal mode
  for other providers with an external judge loop.

### Goal-met detection

The provider appends a clause to the condition:

> …and you have emitted `<promise>COMPLETE</promise>`

The judge will not pass the goal until the substantive conditions hold
**and** the signal was emitted, so the orchestrator's existing substring
detection works unchanged. `goalMet` = completion signal found. A
turn-bound exit emits no signal, so the outer loop distinguishes the two
outcomes without new parsing.

If the spike (below) finds a native goal-met event in the stream-json
output, prefer that over the signal clause and record the change in the ADR.

## Spike (first implementation task, before any engine code)

Verify in the sandbox image:

1. `/goal` accepted via stdin with `--print` (`-p -`), matching the current
   invocation shape in `AgentProvider.ts`.
2. stream-json output flows turn-by-turn during a goal run, so the 600s
   idle timeout does not fire mid-run.
3. Whether a native goal-evaluation/goal-met event appears in the stream.
4. Claude Code ≥ 2.1.139 available in the sandbox image; workspace trust
   and hooks-enabled requirements are satisfiable non-interactively.

The spike script is kept under `docs/` with its findings.

## Template: `parallel-planner-goal-with-pr-review`

A clone of `parallel-planner-with-pr-review` (which stays byte-identical).
The PR-review flow is unchanged. "Goal" in the template name means the
workflow convention: every issue gets a spec, and the implementer runs
against it. Mode selection = template selection.

Per-task flow:

1. **Spec step** (new; 1 iteration, planner-shaped): reads the issue and any
   `**PRD:**` reference, writes `specs/issue-<n>.md`, commits it, and adds a
   `**Spec:** specs/issue-<n>.md` line to the issue body (mirroring the
   `**PRD:**` convention).
   - The spec file starts with a `## Goal` section containing the goal
     statement — the committed file is the single durable artifact; no goal
     text lives only in orchestrator memory.
   - Acceptance criteria MUST be written as observable states, not actions
     ("a summary comment exists on the issue", not "post a comment"). This
     rule goes in the spec-step prompt; it is what makes re-runs idempotent.
   - Idempotency: if the issue already has a `**Spec:**` line and the file
     exists on the branch, generation is skipped.
   - The step always returns the goal statement via structured output
     (ADR 0010) — freshly generated or re-read from the existing file — so
     the host-side template code has the string without reaching into the
     sandbox; the committed file remains the durable source of truth.
2. **Implementer step**: calls
   `sandbox.run({ name: "implementer", goal, maxIterations: 4, ... })` with
   the statement returned by the spec step.
3. **Process rules** (RGR, `RALPH:` commit prefix, one-task-only, don't
   close the issue, don't push) move out of the prompt into a scaffolded
   workspace skill under `.claude/skills/` — the same pattern
   `PrdWorkflow.ts` uses — so they compose with a target repo's existing
   CLAUDE.md instead of clobbering it. Claude Code auto-loads them each
   session.

The engine knows nothing about specs, issues, or files; spec-per-issue is
purely this template's convention for producing a good condition. Other
templates may pass any opaque `goal` string.

## Idempotency

State lives only in git and GitHub; the orchestrator can be killed at any
point and re-run:

| Killed during…                 | Durable state                   | Re-run behavior                                                               |
| ------------------------------ | ------------------------------- | ----------------------------------------------------------------------------- |
| Spec generation                | nothing yet                     | no `**Spec:**` link found → regenerate cleanly                                |
| After spec, before implementer | spec committed + issue linked   | spec step skips; implementer reads goal from file                             |
| Mid-implementation             | `RALPH:` commits on task branch | fresh-context attempt continues from git state (same as current mode)         |
| After work, before signal      | commits + possibly the comment  | judge re-evaluates actual state; existence-phrased criteria don't double-fire |
| Outer template loop            | issues/labels/PRs               | already restart-safe; goal mode adds no new in-memory state                   |

## Error handling

- `GoalNotSupportedError` for non-claudeCode providers.
- Validation errors at `run()` entry: `goal` + `prompt`/`promptFile`
  together; empty goal; composed condition over the 4,000-char cap.
- Existing failure machinery (idle timeout, `AgentError` on non-zero exit,
  abort) applies unchanged to goal iterations; the completion-timeout grace
  path (ADR 0019) still covers a hanging process after the signal.

## Testing

- Unit tests: option validation (mutual exclusivity, cap), condition
  composition (signal clause + turn bound appended), `goalMet` true/false
  paths, `GoalNotSupportedError`.
- Template test (InitService-style) pinning the new template's structure
  and the spec-step idempotency skip.
- Spike script + findings committed under `docs/`.

## Documentation

- Changeset: `minor` (new feature, pre-1.0).
- README: `goal`, `goalMaxTurns`, `goalMet` in the RunOptions/RunResult
  tables; goal-mode section with the hybrid-loop explanation.
- New ADR: goal mode — inner loop delegated to the agent runtime, outer
  loop stays in the consumer (scopes ADR 0010); signal-clause detection
  choice and the native-event alternative.
- CONTEXT.md: terms **goal**, **goal statement**, **judge**, **spec**.
- README-FORK.md section at the top, in its own commit, per fork workflow.

## Out of scope

- Simulated goal mode for non-Claude-Code providers.
- A global config subsystem for mode selection (mode = template choice).
- Goal mode for planner/reviewer/merger steps (they stay 1-iteration).
- Changes to existing templates.
