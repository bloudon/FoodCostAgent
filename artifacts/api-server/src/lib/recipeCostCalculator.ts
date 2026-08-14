/**
 * Pure, synchronous recipe-cost calculation with explicit unresolved-reason tracking.
 *
 * All data must be pre-fetched and provided by the caller. This makes the
 * function fully testable without a database or storage layer.
 *
 * Use `assessRecipeCostResult` for unit tests and batch calculations where
 * data is already in memory. Use `calculateRecipeCostDetailed` (routes.ts)
 * for request-scoped async calculations.
 */

import type { Unit, InventoryItemUnit } from "@workspace/db";
import { convertToInventoryUnits } from "./recipeUnits";
import {
  getEffectiveUnitCost,
  type CostingMethodCarrier,
  type UnresolvedReason,
  type RecipeCostResult,
} from "./costing";

/** Minimal recipe shape required for cost assessment. */
export interface RecipeShape {
  id: string;
  yieldQty: number;
  yieldUnitId: string;
  isPlaceholder?: number | null;
}

/** Minimal inventory-item shape required for cost assessment. */
export interface ItemShape {
  id: string;
  unitId: string;
  pricePerUnit?: number | null;
  avgCostPerUnit?: number | null;
  yieldPercent: number;
}

/** Minimal component shape required for cost assessment. */
export interface ComponentShape {
  componentType: string;
  componentId: string;
  qty: number;
  unitId: string;
  yieldOverride?: number | null;
  missingItemName?: string | null;
}

/**
 * Assess the cost of a recipe from pre-fetched data.
 *
 * Returns a `RecipeCostResult` that carries:
 *   - `cost`              — total cost in dollars (may be 0 for free items OR unresolved)
 *   - `isResolved`        — true only when every component costed successfully
 *   - `unresolvedReasons` — reason codes explaining why costing is incomplete
 *
 * A genuinely free recipe (e.g. water, ice) returns `{ cost: 0, isResolved: true, unresolvedReasons: [] }`.
 * An incomplete recipe returns `isResolved: false` with at least one reason code.
 *
 * @param recipe          The recipe being costed.
 * @param components      All components of that recipe.
 * @param units           Full global units table.
 * @param itemsMap        Inventory items keyed by id.
 * @param recipesMap      All recipes keyed by id (for sub-recipe lookup).
 * @param subCostsMap     Pre-computed RecipeCostResult for each sub-recipe id.
 *                        Must be populated for all recipe-type components before calling.
 * @param perItemUnitsMap Per-item recipe-unit overrides keyed by inventoryItemId.
 * @param company         Company settings (for costing method: last_cost vs weighted_average).
 */
export function assessRecipeCostResult(
  recipe: RecipeShape,
  components: ComponentShape[],
  units: Unit[],
  itemsMap: Map<string, ItemShape>,
  recipesMap: Map<string, RecipeShape>,
  subCostsMap: Map<string, RecipeCostResult>,
  perItemUnitsMap: Map<string, InventoryItemUnit[]>,
  company: CostingMethodCarrier | null | undefined
): RecipeCostResult {
  const unresolvedReasons = new Set<UnresolvedReason>();

  // Structural checks on the recipe itself
  if (recipe.isPlaceholder) {
    unresolvedReasons.add("PLACEHOLDER");
  }
  if (!(recipe.yieldQty > 0)) {
    unresolvedReasons.add("INVALID_YIELD");
  }

  let totalCost = 0;

  for (const comp of components) {
    const unit = units.find((u) => u.id === comp.unitId);

    // Placeholder component — componentId is a random UUID that won't resolve
    if (comp.missingItemName) {
      unresolvedReasons.add("PLACEHOLDER");
      continue;
    }

    if (comp.componentType === "inventory_item") {
      const item = itemsMap.get(comp.componentId);
      if (!item) {
        unresolvedReasons.add("MISSING_ITEM");
        continue;
      }

      const perItemUnits = perItemUnitsMap.get(item.id) ?? [];
      const qtyInInvUnit = convertToInventoryUnits(
        comp.qty,
        unit,
        item,
        units,
        perItemUnits
      );
      if (qtyInInvUnit === null) {
        unresolvedReasons.add("MISSING_CONVERSION");
        continue;
      }

      const itemUnitCost = getEffectiveUnitCost(item, company);
      if (itemUnitCost === 0) {
        // Item has no price on file — contributes $0 but marks the recipe unresolved
        unresolvedReasons.add("MISSING_PRICE");
      }

      const rawYield =
        comp.yieldOverride !== null && comp.yieldOverride !== undefined
          ? comp.yieldOverride
          : item.yieldPercent;
      const yieldPercent = rawYield ?? 100;
      const yieldFactor = yieldPercent / 100;
      const effectiveCost =
        yieldFactor > 0 ? itemUnitCost / yieldFactor : itemUnitCost;
      totalCost += qtyInInvUnit * effectiveCost;
    } else if (comp.componentType === "recipe") {
      const subRecipe = recipesMap.get(comp.componentId);
      if (!subRecipe) {
        unresolvedReasons.add("MISSING_CHILD_RECIPE");
        continue;
      }

      const subResult = subCostsMap.get(comp.componentId);
      if (!subResult) {
        // Sub-recipe cost was not pre-computed — treat as missing
        unresolvedReasons.add("MISSING_CHILD_RECIPE");
        continue;
      }

      // Propagate any unresolved reasons from the child recipe
      for (const reason of subResult.unresolvedReasons) {
        unresolvedReasons.add(reason);
      }

      const qty = unit ? comp.qty * unit.toBaseRatio : comp.qty;
      const subRecipeYieldUnit = units.find(
        (u) => u.id === subRecipe.yieldUnitId
      );
      const subRecipeYieldQty = subRecipeYieldUnit
        ? subRecipe.yieldQty * subRecipeYieldUnit.toBaseRatio
        : subRecipe.yieldQty;

      if (!(subRecipeYieldQty > 0)) {
        unresolvedReasons.add("INVALID_YIELD");
        continue;
      }

      const costPerUnit = subResult.cost / subRecipeYieldQty;
      totalCost += qty * costPerUnit;
    }
  }

  const reasons = [...unresolvedReasons];
  return {
    cost: totalCost,
    isResolved: reasons.length === 0,
    unresolvedReasons: reasons,
  };
}
