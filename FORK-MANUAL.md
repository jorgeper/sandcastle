# Fork manual — how to drive this thing

The operator's guide to this fork's agent pipeline: every flow, every
touchpoint, and exactly how the human communicates with the agents.
Written for future-me who forgot the details. Companion docs:
[README-FORK.md](./README-FORK.md) (what changed vs upstream),
`prd/` (the specs), `docs/adr/` (the decisions).

**Status:** the conversation gateway, chat CLI, designer/decomposer, and
label-gated PRD approval are implemented (`feat/conversation-gateway`,
prd/004). Issue-anchoring — starting every stage from a labeled issue,
auto-created issues, handoff issues, cross-stage nudges — is specced in
prd/005 and marked **[005]** below until implemented.

## The big picture: one inbox, three lanes

Everything is a GitHub issue. A **routing label** decides which lane —
which agent — handles it. You talk to conversational agents through a chat
CLI (and PR comments); autonomous agents run unattended. Approvals are
always labels; merges are always done by scripts/orchestrators, never by
you and never by an agent deciding on its own.

```
            you (or an agent) create an issue
                          │
        ┌─────────────────┼──────────────────┐
  sandcastle:design  sandcastle:decompose  sandcastle
        │ [005]           │ [005]            │
   design script     decompose script    main loop
   (conversation)    (conversation)      (autonomous)
        │                 │                 │
     PRD PR ──merge──► decompose issue ──► parent + impl issues ──► impl PRs
     (you: comment        (you: approve       (you: comment / label
      or approve            breakdown           sandcastle:approved
      via label)            in chat)            on require-pr PRs)
```

Chain example, fully traceable end to end **[005]**:
design issue #41 → anchor comment → PRD PR #45 (`Closes #41`) → merge
creates decompose issue #46 → parent #47 + children #48–#50 → impl PRs.

## Lane 1 — Design (idea → PRD PR → merged PRD)

**Start it, either way:**

| You do                                                   | What happens                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Create an issue, add label `sandcastle:design` **[005]** | `npm run sandcastle:design` lists it; pick it to start the conversation      |
| `npm run sandcastle:design -- "some feature idea"`       | Script auto-creates the design issue **[005]**, then starts the conversation |
| `npm run sandcastle:design` (no args)                    | Picker: open design issues **[005]** + resumable conversations               |

**The conversation (chat CLI):** the designer grills you one question per
turn — arrow-keys to pick an option, or choose "type a custom answer";
proposals render as markdown with **Approve** / **give feedback**. While
the agent works you see its live tool activity. The status bar reminds
you: **Ctrl-C always detaches safely** — the conversation is durable;
re-run the script to re-attach exactly where you left off.

**The PR checkpoint (your main review touchpoint):** on your approval of
the draft, the designer writes `prd/NNN-<slug>.md` on branch
`prd/NNN-<slug>` and opens a PR labeled `sandcastle:ready`. Then:

- **Want changes?** Comment on the PR (normal PR review). The watching
  script feeds your comments to the designer, which pushes revisions and
  replies (marker-prefixed) — repeat until happy.
- **Happy?** `gh pr edit <pr> --add-label "sandcastle:approved"` — the
  _script_ squash-merges and deletes the branch. Same gate as the main
  loop. (Manually merging also works as a fallback.)

**Handoff:** the merge closes the design issue (`Closes #N` **[005]**) and
auto-creates the decompose issue (`sandcastle:decompose`, `**PRD:**` line)
**[005]**.

## Lane 2 — Decompose (merged PRD → implementation issues)

**Start it:**

| You do                                                    | What happens                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Nothing — the merge created the decompose issue **[005]** | `npm run sandcastle:decompose` lists it; pick it                       |
| Create/label an issue `sandcastle:decompose` **[005]**    | Same                                                                   |
| `npm run sandcastle:decompose -- prd/NNN-<slug>.md`       | Direct path (auto-creates the decompose issue for the trace **[005]**) |

**The conversation:** the decomposer reads the PRD and proposes the full
tree — parent issue, children with acceptance criteria, dependency order.
Give feedback in chat until right, then **Approve** (sends the canonical
`APPROVED`). Only after approval does it touch GitHub: parent (unlabeled),
children labeled `Sandcastle` (the release gate), `**Parent:**`/`**PRD:**`
lines, sub-issue links. The script closes the decompose issue with the
created tree **[005]**. To stage the release, ask in-chat to hold labels
and add `Sandcastle` per child later.

