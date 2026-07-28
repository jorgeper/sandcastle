import { describe, expect, it } from "vitest";
import {
  claudeCode,
  composeClaudeGoalPrompt,
  cursor,
  GOAL_CONDITION_MAX_CHARS,
} from "./AgentProvider.js";
import { GoalNotSupportedError } from "./errors.js";
import { DEFAULT_COMPLETION_SIGNAL } from "./Orchestrator.js";
import {
  DEFAULT_GOAL_MAX_TURNS,
  deriveGoalMet,
  resolveGoalPrompt,
  run,
} from "./run.js";
import { testStubProvider } from "./sandboxes/test-shared.js";

const testSandbox = testStubProvider({ name: "test" }).provider;

describe("composeClaudeGoalPrompt", () => {
  it("composes the /goal command with signal clause and turn bound", () => {
    const composed = composeClaudeGoalPrompt({
      goal: "all tests pass",
      maxTurns: 25,
      completionSignal: "<promise>COMPLETE</promise>",
    });
    expect(composed).toBe(
      "/goal all tests pass, and you have emitted <promise>COMPLETE</promise> — or stop after 25 turns",
    );
  });

  it("trims whitespace around the caller's condition", () => {
    const composed = composeClaudeGoalPrompt({
      goal: "  typecheck passes  ",
      maxTurns: 5,
      completionSignal: "<done/>",
    });
    expect(composed).toBe(
      "/goal typecheck passes, and you have emitted <done/> — or stop after 5 turns",
    );
  });
});

describe("resolveGoalPrompt", () => {
  const provider = claudeCode("claude-opus-4-8");

  it("returns undefined when goal is not set", () => {
    expect(resolveGoalPrompt({ provider })).toBeUndefined();
    expect(resolveGoalPrompt({ provider, prompt: "do things" })).toBe(
      undefined,
    );
  });

  it("throws when goalMaxTurns is set without goal", () => {
    expect(() => resolveGoalPrompt({ provider, goalMaxTurns: 5 })).toThrow(
      "goalMaxTurns requires goal to be set.",
    );
  });

  it("throws when goal is combined with prompt", () => {
    expect(() =>
      resolveGoalPrompt({ provider, goal: "tests pass", prompt: "do things" }),
    ).toThrow("goal cannot be combined with prompt or promptFile");
  });

  it("throws when goal is combined with promptFile", () => {
    expect(() =>
      resolveGoalPrompt({
        provider,
        goal: "tests pass",
        promptFile: "./prompt.md",
      }),
    ).toThrow("goal cannot be combined with prompt or promptFile");
  });

  it("throws when goal is empty or whitespace-only", () => {
    expect(() => resolveGoalPrompt({ provider, goal: "" })).toThrow(
      "goal must be a non-empty condition string.",
    );
    expect(() => resolveGoalPrompt({ provider, goal: "   " })).toThrow(
      "goal must be a non-empty condition string.",
    );
  });

  it("throws when goalMaxTurns is not a positive integer", () => {
    for (const bad of [0, -1, 2.5]) {
      expect(() =>
        resolveGoalPrompt({ provider, goal: "tests pass", goalMaxTurns: bad }),
      ).toThrow("goalMaxTurns must be a positive integer");
    }
  });

  it("throws GoalNotSupportedError for providers without native goal support", () => {
    expect(() =>
      resolveGoalPrompt({ provider: cursor("gpt-5.2"), goal: "tests pass" }),
    ).toThrow(GoalNotSupportedError);
    try {
      resolveGoalPrompt({ provider: cursor("gpt-5.2"), goal: "tests pass" });
    } catch (e) {
      expect((e as GoalNotSupportedError).provider).toBe("cursor");
      expect((e as GoalNotSupportedError).message).toContain(
        "does not support goal mode",
      );
    }
  });

  it("throws when completionSignal is an empty array", () => {
    expect(() =>
      resolveGoalPrompt({ provider, goal: "tests pass", completionSignal: [] }),
    ).toThrow("completionSignal must not be an empty array");
  });

  it("composes with the default completion signal and turn bound", () => {
    const composed = resolveGoalPrompt({ provider, goal: "tests pass" });
    expect(composed).toBe(
      `/goal tests pass, and you have emitted ${DEFAULT_COMPLETION_SIGNAL} — or stop after ${DEFAULT_GOAL_MAX_TURNS} turns`,
    );
  });

  it("uses a custom completion signal and goalMaxTurns", () => {
    const composed = resolveGoalPrompt({
      provider,
      goal: "tests pass",
      goalMaxTurns: 7,
      completionSignal: "<finished/>",
    });
    expect(composed).toBe(
      "/goal tests pass, and you have emitted <finished/> — or stop after 7 turns",
    );
  });

  it("uses the first signal when completionSignal is an array", () => {
    const composed = resolveGoalPrompt({
      provider,
      goal: "tests pass",
      completionSignal: ["<a/>", "<b/>"],
    });
    expect(composed).toContain("you have emitted <a/>");
  });

  it("throws when the composed condition exceeds the provider cap", () => {
    const longGoal = "x".repeat(GOAL_CONDITION_MAX_CHARS);
    expect(() => resolveGoalPrompt({ provider, goal: longGoal })).toThrow(
      /goal condition is \d+ characters after composition/,
    );
  });

  it("accepts a condition that fits within the cap after composition", () => {
    const goal = "x".repeat(3800);
    const composed = resolveGoalPrompt({ provider, goal });
    expect(composed).toMatch(/^\/goal x+, and you have emitted/);
  });
});

describe("deriveGoalMet", () => {
  it("is undefined for non-goal runs", () => {
    expect(deriveGoalMet(undefined, undefined)).toBeUndefined();
    expect(deriveGoalMet(undefined, "<promise>COMPLETE</promise>")).toBe(
      undefined,
    );
  });

  it("is true when the completion signal fired on a goal run", () => {
    expect(deriveGoalMet("tests pass", "<promise>COMPLETE</promise>")).toBe(
      true,
    );
  });

  it("is false when iterations were exhausted without the signal", () => {
    expect(deriveGoalMet("tests pass", undefined)).toBe(false);
  });
});

describe("run() goal validation", () => {
  it("rejects goal combined with prompt", async () => {
    await expect(
      run({
        agent: claudeCode("claude-opus-4-8"),
        sandbox: testSandbox,
        branchStrategy: { type: "head" },
        goal: "tests pass",
        prompt: "do things",
      }),
    ).rejects.toThrow("goal cannot be combined with prompt or promptFile");
  });

  it("rejects goal on a provider without native goal support", async () => {
    await expect(
      run({
        agent: cursor("gpt-5.2"),
        sandbox: testSandbox,
        branchStrategy: { type: "head" },
        goal: "tests pass",
      }),
    ).rejects.toThrow(GoalNotSupportedError);
  });

  it("rejects goalMaxTurns without goal", async () => {
    await expect(
      run({
        agent: claudeCode("claude-opus-4-8"),
        sandbox: testSandbox,
        branchStrategy: { type: "head" },
        prompt: "do things",
        goalMaxTurns: 5,
      }),
    ).rejects.toThrow("goalMaxTurns requires goal to be set.");
  });
});
