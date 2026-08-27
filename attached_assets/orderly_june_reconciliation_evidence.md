# Orderly May Bootstrap and June Reconciliation Evidence

Generated for the Bay Hill development scope on 2026-08-26.

## Scope and source integrity

- Company: Bay Hill development company (`61971215-e3ed-49f3-8afc-6dbe1eef1fcc`)
- Destination store: Bay Hill (`7126a705-64a6-4362-8b62-f08349640442`)
- Orderly source property: `24472`
- Source-property binding: `bayhill-dev-binding-24472`
- May workbook SHA-256: `2eb3fc13530213dbd041c532273b58d1c9d54992b2551aa57408cff49fce9b58`
- June workbook SHA-256: `66628b97ac8214a4bf16bb4e357b6fe5b8560cd46b7ce1fd59e29360f7ef5eaa`
- May batch: `31bb8a48-417c-4cdc-999a-6e1c6c64e853`
- June batch: `e935e327-fffa-41c8-85a7-51739cec3c25`

## May bootstrap result

The exact hash-matched May workbook was atomically reprocessed with the current parser, date-confirmed as 2026-05-31, and approved through the authoritative approval service.

- Source/location rows processed: **5,358**
- Canonical inventory items created: **2,872**
- Additional source rows linked to those identities: **2,240**
- Store-item links created: **2,872**
- Unsupported-pack rows retained as unresolved immutable evidence: **246**
- Rows skipped: **0**
- Rows held for review: **0**
- May snapshot value: **$254,286.67**

Unsupported or incomplete pack geometry did not create an inventory item, external mapping, vendor-item relationship, or store-item link.

## June staging state

The untouched June workbook was staged through the authenticated import route and date-confirmed as 2026-06-30. It remains **pending review** and was not approved.

- Source/location rows: **5,409**
- Unique workbook identity candidates: **3,076**
- Parsed source pack strings: **5,160**
- Intentionally unparseable/unsupported pack strings: **249**
- Snapshot value: **$261,007.67**
- Source-data conflicts: **0**
- Same-location duplicate-code groups: **0**

## June-to-May reconciliation

### May canonical resolutions

- **5,170 of 5,409 June rows** resolve to May canonical inventory items.
- Those rows resolve to **2,863 distinct May inventory items**.

### Stable-code matches

- Stable-code rows: **3,950**
- Stable-code rows matched to an existing identity: **3,817**
- Direct immutable external-mapping matches: **3,615 rows**, covering **1,964 distinct identity groups/items**
- Stable rows resolved by derived alternate identity: **75**
- Stable rows left new or reviewable: **256**

### ALT / derived-identity matches

- Derived alternate-identity matches: **1,416 rows**
- Distinct derived identities: **864**
- All **1,416** resolve to May canonical items.
- Composition: **991 blank-code rows**, **350 descriptive/pseudo-code rows**, and **75 stable-code rows**

### Changed-code evidence

There are **63 distinct changed-code/recode evidence groups** covering **167 rows**:

- Compatible alternate identity: **32 groups**
- New pack size: **30 groups**
- Missing pack evidence: **1 group**
- Rows requiring an explicit human decision: **88**
- Rows already resolved by a canonical alternate identity: **75**
- Source-data conflicts: **0**

### Blank-code retention

- Blank-code rows: **1,045**
- Safely retained/resolved under the existing identity rules: **1,037**
- Reviewable blank-code rows: **8**
- Blank-code rows resolving through a derived alternate identity: **991**

### Same-workbook blank/coded reconciliation

- Mixed blank/coded identity groups: **1**
- Rows in that group: **3**
- Blank rows in that group: **2**
- Result: the group resolves to **one existing May identity**
- New candidates or review conflicts from this path: **0**

### Genuinely new product candidates

- Unmatched, non-review rows: **239**
- Distinct new product identity groups: **184**
- Composition: **108 stable-code groups**, **53 descriptive/pseudo-code groups**, and **23 blank-code groups**

These are preview candidates only. June has not been approved.

### Ambiguous groups requiring human review

- Review rows: **131**
- Distinct review groups: **58**
- Fuzzy-match rows: **43**
- Exact-name/pack candidate rows requiring review: **88**
- Distinct candidate existing items represented: **56**

### Duplicate canonical items proposed

- Reliable codes proposing multiple canonical items: **0**
- Conflicting reliable-code groups: **0**
- Same-location duplicate-code groups: **0**
- Same-location duplicate rows: **0**

## Conclusion

May is safely bootstrapped without manufacturing identities from unsupported pack geometry. June is staged but unapproved. Its preview is predominantly anchored to May, while new products and ambiguous changed-code evidence remain separated for review.