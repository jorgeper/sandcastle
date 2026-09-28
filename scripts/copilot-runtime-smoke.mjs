import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { copilot } from "../dist/index.js";

const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "native-copilot-print-"));
const requests = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : {};
  if (req.method === "GET") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        object: "list",
        data: [{ id: "offline-test", object: "model" }],
      }),
    );
    return;
  }
  requests.push(body);
  const message = { role: "assistant", content: "SYNTHETIC_REPLY" };
  if (body.stream) {
    res.setHeader("Content-Type", "text/event-stream");
    for (const choice of [
      { delta: message, finish_reason: null },
      { delta: {}, finish_reason: "stop" },
    ]) {
      res.write(
        `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model: "offline-test", choices: [{ index: 0, ...choice }] })}\n\n`,
      );
    }
    res.end("data: [DONE]\n\n");
  } else {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        id: "local",
        object: "chat.completion",
        model: "offline-test",
        choices: [{ index: 0, message, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const home1 = join(root, "home-one");
  const home2 = join(root, "home-two");
  const repo1 = join(root, "repo-one");
  const repo2 = join(root, "repo-two");
  for (const path of [home1, home2, repo1, repo2]) await mkdir(path);
  const hostSessionsDir = join(root, "captured");
  const provider = (home) =>
    copilot("offline-test", {
      sessionStorage: {
        hostSessionsDir,
        sandboxSessionsDir: join(home, "session-state"),
      },
    });
  const invoke = async (home, cwd, prompt, resumeSession) => {
    const agent = provider(home);
    const { command } = agent.buildPrintCommand({
      prompt,
      resumeSession,
      dangerouslySkipPermissions: true,
    });
    const result = await exec("/bin/sh", ["-c", command], {
      cwd,
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        COPILOT_HOME: home,
        COPILOT_OFFLINE: "true",
        COPILOT_PROVIDER_TYPE: "openai",
        COPILOT_PROVIDER_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
        COPILOT_MODEL: "offline-test",
        NO_COLOR: "1",
      },
    });
    const events = result.stdout
      .split("\n")
      .flatMap((line) => agent.parseStreamLine(line));
    const sessionId = events.findLast((event) => event.sessionId)?.sessionId;
    assert.ok(
      sessionId,
      `Missing session ID: ${result.stdout}\n${result.stderr}`,
    );
    return sessionId;
  };
  const handle = {
    worktreePath: repo1,
    exec: async (command) => {
      const result = await exec("/bin/sh", ["-c", command]);
      return { ...result, exitCode: 0 };
    },
    copyFileOut: copyFile,
    copyFileIn: async (from, to) => {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
    },
    close: async () => {},
  };
  const sessionId = await invoke(
    home1,
    repo1,
    "SYNTHETIC_FIRST: reply without tools.",
  );
  await readFile(
    join(home1, "session-state", sessionId, "events.jsonl"),
    "utf8",
  );
  await provider(home1).sessionStorage.captureToHost({
    hostCwd: join(root, "host-repo"),
    sandboxCwd: repo1,
    sessionId,
    handle,
  });
  await provider(home2).sessionStorage.resumeIntoSandbox({
    hostCwd: join(root, "host-repo"),
    sandboxCwd: repo2,
    sessionId,
    handle,
  });
  const before = requests.length;
  const resumed = await invoke(
    home2,
    repo2,
    "SYNTHETIC_SECOND: reply without tools.",
    sessionId,
  );
  assert.equal(resumed, sessionId);
  assert.ok(
    requests.slice(before).some((body) => {
      const messages = JSON.stringify(body.messages);
      return (
        messages.includes("SYNTHETIC_FIRST") &&
        messages.includes("SYNTHETIC_REPLY") &&
        messages.includes("SYNTHETIC_SECOND")
      );
    }),
    "Resumed model request omitted the first turn.",
  );
  console.log(
    "PASS: native print persisted its journal; complete-directory transfer to a fresh home resumed the same UUID with prior user/assistant history.",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
