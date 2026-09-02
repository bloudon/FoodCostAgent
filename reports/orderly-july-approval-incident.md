# July Orderly approval incident — read-only evidence and recovery decision

## Status

**RECOVERY BLOCKED PENDING THE CHECKSUMED VPS READ-ONLY REPORT.**

The attached operator summary reports that the July 31, 2026 approval resolved
5,496 of 5,518 rows and excluded 22 rows worth $2,353.30:

```text
$251,946.45 resolved/importable
+  $2,353.30 unresolved
= $254,299.75 source snapshot

5,496 resolved rows
+  22 unresolved rows
= 5,518 source rows
```

Those figures are internally exact, but they are not a substitute for querying
the serving VPS database. The older row-level captures in `attached_assets`
predate approval and describe a different preview population (985 held rows and
77 valid `create_variant` decisions). They must not be relabeled as the final
22-row or 333-fork evidence.

No delete, re-upload, approval, count-session creation, APPLY, decision reset,
or other July mutation was performed while producing this report.

## Required production evidence

The authorized production operator must run:

```bash
cd /home/administrator/apps/CostPro/fnbcostpro
sha256sum scripts/vps/run-orderly-july-incident-readonly.sh

scripts/vps/run-orderly-july-incident-readonly.sh \
  '49d087c5-8e33-4bdc-ae06-821f71d2d231' \
  '<reviewed-company-uuid>' \
  '/home/administrator/orderly-evidence/july-approval-incident.sanitized.json'
```

Return only the sanitized JSON and the script SHA-256. The command:

- reads the database selected by the live `fnbcostpro` PM2 process;
- requires the exact approved Orderly batch and July 31 inventory date;
- opens a PostgreSQL `READ ONLY` transaction and rolls it back;
- emits `writesExecuted: 0` and `databaseWritesExecuted: 0`;
- omits product descriptions, source codes, and decision targets, and hashes
  only the high-entropy batch/company UUIDs;
- never prints the connection string; and
- hard-stops without invoking approval, count-session, or remediation paths.

The report is accepted only when all `verificationGates` are true. It writes a
sanitized refusal record for review but exits non-zero when any gate fails.
Empty output, a timeout, a dirty checkout, a missing completed approval job,
schema drift, or any mismatch is a stop condition—not permission to broaden the
query.

## What the report proves

### Source and value reconciliation

The output independently derives authoritative source value from the persisted
`raw_data["Total Cost"]` source-evidence cell, not the parsed convenience
column. It reports:

- declared and persisted source rows;
- resolved and unresolved row/value totals;
- resolved plus unresolved totals; and
- the exact residual after both parts are subtracted from the source.

The reported headline is confirmed only if it reproduces 5,518 / 5,496 / 22,
$254,299.75 / $251,946.45 / $2,353.30, and a zero residual.

### The 22 unresolved rows

`unresolvedRows` must contain exactly 22 row-indexed entries. Each entry includes:

- authoritative source value;
- saved-decision state and effective `leave_unlinked` outcome;
- a derived hold reason;
- source pack evidence;
- bounded same-property candidate evidence; and
- whether immutable raw source evidence remains and whether a historical
  session links it.

The report deliberately omits product descriptions, source codes, and targets.
Raw production rows belong outside version control.

Current behavior is intentional: an unresolved approval row keeps its persisted
source evidence but receives no `resolved_inventory_item_id`. It is therefore
excluded from item-linked totals. If a historical count session exists, the
unresolved-evidence link is the mechanism that preserves its value in the full
historical snapshot. This diagnostic proves source-evidence presence; it does
not recompute the application’s evidence hash or independently prove that the
JSON never changed.

### The reported 333 forks

“333 forks” is not a defined database counter. The report keeps these separate:

1. approval job `itemsCreated`;
2. saved `create_variant` decision rows;
3. distinct reliable source-code groups represented by those decisions;
4. distinct resolved items for those decision rows;
5. source-code mappings and mappings created during approval; and
6. distinct pack-variant pairs (two symmetric relationship rows per pair)
   confirmed during the approval window.

The values must not be forced to equal one another. One reliable code can span
many location rows, one item can satisfy many rows, and each variant pair has
two relationship edges. `inventory_items` has neither `created_at` nor
`source_batch_id`, so exact per-item creation provenance cannot be reconstructed
from the item table. The completed approval job's `itemsCreated` result is the
authoritative creation counter; mappings and relationships are corroborating
evidence, not substitutes.

### Downstream state and live effect

The report inventories:

- distinct resolved catalog items;
- vendor items tied to those items and vendor items carrying this batch as the
  price-source reference;
