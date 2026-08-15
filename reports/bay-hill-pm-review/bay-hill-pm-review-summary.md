# Bay Hill SAFE_CANDIDATE PM Review

**Review status: READ-ONLY CANDIDATE SET — NOT PRODUCT OWNER APPROVAL**

This package was generated from the JSON portion of the supplied successful production report. The CLI preamble was excluded. It contains no credentials, connection strings, raw query payloads, manifest, or apply output.

## Source report provenance

- Report version: `1.0.0`
- Report hash: `4eec609ca3d1bc34c8ac2aa4e0d292920f95df62b502a9af77978e4114dd501e`
- Generated at: `2026-08-15T16:07:22.656Z`
- Scope is deliberately not reproduced in this artifact beyond the approved Bay Hill review context.
- Classification totals reconcile to the report: 897 examined, 893 SAFE_CANDIDATE, 4 AMBIGUOUS, 0 CONFLICT.

## Included review files

- `bay-hill-safe-candidate-detail.csv` — one sanitized row for each of the 893 SAFE_CANDIDATE groups.
- `bay-hill-safe-candidate-item-codes.csv` — exact proposed approval set: 893 source Item Codes.
- `bay-hill-ambiguous-groups.csv` — the 4 excluded AMBIGUOUS groups.

## Distribution and sanity summary

| Candidate identities in group | SAFE_CANDIDATE groups |
| --- | --- |
| 2 IDs | 465 |
| 3 IDs | 166 |
| 4 IDs | 94 |
| 5+ IDs | 168 |

| Measure | Result |
| --- | ---: |
| Canonical items retained | 893 |
| Items proposed to be superseded | 1,992 |
| Count lines that would repoint | 1,314 |
| May only | 48 |
| June only | 52 |
| Both May and June | 793 |
| Groups outside approved May/June date windows | 0 |
| Groups with exactly one external-mapping record | 793 |
| Groups with multiple external-mapping records | 100 |
| Groups with no external mapping on duplicate siblings | 886 |
| Groups with count lines | 670 |
| Groups with zero count lines | 223 |
| Groups with compatible candidate pack/UOM signatures | 893 |
| Groups needing pack/UOM review | 0 |
| Groups with nonzero expected valuation delta | 0 |

**Definitions.** “One/multiple external mapping” counts `inventoryItemExternalMappings` records across every identity in a group. “No mapping on duplicate siblings” means all proposed-to-be-superseded identities have zero such records; a canonical identity may still have mappings. Month presence follows the approved May window (2026-05-01 through 2026-06-01) and June window (2026-06-02 through 2026-07-01).

## Valuation preflight

The proposed operation is identity consolidation only: it repoints references to a selected existing identity and does not change source quantities, locations, unit costs, or count-line amounts. Therefore the expected delta for every SAFE_CANDIDATE is **$0.00**.

| Approved baseline | Expected post-remediation valuation | Expected delta |
| --- | ---: | ---: |
| May 2026 — $254,286.67 | $254,286.67 | $0.00 |
| June 2026 — $261,007.67 | $261,007.67 | $0.00 |

No SAFE_CANDIDATE is surfaced for nonzero expected valuation delta. This is a preflight expectation, not a post-apply reconciliation, because no manifest was created and no apply was run.

## Required known-example verification

### Chambord — source Item Code `9684722`

- **Proposed canonical identity:** `591e9649-c92c-4ff1-b243-4d32433784ae` (Chambord)
- **Deterministic selection:** decided on downstream references (23 vs 5).
- **Why these are the same source item:** the group is keyed to one source Item Code and one source description (`chambord`); all 5 FnB identities use the same product name(s) (`Chambord`) and the candidate pack/UOM comparison is `Compatible; 1 candidate pack/UOM signature(s); source UOM=ml; source case qty=6`. Source rows are present on `2026-06-01 | 2026-07-01`.
- **Mapping evidence:** 1 mapping record(s), 1 mapped identity/identities, 0 sibling mapping record(s).

### Sweet n Low — source Item Code `6115315`

- **Proposed canonical identity:** `231e141f-820a-47f5-9412-5d579ed126a0` (Sweet n Low)
- **Deterministic selection:** decided on downstream references (20 vs 5).
- **Why these are the same source item:** the group is keyed to one source Item Code and one source description (`sweet n low`); all 4 FnB identities use the same product name(s) (`Sweet n Low`) and the candidate pack/UOM comparison is `Compatible; 1 candidate pack/UOM signature(s); source UOM=not supplied; source case qty=not supplied`. Source rows are present on `2026-06-01 | 2026-07-01`.
- **Mapping evidence:** 1 mapping record(s), 1 mapped identity/identities, 0 sibling mapping record(s).

