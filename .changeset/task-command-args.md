---
"@ai-hero/sandcastle": patch
---

Goal template: prompts referencing issue-tracker command placeholders ({{COMMENT_TASK_COMMAND}}, {{CLOSE_TASK_COMMAND}}, {{VIEW_TASK_COMMAND}}, {{LIST_TASKS_COMMAND}}) now receive them — previously the merger, reviewer, and planner crashed with an uncaught PromptError on a fresh scaffold, and the merger's crash killed the whole loop. The merger phase is now wrapped so a failure logs and the next cycle retries from git state. A tripwire test asserts every prompt placeholder has a matching promptArgs entry. The reviewer prompt no longer says "run tests": no changes → no tests; committed refinements → quick tier + targeted tests only.
