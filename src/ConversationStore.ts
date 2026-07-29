import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentTurn } from "./conversationEnvelope.js";
import { validateAgentTurn } from "./conversationEnvelope.js";

/**
 * Lifecycle status of a conversation. Workflow phases (e.g. a designer's
 * PR-review phase) are NOT statuses — consumers derive them from `artifacts`
 * plus external state, which keeps re-attach idempotent.
 *
 * - `awaiting-agent` — a human message (or the opening prompt) has been
 *   persisted and the agent has not answered it yet.
 * - `awaiting-human` — the agent asked or proposed; the human's move.
 * - `done` — the agent emitted a `done` envelope. Reopenable via `send()`.
 * - `failed` — the last turn failed to produce a valid envelope even after
 *   the corrective resume. Re-attachable via `recover()`.
 */
export type ConversationStatus =
  | "awaiting-agent"
  | "awaiting-human"
  | "done"
  | "failed";

/** Agent identity recorded at `start()` and re-checked at `open()`. */
export interface ConversationAgentInfo {
  readonly provider: string;
  readonly model?: string;
}

/**
 * Durable metadata for a conversation, stored as
 * `<dir>/<id>/conversation.json`. The store is the source of truth;
 * frontends are stateless renderers over it.
 */
export interface ConversationMetadata {
  readonly id: string;
  readonly status: ConversationStatus;
  /** Optional label ("designer", "decomposer") for listing/observability. */
  readonly role?: string;
  readonly agent: ConversationAgentInfo;
  /** Fully composed opening prompt (role prompt + protocol instructions).
   *  Persisted so a crash before the first agent reply can be recovered. */
  readonly openingPrompt: string;
  /** Git branch backing the conversation's worktree (`conversation/<id>`). */
  readonly branch: string;
  /** Agent session id captured after the last successful turn. */
  readonly sessionId?: string;
  /** Host path to the preserved worktree, when one was reported. */
  readonly worktreePath?: string;
  /** Path to the agent log file — the join point for observability tooling. */
  readonly logPath?: string;
  /** Artifact URLs/paths accumulated from `done` envelopes. */
  readonly artifacts: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A human turn: free text (or the canonical `APPROVED` message). */
export interface HumanMessage {
  readonly seq: number;
  readonly role: "human";
  readonly at: string;
  readonly body: string;
}

/** An agent turn: the validated envelope. */
export interface AgentMessage {
  readonly seq: number;
  readonly role: "agent";
  readonly at: string;
  readonly body: AgentTurn;
}

/** One line of `messages.jsonl`. */
export type ConversationMessage = HumanMessage | AgentMessage;

/** Summary row returned by `conversation.list()`. */
export interface ConversationSummary {
  readonly id: string;
  readonly status: ConversationStatus;
  readonly role?: string;
  readonly updatedAt: string;
  /** First line of the most recent message body, for listings. */
  readonly lastMessage?: string;
  readonly artifacts: readonly string[];
}

/** Default store root: `<cwd>/.sandcastle/conversations`. */
export const defaultConversationsDir = (cwd?: string): string =>
  join(cwd ?? process.cwd(), ".sandcastle", "conversations");

const METADATA_FILE = "conversation.json";
const MESSAGES_FILE = "messages.jsonl";

const firstLine = (text: string): string => text.split("\n", 1)[0] ?? "";

const messageBodyText = (message: ConversationMessage): string =>
  message.role === "human" ? message.body : message.body.message;

/**
 * If the transcript ends with a human message the agent never answered
 * (process died mid-turn), return it. `recover()` re-runs it instead of
 * double-sending.
 */
export const pendingHumanMessage = (
  messages: readonly ConversationMessage[],
): HumanMessage | undefined => {
  const last = messages.at(-1);
  return last?.role === "human" ? last : undefined;
};

/**
 * File-backed conversation store: one directory per conversation holding
 * `conversation.json` (metadata) and `messages.jsonl` (append-only
 * transcript). Line-oriented JSON on purpose — appendable, tailable,
 * watchable — so a future daemon can `fs.watch` it without a database.
 */
export class ConversationStore {
  private constructor(
    readonly dir: string,
    readonly id: string,
  ) {}

  get path(): string {
    return join(this.dir, this.id);
  }

  private get metadataPath(): string {
    return join(this.path, METADATA_FILE);
  }

  private get messagesPath(): string {
    return join(this.path, MESSAGES_FILE);
  }

