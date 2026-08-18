# Gate 2 Post-Merge Invariant Report — vendor-item duplicate merge

Applied: 2026-08-18 · database: heliumdb (dev) · CLI: `vendorItemDuplicateMergeCli.ts --apply --expect-db heliumdb`

## Preflight results
| Check | Result |
|---|---|
| Preflight 1 — Class B promotion | 19 of 19 groups promoted B→A. Every group's non-null canonical qty was re-derived deterministically (`computePackGeometry`, status `parsed`) from the NULL rows' own pack evidence and matched within 1e-6. **Remaining held B: 0.** No geometry was copied. |
| Preflight 2 — EDI payloads | edi_messages table is empty (0 messages). Proposed loser ids present: **NO**. Code audit: payloads are only listed/fetched whole, never parsed to dereference vendor-item ids. |

## Apply results (authorized per group by under-lock evidence only)
| Metric | Value |
|---|---|
| Groups applied | 2,431 |
| Groups already remediated | 0 |
| Groups stopped | 0 |
| Rows deleted | 6,207 |
| References repointed (all tables) | 0 — under-lock recheck confirmed losers held zero references, matching Gate 1 |
| Drift vs Gate 1 expectations | none (2,431 groups = 2,412 A + 19 promoted B) |

Every group ran in its own transaction: `SELECT … FOR UPDATE`, full reclassification under lock (promotions re-proven under lock), reference repoint + conservation verification through the tx handle, loser deletion verified, audit row written to `vendor_item_merge_audit` (idempotency anchor).

## Post-merge verification
| Check | Result |
|---|---|
| Remaining duplicate groups (full reclassification) | **0** in every class (A/B/C/D/E) |
| Remaining held B groups | 0 |
| Harvill's vendor items | 354 → **118** (expected ~118) |
| Idempotency | Second `--apply` run: 0 duplicate groups found, 0 applied/stopped, counts unchanged |
| Zero-orphan verification | **PASS (no merge-caused orphans)** — the CLI now verifies this reproducibly by intersecting every dangling reference id with the merge-audit loser lists. 38 distinct legacy dangling ids remain (12 historical_invoice_lines, 37 price-history, 1 po_line, 1 receipt_line reference rows); none were touched by this merge — they pre-date the audit-anchored era. Reported separately, flagged for disposition. |

## Constraint recommendation (text only — NOT applied, per PM instruction)
```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS vendor_items_vendor_item_sku_uniq
  ON vendor_items (vendor_id, inventory_item_id, vendor_sku)
  WHERE vendor_sku IS NOT NULL AND btrim(vendor_sku) <> '';
```
- All duplicate groups with real SKUs are resolved, and post-merge data satisfies this index (verified by the zero-duplicate reclassification).
- NULL/blank-SKU rows deliberately remain unconstrained (PM: NULL-SKU behavior must not be broadened).
- To be added only in the separate, PM-approved invariant task, together with the shared get-or-create insert path.

## Machine-readable evidence
- `reports/vendor-item-duplicate-merge-report.json` (latest run)
- `vendor_item_merge_audit` table: one row per applied group (survivor, losers, class at apply, promotion proof reason, refs repointed)
