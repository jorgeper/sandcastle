---
"@ai-hero/sandcastle": patch
---

Goal template: pushes survive a second machine. Lane branches are pushed
with `--force-with-lease=<branch>:<sha>` against the tip read via
`ls-remote`, so a stale remote-tracking ref on this machine no longer
fails the push with "(stale info)". The merger's push of the target branch
now fetches and merges the remote tip first, and a failed push logs and
falls through instead of crashing the loop after issues were already
closed.
