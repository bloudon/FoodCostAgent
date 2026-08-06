# Vendor Registry Simplification Evaluation

## Context

Replit has already implemented **Vendor Registry v1** using the original **141-vendor seed workbook**.

A newer research workbook, **FnB Cost Pro Vendor Master v2.0**, now contains:

- 186 researched vendor records
- 102 records marked `Approved seed`
- 65 records marked `Review before seed`
- 19 records marked `Reference only`
- Additional international vendors
- Connector keys
- Ownership and network relationships
- More detailed geography and source metadata

The goal is **not** to replace the working v1 implementation blindly.

The goal is to evaluate whether the current vendor registry can be simplified so it remains useful for onboarding and connector detection without becoming an overly complex vendor-research system.

## Attached reference file

Use the attached workbook:

`fnb_cost_pro_vendor_master_v2.xlsx`

Important sheets:

- `Vendor Master v2`
- `Seed Export`
- `Change Log v2`
- `Geographic Coverage`
- `Purveyor Registry`

---

# Product principle

FnB Cost Pro does not need a perfect global database of every food distributor before launch.

It needs a vendor system that:

1. Recognizes common purveyors.
2. Prevents duplicate vendor entries.
3. Suggests the correct connector when known.
4. Gives geographically relevant suggestions.
5. Allows customers to add unknown vendors immediately.
6. Learns safely through global-admin approval.

The vendor research workbook can remain detailed.

The production registry should be as simple as possible.

---

# Elon Algorithm Evaluation

Apply the following five-step review to the existing implementation.

## 1. Make the requirements less dumb

Evaluate whether the current build assumes FnB Cost Pro must maintain:

- Complete vendor coverage
- Exact vendor delivery territories
- Detailed industry membership data
- Ownership and acquisition history
- Vendor-specific template documentation
- Research confidence explanations
- Full international normalization before launch

The actual launch requirement is:

> Maintain a reusable global vendor registry that supports vendor recognition, duplicate prevention, connector selection, geographic ranking, and controlled expansion through customer submissions.

Identify any existing requirements or code paths that exceed this requirement without creating clear customer value.

---

## 2. Delete unnecessary complexity

Evaluate which current database fields, services, screens, and workflows are unnecessary for the production vendor picker.

Research-only fields should not automatically become required production fields.

Examples of research data that may not belong in the core runtime model:

- Directory membership
- Detailed research notes
- Primary and geography sources as separate required fields
- Acquisition commentary
- Template research notes
- Confidence explanation text
- `New in v2`
- Detailed metro descriptions
- Buying-group intelligence
- Exact delivery-area promises

Do not delete anything yet.

Identify:

- Fields that are unused
- Fields that are duplicative
- Fields that create required maintenance
- Fields that belong in optional admin metadata
- Fields that belong only in the external research workbook

---

## 3. Simplify before optimizing

Evaluate whether the production registry can be reduced to approximately the following model:

```ts
platformVendorRegistry {
  id
  canonicalName
  aliases[]
  websiteDomains[]
  countryCodes[]
  serviceRegions[]
  connectorType
  orderingUrl
  status
  source
  lastVerifiedAt
}
```

Possible optional administrative fields:

```ts
usageCount
lastUsedAt
submittedByCompanyId
reviewedByUserId
reviewedAt
reviewNotes
```

Suggested meanings:

### `canonicalName`

The approved global display name.

### `aliases`

Searchable alternate names, abbreviations, legacy names, and common variations.

Examples:

```text
Performance Food Group
PFG
Performance Foodservice
```

### `websiteDomains`

Normalized domains used for recognition and duplicate detection.

Store domains rather than full URLs where possible:

```text
sysco.com
usfoods.com
whatchefswant.com
```

### `countryCodes`

Countries where the vendor may be relevant.

Examples:

```text
US
CA
BR
KR
BM
PR
```

### `serviceRegions`

Optional state, province, or territory codes used only to improve ranking.

Examples:

```text
FL
GA
PA
ON
QC
```

These must not be treated as a guaranteed delivery area.

### `connectorType`

Nullable shared platform or vendor connector identifier.

Examples:

```text
cut_and_dry
sysco_shop
us_foods_moxe
ben_e_keith_entree
food_order_entry
public_ecommerce
```

### `orderingUrl`

Optional customer ordering or portal URL.

### `status`