### Sauce - Tabasco — source Item Code `4274684`

- **Proposed canonical identity:** `880224e4-4fa8-4354-8ecc-631df7d5cfcc` (Sauce - Tabasco)
- **Deterministic selection:** decided on downstream references (24 vs 5).
- **Why these are the same source item:** the group is keyed to one source Item Code and one source description (`sauce tabasco`); all 6 FnB identities use the same product name(s) (`Sauce - Tabasco`) and the candidate pack/UOM comparison is `Compatible; 1 candidate pack/UOM signature(s); source UOM=ea; source case qty=144`. Source rows are present on `2026-06-01 | 2026-07-01`.
- **Mapping evidence:** 1 mapping record(s), 1 mapped identity/identities, 0 sibling mapping record(s).

### Heavy Cream — source Item Code `6935464`

- **Proposed canonical identity:** `5ef0e48a-c631-4dd6-8aa1-168998160a41` (Heavy Cream)
- **Deterministic selection:** decided on downstream references (16 vs 5).
- **Why these are the same source item:** the group is keyed to one source Item Code and one source description (`heavy cream`); all 3 FnB identities use the same product name(s) (`Heavy Cream`) and the candidate pack/UOM comparison is `Compatible; 1 candidate pack/UOM signature(s); source UOM=qt; source case qty=1`. Source rows are present on `2026-06-01 | 2026-07-01`.
- **Mapping evidence:** 1 mapping record(s), 1 mapped identity/identities, 0 sibling mapping record(s).

### Chicken - Breast — source Item Code `4505887`

- **Proposed canonical identity:** `823d4663-2055-4d99-96d0-3f24632ba65f` (Chicken - Breast)
- **Deterministic selection:** decided on downstream references (26 vs 5).
- **Why these are the same source item:** the group is keyed to one source Item Code and one source description (`chicken breast`); all 6 FnB identities use the same product name(s) (`Chicken - Breast`) and the candidate pack/UOM comparison is `Compatible; 1 candidate pack/UOM signature(s); source UOM=lb; source case qty=1`. Source rows are present on `2026-06-01 | 2026-07-01`.
- **Mapping evidence:** 1 mapping record(s), 1 mapped identity/identities, 0 sibling mapping record(s).

### Mayonnaise - Extra Heavy — source Item Code `4002432`

- **Proposed canonical identity:** `7c9a155e-734e-4f71-962d-106a306d1aa0` (Mayonnaise - Extra Heavy)
- **Deterministic selection:** decided on downstream references (24 vs 5).
- **Why these are the same source item:** the group is keyed to one source Item Code and one source description (`mayonnaise extra heavy`); all 5 FnB identities use the same product name(s) (`Mayonnaise - Extra Heavy`) and the candidate pack/UOM comparison is `Compatible; 1 candidate pack/UOM signature(s); source UOM=gal; source case qty=1`. Source rows are present on `2026-06-01 | 2026-07-01`.
- **Mapping evidence:** 1 mapping record(s), 1 mapped identity/identities, 0 sibling mapping record(s).

## AMBIGUOUS groups — excluded from the first manifest

### Source Item Code `10149134`

- **Item name(s):** Gatorade ORANGE
- **Candidate IDs:** 3e45e9bc-eea8-4d08-91d9-ec2a54305fa2 | a14df0cd-bea7-462e-90fc-6311782cb19e | b09278a7-6440-4223-ad2b-55bb48450f65 | bad1163f-9499-4d4f-9464-28b7ec705764 | ebe1b8fd-1677-4af8-a09f-6c98220cdc5c
- **Conflicting or insufficient evidence:** candidates 3e45e9bc-eea8-4d08-91d9-ec2a54305fa2 and ebe1b8fd-1677-4af8-a09f-6c98220cdc5c are equally supported by every ranking signal
- **Locations:** beverage carts | cafe | dry storeroom | halfway house | pool cafe
- **Pack/UOM:** Compatible; 1 candidate pack/UOM signature(s); source UOM=ea; source case qty=1
- **Mappings:** 2 mapping record(s) across 1 candidate(s); there is no proposed canonical identity in an AMBIGUOUS group.
- **Why no SAFE_CANDIDATE:** candidates 3e45e9bc-eea8-4d08-91d9-ec2a54305fa2 and ebe1b8fd-1677-4af8-a09f-6c98220cdc5c are equally supported by every ranking signal

### Source Item Code `7023177`

