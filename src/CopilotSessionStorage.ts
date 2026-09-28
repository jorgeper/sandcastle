import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix } from "node:path";
import type { AgentSessionStorage } from "./AgentProvider.js";
import type { BindMountSandboxHandle } from "./SandboxProvider.js";

export interface CopilotSessionDirectories {
  readonly hostSessionsDir?: string;
  readonly sandboxSessionsDir?: string;
}

const quote = (value: string): string =>
  "'" + value.replace(/'/g, "'\\''") + "'";
const assertSessionId = (id: string): void => {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  ) {
    throw new Error("Copilot session transfer requires a full UUID.");
  }
};
const exists = async (path: string): Promise<boolean> => {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error("Copilot session storage must not contain symlinks.");
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rebase = (value: unknown, from: string, to: string): unknown =>
  typeof value === "string" &&
  (value === from ||
    value.startsWith(`${from}/`) ||
    value.startsWith(`${from}\\`))
    ? to + value.slice(from.length).replaceAll("\\", "/")
    : value;

/** Rewrite native context metadata, never historical prompts, code or tool output. */
export const transferCopilotSession = (
  content: string,
  from: string,
  to: string,
): string => {
  if (!content.trim()) throw new Error("Copilot session journal is empty.");
  return content
    .split("\n")
    .map((line, index) => {
      if (!line.trim()) return line;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(
          `Invalid Copilot session journal at line ${index + 1}.`,
        );
      }
      if (!object(event) || typeof event.type !== "string")
        throw new Error(`Invalid Copilot session event at line ${index + 1}.`);
      if (object(event.data) && object(event.data.context)) {
        for (const key of ["cwd", "gitRoot"]) {
          if (key in event.data.context)
            event.data.context[key] = rebase(event.data.context[key], from, to);
        }
      }
      return JSON.stringify(event);
    })
    .join("\n");
};

const rewriteWorkspace = (content: string, to: string): string => {
  if (!/^cwd:/m.test(content))
    throw new Error("Copilot workspace metadata has no cwd.");
  return content
    .replace(/^cwd:.*$/m, () => `cwd: ${JSON.stringify(to)}`)
    .replace(/^git_root:.*$/m, () => `git_root: ${JSON.stringify(to)}`);
};

const execChecked = async (
  handle: BindMountSandboxHandle,
  command: string,
): Promise<string> => {
  const result = await handle.exec(command);
  if (result.exitCode !== 0)
    throw new Error("Copilot session filesystem transfer failed.");
  return result.stdout;
};
const isTransferFile = (file: string): boolean =>
  !file
    .split("/")
    .some((part) => part.endsWith(".lock") || part.endsWith(".pid"));
const safeRelative = (file: string): string => {
  if (
    !file ||
    file.startsWith("/") ||
    file.includes("\\") ||
    file.split("/").some((p) => !p || p === "." || p === "..")
  ) {
    throw new Error("Unsafe path in Copilot session storage.");
  }
  return file;
};
const hostFiles = async (dir: string, prefix = ""): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = prefix + entry.name;
    if (!isTransferFile(file)) continue;
    if (entry.isSymbolicLink())
      throw new Error("Copilot session storage must not contain symlinks.");
    if (entry.isDirectory())
      result.push(...(await hostFiles(join(dir, entry.name), `${file}/`)));
    else if (entry.isFile()) result.push(safeRelative(file));
    else throw new Error("Unsupported file type in Copilot session storage.");
  }
  return result;
};
const requireJournal = (files: string[]): void => {
  if (!files.includes("events.jsonl") || !files.includes("workspace.yaml")) {
    throw new Error(
      "Copilot session is missing events.jsonl or workspace.yaml. Update the CLI and retry.",
    );
  }
};
const rewriteFiles = async (
  dir: string,
  from: string,
  to: string,
): Promise<void> => {
  const journal = join(dir, "events.jsonl");
  const workspace = join(dir, "workspace.yaml");
  await writeFile(
    journal,
    transferCopilotSession(await readFile(journal, "utf8"), from, to),
    { mode: 0o600 },
  );
  await writeFile(
    workspace,
    rewriteWorkspace(await readFile(workspace, "utf8"), to),
    { mode: 0o600 },
  );
};

