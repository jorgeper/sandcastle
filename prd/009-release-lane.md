# PRD 009: Release lane — issue-driven releases, cut in the owner's session

Date: 2026-09-06 (ported from a dogfooding repo's PRD 008 and its
2026-08-04/05 amendments, generalized for any repository)

## Problem

Releases were the one flow still driven by hand: a checklist of version
bumps, a changelog, a gate, a tag, CI, a draft to verify. Done by hand
it drifts — a version was once cut _behind_ the newest tag, publishing
an older build on top of a newer one — and it leaves no trail. Every
other lane in the goal template starts from a labeled issue and logs its
phases on that issue; releases should too.

## Goals

- A release starts as a `sandcastle:release` issue with a
  machine-parseable body, filed only through an interview skill.
- Preflight is pure classification from GitHub state, unit-tested, with
  an ordering guard that makes cutting backwards impossible.
- The cut runs as a phased runbook whose every phase transition is one
  marker comment on the issue, so a re-invocation resumes rather than
  redoes.
- Publishing stays the human's act. The runbook stops at a verified
  draft.
- Everything repo-specific (bump command, workflows, assets) lives in
  one block the owner fills in once; nothing is guessed.

## Non-goals

- Cutting from a sandbox lane. Long CI waits and the publish hand-off
  belong in the owner's persistent session (a sandboxed lane was tried
  and retired on the dogfooding repo after three consecutive timeouts).
- Deleting releases or branches. Abandoned drafts are reported, never
  removed; `release/*` branches are permanent.
- Hotfix branches off a tag. A hotfix is a new, newer version.
- Detecting release mechanics at init. They vary too much; the owner
  states them.

## Requirements

### The request: `/new-release` skill

1. `/new-release` interviews the owner for the version, optional
   targets (free-form names: platforms, packages, artifacts), optional
   highlights, and — only when the version's tag already exists — the
   mode (`cut` or `append`). It validates the version is strict semver
   (pre-release id never stripped) and newer than the newest existing
   tag by invoking `release-lane.mts`, never by re-implementing it.
2. The skill drafts the changelog entry from commits and closed issues
   since the last release tag, presents it for edit/approval, and does
   not continue until the owner explicitly approves the text.
3. The skill files a GitHub issue labeled `sandcastle:release` (disjoint
   from `sandcastle`) whose body is exactly the template embedded in the
   skill: `**Version:**`, `**Targets:**` (may be empty), `**Mode:**`,
   and a `## Changelog` section carrying the approved entry verbatim.
   The skill never starts the cut and is the only supported way to file
   a release issue.

### Classification and preflight (`release-lane.mts`)

4. `npm run sandcastle` never cuts. It lists open `sandcastle:release`
   issues and prints one nudge per issue with its outcome (from the
   newest phase marker) and the next command — never a gate.
5. Preflight parses the body, collecting every problem. A malformed
   body ends preflight with one explanatory comment and no changes to
   the tree.
6. Ordering guard: a version at or behind the newest existing tag
   (prerelease-aware compare; unparseable tags such as a rolling
   `latest` are ignored) is refused with a comment and the cut stops.
7. Abandoned draft releases are reported once as a comment listing the
   exact `gh release delete` commands; no code path deletes a release.

### The cut: `/cut-release` skill

8. The cut branches `release/v<version>` from the default branch and
   performs, in order: the repo's version bump, the changelog commit
   (R11), the repo's extra pre-gate steps, and the gate — every
   `VERIFY_COMMANDS` entry from `.sandcastle/config.mts` unless the
   Repo facts name an explicit command.
9. The branch is pushed before any tag exists. If the repo names a
   pre-tag CI workflow, its run for the branch tip must be green before
   the tag is spent.
10. Failure flow: any failing step files one `sandcastle`-labeled bug
    (`Release cut failed: <step>`, body says `Blocks release #<n>.`),
    posts one `cut failed` comment with `Blocked-by: #<bug>`, and stops.
    A cut whose newest marker is `cut failed` is parked until that bug
    is known-closed. A pre-tag failure spends nothing: the version stays
    reusable and the retry re-cuts it.
11. The changelog file (created on the first cut) gets the approved
    entry, verbatim, at the top under `## v<version>`; the identical
    text becomes the release notes.
12. After tag push, merge-back, the release workflow (or a self-created
    draft when the repo has none), and draft verification (assets match
    the Repo facts, checksums verify if shipped), the skill posts
    `awaiting publish` and stops. Publishing (`--draft=false`) is
    exclusively the owner's act.
13. `append` mode: when tag `v<version>` exists and the issue names
    targets, phases 1–4 are skipped and each target's append workflow
    from the Repo facts runs against the tag; the appended artifacts are
    verified. A `cut` for an existing version is still refused (R6).
14. Every phase transition lands as exactly one comment beginning with a
    fixed marker string exported by `release-lane.mts` and printed by
    the preflight script — the skill never retypes one. Markers are
    pairwise distinct and none contains another.

### Branches and repo facts

15. `release/*` branches are permanent: every branch-deletion site in
    the goal template (and the conversational-prd overlay's PRD merge)
    routes through `isPermanentBranch` and omits `--delete-branch`.
16. All repo-specific release facts sit in one fenced `release-facts`
    block at the top of the scaffolded `/cut-release` skill, seeded with
    `TODO(sandcastle)` sentinels. A sentinel still present stops the cut
    before Phase 0 with a request to the owner. `sandcastle init` never
    overwrites a filled-in skill.

## Open questions

- A `release: published` close-out workflow (comment the links, close
  the issue) is repo-specific CI and is left to the owner; the skill's
  hand-over message says so.
