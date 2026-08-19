# Company Accounting Mapping — PM Decision Brief

**Decision: retain source evidence only; do not build a company invoice-account
mapping.**

The review found one concrete, current FnB classification consumer: the
current-inventory-item classification read model. It resolves a current account
from an item-specific account or its FnB inventory category. It does **not**
consume imported invoice GL Code or Category, and it is not an invoice history,
reporting, or export output. No approved invoice-level business consumer was
found that requires FnB-managed accounting classification. Therefore there is
no justified mapping model to design or implement now.

The following twelve decisions close this request and define the minimum
evidence-preserving gate for a separately approved future consumer.

## 1. Business consumer

**Decision:** No approved invoice report, history view, or export requires a
FnB-managed classification today. The existing current-inventory
classification endpoint is not such a consumer because it does not read
invoice source fields. Retain source evidence only and stop.

**PM gate for reopening:** Name the exact invoice-facing output, its audience,
whether it is a current-policy view or historical output, and the decision the
classification enables. “Future export readiness” alone is not a consumer.

## 2. Immutable source evidence

**Decision:** Each staged invoice line retains the extracted **Source GL Code**
and **Source Category**. Extraction removes leading/trailing whitespace and
treats a resulting blank as missing; it does not case-fold or translate the
remaining text. The complete original staged row is retained separately as the
raw source-row evidence.

On approval, the same extracted values remain in the historical line's GL
snapshot. The historical invoice and line also retain the source
system/property, source invoice/line identity, and invoice date that give those
values meaning.

These are source facts, not FnB assertions. The raw row and historical
extracted values must never be overwritten, normalized again in place, or
backfilled from an FnB account.

## 3. Evidence visibility and missing values

**Decision:** Source GL Code and Source Category remain visible in the invoice
resolution preview before approval and in the approved invoice history. A
missing source value is valid evidence and displays as `—`; it is not silently
replaced with an account, category, item value, or default.

## 4. No promotion to master data

**Decision:** Imported invoice GL Code and Source Category must not create,
edit, or select `vendor_items`, `inventory_items`, FnB inventory categories, or
their current accounting assignments. Invoice matching and current-inventory
classification are separate concerns.

The existing current item override and current category default remain a
separate inventory configuration feature. They are not evidence that an invoice
source value should be mapped or promoted.

## 5. Smallest possible future mapping key

**Decision if a future consumer passes the PM gate:** Start with one
company-scoped mapping keyed by `(company, Source GL Code)`. Preserve the
raw row and extracted historical value as evidence. A future lookup may use
the already trimmed extracted value and an explicitly defined case
normalization, but lookup normalization must not alter either evidence record.

Do not include vendor, store, invoice, item, or FnB category in the initial
key. Those dimensions add policy before there is evidence that the direct
company GL code is insufficient.

## 6. Future target classification entity

**Decision if a future consumer passes the PM gate:** The target is one active
company-owned accounting account. The account must belong to the same company
as the invoice; a target from another company is never valid. This reuses the
existing company accounting-account concept rather than treating a source GL
string as an FnB account.

## 7. Precedence and optional category fallback

**Decision:** There is no mapping or fallback today. If a future consumer is
approved, an exact effective Source GL Code mapping is the only initial rule.
Source Category may be considered solely as a fallback when that approved
consumer demonstrates that source GL is absent or insufficient for a
material, defined population.

If category fallback is later approved, it runs only when no usable Source GL
mapping exists; it cannot override a Source GL result. The existing FnB
inventory item override and FnB category default must not participate in
invoice-source precedence.

## 8. Future classification outcomes

**Decision if mapping is later approved:**

- **Mapped:** exactly one effective company-scoped Source GL mapping resolves
  to one active account. A separately approved category fallback can produce
  `mapped_by_source_category` only when Source GL did not produce a usable
  result.
- **Unmapped:** a source value is present but no effective eligible mapping
  exists. Show the source evidence and require review; do not guess.
- **Conflicting:** configuration produces more than one eligible mapping for
  the same source key, or an otherwise invalid/ambiguous target. Fail closed:
  expose no FnB classification and surface the conflict for correction.
- **Missing source:** Source GL is blank or absent. It remains `missing_source`
  unless an explicitly approved Source Category fallback is present and maps
  uniquely. No inventory or company default fills the gap.

## 9. Authorization and company scope

**Decision if mapping is later approved:** Only a company administrator may
create, change, retire, or correct mappings for that company. A global
administrator may act only in an explicit selected-company context. Store
managers, store users, importers, and any cross-company context must not manage
or supply mappings.

Every mapping read and write must filter by the invoice company. Store scope
does not widen or replace company scope; the mapping is company policy, not a
property or vendor claim.

## 10. Audit requirements

**Decision if mapping is later approved:** Mapping administration requires an
append-only audit trail with company, source key, prior target, new target,
effective window, acting user, timestamp, and stated reason. A classified
invoice output must retain the mapping/version and target used in that output,
while keeping the original source evidence unchanged.

There is no source-mapping audit record to create now because no source mapping
exists. Existing import evidence and approval history remain the audit record
for the source fields themselves.

## 11. Historical treatment: effective dating and snapshots

**Decision if mapping is later approved:** Any invoice-history report or
accounting export must use effective-dated mappings keyed to the invoice
business date and must snapshot the resolved mapping/version and account in
the produced historical classification. A later policy change cannot rewrite
the source GL Code or Source Category, and it cannot silently restate an
already produced historical output. Corrections require an explicit, audited
replacement or rerun policy approved with the consumer.

Neither effective dating nor classification snapshots are needed while source
evidence is the only invoice output.

## 12. Overrides and smallest future implementation

**Decision:** No new item or category override is justified for invoice source
classification. The evidence reviewed shows only current inventory
classification, not a population where the same company Source GL Code needs
different accounts by item or category.

If the PM gate is later met, the smallest implementation is a company Source
GL Code → company accounting-account mapping with the outcomes and governance
above. Source Category fallback requires separate evidence and approval; item
or FnB-category overrides require a further demonstrated exception population.
No schema, UI, route, report, export, QuickBooks work, or historical rewrite
is approved by this brief.
