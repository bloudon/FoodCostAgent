# FnB Cost Pro UOM Architecture Recovery and Audit

**Date:** September 17, 2026  
**Scope:** Investigation and documentation only. No implementation or database changes were made for this audit.

## Executive conclusion

FnB Cost Pro already has the main components required for a coherent UOM system:

- a vendor-independent canonical inventory unit;
- vendor-specific purchase and pack geometry;
- item-specific recipe and issue-unit conversions;
- item-level case/container and fractional-package physical count geometry;
- canonical on-hand quantity, last cost, and weighted-average cost;
- recipe quantities stored with their entered units;
- price and pack provenance.

The August problem did not demonstrate the need for another UOM framework. It exposed disconnected population/write paths, incomplete physical package identity, and places where canonical recipe/storage units were allowed to leak into physical counting presentation.

The largest confirmed system-wide defects are:

1. receiving completion can add raw receipt quantities to canonical on-hand and WAC without authoritative conversion;
2. recipe costing has two materially different conversion engines;
3. the generic weight-to-volume fallback assumes water density where no item density is recorded;
4. some receipt mutation routes do not show an explicit route-local authentication and tenant check;
5. incomplete item geometry can exist even when numeric pack fields appear populated.

No Count Unit table, generalized conversion framework, location subsystem, Orderly reimport, or automatic historical conversion is justified by this review.

## 1. Original approved UOM design

### Evidence hierarchy

`replit.md` describes repository architecture and ownership, but contains no original UOM product decision (`replit.md:32-39`). The strongest design evidence is therefore:

- PM decisions in `attached_assets/`;
- completed task and readiness reports under `.local/tasks/` and `docs/task-reports/`;
- schema comments and implementation history;
- current code only where it agrees with those decisions.

Current behavior by itself is not treated as product approval.

### Canonical inventory unit

Each inventory item has one vendor-independent canonical unit. Inventory quantity, `pricePerUnit`, and `avgCostPerUnit` are expressed in that unit. Vendor pack changes must not change the item's inventory identity or canonical basis.

Evidence:

- `lib/db/src/schema/schema.ts:423-450`
- schema documentation introduced around commit `beacc5d9a`

`inventory_items.caseSize` is a convenience/counting field. It is not authoritative vendor geometry.

### Vendor purchase units and pack geometry

Vendor geometry is separate from the inventory item's canonical unit:

- purchase unit;
- number of purchase units per case;
- inner-pack size and UOM;
- case and unit prices;
- canonical quantity per purchase unit;
- normalized canonical price;
- geometry status, source, pricing basis, and variable-weight status.

Server-derived geometry is authoritative; the client must not invent normalized quantities.

Evidence:

- `lib/db/src/schema/schema.ts:688-729`
- `.local/tasks/vendor-pack-geometry.md`
- implementation commit `04b2ca5576f6882e191b1eef6c2ed1ecaa971095`
- `artifacts/api-server/src/services/vendorPackGeometry.ts:86-163`

Approved examples include:

- 4 packs × 5 lb = 20 canonical lb;
- 12 bottles × 750 mL = 9,000 canonical mL;
- 30-count case = 30 canonical each.

Variable-weight packs require actual delivered weight or an actual canonical-unit price; an estimate cannot become definitive geometry.

### Item-specific recipe and issue units

`inventory_item_units` records item-specific conversions. Its stored quantity means how much canonical inventory quantity corresponds to the configured unit. The same table distinguishes recipe-capable units from transfer/issue-only units.

Evidence:

- `lib/db/src/schema/schema.ts:527-558`
- `artifacts/api-server/src/lib/recipeUnits.ts:26-82,99-181`
- `.local/tasks/uom-formalize-semantics.md` records later formalization work, not a separate approved architecture.

An issue unit is not automatically a recipe unit. A recipe unit is not automatically a physical count unit.

### Physical inventory counting

Physical counting was intended to use practical item-level geometry:

- cases;
- containers/packages;
- fractional containers converted to canonical quantity.

The count line stores canonical `qty` and optional entry-breakdown fields including `caseQty`, `containerQty`, and the legacy `looseUnits` field. The presence of `looseUnits` in storage does not authorize an employee-facing canonical measurement input. Under the settled product rule, count entry is limited to practical physical packages and fractions of those packages; mL, fluid ounces, weight ounces, and other recipe/canonical measurements remain internal conversion outputs.

Evidence:

- `lib/db/src/schema/schema.ts:841-860`
- `artifacts/api-server/src/services/inventory/countQuantity.ts:18-82`
- three-tier imported count evidence at `lib/db/src/schema/schema.ts:2691-2699`
- PM decisions `Pasted--PM-Direction-Unit-Integrity-and-August-Counting-Decisi_1789614586048.txt:13-21,39-56`
- PM clarification in the current request: recipe/canonical measurement units must not become physical count units.

This design supports fractional bottles without making mL the employee-facing count unit.

### Recipe quantities and costing

Recipe components preserve entered quantity and unit as source facts. The modern recursive cost path resolves:

1. an item-specific non-issue conversion;
2. compatible generic same-kind unit ratios;
3. a weight/volume fallback;
4. yield and nested-recipe normalization.

Effective item cost is canonical last cost by default or positive WAC when the company selects WAC. Recipe `computedCost` is derived/cache data; historical snapshots are outcomes, not the current source of truth.

Evidence:

