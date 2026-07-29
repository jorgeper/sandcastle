import {
  claudeCode,
  conversation,
  type Conversation,
} from "@ai-hero/sandcastle";
import { chat } from "@ai-hero/sandcastle/chat";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  MODEL,
  DESIGN_LABEL,
  IMPLEMENT_LABEL,
  markerFor,
  slugify,
  ask,
  ensureLabel,
  numberFromUrl,
  getIssue,
  laneNudge,
} from "./shared.ts";

// Filer lane: turn a two-line report into a well-formed, correctly routed
// issue — the lane for everything smaller than a PRD. The issue is this
// lane's OUTPUT (no issue-anchoring on entry). The filer asks at most a
// couple of questions, grounds the issue in the repo, and proposes the
// complete issue (with routing: Sandcastle / sandcastle:design / hold)
// before anything touches GitHub.
//
//   npx tsx .sandcastle/issue.ts "search is slow on big repos"
//   npx tsx .sandcastle/issue.ts            # prompts for the report
//
// Ctrl-C is always safe — the conversation is durable and re-attaches.

const agent = claudeCode(MODEL);
const sandbox = docker();
const AGENT_MARKER = markerFor("filer");

let report = process.argv.slice(2).join(" ").trim();
if (report === "") {
  report = await ask("What's the issue? ");
  if (report === "") process.exit(0);
}

ensureLabel(DESIGN_LABEL, "Needs a PRD; grill the owner");

const convoId = `file-${slugify(report)}`;
let convo: Conversation;
const existing = (await conversation.list()).find((s) => s.id === convoId);
if (existing) {
  console.log(`Re-attaching to conversation "${convoId}".`);
  convo = await conversation.open(convoId, { agent, sandbox });
} else {
  convo = await conversation.start({
    name: convoId,
    role: "filer",
    agent,
    sandbox,
    promptFile: ".sandcastle/filer-prompt.md",
    promptArgs: { REPORT: report, AGENT_MARKER },
  });
}

const { finalTurn } = await chat(convo);

if (finalTurn?.type !== "done" || finalTurn.artifacts.length === 0) {
  console.log(
    "\nNo issue was filed — re-run `npm run sandcastle:issue` to continue.",
  );
  process.exit(0);
}

// --- Guide the next step, keyed to how the issue was routed -------------------

const issueUrl = finalTurn.artifacts.find((a) => a.includes("/issues/"));
console.log(`\nFiled: ${issueUrl ?? finalTurn.artifacts.join(", ")}`);

const n = issueUrl ? numberFromUrl(issueUrl) : undefined;
if (n !== undefined) {
  const labels = getIssue(n).labels.map((l) => l.name);
  if (labels.includes(DESIGN_LABEL)) {
    console.log(
      `Routed to the design lane. Next step:\n  npm run sandcastle:design   (pick #${n})`,
    );
  } else if (labels.includes(IMPLEMENT_LABEL)) {
    console.log(`Implementer-ready. Next step:\n  npm run sandcastle`);
    const nudge = laneNudge(IMPLEMENT_LABEL, "all will be picked up");
    if (nudge) console.log(`(${nudge})`);
  } else {
    console.log(
      `Filed on hold (unlabeled). Release it later with:\n  gh issue edit ${n} --add-label "${IMPLEMENT_LABEL}"   # or "${DESIGN_LABEL}"`,
    );
  }
}
