Use `npm run typecheck` for type checking.

Check [./CONTEXT.md](./CONTEXT.md) for terminology questions.

For user-facing changes, add a changeset to `.changeset`. Check all changesets there first to see if there are duplicates. We use `@changesets/cli`, but you can create/edit the file manually. Make all bugfixes `patch`, all new features or breaking changes `minor` (since we're pre-1.0). Use `package.json#name` for the name.

When changing public-facing behavior, check `README.md` to see if the documentation needs updating.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `mattpocock/sandcastle`; external PRs are also a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels. Agent provider support is detailed here. See `docs/agents/triage.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Fork workflow

This repo is jorgeper's fork of mattpocock/sandcastle (`upstream` remote).
Every change to this fork follows the same pattern:

1. Branch from `main` as `feat/<slug>`.
2. Implement on that branch following the conventions above (typecheck,
   tests, changeset, README).
3. Add a section for the change at the TOP of `README-FORK.md` (newest
   first): what was added and why, and the `feat/<slug>` branch name. Keep
   README-FORK.md/fork-doc edits in a separate commit from the feature
   commits, so the feature commits stay cleanly cherry-pickable for an
   upstream PR.
4. Merge the branch to `main` on the fork. Upstream PRs, if proposed, come
   from the feature branch.