- `docs/task-reports/1113-recipe-uom-yield-migration-readiness.md:26-37,64-174`
- source-field readiness commit `f86bda7767556ff5d3d6ae58a7f594a31698a67d`
- architecture report commit `1739b93a54d58443a59b18aa56004578c5eff13f`

Task 1113 approved readiness with source fields only; it did not approve migration or inferred conversion data.

### Transfers and issues

Transfers/issues use item-specific rows marked `isIssueUnit`. These represent operational issue quantities without redefining inventory or recipe units.

Evidence:

- `lib/db/src/schema/schema.ts:552-558`
- current transfer/issue call sites consuming item-unit configuration.

### Receiving, valuation, WAC, and price history

Intended flow:

1. receive in a vendor purchase unit;
2. resolve vendor pack geometry;
3. convert to canonical quantity;
4. update canonical on-hand;
5. update canonical WAC using canonical received quantity and value;
6. preserve vendor price source, timestamp, and source reference.

Evidence:

- `lib/db/src/schema/schema.ts:444-450,688-729`
- `.local/tasks/vendor-pack-geometry.md`
- `artifacts/api-server/src/lib/costing.ts:1-80`

No recovered decision authorizes multiplying historical receipt quantities merely because their stored unit differs from the item unit.

## 2. Current system-wide architecture

```text
Vendor catalog
  purchase unit + case/inner pack + source price
             |
             v
Vendor pack geometry service
  canonical quantity per purchase unit
  normalized price per canonical unit
             |
       +-----+-------------------------------+
       |                                     |
       v                                     v
Purchasing / Receiving                 Inventory item
purchase quantity                      canonical unit
must normalize                         item count geometry
before inventory mutation              item recipe/issue units
       |                                     |
       v                                     v
Canonical on-hand + WAC          Physical count: case/container/fraction
       |                                     |
       +------------------+------------------+
                          v
                 Canonical inventory quantity
                          |
              +-----------+-----------+
              |                       |
              v                       v
      Recipe usage/costing        Transfers/issues
      entered recipe unit         configured issue unit
      item conversion             item conversion
```

Ownership boundaries:

| Responsibility | Source of truth |
|---|---|
| Inventory identity and quantity basis | `inventory_items.unitId` |
| Vendor/orderable pack | `vendor_items` geometry and provenance |
| Physical count package | item `caseSize`, `containerSize`, `casePkgCount`, `containerLabel`, `containerUnitId` |
| Count result | canonical `inventory_count_lines.qty`; package fields preserve entry form |
| Recipe/issue conversion | `inventory_item_units` |
| Generic compatible-unit ratio | `units` and, in legacy paths, `unit_conversions` |
| On-hand and valuation | canonical store/item quantities and item canonical cost fields |
| Historical vendor price evidence | vendor price source/time/reference fields |
| Location assignment | canonical item/location assignments, with legacy storage location fallback |

Canonical locations are preferred and legacy storage locations are fallback-only (`artifacts/api-server/src/services/inventory/effectiveItemLocations.ts:47-128`). Count lines still carry a `storageLocationId`, so every population and mutation path must use the shared resolver and company checks rather than assuming the ID's subsystem.

## 3. End-to-end examples

### Bay Hill liquor

Current Dev evidence for **12 2022 750ML L ECOLE FRENCHTOWN RED WINE**:

- canonical unit: mL;
- physical container: bottle;
- 750 mL per bottle;
- 12 bottles per case;
- case canonical quantity: 9,000 mL;
- case price: $203.16;
- bottle price: $16.93;
- canonical cost: approximately $0.022573/mL.

Flow:

```text
1 case
  = 12 bottles
  = 9,000 mL canonical
  = $203.16

5.5 bottles counted
  = 5.5 × 750
  = 4,125 mL canonical
  = 4,125 × $0.022573333
  = $93.11
```

An employee-facing count should say **Cases**, **Bottles**, and support a **fraction of a bottle** where required. It must not offer mL, fluid ounces, weight ounces, or another canonical/recipe measurement as a count unit. FnB converts the physical package count to mL internally. A recipe may then consume ounces or mL through its own item-specific or compatible measurement conversion.

The erroneous August wine line was cleared to zero in Dev before this audit. Its physical geometry remains available for a clean test. The August session remains unapplied.

### Bay Hill food

Current Dev examples show the same existing model:

- **Assorted gourmet mushrooms, 5 lb**:
  - canonical unit: ounce weight;
  - 5 containers × 16 oz = 80 canonical oz;
  - $70 case = $0.875/oz.
- **2 oz Tabasco hot sauce**:
  - 48 containers × 1 canonical oz in current imported geometry;
  - $34.86 case = $0.72625/oz.

The intended food flow is:

```text
vendor case -> item package geometry -> canonical weight/volume/each
             -> physical case/package/partial-package count
             -> recipe entered in oz/lb/mL/portion through item conversion
             -> canonical cost × canonical consumption
```

No current Bay Hill `recipe_components` row linked these sampled packaged items to a recipe. Therefore their complete package-to-recipe chain cannot be claimed as demonstrated from current Dev data. That is a configuration/evidence gap, not proof that another UOM architecture is needed.

Prior Tabasco validation also showed why item-specific conversion matters: a recipe quantity expressed as fluid ounces cannot be costed from an item stored as count/weight without a verified item relationship. The system must report unresolved geometry rather than treat the missing conversion as zero cost.

## 4. Physical counting contract

