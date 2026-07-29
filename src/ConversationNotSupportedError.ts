import { ConversationNotSupportedError as ConversationNotSupportedErrorImpl } from "./errors.js";

/**
 * The agent provider cannot hold conversations (`conversation.start()`).
 * Conversations require session resume (filesystem-backed sessions) and
 * structured output; in v1 only Claude Code is supported.
 *
 * Public-facing type for `ConversationNotSupportedError`. The runtime class
 * is the same `Data.TaggedError` from `errors.ts`, but we re-declare its
 * public shape here as a plain `Error` subclass so that Effect's type
 * machinery does not leak into Sandcastle's published `.d.ts` files (same
 * pattern as `GoalNotSupportedError` and `CwdError`).
 */
export interface ConversationNotSupportedError extends Error {
  readonly _tag: "ConversationNotSupportedError";
  readonly message: string;
  /** Name of the provider that lacks conversation support. */
  readonly provider: string;
  /** The capability the provider is missing. */
  readonly missing:
    | "session-resume"
    | "structured-output"
    | "unsupported-provider";
}

interface ConversationNotSupportedErrorConstructor {
  new (args: {
    readonly message: string;
    readonly provider: string;
    readonly missing:
      | "session-resume"
      | "structured-output"
      | "unsupported-provider";
  }): ConversationNotSupportedError;
  readonly prototype: ConversationNotSupportedError;
}

/** The agent provider cannot hold conversations (`conversation.start()`). */
export const ConversationNotSupportedError: ConversationNotSupportedErrorConstructor =
  ConversationNotSupportedErrorImpl as unknown as ConversationNotSupportedErrorConstructor;
