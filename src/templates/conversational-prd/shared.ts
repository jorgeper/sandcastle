import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline/promises";

// Helpers shared by the conversational-prd template scripts (design.ts,
// decompose.ts, issue.ts). Shared *within* the template only — ADR 0009
// forbids sharing across templates, not within one. Pure functions live at
// the top so tests can import this file without side effects.

export const MODEL = "claude-opus-4-8";
export const HARNESS = "claude-code";

/** Routing labels: which lane (agent) handles an issue. */
export const DESIGN_LABEL = "sandcastle:design";
export const DECOMPOSE_LABEL = "sandcastle:decompose";
export const IMPLEMENT_LABEL = "Sandcastle";

/** Identity marker for everything an agent writes on GitHub on the human's
 *  behalf: [agent · harness · model]. Unmarked text = the human. */
export const markerFor = (role: string): string =>
  `**[${role} · ${HARNESS} · ${MODEL}]**`;

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Extract the load-bearing `**PRD:** <path>` line from an issue body. */
export const parsePrdLine = (body: string): string | undefined =>
  /\*\*PRD:\*\*\s*(\S+)/.exec(body)?.[1];

/** Deterministic title for the handoff issue the PRD merge creates —
 *  doubles as the idempotency key when re-runs search for it. */
export const decomposeIssueTitle = (prdFile: string): string =>
  `Decompose ${prdFile}`;

/** Trailing issue/PR number from a GitHub URL. */
export const numberFromUrl = (url: string): number | undefined => {
  const match = /\/(\d+)\s*$/.exec(url.trim());
  return match ? Number.parseInt(match[1]!, 10) : undefined;
};

// ---------------------------------------------------------------------------
// gh wrappers (side-effecting — not exercised by tests)
// ---------------------------------------------------------------------------

export const gh = (args: string): string =>
  execSync(`gh ${args}`, { encoding: "utf-8" });

/** Fast-forward the local checkout (e.g. after a remote squash-merge landed
 *  a PRD). ff-only so a diverged local branch is never rewritten; returns
 *  false when the pull couldn't fast-forward. */
export const pullFastForward = (): boolean => {
  try {
    execSync("git pull --ff-only", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

export const ghJson = <T>(args: string): T => JSON.parse(gh(args)) as T;

/** Bodies go through --body-file: safe for newlines, backticks, quotes. */
const bodyFile = (body: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), "sandcastle-gh-")), "body.md");
  writeFileSync(path, body);
  return path;
};

/** Idempotent, non-fatal label creation — the flow works unlabeled, it
 *  just loses pickup routing. */
export const ensureLabel = (name: string, description: string): void => {
  try {
    gh(
      `label create ${JSON.stringify(name)} --description ${JSON.stringify(description)} --color BFD4F2 2>/dev/null`,
    );
  } catch {
    // Exists already (or creation failed) — either way, not fatal.
  }
};

export interface IssueSummary {
  number: number;
  title: string;
}

export const listOpenIssues = (label: string): IssueSummary[] =>
  ghJson<IssueSummary[]>(
    `issue list --state open --label ${JSON.stringify(label)} --json number,title --limit 50`,
  );

export interface IssueDetails {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: Array<{ name: string }>;
  comments: Array<{ body: string }>;
}

export const getIssue = (n: number): IssueDetails =>
  ghJson<IssueDetails>(
    `issue view ${n} --json number,title,body,state,labels,comments`,
  );

export const createIssue = (options: {
  title: string;
  body: string;
  label?: string;
}): number => {
  const labelArg = options.label
    ? ` --label ${JSON.stringify(options.label)}`
    : "";
  const url = gh(
    `issue create --title ${JSON.stringify(options.title)}${labelArg} --body-file ${JSON.stringify(bodyFile(options.body))}`,
  );
  const n = numberFromUrl(url);
  if (n === undefined) throw new Error(`Could not parse issue URL: ${url}`);
  return n;
};

export const commentOnIssue = (n: number, body: string): void => {
  gh(`issue comment ${n} --body-file ${JSON.stringify(bodyFile(body))}`);
};

/** Exact-title search across open+closed issues (idempotent re-run key). */
export const findIssueByTitle = (title: string): number | undefined =>
  ghJson<IssueSummary[]>(
    `issue list --state all --search ${JSON.stringify(`"${title}" in:title`)} --json number,title --limit 20`,
  ).find((i) => i.title === title)?.number;

/** One-line cross-lane nudge: how much work is waiting in another lane. */
export const laneNudge = (
  label: string,
  suggestion: string,
): string | undefined => {
  let issues: IssueSummary[];
  try {
    issues = listOpenIssues(label);
  } catch {
    return undefined;
  }
  if (issues.length === 0) return undefined;
  const list = issues
    .slice(0, 5)
    .map((i) => `#${i.number}`)
    .join(", ");
  return `${issues.length} ${label} issue(s) open (${list}) — ${suggestion}`;
};

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

export const ask = async (question: string): Promise<string> => {
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

export const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));
