---
name: Controlled ledger resets
description: Safely reset immutable deposit-ledger evidence in a confirmed non-production data reset.
---

Deposit-ledger immutability must remain enabled during a scoped reset. Use the ledger's
explicit transaction-local maintenance authorization only inside the same atomic transaction
that proves the tenant, source-property scope, dependencies, and post-delete state.

**Why:** A direct delete is intentionally rejected by the immutability trigger. Disabling the
trigger would weaken the evidence guarantee beyond the narrowly authorized reset and risks
leaving it disabled after an error.

**How to apply:** Require an explicit destructive-reset approval, keep the database guard in
place, scope every delete by company and source property, use the transaction-local path only
for the exact ledger rows, and verify the transaction leaves the source binding intact. Never
use this path against production evidence.