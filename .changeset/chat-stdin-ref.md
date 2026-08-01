---
"@ai-hero/sandcastle": patch
---

`chat()` restores `process.stdin.ref()` after the Ink app exits. Ink unrefs stdin when tearing down raw mode, so a caller that prompted on stdin after a chat (e.g. a template script's readline loop) would exit mid-await with Node's "unsettled top-level await" warning instead of waiting for input.
