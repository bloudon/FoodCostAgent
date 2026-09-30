# Mobile inventory count performance

## Reference workload

The original investigation used the Bay Hill August inventory count with 5,669
count lines.

### Before

| Measure | Baseline |
| --- | ---: |
| Joined PostgreSQL count-line query | ~26 ms |
| Raw count-line JSON before API enrichment | ~2.77 MB |
| Observed full count-line API request | ~406–666 ms |
| Editable rows mounted on initial WebView render | 5,669 |
| Network activity after one ordinary count edit | 1 PATCH plus a full-session GET |
| Inventory-session summary loading | 1 full count-line GET per session |

The database query and existing foreign-key indexes were not the primary
bottleneck. Transfer, enrichment, repeated collection scans, DOM mounting, and
full-session refetches dominated the user-visible delay.

## After

| Measure | Result |
| --- | ---: |
| Database indexes added | 0 |
| Mobile WebView rows mounted initially | at most 120 |
| Initial mounted-row reduction for 5,669 lines | 97.9% |
| Network activity after one ordinary count edit | 1 PATCH, 0 full-session GETs |
| Inventory-session summary loading | 0 per-session count-line GETs |
| Count-line enrichment complexity | lookup maps instead of repeated linear searches |
| Native category/location filtering | applied in SQL |

The embedded WebView opts into a compact count-line response that retains count
quantities, operational package metadata, previous-count identity, and entry
history while omitting unrelated inventory-item fields. Desktop callers retain
the existing full response contract.

The original 5,669-line development session is no longer present in the current
development database (the current largest session has 161 lines), so exact
after-change response bytes, authenticated API latency, and device interaction
timings cannot be reproduced against that same dataset in this workspace. Those
measurements should be repeated if the fixture is restored. Automated regression
coverage uses a 5,669-line collection to enforce the 120-row initial render
boundary.