1. Canonical unit is the storage and valuation basis, not automatically the employee count unit.
2. Recipe unit is the consumption/measurement expression, not automatically the employee count unit.
3. Vendor purchase geometry describes one vendor's orderable pack and must not redefine the item's physical count configuration.
4. Item count geometry owns physical counting.
5. Fractional packages are allowed only where verified item geometry converts them to canonical quantity.
6. Canonical or recipe measurements—including mL, fluid ounces, and weight ounces—must not appear as count units merely because they are the canonical unit.
7. Every authoritative write path must recalculate canonical `qty` on the server.
8. Missing or internally inconsistent physical geometry must block package counting; it must not silently reinterpret bottles as mL, ounces, or each.
9. Multiple vendor packs may map to one inventory item. The physical count configuration remains item-level unless Brian approves a genuine requirement for multiple simultaneous physical count configurations.

The current architecture clearly supports one primary case/container/fractional-package configuration per item. Recovered evidence does not establish an approved model for multiple simultaneous physical count configurations. That remains a product decision, not permission to add a Count Unit subsystem.

## 5. Intended-versus-actual implementation matrix

| Area | Intended behavior | Actual behavior | Source of truth | Gap/class |
|---|---|---|---|---|
| Vendor catalog | Preserve purchase unit, pack, price basis, and provenance; derive canonical geometry | Geometry/status/provenance exist; Orderly rows can use canonical-oriented fields that need item physical context for presentation | `vendor_items`; geometry service | A reconnect; C configuration |
| Purchasing | Order in vendor units and retain pack identity | Purchase paths have vendor pack fields, but not every call site proves use of one normalization boundary | Vendor item + PO line | A reconnect; B if bypass confirmed |
| Receiving | Convert actual received purchase quantity/value before on-hand and WAC | Completion currently adds raw `receivedQty` to canonical on-hand and can treat `priceEach` as canonical cost | Receipt line + vendor geometry + completion transaction | **B confirmed defect** |
| Inventory storage | Store canonical quantity and canonical unit cost | Core fields follow this model | Inventory/store item | No architecture gap |
| Manual counting | Cases/containers/fractions convert server-side; explicit physical labels | Main create/update paths now use shared calculator; actual usability depends on complete item labels/geometry | Item count geometry + count calculator | A reconnect; C configuration |
| Mobile counting | Same contract and atomic result as web | Corrected mobile paths use shared calculator; older parallel paths required repair | Shared calculator + mobile route | A reconnect; test parity follow-up |
| Recipe entry | Preserve entered qty/unit; recipe units do not redefine count units | Source fields exist | Recipe component | No architecture gap |
| Recipe costing | One authoritative item-first conversion with explicit unresolved results | Modern recursive and legacy calculators have different precedence and coverage; legacy can return zero | Item units + chosen calculator | **B confirmed defect; D policy choice** |
| Inventory valuation | Canonical qty × canonical effective cost | Correct when upstream qty/cost are canonical; wrong receiving normalization contaminates result | Item/store inventory cost fields | B downstream impact |
| Transfers/issues | Use configured issue unit and normalize to canonical | `isIssueUnit` exists; not every issue/transfer call site proves normalization | `inventory_item_units` | A reconnect; B if bypass confirmed |
| Locations | Populate from canonical assignments, legacy fallback only | Shared resolver exists; direct legacy assumptions remain a risk | Effective location resolver | A reconnect |

## 6. Confirmed defects and operational impact

### High: receiving conversion bypass

Receipt completion code currently uses raw received quantity in on-hand/WAC updates rather than proving conversion from receipt/vendor unit to canonical quantity (`artifacts/api-server/src/routes.ts:15529-15613`).

**Impact:** on-hand, WAC, valuation, and later recipe cost can be wrong by a pack factor.

**Smallest correction:** route receipt completion through one existing vendor-geometry normalization boundary inside the completion transaction; reject unresolved/variable geometry unless actual canonical quantity is present.

### High: receipt mutation authorization needs explicit closure

Route-local review found receipt line save, storage-location update, and reopen declarations without an obvious explicit authentication/company check (`artifacts/api-server/src/routes.ts` around the 15398-15461 region).

**Impact:** if no enclosing middleware supplies the boundary, cross-company receipt mutation is possible.

**Smallest correction:** verify the full router middleware chain, then add explicit receipt/company ownership checks where absent. This is a security boundary, not UOM architecture.

### Medium: two recipe conversion engines

The recursive calculator checks item-specific units and compatible ratios but does not use the legacy global conversion table. Legacy `calculateComponentCost` omits item-specific units and can return zero for incompatibility.

Evidence:

- `docs/task-reports/1113-recipe-uom-yield-migration-readiness.md:105-146`
- `docs/task-reports/bay-hill-recipe-costing-validation.md:192-223`

**Impact:** the same recipe can cost differently depending on call path; an unresolved component can look like a valid zero cost.

**Smallest correction:** select one existing calculator as authoritative and route callers through it; preserve explicit unresolved reasons.

### Medium: unverified weight/volume fallback

The recursive path uses a water-density numeric fallback when no item density is stored.

**Impact:** non-water ingredients may be materially miscosted.

**Smallest correction:** Brian must choose whether to require an explicit item density/factor or fail closed. Do not add broad automatic density inference.

### Medium: incomplete package identity

Bay Hill data demonstrated items with valid-looking numeric sizes but missing physical container identity. The wine had `750` and `12` while its container identity was effectively mL until corrected.

**Impact:** UI labels can expose canonical measurement as the count input or show generic “container,” even when the intended action is bottle counting.

