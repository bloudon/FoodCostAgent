# Orderly May Bootstrap and June Reconciliation Evidence

Generated for the Bay Hill development scope on 2026-08-27.

## Scope and source integrity

- Company: Bay Hill development company (`61971215-e3ed-49f3-8afc-6dbe1eef1fcc`)
- Destination store: Bay Hill (`7126a705-64a6-4362-8b62-f08349640442`)
- Orderly source property: `24472`
- Source-property binding: `bayhill-dev-binding-24472`
- May workbook SHA-256: `935e7e28041ed722220c70e757b364f06872522ceaac48e8c6d8b91fd1dad3aa`
- June workbook SHA-256: `66628b97ac8214a4bf16bb4e357b6fe5b8560cd46b7ce1fd59e29360f7ef5eaa`
- Fresh May batch: `612148af-d359-4c6d-80a5-0ffe7b0d4afa`
- Fresh June batch: `c1f454ff-0c38-4e87-8000-ac34a82cb7a8`

## May bootstrap result

The exact May workbook was staged again after the approved development run and its run-created catalog records were explicitly reset. The fresh batch was date-confirmed as 2026-05-31 and approved through the authoritative approval service.

- Source/location rows processed: **5,358**
- Canonical inventory items created: **3,052**
- Additional rows linked to those identities: **2,306**
- Store-item links created: **3,052**
- Unknown-geometry rows imported as opaque item identities: **246**
- Rows skipped: **0**
- Rows held for review: **0**
- Snapshot total: **$254,286.67**
- Imported total: **$254,286.67**
- Excluded rows/value: **0 / $0.00**
- Reconciliation delta: **$0.00** (raw floating-point delta below one billionth of a dollar)

Unknown or unsupported pack geometry retained the raw source pack evidence and source value. It created or resolved a stable inventory identity using an opaque one-package stock-count basis only. It did not create normalized pack totals, unit conversions, or pack-compatibility claims.

## June staging state

The untouched June workbook was staged through the authenticated import route and date-confirmed as 2026-06-30. It remains **pending review** and was not approved.

- Source/location rows: **5,409**
- Unique workbook identity groups: **3,071**
- Parsed source pack strings: **5,160**
- Unknown/unsupported pack strings: **249**
- Unknown-geometry rows resolving to May identities: **249**
- Snapshot value: **$261,007.67**
- Source-data conflicts: **0**
- Same-location duplicate-code groups: **0**

## June-to-May reconciliation

### May canonical resolutions

- **5,377 of 5,409 June rows** resolve to May canonical inventory items.
- Those rows resolve to **3,043 distinct May inventory items**.
- **3,762 rows** resolve through immutable external mappings.
- **1,516 rows** resolve through derived alternate identities.
- **32 rows** remain unmatched new-product candidates.

### Stable-code matches

- Stable-code rows: **3,950**
- Stable-code rows matched to an existing identity: **3,935**
- Unique reliable codes: **2,157**
- Existing reliable-code identity resolutions: **2,105**
- Reliable codes proposing multiple canonical items: **0**
- Conflicting reliable-code groups: **0**

### Changed-code evidence

There are **63 distinct changed-code/recode evidence groups** covering **167 rows**:

- Compatible alternate identity: **32 groups**
- New pack size: **30 groups**
- Missing pack evidence: **1 group**
- Source-data conflicts: **0**

These decisions remain reviewable and are the reason June was not approved.

### Blank-code retention

- Blank-code rows: **1,045**
- Safely matched: **1,044**
- Reviewable/unresolved: **1**
- Blank-code identity groups auto-resolved: **626**

### Review and new-product boundary

- Rows requiring review: **95**
- Distinct review groups represented by those rows: **39**
- Rows held for review: **1**
- Unmatched non-review rows: **32**
- Distinct unmatched new-product groups: **24**
- Proposed duplicate canonical items from reliable codes: **0**

## Conclusion

May now imports every valid source identity, including all 246 unknown-geometry rows, while preserving their value and refusing to invent physical pack geometry. June confirms subsequent-month continuity: all 249 unknown-geometry rows resolve to stable May identities. June remains staged and unapproved pending its explicit recode and new-pack review decisions.