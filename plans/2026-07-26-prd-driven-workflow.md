# PRD-Driven Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the PRD-driven workflow (PRD 001, `prd/001-prd-driven-workflow.md`) in the `parallel-planner-with-review` template: `sandcastle init` scaffolds a `prd/` template plus `/new-prd` and `/decompose-prd` project skills, and the template prompts learn the `**PRD:**` / `**Parent:**` issue-body conventions.

**Architecture:** A new `src/PrdWorkflow.ts` module holds the scaffolded file contents as string constants and a `scaffoldPrdWorkflow()` Effect (same pattern as the Dockerfile constants and `SETUP_ISSUE_TRACKER.md` in `InitService.ts` — the template copier is a flat, non-recursive copy into `.sandcastle/`, so files destined for repo root like `.claude/skills/**` cannot ship as template files). `InitService.scaffold()` calls it, gated on template + tracker + label. Two template prompt files get conditional wording for the new conventions.

**Tech Stack:** TypeScript, Effect (`@effect/platform` FileSystem), vitest, changesets.

## Global Constraints

- No changes to any template `main.mts` — the orchestrator contract stays "open issues labeled `Sandcastle`" (PRD 001 goal).
- The parent issue is never labeled `Sandcastle` (PRD 001 invariant); the skills' text must preserve this.
- Upstream `grilling`/`grill-me` skills are not modified or vendored; `/new-prd` references `/grilling` if present and inlines equivalent interview instructions otherwise.
- Scaffolded skill/prd files must never overwrite existing files in the user's repo.
- Repo conventions (CLAUDE.md): run `npm run typecheck` for type checks; add a `.changeset/` entry for user-facing changes (`minor` for new features, package name `@ai-hero/sandcastle`); update `README.md` when public-facing behavior changes.
- Template prompt files may only use the `{{KEY}}` placeholders that already exist (`VIEW_TASK_COMMAND`, `COMMENT_TASK_COMMAND`, `CLOSE_TASK_COMMAND`, …) — they are substituted per issue tracker by `substituteTemplateArgs`.
- Prompt wording about `**PRD:**` / `**Parent:**` lines must be conditional ("if present") — the same prompts serve beads/custom trackers and repos that never used `/decompose-prd`.

---

### Task 1: `src/PrdWorkflow.ts` — contents + scaffold function

**Files:**

- Create: `src/PrdWorkflow.ts`
- Test: `src/PrdWorkflow.test.ts`

**Interfaces:**

- Produces: `scaffoldPrdWorkflow(repoDir: string): Effect.Effect<void, Error, FileSystem.FileSystem>` — writes `prd/TEMPLATE.md`, `.claude/skills/new-prd/SKILL.md`, `.claude/skills/decompose-prd/SKILL.md` under `repoDir`, creating directories as needed, skipping any file that already exists. Also exports `PRD_TEMPLATE`, `NEW_PRD_SKILL`, `DECOMPOSE_PRD_SKILL` string constants (exported for tests).

- [ ] **Step 1: Write the failing tests**

Create `src/PrdWorkflow.test.ts`:

```ts
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaffoldPrdWorkflow } from "./PrdWorkflow.js";

const makeDir = () => mkdtemp(join(tmpdir(), "prd-workflow-"));

const run = (repoDir: string) =>
  Effect.runPromise(
    scaffoldPrdWorkflow(repoDir).pipe(Effect.provide(NodeFileSystem.layer)),
  );

describe("scaffoldPrdWorkflow", () => {
  it("writes the PRD template and both project skills", async () => {
    const dir = await makeDir();
    await run(dir);

    const template = await readFile(join(dir, "prd", "TEMPLATE.md"), "utf-8");
    expect(template).toContain("## Problem");
    expect(template).toContain("## Non-goals");

    const newPrd = await readFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "utf-8",
    );
    expect(newPrd).toContain("name: new-prd");
    expect(newPrd).toContain("prd/TEMPLATE.md");

    const decompose = await readFile(
      join(dir, ".claude", "skills", "decompose-prd", "SKILL.md"),
      "utf-8",
    );
    expect(decompose).toContain("name: decompose-prd");
    // The parent-never-labeled invariant must be stated in the skill.
    expect(decompose).toContain("never labeled");
    // Sub-issue linking uses the REST sub_issues endpoint.
    expect(decompose).toContain("sub_issues");
  });

  it("does not overwrite existing files", async () => {
    const dir = await makeDir();
    await mkdir(join(dir, ".claude", "skills", "new-prd"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "user-customized",
    );
    await run(dir);

    const newPrd = await readFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "utf-8",
    );
    expect(newPrd).toBe("user-customized");
    // The other files are still created.
    const template = await readFile(join(dir, "prd", "TEMPLATE.md"), "utf-8");
    expect(template).toContain("## Problem");
  });

  it("is idempotent — safe to run twice", async () => {
    const dir = await makeDir();
    await run(dir);
    await run(dir);
    const template = await readFile(join(dir, "prd", "TEMPLATE.md"), "utf-8");
    expect(template).toContain("## Problem");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/PrdWorkflow.test.ts`