  /** Create the conversation directory. Fails if the id already exists. */
  static async create(
    dir: string,
    metadata: Omit<ConversationMetadata, "createdAt" | "updatedAt">,
  ): Promise<ConversationStore> {
    const store = new ConversationStore(dir, metadata.id);
    if (existsSync(store.metadataPath)) {
      throw new Error(
        `Conversation "${metadata.id}" already exists at ${store.path}. ` +
          `Use conversation.open("${metadata.id}", ...) to re-attach, or pick a new name.`,
      );
    }
    await mkdir(store.path, { recursive: true });
    const now = new Date().toISOString();
    await store.writeMetadataFile({
      ...metadata,
      createdAt: now,
      updatedAt: now,
    });
    await writeFile(store.messagesPath, "");
    return store;
  }

  /** Open an existing conversation. Fails if the id is unknown. */
  static async open(dir: string, id: string): Promise<ConversationStore> {
    const store = new ConversationStore(dir, id);
    if (!existsSync(store.metadataPath)) {
      throw new Error(
        `Conversation "${id}" not found under ${dir}. ` +
          `Use conversation.list() to see existing conversations.`,
      );
    }
    return store;
  }

  /** Summaries of all conversations under `dir`, most recently updated first. */
  static async list(dir: string): Promise<ConversationSummary[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const summaries: ConversationSummary[] = [];
    for (const id of entries) {
      const metadataPath = join(dir, id, METADATA_FILE);
      if (!existsSync(metadataPath)) continue;
      const store = new ConversationStore(dir, id);
      const metadata = await store.readMetadata();
      const messages = await store.readMessages();
      const last = messages.at(-1);
      summaries.push({
        id: metadata.id,
        status: metadata.status,
        role: metadata.role,
        updatedAt: metadata.updatedAt,
        lastMessage: last ? firstLine(messageBodyText(last)) : undefined,
        artifacts: metadata.artifacts,
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async readMetadata(): Promise<ConversationMetadata> {
    const raw = await readFile(this.metadataPath, "utf-8");
    return JSON.parse(raw) as ConversationMetadata;
  }

  private async writeMetadataFile(
    metadata: ConversationMetadata,
  ): Promise<void> {
    await writeFile(
      this.metadataPath,
      JSON.stringify(metadata, null, 2) + "\n",
    );
  }

  /** Merge a patch into the metadata, bumping `updatedAt`. */
  async updateMetadata(
    patch: Partial<Omit<ConversationMetadata, "id" | "createdAt">>,
  ): Promise<ConversationMetadata> {
    const current = await this.readMetadata();
    const next: ConversationMetadata = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.writeMetadataFile(next);
    return next;
  }

  /** Append a message, assigning the next `seq`. Human messages are always
   *  appended BEFORE the agent runs — that ordering is what makes crash
   *  recovery (`pendingHumanMessage`) sound. */
  async appendMessage(
    message:
      | { readonly role: "human"; readonly body: string }
      | { readonly role: "agent"; readonly body: AgentTurn },
  ): Promise<ConversationMessage> {
    const messages = await this.readMessages();
    const seq = (messages.at(-1)?.seq ?? 0) + 1;
    const full = {
      seq,
      role: message.role,
      at: new Date().toISOString(),
      body: message.body,
    } as ConversationMessage;
    await appendFile(this.messagesPath, JSON.stringify(full) + "\n");
    return full;
  }

  /** Replay the transcript. Skips malformed lines (a torn final write from a
   *  crash) rather than failing the whole conversation. */
  async readMessages(): Promise<ConversationMessage[]> {
    let raw: string;
    try {
      raw = await readFile(this.messagesPath, "utf-8");
    } catch {
      return [];
    }
    const messages: ConversationMessage[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const record = parsed as {
        seq?: unknown;
        role?: unknown;
        at?: unknown;
        body?: unknown;
      };
      if (typeof record.seq !== "number" || typeof record.at !== "string") {
        continue;
      }
      if (record.role === "human" && typeof record.body === "string") {
        messages.push({
          seq: record.seq,
          role: "human",
          at: record.at,
          body: record.body,
        });
      } else if (record.role === "agent") {
        const validated = validateAgentTurn(record.body);
        if ("turn" in validated) {
          messages.push({
            seq: record.seq,
            role: "agent",
            at: record.at,
            body: validated.turn,
          });
        }
      }
    }
    return messages;
  }
}
