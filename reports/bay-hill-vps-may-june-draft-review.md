# Bay Hill May/June count drafts — VPS read-only review

**Status (September 29, 2026):** The operator ran the read-only query on the VPS and confirmed it reached `ROLLBACK`. Sections A/B and all 4,851 section-C lines were supplied and reconciled. No agent VPS connection, production write, conversion, or historical correction was performed. The output is operator-supplied evidence, not independent verification of the connection's environment/build. **Do not apply either draft on the strength of this review.**

## Confirmed from the operator's sections A/B

| Period | Official count date | Session | Applied | Batch | Persisted lines | Nonzero lines | Lines with saved parts | Approved source rows |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| May | 2026-05-31 | `a454cf0a-dba2-46b5-b191-06ae67fb55e6` | 0 | `cdcfeead-8fa4-4b84-a3b8-9e8b0fa62c55` | 2,512 | 2,512 | 2,512 | 5,358 |
| June | 2026-06-30 | `af1bea97-b199-4864-9968-dacd03d3d1a8` | 0 | `1be3bb58-c7c7-4091-b749-6bc64724fe4b` | 2,339 | 2,339 | 2,339 | 5,409 |

Both session rows say `ORDERLY`, `is_historical_import=1`, and link via `source_batch_id` to an approved `ORDERLY` batch with the same date, company and store. The operator's output scoped them to Bay Hill CC and store `9935864e-8904-4a93-9ea5-b11702960a8b`. **The May batch has a blank `source_property_id`; June has `24472`.** The absence of May property metadata requires separate binding/provenance confirmation; do not silently interpret a blank as property `24472`. Neither session has been applied, but both contain saved lines: they cannot be treated as empty drafts.

## Row-level findings

The private row-level register, `bay-hill-vps-may-june-row-findings-private.csv`, is **not committed**: it contains source/line IDs and unit findings, but omits item names, locations, counts and prices. It is produced by `scripts/review-bay-hill-count-drafts.py` from the operator's private section-C output. Every line has a linked-batch, same-store, same-period, same-item, normalized-location candidate. 4,848 have exactly one source row; three have two and were compared as aggregate source groups. There are no orphan saved lines in this bounded candidate set. This does **not** establish that every approved source row produced a line.

| Row-level classification | May | June | Interpretation |
| --- | ---: | ---: | --- |
| Source quantity and all three parts equal saved line | **2,512** | **2,339** | `NULL` compared with `NULL` as such, not silently changed to zero; numeric comparisons use 0.01% relative tolerance (minimum 0.0001) for stored REAL precision. Includes three aggregated groups. |
| Explicit dated measured source unit differs from saved unit label | **853** | **778** | **1,631 declared-unit discrepancies**. Pack/tier arithmetic reproduces raw and parsed source totals, but the same number was saved under a different unit label. No conversion was applied or authorized. |
| Explicit dated measured source unit agrees with saved label | **594** | **575** | **1,169 numerical/declared-unit continuities**, not certification of physical counting method, valuation, source binding or permission to apply. |
| Source unit/tier meaning cannot be established | **1,065** | **986** | **2,051 unverified lines**: opaque/unparseable packs, missing/contradictory tier units, or pack arithmetic inconsistent with the raw source total. Do not infer correct identity merely from the matching saved number. |
| **All persisted lines** | **2,512** | **2,339** | **4,851**; classification buckets are disjoint and complete. |

The largest declared mismatches are `LB → oz` (470 May, 446 June), `LT → ml` (198, 155), `GAL → ml` (131, 125), `QT → ml` (25, 27), and `KG → oz` (17, 16). These describe *labels*, not authorized conversion factors. This review did **not** check saved unit cost, extended value, application to on-hand, or any post-count activity. Do not conclude a value loss or prescribe multiplication from these counts.

Selected row traces (source parts → saved parts shown as case/container/loose):

