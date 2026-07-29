# Conversation gateway: designer & decomposer agents

**Date:** 2026-07-28
**Status:** Approved design, pre-implementation
**Branch:** `feat/conversation-gateway`

## Motivation

Creating a PRD today means running Claude Code interactively (`/new-prd`
wrapping the grill-me skill), then running `/decompose-prd` — both human-driven
TUI sessions. The goal is to stop driving Claude Code by hand: talk to
sandboxed agents through a gateway instead, so the same interaction can later
run from a Telegram bot on a VPS.

Two workflow stages get promoted from skills-interpreted-in-a-TUI to
first-class sandboxed agents:

1. **Designer** — interviews the human (grilling methodology), drafts a PRD,
   opens a PR with it, then addresses PR feedback until approval.
2. **Decomposer** — reads a merged PRD, proposes a parent-issue + sub-issue
   breakdown, iterates until explicit approval, then creates the issues.

Stage 3 — the existing template main loop — is untouched; it picks up the
issues as it does today. The three stages stay separate manual invocations,
loosely coupled through GitHub artifacts (PRD PR → merged PRD file → issues).

The load-bearing new piece is neither agent but the **conversation gateway**:
a durable, transport-agnostic way for a human to hold a turn-by-turn
conversation with an agent running headless in a sandbox.

## Architecture: turn loop over a durable store

```
┌────────────┐   AgentTurn envelope   ┌──────────────────┐
│  frontend   │ ◄──────────────────── │  Conversation     │──► run() / resume
│ (CLI now,   │                       │  primitive (lib)  │    (existing
│  Telegram   │ ────────────────────► │                   │     machinery)
│  later)     │     send(human msg)   └──────────────────┘
└────────────┘                              │  ▲
        store is the source of truth        ▼  │
                    .sandcastle/conversations/<id>/
```

- **Durable & detachable.** Conversation state lives on disk (message log +
  agent session + preserved worktree). The human answers whenever — the CLI
  process can die and re-attach at any time.
- **Turn-based.** Turn 1 = `run()` with `maxIterations: 1` and a kept
  worktree. Every later turn = one iteration resumed onto the same agent
  session via the existing `resumeSession` option (filesystem-backed
  sessions, ADR 0016; reused worktree, ADR 0003). The gateway adds **no new
  agent-execution machinery**.
- **Store-authoritative.** Every message is appended to the store before it
  is rendered or acted on; frontends are stateless renderers over the store.
- **Daemon-ready, no daemon in v1.** A future VPS/Telegram gateway is a
  process that watches for `awaiting-human` conversations, renders the
  envelope (options → buttons), and calls `send()`. Nothing in v1 assumes
  the frontend is a TTY. Full remote observability of agents is a future
  feature; v1 only commits to a store shape it can read (see Store layout).

## Engine API

New public module `conversation` (Effect internals, effect-free public
surface like the rest of the library):

```ts
const convo = await conversation.start({
  name: "design-notifications",        // conversation id; must be new
  agent: claudeCode({ model }),        // v1: claudeCode only
  sandbox: docker(),
  promptFile: ".sandcastle/designer-prompt.md",  // opening/role prompt
  promptArgs?: Record<string, string>, // normal prompt-template substitution
  role?: string,                       // optional label ("designer") for listing
  dir?: string,                        // store root, default ".sandcastle/conversations"
  cwd?, hooks?, timeouts?, logging?, signal?,    // pass-through to run()
});

convo.id; convo.status; convo.messages;          // replayed from store
convo.lastAgentTurn;                             // AgentTurn
const turn = await convo.send("mobile first");   // one resumed iteration → AgentTurn

const convo2 = await conversation.open("design-notifications", {
  agent, sandbox, dir?, ...                      // runtime deps re-supplied;
});                                              // identity/state from the store

const summaries = await conversation.list(dir?); // [{id, status, updatedAt,
                                                 //   lastMessage, artifacts}]
```

- `start()` resolves after the first agent turn (the opening prompt runs
  immediately; role prompts end their first turn with an envelope, normally
  an `ask`).
- `send()` is one iteration: `run({ resumeSession, prompt: <human text>,
maxIterations: 1, ... })` against the preserved worktree. Human text is an
  inline prompt and therefore passes through literally (ADR 0008) — no
  substitution or `` !`cmd` `` expansion of human answers.
- `open()` recreates a sandbox over the preserved worktree and resumes the
  stored session. Runtime dependencies (agent, sandbox provider) are
  re-supplied by the caller; identity, history, session id, worktree path,
  and branch come from the store. Provider/model mismatch with the stored
  metadata is an error.
- Concurrency: one in-flight `send()` per conversation, enforced with the
  existing worktree-lock mechanism (ADR 0007). A second process calling
  `send()` on the same conversation fails fast.

### The turn envelope

Library-defined, versioned schema. The agent must end **every** turn with
exactly one envelope, emitted as structured output (tag `<turn>`, reusing
`Output.object` / `extractStructuredOutput`, ADR 0010):

```ts
type AgentTurn =
  | { type: "ask"; message: string; options?: string[] }
  | { type: "propose"; message: string }
  | { type: "done"; message: string; artifacts: string[] };
```

