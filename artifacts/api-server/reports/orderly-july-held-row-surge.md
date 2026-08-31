# July Orderly Held-Row Surge Review

## Outcome

**BLOCKED — do not approve July batch `49d087c5-8e33-4bdc-ae06-821f71d2d231`.**

The 979 unsatisfied held rows are not primarily new fail-closed vendor-pack
conflicts. They are blank-Item-Code rows that exact-name match an existing
inventory item, but a legacy matcher compares the incoming package count with
the catalog item's canonical base-unit total. That unit mismatch downgrades a
safe exact-name match to `requiresReview`, which in turn holds the blank row.

Approval would leave these rows unresolved. The production population is broad
and material, so it cannot be accepted as a conservative no-op.

## Evidence reviewed

- Complete July resolution preview captured at 2026-08-30 21:05 UTC
- Earlier July preview captured at 2026-08-30 19:31 UTC
- Saved-review response captured at 2026-08-30 21:08 UTC
- Deployed change `7c8f75f7` committed at 2026-08-30 22:07 UTC
- Current preview, identity-group, hold, and approval code
- Existing database-backed blank-code identity tests

The attached responses contain production identifiers. This report records
only bounded aggregate evidence and representative product descriptions.

## What the 979 rows have in common

The complete preview has 985 raw held rows. Six of those rows had saved manual
decisions in the captured review response, producing the UI's 979 remaining
held rows.

Every raw held row has:

- blank Orderly Item Code;
- `holdReason = blank_item_code`; and
- either no matched item or a match marked `requiresReview`.

The raw held population is:

| Classification | Rows | Identity groups |
| --- | ---: | ---: |
| Exact-name `name_pack`, medium confidence, requires review | 976 | 568 |
| Exact-name `name_pack`, ambiguous | 8 | 4 |
| Fuzzy, low confidence | 1 | 1 |
| **Total** | **985** | **573** |

Additional scope:

- 977 rows already carry a concrete matched inventory-item ID.
- Only 8 rows have no matched ID.
- 655 rows across 243 groups repeat over multiple locations.
- 330 groups are single-row groups.
- The largest group has seven rows, so the increase is broad rather than one
  duplicated product multiplying into hundreds of locations.
- Held source value totals **$61,452.35**.
- 977 rows / $61,139.88 are classified as reviewable.
- 8 rows / $312.47 are classified as conflicted.

Rows per held identity group:

| Rows per group | Groups | Total rows |
| ---: | ---: | ---: |
| 1 | 330 | 330 |
| 2 | 140 | 280 |
| 3 | 60 | 180 |
| 4 | 27 | 108 |
| 5 | 11 | 55 |
| 6 | 3 | 18 |
| 7 | 2 | 14 |

## Root cause

`matchByNamePack` compares:

```text
incoming inventory_import_rows.caseQuantity
```

with:

```text
inventory_items.caseSize
```

and marks the row `medium` plus `requiresReview` when the ratio falls outside
10 percent.

Orderly approval creates inventory items on a canonical basis:

```text
caseSize = casePkgCount × containerSize
```

where `containerSize` is normalized into the canonical unit. Therefore, an
incoming `1/1 750ML` row has:

```text
incoming caseQuantity = 1
catalog caseSize = 750
```

The two numbers describe different concepts. Comparing them makes the exact
name match look like a pack mismatch even though the catalog value often
encodes exactly the incoming normalized pack total.

Production evidence confirms this is the dominant classification mechanism:

- 797 of 976 exact-name held rows have catalog `caseSize` numerically equal to
  the incoming normalized total.
- 637 rows are the direct `incoming caseQuantity = 1` versus
  `catalog caseSize = 750` pattern.
- 820 rows have a catalog-to-incoming-case ratio of at least 100×.
- 123 rows have a ratio from 10× to 100×.
- 32 rows have a ratio from 1.1× to 10×.
- Only one row has a catalog value below the incoming case count.

Unit distribution for the 984 exact-name held rows:

| Unit | Rows | Identity groups |
| --- | ---: | ---: |
| ML | 698 | 433 |
| OZ | 62 | 24 |
| GAL | 51 | 25 |
| LT | 50 | 20 |
| LB | 46 | 32 |
| EA | 43 | 22 |
| QT | 23 | 10 |
| Other / missing | 11 | 6 |

Representative affected rows include `Shafer Hillside Select 2018`,
`Louis XIII`, `Demi-Glace`, `Opus One 2019`, and `Jameson Minis`. Their presence
also shows that this is not confined to one vendor, category, unit, or value
band.

## Why #1289 and the indexes are not the cause

Both captured previews already report:

- 5,518 total rows;
- 1,213 rows requiring review; and
- 985 raw held rows.

Those captures were recorded at 19:31 and 21:05 UTC. Commit `7c8f75f7` was
created at 22:07 UTC, so that commit cannot be the origin of the already
captured held-row population. This timestamp comparison does not independently
prove the later deployment time.

