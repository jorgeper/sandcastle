Use `npm run typecheck` for type checking.

Check [./CONTEXT.md](./CONTEXT.md) for terminology questions.

For user-facing changes, add a changeset to `.changeset`. Check all changesets there first to see if there are duplicates. We use `@changesets/cli`, but you can create/edit the file manually. Make all bugfixes `patch`, all new features or breaking changes `minor` (since we're pre-1.0). Use `package.json#name` for the name.

When changing public-facing behavior, check `README.md` to see if the documentation needs updating.

## Agent skills

### Issue tracker

Issues live as GitHub issues on this fork, `jorgeper/sandcastle`; external PRs are also a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels. Agent provider support is detailed here. See `docs/agents/triage.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Fork workflow

This repo is an independent working fork. Every remote write targets
`jorgeper/sandcastle` and nothing else. **Never propose changes to, push to,
or create/modify PRs, issues, comments, labels, releases, or workflows on
Sandcastle upstream (`mattpocock/sandcastle`, AI Hero, or a renamed successor).**
Historical plans or documentation mentioning upstream contributions are
not permission to make them.

Keep only the owned `origin` remote; do not add an upstream remote, even
fetch-only. Set `remote.pushDefault=origin`, `push.default=simple`, and
`gh repo set-default jorgeper/sandcastle` in each fresh checkout. These are
local settings, not properties inherited from this file or from cloning.
Before any remote write, verify `git remote -v` and `gh repo set-default --view`.
Use `gh ... --repo jorgeper/sandcastle` explicitly for repository writes
(or an explicit `repos/jorgeper/sandcastle/...` API path), and push explicitly
to the verified `origin`. Never infer a PR target from GitHub's fork parent.
If a command resolves to upstream, stop and correct the local target; never
work around the error by targeting upstream or changing these safeguards.

Every change to this fork follows the same pattern:

1. Branch from `main` as `feat/<slug>`.
2. Implement on that branch following the conventions above (typecheck,
   tests, changeset, README).
3. Add a section for the change at the TOP of `README-FORK.md` (newest
   first): what was added and why, and the `feat/<slug>` branch name. Keep
   README-FORK.md/fork-doc edits in a separate commit from the feature
   commits.
4. Merge the branch to `main` on the fork.
