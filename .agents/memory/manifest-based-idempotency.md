---
name: Manifest-based idempotency
description: How to prove a reviewed catalog adoption would produce zero writes on a repeat run.
---

For an idempotency proof, classify every frozen candidate by its exact
provenance-mapping identity and its frozen vendor-product target. A candidate
is satisfied only when both agree; an absent or mismatched mapping is a hold.

**Why:** A fresh source projection can legitimately reclassify a catalog row
as held when current source evidence cannot prove the row's mutable geometry.
That is not the same question as whether a rerun of the frozen migration would
write another mapping or vendor product.

**How to apply:** Bind the dry-run to the immutable manifest hash, execute it
in a read-only transaction with the same database identity guard as APPLY,
compare catalog fingerprints before and after, and require every candidate to
be either satisfied or held with zero create actions.