The #1289 domain change is limited to candidate pack assessment when several
authoritative catalog pack records exist. It does not modify
`matchByNamePack`, `getHoldReason`, or blank identity-group release.

The preview indexes do not mutate data. The held rows are also ordinary
exact-name matches, not predecessor-selection failures. Their matched IDs and
the numeric unit mismatch directly explain the classification, so there is no
evidence that an index-selected query plan changed their semantics.

The likely timing is catalog-state dependent: after May and June created
canonicalized inventory items, July exact-name blank rows encountered catalog
`caseSize` values expressed as normalized totals. A preview against an empty or
pre-seed catalog would not enter this mismatch branch and could show only a
small held population. This timing explanation remains a hypothesis until the
same batch is classified against a frozen before/after catalog state.

## Identity decisions are a separate population

The raw preview contains 582 evidence keys:

| Evidence class | Decisions | Source rows |
| --- | ---: | ---: |
| Descriptive/unreliable code | 420 | 420 |
| Missing pack evidence | 162 | 337 |

The UI's reported **86 identity decisions** is the remaining actionable
source-code decision count after saved decisions are applied. It is calculated
separately from held blank rows. It should not be added to, subtracted from, or
used to explain the 979 held rows.

The later operator report of 206 valid and 22 stale saved decisions is
consistent with the UI showing a reduced pending identity-decision count, but
it does not resolve the blank-code matcher defect.

## Expected safe cases

The implementation and database-backed tests correctly support:

- creating one internal item for a genuinely new blank-code multi-location
  group;
- letting a blank row follow one safe coded sibling;
- holding a blank row when several coded siblings compete; and
- holding genuine ambiguous or fuzzy evidence.

The production preview demonstrates that these paths still run:

- 71 blank rows are safely confirmed;
- 55 blank groups auto-resolve; and
- the one blank/coded-sibling group is tracked.

The missing regression case is production-shaped:

1. an earlier approved Orderly import creates a canonical catalog item;
2. a later blank-code row has the same normalized name and pack;
3. incoming `caseQuantity` is compared with canonical total `caseSize`; and
4. the row is incorrectly held despite equivalent normalized geometry.

## Data-integrity assessment

The aggregate evidence proves why the current matcher marks these rows for
review; it does **not** prove that all 976 rows are safe to release. Numeric
equality alone cannot establish unit dimension, pack shape, provenance, or
candidate uniqueness.

The correct narrowing must not return to name-only linking. A blank row should
be released only when one authoritative candidate is proven by the full
normalized pack geometry and the approved tenant/provenance boundary.

The current direct name matcher loads active items company-wide. Whether an
item created through one property's Orderly history may be reused by another
property is an unresolved product/data-integrity policy. That policy must be
decided before implementation. If cross-property catalog reuse is not allowed,
candidate eligibility must require source-property-compatible provenance.

Safe direction:

- use normalized source and catalog pack geometry for exact-name candidate
  compatibility;
- require exactly one compatible candidate;
- require matching normalized unit/dimension and every pack-shape field the
  approved policy treats as identity evidence;
- retain holds for ambiguous names, inactive candidates, incomplete legacy
  geometry, unknown provenance, incompatible geometry, or multiple compatible
  authoritative packs;
- enforce the decided company/property reuse boundary; and
- apply the same verdict in preview and under-lock approval.

Unsafe direction:

- compare raw `caseQuantity` with canonical `caseSize`;
- ignore pack geometry because names match;
- select the first same-name candidate; or
- weaken vendor/property/tenant evidence boundaries.

## Approval gate

July remains blocked until a corrected preview shows:

1. production-shaped exact-name blank rows with equivalent normalized geometry
   resolve to exactly one existing item;
2. same-name rows with different units/dimensions, multiple compatible
   candidates, incomplete legacy geometry, and disallowed cross-property
   provenance remain held;
3. the company/property catalog-reuse policy is explicit and covered by tests;
4. a read-only before/after production classification identifies exactly which
   rows changed and why, without assuming all 976 are safe;
5. the remaining held population contains only evidence-backed exceptions;
6. source valuation is fully accounted for;
7. the 206 valid / 22 stale saved-decision evidence is unchanged or any change
   is explicitly reviewed; and
8. approval revalidation produces the same classification under lock.

## Independent review

An independent architecture/data-integrity review agreed that:

- July must remain blocked;
- the raw/canonical unit mismatch is real;
- `7c8f75f7` is excluded as the origin of the already captured population; and
- a production-shaped regression plus read-only before/after reconciliation is
  required before any rows are released.

It also identified the unresolved cross-property catalog-reuse policy and
required the report to distinguish observed classification mechanics from
proof that an individual row is safe. Those qualifications are incorporated
above.

No July approval, decision reset, bulk resave, catalog mutation, or manual
deletion was performed during this review.