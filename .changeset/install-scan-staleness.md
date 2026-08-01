---
"@ai-hero/sandcastle": patch
---

Image-gap evidence is scoped to the current image. The run-end scanner now splits logs on run delimiters and only scans runs started within the window — previously append-forever logs re-tallied day-old install lines on every run, against whatever image was current. Doctor ignores a tally recorded against a previous image, live-scans only runs newer than the image build, notes when a suggested line already exists in the Dockerfile (bake ineffective at runtime), and reports the label count dynamically. The playwright Dockerfile suggestion now emits the robust pattern (shared PLAYWRIGHT_BROWSERS_PATH, version pin, world-readable chmod) instead of the naive one-liner that breaks across the USER switch. Init's label table gained the missing ready-to-merge row, with a tripwire test keeping table and provisioned set in sync.
