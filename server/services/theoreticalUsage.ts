import { storage } from "../storage";
import type { TheoreticalUsageRun, TheoreticalUsageLine, DailyMenuItemSales } from "@shared/schema";

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
  costAtSale: number;
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
    const totalMenuItemsSold = salesData.reduce((sum, s) => {
      const qty = Number(s.qtySold) || 0;
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
          sale.qtySold
        );

        for (const ingredient of ingredients) {
          const existing = ingredientUsageMap.get(ingredient.inventoryItemId);
          if (existing) {
            existing.requiredQtyBaseUnit += ingredient.requiredQtyBaseUnit;
            existing.costAtSale += ingredient.costAtSale;
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

      const totalTheoreticalCost = usageLines.reduce((sum, line) => sum + line.costAtSale, 0);

      const updatedRun = await storage.updateTheoreticalUsageRun(usageRun.id, companyId, {
        status: "completed",
        completedAt: new Date(),
        totalTheoreticalCost,
        totalTheoreticalCostWAC: totalTheoreticalCost,
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
    actualSaleQty: number
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
        if (!item) continue;

        const qtyInComponentUnit = component.qty * multiplier;
        
        const baseQty = await this.convertToBaseUnit(
          qtyInComponentUnit,
          component.unitId,
          item.unitId
        );

        const yieldMultiplier = item.yieldPercent > 0 ? (100 / item.yieldPercent) : 1;
        const adjustedQty = baseQty * yieldMultiplier;
        const cost = adjustedQty * item.pricePerUnit;

        ingredients.push({
          inventoryItemId: item.id,
          requiredQtyBaseUnit: adjustedQty,
          baseUnitId: item.unitId,
          costAtSale: cost,
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
          actualSaleQty
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

    const conversions = await storage.getUnitConversions();
    const directConversion = conversions.find(
      c => c.fromUnitId === fromUnitId && c.toUnitId === toUnitId
    );
    
    if (directConversion) {
      return qty * directConversion.conversionFactor;
    }

    const reverseConversion = conversions.find(
      c => c.fromUnitId === toUnitId && c.toUnitId === fromUnitId
    );
    
    if (reverseConversion) {
      return qty / reverseConversion.conversionFactor;
    }

    return qty;
  }
}

export const theoreticalUsageService = new TheoreticalUsageService();
