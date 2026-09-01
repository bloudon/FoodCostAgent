---
name: Self-updating VPS release helpers
description: Covers the bootstrap behavior when a running VPS release script pulls a newer version of itself.
---

When a VPS release helper updates its own file during `git pull`, the current shell process may continue executing the pre-pull script body. Treat output missing newly required verification fields as evidence that the old helper ran, even if the reported Git SHA is current.

**Why:** A release advanced the checkout and API identity to the new commit but left the frontend stale because the running helper had been loaded before its frontend-build logic arrived.

**How to apply:** After changing a release helper, require its new output fields. If the first run advances to the helper-changing commit but emits the old output schema, rerun the same command once from the now-current checkout, then independently verify the public artifact bytes.