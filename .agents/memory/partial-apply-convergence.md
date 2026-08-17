---
name: Partial-apply tails and shared-identity convergence
description: How to read a stopped tail after a partial remediation APPLY — vanished groups plus applied overlap usually mean self-resolution, not lost work.
---

After a partial manifest APPLY, stopped groups whose code "no longer produces a duplicate group" AND whose manifest item ids overlap applied groups' canonical/superseded sets were almost certainly resolved transitively: an earlier applied merge superseded the shared duplicate items, so the later group dissolved before its transaction opened. The under-lock drift stop is the guard working, not a failure to remediate.

**Why:** In the Bay Hill Batch 1 run, 40/41 stops were exactly this shape (all NO_ACTIVE_GROUP now, all overlapping applied merges 2–10 ids), and valuation reconciled to $0.00 — the tail needed no rerun. The one true blocker had ZERO applied overlap and an independent evidence drift (canonical-unit divergence), which is how the two cases are told apart.

**How to apply:** When analyzing a stopped tail, compute per group: (a) current classification, (b) item-id intersection with the immutable `applied` audit rows (anchor to earliest applied row per code — latest-row-wins is not a run identity), (c) the frozen stop-time audit evidence separately from current state. Vanished + overlap → transitively resolved; changed + no overlap → independent drift needing fresh review. Held/excluded groups can also dissolve via shared items with approved groups — flag that for the owner rather than treating it as tampering. Reconciliation booleans must be bidirectional set equality, never just "everything has an audit row".
