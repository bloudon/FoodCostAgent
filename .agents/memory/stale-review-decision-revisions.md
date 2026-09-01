---
name: Stale review-decision revisions
description: Optimistic-concurrency rule for replacing review drafts that no longer validate against current evidence.
---

When reconciliation excludes an invalid stored review decision from the active decision set, its stale entry must still expose the stored revision. The UI must not hydrate the invalid choice, but it must retain that revision and send it with any explicit replacement.

**Why:** Treating a stale stored row as absent makes the browser send a new-record revision token. The server then correctly rejects the write because the hidden stored row still exists, leaving the reviewer unable to replace it.

**How to apply:** Any API that separates valid and stale drafts must keep concurrency metadata on both sets. Replacement remains an ordinary revision-checked update; never delete or overwrite a stale draft without matching its current revision.