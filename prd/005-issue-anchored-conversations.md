# Issue-anchored conversations: every stage starts from an issue

**Date:** 2026-07-28
**Status:** Approved design, pre-implementation
**Branch:** `feat/issue-anchored-conversations` (stacked on `feat/conversation-gateway`)

## Motivation

The conversation gateway (prd/004, ADR 0022) made the designer and
decomposer talkable — but their work is invisible to the issue tracker
until a PR appears. A design "exists" only as a directory under
`.sandcastle/conversations/`; nothing on GitHub says it is happening, and
the three stages (design → decompose → implement) each have a different
entry point.

Meanwhile the main loop's contract is already "issues with label X get
picked up by agent Y." This PRD extends that contract to the conversational
stages, making the **issue the universal work item**:

- Every piece of work — PRD, decomposition, bugfix, feature — starts as an
  issue, created by the human or by an agent.
- **Routing labels** say which agent handles it: `sandcastle:design` →
  designer conversation; `sandcastle:decompose` → decomposer conversation;
  `sandcastle` → implementer pipeline (unchanged).
- Every stage has the same shape: **issue in → conversation/work →
  artifact + next issue out**, giving an unbroken, clickable chain:
  design issue → PRD PR → decompose issue → parent + implementation
  issues → implementation PRs.

Boundaries (from the design discussion):

- The issue is the **tracker**, not the transport. Conversations still run
  through the conversation store and the chat CLI; the grilling never
  happens in issue comments (poll latency). Issue comments as a _second_
  transport is future work.
- **Routing labels only, no state labels.** GitHub-native state carries
  progress: issue open/closed, PR open/merged, `Closes #N` for handoff.
  The existing `sandcastle:ready`/`sandcastle:approved` pair remains a
  PR-gate concern, untouched.
- The fast path stays fast: `design.ts "some idea"` auto-creates the
  issue. Issue-first is a property of the system, not ceremony for the
  human.
- **Every path guides the next step.** Each script's exit (and each agent's
  `done` envelope) tells the human exactly what they can do next — the
  command to run, the label to add, the PR to look at. Nothing ends with
  silence.

## Label taxonomy

Two new routing labels, registered as canonical in `docs/agents/triage.md`:

| Label                  | Meaning                             | Picked up by   |
| ---------------------- | ----------------------------------- | -------------- |
| `sandcastle:design`    | Needs a PRD; grill the owner        | `design.ts`    |
| `sandcastle:decompose` | Merged PRD needs an issue breakdown | `decompose.ts` |

Scripts ensure their label exists before use (`gh label create … || true`
semantics — idempotent, non-fatal). Existing labels and their meanings are
unchanged.

## Designer flow (`design.ts`)

**Entry — always resolves to an issue, then to a conversation:**

1. `design.ts` (no args): list open `sandcastle:design` issues alongside
   re-attachable design conversations; pick one.
2. `design.ts "<topic>"`: create the issue first — title from the topic,
   body carries the agent marker and the topic text, label
   `sandcastle:design` — then proceed as if picked. Human-created issues
   and agent-created issues are indistinguishable downstream.
3. `design.ts --issue <n>`: skip the picker.

**Anchoring (deterministic, script-side):**

- Conversation id is derived from the issue: `design-issue-<n>`. Re-runs
  resolve the same conversation; the issue number is the join key.
- On conversation creation, the script posts one marker-annotated anchor
  comment on the issue: "designer conversation started — attach with
  `npm run sandcastle:design`". When the PR opens, the same comment thread
  gets the PR link (comment appended, not edited, so history is preserved).
- The issue number and body are passed to the designer via `promptArgs`
  (`ISSUE_NUMBER`, plus the issue body fetched host-side); the grilling
  starts from what the issue already says instead of a blank topic.

**PRD PR:** branch `prd/NNN-<slug>`, `sandcastle:ready` label, label-gated
script merge, and the PR body contains `Closes #<design issue>`, so the
merge that lands the PRD also closes the design issue. No state label
needed.

