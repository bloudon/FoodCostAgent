# Task #1352 — Review and resolve the two location warnings

## Asked

Make the desktop and embedded-mobile location warnings actionable. Show every
unmatched current item-location line, and allow an authorized user to remove
only the two approved Bay Hill unsupported Main freezer assignments and their
untouched August count lines after a live preflight. Preserve July history,
supported August lines, count quantities, and on-hand. Production remains
operator-controlled.

## Shipped

- Both warning controls open a shared review view with item/source identity,
  locations, quantities, entry counts, reasons, eligibility, and a link to the
  exact count line. The API uses the same reconciliation classification as the
  previous-count diagnostic for the unmatched-line population.
- A manager/admin-only confirmation requires the two approved item identities,
  approved July source and historical locations, uniquely scoped mappings and
  active supported/unsupported assignments, both supported current lines, and
  zero untouched unsupported lines. It reads and rechecks under a serializable
  transaction, deactivates only the two locked assignment IDs, deletes only the
  two confirmed August line IDs, and verifies zero warnings before commit.
- Added focused eligibility/reconciliation tests, desktop/mobile component
  tests, and actual-route HTTP/transaction tests using an isolated local
  PostgreSQL clone. Updated the VPS operator handoff; no production data was
  changed.

## Deviations

Repeated confirmation returns HTTP 409 for a stale two-line preflight, without
further mutation, rather than a successful idempotency receipt. The replay
contract is documented in the operator handoff. A permissive “already resolved”
response was not introduced without a durable proof of the original action.

## Review

Reviewer: PASS WITH FOLLOW-UP — `location-independent-review`, separate
independent review workstream. Reviewed transaction, tenant and role checks,
exact mutation bounds, source evidence, and real-route regression. No blocking
finding. Follow-up: retain/document the explicit stale-confirmation contract
unless a separately designed durable idempotency receipt is approved.

QA: PASS WITH FOLLOW-UP — `location-independent-qa`, separate independent
acceptance workstream. Independently ran the isolated real-route suite,
component/unit suites, typechecks, and diff check; verified the test refuses a
shared database. Follow-up: the authorized VPS operator must verify the
serving build and live preflight before any in-app confirmation. No live
production acceptance or mutation is claimed.

Independent session/workstream separation: VERIFIED (distinct Reviewer and QA
subagents, separate from implementation).

## Tests

- `pnpm --filter @workspace/api-server exec vitest run src/services/inventory/previousCount.test.ts src/services/inventory/bayHillLocationGuard.test.ts` — 32 passed.
- `pnpm --filter @workspace/fnb-cost-pro exec vitest run src/pages/count-session.component.test.tsx src/pages/count-session-mobile.component.test.tsx` — 20 passed, one pre-existing skipped.
- `env -u NEON_DATABASE_URL STORAGE_MODE=local DATABASE_URL=postgres://runner@127.0.0.1:54329/fnb_location_test pnpm --filter @workspace/api-server exec vitest run src/routes/locationReview.integration.test.ts` — five passed, independently repeated by QA. A schema-only dump was restored into a disposable local PostgreSQL database; no fixture writes occurred on the source database. The suite hard-refuses any other database and cleans its unique fixtures.
- API and web typechecks, workspace typecheck (QA), `git diff --check`, anonymous GET/POST 401 via the running development API, and running API/web workflow logs passed. A preview screenshot confirmed the sign-in page loaded; the authenticated Bay Hill review view was covered by component tests, not a live browser session.

## Risks / Decisions

The VPS source of truth has not been checked for this release. The authorized
operator must deploy the reviewed code through the documented release process,
confirm exactly two eligible live warnings, and explicitly confirm in the app.
Do not use development UUIDs or infer that development success proves
production eligibility. Other unmatched lines remain visible but cannot use
this special removal action.

## Git

Branch: `main`
Base SHA: `e35407ae2535ea3788a2fbbf620df5350370cd10`
Final SHA: `b0e31bcaf53fc152bc5b7732794de7a7d1250acb`
Diff / PR: local diff `e35407ae2535ea3788a2fbbf620df5350370cd10..b0e31bcaf53fc152bc5b7732794de7a7d1250acb`; no PR or VPS deployment created.