/** Transfer the session's complete native directory, not the account or global SQLite index. */
export const makeCopilotSessionStorage = (
  options: CopilotSessionDirectories = {},
): AgentSessionStorage => {
  const hostRoot =
    options.hostSessionsDir ??
    join(
      process.env.COPILOT_HOME ?? join(homedir(), ".copilot"),
      "session-state",
    );
  const sandboxRoot =
    options.sandboxSessionsDir ?? "/home/agent/.copilot/session-state";
  const hostDir = (id: string): string => {
    assertSessionId(id);
    return join(hostRoot, id);
  };
  const sandboxDir = (id: string): string => {
    assertSessionId(id);
    return posix.join(sandboxRoot, id);
  };
  const journal = (id: string): string => join(hostDir(id), "events.jsonl");

  return {
    hostSessionFilePath: (_cwd, id) => journal(id),
    existsOnHost: async (_cwd, id) =>
      (await exists(hostDir(id))) && (await exists(journal(id))),
    readHostSession: async (_cwd, id) => {
      if (!(await exists(hostDir(id))) || !(await exists(journal(id))))
        return undefined;
      return readFile(journal(id), "utf8");
    },
    findByIdOnHost: async (id) => ({
      path:
        (await exists(hostDir(id))) && (await exists(journal(id)))
          ? journal(id)
          : undefined,
      searchedRoot: hostRoot,
    }),
    captureToHost: async ({ hostCwd, sandboxCwd, sessionId, handle }) => {
      const source = sandboxDir(sessionId);
      const destination = hostDir(sessionId);
      const links = await execChecked(
        handle,
        `find ${quote(source)} -type l -print`,
      );
      if (links.trim())
        throw new Error("Copilot session storage must not contain symlinks.");
      const listing = await execChecked(
        handle,
        `cd ${quote(source)} && find . -type f -print0`,
      );
      const files = listing
        .split("\0")
        .filter(Boolean)
        .map((file) => safeRelative(file.replace(/^\.\//, "")))
        .filter(isTransferFile);
      requireJournal(files);
      await mkdir(hostRoot, { recursive: true, mode: 0o700 });
      const staging = await mkdtemp(join(hostRoot, `.${sessionId}-`));
      const backup = `${destination}.previous-${randomUUID()}`;
      let backedUp = false;
      try {
        for (const file of files) {
          const target = join(staging, file);
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await handle.copyFileOut(posix.join(source, file), target);
        }
        await rewriteFiles(staging, sandboxCwd, hostCwd);
        if (await exists(destination)) {
          await rename(destination, backup);
          backedUp = true;
        }
        try {
          await rename(staging, destination);
        } catch (error) {
          if (backedUp) await rename(backup, destination);
          backedUp = false;
          throw error;
        }
        if (backedUp) await rm(backup, { recursive: true });
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },
    resumeIntoSandbox: async ({ hostCwd, sandboxCwd, sessionId, handle }) => {
      const source = hostDir(sessionId);
      if (!(await exists(source)))
        throw new Error("Copilot session does not exist on the host.");
      const files = await hostFiles(source);
      requireJournal(files);
      const destination = sandboxDir(sessionId);
      const staging = `${destination}.incoming-${randomUUID()}`;
      const backup = `${destination}.previous-${randomUUID()}`;
      const local = await mkdtemp(join(hostRoot, `.${sessionId}-`));
      try {
        await execChecked(
          handle,
          `mkdir -p ${quote(staging)} && chmod 700 ${quote(staging)}`,
        );
        for (const file of files) {
          let input = join(source, file);
          if (file === "events.jsonl" || file === "workspace.yaml") {
            const content = await readFile(input, "utf8");
            input = join(local, file);
            await writeFile(
              input,
              file === "events.jsonl"
                ? transferCopilotSession(content, hostCwd, sandboxCwd)
                : rewriteWorkspace(content, sandboxCwd),
              { mode: 0o600 },
            );
          }
          const target = posix.join(staging, file);
          await execChecked(handle, `mkdir -p ${quote(posix.dirname(target))}`);
          await handle.copyFileIn(input, target);
        }
        await execChecked(
          handle,
          `if [ -e ${quote(destination)} ]; then mv ${quote(destination)} ${quote(backup)} || exit 1; fi; ` +
            `if mv ${quote(staging)} ${quote(destination)}; then rm -rf ${quote(backup)}; ` +
            `else if [ -e ${quote(backup)} ]; then mv ${quote(backup)} ${quote(destination)}; fi; exit 1; fi`,
        );
      } finally {
        await rm(local, { recursive: true, force: true });
        await execChecked(handle, `rm -rf ${quote(staging)}`);
      }
    },
  };
};
