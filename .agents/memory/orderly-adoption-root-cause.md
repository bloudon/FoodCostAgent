---
name: Orderly adoption root cause
description: PM-confirmed architecture finding and issue-routing boundary for missing Orderly vendor products.
---

The missing Orderly vendor-product relationships were caused by
cross-batch vendor-product adoption loss. They were not caused by a
one-vendor-per-ingredient rule, systematic vendor preference, or a requirement
that an ingredient have only one vendor product.

The intended model is one canonical inventory item with many vendors and,
within a vendor, potentially many distinct SKUs and pack sizes.

**Why:** Treating the symptom as a single-vendor architecture problem would
collapse legitimate purchasing options and misroute remediation.

**How to apply:** Route cross-shopping identity issues to the cross-shopping
task, bounded Orderly adoption to the completed adoption task, held conflicts
to a separately scoped remediation task, and future fuzzy/new-item work to a
new post-migration task. Do not reopen the closed investigation for
implementation.