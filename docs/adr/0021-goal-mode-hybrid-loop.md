# Goal mode: delegate the inner loop to the agent runtime, keep the outer loop in the consumer

`RunOptions.goal` runs an iteration as a single Claude Code `/goal` invocation: the composed goal command is the entire prompt, Claude Code's native turn loop works toward the condition, and a separate evaluator model (the judge) scores the transcript after every turn — ending the run when the condition holds, or feeding the miss reason back to the agent. Sandcastle's own iteration loop is unchanged and sits outside: each iteration is still a fresh-context spawn, so a stalled attempt hits its turn bound ("or stop after N turns", appended from `goalMaxTurns`) and the next attempt starts clean, continuing from git state. The result is a hybrid — verified completion and per-turn course correction inside an attempt, memory-through-git resets between attempts.

This scopes ADR 0010's stance that "the loop lives in the consumer" rather than superseding it: the consumer still owns the outer loop (`maxIterations`, now meaning autonomous attempts rather than single turns); only the intra-attempt turn loop is delegated to the agent runtime.

## Goal-met detection via the completion-signal clause

The provider appends "and you have emitted `<promise>COMPLETE</promise>`" to the condition during composition. The judge therefore cannot pass the goal until the agent also emits the signal, so the orchestrator's existing substring detection (`Orchestrator.ts`) works unchanged, and `RunResult.goalMet` is derived from it: signal present → goal met; iterations exhausted without a signal → not met. The spike (`docs/spikes/goal-mode.md`) confirmed there is no native goal event in Claude Code's stream-json output and that a no-signal exit is otherwise indistinguishable from success (`exit 0`, `is_error: false`) — the signal clause is the only reliable discriminator.

## Provider contract

`goal` is part of the generic provider contract, not a Claude-Code-ism: providers opt in by implementing `composeGoalPrompt`, and `run()` throws `GoalNotSupportedError` for providers that don't. Composition (signal clause, turn bound, the 4,000-character condition cap) lives behind the provider interface in `AgentProvider.ts`, not in the orchestrator. A future provider without a native goal engine could implement the option by simulating the judge with an external loop.

## Considered alternatives

- **Full replacement** — one continuous `/goal` session per task, no outer iterations. Rejected: abandons the fresh-context-per-iteration design (memory-through-git, no context rot) that the rest of Sandcastle is built around, and leans on compaction for long tasks.
- **Keep the loop, add an external judge** — a checker agent between iterations, no `/goal`. Rejected as the primary design (it re-implements what the runtime now provides and adds engine complexity rather than removing it), but it survives as the documented simulation path for non-Claude providers.
- **Native goal event for detection** — preferred if it existed; the spike found none, so the signal clause stands. Revisit if Claude Code adds a goal field to its stream or result events.

## Consequences

- The engine never sees _why_ the judge rejected a turn — the judge⇄agent dialogue is internal to the session. Diagnosing a `goalMet: false` run means reading the captured session or log, not the `RunResult`.
- The condition text is judged in full: instructions placed in the goal become termination criteria. Callers must keep "how to work" out of the condition (workspace skills/CLAUDE.md carry it — see the `parallel-planner-goal-with-pr-review` template's scaffolded implementer skill).
- An agent quoting the signal string in visible text false-fires detection — the same accepted risk as the prompt-embedded signal convention (thinking-block quotes are not parsed and are safe).
- Goal mode requires Claude Code ≥ 2.1.139 in the sandbox image with hooks enabled (`/goal` is a session-scoped Stop hook); `--doctor`-style preflight is not enforced by the engine.
