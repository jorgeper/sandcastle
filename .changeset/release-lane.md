---
"@ai-hero/sandcastle": minor
---

Goal template: a release lane. `/new-release` (scaffolded by init)
interviews you for a version, optional targets and highlights, drafts the
changelog for your approval, and files a `sandcastle:release` issue in a
machine-parseable body. `/cut-release <n>` executes it in your Claude Code
session: preflight from `.sandcastle/release-lane.mts` (strict-semver parse,
prerelease-aware ordering guard so a version can never be cut behind the
newest tag, abandoned-draft report), then a phased runbook — release
branch, version bump, changelog, gate, pre-tag CI, tag, merge-back,
release workflow, draft verification, appended artifacts — logging every
phase as a marker comment on the issue so a re-invocation resumes. It
stops at a verified draft; publishing stays yours. Repo-specific mechanics
live in one `release-facts` block in the skill, seeded with
`TODO(sandcastle)` sentinels that stop the cut until you fill them in.
`release/*` branches are permanent (never deleted on merge), the
orchestrator reports open release issues as nudges, and
`npm run sandcastle:init` provisions the label.
