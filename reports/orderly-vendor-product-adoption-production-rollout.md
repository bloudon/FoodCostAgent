# Orderly vendor-product adoption — production readiness and operator runbook

## Status and boundary

This package prepares the production rollout of the accepted DEV-only Orderly
vendor-product adoption. It does **not** authorize or perform any production
database access, production preview, APPLY, backup, writer stop, conflict
resolution, invoice change, price change, or July inventory work.

The production preflight command is a **read-only readiness check**, not a
production preview. It validates immutable evidence, the reviewed deployment,
database identity, property binding, schema/constraints, catalog integrity, and
catalog stability. It does not invoke the adoption classifier and does not
report CREATE outcomes.

The 112 held conflicts remain held and non-blocking. They are explicitly outside
this rollout and must not be resolved or re-opened under this package.

## Required approvals and artifacts before a real production preview

All of the following must be true before an operator may run a production
preflight, and remain true before a separately authorized production preview:

1. **Accepted DEV evidence:** retain the accepted DEV manifest, pre-APPLY
   preview, successful APPLY report, post-APPLY verification, and idempotency
   proof. The exact raw Orderly export must match the manifest's SHA-256 and
   logical source fingerprint.
2. **Exact reviewed build:** PM and engineering must identify one Git SHA, API
   package version, and build ID in the form `api@<version>:<git-sha>`. The
   production checkout must be clean and match all three. Before restart, the
   production API process must receive that exact value as `APP_BUILD_ID`; the
   preflight also queries the active API's `/api/build-info` endpoint and refuses
   if its build ID does not match the reviewed build.
3. **Migration/schema state:** the normal application migration must already be
   deployed. The preflight verifies its required tables, columns, unique binding
   constraint, Orderly mapping index, and vendor/SKU uniqueness index; it never
   creates them.
4. **Company/store binding:** PM must provide the reviewed production company ID
   and destination store ID for Orderly property `24472`. The preflight requires
   exactly one active, company-owned binding for those IDs.
5. **Database identity:** an operator must record the reviewed production
   database host, port, and database name from the planned target. The command
   compares all three to the running process target without printing credentials.
6. **Remaining #1209 browser proof:** the PM-approved browser proof that the
   selected `vendor_item_id` survives cross-shopping, alternate-vendor routing,
   and PO creation must be completed and attached to the rollout review.
7. **Verified recovery point:** before any mutation stage, an authorized
   production recovery point must be created and independently verified under
   the standard operations process. The preflight neither creates nor validates
   a backup.
8. **Writer-quiescence plan:** schedule the narrow window for the production
   preview and any later APPLY. The catalog fingerprint must stay stable across
   the preflight; if it changes, the operator must stop and reschedule.
9. **PM authorization:** the PM must authorize the exact build, scope,
   evidence-manifest hash, recovery point, and time window. Preflight success
   alone is never APPLY authorization.

## Read-only preflight command

Run only on the reviewed production deployment after the prerequisites above are
recorded. Supply absolute paths to the reviewed immutable manifest and raw
Orderly source export. Do not place source session headers or credentials in a
shell command or report.

## VPS operator scripts

Use the current pnpm-monorepo scripts, not the historical
`.migration-backup/scripts/deploy-vps.sh`. The historical script pulls a branch
and uses an obsolete npm layout; it is not an approved deployment method for
this rollout.

The reviewed application commit predates this operator tooling. Before switching
the VPS application checkout to the reviewed application SHA, transfer the three
files in `scripts/vps/` to an operator-owned directory outside `APP_DIR` (for
example, `/secure/orderly-operator-scripts`) and verify their SHA-256 values.
The approved transfer checksums are in `scripts/vps/SHA256SUMS`; run
`sha256sum -c SHA256SUMS` from the copied directory before execution.
They are deployment tools, not application source, and must not be copied into
or generated inside the pinned application checkout.

1. Run `bash /secure/orderly-operator-scripts/deploy-reviewed-orderly-preflight.sh`
   on the VPS with
   `APP_DIR`, `API_PORT`, and (when non-default) `PM2_NAME` and `VPS_ENV_FILE`.
   It refuses a dirty checkout, verifies `origin/main` is the exact reviewed
   Git SHA, installs the frozen lockfile with required build-time
   devDependencies even when `NODE_ENV=production`, builds the full workspace,
   persists the reviewed `APP_BUILD_ID`, refreshes the existing PM2 process
   environment, and confirms `/api/build-info`. It never calls `db:push`.
   Application startup performs its reviewed idempotent schema checks; the
   subsequent preflight is the structural verification that those required
   schema objects are present.
