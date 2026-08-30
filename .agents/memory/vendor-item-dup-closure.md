---
name: Vendor-item duplicate program closure
description: PM disposition closing the vendor-item duplicate remediation/prevention program and the boundaries for the remaining follow-ups.
---

# Vendor-item duplicate program — PM closure (Aug 2026)

**State:** Defect remediated and recurrence-prevented in Dev. Cleanup (2,431 groups merged) and prevention (partial unique index `vendor_items_vendor_item_sku_uniq` + one shared get-or-create across all four insert paths) both ACCEPTED/CLOSED by PM.

**Rules for remaining work:**
- Legacy orphan disposition (38 pre-merge dangling vendor-item refs) must NOT reopen the remediation. It is a bounded legacy-integrity cleanup: read-only classification FIRST (table, missing target, whether the referenced business record matters), then per-case disposition among repoint / null-and-mark-historical / preserve as legacy evidence. No broad repair logic until that evidence exists.
- Race-condition test coverage is prevention hardening only — finish, close if green, no new architecture.
- **Why (NULL/blank SKU boundary):** intentionally not database-constrained; PM chose not to invent an identity rule there. Shared creation path mitigates by reusing an existing (vendor, item) row, but do not "fix" this by broadening the constraint.

**Production boundary:** the index migration fails closed at startup if live data still has violations, so the Gate 2 cleanup must run against prod before/with deploying this code. Prod rollout ordering is a PM decision point (see prod May legacy session caution).

**Process deviation on record:** the prevention task was executed via assignment while the PM had a hold pending the cleanup's exact invariant output. PM classified this as a process deviation, NOT a technical rollback trigger — do not undo or rework the merged prevention code over it. Lesson: an assignment implying approval does not override an explicitly stated PM hold; confirm holds are lifted before treating assignment as GO.

**Re-import refresh is intentional:** the order-guide existing-row branch deliberately refreshes pack geometry + quoted price for a FULL-triple (vendor, inventory item, raw SKU) match through the shared price gate — that is product behavior (order guides are quote catalogs), not a race hazard. Only blind-create paths gate all side effects on `created`.

The full-triple invariant intentionally permits multiple real-SKU packs for one
vendor/item pair; code that has only historical supplier text and no SKU must
not choose among conflicting pack geometries.

**Why:** A vendor can legitimately offer the same catalog item in distinct
packs, while predecessor import rows do not carry enough identity to select one
pack safely.

**How to apply:** Treat vendor identity as a required scope, but keep pack
evidence one-to-many. If historical rows for that scope disagree, leave the
candidate unresolved rather than inferring the SKU.
