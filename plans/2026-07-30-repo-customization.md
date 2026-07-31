# Per-Repo Customization (prd/007) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement prd/007 — toolchain profiles + evidence-based `VERIFY_COMMANDS` detection at init, a `config.mts` knob surface in the goal template, doctor checks, the `sandcastle-customize` skill, the `.template-base/` ancestor snapshot, and the sibling-template `master` fix.

**Architecture:** A new library module `src/Toolchain.ts` owns profile detection and verify-command proposal (pure + Effect, mirroring the `PACKAGE_MANAGERS` pattern in InitService). The goal template gains `config.mts` (pure exported consts imported by both `main.mts` and `setup.mts`) and `verify.mts` (pure helpers, unit-tested in-template like `install-scan`). `scaffold()` rewrites `config.mts` from the resolved toolchain (same regex-rewrite pattern as `rewriteMainTs`) and snapshots the scaffold to `.sandcastle/.template-base/`. `cli.ts` adds the confirm/edit/defer question plus `--toolchain`/`--verify-commands` flags.

**Tech Stack:** TypeScript, Effect (`@effect/platform` FileSystem), `@clack/prompts`, `@effect/cli` Options, vitest.

## Global Constraints

- Spec: `prd/007-repo-customization.md` (committed on this branch). Tracking issue: jorgeper/sandcastle#10.
- Branch: `feat/repo-customization` (already checked out; PRD commits already on it).
- Typecheck: `npm run typecheck`. Tests: `npx vitest run` (template `.test.mts` files are included via `src/**/*.test.{ts,tsx,mts}`).
- ADR 0009: no shared code across templates — library logic goes in `src/`, template helpers stay inside the template directory.
- Commit messages: conventional (`feat(template): …`, `feat(init): …`, `fix(template): …`, `test: …`), each ending with the trailer line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- lint-staged runs prettier on commit — do not hand-fight formatting.
- Changesets: `.changeset/` — this feature is one `minor` changeset for the package named in `package.json#name`; check for duplicates first.
- The four resolved-tension decisions in prd/007 are fixed; do not redesign them.
- `main.mts` may be renamed `main.ts` at scaffold time; only literal `main.mts` strings are rewritten, so intra-template imports must use `./config.mts`, `./verify.mts` (never `./main.mts`).

---

### Task 1: `src/Toolchain.ts` — profiles, detection, verify proposal

**Files:**

- Create: `src/Toolchain.ts`
- Test: `src/Toolchain.test.ts`

**Interfaces:**

- Consumes: `detectPackageManager`, `PackageManager` from `./InitService.js` (runtime import; InitService must NOT runtime-import Toolchain back).
- Produces (used by Tasks 6–7):
  - `interface ToolchainProfile { name: ToolchainName; label: string; verifyFallback: readonly string[]; copyToWorktree: readonly string[]; dockerfileHint: string }`
  - `type ToolchainName = "node" | "react-web" | "tauri" | "go" | "python"`
  - `TOOLCHAIN_NAMES: readonly ToolchainName[]`
  - `interface DetectedToolchain { profile: ToolchainProfile; installCommand: string; verifyProposal: string[]; evidence: string }`
  - `detectToolchain(repoDir): Effect<DetectedToolchain | null, never, FileSystem>`
  - `resolveToolchain(repoDir, name: ToolchainName): Effect<DetectedToolchain, never, FileSystem>` (same, but the profile is forced)
  - `scanVerifyScripts(scripts: Record<string, string>): string[]` (pure)

- [ ] **Step 1: Write the failing tests**

```ts
// src/Toolchain.test.ts
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectToolchain,
  resolveToolchain,
  scanVerifyScripts,
} from "./Toolchain.js";

const makeDir = () => mkdtemp(join(tmpdir(), "toolchain-"));
const run = <A>(eff: Effect.Effect<A, never, any>) =>
  Effect.runPromise(eff.pipe(Effect.provide(NodeFileSystem.layer)));

describe("scanVerifyScripts", () => {
  it("picks verification-shaped scripts in stable order", () => {
    expect(
      scanVerifyScripts({
        typecheck: "tsc",
        lint: "eslint .",
        test: "vitest run",
        build: "vite build",
      }),
    ).toEqual(["typecheck", "lint", "test"]);
  });

  it("prefers validate:quick over validate and test over test:unit, caps at 3", () => {
    // marky-mark shape: no `test` script at all
    expect(
      scanVerifyScripts({
        typecheck: "tsc --noEmit",
        "test:unit": "vitest run",
        "test:e2e": "playwright test",
        validate: "node scripts/validate.mjs",
        "validate:quick": "node scripts/validate.mjs --quick",
      }),
    ).toEqual(["typecheck", "validate:quick", "test:unit"]);
  });

  it("returns empty for no verification-shaped scripts", () => {
    expect(scanVerifyScripts({ dev: "vite", build: "vite build" })).toEqual([]);
  });
});

describe("detectToolchain", () => {
  it("detects tauri over node when src-tauri/tauri.conf.json exists", async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: { typecheck: "tsc", "test:unit": "vitest run" },
      }),
    );
    await mkdir(join(dir, "src-tauri"), { recursive: true });
    await writeFile(join(dir, "src-tauri", "tauri.conf.json"), "{}");
    const d = await run(detectToolchain(dir));
    expect(d?.profile.name).toBe("tauri");
    expect(d?.installCommand).toBe("npm install");
    expect(d?.verifyProposal).toEqual([
      "npm run typecheck",
      "npm run test:unit",
    ]);
  });

  it("detects react-web when react is a dependency", async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19.0.0" },
        scripts: { lint: "eslint ." },
      }),
    );
    const d = await run(detectToolchain(dir));
    expect(d?.profile.name).toBe("react-web");
    expect(d?.verifyProposal).toEqual(["npm run lint"]);
  });

  it("detects node with pnpm install command from lockfile", async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    );
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    const d = await run(detectToolchain(dir));
    expect(d?.profile.name).toBe("node");
    expect(d?.installCommand).toBe("pnpm install");
    expect(d?.verifyProposal).toEqual(["pnpm run test"]);
  });

  it("detects go with family-fallback verify commands", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "go.mod"), "module example.com/x\n");
    const d = await run(detectToolchain(dir));
    expect(d?.profile.name).toBe("go");
    expect(d?.installCommand).toBe("go mod download");
    expect(d?.verifyProposal).toEqual([
      "go vet ./...",
      "go build ./...",
      "go test ./...",
    ]);
    expect(d?.profile.copyToWorktree).toEqual([]);
  });

  it("detects python and adds ruff/mypy only when configured", async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, "pyproject.toml"),
      '[project]\nname = "x"\n[tool.ruff]\nline-length = 100\n',
    );
    const d = await run(detectToolchain(dir));
    expect(d?.profile.name).toBe("python");
    expect(d?.installCommand).toBe("pip install -e .");
    expect(d?.verifyProposal).toEqual(["pytest", "ruff check"]);
  });

  it("uses uv sync when uv.lock exists", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "pyproject.toml"), '[project]\nname = "x"\n');
    await writeFile(join(dir, "uv.lock"), "");
    const d = await run(detectToolchain(dir));
    expect(d?.installCommand).toBe("uv sync");
  });

  it("returns null when nothing matches", async () => {
    const dir = await makeDir();
    expect(await run(detectToolchain(dir))).toBeNull();
  });

  it("resolveToolchain forces a profile but still scans evidence", async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { typecheck: "tsc" } }),
    );
    const d = await run(resolveToolchain(dir, "react-web"));
    expect(d.profile.name).toBe("react-web");
    expect(d.verifyProposal).toEqual(["npm run typecheck"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/Toolchain.test.ts`
Expected: FAIL — `Cannot find module './Toolchain.js'`

- [ ] **Step 3: Implement `src/Toolchain.ts`**

