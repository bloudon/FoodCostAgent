---
name: Orderly re-onboarding property binding
description: Re-onboarding after a company purge must restore the source-property binding before imports can inherit prior approved identity.
---

After a company is purged and re-onboarded, recreate and verify its approved Orderly source-property binding before staging or approving imports. A batch with a SQL `NULL` source property cannot match prior approved rows scoped to the property, even when code, supplier, geometry, and resolved item all agree.

**Why:** The preview query is intentionally property-scoped to prevent cross-property code reuse; missing binding metadata therefore fails closed and makes a valid historical match appear absent.

**How to apply:** Treat binding creation, destination-store verification, and backfilling any already-staged batches as one controlled production repair. Preserve existing review decisions and do not retry approval until the preview shows the historical resolution.