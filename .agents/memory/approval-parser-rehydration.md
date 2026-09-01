---
name: Approval-time parser rehydration
description: Why reparsed source geometry must be persisted in the same approval transaction that consumes it.
---

Preview and approval must reparse immutable raw import evidence whenever persisted geometry is unusable, on both the incoming row and the bounded approved predecessor rows used as candidate provenance. Raw header lookup must use the same trimmed, case-folded semantics as workbook format detection while preserving the original key/value untouched. Preview uses recovered fields in memory only; approval persists recovered fields only for the incoming row it resolves, never by rewriting historical predecessor evidence.

**Why:** Repairing only the incoming row leaves matching fail-closed when its candidate derives from an older approved row with the same stale parser output. Older versions may store null or non-positive tiers under varying statuses, so status-based gates are unreliable. Real workbooks can also pass normalized format detection while retaining non-canonical source-header spelling in immutable JSON; an exact-key reader then silently skips legacy evidence.

**How to apply:** Decide whether to reparse from normalized geometry validity, not the stored status string. Normalize raw header names only for lookup; preserve original spelling and fail closed on duplicate normalized keys. Bound candidate rehydration to the already-selected approved same-property predecessor; never scan wider history or infer from prices/catalog display fields. Approval may persist the current row’s complete derived contract in its transaction, but historical predecessor rows remain immutable. Regression coverage must prove both preview and approval leave predecessor evidence unchanged.