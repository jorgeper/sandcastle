# Fork changes

This is [jorgeper/sandcastle](https://github.com/jorgeper/sandcastle), a fork
of [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle). This
file records every functional change the fork carries on top of upstream —
one section per change, newest first. Each section names the `feat/*` branch
that implemented it, so any change can be proposed upstream from its branch.

## Design picker accepts free text (`feat/design-picker-free-text`)

The bare-run `design.ts` picker is now symmetrical with `issue.ts`: type a
number to open a waiting design issue's conversation, or describe a new
topic in free text — the script files the `sandcastle:design` issue (same
title/marker/label as the `-- "topic"` argument form, via one shared
`fileDesignIssue` helper) and starts its conversation immediately. The
prompt also appears when no design issues are waiting, so an empty lane
invites a new topic instead of exiting silently ("every path tells you the
next step"). Answer interpretation is a pure `interpretPickerAnswer` helper
in the template's `shared.ts` (only a pure in-range integer is a pick;
out-of-range or decimal input becomes a topic), unit-tested via the
template-shipped `shared.test.ts`. Found while onboarding a real repo:
the picker dead-ended into "Enter to finish" and never mentioned how to
start a fresh design.

## Issue-anchored lanes: filer agent + label routing (`feat/issue-anchored-conversations`)

Makes the GitHub issue the universal work item across the whole pipeline
(spec: `prd/005-issue-anchored-conversations.md`). Every stage starts from
an issue carrying a routing label — created by the human or auto-filed by
the scripts — and every path prints the human's next step.

**What was added**

- Routing labels (registered in `docs/agents/triage.md`, term in
  CONTEXT.md): `sandcastle:design` → designer, `sandcastle:decompose` →
  decomposer, `Sandcastle` → main loop. Routing only — no state labels;
  GitHub-native state (open/closed, merged, `Closes #N`) carries progress.
- New filer lane: `issue.ts` + `filer-prompt.md` — a short-leash
  conversation (≤2–3 questions, repo-grounded) that turns a report into a
  well-formed issue routed implement / needs-a-PRD / hold. Escalation is a
  label, not an agent handoff; the designer has the symmetric
  de-escalation (relabel to `Sandcastle`, no PRD).
- `design.ts`: resolves a design issue (picker / `--issue` / auto-file
  from a topic), anchors the conversation to it (id `design-issue-<n>`,
  marker-annotated anchor + PR comments), PRD PR carries
  `Closes #<issue>`, and the approval merge files the decompose handoff
  issue (idempotent by deterministic title). `decompose.ts`: symmetric
  pickup, PRD path parsed from the `**PRD:**` line, script closes the
  tracking issue with the created tree.
- Template-internal `shared.ts` (markers, labels, `gh` wrappers with
  `--body-file` quoting, pure helpers) — shared within the template only,
  ADR 0009 intact; pure helpers unit-tested from outside the template dir.
- Goal-template main loop: best-effort pre-loop nudge listing open
  design/decompose issues awaiting a conversation — points at the scripts,
  never drives them.
- `FORK-MANUAL.md`: the operator's guide (one inbox, four lanes, every
  touchpoint), linked from the README fork notice.

## Conversation gateway: designer & decomposer agents (`feat/conversation-gateway`)

Adds a way to _talk to_ sandboxed agents instead of driving Claude Code's
TUI by hand (spec: `prd/004-conversation-gateway.md`, decision record:
ADR 0022). Motivation: creating a PRD meant running the `/new-prd` and
`/decompose-prd` skills interactively; the goal is to reach agents only
through gateways (a chat CLI today, Telegram on a VPS later) so the whole
pipeline — design → decompose → implement — runs as sandboxed agents.

**What was added**

- Engine: `conversation.start()/open()/send()/list()` — durable, turn-based
  conversations built entirely from existing machinery (`run()` +
  `resumeSession` + structured output; one iteration per turn on branch
  `conversation/<id>`). The agent ends every turn with a typed turn
  envelope (`ask` / `propose` / `done`); protocol instructions are
  library-owned and appended to the opening prompt (`composeGoalPrompt`
  precedent). The store (`.sandcastle/conversations/<id>/`,
  `conversation.json` + append-only `messages.jsonl`) is the source of
  truth: human messages persist before the agent runs, so a killed process
  re-attaches via `open()` + `recover()` without losing or double-sending
  a turn. v1 is claudeCode-only; others throw
  `ConversationNotSupportedError` (Effect-free wrapper, `CwdError`
  pattern).
- Frontend: `chat(convo)` on the new `@ai-hero/sandcastle/chat` subpath —
  an Ink 7 chat TUI (transcript replayed from the store, markdown
  proposals, option select menus, approve/feedback flow, live agent
  activity stream, non-TTY fallback). Frontends are stateless renderers
  over the store, which is what makes the future Telegram daemon a new
  frontend rather than a redesign.
- Template `conversational-prd`: `design.ts` (designer agent grills you
  into a PRD, opens the PRD PR, then addresses your PR comments through
  the same conversation until approval/merge — PR thread as a second
  transport) and `decompose.ts` (decomposer proposes the parent/sub-issue
  breakdown and creates Sandcastle-labeled issues only after the canonical
  `APPROVED` message). Stage 3 stays the existing issue-driven main loop.

## Goal mode: native /goal-driven implementer (`feat/goal-mode`)

Replaces "spawn 100 fresh agents and substring-match their own completion
claim" with Claude Code's native `/goal` engine, wrapped in a hybrid loop
(spec: `prd/003-goal-mode.md`, decision record: ADR 0021). Motivation:
false completions (the worker declared itself done and nothing verified
it), silent stalls (a no-progress run burned every iteration), and the
re-exploration tax of 100 fresh spawns.

