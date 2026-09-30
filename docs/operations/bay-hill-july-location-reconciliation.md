# Bay Hill July prior-location reconciliation

## Purpose

Preserve the development evidence needed to reproduce the July-to-August inventory
comparison correction on the VPS without copying development database identifiers.

## Confirmed behavior

- The approved July import contains resolved item/location rows with both positive
  and zero quantities.
- The July historical count session materialized only positive item/location pairs.
- Prior-count comparison may use an approved, same-company, same-store source
  batch's all-zero resolved rows as read-only evidence.
- This evidence affects comparison diagnostics only. It must not create historical
  lines, change July history, change August quantities, apply a count, or change
  on-hand.
- Before the two location corrections below, 1,050 of 1,052 warnings had exact
  approved July zero evidence. The remaining two were unsupported duplicate
  `Main freezer` assignments.

## Location corrections to preserve for the VPS

Resolve items by the VPS company/store plus stable source code and item name. Do
not copy development UUIDs.

| Source item code | Item | Supported location | Unsupported assignment |
| --- | --- | --- | --- |
| `9503` | LEMON OLIVE OIL CAKE | Front Reach-in Freezer | Main freezer |
| `0726127` | POTATO INSTANT REAL MASH DEHT | Dry Storeroom | Main freezer |

Both the approved July evidence and the supplied August 31 workbook place each item
in the supported location. The August workbook does not place either item in
`Main freezer`.

## Required VPS preflight

For each row above, stop unless all conditions are true:

1. The item resolves uniquely within the Bay Hill company/store.
2. The supported location assignment is active.
3. The unsupported `Main freezer` assignment is active and unique.
4. The target August manual session has both the supported line and the unsupported
   `Main freezer` line.
5. The unsupported line has zero quantity in every stored quantity field.
6. The unsupported line has no count entries.
7. The July historical session and its approved source batch are unchanged.

If every condition passes in one transaction:

1. Deactivate the unsupported `Main freezer` assignment.
2. Delete only its untouched zero August session line.
3. Verify exactly two assignments were deactivated and exactly two lines were
   deleted.
4. Verify prior-location reconciliation reports zero unsupported lines.
5. Verify July history, August counted quantities, and live on-hand are unchanged.

## Development result

On September 22, 2026, the guarded development transaction found exactly two
eligible assignments, deactivated both, and deleted exactly two untouched zero
August session lines. No historical or on-hand rows were changed.

## In-app resolution release handoff (operator only)

The Review and Resolve control is a separate, user-confirmed way to execute the
bounded correction above. Replit development data and previews do **not** prove
the current VPS records are eligible. Do not run a manual production SQL delete,
copy development IDs, or execute the confirmation on behalf of an operator.

1. After review and approval of the finished revision, publish it to the
   approved GitHub `main` release source through the established code-review
   process. Record the reviewed Git SHA and the SHA-256 of
   `scripts/vps/update-fnbcostpro-from-main.sh`. Do not deploy a moving branch
   without comparing the release helper's hash to the reviewed revision.
2. The authorized VPS operator, from the clean CostPro repository checkout,
   verifies the expected revision and script hash, then runs
   `scripts/vps/update-fnbcostpro-from-main.sh`. Stop on any refusal or failed
   build. Require the final structured release record to show the reviewed
   `gitSha`, `healthVerified: true`, `buildIdentityVerified: true`,
   `frontendBundleVerified: true`, and no database migration command executed.
   The first run can execute the pre-update copy of the helper; if its final
   record lacks these fields, compare the installed script to the reviewed
   version and rerun once rather than treating partial output as verification.
3. On the serving site, an authorized manager opens the **August 31, 2026**
   Bay Hill count's location-warning Review. This is a read-only preflight:
   require exactly the two named codes and locations above, both with zero
   quantity in all fields, zero entries, the July 31, 2026 historical source,
   and a clearly enabled two-line confirmation. If the warning list is empty,
   differs, or removal is blocked, stop and return sanitized evidence for
   review; never bypass the gate.
4. Only after checking that live preflight should the authorized user confirm
   the in-app action. Refresh both count views and check that the warning is
   gone, the two supported August lines remain, and July history and live
   on-hand remain unchanged. Return a sanitized result (build identity, item
   codes, before/after warning counts, number of deactivated assignments and
   deleted lines, and refusal/error if applicable), with no credentials or
   private records. A development success is not a production success.

The confirmation is tied to the two line IDs shown in the current review.
After a successful correction, submitting the same confirmation again returns
HTTP 409 (stale review) and makes no further change. Reopen Review and inspect
the current warning list rather than retrying a stale confirmation as a new
removal. This is a fail-closed replay contract, not a stored idempotency receipt.