- `ask` — a question for the human; `options` lets frontends render a
  select menu (CLI) or buttons (Telegram). Free-text answers are always
  allowed regardless of options.
- `propose` — a draft for review (PRD text, issue breakdown). Frontends
  offer two actions: **approve** (sends the canonical message
  `APPROVED`) or free-text feedback. The canonical approval string is a
  library constant shared by the protocol instructions and frontends.
- `done` — the agent's claim of completion; `artifacts` carries URLs (PR,
  issues). Sets conversation status to `done`. Not necessarily final:
  `send()` on a `done` conversation is permitted and moves it back to
  `awaiting-agent` — this is what lets the designer keep addressing PR
  feedback after opening the PR (phase B below).

Since each turn is a single `maxIterations: 1` run, the process exiting ends
the turn; the envelope is for parsing and routing, not completion detection.
No completion signal is involved.

### Protocol composition

The protocol instructions ("end every turn with a `<turn>` envelope; ask one
question at a time; prefer options; wait for `APPROVED` before acting on a
proposal; never ask questions outside the envelope") are **library-owned
text appended to the opening prompt** — the same precedent as goal mode's
`composeGoalPrompt`. Schema and instructions live together in the library
and cannot drift apart. Role prompts (designer/decomposer) contain only
role methodology, not protocol mechanics.

### Provider contract

Conversations require session resume + structured output. v1 supports and
tests `claudeCode` only. Other providers throw
`ConversationNotSupportedError` naming the provider and the missing
capability — mirroring `GoalNotSupportedError`, kept off the public Effect
type surface.

## Store layout

```
.sandcastle/conversations/<id>/
  conversation.json   # { id, status, role, agent: {provider, model},
                      #   sessionId, worktreePath, branch, logPath,
                      #   artifacts, createdAt, updatedAt }
  messages.jsonl      # append-only: { seq, role: "human"|"agent", at, body }
                      #   agent body = AgentTurn envelope; human body = text
```

- `status`: `awaiting-agent` | `awaiting-human` | `done` | `failed`. A
  human message is appended (status → `awaiting-agent`) **before** the
  agent runs. Workflow phases (e.g. the designer's PR-review phase) are
  **not** library statuses — templates derive them from `artifacts` plus
  external state (is the PR still open?), which also makes re-attach
  idempotent.
- `role` is an optional label passed to `start()` (e.g. `"designer"`),
  stored for listing/observability only.
- Agent stream output goes to log files as today (log-to-file mode);
  `conversation.json.logPath` records where, so future observability
  tooling can join conversation + activity. `conversation.list()` is the
  query hook that a future `sandcastle observe` CLI or Telegram "what are
  my agents doing?" command reads.
- The store is line-oriented JSON on purpose: appendable, tailable,
  diffable, watchable — a daemon can `fs.watch` it without a database.

## CLI frontend: Ink chat TUI (library export)

The terminal frontend is a rich chat TUI built on **Ink 7** (the React
terminal renderer behind Claude-Code-class CLIs) — not clack wizard
prompts. It ships **in the library** as a reference frontend,
`conversation.chat(convo, opts)`, so template scripts stay thin and a
future daemon reuses the same primitive with a different frontend. clack
remains for the library's existing `Display.ts` internals; the chat TUI is
a separate Ink render tree.

Layout (persistent full-screen app):

- **Transcript pane** — the full conversation replayed from the store as
  chat bubbles (human right-aligned/dimmed, agent labeled with role);
  `propose` bodies rendered as markdown (headings, lists, code fences) in
  the terminal.
- **Interaction area** — driven by `lastAgentTurn`: `ask` with options →
  arrow-key select with an always-present "type a custom answer" row;
  `ask` without options → multi-line text input; `propose` → **Approve** /
  give feedback select. Rendered with Ink select/text-input components.
- **Activity region** — while the agent works: spinner + live activity
  feed from `AgentStreamEvent`s (`onAgentStreamEvent`, log-to-file mode),
  e.g. "⚙ reading prd/TEMPLATE.md", with the last few tool calls shown and
  collapsing to one line when the turn completes. Headless turns are not a
  black box.
- **Status bar** — conversation id, role, status, branch/PR artifact,
  elapsed turn time, "Ctrl-C detaches (conversation is durable)".

Interactivity notes: mid-turn steering (TUI Esc) is still out of scope —
Ctrl-C aborts safely (ADR 0004) and re-attaches later. Invoked with no
args, each script lists open conversations (via `conversation.list`) in
the same TUI and offers resume-or-start-new. Non-TTY stdout (piped/CI)
falls back to plain line output; the store, not the TUI, remains the
source of truth.

Dependencies: `ink` + `react` (+ Ink select/text-input/spinner
components) become library dependencies of the chat frontend module. The
frontend is exported from a dedicated subpath so programmatic consumers of
`conversation` don't pay for it.

## Template: `conversational-prd`

A new self-contained init template (ADR 0009 — no shared code) scaffolding:

```
design.ts  decompose.ts  designer-prompt.md  decomposer-prompt.md
```

`package.json` scripts: `sandcastle:design`, `sandcastle:decompose`.
Sandboxes need `gh` auth + network exactly like existing templates (same
env-mounting path; nothing new).

Both scripts are thin: parse args → `conversation.start`/`open` →
`conversation.chat()`. Workflow logic that is not chat (the designer's
phase-B PR polling, phase detection) lives in the template scripts, not
the frontend.

### Designer flow (`design.ts`) — one conversation, two phases

**Phase A — grilling (CLI transport).**
`design.ts "notifications feature"` starts a conversation with the designer
prompt: the grilling methodology adapted from the `new-prd`/grill-me skills
(one question per turn via `ask`, options preferred; then draft the PRD per
`prd/TEMPLATE.md` and present it via `propose`; iterate on feedback). On
approval the agent writes `prd/NNN-slug.md`, commits on branch
`prd/NNN-slug`, pushes, opens the PR via `gh` (as today's templates do),
and emits `done` with the PR URL.

**Phase B — PR review (PR transport).**
After the `done`-with-PR-URL envelope, `design.ts` keeps the conversation
in play: it polls the PR for new human comments
and reviews; each batch becomes a human turn (`send("PR feedback: ...")`),
and the designer pushes fixup commits and replies on the thread — same
durable conversation, the PR thread is simply a second transport. The
conversation is left in `done` (with the PR URL in `artifacts`) and
`design.ts` exits when the PR is approved or merged. Ctrl-C at any point is
safe; re-running `design.ts` re-attaches, deriving the phase from the store
plus PR state (no PR artifact → phase A; PR open → phase B; PR merged →
nothing to do).

### Decomposer flow (`decompose.ts`)

1. After the PRD PR merges: `decompose.ts prd/004-notifications.md`.
2. The decomposer reads the PRD off main and emits a `propose`: parent
   issue + sub-issues (titles, one-line bodies, dependency order, labels
   the main-loop planner queries for) — the propose → iterate →
   explicit-approve protocol of the existing `decompose-prd` skill, now
   enforced by envelope types.
3. Iterate/approve in the CLI. Only after `APPROVED` does the agent create
   the issues via `gh`, then emit `done` listing issue URLs.
4. `npm run sandcastle` (stage 3) picks the issues up unchanged.

## Idempotency & crash recovery

| Killed during…                      | Durable state                          | Re-attach behavior                                                     |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Agent mid-turn                      | trailing human msg without agent reply | `open()` re-runs that human turn (send is not duplicated in the store) |
| Between turns                       | complete message pairs                 | render `lastAgentTurn`, wait for human                                 |
| Phase B polling                     | PR state on GitHub                     | re-poll; comments already answered are identified by reply markers     |
| After issue creation, before `done` | issues exist on GitHub                 | decomposer prompt requires checking for already-created issues first   |
| Worktree deleted out-of-band        | store only                             | reopen fails with a clear error; transcript remains readable           |

## Error handling

- `ConversationNotSupportedError` — provider lacks resume or structured
  output.
- Envelope violation (missing/invalid `<turn>`): one automatic corrective
  resume ("re-emit a valid envelope"); on second failure the turn fails and
  status → `failed` (re-attachable).
- `start()` with an existing id, `open()` with an unknown id,
  provider/model mismatch on `open()`, concurrent `send()` — all fail fast
  with typed errors.
- Existing `run()` failure machinery (idle timeout, `AgentError`, abort
  signal, per-step timeouts) applies unchanged to each turn.

## Testing

- Store unit tests: append/replay, status transitions, crash-recovery scan
  (trailing-human-message detection), `list()`.
- Protocol tests (goal.test.ts-style): envelope schema validation, protocol
  instruction composition, canonical approval constant, corrective-resume
  path, `ConversationNotSupportedError`.
- Mocked-provider end-to-end: start → ask → send → propose → APPROVED →
  done, without real sandboxes; plus open()-after-kill replay.
- Chat TUI component tests with `ink-testing-library` (render `ask` with
  options, propose approve/feedback flow, activity region updates) against
  a stubbed conversation.
- Template structure test (InitService-style) for `conversational-prd`.

## Documentation

- Changeset: `minor`.
- README: `conversation` section (start/open/send/list, envelope, store,
  the Ink `chat` frontend and its subpath export).
- CONTEXT.md terms: **conversation**, **conversation turn** (distinct from
  goal mode's inner turns), **turn envelope**, **conversation store**,
  **frontend**.
- New ADR `0022-conversation-primitive`: turn loop over a durable store;
  store-authoritative; daemon-ready; protocol composition in the library.
- README-FORK.md section at the top, own commit, per fork workflow.

## Out of scope

- Telegram/VPS daemon gateway (v2 — consumes the same store + primitive).
- Observability tooling (`sandcastle observe`, remote log querying); v1
  only records `logPath` and exposes `list()`.
- Auto-chaining stages (label-driven decompose-on-merge etc.).
- Non-claudeCode providers; GitHub-issue-as-transport for grilling.
- Mid-turn steering/interruption of the agent.
- Changes to existing templates or the stage-3 main loop.
