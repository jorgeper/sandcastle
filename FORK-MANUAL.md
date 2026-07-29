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

The chain is fully traceable **and a real GitHub sub-issue tree**: design
issue #41 → anchor comment → conversation → PRD PR #45 (`Closes #41`,
`sandcastle:ready`) → approved → script merges → decompose issue #46
(sub-issue of #41, `**PRD:**` line) → parent #47 (sub-issue of #46) +
children #48–#50 (sub-issues of #47) → impl PRs (`Closes #<child>`,
enforced by the orchestrator even if the pr-writer forgets). Expand the
design issue in GitHub's issue list and the entire feature unfolds under
it. Nothing exists without an issue that says why.

## Onboarding a repo

How to put an existing repo on the full four-lane pipeline. Written from a
real onboarding (marky-mark) — every numbered caveat below was a bug or a
forgotten step the first time through. If a step surprises you, fix this
manual, not just the repo.

**Prerequisites:** Docker running, `gh` authed, Node with npm, and a local
build of this fork (`npm run build` in `~/src/sandcastle`) — the fork
isn't on npm.

**0. Decide where the agents play.** The pipeline lives in issues, labels,
and PRs — the repo the agents see is the repo they write to. To trial
without risk, onboard a **pushed clone** with `origin` re-pointed and
deliberately **no `upstream` remote** (GitHub won't fork your own repo
into your own account, and a fork's shared PR surface is wrong anyway):

```bash
gh repo create <owner>/<repo>-sandcastle --private
git clone https://github.com/<owner>/<repo>.git ~/src/throwaway/<repo>-sandcastle
cd ~/src/throwaway/<repo>-sandcastle
git remote set-url origin https://github.com/<owner>/<repo>-sandcastle.git
git push -u origin main
gh repo set-default <owner>/<repo>-sandcastle
```

**1. Install the fork.** `npm install --save-dev file:../../sandcastle tsx`
(adjust the relative path). npm symlinks `file:` deps — a later
`npm run build` in the fork propagates **library** changes with no
reinstall, but **template files do not update through the symlink**: after
editing templates in the fork, re-copy the changed files into
`.sandcastle/` by hand.

**2. `npx sandcastle init`.** Answers: agent `claude-code`, sandbox
`docker`, template **`parallel-planner-goal-with-pr-review`** (its
`main` file is the implement loop and nudges the conversational lanes),
tracker `github-issues`, create the label, install `zod`. ⚠ The main file
is `main.ts` when the repo's package.json has `"type": "module"`, else
`main.mts` — check `ls .sandcastle` before writing scripts that reference
it.

**3. Layer the conversational lanes** (no combined template yet):

```bash
cp ~/src/sandcastle/src/templates/conversational-prd/{design.ts,decompose.ts,issue.ts,shared.ts,shared.test.ts,designer-prompt.md,decomposer-prompt.md,filer-prompt.md} .sandcastle/
```

**4. Credentials.** `cp .sandcastle/.env.example .sandcastle/.env`; fill
`CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) and `GH_TOKEN`. ⚠ A
fine-grained PAT needs **Contents + Issues + Pull requests, all R/W**,
scoped to the onboarded repo — a contents-only token authenticates fine
and then strands agents on issue operations (the preflight and doctor now
catch this).

**5. Scripts.** Add to package.json (init suggests these but does not
write them), using the main filename from step 2:

```json
"sandcastle":           "npx tsx .sandcastle/main.mts",
"sandcastle:init":      "npx tsx .sandcastle/main.mts --init",
"sandcastle:doctor":    "npx tsx .sandcastle/main.mts --doctor",
"sandcastle:design":    "npx tsx .sandcastle/design.ts",
"sandcastle:decompose": "npx tsx .sandcastle/decompose.ts",
"sandcastle:issue":     "npx tsx .sandcastle/issue.ts"
```

**6. Labels — and COMMIT THE SCAFFOLD.** `npm run sandcastle:init`
creates the label vocabulary and writes
`.claude/skills/sandcastle-implementer/SKILL.md`. Then:

```bash
git add .claude .sandcastle package.json package-lock.json
git commit -m "chore: sandcastle scaffold + implementer skill"
git push origin main
```

⚠ This is the most-forgotten step and it fails silently: sandbox worktrees
branch from your committed `main`, so an uncommitted skill file means the
goal-mode implementer runs with **no process rules** — unmarked comments,
no single-comment discipline, no prior-attempt awareness. The scaffolded
`.sandcastle/.gitignore` already excludes `.env`, logs, and worktrees, so
committing the directory is safe.

**7. Dockerfile = toolchain.** Before (or after — rebuild any time with
`npx sandcastle docker build-image`) the image build, bake in what agents
would otherwise reinstall per sandbox: browsers, system packages. E.g.
`RUN npx playwright install --with-deps chromium`. Rule: **image =
toolchain, worktree = project deps (`node_modules` survives the bind
mount), hooks = cheap glue only.** If you watch an agent `apt-get` or
download browsers, that belongs in the image.

**8. Verify, then smoke test.**

```bash
npm run sandcastle:doctor    # env, token issue-access probe, image, labels
npm run sandcastle:issue -- "a small real improvement"
```

The filer lane is the gentlest first run: capture is instant, `y` opens
the chat, route to `Sandcastle`, then `npm run sandcastle` to watch the
implement lane land it. From here the lanes below are the map.

## Lane 0 — File (capture first, enrich optionally)

The lane for everything smaller than a PRD — and the router for everything
else.

```bash
npm run sandcastle:issue -- "search is slow on big repos"
```

**Capture is instant** (no agent): the issue is filed immediately — your
words, marker, **unlabeled = on hold**, invisible to the agents. Hit Enter
at the "Develop it now?" prompt and you're done — that's the quick issue;
there is no separate quick workflow. Fire-and-forget from anywhere
(this is the Telegram one-liner).

**Develop it** (now with `y`, or any time later — `npm run sandcastle:issue`
with no args lists all held issues): a short conversation grounds the
issue in the repo, asks at most 2–3 questions if needed, rewrites the body
(code pointers, acceptance criteria) for your approval, and then **always
asks how to route it** — with the filer's recommendation, both ways
("I think this needs a PRD — route to design?" / "I don't think this
needs a PRD — release to implementers?"), but the choice is always yours:

- `Sandcastle` — release to the implementers (main loop picks it up).
- `sandcastle:design` — route to the design lane; the designer starts warm
  from the enriched body (**escalation is a label, not a handoff**).
- Hold — stays unlabeled on the backlog.

Ctrl-C anywhere is safe: the issue already exists; the conversation
re-attaches; unlabeled means untouched.

**Replies count, screenshots don't (yet):** agents read the issue's full
comment thread, so replying to your own issue with more detail works. But
image attachments may not be downloadable from the sandbox — put the
load-bearing facts in words; the filer will ask what a screenshot shows.

## Lane 1 — Design (issue → PRD PR → merged PRD)

**Start it, any of three ways:**

| You do                                             | What happens                                                |
| -------------------------------------------------- | ----------------------------------------------------------- |
| Create/label an issue `sandcastle:design`          | `npm run sandcastle:design` lists it; pick it               |
| `npm run sandcastle:design -- "some feature idea"` | Script files the design issue, then starts the conversation |
| Type free text at the bare-run picker              | Same as above — files the issue, starts the conversation    |
| `npm run sandcastle:design -- --issue 41`          | Skip the picker                                             |

The conversation is anchored to the issue (id `design-issue-<n>`, anchor
comment on the issue), and the designer starts from the issue body — it
won't re-ask what the issue already answers. Dictate freely: the filed
title is a mechanical summary of your report (full text in the body), and
the designer retitles the issue concisely once it understands the feature.

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
| Start/resume a design          | `npm run sandcastle:design` (topic, `--issue <n>`, or picker — free text files a new topic)                      |
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
npm run sandcastle:design                   # picker / re-attach (free text = new topic)
npm run sandcastle:decompose                # decompose lane (picker)
npm run sandcastle                          # implement lane (main loop)
gh pr edit <pr> --add-label "sandcastle:approved"        # approve any gated PR
gh issue create --label sandcastle:design --title "PRD: …"   # queue a design by hand
```