2. Export the reviewed evidence and target identity values, then run
   `bash /secure/orderly-operator-scripts/run-orderly-production-preflight.sh`.
   It invokes only the dedicated read-only production-preflight CLI and writes
   both its operator report and a credential-safe summary whose database host,
   database name, and binding identifier are hashed.
3. Return the sanitized summary to PM and stop. A passing preflight is never
   authorization for preview, APPLY, recovery-point work, writer quiescence,
   conflict remediation, or July inventory work.

```bash
NODE_ENV=production pnpm --filter @workspace/api-server run orderly:adoption-production-preflight -- \
  --manifest /secure/reviewed/orderly-vendor-product-adoption-manifest-24472.json \
  --source /secure/reviewed/allSpecsForRestaurant_24472_raw.json \
  --out /secure/reports/orderly-vendor-product-adoption-production-preflight.json \
  --expected-company-id '<reviewed-production-company-id>' \
  --expected-store-id '<reviewed-production-store-id>' \
  --expected-db-host '<reviewed-production-db-host>' \
  --expected-db-port '<reviewed-production-db-port>' \
  --expected-db-name '<reviewed-production-db-name>' \
  --expected-git-sha '<reviewed-git-sha>' \
  --expected-api-version '<reviewed-api-version>' \
  --expected-build-id 'api@<reviewed-api-version>:<reviewed-git-sha>' \
  --api-port '<reviewed-active-api-listener-port>'
```

The report must state all of the following before proceeding:

- `mode: "production-readiness-preflight"`
- `isProductionPreview: false`
- `writesExecuted: 0` and `databaseWritesExecuted: 0`
- the reviewed manifest ID/hash, source fingerprint, and approved property
  `24472`
- an active serving API build ID equal to the reviewed build ID
- one active reviewed binding
- an unchanged before/after catalog fingerprint
- zero duplicate SKU identities, duplicate Orderly mappings, and orphan or
  cross-company mappings

The output report is an operator artifact and may be written to disk. It is not
a database write. It contains hashes, counts, and credential-redacted database
identity only; it must not include raw source rows, credentials, or session
headers.

## Refusal behavior

The command fails closed if:

- it is not running with `NODE_ENV=production`;
- the checkout is dirty, unavailable, or does not match the reviewed build;
- the active serving API does not expose the exact reviewed `APP_BUILD_ID`;
- any required scope, database, build, manifest, source, or output argument is
  absent;
- the manifest hash, raw file hash, or canonical source fingerprint differs;
- the database target does not exactly match the reviewed host/port/name;
- required schema objects or indexes are absent;
- the active Orderly property binding is missing, duplicated, cross-company, or
  directed to another store;
- duplicate vendor/SKU identities, duplicate provenance mappings, or
  orphan/cross-company mappings exist in scope; or
- the catalog fingerprint changes during the read-only transaction.

See `orderly-vendor-product-adoption-production-refusal-matrix.md` for the
operator action associated with each refusal.

## Later stages — documented only, not authorized here

After a successful preflight, the later stages must happen in this order, with
fresh PM approval at each required gate:

1. **Production preview:** run the separately authorized preview against the
   actual production database during the writer-quiescence window. Its current
   classification is the authoritative production classification; preflight
   never substitutes for it.
2. **PM review:** PM reviews the exact production preview, immutable evidence
   bindings, refusal-free report, recovery point, and the exact candidate/held
   populations. No broadened scope, fuzzy matching, lifecycle interpretation,
   or held-row remediation is allowed.
3. **Bounded production APPLY:** only a separately reviewed and explicitly
   authorized production APPLY may run. It must preserve the DEV guardrails:
   exact frozen manifest, safe candidates only, drift held, no inventory/vendor
   creation outside the frozen scope, no pack overwrite, no prices/history/
   invoice changes, no fuzzy matching, no lifecycle interpretation, and no
   conflict remediation.
4. **Post-APPLY verification:** immediately compare the frozen baseline with a
   fresh production projection. Confirm exact mapping/vendor-product identities,
   unchanged forbidden domains, catalog counts, and all held rows still held.
5. **July inventory import/reconciliation:** plan and execute as a separate,
   later workstream after adoption verification. It must include source import
   validation and reconciliation; it is not part of this rollout.
