# PR Checkpoint & Outer Review Loop — Design

**Date:** 2026-07-26
**Status:** Approved pending final review

## Overview

Today the sandcastle loop (`.sandcastle/main.mts`) runs plan → implement+review →
local merge, closing issues with no human checkpoint. This design adds an
opt-in PR mode: issues labeled `sandcastle:require-pr` produce a GitHub pull request instead of a
local merge. The PR is reviewed _on GitHub_ by an outer reviewer agent, fixed
by a comment-addresser agent, and the two debate in PR threads until they
converge or deadlock. The human (repo owner) reads the discussion, decides any
deadlocked threads, and adds the `sandcastle:approved` label. Only a PR
carrying that label (with all threads settled) gets merged.

Two goals:

1. **PR as a human checkpoint** — nothing labeled `sandcastle:require-pr` lands on master without
   an explicit GitHub approval from the owner.
2. **Outer review loop in PR comments** — a second-level review that happens as
   real PR comments, so the owner reviews the _discussion_, not the code.

## Non-goals (explicitly out of scope)

- Per-agent memory (design leaves room; nothing is built).
- Agent registry / config abstraction — agents stay defined inline in
  `main.mts` exactly as today (`sandbox.run({ name, maxIterations, agent,
promptFile, promptArgs })`).
- Bot accounts or GitHub Apps. Everything runs as the owner's identity;
  markers distinguish agents. (Both were designed and rejected for
  complexity — an App retrofit stays contained if collaborators join.)
- A standalone `/pr-review` skill. The outer review is part of the main loop.
- Auto-triggering reviews from GitHub webhooks/Actions. Progress happens when
  the loop runs.

## Two modes, selected by the `sandcastle:require-pr` label

|              | No `sandcastle:require-pr` label (unchanged)   | `sandcastle:require-pr` label                                                                                                                                                                |
| ------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implement    | implementer (100 iter)                         | implementer (100 iter)                                                                                                                                                                       |
| First review | inner reviewer, same sandbox, commits directly | **skipped**                                                                                                                                                                                  |
| Publish      | —                                              | push branch (all commits kept); implementer's session resumed one "pr-writer" turn to write a human-quality description (`Fixes #N`, what/why, key decisions, files touched); `gh pr create` |
| Review       | —                                              | outer reviewer ⇄ addresser debate in PR threads                                                                                                                                              |
| Gate         | none                                           | owner adds `sandcastle:approved` label                                                                                                                                                       |
| Merge        | merger agent, local `git merge`                | `gh pr merge --squash --delete-branch` (code)                                                                                                                                                |
| Issue close  | merger agent `gh issue close`                  | auto via `Closes #N`                                                                                                                                                                         |

The `sandcastle:require-pr` label _replaces_ the inner reviewer with the PR-based outer review —
they don't stack.

## Identity & the approval label

Everything — PRs, comments, thread replies, resolutions — is authored by
**the owner's own account** using the existing `GH_TOKEN` PAT (upgraded
scopes: Contents R/W, Pull requests R/W, Issues R/W). No bot account, no
GitHub App. This simulates how a solo dev works: the owner PRs and comments
on their own PRs, and _markers_ distinguish agent activity from human
activity.

- Every PR action an agent performs — opening the PR, commenting, replying —
  leads with an attribution marker carrying full provenance:
  `**[agent-name · harness · model]**` (e.g.
  `**[pr-reviewer · claude-code · claude-opus-4-8]**`), where agent-name is
  the `name:` from its `sandbox.run()` call. A `MARKER_DETAIL` constant in
  `main.mts` switches to plain `**[agent-name]**`; turn-taking parses the
  name before any separator either way. Unmarked comments are the human.
