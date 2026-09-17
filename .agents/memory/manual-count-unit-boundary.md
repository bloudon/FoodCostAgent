---
name: Manual count unit boundary
description: Product and integrity rules for practical package counts converted to canonical inventory quantity.
---

Manual inventory counts may be entered in practical item-level packages such as bottles or cases, but the persisted count quantity and valuation basis remain the item's canonical inventory unit. Reuse the established item package geometry; do not make counts depend on one vendor's purchase unit or create another unit/location model. Missing or inconsistent geometry must block package entry rather than treating it as canonical quantity.

Vendor price presentation must keep purchase-unit cost and canonical-unit cost separate. A purchase price may always be labeled with its actual purchase unit; a canonical price may be shown only from a valid normalized canonical cost backed by usable geometry.

Historical receipt rows whose stored unit differs from the item canonical unit are evidence of a contract risk, not proof that their numeric quantities need multiplication. Treat any proposed conversion as a dry-run candidate until operator intent is reviewed.

**Why:** A decimal bottle count was interpreted as the same numeric quantity of milliliters when canonical Orderly locations hid the existing package-count controls. Vendor purchase units are unsafe as a general count identity because one item can have multiple vendors and pack formats.

**How to apply:** Keep package and canonical labels explicit, perform authoritative conversion on every write path, never relabel purchase cost as canonical, preserve unrounded canonical cost, and never correct ambiguous counts or receipts without operator review and explicit PM authorization.