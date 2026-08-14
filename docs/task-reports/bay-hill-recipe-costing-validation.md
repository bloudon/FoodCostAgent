# Recipe Costing Validation — Bay Hill Sample

**Type:** Evidence-only validation / mapping report
**Fixture:** `attached_assets/Bay_Hill_Recipe_Harvest_Sample_1786736857349.xlsx`
**Objective:** `attached_assets/Pasted--Recipe-Costing-Validation-Bay-Hill-Sample-Objective-Us_1786736861542.txt`
**Date:** 2026-08-14

## 0. Scope and stop condition

No schema, costing, UOM, yield, water-density, stale-price, importer, or Base Cost behavior was changed. No Orderly data was imported. The source workbook was read only (extracted via a read-only XML pass to `/tmp`; the `.xlsx` was not modified or normalized). This report stops at evidence, as required.

**Headline finding — the comparison cannot exercise FnB costing at all.**

The FnB company `Bay Hill CC` (`61971215-e3ed-49f3-8afc-6dbe1eef1fcc`) exists but is **empty**:

| FnB entity for Bay Hill CC | Count |
| --- | --- |
| `inventory_items` | 0 |
| `recipes` | 0 |
| `menu_items` | 0 |
| vendor items (via `vendors`) | 0 |

Consequently **0 of 37** source component lines reach FnB conversion, pricing, or yield logic. Every line fails at the first gate — inventory match. FnB produced **no** cost number for any line, so there is no FnB-vs-Orderly cost variance to judge anywhere in this sample. What broke first is **tenant data population**, not UOM and not costing.

Because no line was costed, the required `CALCULATED — WATER-DENSITY FALLBACK` marker is **not** returned for any row. Section 6 reports the fallback risk as an explicitly-labelled projection, not as a validated result.

## 1. Source fixture inventory (raw, unmodified)

Three sheets, exactly as harvested.

| Sheet | Data rows | Notes |
| --- | --- | --- |
| Recipes | 7 | 4 standalone recipes, 3 menu items |
| Recipe Ingredients | 37 component lines + 1 explicit empty-record marker | |
| Orderly Conversions | 78 | appendix |

### 1a. Orderly Conversions appendix is not replayable

Across all 78 appendix rows, `source_from_uom` and `source_conversion_factor` are **empty**. The appendix records only an ingredient name, a single converted-unit label, and a Standard/Custom label. It therefore carries **no numeric factor** for any ingredient.

Consequence: even with a perfect inventory match, Orderly's own conversion math cannot be reproduced or validated from this fixture. Any FnB-vs-Orderly line-cost agreement would be coincidental, not verified. This is a **source-data limitation**, not an FnB gap.

The appendix also contains duplicate ingredient names with *different* converted units — `Onions - Yellow → Cup` and `Onions - Yellow → Each`; `Garlic Fresh → Cup` and `Garlic Fresh → Each`; also `Peppers - Green`, `Peppers - Jalapeno`, `Shallots - Peeled`, `Tomatoes`, `Yellow Mustard Vol pak`, `Herbs - Parsley`, `Herbs - Rosemary`, `Cilantro Fresh`, `Garlic - Peeled`. Name-only matching against these is **ambiguous by construction** and is not treated as authoritative below.

## 2. Per-line mapping report (all 37 lines)

Columns are abbreviated for width. Constant across every row:

- **FnB target identity:** `NONE` (no Bay Hill CC recipes/menu items exist)
- **FnB inventory match:** `NONE`
- **Source line yield %:** `100` on every line (37/37)
- **FnB effective yield:** `NOT EVALUATED` — item `yieldPercent` unreadable with no matched item; no component `yieldOverride` exists in source
- **FnB conversion path used:** `NONE — not reached`
- **FnB costing unit:** `NONE — no canonical unit`
- **FnB unit cost source:** `NONE — no item, no price record`
- **FnB calculated line cost:** `NOT CALCULATED` (explicitly **not** `$0`)
- **Difference:** `NOT COMPUTABLE`
- **Resolution status:** `missing inventory match`, except where noted

