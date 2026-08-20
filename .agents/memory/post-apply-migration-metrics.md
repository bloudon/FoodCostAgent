---
name: Post-apply migration metrics
description: How to retain an auditable historical-resolution lift after a catalog mutation.
---

Report post-apply historical resolution improvement by comparing the frozen
pre-apply baseline with a fresh post-apply projection. Do not use only the
fresh projection's `newlyResolvable` field.

**Why:** The projection measures its “before” state from the catalog it reads.
After a successful adoption, that catalog already contains the created vendor
products, so the fresh projection correctly reports zero *new* changes even
though the migration improved resolution versus the frozen baseline.

**How to apply:** Preserve the manifest-bound baseline report, generate a
separate read-only post-apply preview, verify both bind to the same source
fingerprint, and calculate lines, dollars, codes, and match-rate lift across
those two snapshots.