```ts
// src/Toolchain.ts
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import { detectPackageManager, type PackageManager } from "./InitService.js";

// ---------------------------------------------------------------------------
// Toolchain profiles (prd/007) — one row per project archetype, not an
// ecosystem census. Detection is manifest presence; verify commands come
// from script evidence where the ecosystem varies (node family) and from
// the row's fallback where tooling is uniform (go, python).
// ---------------------------------------------------------------------------

export type ToolchainName = "node" | "react-web" | "tauri" | "go" | "python";

export const TOOLCHAIN_NAMES: readonly ToolchainName[] = [
  "node",
  "react-web",
  "tauri",
  "go",
  "python",
];

export interface ToolchainProfile {
  readonly name: ToolchainName;
  readonly label: string;
  /** Verify commands used only when script/config evidence yields nothing. */
  readonly verifyFallback: readonly string[];
  readonly copyToWorktree: readonly string[];
  /** One-line note about what the sandbox image needs for this toolchain. */
  readonly dockerfileHint: string;
}

const NODE_BASE = {
  copyToWorktree: ["node_modules"],
  verifyFallback: [] as string[],
} as const;

const PROFILES: Record<ToolchainName, ToolchainProfile> = {
  node: {
    name: "node",
    label: "Node.js (CLI / library)",
    ...NODE_BASE,
    dockerfileHint: "the default image already carries Node 22",
  },
  "react-web": {
    name: "react-web",
    label: "React web app",
    ...NODE_BASE,
    dockerfileHint:
      "browser tests need their deps baked in (e.g. RUN npx playwright install --with-deps chromium)",
  },
  tauri: {
    name: "tauri",
    label: "Tauri desktop app (node + rust)",
    ...NODE_BASE,
    dockerfileHint:
      "src-tauri builds need the rust toolchain in the image (rustup + platform build deps)",
  },
  go: {
    name: "go",
    label: "Go (CLI / service)",
    verifyFallback: ["go vet ./...", "go build ./...", "go test ./..."],
    copyToWorktree: [],
    dockerfileHint:
      "the image needs the Go toolchain (e.g. FROM golang:1.23-bookworm layer or apt install golang)",
  },
  python: {
    name: "python",
    label: "Python (backend)",
    verifyFallback: ["pytest"],
    copyToWorktree: [".venv"],
    dockerfileHint: "the image needs python3 + your installer (uv/poetry/pip)",
  },
};

export interface DetectedToolchain {
  readonly profile: ToolchainProfile;
  readonly installCommand: string;
  readonly verifyProposal: string[];
  /** Human-readable justification, e.g. "package.json + src-tauri/tauri.conf.json". */
  readonly evidence: string;
}

// Verification-shaped script names, in proposal order. More specific
// variants are dropped when their general form exists (see supersedes).
const VERIFY_SCRIPT_ORDER = [
  "typecheck",
  "check",
  "lint",
  "validate:quick",
  "validate",
  "test",
  "test:unit",
] as const;

const SUPERSEDES: ReadonlyArray<readonly [keep: string, drop: string]> = [
  ["typecheck", "check"],
  ["validate:quick", "validate"],
  ["test", "test:unit"],
];

/** Pick up to 3 verification-shaped scripts from package.json `scripts`. */
export const scanVerifyScripts = (
  scripts: Record<string, string>,
): string[] => {
  const picked = VERIFY_SCRIPT_ORDER.filter((name) => name in scripts);
  const drop = new Set(
    SUPERSEDES.filter(([keep]) => picked.includes(keep as never)).map(
      ([, d]) => d,
    ),
  );
  return picked.filter((name) => !drop.has(name)).slice(0, 3);
};

const runCommand = (pm: PackageManager, script: string) =>
  `${pm} run ${script}`;

const INSTALL_COMMANDS: Record<PackageManager, string> = {
  npm: "npm install",
  pnpm: "pnpm install",
  yarn: "yarn install",
  bun: "bun install",
};

const readJson = (
  path: string,
): Effect.Effect<
  Record<string, unknown> | null,
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs
      .readFileString(path)
      .pipe(Effect.orElseSucceed(() => ""));
    if (!content) return null;
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  });

const fileExists = (
  path: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
  });

const buildDetected = (
  repoDir: string,
  profile: ToolchainProfile,
  evidence: string,
): Effect.Effect<DetectedToolchain, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const nodeFamily =
      profile.name === "node" ||
      profile.name === "react-web" ||
      profile.name === "tauri";

    if (nodeFamily) {
      const pm = yield* detectPackageManager(repoDir);
      const pkg = yield* readJson(join(repoDir, "package.json"));
      const scripts = (pkg?.["scripts"] ?? {}) as Record<string, string>;
      const picked = scanVerifyScripts(scripts);
      return {
        profile,
        installCommand: INSTALL_COMMANDS[pm],
        verifyProposal: picked.map((s) => runCommand(pm, s)),
        evidence,
      };
    }

    if (profile.name === "go") {
      return {
        profile,
        installCommand: "go mod download",
        verifyProposal: [...profile.verifyFallback],
        evidence,
      };
    }

    // python: installer by lockfile; ruff/mypy only when configured.
    const fs = yield* FileSystem.FileSystem;
    const hasUv = yield* fileExists(join(repoDir, "uv.lock"));
    const hasPoetry = yield* fileExists(join(repoDir, "poetry.lock"));
    const installCommand = hasUv
      ? "uv sync"
      : hasPoetry
        ? "poetry install"
        : "pip install -e .";
    const pyproject = yield* fs
      .readFileString(join(repoDir, "pyproject.toml"))
      .pipe(Effect.orElseSucceed(() => ""));
    const verifyProposal = [...profile.verifyFallback];
    if (pyproject.includes("[tool.ruff]")) verifyProposal.push("ruff check");
    if (pyproject.includes("[tool.mypy]")) verifyProposal.push("mypy .");
    return { profile, installCommand, verifyProposal, evidence };
  });

/** Force a named profile, still scanning the repo for evidence. */
export const resolveToolchain = (
  repoDir: string,
  name: ToolchainName,
): Effect.Effect<DetectedToolchain, never, FileSystem.FileSystem> =>
  buildDetected(repoDir, PROFILES[name], `selected: ${name}`);

/**
 * Detect the repo's toolchain profile from manifest presence. Most-specific
 * wins among node variants (tauri > react-web > node); go and python are
 * checked when there is no package.json. Null when nothing matches — the
 * caller offers manual entry or defer.
 */
export const detectToolchain = (
  repoDir: string,
): Effect.Effect<DetectedToolchain | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const hasPkg = yield* fileExists(join(repoDir, "package.json"));
    if (hasPkg) {
      if (yield* fileExists(join(repoDir, "src-tauri", "tauri.conf.json"))) {
        return yield* buildDetected(
          repoDir,
          PROFILES.tauri,
          "package.json + src-tauri/tauri.conf.json",
        );
      }
      const pkg = yield* readJson(join(repoDir, "package.json"));
      const depMaps = ["dependencies", "devDependencies"] as const;
      const hasReact = depMaps.some((key) => {
        const deps = pkg?.[key];
        return typeof deps === "object" && deps !== null && "react" in deps;
      });
      if (hasReact) {
        return yield* buildDetected(
          repoDir,
          PROFILES["react-web"],
          "package.json with a react dependency",
        );
      }
      return yield* buildDetected(repoDir, PROFILES.node, "package.json");
    }
    if (yield* fileExists(join(repoDir, "go.mod"))) {
      return yield* buildDetected(repoDir, PROFILES.go, "go.mod");
    }
    if (yield* fileExists(join(repoDir, "pyproject.toml"))) {
      return yield* buildDetected(repoDir, PROFILES.python, "pyproject.toml");
    }
    return null;
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/Toolchain.test.ts` then `npm run typecheck`
Expected: PASS, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/Toolchain.ts src/Toolchain.test.ts
git commit -m "feat(init): toolchain profiles + evidence-based verify-command detection (prd/007)"
```

(Include the Co-Authored-By trailer — see Global Constraints. Same for every commit below.)

---

### Task 2: Goal template `config.mts` + `verify.mts`; rewire `main.mts` and `setup.mts`

**Files:**

- Create: `src/templates/parallel-planner-goal-with-pr-review/config.mts`
- Create: `src/templates/parallel-planner-goal-with-pr-review/verify.mts`
- Test: `src/templates/parallel-planner-goal-with-pr-review/verify.test.mts`
- Modify: `src/templates/parallel-planner-goal-with-pr-review/main.mts` (config block at lines 95-156; startup section ~line 441)
- Modify: `src/templates/parallel-planner-goal-with-pr-review/setup.mts` (imports)

**Interfaces:**

- Produces: `config.mts` exports `SPEC_DIR, GOAL_MAX_TURNS, IMPLEMENT_ATTEMPTS, MAX_ITERATIONS, MAX_DEBATE_ROUNDS, MARKER_DETAIL, PR_SUMMARY_DETAILED, TOOLCHAIN, INSTALL_COMMAND, COPY_TO_WORKTREE, VERIFY_COMMANDS`; `verify.mts` exports `verifyCommandsText(commands: readonly string[]): string` and `missingVerifyScripts(commands: readonly string[], scripts: Record<string, string>): string[]`.
- Consumed by: Task 3 (VERIFY_TEXT promptArg), Task 4 (doctor + nudges), Task 6 (`rewriteConfigMts` regexes anchor on these exact const declarations).

- [ ] **Step 1: Write the failing tests**

```ts
// src/templates/parallel-planner-goal-with-pr-review/verify.test.mts
import { describe, expect, it } from "vitest";
import { missingVerifyScripts, verifyCommandsText } from "./verify.mts";

