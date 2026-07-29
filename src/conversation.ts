import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentProvider } from "./AgentProvider.js";
import type { SandboxProvider } from "./SandboxProvider.js";
import type { SandboxHooks } from "./SandboxLifecycle.js";
import type { AgentStreamEvent } from "./AgentStreamEmitter.js";
import {
  run,
  buildStructuredOutputRetryFeedback,
  type LoggingOption,
  type Timeouts,
} from "./run.js";
import { createSandbox, type Sandbox } from "./createSandbox.js";
import { extractStructuredOutput } from "./extractStructuredOutput.js";
import { Output, StructuredOutputError } from "./Output.js";
import { ConversationNotSupportedError } from "./ConversationNotSupportedError.js";
import {
  agentTurnSchema,
  composeConversationProtocol,
  TURN_ENVELOPE_REMINDER,
  TURN_TAG,
  type AgentTurn,
} from "./conversationEnvelope.js";
import {
  ConversationStore,
  defaultConversationsDir,
  pendingHumanMessage,
  type ConversationMessage,
  type ConversationMetadata,
  type ConversationStatus,
  type ConversationSummary,
} from "./ConversationStore.js";
import {
  findMissingPromptArgKeys,
  type PromptArgs,
} from "./PromptArgumentSubstitution.js";

/**
 * A conversation was used in a state that doesn't allow the operation
 * (unknown id, duplicate id, provider mismatch on open, send while a turn is
 * in flight or unanswered, …).
 */
export class ConversationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationError";
  }
}

/** Options shared by every conversation operation that runs the agent. */
interface ConversationRuntimeOptions {
  /** Agent provider. v1: `claudeCode` only — others throw `ConversationNotSupportedError`. */
  readonly agent: AgentProvider;
  /** Sandbox provider the turns run in. */
  readonly sandbox: SandboxProvider;
  /** Store root. Default: `<cwd>/.sandcastle/conversations`. */
  readonly dir?: string;
  /** Host repo directory, as in `RunOptions.cwd`. */
  readonly cwd?: string;
  /** Lifecycle hooks, passed through to each turn's run. */
  readonly hooks?: SandboxHooks;
  /** Per-step timeout overrides, passed through to each turn's run. */
  readonly timeouts?: Timeouts;
  /** Logging mode for agent turns. Default: log-to-file under
   *  `.sandcastle/logs/conversation-<id>.log`. Terminal mode (`stdout`) is
   *  not meaningful under a chat frontend. */
  readonly logging?: LoggingOption;
  /** Abort signal — aborts the in-flight turn; the conversation re-attaches. */
  readonly signal?: AbortSignal;
  /** Idle timeout per turn, as in `RunOptions.idleTimeoutSeconds`. */
  readonly idleTimeoutSeconds?: number;
  /** Completion grace window per turn, as in `RunOptions.completionTimeoutSeconds`. */
  readonly completionTimeoutSeconds?: number;
  /**
   * Keep one live sandbox between turns while this process holds the
   * conversation (default: `true`). The container starts once and every
   * turn reuses it, which is what makes interactive chat snappy; `close()`
   * (or process exit) tears the container down — the worktree, store, and
   * agent session always persist, so detach/re-attach is unaffected. Set to
   * `false` to spin a fresh sandbox per turn instead.
   */
  readonly keepSandbox?: boolean;
  /**
   * Test seam: replaces `run()` for turn execution (forces the
   * fresh-sandbox-per-turn path).
   * @internal
   */
  readonly runner?: typeof run;
  /**
   * Test seam: replaces `createSandbox()` for the keep-alive path.
   * @internal
   */
  readonly sandboxFactory?: typeof createSandbox;
}

export interface ConversationStartOptions extends ConversationRuntimeOptions {
  /** Conversation id. Must not already exist under the store root. */
  readonly name: string;
  /** Inline opening (role) prompt. Mutually exclusive with `promptFile`. */
  readonly prompt?: string;
  /** Path to the opening (role) prompt file. Mutually exclusive with `prompt`.
   *  Resolved against `process.cwd()`, like `RunOptions.promptFile`. */
  readonly promptFile?: string;
  /** `{{KEY}}` substitution for the opening prompt. Applied host-side; shell
   *  (`` !`cmd` ``) expansion is NOT applied to conversation prompts. */
  readonly promptArgs?: PromptArgs;
  /** Optional label ("designer", "decomposer") stored for listing. */
  readonly role?: string;
}

