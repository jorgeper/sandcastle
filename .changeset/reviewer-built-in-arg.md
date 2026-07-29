---
"@ai-hero/sandcastle": patch
---

goal template: fixed the "implementer circles forever" failure — three defects behind one symptom. (1) The reviewer and conflict-resolver runs passed `TARGET_BRANCH` in `promptArgs`, but it's a reserved built-in: the run threw a PromptError before writing its log, rejecting the whole dispatch right after a successful implement. (2) `TARGET_BRANCH` was hardcoded `"master"`, so on a `main`-based repo the merge phase's branch-ahead check was always false and implemented branches were stranded forever; it's now derived from the branch the loop runs on. (3) The spec prompt now requires goals to reference commands that actually exist in package.json scripts — a goal demanding a nonexistent `npm run test` is unsatisfiable as written and burns implementer attempts on arguing equivalence.
