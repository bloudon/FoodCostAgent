---
name: Orderly adoption evidence freeze
description: Why the live Orderly adoption preview is read-only only, and what future APPLY authorization must prove.
---

Approved `inventory_import_rows` are sufficient to classify a **read-only**
preview when scoped by the active source-property binding, but their parsed
columns and normalized local vendor names are not a durable write
authorization.

**Why:** Parsed supplier, SKU, geometry, and resolution fields can change after
approval, and a later vendor-name edit can alter the normalized-name bridge.
That would let a future APPLY act on evidence different from the PM-reviewed
report.

**How to apply:** Keep catalog adoption blocked until the apply design freezes
the exact approved evidence with stable source-vendor identity and binds the
APPLY request to a fresh fingerprint/hash of the PM-reviewed source snapshot.
Do not use current parsed-row values or display-name matching alone to authorize
writes.

For Orderly evidence, retain two separate hashes: a raw-file SHA-256 for chain
of custody and a canonical logical-source fingerprint for authorization. The
logical fingerprint must sort normalized relationship projections and object
keys, so harmless formatting or source-array ordering does not change it.
Freeze only safe candidates; held rows belong in the accompanying evidence
summary, not in the mutation manifest. A future apply must verify the
deterministic manifest ID/hash, property, logical source fingerprint, and a
fresh per-candidate DB revalidation before doing anything.