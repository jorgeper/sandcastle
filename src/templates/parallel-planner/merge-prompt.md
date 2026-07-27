# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`{{CLOSE_TASK_COMMAND}}`

# CLOSE FINISHED PARENTS

After closing an issue, check its body for a `**Parent:** #<ID>` line. If present, view that parent with `{{VIEW_TASK_COMMAND}}`. If every one of the parent's sub-issues is now closed, close the parent too using `{{CLOSE_TASK_COMMAND}}`, with a comment noting that all sub-issues are complete. If the issue has no `**Parent:**` line, skip this step.

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