**Re-entrant, no resident process (supersedes prd/004's polling watcher):**
`design.ts` works like the main loop — each run classifies GitHub state,
does everything actionable, and exits with what's waiting on the human:

1. **Sweep** every design conversation that has a PRD PR: merge approved
   PRs (+ file the handoff issue), relay new PR comments (including inline
   diff comments) to the designer — mechanical work, no human needed.
2. **Converse**: offer the open design issues that still need a
   conversation, one after another, until the human stops or none remain.
3. **Exit** with the "waiting on you" list (PRs to review/approve, next
   commands). Advancing the lane = acting on GitHub and re-running the
   script — which is also exactly the shape a Telegram gateway can trigger
   per command, with no process to babysit.

**Handoff (script-side, at merge):** immediately after the approval merge,
`design.ts` creates the follow-up issue:

- Title: `Decompose prd/NNN-<slug>.md`
- Label: `sandcastle:decompose`
- Body: agent marker, a `**PRD:** prd/NNN-<slug>.md` line (load-bearing,
  same convention the implementation issues use), and a reference to the
  design issue (`Follows #<n>`).

The printed next step becomes `npm run sandcastle:decompose` (no file
argument needed — the issue carries it).

## Decomposer flow (`decompose.ts`)

Symmetric:

1. No args: list open `sandcastle:decompose` issues (plus re-attachable
   decompose conversations); pick one. `--issue <n>` skips the picker.
2. `decompose.ts prd/NNN-<slug>.md` (legacy fast path): auto-creates the
   `sandcastle:decompose` issue first, then proceeds — so even the manual
   path leaves a trace.
3. Conversation id: `decompose-issue-<n>`. The PRD path is parsed from the
   issue body's `**PRD:**` line host-side and passed via `promptArgs`.
4. After the human approves and the decomposer creates the parent +
   implementation issues (unchanged conventions: `**Parent:**`, `**PRD:**`,
   `Sandcastle` label on children, sub-issue linking), the **script**
   closes the decompose issue with a marker-annotated comment listing the
   created issue tree. Closing is mechanical, so it stays out of the agent.

Stage 3 (main loop) picks up labeled implementation issues exactly as
today.

## Filer flow (`issue.ts`) — the lane for everything smaller than a PRD

A third conversational role with a deliberately short leash: turn a
two-line report into a well-formed, correctly routed issue.

1. `issue.ts "search is slow on big repos"` (or no args → prompt). No
   issue-anchoring on entry — the issue is this lane's **output**.
   Conversation id: `file-<slug>`, role `filer`.
2. The filer asks **at most 2–3 clarifying questions, and only if the
   report is ambiguous** (repro, expected vs. actual, acceptance
   criteria). A clear report goes straight to the proposal. It grounds
   the issue in the repo: likely files, related issues, concrete
   acceptance criteria.
3. The proposal shows the complete issue (title, body with marker first
   line, label) **plus the routing recommendation** as options,
   recommendation first:
   - `Sandcastle` — contained bug/task, implementer-ready (the default);
   - `sandcastle:design` — this smells bigger than a bug; file it into
     the design lane instead (**escalation is a label, not a mid-flight
     agent handoff** — the issue is the baton, and the designer later
     starts warm from everything the filer wrote into the body);
   - hold — create unlabeled (backlog; release later by adding the
     label).
4. On `APPROVED`: create the issue, `done` with the URL and next-step
   guidance keyed to the label (design → run `design.ts`; `Sandcastle` →
   `npm run sandcastle`; hold → how to release).

**De-escalation (designer prompt note):** the symmetric misjudgment — a
design conversation that quickly concludes "this is just a bug" — is
handled the same way: the designer proposes relabeling the issue to
`Sandcastle` (dropping `sandcastle:design`) and ends its conversation.
Same baton, opposite direction. No PRD is written.

## Cross-stage visibility (nudges, not orchestration)

Every entry point reports the state of the other lanes, so the human
always sees the whole pipeline from wherever they are:

- `npm run sandcastle` (main loop): before planning, a host-side check
  lists open `sandcastle:design` / `sandcastle:decompose` issues and
  prints a notice — "2 design issue(s) await a conversation: #41, #52 —
  run `npx tsx .sandcastle/design.ts`" (same for decompose). The loop
  **never blocks on or drives these issues** — they need the human
  present; it only points at the right script.
- `design.ts` / `decompose.ts`: after their own picker, a one-line note
  when implementation issues are labeled and waiting — "3 implementation
  issue(s) ready — `npm run sandcastle` when you want them built."

This is a convention-level coupling only (label names + a printed
suggestion), not shared code — ADR 0009 holds. The notice degrades
gracefully: if the conversational scripts aren't scaffolded in a repo, it
names the label and template instead of the script.

## Traceability chain

```
#41 [sandcastle:design]  "PRD: pi digits"          (human or agent creates)
 └─ anchor comment → conversation design-issue-41
 └─ PR #45 "PRD 002: pi digits"  (Closes #41, sandcastle:ready → approved → script merge)
      └─ merge creates #46 [sandcastle:decompose] "Decompose prd/002-pi-digits.md" (Follows #41)
           └─ conversation decompose-issue-46
           └─ parent #47 + children #48..#50 [Sandcastle] (**Parent:** #47, **PRD:** prd/002-…)
                └─ main loop → implementation PRs → merges
```

Every artifact links to its predecessor; nothing exists without an issue
that says why.

## Idempotency & crash recovery

Deterministic names + GitHub state make every step re-runnable:

| Killed after…                        | Re-run behavior                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Issue created, conversation not      | id `design-issue-<n>` doesn't exist → conversation starts; issue is listed again |
| Conversation started, no anchor      | anchor comment searched by marker; missing → posted                              |
| PR opened, `Closes` present          | phase detection unchanged (artifacts + PR state)                                 |
| Approval merge done, no follow-up    | decompose issue searched by title (`Decompose prd/NNN-…`); missing → created     |
| Issues created, decompose not closed | close is retried; already-created issues detected by the existing title search   |

Conversation-level crash recovery (pending human message, corrective
resume) is prd/004 machinery and is unchanged.

## Error handling

- Missing labels: created on demand; failure to create is a warning, not
  fatal (the flow works unlabeled, it just loses pickup routing).
- Issue fetch/create failures fail fast with the `gh` stderr surfaced —
  before any conversation state is touched.
- A `sandcastle:design` issue whose conversation is `done` with a merged
  PR is reported as complete (idempotent no-op), not restarted.

## Testing

- Template structure test additions: the template gains `issue.ts`,
  `filer-prompt.md`, and a `shared.ts` (pure helpers shared _within_ the
  template — ADR 0009 forbids sharing across templates, not within one);
  scripts reference the routing labels, `Closes #`, and the `**PRD:**`
  parsing; prompts reference `{{ISSUE_NUMBER}}`.
- Pure-function tests for the host-side helpers the scripts gain (PRD-line
  parsing, decompose-issue title derivation, anchor-comment detection,
  visibility-notice formatting) — extracted into small exported functions
  within the template files so they stay self-contained (ADR 0009) but
  testable.
- Conversation-library behavior is unchanged — no new library tests.

## Documentation

- Changeset: `minor` (template behavior change; library untouched).
- README: conversations section — issue-anchored flow and the routing
  labels; template description updated.
- `docs/agents/triage.md`: register `sandcastle:design` and
  `sandcastle:decompose` as canonical labels.
- CONTEXT.md: **routing label** term; cross-reference from **conversation**.
- README-FORK.md section (own commit) per fork workflow.

## Out of scope

- Issue comments as a conversation transport (future second transport,
  same store).
- A unified orchestrator/daemon that routes all labels from one loop —
  this PRD makes the stages symmetric so that becomes possible; it does
  not build it.
- A triage agent that labels unlabeled issues.
- Unresolved-review-threads gate on the PRD PR (tracked as the remaining
  Option B asymmetry from the approval-gate discussion).
- Changes to the conversation library. Main-loop template changes are
  limited to the pre-planning visibility notice above — no routing or
  blocking behavior.
