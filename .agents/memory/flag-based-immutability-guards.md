---
name: Flag-based immutability guards
description: Why a record-level "this is immutable" flag is inert on pre-existing rows, and how to enumerate the mutation paths it must cover.
---

# Flag-based immutability guards

When immutability is expressed as a column on a record (rather than as a
separate table or a status transition), two failure modes recur.

## 1. The guard is inert on every row that predates it

A migration that adds the flag with `DEFAULT 0` leaves existing rows unprotected.
The rows that most need the protection are usually the ones that already exist —
they are why the feature was requested. Shipping the guard without deciding what
happens to them means the feature is provably correct in tests and provably
absent in production.

**Why:** an Orderly historical-snapshot guard passed every test and covered every
route, while the single real snapshot in the database still had the flag at 0 and
remained fully appliable.

**How to apply:** treat the backfill as part of the feature, not cleanup. Decide
explicitly, before calling the work done, whether pre-existing rows are
backfilled, re-created through the new path, or documented as unprotected — and
get that decision from the owner when a standing instruction says not to alter
the existing records.

## 2. Route-by-route wiring misses the non-obvious mutation paths

Grepping for the obvious verbs (apply / edit / delete / clear) finds the CRUD
routes and misses the ones that mutate as a side effect: bulk scan-apply,
image-scan endpoints with an `applyToLine`-style option, importers, and
reconciliation jobs.

**Why:** two mobile scan routes wrote count-line quantities without ever calling
the shared guard, because neither route name contained an edit verb.

**How to apply:** enumerate mutation paths by what they *write*, not by what they
are called — search for the storage/update helpers themselves (e.g. the atomic
increment and line-update functions) and confirm every caller passes the guard.
An independent reviewer catches this reliably; self-review does not.