```text
approved
pending
rejected
inactive
```

### `source`

```text
seeded
user_submission
global_admin
import
```

---

# Geography simplification

Evaluate the current geographic implementation.

The intended behavior is:

- Geography improves search-result ordering.
- Geography does not block vendor selection.
- Geography does not guarantee that a distributor serves every ZIP in a state.
- National vendors should rank broadly.
- Regional vendors should receive a ranking boost when the customer location matches.
- Unverified geography should not create false matches.

Suggested ranking order:

1. Exact approved vendor already used by the company
2. Matching website domain
3. Matching country and state/province
4. Matching country
5. National vendor
6. Other approved global vendors
7. Pending or company-only vendors when appropriate

Display language should avoid delivery guarantees.

Suggested UI wording:

> Commonly available in your region. Confirm delivery availability with the vendor.

---

# Seed strategy evaluation

The current implementation already loaded 141 vendors.

Do not assume all 141 should be deleted or replaced.

Evaluate the existing 141 records against the v2 workbook and classify them into:

```text
KEEP
UPDATE
MERGE
HIDE_FROM_PICKER
MARK_REFERENCE_ONLY
REVIEW
ADD_FROM_V2
```

Use the v2 field:

```text
Seed Status
```

Recommended interpretation:

## `Approved seed`

Suitable for the global customer-facing vendor picker, subject to duplicate and active-status checks.

## `Review before seed`

Do not automatically expose globally until verified by a global administrator.

These may still be valid vendors, but often have incomplete:

- Website data
- Territory data
- Alias data
- Active-status verification
- Ordering information

## `Reference only`

Keep outside the normal restaurant vendor picker unless there is a specific product reason to expose them.

Examples may include:

- Buying groups
- Distributor cooperatives
- Redistributors
- Closed franchise supply systems
- Contract-chain distributors
- Parent networks

Reference-only examples may still be useful for:

- Connector research
- Ownership relationships
- Vendor intelligence
- Admin search
- Future expansion

---

# Customer workflow target

## Known vendor

```text
Add Vendor
   ↓
Search by name, alias, or domain
   ↓
Relevant approved vendors appear
   ↓
Known connector and ordering URL are suggested
   ↓
Customer selects vendor
```

## Unknown vendor

```text
Add Vendor
   ↓
No useful match
   ↓
Customer enters vendor name
Website is optional
Connector is optional
   ↓
Vendor becomes usable immediately for that company
   ↓
A pending global-registry submission is created
```

Global approval must not block the customer from using the vendor within their own company.

---

# Global-admin workflow target

The global-admin review screen should focus on:

- Submitted vendor name
- Suggested canonical name
- Website and normalized domain
- Country and region
- Suggested connector
- Number of companies using the vendor
- Similar approved vendors
- Similar pending submissions
- Approve
- Merge
- Reject
- Keep company-only

Usage count should matter more than membership in an industry directory.

---

# Connector simplification

Connector behavior should be platform-based where possible.

Example:

```text
What Chefs Want
connectorType = cut_and_dry

Saval Foodservice
connectorType = cut_and_dry
```

Do not duplicate Cut+Dry implementation logic per vendor.

The vendor record should contain only the connector reference and vendor-specific ordering URL.

Detailed CSV formats, upload rules, authentication behavior, and connector instructions should live in the connector definition or connector documentation.

Suggested relationship:

```ts
platformVendorRegistry.connectorType
    -> connectorDefinitions.key
```

Example connector definition:

```ts
connectorDefinitions {
  key
  displayName
  capabilities[]
  templateColumns[]
  documentationUrl
  authMethod
  status
}
```

Do not build connector automation from undocumented scraping or private browser behavior.

---

# Duplicate detection

Evaluate whether current detection handles:

- Canonical-name normalization
- Alias matching
- Website-domain matching
- Punctuation differences
- `Inc`, `LLC`, `Corp`, and `Company`
- Parent and operating-brand distinctions
- Pending submissions
- Company-created local vendors

Suggested normalized comparison:

```text
Cheney Brothers, Inc.
Cheney Brothers
cheneybrothers.com
```

These should resolve to the same likely global vendor.

Do not automatically merge based only on similar names.

Domain matches should be weighted more strongly than fuzzy-name matches.

---

# Ownership relationships

Do not automatically replace operating vendor brands with parent companies.

Examples:

