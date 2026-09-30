# Bay Hill — remaining count-setup evidence review

**Scope:** the 90 unresolved IDs from the September 23, 2026, 200-item worklist after the 110 confirmed whole-case items were configured in development. The [item-by-item decision register](bay-hill-remaining-count-review-2026-09-28.csv) is the deliverable; this document explains its evidence and decisions. This was a **read-only development review**. No inventory, count, supplier, invoice, or production rows were changed.

## Reconciliation and limits

The read was taken against the workspace development `neon-serverless` target (`helium/heliumdb`) inside one repeatable-read, read-only transaction. Bay Hill CC was uniquely identified, and the active Orderly source-property binding `24472` belonged to that company. All 200 snapshot IDs still belong to Bay Hill. Exactly 110 have the reviewed whole-case configuration (`EA`, one canonical unit per package, one package per case, label `whole case`, matching unit identity); the other **90** are the rows in the accompanying CSV. The CSV is keyed by item ID, not item name.

For the 90, the current name, canonical unit, Orderly pack strings, and source-property scope match the September 23 CSV. Case quantities match within the stored REAL precision; the register preserves both the exact snapshot text and the live numeric value rather than claiming byte-for-byte equality (six decimal values differ slightly from the snapshot after storage). The original CSV did **not** contain operational geometry, so it cannot prove that all operational fields have been unchanged since that date. Today **89** of the 90 have no numeric operational count geometry and display the generic `package` label; **Asst Lays Chips** is the exception, already configured in development as 60 individual bags per case. The earlier staff-confirmation claim appears in the Harvill triage, but the database configuration alone does not prove today's physical case; reconfirm it before any new decision. Its three July historical lines still say one case and 30 EA each. Configuration is not historical reconciliation.

The review inspected 274 bound item-source mappings, 128 supplier-item records, 332 saved count lines (123 with stored case/container/loose parts), 615 approved May–July imported inventory rows and linked historical invoice lines for the 90 (none). Supplier `verified` geometry and an approved historical inventory row describe retained purchase/count evidence, **not proof of today's physical counting pack**. A prior [Harvill's invoice triage](../attached_assets/Pasted--Bay-Hill-Count-Setup-Review-Triage-Source-bay-hill-cou_1790216194697.txt) describes older produce invoices; those invoices are not linked to these items in the development invoice tables. Its SKU/pack claims are shown in the register as secondary historical evidence, not a current approval. The 110 configured items were not subjected to a new production or signed-in count test here.

| Remaining group | Items | Disposition |
| --- | ---: | --- |
| Historical `1/1 Case` holds | 8 | Hold pending interpretation of saved package/loose parts; the whole-case decision cannot silently rename them. |
| Conflicting source packs | 64 | One already has a 60-bag **development configuration** and an earlier staff-confirmation claim but unresolved older lines (Asst Lays); three equal-total EA items are **candidates only** for operator confirmation (BONNE-MAMAN HONEY MINI, Corona - Light - Bottled, Stella Artois - Bottled); 60 need pack/container resolution. |
| Other opaque `Case` expressions | 13 | Hold: `12/10 Case`, `1/200 Case`, etc. do not establish an inner physical unit. |
| Source-unit / pack-geometry issues | 5 | Four `0/0` expressions lack valid size; Pepperoni has an apparent `2/5 LB` source pack but conflicting stored geometry and an older count-unit mismatch. |
| **Total** | **90** | **No new item was approved for application by this review.** |

The earlier triage identified ten pairs with compatible *total* quantity. Three EA examples above support a possible individual-unit count, but still require current-pack confirmation; for the other seven, matching totals do not tell staff whether to count one large package or multiple smaller ones. Do not close physical count setup from equivalent totals alone. Four conflicts mix `1/1 Case` with a measurable alternative: Bunny Luv BB Carrots (`1/15 LB`), CAMILLE DE LABRIE (`6/1 750ML`), Gatorade G2 (`1/24 EA`), and Twinings English Breakfast (`1/25 EA`). The latter two have canonical case quantity **one EA** while the measured alternatives say 24 or 25 EA: the stock-unit identity itself needs operator confirmation.

## Eight historical-count holds, first review

All eight still have canonical EA, case quantity one, only `1/1 Case` source mappings, and generic unconfigured package geometry. Their July 31 imported count lines have **no count-pack snapshot**. The parts below are *raw saved fields*, not current whole-case units; the source tiers in the CSV show why their meaning needs an operator.