**Smallest correction:** validate and configure existing item container label/unit fields; incomplete identity must fail closed.

### Low/medium: stale and zero-cost ambiguity

Prior validation found no clear stale-price policy and cases where empty/unresolved recipes can appear as $0.

**Impact:** users cannot distinguish a real zero from unavailable costing evidence.

**Smallest correction:** typed unresolved/stale outcomes using current provenance fields.

## 7. Status of recent corrections

| Correction | Implemented | Tested | Deployment/status |
|---|---|---|---|
| Canonical-location manual count population | Yes | Effective-location and population tests exist | Current Dev code; not accepted for VPS rollout |
| Shared canonical count calculation | Yes | 5.5 × 750 = 4,125; invalid geometry/unit/input tests | Current Dev code |
| Web/manual count writes | Main create/update paths corrected | Focused tests/typecheck passed in prior work | Dev demonstration remains the release gate |
| Mobile count writes | Older permissive path corrected to shared calculator | Source review and helper tests; authenticated route test still absent | Dev only |
| Explicit case/container/fractional-package labels | Implemented when item physical identity is configured | Component tests | Canonical/recipe measurement inputs must remain hidden; actual item configuration still determines correctness |
| Vendor purchase vs canonical price display | Implemented; latest Dev logic uses physical item label and case/pack price for bottle presentation | Focused presentation tests passed | Latest local commit `0130ba17`; no VPS deployment |
| Bay Hill wine item physical identity | Configured in Dev as bottle, 750 mL, 12/case | Read-only post-change verification showed $16.93/bottle and $0.022573/mL | Dev data only |
| Erroneous August wine line | Cleared to zero by explicit user direction before this audit | Verified session remains unapplied | Dev only |
| Receiving normalization | **Not fixed** | Read-only audit only | Must remain separate work |
| Historical receipt correction | Not authorized | Not applicable | HOLD |

Relevant recent implementation history in the current branch includes `305d6b6c`, `f3d2e25e`, and `0130ba17`. A prior reviewed tree was mirrored to GitHub as `ec2d9051…`, but no VPS deployment occurred. GitHub/API-created commit identity must not be confused with the local commit identity; compare trees when reconciling.

### Receiving audit

Reconciled Dev scope:

- 25 potentially mismatched lines;
- 11 completed receipts;
- 5 inventory items;
- 1 company.

All 25 had positive parsed/verified/inferred geometry, but stored evidence does not establish whether the operator entered purchase units or a pre-expanded canonical quantity. The mechanical conversion candidate is not proof and must not be applied.

Historical correction requires transaction-level evidence for each receipt line.

## 8. Minimum remaining work by priority

### A. Existing functionality that needs reconnecting

1. Route every receiving completion through existing vendor geometry.
2. Route all manual/mobile count writes through the shared canonical calculator.
3. Route count population through effective canonical locations.
4. Route transfers/issues through existing item issue-unit conversion.
5. Route recipe costing callers through one existing authoritative calculator.

### B. Confirmed implementation defects

1. Raw receipt quantity can reach canonical on-hand/WAC.
2. Recipe calculators disagree and can represent unresolved conversion as zero.
3. Receipt mutation authorization boundaries require explicit verification/fix.
4. Generic water-density fallback can miscost non-water ingredients.

### C. Missing configuration or incomplete item geometry

1. Validate item physical container label, unit, size, and case package count.
2. Validate vendor pack status/provenance independently from item count geometry.
3. Add item-specific recipe/issue rows only where generic compatible ratios are insufficient.
4. Complete Bay Hill packaged-food-to-recipe mappings before claiming an end-to-end food demonstration.

### D. Genuine gaps in the approved design

Only these questions remain genuine design decisions:

1. Which existing recipe calculator becomes authoritative?
2. Must weight/volume conversion require an explicit item density/factor, or always reject without one?
3. Should unresolved/stale costing return a typed status everywhere rather than numeric zero?
4. Does one item need more than one simultaneous physical count configuration? Recovered evidence does not establish this requirement.

### E. Historical operator review

1. Review the 25 receipt lines individually against transaction/source evidence.
2. Review remaining suspicious August entries individually.
3. Do not infer corrections from unit mismatch alone.
4. Do not alter WAC, on-hand, historical receipts, or Orderly source evidence without a separately reviewed manifest and approval.

## 9. Decisions required from Brian

1. Select the authoritative existing recipe-cost conversion path.
2. Decide the non-water weight/volume policy.
3. Decide whether unresolved/stale costs must be typed and visible rather than represented as zero.
4. Confirm physical count geometry for ambiguous Bay Hill items.
5. Confirm whether multiple physical count configurations per item are an actual operational requirement.
6. Decide disposition of each historical receipt/August line only after operator evidence is available.

## Independent simplicity review

**Answer:** FnB Cost Pro is mostly rediscovering and reconnecting functionality it already has, not discovering the need for a rebuild.

The existing model already supports:

- canonical inventory units;
- vendor pack geometry;
- item-specific recipe and issue units;
- case/container/fractional-package count breakdown;
- fractional package conversion;
- canonical WAC and last cost;
- price provenance;
- canonical and legacy location reconciliation.

The August defects can be addressed by correctly configuring physical item identity and reconnecting all population/write paths to the existing services. Receiving and recipe-costing defects require one authoritative boundary each, not another model.

Do not add:

- a Count Unit table;
- a generalized UOM framework;
- a duplicate location model;
- a separate recovery engine;
- spreadsheet/precomputed conversion authority;
- automatic historical conversion.
# FnB Cost Pro UOM Architecture Recovery and Audit

