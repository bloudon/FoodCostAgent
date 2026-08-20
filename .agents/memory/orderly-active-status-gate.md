---
name: Orderly active-status gate
description: Why Orderly packSize isActive cannot yet drive FnB vendor-product activation.
---

Do not translate Orderly `packSize.isActive` into FnB `vendor_items.active`
until its source semantics are independently evidenced and PM approves the
mapping.

**Why:** The reviewed source export reported `isActive=false` for every
packSize, including relationships whose matching historical Harvill purchase
codes have recent invoice activity. That proves the field cannot safely be
treated as a self-explanatory discontinued/current-purchasing signal.

**How to apply:** Keep active status outside the identity/adoption manifest.
Use a read-only status overlay bound to the frozen packSize identities. Before
any APPLY, require source/Product evidence defining the status, preserve
existing FnB active state for mapping-only changes, and fail closed rather than
defaulting newly created vendor products to active.