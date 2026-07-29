import React from "react";
import { render } from "ink";
import * as readline from "node:readline/promises";
import type { Conversation } from "../conversation.js";
import type { AgentTurn } from "../conversationEnvelope.js";
import { APPROVED_MESSAGE } from "../conversationEnvelope.js";
import { ChatApp } from "./ChatApp.js";
import { renderMarkdown } from "./markdown.js";

export { ChatApp } from "./ChatApp.js";
export type { ChatAppProps } from "./ChatApp.js";
export { renderMarkdown } from "./markdown.js";

export interface ChatResult {
  /** The final agent turn when the conversation reached `done`; `undefined`
   *  when the chat ended early (error or detach). */
  readonly finalTurn: AgentTurn | undefined;
}

/**
 * Run the reference chat frontend for a conversation in the current
 * terminal: an Ink 7 full-screen chat app with the transcript replayed from
 * the store, select menus for `ask` options, an approve/feedback flow for
 * `propose` turns, and a live activity region while the agent works.
 *
 * Resolves when the agent emits a `done` envelope (or on error). Ctrl-C
 * detaches — the conversation is durable and re-attaches via
 * `conversation.open()`.
 *
 * When stdout is not a TTY (piped, CI), falls back to a plain line-based
 * loop on stdin/stdout. The store, not the TUI, is the source of truth.
 */
export const chat = async (conversation: Conversation): Promise<ChatResult> => {
  try {
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      return await chatPlain(conversation);
    }
    let finalTurn: AgentTurn | undefined;
    const instance = render(
      React.createElement(ChatApp, {
        conversation,
        onFinished: (turn) => {
          finalTurn = turn;
        },
      }),
      { exitOnCtrlC: true },
    );
    await instance.waitUntilExit();
    return { finalTurn };
  } finally {
    // Detach = tear down the keep-alive container; worktree, store, and
    // agent session persist, so re-attaching later is unaffected.
    await conversation.close().catch(() => {});
  }
};

/** Plain, non-TTY fallback: line-oriented prompts over stdin/stdout. */
const chatPlain = async (conversation: Conversation): Promise<ChatResult> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const write = (text: string): void => {
    process.stdout.write(text + "\n");
  };
  try {
    let turn: AgentTurn | undefined;
    if (
      conversation.status === "awaiting-agent" ||
      conversation.status === "failed"
    ) {
      write("… agent is working");
      turn = await conversation.recover();
    } else {
      turn = conversation.lastAgentTurn;
    }
    while (turn !== undefined && turn.type !== "done") {
      write("");
      write(renderMarkdown(turn.message));
      if (turn.type === "ask" && turn.options && turn.options.length > 0) {
        turn.options.forEach((option, i) => write(`  ${i + 1}. ${option}`));
        write("  (answer with a number or free text)");
      }
      if (turn.type === "propose") {
        write(
          `  (reply "${APPROVED_MESSAGE}" to approve, anything else is feedback)`,
        );
      }
      const answer = (await rl.question("> ")).trim();
      if (answer === "") continue;
      const optionIndex = Number.parseInt(answer, 10);
      const resolved =
        turn.type === "ask" &&
        turn.options &&
        Number.isInteger(optionIndex) &&
        optionIndex >= 1 &&
        optionIndex <= turn.options.length
          ? turn.options[optionIndex - 1]!
          : answer;
      write("… agent is working");
      turn = await conversation.send(resolved);
    }
    if (turn !== undefined) {
      write("");
      write(renderMarkdown(turn.message));
      for (const artifact of turn.artifacts) write(`  ↳ ${artifact}`);
    }
    return { finalTurn: turn };
  } finally {
    rl.close();
  }
};
