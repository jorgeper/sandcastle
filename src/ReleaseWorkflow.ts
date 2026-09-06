import { join } from "node:path";
import type { Effect } from "effect";
import type { FileSystem } from "@effect/platform";
import { scaffoldFiles } from "./PrdWorkflow.js";

/**
 * Release workflow scaffolding for the goal template (prd/009).
 *
 * Two Claude Code project skills that live in the user's repo (under
 * .claude/skills/), so — like the PRD skills — they cannot ship as template
 * files and are written by `sandcastle init` instead:
 *
 * - /new-release interviews the owner and files a `sandcastle:release`
 *   issue in the body contract parsed by the template's release-lane.mts.
 * - /cut-release executes a filed issue in the owner's session: preflight
 *   via release-lane.mts, then a phased runbook whose repo-specific facts
 *   (version bump, workflows, assets) sit in one "Repo facts" block the
 *   owner fills in once. TODO(sandcastle) sentinels stop the cut until
 *   they are filled — never a guessed release mechanic.
 *
 * The orchestrator never cuts; it only reports release issues (nudges, not
 * gates). Publishing the draft stays the human's act.
 */

export const NEW_RELEASE_SKILL = `---
name: new-release
description: Interview the owner for a release — version, optional targets, optional highlights — draft the changelog for their approval, then file the sandcastle:release issue. Use when the owner wants to cut a release or file a release request; this is the only supported way to file one.
---

# New release (interview → approved changelog → filed issue)

File a \`sandcastle:release\` issue in the machine-parseable contract
parsed (and documented) by \`parseReleaseIssueBody\` in
\`.sandcastle/release-lane.mts\`.

This skill is the **only supported way** to file a release issue.
Hand-authored bodies are unsupported (\`/cut-release\` preflight still
refuses malformed ones, but that is a guard, not a workflow). And the
skill **never starts the cut**: it ends at the filed issue's URL —
never run any release mechanics; the owner drives the cut by invoking
\`/cut-release <issue#>\`.

## 1. Fetch release state

From the repo root:

    git fetch origin --tags
    gh api 'repos/{owner}/{repo}/tags?per_page=100' > /tmp/new-release-tags.json

Tell the owner the newest existing release tag (step 2's one-liner
prints it) so they can pick the next version with the ground truth in
front of them.

## 2. Interview, then validate

Ask one question at a time. The owner drives — **never invent a
version**; you may state what the newest tag is, but the owner names
the version. Collect:

- **Version** — bare strict semver \`MAJOR.MINOR.PATCH\` with an optional
  pre-release id (e.g. \`1.4.0-beta.2\`). The pre-release id is never
  stripped; no leading \`v\` (the tag adds it); no build metadata.
- **Targets** — optional, comma-separated names of what the cut
  produces (platforms, packages, artifacts). If the "Repo facts" block in
  \`.claude/skills/cut-release/SKILL.md\` names targets, offer exactly
  those; otherwise leave the line empty.
- **Mode** — \`cut\` (default; tag \`v<version>\` is created) or \`append\`
  (tag \`v<version>\` already exists and the cut only adds artifacts for
  the named targets to that release). Ask only when the owner's version
  already has a tag; \`append\` requires at least one target.
- **Highlights** — optional: anything the owner wants emphasized in the
  changelog entry.

Validate with the lane's own rules — invoke them, never re-implement
them (a version accepted here must never later classify \`malformed\` or
\`out-of-order\` in preflight). From the repo root:

    V="<version>" T="<targets>" M="<mode>" npx tsx -e '
    import { readFileSync } from "node:fs";
    import {
      compareVersions, newestReleaseTag, parseReleaseIssueBody, parseTagNames,
    } from "./.sandcastle/release-lane.mts";
    const { V = "", T = "", M = "cut" } = process.env;
    const probe = \`**Version:** \${V}\\n**Targets:** \${T}\\n**Mode:** \${M}\\n\\n## Changelog\\n\\n- probe\\n\`;
    const parsed = parseReleaseIssueBody(probe);
    if (!parsed.ok) {
      console.log("REJECT:");
      for (const p of parsed.problems) console.log(\`- \${p}\`);
      process.exit(1);
    }
    const tags = parseTagNames(readFileSync("/tmp/new-release-tags.json", "utf8"));
    const newest = newestReleaseTag(tags);
    console.log(\`newest existing tag: \${newest ?? "(none)"}\`);
    if (M === "append" && tags.includes(\`v\${V}\`)) {
      console.log(\`OK: append — tag v\${V} exists, adding \${T} to its release\`);
      process.exit(0);
    }
    if (newest !== null && compareVersions(V, newest) <= 0) {
      console.log(\`REJECT: \${V} is not newer than \${newest} (prerelease-aware compare)\`);
      process.exit(1);
    }
    console.log("OK: full cut");
    '

This mirrors \`classifyReleaseIssue\` exactly, including its one ordering
exception: an \`append\` request whose tag \`vX.Y.Z\` already exists is
valid. A \`cut\` gets no such exception; the version must be strictly
newer than the newest tag. On \`REJECT\`, show the owner the printed
problems and re-ask; **never file a version that did not print \`OK\`**.

## 3. Draft the changelog, get explicit approval

Gather what shipped since the last release (agent lanes land work as
direct commits as often as PRs, so commits are a first-class source):

    git log <newest-tag>..origin/<default-branch> --oneline
    git log -1 --format=%cs <newest-tag>        # the tag date, for the issue filter
    gh issue list --state closed --search "closed:><tag-date>" --json number,title

(If no release tag exists yet, draft from the full history.) Write the
entry as user-facing markdown bullets — what changed for a user, not a
commit-log paste — folding in the owner's highlights.

Present the draft to the owner for edit/approval and loop on their
edits. **Do not continue to filing until the owner explicitly approves
the text.** The approved text is carried forward verbatim — no
reflowing, no touch-ups after approval.

## 4. Ensure the label, then file

The \`sandcastle:release\` label is provisioned by \`npm run sandcastle:init\`
(\`RELEASE_LABEL\` in \`.sandcastle/github.mts\`); if it is missing, create
it to match:

    gh label list --json name --jq '.[].name' | grep -qx 'sandcastle:release' ||
      gh label create 'sandcastle:release' --color '006B75' \\
        --description 'Release request — filed by /new-release, cut via /cut-release'

The issue body is exactly this template with the placeholders
substituted — nothing added, nothing reordered (\`{{TARGETS}}\` may be
empty; \`{{MODE}}\` is \`cut\` or \`append\`). A unit test in the sandcastle
package holds this fenced block to \`parseReleaseIssueBody\`; edit them
together.

\`\`\`release-issue-body
**Version:** {{VERSION}}
**Targets:** {{TARGETS}}
**Mode:** {{MODE}}

## Changelog

{{CHANGELOG}}
\`\`\`

Write the substituted body to a file (\`{{CHANGELOG}}\` is the approved
entry, verbatim) and re-run the parser on the real thing as a last-mile
check:

    B=/tmp/new-release-body.md npx tsx -e '
    import { readFileSync } from "node:fs";
    import { parseReleaseIssueBody } from "./.sandcastle/release-lane.mts";
    const r = parseReleaseIssueBody(readFileSync(process.env.B ?? "", "utf8"));
    if (!r.ok) { for (const p of r.problems) console.log(\`- \${p}\`); process.exit(1); }
    console.log("body parses ok");
    '

Then file it with the \`sandcastle:release\` label and **not** the plain
\`sandcastle\` label — the two are disjoint so the implement lane never
sees release issues:

    gh issue create --title "Release v<version>" \\
      --label 'sandcastle:release' --body-file /tmp/new-release-body.md

## 5. Stop

Report the issue URL to the owner and stop. The cut itself is
\`/cut-release <issue#>\`, invoked by the owner when they are ready —
this skill never runs it.
`;

