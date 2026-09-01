---
name: Orderly pack identity provenance
description: Why source SKU and normalized geometry are stored per Orderly pack identity rather than inferred from vendor items.
---

An Orderly `packSizeId` is a distinct source identity. Its source SKU and normalized pack geometry must be retained on its immutable provenance mapping, not inferred only from the linked vendor item.

**Why:** The vendor-item uniqueness invariant permits one `(vendor, inventory item, SKU)` relationship. It cannot represent two incompatible source pack identities that reused the same SKU, so reading only vendor-item geometry can erase the contradiction needed to stop an unsafe variant.

**How to apply:** When writing Orderly adoption provenance, persist the source code plus normalized outer count, inner size, and unit with the pack identity. Reconciliation must scope comparisons by company, source property, vendor, candidate item, and source code; equivalent normalized geometry is not a conflict, while incomplete legacy geometry remains a review hold.

For Orderly pack comparison, all three parsed tiers (case quantity, inner-pack quantity, and base-unit quantity) must be explicitly present and positive before a normalized total is confirmed. The one source-defined exception is `0/0 <measurable unit>`: Orderly uses it for direct-unit counts, so parse it as one case × one pack × the stated measurable quantity while retaining the literal `0/0` in raw evidence. Never apply this exception to `Case` or another unsupported unit.

**Why:** A display or classifier that turns partial geometry into a numeric total can make missing source evidence look like a safe match. But production rows prove that `0/0 LT`, `0/0 750ML`, and `0/0 EA` carry internally reconciled direct-unit quantities and prices; treating their zero multipliers as missing forks established item history.

**How to apply:** Recognize the exact direct-unit notation in the authoritative parser, persist canonical derived geometry on approval, and preserve the original pack text in immutable source data. Return unknown/null for every other absent tier. Preview clients may format server-provided normalized facts, but must never derive a total themselves.

Descriptive values in Orderly's Item Code column are not vendor code identity, but they do not make the financial row unusable. Such rows may use a source-property-scoped identity derived from normalized product name plus complete canonical pack geometry; the descriptive text itself must never become a code mapping.

**Why:** Orderly is read-only and repeatedly exports some wine and spirits descriptions in the Item Code field. Rejecting those rows makes entire inventory periods impossible to approve, while mapping the prose as a code falsely claims vendor-stable identity.

**How to apply:** Treat these rows as advisory. Resolve only through an existing derived identity or exactly one same-name catalog candidate with fully compatible persisted pack evidence. Zero or multiple compatible candidates take the new-item path; fuzzy, location-history, and partial-pack matches are never authority. Repeated rows in one batch must converge on one item, and mapping collisions remain fail-closed.

Pack comparison normalization and persistent pack identity are separate contracts. Comparison may convert approved aliases such as gallons, quarts, kilograms, and dozens to canonical dimensions, while the identity key must continue to use the raw normalized source unit string.

**Why:** Reusing comparison aliases in the identity key would silently re-key existing alternate identities when a new alias is introduced, potentially forking cross-month continuity during a seed.

**How to apply:** Keep unit-alias conversion out of identity-key construction. New aliases may improve compatibility checks and catalog geometry only. Unsupported units and non-finite derived totals must remain unknown rather than producing a custom canonical unit or a compatible result.

A stable Orderly Item Code mapping is not proof that a later row has the same physical pack. When complete incoming geometry conflicts with the mapped item for the same vendor, keep the older code mapping as historical identity evidence and require a separate pack variant; use the pack-specific derived identity for future continuity.

**Why:** Orderly can reuse one Item Code after changing the physical pack. Treating the existing code mapping as an unconditional match makes preview claim compatibility while approval correctly rejects the vendor-pack conflict.

**How to apply:** Compare complete pack geometry even on the external-mapping path. A same-vendor mismatch becomes an explicit variant review. Approval must not rewrite the older code mapping; the new variant gets a pack-specific derived identity, which takes precedence when that exact pack appears again.

A reviewed `create_variant` decision must override every cache of pre-existing matches, including a high-confidence name/outer-count match. The comparison candidate is evidence only and can never seed the new code's apply-time identity.

**Why:** A row may high-confidence name-match an existing item while deeper vendor-pack evidence proves a different dimension. Caching that match before decision application silently turns `create_variant` into a link and sends the incoming pack to the comparison item.

**How to apply:** Exclude all possible re-code rows from existing-item approval caches. Apply the explicit variant decision before any confident-match fallback, and regression-test cases where superficial outer counts match but canonical dimensions differ.

Stable Item Codes own separate pack-specific derived-identity namespaces. An unqualified normalized name+pack key may reconcile descriptive or blank-code rows, but it must never merge two distinct stable codes or become a mutation cache for a stable row.

**Why:** Distinct products can differ only by punctuation that normalization intentionally removes. Reusing one unqualified derived key for their stable codes makes approval order-dependent and can redirect a real source code to another item's pack identity.

**How to apply:** Qualify stable-code pack identities by the exact source code within the existing company/source-property scope. Stable rows may read only their real code or code-qualified pack identity; group caches are allowed only for a proven singleton stable sibling, blank-only group, or pseudo-only new group.

Blank-code name+pack identity may use complete, mutually compatible resolved evidence from the one newest approved predecessor for the same company and source property without requiring an external code mapping.

**Why:** A blank source value cannot express code provenance. Requiring a code mapping held valid same-property items created by earlier approvals even though the selected predecessor already carried their property-scoped identity and pack evidence.

**How to apply:** Keep coded reuse scoped through source-property mappings. For blank rows only, treat the selected predecessor as the provenance boundary; require every candidate evidence row to be complete (or valid opaque evidence), mutually compatible, and tied to one unique exact-name catalog candidate. Conflicting, incomplete, ambiguous, or cross-property evidence remains held.