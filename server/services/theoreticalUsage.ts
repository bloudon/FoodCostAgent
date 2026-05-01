import { storage } from "../storage";
import type { TheoreticalUsageRun, TheoreticalUsageLine, DailyMenuItemSales } from "@shared/schema";
import { getEffectiveUnitCost, type CostingMethodCarrier } from "../lib/costing";

interface TheoreticalUsageInput {
  companyId: string;
  storeId: string;
  salesDate: Date;
  sourceBatchId: string;
  salesData: DailyMenuItemSales[];
}

interface IngredientUsage {
  inventoryItemId: string;
  requiredQtyBaseUnit: number;
  baseUnitId: string;
  // Two cost bases captured at run time, both frozen against future toggle
  // changes:
  //   - costAtSale: HEADLINE basis per the company's selected costing method
  //     at run creation time (via getEffectiveUnitCost). Used for the run
  //     summary and food-cost % displayed in the UI. sum(costAtSale) ===
  //     run header totalTheoreticalCost (internally consistent).
  //   - costAtSaleWac: ALWAYS WAC basis (avgCostPerUnit, last-cost fallback
  //     when 0) so totalTheoreticalCostWAC supports a side-by-side compare
  //     against the headline.
  costAtSale: number;
  costAtSaleWac: number;
  sourceMenuItems: Array<{
    menuItemId: string;
    menuItemName: string;
    qtySold: number;
  }>;
}

export class TheoreticalUsageService {
  async calculateTheoreticalUsage(input: TheoreticalUsageInput): Promise<TheoreticalUsageRun> {
    const { companyId, storeId, salesDate, sourceBatchId, salesData } = input;

    // Calculate totals with proper number handling
    console.log('[TFC Usage] First sales record keys:', salesData.length > 0 ? Object.keys(salesData[0]) : 'no data');
    console.log('[TFC Usage] First sales record qtySold:', salesData.length > 0 ? salesData[0].qtySold : 'no data');
    console.log('[TFC Usage] First sales record netSales:', salesData.length > 0 ? salesData[0].netSales : 'no data');
    
    const totalMenuItemsSold = salesData.reduce((sum, s) => {
      const qty = Number(s.qtySold) || 0;
      console.log('[TFC Usage] Processing qty:', s.qtySold, '-> Number:', qty);
      return sum + qty;
    }, 0);
    
    const totalRevenue = salesData.reduce((sum, s) => {
      const revenue = Number(s.netSales) || 0;
      return sum + revenue;
    }, 0);

    console.log('[TFC Usage] Creating run:', { totalMenuItemsSold, totalRevenue, recordCount: salesData.length });

    const usageRun = await storage.createTheoreticalUsageRun({
      companyId,
      storeId,
      salesDate,
      sourceBatchId,
      status: "processing",
      totalMenuItemsSold,
      totalRevenue,
      totalTheoreticalCost: 0,
      totalTheoreticalCostWAC: 0,
    });

    try {
      const ingredientUsageMap = new Map<string, IngredientUsage>();
      const company = await storage.getCompany(companyId);

      for (const sale of salesData) {
        if (sale.qtySold <= 0) continue;

        const menuItem = await storage.getMenuItem(sale.menuItemId);
        if (!menuItem || !menuItem.recipeId) {
          continue;
        }

        const recipe = await storage.getRecipe(menuItem.recipeId, companyId);
        if (!recipe) continue;

        const ingredients = await this.explodeRecipe(
          recipe.id,
          sale.qtySold,
          companyId,
          new Set(),
          menuItem.id,
          menuItem.name,
          sale.qtySold,
          company,
        );

        for (const ingredient of ingredients) {
          const existing = ingredientUsageMap.get(ingredient.inventoryItemId);
          if (existing) {
            existing.requiredQtyBaseUnit += ingredient.requiredQtyBaseUnit;
            existing.costAtSale += ingredient.costAtSale;
            existing.costAtSaleWac += ingredient.costAtSaleWac;
            existing.sourceMenuItems.push(...ingredient.sourceMenuItems);
          } else {
            ingredientUsageMap.set(ingredient.inventoryItemId, ingredient);
          }
        }
      }

      const usageLines = Array.from(ingredientUsageMap.values()).map(usage => ({
        runId: usageRun.id,
        inventoryItemId: usage.inventoryItemId,
        requiredQtyBaseUnit: usage.requiredQtyBaseUnit,
        baseUnitId: usage.baseUnitId,
        costAtSale: usage.costAtSale,
        sourceMenuItems: JSON.stringify(usage.sourceMenuItems),
      }));

      if (usageLines.length > 0) {
        await storage.createTheoreticalUsageLines(usageLines);
      }

      // Persist both stable cost bases on the run header. Both are frozen
      // against future toggle changes — flipping the company costing method
      // never mutates these values. The UI selects which one to surface as
      // the headline (food cost %, summary) based on company.costingMethod
      // at view time, while always rendering both for a side-by-side compare.
      const ingredientUsages = Array.from(ingredientUsageMap.values());
      const totalTheoreticalCost = ingredientUsages.reduce(
        (sum, u) => sum + u.costAtSale,
        0,
      );
      const totalTheoreticalCostWAC = ingredientUsages.reduce(
        (sum, u) => sum + u.costAtSaleWac,
        0,
      );

      const updatedRun = await storage.updateTheoreticalUsageRun(usageRun.id, companyId, {
        status: "completed",
        completedAt: new Date(),
        totalTheoreticalCost,
        totalTheoreticalCostWAC,
      });

      return updatedRun || usageRun;
    } catch (error) {
      await storage.updateTheoreticalUsageRun(usageRun.id, companyId, {
        status: "failed",
        completedAt: new Date(),
      });
      throw error;
    }
  }