- Because the owner authors the PRs, GitHub's Approve button is unavailable
  (authors cannot approve their own PRs). The approval gate is a **label**:
  the owner adds `sandcastle:approved` to authorize the merge. The
  code-enforced merge rule becomes: `sandcastle:approved` present AND zero
  unresolved threads → squash-merge. No branch protection needed
  (`require approvals: 0` is GitHub's default).
- Trade-off, accepted for solo use: the gate is convention-enforced
  (prompt hard-rules forbid agents from touching labels) rather than
  identity-enforced by GitHub. If human collaborators join later, a GitHub
  App retrofit is contained: swap the gate check and token source.
- Self-authored activity never triggers GitHub notifications, so the
  "waiting on you" signals are: the `sandcastle:ready` /
  `sandcastle:needs-decision` labels (`gh pr list --label sandcastle:ready`
  is the inbox), the run's console summary, and a best-effort macOS desktop
  notification (`osascript`) when a debate finalizes.
- Agents authenticate with the same `GH_TOKEN` Sandcastle already injects
  into sandboxes from `.sandcastle/.env` — no per-run token plumbing.
  Host-side operations (pushes, label flips, PR create, squash-merge) use
  the owner's normal host auth.

### Init: guided setup and label lifecycle

The label vocabulary is namespaced under `sandcastle`:

| Label                       | Goes on | Set by       | Meaning                            |
| --------------------------- | ------- | ------------ | ---------------------------------- |
| `sandcastle`                | issue   | human        | queue this issue for the loop      |
| `sandcastle:require-pr`     | issue   | human        | gate it behind a PR + outer review |
| `sandcastle:in-review`      | PR      | orchestrator | agent debate in progress           |
| `sandcastle:ready`          | PR      | orchestrator | debate settled, awaiting the owner |
| `sandcastle:needs-decision` | PR      | orchestrator | deadlocked threads await a verdict |
| `sandcastle:approved`       | PR      | human        | authorize the merge                |

Label creation follows an ownership rule — the tool never provisions the
human's input vocabulary behind their back:

- **Human-applied labels** (`sandcastle`, `sandcastle:require-pr`, and
  `sandcastle:approved` as part of the full set) are created by an explicit
  `npm run sandcastle:init` command, which is create-if-missing
  (case-insensitive; never modifies existing labels) and prints the protocol
  table.
- **Orchestrator-applied status labels** are its own output channel — the
  loop lazily creates them if missing right before writing them, so a
  mid-debate label write never fails. `sandcastle:approved` is additionally
  ensured at debate-finalize, the moment the summary tells the owner to use
  it.
- When a run finds zero `sandcastle`-labeled issues, it prints how to queue
  work — and, if the trigger label doesn't exist, points at
  `npm run sandcastle:init`. Discoverability lives in the tool, not in
  README archaeology.

On startup, `main.mts` also validates PR-mode configuration: if any issue
carries `sandcastle:require-pr` but `GH_TOKEN` is missing from
`.sandcastle/.env`, it prints a short setup guide (upgrade PAT scopes; init
command; the label protocol) and exits. Issues without the
`sandcastle:require-pr` label are unaffected. Full guide:
`.sandcastle/PR_SETUP.md`.

Since all agents share one account, every agent comment starts with a
signature prefix derived from the agent's `name:` in its `sandbox.run()` call
(passed to the prompt as `{{AGENT_NAME}}`): e.g. `**[pr-reviewer]**`,
`**[addresser]**`. The code is the single source of truth — rename an agent
in `main.mts` and the PR transcript follows. Prefixes make the transcript
readable and drive turn-taking (below).

## Per-issue state machine (deterministic code, not prompts)

At the start of each run, `main.mts` classifies every open `sandcastle`-labeled issue
using `gh` (PR lookup by head branch `sandcastle/issue-N`; `mergeable`,
labels, and comments via `gh pr view`; thread resolution via GraphQL
`reviewThreads`, which REST does not expose):

| State                                                                                                               | Action                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| No open PR for the branch                                                                                           | Candidate for the planner (dependency analysis unchanged) → implement pipeline                    |
| PR open, `sandcastle:approved` label, zero unresolved threads                                                       | Squash-merge via code                                                                             |
| PR approved (label) but `mergeable == CONFLICTING`                                                                  | Conflict-resolver agent rebases branch onto master, pushes; then code merges                      |
| PR open, unresolved threads, last speaker is an author-side agent (`implementer`, `addresser`, `conflict-resolver`) | Reviewer's turn → resume debate                                                                   |
| PR open, unresolved threads, last speaker is the PR reviewer agent or the owner                                     | Addresser's turn → resume debate                                                                  |
| PR open, all unresolved threads are `NEEDS-DECISION` with no new owner input                                        | Skip (waiting on human)                                                                           |
| PR closed without merging, issue still open                                                                         | Log warning, skip. Never silently re-implement; the owner relabels or closes the issue to decide. |

The merge gate is enforced in code — the `sandcastle:approved` label **and**
zero unresolved threads — so no prompt misreading can bypass the checkpoint.
The label is checked at merge time; if new commits land after the owner
labeled the PR, the threads that prompted them keep the gate closed until
settled.

Because all debate state lives in the PR itself (threads, prefixes,
resolution flags), a crashed or interrupted run resumes for free — the same
turn-taking rule drives both the within-run loop and cross-run resumption
after owner input.

## The debate loop

After PR creation (and on later runs when there is new input), the loop
alternates two `sandbox.run()` calls on the PR branch, defined inline in
`main.mts` like every other agent:

**Outer reviewer** (`pr-review-prompt.md`, maxIterations 1):

- Reads the PR diff, all threads, and CODING_STANDARDS.md.
- Posts new line comments for real issues (via `gh api` review endpoints).
- For each of its own existing unresolved threads: verifies the fix and
  resolves the thread ("fixed in `abc123`"), or rebuts with reasoning.
- Never resolves owner-authored threads (unmarked comments). **Never
  approves and never touches labels** — the `sandcastle:approved` label
  belongs exclusively to the owner.
- If satisfied (no threads left to open or contest), posts a short summary
  comment; the debate ends.

**Comment addresser** (`pr-address-prompt.md`, maxIterations ~25):

- For each unresolved thread: makes the fix, runs `npm run typecheck` and
  `npm run test`, commits, replies on the thread with what it did — or
  pushes back with reasoning if it disagrees. It replies; it never resolves
  threads (resolution belongs to whoever opened the thread) and never
  touches labels. The orchestrator pushes after it finishes.
- Strictly scoped to the comments. No opportunistic refactoring.

The loop runs at most `MAX_DEBATE_ROUNDS = 3` rounds per invocation. Any
thread still contested at the cap gets a final reviewer comment: `⚠️
NEEDS-DECISION:` plus a 2–3 sentence summary of both positions, left
unresolved. Owner replies on such a thread are routed to the addresser on the
next run, which applies the verdict.

## How the owner knows a PR awaits them

All three signals are emitted by code (not agents) when the debate loop exits:

1. **Status label**, exactly one of: `sandcastle:in-review` (debate running),
   `sandcastle:ready` (reviewer satisfied, awaiting the approval label),
   `sandcastle:needs-decision` (deadlocked threads await a verdict).
   Dashboard: `gh pr list --label sandcastle:ready` — the primary inbox,
   since self-authored GitHub activity never triggers GitHub notifications.
2. **Summary comment**: threads opened/resolved, links to any
   NEEDS-DECISION threads with one-line disagreement summaries. Designed to
   be the only thing the owner must read.

The owner's workflow: read summary → (optionally skim resolved threads) →
decide any NEEDS-DECISION threads → optionally add own comments (they become
unresolved threads routed to the addresser) → add `sandcastle:approved` when
satisfied. Next run merges.

## Files changed

- `.sandcastle/main.mts` — the bulk of the work:
  - `.env` presence check for `GH_TOKEN` with printed setup guide.
  - State classification step (gh + GraphQL queries) before planning.
  - Planner receives only issues with no open PR.
  - Per-issue dispatch: implement pipeline (existing), debate turns,
    conflict-resolver, squash-merge, label/summary/notification emission.
  - Debate loop with `MAX_DEBATE_ROUNDS`; host-side branch pushes.
  - Non-`require-pr` issues flow through the existing path untouched.
- `.sandcastle/lib/` — `env.mts` (env parsing + guide), `state.mts` (pure
  classification: markers, threads, issue actions, `APPROVED_LABEL`),
  `github.mts` (gh wrappers with unit-tested parsers). Vitest covers the
  pure logic.
- New prompts:
  - `.sandcastle/pr-review-prompt.md` (outer reviewer)
  - `.sandcastle/pr-address-prompt.md` (comment addresser)
  - `.sandcastle/pr-conflict-prompt.md` (rebase/conflict resolver, small)
- Changed: `plan-prompt.md` (candidate-numbers restriction). Unchanged:
  `implement-prompt.md`, `review-prompt.md` (inner reviewer, non-`require-pr` only),
  `merge-prompt.md` (only ever sees non-`require-pr` branches).
- New `.sandcastle/PR_SETUP.md` — PAT scopes + the label protocol.
- `.sandcastle/.env.example` documenting `GH_TOKEN` and its scopes (real
  values stay in the git-ignored `.sandcastle/.env`).

## Error handling

- Agent/sandbox failure mid-pipeline: `Promise.allSettled` semantics stay —
  one issue's failure never blocks others; PR state makes retry safe.
- Push/PR-create failure (auth, permissions): fail that issue's pipeline
  loudly with the gh/git error. Pushes are host-side (owner credentials),
  so the main risk is a PAT missing the upgraded scopes — the setup guide
  covers it.
- Reviewer posting malformed line comments: reviewer prompt requires using
  `gh api` with explicit path/line taken from the diff; a failed API call is
  visible in the agent log and the thread simply doesn't exist — no
  corruption of state.
- Runaway ping-pong: hard cap via `MAX_DEBATE_ROUNDS` + NEEDS-DECISION
  escalation.

## Testing

- Dry-run against this demo repo: one issue labeled `sandcastle` + `sandcastle:require-pr`, one
  without; verify the unlabeled issue follows the legacy path end-to-end.
- Mechanical checks before wiring agents: the PAT can push a branch, open a
  PR, post a line comment, resolve a thread via GraphQL;
  `gh pr merge --squash` works with owner auth.
- Debate convergence: seed a PR with a deliberate flaw; confirm reviewer
  comments, addresser fixes and replies, reviewer resolves, labels flip to
  `sandcastle:ready`.
- Deadlock path: prompt-force a disagreement (test-only instruction);
  confirm NEEDS-DECISION escalation and that owner reply routes to the
  addresser next run.
