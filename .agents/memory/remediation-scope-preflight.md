---
name: Remediation scope preflight
description: Production-safe approval of bulk duplicate remediation when candidate identities may have references outside the approved property.
---

# Validate all cross-scope references before approval and apply

Bulk remediation preflight must scan the complete approved candidate set for
references outside the approved company, store, source system, and source
property. It must reject the manifest before APPLY when any are found, with a
reviewable exclusion or explicitly authorized exception set.

**Why:** Per-group fail-closed checks protect data integrity, but discovering
cross-property references during a live production APPLY creates a partial,
slow-running operation that cannot meet an all-or-nothing approval expectation.

**How to apply:** Put the same scope predicate behind manifest generation,
read-only preflight, and APPLY. Tests must cover candidates with one and
multiple outside-scope mappings and prove rejected manifests produce no
remediation mutation or audit attempt.