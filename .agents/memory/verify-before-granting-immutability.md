---
name: Verify before granting immutability
description: Any flag that makes a record unrepairable must be written last, inside the same transaction as the verification that justifies it.
---

# Verify before granting immutability

When a flag makes a record immutable — blocked from edit, apply, and delete by a guard
that ignores role — that flag must be the **last write in the same transaction** as the
validation that justifies it.

Writing the flag alongside the data and validating after commit inverts the protection.
Any post-commit failure (concurrent source change, drifted evidence, a persisted total
that disagrees with the source) throws having already left behind a protected, invalid
record that no guarded API can repair or delete. The guard then defends corruption.

Two things this requires in practice:

- **Verification must read through the transaction handle**, not the module-level
  connection. Reading outside the transaction sees the pre-write state and verifies
  nothing while appearing to pass.
- **Failing verification must roll back the whole record**, not mark it degraded. A
  record that cannot be justified should not exist; and the rollback must not poison
  retry via an "already exists" idempotency guard.

**Why:** A creation path committed the immutability flag, lines, and evidence links
together and reconciled afterwards. Every post-commit failure mode produced permanently
unrepairable data. A separate backfill of the same model got the ordering right, which
made the inconsistency visible.

**How to apply:** For any immutability, lock, seal, approval, or finalized flag, ask
what happens if validation fails immediately after commit. If the answer is
"unrepairable record", move the flag to the end of the transaction. Same rule for a
correctness claim shown in UI: derive it from the measured result, never from the fact
that the write path finished.
