---
"@ai-hero/sandcastle": patch
---

Reused sandboxes skip the replayed setup phase. The lifecycle used to re-run git setup (safe.directory, identity propagation) and onSandboxReady hooks on every run — including every conversation turn on a kept-alive sandbox, where it was pure churn and made each turn's log look like a fresh sandbox launch. Setup now runs once per live sandbox handle; the logs also state which case you're in, subtly: a first run logs "Setting up sandbox (new container)", a reused one logs "Reusing live sandbox (setup already done)". Fresh containers always arrive on fresh handles, so nothing is skipped for genuinely new sandboxes; a second process attaching to the same container re-runs the idempotent setup once.