Expected: FAIL — cannot resolve `./PrdWorkflow.js`.

- [ ] **Step 3: Implement `src/PrdWorkflow.ts`**

Note the file contents are TS template literals: backticks inside the markdown content must be escaped as `` \` ``.

```ts
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname, join } from "node:path";

/**
 * Scaffolded contents for the PRD-driven workflow (see
 * prd/001-prd-driven-workflow.md): a PRD template plus two Claude Code
 * project skills. These live outside .sandcastle/ (repo root prd/ and
 * .claude/skills/), so they cannot ship as template files — the template
 * copier is a flat copy into .sandcastle/. Same pattern as the Dockerfile
 * constants in InitService.
 */

export const PRD_TEMPLATE = `# PRD NNN: <Title>

**Status:** Draft
**Date:** <YYYY-MM-DD>

## Problem

What hurts today, and for whom? Why now?

## Goals

- Observable outcomes this PRD must achieve.

## Non-goals

- Explicitly out of scope. Kill ambiguity here.

## Requirements

Numbered, testable statements. Each becomes acceptance criteria on an issue.

1. ...

## Open questions

- Unresolved decisions. Must be empty (or moved to Non-goals) before decomposing.
`;

export const NEW_PRD_SKILL = `---
name: new-prd
description: Interview the user about a feature idea, then write a numbered PRD under prd/. Use when the user wants to write a PRD, spec out a feature, or start designing something new.
---

# New PRD

Turn a feature idea into a committed PRD through a relentless interview.

## 1. Interview

If a \\\`/grilling\\\` or \\\`/grill-me\\\` skill is available, invoke it on the idea.
Otherwise, do the equivalent yourself: interview the user relentlessly about
every aspect of the idea until you reach shared understanding. Walk down each
branch of the decision tree, resolving dependencies between decisions
one-by-one. Ask questions ONE AT A TIME, each with your recommended answer.
Look up facts in the repo yourself; only decisions go to the user. Do not
write the PRD until the user confirms shared understanding.

## 2. Write the PRD

- Find the next free number: list \\\`prd/\\\`, take the highest NNN prefix + 1
  (three digits, zero-padded; first PRD is 001).
- Write \\\`prd/NNN-<kebab-case-slug>.md\\\` following the section structure of
  \\\`prd/TEMPLATE.md\\\`. Fill every section — an empty Non-goals section means
  you have not grilled hard enough.

## 3. Commit

Commit the new file:
\\\`git add prd/NNN-<slug>.md && git commit -m "docs: add PRD NNN — <title>"\\\`

Then tell the user the next step is \\\`/decompose-prd prd/NNN-<slug>.md\\\`.
`;

