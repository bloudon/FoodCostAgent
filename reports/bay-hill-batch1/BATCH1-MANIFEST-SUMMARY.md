# Bay Hill Remediation — Batch 1 Manifest (generation only, NOT applied)

## Manifest identity

| Field | Value |
| --- | --- |
| Manifest ID | `bay-hill-batch1-2026-08-15` |
| Manifest file | `reports/bay-hill-batch1/bay-hill-batch1-manifest.json` |
| Manifest file SHA-256 | `64570b455c2ec84c4a03c2d85b5a83f171570314550b3111766c793f01289756` |
| Source report hash (`reportHash`) | `4eec609ca3d1bc34c8ac2aa4e0d292920f95df62b502a9af77978e4114dd501e` |
| Unapproved remainder (`unapprovedReportHash`) | `a20be1dc5c099bfc42f49b3924bb797bdb3d149ef4fa4f02a9619739ecee792a` |
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

## Hash semantics — RESOLVED

The two hashes are **the same kind of hash over two different report
populations**, not an internal-vs-file-hash difference. Both are the service's
internal canonical report hash: SHA-256 over a material-facts object
(report version, the four scope fields, and per group the code, classification,
canonical proposal, sorted candidate set, reference counts, merge-sensitive
config, count-line fingerprints, valuations, item facts, and sorted import
evidence). Timestamps and display text are deliberately excluded.

| Hash | What it is |
| --- | --- |
| `4672f3bd98629f82604b2f5cf1622888d644c3973ce777bf70256b1738cfb9ee` | Internal report hash of the **earlier zero-group discovery run** — the same Bay Hill scope with an **empty group list**. |
| `4eec609ca3d1bc34c8ac2aa4e0d292920f95df62b502a9af77978e4114dd501e` | Internal report hash of the **accepted 897-group production report**. This is what the manifest is bound to. |

**Proof (recomputed locally, read-only, no DB):** calling the service's own
`computeReportHash(scope, [])` with the accepted report's scope reproduces
`4672f3bd...` exactly. That hash is therefore fully explained: it is the
"discovery found nothing" report for this scope, from before the discovery
defect was fixed. It is not a competing snapshot of the accepted population and
carries no groups.

Calling `computeReportHash(scope, groups)` over the accepted report's 897 groups
reproduces `4eec609c...` exactly, matching the `reportHash` stored in the JSON —
so the uploaded file has not been altered since production generated it, and the
value is a genuine internal hash rather than a file digest.

### Requested values

| Field | Value |
| --- | --- |
| Internal production report hash (accepted) | `4eec609ca3d1bc34c8ac2aa4e0d292920f95df62b502a9af77978e4114dd501e` |
| Internal report hash of prior zero-group run | `4672f3bd98629f82604b2f5cf1622888d644c3973ce777bf70256b1738cfb9ee` (= scope + no groups) |
| Uploaded report file SHA-256 (original, with CLI preamble) | `1503fe1ac6cc8ca247c4d7231d7163406569f4d66bcf98d74bdd51240bc653e3` |
| JSON-only accepted copy SHA-256 | `bc9d4620577764dd9732c67eabd1187d2630413cfb5052f81ef25b4b604ecbe6` |
| Manifest `reportHash` | `4eec609c...` — matches accepted report |
| Manifest `unapprovedReportHash` | `a20be1dc5c099bfc42f49b3924bb797bdb3d149ef4fa4f02a9619739ecee792a` — recomputed from the accepted report minus the 848 approved groups, matches exactly |
| Per-group hashes | 848 of 848 present |

The JSON-only copy differs from the original upload only by removal of the CLI
build preamble; both contain byte-identical JSON, which is why both reproduce
the same internal hash. The original upload was not modified.

**Binding is correct. No regeneration required.**

### Proof of the accepted 897 / 893 / 4 / 0 population

Read directly from the uploaded JSON:

- `reportVersion` `1.0.0`
- `totals`: `groupsExamined` 897, `safeCandidates` 893, `ambiguous` 4,
  `conflicts` 0, `notDefectRelated` 0, `itemsThatWouldBeSuperseded` 1,992,
  `countLinesThatWouldRepoint` 1,314
- Independently counted from the `groups` array (not read from `totals`):
  897 groups — 893 `SAFE_CANDIDATE`, 4 `AMBIGUOUS`, 0 `CONFLICT`,
  0 `NOT_DEFECT_RELATED`
- Scope: companyId `43abaf82-44ce-4231-9570-7a01e7c85ced`, storeId
  `ee9e1530-50db-45f4-ae61-2c45e86827f0`, sourceSystem `ORDERLY`,
  sourcePropertyId `24472`

The report-level totals of 1,992 superseded and 1,314 repoints cover all 893
SAFE groups; Batch 1's 1,901 and 1,259 are the subset for the 848 approved
groups, with the difference attributable to the 45 held groups.

Verification script: `reports/bay-hill-batch1/verify-hash-binding.ts`
(read-only; imports the production hash functions and touches no database).

## How the 44-group exclusion set was determined — STILL REQUIRES PO CONFIRMATION

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
not the reviewed artifact.

### Set-equality status: 7 of 44 confirmed, 37 pending

The Product Owner has confirmed the explicitly named members but does not yet
have the full reviewed list. Verified by set membership against
`batch1-held-safe-codes.txt`:

| Confirmed identity | In held set |
| --- | --- |
| `09-71510` | present |
| `2434371` | present |
| `430016` | present |
| `7200946` | present |
| `7915166` | present |
| `snapper american fillets` | present |
| `snapper american fillets use 6up sk/off pbo` | present |

All 7 explicitly named identities are present in the held set — 0 discrepancies
so far. The remaining **37 free-text identities are derived, not confirmed**,
and are pending exact retrieval from the independent review.

The required comparison is therefore **incomplete**:

- Claude hold set count — not yet available
- Replit hold set count — 45 held SAFE (44 + Stella Artois `99682`)
- Claude minus Replit — cannot be computed
- Replit minus Claude — cannot be computed

**APPLY remains blocked on this comparison.** The manifest population is
unchanged and will not be altered until the exact 44-item set is supplied and
compared by set equality.

## Pack/UOM terminology

Per the decision, groups with no supplied source UOM/case-quantity evidence are
reported as `NO_CONTRADICTING_PACK_UOM_EVIDENCE`, not `VERIFIED_COMPATIBLE`.
Absent pack/UOM data was not used as a blocking rule.

## Status

MANIFEST GENERATION ONLY. **No APPLY was run and none is authorized.**
Stopping here for final Product Owner approval.
