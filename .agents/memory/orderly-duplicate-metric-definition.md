---
name: Orderly duplicate metric definitions
description: How to reconcile raw same-name duplicate populations with narrower period-transition diagnostics.
---

The observed duplicate-analysis population must remain intact until its membership is explained. A narrower query over exact normalized descriptions and removed/added period flags is a diagnostic slice, not a replacement count.

**Why:** Different pairing and naming rules can produce materially different counts, and excluding a candidate because it looks like a legitimate variant can hide an identity-resolution defect. In particular, a May/June vendor change with no offered cross-vendor link requires investigation rather than relabeling.

**How to apply:** For every candidate in the source population, report May vendor, June vendor, vendor-difference status, both pack-evidence sets, whether `link_vendor_pack` was offered, the reason if it was not eligible, and any explicit pack-variant relationship. Reconcile the source population and diagnostic subsets before changing metric names or thresholds.

The Orderly period comparison's resolved inventory-item IDs are not sufficient to reconstruct the full duplicate-pair population or vendor sets. Workbook/source-row evidence may include rows that resolve differently or contain blank suppliers, so a resolved-ID query can undercount cross-vendor cases.

**Why:** A prior narrow query produced a misleading six-item pseudo-code conclusion and omitted stable-code and mixed-supplier cases present in the full 31-pair diagnostic.

**How to apply:** Treat the established 31-pair diagnostic as the population under test. Reconcile any database-derived subset against the workbook/source-row pairing logic before using it to scope identity fixes.