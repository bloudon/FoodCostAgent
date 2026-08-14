# Task #1113 — Recipe / UOM / yield migration readiness

## Asked

Document the current FnB recipe, yield, conversion, sub-recipe, menu-item, and incomplete-record architecture before harvesting a representative 10–20 recipe Orderly sample. This is an evidence-only readiness gate: no schema, API, UI, costing, conversion, yield, or migration behavior was changed.

## Executive decision

**GO WITH SOURCE FIELDS ONLY — one or more FnB mappings remain unresolved**

Claude can begin *transcribing source evidence* for the validation sample described below. The spreadsheet schema should not be locked for automated import or expected-cost parity yet. The current recursive recipe path has the domain constructs needed for recipe output yield, per-component usable-yield override, item-specific recipe units, nested recipes, and unresolved evidence. However, the repository contains two materially different conversion/costing paths, and a few source-to-FnB resolution policies must be decided in the adapter rather than invented in the spreadsheet.

This is not approval to import historical data or to treat an Orderly `$0` recipe as a successful FnB cost.

## Evidence boundary and value types

The following labels are used throughout this report:

| Label | Meaning |
|---|---|
| **Persisted source/domain data** | User/domain facts stored on the entity and suitable for a migration input after matching. |
| **Persisted cached/derived data** | Stored calculation result or historical snapshot; never the authoritative source input for this experiment. |
| **Calculated dynamically at runtime** | Derived by a service from stored domain data; must not be precomputed in the harvest spreadsheet. |
| **UI-only presentation** | Formatting, display labels, or client rendering; not a migration contract. |

## 1. Existing FnB architecture

### Recursive recipe model

