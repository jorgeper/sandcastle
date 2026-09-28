import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  makeCopilotSessionStorage,
  transferCopilotSession,
} from "./CopilotSessionStorage.js";
import type { BindMountSandboxHandle } from "./SandboxProvider.js";

const execAsync = promisify(exec);
const journal = (cwd: string) =>
  JSON.stringify({
    type: "session.start",
    id: "event-id",
    parentId: null,
    data: { context: { cwd, gitRoot: cwd }, sessionId: "unchanged" },
  }) +
  "\n" +
  JSON.stringify({
    type: "user.message",
    data: { content: `Read ${cwd}/file.md` },
  }) +
  "\n";

describe("Copilot native session transfer", () => {
  it("rebases context while preserving history, identity, and Windows source paths", () => {
    const output = transferCopilotSession(
      journal("C:\\work\\repo"),
      "C:\\work\\repo",
      "/sandbox",
    );
    const events = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events[0].data.context).toEqual({
      cwd: "/sandbox",
      gitRoot: "/sandbox",
    });
    expect(events[0].id).toBe("event-id");
    expect(events[1].data.content).toBe("Read C:\\work\\repo/file.md");
    expect(() => transferCopilotSession("{bad", "/a", "/b")).toThrow(/line 1/);
  });

  it("round-trips journals, checkpoints and binary files without global credentials or locks", async () => {
    const root = await mkdtemp(join(tmpdir(), "copilot-storage-"));
    try {
      const id = randomUUID();
      const sandboxRoot = join(root, "sandbox-sessions");
      const hostRoot = join(root, "host-sessions");
      const original = join(sandboxRoot, id);
      await mkdir(join(original, "files"), { recursive: true });
      await mkdir(join(original, "checkpoints"));
      await writeFile(join(original, "events.jsonl"), journal("/sandbox/repo"));
      await writeFile(
        join(original, "workspace.yaml"),
        `id: ${id}\ncwd: /sandbox/repo\ngit_root: /sandbox/repo\n`,
      );
      await writeFile(join(original, "checkpoints/index.md"), "checkpoint");
      await writeFile(
        join(original, "files/image.bin"),
        Buffer.from([0, 255, 13, 10]),
      );
      await writeFile(join(original, ".workspace-fork.lock"), "not portable");
      const handle: BindMountSandboxHandle = {
        worktreePath: "/sandbox/repo",
        exec: async (command) => {
          const { stdout, stderr } = await execAsync(command);
          return { stdout, stderr, exitCode: 0 };
        },
        copyFileOut: copyFile,
        copyFileIn: async (from, to) => {
          await mkdir(dirname(to), { recursive: true });
          await copyFile(from, to);
        },
        close: async () => {},
      };
      const storage = makeCopilotSessionStorage({
        hostSessionsDir: hostRoot,
        sandboxSessionsDir: sandboxRoot,
      });
      const args = {
        hostCwd: "/host/repo",
        sandboxCwd: "/sandbox/repo",
        sessionId: id,
        handle,
      };
      await storage.captureToHost(args);
      expect(
        await readFile(join(hostRoot, id, "workspace.yaml"), "utf8"),
      ).toContain('git_root: "/host/repo"');
      expect(await storage.existsOnHost("/any/cwd", id)).toBe(true);
      expect(await storage.readHostSession("/host/repo", id)).toContain(
        'cwd":"/host/repo"',
      );
      expect(await readdir(hostRoot)).toEqual([id]);
      expect(await readdir(join(hostRoot, id))).not.toContain(
        ".workspace-fork.lock",
      );
      expect(await storage.findByIdOnHost(id)).toEqual({
        path: join(hostRoot, id, "events.jsonl"),
        searchedRoot: hostRoot,
      });
      await rm(original, { recursive: true });
      await storage.resumeIntoSandbox(args);
      expect(await readFile(join(original, "events.jsonl"), "utf8")).toContain(
        'cwd":"/sandbox/repo"',
      );
      expect(
        await readFile(join(original, "workspace.yaml"), "utf8"),
      ).toContain('cwd: "/sandbox/repo"');
      expect(await readFile(join(original, "files/image.bin"))).toEqual(
        Buffer.from([0, 255, 13, 10]),
      );
      expect(
        await readFile(join(original, "checkpoints/index.md"), "utf8"),
      ).toBe("checkpoint");
      const previous = await storage.readHostSession("", id);
      const sandboxPrevious = await readFile(
        join(original, "events.jsonl"),
        "utf8",
      );
      await expect(
        storage.resumeIntoSandbox({
          ...args,
          handle: {
            ...handle,
            copyFileIn: async () => {
              throw new Error("restore failed");
            },
          },
        }),
      ).rejects.toThrow("restore failed");
      expect(await readFile(join(original, "events.jsonl"), "utf8")).toBe(
        sandboxPrevious,
      );
      expect(await readdir(sandboxRoot)).toEqual([id]);
      await expect(
        storage.captureToHost({
          ...args,
          handle: {
            ...handle,
            copyFileOut: async () => {
              throw new Error("copy failed");
            },
          },
        }),
      ).rejects.toThrow("copy failed");
      expect(await storage.readHostSession("", id)).toBe(previous);
      expect(await readdir(hostRoot)).toEqual([id]);
      await writeFile(join(original, "events.jsonl"), "");
      await expect(storage.captureToHost(args)).rejects.toThrow(
        /journal is empty/,
      );
      expect(await storage.readHostSession("", id)).toBe(previous);
      await writeFile(join(original, "events.jsonl"), sandboxPrevious);
      await writeFile(join(hostRoot, id, "stale.txt"), "removed in sandbox");
      await storage.captureToHost(args);
      expect(await readdir(join(hostRoot, id))).not.toContain("stale.txt");
      await symlink(join(root, "outside"), join(original, "files/link"));
      await expect(storage.captureToHost(args)).rejects.toThrow(/symlinks/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal IDs and distinguishes missing sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "copilot-missing-"));
    try {
      const storage = makeCopilotSessionStorage({ hostSessionsDir: root });
      expect(() => storage.hostSessionFilePath("", "../escape")).toThrow(
        /UUID/,
      );
      expect(await storage.existsOnHost("", randomUUID())).toBe(false);
      expect(await storage.readHostSession("", randomUUID())).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