- **Item name(s):** GINGER BEER
- **Candidate IDs:** 17392a62-a7b4-4c95-9f1d-d0d26d2461ec | 197533be-a6c8-49cc-ae44-5d69ded251ce | 1b9a17d5-faa5-40aa-9495-782763512fd9 | 1c04e2f8-d37b-441c-809e-2285f0da8ac0 | 3a7a8260-bd45-4a86-8fed-bcc6f671a97e | 3c365c4e-32e9-4e3d-8947-4e9b95bfa29d | 57a8e09d-bd96-4047-b004-4d7d102fc6ef | 911d2177-4b90-4c24-bfaa-9cd5cd5fb751 | c9fefb23-8422-4d59-ae7d-6d05e702b6ea | f41623e6-635c-4670-919d-072b8cbff310
- **Conflicting or insufficient evidence:** candidates 3a7a8260-bd45-4a86-8fed-bcc6f671a97e and 3c365c4e-32e9-4e3d-8947-4e9b95bfa29d are equally supported by every ranking signal
- **Locations:** bay window | bay window bar | beverage carts | cafe | dry storeroom | grill room | halfway house | member lounge | mens locker room | pool cafe
- **Pack/UOM:** Compatible; 1 candidate pack/UOM signature(s); source UOM=ea; source case qty=24
- **Mappings:** 2 mapping record(s) across 1 candidate(s); there is no proposed canonical identity in an AMBIGUOUS group.
- **Why no SAFE_CANDIDATE:** candidates 3a7a8260-bd45-4a86-8fed-bcc6f671a97e and 3c365c4e-32e9-4e3d-8947-4e9b95bfa29d are equally supported by every ranking signal

### Source Item Code `7468556`

- **Item name(s):** Gatorade ORANGE
- **Candidate IDs:** 3e45e9bc-eea8-4d08-91d9-ec2a54305fa2 | a14df0cd-bea7-462e-90fc-6311782cb19e | b09278a7-6440-4223-ad2b-55bb48450f65 | bad1163f-9499-4d4f-9464-28b7ec705764 | ebe1b8fd-1677-4af8-a09f-6c98220cdc5c
- **Conflicting or insufficient evidence:** candidates 3e45e9bc-eea8-4d08-91d9-ec2a54305fa2 and ebe1b8fd-1677-4af8-a09f-6c98220cdc5c are equally supported by every ranking signal
- **Locations:** beverage carts | cafe | dry storeroom | halfway house | pool cafe
- **Pack/UOM:** Compatible; 1 candidate pack/UOM signature(s); source UOM=ea; source case qty=1
- **Mappings:** 2 mapping record(s) across 1 candidate(s); there is no proposed canonical identity in an AMBIGUOUS group.
- **Why no SAFE_CANDIDATE:** candidates 3e45e9bc-eea8-4d08-91d9-ec2a54305fa2 and ebe1b8fd-1677-4af8-a09f-6c98220cdc5c are equally supported by every ranking signal

### Source Item Code `9021845`

- **Item name(s):** GINGER BEER
- **Candidate IDs:** 17392a62-a7b4-4c95-9f1d-d0d26d2461ec | 197533be-a6c8-49cc-ae44-5d69ded251ce | 1b9a17d5-faa5-40aa-9495-782763512fd9 | 1c04e2f8-d37b-441c-809e-2285f0da8ac0 | 3a7a8260-bd45-4a86-8fed-bcc6f671a97e | 3c365c4e-32e9-4e3d-8947-4e9b95bfa29d | 57a8e09d-bd96-4047-b004-4d7d102fc6ef | 911d2177-4b90-4c24-bfaa-9cd5cd5fb751 | c9fefb23-8422-4d59-ae7d-6d05e702b6ea | f41623e6-635c-4670-919d-072b8cbff310
- **Conflicting or insufficient evidence:** candidates 3a7a8260-bd45-4a86-8fed-bcc6f671a97e and 3c365c4e-32e9-4e3d-8947-4e9b95bfa29d are equally supported by every ranking signal
- **Locations:** bay window | bay window bar | beverage carts | cafe | dry storeroom | grill room | halfway house | member lounge | mens locker room | pool cafe
- **Pack/UOM:** Compatible; 1 candidate pack/UOM signature(s); source UOM=ea; source case qty=24
- **Mappings:** 2 mapping record(s) across 1 candidate(s); there is no proposed canonical identity in an AMBIGUOUS group.
- **Why no SAFE_CANDIDATE:** candidates 3a7a8260-bd45-4a86-8fed-bcc6f671a97e and 3c365c4e-32e9-4e3d-8947-4e9b95bfa29d are equally supported by every ranking signal

## Stop condition

The proposed approval set is exactly the 893 source Item Codes in `bay-hill-safe-candidate-item-codes.csv`. Production classification is **not** Product Owner approval. This package intentionally contains **no manifest**, **no APPLY output**, and performs **no production mutation**.