describe("verifyCommandsText", () => {
  it("formats one command", () => {
    expect(verifyCommandsText(["npm run typecheck"])).toBe(
      "`npm run typecheck`",
    );
  });
  it("joins two with and", () => {
    expect(verifyCommandsText(["npm run typecheck", "npm run test:unit"])).toBe(
      "`npm run typecheck` and `npm run test:unit`",
    );
  });
  it("comma-joins three", () => {
    expect(verifyCommandsText(["a", "b", "c"])).toBe("`a`, `b` and `c`");
  });
  it("falls back to a config.mts pointer when empty", () => {
    expect(verifyCommandsText([])).toContain(".sandcastle/config.mts");
  });
});

describe("missingVerifyScripts", () => {
  const scripts = { typecheck: "tsc", "test:unit": "vitest run" };
  it("flags pm-run scripts missing from package.json", () => {
    expect(
      missingVerifyScripts(["npm run typecheck", "npm run test"], scripts),
    ).toEqual(["test"]);
  });
  it("ignores non-pm-run commands (binaries checked elsewhere)", () => {
    expect(missingVerifyScripts(["cargo check", "pytest"], scripts)).toEqual(
      [],
    );
  });
  it("handles pnpm/yarn/bun runners", () => {
    expect(missingVerifyScripts(["pnpm run lint"], scripts)).toEqual(["lint"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/templates/parallel-planner-goal-with-pr-review/verify.test.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `config.mts` and `verify.mts`**

```ts
// src/templates/parallel-planner-goal-with-pr-review/config.mts
// ---------------------------------------------------------------------------
// Configuration — every knob for this template, in one place (prd/007).
// Imported by main.mts (the loop) and setup.mts (doctor): keep it pure
// consts, no logic and no side effects. Edit by hand any time, or run the
// "sandcastle-customize" skill from your coding agent to update the
// toolchain block below.
// ---------------------------------------------------------------------------

// Repo-relative directory where per-issue specs are committed. Rename to
// "prd", "docs/specs", etc. — the spec writer, goal statements, and issue
// comments all follow it. Specs land at `<SPEC_DIR>/issue-<n>.md`.
export const SPEC_DIR = "specs";

// Inner turn bound for each implementer attempt: "or stop after N turns" is
// appended to the goal so a stalled attempt ends and the next fresh-context
// attempt takes over instead of spinning forever.
export const GOAL_MAX_TURNS = 25;

// Outer fresh-context attempts per issue (`maxIterations` of the goal run).
// Each attempt is a full autonomous /goal session, so keep this small.
export const IMPLEMENT_ATTEMPTS = 4;

// Maximum number of classify→plan→execute→merge cycles before stopping.
export const MAX_ITERATIONS = 10;

// Reviewer turns per debate invocation before deadlocked threads escalate to
// the owner as NEEDS-DECISION.
export const MAX_DEBATE_ROUNDS = 3;

// When true, PR/issue markers carry full provenance: **[agent · harness ·
// model]**. Set false for plain **[agent]** markers. Turn-taking parses the
// agent name either way.
export const MARKER_DETAIL = true;

// When true (default), PR descriptions include a commit-by-commit
// walkthrough so the owner never has to click into individual commits.
// False keeps the tighter what/why summary — fewer pr-writer tokens.
export const PR_SUMMARY_DETAILED = true;

// --- Toolchain (written by `sandcastle init` from detection; prd/007) ------

// Detected project archetype — informational, drives nothing at runtime.
export const TOOLCHAIN = "node";

// Runs inside the sandbox before the agent starts each iteration
// (hooks.sandbox.onSandboxReady).
export const INSTALL_COMMAND = "npm install";

// Host paths copied into the worktree before each sandbox starts.
export const COPY_TO_WORKTREE = ["node_modules"];

// The canonical verification suite for this repo. Injected into every
// prompt that tells an agent to verify its work (spec goals, merges,
// conflict resolution, review fixes) and checked by `--doctor`. Repo
// nuance (e.g. "test:e2e is too slow for the inner loop") belongs in your
// CLAUDE.md/AGENTS.md, which agents read and which overrides this list.
export const VERIFY_COMMANDS = ["npm run typecheck", "npm run test"];
```

```ts
// src/templates/parallel-planner-goal-with-pr-review/verify.mts
// Pure helpers around the VERIFY_COMMANDS knob (config.mts) — used by
// main.mts (prompt text + startup nudge) and setup.mts (doctor).

/** Human-readable list for prompt injection: '`a`, `b` and `c`'. */
export const verifyCommandsText = (commands: readonly string[]): string => {
  if (commands.length === 0) {
    return "the verification commands declared in .sandcastle/config.mts (currently unset — check package.json scripts for the real ones)";
  }
  const quoted = commands.map((c) => `\`${c}\``);
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
};

/**
 * Script names referenced by `<pm> run <script>` verify commands but absent
 * from package.json `scripts`. Non-runner commands (cargo, pytest, …) are
 * skipped — their absence is a PATH question, not a package.json one.
 */
export const missingVerifyScripts = (
  commands: readonly string[],
  scripts: Record<string, string>,
): string[] =>
  commands
    .map((c) => /^(?:npm|pnpm|yarn|bun) run (\S+)/.exec(c)?.[1])
    .filter((s): s is string => s !== undefined && !(s in scripts));
```

- [ ] **Step 4: Rewire `main.mts`**

In `src/templates/parallel-planner-goal-with-pr-review/main.mts`:

1. Add imports (with the other `./` imports near line 48):

```ts
import {
  COPY_TO_WORKTREE,
  GOAL_MAX_TURNS,
  IMPLEMENT_ATTEMPTS,
  INSTALL_COMMAND,
  MARKER_DETAIL,
  MAX_DEBATE_ROUNDS,
  MAX_ITERATIONS,
  PR_SUMMARY_DETAILED,
  SPEC_DIR,
  VERIFY_COMMANDS,
} from "./config.mts";
import { verifyCommandsText } from "./verify.mts";
```

2. Replace the configuration section (lines 95-156). Delete the const declarations for `SPEC_DIR`, `GOAL_MAX_TURNS`, `IMPLEMENT_ATTEMPTS`, `MAX_ITERATIONS`, `MAX_DEBATE_ROUNDS`, `MARKER_DETAIL`, `PR_SUMMARY_DETAILED` (now imported). KEEP, in a slimmed section:

```ts
// ---------------------------------------------------------------------------
// Configuration — knobs live in ./config.mts (one place, also read by the
// doctor). Only derived values stay here.
// ---------------------------------------------------------------------------

// Issues carrying this label get a PR + outer review instead of the inner
// reviewer + local merge.
const PR_LABEL = github.REQUIRE_PR_LABEL;

// The branch merges target and PRs diff against.
// The branch the loop runs on — merges, pushes, and the merge phase's
// branchAhead() all anchor here. Derived, never hardcoded: a "master"
// default silently stranded every implemented branch on main-based repos
// (branchAhead was always false, so nothing ever merged).
const TARGET_BRANCH = (
  await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"])
).stdout.trim();

// Models are deliberately NOT configured here: each agent's harness and
// model are declared inline at its sandbox.run()/run() call site, so any
// agent can run a different model (or harness) by editing that one spot.

const branchFor = (issueNumber: number) => `sandcastle/issue-${issueNumber}`;

// Hooks run inside the sandbox before the agent starts each iteration.
// The install command comes from the detected toolchain (config.mts).
const hooks = {
  sandbox: { onSandboxReady: [{ command: INSTALL_COMMAND }] },
};

// Copied from the host into the worktree before each sandbox starts.
const copyToWorktree = [...COPY_TO_WORKTREE];

// Prompt-ready rendering of the verify commands, injected as the
// VERIFY_COMMANDS prompt arg everywhere agents are told to verify work.
const VERIFY_TEXT = verifyCommandsText(VERIFY_COMMANDS);
```

3. Do not add the promptArgs yet (Task 3) and no new warnings yet (Task 4).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/templates/parallel-planner-goal-with-pr-review/ && npm run typecheck`
Expected: verify tests PASS; typecheck clean. `VERIFY_TEXT` is unused for now — if `npm run typecheck` flags unused locals, add the promptArg use from Task 3 Step 2 immediately rather than suppressing (check `tsconfig.json` `noUnusedLocals` first; if it is not enabled, proceed).

- [ ] **Step 6: Commit**

```bash
git add src/templates/parallel-planner-goal-with-pr-review/config.mts \
        src/templates/parallel-planner-goal-with-pr-review/verify.mts \
        src/templates/parallel-planner-goal-with-pr-review/verify.test.mts \
        src/templates/parallel-planner-goal-with-pr-review/main.mts
git commit -m "feat(template): move goal-template knobs to config.mts; add verify helpers (prd/007)"
```

---

### Task 3: Prompts go project-agnostic (`{{VERIFY_COMMANDS}}`)

**Files:**

- Modify: `src/templates/parallel-planner-goal-with-pr-review/spec-prompt.md:47-66`
- Modify: `src/templates/parallel-planner-goal-with-pr-review/merge-prompt.md:11,25`
- Modify: `src/templates/parallel-planner-goal-with-pr-review/pr-conflict-prompt.md:11`
- Modify: `src/templates/parallel-planner-goal-with-pr-review/pr-address-prompt.md:26-28`
- Modify: `src/templates/parallel-planner-goal-with-pr-review/implementer-skill.md:37-41`
- Modify: `src/templates/parallel-planner-goal-with-pr-review/main.mts` (4 promptArgs sites)
- Test: `src/InitService.test.ts` (new assertions)

**Interfaces:**

- Consumes: `VERIFY_TEXT` from Task 2.
- Produces: all four prompts carry a `{{VERIFY_COMMANDS}}` placeholder; every `run()` reading them passes `VERIFY_COMMANDS: VERIFY_TEXT`. (Missing placeholder/arg fails fast per ADR 0020 — placeholder and arg MUST land in the same commit.)

- [ ] **Step 1: Write the failing test** (add to `src/InitService.test.ts` inside the existing goal-template describe block, near the issue-7 test at line 1415):

```ts
it("prompts carry no hardcoded verify commands — {{VERIFY_COMMANDS}} instead (prd/007)", async () => {
  const dir = await makeDir();
  await runScaffold(dir, {
    templateName: "parallel-planner-goal-with-pr-review",
  });
  const read = (f: string) => readFile(join(dir, ".sandcastle", f), "utf-8");
  for (const file of [
    "spec-prompt.md",
    "merge-prompt.md",
    "pr-conflict-prompt.md",
    "pr-address-prompt.md",
  ]) {
    const content = await read(file);
    // Tier-2 rule: repo-specific commands come from the knob, never the text.
    expect(content, file).toContain("{{VERIFY_COMMANDS}}");
    expect(content, file).not.toContain("npm run typecheck");
    expect(content, file).not.toContain("npm run test");
  }
  // The scaffolded skill is copied, not run through run() — it defers to
  // config.mts instead of carrying a placeholder.
  const skill = await read("implementer-skill.md");
  expect(skill).toContain("config.mts");
  expect(skill).not.toContain("npm run typecheck");
  // Every prompt with the placeholder gets the arg (fail-fast pairing).
  const mainTs = await read("main.mts");
  expect(mainTs.match(/VERIFY_COMMANDS: VERIFY_TEXT/g)?.length).toBe(4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/InitService.test.ts -t "hardcoded verify"`
Expected: FAIL on `spec-prompt.md` containing `npm run typecheck`.

- [ ] **Step 3: Edit the four prompts + the skill**

`spec-prompt.md` — replace lines 47-66 (“Rules for the goal statement…”) with:

```markdown
Rules for the goal statement and acceptance criteria:

- **Observable end states, not actions.** "A summary comment exists on issue #{{TASK_ID}}", never "post a comment". "The verify commands have been
  run and pass", never "run the tests". This is what makes re-runs
  idempotent: a judge re-evaluating from actual state must not double-fire
  work that already happened.
- The goal statement is one sentence naming the spec file: "All acceptance
  criteria in {{SPEC_PATH}} are satisfied for issue #{{TASK_ID}}, with
  evidence visible in the session: <the 2-4 most load-bearing criteria
  inline>."
- Always include these two criteria: {{VERIFY_COMMANDS}} pass (run in the
  implementer's session), and a summary comment from the implementer exists
  on issue #{{TASK_ID}}.
- Keep the goal statement under 1,500 characters; detail belongs in the
  acceptance criteria, which the file carries.
- Any command the goal or criteria reference MUST exist: check
  package.json `scripts` and name the real ones (a repo may declare
  `test:unit` but no `test`). A goal referencing a nonexistent command
  is unsatisfiable as written — the judge can't verify it and the
  implementer wastes attempts arguing equivalence. Your repo's
  CLAUDE.md/AGENTS.md may refine which commands are appropriate — it
  overrides the defaults above.
```

`merge-prompt.md` line 11 → `3. After resolving conflicts, run {{VERIFY_COMMANDS}} to verify everything works`
`merge-prompt.md` line 25 → `- **Tests:** the result of {{VERIFY_COMMANDS}}`
`pr-conflict-prompt.md` line 11-12 → `4. Run {{VERIFY_COMMANDS}}; fix failures caused by the merge before finishing.`
`pr-address-prompt.md` lines 26-28 → `2. If you agree (or the owner has decided): make the code change. Run {{VERIFY_COMMANDS}} before committing. Commit with a message referencing the thread topic.`

`implementer-skill.md` — replace the "Feedback loops" section (lines 37-41) with:

```markdown
## Feedback loops

Before committing, run the verify commands declared in
`.sandcastle/config.mts` (the `VERIFY_COMMANDS` list) and make sure they
pass — the goal judge needs to see their output in your session. Your
repo's CLAUDE.md/AGENTS.md may refine which commands are appropriate; it
overrides the list.
```

- [ ] **Step 4: Add the promptArgs in `main.mts`**

Four sites (all pass the same value):

1. spec-writer (`promptArgs` at ~line 663): add `VERIFY_COMMANDS: VERIFY_TEXT,`
2. inner-loop conflict-resolver (`promptArgs` at ~line 534): add `VERIFY_COMMANDS: VERIFY_TEXT,`
3. addresser turn inside `runDebate` (`promptArgs` at ~line 359): add `VERIFY_COMMANDS: VERIFY_TEXT,`
4. merger (`promptArgs` at ~line 849): add `VERIFY_COMMANDS: VERIFY_TEXT,`

Do NOT add it to pr-reviewer, planner, or reviewer runs — their prompts have no placeholder and an unused arg warns.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/InitService.test.ts && npm run typecheck`
Expected: new test PASSES; the existing issue-7 test still passes (spec-prompt keeps the literal `package.json`).

- [ ] **Step 6: Commit**

```bash
git add src/templates/parallel-planner-goal-with-pr-review src/InitService.test.ts
git commit -m "feat(template): prompts take verify commands from the knob, not hardcoded npm (prd/007)"
```

---

### Task 4: Doctor checks + startup nudges

**Files:**

- Modify: `src/templates/parallel-planner-goal-with-pr-review/setup.mts` (imports; new check after "implementer skill committed", ~line 200)
- Modify: `src/templates/parallel-planner-goal-with-pr-review/main.mts` (startup, before `await warnUncommittedSkill();` at line 441)
- Test: `src/InitService.test.ts`

**Interfaces:**

- Consumes: `VERIFY_COMMANDS` (config.mts), `missingVerifyScripts` (verify.mts), `TARGET_BRANCH` (main.mts local).
- Produces: doctor check named `verify commands`; startup warnings `warnEmptyVerifyCommands` and `warnNonDefaultBranch`.

- [ ] **Step 1: Write the failing test** (same describe block in `InitService.test.ts`):

```ts
it("doctor checks verify commands; loop nudges on empty knob and non-default branch (prd/007)", async () => {
  const dir = await makeDir();
  await runScaffold(dir, {
    templateName: "parallel-planner-goal-with-pr-review",
  });
  const setup = await readFile(join(dir, ".sandcastle", "setup.mts"), "utf-8");
  const mainTs = await readFile(join(dir, ".sandcastle", "main.mts"), "utf-8");
  // Doctor: empty knob nudges toward the customize skill; declared
  // `<pm> run X` commands must exist in package.json scripts.
  expect(setup).toContain("verify commands");
  expect(setup).toContain("sandcastle-customize");
  expect(setup).toContain("missingVerifyScripts");
  // Loop startup: nudge (never gate) on empty knob and on a loop branch
  // that differs from the repo's default branch.
  expect(mainTs).toContain("warnEmptyVerifyCommands");
  expect(mainTs).toContain("defaultBranchRef");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/InitService.test.ts -t "doctor checks verify"`
Expected: FAIL.

- [ ] **Step 3: Add the doctor check** in `setup.mts` — imports at top:

```ts
import { VERIFY_COMMANDS } from "./config.mts";
import { missingVerifyScripts } from "./verify.mts";
```

Insert after the "implementer skill committed" check (after line 200):

```ts
await check("verify commands", async () => {
  // Tier-2 knob honesty (prd/007): a wrong VERIFY_COMMANDS fails loud
  // here, not three agent-turns deep in an unsatisfiable spec goal.
  if (VERIFY_COMMANDS.length === 0) {
    return {
      ok: false,
      detail:
        "VERIFY_COMMANDS in .sandcastle/config.mts is empty — spec goals and merge checks can't name verification",
      hint: 'run the "sandcastle-customize" skill from your coding agent in this repo (or edit .sandcastle/config.mts by hand)',
    };
  }
  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    scripts = pkg.scripts ?? {};
  } catch {
    // No package.json (non-node repo): pm-run checks don't apply.
  }
  const missing = missingVerifyScripts(VERIFY_COMMANDS, scripts);
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `package.json has no script(s): ${missing.join(", ")}`,
      hint: "fix VERIFY_COMMANDS in .sandcastle/config.mts or add the scripts to package.json",
    };
  }
  return { ok: true, detail: VERIFY_COMMANDS.join(", ") };
});
```

- [ ] **Step 4: Add the startup nudges** in `main.mts`, next to `warnUncommittedSkill` (~line 425):

```ts
// Nudge, not a gate (prd/007): an empty VERIFY_COMMANDS means init deferred
// detection — agents can't be told how to verify until it's set.
const warnEmptyVerifyCommands = (): void => {
  if (VERIFY_COMMANDS.length > 0) return;
  console.warn(
    `⚠ VERIFY_COMMANDS in .sandcastle/config.mts is empty — spec goals and merge checks can't name verification commands.\n` +
      `  Fix: run the "sandcastle-customize" skill from your coding agent in this repo, or edit .sandcastle/config.mts by hand.`,
  );
};

// Nudge, not a gate (prd/007 Tier-1 guard): the loop anchors merges and PRs
// to the branch it runs on — starting it on a side branch is usually an
// accident worth flagging, never blocking.
const warnNonDefaultBranch = async (): Promise<void> => {
  try {
    const { stdout } = await execFileAsync("gh", [
      "repo",
      "view",
      "--json",
      "defaultBranchRef",
      "--jq",
      ".defaultBranchRef.name",
    ]);
    const defaultBranch = stdout.trim();
    if (defaultBranch && defaultBranch !== TARGET_BRANCH) {
      console.warn(
        `⚠ loop is running on "${TARGET_BRANCH}" but the repo's default branch is "${defaultBranch}" — merges and PRs will target "${TARGET_BRANCH}".\n` +
          `  If that's not intended, stop and re-run from "${defaultBranch}".`,
      );
    }
  } catch {
    // Best-effort nudge; never block the loop on gh availability.
  }
};
```

And in the startup sequence (line 441):

```ts
await warnUncommittedSkill();
warnEmptyVerifyCommands();
await warnNonDefaultBranch();
await nudgeConversationalLanes();
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/InitService.test.ts src/templates/parallel-planner-goal-with-pr-review/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/templates/parallel-planner-goal-with-pr-review src/InitService.test.ts
git commit -m "feat(template): doctor verify-commands check + empty-knob and branch nudges (prd/007)"
```

---

### Task 5: The `sandcastle-customize` skill

**Files:**

- Create: `src/templates/parallel-planner-goal-with-pr-review/customize-skill.md`
- Modify: `src/templates/parallel-planner-goal-with-pr-review/setup.mts` (scaffold it in `runInit`, lines 55-89)
- Test: `src/InitService.test.ts`

**Interfaces:**

- Produces: `.claude/skills/sandcastle-customize/SKILL.md` scaffolded by `npm run sandcastle:init` (same never-overwrite pattern as the implementer skill).

- [ ] **Step 1: Write the failing test**:

```ts
it("scaffolds the customize skill source and setup.mts installs it (prd/007)", async () => {
  const dir = await makeDir();
  await runScaffold(dir, {
    templateName: "parallel-planner-goal-with-pr-review",
  });
  const files = await readdir(join(dir, ".sandcastle"));
  expect(files).toContain("customize-skill.md");
  const skill = await readFile(
    join(dir, ".sandcastle", "customize-skill.md"),
    "utf-8",
  );
  expect(skill).toContain("VERIFY_COMMANDS");
  expect(skill).toContain("sandcastle:doctor");
  const setup = await readFile(join(dir, ".sandcastle", "setup.mts"), "utf-8");
  expect(setup).toContain(".claude/skills/sandcastle-customize/SKILL.md");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/InitService.test.ts -t "customize skill"`
Expected: FAIL.

- [ ] **Step 3: Write `customize-skill.md`**

```markdown
---
name: sandcastle-customize
description: Detect this repo's toolchain and set Sandcastle's verify commands (VERIFY_COMMANDS in .sandcastle/config.mts). Use when init deferred detection, when doctor flags the knob, or when the repo's verification tooling changed.
---

# Customize Sandcastle for this repo

You are configuring the Tier-2 knobs in `.sandcastle/config.mts` — the
single place Sandcastle's agents learn how to install and verify in this
repo. v1 scope: the toolchain block (`TOOLCHAIN`, `INSTALL_COMMAND`,
`COPY_TO_WORKTREE`, `VERIFY_COMMANDS`).

## 1. Inspect the repo

Gather evidence before proposing anything:

- Manifests: `package.json` (+ lockfile → npm/pnpm/yarn/bun),
  `src-tauri/tauri.conf.json` (Tauri), `go.mod`, `pyproject.toml`
  (+ `uv.lock`/`poetry.lock`).
- `package.json` `scripts`: which are verification-shaped (`typecheck`,
  `test`, `test:*`, `lint`, `check`, `validate*`)? Which actually run fast
  enough for an agent inner loop (unit tests yes; e2e/browser suites
  usually no)?
- CI config (`.github/workflows/*`): what does CI actually run to gate
  merges?
- `CLAUDE.md` / `AGENTS.md`: any stated rules about verification — these
  override everything else.

## 2. Propose

Tell the owner what you detected (project type + evidence) and propose a
`VERIFY_COMMANDS` list with one line of reasoning per command. Prefer 2-3
fast, canonical commands over an exhaustive list. If the evidence is
ambiguous, ask — don't guess.

## 3. Apply on approval

Edit `.sandcastle/config.mts` only after the owner approves:

- Set `VERIFY_COMMANDS` to the approved list.
- Correct `TOOLCHAIN`, `INSTALL_COMMAND`, and `COPY_TO_WORKTREE` if they
  don't match the repo (e.g. pnpm repo with `npm install`).
- Delete any `TODO(sandcastle)` comment left by init's "detect later".

## 4. Point at the receipt

End by telling the owner to run `npm run sandcastle:doctor` — it verifies
the declared scripts exist and the rest of the setup holds.
```

- [ ] **Step 4: Scaffold it from `runInit`** — in `setup.mts`, generalize the skill scaffolding (replacing lines 55-65):

```ts
const SKILL_PATH = ".claude/skills/sandcastle-implementer/SKILL.md";
const CUSTOMIZE_SKILL_PATH = ".claude/skills/sandcastle-customize/SKILL.md";

const scaffoldSkill = (
  targetPath: string,
  sourceFile: string,
): "created" | "exists" => {
  if (existsSync(targetPath)) return "exists";
  const source = fileURLToPath(new URL(sourceFile, import.meta.url));
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, readFileSync(source, "utf8"));
  return "created";
};

export const scaffoldImplementerSkill = (): "created" | "exists" =>
  scaffoldSkill(SKILL_PATH, "./implementer-skill.md");

export const scaffoldCustomizeSkill = (): "created" | "exists" =>
  scaffoldSkill(CUSTOMIZE_SKILL_PATH, "./customize-skill.md");
```

And in `runInit` (after the implementer-skill block at lines 71-77):

```ts
const customize = scaffoldCustomizeSkill();
console.log(
  customize === "created"
    ? `Wrote ${CUSTOMIZE_SKILL_PATH} — run it from your coding agent to tune verify commands; commit it with the scaffold.`
    : `${CUSTOMIZE_SKILL_PATH} already exists — left untouched.`,
);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/InitService.test.ts && npm run typecheck`
Expected: PASS. (`customize-skill.md` is copied automatically — `copyTemplateFiles` copies every non-excluded file.)

- [ ] **Step 6: Commit**

```bash
git add src/templates/parallel-planner-goal-with-pr-review src/InitService.test.ts
git commit -m "feat(template): sandcastle-customize skill — agent-assisted verify detection (prd/007)"
```

---

### Task 6: `scaffold()` — toolchain rewrite + `.template-base/` snapshot

**Files:**

- Modify: `src/InitService.ts` (TemplateMetadata, ScaffoldOptions, new `rewriteConfigMts` + `snapshotTemplateBase`, calls in `scaffold()` after line 1120)
- Test: `src/InitService.test.ts`

**Interfaces:**

- Produces (consumed by Task 7):
  - `TemplateMetadata.toolchainConfig?: boolean` — `true` only on `parallel-planner-goal-with-pr-review`; helper `templateHasToolchainConfig(name: string): boolean` (exported).
  - `ScaffoldOptions.toolchain?: ToolchainScaffold` where `export interface ToolchainScaffold { name: string; installCommand: string; copyToWorktree: readonly string[]; verifyCommands: readonly string[] | "defer" }` (defined in InitService — data-only, no import from Toolchain.ts, avoiding an import cycle).
- Behavior: when `options.toolchain` is set and `config.mts` exists in the scaffold, rewrite its four toolchain consts; `"defer"` writes `VERIFY_COMMANDS: string[] = []` plus a `TODO(sandcastle)` comment. Every scaffold (all templates) then snapshots `.sandcastle/` → `.sandcastle/.template-base/` + `BASE.json`.

- [ ] **Step 1: Write the failing tests** (new describe `"toolchain customization (prd/007)"`):

```ts
describe("toolchain customization (prd/007)", () => {
  const goalTemplate = { templateName: "parallel-planner-goal-with-pr-review" };

  it("rewrites config.mts from the resolved toolchain", async () => {
    const dir = await makeDir();
    await runScaffold(dir, {
      ...goalTemplate,
      toolchain: {
        name: "tauri",
        installCommand: "pnpm install",
        copyToWorktree: ["node_modules"],
        verifyCommands: ["pnpm run typecheck", "pnpm run test:unit"],
      },
    });
    const config = await readFile(
      join(dir, ".sandcastle", "config.mts"),
      "utf-8",
    );
    expect(config).toContain('TOOLCHAIN = "tauri"');
    expect(config).toContain('INSTALL_COMMAND = "pnpm install"');
    expect(config).toContain(
      'VERIFY_COMMANDS = ["pnpm run typecheck", "pnpm run test:unit"]',
    );
  });

  it("defer writes the sentinel: empty list + TODO comment", async () => {
    const dir = await makeDir();
    await runScaffold(dir, {
      ...goalTemplate,
      toolchain: {
        name: "node",
        installCommand: "npm install",
        copyToWorktree: ["node_modules"],
        verifyCommands: "defer",
      },
    });
    const config = await readFile(
      join(dir, ".sandcastle", "config.mts"),
      "utf-8",
    );
    expect(config).toContain("VERIFY_COMMANDS: string[] = []");
    expect(config).toContain("TODO(sandcastle)");
    expect(config).toContain("sandcastle-customize");
  });

  it("no toolchain option leaves template defaults", async () => {
    const dir = await makeDir();
    await runScaffold(dir, goalTemplate);
    const config = await readFile(
      join(dir, ".sandcastle", "config.mts"),
      "utf-8",
    );
    expect(config).toContain('TOOLCHAIN = "node"');
    expect(config).toContain('INSTALL_COMMAND = "npm install"');
  });

  it("snapshots the scaffold to .template-base with a BASE.json marker", async () => {
    const dir = await makeDir();
    await runScaffold(dir, goalTemplate);
    const baseDir = join(dir, ".sandcastle", ".template-base");
    const baseFiles = await readdir(baseDir);
    expect(baseFiles).toContain("config.mts");
    expect(baseFiles).toContain("main.mts");
    expect(baseFiles).toContain("BASE.json");
    const marker = JSON.parse(
      await readFile(join(baseDir, "BASE.json"), "utf-8"),
    );
    expect(marker.template).toBe("parallel-planner-goal-with-pr-review");
    expect(typeof marker.sandcastleVersion).toBe("string");
    // The ancestor matches what was scaffolded, byte for byte.
    const scaffolded = await readFile(
      join(dir, ".sandcastle", "config.mts"),
      "utf-8",
    );
    const snapshot = await readFile(join(baseDir, "config.mts"), "utf-8");
    expect(snapshot).toBe(scaffolded);
  });

  it("snapshots the blank template too (ancestor for every repo)", async () => {
    const dir = await makeDir();
    await runScaffold(dir); // blank
    const baseFiles = await readdir(join(dir, ".sandcastle", ".template-base"));
    expect(baseFiles).toContain("BASE.json");
    expect(baseFiles).toContain("prompt.md");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/InitService.test.ts -t "prd/007"`
Expected: FAIL — `toolchain` is not a known option / no `.template-base`.

- [ ] **Step 3: Implement in `src/InitService.ts`**

1. `TemplateMetadata` gains `toolchainConfig?: boolean`; set `toolchainConfig: true` on the `parallel-planner-goal-with-pr-review` entry. Export:

```ts
export const templateHasToolchainConfig = (templateName: string): boolean =>
  TEMPLATES.find((t) => t.name === templateName)?.toolchainConfig === true;
```

2. Add near `ScaffoldOptions`:

```ts
/** Resolved toolchain facts written into the template's config.mts (prd/007). */
export interface ToolchainScaffold {
  readonly name: string;
  readonly installCommand: string;
  readonly copyToWorktree: readonly string[];
  /** "defer" writes the empty-list sentinel the doctor and loop nudge on. */
  readonly verifyCommands: readonly string[] | "defer";
}
```

and `toolchain?: ToolchainScaffold;` on `ScaffoldOptions`.

3. New rewrite (same shape as `rewriteMainTs`):

```ts
const DEFER_COMMENT =
  "// TODO(sandcastle): verify commands not set — run the sandcastle-customize skill from your coding agent (or fill this in), then delete this comment.";

const rewriteConfigMts = (
  configDir: string,
  toolchain: ToolchainScaffold,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const configPath = join(configDir, "config.mts");
    const exists = yield* fs
      .exists(configPath)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    if (!exists) return;
    let content = yield* fs
      .readFileString(configPath)
      .pipe(Effect.mapError((e) => new Error(e.message)));
    content = content
      .replace(
        /TOOLCHAIN = "[^"]*"/,
        `TOOLCHAIN = ${JSON.stringify(toolchain.name)}`,
      )
      .replace(
        /INSTALL_COMMAND = "[^"]*"/,
        `INSTALL_COMMAND = ${JSON.stringify(toolchain.installCommand)}`,
      )
      .replace(
        /COPY_TO_WORKTREE = \[[^\]]*\]/,
        `COPY_TO_WORKTREE = ${JSON.stringify(toolchain.copyToWorktree)}`,
      );
    content =
      toolchain.verifyCommands === "defer"
        ? content.replace(
            /VERIFY_COMMANDS = \[[^\]]*\]/,
            `VERIFY_COMMANDS: string[] = []; ${DEFER_COMMENT}`,
          )
        : content.replace(
            /VERIFY_COMMANDS = \[[^\]]*\]/,
            `VERIFY_COMMANDS = ${JSON.stringify(toolchain.verifyCommands)}`,
          );
    yield* fs
      .writeFileString(configPath, content)
      .pipe(Effect.mapError((e) => new Error(e.message)));
  });
```

Note: the defer replacement intentionally swallows the original trailing `;` of the declaration (the regex stops at `]`), so the replacement string carries its own `;` before the comment. Verify the output parses: the test in Step 1 plus `npm run typecheck` (the scaffolded file isn't typechecked, but the template source is — the template source keeps valid defaults).

4. Vendor-base snapshot (prd/007 §3) — after ALL rewrites at the end of `scaffold()` (after the custom-tracker block at line 1145, before `return`):

```ts
// Vendor-base ancestor (prd/007): a pristine post-substitution copy of the
// scaffold, so a future `sandcastle update` can three-way merge instead of
// clobbering local edits. Committed, not gitignored — it must survive clones.
const baseDir = join(configDir, ".template-base");
yield *
  fs
    .makeDirectory(baseDir, { recursive: false })
    .pipe(Effect.mapError((e) => new Error(e.message)));
const scaffolded =
  yield *
  fs
    .readDirectory(configDir)
    .pipe(Effect.mapError((e) => new Error(e.message)));
yield *
  Effect.all(
    scaffolded
      .filter((f) => f !== ".template-base")
      .map((f) =>
        fs
          .copyFile(join(configDir, f), join(baseDir, f))
          .pipe(Effect.mapError((e) => new Error(e.message))),
      ),
    { concurrency: "unbounded" },
  );
const sandcastleVersion =
  yield *
  Effect.gen(function* () {
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const content = yield* fs
      .readFileString(pkgPath)
      .pipe(Effect.orElseSucceed(() => "{}"));
    try {
      const v = (JSON.parse(content) as { version?: string }).version;
      return typeof v === "string" ? v : "unknown";
    } catch {
      return "unknown";
    }
  });
yield *
  fs
    .writeFileString(
      join(baseDir, "BASE.json"),
      JSON.stringify({ template: templateName, sandcastleVersion }, null, 2) +
        "\n",
    )
    .pipe(Effect.mapError((e) => new Error(e.message)));
```

5. Call `rewriteConfigMts` right after `substituteTemplateArgs` (line 1115):

```ts
if (options.toolchain) {
  yield * rewriteConfigMts(configDir, options.toolchain);
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/InitService.test.ts && npm run typecheck`
Expected: all PASS, including pre-existing scaffold tests (they must not break on the new `.template-base` directory — any test doing `readdir(.sandcastle)` equality may need the new entry added).

- [ ] **Step 5: Commit**

```bash
git add src/InitService.ts src/InitService.test.ts
git commit -m "feat(init): scaffold writes toolchain knobs into config.mts + .template-base ancestor (prd/007)"
```

---

### Task 7: `cli.ts` — the init question, flags, next steps

**Files:**

- Modify: `src/cli.ts` (new options near line 140; resolution block after the label question at line 418; scaffold call at 420-437; next-steps call at 522-529)
- Modify: `src/InitService.ts` (`getNextStepsLines` signature, lines 648-719)
- Test: `src/InitService.test.ts` (`getNextStepsLines` cases)

**Interfaces:**

- Consumes: `detectToolchain`, `resolveToolchain`, `TOOLCHAIN_NAMES`, `DetectedToolchain` (Task 1); `templateHasToolchainConfig`, `ToolchainScaffold` (Task 6).
- Produces: `--toolchain <node|react-web|tauri|go|python>` and `--verify-commands <csv|"detect"|"defer">` flags; `getNextStepsLines` gains a final parameter `verify?: { deferred: boolean }`.

- [ ] **Step 1: Write the failing tests** for the next-steps change:

```ts
it("next steps guide the defer path to the customize skill and always end with doctor (prd/007)", () => {
  const tracker = getIssueTracker("github-issues")!;
  const deferred = getNextStepsLines(
    "parallel-planner-goal-with-pr-review",
    "main.mts",
    tracker,
    claudeCodeAgent,
    "npm",
    { deferred: true },
  ).join("\n");
  expect(deferred).toContain("sandcastle-customize");
  expect(deferred).toContain("npm run sandcastle:doctor");
  const confirmed = getNextStepsLines(
    "parallel-planner-goal-with-pr-review",
    "main.mts",
    tracker,
    claudeCodeAgent,
    "npm",
    { deferred: false },
  ).join("\n");
  expect(confirmed).not.toContain("sandcastle-customize");
  expect(confirmed).toContain("npm run sandcastle:doctor");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/InitService.test.ts -t "next steps guide"`
Expected: FAIL (arity / missing lines).

- [ ] **Step 3: Update `getNextStepsLines`** — add the trailing optional param `verify?: { deferred: boolean }`. In the non-blank branch:

- Replace the copyToWorktree line (700-702) with:

```ts
`${step++}. The sandbox install command and copyToWorktree paths were set from your detected toolchain in .sandcastle/config.mts — adjust there if detection got it wrong`,
```

- After the CODING_STANDARDS line, before the final "Run \`npm run sandcastle\`" line, add:

```ts
if (template === "parallel-planner-goal-with-pr-review") {
  if (verify?.deferred) {
    lines.push(
      `${step++}. Verify commands are DEFERRED — after \`npm run sandcastle:init\`, run the "sandcastle-customize" skill from your coding agent in this repo to set them (agents can't verify their work until then)`,
    );
  }
  lines.push(
    `${step++}. Run \`npm run sandcastle:doctor\` to verify the setup end-to-end`,
  );
}
```

(Keep the param optional so the blank/custom branches and existing callers stay valid.)

- [ ] **Step 4: Add the CLI flags and resolution** in `src/cli.ts`.

Options (near the other init options):

```ts
const toolchainOption = Options.choice("toolchain", TOOLCHAIN_NAMES).pipe(
  Options.withDescription(
    "Toolchain profile for templates with a config.mts (default: detected from the repo's manifests)",
  ),
  Options.optional,
);

const verifyCommandsOption = Options.text("verify-commands").pipe(
  Options.withDescription(
    'Verify commands for the scaffolded config.mts: comma-separated commands, "detect" to accept the auto-proposal, or "defer" to set them later via the sandcastle-customize skill',
  ),
  Options.optional,
);
```

Add both to the `Command.make("init", {...})` config and handler destructuring.

Resolution block — insert after the label question (line 418), before the scaffold spinner:

```ts
// Toolchain + verify commands (prd/007) — only for templates that carry a
// config.mts. Detect + confirm, with an explicit defer escape hatch.
let toolchainScaffold: ToolchainScaffold | undefined;
if (templateHasToolchainConfig(selectedTemplate)) {
  const detected =
    toolchainFlag._tag === "Some"
      ? yield * resolveToolchain(cwd, toolchainFlag.value)
      : yield * detectToolchain(cwd);
  const proposal = detected?.verifyProposal ?? [];

  let verifyCommands: readonly string[] | "defer";
  if (verifyCommandsFlag._tag === "Some") {
    const raw = verifyCommandsFlag.value.trim();
    verifyCommands =
      raw === "defer"
        ? "defer"
        : raw === "detect"
          ? proposal.length > 0
            ? proposal
            : "defer"
          : raw
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean);
  } else {
    if (!isInteractive) {
      yield * failIfNonInteractive("--verify-commands");
    }
    const detectionLine = detected
      ? `Detected: ${detected.profile.label} (${detected.evidence}).`
      : "No toolchain detected from the repo's manifests.";
    const proposalLine =
      proposal.length > 0 ? proposal.join(", ") : "none proposed";
    const choice =
      yield *
      Effect.promise(() =>
        clack.select({
          message: `${detectionLine} Verify commands: ${proposalLine}`,
          initialValue: proposal.length > 0 ? "confirm" : "defer",
          options: [
            ...(proposal.length > 0
              ? [{ value: "confirm", label: `Use: ${proposalLine}` }]
              : []),
            { value: "edit", label: "Type the commands myself" },
            {
              value: "defer",
              label: "Detect later (the sandcastle-customize skill will help)",
            },
          ],
        }),
      );
    if (clack.isCancel(choice)) {
      yield *
        Effect.fail(
          new InitError({ message: "Verify-commands selection cancelled." }),
        );
    }
    if (choice === "confirm") {
      verifyCommands = proposal;
    } else if (choice === "edit") {
      const typed =
        yield *
        Effect.promise(() =>
          clack.text({
            message: "Verify commands (comma-separated):",
            initialValue: proposal.join(", "),
          }),
        );
      if (clack.isCancel(typed)) {
        yield *
          Effect.fail(
            new InitError({ message: "Verify-commands entry cancelled." }),
          );
      }
      const parsed = String(typed)
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      verifyCommands = parsed.length > 0 ? parsed : "defer";
    } else {
      verifyCommands = "defer";
    }
  }

  const profile = detected?.profile;
  toolchainScaffold = {
    name: profile?.name ?? "node",
    installCommand: detected?.installCommand ?? "npm install",
    copyToWorktree: profile?.copyToWorktree ?? ["node_modules"],
    verifyCommands,
  };
}
```

Imports to add in `cli.ts`: `detectToolchain, resolveToolchain, TOOLCHAIN_NAMES` from `./Toolchain.js`; `templateHasToolchainConfig` and `type ToolchainScaffold` from `./InitService.js`. Note `Options.choice` needs a non-readonly tuple — if the types fight, use `Options.choice("toolchain", [...TOOLCHAIN_NAMES])`.

Pass it to scaffold (line 422): add `toolchain: toolchainScaffold,` to the options object. Pass the outcome to next steps (line 523):

```ts
const nextSteps = getNextStepsLines(
  selectedTemplate,
  scaffoldResult.mainFilename,
  selectedIssueTracker,
  selectedAgent,
  packageManager,
  toolchainScaffold
    ? { deferred: toolchainScaffold.verifyCommands === "defer" }
    : undefined,
);
```

- [ ] **Step 5: Run tests + typecheck + smoke**

Run: `npx vitest run && npm run typecheck`
Then smoke the non-interactive path end-to-end in a scratch dir:

```bash
cd "$(mktemp -d)" && git init -q && echo '{"scripts":{"typecheck":"tsc","test:unit":"vitest run"}}' > package.json
node /Users/jorgeper/src/sandcastle/dist/main.js init --agent claude-code --sandbox docker \
  --issue-tracker github-issues --template parallel-planner-goal-with-pr-review \
  --create-label false --build-image false --install-template-deps false \
  --verify-commands detect 2>&1 | tail -20
grep -A1 "VERIFY_COMMANDS" .sandcastle/config.mts
```

(Build first with `npm run build` from the repo if `dist/` is stale.)
Expected: config.mts shows `VERIFY_COMMANDS = ["npm run typecheck", "npm run test:unit"]`, next steps include the doctor line.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/InitService.ts src/InitService.test.ts
git commit -m "feat(init): toolchain question — detect + confirm/edit/defer, flags, guided next steps (prd/007)"
```

---

### Task 8: Sibling template `master` fix

**Files:**

- Modify: `src/templates/parallel-planner-with-pr-review/main.mts:93` (and the stale comment at ~line 671)
- Test: `src/InitService.test.ts`

- [ ] **Step 1: Write the failing test**:

```ts
it("parallel-planner-with-pr-review derives TARGET_BRANCH (prd/007)", async () => {
  const dir = await makeDir();
  await runScaffold(dir, { templateName: "parallel-planner-with-pr-review" });
  const mainTs = await readFile(join(dir, ".sandcastle", "main.mts"), "utf-8");
  expect(mainTs).not.toContain('TARGET_BRANCH = "master"');
  expect(mainTs).toMatch(/TARGET_BRANCH[\s\S]{0,240}rev-parse/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/InitService.test.ts -t "derives TARGET_BRANCH"`
Expected: FAIL.

- [ ] **Step 3: Fix** — replace line 93 (`const TARGET_BRANCH = "master";`) with the goal template's derivation (this template already has `execFileAsync` in scope — verify, else promisify like the goal template does):

```ts
// The branch merges target and PRs diff against — derived from the branch
// the loop runs on, never hardcoded: a "master" default silently stranded
// every implemented branch on main-based repos (branchAhead was always
// false, so nothing ever merged).
const TARGET_BRANCH = (
  await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"])
).stdout.trim();
```

Also fix the stale comment near line 671: `origin/master` → `the target branch`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/InitService.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/templates/parallel-planner-with-pr-review src/InitService.test.ts
git commit -m "fix(template): parallel-planner-with-pr-review derives TARGET_BRANCH instead of hardcoding master (prd/007)"
```

---

### Task 9: Changeset, docs, full verification

**Files:**

- Create: `.changeset/toolchain-repo-customization.md`
- Modify: `README.md` (only if it documents init options — check first)
- Modify: `FORK-MANUAL.md` ("Onboarding a repo", lines 44-145 — separate commit)

- [ ] **Step 1: Changeset** — check `.changeset/` for duplicates, read `package.json#name` for the exact package name, then:

```markdown
---
"<package.json#name>": minor
---

Per-repo customization (prd/007): `sandcastle init` detects a toolchain
profile (node, react-web, tauri, go, python), proposes verify commands from
the repo's real package.json scripts, and asks confirm / edit / defer
(`--toolchain`, `--verify-commands`). The goal template's knobs move to
`.sandcastle/config.mts` (install command, copyToWorktree, VERIFY_COMMANDS)
and its prompts take verification from the knob instead of hardcoding
`npm run typecheck`/`npm run test`. Deferring scaffolds a
`sandcastle-customize` skill; `--doctor` checks the knob (empty → nudge,
missing scripts → loud failure); the loop warns on empty knobs and
non-default branches. Every init snapshots the pristine scaffold to
`.sandcastle/.template-base/` as the ancestor for a future three-way
`sandcastle update`. The `parallel-planner-with-pr-review` template now
derives TARGET_BRANCH instead of hardcoding "master".
```

- [ ] **Step 2: README check** — `grep -n "init\|--template\|--agent" README.md`; if init flags are documented, add `--toolchain` / `--verify-commands` in the same style. If not documented, skip.

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npx vitest run`
Expected: everything green. Fix anything that isn't before proceeding.

- [ ] **Step 4: Commit feature docs**

```bash
git add .changeset README.md
git commit -m "docs: changeset + README for per-repo customization (prd/007)"
```

- [ ] **Step 5: FORK-MANUAL rewrite (separate fork-docs commit)** — update the "Onboarding a repo" section per prd/007's walkthrough: step 2 gains the toolchain question (confirm/edit/defer + the new flags), a new step covers "if you deferred: run the sandcastle-customize skill after `npm run sandcastle:init`", and step 8's doctor description mentions the two new checks. Also update prd/007's Status line to "Implemented". Commit:

```bash
git add FORK-MANUAL.md prd/007-repo-customization.md
git commit -m "docs(fork): onboarding manual covers the toolchain question + customize skill (prd/007)"
```

---

## Final checks (after all tasks)

- `npm run typecheck` and `npx vitest run` — green.
- Acceptance criteria sweep against prd/007 §Acceptance criteria: marky-mark-shaped detection (covered by Toolchain tests), defer→sentinel→doctor-nudge chain (Tasks 4/6/7 tests), no hardcoded verify commands in goal-template prompts (Task 3 test), doctor loud failure (Task 4), branch warning (Task 4), `.template-base` byte-match (Task 6 test), pure-function tests (Tasks 1/2), sibling derivation (Task 8).
- Do NOT merge to `main` — per the fork workflow the user reviews first; the branch already carries the PRD and README-FORK commits.