**Date:** September 17, 2026  
**Scope:** Investigation and documentation only. No implementation or database changes were made for this audit.

## Executive conclusion

FnB Cost Pro already has the main components required for a coherent UOM system:

- a vendor-independent canonical inventory unit;
- vendor-specific purchase and pack geometry;
- item-specific recipe and issue-unit conversions;
- item-level case/container and fractional-package physical count geometry;
- canonical on-hand quantity, last cost, and weighted-average cost;
- recipe quantities stored with their entered units;
- price and pack provenance.

The August problem did not demonstrate the need for another UOM framework. It exposed disconnected population/write paths, incomplete physical package identity, and places where canonical recipe/storage units were allowed to leak into physical counting presentation.

The largest confirmed system-wide defects are:

1. receiving completion can add raw receipt quantities to canonical on-hand and WAC without authoritative conversion;
2. recipe costing has two materially different conversion engines;
3. the generic weight-to-volume fallback assumes water density where no item density is recorded;
4. some receipt mutation routes do not show an explicit route-local authentication and tenant check;
5. incomplete item geometry can exist even when numeric pack fields appear populated.

No Count Unit table, generalized conversion framework, location subsystem, Orderly reimport, or automatic historical conversion is justified by this review.

## 1. Original approved UOM design

### Evidence hierarchy

`replit.md` describes repository architecture and ownership, but contains no original UOM product decision (`replit.md:32-39`). The strongest design evidence is therefore:

- PM decisions in `attached_assets/`;
- completed task and readiness reports under `.local/tasks/` and `docs/task-reports/`;
- schema comments and implementation history;
- current code only where it agrees with those decisions.

Current behavior by itself is not treated as product approval.

### Canonical inventory unit

Each inventory item has one vendor-independent canonical unit. Inventory quantity, `pricePerUnit`, and `avgCostPerUnit` are expressed in that unit. Vendor pack changes must not change the item's inventory identity or canonical basis.

Evidence:

- `lib/db/src/schema/schema.ts:423-450`
- schema documentation introduced around commit `beacc5d9a`

`inventory_items.caseSize` is a convenience/counting field. It is not authoritative vendor geometry.

### Vendor purchase units and pack geometry

Vendor geometry is separate from the inventory item's canonical unit:

- purchase unit;
- number of purchase units per case;
- inner-pack size and UOM;
- case and unit prices;
- canonical quantity per purchase unit;
- normalized canonical price;
- geometry status, source, pricing basis, and variable-weight status.

Server-derived geometry is authoritative; the client must not invent normalized quantities.

Evidence:

- `lib/db/src/schema/schema.ts:688-729`
- `.local/tasks/vendor-pack-geometry.md`
- implementation commit `04b2ca5576f6882e191b1eef6c2ed1ecaa971095`
- `artifacts/api-server/src/services/vendorPackGeometry.ts:86-163`

Approved examples include:

- 4 packs × 5 lb = 20 canonical lb;
- 12 bottles × 750 mL = 9,000 canonical mL;
- 30-count case = 30 canonical each.

Variable-weight packs require actual delivered weight or an actual canonical-unit price; an estimate cannot become definitive geometry.

### Item-specific recipe and issue units

`inventory_item_units` records item-specific conversions. Its stored quantity means how much canonical inventory quantity corresponds to the configured unit. The same table distinguishes recipe-capable units from transfer/issue-only units.

Evidence:

- `lib/db/src/schema/schema.ts:527-558`
- `artifacts/api-server/src/lib/recipeUnits.ts:26-82,99-181`
- `.local/tasks/uom-formalize-semantics.md` records later formalization work, not a separate approved architecture.

An issue unit is not automatically a recipe unit. A recipe unit is not automatically a physical count unit.

### Physical inventory counting

Physical counting was intended to use practical item-level geometry:

- cases;
- containers/packages;
- fractional containers converted to canonical quantity.

The count line stores canonical `qty` and optional entry-breakdown fields including `caseQty`, `containerQty`, and the legacy `looseUnits` field. The presence of `looseUnits` in storage does not authorize an employee-facing canonical measurement input. Under the settled product rule, count entry is limited to practical physical packages and fractions of those packages; mL, fluid ounces, weight ounces, and other recipe/canonical measurements remain internal conversion outputs.

Evidence:

- `lib/db/src/schema/schema.ts:841-860`
- `artifacts/api-server/src/services/inventory/countQuantity.ts:18-82`
- three-tier imported count evidence at `lib/db/src/schema/schema.ts:2691-2699`
- PM decisions `Pasted--PM-Direction-Unit-Integrity-and-August-Counting-Decisi_1789614586048.txt:13-21,39-56`
- PM clarification in the current request: recipe/canonical measurement units must not become physical count units.

This design supports fractional bottles without making mL the employee-facing count unit.

### Recipe quantities and costing

Recipe components preserve entered quantity and unit as source facts. The modern recursive cost path resolves:

1. an item-specific non-issue conversion;
2. compatible generic same-kind unit ratios;
3. a weight/volume fallback;
4. yield and nested-recipe normalization.

Effective item cost is canonical last cost by default or positive WAC when the company selects WAC. Recipe `computedCost` is derived/cache data; historical snapshots are outcomes, not the current source of truth.

Evidence:

