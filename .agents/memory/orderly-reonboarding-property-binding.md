---
name: Orderly re-onboarding property binding
description: Re-onboarding after a company purge must restore the source-property binding before imports can inherit prior approved identity.
---

After a company is purged and re-onboarded, recreate and verify its approved Orderly source-property binding before staging or approving imports. A batch with a SQL `NULL` source property cannot match prior approved rows scoped to the property, even when code, supplier, geometry, and resolved item all agree.

**Why:** The preview query is intentionally property-scoped to prevent cross-property code reuse; missing binding metadata therefore fails closed and makes a valid historical match appear absent.

**How to apply:** Treat binding creation, destination-store verification, and backfilling any already-staged batches as one controlled production repair. Preserve existing review decisions and do not retry approval until the preview shows the historical resolution.

An approved predecessor row can be the only durable code/vendor/pack evidence
after re-onboarding; an external mapping may legitimately be absent. A preview
does not satisfy historical inheritance merely because `matchedId` names the
same catalog item: the match must consume the predecessor's compatible pack
evidence and require no new variant decision.

**Why:** Production had byte-identical `1/72 EA` June and July rows resolved to
the same item, but the catalog's older case size and missing external mapping
made a name match look like a new variant until predecessor evidence was
allowed to stand on its own.

**How to apply:** For acceptance, verify the latest eligible predecessor row,
vendor, normalized pack, resolved item, no-review status, and measured public
preview duration together. Treat `matchedId` alone as insufficient evidence.

Alternate-code predecessor evidence is authoritative only when the supplier
name resolves to one tenant vendor identity and every relevant predecessor row
proves one mutually compatible pack geometry. A rejected name collision or
pack contradiction must not fall through to vendorless item-mapping evidence.

**Why:** Otherwise a surviving item mapping can mask ambiguous predecessor
provenance and make link validity depend on row order or evidence from another
vendor.

**How to apply:** Distinguish “no relevant predecessor evidence” from
“relevant evidence was rejected.” Legacy mapping fallback may serve the first
case; the second remains unknown and requires review.