---
name: Bay Hill production identity
description: Historical Bay Hill identifiers must not be reused as current tenant targets; production identity must be verified from the live company and source binding.
---

# Bay Hill production identity must be re-established

An earlier forensic record associated Bay Hill history with company
`43abaf82-44ce-4231-9570-7a01e7c85ced` and store
`ee9e1530-50db-45f4-ae61-2c45e86827f0`. That was historical evidence, not a
safe current-tenant identifier.

Production identity verification later found the current Bay Hill Country Club
tenant was company `f8134d5a-bb3d-44c4-95bb-973ee471e04f` with store
`9197ad56-a51f-4980-8bac-bb39172afc04`. That company was subsequently purged
atomically, including its remaining count, unresolved evidence, and import
rows.

**Why:** Production contained multiple company IDs associated with historical
and current Bay Hill-related evidence. The live company row and active
`ORDERLY` property `24472` binding are the authoritative identity checks; old
reports and pasted operator output are not sufficient targets for destructive
work.

**How to apply:** After re-onboarding, query the current company and active
`ORDERLY`/`24472` binding together before any historical import. Treat the
re-onboarded company ID as the only valid target; do not reuse either
historical company ID above.