### Chicken Pot Pie Mix (`recipeItem/251455`, standalone)

| # | Source component | Qty | UOM | Orderly line cost | Failure reason |
| --- | --- | --- | --- | --- | --- |
| 1 | Bay Leave | 0.015 | EA | $0.00 | missing inventory match **+ source zero-cost line** (fractional EACH; source shows $0.00) |
| 2 | Carrots | 30 | OZ | $1.53 | missing inventory match |
| 3 | Celery | 30 | OZ | $1.72 | missing inventory match |
| 4 | Chicken - Breast | 12.5 | LB | $47.75 | missing inventory match |
| 5 | Chicken Base | 7 | OZ | $2.75 | missing inventory match |
| 6 | Chicken Stock | 1.5 | GL | $29.75 | missing inventory match |
| 7 | Garlic Fresh | 2 | OZ | $0.37 | missing inventory match **+ source-data ambiguity** (two appendix rows: Cup and Each) |
| 8 | Heavy Cream | 2 | C | $2.26 | missing inventory match |
| 9 | Onions - Yellow | 30 | OZ | $1.32 | missing inventory match **+ source-data ambiguity** (two appendix rows: Cup and Each) |
| 10 | Peas - Green | 40 | OZ | $4.94 | missing inventory match |
| 11 | Pepper - White - Ground | 2 | TSP | $0.60 | missing inventory match |
| 12 | Roux | 32 | OZ | $2.86 | missing inventory match (source type = ingredient, though "Roux" is plausibly a sub-recipe — **unverified**) |

### Palmer Blue Cheese Dressing - Batch (`recipeItem/185318`, standalone, reused sub-recipe)

| # | Source component | Qty | UOM | Orderly line cost | Failure reason |
| --- | --- | --- | --- | --- | --- |
| 1 | Buttermilk | 0.5 | QT | $6.92 | missing inventory match |
| 2 | Cheese - Blue Crumbled | 3 | LB | $9.31 | missing inventory match |
| 3 | Juice - Lemon | 4 | OZ | $0.42 | missing inventory match |
| 4 | Mayonnaise - Extra Heavy | 1 | GL | $24.68 | missing inventory match |
| 5 | **Sauce - Tabasco** | 0.5 | OZ | **$0.00** | missing inventory match (FnB) **+ source classification: dimensionally incompatible / missing item-specific conversion** — see 3a |
| 6 | Sauce - Worcestershire | 0.5 | GL | $5.19 | missing inventory match |

### Bay Hill Chips (`menuItem/431658`)

| # | Source component | Type | Qty | UOM | Orderly line cost | Failure reason |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Bay Hill Chips | ingredient | 10 | OZ | $1.24 | missing inventory match **+ source-data ambiguity** — component name collides with the parent Menu Item name; name-only matching explicitly rejected here |
| 2 | Oil - Shortening Liquid Fry | ingredient | 8 | OZ | $0.72 | missing inventory match |
| 3 | Palmer Blue Cheese Dressing - Batch | **sub-recipe** (`185318`) | 4 | OZ | $0.59 | **unresolved sub-recipe** — target recipe does not exist in FnB |

### Baked Camembert (`menuItem/553107`)

| # | Source component | Qty | UOM | Orderly line cost | Failure reason |
| --- | --- | --- | --- | --- | --- |
| 1 | Apples - Granny Smith | 0.3 | EA | $0.15 | missing inventory match (fractional EACH) |
| 2 | Baguettes | 0.2 | EA | $0.20 | missing inventory match (fractional EACH) |
| 3 | BONNE-MAMAN HONEY MINI | 2 | EA | $2.40 | missing inventory match |
| 4 | CHS CAMEMBERT 12/7OZ | 3.5 | OZ | $14.25 | missing inventory match **+ source-data ambiguity** — pack geometry (12 × 7 OZ) is embedded in the name string, not a structured field |
| 5 | CRACKER LAHVOSH WHITE 15" | 0.2 | EA | $0.10 | missing inventory match (fractional EACH; dimension in name) |
| 6 | Craisins | 2 | OZ | $0.47 | missing inventory match |
| 7 | LEMON OLIVE OIL | 1 | OZ | $1.64 | missing inventory match |
| 8 | Walnut | 0.5 | OZ | $0.28 | missing inventory match |