  private async explodeRecipe(
    recipeId: string,
    multiplier: number,
    companyId: string,
    visited: Set<string>,
    menuItemId: string,
    menuItemName: string,
    actualSaleQty: number,
    company?: CostingMethodCarrier | null,
  ): Promise<IngredientUsage[]> {
    if (visited.has(recipeId)) {
      return [];
    }
    
    const localVisited = new Set(visited);
    localVisited.add(recipeId);

    const recipe = await storage.getRecipe(recipeId, companyId);
    if (!recipe) return [];

    const components = await storage.getRecipeComponents(recipeId);
    const ingredients: IngredientUsage[] = [];

    for (const component of components) {
      if (component.componentType === "inventory_item") {
        const item = await storage.getInventoryItem(component.componentId);
        if (!item) {
          console.warn(`[TheoreticalUsage] Missing inventory item: componentId=${component.componentId} recipeId=${recipeId} componentRowId=${component.id} — skipping component in usage calculation`);
          continue;
        }

        const qtyInComponentUnit = component.qty * multiplier;
        
        const baseQty = await this.convertToBaseUnit(
          qtyInComponentUnit,
          component.unitId,
          item.unitId
        );

        // Note: Recipe quantities already account for yield (they specify "as purchased" amounts)
        // Do NOT apply yield percentage here, as that would double-count waste.
        //
        // Capture two cost bases at run time, both frozen against future
        // costing-method toggles:
        //   - cost: HEADLINE basis per the company's selected costing method
        //     at run creation time. Sum of `cost` over lines === run header
        //     totalTheoreticalCost (internally consistent for the food
        //     cost % displayed in the UI).
        //   - costWac: ALWAYS WAC basis (avgCostPerUnit, falling back to
        //     pricePerUnit when WAC is 0) so the run header
        //     totalTheoreticalCostWAC supports a side-by-side compare.
        const lastCostUnit = Number(item.pricePerUnit) || 0;
        const wacUnit = Number(item.avgCostPerUnit) || 0;
        const wacEffectiveUnit = wacUnit > 0 ? wacUnit : lastCostUnit;
        const cost = baseQty * getEffectiveUnitCost(item, company);
        const costWac = baseQty * wacEffectiveUnit;

        ingredients.push({
          inventoryItemId: item.id,
          requiredQtyBaseUnit: baseQty,
          baseUnitId: item.unitId,
          costAtSale: cost,
          costAtSaleWac: costWac,
          sourceMenuItems: [{
            menuItemId,
            menuItemName,
            qtySold: actualSaleQty,
          }],
        });
      } else if (component.componentType === "recipe") {
        const nestedMultiplier = component.qty * multiplier;
        const nestedIngredients = await this.explodeRecipe(
          component.componentId,
          nestedMultiplier,
          companyId,
          localVisited,
          menuItemId,
          menuItemName,
          actualSaleQty,
          company,
        );
        ingredients.push(...nestedIngredients);
      }
    }

    return ingredients;
  }

  private async convertToBaseUnit(
    qty: number,
    fromUnitId: string,
    toUnitId: string
  ): Promise<number> {
    if (fromUnitId === toUnitId) {
      return qty;
    }

    // Try direct conversion first
    const conversions = await storage.getUnitConversions();
    const directConversion = conversions.find(
      c => c.fromUnitId === fromUnitId && c.toUnitId === toUnitId
    );
    
    if (directConversion) {
      return qty * directConversion.conversionFactor;
    }

    // Try reverse conversion
    const reverseConversion = conversions.find(
      c => c.fromUnitId === toUnitId && c.toUnitId === fromUnitId
    );
    
    if (reverseConversion) {
      return qty / reverseConversion.conversionFactor;
    }

    // Use base unit ratios (grams for weight, milliliters for volume)
    const fromUnit = await storage.getUnit(fromUnitId);
    const toUnit = await storage.getUnit(toUnitId);
    
    if (fromUnit && toUnit && fromUnit.kind === toUnit.kind) {
      // Convert: fromQty * fromRatio = baseQty, then baseQty / toRatio = toQty
      const result = (qty * fromUnit.toBaseRatio) / toUnit.toBaseRatio;
      console.log(`[TFC Conversion] ${qty} ${fromUnit.name} → ${result.toFixed(4)} ${toUnit.name} (via base unit)`);
      return result;
    }

    console.warn(`[TFC Conversion] No conversion found from ${fromUnitId} to ${toUnitId}`);
    return qty;
  }
}

export const theoreticalUsageService = new TheoreticalUsageService();
