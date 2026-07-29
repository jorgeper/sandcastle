import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentStreamEvent } from "../AgentStreamEmitter.js";
import type { Conversation } from "../conversation.js";
import type { ConversationMessage } from "../ConversationStore.js";
import type { AgentTurn } from "../conversationEnvelope.js";
import { APPROVED_MESSAGE } from "../conversationEnvelope.js";
import { renderMarkdown } from "./markdown.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CUSTOM_ANSWER = "✏  Type a custom answer";
const APPROVE_LABEL = "✔  Approve";
const FEEDBACK_LABEL = "✏  Give feedback";

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const Select: React.FC<{
  readonly items: readonly string[];
  readonly onSelect: (item: string, index: number) => void;
}> = ({ items, onSelect }) => {
  const [cursor, setCursor] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setCursor((c) => (c - 1 + items.length) % items.length);
    else if (key.downArrow) setCursor((c) => (c + 1) % items.length);
    else if (key.return) onSelect(items[cursor]!, cursor);
  });
  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Text key={item} color={i === cursor ? "cyan" : undefined}>
          {i === cursor ? "❯ " : "  "}
          {item}
        </Text>
      ))}
    </Box>
  );
};

const TextInput: React.FC<{
  readonly onSubmit: (value: string) => void;
}> = ({ onSubmit }) => {
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (key.return) {
      if (value.trim() !== "") onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow) {
      return;
    }
    if (input) setValue((v) => v + input);
  });
  return (
    <Text>
      {"› "}
      {value}
      <Text color="cyan">▊</Text>
    </Text>
  );
};

const Spinner: React.FC = () => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      80,
    );
    return () => clearInterval(timer);
  }, []);
  return <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>;
};

const Transcript: React.FC<{
  readonly messages: readonly ConversationMessage[];
  readonly role: string;
}> = ({ messages, role }) => (
  <Box flexDirection="column">
    {messages.map((message) =>
      message.role === "human" ? (
        <Box key={message.seq} marginBottom={1}>
          <Text dimColor>
            {"you › "}
            {message.body}
          </Text>
        </Box>
      ) : (
        <Box key={message.seq} flexDirection="column" marginBottom={1}>
          <Text bold color="magenta">
            {role}
            {message.body.type === "propose" ? " proposes:" : " ›"}
          </Text>
          <Text>{renderMarkdown(message.body.message)}</Text>
          {message.body.type === "done" &&
            message.body.artifacts.map((artifact) => (
              <Text key={artifact} color="green">
                {"  ↳ "}
                {artifact}
              </Text>
            ))}
        </Box>
      ),
    )}
  </Box>
);

const Activity: React.FC<{
  readonly events: readonly AgentStreamEvent[];
  readonly elapsedSeconds: number;
}> = ({ events, elapsedSeconds }) => (
  <Box flexDirection="column">
    {events.map((event, i) => (
      <Text key={i} dimColor>
        {"  ⚙ "}
        {event.type === "toolCall"
          ? `${event.name} ${event.formattedArgs}`
          : event.type === "text"
            ? firstLine(event.message)
            : ""}
      </Text>
    ))}
    <Box>
      <Spinner />
      <Text dimColor> working… {elapsedSeconds}s</Text>
    </Box>
  </Box>
);

const firstLine = (text: string): string => text.split("\n", 1)[0] ?? "";

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

export interface ChatAppProps {
  readonly conversation: Conversation;
  readonly onFinished: (turn: AgentTurn | undefined) => void;
}

type Mode =
  | { readonly kind: "busy" }
  | { readonly kind: "select"; readonly turn: AgentTurn }
  | { readonly kind: "text" }
  | { readonly kind: "finished" };

export const ChatApp: React.FC<ChatAppProps> = ({
  conversation,
  onFinished,
}) => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<readonly ConversationMessage[]>(
    conversation.messages,
  );
  const [mode, setMode] = useState<Mode>({ kind: "busy" });
  const [activity, setActivity] = useState<readonly AgentStreamEvent[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const startedRef = useRef(false);
  const role = conversation.metadata.role ?? "agent";

  const modeForTurn = useCallback((turn: AgentTurn | undefined): Mode => {
    if (turn === undefined || turn.type === "done") return { kind: "finished" };
    if (turn.type === "propose") return { kind: "select", turn };
    return turn.options && turn.options.length > 0
      ? { kind: "select", turn }
      : { kind: "text" };
  }, []);

  const runTurn = useCallback(
    async (action: () => Promise<AgentTurn | undefined>) => {
      setMode({ kind: "busy" });
      setActivity([]);
      setElapsed(0);
      try {
        const turn = await action();
        setMessages([...conversation.messages]);
        const next = modeForTurn(turn ?? conversation.lastAgentTurn);
        setMode(next);
        if (next.kind === "finished") {
          onFinished(conversation.lastAgentTurn);
          exit();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setMode({ kind: "finished" });
        onFinished(undefined);
        exit();
      }
    },
    [conversation, exit, modeForTurn, onFinished],
  );

  const streamHandler = useCallback((event: AgentStreamEvent) => {
    if (event.type === "raw") return;
    setActivity((events) => [...events.slice(-2), event]);
  }, []);

  // Kick off: recover an unanswered turn, or render the waiting turn.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (
      conversation.status === "awaiting-agent" ||
      conversation.status === "failed"
    ) {
      void runTurn(() =>
        conversation.recover({ onAgentStreamEvent: streamHandler }),
      );
    } else {
      const next = modeForTurn(conversation.lastAgentTurn);
      setMode(next);
      if (next.kind === "finished") {
        onFinished(conversation.lastAgentTurn);
        exit();
      }
    }
  }, [conversation, exit, modeForTurn, onFinished, runTurn, streamHandler]);

  // Elapsed-seconds ticker while the agent works.
  useEffect(() => {
    if (mode.kind !== "busy") return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [mode.kind]);

  const send = useCallback(
    (text: string) => {
      void runTurn(() =>
        conversation.send(text, { onAgentStreamEvent: streamHandler }),
      );
    },
    [conversation, runTurn, streamHandler],
  );

  const selectItems = useMemo((): readonly string[] => {
    if (mode.kind !== "select") return [];
    if (mode.turn.type !== "ask") return [APPROVE_LABEL, FEEDBACK_LABEL];
    return [...(mode.turn.options ?? []), CUSTOM_ANSWER];
  }, [mode]);

  const onSelect = useCallback(
    (item: string) => {
      if (item === CUSTOM_ANSWER || item === FEEDBACK_LABEL) {
        setMode({ kind: "text" });
        return;
      }
      send(item === APPROVE_LABEL ? APPROVED_MESSAGE : item);
    },
    [send],
  );

  const artifacts = conversation.metadata.artifacts;

  return (
    <Box flexDirection="column">
      <Transcript messages={messages} role={role} />
      {error && <Text color="red">✖ {error}</Text>}
      {mode.kind === "busy" && (
        <Activity events={activity} elapsedSeconds={elapsed} />
      )}
      {mode.kind === "select" && (
        <Select items={selectItems} onSelect={onSelect} />
      )}
      {mode.kind === "text" && <TextInput onSubmit={send} />}
      <Box marginTop={1}>
        <Text dimColor>
          {conversation.id}
          {" · "}
          {role}
          {" · "}
          {conversation.status}
          {" · "}
          {conversation.metadata.branch}
          {artifacts.length > 0 ? ` · ${artifacts[artifacts.length - 1]}` : ""}
          {" · Ctrl-C detaches (conversation is durable)"}
        </Text>
      </Box>
    </Box>
  );
};