### Crab Cakes (`menuItem/554310`)

| # | Source component | Failure reason |
| --- | --- | --- |
| — | *(no ingredient lines — explicit empty-record marker row retained in source)* | **incomplete/empty source recipe** |

Classified as an empty shell, **not** a successfully costed $0 recipe. Source itself displays unedited placeholder copy.

### Bay Hill Beef Brisket (`recipeItem/650018`, standalone)

| # | Source component | Qty | UOM | Orderly line cost | Failure reason |
| --- | --- | --- | --- | --- | --- |
| 1 | Beef - Brisket | 120 | LB | $799.21 | missing inventory match |
| 2 | Beef Brisket Rub | 3 | QT | $45.72 | missing inventory match |

Source models **no** trim/moisture loss (both lines Yield 100%) despite a 24-hour cook. Recorded as source evidence only; no yield behavior inferred.

### Coconut Flan (`recipeItem/649991`, standalone)

| # | Source component | Qty | UOM | Orderly line cost | Failure reason |
| --- | --- | --- | --- | --- | --- |
| 1 | Coco lopez | 60 | OZ | $11.88 | missing inventory match |
| 2 | Eggs - Whole Liquid | 2.5 | LB | $3.22 | missing inventory match |
| 3 | Heavy Cream | 4 | QT | $18.09 | missing inventory match |
| 4 | Milk - Evaporated | 24 | OZ | $3.48 | missing inventory match |
| 5 | MILK CONDENSED SWEETENED cans | 56 | OZ | $8.65 | missing inventory match (pack form in name text) |
| 6 | **MONIN ORANGE SYRUP 750 ML** | 1 | C | **$0.00** | missing inventory match (FnB) **+ source classification: stale/unusable price** — see 3b |

> Note on `Heavy Cream`: an item named `Heavy Cream` exists in FnB, but under **The Breakfast Nook** (`bn-company-0001`, $5.60/lb), a different tenant. This is a cross-tenant name collision, **not** a Bay Hill match, and was not used. Same for `Chicken Breast`, `Onions`, and blue-cheese/garlic-like names under other companies.

## 3. Known source cases — classification confirmed

### 3a. Sauce - Tabasco → `dimensionally incompatible / missing item-specific conversion`

Source evidence: recipe line calls **0.5 OZ** (weight). Two real vendor products exist with **current** pricing — Sysco 4274684 at $57.49/144 EA (05/20/26) and Cheney Brothers 056121 at $68.74/144 EA (12/30/25) — both priced per case of 144 miniature bottles (**count**). No OZ↔Each path exists for this ingredient, and it does not appear in the Conversions appendix.

**This is not "missing price."** Price is present and current; the weight→count dimension cannot be crossed.

FnB behavior on the same shape (verified by reading both engines): with a count-canonical item and no `inventory_item_units` row, `convertToInventoryUnits` returns `null` → `MISSING_CONVERSION` (`artifacts/api-server/src/lib/recipeUnits.ts:37-82`, consumed at `recipeCostCalculator.ts:115-118`). The water-density fallback is volume↔weight **only** and never rescues count. So FnB's modern path would classify this case correctly and **not** silently zero it. The legacy path would `return 0` with only a `console.warn` (`routes.ts:25877-25881`).

### 3b. MONIN ORANGE SYRUP 750 ML → `stale/unusable price`