| Item | July 31 saved parts | Question before current setup |
| --- | --- | --- |
| Anniversary Chocolate | 0 cases + 0.75 container; 0.75 EA saved | Source uses `Pack 0.75` in July versus `Case 0.75` earlier. Was that ¾ of the same whole case or a different inner pack? |
| BIALE ZINFANDEL BLACK CHICKEN | 0.25 loose; 0.25 EA saved | Source placed 0.25 in its third tier named `Case`; was it a fractional case or a bottle/other loose unit? |
| CAPPUCCINO CREAMER Busy bean | 4 cases/4 EA in one location; 1 container/1 EA in another | Source says four `Case` plus one `Pack`. Is `Pack` a whole case or a distinct smaller unit? |
| CURVED GREEN PETALS DUO, WHITE CHOCOLATE, 160 PCS | 0.5 container; 0.5 EA saved | Source moved from 0.5 `Case` in earlier months to 0.5 `Pack` in July. Verify what was physically counted; the name's `160 PCS` is not permission to convert history. |
| DUCKHORN MERLOT NAPA VLY 22 75 | 1.25 cases/1.25 EA and 0.41 loose/0.41 EA | Verify whether the 0.41 third-tier `Case` was fractional whole-case stock or loose bottles; do not reinterpret the 1.25-case line. |
| Deco Blooming heart | 0.5 container; 0.5 EA saved | Source changed 0.5 `Case` to 0.5 `Pack`. Ask what `Pack` represented. |
| LA MASSA IGT TUSCAN RED 2021 (94V, 94RP) | 0.08 loose; 0.08 EA saved | Source's third tier is called `Case`, but the saved line is loose. Determine the intended physical unit. |
| Praline Croquatine | 1 container; 1 EA saved | Source changed one `Case` to one `Pack`. Confirm whether these describe the same stock unit. |

The later August 31 manual zero-quantity lines have no package-part breakdown; they do not settle July semantics. Preserve all stored quantities, units and valuation even if an operator later confirms a new **current** whole-case method.

## Priority for Bay Hill

1. **Resolve saved-count interpretation:** show the eight July rows above, plus Asst Lays' three one-case/30-EA lines, to the people who counted them. Record what each original `Case`, `Pack` and loose entry meant **at the time**. A current standard does not retroactively fix a historical line.
2. **Resolve the highest-risk pack identities:** the four mixed opaque/measurable conflicts, the five source-unit/geometry issues (particularly Pepperoni's five saved **OZ** lines against today's **LB** item), and cases where one source pack implies a different canonical total. Ask for current supplier/SKU, a delivery label or physical package, number of countable inner units, and the total in the stock unit.
3. **Confirm the quick EA candidates:** for BONNE-MAMAN, Corona and Stella, confirm that an individual EA is the unit staff physically count and whether the current standard cases contain 60, 24 and 24 each respectively. They are **not** authorized for automatic setup from this report.
4. **Walk the remaining vendor packs and 13 other opaque cases:** confirm physical container size and case composition, including whether a case expression denotes cases-within-cases. Keep alternative supplier/source packs as historical evidence; do not use supplier `verified` geometry alone to pick today's standard.

Only after a separately documented operator decision should a **new bounded development dry run** propose item-level geometry for specifically confirmed IDs. It should check the active company/property binding, current canonical unit and case quantity, all supplier/source alternatives, and saved count-unit/part conflicts again, print every proposed old/new value, and require a fresh authorization before applying. A production rollout and signed-in web/mobile count acceptance remain separate decisions.

### Register columns

The CSV retains snapshot and live source-pack identities, live item count method, supplier geometries and source IDs, earlier Harvill triage where available, every saved non-null count-part line with its official count date and unit, line-unit mismatches, and the latest approved import's source count tiers. Its `fact_needed_or_safe_next_step` column is a question for an operator, **not** an approved conversion. Imported inventory dates are inventory-period dates; the line creation timestamp was not used as the business date.

## Independent review

| Workstream | Result | Evidence and limit |
| --- | --- | --- |
| FnB QA | **PASS WITH FOLLOW-UP** | A separate reviewer independently reconciled 200/110/90 in a read-only development query; verified the 90 unique IDs and 8/64/13/5 partition; checked the eight July count holds, Asst Lays and Pepperoni. No changed UI or API flow required a browser run. A fresh isolated QA environment was not verified. |
| FnB data-integrity reviewer | **PASS WITH FOLLOW-UP** | A separate reviewer found no unsafe unit invention or release of a historical hold, and confirmed that supplier geometry, old invoices, and catalog totals are not treated as present-day pack approval. This was an artifact review, not an independent production/database audit. |

Both reviewers asked for the snapshot/live decimal precision and the distinction between Asst Lays' existing development configuration versus staff confirmation to be made explicit. Those clarifications are incorporated above and in the register. No subsequent database change was made.