- `docs/task-reports/1113-recipe-uom-yield-migration-readiness.md:26-37,64-174`
- source-field readiness commit `f86bda7767556ff5d3d6ae58a7f594a31698a67d`
- architecture report commit `1739b93a54d58443a59b18aa56004578c5eff13f`

Task 1113 approved readiness with source fields only; it did not approve migration or inferred conversion data.

### Transfers and issues

Transfers/issues use item-specific rows marked `isIssueUnit`. These represent operational issue quantities without redefining inventory or recipe units.

Evidence:

- `lib/db/src/schema/schema.ts:552-558`
- current transfer/issue call sites consuming item-unit configuration.

### Receiving, valuation, WAC, and price history

Intended flow:

1. receive in a vendor purchase unit;
2. resolve vendor pack geometry;
3. convert to canonical quantity;
4. update canonical on-hand;
5. update canonical WAC using canonical received quantity and value;
6. preserve vendor price source, timestamp, and source reference.

Evidence:

- `lib/db/src/schema/schema.ts:444-450,688-729`
- `.local/tasks/vendor-pack-geometry.md`
- `artifacts/api-server/src/lib/costing.ts:1-80`

No recovered decision authorizes multiplying historical receipt quantities merely because their stored unit differs from the item unit.

## 2. Current system-wide architecture

```text
Vendor catalog
  purchase unit + case/inner pack + source price
             |
             v
Vendor pack geometry service
  canonical quantity per purchase unit
  normalized price per canonical unit
             |
       +-----+-------------------------------+
       |                                     |
       v                                     v
Purchasing / Receiving                 Inventory item
purchase quantity                      canonical unit
must normalize                         item count geometry
before inventory mutation              item recipe/issue units
       |                                     |
       v                                     v
Canonical on-hand + WAC          Physical count: case/container/fraction
       |                                     |
       +------------------+------------------+
                          v
                 Canonical inventory quantity
                          |
              +-----------+-----------+
              |                       |
              v                       v
      Recipe usage/costing        Transfers/issues
      entered recipe unit         configured issue unit
      item conversion             item conversion
```

Ownership boundaries:

| Responsibility | Source of truth |
|---|---|
| Inventory identity and quantity basis | `inventory_items.unitId` |
| Vendor/orderable pack | `vendor_items` geometry and provenance |
| Physical count package | item `caseSize`, `containerSize`, `casePkgCount`, `containerLabel`, `containerUnitId` |
| Count result | canonical `inventory_count_lines.qty`; package fields preserve entry form |
| Recipe/issue conversion | `inventory_item_units` |
| Generic compatible-unit ratio | `units` and, in legacy paths, `unit_conversions` |
| On-hand and valuation | canonical store/item quantities and item canonical cost fields |
| Historical vendor price evidence | vendor price source/time/reference fields |
| Location assignment | canonical item/location assignments, with legacy storage location fallback |

Canonical locations are preferred and legacy storage locations are fallback-only (`artifacts/api-server/src/services/inventory/effectiveItemLocations.ts:47-128`). Count lines still carry a `storageLocationId`, so every population and mutation path must use the shared resolver and company checks rather than assuming the ID's subsystem.

## 3. End-to-end examples

### Bay Hill liquor

Current Dev evidence for **12 2022 750ML L ECOLE FRENCHTOWN RED WINE**:

- canonical unit: mL;
- physical container: bottle;
- 750 mL per bottle;
- 12 bottles per case;
- case canonical quantity: 9,000 mL;
- case price: $203.16;
- bottle price: $16.93;
- canonical cost: approximately $0.022573/mL.

Flow:

```text
1 case
  = 12 bottles
  = 9,000 mL canonical
  = $203.16

5.5 bottles counted
  = 5.5 × 750
  = 4,125 mL canonical
  = 4,125 × $0.022573333
  = $93.11
```

An employee-facing count should say **Cases**, **Bottles**, and support a **fraction of a bottle** where required. It must not offer mL, fluid ounces, weight ounces, or another canonical/recipe measurement as a count unit. FnB converts the physical package count to mL internally. A recipe may then consume ounces or mL through its own item-specific or compatible measurement conversion.

The erroneous August wine line was cleared to zero in Dev before this audit. Its physical geometry remains available for a clean test. The August session remains unapplied.

### Bay Hill food

Current Dev examples show the same existing model:

- **Assorted gourmet mushrooms, 5 lb**:
  - canonical unit: ounce weight;
  - 5 containers × 16 oz = 80 canonical oz;
  - $70 case = $0.875/oz.
- **2 oz Tabasco hot sauce**:
  - 48 containers × 1 canonical oz in current imported geometry;
  - $34.86 case = $0.72625/oz.

The intended food flow is:

```text
vendor case -> item package geometry -> canonical weight/volume/each
             -> physical case/package/partial-package count
             -> recipe entered in oz/lb/mL/portion through item conversion
             -> canonical cost × canonical consumption
```

No current Bay Hill `recipe_components` row linked these sampled packaged items to a recipe. Therefore their complete package-to-recipe chain cannot be claimed as demonstrated from current Dev data. That is a configuration/evidence gap, not proof that another UOM architecture is needed.

Prior Tabasco validation also showed why item-specific conversion matters: a recipe quantity expressed as fluid ounces cannot be costed from an item stored as count/weight without a verified item relationship. The system must report unresolved geometry rather than treat the missing conversion as zero cost.

## 4. Physical counting contract

