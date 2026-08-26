---
name: Orderly review-draft atomicity
description: Durable-review decisions must be validated and applied against the same locked catalog evidence.
---

# Saved Orderly review decisions require one locked source of truth

Draft decisions can be safely resumed only when approval locks the batch, reloads
the saved decision set, recomputes the preview under that lock, and uses that
locked preview for both validation and every downstream identity/blank-row cache
that drives mutations.

**Why:** Validating the saved action against one preview while resolving reliable
codes or blank-row inheritance from an earlier preview lets a concurrent catalog
change make a formerly reviewed decision unsafe at apply time.

**How to apply:** Treat a changed draft revision or any drift in the locked
preview's candidate, pack, code-group, or identity-group evidence as a conflict.
For bulk draft saves, validate all requested changes before any write, under the
batch lock. Never let the browser's in-memory map become approval authority.