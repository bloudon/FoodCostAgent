import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertUnitSchema,
  insertStorageLocationSchema,
  insertVendorSchema,
  insertProductSchema,
  insertVendorProductSchema,
  insertRecipeSchema,
  insertRecipeComponentSchema,
  insertInventoryCountSchema,
  insertInventoryCountLineSchema,
  insertPurchaseOrderSchema,
  insertPOLineSchema,
  insertReceiptSchema,
  insertReceiptLineSchema,
  insertPOSSaleSchema,
  insertPOSSalesLineSchema,
  insertMenuItemSchema,
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // ============ UNITS ============
  app.get("/api/units", async (req, res) => {
    const units = await storage.getUnits();
    res.json(units);
  });

  app.post("/api/units", async (req, res) => {
    try {
      const data = insertUnitSchema.parse(req.body);
      const unit = await storage.createUnit(data);
      res.status(201).json(unit);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ STORAGE LOCATIONS ============
  app.get("/api/storage-locations", async (req, res) => {
    const locations = await storage.getStorageLocations();
    res.json(locations);
  });

  app.post("/api/storage-locations", async (req, res) => {
    try {
      const data = insertStorageLocationSchema.parse(req.body);
      const location = await storage.createStorageLocation(data);
      res.status(201).json(location);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VENDORS ============
  app.get("/api/vendors", async (req, res) => {
    const vendors = await storage.getVendors();
    res.json(vendors);
  });

  app.post("/api/vendors", async (req, res) => {
    try {
      const data = insertVendorSchema.parse(req.body);
      const vendor = await storage.createVendor(data);
      res.status(201).json(vendor);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ PRODUCTS ============
  app.get("/api/products", async (req, res) => {
    const products = await storage.getProducts();
    res.json(products);
  });

  app.get("/api/products/:id", async (req, res) => {
    const product = await storage.getProduct(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    res.json(product);
  });

  app.post("/api/products", async (req, res) => {
    try {
      const data = insertProductSchema.parse(req.body);
      const product = await storage.createProduct(data);
      res.status(201).json(product);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VENDOR PRODUCTS ============
  app.get("/api/vendor-products", async (req, res) => {
    const vendorId = req.query.vendor_id as string | undefined;
    const vendorProducts = await storage.getVendorProducts(vendorId);
    res.json(vendorProducts);
  });

  app.post("/api/vendor-products", async (req, res) => {
    try {
      const data = insertVendorProductSchema.parse(req.body);
      const vendorProduct = await storage.createVendorProduct(data);
      res.status(201).json(vendorProduct);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ RECIPES ============
  app.get("/api/recipes", async (req, res) => {
    const recipes = await storage.getRecipes();
    res.json(recipes);
  });

  app.get("/api/recipes/:id", async (req, res) => {
    const recipe = await storage.getRecipe(req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    const components = await storage.getRecipeComponents(req.params.id);
    const units = await storage.getUnits();
    const products = await storage.getProducts();
    const recipes = await storage.getRecipes();

    const expandedComponents = await Promise.all(
      components.map(async (comp) => {
        const unit = units.find((u) => u.id === comp.unitId);
        if (comp.componentType === "product") {
          const product = products.find((p) => p.id === comp.componentId);
          return {
            ...comp,
            name: product?.name || "Unknown",
            unitName: unit?.name || "Unknown",
          };
        } else {
          const subRecipe = recipes.find((r) => r.id === comp.componentId);
          return {
            ...comp,
            name: subRecipe?.name || "Unknown",
            unitName: unit?.name || "Unknown",
          };
        }
      })
    );

    const computedCost = await calculateRecipeCost(recipe.id);
    
    res.json({
      ...recipe,
      computedCost,
      components: expandedComponents,
    });
  });

  app.post("/api/recipes", async (req, res) => {
    try {
      const data = insertRecipeSchema.parse(req.body);
      const recipe = await storage.createRecipe(data);
      res.status(201).json(recipe);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/recipes/:id/components", async (req, res) => {
    try {
      const data = insertRecipeComponentSchema.parse(req.body);
      const component = await storage.createRecipeComponent({
        ...data,
        recipeId: req.params.id,
      });
      
      const updatedCost = await calculateRecipeCost(req.params.id);
      await storage.updateRecipe(req.params.id, { computedCost: updatedCost });
      
      res.status(201).json(component);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ INVENTORY ============
  app.get("/api/inventory", async (req, res) => {
    const locationId = req.query.location_id as string | undefined;
    const levels = await storage.getInventoryLevels(locationId);
    
    const products = await storage.getProducts();
    const enriched = levels.map((level) => {
      const product = products.find((p) => p.id === level.productId);
      return {
        ...level,
        productName: product?.name || "Unknown",
      };
    });
    
    res.json(enriched);
  });

  // ============ INVENTORY COUNTS ============
  app.get("/api/inventory-counts", async (req, res) => {
    const counts = await storage.getInventoryCounts();
    res.json(counts);
  });

  app.post("/api/inventory-counts", async (req, res) => {
    try {
      const { lines, ...countData } = req.body;
      const countInput = insertInventoryCountSchema.parse(countData);
      const count = await storage.createInventoryCount(countInput);

      if (lines && Array.isArray(lines)) {
        const units = await storage.getUnits();
        
        for (const line of lines) {
          const lineData = insertInventoryCountLineSchema.parse({
            ...line,
            inventoryCountId: count.id,
          });

          const unit = units.find((u) => u.id === lineData.unitId);
          const derivedMicroUnits = unit
            ? lineData.qty * unit.toBaseRatio
            : lineData.qty;

          await storage.createInventoryCountLine({
            ...lineData,
            derivedMicroUnits,
          });

          await storage.updateInventoryLevel(
            lineData.productId,
            count.storageLocationId,
            derivedMicroUnits
          );
        }
      }

      res.status(201).json(count);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ PURCHASE ORDERS ============
  app.get("/api/purchase-orders", async (req, res) => {
    const orders = await storage.getPurchaseOrders();
    const vendors = await storage.getVendors();
    
    const enriched = orders.map((po) => {
      const vendor = vendors.find((v) => v.id === po.vendorId);
      return {
        ...po,
        vendorName: vendor?.name || "Unknown",
      };
    });
    
    res.json(enriched);
  });

  app.get("/api/purchase-orders/:id", async (req, res) => {
    const po = await storage.getPurchaseOrder(req.params.id);
    if (!po) {
      return res.status(404).json({ error: "Purchase order not found" });
    }

    const lines = await storage.getPOLines(req.params.id);
    const vendorProducts = await storage.getVendorProducts();
    const products = await storage.getProducts();

    const enrichedLines = lines.map((line) => {
      const vp = vendorProducts.find((vp) => vp.id === line.vendorProductId);
      const product = products.find((p) => p.id === vp?.productId);
      return {
        ...line,
        productName: product?.name || "Unknown",
        vendorSku: vp?.vendorSku || "",
      };
    });

    res.json({
      ...po,
      lines: enrichedLines,
    });
  });

  app.post("/api/purchase-orders", async (req, res) => {
    try {
      const { lines, ...poData } = req.body;
      const poInput = insertPurchaseOrderSchema.parse(poData);
      const po = await storage.createPurchaseOrder(poInput);

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          const lineData = insertPOLineSchema.parse({
            ...line,
            purchaseOrderId: po.id,
          });
          await storage.createPOLine(lineData);
        }
      }

      res.status(201).json(po);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ RECEIPTS ============
  app.get("/api/receipts", async (req, res) => {
    const receipts = await storage.getReceipts();
    res.json(receipts);
  });

  app.post("/api/receipts", async (req, res) => {
    try {
      const { lines, storageLocationId, ...receiptData } = req.body;
      const receiptInput = insertReceiptSchema.parse(receiptData);
      const receipt = await storage.createReceipt(receiptInput);

      if (lines && Array.isArray(lines)) {
        const units = await storage.getUnits();
        const vendorProducts = await storage.getVendorProducts();

        for (const line of lines) {
          const lineData = insertReceiptLineSchema.parse({
            ...line,
            receiptId: receipt.id,
          });

          const unit = units.find((u) => u.id === lineData.unitId);
          const derivedMicroUnits = unit
            ? lineData.receivedQty * unit.toBaseRatio
            : lineData.receivedQty;

          await storage.createReceiptLine({
            ...lineData,
            derivedMicroUnits,
          });

          const vp = vendorProducts.find((vp) => vp.id === lineData.vendorProductId);
          if (vp) {
            const costPerMicroUnit = lineData.priceEach / derivedMicroUnits;
            await storage.updateProduct(vp.productId, {
              lastCost: costPerMicroUnit,
            });

            if (storageLocationId) {
              const currentLevel = await storage.getInventoryLevel(
                vp.productId,
                storageLocationId
              );
              const newOnHand = (currentLevel?.onHandMicroUnits || 0) + derivedMicroUnits;
              await storage.updateInventoryLevel(
                vp.productId,
                storageLocationId,
                newOnHand
              );
            }
          }
        }

        await storage.updatePurchaseOrder(receiptInput.purchaseOrderId, {
          status: "received",
        });
      }

      res.status(201).json(receipt);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ POS INGESTION ============
  app.post("/api/pos/ingest", async (req, res) => {
    try {
      const { lines, ...saleData } = req.body;
      const saleInput = insertPOSSaleSchema.parse(saleData);
      const sale = await storage.createPOSSale(saleInput);

      if (lines && Array.isArray(lines)) {
        for (const line of lines) {
          const lineData = insertPOSSalesLineSchema.parse({
            ...line,
            posSalesId: sale.id,
          });
          await storage.createPOSSalesLine(lineData);
        }
      }

      res.status(201).json(sale);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ MENU ITEMS ============
  app.get("/api/menu-items", async (req, res) => {
    const items = await storage.getMenuItems();
    res.json(items);
  });

  app.post("/api/menu-items", async (req, res) => {
    try {
      const data = insertMenuItemSchema.parse(req.body);
      const item = await storage.createMenuItem(data);
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ VARIANCE REPORT ============
  app.get("/api/reports/variance", async (req, res) => {
    try {
      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate = req.query.end ? new Date(req.query.end as string) : undefined;

      const theoreticalUsage = await calculateTheoreticalUsage(startDate, endDate);
      const actualUsage = await calculateActualUsage(startDate, endDate);

      const products = await storage.getProducts();
      const variance = products.map((product) => {
        const theoretical = theoreticalUsage[product.id] || 0;
        const actual = actualUsage[product.id] || 0;
        const varianceUnits = actual - theoretical;
        const varianceCost = varianceUnits * product.lastCost;
        const variancePercent = theoretical > 0 ? (varianceUnits / theoretical) * 100 : 0;

        return {
          productId: product.id,
          productName: product.name,
          theoreticalUsage: theoretical,
          actualUsage: actual,
          varianceUnits,
          varianceCost,
          variancePercent,
        };
      }).filter(v => v.theoreticalUsage > 0 || v.actualUsage > 0);

      res.json(variance);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ RECIPE COSTS REPORT ============
  app.get("/api/reports/recipe-costs", async (req, res) => {
    try {
      const recipeId = req.query.recipe_id as string | undefined;
      
      if (recipeId) {
        const cost = await calculateRecipeCost(recipeId);
        const recipe = await storage.getRecipe(recipeId);
        res.json({ recipeId, recipeName: recipe?.name, cost });
      } else {
        const recipes = await storage.getRecipes();
        const costs = await Promise.all(
          recipes.map(async (recipe) => ({
            recipeId: recipe.id,
            recipeName: recipe.name,
            cost: await calculateRecipeCost(recipe.id),
          }))
        );
        res.json(costs);
      }
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

// ============ HELPER FUNCTIONS ============

async function calculateRecipeCost(recipeId: string): Promise<number> {
  const recipe = await storage.getRecipe(recipeId);
  if (!recipe) return 0;

  const components = await storage.getRecipeComponents(recipeId);
  const units = await storage.getUnits();
  const products = await storage.getProducts();
  
  let totalCost = 0;

  for (const comp of components) {
    const unit = units.find((u) => u.id === comp.unitId);
    const microUnits = unit ? comp.qty * unit.toBaseRatio : comp.qty;

    if (comp.componentType === "product") {
      const product = products.find((p) => p.id === comp.componentId);
      if (product) {
        totalCost += microUnits * product.lastCost;
      }
    } else if (comp.componentType === "recipe") {
      const subRecipeCost = await calculateRecipeCost(comp.componentId);
      totalCost += subRecipeCost * comp.qty;
    }
  }

  const wasteMultiplier = 1 + recipe.wastePercent / 100;
  return totalCost * wasteMultiplier;
}

async function calculateTheoreticalUsage(
  startDate?: Date,
  endDate?: Date
): Promise<Record<string, number>> {
  const sales = await storage.getPOSSales(startDate, endDate);
  const menuItems = await storage.getMenuItems();
  const usage: Record<string, number> = {};

  for (const sale of sales) {
    const saleLines = await storage.getPOSSalesLines(sale.id);
    
    for (const line of saleLines) {
      const menuItem = menuItems.find((mi) => mi.pluSku === line.pluSku);
      if (menuItem) {
        const recipeUsage = await calculateRecipeUsage(menuItem.recipeId, line.qtySold);
        
        for (const [productId, qty] of Object.entries(recipeUsage)) {
          usage[productId] = (usage[productId] || 0) + qty;
        }
      }
    }
  }

  return usage;
}

async function calculateRecipeUsage(
  recipeId: string,
  multiplier: number
): Promise<Record<string, number>> {
  const components = await storage.getRecipeComponents(recipeId);
  const units = await storage.getUnits();
  const usage: Record<string, number> = {};

  for (const comp of components) {
    const unit = units.find((u) => u.id === comp.unitId);
    const microUnits = unit ? comp.qty * unit.toBaseRatio : comp.qty;

    if (comp.componentType === "product") {
      usage[comp.componentId] = (usage[comp.componentId] || 0) + microUnits * multiplier;
    } else if (comp.componentType === "recipe") {
      const subUsage = await calculateRecipeUsage(comp.componentId, multiplier * comp.qty);
      for (const [productId, qty] of Object.entries(subUsage)) {
        usage[productId] = (usage[productId] || 0) + qty;
      }
    }
  }

  return usage;
}

async function calculateActualUsage(
  startDate?: Date,
  endDate?: Date
): Promise<Record<string, number>> {
  const counts = await storage.getInventoryCounts();
  const receipts = await storage.getReceipts();
  const usage: Record<string, number> = {};

  const filteredCounts = counts.filter((c) => {
    if (startDate && c.countedAt < startDate) return false;
    if (endDate && c.countedAt > endDate) return false;
    return true;
  }).sort((a, b) => a.countedAt.getTime() - b.countedAt.getTime());

  if (filteredCounts.length < 2) {
    return usage;
  }

  const startCount = filteredCounts[0];
  const endCount = filteredCounts[filteredCounts.length - 1];

  const startLines = await storage.getInventoryCountLines(startCount.id);
  const endLines = await storage.getInventoryCountLines(endCount.id);

  const productIds = new Set([
    ...startLines.map((l) => l.productId),
    ...endLines.map((l) => l.productId),
  ]);

  for (const productId of productIds) {
    const startLine = startLines.find((l) => l.productId === productId);
    const endLine = endLines.find((l) => l.productId === productId);

    const startingOnHand = startLine?.derivedMicroUnits || 0;
    const endingOnHand = endLine?.derivedMicroUnits || 0;

    let receiptsInPeriod = 0;
    const filteredReceipts = receipts.filter((r) => {
      if (startDate && r.receivedAt < startDate) return false;
      if (endDate && r.receivedAt > endDate) return false;
      return true;
    });

    for (const receipt of filteredReceipts) {
      const receiptLines = await storage.getReceiptLines(receipt.id);
      const vendorProducts = await storage.getVendorProducts();
      
      for (const rLine of receiptLines) {
        const vp = vendorProducts.find((vp) => vp.id === rLine.vendorProductId);
        if (vp && vp.productId === productId) {
          receiptsInPeriod += rLine.derivedMicroUnits;
        }
      }
    }

    const actualUsage = startingOnHand + receiptsInPeriod - endingOnHand;
    usage[productId] = actualUsage;
  }

  return usage;
}