| Entity / table | Identity and scope | Relationships and operational fields | Value classification |
|---|---|---|---|
| `recipes` | PK `id`; company-scoped through `companyId`. | Required `name`, `yieldQty`, `yieldUnitId`; `canBeIngredient`, `isPlaceholder`, `parentRecipeId`, `sizeName`, `isActive`, instructions and image metadata. `yieldUnitId` identifies the recipe output unit. | Name, output yield, status, placeholder state and content are **persisted source/domain data**. `computedCost` is a **persisted cached/derived batch/recipe cost**. There is no core persisted recipe cost-per-serving field. |
| `store_recipes` | Store availability junction scoped by company, store, and recipe. | Associates a recipe with a store and has store-level active state. | Availability/status is **persisted source/domain data**. It does not create a second recipe cost or yield. |
| `recipe_components` | PK `id`; owned through `recipeId` (and thereby the recipe's company). | Polymorphic `componentType`: `inventory_item` or `recipe`; `componentId`; entered `qty`, `unitId`, optional `yieldOverride`, `sortOrder`, optional `missingItemName`, timestamps. Most references are enforced by the application rather than SQL foreign-key constraints. | Entered quantity/unit, component choice, line override, sort position, and unresolved source name are **persisted source/domain data**. Normalized quantity, conversion result, line cost, and yield-adjusted cost are **calculated dynamically**; they are not line columns. |
| `recipe_cost_snapshots` | Company/recipe/date historical snapshot, optionally related to a `menuItemId`. | Persists `computedCost`, `yieldQty`, `yieldUnitId`, and `costPerServing`. | **Persisted cached/derived historical evidence**, not the input to current recipe costing. |

**Recipe → sub-recipe.** A component with `componentType = "recipe"` and `componentId` equal to another `recipes.id` is the current nested-recipe path. The child must be usable as an ingredient (`canBeIngredient` is the applicable recipe capability flag). The parent preserves its entered component quantity and unit; child cost is converted to a cost per normalized child yield unit at runtime.

### Menu model

| Entity / table | Identity and scope | Relationships and operational fields | Value classification |
|---|---|---|---|
| `menu_items` | PK `id`; company-scoped through `companyId`. | Nullable direct `recipeId`; `servingSizeQty`, nullable `servingUnitId`, `isRecipeItem`, `isActive`, selling `price`, name, PLU/SKU, description, size/parent fields. | Selling price, serving data, direct link, active state, and descriptions are **persisted source/domain data**. A selling price is not a recipe ingredient cost. |
| `menu_item_recipes` | Company-scoped menu-item/recipe junction. | `menuItemId`, `recipeId`, required `prepStyleLabel`, and `sortOrder`. Supports a menu item associated with multiple recipes/preparations. | Link, label, and order are **persisted source/domain data**. |
| `store_menu_items` | Store-availability junction for menu items. | Controls per-store availability and active state. | **Persisted source/domain data**. |

**Menu Item → Recipe.** There are two real paths, both of which the migration must retain rather than collapse:

1. `menu_items.recipeId` is a nullable direct recipe link; the menu-description seeder uses this path.
2. `menu_item_recipes(menuItemId, recipeId)` is the junction path for one menu item associated with one or more recipes, with `prepStyleLabel` and `sortOrder`.

Neither relationship means that a menu item and a recipe are the same entity. Menu items carry sale/serving/price information; recipes carry components and output yield.

### Older prep-production model (separate from recursive recipes)

| Entity / table | Identity and scope | Relationships and operational fields | Value classification |
|---|---|---|---|
| `prep_items` | PK `id`; company-scoped through `companyId`. | `outputUnit`, `outputQtyPerBatch`, `yieldPercent`, shelf life, lead time, station, `isActive`, and nullable `recipeId`. | Output and production-planning inputs are **persisted source/domain data**. Effective output is **calculated dynamically** by the prep chart. |
| `prep_item_ingredients` | Company-scoped prep line. | `prepItemId`, polymorphic `sourceType` (`inventory_item` or `prep_item`), `sourceId`, quantity, optional `unitId`, order. | Stored line facts are **persisted source/domain data**. |
| `menu_item_prep_usages` | Company-scoped usage link. | `menuItemId`, `prepItemId`, `quantityPerSale`, optional unit. | Stored sales-to-prep demand facts are **persisted source/domain data**. |

`prepChartEngine` uses menu-sales demand, `menu_item_prep_usages.quantityPerSale`, on-hand, buffers, `outputQtyPerBatch`, and the prep item's `yieldPercent` to recommend production batches. It is production planning. It should not be treated as the recursive recipe-costing model or as proof that an Orderly sub-recipe should become a `prep_item`.

## 2. Yield model — four scopes kept separate

| Yield concept | FnB field / location | Scope | How it behaves today | Value classification |
|---|---|---|---|---|
| Recipe output yield | `recipes.yieldQty`, `recipes.yieldUnitId` | One recipe batch/output | Required on a recipe. Child batch cost is divided by normalized output yield to determine a child cost per yield unit when a parent consumes it. | **Persisted source/domain data**; cost per yield unit is **runtime-calculated**. |
| Inventory usable yield | `inventory_items.yieldPercent` | One inventory item globally within its company | Default usable-yield factor used when an inventory component has no line override. Cost is divided by its fraction, increasing usable-unit cost when yield is below 100%. It is not store-specific (`store_inventory_items` does not carry a yield). | **Persisted source/domain data**; adjustment is **runtime-calculated**. |
| Recipe-component yield adjustment | `recipe_components.yieldOverride` | One particular recipe/component use | Optional. When present it takes precedence over the inventory item's global `yieldPercent` in current recursive costing. | **Persisted source/domain data**; adjustment is **runtime-calculated**. |
| Legacy prep yield | `prep_items.yieldPercent` | One prep-production item/batch | Reduces effective prep output in `prepChartEngine`: `outputQtyPerBatch × yieldPercent / 100`. It supports production recommendations, not the recursive recipe cost engine. | **Persisted source/domain data**; effective output is **runtime-calculated**. |

### Answer: can the same inventory item have different yield in different recipes?

**Supported through an existing component-level override.** For example, the same inventory item can use its global `inventory_items.yieldPercent` in Recipe A but an explicit `recipe_components.yieldOverride` in Recipe B. This is the direct FnB home for Orderly ingredient-line `Yield %` *when the source percentage means usable/trim yield for that component*. It is still a migration mapping decision to verify the meaning of every Orderly percentage; it must never be conflated with Orderly recipe-level output yield.

### Concrete recipe cost path

For an inventory component in the current recursive `calculateRecipeCost` path:

1. Read the stored entered `recipe_components.qty` and `unitId`.
2. Resolve it against the inventory item's canonical unit using `convertToInventoryUnits`.
3. Select the company's effective per-canonical-unit cost with `getEffectiveUnitCost`: last cost by default, or positive weighted average when that method is chosen, otherwise last cost.
4. Apply the component `yieldOverride` when supplied; otherwise apply `inventory_items.yieldPercent`. A 90% yield means the usable cost is divided by `0.90`.
5. Multiply normalized quantity by the yield-adjusted unit cost to obtain the runtime line contribution.
6. Sum component contributions into the runtime recipe total. Callers may persist this as `recipes.computedCost`.

For a nested child recipe, the runtime path uses the child batch cost divided by `child.yieldQty × childYieldUnit.toBaseRatio`, then multiplies by the parent component quantity in normalized child-yield units. Thus, if a child batch costs `$20`, yields `10` each, and the parent consumes `1` each, it contributes `$2` before any other parent lines. The `$2` is dynamic; the core recipe row stores only the cached batch total when persisted.

No core rounding step was found in this path. UI surfaces commonly format monetary results to two decimals, which is **UI-only presentation** rather than an input contract.

## 3. UOM and conversion architecture

### Stored conversion domain model

| Entity / table | Scope and fields | Purpose / classification |
|---|---|---|
| `units` | Global PK `id`; `name`, abbreviation, `kind` (`weight`, `volume`, `count`), `toBaseRatio`, system. | Global unit definitions and same-kind normalization metadata; **persisted source/domain data**. |
| `unit_conversions` | Global directed `fromUnitId`, `toUnitId`, `conversionFactor`. | Explicit global conversions; **persisted source/domain data**. |
| `inventory_items` | Company-scoped canonical costing `unitId`; `caseSize`, `containerSize`, `containerLabel`, `containerUnitId`, `casePkgCount`; `isVariableWeight`, current-cost fields. | The item’s canonical cost unit and purchase/pack geometry; **persisted source/domain data**. |
| `inventory_item_units` | Company/item/unit scoped `unitsPerCanonical`, `isIssueUnit`, ordering. | Item-specific units. Non-issue rows are recipe units; current recursive costing converts recipe quantity as `recipe_qty / unitsPerCanonical`. **Persisted source/domain data**. |

The recipe-unit seeding utility can create identity, case, and container rows from recognized inventory item geometry while preserving existing item-unit rows. This makes pack/case geometry a source of item-specific recipe-unit evidence, not a separate recipe conversion construct.

### Current recursive recipe-unit path

`convertToInventoryUnits(qty, fromUnit, item, units, perItemUnits)` in `artifacts/api-server/src/lib/recipeUnits.ts` is the conversion implementation used by the current recursive `calculateRecipeCost` path. Its precedence is:

1. Same unit: return quantity unchanged.
2. A non-issue `inventory_item_units` row for that item/unit: return `qty / unitsPerCanonical`.
3. Same `units.kind`: use `toBaseRatio` to normalize from source to canonical unit.
4. Weight ↔ volume: numeric water-density fallback.
5. Otherwise: return `null`.

It does **not** consult the global `unit_conversions` table.

### Legacy component-cost path (material divergence)

The older `calculateComponentCost` in `artifacts/api-server/src/routes.ts` has a different precedence:

1. Same unit.
2. Direct `unit_conversions` mapping.
3. Reverse global conversion (inverting the factor).
4. Same-kind `toBaseRatio`.
5. Otherwise log an incompatible-unit warning and return zero.

It does **not** use `inventory_item_units` or the weight↔volume water fallback. This divergence is a real readiness constraint. This report does not declare either path “canonical” beyond observed call paths: recipe APIs and recalculation use the recursive `calculateRecipeCost`; legacy callers using `calculateComponentCost` can produce a different outcome for the same input.

### Exact observed failure semantics

| Scenario | Recursive recipe path (`calculateRecipeCost` + `convertToInventoryUnits`) | Legacy `calculateComponentCost` path |
|---|---|---|
| Component UOM equals canonical costing UOM | Resolves successfully; same quantity. | Resolves successfully; same quantity. |
| Direct/reverse global conversion exists | Does not consult `unit_conversions`; may still resolve only through item-specific, same-kind, or water fallback. | Resolves through direct conversion or reversed factor. |
| Item-specific recipe unit exists | Resolves before same-kind handling using `qty / unitsPerCanonical`; issue-unit rows are excluded. | Not consulted. |
| Case/pack/container geometry is needed | Resolves only when represented as recognized non-issue item-specific recipe-unit evidence (including seeded identity/case/container rows). Otherwise no special case-geometry fallback. | No item-unit/pack geometry path. |
| lb → oz | Resolves via same-kind base ratios. | Resolves via global direct/reverse conversion if defined, otherwise same-kind base ratios. |
| gallon → fl oz | Resolves via same-kind base ratios. | Resolves via global direct/reverse conversion if defined, otherwise same-kind base ratios. |
| bunch → each / bottle → oz | Requires item-specific recipe-unit evidence or a compatible supported path; otherwise `null`. | Requires an explicit global mapping if present or compatible same-kind ratios; otherwise warning + zero. |
| Weight ↔ volume | Uses water-density numeric fallback rather than a persisted item-specific density conversion. | No water fallback; incompatible dimensions warn and return zero unless an explicit global mapping is used first. |
| No compatible conversion | `null`; recursive caller skips the line, contributing zero. No thrown conversion exception was found in this path. | Logs incompatible-unit warning and returns zero. |
| Inventory item missing | Skipped as zero contribution. | Component cost cannot be positively resolved; the observed fallback behavior is zero. |
| No usable cost | `getEffectiveUnitCost` returns zero (weighted-average mode falls back to positive/available last cost first); line contributes zero. | A zero/missing resolved unit cost produces zero contribution. |
| Child recipe has unresolved lines | Recursive child cost can be lower/zero because unresolved child contributions are skipped; no structured unresolved result is propagated by the core calculator. | Not the recursive child-recipe path. |

**Dimensional compatibility.** Same-kind conversions are dimensionally compatible by `kind`. The recursive implementation additionally permits a water-density numeric weight/volume fallback, so it does *not* strictly reject every incompatible weight↔volume request unless an item-specific conversion exists. This is a limitation/behavior to validate, especially for non-water foods. Item-specific recipe units are the existing supported home for item-specific conversion factors; the model is richer than a bare global unit table but does not currently encode an item-specific density semantic in the examined path.

## 4. Recipe ingredient contract

One `recipe_components` line stores:

| Field / fact | Current behavior |
|---|---|
| Inventory item or sub-recipe identity | `componentType` plus `componentId`; polymorphic, application-enforced. |
| Quantity / UOM | Entered `qty` and `unitId`, both **persisted source/domain data**. |
| Per-line yield | Optional `yieldOverride`, **persisted source/domain data**. |
| Missing/incomplete source evidence | Optional `missingItemName`, **persisted source/domain data**, used for a component not yet matched to inventory. |
| Ordering | `sortOrder`, **persisted source/domain data**. |
| Normalized quantity / conversion reference | Not stored on the line; resolved **dynamically** from global units and item-specific units. |
| Calculated line cost / historical source cost | Not stored on the component. Runtime line contribution is derived; snapshots preserve recipe-level historical outcomes, not component-level source costs. |

**Does FnB preserve chef-entered quantity/UOM?** Yes. It preserves entered `qty` and `unitId` and normalizes during calculation. The migration spreadsheet should keep source quantity/UOM as observed and let FnB calculate normalized quantity and cost.

## 5. Sub-recipes, recursion, and cycle safety

The current sub-recipe path is `recipes` → `recipe_components(componentType = "recipe", componentId = child recipes.id)`. Parent quantity/unit remain source facts on the component. At runtime, the child recipe is costed recursively and represented to the parent as a cost per normalized child yield unit, derived from child `computedCost`/calculated batch cost and child output yield.

The recalculation workflow creates a child-first dependency graph and performs iterative DFS with an `onStack` set. It detects recipe cycles before committing costs and returns HTTP `409` with the cycle recipe IDs. The ordinary recursive calculator memoizes repeated results; the explicit 409 guarantee is evidenced in the graph-recalculation path, so callers should not assume memoization itself is cycle diagnostics.

This supports a validation chain of:

`Menu Item` → `Recipe` → `Batch/Sub-recipe Recipe` → `Inventory Ingredient`

without flattening it. Do not map every Orderly prep/batch recipe into the separate legacy `prep_items` model merely because it sounds like a prep item.

## 6. Incomplete, warning, and $0 records

| Source/target condition | Existing FnB evidence/state | Correct migration-review treatment |
|---|---|---|
| Incomplete recipe inferred from a menu description | `recipes.isPlaceholder = 1`; menu seeder uses yield `1 each`, cached `computedCost = 0`, and preserves source notes in instructions. | Create/preserve as **placeholder/unresolved evidence**, never as a successfully costed recipe. |
| Missing ingredient match | `recipe_components.missingItemName`; seeder can attach a non-resolving placeholder component ID. | Retain exact source name and mark match unresolved. Do not fabricate inventory identity. |
| Missing recipe child | Recursive calculator skips missing child contribution. | Record unresolved dependency; zero outcome is not validation success. |
| Missing/incompatible UOM conversion | Recursive path contributes zero for `null`; legacy path warns and returns zero. | Record conversion unresolved and the calculation path used. |
| Missing/zero item cost | Effective unit cost can be zero after defined WAC/last-cost behavior. | Record price unresolved/zero; do not silently certify a free ingredient. |
| `$0` recipe | Can arise from placeholder construction, skipped lines, missing prices, missing components, actual zero prices, or no components. | Treat as **ambiguous/unresolved until reason-coded**. `$0` alone is not a valid “free recipe” status. |

The separate placeholder-creation route can assign a small nonzero cached cost, while `menuRecipeSeeder` uses zero. That reinforces that cached amount alone is not an adequate completeness status.

## 7. Recommended Orderly → FnB terminology mapping

| Orderly concept | FnB concept | Notes |
|---|---|---|
| Menu Item | `menu_items` | Sale/serving/price entity. Link to recipe must identify direct versus junction path. Do not call it a recipe by default. |
| Recipe | `recipes` | Recursive ingredient/cost/output-yield entity. |
| Sub-recipe / Batch Recipe | Child `recipes` component where `componentType = "recipe"` | Use the recursive model when the source is consumed as an ingredient. `prep_items` remains a distinct production-planning model. |
| Ingredient | `recipe_components` targeting `inventory_items` | Preserve raw ingredient wording until it is matched. |
| Recipe Yield | `recipes.yieldQty` + `yieldUnitId` | Recipe output quantity/unit, not trim percentage. |
| Ingredient Yield % | `recipe_components.yieldOverride`, falling back to `inventory_items.yieldPercent` | Existing component override supports per-use yield. Verify source semantics before mapping. |
| Conversion | `inventory_item_units` for item-specific recipe units; `units` / `unit_conversions` for global evidence | Item-specific Orderly conversion is closest to an item-unit row; handling must account for the current recursive/legacy path divergence. |

## 8. Minimal spreadsheet contract for the harvest

The workbook should retain raw source evidence and support matching, but should not calculate FnB's conversion, yield adjustment, or cost.

### A. Raw Orderly source

One recipe header row and one component row per ingredient/sub-recipe are sufficient if joined by the raw source IDs/names below.

| Proposed column name | Purpose |
|---|---|
| `orderly_source_property` | Source property/account context as observed. |
| `orderly_menu_item_id` | Raw Menu Item identifier, when present. |
| `orderly_menu_item_name` | Exact displayed Menu Item name. |
| `orderly_recipe_id` | Raw recipe/prep/batch identifier, when present. |
| `orderly_recipe_name` | Exact recipe name. |
| `orderly_recipe_type_label` | Exact source label such as recipe, prep, or batch recipe. |
| `orderly_recipe_yield_qty` | Exact recipe-level output quantity. |
| `orderly_recipe_yield_uom` | Exact recipe-level output UOM/text. |
| `orderly_recipe_displayed_cost` | Reconciliation evidence only; never an import cost input. |
| `orderly_recipe_warning_text` | Exact warning/incomplete/$0 context observed. |
| `orderly_component_row_number` | Source ordering/evidence locator. |
| `orderly_component_id` | Raw line identifier, when present. |
| `orderly_component_name` | Exact ingredient or sub-recipe name. |
| `orderly_component_type_label` | Exact ingredient/sub-recipe label. |
| `orderly_component_qty` | Entered source quantity. |
| `orderly_component_uom` | Entered source UOM. |
| `orderly_component_yield_percent` | Exact line-level yield percentage, when shown. |
| `orderly_component_source_recipe_id` | Raw child recipe identifier when a line consumes a sub-recipe. |
| `orderly_conversion_source_label` | Exact displayed conversion name/label, if a conversion is shown. |
| `orderly_conversion_from_uom` | Exact source conversion origin UOM. |
| `orderly_conversion_to_uom` | Exact source conversion destination UOM. |
| `orderly_conversion_factor` | Exact source factor, if displayed. |
| `orderly_capture_url_or_reference` | Non-derived source evidence locator. |
| `orderly_capture_notes` | Transcription caveat; do not replace original fields. |

### B. FnB matching aids

These resolve existing targets and record human/adapter decisions. They are not Orderly authoritative calculations.

| Proposed column name | Purpose |
|---|---|
| `fnb_company_id` | Required authorized FnB company scope. |
| `fnb_store_id` | Target/store availability context, if applicable. |
| `fnb_menu_item_id_candidate` | Candidate existing `menu_items.id`. |
| `fnb_recipe_id_candidate` | Candidate existing `recipes.id`. |
| `fnb_parent_recipe_id_candidate` | Candidate parent recipe for a child source recipe. |
| `fnb_inventory_item_id_candidate` | Candidate `inventory_items.id` for an ingredient. |
| `fnb_component_target_type` | Proposed `inventory_item` or `recipe`; blank when unresolved. |
| `fnb_unit_id_candidate` | Candidate entered FnB unit. |
| `fnb_canonical_unit_id_observed` | Matched inventory item's canonical cost unit, used for review only. |
| `fnb_inventory_item_unit_id_candidate` | Candidate non-issue `inventory_item_units` mapping for an item-specific recipe unit. |
| `fnb_match_status` | Matched, ambiguous, missing, placeholder, or needs-review. |
| `fnb_match_rationale` | Evidence for the match; no derived cost. |
| `fnb_calculation_path_to_validate` | `recursive_recipe` or legacy path where comparison requires it. |

### C. FnB-calculated / validation output

These must be blank in raw capture and populated only after FnB resolves/calculates, or recorded as an unresolved validation result.

| Proposed column name | Purpose |
|---|---|
| `fnb_conversion_resolution` | Same unit, item-specific, same-kind, water fallback, global direct/reverse legacy, or unresolved. |
| `fnb_normalized_component_qty` | Runtime conversion result; not source input. |
| `fnb_effective_yield_percent` | Component override or item default actually used. |
| `fnb_effective_unit_cost` | Last-cost/WAC selection actually used. |
| `fnb_component_cost` | Runtime calculated contribution. |
| `fnb_recipe_total_cost` | Runtime/current computed recipe batch total. |
| `fnb_recipe_cost_per_yield_unit` | Derived batch-total/output-yield result. |
| `fnb_cost_snapshot_id` | Historical snapshot reference only if intentionally recorded after calculation. |
| `fnb_validation_status` | Validated, unresolved mapping, unresolved conversion, missing price, cycle, or other reason-coded outcome. |
| `fnb_validation_reason` | Exact reason; mandatory when output is zero/unresolved. |
| `orderly_to_fnb_cost_difference` | Reconciliation comparison only, after both results exist. |

## 9. Existing components to reuse

- `recipes`, `recipe_components`, and recursive `calculateRecipeCost` for recipe structure and live costing.
- `recipes.yieldQty` / `yieldUnitId` for recipe output yield.
- `recipe_components.yieldOverride` for per-component usable-yield behavior.
- `inventory_items.yieldPercent` for the global item default.
- `units`, `inventory_item_units`, and item pack/container geometry for current recipe-unit conversion evidence.
- `menu_items.recipeId` and `menu_item_recipes` for the distinct menu-to-recipe relationships.
- `recipes.isPlaceholder` and `recipe_components.missingItemName` for preserving incomplete source evidence.
- `recipe_cost_snapshots` for post-calculation historical validation evidence, not input values.

## 10. Genuine gaps and decisions

| Finding | Classification | Why it matters before automated migration |
|---|---|---|
| Recipe output yield, item-global usable yield, and per-component override exist. | **Existing capability — reuse** | Orderly recipe output and line yield can be represented without a new yield field, subject to source-semantic verification. |
| Menu Item, Recipe, and child Recipe are different entities and both direct/junction menu links exist. | **Mapping/adapter issue only** | Harvest must record exact source type and link path rather than flatten labels. |
| Item-specific Orderly conversions map conceptually to non-issue `inventory_item_units`; case/container seeding supplies geometry evidence. | **Existing capability — reuse** | Each source conversion still needs entity/unit matching and a factor review. |
| Current recursive and legacy conversion paths use different precedence and different fallbacks. | **Significant product/architecture decision** | Automated comparison/import must declare which path is authoritative or harmonize them. A spreadsheet must not hide the divergence by precomputing conversions. |
| Weight↔volume has a water numeric fallback in the recursive path but no observed persisted item-density semantic. | **Significant product/architecture decision** | Non-water ingredient conversions risk technically successful but materially incorrect costing. The sample should expose—not normalize away—these cases. |
| Recipe calculation often turns unresolved components/conversions/prices into zero rather than a typed unresolved result. | **Small schema gap** | Existing placeholder/missing-name fields preserve some evidence, but a migration validation adapter needs reason-coded review results so `$0` is never read as success. |
| A source “conversion” may be represented in global `unit_conversions`, an item recipe-unit row, pack geometry, or only a source observation. | **Mapping/adapter issue only** | Need a documented matching policy per source conversion; do not add a parallel conversion table. |

## 11. Required validation sample (10–20 source recipes)

Begin harvesting only a balanced sample covering each category below; one recipe may satisfy several categories:

1. Simple flat recipe.
2. Recipe with an explicit recipe-level yield.
3. Recipe with non-100% ingredient-line yield.
4. Recipe using a global conversion.
5. Recipe using an item-specific conversion.
6. Recipe requiring case/pack conversion.
7. Recipe using a weight conversion.
8. Recipe using a volume conversion.
9. Recipe containing a sub-recipe.
10. Full Menu Item → Recipe → Sub-recipe chain.
11. Incomplete or `$0` source recipe.
12. Missing-conversion or missing-price case, if available.

For every selected record, retain the raw source fields, capture source warnings, mark the proposed FnB path, and require a reason-coded validation outcome rather than accepting a numeric zero.

## Final recommendation

**GO WITH SOURCE FIELDS ONLY — one or more FnB mappings remain unresolved.** Start the 10–20 recipe harvest as a source-evidence and matching exercise using the column contract above. Do not load data, lock an automated import schema, or precompute converted quantities, yield-adjusted costs, or recipe costs in Excel. Resolve the conversion-path authority, non-water weight/volume policy, and explicit unresolved-result handling before treating any calculated FnB-vs-Orderly comparison as migration-ready parity.

## Verification

- Read-only repository evidence reviewed from `lib/db/src/schema/schema.ts`, `artifacts/api-server/src/routes.ts`, `artifacts/api-server/src/lib/recipeUnits.ts`, `artifacts/api-server/src/lib/costing.ts`, `artifacts/api-server/src/services/menuRecipeSeeder.ts`, `artifacts/api-server/src/services/recipeScanner.ts`, and `artifacts/api-server/src/services/prepChartEngine.ts`.
- No schema, API, UI, costing, conversion, yield, import, or migration-data files were altered.