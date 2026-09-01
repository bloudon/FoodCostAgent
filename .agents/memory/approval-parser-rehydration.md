---
name: Approval-time parser rehydration
description: Why reparsed source geometry must be persisted in the same approval transaction that consumes it.
---

Preview and approval must reparse immutable raw import evidence whenever the persisted geometry is unusable, even if an older parser labeled it `ok`. Raw header lookup must use the same trimmed, case-folded semantics as workbook format detection while preserving the original key/value untouched. Preview uses recovered fields in memory only; approval persists every recovered derived field and status atomically with the resolution that consumes them.

**Why:** Older parser versions may freeze non-positive tiers under an `ok` status, so gating rehydration on status alone leaves staged batches permanently stale. Real workbooks can also pass normalized format detection while retaining non-canonical source-header spelling in immutable JSON; an exact-key reader then silently skips the whole legacy batch. An in-memory reparse can also create correct catalog geometry while leaving the approved source row inconsistent unless approval persists the complete derived contract.

**How to apply:** Decide whether to reparse from normalized geometry validity, not the stored status string. Normalize raw header names only for lookup; preserve their original spelling and fail closed if multiple keys normalize to the same required field. Never replace already-compatible staged geometry during preview. Approval must update the complete derived contract in its transaction while retaining untouched raw source authority. Regression coverage should prove preview is write-free and compare approval persistence, provenance, and reconciliation basis.