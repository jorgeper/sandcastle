# TASK

Produce (or recover) the implementation spec for issue {{TASK_ID}}: {{ISSUE_TITLE}}

You are the spec writer. You do NOT implement anything. Your job is to turn
the issue into a small committed spec plus a goal statement that a judge can
verify, then emit both via the structured output block at the end.

# IDEMPOTENCY CHECK (do this first)

View the issue with `gh issue view {{TASK_ID}}`. If the issue body already
contains a `**Spec:**` line AND the referenced file exists on this branch:
read the file, take the goal statement verbatim from its `## Goal` section,
and skip straight to OUTPUT. Do not regenerate, rewrite, or re-link anything.

# WRITE THE SPEC

Otherwise, gather context: the issue body, any `**PRD:**` file it references,
and any `**Parent:** #<ID>` issue. Explore the repo enough to make the
acceptance criteria concrete.

Write `specs/issue-{{TASK_ID}}.md` with exactly this shape:

```markdown
# Spec: <issue title> (#{{TASK_ID}})

## Goal

<the goal statement — see rules below>

## Acceptance criteria

- <criterion 1>
- <criterion 2>
  ...

## Context

<a few sentences: relevant files, constraints, and pointers the implementer
needs. Keep it short — the implementer can explore.>
```

Rules for the goal statement and acceptance criteria:

- **Observable end states, not actions.** "A summary comment exists on issue #{{TASK_ID}}", never "post a comment". "npm run typecheck and npm run test
  have been run and pass", never "run the tests". This is what makes re-runs
  idempotent: a judge re-evaluating from actual state must not double-fire
  work that already happened.
- The goal statement is one sentence naming the spec file: "All acceptance
  criteria in specs/issue-{{TASK_ID}}.md are satisfied for issue #{{TASK_ID}}, with evidence visible in the session: <the 2-4 most
  load-bearing criteria inline>."
- Always include these two criteria: `npm run typecheck` and `npm run test`
  pass (run in the implementer's session), and a summary comment from the
  implementer exists on issue #{{TASK_ID}}.
- Keep the goal statement under 1,500 characters; detail belongs in the
  acceptance criteria, which the file carries.

Then, in this order:

1. Commit the spec file on branch {{BRANCH}} with message
   `RALPH: spec for issue #{{TASK_ID}}`.
2. Add the spec link to the issue body: append a line `**Spec:**
specs/issue-{{TASK_ID}}.md` (use `gh issue view {{TASK_ID}} --json body`
   to read the current body and `gh issue edit {{TASK_ID}} --body-file -` to
   write it back with the line appended; change nothing else in the body).

# OUTPUT

Finally, emit exactly one structured output block and nothing after it:

<spec>{"goal": "<the goal statement>", "specPath": "specs/issue-{{TASK_ID}}.md"}</spec>

The value must be valid JSON on one line. Emit it whether the spec was
freshly written or recovered from an existing file.
