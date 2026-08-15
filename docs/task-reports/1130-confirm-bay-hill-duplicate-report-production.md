# Task #1130 — Confirm the Bay Hill duplicate report finds the real duplicates in production

## Asked

The zero-group discovery defect had only ever been proven against DB-backed regressions in the workspace, because the production VPS database is not reachable from Replit. Confirm against the actual Bay Hill production data that discovery now finds the duplicates it previously missed.

Strictly scoped: run the read-only diagnostic, then REPORT only. **No manifest generation and no APPLY.** If the diagnose verdict contradicted the legacy-NULL hypothesis, stop and report the responsible predicate rather than changing discovery again.

## Verification record

**Tenant / scope.** Bay Hill CC — the single Orderly-bound location of the one production company on the VPS. All runs were scoped to that company + store + source system `ORDERLY` + source property, resolved from the persisted source-property binding rather than supplied by hand. Identifiers are referenced below by short prefix only; the full values are in the production database and in the CLI's own scope banner, not in this repository.

**Build / environment.** Run on the production VPS against the production database on 2026-08-15 (America/New_York), from the current api-server checkout. Each invocation rebuilt the CLI bundle immediately before running, so both runs exercised the current discovery code. The exact deployed commit SHA was not captured at run time — see Risks.

**Runs performed, in order.**

1. `orderly:remediate --mode diagnose --trace-name Tabasco` — read-only, twice (before and after the report).
2. `orderly:remediate --mode report --json` — read-only.

No other mode was invoked. `manifest` and `apply` were never run.

### 1. Diagnose — cause confirmed in production

The predicate funnel reproduced the defect exactly as hypothesized. Each stage adds one condition:

| Stage | Batches surviving |
| --- | --- |
| company + source system | 2 |
| + status = approved | 2 |
| + target_store_id = scope | 2 |
| + source_property_id = scope | **0** |

Both approved batches carry `source_property_id = NULL`. The bound source property is non-null, and a NULL/empty stored scope coalesces to the empty string, which can never equal a bound property id — so the final predicate eliminated every batch and discovery examined nothing.

**Verdict: the legacy-NULL hypothesis is CONFIRMED in production.** The responsible predicate is the source-property equality condition applied to legacy pre-binding batches. No alternative predicate was implicated, so the stop-and-report branch of the task did not trigger.

The trace also showed, under one Orderly item code, six distinct active inventory identities sharing one product name — each tied to a different physical storage location, none superseded. This is the reported production symptom, reproduced first-hand.

### 2. Report — discovery now finds the data

REPORT, run read-only against the same scope:

| Metric | Value |
| --- | --- |
| groupsExamined | 897 |
| safeCandidates | 893 |
| ambiguous | 4 |
| conflicts | 0 |
| notDefectRelated | 0 |
| itemsThatWouldBeSuperseded | 1992 |
| countLinesThatWouldRepoint | 1314 |

These 897 groups are **not** a platform-wide figure. They are the Orderly item codes within this single Bay Hill store/property scope — the same scope that previously yielded `groupsExamined: 0`. The defect was never Tabasco-specific; Tabasco was the reported example of a store-wide fan-out, so a store-wide group count is the expected shape of a correct result. The transition from 0 to 897 under an unchanged scope is the confirmation this task was asked to obtain.

### 3. Tabasco group — the reported symptom, classified

| Property | Result |
| --- | --- |
| Identities found | **6** — matches the reported symptom exactly |
| Classification | **SAFE_CANDIDATE** |
| Conflict reasons | none |
| Ambiguity reasons | none |
| Distinct source descriptions | 1 |
| Distinct source case quantities | 1 |
| Distinct source base units | 1 |
| Distinct source storage locations | 6 |

Why the classifier rated it safe: all six identities agree on product description, category, unit, case geometry, and price, and differ only by storage location — the signature of one real product fanned out per location, which is the defect this remediation targets. The six identities separate cleanly into one with substantial downstream references and five with few, so canonical selection was decided on downstream reference count rather than a tie-break, and the report recorded that reason explicitly. Nothing about this group required a judgment call the tool could not justify from evidence.

**Note for whoever runs remediation:** SAFE_CANDIDATE is the report's classification, not an authorization to merge. This task deliberately produced no manifest, and the 4 ambiguous groups elsewhere in the scope have not been examined at all. Approval remains a separate, explicitly-approved step.