- Orderly external mappings;
- inventory-location assignments;
- source-linked historical count sessions and their snapshot totals;
- whether any source-linked session was applied; and
- current non-zero on-hand among the resolved store items.

Approval itself creates or links catalog/vendor/location/store relationships and
stores row resolutions. New store-item rows start at zero; approval does not
apply a count. An applied source-linked session proves an application occurred,
but later inventory activity prevents the report from isolating a presently
July-attributable on-hand effect. Current non-zero on-hand alone does not prove
July caused it.

## Recovery options

### Option 1 — preserve July and perform bounded remediation (recommended)

Preserve the approved batch, raw source rows, decisions, mappings, and any
historical session. Prepare a reviewed manifest containing only the 22
unresolved row identities and their approved canonical targets or explicit new
variants. Amend the historical snapshot through a purpose-built, audited,
idempotent path; do not rerun approval.

**Risks:** wrong candidate links, double-counted value, mutating an immutable
historical session, or creating duplicate catalog/vendor-pack identities.

**Idempotency:** bind the manifest to batch hash, row evidence hashes, decision
revision, target IDs, and the exact pre-state. Record one audit result per row;
a rerun must produce zero new mutations and the same totals.

**Verification gates:** all read-only gates pass; exactly 22 rows/$2,353.30 are
in scope; every row has one reviewed outcome; resolved plus retained unresolved
value remains $254,299.75; catalog/mapping/pack uniqueness holds; historical
session lines and unresolved links reconcile under lock; on-hand is unchanged
unless separately and explicitly authorized.

### Option 2 — append a corrective batch/session

Leave July untouched and append a clearly labeled correction containing only
the omitted evidence.

**Risks:** duplicate July reporting, ambiguous period ownership, downstream
reports summing both records incorrectly, and accidental on-hand application.

**Idempotency:** one correction identity per original row/evidence hash, one
source-period binding, and a uniqueness guard that prevents a second correction.

**Verification gates:** correction is visibly linked to July; no source row is
represented twice; combined July plus correction equals $254,299.75; reports
have an explicit rule for including the correction; correction remains
historical/unapplied unless a separate live adjustment is authorized.

### Option 3 — explicitly authorized rollback and rebuild

Delete/revert every July-derived object and rebuild from the preserved source
and reviewed decisions.

**Risks:** highest risk. Approval writes span rows, catalog items, vendor items,
mappings, relationships, locations, store links, and possibly a historical
session. Shared or subsequently referenced entities may no longer be safely
attributable to July. Partial rollback can destroy provenance or leave dangling
references.

**Idempotency:** a reviewed reverse manifest must enumerate every object and
reference, prove exclusive July ownership, define restore points, and make both
rollback and rebuild independently rerunnable.

**Verification gates:** pre-mutation counts and backups; no later references;
exact reverse manifest; dry-run and under-lock revalidation; rollback design;
explicit Product Owner authorization; post-rebuild 5,518/$254,299.75
reconciliation; zero duplicates; all downstream reports and on-hand unchanged
except where explicitly approved.

## Recommendation

Choose **Option 1: preserve July plus bounded remediation**, but do not implement
it until the VPS report is reviewed and a 22-row signed manifest exists. It has
the smallest mutation surface and preserves the strongest evidence. Option 2 is
acceptable only if reporting semantics can make the correction unambiguous.
Option 3 should remain a last resort because exact rollback attribution is not
available on every table.

This recommendation is not authorization to mutate production.

## Recurrence controls

1. Change every approval-time “Leave unlinked” explanation to say:
   **“Preserve this source row as evidence, but exclude it from item-linked
   import and count totals until it is resolved.”**
2. Before approval, show unresolved row count, unresolved authoritative value,
   resolved value, source value, and the exact reconciliation equation.
3. Approval must fail closed when resolved plus retained-unresolved value does
   not equal source value, or require a signed acknowledgment bound to the batch
   hash, decision revision, row/value impact, actor, and timestamp.
4. Count-session creation must repeat that gate against persisted lines and
   unresolved evidence links under the same transaction before granting
   historical immutability.
5. Persist approval provenance for created inventory items (batch/audit
   identity and creation time) so a future incident can reconcile exact item
   creation without inference.

## Conclusion

The observed $2,353.30 difference is consistent with unresolved rows being
excluded from item-linked totals, not deleted. The 333 headline cannot safely be
called “333 variants” until the completed approval result, decision groups,
mappings, and symmetric pack relationships are reconciled by the production
report. Recovery remains blocked until that zero-write evidence is returned.