Source evidence: 1 Cup usage; single vendor product (Truly Good Foods 756630, "1/1 750ML Bottle") at $7.80 dated **07/28/2023** (~3 years before capture); ingredient screen independently flags **"No Recent Purchase."** 750 ML and Cup are both volume — **dimensionally compatible** — so this is not a conversion failure. Orderly's exact staleness rule is **not inferred**; only that Orderly displayed $0.00 while a price record exists.

**FnB gap surfaced:** FnB has **no** stale-price concept. `getEffectiveUnitCost` (`costing.ts:72-84`) reads `pricePerUnit`/`avgCostPerUnit` with no date input, and `UnresolvedReason` (`costing.ts:37-43`) has no stale-price code. A 2023 price would be used silently as if current. Reported as evidence; no policy implemented.

### 3c. Crab Cakes → `incomplete/empty source recipe`

Zero lines; source shows its own placeholder copy. Not a costed $0. FnB's modern path would agree structurally — a recipe with no components and `yieldQty > 0` returns `cost: 0, isResolved: true`, which is **still wrong for this case**; the empty-shell signal comes from having zero components, not from a reason code. Noted as a real classification gap, unchanged.

## 4. Base Cost reconciliation (evidence only)

`orderly_displayed_base_cost` preserved verbatim. Arithmetic verified:

| Recipe | Ingredient-line sum | Source Base Cost | Sum + Base | Source Food Cost | Delta |
| --- | --- | --- | --- | --- | --- |
| Chicken Pot Pie Mix | $95.85 | $0.00 | $95.85 | $95.85 | $0.00 |
| Palmer Blue Cheese Dressing - Batch | $46.52 | $0.00 | $46.52 | $46.52 | $0.00 |
| Bay Hill Chips | $2.55 | $0.00 | $2.55 | $2.55 | $0.00 |
| Baked Camembert | $19.49 | $0.00 | $19.49 | $19.49 | $0.00 |
| Crab Cakes | $0.00 | $0.00 | $0.00 | $0.00 | $0.00 |
| Bay Hill Beef Brisket | $844.93 | $0.00 | $844.93 | $844.93 | $0.00 |
| **Coconut Flan** | **$45.32** | **$9.00** | **$54.32** | **$54.32** | **$0.00** |

The source is internally self-consistent in all 7 cases. **Coconut Flan** is the only nonzero Base Cost: $45.32 + $9.00 = $54.32 exactly. One data point is not a proven rule; **no generalized Base Cost behavior was implemented**. FnB currently has no Base Cost concept at the recipe level.

## 5. Yield — three layers kept separate

| Layer | Source evidence | FnB counterpart | Status |
| --- | --- | --- | --- |
| Recipe output yield | 3.75 GL; 1.5 GL; 12 Each; 80 Cup (menu items have none) | `recipes.yieldQty` / `yieldUnitId` | Not populated — no FnB recipes |
| Recipe-component yield override | none present (all lines 100%) | `recipe_components.yieldOverride` | No override implied |
| Inventory-item yield | not exposed by source | `inventory_items.yieldPercent` | Unreadable — no matched items |

All 37 lines are **100%**. **No non-100% yield behavior is inferred from this sample.**

### Coconut Flan yield conflict — surfaced, unresolved

- Structured field: **80 Cup**
- Free-text Notes: **40 portions**

Both preserved; **neither chosen as authoritative**. These are not reconcilable without a portion-size definition (80 Cup ÷ 40 portions would imply 2 Cup/portion, which is an inference, not source evidence). Any migration must resolve this per-recipe, because `recipes.yieldQty`/`yieldUnitId` accepts only one answer and sub-recipe cost-per-unit divides by it (`recipeCostCalculator.ts:154-168`).

## 6. UOM battle test — which FnB mechanism resolves each row

No row was executed (no items exist). The following is a **projection** of the two divergent FnB paths against the source unit shapes, based on reading the code and the live `units` / `unit_conversions` tables. Labelled projections, not results.

**Path A — modern** (`recipeCostCalculator.ts` → `recipeUnits.ts:convertToInventoryUnits`): same-unit → per-item `inventory_item_units` (`isIssueUnit=0`) → same-kind `toBaseRatio` → **water-density volume↔weight fallback** → `null`. Ignores global `unit_conversions` entirely.

