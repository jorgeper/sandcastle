export const SPEC_DIR = "issue-specs";
export const MAX_ITERATIONS = 10;

// Effort tiers, ordered weakest → strongest.
export const EFFORT_TIERS = [
  { name: "normal", model: "claude-opus-5" },
  { name: "hard", model: "claude-fable-5-1" },
] as const;

export const AGENT_TIERS = {
  // The loop (main.ts)
  planner: "normal",
  "spec-writer": "hard",
  implementer: "hard",
  reviewer: "normal",
  merger: "normal",
  "conflict-resolver": "normal",
  decomposer: "normal",
  "pr-reviewer": "normal",
  addresser: "normal",
  designer: "normal",
  filer: "normal",
} as const satisfies Record<string, (typeof EFFORT_TIERS)[number]["name"]>;
