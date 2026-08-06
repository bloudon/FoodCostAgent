# Unit Model Reference

This document defines every unit-related concept in FnB Cost Pro and specifies
the exact meaning of each database field. All new code and migrations must
conform to these definitions.

---

## Core principle

> **The inventory item defines what the product is measured in.
> Each vendor item defines how that vendor sells it.**

An inventory item's canonical unit is stable. It does not change when the
primary vendor changes or when a different pack size is received.

---

## Concepts

### Canonical inventory unit (`inventory_items.unit_id`)

The stable, vendor-independent unit used to measure this ingredient in the
kitchen and in all cost calculations.

| Item                | Canonical unit |
|---------------------|----------------|
| Boneless chicken    | LB             |
| Eggs                | EA             |
| Olive oil           | FL OZ          |
| Espresso beans      | LB or KG       |
| Kosher salt (bulk)  | LB             |

**Rules:**
- Never change because the primary vendor changes.
- `price_per_unit` and `avg_cost_per_unit` are expressed per one of this unit.
- Recipe components reference this item in any *whitelisted* kitchen unit; the
  costing engine converts back to this unit before multiplying by unit cost.

### Purchase unit (`vendor_items.purchase_unit_id`)

How a specific vendor packages this item for ordering. Two vendors may use
different purchase units for the same inventory item:

| Vendor   | Purchase unit | Pack            | Canonical qty |
|----------|---------------|-----------------|---------------|
| Sysco    | CS            | 4 × 5 LB bags   | 20 LB         |
| US Foods | CS            | 2 × 12 LB bags  | 24 LB         |
| Local    | LB            | by the pound    | 1 LB          |

The purchase unit is a *vendor item* attribute, not an inventory item attribute.

### Purchase pack geometry (`vendor_items.canonical_qty_per_purchase_unit`)

The total number of canonical inventory units in one ordered purchase unit.
Used to compute the normalized price for vendor comparison:

```
normalized_price = purchase_price / canonical_qty_per_purchase_unit
```

Example: $62.00 case ÷ 20 LB = $3.10/LB normalized.

### Recipe/usage conversion (`inventory_item_units.units_per_canonical`)

An item-specific whitelist of kitchen units the item may be called by in
recipes, counts, and issue workflows. Each row stores:

```
units_per_canonical = how many of this unit equal 1 canonical unit
```

| Canonical unit | Kitchen unit | unitsPerCanonical | Meaning              |
|----------------|--------------|-------------------|----------------------|
| LB             | LB           | 1                 | identity             |
| LB             | OZ           | 16                | 16 oz per lb         |
| LB             | EA (apple)   | 4                 | 4 apples per lb      |
| LB             | CS (20-lb)   | 0.05              | 1/20 case per lb     |
| FL OZ          | FL OZ        | 1                 | identity             |
| FL OZ          | CUP          | 0.125             | 1/8 cup per fl oz    |
| FL OZ          | ML           | 29.574            | 29.574 ml per fl oz  |

**Costing formula:**

```
qty_in_canonical = recipe_qty / unitsPerCanonical
component_cost   = qty_in_canonical × price_per_unit
```

Example: recipe calls for 2 EA apples (unitsPerCanonical = 4, price = $1.20/LB):
```
qty_in_canonical = 2 / 4 = 0.5 LB
component_cost   = 0.5 × $1.20 = $0.60
```

### Issue / count unit

An `inventory_item_units` row with `is_issue_unit = 1`. Behaves like a recipe
unit but appears only in transfer and count workflows, not in the recipe builder.
Not used in recipe costing (`convertToInventoryUnits` skips issue rows).

---

## Database fields

### `units`

| Field          | Type    | Meaning                                                  |
|----------------|---------|----------------------------------------------------------|
| `abbreviation` | text    | Display abbreviation: `lb`, `oz`, `fl oz`, `ea`, etc.   |
| `kind`         | text    | Dimension family: `weight`, `volume`, or `count`         |
| `to_base_ratio`| real    | Converts to the family's micro-base unit (g or mL). Used for same-kind cross-unit math when no per-item override exists. |
| `system`       | text    | `imperial`, `metric`, or `both`                          |

### `unit_conversions`

| Field               | Type | Meaning                                         |
|---------------------|------|-------------------------------------------------|
| `conversion_factor` | real | How many `to_unit` are in 1 `from_unit`. Example: lb→oz = 16. |

### `inventory_items`

| Field              | Type | Meaning                                                         |
|--------------------|------|-----------------------------------------------------------------|
| `unit_id`          | FK   | **Canonical inventory unit.** Stable across vendors.            |
| `case_size`        | real | Convenience cache: total canonical units in the primary vendor's purchase unit. E.g. 20 when unit is LB and the primary case contains 20 LB. Authoritative pack geometry lives on `vendor_items`. |
| `container_size`   | real | Size of each inner container in the item's canonical unit.      |
| `container_label`  | text | Human label for the inner container: `can`, `bottle`, `bag`.    |
| `container_unit_id`| FK   | Unit used to enter/display `container_size` (may differ from canonical unit). |
| `case_pkg_count`   | real | Number of inner containers per purchase unit.                   |
| `price_per_unit`   | real | **Cost per 1 canonical unit** (last-cost method). Updated on vendor sync and receiving. |
| `avg_cost_per_unit`| real | **Weighted-average cost per 1 canonical unit.** Updated incrementally as purchases are received. |
| `yield_percent`    | real | Usable yield after trim/waste (0–100). Effective cost = price_per_unit / (yield_percent / 100). |

