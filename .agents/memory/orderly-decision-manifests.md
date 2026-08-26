---
name: Signed decision manifests
description: Safety boundary for portable Orderly review-decision exports and imports.
---

# A decision manifest is a review artifact, never approval authority

An exported review manifest must be integrity-bound to its exact import scope,
the reviewer-visible preview evidence, saved decision revisions, and a
deterministic serialized form. Import must fail closed on any signature, scope,
preview, or revision drift and must then validate and write every decision in
one locked transaction.

**Why:** A downloadable JSON file is outside the normal request lifecycle. If
it can be replayed against another batch, or if a changed catalog/pack evidence
snapshot is trusted after export, a formerly safe draft can become an unsafe
inventory decision. JSON serialization also drops undefined object keys, so
the signed representation must normalize optional fields before signing.

**How to apply:** Keep manifest routes limited to an authorized pending batch;
include no client-selected destination or approval action; bind every
review-relevant scope/evidence field in the signature; and use the ordinary
locked review-save path for imports. Return accepted, rejected, and stale
results without partial writes.