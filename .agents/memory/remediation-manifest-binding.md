---
name: Evidence-led data remediation (report → approve → apply)
description: Durable rules for remediation tools that separate a reviewed read-only report from a mutating apply step, learned from the Orderly duplicate-identity repair.
---

Applies to any tool that finds damaged data, has a human approve specific fixes, then
mutates. The pattern is deceptively simple and most of the failure modes below looked
correct in review before they were traced.

## Bind approval per-item, and bind the remainder separately

A manifest needs a hash per approved item **and** a hash of the groups it does *not*
approve — never a single whole-report hash.

**Why:** applying an approved item changes the whole-report hash by design, so validating
against it turns every legitimate rerun or resume into a false "stale report", while
comparing a whole-report hash to one item's hash never matches and silently becomes dead
code. The unapproved remainder is the part untouched by a legitimate apply, so it isolates
exactly the third-party drift approval was granted against: a new problem appearing in
scope, or a change to something the reviewer deliberately declined.

**How to apply:** check the remainder hash once before processing anything, so a stale
manifest mutates nothing; treat a missing hash as a manifest error, never a pass.

## Hash the values, not the row counts

Binding built from reference counts cannot see an in-place edit — the count is unchanged,
so a stale approval still validates and the apply runs against evidence nobody reviewed.
Fold the actual merge-relevant values into the hash.

The trap is doing this partially. Hashing *some* values (say, the collision-sensitive
config) while leaving others as bare counts leaves exactly the same hole for the fields
that were missed: quantities and costs on the rows being moved, the valuation derived from
them, and the source facts that justified the operation. Enumerate everything the report
*shows the reviewer* and everything the mutation *will touch*, and bind all of it —
per-row identity plus values, not aggregates.

**How to test it:** an edit that keeps the operation valid is the only meaningful case. If
the edit also flips a classification or trips a compatibility rule, the stop proves nothing
about the hash — the test passes with the binding removed. Verify each such test actually
fails when you revert the binding.

## Scope every reference through the SAME provenance chain

A scope check is only as strong as its weakest table. If one reference type is validated
through the full chain (company + source system + source property + target store) and
another is validated by store alone, the weak one is the whole boundary — mutation moves
rows by entity id, and the entity is usually company-level, so nothing downstream catches
it. Two source properties feeding one store is a legitimate configuration, not an edge case.

Fail closed on unprovable provenance: join to the authoritative source row and reject when
the join fails (left join + `IS NULL`), so a missing, dangling, or foreign-system link stops
the operation instead of being assumed in-scope.

Copy the discovery predicate *whole*. If discovery only considers approved/active source
records, the mutation-time scope check must require the same status — otherwise the tool
mutates rows it would never have shown the reviewer, which is the exact definition of
unreviewed evidence. Reconstructing "the same" filter by hand from the column list is how
the status clause gets dropped; diff it against discovery's predicate field by field.

**How to test it:** the fixture must put the out-of-scope reference on an item the operation
would actually mutate. A foreign-property *noise* row that no candidate touches exercises
nothing — it passes with the check removed.

## Lock the rows whose VALUES you bind, not just the rows you rewrite

`SELECT ... FOR UPDATE` on the parent entity does not lock its dependent rows. Updating a
child row's own columns (a count line's qty, a conversion factor, a par level) neither
touches nor locks the parent it points at, so such a writer walks straight through a
parent-only lock, commits after the under-lock recheck has read the old values, and gets its
new values consumed as though reviewed.

Lock every table whose values the approval hash covers, in a fixed table order with
`ORDER BY id`, so overlapping runs queue instead of deadlocking. Row locks still cannot lock
a row that does not exist, so pair them with SERIALIZABLE to cover phantom inserts. Map
SQLSTATE 40001 to the staleness stop code and do NOT auto-retry — a retry re-derives and
re-applies without a human re-reading the changed evidence.

**How to test it:** race tests with `Promise.all` are not deterministic enough to prove this.
Drive the interleaving with a second pooled connection holding an open transaction: BEGIN +
UPDATE, start the operation, let it block on the lock, then COMMIT. Target a row that is read
as evidence but never mutated, or the mutation path will incidentally lock it and the test
will pass for the wrong reason.

## Re-derive under the lock, then use *that* snapshot

Once you re-read evidence under the lock, the pre-transaction object is dead weight —
mutating and auditing from it reintroduces the staleness the recheck just closed, and the
audit records numbers from before an edit the recheck accepted. Pass the locked snapshot
into the mutation and the audit.

