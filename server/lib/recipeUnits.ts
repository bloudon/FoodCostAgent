/**
 * Per-item Recipe Units helpers.
 *
 * "Recipe Units" are an item-specific whitelist of units that recipes are
 * allowed to call this item by, with a per-item conversion factor. Each row's
 * `qtyPerInventoryUnit` answers "for 1 of the item's inventory unit, how many
 * of THIS unit do you get?" — so for 5-lb bags of an item priced by LB, the
 * "bag" row stores qtyPerInventoryUnit = 1/5 = 0.2 (you get 0.2 bags per LB).
 *
 * The cost engine consults this list before falling back to the global
 * `units.to_base_ratio` math, so cross-kind references like "1 each apple"
 * against a per-LB apple price work correctly.
 *
 * Two entry points:
 *   - convertToInventoryUnits: cost-time qty conversion
 *   - autoSeedRecipeUnitsForItem: idempotent seed at create/update time
 */

import type { Unit, InventoryItem, InventoryItemUnit } from "@shared/schema";
import { storage } from "../storage";

/**
 * Convert a recipe-component qty from `fromUnit` into the item's inventory
 * unit. Tries (in order): same-unit, item-specific factor, same-kind via
 * toBaseRatio. Returns null when the units are incompatible.
 */
export function convertToInventoryUnits(
  qty: number,
  fromUnit: Unit | undefined,
  item: Pick<InventoryItem, "id" | "unitId">,
  units: Unit[],
  perItemUnits: InventoryItemUnit[]
): number | null {
  if (!fromUnit) return null;

  // Trivial: already in the inventory unit
  if (fromUnit.id === item.unitId) return qty;

  // Item-specific factor (recipe units only — issue units are not used for
  // recipe costing, even though they share the table)
  const override = perItemUnits.find(
    (u) => u.unitId === fromUnit.id && u.isIssueUnit === 0
  );
  if (override && override.qtyPerInventoryUnit > 0) {
    return qty / override.qtyPerInventoryUnit;
  }

  // Same-kind path via global toBaseRatio
  const itemUnit = units.find((u) => u.id === item.unitId);
  if (
    itemUnit &&
    fromUnit.kind === itemUnit.kind &&
    itemUnit.toBaseRatio > 0 &&
    fromUnit.toBaseRatio > 0
  ) {
    return (qty * fromUnit.toBaseRatio) / itemUnit.toBaseRatio;
  }

  // Water-density cross-kind fallback (volume ↔ weight, 1 mL ≈ 1 g).
  // Volume toBaseRatio is in mL; weight toBaseRatio is in grams.
  // Water density (1 g/mL) means they share the same numeric base, so the
  // standard ratio formula works without any density constant:
  //   qty_in_inventory_unit = (qty × fromUnit.toBaseRatio) / itemUnit.toBaseRatio
  // This gives: 1 cup → 236.6 mL → 236.6 g → 0.522 lb ≈ 8.35 oz
  //             1 tbsp → 14.79 mL → 0.0326 lb ≈ 0.52 oz
  //             1 tsp  →  4.93 mL → 0.0109 lb ≈ 0.17 oz
  // A saved per-item factor (handled above) always wins over this fallback.
  if (
    itemUnit &&
    ((fromUnit.kind === "volume" && itemUnit.kind === "weight") ||
      (fromUnit.kind === "weight" && itemUnit.kind === "volume")) &&
    itemUnit.toBaseRatio > 0 &&
    fromUnit.toBaseRatio > 0
  ) {
    return (qty * fromUnit.toBaseRatio) / itemUnit.toBaseRatio;
  }

  return null;
}

/**
 * Map a Pack Breakdown label (e.g. "Case", "Bag", "Box", "Each") to a unit row
 * in the global `units` table. Returns undefined when no matching unit exists.
 */
function findUnitByLabel(units: Unit[], label: string): Unit | undefined {
  const target = label.trim().toLowerCase();
  if (!target) return undefined;
  return units.find(
    (u) =>
      u.name.toLowerCase() === target ||
      u.abbreviation.toLowerCase() === target
  );
}

/**
 * Idempotent seed: derives Recipe Unit rows from caseSize, containerSize, and
 * containerLabel. Existing rows for the same (item, unit, isIssueUnit=0) are
 * left untouched so user edits/manual additions are preserved.
 *
 * Auto-seeds:
 *   - The inventory unit itself (qtyPerInventoryUnit = 1)
 *   - "Case" unit when caseSize is set and a "case" row exists in `units`
 *     (qtyPerInventoryUnit = 1 / caseSize)
 *   - The containerLabel unit when containerSize is set and the label
 *     resolves to a global unit (qtyPerInventoryUnit = 1 / containerSize)
 */
export async function autoSeedRecipeUnitsForItem(
  item: Pick<
    InventoryItem,
    | "id"
    | "companyId"
    | "unitId"
    | "caseSize"
    | "containerSize"
    | "containerLabel"
  >
): Promise<void> {
  if (!item.id || !item.companyId || !item.unitId) return;

  const [units, existing] = await Promise.all([
    storage.getUnits(),
    storage.getInventoryItemUnits(item.id),
  ]);

  // Only consider Recipe Units (isIssueUnit=0) for the "already exists" check.
  const existingRecipeUnitIds = new Set(
    existing.filter((u) => u.isIssueUnit === 0).map((u) => u.unitId)
  );

  const seeds: Array<{ unitId: string; qtyPerInventoryUnit: number; sortOrder: number }> = [];

  // 1. Inventory unit itself
  if (!existingRecipeUnitIds.has(item.unitId)) {
    seeds.push({ unitId: item.unitId, qtyPerInventoryUnit: 1, sortOrder: 0 });
  }

  // 2. Case row (when we have a meaningful caseSize)
  const caseUnit = units.find((u) => u.name.toLowerCase() === "case");
  if (
    caseUnit &&
    item.caseSize &&
    item.caseSize > 0 &&
    !existingRecipeUnitIds.has(caseUnit.id)
  ) {
    seeds.push({
      unitId: caseUnit.id,
      qtyPerInventoryUnit: 1 / item.caseSize,
      sortOrder: 1,
    });
  }

  // 3. Container row (when label and containerSize are set and resolve)
  if (item.containerLabel && item.containerSize && item.containerSize > 0) {
    const containerUnit = findUnitByLabel(units, item.containerLabel);
    if (
      containerUnit &&
      containerUnit.id !== caseUnit?.id &&
      !existingRecipeUnitIds.has(containerUnit.id)
    ) {
      seeds.push({
        unitId: containerUnit.id,
        qtyPerInventoryUnit: 1 / item.containerSize,
        sortOrder: 2,
      });
    }
  }

  for (const seed of seeds) {
    try {
      await storage.createInventoryItemUnit({
        companyId: item.companyId,
        inventoryItemId: item.id,
        unitId: seed.unitId,
        qtyPerInventoryUnit: seed.qtyPerInventoryUnit,
        isIssueUnit: 0,
        sortOrder: seed.sortOrder,
      });
    } catch {
      // Unique constraint collision — another concurrent save already seeded
      // this row. Safe to ignore; we never overwrite user-edited rows.
    }
  }
}
