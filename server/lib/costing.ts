/**
 * Costing helper — single source of truth for "what unit cost should I use
 * for this inventory item?".
 *
 * Companies pick a Costing Method on the Company Settings page:
 *   - 'last_cost' → use item.pricePerUnit (the most recent received cost)
 *   - 'wac'       → use item.avgCostPerUnit (rolling weighted average cost)
 *
 * Default is 'last_cost' so existing companies see no behavioral change.
 *
 * Critical fallback: when a company picks 'wac' but the item has never been
 * received (avgCostPerUnit = 0), we fall back to pricePerUnit so recipes
 * don't suddenly cost $0.
 */

export type CostingMethod = "last_cost" | "wac";

export interface CostingMethodCarrier {
  costingMethod?: string | null;
}

export interface UnitCostCarrier {
  pricePerUnit?: number | null;
  avgCostPerUnit?: number | null;
}

export function getCostingMethod(
  company: CostingMethodCarrier | null | undefined
): CostingMethod {
  return company?.costingMethod === "wac" ? "wac" : "last_cost";
}

/**
 * Returns the unit cost to use for cost calculations for this item, given
 * the company's preferred costing method. Always returns a finite number ≥ 0.
 */
export function getEffectiveUnitCost(
  item: UnitCostCarrier | null | undefined,
  company: CostingMethodCarrier | null | undefined
): number {
  if (!item) return 0;
  const method = getCostingMethod(company);
  const lastCost = Number(item.pricePerUnit) || 0;
  if (method === "wac") {
    const wac = Number(item.avgCostPerUnit) || 0;
    if (wac > 0) return wac;
  }
  return lastCost;
}
