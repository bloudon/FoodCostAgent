import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { z } from "zod";
import { createSession, requireAuth, verifyPassword } from "./auth";
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
  insertRecipeVersionSchema,
  insertTransferLogSchema,
  insertWasteLogSchema,
  insertCompanySettingsSchema,
  insertSystemPreferencesSchema,
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // ============ AUTHENTICATION ============
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }).parse(req.body);

      const user = await storage.getUserByEmail(email);
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = await createSession(
        user.id,
        req.headers["user-agent"],
        req.ip
      );

      res.cookie("session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.json({ user: { id: user.id, email: user.email, role: user.role } });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    try {
      const sessionId = (req as any).sessionId;
      if (sessionId) {
        await storage.revokeAuthSession(sessionId);
      }
      res.clearCookie("session");
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const user = (req as any).user;
    res.json({ id: user.id, email: user.email, role: user.role });
  });


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

  app.get("/api/storage-locations/:id", async (req, res) => {
    const location = await storage.getStorageLocation(req.params.id);
    if (!location) {
      return res.status(404).json({ error: "Storage location not found" });
    }
    res.json(location);
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

  app.patch("/api/storage-locations/:id", async (req, res) => {
    try {
      const data = insertStorageLocationSchema.partial().parse(req.body);
      const location = await storage.updateStorageLocation(req.params.id, data);
      if (!location) {
        return res.status(404).json({ error: "Storage location not found" });
      }
      res.json(location);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/storage-locations/:id", async (req, res) => {
    try {
      await storage.deleteStorageLocation(req.params.id);
      res.status(204).send();
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

  // ============ RECIPE COMPONENTS ============
  app.get("/api/recipe-components/:recipeId", async (req, res) => {
    const components = await storage.getRecipeComponents(req.params.recipeId);
    const units = await storage.getUnits();
    const products = await storage.getProducts();
    const recipes = await storage.getRecipes();

    const enriched = await Promise.all(
      components.map(async (comp) => {
        const unit = units.find((u) => u.id === comp.unitId);
        const componentCost = await calculateComponentCost(comp);
        
        if (comp.componentType === "product") {
          const product = products.find((p) => p.id === comp.componentId);
          return {
            ...comp,
            productId: comp.componentId, // Add for frontend compatibility
            productName: product?.name || "Unknown",
            unitName: unit?.name || "Unknown",
            componentCost,
          };
        } else {
          const subRecipe = recipes.find((r) => r.id === comp.componentId);
          return {
            ...comp,
            subRecipeId: comp.componentId, // Add for frontend compatibility
            subRecipeName: subRecipe?.name || "Unknown",
            unitName: unit?.name || "Unknown",
            componentCost,
          };
        }
      })
    );

    res.json(enriched);
  });

  app.patch("/api/recipe-components/:id", async (req, res) => {
    try {
      const component = await storage.getRecipeComponent(req.params.id);
      if (!component) {
        return res.status(404).json({ error: "Component not found" });
      }

      const updateData = {
        qty: req.body.qty !== undefined ? req.body.qty : component.qty,
        unitId: req.body.unitId || component.unitId,
      };

      await storage.updateRecipeComponent(req.params.id, updateData);
      
      const updatedCost = await calculateRecipeCost(component.recipeId);
      await storage.updateRecipe(component.recipeId, { computedCost: updatedCost });
      
      const updated = await storage.getRecipeComponent(req.params.id);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/recipe-components/:id", async (req, res) => {
    try {
      const component = await storage.getRecipeComponent(req.params.id);
      if (!component) {
        return res.status(404).json({ error: "Component not found" });
      }

      const recipeId = component.recipeId;
      await storage.deleteRecipeComponent(req.params.id);
      
      const updatedCost = await calculateRecipeCost(recipeId);
      await storage.updateRecipe(recipeId, { computedCost: updatedCost });
      
      res.status(204).send();
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

  app.get("/api/inventory-counts/:id", async (req, res) => {
    const count = await storage.getInventoryCount(req.params.id);
    if (!count) {
      return res.status(404).json({ error: "Count not found" });
    }
    res.json(count);
  });

  app.get("/api/inventory-count-lines/:countId", async (req, res) => {
    const lines = await storage.getInventoryCountLines(req.params.countId);
    const units = await storage.getUnits();
    
    const enriched = lines.map(line => {
      const unit = units.find(u => u.id === line.unitId);
      return {
        ...line,
        unitName: unit?.name || "unit"
      };
    });
    
    res.json(enriched);
  });

  app.get("/api/inventory-count-line/:id", async (req, res) => {
    const line = await storage.getInventoryCountLine(req.params.id);
    if (!line) {
      return res.status(404).json({ error: "Count line not found" });
    }
    
    const units = await storage.getUnits();
    const unit = units.find(u => u.id === line.unitId);
    
    const enriched = {
      ...line,
      unitName: unit?.name || "unit"
    };
    
    res.json(enriched);
  });

  app.post("/api/inventory-count-lines", async (req, res) => {
    try {
      const lineData = insertInventoryCountLineSchema.parse(req.body);
      const units = await storage.getUnits();
      const unit = units.find((u) => u.id === lineData.unitId);
      const derivedMicroUnits = unit
        ? lineData.qty * unit.toBaseRatio
        : lineData.qty;

      const count = await storage.getInventoryCount(lineData.inventoryCountId);
      if (!count) {
        return res.status(404).json({ error: "Count not found" });
      }

      const line = await storage.createInventoryCountLine({
        ...lineData,
        derivedMicroUnits,
      });

      // Update inventory level
      await storage.updateInventoryLevel(
        lineData.productId,
        count.storageLocationId,
        derivedMicroUnits
      );

      res.status(201).json(line);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/inventory-count-lines/:id", async (req, res) => {
    try {
      const lineData = insertInventoryCountLineSchema.partial().parse(req.body);
      const existingLine = await storage.getInventoryCountLine(req.params.id);
      
      if (!existingLine) {
        return res.status(404).json({ error: "Count line not found" });
      }

      const count = await storage.getInventoryCount(existingLine.inventoryCountId);
      if (!count) {
        return res.status(404).json({ error: "Count not found" });
      }

      // Calculate new derived micro units if qty or unit changed
      let derivedMicroUnits = existingLine.derivedMicroUnits;
      if (lineData.qty !== undefined || lineData.unitId !== undefined) {
        const units = await storage.getUnits();
        const unitId = lineData.unitId || existingLine.unitId;
        const qty = lineData.qty !== undefined ? lineData.qty : existingLine.qty;
        const unit = units.find((u) => u.id === unitId);
        derivedMicroUnits = unit ? qty * unit.toBaseRatio : qty;
      }

      const updatedLine = await storage.updateInventoryCountLine(req.params.id, {
        ...lineData,
        derivedMicroUnits,
      });

      // Update inventory level - subtract old, add new
      const oldMicroUnits = existingLine.derivedMicroUnits;
      const productId = lineData.productId || existingLine.productId;
      const currentLevel = await storage.getInventoryLevel(productId, count.storageLocationId);
      const currentQty = currentLevel?.onHandMicroUnits || 0;
      
      await storage.updateInventoryLevel(
        productId,
        count.storageLocationId,
        currentQty - oldMicroUnits + derivedMicroUnits
      );

      res.json(updatedLine);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/inventory-count-lines/:id", async (req, res) => {
    try {
      const line = await storage.getInventoryCountLine(req.params.id);
      
      if (!line) {
        return res.status(404).json({ error: "Count line not found" });
      }

      const count = await storage.getInventoryCount(line.inventoryCountId);
      if (!count) {
        return res.status(404).json({ error: "Count not found" });
      }

      // Update inventory level - subtract this line's quantity
      const currentLevel = await storage.getInventoryLevel(line.productId, count.storageLocationId);
      const currentQty = currentLevel?.onHandMicroUnits || 0;
      
      await storage.updateInventoryLevel(
        line.productId,
        count.storageLocationId,
        currentQty - line.derivedMicroUnits
      );

      await storage.deleteInventoryCountLine(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
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

  // ============ RECIPE VERSIONS ============
  app.get("/api/recipe-versions/:recipeId", async (req, res) => {
    const versions = await storage.getRecipeVersions(req.params.recipeId);
    res.json(versions);
  });

  app.post("/api/recipe-versions", async (req, res) => {
    try {
      const data = insertRecipeVersionSchema.parse(req.body);
      const version = await storage.createRecipeVersion(data);
      res.status(201).json(version);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ TRANSFER LOGS ============
  app.get("/api/transfers", async (req, res) => {
    const productId = req.query.product_id as string | undefined;
    const startDate = req.query.start_date ? new Date(req.query.start_date as string) : undefined;
    const endDate = req.query.end_date ? new Date(req.query.end_date as string) : undefined;
    const transfers = await storage.getTransferLogs(productId, startDate, endDate);
    res.json(transfers);
  });

  app.post("/api/transfers", async (req, res) => {
    try {
      const data = insertTransferLogSchema.parse(req.body);
      
      // Get current inventory levels
      const fromLevel = await storage.getInventoryLevel(data.productId, data.fromLocationId);
      const fromQty = fromLevel?.onHandMicroUnits || 0;
      
      // Validate sufficient quantity
      if (fromQty < data.derivedMicroUnits) {
        return res.status(400).json({ 
          error: `Insufficient inventory. Available: ${fromQty}, Requested: ${data.derivedMicroUnits}` 
        });
      }
      
      // Create transfer log
      const transfer = await storage.createTransferLog(data);
      
      // Update inventory levels (creates rows if they don't exist)
      await storage.updateInventoryLevel(
        data.productId,
        data.fromLocationId,
        fromQty - data.derivedMicroUnits
      );
      
      const toLevel = await storage.getInventoryLevel(data.productId, data.toLocationId);
      await storage.updateInventoryLevel(
        data.productId,
        data.toLocationId,
        (toLevel?.onHandMicroUnits || 0) + data.derivedMicroUnits
      );
      
      res.status(201).json(transfer);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ WASTE LOGS ============
  app.get("/api/waste", async (req, res) => {
    const productId = req.query.product_id as string | undefined;
    const startDate = req.query.start_date ? new Date(req.query.start_date as string) : undefined;
    const endDate = req.query.end_date ? new Date(req.query.end_date as string) : undefined;
    const wasteLogs = await storage.getWasteLogs(productId, startDate, endDate);
    res.json(wasteLogs);
  });

  app.post("/api/waste", async (req, res) => {
    try {
      const data = insertWasteLogSchema.parse(req.body);
      
      // Get current inventory level
      const level = await storage.getInventoryLevel(data.productId, data.storageLocationId);
      const currentQty = level?.onHandMicroUnits || 0;
      
      // Validate sufficient quantity
      if (currentQty < data.derivedMicroUnits) {
        return res.status(400).json({ 
          error: `Insufficient inventory. Available: ${currentQty}, Waste amount: ${data.derivedMicroUnits}` 
        });
      }
      
      // Create waste log
      const wasteLog = await storage.createWasteLog(data);
      
      // Update inventory level (creates row if it doesn't exist)
      await storage.updateInventoryLevel(
        data.productId,
        data.storageLocationId,
        currentQty - data.derivedMicroUnits
      );
      
      res.status(201).json(wasteLog);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/reports/waste-trends", async (req, res) => {
    const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
    const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
    const wasteLogs = await storage.getWasteLogs(undefined, startDate, endDate);
    const products = await storage.getProducts();
    const trends: Record<string, any> = {};
    for (const wasteLog of wasteLogs) {
      if (!trends[wasteLog.productId]) {
        const product = products.find(p => p.id === wasteLog.productId);
        trends[wasteLog.productId] = { productId: wasteLog.productId, productName: product?.name || "Unknown", totalWasteMicroUnits: 0, totalWasteCost: 0, byReason: {} as Record<string, number>, count: 0 };
      }
      const product = products.find(p => p.id === wasteLog.productId);
      const costPerMicroUnit = product?.lastCost || 0;
      trends[wasteLog.productId].totalWasteMicroUnits += wasteLog.derivedMicroUnits;
      trends[wasteLog.productId].totalWasteCost += wasteLog.derivedMicroUnits * costPerMicroUnit;
      trends[wasteLog.productId].count += 1;
      if (!trends[wasteLog.productId].byReason[wasteLog.reasonCode]) trends[wasteLog.productId].byReason[wasteLog.reasonCode] = 0;
      trends[wasteLog.productId].byReason[wasteLog.reasonCode] += wasteLog.derivedMicroUnits;
    }
    res.json(Object.values(trends));
  });

  // ============ COGS & COST ANALYSIS ============
  app.get("/api/reports/cogs-summary", async (req, res) => {
    const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
    const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
    
    // Prefetch all data once
    const sales = await storage.getPOSSales(startDate, endDate);
    const menuItems = await storage.getMenuItems();
    const products = await storage.getProducts();
    const units = await storage.getUnits();
    
    // Create lookup maps
    const productMap = new Map(products.map(p => [p.id, p]));
    const menuItemMap = new Map(menuItems.map(m => [m.id, m]));
    const unitMap = new Map(units.map(u => [u.id, u]));
    
    // Pre-calculate menu item costs using calculateRecipeCost (handles sub-recipes)
    const menuItemCostMap = new Map<string, number>();
    for (const menuItem of menuItems) {
      const cost = await calculateRecipeCost(menuItem.recipeId);
      menuItemCostMap.set(menuItem.id, cost);
    }
    
    let totalRevenue = 0;
    let totalCOGS = 0;
    const menuItemSummary: Record<string, { revenue: number, cogs: number, count: number, name: string }> = {};
    
    for (const sale of sales) {
      totalRevenue += sale.totalAmount;
      const saleLines = await storage.getPOSSalesLines(sale.id);
      
      for (const line of saleLines) {
        const portionCost = menuItemCostMap.get(line.menuItemId) || 0;
        const lineCOGS = portionCost * (line.qtySold || 0);
        totalCOGS += lineCOGS;
        
        if (!menuItemSummary[line.menuItemId]) {
          const menuItem = menuItemMap.get(line.menuItemId);
          menuItemSummary[line.menuItemId] = {
            revenue: 0,
            cogs: 0,
            count: 0,
            name: menuItem?.name || "Unknown"
          };
        }
        
        menuItemSummary[line.menuItemId].revenue += line.lineTotal || 0;
        menuItemSummary[line.menuItemId].cogs += lineCOGS;
        menuItemSummary[line.menuItemId].count += line.qtySold || 0;
      }
    }
    
    res.json({
      totalRevenue,
      totalCOGS,
      grossProfit: totalRevenue - totalCOGS,
      grossMarginPercent: totalRevenue > 0 ? ((totalRevenue - totalCOGS) / totalRevenue * 100) : 0,
      menuItems: Object.entries(menuItemSummary).map(([menuItemId, data]) => ({
        menuItemId,
        name: data.name,
        revenue: data.revenue,
        cogs: data.cogs,
        profit: data.revenue - data.cogs,
        marginPercent: data.revenue > 0 ? ((data.revenue - data.cogs) / data.revenue * 100) : 0,
        unitsSold: data.count
      }))
    });
  });

  app.get("/api/reports/price-change-impact", async (req, res) => {
    const productId = req.query.product_id as string;
    
    if (!productId) {
      return res.status(400).json({ error: "product_id is required" });
    }
    
    // Prefetch all data once
    const product = await storage.getProduct(productId);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    const menuItems = await storage.getMenuItems();
    const impact = [];
    
    // Check each menu item's recipe for the affected product (including sub-recipes)
    for (const menuItem of menuItems) {
      const productImpact = await calculateProductImpactInRecipe(menuItem.recipeId, productId);
      
      if (!productImpact.usesProduct) continue;
      
      // Calculate current recipe cost using calculateRecipeCost (handles sub-recipes)
      const currentRecipeCost = await calculateRecipeCost(menuItem.recipeId);
      const costPercent = currentRecipeCost > 0 ? (productImpact.costContribution / currentRecipeCost * 100) : 0;
      
      impact.push({
        menuItemId: menuItem.id,
        menuItemName: menuItem.name,
        recipeId: menuItem.recipeId,
        currentRecipeCost,
        componentQuantity: productImpact.microUnits,
        componentCostContribution: productImpact.costContribution,
        costPercentage: costPercent,
        priceImpactPer10Percent: productImpact.costContribution * 0.1
      });
    }
    
    res.json({
      product: {
        id: product.id,
        name: product.name,
        currentCost: product.lastCost,
        baseUnitId: product.baseUnitId
      },
      affectedRecipes: impact.length,
      impactAnalysis: impact
    });
  });

  // ============ COMPANY SETTINGS ============
  app.get("/api/company-settings", async (req, res) => {
    const settings = await storage.getCompanySettings();
    res.json(settings || {});
  });

  app.patch("/api/company-settings", async (req, res) => {
    try {
      const data = insertCompanySettingsSchema.partial().parse(req.body);
      const settings = await storage.updateCompanySettings(data);
      res.json(settings);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============ SYSTEM PREFERENCES ============
  app.get("/api/system-preferences", async (req, res) => {
    const preferences = await storage.getSystemPreferences();
    res.json(preferences || {});
  });

  app.patch("/api/system-preferences", async (req, res) => {
    try {
      const data = insertSystemPreferencesSchema.partial().parse(req.body);
      const preferences = await storage.updateSystemPreferences(data);
      res.json(preferences);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

// ============ HELPER FUNCTIONS ============

async function calculateComponentCost(comp: any): Promise<number> {
  const units = await storage.getUnits();
  const products = await storage.getProducts();
  
  const unit = units.find((u) => u.id === comp.unitId);
  const microUnits = unit ? comp.qty * unit.toBaseRatio : comp.qty;

  if (comp.componentType === "product") {
    const product = products.find((p) => p.id === comp.componentId);
    if (product) {
      return microUnits * product.lastCost;
    }
  } else if (comp.componentType === "recipe") {
    const subRecipe = await storage.getRecipe(comp.componentId);
    if (subRecipe) {
      const subRecipeCost = await calculateRecipeCost(comp.componentId);
      const subRecipeYieldUnit = units.find(u => u.id === subRecipe.yieldUnitId);
      const subRecipeYieldMicroUnits = subRecipeYieldUnit ? subRecipe.yieldQty * subRecipeYieldUnit.toBaseRatio : subRecipe.yieldQty;
      const costPerMicroUnit = subRecipeYieldMicroUnits > 0 ? subRecipeCost / subRecipeYieldMicroUnits : 0;
      return microUnits * costPerMicroUnit;
    }
  }
  
  return 0;
}

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
      // Get sub-recipe's cost (already includes its waste)
      const subRecipe = await storage.getRecipe(comp.componentId);
      if (subRecipe) {
        const subRecipeCost = await calculateRecipeCost(comp.componentId);
        // Convert sub-recipe's yield to cost per unit, then scale by quantity needed
        const subRecipeYieldUnit = units.find(u => u.id === subRecipe.yieldUnitId);
        const subRecipeYieldMicroUnits = subRecipeYieldUnit ? subRecipe.yieldQty * subRecipeYieldUnit.toBaseRatio : subRecipe.yieldQty;
        const costPerMicroUnit = subRecipeYieldMicroUnits > 0 ? subRecipeCost / subRecipeYieldMicroUnits : 0;
        totalCost += microUnits * costPerMicroUnit;
      }
    }
  }

  const wasteMultiplier = 1 + recipe.wastePercent / 100;
  return totalCost * wasteMultiplier;
}

async function calculateProductImpactInRecipe(recipeId: string, targetProductId: string): Promise<{ usesProduct: boolean, microUnits: number, costContribution: number }> {
  const components = await storage.getRecipeComponents(recipeId);
  const units = await storage.getUnits();
  const products = await storage.getProducts();
  
  let totalMicroUnits = 0;
  let totalCostContribution = 0;

  for (const comp of components) {
    const unit = units.find((u) => u.id === comp.unitId);
    const microUnits = unit ? comp.qty * unit.toBaseRatio : comp.qty;

    if (comp.componentType === "product" && comp.componentId === targetProductId) {
      const product = products.find((p) => p.id === targetProductId);
      if (product) {
        totalMicroUnits += microUnits;
        totalCostContribution += microUnits * product.lastCost;
      }
    } else if (comp.componentType === "recipe") {
      const subRecipe = await storage.getRecipe(comp.componentId);
      if (subRecipe) {
        const subImpact = await calculateProductImpactInRecipe(comp.componentId, targetProductId);
        if (subImpact.usesProduct) {
          // Scale sub-recipe usage by yield ratio
          const subRecipeYieldUnit = units.find(u => u.id === subRecipe.yieldUnitId);
          const subRecipeYieldMicroUnits = subRecipeYieldUnit ? subRecipe.yieldQty * subRecipeYieldUnit.toBaseRatio : subRecipe.yieldQty;
          
          if (subRecipeYieldMicroUnits > 0) {
            // Scale the sub-recipe's product usage by (qty needed / yield)
            const scaleFactor = microUnits / subRecipeYieldMicroUnits;
            totalMicroUnits += subImpact.microUnits * scaleFactor;
            totalCostContribution += subImpact.costContribution * scaleFactor;
          }
        }
      }
    }
  }

  return {
    usesProduct: totalMicroUnits > 0,
    microUnits: totalMicroUnits,
    costContribution: totalCostContribution
  };
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

// ============ WEBSOCKET POS STREAMING ============
export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws/pos" });
  
  wss.on("connection", (ws: WebSocket) => {
    console.log("🔌 POS WebSocket client connected");
    
    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === "POS_SALE") {
          // Process POS sale in real-time
          const saleData = insertPOSSaleSchema.parse(message.data);
          const sale = await storage.createPOSSale(saleData);
          
          // Process sale lines if provided
          if (message.lines && Array.isArray(message.lines)) {
            for (const lineData of message.lines) {
              const parsedLine = insertPOSSalesLineSchema.parse({
                ...lineData,
                posSalesId: sale.id,
              });
              await storage.createPOSSalesLine(parsedLine);
            }
          }
          
          // Send confirmation back to client
          ws.send(JSON.stringify({
            type: "SALE_PROCESSED",
            saleId: sale.id,
            timestamp: new Date().toISOString(),
          }));
          
          // Broadcast to all connected clients (for dashboard updates)
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: "SALE_UPDATE",
                sale,
              }));
            }
          });
        }
      } catch (error: any) {
        console.error("WebSocket error:", error);
        ws.send(JSON.stringify({
          type: "ERROR",
          message: error.message,
        }));
      }
    });
    
    ws.on("close", () => {
      console.log("🔌 POS WebSocket client disconnected");
    });
    
    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });
  
  console.log("✅ WebSocket POS streaming enabled at /ws/pos");
  
  return wss;
}