### `inventory_item_units`

| Field                | Type    | Meaning                                                      |
|----------------------|---------|--------------------------------------------------------------|
| `unit_id`            | FK      | The kitchen/recipe unit this row enables.                    |
| `units_per_canonical`| real    | **How many of this unit equal 1 canonical unit.** Always > 0. Costing: `qty_in_canonical = recipe_qty / units_per_canonical`. DB column: `qty_per_inventory_unit` (name preserved for compatibility). |
| `is_issue_unit`      | integer | `0` = recipe unit (used in costing); `1` = issue/count unit (skipped by recipe costing). |
| `sort_order`         | integer | Display order in the UI.                                     |

### `vendor_items`

| Field              | Type | Meaning                                                               |
|--------------------|------|-----------------------------------------------------------------------|
| `purchase_unit_id` | FK   | How this vendor packages the item (e.g. CS, EA, LB). Vendor-specific. |
| `case_size`        | real | Raw pack quantity from vendor catalog. Interpretation depends on `pack_uom`. May differ from `inventory_items.case_size`. |
| `last_price`       | real | Most recent purchase price per purchase unit from this vendor.        |
| `last_case_price`  | real | Most recent case price (may equal `last_price` when purchase unit is CS). |

---

## Item archetypes

### 1. Simple weight item (e.g. boneless chicken breast)

```
inventory_items.unit_id        → LB
inventory_items.price_per_unit → $3.10  (per LB)

vendor_items (Sysco)
  purchase_unit_id             → CS
  case_size                    → 20      (20 LB per case)
  last_price                   → $62.00  (per case)

inventory_item_units
  LB  | unitsPerCanonical = 1    | recipe
  OZ  | unitsPerCanonical = 16   | recipe
  CS  | unitsPerCanonical = 0.05 | recipe  (1/20)
```

Recipe calling for 8 OZ chicken:
```
qty_in_canonical = 8 / 16 = 0.5 LB
cost = 0.5 × $3.10 = $1.55
```

### 2. Volume item (e.g. olive oil)

```
inventory_items.unit_id        → FL OZ
inventory_items.price_per_unit → $0.34  (per FL OZ)

inventory_item_units
  FL OZ | unitsPerCanonical = 1      | recipe
  CUP   | unitsPerCanonical = 8      | recipe  (8 fl oz per cup)
  ML    | unitsPerCanonical = 0.0338 | recipe  (1 fl oz = 29.574 ml → 1 ml = 0.0338 fl oz... wait)
```

Wait — unitsPerCanonical = "how many of THIS unit per 1 FL OZ":
- ML row: 1 FL OZ = 29.574 ML → unitsPerCanonical = 29.574
- CUP row: 1 CUP = 8 FL OZ → unitsPerCanonical = 0.125 (1/8 cup per fl oz)

Recipe calling for 2 TBSP (≈ 1 FL OZ):
```
Use global toBaseRatio fallback or per-item FL OZ row.
```

### 3. Count / each item (e.g. eggs)

```
inventory_items.unit_id        → EA
inventory_items.price_per_unit → $0.30  (per egg)

vendor_items (distributor)
  purchase_unit_id             → CS
  case_size                    → 30      (30 eggs per case)
  last_price                   → $9.00   (per case)

inventory_item_units
  EA | unitsPerCanonical = 1  | recipe
  CS | unitsPerCanonical = 1/30 ≈ 0.0333 | recipe
```

### 4. Inner-pack item (e.g. anchovies in oil)

```
inventory_items.unit_id        → OZ
inventory_items.case_size      → 208    (208 oz total in one case)
inventory_items.container_size → 13     (13 oz per can)
inventory_items.container_label→ can
inventory_items.case_pkg_count → 16     (16 cans per case)
inventory_items.price_per_unit → $0.30  (per OZ)

inventory_item_units
  OZ  | unitsPerCanonical = 1    | recipe
  CAN | unitsPerCanonical = 13   | recipe  (13 oz per can)
  CS  | unitsPerCanonical = 208  | recipe  (208 oz per case)
```

### 5. Variable-weight item (e.g. whole salmon)

```
inventory_items.unit_id        → LB
inventory_items.is_variable_weight → 1
inventory_items.price_per_unit → $8.50  (per LB — priced by actual weight)

vendor_items
  is_variable_weight           → true
  pricing_basis                → CANONICAL_UNIT  (vendor charges per LB, not per fish)
```

No fixed `unitsPerCanonical` for the CS row because case weight varies.
Recipe components reference LB directly. Ordering estimates use average weight.

---

## Migration note

The DB column `qty_per_inventory_unit` was renamed to `units_per_canonical` in
the TypeScript/Drizzle layer only. The physical column name is preserved
(`qty_per_inventory_unit`) for zero-downtime compatibility. Any future DB
migration that renames the physical column must update this document.
