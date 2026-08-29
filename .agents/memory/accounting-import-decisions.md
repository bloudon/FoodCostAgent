---
name: Accounting import decisions
description: Durable product decisions for tenant chart imports, account references, and unassigned inventory review.
---

The chart-of-accounts onboarding work must treat the unassigned population as an operational worklist, not only an aggregate. Order the worklist by inventory value descending, with a stable secondary sort, so operators clear the highest-impact decisions first.

**Why:** Bay Hill's small set of highest-value unassigned rows accounts for most of the unresolved value; alphabetical ordering turns a ten-minute cleanup into a recurring chore.

The `999900` unassigned account should be a tenant-owned, system-managed sentinel created idempotently during the tenant's first chart setup/account import, not inferred only when a source file happens to contain that code. It is not a shared platform row or a Bay Hill template row. The importer should reserve the code and reject attempts to redefine it incompatibly.

**Why:** A predictable sentinel gives every tenant a visible, actionable destination for unresolved items and makes account counts deterministic: imported accounts plus one system sentinel.

Category-account suggestions and the recurring unassigned-item worklist are separate deliverables. Exact-name suggestions can be bounded and mostly automatic; the worklist must remain useful every month even when initial mapping is complete.

**Why:** Cutting optional mapping automation should not remove the operational surface needed to resolve new or unmapped inventory.

The company-scoped composite foreign-key migration for category/item account references must run before Bay Hill's production accounts are seeded.

**Why:** Production currently has no account rows, making the integrity migration cheaper and safer before customer accounting data exists.