1. Canonical unit is the storage and valuation basis, not automatically the employee count unit.
2. Recipe unit is the consumption/measurement expression, not automatically the employee count unit.
3. Vendor purchase geometry describes one vendor's orderable pack and must not redefine the item's physical count configuration.
4. Item count geometry owns physical counting.
5. Fractional packages are allowed only where verified item geometry converts them to canonical quantity.
6. Canonical or recipe measurements—including mL, fluid ounces, and weight ounces—must not appear as count units merely because they are the canonical unit.
7. Every authoritative write path must recalculate canonical `qty` on the server.
8. Missing or internally inconsistent physical geometry must block package counting; it must not silently reinterpret bottles as mL, ounces, or each.
9. Multiple vendor packs may map to one inventory item. The physical count configuration remains item-level unless Brian approves a genuine requirement for multiple simultaneous physical count configurations.

The current architecture clearly supports one primary case/container/fractional-package configuration per item. Recovered evidence does not establish an approved model for multiple simultaneous physical count configurations. That remains a product decision, not permission to add a Count Unit subsystem.

## 5. Intended-versus-actual implementation matrix

| Area | Intended behavior | Actual behavior | Source of truth | Gap/class |
|---|---|---|---|---|
| Vendor catalog | Preserve purchase unit, pack, price basis, and provenance; derive canonical geometry | Geometry/status/provenance exist; Orderly rows can use canonical-oriented fields that need item physical context for presentation | `vendor_items`; geometry service | A reconnect; C configuration |
| Purchasing | Order in vendor units and retain pack identity | Purchase paths have vendor pack fields, but not every call site proves use of one normalization boundary | Vendor item + PO line | A reconnect; B if bypass confirmed |
| Receiving | Convert actual received purchase quantity/value before on-hand and WAC | Completion currently adds raw `receivedQty` to canonical on-hand and can treat `priceEach` as canonical cost | Receipt line + vendor geometry + completion transaction | **B confirmed defect** |
| Inventory storage | Store canonical quantity and canonical unit cost | Core fields follow this model | Inventory/store item | No architecture gap |
| Manual counting | Cases/containers/fractions convert server-side; explicit physical labels | Main create/update paths now use shared calculator; actual usability depends on complete item labels/geometry | Item count geometry + count calculator | A reconnect; C configuration |
| Mobile counting | Same contract and atomic result as web | Corrected mobile paths use shared calculator; older parallel paths required repair | Shared calculator + mobile route | A reconnect; test parity follow-up |
| Recipe entry | Preserve entered qty/unit; recipe units do not redefine count units | Source fields exist | Recipe component | No architecture gap |
| Recipe costing | One authoritative item-first conversion with explicit unresolved results | Modern recursive and legacy calculators have different precedence and coverage; legacy can return zero | Item units + chosen calculator | **B confirmed defect; D policy choice** |
| Inventory valuation | Canonical qty × canonical effective cost | Correct when upstream qty/cost are canonical; wrong receiving normalization contaminates result | Item/store inventory cost fields | B downstream impact |
| Transfers/issues | Use configured issue unit and normalize to canonical | `isIssueUnit` exists; not every issue/transfer call site proves normalization | `inventory_item_units` | A reconnect; B if bypass confirmed |
| Locations | Populate from canonical assignments, legacy fallback only | Shared resolver exists; direct legacy assumptions remain a risk | Effective location resolver | A reconnect |

## 6. Confirmed defects and operational impact

### High: receiving conversion bypass

Receipt completion code currently uses raw received quantity in on-hand/WAC updates rather than proving conversion from receipt/vendor unit to canonical quantity (`artifacts/api-server/src/routes.ts:15529-15613`).

**Impact:** on-hand, WAC, valuation, and later recipe cost can be wrong by a pack factor.

**Smallest correction:** route receipt completion through one existing vendor-geometry normalization boundary inside the completion transaction; reject unresolved/variable geometry unless actual canonical quantity is present.

### High: receipt mutation authorization needs explicit closure

Route-local review found receipt line save, storage-location update, and reopen declarations without an obvious explicit authentication/company check (`artifacts/api-server/src/routes.ts` around the 15398-15461 region).

**Impact:** if no enclosing middleware supplies the boundary, cross-company receipt mutation is possible.

**Smallest correction:** verify the full router middleware chain, then add explicit receipt/company ownership checks where absent. This is a security boundary, not UOM architecture.

### Medium: two recipe conversion engines

The recursive calculator checks item-specific units and compatible ratios but does not use the legacy global conversion table. Legacy `calculateComponentCost` omits item-specific units and can return zero for incompatibility.

Evidence:

- `docs/task-reports/1113-recipe-uom-yield-migration-readiness.md:105-146`
- `docs/task-reports/bay-hill-recipe-costing-validation.md:192-223`

**Impact:** the same recipe can cost differently depending on call path; an unresolved component can look like a valid zero cost.

**Smallest correction:** select one existing calculator as authoritative and route callers through it; preserve explicit unresolved reasons.

### Medium: unverified weight/volume fallback

The recursive path uses a water-density numeric fallback when no item density is stored.

**Impact:** non-water ingredients may be materially miscosted.

**Smallest correction:** Brian must choose whether to require an explicit item density/factor or fail closed. Do not add broad automatic density inference.

### Medium: incomplete package identity

Bay Hill data demonstrated items with valid-looking numeric sizes but missing physical container identity. The wine had `750` and `12` while its container identity was effectively mL until corrected.

**Impact:** UI labels can expose canonical measurement as the count input or show generic “container,” even when the intended action is bottle counting.

**Smallest correction:** validate and configure existing item container label/unit fields; incomplete identity must fail closed.

