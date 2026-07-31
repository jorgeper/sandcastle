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
