# Task #1108 — Fix Bay Hill Orderly item identity

## Asked

Bay Hill's Orderly XLSX inventory import could create several FnB `inventory_items` for a single real product when that product was counted in more than one physical location (for example Chambord appearing in five bar/storage locations). Fix item identity so one source item resolves to exactly one inventory item, while preserving every per-location count row. Exported XLSX files only — the Orderly scraper/API remains on hold. The August 2025–July 2026 history must not be loaded until the importer passes this gate.

## Shipped

**Identity rule.** A reliable XLSX Item Code is authoritative *within the authorized company + Orderly source property* import context. It resolves or creates exactly one inventory item, and every source location/count row is preserved against that single item. Location, month/file, vendor, pricing, par/target, and ordinary count changes never alter core identity.

- `lib/db/src/schema/schema.ts` — `inventory_item_external_mappings` gained a required, defaulted `sourcePropertyId`. Its uniqueness moved from `(company, system, code)` to `(company, system, property, code)`, matching the existing `vendorItemExternalMappings` precedent. This stops two authorized Orderly properties in one company from colliding on the same Item Code, and keeps XLSX Item Code distinct from the Orderly API identity (`ORDERLY + sourcePropertyId + packSize.id`).
- `artifacts/api-server/src/routes.ts` — idempotent startup migration that adds the column, replaces the old company-wide unique constraint, and creates the property-scoped index/uniqueness. Legacy rows keep an empty property scope and continue to resolve as before.
- `artifacts/api-server/src/services/orderly/orderlyDomain.ts` — the mapping row is now the single identity authority inside the approval transaction. Every reliable-code resolution path (batch cache, group-wide safe existing match, manual override, confident auto-match, and new-item creation) funnels through `claimReliableCodeItemId`, which adopts an already-committed mapping, otherwise claims one via insert-first `ON CONFLICT DO NOTHING`, and on a lost race adopts the winner. Compatibility checking compares all row pairs rather than only against the first row. Added the read-only identity metric summary.
- `artifacts/api-server/src/services/orderly/orderlyCountSession.ts` — fallback mapping lookup filters by the batch's verified source property.
- `artifacts/api-server/src/services/orderly/orderlyIdentity.db.test.ts` — new DB-backed regression suite (10 tests).

**Deliberately narrow conflicts.** Only materially different product evidence, incompatible case geometry, or incompatible base units conflict. Partial-count notation (`6/6 ML`, `6/0.3 ML`, `6/0 ML`) does not. Blank-code rows stay unresolved unless a safe existing match exists — no uncertain synthetic item is invented. Same-code/different-location fan-out is reported separately from same-code/same-location duplicate source rows.

**Explicitly out of scope.** No existing May/June duplicate was merged, deleted, repointed, or otherwise remediated. Historical cleanup remains task #1109.

## Deviations

None material. Two corrections were made in response to Reviewer blocks rather than the original plan text: mapping scope was widened to include source property, and the concurrency claim was extended to cover existing-match paths, not just new-item creation.

## Review

Reviewer: PASS WITH FOLLOW-UP
QA: PASS
Independent session/workstream separation: UNVERIFIED (Reviewer) — `PROCEDURAL REVIEW — INDEPENDENCE UNVERIFIED`; QA self-reported VERIFIED for its final round having run all commands and DB queries itself, but it ran in this same workspace, so treat overall separation as unverified.

The Reviewer blocked three times before passing, and each block was a real defect:

1. **High — mapping not property-scoped.** `inventory_item_external_mappings` was company/source/code scoped, allowing same-code collisions across Orderly properties and conflation with API mappings. Resolved by the schema/migration change above.
2. **High — concurrent approvals could duplicate.** Two approvals could each observe no mapping and create an item. Resolved by the insert-first mapping claim; then re-blocked because the claim only guarded the *creation* branch, so two approvals matching the same code to two *different existing* items could still diverge. Resolved by routing every reliable-code path through the claim.
3. **High — data loss in the loser path.** The lost-race cleanup deleted the candidate item unconditionally, which could delete a *pre-existing* catalog item. Resolved by guarding the delete on `candidate.created && candidateItemId !== winner`, additionally company-scoped.
4. **Medium — `reliableCodesWithMultipleProposedItems` was hard-coded to zero.** Now derived from actual grouped resolution.
5. **Medium — conflict detection only compared against the first row.** Now all-pairs.