**Path B — legacy** (`routes.ts:25837-25911 calculateComponentCost`): same-unit → global `unit_conversions` direct → reverse → same-kind `toBaseRatio` → `console.warn` + **return 0**. Ignores per-item `inventory_item_units` entirely.

### Quantified disagreement between the two paths

Live `unit_conversions` contains **cross-kind** rows that only Path B honors:

| Conversion | Path B (global row) | Path A (water fallback) | Divergence |
| --- | --- | --- | --- |
| gallon → pound | **8.0** | **8.3454** | **+4.32%** |
| gallon → ounce (weight) | **128.0** | **133.5265** | **+4.32%** |
| #10 can → cup | **13.625** | `null` → `MISSING_CONVERSION` | total disagreement |
| cup → fluid ounce | 8.0 | 8.0 | none |
| quart → cup | 4.0 | 4.0 | none |

The two engines disagree on **magnitude** for weight↔volume and on **resolvability** for count↔volume. This is a live, unhidden contradiction.

### Requested rows

| Row | Projected mechanism |
| --- | --- |
| **Chicken Pot Pie Mix** | 1.5 GL Chicken Stock + 2 C Heavy Cream + 2 TSP pepper against likely weight-canonical items ⇒ Path A hits **water-density fallback**; Path B hits the **gallon→pound global row (8.0)**. Same recipe, two different numbers. 30 OZ lines are same-kind and agree. |
| **Baked Camembert** | Four fractional-EACH lines (0.3, 0.2, 0.2 EA) ⇒ count→canonical. Resolvable **only** by a per-item `inventory_item_units` row (Path A). Path B cannot: no count↔weight global row exists ⇒ `return 0` silently. `CHS CAMEMBERT 12/7OZ` needs pack geometry parsed out of the name. |
| **Bay Hill Chips → Palmer Blue Cheese Dressing - Batch** | Sub-recipe at 4 OZ against child yield **1.5 Gallon**. Both paths normalize child yield via `yieldUnit.toBaseRatio` (mL) then multiply component qty by *its* `toBaseRatio` — 4 OZ is **weight (28.3495 g)** divided into a **volume (5678 mL)** base. Units are mixed with no dimension check in either path. This is the highest-risk row in the sample: it produces a plausible-looking number from an unchecked weight/volume mix. |
| **Onions - Yellow** | 30 OZ; appendix offers **both** Cup and Each. Path A depends entirely on which per-item row exists; Path B on canonical unit. Ambiguous — not authoritative. |
| **Garlic Fresh** | 2 OZ; same dual Cup/Each ambiguity. |
| **Any weight↔volume** | GL/QT/C/TSP against weight-canonical items ⇒ Path A silently applies water density to non-water ingredients (cream, stock, mayonnaise, oil, syrup). |
| **Fractional EACH** | 0.015 EA Bay Leave, 0.3/0.2 EA — require per-item factors; unreachable in Path B. |

### Water-density flag

Per the objective, the marker is returned only when FnB actually produces a number via the fallback. **No line produced a number**, so:

`CALCULATED — WATER-DENSITY FALLBACK` — **returned for 0 lines.**

Projected exposure if items were populated with weight-canonical units: **Chicken Stock (1.5 GL), Heavy Cream (2 C and 4 QT), Mayonnaise - Extra Heavy (1 GL), Sauce - Worcestershire (0.5 GL), Buttermilk (0.5 QT), Pepper - White - Ground (2 TSP), Beef Brisket Rub (3 QT), MONIN (1 C)** — all non-water. PM review required before any of these are accepted as valid conversions.

## 7. Per-recipe validation report

