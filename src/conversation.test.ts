import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCode, cursor, type AgentProvider } from "./AgentProvider.js";
import { ConversationNotSupportedError } from "./ConversationNotSupportedError.js";
import {
  conversation,
  conversationBranch,
  ConversationError,
} from "./conversation.js";
import {
  APPROVED_MESSAGE,
  composeConversationProtocol,
  CONVERSATION_PROTOCOL_INSTRUCTIONS,
  TURN_TAG,
  validateAgentTurn,
  agentTurnSchema,
  type AgentTurn,
} from "./conversationEnvelope.js";
import {
  ConversationStore,
  pendingHumanMessage,
  type ConversationMessage,
} from "./ConversationStore.js";
import { StructuredOutputError } from "./Output.js";
import { testStubProvider } from "./sandboxes/test-shared.js";
import type { run, RunOptions } from "./run.js";

const makeDir = () => mkdtemp(join(tmpdir(), "conversation-"));

const agent = claudeCode("claude-opus-4-8");
const sandbox = testStubProvider({ name: "test" }).provider;

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

describe("validateAgentTurn", () => {
  it("accepts an ask turn with options", () => {
    const result = validateAgentTurn({
      type: "ask",
      message: "Mobile or web?",
      options: ["Mobile", "Web"],
    });
    expect(result).toEqual({
      turn: {
        type: "ask",
        message: "Mobile or web?",
        options: ["Mobile", "Web"],
      },
    });
  });

  it("accepts an ask turn without options", () => {
    expect(validateAgentTurn({ type: "ask", message: "Why?" })).toEqual({
      turn: { type: "ask", message: "Why?" },
    });
  });

  it("accepts propose and done turns", () => {
    expect(validateAgentTurn({ type: "propose", message: "# Draft" })).toEqual({
      turn: { type: "propose", message: "# Draft" },
    });
    expect(
      validateAgentTurn({
        type: "done",
        message: "PR opened",
        artifacts: ["https://github.com/x/y/pull/1"],
      }),
    ).toEqual({
      turn: {
        type: "done",
        message: "PR opened",
        artifacts: ["https://github.com/x/y/pull/1"],
      },
    });
  });

  it("rejects non-objects and unknown types", () => {
    expect(validateAgentTurn("nope")).toHaveProperty("issues");
    expect(validateAgentTurn(null)).toHaveProperty("issues");
    expect(validateAgentTurn({ type: "shout", message: "hi" })).toHaveProperty(
      "issues",
    );
  });

  it("rejects empty messages, empty options, and done without artifacts", () => {
    expect(validateAgentTurn({ type: "ask", message: "  " })).toHaveProperty(
      "issues",
    );
    expect(
      validateAgentTurn({ type: "ask", message: "q", options: [] }),
    ).toHaveProperty("issues");
    expect(validateAgentTurn({ type: "done", message: "d" })).toHaveProperty(
      "issues",
    );
  });

  it("backs the Standard Schema validator", () => {
    const good = agentTurnSchema["~standard"].validate({
      type: "propose",
      message: "draft",
    });
    expect(good).toEqual({ value: { type: "propose", message: "draft" } });
    const bad = agentTurnSchema["~standard"].validate({ type: "nope" });
    expect(bad).toHaveProperty("issues");
  });
});

// ---------------------------------------------------------------------------
// Protocol composition
// ---------------------------------------------------------------------------