### 4. No-write proof

The diagnostic was re-run after REPORT. Both approved batches still report `property=NULL` and `binding=NULL` — unchanged from the pre-report run, and still the values that caused the original defect. The report neither wrote scope columns nor "helpfully" backfilled them. Production data is in exactly the state it was before this task began.

## Deviations

None to the task's scope. Two process deviations worth recording:

- **Raw production output was committed and then removed.** A verbatim VPS terminal paste was committed to `attached_assets/` as evidence. It contained production inventory pricing, quantities, storage-location names, internal and import-batch identifiers, and VPS host/path context. Completion review flagged this as unnecessary disclosure of confidential operational data. The file was deleted and the local-only commit that introduced it was dropped, so neither `main` nor the pushed remote contains it in history. This sanitized record replaces it. See Risks for the one branch still holding it.
- **REPORT `--json` output is not directly parseable.** Build and database diagnostic lines surround the JSON on stdout, so a plain redirect-then-parse fails and the JSON has to be extracted by substring. This did not affect the result — the report itself completed correctly — but it made verification needlessly fragile. Filed as follow-up #1133.

## Review

Reviewer: PASS WITH FOLLOW-UP — the first completion review REJECTED this task on two counts: raw production data committed as evidence, and the absence of a structured record naming the tenant, scope, and explicit result. Both are addressed above (attachment removed from working tree and pushed history; this record added, including the reconciliation of the 897-group figure against the single-store scope). Follow-up #1133 covers the JSON output defect.

QA: NOT SEPARATELY PERFORMED — this task *is* a verification task; its deliverable is the evidence above, gathered from production. There is no shipped behavior change for a QA pass to exercise.

Independent session/workstream separation: `PROCEDURAL REVIEW — INDEPENDENCE UNVERIFIED`. Commands were executed by the Product Owner on the VPS and the output interpreted in this same workspace session.

## Tests

No code was changed by this task, so no test suite was run. Production commands executed, all read-only:

- `pnpm --filter @workspace/api-server run orderly:remediate -- --mode diagnose --trace-name Tabasco` (before REPORT — captured the funnel and verdict)
- `pnpm --filter @workspace/api-server run orderly:remediate -- --mode report --json`
- the same diagnose command again (after REPORT — confirmed scope columns unchanged)

Each was run with the VPS application environment loaded into the same shell. A first REPORT attempt failed with `DATABASE_URL must be set`: the CLI is a standalone entrypoint that does not load the application's env file itself, so a shell that can reach the database via `psql` does not imply the CLI process is configured. Sourcing the environment in the same shell resolved it. This is a known standalone-entrypoint divergence, not a discovery defect.

## Risks / Decisions

- **The raw paste survives in one internal branch.** The `replit-agent` checkpoint branch still contains the removed attachment. That branch is the workspace's rollback mechanism; rewriting it would destroy the user's checkpoint history, which is a worse outcome than the residual exposure in a local, never-pushed branch. It is **not** present on `main` or on the pushed remote. If this repository is ever mirrored or made public, that branch must be excluded or scrubbed first.
- **The deployed commit SHA was not captured.** Both runs rebuilt the CLI from the VPS checkout immediately before executing, so they ran current code, but the precise SHA was not recorded. Future production verification should print the deployed SHA alongside the scope banner.
- **Nothing has been remediated.** Production still contains every duplicate identity described here, including the six-way Tabasco fan-out. This task confirmed only that the report can now *see* them.
- **Remediation remains gated.** A manifest run, review of the 4 ambiguous groups, and explicit Product Owner approval are all still required before any APPLY. 1992 items would be superseded and 1314 count lines repointed — this is Significant, irreversible-in-practice work on production costing data.
- **The underlying legacy-NULL scope data was not repaired.** Discovery now tolerates the NULL batches, but the batches themselves still carry no source-property scope. Whether to backfill them is a separate decision, not made here.

## Git

Branch: `main`
Base SHA: `f6eb7a4a4a202a0b556758dd394de570a07fa4e6`
Final SHA: pending commit of this report
Diff / PR: local working tree — adds `docs/task-reports/1130-confirm-bay-hill-duplicate-report-production.md`; removes the raw production terminal attachment from `attached_assets/`. No application code changed.