| Recipe | Source Food Cost | FnB component sum | Source Base Cost | FnB total pre-Base | Variance to Orderly | Resolved lines | Unresolved lines | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chicken Pot Pie Mix | $95.85 | NOT CALCULATED | $0.00 | NOT CALCULATED | NOT COMPUTABLE | 0 | 12 | **UNRESOLVED — FNB DATA/MAPPING** |
| Palmer Blue Cheese Dressing - Batch | $46.52 | NOT CALCULATED | $0.00 | NOT CALCULATED | NOT COMPUTABLE | 0 | 6 | **UNRESOLVED — FNB DATA/MAPPING** |
| Bay Hill Chips | $2.55 | NOT CALCULATED | $0.00 | NOT CALCULATED | NOT COMPUTABLE | 0 | 3 | **UNRESOLVED — FNB DATA/MAPPING** |
| Baked Camembert | $19.49 | NOT CALCULATED | $0.00 | NOT CALCULATED | NOT COMPUTABLE | 0 | 8 | **UNRESOLVED — FNB DATA/MAPPING** |
| Crab Cakes | $0.00 | NOT CALCULATED | $0.00 | NOT CALCULATED | NOT COMPUTABLE | 0 | 0 (empty shell) | **UNRESOLVED — SOURCE DATA** |
| Bay Hill Beef Brisket | $844.93 | NOT CALCULATED | $0.00 | NOT CALCULATED | NOT COMPUTABLE | 0 | 2 | **UNRESOLVED — FNB DATA/MAPPING** |
| Coconut Flan | $54.32 | NOT CALCULATED | $9.00 | NOT CALCULATED | NOT COMPUTABLE | 0 | 6 | **UNRESOLVED — FNB DATA/MAPPING** (also carries source yield conflict + the only nonzero Base Cost) |

**Is the comparison valid enough to judge FnB costing? — NO, for all 7 recipes.**

No recipe is `PASS`, `PASS WITH EXPLAINED SOURCE DIFFERENCE`, or `FAIL — COSTING DIFFERENCE`, because FnB never produced a number to compare. Declaring any `PASS` here would be exactly the silent-$0 failure the objective prohibits.

### Failure taxonomy totals

| Classification | Lines |
| --- | --- |
| resolved | **0** |
| missing inventory match | **36** (all lines except the empty-record marker) |
| unresolved sub-recipe | 1 (Palmer ref inside Bay Hill Chips; also counted above) |
| incomplete/empty source recipe | 1 recipe (Crab Cakes) |
| source zero-cost line | 1 (Bay Leave, $0.00 at source) |
| dimensionally incompatible / missing item-specific conversion | 1 (Sauce - Tabasco, source-side) |
| stale/unusable price | 1 (MONIN, source-side) |
| source-data ambiguity | 5 (Bay Hill Chips name collision; Onions - Yellow; Garlic Fresh; CHS CAMEMBERT pack-in-name; Coconut Flan yield conflict) |
| missing price | **0** |
| missing conversion (FnB-executed) | **0 — not reached** |
| dimensionally incompatible (FnB-executed) | **0 — not reached** |

## 8. What breaks first — ordered

1. **Tenant data population.** Bay Hill CC has no inventory, no recipes, no vendor items. Nothing downstream can be tested. This blocks the entire validation.
2. **Source conversion factors are absent.** The appendix has no numeric factors, so Orderly's math is unreproducible even after items exist. Line-cost agreement could not be *verified* today, only observed.
3. **Two conversion engines disagree** — 4.32% on gallon→weight and total disagreement on count→volume. Which engine runs depends on the code path, not on the data.
4. **Sub-recipe cost-per-unit mixes weight and volume bases without a dimension check** (4 OZ into a 1.5-Gallon yield). Produces a plausible wrong number rather than an error.
5. **No stale-price concept in FnB.** A 2023 price is treated as current.
6. **Empty recipes still report `isResolved: true` at $0** when they have zero components.

## 9. Explicitly not done

Per the stop condition: UOM architecture, water-density behavior, stale-price policy, recipe importer, Base Cost behavior, and recursive costing are **unchanged**. No workbook normalization. No Orderly import. No data written to any company.
