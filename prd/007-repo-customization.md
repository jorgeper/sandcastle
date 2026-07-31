# Per-repo customization: toolchain profiles, VERIFY_COMMANDS, and the customize skill

**Date:** 2026-07-30
**Status:** Approved design, pre-implementation
**Branch:** `feat/repo-customization`
**Tracking issue:** [jorgeper/sandcastle#10](https://github.com/jorgeper/sandcastle/issues/10)

## Motivation

Issue #10 sorts every repo-specific fact a template needs into three
tiers: derive it (Tier 1), declare it as one knob (Tier 2), or defer to
the repo's own agent docs (Tier 3). Today the goal template violates
Tier 2 everywhere it matters: `spec-prompt.md`, `merge-prompt.md`,
`pr-conflict-prompt.md`, and `pr-address-prompt.md` each independently
hardcode `npm run typecheck` / `npm run test`; the `onSandboxReady` hook
hardcodes `npm install`; `copyToWorktree` hardcodes `node_modules`. The
costs are not hypothetical: the spec writer once wrote an unsatisfiable
goal against a nonexistent `npm run test`, and `marky-mark` (Vite +
Tauri) has **no** `npm run test` at all — its verification is
`typecheck` / `test:unit` / `validate:quick`. Detecting "node" and
defaulting to `npm run test` would still write dead goals; the evidence
in the actual manifest matters.

This PRD is the thin slice of the issue-#10 framework: the Tier-2 knob
surface, toolchain-aware init, the first customize skill, the doctor
checks that keep the knobs honest, and the ancestor snapshot that makes
a future upgrade path possible. It resolves all four design tensions the
issue left open (decisions inline below).

## Design

### 1. The knob surface: `config.mts`

The goal template's config block moves from `main.mts` to a new
**`.sandcastle/config.mts`** — pure exported consts, no logic. `main.mts`
and `setup.mts` both import it.

Resolved tension: knobs stay **TS consts**, not a separate declarative
file (`project.json` adds a second config surface, a schema, and a
loader for no current consumer — the docs' never-built `config.json` is
the cautionary tale). The move out of `main.mts` is mechanical, not
philosophical: doctor needs `VERIFY_COMMANDS`, and importing `main.mts`
would execute the loop.

New knobs, populated by init via existing `{{KEY}}` template-arg
substitution; existing loop knobs (`GOAL_MAX_TURNS`, `MAX_ITERATIONS`,
`IMPLEMENT_ATTEMPTS`, …) move here too so there is exactly one place to
look:

```ts
export const TOOLCHAIN = "tauri"; // detected profile, informational
export const INSTALL_COMMAND = "npm install"; // → hooks.sandbox.onSandboxReady
export const COPY_TO_WORKTREE = ["node_modules"]; // → createSandbox copyToWorktree
export const VERIFY_COMMANDS = ["npm run typecheck", "npm run test:unit"];
// deferred at init → [] plus: // TODO(sandcastle): run the sandcastle-customize skill
```

### 2. Toolchain profiles (InitService)

A `TOOLCHAINS` table beside the existing `PACKAGE_MANAGERS` / `LOCKFILES`
tables. Exactly five rows in v1 — one per project archetype the fork
actually needs, not an ecosystem census:

| profile     | archetype        | detect                                       | install                                                         | copyToWorktree | verify fallback                                   | Dockerfile hint       |
| ----------- | ---------------- | -------------------------------------------- | --------------------------------------------------------------- | -------------- | ------------------------------------------------- | --------------------- |
| `node`      | JS/TS CLI or lib | `package.json`                               | PM install (npm/pnpm/yarn/bun by lockfile)                      | `node_modules` | evidence scan (see below)                         | node (existing)       |
| `react-web` | web app          | node + `react` in deps                       | PM install                                                      | `node_modules` | evidence scan                                     | node + browser deps   |
| `tauri`     | desktop app      | `package.json` + `src-tauri/tauri.conf.json` | PM install                                                      | `node_modules` | evidence scan                                     | node + rust toolchain |
| `go`        | CLI              | `go.mod`                                     | `go mod download`                                               | —              | `go vet ./...`, `go build ./...`, `go test ./...` | golang                |
| `python`    | backend          | `pyproject.toml`                             | `uv sync` / `poetry install` / `pip install -e .` (by lockfile) | `.venv`        | `pytest`; `ruff check` / `mypy` when configured   | python + uv           |

Detection is manifest presence; most-specific wins among node variants
(`tauri` > `react-web` > `node`). No manifest matched → unknown → the
init question offers manual entry or defer (§3). `marky-mark` must
detect as `tauri` — that repo is the acceptance fixture.

**Verify commands come from evidence, not the family.** For node-family
profiles, init scans the actual `package.json` scripts for
verification-shaped names (`typecheck`, `test`, `test:*`, `lint`,
`check`, `validate*`) and proposes those. The per-row fallback applies
only when there is no script evidence (Go and Python tooling is uniform
enough for real defaults). This is what saves marky-mark from
`npm run test`.

### 3. Init flow

Resolved tension (ask-up-front vs detect-later): **detect + confirm,
with an explicit escape hatch.** One new prompt (plus `--toolchain` /
`--verify-commands` flags for non-TTY):

> Detected: tauri (package.json + src-tauri). Verify commands:
> `npm run typecheck`, `npm run test:unit` — **[confirm / edit / detect later]**

- **confirm/edit** writes the knobs into `config.mts`.
- **detect later** writes `VERIFY_COMMANDS = []` with the TODO sentinel,
  and init's closing next-steps output prints exactly what to run next
  (the every-path-guides-the-next-step rule).

Init also threads its _existing_ package-manager detection into the
scaffold: `INSTALL_COMMAND` and `COPY_TO_WORKTREE` come from the profile
row, fixing the `onSandboxReady`/`copyToWorktree` Tier-2 violations.

Two new scaffold outputs:

- **`.claude/skills/sandcastle-customize/SKILL.md`** (§4), the
  agent-assisted path — same precedent as the implementer/new-prd/
  decompose-prd skills.
- **`.sandcastle/.template-base/`** — a pristine copy of every scaffolded
  file _post-substitution_, plus a marker file recording template name
  and sandcastle version. Committed, not gitignored, so it survives
  clones. Resolved tension (upgrades vs local edits): the model is
  **vendor-base three-way merge** — a future `sandcastle update` runs
  per-file diff3 against this ancestor; untouched files fast-forward,
  edited files get conflict markers. The update command itself is
  deferred (non-goal); the thin slice only guarantees every repo
  initialized from now on has an ancestor to merge from.

### 4. The customize skill (v1 = verify detection)

Resolved tension (skill vs conversational lane): a **Claude Code skill
in the host repo**, because that is where the editing target
(`config.mts`) and the precedent live. Init stays deterministic code —
no LLM; the intelligence lives behind the skill the owner runs when they
choose to.

v1 scope is deliberately narrow: inspect the repo (manifests, scripts,
CI config, CLAUDE.md/AGENTS.md), propose verify commands with reasoning,
and on approval edit `VERIFY_COMMANDS` in `config.mts`. The SKILL.md is
written so broader customization ("tune the reviewer") can be added
later without restructuring; those interviews are non-goals now.

### 5. Prompts go project-agnostic

In the goal template, every hardcoded `npm run typecheck` /
`npm run test` site (`spec-prompt.md`, `merge-prompt.md`,
`pr-conflict-prompt.md`, `pr-address-prompt.md`) becomes a
`{{VERIFY_COMMANDS}}` placeholder, injected as a promptArg from
`config.mts` at each `run()` call site — the existing runtime
substitution path, zero new machinery, always current.

One exception: the scaffolded `implementer-skill.md` is copied at init,
not run through `run()`, so promptArgs cannot reach it. It instead
instructs the agent to run the verify commands declared in
`.sandcastle/config.mts` — a file the agent can read, so later skill or
hand edits stay current automatically.

Prompts that state verification behavior gain an explicit Tier-3
deferral line: repo CLAUDE.md/AGENTS.md nuance (e.g. "test:e2e is too
slow for the inner loop") overrides the declared commands.

### 6. Doctor checks and the branch guard

Two additions to `runDoctor`, in the existing `CheckResult { ok, detail,
hint }` shape — every failure names its fix:

1. **Sentinel check:** `VERIFY_COMMANDS` empty → nudge to run the
   `sandcastle-customize` skill. Deferring at init is safe, never
   silent.
2. **Existence check:** for each `npm run X` verify command, the script
   exists in `package.json` (the token-probe pattern: a wrong knob fails
   loud at doctor time, not three agent-turns deep). Non-npm commands
   check binary presence (`command -v`) best-effort.

Plus the Tier-1 refinement issue #10 calls "worth building": a startup
guard in `main.mts` comparing the loop's current branch to
`gh repo view --json defaultBranchRef`, warning on mismatch. Nudge, not
gate — the loop still runs.

### 7. The `master` fix

`parallel-planner-with-pr-review/main.mts` still ships
`const TARGET_BRANCH = "master"` — the exact stranding bug the goal
template already fixed. It gets the same one-line derivation
(`git rev-parse --abbrev-ref HEAD`). No other sibling-template changes
in this slice.

## Non-goals

- `sandcastle update` (the three-way merge command) — this slice only
  stores the ancestor.
- Rolling the profile/knob treatment out to the other templates (only
  the `master` fix leaves the goal template).
- The general customization skill ("tune the reviewer" interviews).
- In-loop drift detection (agents running undeclared verify commands →
  suggest updating the knob — the image-gap pattern applied to Tier 2).
- More toolchain profiles (Rust-only, JVM, …) — rows are cheap to add
  when a real repo needs one.
- Automatic edits to anything: every surface proposes; the owner
  decides.

Each deferred item becomes its own tracked issue when this lands.

## Acceptance criteria

- Init on marky-mark detects `tauri`, proposes verify commands from its
  real scripts (`typecheck`, `test:unit`, … — never `npm run test`), and
  writes confirmed values into `config.mts`; `onSandboxReady` and
  `copyToWorktree` come from the profile, not hardcoded npm.
- Init on a repo with no recognized manifest offers manual entry or
  defer; defer leaves the sentinel, prints the skill next-step, and
  doctor nudges until it is resolved.
- No scaffolded prompt in the goal template contains a literal
  `npm run typecheck` / `npm run test` (regression-tested, extending the
  existing `master` guard in `InitService.test.ts`).
- Doctor fails loud, with a concrete hint, when a declared
  `npm run X` verify command has no matching script.
- A loop started on a non-default branch prints the branch-mismatch
  warning and continues.
- `.sandcastle/.template-base/` exists after init and matches the
  scaffolded files byte-for-byte.
- Detection and proposal logic are pure functions with unit tests in
  `InitService.test.ts`; template-side helpers follow the
  `install-scan.test.mts` pattern.
- `parallel-planner-with-pr-review` derives `TARGET_BRANCH` at runtime.
