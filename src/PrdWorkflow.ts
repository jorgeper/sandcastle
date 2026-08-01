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

If a \`/grilling\` or \`/grill-me\` skill is available, invoke it on the idea.

If neither is available, tell the user those skills come from Matt Pocock's
skills collection (https://github.com/mattpocock/skills) and offer to
install it for them. If they say yes, run:

    claude plugin marketplace add mattpocock/skills
    claude plugin install mattpocock-skills@mattpocock

Newly installed plugin skills may not be visible until the next session, so
after installing — or if the user declines — conduct the interview yourself
this time: interview the user relentlessly about every aspect of the idea
until you reach shared understanding. Walk down each branch of the decision
tree, resolving dependencies between decisions one-by-one. Ask questions ONE
AT A TIME, each with your recommended answer. Look up facts in the repo
yourself; only decisions go to the user. Do not write the PRD until the user
confirms shared understanding.

## 2. Write the PRD

- Find the next free number: list \`prd/\`, take the highest NNN prefix + 1
  (three digits, zero-padded; first PRD is 001).
- Write \`prd/NNN-<kebab-case-slug>.md\` following the section structure of
  \`prd/TEMPLATE.md\`. Fill every section — an empty Non-goals section means
  you have not grilled hard enough.

## 3. Commit

Commit the new file:
\`git add prd/NNN-<slug>.md && git commit -m "docs: add PRD NNN — <title>"\`

Then tell the user the next step is \`/decompose-prd prd/NNN-<slug>.md\`.
`;

export const DECOMPOSE_PRD_SKILL = `---
name: decompose-prd
description: Turn a committed PRD into a parent GitHub issue plus Sandcastle-labeled sub-issues. Use when the user wants to create implementation issues from a PRD file.
---

# Decompose PRD

Input: the path to a PRD file (e.g. \`prd/001-my-feature.md\`). If no path was
given, list \`prd/\` and ask which one.

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

Resolve the repo slug once: \`gh repo view --json nameWithOwner -q .nameWithOwner\`.

1. Create the parent — the parent is **never labeled** \`Sandcastle\`; the
   label on children is the release gate that lets the orchestrator pick
   work up:
   \`gh issue create --title "<feature title>" --body "<summary + PRD link>"\`
   Note its number PARENT_NUM.
2. Create each child in dependency order, so earlier siblings' numbers can be
   referenced in \`Blocked by\` lines:

   \`\`\`
   gh issue create --title "<child title>" --label Sandcastle --body "**Parent:** #PARENT_NUM
   **PRD:** prd/NNN-<slug>.md

   ## Acceptance criteria

   - <criterion>

   Blocked by #<earlier sibling number>"
   \`\`\`

   Omit the \`Blocked by\` line for unblocked children. The \`**Parent:**\` and
   \`**PRD:**\` lines are load-bearing: downstream agents read them.
3. Link each child as a GitHub sub-issue of the parent. The endpoint takes the
   child's database id, not its number:

   \`\`\`
   CHILD_ID=$(gh api repos/<owner>/<repo>/issues/<child number> --jq .id)
   gh api repos/<owner>/<repo>/issues/PARENT_NUM/sub_issues -F sub_issue_id="$CHILD_ID"
   \`\`\`

If the user asked to hold the release during approval, create children
WITHOUT \`--label Sandcastle\`; they release later by adding the label in
GitHub (per child, in waves if they like).

## 3. Report

Show the created tree (parent #, children #s with their blockers) and remind
the user that labeled children will be picked up by the next
\`npm run sandcastle\` run.
`;

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
picks it up. Confirm the issue still carries the \`Sandcastle\` label after
de-escalation (removing \`sandcastle:requires-prd\` alone does not queue
it); if missing, tell the user to add it.

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

const ISSUE_ANCHORED_FILES: readonly ScaffoldFile[] = [
  { relativePath: join("prd", "TEMPLATE.md"), content: PRD_TEMPLATE },
  {
    relativePath: join(".claude", "skills", "new-prd", "SKILL.md"),
    content: NEW_PRD_ISSUE_SKILL,
  },
];

/**
 * Private helper to write scaffold files to the repo. Never overwrites: a file
 * that already exists is left untouched.
 */
const scaffoldFiles = (
  repoDir: string,
  files: readonly ScaffoldFile[],
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const file of files) {
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

/**
 * Write the PRD workflow files into the user's repo. Never overwrites: a file
 * that already exists is left untouched, so re-running init (or a user who
 * customized a skill) loses nothing.
 */
export const scaffoldPrdWorkflow = (
  repoDir: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  scaffoldFiles(repoDir, FILES);

/**
 * Issue-anchored variant (prd/008) for the goal template: /new-prd targets
 * an existing `sandcastle:requires-prd` issue and opens a PRD PR; there is
 * no decompose-prd skill because the orchestrator decomposes. Same
 * never-overwrite contract as scaffoldPrdWorkflow.
 */
export const scaffoldIssueAnchoredPrdWorkflow = (
  repoDir: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  scaffoldFiles(repoDir, ISSUE_ANCHORED_FILES);