## A unique key is not a merge key

Matching a unique constraint proves two rows *collide*, not that they *agree*. Merge only
after comparing the columns the constraint does not cover; stop on any disagreement.

**Why:** the columns left out of a unique key are usually the ones carrying meaning —
conversion factors, par levels, primary/active flags. Dropping the loser because the key
matched discards deliberate configuration, and for conversion factors silently changes
every downstream cost.

**How to apply:** for each merge path, diff the table's unique columns against its full
column list and compare the remainder. Exclude only values the repair itself recomputes
(e.g. an on-hand quantity derived from repointed history) — comparing those would stop
nearly every real group. Use a small relative epsilon for float columns; NULL equals only
NULL.

## The audit row is a mechanism, not a log

When discovery reads audit rows back to recognize already-repaired items, the audit insert
must be inside the mutation transaction.

**Why:** consolidation destroys the provenance discovery matches on, so a repaired item
disappears from discovery entirely. If the mutation commits and the audit insert fails,
the repair exists but is untracked — unresumable and unreconcilable. Conversely, discovery
that does not read those rows back reports a rerun as drift instead of a no-op.

**How to apply:** mutation + valuation + success audit in one transaction; write the
*failure* audit row afterwards, outside it, so stops survive the rollback.

## Verification must reuse the discovery scope

A post-apply check has to filter on exactly the predicates that defined the remediated
set. A looser filter folds in unrelated data — reporting a mismatch for rows never in
scope, or masking a real error with unrelated value, which defeats the check entirely.
Diff the verification WHERE clause against discovery's; seed fixtures with in-window noise
so a loosened filter fails loudly.

## Scope locks must pin the field that selects the data

A production lock omitting the field that determines *which* data is touched is not a
lock. Pin every scope field, and make "not yet authorized" refuse everything rather than
act as a wildcard.

## Discovery scope does not constrain mutation scope

Scoping which *rows become candidates* says nothing about which *rows get written*. If
the repair then rewrites references by entity id alone, it reaches every tenant, store, or
property that shares the entity — approval for one property silently mutating another.

**Why:** the entity being repaired is usually at a broader level (company) than the
approval (one property at one store), so the same row legitimately carries references
belonging to scopes nobody approved.

**How to apply:** for each reference table, ask what provenance column it carries
(store id, source system/property, or a parent batch to join through). Assert every one is
inside scope before mutating, and *stop* on anything outside rather than filtering it out
— a half-merged entity whose remaining references still point at the old id is worse than
an untouched one. Tables with no provenance are scope-free by construction; say so
explicitly rather than leaving it ambiguous. Test by seeding a second property/store on an
in-scope duplicate and asserting those rows survive untouched.

## Validating outside the transaction validates nothing

A freshness or hash check that runs before the mutating transaction leaves a window: a
concurrent writer can add a reference after the check and the repair sweeps it up as
though it had been reviewed.

**How to apply:** lock the candidate rows (`SELECT ... FOR UPDATE`) as the first statement
*inside* the transaction, then re-derive the evidence under those locks and re-run the same
drift check. A concurrent writer must then either land before the lock (and be caught by
the recheck) or block until the transaction ends. Prove it with two genuinely concurrent
applies of the same approved manifest — assert exactly one mutates and history landed
once. A test where the second write happens before apply is caught by the *outer* check
and does not exercise the lock at all.

## Supersede, never delete; repoint, never rewrite

Move history by changing only the owning foreign key — quantities, costs, dates,
locations, and batch identity stay untouched. Deactivate and link duplicates instead of
deleting them.

**Why:** an earlier merge utility here grouped by normalized names, aggregated and deleted
history, and hard-deleted duplicates, which makes valuation unreproducible and the repair
unauditable. Names are never a safe identity key.

**How to apply:** when two legitimate rows would collide, stop the group with no partial
mutation. Prove rollback with a DB-backed test — a mock cannot demonstrate it.

## Migrations verified only against the DB that already has the objects

DDL applied by hand and then "verified" against that same database proves nothing; the
check passes even if the migration is empty.

**How to apply:** make the DDL a callable module and run it against a scratch schema
containing only the bare prerequisite tables, then assert the objects exist and accept the
row shapes the service writes. Also unwrap driver errors through `cause` before storing
them — otherwise the audit trail fills with full SQL dumps and keyword classifiers miss.