Reviewer follow-up (non-blocking, applied): assert both approvals are `fulfilled` in the concurrent-existing-items regression rather than only using `Promise.allSettled`, so a future failure in one approval cannot be masked. Done.

QA follow-up (non-blocking, not applied): nine `identitySummary` fields are populated in production code and exercised against the real workbook, but not directly asserted in unit tests.

## Tests

- `pnpm run typecheck` (repo root) — clean across all 5 projects.
- `cd artifacts/api-server && npx vitest run src/services/orderly/ src/routes/orderlyApprovalRoute.test.ts src/services/accounting` — **11 files, 155 passed, 1 skipped**.
- Identity suite (`orderlyIdentity.db.test.ts`, 10 tests, DB-backed) covers: five-location Chambord-style fan-out → one item + one mapping + five location records; reuse in a later month; idempotent re-import; row-order independence; conflict rejection with no inventory mutation; non-first-row-pair conflict; blank codes left unresolved; same-location duplicate metrics; same Item Code under a second authorized property → separate item; two concurrent approvals of a new code → exactly one item/mapping; two concurrent approvals matching different pre-existing items → one mapping wins and both originals survive; a mapping committed after preview is adopted.
- API workflow restarted cleanly, applied the migration, and listened on port 8080.
- Migration verified directly against the DB: `source_property_id` present (`NOT NULL`, default `''`), unique constraint now `(company_id, source_system, source_property_id, source_external_id)`, and all 2537 legacy mapping rows preserved under the `''` scope.
- Read-only preview of the real May batch `66e6b1c1-58a5-44b7-b47d-05a6c0008f16`, re-run after every change and byte-identical throughout: 4319 reliable rows / 2431 unique codes / 0 codes with multiple proposed items / 0 conflicting groups / 843 cross-location groups / 5358 location rows preserved / 1039 blank rows unresolved / 26 locations / source valuation 254,286.67. The batch remains `pending_review` and was never mutated.

One combined-run failure during testing was traced to stale fixture data (a synthetic `hii-` test company binding on source property `24472`) left by an earlier crashed run, not a regression; the fixture row was deleted and my new fixtures were renamed to a collision-proof prefix.

## Risks / Decisions

- **The importer gate is not yet cleared for history.** The May preview shows 2431 proposed new items with `reliableCodesWithoutPackSizeReconciliationEvidence: 2431` and `existingItemResolutions: 0` — this batch would seed the catalog from scratch. Loading the August 2025–July 2026 history stays blocked pending Product Owner sign-off.
- **Existing May/June duplicates remain in the data.** Task #1109 owns that remediation. This fix stops new duplicates; it does not repair old ones.
- **Legacy mappings sit under the `''` property scope.** They resolve exactly as before. If a legacy mapping is ever needed under a bound property, it must be re-scoped deliberately.
- **Independence is unverified.** Reviewer and QA both ran in this workspace. A genuinely separate review session is advisable before loading history.
- Blank-code rows (1039 in May) stay unresolved by design and will need human resolution or a later safe match.

## Git

Branch: `main`
Base SHA: `40088beeaf1998e2d80f322f85c7d2b9833afe50`
Final SHA: pending commit of this task's changes
Diff / PR: local working tree — `artifacts/api-server/src/routes.ts`, `artifacts/api-server/src/services/orderly/orderlyDomain.ts`, `artifacts/api-server/src/services/orderly/orderlyCountSession.ts`, `lib/db/src/schema/schema.ts`, and new `artifacts/api-server/src/services/orderly/orderlyIdentity.db.test.ts`
