# Bay Hill Remediation — Batch 1 Manifest (generation only, NOT applied)

## Manifest identity

| Field | Value |
| --- | --- |
| Manifest ID | `bay-hill-batch1-2026-08-15` |
| Manifest file | `reports/bay-hill-batch1/bay-hill-batch1-manifest.json` |
| Manifest file SHA-256 | `64570b455c2ec84c4a03c2d85b5a83f171570314550b3111766c793f01289756` |
| Source report hash | `4eec609ca3d1bc34c8ac2aa4e0d292920f95df62b502a9af77978e4114dd501e` |
| Unapproved-remainder hash | `a20be1dc5c099bfc42f49b3924bb797bdb3d149ef4fa4f02a9619739ecee792a` |
| Report version | `1.0.0` |
| Per-group hashes present | 848 of 848 |

The manifest was produced by the repository path
`--mode manifest --report <accepted report> --approve <848 codes> --manifest-id bay-hill-batch1-2026-08-15`.
No database changes were made.

## Approved population

| Metric | Value |
| --- | --- |
| Approved groups / source Item Codes | **848** (848 unique) |
| Canonical item count | 848 canonical selections, 808 distinct inventoryItemIds |
| Superseded item count | 1,901 (1,809 distinct) |
| Count-line repoints | **1,259** |
| Affected count locations | 2,508 |
| Affected count sessions | 2,356 |
| May expected valuation delta | **$0.00** |
| June expected valuation delta | **$0.00** |
| Aggregate expected valuation delta | **$0.00** (0 groups with a non-zero delta) |

Deltas were confirmed two independent ways: from the sanitized detail CSV
(806 May-present groups, 807 June-present groups, all $0.00) and by re-deriving
before/after valuation directly from the accepted report (max absolute
per-group delta 0.000000).

Note on canonical distinctness: 808 distinct canonical identities across 848
groups is expected — several source codes converge on the same canonical FnB
item (for example both Snapper free-text codes pointed at one canonical item,
though both are held from this batch).

## Exclusion confirmations

- All **45 held SAFE groups are absent** from the manifest (verified by set
  membership, not by count alone).
- All **4 AMBIGUOUS groups are absent**: `10149134`, `7468556`, `7023177`,
  `9021845`. None of the four ever appeared in the SAFE population.
- Every approved group is classified `SAFE_CANDIDATE` in the accepted report.

Held list: `reports/bay-hill-batch1/batch1-held-safe-codes.txt`
Approved list: `reports/bay-hill-batch1/batch1-approved-codes.txt`

## Production scope (unchanged)

| Field | Value |
| --- | --- |
| Company | Bay Hill CC |
| companyId | `43abaf82-44ce-4231-9570-7a01e7c85ced` |
| storeId | `ee9e1530-50db-45f4-ae61-2c45e86827f0` |
| sourceSystem | `ORDERLY` |
| sourcePropertyId | `24472` |

The manifest carries the report's own scope object and passed the CLI's
Bay Hill production-scope guard.

## How the 44-group exclusion set was determined — REQUIRES PO CONFIRMATION

The decision said to use the exact reviewed list rather than reconstructing it
from prose. **No independent-review artifact containing the exact 44 identities
exists in this workspace.** Every uploaded file and generated review file was
searched; none contains the list.

Rather than reconstruct from prose, the set was derived deterministically from
the accepted report, and the derivation reproduces the decision's arithmetic
exactly:

- **A. Free-text source identity — 39 groups.** Exactly 39 of the 893 SAFE
  source Item Codes contain whitespace, i.e. they are product/description text
  rather than a code/SKU (e.g. `black grouper fillets`,
  `crawfsh tail mt 150-200ct wild mediteranean caught`). The count matches the
  decision's 39 with no tuning, and the set contains both named Snapper
  descriptions: `snapper american fillets` and
  `snapper american fillets use 6up sk/off pbo`.
- **B. Noncanonical sibling mapping — 7 named, 5 distinct additions.** The
  decision lists 5 codes plus "both Snapper free-text groups", and states the
  Snapper pair overlaps set A. All 5 (`09-71510`, `2434371`, `430016`,
  `7200946`, `7915166`) were confirmed present in the SAFE population.
- 39 + 5 = **44 distinct**, matching the decision's stated total.
- Plus `99682` (Stella Artois - Bottled) = **45 held SAFE groups**.
- 893 − 45 = **848**, matching the authorized Batch 1 count.

The arithmetic agreeing at three independent points (39, 44, 848) is strong
evidence the derivation reproduces the reviewed list, but it is a derivation,
not the reviewed artifact. **Before APPLY, please either confirm the 39 free-text
identities in `batch1-held-safe-codes.txt` match the independent review, or
supply the original list so the manifest can be regenerated.**

## Pack/UOM terminology

Per the decision, groups with no supplied source UOM/case-quantity evidence are
reported as `NO_CONTRADICTING_PACK_UOM_EVIDENCE`, not `VERIFIED_COMPATIBLE`.
Absent pack/UOM data was not used as a blocking rule.

## Status

MANIFEST GENERATION ONLY. **No APPLY was run and none is authorized.**
Stopping here for final Product Owner approval.