export type ConversationOpenOptions = ConversationRuntimeOptions;

export interface ConversationSendOptions {
  /** Live agent activity for this turn (tool calls, text), regardless of
   *  logging mode — this is what chat frontends render while waiting. */
  readonly onAgentStreamEvent?: (event: AgentStreamEvent) => void;
}

export interface ConversationListOptions {
  /** Store root. Default: `<cwd>/.sandcastle/conversations`. */
  readonly dir?: string;
  /** Base directory for the default store root. Default: `process.cwd()`. */
  readonly cwd?: string;
}

/**
 * A durable, turn-based conversation with an agent running headless in a
 * sandbox. State lives in the conversation store; each turn is one resumed
 * iteration of the underlying agent session. See `conversation.start()`.
 */
export interface Conversation {
  readonly id: string;
  /** Current lifecycle status (replayed from the store). */
  readonly status: ConversationStatus;
  /** Full transcript (replayed from the store). */
  readonly messages: readonly ConversationMessage[];
  /** The most recent agent envelope, if any. */
  readonly lastAgentTurn: AgentTurn | undefined;
  /** Durable metadata snapshot. */
  readonly metadata: ConversationMetadata;
  /**
   * Send a human message and run one agent turn. The message is persisted
   * BEFORE the agent runs (crash-safe). Allowed on a `done` conversation —
   * it reopens. Fails fast if a turn is in flight or unanswered
   * (use `recover()`).
   */
  send(message: string, options?: ConversationSendOptions): Promise<AgentTurn>;
  /**
   * Re-run an unanswered turn after a crash or failure: the opening prompt
   * when the agent never replied at all, or the trailing human message the
   * agent never answered. Returns `undefined` when there is nothing to
   * recover.
   */
  recover(options?: ConversationSendOptions): Promise<AgentTurn | undefined>;
  /**
   * Tear down the live keep-alive sandbox, if one is running (container
   * only — the worktree, store, and agent session persist, so the
   * conversation re-attaches normally afterwards). No-op otherwise.
   */
  close(): Promise<void>;
}

const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

/** Branch backing a conversation's worktree. */
export const conversationBranch = (id: string): string => `conversation/${id}`;

const SUPPORTED_PROVIDER = "claude-code";

const assertProviderSupported = (agent: AgentProvider): void => {
  if (!agent.sessionStorage) {
    throw new ConversationNotSupportedError({
      message:
        `The "${agent.name}" provider does not support conversations: ` +
        "conversations resume the agent session on every turn, which requires " +
        "filesystem-backed sessions (provider.sessionStorage). Use claudeCode.",
      provider: agent.name,
      missing: "session-resume",
    });
  }
  if (agent.name !== SUPPORTED_PROVIDER) {
    throw new ConversationNotSupportedError({
      message:
        `The "${agent.name}" provider is not supported for conversations in v1 ` +
        "(structured-output turn envelopes are only tested against Claude Code). " +
        "Use claudeCode.",
      provider: agent.name,
      missing: "unsupported-provider",
    });
  }
};

const substituteArgs = (prompt: string, args: PromptArgs): string => {
  const missing = findMissingPromptArgKeys(prompt, args);
  if (missing.length > 0) {
    throw new ConversationError(
      `Opening prompt references missing promptArgs: ${missing.join(", ")}`,
    );
  }
  return prompt.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (match, key: string) =>
      key in args ? String(args[key as keyof typeof args]) : match,
  );
};

class ConversationImpl implements Conversation {
  #store: ConversationStore;
  #options: ConversationRuntimeOptions;
  #metadata: ConversationMetadata;
  #messages: ConversationMessage[];
  #inFlight = false;
  #liveSandbox: Sandbox | undefined;

  constructor(
    store: ConversationStore,
    options: ConversationRuntimeOptions,
    metadata: ConversationMetadata,
    messages: ConversationMessage[],
  ) {
    this.#store = store;
    this.#options = options;
    this.#metadata = metadata;
    this.#messages = messages;
  }

  get id(): string {
    return this.#metadata.id;
  }

  get status(): ConversationStatus {
    return this.#metadata.status;
  }

  get messages(): readonly ConversationMessage[] {
    return this.#messages;
  }

