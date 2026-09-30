---
name: Manual count unit boundary
description: Product and integrity rules for practical package counts converted to canonical inventory quantity.
---

Manual inventory counts may be entered only in practical item-level packages such as bottles or cases, including fractions of those packages. Canonical and recipe measurements such as mL or ounces must not appear as count units merely because they are canonical. Persisted count quantity and valuation remain canonical. Reuse established item package geometry; do not make counts depend on one vendor's purchase unit or create another unit/location model. Missing or inconsistent geometry must block package entry rather than exposing canonical measurement as a fallback.

A display-unit switch in an item/count setup must convert the visible number, not just relabel it: 48 oz becomes 3 lb, while the stored canonical amount remains 48 oz. This does not establish that 3 lb is one physical case; an operator-confirmed 1.5-lb case is a separate setup decision. **Why:** A label-only switch can silently multiply a pack sixteenfold or confuse a two-case total with the size of one case. **How to apply:** Convert the current entered magnitude on every compatible display-unit change and normalize back to canonical units only on save; never change canonical cost or past count evidence merely to offer a pound display.

A specific container label improves presentation but is not part of the conversion geometry. When positive container size and case package count are already verified, keep the row usable with the neutral physical label “Container” rather than blocking it. Measurement-unit metadata alone must never activate package mode.

Positive legacy geometry is **not** proof that its factors describe physical packages. An imported total may have been decomposed as many one-ounce or one-milliliter “containers” even when the retained source describes fewer larger packages. A neutral label cannot make that count correct. Require one consistent, complete source pack whose physical count and total agree with the item's canonical unit and case quantity; ambiguous packs must require setup instead of exposing the old numeric geometry.

**Why:** The Bay Hill review found total-preserving but physically false case breakdowns, including 24 packages of 2 oz stored as 48 of 1 oz. Label-only presentation made the false count more visible without fixing it.

**How to apply:** Distinguish source-pack *total normalization* from *inner physical-package identity* before count setup or repair. Preserve saved count quantities and costs; mark older package-part breakdowns for review whenever they cannot reconcile under corrected geometry. Never use a raw vendor pack alone as authority when multiple source packs disagree.

Employee-facing totals must remain in operational packages (for example, 14.5 bottles), not canonical conversion quantities such as 10,875 mL. Prefer an explicit container label; otherwise resolve obvious names/categories such as liquor or wine to “bottle” before using “container.”

Vendor price presentation must keep purchase-unit cost and canonical-unit cost separate. A purchase price may always be labeled with its actual purchase unit; a canonical price may be shown only from a valid normalized canonical cost backed by usable geometry.

Historical receipt rows whose stored unit differs from the item canonical unit are evidence of a contract risk, not proof that their numeric quantities need multiplication. Treat any proposed conversion as a dry-run candidate until operator intent is reviewed.

Saved count lines also need their unit identity checked against the item's current canonical unit before displaying today's package breakdown or per-container price. A package-part sum that happens to reconcile numerically is not evidence of unit continuity; canonical-only historical counts are never divided by today's container size to invent a physical count. Mark either situation for review, without rewriting the saved quantity. **Why:** Historical unit changes and package-geometry changes can make old numeric quantities look like valid current bottle counts while silently changing their meaning. **How to apply:** Compare stored and current unit identity, then reconcile saved case/container parts to canonical quantity before displaying physical totals or making a previous count comparable.

An operator's confirmation of the *current standard case* may support current item-level counting geometry even when retained vendor packs conflict. Keep alternate source packs intact and leave saved counts expressed with an older case conversion untouched and flagged for historical review. **Why:** A confirmed 60-bag standard case can coexist with a retained 30-bag source and historical one-case/30-bag lines; recasting those lines as today's 60-bag case would double their physical meaning. **How to apply:** Verify the canonical item total and physical inner unit before enabling today's packages; treat contradictory vendor packs and prior package parts as separate evidence/reconciliation work, not as permission to rewrite history.

PM accepted this item-level geometry approach for production rollout. Production acceptance must preserve the existing August session and identify suspicious saved lines for operator review without reinterpreting or changing them.

Production rollout is gated on a signed-in demonstration against the actual Bay Hill Dev session and item records; pure helper tests and reconstructed examples are not sufficient evidence.

**Why:** PM confirmed this as the settled product rule after a decimal bottle count was interpreted as the same numeric quantity of milliliters. Staff count physical packages, FnB converts internally, and recipes use separate conversions. Vendor purchase units are also unsafe as a general count identity because one item can have multiple vendors and pack formats. Requiring a new label on otherwise complete legacy geometry blocked nearly every Bay Hill row and made the count session unusable.

**How to apply:** Offer cases, containers, and fractions of those physical packages. Keep canonical measurements internal, perform authoritative conversion on every write path, never relabel purchase cost as canonical, preserve unrounded canonical cost, and never correct ambiguous counts or receipts without operator review and explicit PM authorization.