| Period, source row index / saved line | Dated source evidence | Saved line | Disposition |
| --- | --- | --- | --- |
| May row 4108 / `1a33cb75-e4dc-4ce9-98cf-c857c24ceb4c` | Cheese - American Yellow Sliced, Cafe; `4/5 LB`, Case/Pack/LB, `1/0/0`, total **20 LB** | `1/0/0`, **20 oz** | Measured source LB versus saved oz; numeric parts and total intact. |
| June row 4147 / `0901f398-e5ed-4af6-8bdb-d7b6c811e52d` | Same item/location; `1/5 LB`, `1/0/0`, total **5 LB** | `1/0/0`, **5 oz** | Separate June pack and same declared-unit discrepancy; May geometry is not June geometry. |
| May row 4014 / `83b69e77-1e66-41d7-b3e2-a5b9ac34dcf6` | Pepperoni, Bay Window; `2/5 LB`, `0.2/0/0`, total **2 LB** | `0.2/0/0`, **2 oz** | Declared-unit discrepancy; leave fractional part unchanged. |
| June row 4115 / `54601b69-1eb0-4bef-bb48-391a20ae6160` | Asst Lays Chips, Cafe; `1/60 EA`, `1/0/0`, total **60 EA** | `1/0/0`, **60 ea** | Numeric and explicit-unit continuity for this dated 60-bag pack, not approval of a current counting standard or July's 30-bag source. |
| June rows 4561 + 4768 / `d6f5693e-200e-4d53-8bc4-7326ab68253b` | Coriander - Ground, Dry Storeroom; `1/14 OZ`, source parts `0/0/0 + 2/0/0`, total **0 + 2** | `2/0/0`, **2 oz** | Aggregated parts/total agree; `2 × 14 OZ` does not reproduce the source total of 2, so unit meaning remains unverified. |
| June row 5027 / `8e28ae8e-2cc6-450f-ac4f-52561ac027b3` | Anniversary Chocolate, Pastry Shop; `1/1 Case`, `0.75/0/0`, total **0.75** | `0.75/0/0`, **0.75 ea** | Opaque Case tier cannot certify a physical EA. |

**Method and limit:** This compares only persisted approved source rows matched by batch ID plus company/store/date/item and normalized storage location, then the raw source pack/tier/total evidence against the saved line's unit and parts. `scripts/review-bay-hill-count-drafts.py` rejects incomplete output, duplicate lines, unexpected batch/session IDs and missing source candidates. For multiple source rows, it sums the three parts and total before comparison; it does not invent a separate saved line per source row. It requires positive geometry **parsed from the dated pack string**, consistent dated tier labels for positive tiers, raw/parsed source total agreement, and source-pack arithmetic before calling a measured unit explicit; the parser's stored geometry fields were not included in the operator extract. Agreement does not imply current package geometry is right. Three-way `NULL`/zero comparisons are preserved. The operator SQL does not export price/value, and the VPS schema lacks `count_pack_snapshot`: these cannot be certified here.

## PM/operator decisions

1. **Hold both unapplied drafts from unit-based reliance or count application** pending row-level review of the 1,631 explicit label discrepancies and 2,051 interpretation-needed lines. Use the private register's session/line/source-row IDs to locate the original dated evidence. Do not overwrite, relabel or scale any historical quantity to make labels agree.
2. Confirm the May batch's missing property metadata through separate operator evidence of its original property `24472` and destination authorization before treating its linkage as complete. The matching store and approved status alone do not prove property ownership.
3. Establish the original count basis and cost-per-unit meaning with PM/operator for each disputed row. Review implications for saved costs, downstream reports and on-hand before **separately authorizing** any correction. The 1,169 agreeing rows are not blanket approval of the sessions.

The [September 28 development reconciliation](bay-hill-historical-count-unit-reconciliation-2026-09-28.md) found 408 approved May/June source rows in its 90-item cohort but no **batch-linked** May/June sessions **in development**. This VPS evidence is a different database/population and supersedes *only* any attempt to extrapolate its absence-of-lines claim to the VPS. An older operator attachment, `attached_assets/Pasted--Section-A-May-June-batches-and-sessions-scope-identifi_1787019786705.txt`, describes *different, applied* May/June sessions from an earlier import; its date, scope and applied state cannot certify the current drafts.

## Reproduction and evidence handling

The operator used [the bounded SQL](bay-hill-vps-may-june-draft-readonly.sql) with the VPS `DATABASE_URL`. It uses a repeatable-read, read-only transaction and ends with `ROLLBACK`; do not use a development database or provide credentials to Replit. Confirm the query's company, store, session dates and batch metadata in sections A/B before interpreting C. The first attempt stopped because the VPS schema did not yet have the optional `count_pack_snapshot` column; the revised SQL omits it and completed. No import, approval, count application, or update command was invoked. The raw terminal export remains private; do not commit it.

To recreate the private row register from the operator's section-C file (outside version control):

```sh
python scripts/review-bay-hill-count-drafts.py PRIVATE-SECTION-C.txt \
  > reports/bay-hill-vps-may-june-row-findings-private.csv
```

The private input and derived register are ignored by git. The latter contains row IDs and label/part comparison flags, without prices, names, locations or quantities; it must still be handled as private operational evidence. A correction, if proposed, requires separate explicit authorization and downstream impact review. The new creation guard in `artifacts/api-server/src/services/orderly/orderlyCountSession.ts` is not retroactive.