export const DECOMPOSE_PRD_SKILL = `---
name: decompose-prd
description: Turn a committed PRD into a parent GitHub issue plus Sandcastle-labeled sub-issues. Use when the user wants to create implementation issues from a PRD file.
---

# Decompose PRD

Input: the path to a PRD file (e.g. \\\`prd/001-my-feature.md\\\`). If no path was
given, list \\\`prd/\\\` and ask which one.

## 1. Propose the breakdown — NO GitHub writes yet

Read the PRD. Propose the full breakdown as text in this session:

- **Parent issue** — title and body. The body links the PRD file and
  summarizes the feature in one paragraph.
- **N ≥ 1 child issues** — for each: title, acceptance criteria (lifted from
  the PRD's Requirements), and dependency edges between siblings. A simple
  feature is a single child — that is normal, not a special case.

Iterate with the user until they EXPLICITLY approve. Creation is the commit
point; nothing touches GitHub before approval.

## 2. Create the issue tree (only after approval)

Resolve the repo slug once: \\\`gh repo view --json nameWithOwner -q .nameWithOwner\\\`.

1. Create the parent — the parent is **never labeled** \\\`Sandcastle\\\`; the
   label on children is the release gate that lets the orchestrator pick
   work up:
   \\\`gh issue create --title "<feature title>" --body "<summary + PRD link>"\\\`
   Note its number PARENT_NUM.
2. Create each child in dependency order, so earlier siblings' numbers can be
   referenced in \\\`Blocked by\\\` lines:

   \\\`\\\`\\\`
   gh issue create --title "<child title>" --label Sandcastle --body "**Parent:** #PARENT_NUM
   **PRD:** prd/NNN-<slug>.md

   ## Acceptance criteria

   - <criterion>

   Blocked by #<earlier sibling number>"
   \\\`\\\`\\\`

   Omit the \\\`Blocked by\\\` line for unblocked children. The \\\`**Parent:**\\\` and
   \\\`**PRD:**\\\` lines are load-bearing: downstream agents read them.
3. Link each child as a GitHub sub-issue of the parent. The endpoint takes the
   child's database id, not its number:

   \\\`\\\`\\\`
   CHILD_ID=$(gh api repos/<owner>/<repo>/issues/<child number> --jq .id)
   gh api repos/<owner>/<repo>/issues/PARENT_NUM/sub_issues -F sub_issue_id="$CHILD_ID"
   \\\`\\\`\\\`

If the user asked to hold the release during approval, create children
WITHOUT \\\`--label Sandcastle\\\`; they release later by adding the label in
GitHub (per child, in waves if they like).

## 3. Report

Show the created tree (parent #, children #s with their blockers) and remind
the user that labeled children will be picked up by the next
\\\`npm run sandcastle\\\` run.
`;

interface ScaffoldFile {
  readonly relativePath: string;
  readonly content: string;
}

const FILES: readonly ScaffoldFile[] = [
  { relativePath: join("prd", "TEMPLATE.md"), content: PRD_TEMPLATE },
  {
    relativePath: join(".claude", "skills", "new-prd", "SKILL.md"),
    content: NEW_PRD_SKILL,
  },
  {
    relativePath: join(".claude", "skills", "decompose-prd", "SKILL.md"),
    content: DECOMPOSE_PRD_SKILL,
  },
];

/**
 * Write the PRD workflow files into the user's repo. Never overwrites: a file
 * that already exists is left untouched, so re-running init (or a user who
 * customized a skill) loses nothing.
 */
