---
name: Orderly duplicate metric definitions
description: How to reconcile raw same-name duplicate populations with narrower period-transition diagnostics.
---

The observed duplicate-analysis population must remain intact until its membership is explained. A narrower query over exact normalized descriptions and removed/added period flags is a diagnostic slice, not a replacement count.

**Why:** Different pairing and naming rules can produce materially different counts, and excluding a candidate because it looks like a legitimate variant can hide an identity-resolution defect. In particular, a May/June vendor change with no offered cross-vendor link requires investigation rather than relabeling.

**How to apply:** For every candidate in the source population, report May vendor, June vendor, vendor-difference status, both pack-evidence sets, whether `link_vendor_pack` was offered, the reason if it was not eligible, and any explicit pack-variant relationship. Reconcile the source population and diagnostic subsets before changing metric names or thresholds.