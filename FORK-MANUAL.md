# Fork manual — how to drive this thing

The operator's guide to this fork's agent pipeline: every flow, every
touchpoint, and exactly how the human communicates with the agents.
Written for future-me who forgot the details. Companion docs:
[README-FORK.md](./README-FORK.md) (what changed vs upstream),
`prd/` (the specs), `docs/adr/` (the decisions).

## The big picture: one inbox, four lanes

Everything is a GitHub issue. A **routing label** decides which lane —
which agent — handles it. You talk to conversational agents through a chat
CLI (and PR comments); autonomous agents run unattended. Approvals are
always labels; merges and issue-closing are always done by scripts, never
by you and never by an agent deciding on its own. **Every path tells you
the next step** — if a script or agent ends without guiding you, that's a
bug.

```
      you have a thing ──► issue.ts (filer) files + routes it
                or: create the issue yourself and add a label
                          │
        ┌─────────────────┼──────────────────┐
  sandcastle:design  sandcastle:decompose  Sandcastle
        │                 │                  │
   design script     decompose script    main loop
   (conversation)    (conversation)      (autonomous)
        │                 │                  │
     PRD PR ──merge──► decompose issue ──► parent + impl issues ──► impl PRs
     (you: comment        (you: approve       (you: comment / label
      or label              breakdown           sandcastle:approved
      sandcastle:approved)  in chat)            on require-pr PRs)
```

The chain is fully traceable: design issue #41 → anchor comment →
conversation → PRD PR #45 (`Closes #41`, `sandcastle:ready`) → approved →
script merges → decompose issue #46 (`**PRD:**` line, `Follows #41`) →
parent #47 + children #48–#50 → impl PRs. Nothing exists without an issue
that says why.

## Lane 0 — File (a report → a well-routed issue)

The lane for everything smaller than a PRD — and the router for everything
else.

```bash
npm run sandcastle:issue -- "search is slow on big repos"
```

The filer investigates the repo first (likely files, related issues), asks
**at most 2–3 questions** and only if your report is ambiguous, then
proposes the complete issue: title, body with code pointers and acceptance
criteria, and a **routing recommendation**:

- `Sandcastle` — implementer-ready; the main loop will pick it up.
- `sandcastle:design` — smells bigger than a bug; route it to the design
  lane (**escalation is a label, not a handoff** — the designer later
  starts warm from everything the filer wrote into the issue).
- Hold — file unlabeled; release later by adding a label.

Approve, and it files the issue and tells you the next command for
wherever it was routed.

## Lane 1 — Design (issue → PRD PR → merged PRD)

**Start it, any of three ways:**

| You do                                             | What happens                                                |
| -------------------------------------------------- | ----------------------------------------------------------- |
| Create/label an issue `sandcastle:design`          | `npm run sandcastle:design` lists it; pick it               |
| `npm run sandcastle:design -- "some feature idea"` | Script files the design issue, then starts the conversation |
| `npm run sandcastle:design -- --issue 41`          | Skip the picker                                             |

The conversation is anchored to the issue (id `design-issue-<n>`, anchor
comment on the issue), and the designer starts from the issue body — it
won't re-ask what the issue already answers.

**The conversation (chat CLI):** one question per turn — arrow-keys for
options or type a custom answer; proposals render as markdown with
**Approve** / **give feedback**. **Ctrl-C always detaches safely**; re-run
the script to re-attach. If the designer realizes this doesn't need a PRD,
it proposes **de-escalating**: the issue is relabeled `Sandcastle` and the
conversation ends — no PRD, straight to the implementers.

**The PR checkpoint:** after you approve the draft, the designer opens the
PRD PR (`sandcastle:ready`, body `Closes #<design issue>`) and the script
moves on — **nothing polls**. `design.ts` is re-entrant like the main
loop: every run first sweeps all PRD PRs (relays new comments — including
inline diff comments — to their designers; merges approved ones and files
the decompose issue), then offers remaining design issues, then exits
listing exactly what's waiting on you. So:

- **Want changes?** Comment on the PR (top-level or inline), then re-run
  `npm run sandcastle:design` — the sweep relays it and the designer
  pushes revisions and replies (marker-prefixed).
- **Happy?** `gh pr edit <pr> --add-label "sandcastle:approved"`, then
  re-run — the sweep squash-merges (same gate as the main loop), closing
  the design issue and **auto-filing the decompose issue**.

## Lane 2 — Decompose (merged PRD → implementation issues)

**Start it:**

