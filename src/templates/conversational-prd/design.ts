import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  DECOMPOSE_LABEL,
  IMPLEMENT_LABEL,
  markerFor,
  ask,
  sleep,
  gh,
  ghJson,
  ensureLabel,
  listOpenIssues,
  getIssue,
  createIssue,
  commentOnIssue,
  findIssueByTitle,
  decomposeIssueTitle,
  laneNudge,
} from "./shared.ts";

// Designer lane: a design issue in → grilling conversation → PRD PR →
// label-gated merge → decompose issue out.
//
//   npx tsx .sandcastle/design.ts "my feature idea"   # auto-creates the issue
//   npx tsx .sandcastle/design.ts --issue 41          # pick up a labeled issue
//   npx tsx .sandcastle/design.ts                     # picker
//
// Ctrl-C is always safe — the conversation is durable and re-attaches.

const agent = claudeCode(MODEL);
const sandbox = docker();
const AGENT_MARKER = markerFor("designer");
const POLL_SECONDS = 30;
const ANCHOR_TEXT = "Designer conversation started";

// --- Resolve the design issue -------------------------------------------------

ensureLabel(DESIGN_LABEL, "Needs a PRD; grill the owner");

const args = process.argv.slice(2);
let issueNumber: number;

if (args[0] === "--issue" && args[1]) {
  issueNumber = Number.parseInt(args[1], 10);
} else if (args.length > 0) {
  const topic = args.join(" ").trim();
  console.log(`Filing a design issue for: ${topic}`);
  issueNumber = createIssue({
    title: `PRD: ${topic}`,
    label: DESIGN_LABEL,
    body: `${AGENT_MARKER}\n\n${topic}\n\n_Filed via design.ts on behalf of the owner._`,
  });
  console.log(`Created design issue #${issueNumber}.`);
} else {
  const issues = listOpenIssues(DESIGN_LABEL);
  if (issues.length === 0) {
    const idea = await ask(
      `No open ${DESIGN_LABEL} issues. Describe a new feature to design (or Enter to exit): `,
    );
    if (idea === "") process.exit(0);
    issueNumber = createIssue({
      title: `PRD: ${idea}`,
      label: DESIGN_LABEL,
      body: `${AGENT_MARKER}\n\n${idea}\n\n_Filed via design.ts on behalf of the owner._`,
    });
    console.log(`Created design issue #${issueNumber}.`);
  } else {
    console.log(`Open ${DESIGN_LABEL} issues:`);
    issues.forEach((i, idx) =>
      console.log(`  ${idx + 1}. #${i.number} ${i.title}`),
    );
    const answer = await ask("Number to work on (or Enter to exit): ");
    const index = Number.parseInt(answer, 10);
    if (!Number.isInteger(index) || index < 1 || index > issues.length) {
      process.exit(0);
    }
    issueNumber = issues[index - 1]!.number;
  }
}

const issue = getIssue(issueNumber);

const implNudge = laneNudge(
  IMPLEMENT_LABEL,
  "run `npm run sandcastle` when you want them built",
);
if (implNudge) console.log(`\nFYI: ${implNudge}`);

// --- Open or start the conversation (issue number is the join key) ------------

const convoId = `design-issue-${issueNumber}`;
let convo: Conversation;
const existing = (await conversation.list()).find((s) => s.id === convoId);
if (existing) {
  console.log(`Re-attaching to conversation "${convoId}".`);
  convo = await conversation.open(convoId, { agent, sandbox });
} else {
  console.log(`Starting design conversation for issue #${issueNumber}…`);
  convo = await conversation.start({
    name: convoId,
    role: "designer",
    agent,
    sandbox,
    promptFile: ".sandcastle/designer-prompt.md",
    promptArgs: {
      ISSUE_NUMBER: issueNumber,
      ISSUE_TITLE: issue.title,
      ISSUE_BODY: issue.body,
      AGENT_MARKER,
    },
  });
}

// Anchor comment: make the conversation visible from the issue (idempotent).
if (!issue.comments.some((c) => c.body.includes(ANCHOR_TEXT))) {
  commentOnIssue(
    issueNumber,
    `${AGENT_MARKER}\n\n${ANCHOR_TEXT} (\`${convoId}\`). Attach with \`npm run sandcastle:design\`.`,
  );
}

// --- Recovery: a previous run may have died mid-turn --------------------------

if (convo.status === "awaiting-agent" || convo.status === "failed") {
  console.log("Recovering an unanswered turn from a previous run…");
  const turn = await convo.recover();
  if (turn) console.log(`Designer: ${turn.message.split("\n", 1)[0]}`);
}

// --- Phase A: grilling chat ---------------------------------------------------

const prUrlOf = (c: Conversation): string | undefined =>
  [...c.metadata.artifacts].reverse().find((a) => a.includes("/pull/"));
