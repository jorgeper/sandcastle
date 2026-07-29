import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { ChatApp } from "./ChatApp.js";
import { renderMarkdown } from "./markdown.js";
import type { Conversation } from "../conversation.js";
import type { AgentTurn } from "../conversationEnvelope.js";
import { APPROVED_MESSAGE } from "../conversationEnvelope.js";
import type {
  ConversationMessage,
  ConversationMetadata,
} from "../ConversationStore.js";

const ENTER = "\r";
const ARROW_DOWN = "[B";

const waitFor = async (predicate: () => boolean): Promise<void> => {
  // Generous bound: the full suite runs many files in parallel and a loaded
  // machine can starve the Ink render loop for seconds.
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor timed out");
};

interface StubOptions {
  turn: AgentTurn;
  onSend?: (message: string) => AgentTurn;
}

/** Duck-typed Conversation over in-memory state — the chat frontend is a
 *  stateless renderer, so a stub with the same surface is a faithful host. */
const stubConversation = (options: StubOptions) => {
  const sent: string[] = [];
  let seq = 0;
  const messages: ConversationMessage[] = [
    { seq: ++seq, role: "agent", at: "t0", body: options.turn },
  ];
  const state = {
    status: "awaiting-human" as ConversationMetadata["status"],
    lastAgentTurn: options.turn as AgentTurn | undefined,
  };
  const convo = {
    id: "stub-convo",
    get status() {
      return state.status;
    },
    get messages(): readonly ConversationMessage[] {
      return messages;
    },
    get lastAgentTurn() {
      return state.lastAgentTurn;
    },
    metadata: {
      id: "stub-convo",
      status: "awaiting-human",
      role: "designer",
      agent: { provider: "claude-code" },
      openingPrompt: "",
      branch: "conversation/stub-convo",
      artifacts: [],
      createdAt: "t0",
      updatedAt: "t0",
    } as ConversationMetadata,
    async send(message: string): Promise<AgentTurn> {
      sent.push(message);
      const next =
        options.onSend?.(message) ??
        ({ type: "done", message: "finished", artifacts: [] } as AgentTurn);
      messages.push({ seq: ++seq, role: "human", at: "t", body: message });
      messages.push({ seq: ++seq, role: "agent", at: "t", body: next });
      state.lastAgentTurn = next;
      state.status = next.type === "done" ? "done" : "awaiting-human";
      return next;
    },
    async recover(): Promise<AgentTurn | undefined> {
      return undefined;
    },
  };
  return { convo: convo as unknown as Conversation, sent };
};

describe("ChatApp", () => {
  it("renders an ask turn's question and options as a select menu", async () => {
    const { convo } = stubConversation({
      turn: {
        type: "ask",
        message: "Where should notifications appear?",
        options: ["In-app", "Email"],
      },
    });
    const { lastFrame } = render(
      <ChatApp conversation={convo} onFinished={() => {}} />,
    );
    await waitFor(() => lastFrame()!.includes("In-app"));
    const frame = lastFrame()!;
    expect(frame).toContain("Where should notifications appear?");
    expect(frame).toContain("In-app");
    expect(frame).toContain("Email");
    expect(frame).toContain("Type a custom answer");
    expect(frame).toContain("Ctrl-C detaches");
    expect(frame).toContain("stub-convo");
  });

  it("sends the selected option when the user picks one", async () => {
    const { convo, sent } = stubConversation({
      turn: {
        type: "ask",
        message: "Pick one",
        options: ["Alpha", "Beta"],
      },
    });
    const onFinished = vi.fn();
    const { stdin, lastFrame } = render(
      <ChatApp conversation={convo} onFinished={onFinished} />,
    );
    await waitFor(() => lastFrame()!.includes("Alpha"));
    stdin.write(ARROW_DOWN);
    await waitFor(() => lastFrame()!.includes("❯ Beta"));
    stdin.write(ENTER);
    await waitFor(() => sent.length === 1);
    expect(sent).toEqual(["Beta"]);
    await waitFor(() => onFinished.mock.calls.length === 1);
  });

  it("offers Approve / feedback on a propose turn and sends the canonical approval", async () => {
    const { convo, sent } = stubConversation({
      turn: { type: "propose", message: "# PRD draft\n\n- requirement one" },
    });
    const { stdin, lastFrame } = render(
      <ChatApp conversation={convo} onFinished={() => {}} />,
    );
    await waitFor(() => lastFrame()!.includes("Approve"));
    const frame = lastFrame()!;
    expect(frame).toContain("PRD draft");
    expect(frame).toContain("Give feedback");
    stdin.write(ENTER); // Approve is first
    await waitFor(() => sent.length === 1);
    expect(sent).toEqual([APPROVED_MESSAGE]);
  });

  it("falls back to a text input for an ask without options and sends typed text", async () => {
    const { convo, sent } = stubConversation({
      turn: { type: "ask", message: "Describe the feature" },
    });
    const { stdin, lastFrame } = render(
      <ChatApp conversation={convo} onFinished={() => {}} />,
    );
    await waitFor(() => lastFrame()!.includes("▊"));
    stdin.write("push based");
    await waitFor(() => lastFrame()!.includes("push based"));
    stdin.write(ENTER);
    await waitFor(() => sent.length === 1);
    expect(sent).toEqual(["push based"]);
  });
});

describe("renderMarkdown", () => {
  it("renders headings, bullets, and inline code without markdown syntax leftovers", () => {
    const rendered = renderMarkdown(
      "# Title\n\n- item `code`\n\n```\nfenced\n```",
    );
    expect(rendered).toContain("Title");
    expect(rendered).toContain("• item");
    expect(rendered).toContain("fenced");
    expect(rendered).not.toContain("# Title");
    expect(rendered).not.toContain("```");
  });
});
