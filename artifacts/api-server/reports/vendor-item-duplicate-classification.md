# Gate 1 Classifier Report — Duplicate vendor catalog rows (READ-ONLY)

Generated: 2026-08-18T21:12:42.748Z · database: heliumdb · **no writes performed**

## Pack-equivalence contract used
```
Two vendor_items rows have EQUIVALENT pack geometry iff ALL normalized fields agree:
  1. purchase_unit_id            — exact match (same unit row).
  2. total units per case        — case_size * coalesce(inner_pack_size, 1),
                                   compared with relative tolerance 1e-9.
  3. canonical_qty_per_purchase_unit
                                 — both NULL, or both non-NULL and equal within
                                   relative tolerance 1e-6. NULL-vs-value is
                                   treated as a CONFLICT but flagged as
                                   normalization-sensitive (the group's class
                                   could change if geometry were derived).
  4. pricing_basis               — normalized (NULL -> 'purchase_unit'), exact.
  5. is_variable_weight          — normalized (NULL -> 0), exact.
  6. pack_uom                    — normalized lower(trim()); raw differences with
                                   equal normalized value are COSMETIC and ignored
                                   (counted in the report).
Raw pack-string differences alone never create a conflict (rule 6).
Price fields (last_price, last_case_price, price_source, priced_at,
normalized_price_per_canonical_unit) are DIAGNOSTIC ONLY and never part of
pack equivalence or identity.
Protected operational fields for Class E: active, brand_name (normalized
lower/trim; differing non-null values conflict; NULL never conflicts).
```

## Totals
| Metric | Value |
|---|---|
| Total vendor_items | 8867 |
| Duplicate groups | 2431 |
| Excess rows | 6207 |
| Companies affected | 1 |

## Classification
| Class | Groups | Excess rows | Disposition |
|---|---|---|---|
| A — exact duplicate purchasing identity | 2412 | 6144 | AUTO-MERGE CANDIDATES |
| B — same SKU, conflicting pack geometry | 19 | 63 | HOLD |
| C — NULL/blank SKU (null=0, blank=0) | 0 | 0 | HOLD except 0 authoritative-identity groups |
| D — conflicting external/source mappings | 0 | 0 | HOLD |
| E — protected config disagreement | 0 | 0 | HOLD |

Class C shadow classes (what each would be if SKU-less-ness were ignored): {}

## PM amendment metrics
| Metric | Value |
|---|---|
| Class A groups with differing price snapshots (diagnostic only, still A) | 0 |
| Class A groups with cosmetic raw-pack (pack_uom) differences | 0 |
| Groups whose class depends on normalization assumptions (null-vs-value canonical qty) | 19 |
| Additional groups that would merge under SKU trim/uppercase (NOT applied) | 0 |

## Harvill's Produce
| Metric | Value |
|---|---|
| Duplicate groups | 118 |
| Class A groups | 99 |
| Class A rows | 272 |
| Proposed deletions (Class A only) | 173 |
| By class | {"A":99,"B":19} |

## Reference inventory (dynamically enumerated, fail-closed)
DB/schema columns holding vendor_items ids (bucket 1):
- `historical_invoice_lines.vendor_item_id` — total rows: 770, held by would-be losers: 0
- `inventory_item_price_history.vendor_item_id` — total rows: 823, held by would-be losers: 0
- `po_lines.vendor_item_id` — total rows: 59, held by would-be losers: 0
- `po_routing_audit.source_vendor_item_id` — total rows: 0, held by would-be losers: 0
- `po_routing_audit.vendor_item_id` — total rows: 0, held by would-be losers: 0
- `receipt_lines.vendor_item_id` — total rows: 55, held by would-be losers: 0
- `vendor_invoice_import_lines.resolved_vendor_item_id` — total rows: 742, held by would-be losers: 0
- `vendor_item_external_mappings.vendor_item_id` — total rows: 3, held by would-be losers: 0

Repo-level soft references (bucket 2): Repo audit found no confirmed persistence of vendor item ids into JSON/jsonb payloads. One conditional site: edi_messages.payload_json (normalized PO serialization) — verify PO payload shape before Gate 2 apply.

Audit/provenance columns (bucket 3 — stored IDs without FK semantics, repointed not dropped):
- `po_routing_audit.vendor_item_id`
- `po_routing_audit.source_vendor_item_id`
- `inventory_item_price_history.vendor_item_id`
- `historical_invoice_lines.vendor_item_id`
- `vendor_invoice_import_lines.resolved_vendor_item_id`
- `vendor_item_external_mappings.vendor_item_id`

## Merge proposal (Gate 2 — HOLD, pending PM approval)
| Metric | Value |
|---|---|
| Mergeable groups (A + authoritative C) | 2412 |
| Proposed survivors | 2412 |
| Proposed deletions | 6144 |

Survivor rule: authoritative external mapping target → most downstream references → vendor_items has no created_at column; deterministic tiebreak after external-mapping and reference-count rules is the lexicographically smallest id.

## Recommended uniqueness constraint
HOLD any (vendor_id, inventory_item_id, vendor_sku) uniqueness: 19 non-Class-A duplicate groups with real SKUs exist (B=19, D=0, E=0); a strong constraint would forbid rows PM has not yet ruled on. Recommend deciding B/D/E disposition first, or a narrower constraint excluding those groups.

## Held group samples (B/D/E, first 20)
- [B] Harvill's Produce Co., Inc. · sku="letgsm" · 10 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="letromhrt" · 8 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="CUCE" · 6 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="pepgrlb" · 6 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="BERSBD" · 6 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="tom4540" · 6 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="tomtoy" · 6 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="BEANGRSN" · 4 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="MELCL" · 4 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="PINEGRP" · 4 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="POTYUKB" · 4 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="PEPRD" · 4 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="HERBCIL6" · 2 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="grawh2" · 2 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="LETGRM" · 2 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="PARITAL6" · 2 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="ONISWLB" · 2 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="SHALPLGL" · 2 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)
- [B] Harvill's Produce Co., Inc. · sku="STAREA" · 2 rows — pack geometry conflict: canonical_qty_per_purchase_unit (null-vs-value)

**STOP. No writes, no uniqueness constraint, no insert-path refactor until PM approves Gate 2.**
