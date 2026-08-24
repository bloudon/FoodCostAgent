---
name: Orderly pack identity provenance
description: Why source SKU and normalized geometry are stored per Orderly pack identity rather than inferred from vendor items.
---

An Orderly `packSizeId` is a distinct source identity. Its source SKU and normalized pack geometry must be retained on its immutable provenance mapping, not inferred only from the linked vendor item.

**Why:** The vendor-item uniqueness invariant permits one `(vendor, inventory item, SKU)` relationship. It cannot represent two incompatible source pack identities that reused the same SKU, so reading only vendor-item geometry can erase the contradiction needed to stop an unsafe variant.

**How to apply:** When writing Orderly adoption provenance, persist the source code plus normalized outer count, inner size, and unit with the pack identity. Reconciliation must scope comparisons by company, source property, vendor, candidate item, and source code; equivalent normalized geometry is not a conflict, while incomplete legacy geometry remains a review hold.