describe("composeConversationProtocol", () => {
  it("appends the library-owned protocol instructions to the role prompt", () => {
    const composed = composeConversationProtocol("  You are a designer.  ");
    expect(composed.startsWith("You are a designer.")).toBe(true);
    expect(composed).toContain(CONVERSATION_PROTOCOL_INSTRUCTIONS);
    expect(composed.indexOf("You are a designer.")).toBeLessThan(
      composed.indexOf("## Conversation protocol"),
    );
  });

  it("instructions reference the turn tag and the canonical approval message", () => {
    expect(CONVERSATION_PROTOCOL_INSTRUCTIONS).toContain(`<${TURN_TAG}>`);
    expect(CONVERSATION_PROTOCOL_INSTRUCTIONS).toContain(APPROVED_MESSAGE);
    expect(CONVERSATION_PROTOCOL_INSTRUCTIONS).toContain('"type": "ask"');
  });

  it("instructions forbid restating options inside the message body", () => {
    // The frontend renders options as the selection UI; duplicated
    // enumerations in the prose defeat it (see screenshot bug).
    expect(CONVERSATION_PROTOCOL_INSTRUCTIONS).toContain(
      "NEVER enumerate, number, or restate",
    );
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const baseMetadata = (id: string) => ({
  id,
  status: "awaiting-agent" as const,
  agent: { provider: "claude-code" },
  openingPrompt: "opening",
  branch: conversationBranch(id),
  artifacts: [],
});

describe("ConversationStore", () => {
  it("creates, appends, and replays messages with increasing seq", async () => {
    const dir = await makeDir();
    const store = await ConversationStore.create(dir, baseMetadata("a"));
    await store.appendMessage({
      role: "agent",
      body: { type: "ask", message: "q1" },
    });
    await store.appendMessage({ role: "human", body: "a1" });
    const messages = await store.readMessages();
    expect(messages.map((m) => [m.seq, m.role])).toEqual([
      [1, "agent"],
      [2, "human"],
    ]);
  });

  it("fails on duplicate create and unknown open", async () => {
    const dir = await makeDir();
    await ConversationStore.create(dir, baseMetadata("dup"));
    await expect(
      ConversationStore.create(dir, baseMetadata("dup")),
    ).rejects.toThrow(/already exists/);
    await expect(ConversationStore.open(dir, "missing")).rejects.toThrow(
      /not found/,
    );
  });

  it("updateMetadata merges a patch and bumps updatedAt", async () => {
    const dir = await makeDir();
    const store = await ConversationStore.create(dir, baseMetadata("m"));
    const before = await store.readMetadata();
    await new Promise((r) => setTimeout(r, 5));
    const after = await store.updateMetadata({ status: "awaiting-human" });
    expect(after.status).toBe("awaiting-human");
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  it("detects a trailing unanswered human message", async () => {
    const dir = await makeDir();
    const store = await ConversationStore.create(dir, baseMetadata("p"));
    expect(pendingHumanMessage(await store.readMessages())).toBeUndefined();
    await store.appendMessage({
      role: "agent",
      body: { type: "ask", message: "q" },
    });
    await store.appendMessage({ role: "human", body: "answer" });
    const pending = pendingHumanMessage(await store.readMessages());
    expect(pending?.body).toBe("answer");
  });

  it("skips torn or malformed jsonl lines instead of failing", async () => {
    const dir = await makeDir();
    const store = await ConversationStore.create(dir, baseMetadata("torn"));
    await store.appendMessage({ role: "human", body: "ok" });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(dir, "torn", "messages.jsonl"), '{"seq": 2, "rol');
    const messages = await store.readMessages();
    expect(messages).toHaveLength(1);
  });

  it("lists conversations most recently updated first with summaries", async () => {
    const dir = await makeDir();
    const a = await ConversationStore.create(dir, {
      ...baseMetadata("a"),
      role: "designer",
    });
    await new Promise((r) => setTimeout(r, 5));
    const b = await ConversationStore.create(dir, baseMetadata("b"));
    await a.appendMessage({
      role: "agent",
      body: { type: "ask", message: "first line\nsecond" },
    });
    await a.updateMetadata({ status: "awaiting-human" });
    const list = await ConversationStore.list(dir);
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
    expect(list[0]).toMatchObject({
      id: "a",
      role: "designer",
      status: "awaiting-human",
      lastMessage: "first line",
    });
    void b;
  });

  it("returns an empty list for a missing directory", async () => {
    expect(await ConversationStore.list("/nonexistent/nowhere")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Conversation end-to-end (mocked runner)
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly options: RunOptions & {
    output?: { tag: string; maxRetries?: number };
  };
}

const makeFakeRunner = (
  script: Array<AgentTurn | Error>,
  sessionIds: string[] = ["sess-1", "sess-2", "sess-3", "sess-4"],
) => {
  const calls: FakeCall[] = [];
  const runner = (async (options: RunOptions) => {
    calls.push({ options } as FakeCall);
    const next = script.shift();
    if (next === undefined) throw new Error("fake runner script exhausted");
    if (next instanceof Error) throw next;
    return {
      iterations: [{ sessionId: sessionIds[calls.length - 1] }],
      stdout: "",
      commits: [],
      branch: "conversation/test",
      logFilePath: "/tmp/conversation-test.log",
      output: next,
    };
  }) as unknown as typeof run;
  return { runner, calls };
};

describe("conversation (mocked runner)", () => {
  it("start composes the opening prompt, runs turn 1, and persists everything", async () => {
    const dir = await makeDir();
    const ask: AgentTurn = {
      type: "ask",
      message: "Who is it for?",
      options: ["Me", "Everyone"],
    };
    const { runner, calls } = makeFakeRunner([ask]);
    const convo = await conversation.start({
      name: "design-x",
      role: "designer",
      agent,
      sandbox,
      prompt: "You design {{TOPIC}}.",
      promptArgs: { TOPIC: "notifications" },
      dir,
      runner,
    });

    expect(calls).toHaveLength(1);
    const options = calls[0]!.options;
    expect(options.prompt).toContain("You design notifications.");
    expect(options.prompt).toContain(`<${TURN_TAG}>`);
    expect(options.maxIterations).toBe(1);
    expect(options.resumeSession).toBeUndefined();
    expect(options.branchStrategy).toEqual({
      type: "branch",
      branch: "conversation/design-x",
    });
    expect(options.output?.tag).toBe(TURN_TAG);
    expect(options.output?.maxRetries).toBe(1);

    expect(convo.status).toBe("awaiting-human");
    expect(convo.lastAgentTurn).toEqual(ask);
    expect(convo.metadata.sessionId).toBe("sess-1");
    expect(convo.metadata.logPath).toBe("/tmp/conversation-test.log");
    expect(convo.metadata.agent).toEqual({
      provider: "claude-code",
      model: "claude-opus-4-8",
    });

    const reread = await ConversationStore.open(dir, "design-x");
    expect((await reread.readMessages()).at(-1)?.role).toBe("agent");
  });

  it("send persists the human message before the agent turn and resumes the session", async () => {
    const dir = await makeDir();
    const { runner, calls } = makeFakeRunner([
      { type: "ask", message: "q1" },
      { type: "propose", message: "# PRD draft" },
      {
        type: "done",
        message: "PR opened",
        artifacts: ["https://github.com/x/y/pull/9"],
      },
    ]);
    const convo = await conversation.start({
      name: "flow",
      agent,
      sandbox,
      prompt: "role",
      dir,
      runner,
    });

    const proposal = await convo.send("free text answer");
    expect(proposal.type).toBe("propose");
    // The human's message is prefixed verbatim; the envelope reminder is
    // appended so run()'s output-tag-in-prompt validation holds on resumed
    // turns (it only passes naturally on the opening prompt).
    expect(calls[1]!.options.prompt!.startsWith("free text answer")).toBe(true);
    expect(calls[1]!.options.resumeSession).toBe("sess-1");
    for (const call of calls) {
      expect(call.options.prompt).toContain(`<${TURN_TAG}>`);
    }

    const done = await convo.send(APPROVED_MESSAGE);
    expect(done.type).toBe("done");
    expect(convo.status).toBe("done");
    expect(convo.metadata.artifacts).toEqual(["https://github.com/x/y/pull/9"]);

    const roles = convo.messages.map((m: ConversationMessage) => m.role);
    expect(roles).toEqual(["agent", "human", "agent", "human", "agent"]);
  });

  it("send on a done conversation reopens it", async () => {
    const dir = await makeDir();
    const { runner } = makeFakeRunner([
      { type: "done", message: "did nothing", artifacts: [] },
      { type: "ask", message: "more?" },
    ]);
    const convo = await conversation.start({
      name: "reopen",
      agent,
      sandbox,
      prompt: "role",
      dir,
      runner,
    });
    expect(convo.status).toBe("done");
    const turn = await convo.send("actually, one more thing");
    expect(turn).toEqual({ type: "ask", message: "more?" });
    expect(convo.status).toBe("awaiting-human");
  });

  it("rejects empty sends and sends while a human message is unanswered", async () => {
    const dir = await makeDir();
    const store = await ConversationStore.create(dir, {
      ...baseMetadata("stuck"),
      sessionId: "sess-1",
    } as Parameters<typeof ConversationStore.create>[1]);
    await store.appendMessage({
      role: "agent",
      body: { type: "ask", message: "q" },
    });
    await store.appendMessage({ role: "human", body: "unanswered" });
    const { runner } = makeFakeRunner([]);
    const convo = await conversation.open("stuck", {
      agent,
      sandbox,
      dir,
      runner,
    });
    await expect(convo.send("   ")).rejects.toThrow(ConversationError);
    await expect(convo.send("new message")).rejects.toThrow(
      /has not been answered/,
    );
  });

  it("recover re-runs a trailing unanswered human message without duplicating it", async () => {
    const dir = await makeDir();
    const store = await ConversationStore.create(dir, {
      ...baseMetadata("crashed"),
      sessionId: "sess-1",
    } as Parameters<typeof ConversationStore.create>[1]);
    await store.appendMessage({
      role: "agent",
      body: { type: "ask", message: "q" },
    });
    await store.appendMessage({ role: "human", body: "my answer" });

    const { runner, calls } = makeFakeRunner([
      { type: "propose", message: "draft" },
    ]);
    const convo = await conversation.open("crashed", {
      agent,
      sandbox,
      dir,
      runner,
    });
    const turn = await convo.recover();
    expect(turn?.type).toBe("propose");
    expect(calls[0]!.options.prompt!.startsWith("my answer")).toBe(true);
    expect(calls[0]!.options.prompt).toContain(`<${TURN_TAG}>`);
    expect(calls[0]!.options.resumeSession).toBe("sess-1");
    const roles = convo.messages.map((m) => m.role);
    expect(roles).toEqual(["agent", "human", "agent"]);
  });

  it("recover returns undefined when there is nothing to recover", async () => {
    const dir = await makeDir();
    const { runner } = makeFakeRunner([{ type: "ask", message: "q" }]);
    const convo = await conversation.start({
      name: "idle",
      agent,
      sandbox,
      prompt: "role",
      dir,
      runner,
    });
    expect(await convo.recover()).toBeUndefined();
  });

  it("marks the conversation failed when the envelope fails after the corrective resume", async () => {
    const dir = await makeDir();
    const failure = new StructuredOutputError("no valid envelope", {
      tag: TURN_TAG,
      rawMatched: undefined,
      commits: [],
      branch: "conversation/bad",
      sessionId: "sess-err",
    });
    const { runner } = makeFakeRunner([
      failure,
      { type: "ask", message: "recovered" },
    ]);
    await expect(
      conversation.start({
        name: "bad",
        agent,
        sandbox,
        prompt: "role",
        dir,
        runner,
      }),
    ).rejects.toThrow("no valid envelope");

    const reopened = await conversation.open("bad", {
      agent,
      sandbox,
      dir,
      runner,
    });
    expect(reopened.status).toBe("failed");
    const turn = await reopened.recover();
    expect(turn).toEqual({ type: "ask", message: "recovered" });
    expect(reopened.status).toBe("awaiting-human");
  });

  it("fails fast on duplicate names, unknown ids, and provider mismatches", async () => {
    const dir = await makeDir();
    const { runner } = makeFakeRunner([
      { type: "ask", message: "q" },
      { type: "ask", message: "q" },
    ]);
    await conversation.start({
      name: "unique",
      agent,
      sandbox,
      prompt: "role",
      dir,
      runner,
    });
    await expect(
      conversation.start({
        name: "unique",
        agent,
        sandbox,
        prompt: "role",
        dir,
        runner,
      }),
    ).rejects.toThrow(/already exists/);
    await expect(
      conversation.open("nope", { agent, sandbox, dir, runner }),
    ).rejects.toThrow(/not found/);

    const store = await ConversationStore.open(dir, "unique");
    await store.updateMetadata({
      agent: { provider: "someone-else" },
    } as never);
    await expect(
      conversation.open("unique", { agent, sandbox, dir, runner }),
    ).rejects.toThrow(/cannot be resumed across providers/);

    await store.updateMetadata({
      agent: { provider: "claude-code", model: "claude-sonnet-4-6" },
    } as never);
    await expect(
      conversation.open("unique", { agent, sandbox, dir, runner }),
    ).rejects.toThrow(/started with model/);
  });

  it("validates ids, prompt exclusivity, and missing promptArgs", async () => {
    const dir = await makeDir();
    const { runner } = makeFakeRunner([]);
    const base = { agent, sandbox, dir, runner };
    await expect(
      conversation.start({ ...base, name: "bad name!", prompt: "x" }),
    ).rejects.toThrow(/Invalid conversation name/);
    await expect(conversation.start({ ...base, name: "x" })).rejects.toThrow(
      /exactly one of prompt or promptFile/,
    );
    await expect(
      conversation.start({
        ...base,
        name: "x",
        prompt: "a",
        promptFile: "b.md",
      }),
    ).rejects.toThrow(/exactly one of prompt or promptFile/);
    await expect(
      conversation.start({ ...base, name: "x", prompt: "Hi {{WHO}}" }),
    ).rejects.toThrow(/missing promptArgs: WHO/);
  });

  it("lists conversations through the public API", async () => {
    const dir = await makeDir();
    const { runner } = makeFakeRunner([{ type: "ask", message: "q" }]);
    await conversation.start({
      name: "listed",
      role: "designer",
      agent,
      sandbox,
      prompt: "role",
      dir,
      runner,
    });
    const list = await conversation.list({ dir });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "listed", role: "designer" });
  });
});

// ---------------------------------------------------------------------------
// Provider gating
// ---------------------------------------------------------------------------

describe("ConversationNotSupportedError", () => {
  it("rejects providers without session storage", async () => {
    const dir = await makeDir();
    await expect(
      conversation.start({
        name: "x",
        agent: cursor("cursor-model"),
        sandbox,
        prompt: "role",
        dir,
      }),
    ).rejects.toThrow(ConversationNotSupportedError);
    try {
      await conversation.start({
        name: "x",
        agent: cursor("cursor-model"),
        sandbox,
        prompt: "role",
        dir,
      });
      expect.unreachable();
    } catch (error) {
      const e = error as ConversationNotSupportedError;
      expect(e._tag).toBe("ConversationNotSupportedError");
      expect(e.provider).toBe("cursor");
      expect(e.missing).toBe("session-resume");
    }
  });

  it("rejects resume-capable providers other than claudeCode in v1", async () => {
    const dir = await makeDir();
    const impostor = {
      ...claudeCode("claude-opus-4-8"),
      name: "codex",
    } as AgentProvider;
    try {
      await conversation.start({
        name: "x",
        agent: impostor,
        sandbox,
        prompt: "role",
        dir,
      });
      expect.unreachable();
    } catch (error) {
      const e = error as ConversationNotSupportedError;
      expect(e.provider).toBe("codex");
      expect(e.missing).toBe("unsupported-provider");
    }
  });

  it("gates open() the same way it gates start()", async () => {
    const dir = await makeDir();
    await expect(
      conversation.open("whatever", {
        agent: cursor("cursor-model"),
        sandbox,
        dir,
      }),
    ).rejects.toThrow(ConversationNotSupportedError);
  });
});