export const scaffoldPrdWorkflow = (
  repoDir: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const file of FILES) {
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

Escaping check: the markdown constants contain backticks — in the real file each backtick inside a template literal must be written as `` \` `` (the triple-escaped forms above render as `\`` in the .ts source). There are no `${` sequences in the content except `$(gh api ...)`and`"$CHILD_ID"`, which are safe (`$`not followed by`{`... except verify: `$(` is safe, `"$CHILD_ID"`is safe). After writing,`npm run typecheck` will catch any escaping mistake.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/PrdWorkflow.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/PrdWorkflow.ts src/PrdWorkflow.test.ts
git commit -m "feat: add PrdWorkflow scaffold module (prd/ template + project skills)"
```

---

### Task 2: Wire `scaffoldPrdWorkflow` into `InitService.scaffold()`

**Files:**

- Modify: `src/InitService.ts` (the `scaffold` function, after the `substituteTemplateArgs` call, currently around line 1096)
- Test: `src/InitService.test.ts` (new describe block)

**Interfaces:**

- Consumes: `scaffoldPrdWorkflow(repoDir)` from Task 1.
- Produces: `sandcastle init` with template `parallel-planner-with-review`, tracker `github-issues`, and `createLabel !== false` scaffolds the three workflow files at repo root; any other combination scaffolds none of them.

- [ ] **Step 1: Write the failing tests**

Append to `src/InitService.test.ts` (inside the top-level `describe("InitService scaffold", ...)`, after the existing `parallel-planner-with-review template` block; reuse the existing `makeDir`/`runScaffold` helpers and `getIssueTracker`):

```ts
describe("PRD workflow scaffold", () => {
  const exists = async (path: string) => {
    try {
      await readFile(path, "utf-8");
      return true;
    } catch {
      return false;
    }
  };

  it("scaffolds prd/TEMPLATE.md and both skills for parallel-planner-with-review + github-issues", async () => {
    const dir = await makeDir();
    await runScaffold(dir, { templateName: "parallel-planner-with-review" });

    expect(await exists(join(dir, "prd", "TEMPLATE.md"))).toBe(true);
    const newPrd = await readFile(
      join(dir, ".claude", "skills", "new-prd", "SKILL.md"),
      "utf-8",
    );
    expect(newPrd).toContain("name: new-prd");
    const decompose = await readFile(
      join(dir, ".claude", "skills", "decompose-prd", "SKILL.md"),
      "utf-8",
    );
    expect(decompose).toContain("--label Sandcastle");
  });

  it("does not scaffold for other templates", async () => {
    const dir = await makeDir();
    await runScaffold(dir, { templateName: "simple-loop" });
    expect(await exists(join(dir, "prd", "TEMPLATE.md"))).toBe(false);
    expect(
      await exists(join(dir, ".claude", "skills", "new-prd", "SKILL.md")),
    ).toBe(false);
  });

  it("does not scaffold for non-github issue trackers", async () => {
    const dir = await makeDir();
    await runScaffold(dir, {
      templateName: "parallel-planner-with-review",
      issueTracker: getIssueTracker("beads")!,
    });
    expect(await exists(join(dir, "prd", "TEMPLATE.md"))).toBe(false);
  });

  it("does not scaffold when the user declined the Sandcastle label", async () => {
    const dir = await makeDir();
    await runScaffold(dir, {
      templateName: "parallel-planner-with-review",
      createLabel: false,
    });
    expect(await exists(join(dir, "prd", "TEMPLATE.md"))).toBe(false);
  });
});
```

Rationale for the label gate: `/decompose-prd`'s release mechanism _is_ the `Sandcastle` label; scaffolding it into a repo that stripped the label from its prompts would ship a broken gate.

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `npx vitest run src/InitService.test.ts -t "PRD workflow scaffold"`
Expected: first test FAILS (files not created); the three negative tests may pass vacuously — confirm the positive test is the failing one.

- [ ] **Step 3: Implement the wiring**

In `src/InitService.ts`:

Add the import at the top with the other local imports:

```ts
import { scaffoldPrdWorkflow } from "./PrdWorkflow.js";
```

In `scaffold()`, after the `substituteTemplateArgs` call and the `createLabel` prompt-rewrite block, before the `custom` issue tracker block:

```ts
// PRD-driven workflow (prd/001-prd-driven-workflow.md): scaffold the prd/
// template and the /new-prd + /decompose-prd project skills. GitHub-only
// (sub-issues are a GitHub feature) and label-gated (the Sandcastle label
// is the workflow's release gate).
if (
  templateName === "parallel-planner-with-review" &&
  issueTracker.name === "github-issues" &&
  createLabel
) {
  yield * scaffoldPrdWorkflow(repoDir);
}
```

- [ ] **Step 4: Run the full test file**

Run: `npx vitest run src/InitService.test.ts`
Expected: all pass (including all pre-existing tests — the new files land outside `.sandcastle/`, so no existing assertion about scaffold output should break; if one does, read it and adjust only if it asserts an exhaustive file list).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/InitService.ts src/InitService.test.ts
git commit -m "feat: scaffold PRD workflow files from init for parallel-planner-with-review"
```

---

### Task 3: Teach `implement-prompt.md` the `**PRD:**` / `**Parent:**` convention

**Files:**

- Modify: `src/templates/parallel-planner-with-review/implement-prompt.md:5`
- Modify: `src/templates/parallel-planner/implement-prompt.md` (same line — check it first; apply only if it has the same "parent PRD" sentence)
- Test: existing suite (template content is exercised by scaffold tests)

**Interfaces:**

