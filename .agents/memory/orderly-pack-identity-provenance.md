---
name: Orderly pack identity provenance
description: Why source SKU and normalized geometry are stored per Orderly pack identity rather than inferred from vendor items.
---

An Orderly `packSizeId` is a distinct source identity. Its source SKU and normalized pack geometry must be retained on its immutable provenance mapping, not inferred only from the linked vendor item.

**Why:** The vendor-item uniqueness invariant permits one `(vendor, inventory item, SKU)` relationship. It cannot represent two incompatible source pack identities that reused the same SKU, so reading only vendor-item geometry can erase the contradiction needed to stop an unsafe variant.

**How to apply:** When writing Orderly adoption provenance, persist the source code plus normalized outer count, inner size, and unit with the pack identity. Reconciliation must scope comparisons by company, source property, vendor, candidate item, and source code; equivalent normalized geometry is not a conflict, while incomplete legacy geometry remains a review hold.

For Orderly pack comparison, all three parsed tiers (case quantity, inner-pack quantity, and base-unit quantity) must be explicitly present and positive before a normalized total is confirmed. Never silently substitute a missing tier with `1`.

**Why:** A display or classifier that turns partial geometry into a numeric total can make missing source evidence look like a safe match.

**How to apply:** Return an unknown/null normalized total for any absent tier. Preview clients may format server-provided normalized facts, but must show incomplete evidence as unconfirmed and never derive a total themselves.

Descriptive values in Orderly's Item Code column are not vendor code identity, but they do not make the financial row unusable. Such rows may use a source-property-scoped identity derived from normalized product name plus complete canonical pack geometry; the descriptive text itself must never become a code mapping.

**Why:** Orderly is read-only and repeatedly exports some wine and spirits descriptions in the Item Code field. Rejecting those rows makes entire inventory periods impossible to approve, while mapping the prose as a code falsely claims vendor-stable identity.

**How to apply:** Treat these rows as advisory. Resolve only through an existing derived identity or exactly one same-name catalog candidate with fully compatible persisted pack evidence. Zero or multiple compatible candidates take the new-item path; fuzzy, location-history, and partial-pack matches are never authority. Repeated rows in one batch must converge on one item, and mapping collisions remain fail-closed.