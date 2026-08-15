# Bay Hill Batch 1 — exact hold-set validation

Validation source: `attached_assets/bay-hill-review-hold-44_1786814988633.csv`
Compared against: `reports/bay-hill-batch1/batch1-held-safe-codes.txt`

| Check | Result |
| --- | --- |
| Claude CSV rows | 44 |
| Claude CSV unique Source Item Codes | 44 |
| Replit held file total | 45 (44 Claude holds + Stella `99682`) |
| Replit 44-code comparison set | 44 unique |
| Claude − Replit | `[]` (empty) |
| Replit − Claude | `[]` (empty) |
| Exact set equality | **PASS** |
| Claude identities found in accepted report | 44 of 44; all SAFE_CANDIDATE |
| Claude identities in manifest | 0 (empty) |
| Stella `99682` in manifest | no |
| AMBIGUOUS identities in manifest | 0 (empty) |
| Manifest groups / unique codes | 848 / 848 |

Interpretation: the authoritative Claude hold artifact exactly matches the 44
held SAFE identities used for the Batch 1 decision. The fifth held-SAFE item,
`99682 — Stella Artois - Bottled`, is the separately authorized manual-review
hold and is not part of Claude’s 44-row CSV. The staged 848-group manifest is
confirmed on the exclusion-set condition. No regeneration was needed.