### Low/medium: stale and zero-cost ambiguity

Prior validation found no clear stale-price policy and cases where empty/unresolved recipes can appear as $0.

**Impact:** users cannot distinguish a real zero from unavailable costing evidence.

**Smallest correction:** typed unresolved/stale outcomes using current provenance fields.

## 7. Status of recent corrections

| Correction | Implemented | Tested | Deployment/status |
|---|---|---|---|
| Canonical-location manual count population | Yes | Effective-location and population tests exist | Current Dev code; not accepted for VPS rollout |
| Shared canonical count calculation | Yes | 5.5 × 750 = 4,125; invalid geometry/unit/input tests | Current Dev code |
| Web/manual count writes | Main create/update paths corrected | Focused tests/typecheck passed in prior work | Dev demonstration remains the release gate |
| Mobile count writes | Older permissive path corrected to shared calculator | Source review and helper tests; authenticated route test still absent | Dev only |
| Explicit case/container/fractional-package labels | Implemented when item physical identity is configured | Component tests | Canonical/recipe measurement inputs must remain hidden; actual item configuration still determines correctness |
| Vendor purchase vs canonical price display | Implemented; latest Dev logic uses physical item label and case/pack price for bottle presentation | Focused presentation tests passed | Latest local commit `0130ba17`; no VPS deployment |
| Bay Hill wine item physical identity | Configured in Dev as bottle, 750 mL, 12/case | Read-only post-change verification showed $16.93/bottle and $0.022573/mL | Dev data only |
| Erroneous August wine line | Cleared to zero by explicit user direction before this audit | Verified session remains unapplied | Dev only |
| Receiving normalization | **Not fixed** | Read-only audit only | Must remain separate work |
| Historical receipt correction | Not authorized | Not applicable | HOLD |

Relevant recent implementation history in the current branch includes `305d6b6c`, `f3d2e25e`, and `0130ba17`. A prior reviewed tree was mirrored to GitHub as `ec2d9051…`, but no VPS deployment occurred. GitHub/API-created commit identity must not be confused with the local commit identity; compare trees when reconciling.

### Receiving audit

Reconciled Dev scope:

- 25 potentially mismatched lines;
- 11 completed receipts;
- 5 inventory items;
- 1 company.

All 25 had positive parsed/verified/inferred geometry, but stored evidence does not establish whether the operator entered purchase units or a pre-expanded canonical quantity. The mechanical conversion candidate is not proof and must not be applied.

Historical correction requires transaction-level evidence for each receipt line.

## 8. Minimum remaining work by priority

### A. Existing functionality that needs reconnecting

1. Route every receiving completion through existing vendor geometry.
2. Route all manual/mobile count writes through the shared canonical calculator.
3. Route count population through effective canonical locations.
4. Route transfers/issues through existing item issue-unit conversion.
5. Route recipe costing callers through one existing authoritative calculator.

### B. Confirmed implementation defects

1. Raw receipt quantity can reach canonical on-hand/WAC.
2. Recipe calculators disagree and can represent unresolved conversion as zero.
3. Receipt mutation authorization boundaries require explicit verification/fix.
4. Generic water-density fallback can miscost non-water ingredients.

### C. Missing configuration or incomplete item geometry

1. Validate item physical container label, unit, size, and case package count.
2. Validate vendor pack status/provenance independently from item count geometry.
3. Add item-specific recipe/issue rows only where generic compatible ratios are insufficient.
4. Complete Bay Hill packaged-food-to-recipe mappings before claiming an end-to-end food demonstration.

### D. Genuine gaps in the approved design

Only these questions remain genuine design decisions:

1. Which existing recipe calculator becomes authoritative?
2. Must weight/volume conversion require an explicit item density/factor, or always reject without one?
3. Should unresolved/stale costing return a typed status everywhere rather than numeric zero?
4. Does one item need more than one simultaneous physical count configuration? Recovered evidence does not establish this requirement.

### E. Historical operator review

1. Review the 25 receipt lines individually against transaction/source evidence.
2. Review remaining suspicious August entries individually.
3. Do not infer corrections from unit mismatch alone.
4. Do not alter WAC, on-hand, historical receipts, or Orderly source evidence without a separately reviewed manifest and approval.

## 9. Decisions required from Brian

1. Select the authoritative existing recipe-cost conversion path.
2. Decide the non-water weight/volume policy.
3. Decide whether unresolved/stale costs must be typed and visible rather than represented as zero.
4. Confirm physical count geometry for ambiguous Bay Hill items.
5. Confirm whether multiple physical count configurations per item are an actual operational requirement.
6. Decide disposition of each historical receipt/August line only after operator evidence is available.

## Independent simplicity review

**Answer:** FnB Cost Pro is mostly rediscovering and reconnecting functionality it already has, not discovering the need for a rebuild.

The existing model already supports:

- canonical inventory units;
- vendor pack geometry;
- item-specific recipe and issue units;
- case/container/fractional-package count breakdown;
- fractional package conversion;
- canonical WAC and last cost;
- price provenance;
- canonical and legacy location reconciliation.

The August defects can be addressed by correctly configuring physical item identity and reconnecting all population/write paths to the existing services. Receiving and recipe-costing defects require one authoritative boundary each, not another model.

Do not add:

- a Count Unit table;
- a generalized UOM framework;
- a duplicate location model;
- a separate recovery engine;
- spreadsheet/precomputed conversion authority;
- automatic historical conversion.
