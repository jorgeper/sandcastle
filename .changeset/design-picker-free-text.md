---
"@ai-hero/sandcastle": minor
---

conversational-prd template: the bare-run `design.ts` picker accepts free text to file a new design topic, symmetrical with `issue.ts` — type a number to open a waiting design issue's conversation, or describe a new topic to file a `sandcastle:design` issue (same title/marker/label as the argument form) and start its conversation immediately. The prompt now appears even when no design issues are waiting, so an empty lane is an invitation rather than a silent exit; only a pure in-range integer counts as a pick (out-of-range or decimal input is treated as a topic). The answer interpretation ships as a pure `interpretPickerAnswer` helper in the template's `shared.ts` with unit tests.
