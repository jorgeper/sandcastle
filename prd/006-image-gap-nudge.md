# Image-gap nudge: detect expensive in-sandbox installs, suggest the Dockerfile

**Date:** 2026-07-29
**Status:** Approved design, pre-implementation
**Branch:** `feat/image-gap-nudge`
**Tracking issue:** [jorgeper/sandcastle#9](https://github.com/jorgeper/sandcastle/issues/9)

## Motivation

Anything an agent installs inside a sandbox container dies with the
container. Watching an implementer run `npx playwright install` means every
new sandbox — every issue, every goal-mode fresh-context attempt, every
loop iteration — re-downloads the browsers. The costs are real: bandwidth,
wall-clock, and in goal mode the agent's turn budget is burned on setup
instead of the acceptance criteria, which directly hurts convergence.

The layering rule exists (image = toolchain, worktree = project deps,
hooks = cheap glue — FORK-MANUAL "Onboarding a repo" step 7), but nothing
tells the owner when the agents' actual behavior violates it. Today the
only detection is a human watching `tail -f` at the right moment. The runs
already write complete logs to `.sandcastle/logs/`; nothing reads them.

## Design

**Nudge, never a gate.** Nothing blocks, nothing edits the Dockerfile.
The loop and the doctor tell the owner what the agents keep installing and
what one-line fix would stop it; the owner decides.

### Detection

A fixed signature list matched line-by-line against run logs — no
duration or size heuristics in v1:

| key                 | matches                                    |
| ------------------- | ------------------------------------------ |
| playwright-browsers | `playwright install`                       |
| apt-packages        | `apt install` / `apt-get install`          |
| apk-packages        | `apk add`                                  |
| dnf-yum-packages    | `dnf install` / `yum install`              |
| npm-global          | `npm install -g` / `npm i -g` / `--global` |

Explicitly **not** signatures: plain `npm/yarn/pnpm install` (worktree
project deps — the bind mount already persists them), `pip install`
(usually venv/worktree-local; revisit if it shows up in practice).

### Scope of a scan

At the end of a main-loop run, scan files in `.sandcastle/logs/` modified
since the loop started. `conversation-*.log` files are excluded: keep-alive
conversation sandboxes amortize installs across turns and their logs can
span runs.

### Tally and reset

`.sandcastle/install-tally.json` records, per signature key, how many runs
it appeared in and the last matching log line. The tally carries the
sandbox **image id** (`docker images -q sandcastle:<dir>`): when the
stored id differs from the current one — the owner rebuilt the image —
the tally resets. A rebuild is the fix; stale counts would nag about
solved problems.

### Surfacing

1. **Run end (main loop):** one line per signature detected in this run,
   with the cross-run count when it repeats:

   ```
   ⚠ agents installed Playwright browsers (`npx playwright install`) inside the sandbox (seen in 3 runs) —
     bake it into .sandcastle/Dockerfile and rebuild: npx sandcastle docker build-image
   ```

2. **Doctor:** an "image gaps" check — ✓ "no recurring in-sandbox
   installs" when the tally is empty, ✗ listing the tallied signatures
   with the same Dockerfile hint when it isn't.

A prompt-side companion (implementer skill line: "if you had to install a
system-level tool, say so in your issue comment") is deferred — the log
scan already catches the mechanical fact; agent self-reporting adds words
but no detection.

## Non-goals

- Automatic Dockerfile editing or rebuilds.
- Duration/size-based "expensive" heuristics (v1 is a fixed list).
- Scanning conversational-lane logs.
- Tracking installs in bind-mounted worktree paths (those persist).

## Acceptance criteria

- An implementer that runs `npx playwright install` produces a visible
  run-end line naming the install and the Dockerfile fix; the count
  increments across runs.
- `npm run sandcastle:doctor` surfaces the same tally with the same hint.
- Rebuilding the image resets the tally (verified by image-id change).
- Plain `npm install` in the worktree never triggers it.
- Detection/tally/formatting are pure functions with unit tests shipped
  in the template (`install-scan.test.mts` pattern, like `state.test.mts`).
- No behavior change otherwise: scan failures are swallowed (best-effort,
  like the conversational-lane nudge).