**What was added**

- Engine: `RunOptions.goal` (a completion condition judged after every turn
  by `/goal`'s separate evaluator model) + `goalMaxTurns` (inner turn bound,
  default 25), and `RunResult.goalMet` — on both `run()` and
  `createSandbox().run()`. `goal` is mutually exclusive with
  `prompt`/`promptFile`; the composed `/goal` command _is_ the prompt.
  `maxIterations` keeps its meaning as outer fresh-context attempts, so the
  memory-through-git reset survives between autonomous attempts.
- Provider contract, not a Claude-Code-ism: providers opt in via
  `composeGoalPrompt`; everyone else throws `GoalNotSupportedError`
  (exported through an Effect-free wrapper, `CwdError` pattern, to keep the
  published `.d.ts` clean). Goal-met detection appends a completion-signal
  clause to the condition so the judge can't pass without the signal —
  the orchestrator's existing substring detection works unchanged, and a
  turn-bound exit (no signal) is distinguishable from success. Spike
  findings (no native goal event in stream-json, turn-by-turn output, the
  signal-echo hazard) recorded in `docs/spikes/goal-mode.md`.
- Template `parallel-planner-goal-with-pr-review`: a spec-writer step
  distills each issue into a committed spec (`specs/issue-<n>.md`, dir
  configurable via `SPEC_DIR`) whose `## Goal` section carries the goal
  statement; the implementer runs against it in goal mode
  (`GOAL_MAX_TURNS`/`IMPLEMENT_ATTEMPTS` in the config block). The spec
  writer is an independent step like the implementer — its own `RALPH:`
  commit and its own 🏰 issue comment with a SHA-pinned GitHub link to the
  spec; it never edits the issue body. Unverified work (`goalMet: false`)
  never reaches the PR or merge phases. Process rules ship as a scaffolded
  `.claude/skills/sandcastle-implementer` skill, since goal mode has no
  implementer prompt.
- Everything is stateless/idempotent: spec recovery keys off the committed
  file, criteria are phrased as observable end states, and a killed
  orchestrator re-runs cleanly from git + issue state.
- Docs: README goal-mode section + option/result tables, CONTEXT.md terms
  (goal, goal statement, judge, spec), ADR 0021 (scopes ADR 0010: outer
  loop stays in the consumer; inner turn loop delegated to the runtime).
  Requires Claude Code ≥ 2.1.139 in the sandbox image with hooks enabled.

## Fix: resume()/fork() leaked promptArgs into the inline resume prompt (`feat/resume-strip-prompt-args`)

`RunResult.resume()`/`.fork()` (and their `sandbox.run()` counterparts)
build the follow-up run by spreading the original run's options and
swapping in an inline prompt. Only `promptFile` was cleared — the leftover
`promptArgs` tripped the "promptArgs is only supported with promptFile"
validation, so every resume/fork after a `promptFile` + `promptArgs` run
rejected before the agent started. In the `parallel-planner-with-pr-review`
template this silently downgraded every PR description to the two-line
fallback: the pr-writer resume (which reuses the implementer's session)
could never run. All four builders now drop `promptArgs` alongside
`promptFile`, matching what the structured-output retry path already did.
Regression tests cover both the `createSandbox` and `run` flows; README
notes the drop-semantics under Session resume.

## PR checkpoint with agent review debate (`feat/pr-checkpoint`)

Adds a sixth template, `parallel-planner-with-pr-review`, that puts a human
checkpoint between implementation and merge. Upstream's review happens
inside the pipeline (the inner reviewer commits directly and the merger
lands everything); this template moves the review _onto a GitHub PR_ so the
owner reads a conversation, not a diff, and nothing merges without their
say-so.

**What was added**

- Issues labeled `sandcastle:require-pr` (alongside `sandcastle`) publish a
  PR instead of using the inner reviewer. The PR description is written by
  the implementer's own resumed session — what/why, commit walkthrough, key
  decisions (`PR_SUMMARY_DETAILED` const) — with all branch commits kept.
- An outer `pr-reviewer` ⇄ `addresser` debate runs in the PR's review
  threads (up to `MAX_DEBATE_ROUNDS` reviewer turns), deadlocks escalating
  as `⚠️ NEEDS-DECISION` threads the owner arbitrates. Everything runs as
  the owner's single identity; each agent action carries a
  `**[agent · harness · model]**` marker, and unmarked comments (the human)
  route back to the addresser. Turn-taking, thread states, and the merge
  gate are pure, unit-tested code (34 tests) — not prompt interpretation.
- The merge gate: owner adds the `sandcastle:approved` label + zero
  unresolved threads → orchestrator squash-merges, deletes the branch, and
  closes the issue explicitly (no reliance on async `Closes #N`).
  GitHub-native approvals are unusable here (authors can't approve their
  own PRs), hence the label.
- Label vocabulary namespaced under `sandcastle`/`sandcastle:*` with an
  ownership rule: `main.mts --init` provisions human-applied labels;
  orchestrator-applied status labels self-create at point of use. `--doctor`
  checks env/tokens/docker image/labels; `--help` documents it all.
- Repo-level enablement: `allowImportingTsExtensions` +
  `rewriteRelativeImportExtensions` in tsconfig and a vitest include for
  `.test.mts`, since the template ships helper modules + tests beside
  `main.mts` (flat, because init's template copy is non-recursive). This
  stretches ADR 0009's letter — the directory is still the self-contained
  unit — worth revisiting before an upstream PR.

Spec: `prd/002-pr-checkpoint.md` (same branch).

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