## Lane 3 — Implement (labeled issues → merged code)

Unchanged main loop: `npm run sandcastle`. Planner picks up `Sandcastle`-
labeled, unblocked issues; implementers run (goal mode); reviewer/merger
land the work. Your touchpoints (from the goal template):

- `sandcastle:require-pr` label on an issue → its work goes through a PR
  with the agent review debate instead of auto-merge.
- PRs labeled `sandcastle:ready` await you: review, comment (unmarked
  comments route to the addresser), resolve threads.
- Approve with `sandcastle:approved` → orchestrator merges.
  `sandcastle:needs-decision` threads are deadlocks waiting on your call.
- **[005]** Before planning, the loop nudges: open design/decompose issues
  are listed with the script to run — it never drives them itself.

## Every touchpoint, one table

| You want to…                   | Do this                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Queue any work                 | Create an issue; add a routing label (`sandcastle:design` / `sandcastle:decompose` **[005]** / `Sandcastle`)                                    |
| Start/resume a design          | `npm run sandcastle:design` (topic arg, `--issue <n>` **[005]**, or picker)                                                                     |
| Answer the designer/decomposer | Chat CLI: arrows + enter, or type; **Approve** sends `APPROVED`                                                                                 |
| Step away mid-conversation     | Ctrl-C — always safe; re-run the script to re-attach                                                                                            |
| Revise a PRD under review      | Comment on the PRD PR; the watcher relays it                                                                                                    |
| Approve a PRD                  | Add `sandcastle:approved` to the PRD PR (script merges)                                                                                         |
| Turn a PRD into issues         | `npm run sandcastle:decompose`; approve the proposed tree in chat                                                                               |
| Build the backlog              | `npm run sandcastle`                                                                                                                            |
| Gate an impl issue behind a PR | Label the issue `sandcastle:require-pr`                                                                                                         |
| Approve an implementation PR   | Add `sandcastle:approved` (orchestrator merges)                                                                                                 |
| See what agents are doing      | `tail -f .sandcastle/logs/conversation-<id>.log` (or the run logs); conversation transcripts in `.sandcastle/conversations/<id>/messages.jsonl` |

**Who wrote that?** Everything an agent writes on GitHub under your
identity starts with a marker — `**[designer · claude-code · <model>]**`,
`**[decomposer · …]**`, the goal template's `**[agent · harness · model]**`.
Unmarked = you. (Also how scripts tell your PR comments from agent replies.)

## Under the hood (when something looks stuck)

- **State lives in three places:** the conversation store
  (`.sandcastle/conversations/<id>/` — `conversation.json` + transcript),
  the worktree/branch (`conversation/<id>` under `.sandcastle/worktrees/`),
  and the agent session (`~/.claude/projects/…/<sessionId>.jsonl` — the
  agent's actual memory, resumed every turn).
- **Crash/kill anywhere is safe:** your message is persisted before the
  agent runs; on re-attach the scripts recover the unanswered turn.
  A `failed` conversation (agent broke the envelope protocol twice)
  re-attaches the same way.
- **Speed:** while attached, one sandbox stays alive across turns
  (`keepSandbox`); detaching tears down only the container.
- **Retention gotcha:** agent sessions live in Claude Code's native store
  and are pruned by its `cleanupPeriodDays` (default 30 days). A
  conversation dormant longer keeps its transcript/worktree but loses the
  agent's memory.
- Conversations require `claudeCode` (session resume + structured output);
  other providers throw `ConversationNotSupportedError`.

## Cheat sheet

```bash
npm run sandcastle:design -- "idea"      # design lane (issue auto-created [005])
npm run sandcastle:design                # picker / re-attach
gh pr edit <pr> --add-label "sandcastle:approved"   # approve PRD or impl PR
npm run sandcastle:decompose             # decompose lane (picker [005])
npm run sandcastle                       # implement lane (main loop)
gh issue create --label sandcastle:design --title "PRD: …"   # queue a design [005]
```
