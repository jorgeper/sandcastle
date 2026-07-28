import { GoalNotSupportedError as GoalNotSupportedErrorImpl } from "./errors.js";

/**
 * The agent provider does not support native goal mode (`RunOptions.goal`).
 *
 * Public-facing type for `GoalNotSupportedError`. The runtime class is the
 * same `Data.TaggedError` from `errors.ts`, but we re-declare its public
 * shape here as a plain `Error` subclass so that Effect's type machinery
 * does not leak into Sandcastle's published `.d.ts` files (same pattern as
 * `CwdError`).
 */
export interface GoalNotSupportedError extends Error {
  readonly _tag: "GoalNotSupportedError";
  readonly message: string;
  /** Name of the provider that lacks goal support. */
  readonly provider: string;
}

interface GoalNotSupportedErrorConstructor {
  new (args: {
    readonly message: string;
    readonly provider: string;
  }): GoalNotSupportedError;
  readonly prototype: GoalNotSupportedError;
}

/** The agent provider does not support native goal mode (`RunOptions.goal`). */
export const GoalNotSupportedError: GoalNotSupportedErrorConstructor =
  GoalNotSupportedErrorImpl as unknown as GoalNotSupportedErrorConstructor;
