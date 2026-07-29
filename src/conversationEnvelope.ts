import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * XML tag the agent wraps each turn envelope in. The library owns both the
 * tag and the protocol instructions that reference it (see
 * `composeConversationProtocol`) so the two cannot drift apart.
 */
export const TURN_TAG = "turn";

/**
 * Canonical approval message. Frontends send this exact string when the human
 * approves a `propose` turn; the protocol instructions tell the agent to wait
 * for it before acting on a proposal.
 */
export const APPROVED_MESSAGE = "APPROVED";

/**
 * A question for the human. `options` lets frontends render a select menu
 * (CLI) or buttons (Telegram); free-text answers are always allowed
 * regardless of options.
 */
export interface AgentTurnAsk {
  readonly type: "ask";
  readonly message: string;
  readonly options?: readonly string[];
}

/**
 * A draft for the human to review (a PRD, an issue breakdown). Frontends
 * offer approve (sends `APPROVED_MESSAGE`) or free-text feedback.
 */
export interface AgentTurnPropose {
  readonly type: "propose";
  readonly message: string;
}

/**
 * The agent's claim of completion. `artifacts` carries URLs (PR, issues).
 * Not necessarily final: `send()` on a done conversation reopens it.
 */
export interface AgentTurnDone {
  readonly type: "done";
  readonly message: string;
  readonly artifacts: readonly string[];
}

/**
 * The typed envelope every conversation turn ends with. The agent emits it
 * as structured output inside a `<turn>` tag; frontends render it (questions
 * as prompts/menus, proposals as documents, done as a result summary).
 */
export type AgentTurn = AgentTurnAsk | AgentTurnPropose | AgentTurnDone;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

/**
 * Validate an unknown value as an `AgentTurn`. Returns the typed turn or a
 * list of human-readable issues. Pure — shared by the Standard Schema
 * validator below and any frontend that needs to re-validate stored turns.
 */
export const validateAgentTurn = (
  value: unknown,
): { readonly turn: AgentTurn } | { readonly issues: readonly string[] } => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { issues: ["envelope must be a JSON object"] };
  }
  const record = value as Record<string, unknown>;
  const issues: string[] = [];
  const type = record["type"];
  if (type !== "ask" && type !== "propose" && type !== "done") {
    return {
      issues: [
        `"type" must be "ask", "propose", or "done" — got ${JSON.stringify(type)}`,
      ],
    };
  }
  if (
    typeof record["message"] !== "string" ||
    record["message"].trim() === ""
  ) {
    issues.push('"message" must be a non-empty string');
  }
  if (type === "ask" && record["options"] !== undefined) {
    if (!isStringArray(record["options"]) || record["options"].length === 0) {
      issues.push(
        '"options" must be a non-empty array of strings when present',
      );
    }
  }
  if (type === "done" && !isStringArray(record["artifacts"])) {
    issues.push('"artifacts" must be an array of strings (may be empty)');
  }
  if (issues.length > 0) return { issues };

  const message = record["message"] as string;
  switch (type) {
    case "ask":
      return {
        turn:
          record["options"] === undefined
            ? { type, message }
            : { type, message, options: record["options"] as string[] },
      };
    case "propose":
      return { turn: { type, message } };
    case "done":
      return {
        turn: { type, message, artifacts: record["artifacts"] as string[] },
      };
  }
};

/**
 * Standard Schema validator for `AgentTurn`, used as the structured-output
 * schema for every conversation turn (`Output.object({ tag: TURN_TAG, ... })`).
 * Hand-rolled so the library does not take a runtime schema-library
 * dependency.
 */
export const agentTurnSchema: StandardSchemaV1<unknown, AgentTurn> = {
  "~standard": {
    version: 1,
    vendor: "sandcastle",
    validate: (value) => {
      const result = validateAgentTurn(value);
      if ("turn" in result) return { value: result.turn };
      return { issues: result.issues.map((message) => ({ message })) };
    },
  },
};

/**
 * Library-owned conversation protocol instructions. Appended to the opening
 * (role) prompt by `conversation.start()` — the same precedent as goal mode's
 * `composeGoalPrompt` — so the envelope schema and the instructions the agent
 * sees are versioned together. Role prompts contain only role methodology,
 * never protocol mechanics.
 */
export const CONVERSATION_PROTOCOL_INSTRUCTIONS = `## Conversation protocol

You are one side of a turn-based conversation with a human. The human is not
watching a terminal — they see ONLY what you put inside the envelope described
below. Everything else you print is invisible to them.

End EVERY turn with exactly one envelope: a single <${TURN_TAG}> XML tag whose
content is one JSON object, emitted as the last thing in your response:

<${TURN_TAG}>{"type": "...", ...}</${TURN_TAG}>

The three envelope types:

1. A question — when you need information from the human:
   {"type": "ask", "message": "<the question>", "options": ["<choice 1>", "<choice 2>"]}
   - Ask exactly ONE question per turn. Never bundle questions.
   - Prefer offering 2-4 "options" when the answer space is enumerable; omit
     "options" for open-ended questions. The human can always answer with
     free text regardless of options.

2. A proposal — when you have a draft (document, plan, breakdown) for review:
   {"type": "propose", "message": "<the full draft, markdown>"}
   - Put the COMPLETE draft in "message" — the human reads it from there.
   - Do NOT act on a proposal (write files, run commands with side effects,
     create anything external) until the human replies with exactly
     "${APPROVED_MESSAGE}". Any other reply is feedback: revise and re-propose.

3. Completion — when the task is finished:
   {"type": "done", "message": "<summary>", "artifacts": ["<url or path>", ...]}
   - "artifacts" lists what you produced (PR URLs, issue URLs, file paths).

Rules:
- Every turn ends with exactly one envelope. No envelope means the turn failed.
- Never ask the human anything outside the envelope.
- The JSON must be valid: double-quoted keys/strings, no trailing commas, no
  comments. Escape newlines in strings as \\n.`;

/**
 * Compose the full opening prompt for a conversation: the caller's role
 * prompt followed by the library-owned protocol instructions.
 */
export const composeConversationProtocol = (rolePrompt: string): string =>
  `${rolePrompt.trim()}\n\n${CONVERSATION_PROTOCOL_INSTRUCTIONS}`;
