# Supplier replacement approval acceptance — 2026-09-25

## Scope and environment

**QA result: PASS.** Independent browser/session separation: **VERIFIED** (fresh QA administrator and manager browser contexts). Architecture/security reviewer result: **not assessed by QA**.

Tested against the running **development** web preview and API, using the development PostgreSQL database. No production endpoint or production database was used. A uniquely named isolated QA company, its store, administrator, store manager, inventory item, and two verified supplier products were created for this test. The item was assigned to its QA store, and both supplier products had dated current-price observations so they appeared in the web approval form. The fixture used 12 canonical units for the predecessor pack, 24 for the replacement pack, and a currently configured case of 24 units. All fixture writes were limited to the QA company.

## Browser acceptance

| Check | Evidence | Result |
| --- | --- | --- |
| Authenticated company administrator approves a verified replacement through the actual item-detail web form | Selected QA-OLD → QA-NEW, effective **2026-09-24**, basis “QA isolated supplier notice confirms replacement,” with current-counting-standard confirmation checked. The new entry rendered after submission (browser evidence `x2ev1e`). | PASS |
| Decision survives a full page reload | Exactly one `confirmed-pack-transition` element showed **09/24/2026 · Operator-recorded replacement**, both SKUs, and the supplied basis. The current standard showed “Operator transition recorded for 09/24/2026; past counts remain unchanged.” (browser evidence `3fcyre`). | PASS |
| Store manager has read-only access | Logged in as a separate QA manager in a fresh browser context. The dated decision and current standard were readable, but the approval form was absent: zero “Record verified replacement” buttons, zero inputs, and zero selects within the supplier history card (browser evidence `ee3cfo`). | PASS |

The initial isolated fixture did not render the item detail because it had no selected-store assignment. Once assigned, it rendered read-only because neither supplier product had a dated current-price observation. Both fixture omissions were corrected only on the QA rows, and the same browser tester then completed the approval successfully. These were fixture prerequisites, not changes to application code.

## Authenticated API acceptance

Used separate **real login/session-cookie** requests for the QA company administrator and store manager, then POSTed to `/api/inventory-items/:id/pack-history/transitions` for the QA item. Checked both HTTP status and returned error text:

| Request | Expected/observed |
| --- | --- |
| Manager attempts a company-wide decision | **403**, “Company administrator access required” |
| Administrator supplies impossible calendar date `2026-02-30` | **400**, valid effective date required |
| Administrator supplies future date `2099-01-01` | **400**, “Replacement date cannot be in the future” |
| Administrator attempts to confirm the 12-unit pack against the configured 24-unit case | **422**, replacement does not match current counting standard |
| Administrator repeats the approved same-day predecessor/replacement pair | **409**, replacement already recorded |
| Administrator submits the reverse, contradictory pair for the same date | **409**, replacement already recorded |

After these requests, authenticated GET `/api/inventory-items/:id/pack-history` returned **200**, exactly **one** transition dated `2026-09-24`. A database count restricted to the QA company also returned **one** transition. Thus the denied and conflicting submissions created no second decision. The successful write was made by the browser form; the API and database readbacks independently checked its persisted result.

## Cleanup and isolation

Before cleanup, a transaction checked the QA company's unique identity and its single expected transition. Scoped deletes removed **4** QA auth sessions, **1** transition, **2** supplier items, **2** vendors, **1** store-item assignment, **1** inventory item, **1** user-store assignment, **2** QA users, **1** QA store, and **1** QA company. The transaction committed, and a final query across the QA company, users, stores, inventory items, vendors, and transitions returned **0 remaining rows**. No Bay Hill or other company identifier appeared in a mutation predicate; no production records were accessed or changed.

## Regression and blocking findings

The administrator's reload persistence, manager's read-only history, current-standard label, role rejection, date validation, mismatch rejection, and same-day uniqueness were checked. **No blocking product findings.** This is an executed acceptance report, not a claim that the journey is automatically rerun on future changes.