import { FileSystem } from "@effect/platform";
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
const run = <A>(eff: Effect.Effect<A, never, FileSystem.FileSystem>) =>
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
