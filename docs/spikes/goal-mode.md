# Spike: running `/goal` non-interactively

Findings for prd/003-goal-mode.md (Spike section). Verified on Claude Code
2.1.220 (requirement: ≥ 2.1.139), macOS host, throwaway git repo, model
`claude-haiku-4-5-20251001`.

## Method

Piped a `/goal` command over stdin using Sandcastle's exact invocation shape
(`AgentProvider.ts` `buildPrintCommand`):

```sh
printf '/goal the file answer.txt exists and contains exactly the text 42, and you have emitted <promise>COMPLETE</promise> — or stop after 6 turns' \
  | claude --print --verbose --dangerously-skip-permissions \
      --output-format stream-json --model claude-haiku-4-5-20251001 -p -
```

Second run used an unsatisfiable condition with a 2-turn bound to observe the
no-signal exit path.

## Findings

1. **`/goal` via stdin `-p -` works.** The command registers the goal,
   the agent works autonomously across turns, creates the artifact, emits the
   signal, and the process exits 0.
2. **stream-json flows turn-by-turn** (assistant/thinking/tool events
   throughout), so the orchestrator's idle timeout will not fire mid-run.
3. **No native goal event exists in stream-json.** Event types observed:
   `system/init`, `system/hook_*`, `system/thinking_tokens`, `assistant`,
   `user`, `rate_limit_event`, `result`. The Stop-hook goal evaluation is
   invisible in the stream, and the terminal `result` event carries no goal
   field (`is_error`, `num_turns`, `stop_reason` only). Conclusion: the
   spec's signal-clause detection is the right mechanism; there is no native
   event to prefer.
4. **The completion signal surfaces as a normal assistant `text` block**,
   which `parseStreamLine` already turns into a `text` event — the existing
   substring detection in `Orchestrator.ts` works unchanged.
5. **No-signal exit is clean.** A run that ends without meeting the
   condition still exits 0 with `is_error: false`; the only reliable
   met/not-met discriminator is the presence of the completion signal in
   parsed output. `goalMet` must therefore be derived from the signal, not
   the exit code.
6. **Goal-text echo hazard is bounded.** The condition contains the literal
   signal string; an agent may quote it. In the failure run the quote
   appeared only in a `thinking` block, which `parseStreamLine` does not
   parse. An agent quoting the signal in visible text would false-fire
   detection — the same accepted risk as today's prompt-embedded signal
   instruction (README, completion-signal section).
7. **Trust/permissions:** `--dangerously-skip-permissions` ran in a fresh
   directory with no trust prompt. Caveats for sandbox use: the image must
   ship Claude Code ≥ 2.1.139, and `/goal` is implemented as a
   session-scoped Stop hook, so `disableAllHooks` /
   `allowManagedHooksOnly` must not be set in the sandbox settings. Host
   user-level SessionStart hooks ran during the spike; sandbox images
   without user settings won't have them.
