import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import {
  claudeCode,
  conversation,
  type Conversation,
} from "@ai-hero/sandcastle";
import { chat } from "@ai-hero/sandcastle/chat";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// Designer: grills you into a PRD over a chat conversation, opens a PR with
// the result, then keeps addressing your PR comments until the PR is
// approved or merged.
//
// Run with:   npx tsx .sandcastle/design.ts "my feature idea"
// Re-attach:  npx tsx .sandcastle/design.ts          (lists open designs)
//
// Ctrl-C is always safe — the conversation is durable and re-attaches.

const agent = claudeCode("claude-opus-4-8");
const sandbox = docker();

/** Marker the designer prefixes its own PR replies with (see designer-prompt.md). */
const DESIGNER_MARKER = "**[designer · sandcastle]**";
const POLL_SECONDS = 30;

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const ask = async (question: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
};

const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const gh = (args: string): string =>
  execSync(`gh ${args}`, { encoding: "utf-8" });

const prUrlOf = (convo: Conversation): string | undefined =>
  [...convo.metadata.artifacts].reverse().find((a) => a.includes("/pull/"));

// --- Pick or start a conversation --------------------------------------------

const topicArg = process.argv.slice(2).join(" ").trim();
let convo: Conversation;

if (topicArg === "") {
  const summaries = (await conversation.list()).filter(
    (s) => s.role === "designer",
  );
  const open = summaries.filter(
    (s) => s.status !== "done" || s.artifacts.some((a) => a.includes("/pull/")),
  );
  if (open.length > 0) {
    console.log("Open design conversations:");
    open.forEach((s, i) =>
      console.log(`  ${i + 1}. ${s.id} [${s.status}] ${s.lastMessage ?? ""}`),
    );
    const answer = await ask("Number to resume, or type a new feature idea: ");
    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= open.length) {
      convo = await conversation.open(open[index - 1]!.id, { agent, sandbox });
    } else if (answer !== "") {
      convo = await startDesign(answer);
    } else {
      process.exit(0);
    }
  } else {
    const idea = await ask("What are we designing? ");
    if (idea === "") process.exit(0);
    convo = await startDesign(idea);
  }
} else {
  convo = await startDesign(topicArg);
}

async function startDesign(topic: string): Promise<Conversation> {
  const name = `design-${slugify(topic)}`;
  const existing = (await conversation.list()).find((s) => s.id === name);
  if (existing) {
    console.log(`Re-attaching to existing conversation "${name}".`);
    return conversation.open(name, { agent, sandbox });
  }
  console.log(`Starting design conversation "${name}"…`);
  return conversation.start({
    name,
    role: "designer",
    agent,
    sandbox,
    promptFile: ".sandcastle/designer-prompt.md",
    promptArgs: { TOPIC: topic },
  });
}

// --- Phase A: grilling chat ---------------------------------------------------

let prUrl = prUrlOf(convo);
if (prUrl === undefined) {
  await chat(convo);
  prUrl = prUrlOf(convo);
  if (prUrl === undefined) {
    console.log("No PR was opened — re-run to continue the conversation.");
    process.exit(0);
  }
}

// --- Phase B: PR review — same conversation, PR comments as the transport ----

console.log(`\nWatching ${prUrl} for feedback (Ctrl-C to detach)…`);
const feedbackStatePath = join(
  ".sandcastle",
  "conversations",
  convo.id,
  "pr-feedback.json",
);

interface FeedbackState {
  lastProcessedAt: string;
}

const readFeedbackState = (): FeedbackState =>
  existsSync(feedbackStatePath)
    ? (JSON.parse(readFileSync(feedbackStatePath, "utf-8")) as FeedbackState)
    : { lastProcessedAt: new Date(0).toISOString() };

interface PrComment {
  author?: { login?: string };
  body?: string;
  createdAt?: string;
  submittedAt?: string;
  state?: string;
}

for (;;) {
  const view = JSON.parse(
    gh(`pr view ${prUrl} --json state,reviewDecision,comments,reviews`),
  ) as {
    state: string;
    reviewDecision: string;
    comments: PrComment[];
    reviews: PrComment[];
  };
  if (view.state !== "OPEN" || view.reviewDecision === "APPROVED") {
    console.log(
      view.state === "MERGED"
        ? "PR merged — next step: npx tsx .sandcastle/decompose.ts prd/<file>.md"
        : `PR is ${view.reviewDecision === "APPROVED" ? "approved" : view.state.toLowerCase()}.`,
    );
    break;
  }

  const cutoff = readFeedbackState().lastProcessedAt;
  const items = [...view.comments, ...view.reviews]
    .map((c) => ({
      author: c.author?.login ?? "unknown",
      body: (c.body ?? "").trim(),
      at: c.createdAt ?? c.submittedAt ?? "",
    }))
    .filter(
      (c) =>
        c.body !== "" && !c.body.startsWith(DESIGNER_MARKER) && c.at > cutoff,
    )
    .sort((a, b) => a.at.localeCompare(b.at));

  if (items.length > 0) {
    const batch = items
      .map((c) => `From @${c.author} at ${c.at}:\n${c.body}`)
      .join("\n\n---\n\n");
    console.log(`\nSending ${items.length} feedback item(s) to the designer…`);
    const turn = await convo.send(`PR feedback:\n\n${batch}`);
    writeFileSync(
      feedbackStatePath,
      JSON.stringify({ lastProcessedAt: items[items.length - 1]!.at }) + "\n",
    );
    console.log(`Designer: ${turn.message.split("\n", 1)[0]}`);
  } else {
    process.stdout.write(".");
  }
  await sleep(POLL_SECONDS);
}
