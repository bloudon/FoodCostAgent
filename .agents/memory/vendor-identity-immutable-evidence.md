---
name: Vendor identity and immutable evidence
description: How vendor consolidation interacts with retained invoice and financial-ledger provenance.
---

Vendor identity consolidation must not rewrite retained `historical_invoices` or deposit-ledger evidence. Preserve the original vendor IDs in those immutable records, and record the survivor/loser relationship plus retained-evidence counts in a consolidation audit.

**Why:** The database deliberately rejects updates to retained invoice and ledger rows. Bypassing those guards would destroy source and financial provenance; attempting generic repoints instead makes every otherwise-authorized merge roll back.

**How to apply:** Repoint only mutable operational references under tenant scope. Validate immutable evidence is unchanged in the same transaction, keep the original vendor records available for historical reads, and have any canonical-identity interpretation use the applied audit relationship rather than mutating source evidence.