| You do                                              | What happens                                         |
| --------------------------------------------------- | ---------------------------------------------------- |
| Nothing — the PRD merge filed the decompose issue   | `npm run sandcastle:decompose` lists it; pick it     |
| `npm run sandcastle:decompose -- --issue 46`        | Skip the picker                                      |
| `npm run sandcastle:decompose -- prd/NNN-<slug>.md` | Direct path (files the tracking issue for the trace) |

The decomposer reads the PRD (path from the issue's `**PRD:**` line) and
proposes the full tree — parent, children with acceptance criteria,
dependency order. Iterate in chat, then **Approve**. Only then does it
create the issues (parent unlabeled; children labeled `Sandcastle`,
`**Parent:**`/`**PRD:**` lines, sub-issue links). The script closes the
decompose issue with the created tree and points you at the main loop. To
stage the release, ask in-chat to hold labels.

## Lane 3 — Implement (labeled issues → merged code)

`npm run sandcastle`. Before planning, it **nudges** you about open
design/decompose issues (they need you present — it never drives them).
Then as before: planner picks up `Sandcastle`-labeled unblocked issues,
implementers run in goal mode, reviewer/merger land the work.

- `sandcastle:require-pr` on an issue → PR + agent review debate instead
  of auto-merge.
- PRs labeled `sandcastle:ready` await you; comment (unmarked comments
  route to the addresser), resolve threads.
- Approve with `sandcastle:approved` → orchestrator merges.
  `sandcastle:needs-decision` = deadlocked threads awaiting your call.

## Every touchpoint, one table

| You want to…                   | Do this                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| File anything, well-formed     | `npm run sandcastle:issue -- "<report>"` — filer routes it (implement / design / hold)                           |
| Queue work by hand             | Create an issue; add `sandcastle:design`, `sandcastle:decompose`, or `Sandcastle`                                |
| Start/resume a design          | `npm run sandcastle:design` (topic, `--issue <n>`, or picker)                                                    |
| Answer an agent                | Chat CLI: arrows + enter, or type; **Approve** sends `APPROVED`                                                  |
| Step away mid-conversation     | Ctrl-C — always safe; re-run the script to re-attach                                                             |
| Revise a PRD under review      | Comment on the PRD PR (inline works too); next design run relays it                                              |
| Approve any gated PR           | Add `sandcastle:approved` (script/orchestrator merges — you never merge)                                         |
| Turn a merged PRD into issues  | `npm run sandcastle:decompose`; approve the tree in chat                                                         |
| Build the backlog              | `npm run sandcastle`                                                                                             |
| Gate an impl issue behind a PR | Label it `sandcastle:require-pr`                                                                                 |
| See what agents are doing      | `tail -f .sandcastle/logs/conversation-<id>.log`; transcripts in `.sandcastle/conversations/<id>/messages.jsonl` |

**Who wrote that?** Everything an agent writes on GitHub under your
identity starts with a marker — `**[filer · claude-code · <model>]**`,
`**[designer · …]**`, `**[decomposer · …]**`, the main loop's
`**[agent · harness · model]**`. Unmarked = you. (Also how scripts tell
your PR comments from agent replies.)

## Under the hood (when something looks stuck)

- **State lives in three places:** the conversation store
  (`.sandcastle/conversations/<id>/` — `conversation.json` + transcript),
  the worktree/branch (`conversation/<id>` under `.sandcastle/worktrees/`),
  and the agent session (`~/.claude/projects/…/<sessionId>.jsonl` — the
  agent's actual memory, resumed every turn).
- **Crash/kill anywhere is safe:** your message is persisted before the
  agent runs; on re-attach the scripts recover the unanswered turn. Every
  handoff is idempotent (deterministic issue titles/conversation ids +
  GitHub-state searches), so re-running never duplicates work.
- **Speed:** while attached, one sandbox stays alive across turns
  (`keepSandbox`); detaching tears down only the container.
- **Retention gotcha:** agent sessions live in Claude Code's native store
  and are pruned by its `cleanupPeriodDays` (default 30 days). A dormant
  conversation keeps its transcript/worktree but loses the agent's memory.
- Conversations require `claudeCode` (session resume + structured output);
  other providers throw `ConversationNotSupportedError`.

## Cheat sheet

```bash
npm run sandcastle:issue -- "report"        # file + route anything
npm run sandcastle:design -- "idea"         # design lane (files the issue)
npm run sandcastle:design                   # picker / re-attach
npm run sandcastle:decompose                # decompose lane (picker)
npm run sandcastle                          # implement lane (main loop)
gh pr edit <pr> --add-label "sandcastle:approved"        # approve any gated PR
gh issue create --label sandcastle:design --title "PRD: …"   # queue a design by hand
```