  get lastAgentTurn(): AgentTurn | undefined {
    for (let i = this.#messages.length - 1; i >= 0; i--) {
      const message = this.#messages[i];
      if (message?.role === "agent") return message.body;
    }
    return undefined;
  }

  get metadata(): ConversationMetadata {
    return this.#metadata;
  }

  async send(
    message: string,
    options?: ConversationSendOptions,
  ): Promise<AgentTurn> {
    this.#assertIdle();
    if (message.trim() === "") {
      throw new ConversationError("Cannot send an empty message.");
    }
    if (pendingHumanMessage(this.#messages)) {
      throw new ConversationError(
        "The previous human message has not been answered yet. " +
          "Call recover() to re-run it before sending a new message.",
      );
    }
    if (this.#metadata.sessionId === undefined) {
      throw new ConversationError(
        "The opening turn has not completed, so there is no agent session " +
          "to resume. Call recover() first.",
      );
    }
    const human = await this.#store.appendMessage({
      role: "human",
      body: message,
    });
    this.#messages.push(human);
    this.#metadata = await this.#store.updateMetadata({
      status: "awaiting-agent",
    });
    return this.#runTurn(message, this.#metadata.sessionId, options);
  }

  async recover(
    options?: ConversationSendOptions,
  ): Promise<AgentTurn | undefined> {
    this.#assertIdle();
    if (this.#metadata.status === "done") return undefined;
    const pending = pendingHumanMessage(this.#messages);
    if (pending) {
      if (this.#metadata.sessionId === undefined) {
        throw new ConversationError(
          "Transcript has an unanswered human message but no agent session " +
            "was ever captured — the store is inconsistent.",
        );
      }
      this.#metadata = await this.#store.updateMetadata({
        status: "awaiting-agent",
      });
      return this.#runTurn(pending.body, this.#metadata.sessionId, options);
    }
    if (this.#messages.length === 0) {
      // Crash (or failure) before the first agent reply: re-run the opening
      // prompt as a fresh session.
      this.#metadata = await this.#store.updateMetadata({
        status: "awaiting-agent",
      });
      return this.#runTurn(this.#metadata.openingPrompt, undefined, options);
    }
    return undefined;
  }

  #assertIdle(): void {
    if (this.#inFlight) {
      throw new ConversationError(
        "A turn is already in flight for this conversation.",
      );
    }
  }

  #buildLogging(options?: ConversationSendOptions): LoggingOption {
    const base: LoggingOption = this.#options.logging ?? {
      type: "file",
      path: join(
        this.#options.cwd ?? process.cwd(),
        ".sandcastle",
        "logs",
        `conversation-${this.id}.log`,
      ),
    };
    if (base.type !== "file" || options?.onAgentStreamEvent === undefined) {
      return base;
    }
    const baseHandler = base.onAgentStreamEvent;
    const sendHandler = options.onAgentStreamEvent;
    return {
      ...base,
      onAgentStreamEvent: (event) => {
        baseHandler?.(event);
        sendHandler(event);
      },
    };
  }

  async close(): Promise<void> {
    const sandbox = this.#liveSandbox;
    this.#liveSandbox = undefined;
    if (sandbox) await sandbox.close();
  }

  async #ensureSandbox(): Promise<Sandbox> {
    if (!this.#liveSandbox) {
      const factory = this.#options.sandboxFactory ?? createSandbox;
      this.#liveSandbox = await factory({
        branch: this.#metadata.branch,
        sandbox: this.#options.sandbox,
        cwd: this.#options.cwd,
        hooks: this.#options.hooks,
        timeouts: this.#options.timeouts,
      });
    }
    return this.#liveSandbox;
  }

  async #runTurn(
    prompt: string,
    resumeSession: string | undefined,
    options?: ConversationSendOptions,
  ): Promise<AgentTurn> {
    this.#inFlight = true;
    try {
      const logging = this.#buildLogging(options);
      // Resumed turns carry only the human's message, but every turn prompt
      // must contain the structured-output tag (run() enforces it, ADR
      // 0010). The reminder satisfies that invariant and re-anchors the
      // protocol for the agent; the store keeps the clean human message.
      const turnPrompt = prompt.includes(`<${TURN_TAG}>`)
        ? prompt
        : `${prompt}${TURN_ENVELOPE_REMINDER}`;
      // The runner seam and keepSandbox: false use a fresh sandbox per turn;
      // the default keeps one sandbox alive across turns for fast
      // interactive chat.
      const useColdPath =
        this.#options.runner !== undefined ||
        this.#options.keepSandbox === false;
      let outcome: TurnOutcome;
      try {
        outcome = useColdPath
          ? await this.#runTurnCold(turnPrompt, resumeSession, logging)
          : await this.#runTurnHot(turnPrompt, resumeSession, logging);
      } catch (error) {
        if (error instanceof StructuredOutputError) {
          // The corrective resume already ran and the agent still failed to
          // emit a valid envelope: the turn fails.
          this.#metadata = await this.#store.updateMetadata({
            status: "failed",
            sessionId: error.sessionId ?? this.#metadata.sessionId,
          });
        }
        // Other errors (idle timeout, abort, infra) leave the status as
        // awaiting-agent so recover() can re-run the unanswered turn.
        throw error;
      }

      const turn = outcome.turn;
      const sessionId = outcome.sessionId ?? this.#metadata.sessionId;
      const agentMessage = await this.#store.appendMessage({
        role: "agent",
        body: turn,
      });
      this.#messages.push(agentMessage);
      this.#metadata = await this.#store.updateMetadata({
        status: turn.type === "done" ? "done" : "awaiting-human",
        sessionId,
        logPath: outcome.logFilePath ?? this.#metadata.logPath,
        worktreePath:
          outcome.preservedWorktreePath ?? this.#metadata.worktreePath,
        artifacts:
          turn.type === "done"
            ? [
                ...this.#metadata.artifacts,
                ...turn.artifacts.filter(
                  (a) => !this.#metadata.artifacts.includes(a),
                ),
              ]
            : this.#metadata.artifacts,
      });
      return turn;
    } finally {
      this.#inFlight = false;
    }
  }

  /** Fresh sandbox per turn via run(); structured output extracted and
   *  corrective-resumed by run() itself (output.maxRetries). */
  async #runTurnCold(
    turnPrompt: string,
    resumeSession: string | undefined,
    logging: LoggingOption,
  ): Promise<TurnOutcome> {
    const runner = this.#options.runner ?? run;
    const result = await runner({
      agent: this.#options.agent,
      sandbox: this.#options.sandbox,
      cwd: this.#options.cwd,
      prompt: turnPrompt,
      maxIterations: 1,
      branchStrategy: { type: "branch", branch: this.#metadata.branch },
      resumeSession,
      output: Output.object({
        tag: TURN_TAG,
        schema: agentTurnSchema,
        maxRetries: 1,
      }),
      logging,
      hooks: this.#options.hooks,
      timeouts: this.#options.timeouts,
      signal: this.#options.signal,
      idleTimeoutSeconds: this.#options.idleTimeoutSeconds,
      completionTimeoutSeconds: this.#options.completionTimeoutSeconds,
      name: this.#metadata.role ?? "conversation",
    });
    return {
      turn: result.output as AgentTurn,
      sessionId: result.iterations.at(-1)?.sessionId,
      logFilePath: result.logFilePath,
      preservedWorktreePath: result.preservedWorktreePath,
    };
  }

  /** Keep-alive path: one live sandbox across turns via sandbox.run().
   *  sandbox.run() has no structured-output option, so extraction (and the
   *  single corrective resume) happens here. */
  async #runTurnHot(
    turnPrompt: string,
    resumeSession: string | undefined,
    logging: LoggingOption,
  ): Promise<TurnOutcome> {
    const sandbox = await this.#ensureSandbox();
    const definition = Output.object({
      tag: TURN_TAG,
      schema: agentTurnSchema,
    });
    const common = {
      logging,
      signal: this.#options.signal,
      idleTimeoutSeconds: this.#options.idleTimeoutSeconds,
      completionTimeoutSeconds: this.#options.completionTimeoutSeconds,
      name: this.#metadata.role ?? "conversation",
    };
    let result = await sandbox.run({
      agent: this.#options.agent,
      prompt: turnPrompt,
      maxIterations: 1,
      resumeSession,
      ...common,
    });
    const context = (r: typeof result) => ({
      commits: r.commits,
      branch: this.#metadata.branch,
      sessionId: r.iterations.at(-1)?.sessionId,
      sessionFilePath: r.iterations.at(-1)?.sessionFilePath,
    });
    try {
      const turn = (await extractStructuredOutput(
        result.stdout,
        definition,
        context(result),
      )) as AgentTurn;
      return {
        turn,
        sessionId: result.iterations.at(-1)?.sessionId,
        logFilePath: result.logFilePath,
      };
    } catch (error) {
      if (!(error instanceof StructuredOutputError) || !result.resume) {
        throw error;
      }
      // One corrective resume, mirroring run()'s output.maxRetries: 1.
      result = await result.resume(
        buildStructuredOutputRetryFeedback(error, 0),
        common,
      );
      const turn = (await extractStructuredOutput(
        result.stdout,
        definition,
        context(result),
      )) as AgentTurn;
      return {
        turn,
        sessionId: result.iterations.at(-1)?.sessionId,
        logFilePath: result.logFilePath,
      };
    }
  }
}

