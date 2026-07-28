---
"@ai-hero/sandcastle": patch
---

Fix `.resume()` and `.fork()` rejecting with "promptArgs is only supported with promptFile" when the original run used `promptFile` + `promptArgs`. The resume/fork builders spread the original run options but only cleared `promptFile`, so the leftover `promptArgs` collided with the inline resume prompt. Both now drop `promptArgs` too, matching the structured-output retry path.
