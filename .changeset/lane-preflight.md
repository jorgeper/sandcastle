---
"@ai-hero/sandcastle": patch
---

Conversational lanes preflight the environment before burning an agent turn on a misconfiguration: design.ts and decompose.ts check at startup, issue.ts when developing (capture stays instant). The checks cover .sandcastle/.env presence, an agent credential, and — the killer case — whether GH_TOKEN can actually read the repo's issues, catching contents-only fine-grained PATs that authenticate fine but strand the agent mid-conversation on issue/PR operations. Problems are a nudge, not a gate: the script lists what's wrong, points at `npm run sandcastle:doctor`, and asks whether to continue. The goal template's doctor gained the same issue-access probe with a concrete fix hint (regenerate with Contents + Issues + Pull requests R/W), replacing its auth-only GH_TOKEN check.
