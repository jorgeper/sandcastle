---
"@ai-hero/sandcastle": minor
---

Per-repo customization (prd/007): `sandcastle init` detects a toolchain
profile (node, react-web, tauri, go, python), proposes verify commands from
the repo's real package.json scripts, and asks confirm / edit / defer
(`--toolchain`, `--verify-commands`). The goal template's knobs move to
`.sandcastle/config.mts` (install command, copyToWorktree, VERIFY_COMMANDS)
and its prompts take verification from the knob instead of hardcoding
`npm run typecheck`/`npm run test`. Deferring scaffolds a
`sandcastle-customize` skill; `--doctor` checks the knob (empty → nudge,
missing scripts → loud failure); the loop warns on empty knobs and
non-default branches. Every init snapshots the pristine scaffold to
`.sandcastle/.template-base/` as the ancestor for a future three-way
`sandcastle update`. The `parallel-planner-with-pr-review` template now
derives TARGET_BRANCH instead of hardcoding "master".