```text
Cheney Brothers
Parent: Performance Food Group
```

Cheney Brothers should remain selectable because customers may know it and order from it under that identity.

Similarly:

```text
FreshPoint
Parent: Sysco
```

Both identities may be operationally relevant.

An acquisition announcement should not automatically trigger a merge before the transaction closes.

---

# Migration safety

Before changing the schema or seed data, determine:

- Whether company vendor records reference global vendor IDs
- Whether vendor IDs are used in purchase orders
- Whether vendor IDs are used in products or order guides
- Whether vendor IDs appear in invoices
- Whether vendor IDs appear in integrations
- Whether vendor IDs are used in audit history
- Whether vendor names were copied into transactional records
- Whether deleting a global record would break existing data
- Whether existing company-created aliases must be preserved

Prefer:

```text
Deactivate
Hide from picker
Merge with redirect
Preserve legacy ID
```

over destructive deletion.

If two records are merged, preserve an alias or redirect table so existing references continue resolving.

---

# Requested evaluation output

Do not implement changes yet.

First return a written assessment containing the following sections.

## 1. Current implementation summary

Describe:

- Current vendor-related tables
- Current fields
- Current API routes
- Current admin pages
- Current customer workflows
- Current connector-detection behavior
- Current seed process
- Current geographic behavior

## 2. Gap analysis

For each proposed simplification, state:

```text
Already implemented
Partially implemented
Not implemented
Conflicts with current architecture
Not recommended
```

Explain why.

## 3. Existing 141-vendor disposition

Produce a summary table showing:

```text
KEEP
UPDATE
MERGE
HIDE_FROM_PICKER
MARK_REFERENCE_ONLY
REVIEW
```

Provide counts for each category.

Also identify any obvious duplicate or obsolete records.

## 4. v2 additions

Compare the existing 141 records with `Vendor Master v2`.

Report:

- Net-new vendors
- Records with aliases to add
- Records with website-domain changes
- Records with connector changes
- Records with ownership changes
- Records that should remain reference-only
- International vendors worth adding now
- Records that should remain pending review

## 5. Simplified target schema

Show the recommended schema.

Clearly separate:

- Required runtime fields
- Optional admin fields
- Research-only fields that should remain outside production

## 6. Migration plan

Provide a safe staged migration plan.

Suggested stages:

```text
Stage 1: Add missing optional fields without breaking v1
Stage 2: Normalize aliases and domains
Stage 3: Add seed-status and visibility behavior
Stage 4: Import approved v2 additions
Stage 5: Hide reference-only records from normal picker
Stage 6: Add merge and duplicate-review support
Stage 7: Remove genuinely unused code only after validation
```

## 7. Risk assessment

Include:

- Data-integrity risks
- Existing-customer impact
- Connector risks
- Geographic-ranking risks
- Duplicate-record risks
- Internationalization risks
- Maintenance risks

## 8. Implementation recommendation

End with one of:

```text
KEEP CURRENT V1
SIMPLIFY V1 IN PLACE
MIGRATE TO THE PROPOSED MODEL
PARTIAL MIGRATION ONLY
```

Provide the reasoning.

## 9. Proposed implementation tickets

Break the recommended work into small tickets with:

- Title
- What and why
- Acceptance criteria
- Migration impact
- Dependencies
- Estimated complexity: Small, Medium, or Large

---

# Non-goals

Do not propose the following as launch requirements:

- Perfect global vendor coverage
- Exact delivery ZIP mapping
- Continuous scraping of vendor websites
- Automated browser ordering
- Automatic approval based only on fuzzy matching
- Full API integration for every vendor
- Full international tax or legal normalization
- Rebuilding working company-vendor functionality without a migration need
- Deleting existing vendor records that are referenced by customer data

---

# Recommended product decision

The expected direction is:

> Simplify v1 in place rather than replacing it.

Keep the current working 141-vendor implementation as the foundation.

Then:

1. Normalize the schema where needed.
2. Import only suitable v2 additions.
3. Separate customer-facing vendors from reference-only entities.
4. Use geography as ranking metadata.
5. Store shared connector types once.
6. Allow company-level vendors immediately.
7. Use global-admin approval to grow the registry.
8. Let real customer usage determine future expansion priorities.

The attached v2 workbook is a research and migration source.

It should not be imported blindly as 186 equally trusted, equally customer-facing vendor records.
