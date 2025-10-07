import { eq, and, gte, lte, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  users, type User, type InsertUser,
  authSessions, type AuthSession, type InsertAuthSession,
  storageLocations, type StorageLocation, type InsertStorageLocation,
  units, type Unit, type InsertUnit,
  unitConversions, type UnitConversion, type InsertUnitConversion,
  products, type Product, type InsertProduct,
  productPriceHistory, type ProductPriceHistory, type InsertProductPriceHistory,
  vendors, type Vendor, type InsertVendor,
  vendorProducts, type VendorProduct, type InsertVendorProduct,
  recipes, type Recipe, type InsertRecipe,
  recipeComponents, type RecipeComponent, type InsertRecipeComponent,
  inventoryLevels, type InventoryLevel, type InsertInventoryLevel,
  inventoryCounts, type InventoryCount, type InsertInventoryCount,
  inventoryCountLines, type InventoryCountLine, type InsertInventoryCountLine,
  purchaseOrders, type PurchaseOrder, type InsertPurchaseOrder,
  poLines, type POLine, type InsertPOLine,
  receipts, type Receipt, type InsertReceipt,
  receiptLines, type ReceiptLine, type InsertReceiptLine,
  posSales, type POSSale, type InsertPOSSale,
  posSalesLines, type POSSalesLine, type InsertPOSSalesLine,
  menuItems, type MenuItem, type InsertMenuItem,
  recipeVersions, type RecipeVersion, type InsertRecipeVersion,
  transferLogs, type TransferLog, type InsertTransferLog,
  wasteLogs, type WasteLog, type InsertWasteLog,
  companySettings, type CompanySettings, type InsertCompanySettings,
  systemPreferences, type SystemPreferences, type InsertSystemPreferences,
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Auth Sessions
  createAuthSession(session: InsertAuthSession): Promise<AuthSession>;
  getAuthSessionByToken(tokenHash: string): Promise<AuthSession | undefined>;
  revokeAuthSession(id: string): Promise<void>;
  cleanExpiredSessions(): Promise<void>;

  // Storage Locations
  getStorageLocations(): Promise<StorageLocation[]>;
  getStorageLocation(id: string): Promise<StorageLocation | undefined>;
  createStorageLocation(location: InsertStorageLocation): Promise<StorageLocation>;
  updateStorageLocation(id: string, location: Partial<StorageLocation>): Promise<StorageLocation | undefined>;
  deleteStorageLocation(id: string): Promise<void>;

  // Units
  getUnits(): Promise<Unit[]>;
  getUnit(id: string): Promise<Unit | undefined>;
  createUnit(unit: InsertUnit): Promise<Unit>;

  // Unit Conversions
  getUnitConversions(): Promise<UnitConversion[]>;
  getUnitConversion(id: string): Promise<UnitConversion | undefined>;
  createUnitConversion(conversion: InsertUnitConversion): Promise<UnitConversion>;
  updateUnitConversion(id: string, conversion: Partial<UnitConversion>): Promise<UnitConversion | undefined>;
  deleteUnitConversion(id: string): Promise<void>;

  // Products
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: string, product: Partial<Product>): Promise<Product | undefined>;

  // Vendors
  getVendors(): Promise<Vendor[]>;
  getVendor(id: string): Promise<Vendor | undefined>;
  createVendor(vendor: InsertVendor): Promise<Vendor>;

  // Vendor Products
  getVendorProducts(vendorId?: string): Promise<VendorProduct[]>;
  getVendorProduct(id: string): Promise<VendorProduct | undefined>;
  createVendorProduct(vendorProduct: InsertVendorProduct): Promise<VendorProduct>;

  // Recipes
  getRecipes(): Promise<Recipe[]>;
  getRecipe(id: string): Promise<Recipe | undefined>;
  createRecipe(recipe: InsertRecipe): Promise<Recipe>;
  updateRecipe(id: string, recipe: Partial<Recipe>): Promise<Recipe | undefined>;

  // Recipe Components
  getRecipeComponents(recipeId: string): Promise<RecipeComponent[]>;
  getRecipeComponent(id: string): Promise<RecipeComponent | undefined>;
  createRecipeComponent(component: InsertRecipeComponent): Promise<RecipeComponent>;
  updateRecipeComponent(id: string, component: Partial<RecipeComponent>): Promise<RecipeComponent | undefined>;
  deleteRecipeComponent(id: string): Promise<void>;

  // Inventory Levels
  getInventoryLevels(locationId?: string): Promise<InventoryLevel[]>;
  getInventoryLevel(productId: string, locationId: string): Promise<InventoryLevel | undefined>;
  updateInventoryLevel(productId: string, locationId: string, microUnits: number): Promise<InventoryLevel>;

  // Inventory Counts
  getInventoryCounts(): Promise<InventoryCount[]>;
  getInventoryCount(id: string): Promise<InventoryCount | undefined>;
  createInventoryCount(count: InsertInventoryCount): Promise<InventoryCount>;

  // Inventory Count Lines
  getInventoryCountLines(countId: string): Promise<InventoryCountLine[]>;
  getInventoryCountLine(id: string): Promise<InventoryCountLine | undefined>;
  createInventoryCountLine(line: InsertInventoryCountLine): Promise<InventoryCountLine>;
  updateInventoryCountLine(id: string, line: Partial<InventoryCountLine>): Promise<InventoryCountLine | undefined>;
  deleteInventoryCountLine(id: string): Promise<void>;

  // Purchase Orders
  getPurchaseOrders(): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined>;
  createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: string, po: Partial<PurchaseOrder>): Promise<PurchaseOrder | undefined>;

  // PO Lines
  getPOLines(poId: string): Promise<POLine[]>;
  createPOLine(line: InsertPOLine): Promise<POLine>;

  // Receipts
  getReceipts(): Promise<Receipt[]>;
  getReceipt(id: string): Promise<Receipt | undefined>;
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;

  // Receipt Lines
  getReceiptLines(receiptId: string): Promise<ReceiptLine[]>;
  createReceiptLine(line: InsertReceiptLine): Promise<ReceiptLine>;

  // POS Sales
  getPOSSales(startDate?: Date, endDate?: Date): Promise<POSSale[]>;
  createPOSSale(sale: InsertPOSSale): Promise<POSSale>;

  // POS Sales Lines
  getPOSSalesLines(saleId: string): Promise<POSSalesLine[]>;
  createPOSSalesLine(line: InsertPOSSalesLine): Promise<POSSalesLine>;

  // Menu Items
  getMenuItems(): Promise<MenuItem[]>;
  getMenuItem(id: string): Promise<MenuItem | undefined>;
  getMenuItemByPLU(pluSku: string): Promise<MenuItem | undefined>;
  createMenuItem(item: InsertMenuItem): Promise<MenuItem>;

  // Recipe Versions
  getRecipeVersions(recipeId: string): Promise<RecipeVersion[]>;
  getRecipeVersion(id: string): Promise<RecipeVersion | undefined>;
  createRecipeVersion(version: InsertRecipeVersion): Promise<RecipeVersion>;

  // Transfer Logs
  getTransferLogs(productId?: string, startDate?: Date, endDate?: Date): Promise<TransferLog[]>;
  createTransferLog(transfer: InsertTransferLog): Promise<TransferLog>;

  // Waste Logs
  getWasteLogs(productId?: string, startDate?: Date, endDate?: Date): Promise<WasteLog[]>;
  createWasteLog(waste: InsertWasteLog): Promise<WasteLog>;

  // Company Settings
  getCompanySettings(): Promise<CompanySettings | undefined>;
  updateCompanySettings(settings: Partial<CompanySettings>): Promise<CompanySettings>;

  // System Preferences
  getSystemPreferences(): Promise<SystemPreferences | undefined>;
  updateSystemPreferences(preferences: Partial<SystemPreferences>): Promise<SystemPreferences>;

  // Product Price History
  getProductPriceHistory(productId: string): Promise<ProductPriceHistory[]>;
  createProductPriceHistory(history: InsertProductPriceHistory): Promise<ProductPriceHistory>;

  // Product search for count entry
  searchProducts(term: string): Promise<Product[]>;

  // Inventory count aggregations
  getInventoryCountAggregations(countId: string): Promise<Array<{
    productId: string;
    productName: string;
    totalMicroUnits: number;
    totalValue: number;
    countLineIds: string[];
  }>>;

  getProductCountDetails(productId: string, countId: string): Promise<Array<{
    countLineId: string;
    userId: string;
    userName: string;
    storageLocationId: string;
    locationName: string;
    qty: number;
    unitId: string;
    unitName: string;
    microUnits: number;
    costPerMicroUnit: number;
    totalValue: number;
    countedAt: Date;
  }>>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Auth Sessions
  async createAuthSession(insertSession: InsertAuthSession): Promise<AuthSession> {
    const [session] = await db.insert(authSessions).values(insertSession).returning();
    return session;
  }

  async getAuthSessionByToken(tokenHash: string): Promise<AuthSession | undefined> {
    const [session] = await db
      .select()
      .from(authSessions)
      .where(and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gte(authSessions.expiresAt, new Date())
      ));
    return session || undefined;
  }

  async revokeAuthSession(id: string): Promise<void> {
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, id));
  }

  async cleanExpiredSessions(): Promise<void> {
    await db
      .delete(authSessions)
      .where(lte(authSessions.expiresAt, new Date()));
  }

  // Storage Locations
  async getStorageLocations(): Promise<StorageLocation[]> {
    return db.select().from(storageLocations).orderBy(storageLocations.sortOrder);
  }

  async getStorageLocation(id: string): Promise<StorageLocation | undefined> {
    const [location] = await db.select().from(storageLocations).where(eq(storageLocations.id, id));
    return location || undefined;
  }

  async createStorageLocation(insertLocation: InsertStorageLocation): Promise<StorageLocation> {
    const [location] = await db.insert(storageLocations).values(insertLocation).returning();
    return location;
  }

  async updateStorageLocation(id: string, updates: Partial<StorageLocation>): Promise<StorageLocation | undefined> {
    const [location] = await db
      .update(storageLocations)
      .set(updates)
      .where(eq(storageLocations.id, id))
      .returning();
    return location || undefined;
  }

  async deleteStorageLocation(id: string): Promise<void> {
    await db.delete(storageLocations).where(eq(storageLocations.id, id));
  }

  // Units
  async getUnits(): Promise<Unit[]> {
    return db.select().from(units);
  }

  async getUnit(id: string): Promise<Unit | undefined> {
    const [unit] = await db.select().from(units).where(eq(units.id, id));
    return unit || undefined;
  }

  async createUnit(insertUnit: InsertUnit): Promise<Unit> {
    const [unit] = await db.insert(units).values(insertUnit).returning();
    return unit;
  }

  // Unit Conversions
  async getUnitConversions(): Promise<UnitConversion[]> {
    return db.select().from(unitConversions);
  }

  async getUnitConversion(id: string): Promise<UnitConversion | undefined> {
    const [conversion] = await db.select().from(unitConversions).where(eq(unitConversions.id, id));
    return conversion || undefined;
  }

  async createUnitConversion(insertConversion: InsertUnitConversion): Promise<UnitConversion> {
    const [conversion] = await db.insert(unitConversions).values(insertConversion).returning();
    return conversion;
  }

  async updateUnitConversion(id: string, updates: Partial<UnitConversion>): Promise<UnitConversion | undefined> {
    const [conversion] = await db
      .update(unitConversions)
      .set(updates)
      .where(eq(unitConversions.id, id))
      .returning();
    return conversion || undefined;
  }

  async deleteUnitConversion(id: string): Promise<void> {
    await db.delete(unitConversions).where(eq(unitConversions.id, id));
  }

  // Products
  async getProducts(): Promise<Product[]> {
    return db.select().from(products);
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product || undefined;
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(insertProduct).returning();
    return product;
  }

  async updateProduct(id: string, updates: Partial<Product>): Promise<Product | undefined> {
    const [product] = await db
      .update(products)
      .set(updates)
      .where(eq(products.id, id))
      .returning();
    return product || undefined;
  }

  // Vendors
  async getVendors(): Promise<Vendor[]> {
    return db.select().from(vendors);
  }

  async getVendor(id: string): Promise<Vendor | undefined> {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, id));
    return vendor || undefined;
  }

  async createVendor(insertVendor: InsertVendor): Promise<Vendor> {
    const [vendor] = await db.insert(vendors).values(insertVendor).returning();
    return vendor;
  }

  // Vendor Products
  async getVendorProducts(vendorId?: string): Promise<VendorProduct[]> {
    if (vendorId) {
      return db.select().from(vendorProducts).where(eq(vendorProducts.vendorId, vendorId));
    }
    return db.select().from(vendorProducts);
  }

  async getVendorProductsByProduct(productId: string): Promise<VendorProduct[]> {
    return db.select().from(vendorProducts).where(eq(vendorProducts.productId, productId));
  }

  async getVendorProduct(id: string): Promise<VendorProduct | undefined> {
    const [vendorProduct] = await db.select().from(vendorProducts).where(eq(vendorProducts.id, id));
    return vendorProduct || undefined;
  }

  async createVendorProduct(insertVP: InsertVendorProduct): Promise<VendorProduct> {
    const [vendorProduct] = await db.insert(vendorProducts).values(insertVP).returning();
    return vendorProduct;
  }

  // Recipes
  async getRecipes(): Promise<Recipe[]> {
    return db.select().from(recipes);
  }

  async getRecipe(id: string): Promise<Recipe | undefined> {
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    return recipe || undefined;
  }

  async createRecipe(insertRecipe: InsertRecipe): Promise<Recipe> {
    const [recipe] = await db.insert(recipes).values(insertRecipe).returning();
    return recipe;
  }

  async updateRecipe(id: string, updates: Partial<Recipe>): Promise<Recipe | undefined> {
    const [recipe] = await db
      .update(recipes)
      .set(updates)
      .where(eq(recipes.id, id))
      .returning();
    return recipe || undefined;
  }

  // Recipe Components
  async getRecipeComponents(recipeId: string): Promise<RecipeComponent[]> {
    return db.select().from(recipeComponents).where(eq(recipeComponents.recipeId, recipeId));
  }

  async getRecipeComponent(id: string): Promise<RecipeComponent | undefined> {
    const [component] = await db.select().from(recipeComponents).where(eq(recipeComponents.id, id));
    return component || undefined;
  }

  async createRecipeComponent(insertComponent: InsertRecipeComponent): Promise<RecipeComponent> {
    const [component] = await db.insert(recipeComponents).values(insertComponent).returning();
    return component;
  }

  async updateRecipeComponent(id: string, updates: Partial<RecipeComponent>): Promise<RecipeComponent | undefined> {
    const [component] = await db
      .update(recipeComponents)
      .set(updates)
      .where(eq(recipeComponents.id, id))
      .returning();
    return component || undefined;
  }

  async deleteRecipeComponent(id: string): Promise<void> {
    await db.delete(recipeComponents).where(eq(recipeComponents.id, id));
  }

  // Inventory Levels
  async getInventoryLevels(locationId?: string): Promise<InventoryLevel[]> {
    if (locationId) {
      return db.select().from(inventoryLevels).where(eq(inventoryLevels.storageLocationId, locationId));
    }
    return db.select().from(inventoryLevels);
  }

  async getInventoryLevel(productId: string, locationId: string): Promise<InventoryLevel | undefined> {
    const [level] = await db
      .select()
      .from(inventoryLevels)
      .where(
        and(
          eq(inventoryLevels.productId, productId),
          eq(inventoryLevels.storageLocationId, locationId)
        )
      );
    return level || undefined;
  }

  async updateInventoryLevel(productId: string, locationId: string, microUnits: number): Promise<InventoryLevel> {
    const existing = await this.getInventoryLevel(productId, locationId);
    if (existing) {
      const [updated] = await db
        .update(inventoryLevels)
        .set({ 
          onHandMicroUnits: microUnits,
          updatedAt: new Date()
        })
        .where(eq(inventoryLevels.id, existing.id))
        .returning();
      return updated;
    } else {
      const [level] = await db
        .insert(inventoryLevels)
        .values({
          productId,
          storageLocationId: locationId,
          onHandMicroUnits: microUnits,
        })
        .returning();
      return level;
    }
  }

  // Inventory Counts
  async getInventoryCounts(): Promise<InventoryCount[]> {
    return db.select().from(inventoryCounts);
  }

  async getInventoryCount(id: string): Promise<InventoryCount | undefined> {
    const [count] = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, id));
    return count || undefined;
  }

  async createInventoryCount(insertCount: InsertInventoryCount): Promise<InventoryCount> {
    const [count] = await db.insert(inventoryCounts).values(insertCount).returning();
    return count;
  }

  // Inventory Count Lines
  async getInventoryCountLines(countId: string): Promise<InventoryCountLine[]> {
    return db.select().from(inventoryCountLines).where(eq(inventoryCountLines.inventoryCountId, countId));
  }

  async getInventoryCountLine(id: string): Promise<InventoryCountLine | undefined> {
    const [line] = await db.select().from(inventoryCountLines).where(eq(inventoryCountLines.id, id));
    return line || undefined;
  }

  async createInventoryCountLine(insertLine: InsertInventoryCountLine): Promise<InventoryCountLine> {
    const [line] = await db.insert(inventoryCountLines).values(insertLine).returning();
    return line;
  }

  async updateInventoryCountLine(id: string, updates: Partial<InventoryCountLine>): Promise<InventoryCountLine | undefined> {
    const [line] = await db
      .update(inventoryCountLines)
      .set(updates)
      .where(eq(inventoryCountLines.id, id))
      .returning();
    return line || undefined;
  }

  async deleteInventoryCountLine(id: string): Promise<void> {
    await db.delete(inventoryCountLines).where(eq(inventoryCountLines.id, id));
  }

  // Purchase Orders
  async getPurchaseOrders(): Promise<PurchaseOrder[]> {
    return db.select().from(purchaseOrders);
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    return po || undefined;
  }

  async createPurchaseOrder(insertPO: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const [po] = await db.insert(purchaseOrders).values(insertPO).returning();
    return po;
  }

  async updatePurchaseOrder(id: string, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder | undefined> {
    const [po] = await db
      .update(purchaseOrders)
      .set(updates)
      .where(eq(purchaseOrders.id, id))
      .returning();
    return po || undefined;
  }

  // PO Lines
  async getPOLines(poId: string): Promise<POLine[]> {
    return db.select().from(poLines).where(eq(poLines.purchaseOrderId, poId));
  }

  async createPOLine(insertLine: InsertPOLine): Promise<POLine> {
    const [line] = await db.insert(poLines).values(insertLine).returning();
    return line;
  }

  // Receipts
  async getReceipts(): Promise<Receipt[]> {
    return db.select().from(receipts);
  }

  async getReceipt(id: string): Promise<Receipt | undefined> {
    const [receipt] = await db.select().from(receipts).where(eq(receipts.id, id));
    return receipt || undefined;
  }

  async createReceipt(insertReceipt: InsertReceipt): Promise<Receipt> {
    const [receipt] = await db.insert(receipts).values(insertReceipt).returning();
    return receipt;
  }

  // Receipt Lines
  async getReceiptLines(receiptId: string): Promise<ReceiptLine[]> {
    return db.select().from(receiptLines).where(eq(receiptLines.receiptId, receiptId));
  }

  async createReceiptLine(insertLine: InsertReceiptLine): Promise<ReceiptLine> {
    const [line] = await db.insert(receiptLines).values(insertLine).returning();
    return line;
  }

  // POS Sales
  async getPOSSales(startDate?: Date, endDate?: Date): Promise<POSSale[]> {
    if (startDate && endDate) {
      return db
        .select()
        .from(posSales)
        .where(and(gte(posSales.occurredAt, startDate), lte(posSales.occurredAt, endDate)));
    } else if (startDate) {
      return db.select().from(posSales).where(gte(posSales.occurredAt, startDate));
    } else if (endDate) {
      return db.select().from(posSales).where(lte(posSales.occurredAt, endDate));
    }
    return db.select().from(posSales);
  }

  async createPOSSale(insertSale: InsertPOSSale): Promise<POSSale> {
    const [sale] = await db.insert(posSales).values(insertSale).returning();
    return sale;
  }

  // POS Sales Lines
  async getPOSSalesLines(saleId: string): Promise<POSSalesLine[]> {
    return db.select().from(posSalesLines).where(eq(posSalesLines.posSalesId, saleId));
  }

  async createPOSSalesLine(insertLine: InsertPOSSalesLine): Promise<POSSalesLine> {
    const [line] = await db.insert(posSalesLines).values(insertLine).returning();
    return line;
  }

  // Menu Items
  async getMenuItems(): Promise<MenuItem[]> {
    return db.select().from(menuItems);
  }

  async getMenuItem(id: string): Promise<MenuItem | undefined> {
    const [item] = await db.select().from(menuItems).where(eq(menuItems.id, id));
    return item || undefined;
  }

  async getMenuItemByPLU(pluSku: string): Promise<MenuItem | undefined> {
    const [item] = await db.select().from(menuItems).where(eq(menuItems.pluSku, pluSku));
    return item || undefined;
  }

  async createMenuItem(insertItem: InsertMenuItem): Promise<MenuItem> {
    const [item] = await db.insert(menuItems).values(insertItem).returning();
    return item;
  }

  // Recipe Versions
  async getRecipeVersions(recipeId: string): Promise<RecipeVersion[]> {
    return db.select().from(recipeVersions).where(eq(recipeVersions.recipeId, recipeId)).orderBy(recipeVersions.versionNumber);
  }

  async getRecipeVersion(id: string): Promise<RecipeVersion | undefined> {
    const [version] = await db.select().from(recipeVersions).where(eq(recipeVersions.id, id));
    return version || undefined;
  }

  async createRecipeVersion(insertVersion: InsertRecipeVersion): Promise<RecipeVersion> {
    const [version] = await db.insert(recipeVersions).values(insertVersion).returning();
    return version;
  }

  // Transfer Logs
  async getTransferLogs(productId?: string, startDate?: Date, endDate?: Date): Promise<TransferLog[]> {
    let query = db.select().from(transferLogs);
    const conditions = [];
    
    if (productId) {
      conditions.push(eq(transferLogs.productId, productId));
    }
    if (startDate) {
      conditions.push(gte(transferLogs.transferredAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(transferLogs.transferredAt, endDate));
    }
    
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async createTransferLog(insertTransfer: InsertTransferLog): Promise<TransferLog> {
    const [transfer] = await db.insert(transferLogs).values(insertTransfer).returning();
    return transfer;
  }

  // Waste Logs
  async getWasteLogs(productId?: string, startDate?: Date, endDate?: Date): Promise<WasteLog[]> {
    let query = db.select().from(wasteLogs);
    const conditions = [];
    
    if (productId) {
      conditions.push(eq(wasteLogs.productId, productId));
    }
    if (startDate) {
      conditions.push(gte(wasteLogs.wastedAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(wasteLogs.wastedAt, endDate));
    }
    
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async createWasteLog(insertWaste: InsertWasteLog): Promise<WasteLog> {
    const [waste] = await db.insert(wasteLogs).values(insertWaste).returning();
    return waste;
  }

  // Company Settings
  async getCompanySettings(): Promise<CompanySettings | undefined> {
    const [settings] = await db.select().from(companySettings).limit(1);
    return settings || undefined;
  }

  async updateCompanySettings(updates: Partial<CompanySettings>): Promise<CompanySettings> {
    const existing = await this.getCompanySettings();
    
    if (existing) {
      const [updated] = await db
        .update(companySettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(companySettings.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(companySettings)
        .values(updates as InsertCompanySettings)
        .returning();
      return created;
    }
  }

  // System Preferences
  async getSystemPreferences(): Promise<SystemPreferences | undefined> {
    const [prefs] = await db.select().from(systemPreferences).limit(1);
    return prefs || undefined;
  }

  async updateSystemPreferences(updates: Partial<SystemPreferences>): Promise<SystemPreferences> {
    const existing = await this.getSystemPreferences();
    
    if (existing) {
      const [updated] = await db
        .update(systemPreferences)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(systemPreferences.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(systemPreferences)
        .values(updates as InsertSystemPreferences)
        .returning();
      return created;
    }
  }

  // Product Price History
  async getProductPriceHistory(productId: string): Promise<ProductPriceHistory[]> {
    return db
      .select()
      .from(productPriceHistory)
      .where(eq(productPriceHistory.productId, productId))
      .orderBy(productPriceHistory.effectiveAt);
  }

  async createProductPriceHistory(insertHistory: InsertProductPriceHistory): Promise<ProductPriceHistory> {
    const [history] = await db.insert(productPriceHistory).values(insertHistory).returning();
    return history;
  }

  // Product search for count entry
  async searchProducts(term: string): Promise<Product[]> {
    const searchTerm = `%${term.toLowerCase()}%`;
    return db
      .select()
      .from(products)
      .where(
        and(
          eq(products.active, 1)
        )
      );
  }

  // Inventory count aggregations
  async getInventoryCountAggregations(countId: string): Promise<Array<{
    productId: string;
    productName: string;
    totalMicroUnits: number;
    totalValue: number;
    countLineIds: string[];
  }>> {
    return [];
  }

  async getProductCountDetails(productId: string, countId: string): Promise<Array<{
    countLineId: string;
    userId: string;
    userName: string;
    storageLocationId: string;
    locationName: string;
    qty: number;
    unitId: string;
    unitName: string;
    microUnits: number;
    costPerMicroUnit: number;
    totalValue: number;
    countedAt: Date;
  }>> {
    return [];
  }
}

export const storage = new DatabaseStorage();
