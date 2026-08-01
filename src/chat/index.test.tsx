import { afterEach, expect, it, vi } from "vitest";
import { chat } from "./index.js";
import type { Conversation } from "../conversation.js";

// Ink unrefs process.stdin when it tears down raw mode on unmount. If chat()
// does not restore the ref, a caller that prompts on stdin afterwards (e.g. a
// readline question in a template script) no longer keeps the event loop
// alive and the process exits mid-await with "unsettled top-level await".

const originalStdinTTY = process.stdin.isTTY;
const originalStdoutTTY = process.stdout.isTTY;

afterEach(() => {
  process.stdin.isTTY = originalStdinTTY;
  process.stdout.isTTY = originalStdoutTTY;
  vi.restoreAllMocks();
});

it("re-refs stdin after the Ink app exits so later prompts keep the process alive", async () => {
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
  const refSpy = vi.spyOn(process.stdin, "ref");

  const conversation = {
    id: "conversation/test",
    status: "done",
    messages: [],
    lastAgentTurn: { type: "done", message: "all done", artifacts: [] },
    metadata: { role: "designer", branch: "conversation/test", artifacts: [] },
    close: async () => {},
  } as unknown as Conversation;

  await chat(conversation);

  expect(refSpy).toHaveBeenCalled();
});
