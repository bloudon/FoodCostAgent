---
name: Bay Hill July location cleanup
description: VPS handoff constraints for the final two unsupported July-to-August location assignments.
---

The VPS correction must preserve July history and resolve items by company/store,
stable source code, and item name rather than development UUIDs.

The two approved corrections are:

- `9503` LEMON OLIVE OIL CAKE: keep Front Reach-in Freezer; remove Main freezer.
- `0726127` POTATO INSTANT REAL MASH DEHT: keep Dry Storeroom; remove Main freezer.

**Why:** Approved July evidence and the supplied August 31 workbook agree on the
supported locations. The extra Main freezer lines were untouched zero lines with
no count entries in development.

**How to apply:** Follow
`docs/operations/bay-hill-july-location-reconciliation.md`. Fail closed unless the
VPS preflight proves the same identities, active assignments, duplicate session
lines, zero quantities, and no entries. Never copy development UUIDs or mutate
July history/on-hand.