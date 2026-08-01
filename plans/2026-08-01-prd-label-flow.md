# Label-Routed PRD Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement prd/008-prd-label-flow.md — a `sandcastle:requires-prd` label lane in the goal-template main loop (nudge → merge-on-approved → autonomous decompose → auto-close), plus a rewritten issue-anchored `/new-prd` Claude Code skill scaffolded by `PrdWorkflow.ts`.

**Architecture:** All new lane logic lives in a new template module `prd-lane.mts` with pure, unit-tested classification/parsing functions; `main.mts` wires the lane in before its iteration loop and keeps every agent call site inline (template convention: "this script IS the config"). The skill ships as a new string constant + scaffold function in `src/PrdWorkflow.ts`, gated in `InitService.ts` to the goal template.

**Tech Stack:** TypeScript (`.mts` template files are plain tsx-run scripts; `src/*.ts` is Effect-based), vitest, `gh` CLI, zod (not needed for new code), prettier via lint-staged.

## Global Constraints

- Spec: `prd/008-prd-label-flow.md` (committed on this branch). One deviation, already agreed: the `sandcastle:requires-prd` label is provisioned by `npm run sandcastle:init` (human-applied labels are never created behind the owner's back — `github.mts` ownership comment), not lazily by the loop. Task 8 amends the spec line.
- Label name: `sandcastle:requires-prd`. Branch convention: `prd/issue-<N>-<slug>`. PR body line: `PRD for #N` — NEVER `Closes #N`.
- Parent close marker (exact string, used for idempotent close-once): `🏰 Sandcastle: all sub-issues complete`
- Type check: `npm run typecheck`. Tests: `npx vitest run <file>`.
- Working branch: `feat/prd-label-flow` (already exists, has the PRD committed).
- lint-staged runs prettier on commit — never hand-format against it.
- Commit messages: end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Template dir shorthand used below: `TPL = src/templates/parallel-planner-goal-with-pr-review`.

---

### Task 1: Label vocabulary — `sandcastle:requires-prd`

**Files:**

- Modify: `src/templates/parallel-planner-goal-with-pr-review/github.mts` (label block, ~line 188)
- Modify: `src/templates/parallel-planner-goal-with-pr-review/setup.mts` (`LABEL_ROWS`, ~line 24)
- Test: `src/templates/parallel-planner-goal-with-pr-review/labels.test.mts`

**Interfaces:**

- Produces: `github.REQUIRES_PRD_LABEL: string` (= `"sandcastle:requires-prd"`), included in `TRIGGER_LABEL_DEFS` (and therefore `ALL_LABEL_DEFS`, so `runInit` and `--doctor` cover it automatically).

- [ ] **Step 1: Write the failing test**

Append to the existing `describe` in `TPL/labels.test.mts`:

```ts
it("provisions the requires-prd trigger label", () => {
  expect(ALL_LABEL_DEFS.map((d) => d.name)).toContain(
    "sandcastle:requires-prd",
  );
});
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npx vitest run src/templates/parallel-planner-goal-with-pr-review/labels.test.mts`
Expected: new test FAILS (label absent); the existing init-table tripwire still passes.

- [ ] **Step 3: Add the label def and init-table row**

In `TPL/github.mts`, below `REQUIRE_PR_LABEL`:

```ts
export const REQUIRES_PRD_LABEL = "sandcastle:requires-prd";
```

and add to `TRIGGER_LABEL_DEFS`:

```ts
  { name: REQUIRES_PRD_LABEL, color: "B60205", desc: "Needs an approved PRD before decompose/implement" },
```

In `TPL/setup.mts`, add to `LABEL_ROWS` (after the `REQUIRE_PR_LABEL` row):

```ts
  [github.REQUIRES_PRD_LABEL, "issue", "you", "needs an approved PRD PR before decompose/implement"],
```

- [ ] **Step 4: Run tests to verify both pass**

Run: `npx vitest run src/templates/parallel-planner-goal-with-pr-review/labels.test.mts`
Expected: PASS (the tripwire test proves LABEL_ROWS and ALL_LABEL_DEFS agree).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/templates/parallel-planner-goal-with-pr-review/github.mts src/templates/parallel-planner-goal-with-pr-review/setup.mts src/templates/parallel-planner-goal-with-pr-review/labels.test.mts
git commit -m "feat(goal-template): add sandcastle:requires-prd trigger label

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure PRD-lane logic — classification and parsers

**Files:**

- Create: `src/templates/parallel-planner-goal-with-pr-review/prd-lane.mts`
- Test: `src/templates/parallel-planner-goal-with-pr-review/prd-lane.test.mts`

**Interfaces:**

- Consumes: `APPROVED_LABEL` from `./state.mts` (value: `"sandcastle:approved"`).
- Produces (exact exports later tasks rely on):
  - `PARENT_CLOSE_MARKER: string`
  - `prdBranchPrefixFor(issueNumber: number): string` → `` `prd/issue-${issueNumber}-` ``
  - `interface PrdPrHead { number: number; state: "OPEN" | "MERGED" | "CLOSED"; headRefName: string }`
  - `findPrdPr(prs: PrdPrHead[], issueNumber: number): PrdPrHead | null`
  - `interface SubIssueSummary { total: number; open: number }`
  - `parseSubIssues(json: string): SubIssueSummary`
  - `parsePrApproval(json: string): boolean`
  - `parseCloseMarkerPresent(json: string): boolean`
  - `prdPathFromPrFiles(json: string): string | null`
  - `type PrdAction` (union below)
  - `classifyPrdIssue(input): PrdAction`

- [ ] **Step 1: Write the failing tests**

Create `TPL/prd-lane.test.mts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyPrdIssue,
  findPrdPr,
  parseCloseMarkerPresent,
  parsePrApproval,
  parseSubIssues,
  prdBranchPrefixFor,
  prdPathFromPrFiles,
  PARENT_CLOSE_MARKER,
  type PrdPrHead,
} from "./prd-lane.mts";

describe("prdBranchPrefixFor / findPrdPr", () => {
  const prs: PrdPrHead[] = [
    { number: 5, state: "CLOSED", headRefName: "prd/issue-12-old-take" },
    { number: 9, state: "OPEN", headRefName: "prd/issue-12-search-speedup" },
    { number: 7, state: "OPEN", headRefName: "prd/issue-120-other" },
    { number: 8, state: "OPEN", headRefName: "sandcastle/issue-12" },
  ];

  it("builds the branch prefix", () => {
    expect(prdBranchPrefixFor(12)).toBe("prd/issue-12-");
  });

  it("matches only the exact issue number prefix (12, not 120)", () => {
    expect(findPrdPr(prs, 120)?.number).toBe(7);
  });

  it("picks the newest (highest-numbered) matching PR", () => {
    expect(findPrdPr(prs, 12)?.number).toBe(9);
  });

  it("returns null when no PRD branch exists", () => {
    expect(findPrdPr(prs, 99)).toBeNull();
  });
});

describe("parseSubIssues", () => {
  it("counts total and open", () => {
    const json = JSON.stringify([
      { number: 31, state: "open" },
      { number: 32, state: "closed" },
      { number: 33, state: "OPEN" },
    ]);
    expect(parseSubIssues(json)).toEqual({ total: 3, open: 2 });
  });

  it("handles the empty list", () => {
    expect(parseSubIssues("[]")).toEqual({ total: 0, open: 0 });
  });
});

describe("parsePrApproval", () => {
  it("true on the approved label", () => {
    const json = JSON.stringify({
      labels: [{ name: "sandcastle:approved" }],
      reviewDecision: "",
    });
    expect(parsePrApproval(json)).toBe(true);
  });

  it("true on an approving review", () => {
    const json = JSON.stringify({ labels: [], reviewDecision: "APPROVED" });
    expect(parsePrApproval(json)).toBe(true);
  });

  it("false otherwise", () => {
    const json = JSON.stringify({
      labels: [{ name: "sandcastle:ready" }],
      reviewDecision: "REVIEW_REQUIRED",
    });
    expect(parsePrApproval(json)).toBe(false);
  });
});

describe("parseCloseMarkerPresent", () => {
  it("finds the marker in issue comments", () => {
    const json = JSON.stringify({
      comments: [{ body: "hello" }, { body: `${PARENT_CLOSE_MARKER} — 3/3.` }],
    });
    expect(parseCloseMarkerPresent(json)).toBe(true);
  });

  it("false without it", () => {
    expect(
      parseCloseMarkerPresent(JSON.stringify({ comments: [{ body: "hi" }] })),
    ).toBe(false);
  });
});

describe("prdPathFromPrFiles", () => {
  it("returns the PRD markdown file from the PR's changed files", () => {
    const json = JSON.stringify({
      files: [{ path: "README.md" }, { path: "prd/009-search-speedup.md" }],
    });
    expect(prdPathFromPrFiles(json)).toBe("prd/009-search-speedup.md");
  });

  it("ignores prd/TEMPLATE.md and returns null when absent", () => {
    const json = JSON.stringify({ files: [{ path: "prd/TEMPLATE.md" }] });
    expect(prdPathFromPrFiles(json)).toBeNull();
  });
});

describe("classifyPrdIssue", () => {
  const none = { total: 0, open: 0 };

  it("no PR → needs-prd", () => {
    expect(
      classifyPrdIssue({
        pr: null,
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "needs-prd" });
  });

  it("open unapproved PR → awaiting-review", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "OPEN", approved: false },
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "awaiting-review", pr: 9 });
  });

  it("open approved PR → merge-and-decompose", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "OPEN", approved: true },
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "merge-and-decompose", pr: 9 });
  });

  it("merged PR, no sub-issues → decompose (crash recovery)", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "MERGED", approved: true },
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "decompose", pr: 9 });
  });

  it("closed-unmerged PR → abandoned", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "CLOSED", approved: false },
        subIssues: none,
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "abandoned", pr: 9 });
  });

  it("sub-issues with some open → in-progress (regardless of PR)", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "MERGED", approved: true },
        subIssues: { total: 3, open: 1 },
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "in-progress", open: 1, total: 3 });
  });

  it("all sub-issues closed, marker absent → close-parent", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "MERGED", approved: true },
        subIssues: { total: 3, open: 0 },
        closeMarkerPresent: false,
      }),
    ).toEqual({ kind: "close-parent", total: 3 });
  });

  it("all closed but marker present (manually reopened parent) → done", () => {
    expect(
      classifyPrdIssue({
        pr: { number: 9, state: "MERGED", approved: true },
        subIssues: { total: 3, open: 0 },
        closeMarkerPresent: true,
      }),
    ).toEqual({ kind: "done" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/templates/parallel-planner-goal-with-pr-review/prd-lane.test.mts`
Expected: FAIL — module `./prd-lane.mts` does not exist.

- [ ] **Step 3: Implement the pure module**

Create `TPL/prd-lane.mts`:

```ts
// PRD lane (prd/008): pure classification for `sandcastle:requires-prd`
// issues. Every state is derived from GitHub alone — no conversation store.
// The impure lane runner lives in main.mts (agent call sites stay there,
// template convention); everything here is unit-testable.

import { APPROVED_LABEL } from "./state.mts";

/** First line of the idempotent parent-close comment. Close once: a
 * manually-reopened parent (marker already present) is never re-closed. */
export const PARENT_CLOSE_MARKER = "🏰 Sandcastle: all sub-issues complete";

/** A PRD PR for issue N lives on branch `prd/issue-<N>-<slug>` — the
 * trailing dash keeps issue 12 from matching issue 120's branches. */
export const prdBranchPrefixFor = (issueNumber: number): string =>
  `prd/issue-${issueNumber}-`;

export interface PrdPrHead {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  headRefName: string;
}

/** Newest (highest-numbered) PR whose head branch matches the issue. */
export const findPrdPr = (
  prs: PrdPrHead[],
  issueNumber: number,
): PrdPrHead | null => {
  const prefix = prdBranchPrefixFor(issueNumber);
  const matches = prs.filter((pr) => pr.headRefName.startsWith(prefix));
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (a.number > b.number ? a : b));
};

export interface SubIssueSummary {
  total: number;
  open: number;
}

/** Input: `gh api repos/<slug>/issues/<n>/sub_issues` (a JSON array of
 * issue objects; `state` is "open"/"closed"). */
export const parseSubIssues = (json: string): SubIssueSummary => {
  const items = JSON.parse(json) as { state?: string }[];
  return {
    total: items.length,
    open: items.filter((i) => (i.state ?? "").toLowerCase() === "open").length,
  };
};

/** Input: `gh pr view <n> --json labels,reviewDecision`. Same convention as
 * design.ts: the approved label or an approving review. */
export const parsePrApproval = (json: string): boolean => {
  const view = JSON.parse(json) as {
    labels?: { name?: string }[];
    reviewDecision?: string;
  };
  return (
    (view.labels ?? []).some((l) => l.name === APPROVED_LABEL) ||
    view.reviewDecision === "APPROVED"
  );
};

/** Input: `gh issue view <n> --json comments`. */
export const parseCloseMarkerPresent = (json: string): boolean => {
  const view = JSON.parse(json) as { comments?: { body?: string }[] };
  return (view.comments ?? []).some((c) =>
    (c.body ?? "").includes(PARENT_CLOSE_MARKER),
  );
};

/** Input: `gh pr view <n> --json files`. The merged PRD is the PR's
 * `prd/*.md` file (never TEMPLATE.md) — how a re-run recovers the path. */
export const prdPathFromPrFiles = (json: string): string | null => {
  const view = JSON.parse(json) as { files?: { path?: string }[] };
  return (
    (view.files ?? [])
      .map((f) => f.path ?? "")
      .find(
        (p) => /(^|\/)prd\/.+\.md$/.test(p) && !p.endsWith("prd/TEMPLATE.md"),
      ) ?? null
  );
};

export type PrdAction =
  | { kind: "needs-prd" }
  | { kind: "awaiting-review"; pr: number }
  | { kind: "merge-and-decompose"; pr: number }
  | { kind: "decompose"; pr: number }
  | { kind: "in-progress"; open: number; total: number }
  | { kind: "close-parent"; total: number }
  | { kind: "done" }
  | { kind: "abandoned"; pr: number };

/** The state machine of prd/008. Sub-issues dominate: once they exist the
 * PRD phase is over, whatever the PR looks like. */
export const classifyPrdIssue = (input: {
  pr: {
    number: number;
    state: "OPEN" | "MERGED" | "CLOSED";
    approved: boolean;
  } | null;
  subIssues: SubIssueSummary;
  closeMarkerPresent: boolean;
}): PrdAction => {
  const { pr, subIssues, closeMarkerPresent } = input;
  if (subIssues.total > 0) {
    if (subIssues.open > 0)
      return {
        kind: "in-progress",
        open: subIssues.open,
        total: subIssues.total,
      };
    return closeMarkerPresent
      ? { kind: "done" }
      : { kind: "close-parent", total: subIssues.total };
  }
  if (pr === null) return { kind: "needs-prd" };
  if (pr.state === "OPEN")
    return pr.approved
      ? { kind: "merge-and-decompose", pr: pr.number }
      : { kind: "awaiting-review", pr: pr.number };
  if (pr.state === "MERGED") return { kind: "decompose", pr: pr.number };
  return { kind: "abandoned", pr: pr.number };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/templates/parallel-planner-goal-with-pr-review/prd-lane.test.mts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/templates/parallel-planner-goal-with-pr-review/prd-lane.mts src/templates/parallel-planner-goal-with-pr-review/prd-lane.test.mts
git commit -m "feat(goal-template): pure PRD-lane state machine and GitHub parsers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Thin `gh` wrappers in github.mts

**Files:**

- Modify: `src/templates/parallel-planner-goal-with-pr-review/github.mts` (append near the other wrappers; no new tests — the file's convention is "everything touching the network stays thin", parsing was tested in Task 2)

**Interfaces:**

- Produces (exact signatures Task 5 consumes):
  - `listRequiresPrdIssues(): Promise<IssueInfo[]>`
  - `listAllPrHeads(): Promise<{ number: number; state: string; headRefName: string }[]>`
  - `subIssuesJson(repo: string, issueNumber: number): Promise<string>`
  - `prApprovalJson(prNumber: number): Promise<string>`
  - `prFilesJson(prNumber: number): Promise<string>`
  - `issueCommentsJson(issueNumber: number): Promise<string>`

- [ ] **Step 1: Implement the wrappers**

Append to `TPL/github.mts` (after `listSandcastleIssues` or at the end of the wrapper section):

```ts
// --- PRD lane (prd/008) wrappers — raw JSON out, parsing in prd-lane.mts ---

export const listRequiresPrdIssues = async (): Promise<IssueInfo[]> => {
  const raw = await gh([
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    REQUIRES_PRD_LABEL,
    "--limit",
    "100",
    "--json",
    "number,title,labels",
  ]);
  return (JSON.parse(raw) as any[]).map((issue) => ({
    number: issue.number,
    title: issue.title,
    labels: (issue.labels as any[]).map((label) => label.name),
  }));
};

export const listAllPrHeads = async (): Promise<
  { number: number; state: string; headRefName: string }[]
> => {
  const raw = await gh([
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "200",
    "--json",
    "number,state,headRefName",
  ]);
  return JSON.parse(raw);
};

export const subIssuesJson = (
  repo: string,
  issueNumber: number,
): Promise<string> =>
  gh(["api", `repos/${repo}/issues/${issueNumber}/sub_issues`]);

export const prApprovalJson = (prNumber: number): Promise<string> =>
  gh(["pr", "view", String(prNumber), "--json", "labels,reviewDecision"]);

export const prFilesJson = (prNumber: number): Promise<string> =>
  gh(["pr", "view", String(prNumber), "--json", "files"]);

export const issueCommentsJson = (issueNumber: number): Promise<string> =>
  gh(["issue", "view", String(issueNumber), "--json", "comments"]);
```

- [ ] **Step 2: Typecheck, run the template test suite, commit**

Run: `npm run typecheck && npx vitest run src/templates/parallel-planner-goal-with-pr-review/`
Expected: PASS (nothing regressed).

```bash
git add src/templates/parallel-planner-goal-with-pr-review/github.mts
git commit -m "feat(goal-template): gh wrappers for the PRD lane

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Decomposer prompt file

**Files:**

- Create: `src/templates/parallel-planner-goal-with-pr-review/decompose-prompt.md`
- Test: `src/templates/parallel-planner-goal-with-pr-review/prompt-args.test.mts` (add entry)

**Interfaces:**

- Produces: prompt file consumed by Task 5's agent call with promptArgs exactly `PARENT_NUMBER`, `PARENT_TITLE`, `PRD_PATH`, `REPO`, `AGENT_MARKER`, `TRIGGER_LABEL`.

- [ ] **Step 1: Add the failing prompt-args entry**

In `TPL/prompt-args.test.mts`, add to `ARGS_BY_PROMPT`:

```ts
  "decompose-prompt.md": [
    "PARENT_NUMBER",
    "PARENT_TITLE",
    "PRD_PATH",
    "REPO",
    "AGENT_MARKER",
    "TRIGGER_LABEL",
  ],
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/templates/parallel-planner-goal-with-pr-review/prompt-args.test.mts`
Expected: FAIL — `decompose-prompt.md` missing (or placeholder mismatch).

- [ ] **Step 3: Write the prompt file**

Create `TPL/decompose-prompt.md` (the file content is everything inside the four-backtick fence, including its own three-backtick blocks):

````markdown
# TASK

Decompose the approved, merged PRD `{{PRD_PATH}}` into implementation
sub-issues of parent issue #{{PARENT_NUMBER}} — "{{PARENT_TITLE}}".

You are the decomposer. The PRD was already approved by the owner (that
approval is the gate — do NOT ask for approval of the breakdown). You do
not implement anything and you NEVER edit the parent issue's body, title,
or labels. Derived issues are the one thing you create.

# IDEMPOTENCY CHECK (do this first)

List the parent's sub-issues:
`gh api repos/{{REPO}}/issues/{{PARENT_NUMBER}}/sub_issues`
If ANY exist, a previous run already decomposed (perhaps partially): do
NOT create more issues, do NOT comment. Print what exists and stop.

# DECOMPOSE

Read `{{PRD_PATH}}` and the parent issue (`gh issue view {{PARENT_NUMBER}}
--comments`). Break the PRD into N ≥ 1 implementable sub-issues. A simple
PRD is a single sub-issue — that is normal, not a special case.

Rules:

- Every sub-issue must be independently landable on the default branch:
  its own branch and PR, tests passing, no half-wired user-visible state.
  Order user-visible wiring last via `Blocked by` edges.
- Acceptance criteria are lifted from the PRD's numbered Requirements —
  each requirement lands in exactly one sub-issue.

Create the sub-issues in dependency order, so earlier siblings' numbers
can be referenced in `Blocked by` lines:

```
gh issue create --title "<sub-issue title>" --label "{{TRIGGER_LABEL}}" --body "**Parent:** #{{PARENT_NUMBER}}
**PRD:** {{PRD_PATH}}

## Acceptance criteria

- <criterion>

Blocked by #<earlier sibling number>"
```

Omit the `Blocked by` line for unblocked sub-issues. The `**Parent:**` and
`**PRD:**` lines are load-bearing: downstream agents read them.

Then link each sub-issue to the parent via the sub-issue API (it takes the
child's database id, not its number):

```
CHILD_ID=$(gh api repos/{{REPO}}/issues/<child number> --jq .id)
gh api repos/{{REPO}}/issues/{{PARENT_NUMBER}}/sub_issues -F sub_issue_id="$CHILD_ID"
```

# REPORT

Comment on the parent (first line is your marker):

```
gh issue comment {{PARENT_NUMBER}} --body "{{AGENT_MARKER}}

Decomposed {{PRD_PATH}} into: #<n1>, #<n2>, …  (dependency edges in the issue bodies)"
```

Finally, print the created issue numbers to stdout.
````

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/templates/parallel-planner-goal-with-pr-review/prompt-args.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/templates/parallel-planner-goal-with-pr-review/decompose-prompt.md src/templates/parallel-planner-goal-with-pr-review/prompt-args.test.mts
git commit -m "feat(goal-template): decomposer prompt for the PRD lane

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire the PRD lane into main.mts

**Files:**

- Modify: `src/templates/parallel-planner-goal-with-pr-review/main.mts`

Three changes: (a) a `runPrdLane` function defined near `nudgeConversationalLanes` (~line 415), (b) a call to it right after `await nudgeConversationalLanes();` (~line 506), (c) exclusion of requires-prd issues from the implement loop (right after `listSandcastleIssues()`, ~line 517).

No new unit tests — all decision logic was tested in Task 2; this function is deliberately thin glue (matches how Phase 0.5 merge glue is untested). Verification is typecheck + full template suite.

**Interfaces:**

- Consumes: everything produced by Tasks 1–4; `github.mergePr`, `github.closeIssue`, `github.repoSlug`, `sandcastle.run`, `docker()`, `hooks`, `markerFor`, `timed`, `TARGET_BRANCH`, `execFileAsync`.

- [ ] **Step 1: Add the lane runner**

In `TPL/main.mts`, import at the top (with the other `./` imports):

```ts
import {
  classifyPrdIssue,
  findPrdPr,
  parseCloseMarkerPresent,
  parsePrApproval,
  parseSubIssues,
  prdPathFromPrFiles,
  PARENT_CLOSE_MARKER,
  type PrdPrHead,
} from "./prd-lane.mts";
```

Add after `nudgeConversationalLanes` (before the "Main loop" banner):

```ts
// ---------------------------------------------------------------------------
// PRD lane (prd/008): issues labeled `sandcastle:requires-prd` follow
// idea → PRD PR (via the /new-prd skill, run by the owner in Claude Code)
// → approval → merge → autonomous decompose → sub-issues. Every state is
// derived from GitHub; this runs once per invocation, before the loop, so
// freshly decomposed sub-issues are picked up by iteration 1.
// ---------------------------------------------------------------------------

const runPrdLane = async (): Promise<void> => {
  let issues: github.IssueInfo[];
  try {
    issues = await github.listRequiresPrdIssues();
  } catch {
    return; // no gh / no labels yet — the lane is best-effort at startup
  }
  if (issues.length === 0) return;

  const repo = await github.repoSlug();
  const prHeads = (await github.listAllPrHeads()) as PrdPrHead[];
  const nudges: string[] = [];

  for (const issue of issues) {
    const head = findPrdPr(prHeads, issue.number);
    // API errors mean "state unknown" — report, never guess (prd/008).
    let action: ReturnType<typeof classifyPrdIssue>;
    let mergedPrNumber = head?.state === "MERGED" ? head.number : null;
    try {
      const pr =
        head === null
          ? null
          : {
              number: head.number,
              state: head.state,
              approved:
                head.state === "OPEN"
                  ? parsePrApproval(await github.prApprovalJson(head.number))
                  : false,
            };
      action = classifyPrdIssue({
        pr,
        subIssues: parseSubIssues(
          await github.subIssuesJson(repo, issue.number),
        ),
        closeMarkerPresent: parseCloseMarkerPresent(
          await github.issueCommentsJson(issue.number),
        ),
      });
    } catch (error) {
      console.warn(
        `  ⚠ PRD lane: could not classify #${issue.number} (${error instanceof Error ? error.message.split("\n", 1)[0] : error}) — skipping.`,
      );
      continue;
    }
    console.log(`  PRD #${issue.number} → ${action.kind}`);

    if (action.kind === "merge-and-decompose") {
      console.log(
        `  merging approved PRD PR #${action.pr} (issue #${issue.number})…`,
      );
      try {
        await github.mergePr(action.pr);
        mergedPrNumber = action.pr;
      } catch (error) {
        nudges.push(
          `PRD PR #${action.pr} (issue #${issue.number}) is approved but the merge failed — resolve and re-run.`,
        );
        continue;
      }
    }

    if (action.kind === "merge-and-decompose" || action.kind === "decompose") {
      const prNumber = mergedPrNumber ?? (action as { pr: number }).pr;
      const prdPath = prdPathFromPrFiles(await github.prFilesJson(prNumber));
      if (prdPath === null) {
        nudges.push(
          `PRD PR #${prNumber} (issue #${issue.number}) merged but no prd/*.md among its files — decompose manually.`,
        );
        continue;
      }
      // The decomposer reads the PRD from the default branch — sync first.
      await execFileAsync("git", [
        "pull",
        "--ff-only",
        "origin",
        TARGET_BRANCH,
      ]);
      const decomposerModel = "claude-opus-4-8";
      await timed("decomposer", { issue: issue.number }, () =>
        sandcastle.run({
          hooks,
          sandbox: docker(),
          name: "decomposer",
          maxIterations: 1,
          agent: sandcastle.claudeCode(decomposerModel),
          promptFile: "./.sandcastle/decompose-prompt.md",
          promptArgs: {
            PARENT_NUMBER: issue.number,
            PARENT_TITLE: issue.title,
            PRD_PATH: prdPath,
            REPO: repo,
            AGENT_MARKER: markerFor(
              "decomposer",
              "claude-code",
              decomposerModel,
            ),
            TRIGGER_LABEL: github.TRIGGER_LABEL,
          },
        }),
      );
      console.log(
        `  #${issue.number}: decomposed — sub-issues enter this run's implement lane.`,
      );
      continue;
    }

    if (action.kind === "close-parent") {
      console.log(
        `  #${issue.number}: all ${action.total} sub-issue(s) closed — closing parent.`,
      );
      await github.closeIssue(
        issue.number,
        `${PARENT_CLOSE_MARKER} — ${action.total}/${action.total} sub-issues closed.`,
      );
      continue;
    }

    if (action.kind === "needs-prd")
      nudges.push(
        `#${issue.number} "${issue.title}" needs a PRD — run the /new-prd skill in Claude Code (it grills you, then opens the PRD PR).`,
      );
    if (action.kind === "awaiting-review")
      nudges.push(
        `PRD PR #${action.pr} (issue #${issue.number}) awaits your review — approve with: gh pr edit ${action.pr} --add-label "${APPROVED_LABEL}"`,
      );
    if (action.kind === "abandoned")
      nudges.push(
        `PRD PR #${action.pr} (issue #${issue.number}) was closed without merging — reopen it, or run /new-prd for a fresh PRD.`,
      );
  }

  for (const nudge of nudges) console.log(`ℹ PRD lane: ${nudge}`);
};
```

- [ ] **Step 2: Call the lane and exclude its issues from the implement loop**

After `await nudgeConversationalLanes();` add:

```ts
await runPrdLane();
```

Inside the loop, immediately after `const openIssues = await github.listSandcastleIssues();` (before the empty check), add:

```ts
// PRD-lane parents are never implemented directly (prd/008) — their
// sub-issues carry the work. runPrdLane() already reported their state.
const prdParents = openIssues.filter((issue) =>
  issue.labels.includes(github.REQUIRES_PRD_LABEL),
);
if (prdParents.length > 0) {
  console.log(
    `Skipping ${prdParents.length} \`${github.REQUIRES_PRD_LABEL}\` parent issue(s): ${prdParents.map((i) => `#${i.number}`).join(", ")}.`,
  );
}
const workIssues = openIssues.filter(
  (issue) => !issue.labels.includes(github.REQUIRES_PRD_LABEL),
);
```

Then replace the remaining uses of `openIssues` inside the loop body with `workIssues` — the `openIssues.length === 0` empty-check, the `openIssues.some(...)` PR-infra check, and the `for (const issue of openIssues)` Phase-0 loop. (Keep the variable name `openIssues` for the raw fetch so the diff stays minimal.) Note for the empty-check message: it fires only when there are no work issues at all; leave the wording unchanged.

- [ ] **Step 3: Typecheck and run the template suite**

Run: `npm run typecheck && npx vitest run src/templates/parallel-planner-goal-with-pr-review/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/templates/parallel-planner-goal-with-pr-review/main.mts
git commit -m "feat(goal-template): PRD lane in the main loop — merge on approval, autonomous decompose, parent auto-close

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Issue-anchored `/new-prd` skill in PrdWorkflow.ts

**Files:**

- Modify: `src/PrdWorkflow.ts`
- Test: `src/PrdWorkflow.test.ts`

**Interfaces:**

- Produces: `NEW_PRD_ISSUE_SKILL: string` and `scaffoldIssueAnchoredPrdWorkflow(repoDir: string): Effect.Effect<void, Error, FileSystem.FileSystem>` — writes `prd/TEMPLATE.md` (same `PRD_TEMPLATE`) and `.claude/skills/new-prd/SKILL.md` (the new content), never overwriting. No `decompose-prd` skill (the orchestrator decomposes).

- [ ] **Step 1: Write the failing tests**

Append to `src/PrdWorkflow.test.ts`:

```ts
describe("scaffoldIssueAnchoredPrdWorkflow", () => {
  const runIssueAnchored = (repoDir: string) =>
    Effect.runPromise(
      scaffoldIssueAnchoredPrdWorkflow(repoDir).pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    );

  it("writes the PRD template and the issue-anchored new-prd skill only", async () => {
    const dir = await makeDir();
    await runIssueAnchored(dir);

    const template = await readFile(join(dir, "prd", "TEMPLATE.md"), "utf-8");
    expect(template).toContain("## Problem");

    const newPrd = await readFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "utf-8",
    );
    expect(newPrd).toContain("name: new-prd");
    // Issue-anchored: targets a requires-prd issue, opens a PR on the
    // prd/issue-<N>-<slug> branch, and must never close the issue.
    expect(newPrd).toContain("sandcastle:requires-prd");
    expect(newPrd).toContain("prd/issue-");
    expect(newPrd).toContain("PRD for #");
    expect(newPrd).toMatch(/never.*Closes/i);
    // Still wraps the grilling skill with the install offer.
    expect(newPrd).toContain("github.com/mattpocock/skills");
    expect(newPrd).toContain(
      "claude plugin install mattpocock-skills@mattpocock",
    );
    // Decompose belongs to the orchestrator now — no decompose-prd skill.
    await expect(
      readFile(
        join(dir, ".claude", "skills", "decompose-prd", "SKILL.md"),
        "utf-8",
      ),
    ).rejects.toThrow();
  });

  it("does not overwrite an existing new-prd skill", async () => {
    const dir = await makeDir();
    await mkdir(join(dir, ".claude", "skills", "new-prd"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "user-customized",
    );
    await runIssueAnchored(dir);
    expect(
      await readFile(
        join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
        "utf-8",
      ),
    ).toBe("user-customized");
  });
});
```

Also add `scaffoldIssueAnchoredPrdWorkflow` to the import from `./PrdWorkflow.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/PrdWorkflow.test.ts`
Expected: FAIL — `scaffoldIssueAnchoredPrdWorkflow` not exported.

- [ ] **Step 3: Implement**

In `src/PrdWorkflow.ts`, add the new skill constant (after `NEW_PRD_SKILL`) and the scaffold function (after `scaffoldPrdWorkflow`):

```ts
export const NEW_PRD_ISSUE_SKILL = `---
name: new-prd
description: Grill the user into a PRD for a sandcastle:requires-prd GitHub issue, then open the PRD PR linked to it. Use when the user wants to write a PRD, spec out a feature, or the orchestrator said an issue needs a PRD.
---

# New PRD (issue-anchored)

Turn a \`sandcastle:requires-prd\` issue into a PRD pull request through a
relentless interview. The owner filed the issue; you never create issues.

## 1. Resolve the target issue

If the user gave an issue number or URL, use it. Otherwise list the
candidates and let them pick:

    gh pr list --state all --limit 200 --json headRefName --jq '[.[].headRefName]'
    gh issue list --state open --label "sandcastle:requires-prd" --json number,title

An issue is a candidate only if NO branch \`prd/issue-<N>-*\` appears in
the PR list (those already have a PRD PR). If the picked issue's PRD PR is
already MERGED, say so and stop — decompose is the orchestrator's job
(\`npm run sandcastle\`).

**Feedback mode:** if the issue has an OPEN PRD PR, skip to section 6.

## 2. De-escalation check

Read the issue (\`gh issue view <N> --comments\`). If it becomes clear this
is a contained bug or small task that needs no PRD, say so and offer to
remove the label:

    gh issue edit <N> --remove-label "sandcastle:requires-prd"

On agreement, also comment on the issue explaining the de-escalation, add
any acceptance criteria you learned, and stop — the plain implement lane
picks it up.

## 3. Grill

If a \`/grilling\` or \`/grill-me\` skill is available, invoke it on the
issue's idea.

If neither is available, tell the user those skills come from Matt Pocock's
skills collection (https://github.com/mattpocock/skills) and offer to
install it for them. If they say yes, run:

    claude plugin marketplace add mattpocock/skills
    claude plugin install mattpocock-skills@mattpocock

Newly installed plugin skills may not be visible until the next session, so
after installing — or if the user declines — conduct the interview yourself
this time: interview the user relentlessly about every aspect of the idea
until you reach shared understanding. Ask questions ONE AT A TIME, each
with your recommended answer first. Look up facts in the repo yourself;
only decisions go to the user. Do not write the PRD until the user
confirms shared understanding.

## 4. Write the PRD

- Find the next free number: list \`prd/\`, take the highest NNN prefix + 1
  (three digits, zero-padded; first PRD is 001).
- Create branch \`prd/issue-<N>-<kebab-slug>\` from the default branch —
  this exact branch-name shape is load-bearing: it is how the orchestrator
  links the PR to issue #<N>.
- Write \`prd/NNN-<kebab-slug>.md\` following \`prd/TEMPLATE.md\`. Fill every
  section — an empty Non-goals section means you have not grilled hard
  enough. Requirements are numbered, testable statements: the decomposer
  turns each one into a sub-issue acceptance criterion.

## 5. Open the PR

Commit, push, and open the PR:

    git add prd/NNN-<slug>.md && git commit -m "docs: add PRD NNN — <title>"
    git push -u origin prd/issue-<N>-<slug>
    gh pr create --title "PRD NNN: <title>" --body "PRD for #<N>.

<one-paragraph summary>"

The body's first line is \`PRD for #<N>.\` — NEVER write \`Closes #<N>\` (or
Fixes/Resolves): the issue must stay open after the merge; it becomes the
parent of the decomposed sub-issues. Comment the PR URL on the issue for
visibility, then return to the default branch.

Tell the user the next steps: review the PR; approve with
\`gh pr edit <PR> --add-label "sandcastle:approved"\`; then run
\`npm run sandcastle\` — it merges the PR, decomposes the PRD into
sub-issues, and the implementers take it from there.

## 6. Feedback mode (open PRD PR exists)

Fetch the PR's comments and review threads, check out its branch, revise
the PRD to address them, commit, push, and reply on the threads. Then
remind the user of the approval command above. The PR thread is the
memory — nothing else tracks this conversation.
`;

const ISSUE_ANCHORED_FILES: readonly ScaffoldFile[] = [
  { relativePath: join("prd", "TEMPLATE.md"), content: PRD_TEMPLATE },
  {
    relativePath: join(".claude", "skills", "new-prd", "SKILL.md"),
    content: NEW_PRD_ISSUE_SKILL,
  },
];

/**
 * Issue-anchored variant (prd/008) for the goal template: /new-prd targets
 * an existing `sandcastle:requires-prd` issue and opens a PRD PR; there is
 * no decompose-prd skill because the orchestrator decomposes. Same
 * never-overwrite contract as scaffoldPrdWorkflow.
 */
export const scaffoldIssueAnchoredPrdWorkflow = (
  repoDir: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const file of ISSUE_ANCHORED_FILES) {
      const target = join(repoDir, file.relativePath);
      const exists = yield* fs
        .exists(target)
        .pipe(Effect.mapError((e) => new Error(e.message)));
      if (exists) continue;
      yield* fs
        .makeDirectory(dirname(target), { recursive: true })
        .pipe(Effect.mapError((e) => new Error(e.message)));
      yield* fs
        .writeFileString(target, file.content)
        .pipe(Effect.mapError((e) => new Error(e.message)));
    }
  });
```

(If extracting the shared write-loop into a helper keeps it DRY, do so — both scaffold functions may call a private `scaffoldFiles(repoDir, files)`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/PrdWorkflow.test.ts`
Expected: PASS — including the pre-existing `scaffoldPrdWorkflow` tests (old skill unchanged).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/PrdWorkflow.ts src/PrdWorkflow.test.ts
git commit -m "feat: issue-anchored /new-prd skill — grills into a PRD PR for a requires-prd issue

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Scaffold the skill from init for the goal template

**Files:**

- Modify: `src/InitService.ts` (the `scaffoldPrdWorkflow` call site, ~line 1230)
- Test: `src/InitService.test.ts` (mirror the existing PRD-workflow scaffold tests — find them with `grep -n "new-prd" src/InitService.test.ts`, ~line 1709)

**Interfaces:**

- Consumes: `scaffoldIssueAnchoredPrdWorkflow` from Task 6.

- [ ] **Step 1: Write the failing test**

Next to the existing new-prd scaffold tests in `src/InitService.test.ts` (copy the surrounding test's init-call setup exactly — same helper, same options shape — changing only the template name and assertions):

```ts
it("scaffolds the issue-anchored new-prd skill for the goal template (github + label)", async () => {
  // ...same setup as the neighbouring scaffoldPrdWorkflow test, with
  // template: "parallel-planner-goal-with-pr-review"...
  const newPrd = await readFile(
    join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
    "utf-8",
  );
  expect(newPrd).toContain("sandcastle:requires-prd");
  // No decompose-prd skill in this template — the orchestrator decomposes.
  expect(
    await exists(join(dir, ".claude", "skills", "decompose-prd", "SKILL.md")),
  ).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/InitService.test.ts -t "issue-anchored"`
Expected: FAIL — skill file not written.

- [ ] **Step 3: Wire the scaffold**

In `src/InitService.ts`, directly after the existing `scaffoldPrdWorkflow` block:

```ts
// Issue-anchored PRD workflow (prd/008): /new-prd targets a
// `sandcastle:requires-prd` issue and opens the PRD PR; main.mts owns
// merge + decompose. Same GitHub-only, label-gated conditions.
if (
  templateName === "parallel-planner-goal-with-pr-review" &&
  issueTracker.name === "github-issues" &&
  createLabel
) {
  yield * scaffoldIssueAnchoredPrdWorkflow(repoDir);
}
```

and add `scaffoldIssueAnchoredPrdWorkflow` to the import from `./PrdWorkflow.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/InitService.test.ts`
Expected: PASS (all, including existing gating tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/InitService.ts src/InitService.test.ts
git commit -m "feat(init): scaffold issue-anchored /new-prd for the goal template

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, spec amendment, changeset

**Files:**

- Modify: `prd/008-prd-label-flow.md` (label-provisioning sentence)
- Modify: `docs/agents/triage.md` (label table)
- Create: `docs/adr/0023-label-routed-prd-flow.md`
- Modify: `README.md` (goal-template section — find it with `grep -n "parallel-planner-goal-with-pr-review" README.md`)
- Modify: `FORK-MANUAL.md` (new lane, operator's view)
- Create: `.changeset/prd-label-flow.md`

- [ ] **Step 1: Amend the spec's label-provisioning sentence**

In `prd/008-prd-label-flow.md`, replace the sentence

> The main loop ensures the label exists (idempotent `gh label create || true` semantics, same as the scripts).

with:

> The label is provisioned by `npm run sandcastle:init` (it joins the template's `ALL_LABEL_DEFS`); human-applied labels are never created behind the owner's back.

- [ ] **Step 2: Register the label in triage.md**

Add to the label table in `docs/agents/triage.md` (matching the two existing `sandcastle:*` rows' format):

```markdown
| `sandcastle:requires-prd` | Needs an approved PRD PR before decompose/implement | `main.mts` PRD lane (goal template) + `/new-prd` skill |
```

- [ ] **Step 3: Write ADR 0023**

Create `docs/adr/0023-label-routed-prd-flow.md` (match the header style of `docs/adr/0022-conversation-primitive.md` — read it first):

```markdown
# 23. Humans file entry-point issues; one orchestrator runs every lane

Date: 2026-08-01

## Status

Accepted

## Context

The conversational-prd path (ADR 0022, prd/004/005) reaches PRDs through
agent-filed issues and three separate scripts (issue/design/decompose).
The fork owner's operating principles have since firmed up: the human
files every entry-point issue, and `npm run sandcastle` is the single
orchestration command. Interactive grilling belongs in the owner's
Claude Code session, not in a sandboxed chat gateway.

## Decision

Add a label-routed PRD lane (prd/008) to the goal template:
`sandcastle:requires-prd` on an owner-filed issue routes it through
PRD-PR → approval → autonomous decompose → sub-issues, all driven by
`main.mts` from pure GitHub state (branch convention
`prd/issue-<N>-<slug>`; no conversation store). The PRD itself is
produced interactively by the scaffolded issue-anchored `/new-prd`
skill, which wraps the owner's grilling skill. Agents create only
derived issues (the decomposer's sub-issues); PRD approval on the PR is
the lane's only human gate.

## Consequences

- The conversational-prd template remains as a parallel path, unchanged.
- The PRD-PR link is a branch-name convention: renaming the branch breaks
  the chain (deliberate — stateless detection beats stored state).
- Decomposition quality is unreviewed by design; the recourse is editing
  the sub-issues, not a second gate.
```

- [ ] **Step 4: README + FORK-MANUAL**

README.md, in the goal-template section: add a short paragraph — the `sandcastle:requires-prd` label routes an issue through the PRD lane (nudge → `/new-prd` skill → approve the PRD PR with `sandcastle:approved` → the loop merges, decomposes into sub-issues, auto-closes the parent when they finish), and `npm run sandcastle:init` now also creates that label.

FORK-MANUAL.md: add the lane to the operator flow where the design/decompose lanes are described — when to use `sandcastle:requires-prd` vs `sandcastle:design`, and that the only commands involved are `/new-prd` (Claude Code) and `npm run sandcastle`.

- [ ] **Step 5: Changeset**

Create `.changeset/prd-label-flow.md` (check `.changeset/` first for a duplicate covering this feature; the package name comes from `package.json#name`):

```markdown
---
"@ai-hero/sandcastle": minor
---

Label-routed PRD lane in the goal template: label an issue
`sandcastle:requires-prd` and the main loop nudges you to run the new
issue-anchored `/new-prd` skill (grills you, opens a PRD PR on
`prd/issue-<N>-<slug>`), merges the PR once you approve it, autonomously
decomposes the PRD into `Sandcastle` sub-issues, and closes the parent
when they all finish. `npm run sandcastle:init` provisions the new label.
```

- [ ] **Step 6: Full verification and commit**

Run: `npm run typecheck && npx vitest run`
Expected: everything PASSES.

```bash
git add prd/008-prd-label-flow.md docs/agents/triage.md docs/adr/0023-label-routed-prd-flow.md README.md FORK-MANUAL.md .changeset/prd-label-flow.md
git commit -m "docs: triage label, ADR 0023, README/FORK-MANUAL, changeset for the PRD lane

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: README-FORK entry (separate commit, per fork workflow)

**Files:**

- Modify: `README-FORK.md` (new section at the TOP)

- [ ] **Step 1: Add the section**

At the very top of the section list in `README-FORK.md` (above the current newest entry), following the established format:

```markdown
## Label-routed PRD flow: /new-prd skill + single orchestrator (`feat/prd-label-flow`)

Implements prd/008 (decision record: ADR 0023). Motivation: the owner
files every entry-point issue and runs exactly one orchestration command —
no more design/decompose scripts for the common case; grilling moves into
the owner's own Claude Code session.

**What was added**

- Goal-template PRD lane: `sandcastle:requires-prd` issues are classified
  from pure GitHub state each `npm run sandcastle` run — nudge (no PRD PR),
  awaiting-review, merge-on-`sandcastle:approved`, autonomous decompose
  into `Sandcastle` sub-issues (agent-created, sub-issue-API-linked, the
  parent is the owner's issue), and close-once parent auto-close when all
  sub-issues finish. Parents are excluded from direct implementation.
- PR ↔ issue linkage is the branch name `prd/issue-<N>-<slug>` — stateless
  detection, no conversation store; the PR body says "PRD for #N", never
  `Closes`.
- Issue-anchored `/new-prd` skill (scaffolded by init for the goal
  template): picker over requires-prd issues, de-escalation offer,
  grill-me wrapping with install offer, PRD on the convention branch,
  PR + hand-off guidance, feedback mode against the open PR.
- The conversational-prd scripts are untouched — this is a parallel path.
```

- [ ] **Step 2: Commit (docs-only, separate from feature commits)**

```bash
git add README-FORK.md
git commit -m "docs(fork): record label-routed PRD flow (feat/prd-label-flow)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `npm run typecheck` — clean.
- [ ] `npx vitest run` — full suite green.
- [ ] `git log --oneline main..feat/prd-label-flow` — feature commits + two docs commits, README-FORK last.
- [ ] Merge to `main` per the fork workflow (fast-forward or merge commit, matching recent history).
