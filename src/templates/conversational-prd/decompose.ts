import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import {
  claudeCode,
  conversation,
  type Conversation,
} from "@ai-hero/sandcastle";
import { chat } from "@ai-hero/sandcastle/chat";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// Decomposer: reads a merged PRD, proposes a parent-issue + sub-issue
// breakdown over a chat conversation, and — only after you approve —
// creates the Sandcastle-labeled issue tree on GitHub. The main loop
// (npm run sandcastle) picks the issues up from there.
//
// Run with:  npx tsx .sandcastle/decompose.ts prd/001-my-feature.md
//
// Ctrl-C is always safe — the conversation is durable and re-attaches.

const MODEL = "claude-opus-4-8";
const agent = claudeCode(MODEL);
const sandbox = docker();

/** Marker prefixed to everything the decomposer writes on GitHub on the
 *  human's behalf (issue bodies, comments): [agent · harness · model]. */
const AGENT_MARKER = `**[decomposer · claude-code · ${MODEL}]**`;

const prdFile = process.argv[2]?.trim();
if (!prdFile) {
  console.error("Usage: npx tsx .sandcastle/decompose.ts <prd-file>");
  if (existsSync("prd")) {
    const prds = readdirSync("prd").filter(
      (f) => f.endsWith(".md") && f !== "TEMPLATE.md",
    );
    if (prds.length > 0) {
      console.error("\nAvailable PRDs:");
      for (const f of prds) console.error(`  prd/${f}`);
    }
  }
  process.exit(1);
}
if (!existsSync(prdFile)) {
  console.error(`PRD file not found: ${prdFile}`);
  process.exit(1);
}

const name = `decompose-${basename(prdFile, ".md")}`;
const existing = (await conversation.list()).find((s) => s.id === name);

let convo: Conversation;
if (existing) {
  console.log(`Re-attaching to existing conversation "${name}".`);
  convo = await conversation.open(name, { agent, sandbox });
} else {
  console.log(`Starting decompose conversation "${name}"…`);
  convo = await conversation.start({
    name,
    role: "decomposer",
    agent,
    sandbox,
    promptFile: ".sandcastle/decomposer-prompt.md",
    promptArgs: { PRD_FILE: prdFile, AGENT_MARKER },
  });
}

const { finalTurn } = await chat(convo);
if (finalTurn?.type === "done" && finalTurn.artifacts.length > 0) {
  console.log("\nCreated issues:");
  for (const url of finalTurn.artifacts) console.log(`  ${url}`);
  console.log("\nNext step: npm run sandcastle");
}
