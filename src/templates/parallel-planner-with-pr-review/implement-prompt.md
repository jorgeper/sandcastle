# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `{{VIEW_TASK_COMMAND}}`. If the issue body has a `**PRD:**` line, read that file from the repo — it is the product spec for this work. If it has a `**Parent:** #<ID>` line, view the parent issue too for feature-level context.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run `npm run typecheck` and `npm run test` to ensure the tests pass.

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + PRD reference
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

# THE ISSUE

When the task is complete, leave a single comment on the issue recording what this run did, using:

`{{COMMENT_TASK_COMMAND}}`

Lead the comment with `🏰 **Sandcastle · Implementer** — {{BRANCH}}`, then keep it concise:

- **Done:** what was built
- **Decisions:** key choices made
- **Files:** files changed

Post this comment **before** you output the completion signal, so the trace is recorded even if the process exits immediately after.

If you cannot complete the task because of a genuine blocker, leave one comment describing the blocker and what remains, and do **not** output the completion signal — the next iteration will continue. Do not post a comment for routine "more work needed next iteration" handoff; that belongs in the commit message.

Do not close the issue - this will be done later.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
