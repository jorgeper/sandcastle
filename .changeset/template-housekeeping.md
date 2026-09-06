---
"@ai-hero/sandcastle": patch
---

Goal template and conversational-prd template agents run on `claude-opus-5`
(was `claude-opus-4-8`). The Node toolchain profile's sandbox install
command is now `npm install --no-audit --no-fund`: the audit step POSTs the
package list to the registry and a hung POST there could exceed the
sandbox hook timeout, and neither audit nor fund output matters in a
throwaway sandbox.