interface TurnOutcome {
  readonly turn: AgentTurn;
  readonly sessionId?: string;
  readonly logFilePath?: string;
  readonly preservedWorktreePath?: string;
}

const resolveDir = (options: {
  readonly dir?: string;
  readonly cwd?: string;
}): string => options.dir ?? defaultConversationsDir(options.cwd);

const start = async (
  options: ConversationStartOptions,
): Promise<Conversation> => {
  assertProviderSupported(options.agent);
  if (!CONVERSATION_ID_PATTERN.test(options.name)) {
    throw new ConversationError(
      `Invalid conversation name "${options.name}". Use letters, digits, ` +
        "dots, dashes, and underscores (max 100 chars).",
    );
  }
  if ((options.prompt === undefined) === (options.promptFile === undefined)) {
    throw new ConversationError(
      "Provide exactly one of prompt or promptFile for the opening prompt.",
    );
  }
  const rawPrompt =
    options.prompt ?? (await readFile(options.promptFile!, "utf-8"));
  const substituted = substituteArgs(rawPrompt, options.promptArgs ?? {});
  const openingPrompt = composeConversationProtocol(substituted);

  const dir = resolveDir(options);
  const store = await ConversationStore.create(dir, {
    id: options.name,
    status: "awaiting-agent",
    role: options.role,
    agent: { provider: options.agent.name, model: options.agent.model },
    openingPrompt,
    branch: conversationBranch(options.name),
    artifacts: [],
  });
  const metadata = await store.readMetadata();
  const conversation = new ConversationImpl(store, options, metadata, []);
  await conversation.recover();
  return conversation;
};