const prdFileOf = (c: Conversation): string | undefined =>
  c.metadata.artifacts.find((a) => /(^|\/)prd\//.test(a) && a.endsWith(".md"));

let prUrl = prUrlOf(convo);
if (prUrl === undefined) {
  await chat(convo);
  prUrl = prUrlOf(convo);
  if (prUrl === undefined) {
    // The conversation may have ended by de-escalation (issue relabeled to
    // Sandcastle, no PRD) — or just detached mid-grilling.
    const labels = getIssue(issueNumber).labels.map((l) => l.name);
    if (convo.status === "done" && labels.includes(IMPLEMENT_LABEL)) {
      console.log(
        `\nIssue #${issueNumber} was de-escalated to ${IMPLEMENT_LABEL} — no PRD needed.` +
          `\nNext step:\n  npm run sandcastle`,
      );
    } else {
      console.log(
        "\nNo PR was opened — re-run `npm run sandcastle:design` to continue the conversation.",
      );
    }
    process.exit(0);
  }
}

// Make the PR visible from the issue (idempotent).
if (!getIssue(issueNumber).comments.some((c) => c.body.includes(prUrl))) {
  commentOnIssue(issueNumber, `${AGENT_MARKER}\n\nPRD PR opened: ${prUrl}`);
}

// --- Phase B: PR review — same conversation, PR comments as the transport ----

const nextStep = () => `npm run sandcastle:decompose`;

console.log(`\nThe PRD is up for review: ${prUrl}\n`);
console.log("Your move — either:");
console.log(
  "  • Comment on the PR: I'll pick it up here and the designer will push revisions and reply.",
);
console.log(
  "  • Approve it with the same label gate as the main loop — I'll merge it for you:",
);
console.log(`      gh pr edit ${prUrl} --add-label "sandcastle:approved"`);
console.log(
  `\nAfter the merge I'll file the decompose issue; the next step is:\n      ${nextStep()}`,
);
console.log(
  `\nWatching ${prUrl} for feedback and approval (Ctrl-C to detach; re-run to resume)…`,
);

// The keep-alive sandbox stays up between polls; tear it down on Ctrl-C so
// detaching doesn't leak a running container (worktree/store/session persist).
process.on("SIGINT", () => {
  void convo
    .close()
    .catch(() => {})
    .then(() => process.exit(0));
});

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
}

/** Handoff: the merge that lands the PRD creates the decompose issue. */
const createHandoffIssue = (): void => {
  const prdFile = prdFileOf(convo);
  if (!prdFile) {
    console.log(
      `Merged, but no PRD file recorded in artifacts — file the decompose issue manually with a **PRD:** line and the ${DECOMPOSE_LABEL} label.`,
    );
    return;
  }
  ensureLabel(DECOMPOSE_LABEL, "Merged PRD needs an issue breakdown");
  const title = decomposeIssueTitle(prdFile);
  const already = findIssueByTitle(title);
  if (already !== undefined) {
    console.log(`Decompose issue already exists: #${already}.`);
  } else {
    const n = createIssue({
      title,
      label: DECOMPOSE_LABEL,
      body: `${AGENT_MARKER}\n\n**PRD:** ${prdFile}\n\nFollows #${issueNumber}.`,
    });
    console.log(`Filed decompose issue #${n}.`);
  }
  console.log(`Next step:\n  ${nextStep()}`);
};

for (;;) {
  const view = ghJson<{
    state: string;
    reviewDecision: string;
    comments: PrComment[];
    reviews: PrComment[];
    labels: Array<{ name?: string }>;
  }>(`pr view ${prUrl} --json state,reviewDecision,comments,reviews,labels`);
  if (view.state !== "OPEN") {
    // Manual merge/close still honored as a fallback.
    if (view.state === "MERGED") {
      createHandoffIssue();
    } else {
      console.log(`PR is ${view.state.toLowerCase()}.`);
    }
    break;
  }

  // Approval gate — same convention as the main loop's implement/review
  // flow: the owner adds sandcastle:approved (or formally approves), and
  // the orchestration merges. Merging stays in the script, never the agent.
  const approved =
    view.labels.some((l) => l.name === "sandcastle:approved") ||
    view.reviewDecision === "APPROVED";
  if (approved) {
    console.log("\nsandcastle:approved — merging the PRD PR…");
    try {
      gh(`pr merge ${prUrl} --squash --delete-branch`);
      console.log("Merged.");
      createHandoffIssue();
      break;
    } catch (error) {
      console.error(
        `Merge failed (${error instanceof Error ? error.message.split("\n", 1)[0] : error}); retrying next poll.`,
      );
    }
  }

  const cutoff = readFeedbackState().lastProcessedAt;
  const items = [...view.comments, ...view.reviews]
    .map((c) => ({
      author: c.author?.login ?? "unknown",
      body: (c.body ?? "").trim(),
      at: c.createdAt ?? c.submittedAt ?? "",
    }))
    .filter(
      (c) => c.body !== "" && !c.body.startsWith(AGENT_MARKER) && c.at > cutoff,
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
    console.log(
      '(reply on the PR again, or add the "sandcastle:approved" label when satisfied — still watching)',
    );
  } else {
    process.stdout.write(".");
  }
  await sleep(POLL_SECONDS);
}

await convo.close();
