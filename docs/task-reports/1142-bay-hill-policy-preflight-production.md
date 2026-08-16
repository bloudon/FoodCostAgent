# Task #1142 — Confirm Bay Hill legacy-scope policy preflight in production

## Asked

Run the approved, read-only legacy-scope policy preflight on the production VPS against the unchanged Bay Hill Batch 1 manifest. Do not regenerate the manifest, run APPLY, run reconciliation, repair mappings, or alter provenance. Stop after returning the production evidence.

## Shipped

The production VPS executed the new `policy-preflight` mode against the unchanged manifest `bay-hill-batch1-2026-08-15`. The run completed all 848 groups and returned a passing policy decision with zero remediation writes.

### Sanitized production verification record

- **Tenant / scope:** Bay Hill CC, scoped to the exact approved company, store, source system `ORDERLY`, and source property `24472`.
- **Manifest:** `bay-hill-batch1-2026-08-15`.
- **Policy:** `bay-hill-batch1-legacy-scope-adoption`.
- **Groups evaluated:** 848.
- **Groups authorized:** 848.
- **Groups blocked:** 0.
- **Scoped legacy batches:** 2.
- **A_LEGACY_MISSING_SCOPE mappings:** 932.
- **B_DEMONSTRABLY_FOREIGN mappings:** 0.
- **C_AMBIGUOUS mappings:** 0.
- **Mappings authorized by the legacy policy:** 932.
- **Blocked source external IDs:** none.
- **Remediation writes:** 0.
- **Policy authorization binding:** passed.
- **Manifest SHA-256 before and after:** `64570b455c2ec84c4a03c2d85b5a83f171570314550b3111766c793f01289756`.

The aggregate counts reconcile to the one approved Bay Hill scope and the expected production evidence: every group is authorized only through the exact code-owned policy binding, with all 932 mappings classified as Class A and no Class B or C evidence.

## Deviations

None from the approved PM sequence. One initial invocation used a manifest path relative to the repository root; the package-filtered command runs from `artifacts/api-server`, so that attempt stopped at file loading with ENOENT before any database evaluation or mutation. The successful retry used the absolute manifest path. The manifest checksum remained unchanged.

## Review

Reviewer: PASS WITH FOLLOW-UP — the implementation review independently confirmed the code-owned policy, fail-closed default, Class B/C blocking, mixed-group blocking, and shared preflight/APPLY validator. Follow-up: keep exhaustive per-binding and fail-closed regression coverage before any future APPLY authorization.

QA: NOT SEPARATELY PERFORMED — this was a production read-only verification task with no new application behavior shipped during the VPS run.

Independent session/workstream separation: PROCEDURAL REVIEW — INDEPENDENCE UNVERIFIED. The production command was run by the operator on the VPS and the evidence was interpreted in this workspace session.

Blocking status: NOT BLOCKED.

## Tests

- `pnpm --filter @workspace/api-server run typecheck` — passed.
- Focused Orderly DB suites — 36 tests passed.
- `pnpm --filter @workspace/api-server run build` — passed.
- Full API suite — 1,649 passed, 1 skipped.
- Independent authorization review — PASS WITH FOLLOW-UP, not blocked.
- Production `policy-preflight` — completed 848/848 groups; zero writes.

Deliberately not executed: `--mode apply`, `--mode reconcile`, manifest regeneration, or any mapping/provenance repair.

## Risks / Decisions

- The PM-approved sequence now passes its production read-only gate.
- This result is evidence that the exact unchanged manifest is authorized for the exact policy population; it is **not** an APPLY authorization by itself.
- Any future APPLY still requires a fresh explicit Product Owner authorization, and the exhaustive binding regression follow-up should be completed first.
- The production build commit SHA was not captured in the operator output; the result is attributed to the current VPS checkout used for the run, not to a recorded immutable SHA.

## Git

Branch: `main`
Base SHA: `e8955ee8de80ade1e0afdc0064c7046c8cda12b5`
Final SHA: pending commit of this report
Diff / PR: local working tree — adds this sanitized production verification record; no production data or manifest changes.
