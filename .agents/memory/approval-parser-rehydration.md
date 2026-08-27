---
name: Approval-time parser rehydration
description: Why reparsed source geometry must be persisted in the same approval transaction that consumes it.
---

When approval reparses immutable raw import evidence, it must persist every recovered derived field and status atomically with the resolution that consumes them.

**Why:** An in-memory reparse can create correct catalog geometry while leaving the approved source row marked unparseable. Downstream count and costing paths may then use fallback math against evidence that approval already treated as measurable.

**How to apply:** Any approval-time parser upgrade must update the staged row's complete derived contract in the approval transaction, while retaining the untouched raw source value as authority. Regression coverage should compare the persisted row, created provenance, and downstream reconciliation basis.