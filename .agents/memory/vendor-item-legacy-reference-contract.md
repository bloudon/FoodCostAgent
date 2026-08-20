---
name: Vendor-item legacy reference contract
description: The one approved schema-compatibility exception for the read-only vendor-item duplicate classifier.
---

The read-only vendor-item duplicate classifier may tolerate exactly one absent
reference consumer on the restored legacy production schema:
`vendor_invoice_import_lines.resolved_vendor_item_id`. Its absence must be
visible in the report as not present, zero applicable references, and
`legacy_optional_absent`. No other missing consumer is optional; unknown or
missing required references fail closed before classification.

**Why:** This column arrived with the later vendor-invoice staging feature,
after the restored production schema. Treating it as required prevented a
read-only report; treating missing consumers generally as optional would hide
an unsafe reference drift.

**How to apply:** Keep the exception explicit and code-owned. Test both schema
versions and the guard order; do not introduce dynamic acceptance of arbitrary
missing columns without a separately reviewed PM decision.