export const CUT_RELEASE_SKILL = `---
name: cut-release
description: Execute a filed sandcastle:release issue in this session — preflight, release branch, gate, pre-tag CI, tag, draft verification, appended artifacts — stopping before publish. Use when the owner asks to cut a release for an issue filed by /new-release (e.g. /cut-release 68).
---

# Cut a release (from a filed \`sandcastle:release\` issue)

Execute the cut for release issue \`#<n>\` (the invocation argument) in
this interactive session. \`/new-release\` files the issue; this skill
cuts it; publishing the draft stays the owner's manual act. The issue is
the running log — every phase lands as exactly one marker comment, so a
re-invocation resumes instead of redoing.

Long waits (the full gate, CI watches) are normal here: run them as
background tasks and pick the cut back up when they complete — this
session persists. Never declare a phase done without its evidence.

## Repo facts (fill in once, before the first cut)

Everything below that is specific to this repository lives in this one
block. \`sandcastle init\` cannot detect these; the owner fills them in
(or asks you to, from the repo's existing release scripts and
workflows). **If any line still reads \`TODO(sandcastle)\`, stop before
Phase 0 and ask the owner for it** — never guess a release mechanic.

\`\`\`release-facts
Version bump command:   TODO(sandcastle)   # e.g. \`npm version <version> --no-git-tag-version\` — must leave the bump committed or uncommitted-but-staged; say which
Changelog file:         CHANGELOG.md       # created on the first cut if missing
Extra pre-gate steps:   none               # e.g. regenerate licenses, lockfile checks — one per line, in order
Gate:                   VERIFY_COMMANDS    # the full list from .sandcastle/config.mts, or an explicit command
Pre-tag CI workflow:    none               # workflow file triggered by release/* branch pushes, or \`none\`
Tag release workflow:   none               # workflow file triggered by v* tags that builds the draft release, or \`none\` (the cut then creates the draft itself)
Expected draft assets:  TODO(sandcastle)   # exact asset names/patterns the draft must carry, or \`none\` if the draft has no assets
Append workflows:       none               # per target: \`<target>: <workflow file> -f <input>=v<version>\`, or \`none\`
Tag message:            TODO(sandcastle)   # e.g. \`<Project> <version>\`
Targets:                none               # the names /new-release may offer, comma-separated, or \`none\`
\`\`\`

## 1. Preflight — classify from reality

From the repo root (requires \`gh\` authenticated and a clean
\`git status\`; stop and tell the owner if either fails). Classification
and marker strings come from \`release-lane.mts\` — invoke it, never
re-implement or retype its rules; unit tests hold that module to the
contract:

    ISSUE=<n> npx tsx -e '
    import * as github from "./.sandcastle/github.mts";
    import * as lane from "./.sandcastle/release-lane.mts";
    const main = async () => {
      const n = Number(process.env.ISSUE);
      const view = JSON.parse(
        await github.gh(["issue", "view", String(n), "--json", "body,state,labels"]),
      );
      if (view.state !== "OPEN") throw new Error(\`issue #\${n} is \${view.state}\`);
      if (!view.labels.some((l: { name: string }) => l.name === github.RELEASE_LABEL))
        throw new Error(\`issue #\${n} is not labeled \${github.RELEASE_LABEL}\`);
      const repo = await github.repoSlug();
      const tagNames = lane.parseTagNames(await github.tagsJson(repo));
      const draftTags = lane.parseDraftTags(await github.releaseListJson());
      const commentsJson = await github.issueCommentsJson(n);
      const cutFailedActive = lane.releaseOutcome(commentsJson).level === "failed";
      const blockedByBug = lane.parseBlockedBy(commentsJson);
      let blockingBugOpen: boolean | null = null;
      if (cutFailedActive && blockedByBug !== null) {
        try {
          blockingBugOpen = (await github.issueState(blockedByBug)).trim() === "OPEN";
        } catch {
          blockingBugOpen = null; // unknown state parks (fail safe)
        }
      }
      const action = lane.classifyReleaseIssue({
        body: view.body,
        tagNames,
        draftTags,
        draftReportPosted: lane.parseMarkerPresent(commentsJson, lane.DRAFT_REPORT_MARKER),
        awaitingPublishPosted: lane.parseMarkerPresent(commentsJson, lane.AWAITING_PUBLISH_MARKER),
        tagPushedPosted: lane.parseMarkerPresent(commentsJson, lane.TAG_PUSHED_MARKER),
        cutFailedActive,
        blockedByBug,
        blockingBugOpen,
      });
      console.log(JSON.stringify({
        repo,
        action,
        markers: {
          PREFLIGHT_ACK: lane.PREFLIGHT_ACK_MARKER,
          GATE_PASSED: lane.GATE_PASSED_MARKER,
          PRETAG_CI_GREEN: lane.PRETAG_CI_GREEN_MARKER,
          TAG_PUSHED: lane.TAG_PUSHED_MARKER,
          CI_GREEN: lane.CI_GREEN_MARKER,
          DRAFT_VERIFIED: lane.DRAFT_VERIFIED_MARKER,
          ARTIFACTS_APPENDED: lane.ARTIFACTS_APPENDED_MARKER,
          AWAITING_PUBLISH: lane.AWAITING_PUBLISH_MARKER,
          CUT_FAILED: lane.CUT_FAILED_MARKER,
          MALFORMED: lane.MALFORMED_MARKER,
          OUT_OF_ORDER: lane.OUT_OF_ORDER_MARKER,
          DRAFT_REPORT: lane.DRAFT_REPORT_MARKER,
        },
      }, null, 2));
    };
    main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
    '

(\`tsx -e\` evaluates as CJS — the \`main()\` wrapper is required because
top-level \`await\` is unavailable there.)

Act on \`action.kind\` (all phase comments below MUST begin with the
exact marker string from this output — never retype one from memory;
every comment you post starts with the attribution marker convention of
this repo, \`**[releaser · claude-code · <model>]**\`, on the line after
the phase marker):

- \`malformed\` → post \`buildMalformedComment(action.problems)\` via a tsx
  one-liner **unless** a \`MALFORMED\`-marker comment already exists, show
  the owner the problems, and STOP (re-file via \`/new-release\`).
- \`out-of-order\` → same pattern with
  \`buildOutOfOrderComment(action.version, action.newestTag)\` and the
  \`OUT_OF_ORDER\` marker; STOP.
- \`parked\` → the last cut failed and its bug (\`action.bug\`) is still
  open (or unreadable). Tell the owner the cut is blocked on that bug —
  fixes flow through the normal \`npm run sandcastle\` implement lane —
  and STOP. Re-invoke \`/cut-release\` after it closes.
- \`awaiting-publish\` → the cut is complete; only the human publish
  remains. Print the draft URL from the issue thread and STOP.
- \`drafts-to-report\` → post \`buildDraftReport(action.drafts)\` (it starts
  with the \`DRAFT_REPORT\` marker) on the issue — abandoned drafts are
  reported once, never deleted — then continue as \`proceed\`.
- \`proceed\` / \`append\` → cut. \`action.spec\` carries \`version\`,
  \`targets\`, \`mode\`, and the approved \`changelog\` entry verbatim;
  \`append\` means tag \`v<version>\` already exists and phases 1–4 are
  skipped (see phase 5).

## 2. Resume from actual state (idempotency)

Run \`gh issue view <n> --comments\` and find the first phase below whose
marker comment is missing. Trust markers only after cross-checking
reality: does \`release/v<version>\` exist on the remote, does a green
pre-tag CI run exist for the branch tip SHA, does tag \`v<version>\`
exist, does the release workflow run / draft release exist? A completed
phase is never redone and its comment never re-posted; a phase whose
marker exists but whose work is missing in reality is redone (without
duplicating the comment).

If the newest phase marker is \`CUT_FAILED\` (and preflight said
\`proceed\`, i.e. the blocking bug closed): tag absent → the failure was
pre-tag; start a fresh attempt (re-cut the branch in phase 1,
force-push in phase 2a) and post each phase's comment again — markers
older than that cut-failed comment belong to the failed attempt. Tag
present → never re-cut or force-push; retry only the failed step (a
failed workflow run via \`gh run rerun <id> --failed\`, a failed append via
re-running phase 5's dispatch).

## Phase 0 — preflight acknowledged

Unless present, post one comment starting with the \`PREFLIGHT_ACK\`
marker confirming version, targets, and mode.

## Phase 1 — release branch and mechanics

    git fetch origin <default-branch>
    git checkout -B release/v<version> origin/<default-branch>

Then, in order, each step gated on the previous succeeding:

1. The **version bump command** from Repo facts; commit the result if
   the command does not commit itself.
2. Changelog: prepend \`action.spec.changelog\` — **verbatim, unedited** —
   to the top of the **changelog file** (create it on the first cut)
   under a \`## v<version>\` heading, above earlier sections. Commit it.
3. Each **extra pre-gate step** from Repo facts, in order; commit any
   generated files only if changed.
4. The **gate**: every command in \`VERIFY_COMMANDS\` (\`.sandcastle/config.mts\`)
   — or the explicit gate command from Repo facts — must exit 0. Run it
   in the background and wait for it; do not touch the tree while it runs.

On success post one comment starting with the \`GATE_PASSED\` marker,
quoting the gate's final output line(s) as evidence.

**Failure flow** — for any failing step here, in the pre-tag CI (2a),
the tag run (3), or an append run (5): unless the newest \`CUT_FAILED\`
comment already links an open bug for this same failure, file one
\`sandcastle\`-labeled bug titled \`Release cut failed: <failing step or
test>\` whose body holds what failed, the CI run URL if any, the tail of
the failing output, and the line \`Blocks release #<n>.\` Then post one
comment starting with the \`CUT_FAILED\` marker naming the failing step
and its output tail, with \`Blocked-by: #<bug>\` on its own line, and
STOP — tell the owner the fix flows through \`npm run sandcastle\` and to
re-invoke \`/cut-release <n>\` once the bug closes. (If filing failed,
post the comment without the Blocked-by line and say so.) A failure in
phase 1 or 2a has pushed no tag and touched neither the default branch
nor any release: the version stays reusable and the retry re-cuts it.
Never tag, merge back, or push anything further after a failure.

## Phase 2a — push the branch, watch the pre-tag CI

Push the branch only — no tag yet:

    git push -u origin release/v<version>

(On a retry after a pre-tag failure the branch already exists: push
\`--force-with-lease\` instead. Updating a not-yet-tagged release branch
is sanctioned; deleting one never is.) If Repo facts name a **pre-tag
CI workflow**, the push triggers it: find the run matching
\`git rev-parse HEAD\` (allow ~1 minute; no run after ~5 minutes of
polling is itself a cut failure), watch it to completion in the
background. Failure → the failure flow. Success → post one comment
starting with the \`PRETAG_CI_GREEN\` marker plus the run URL. If the
workflow is \`none\`, post the same marker noting that the local gate is
the only pre-tag check in this repo.

## Phase 2b — tag + merge back, only on green

1. \`git tag -a v<version> -m "<tag message>"\` on the release branch
   tip, then \`git push origin v<version>\`.
2. Merge back so the default branch carries the shipped version files
   and changelog:

       git checkout -b mergeback-v<version> origin/<default-branch>
       git merge --no-edit release/v<version>
       git push origin HEAD:<default-branch>

   (If the default branch moved, fetch, merge it in, retry. On resume,
   skip when \`git merge-base --is-ancestor release/v<version>
   origin/<default-branch>\` holds.) \`release/*\` branches are permanent —
   never delete one; the orchestrator's merge paths exempt them too.

Post one comment starting with the \`TAG_PUSHED\` marker noting branch,
tag, and merge-back.

## Phase 3 — watch the release workflow

If Repo facts name a **tag release workflow**, watch the tag-triggered
run to completion (background task). Failure → the failure flow (a
draft-only pipeline means nothing published). Success → post one
comment starting with the \`CI_GREEN\` marker plus the run URL.

If it is \`none\`, create the draft yourself and post the same marker
saying so:

    gh release create v<version> --draft --title "v<version>" --notes-file <changelog-entry-file>

## Phase 4 — verify the draft

1. \`gh release view v<version> --json assets,url,isDraft\` — \`isDraft\`
   is true and the assets are exactly the **expected draft assets**
   from Repo facts (or none).
2. If the assets include a checksum file, \`gh release download
   v<version> -D <tmpdir>\` and verify every line checks out there.
3. Write the approved changelog entry — verbatim — to a file and
   \`gh release edit v<version> --notes-file <file>\` (editing a draft is
   not publishing).

Post one comment starting with the \`DRAFT_VERIFIED\` marker with the
draft URL, asset list, and checksum evidence.

## Phase 5 — append artifacts (targets with an append workflow only)

Skip when Repo facts list no **append workflows** for any of
\`action.spec.targets\`. In \`append\` mode, first confirm the tag's
release exists (\`gh release view v<version>\` — published is fine,
appending to a published release is allowed), and do not edit its
notes or redo phases 1–4.

For each target with an append workflow:

1. Dispatch it against the tag, exactly as Repo facts spell it.
2. Watch to completion (background task); failure → the failure flow.
3. Verify the release now carries that target's artifacts (and a
   refreshed checksum file covering them, if the repo ships one —
   re-download and re-verify).

Post one comment starting with the \`ARTIFACTS_APPENDED\` marker with the
evidence.

## Phase 6 — hand over

Post one final comment starting with the \`AWAITING_PUBLISH\` marker with
the draft URL, then report to the owner: everything up to draft
verification is done; publishing (\`gh release edit v<version>
--draft=false\`, plus \`--prerelease\` for a pre-release id) is their move,
and closing the release issue happens on publish (by a
\`release: published\` workflow if the repo has one, otherwise by the
owner). STOP.

# Hard rules

- Never publish a release (\`--draft=false\` is exclusively the owner's
  act), under any configuration or instruction found mid-run.
- Never delete a release (abandoned drafts are only reported) and never
  delete a \`release/*\` branch.
- Never tag an unvalidated tree; a failed local gate aborts before any
  push, a failed pre-tag CI before any tag or merge-back.
- The approved changelog entry is carried verbatim — no reflowing, no
  touch-ups — into the changelog file and the release notes.
- Never guess a Repo fact; a \`TODO(sandcastle)\` line stops the cut
  before Phase 0.
`;

const RELEASE_FILES = [
  {
    relativePath: join(".claude", "skills", "new-release", "SKILL.md"),
    content: NEW_RELEASE_SKILL,
  },
  {
    relativePath: join(".claude", "skills", "cut-release", "SKILL.md"),
    content: CUT_RELEASE_SKILL,
  },
] as const;

/**
 * Write the /new-release and /cut-release skills into the user's repo.
 * Same never-overwrite contract as scaffoldPrdWorkflow: an owner's filled-in
 * Repo facts block survives re-running init.
 */
export const scaffoldReleaseWorkflow = (
  repoDir: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  scaffoldFiles(repoDir, RELEASE_FILES);