- Consumes: issue bodies created by `/decompose-prd` (Task 1's format).
- Produces: deterministic PRD discovery for implementer agents.

- [ ] **Step 1: Check for existing assertions on the old wording**

Run: `grep -rn "parent PRD" src/`
Expected: hits in the two template `implement-prompt.md` files; if any test file asserts the old sentence, note it for step 3.

- [ ] **Step 2: Edit the prompt(s)**

In `src/templates/parallel-planner-with-review/implement-prompt.md`, replace line 5:

```
Pull in the issue using `{{VIEW_TASK_COMMAND}}`. If it has a parent PRD, pull that in too.
```

with:

```
Pull in the issue using `{{VIEW_TASK_COMMAND}}`. If the issue body has a `**PRD:**` line, read that file from the repo — it is the product spec for this work. If it has a `**Parent:** #<ID>` line, view the parent issue too for feature-level context.
```

Apply the identical replacement in `src/templates/parallel-planner/implement-prompt.md` if step 1 found the same sentence there. Update any test assertions found in step 1.

- [ ] **Step 3: Run tests and commit**

```bash
npm run typecheck && npm run test
git add src/templates
git commit -m "feat(templates): deterministic PRD discovery via **PRD:** body line in implement prompt"
```

---

### Task 4: Teach `merge-prompt.md` to close finished parents

**Files:**

- Modify: `src/templates/parallel-planner-with-review/merge-prompt.md` (after the `{{CLOSE_TASK_COMMAND}}` step in `# CLOSE ISSUES`)
- Modify: `src/templates/parallel-planner/merge-prompt.md` (same section — check for the same structure first)
- Test: existing suite

**Interfaces:**

- Consumes: `**Parent:** #<ID>` lines in child issue bodies (Task 1's format).
- Produces: parents auto-close when their last child closes; PRD 001 deliverable 5.

- [ ] **Step 1: Edit the prompt(s)**

In `src/templates/parallel-planner-with-review/merge-prompt.md`, after the paragraph ending with:

```
`{{CLOSE_TASK_COMMAND}}`
```

insert:

```
# CLOSE FINISHED PARENTS

After closing an issue, check its body for a `**Parent:** #<ID>` line. If present, view that parent with `{{VIEW_TASK_COMMAND}}`. If every one of the parent's sub-issues is now closed, close the parent too using `{{CLOSE_TASK_COMMAND}}`, with a comment noting that all sub-issues are complete. If the issue has no `**Parent:**` line, skip this step.
```

Mirror in `src/templates/parallel-planner/merge-prompt.md` if its `# CLOSE ISSUES` section has the same structure.

- [ ] **Step 2: Run tests and commit**

```bash
npm run typecheck && npm run test
git add src/templates
git commit -m "feat(templates): merger closes parent issue when all sub-issues are closed"
```

---

### Task 5: Changeset + README

**Files:**

- Create: `.changeset/prd-driven-workflow.md`
- Modify: `README.md` (the `parallel-planner-with-review` template section — locate with `grep -n "parallel-planner-with-review" README.md`)

- [ ] **Step 1: Check for duplicate changesets**

Run: `ls .changeset/*.md | xargs grep -l "prd" -i` — expect no existing changeset covering this; if one exists, edit it instead of creating a new one.

- [ ] **Step 2: Write the changeset**

Create `.changeset/prd-driven-workflow.md`:

```md
---
"@ai-hero/sandcastle": minor
---

`parallel-planner-with-review` + GitHub Issues now scaffolds a PRD-driven workflow: a `prd/TEMPLATE.md`, and `/new-prd` + `/decompose-prd` Claude Code project skills that take a feature from grilled PRD to a parent issue with Sandcastle-labeled, dependency-ordered sub-issues. The implement prompt reads the PRD via a `**PRD:**` body line, and the merger closes a parent once all its sub-issues are closed.
```

- [ ] **Step 3: Update README**

In the `parallel-planner-with-review` section of `README.md`, append a short subsection (match the surrounding heading level):

```md
#### PRD-driven workflow (GitHub Issues only)

With the GitHub Issues tracker, init also scaffolds `prd/TEMPLATE.md` and two Claude Code project skills:

- `/new-prd` — interviews you about a feature idea (via your `/grilling` skill when installed), then writes `prd/NNN-slug.md` and commits it.
- `/decompose-prd prd/NNN-slug.md` — proposes a breakdown in-session for your approval, then creates one parent issue (never labeled) plus N ≥ 1 sub-issues labeled `Sandcastle` with acceptance criteria, `Blocked by` edges, and `**Parent:** / **PRD:**` body lines. The label on children is the release gate; the planner stages dependent issues across merge rounds automatically.

Existing files are never overwritten, and nothing is scaffolded if you decline the `Sandcastle` label. See `prd/001-prd-driven-workflow.md` in this repo for the design.
```

- [ ] **Step 4: Final verification and commit**

```bash
npm run typecheck && npm run test
git add .changeset/prd-driven-workflow.md README.md
git commit -m "docs: changeset + README for PRD-driven workflow scaffold"
```

---

## Self-review notes

- **Spec coverage:** PRD 001 deliverable 1 (prd/ convention + template) → Tasks 1–2; deliverables 2–3 (skills) → Tasks 1–2; deliverable 4 (implement prompt) → Task 3; deliverable 5 (merge prompt) → Task 4. Changeset/README are repo-convention obligations (CLAUDE.md).
- **Deviation from PRD 001 worth knowing:** the PRD's deliverables table said "template scaffold" for the skills; the actual mechanism is an InitService-driven scaffold module because the template copier is flat and `.sandcastle/`-scoped. Same user-visible outcome.
- **Scope choice:** skills are scaffolded only for `parallel-planner-with-review` (the PRD's stated target), not `parallel-planner` — but Tasks 3–4 apply the _prompt_ wording to both planner templates when the wording matches, since those edits are conditional and harmless without the skills.