const open = async (
  id: string,
  options: ConversationOpenOptions,
): Promise<Conversation> => {
  assertProviderSupported(options.agent);
  const dir = resolveDir(options);
  const store = await ConversationStore.open(dir, id);
  const metadata = await store.readMetadata();
  if (metadata.agent.provider !== options.agent.name) {
    throw new ConversationError(
      `Conversation "${id}" was started with the "${metadata.agent.provider}" ` +
        `provider but open() received "${options.agent.name}". Sessions are ` +
        "provider-owned and cannot be resumed across providers.",
    );
  }
  if (
    metadata.agent.model !== undefined &&
    options.agent.model !== undefined &&
    metadata.agent.model !== options.agent.model
  ) {
    throw new ConversationError(
      `Conversation "${id}" was started with model "${metadata.agent.model}" ` +
        `but open() received "${options.agent.model}". Re-attach with the ` +
        "original model, or start a new conversation.",
    );
  }
  const messages = await store.readMessages();
  return new ConversationImpl(store, options, metadata, messages);
};

const list = async (
  options?: ConversationListOptions,
): Promise<ConversationSummary[]> =>
  ConversationStore.list(resolveDir(options ?? {}));

/**
 * Durable, turn-based conversations with sandboxed agents.
 *
 * - `conversation.start()` creates the store entry, runs the opening (role)
 *   prompt as turn 1, and resolves after the first agent envelope.
 * - `conversation.send()` is one resumed iteration of the same agent session.
 * - `conversation.open()` re-attaches from any process — state lives in the
 *   store (`.sandcastle/conversations/<id>/`), the worktree, and the
 *   filesystem-backed agent session.
 * - `conversation.list()` summarizes conversations for pickers and
 *   observability tooling.
 *
 * Frontends (the Ink chat TUI from `@ai-hero/sandcastle/chat`, a future
 * Telegram daemon) are stateless renderers over the store.
 */
export const conversation = {
  start,
  open,
  list,
};
