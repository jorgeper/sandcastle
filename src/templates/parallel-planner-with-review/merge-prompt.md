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

For each branch that was merged, first leave a single comment on its issue recording the merge, using:

`{{COMMENT_TASK_COMMAND}}`

Lead the comment with `🏰 **Sandcastle · Merger**`, then keep it concise:

- **Merged:** `<branch>` → the current branch
- **Tests:** the result of `npm run typecheck` and `npm run test`

Then close the issue using the following command:

`{{CLOSE_TASK_COMMAND}}`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
