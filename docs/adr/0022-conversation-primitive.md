# Conversations: a turn loop over a durable store, built from run() + resume

`conversation.start()` gives a human a turn-based conversation with an agent
running headless in a sandbox. The primitive adds no agent-execution
machinery: turn 1 is `run()` with `maxIterations: 1` on the named branch
`conversation/<id>` (worktree reused across turns, ADR 0003, guarded by the
worktree lock, ADR 0007), and every later turn is one iteration resumed onto
the same filesystem-backed agent session (`resumeSession`, ADR 0016). The
agent ends each turn with a typed **turn envelope** (`ask` / `propose` /
`done`) emitted as structured output (ADR 0010) with `maxRetries: 1` — the
existing corrective-resume path doubles as the envelope-violation retry.

## The store is authoritative; frontends are stateless

Every message is persisted to `.sandcastle/conversations/<id>/`
(`conversation.json` + append-only `messages.jsonl`) before anything renders
or runs. Human messages are written **before** the agent turn executes, so a
process killed mid-turn leaves a trailing unanswered human message that
`open()` + `recover()` re-runs — never a lost or double-sent turn. Frontends
(the Ink chat TUI on the `/chat` subpath; a future Telegram daemon on a VPS)
are stateless renderers over the store. That is the load-bearing decision:
a daemon gateway becomes "a process that watches for `awaiting-human`
conversations and calls `send()`", not a redesign. The store is
line-oriented JSON on purpose — appendable, tailable, `fs.watch`-able.

## Protocol composition lives in the library

The envelope schema and the protocol instructions the agent sees ("end every
turn with one `<turn>` envelope; one question per turn; wait for `APPROVED`
before acting on a proposal") are defined together in
`conversationEnvelope.ts` and appended to the opening prompt by
`conversation.start()` — the `composeGoalPrompt` precedent. Role prompts
(designer, decomposer) carry only role methodology; they cannot drift from
the wire format because they never state it.

## Workflow phases are not library statuses

Statuses are only `awaiting-agent | awaiting-human | done | failed`. `done`
records the agent's completion claim and is reopenable by `send()` — that is
what lets the designer keep addressing PR feedback through the same
conversation after opening the PR. Template-level phases (the designer's
PR-review phase) are derived from `artifacts` plus external state (is the PR
open?), which keeps re-attach idempotent.

## Considered alternatives

- **`interactive()` passthrough** — hands the whole TTY to the agent's own
  TUI. Rejected: no programmatic message channel, nothing for a non-terminal
  frontend to consume, no durability.
- **Daemon-first gateway** — a background process owning all conversations,
  frontends as thin clients. Deferred, not rejected: the store-authoritative
  design makes the daemon a later additive layer (v2), and it buys nothing
  for the CLI use case shipped here.
- **GitHub issues as the conversation transport** — durable and phone-ready,
  but a poll cycle per grilling turn is too slow. It survives in miniature:
  the designer's PR-review phase feeds PR comments into the same
  conversation as human turns.
- **Structured turns vs. free-form chat** — free-form reads naturally but
  leaves frontends unable to render options/buttons and makes "is it done?"
  a heuristic. The typed envelope is what makes every frontend trivial.

## Consequences

- Conversations require session resume + structured output; v1 supports
  `claudeCode` only (`ConversationNotSupportedError` otherwise, mirroring
  `GoalNotSupportedError`).
- The human cannot steer mid-turn (no TUI Esc); Ctrl-C aborts safely and the
  conversation re-attaches. Accepted for interview-sized turns.
- Opening prompts are inline prompts after host-side `{{KEY}}` substitution:
  shell (`` !`cmd` ``) expansion does not apply to conversation prompts
  (ADR 0008 boundary).
- `ink`/`react` are runtime dependencies of the package, isolated behind the
  `/chat` subpath so programmatic consumers never load them.
