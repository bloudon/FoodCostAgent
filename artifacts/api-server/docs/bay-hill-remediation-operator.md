# Bay Hill duplicate remediation operator procedure

This procedure is for the production operator on the VPS. Deploying this code
does not run remediation automatically. Do not run any command from this
procedure until the normal application deployment is complete and the service
health check is clean.

The CLI is hard-locked to Bay Hill CC's approved scope:

- Company: `43abaf82-44ce-4231-9570-7a01e7c85ced`
- Store: `ee9e1530-50db-45f4-ae61-2c45e86827f0`
- Source system: `ORDERLY`
- Source property: `24472`

The operator cannot override this scope with command-line arguments.

## 1. Preflight — read-only

Run this after normal deployment and a clean application health check:

```bash
pnpm --filter @workspace/api-server run orderly:remediate -- --mode preflight
```

It verifies the active Bay Hill source-property binding and the required
production tables, columns, indexes, and constraints with SELECT-only queries.
`PRECONDITION_FAILED` means the normal application migration/deployment must be
corrected before continuing. The remediation command never creates or alters
schema.

## 2. Report — read-only

Run only after preflight passes:

```bash
pnpm --filter @workspace/api-server run orderly:remediate -- --mode report --json > bay-hill-report.json
```

Send the complete `bay-hill-report.json` to the Product Owner for review. Do
not approve AMBIGUOUS or CONFLICT groups. There is no report-and-apply command.

## 3. Manifest — no database mutation

After Product Owner approval of the exact source Item Codes from the reviewed
report, create a manifest. Substitute only the reviewed codes and a traceable
approval identifier:

```bash
pnpm --filter @workspace/api-server run orderly:remediate -- \
  --mode manifest \
  --report bay-hill-report.json \
  --approve <comma-separated-approved-source-item-codes> \
  --manifest-id <product-owner-approval-id> \
  --out bay-hill-approved-manifest.json
```

This writes a local manifest file but does not change the database. The
manifest is bound to the reviewed report and its unapproved remainder.

## 4. Apply — explicit production mutation

This stage is not authorized by readiness work alone. Immediately before any
eventual apply, verify a current production PostgreSQL recovery point/backup.
Then rerun preflight and use only the reviewed manifest:

```bash
pnpm --filter @workspace/api-server run orderly:remediate -- --mode preflight
pnpm --filter @workspace/api-server run orderly:remediate -- \
  --mode apply \
  --manifest bay-hill-approved-manifest.json \
  --operator <production-user-id> \
  --confirm-production-apply
```

Apply rejects a missing operator, missing confirmation, missing or stale report
binding, changed unapproved groups, unapproved source Item Codes, or a failed
preflight. There is no `apply-all-safe` command.

## 5. Reconcile — read-only verification

After a successful approved apply, run:

```bash
pnpm --filter @workspace/api-server run orderly:remediate -- --mode reconcile
```

Review the May and June valuation checks and confirm that no SAFE_CANDIDATE
groups remain before loading further historical data.