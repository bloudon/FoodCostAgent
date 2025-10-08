import { eq, and, gte, lte, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  users, type User, type InsertUser,
  authSessions, type AuthSession, type InsertAuthSession,
  storageLocations, type StorageLocation, type InsertStorageLocation,
  units, type Unit, type InsertUnit,
  unitConversions, type UnitConversion, type InsertUnitConversion,
  inventoryItems, type InventoryItem, type InsertInventoryItem,
  inventoryItemLocations, type InventoryItemLocation, type InsertInventoryItemLocation,
  inventoryItemPriceHistory, type InventoryItemPriceHistory, type InsertInventoryItemPriceHistory,
  vendors, type Vendor, type InsertVendor,
  vendorItems, type VendorItem, type InsertVendorItem,
  recipes, type Recipe, type InsertRecipe,
  recipeComponents, type RecipeComponent, type InsertRecipeComponent,
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

  // Inventory Items
  getInventoryItems(locationId?: string): Promise<InventoryItem[]>;
  getInventoryItem(id: string): Promise<InventoryItem | undefined>;
  createInventoryItem(item: InsertInventoryItem): Promise<InventoryItem>;
  updateInventoryItem(id: string, item: Partial<InventoryItem>): Promise<InventoryItem | undefined>;
  getInventoryItemsByName(name: string): Promise<InventoryItem[]>;
  getInventoryItemsAggregated(): Promise<Array<{
    name: string;
    category: string | null;
    totalOnHandQty: number;
    locations: Array<{
      locationId: string;
      locationName: string;
      onHandQty: number;
    }>;
  }>>;
  
  // Inventory Item Locations
  getInventoryItemLocations(inventoryItemId: string): Promise<InventoryItemLocation[]>;
  setInventoryItemLocations(inventoryItemId: string, locationIds: string[], primaryLocationId?: string): Promise<void>;

  // Vendors
  getVendors(): Promise<Vendor[]>;
  getVendor(id: string): Promise<Vendor | undefined>;
  createVendor(vendor: InsertVendor): Promise<Vendor>;
  updateVendor(id: string, vendor: Partial<Vendor>): Promise<Vendor | undefined>;
  deleteVendor(id: string): Promise<void>;

  // Vendor Items
  getVendorItems(vendorId?: string): Promise<VendorItem[]>;
  getVendorItem(id: string): Promise<VendorItem | undefined>;
  createVendorItem(vendorItem: InsertVendorItem): Promise<VendorItem>;

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
  getTransferLogs(inventoryItemId?: string, startDate?: Date, endDate?: Date): Promise<TransferLog[]>;
  createTransferLog(transfer: InsertTransferLog): Promise<TransferLog>;

  // Waste Logs
  getWasteLogs(inventoryItemId?: string, startDate?: Date, endDate?: Date): Promise<WasteLog[]>;
  createWasteLog(waste: InsertWasteLog): Promise<WasteLog>;

  // Company Settings
  getCompanySettings(): Promise<CompanySettings | undefined>;
  updateCompanySettings(settings: Partial<CompanySettings>): Promise<CompanySettings>;

  // System Preferences
  getSystemPreferences(): Promise<SystemPreferences | undefined>;
  updateSystemPreferences(preferences: Partial<SystemPreferences>): Promise<SystemPreferences>;

  // Inventory Item Price History
  getInventoryItemPriceHistory(inventoryItemId: string): Promise<InventoryItemPriceHistory[]>;
  createInventoryItemPriceHistory(history: InsertInventoryItemPriceHistory): Promise<InventoryItemPriceHistory>;

  // Inventory item search for count entry
  searchInventoryItems(term: string): Promise<InventoryItem[]>;

  // Inventory count aggregations
  getInventoryCountAggregations(countId: string): Promise<Array<{
    inventoryItemId: string;
    inventoryItemName: string;
    totalQty: number;
    totalValue: number;
    countLineIds: string[];
  }>>;

  getInventoryItemCountDetails(inventoryItemId: string, countId: string): Promise<Array<{
    countLineId: string;
    userId: string;
    userName: string;
    storageLocationId: string;
    locationName: string;
    qty: number;
    unitId: string;
    unitName: string;
    costPerCase: number;
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

  // Inventory Items
  async getInventoryItems(locationId?: string): Promise<InventoryItem[]> {
    if (locationId) {
      return db.select().from(inventoryItems).where(eq(inventoryItems.storageLocationId, locationId));
    }
    return db.select().from(inventoryItems);
  }

  async getInventoryItem(id: string): Promise<InventoryItem | undefined> {
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    return item || undefined;
  }

  async createInventoryItem(insertItem: InsertInventoryItem): Promise<InventoryItem> {
    const [item] = await db.insert(inventoryItems).values(insertItem).returning();
    return item;
  }

  async updateInventoryItem(id: string, updates: Partial<InventoryItem>): Promise<InventoryItem | undefined> {
    const [item] = await db
      .update(inventoryItems)
      .set(updates)
      .where(eq(inventoryItems.id, id))
      .returning();
    return item || undefined;
  }

  async getInventoryItemsByName(name: string): Promise<InventoryItem[]> {
    return db.select().from(inventoryItems).where(eq(inventoryItems.name, name));
  }

  async getInventoryItemsAggregated(): Promise<Array<{
    name: string;
    category: string | null;
    totalOnHandQty: number;
    locations: Array<{
      locationId: string;
      locationName: string;
      onHandQty: number;
    }>;
  }>> {
    const items = await db.select().from(inventoryItems);
    const locations = await db.select().from(storageLocations);
    
    const grouped = new Map<string, {
      name: string;
      category: string | null;
      totalOnHandQty: number;
      locations: Array<{
        locationId: string;
        locationName: string;
        onHandQty: number;
      }>;
    }>();

    for (const item of items) {
      const key = `${item.name}-${item.category || 'null'}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          name: item.name,
          category: item.category,
          totalOnHandQty: 0,
          locations: []
        });
      }

      const group = grouped.get(key)!;
      group.totalOnHandQty += item.onHandQty;
      
      const location = locations.find(l => l.id === item.storageLocationId);
      group.locations.push({
        locationId: item.storageLocationId,
        locationName: location?.name || 'Unknown',
        onHandQty: item.onHandQty
      });
    }

    return Array.from(grouped.values());
  }

  // Inventory Item Locations
  async getInventoryItemLocations(inventoryItemId: string): Promise<InventoryItemLocation[]> {
    return db
      .select()
      .from(inventoryItemLocations)
      .where(eq(inventoryItemLocations.inventoryItemId, inventoryItemId));
  }

  async setInventoryItemLocations(
    inventoryItemId: string,
    locationIds: string[],
    primaryLocationId?: string
  ): Promise<void> {
    // Delete existing locations
    await db
      .delete(inventoryItemLocations)
      .where(eq(inventoryItemLocations.inventoryItemId, inventoryItemId));
    
    // Insert new locations
    if (locationIds.length > 0) {
      const primary = primaryLocationId || locationIds[0];
      await db.insert(inventoryItemLocations).values(
        locationIds.map(locationId => ({
          inventoryItemId,
          storageLocationId: locationId,
          isPrimary: locationId === primary ? 1 : 0
        }))
      );
      
      // Update the primary location in the inventory item
      await db
        .update(inventoryItems)
        .set({ storageLocationId: primary })
        .where(eq(inventoryItems.id, inventoryItemId));
    }
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

  async updateVendor(id: string, updates: Partial<Vendor>): Promise<Vendor | undefined> {
    const [vendor] = await db
      .update(vendors)
      .set(updates)
      .where(eq(vendors.id, id))
      .returning();
    return vendor || undefined;
  }

  async deleteVendor(id: string): Promise<void> {
    await db.delete(vendors).where(eq(vendors.id, id));
  }

  // Vendor Items
  async getVendorItems(vendorId?: string): Promise<VendorItem[]> {
    if (vendorId) {
      return db.select().from(vendorItems).where(eq(vendorItems.vendorId, vendorId));
    }
    return db.select().from(vendorItems);
  }

  async getVendorItemsByInventoryItem(inventoryItemId: string): Promise<VendorItem[]> {
    return db.select().from(vendorItems).where(eq(vendorItems.inventoryItemId, inventoryItemId));
  }

  async getVendorItem(id: string): Promise<VendorItem | undefined> {
    const [vendorItem] = await db.select().from(vendorItems).where(eq(vendorItems.id, id));
    return vendorItem || undefined;
  }

  async createVendorItem(insertVI: InsertVendorItem): Promise<VendorItem> {
    const [vendorItem] = await db.insert(vendorItems).values(insertVI).returning();
    return vendorItem;
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
  async getTransferLogs(inventoryItemId?: string, startDate?: Date, endDate?: Date): Promise<TransferLog[]> {
    let query = db.select().from(transferLogs);
    const conditions = [];
    
    if (inventoryItemId) {
      conditions.push(eq(transferLogs.inventoryItemId, inventoryItemId));
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
  async getWasteLogs(inventoryItemId?: string, startDate?: Date, endDate?: Date): Promise<WasteLog[]> {
    let query = db.select().from(wasteLogs);
    const conditions = [];
    
    if (inventoryItemId) {
      conditions.push(eq(wasteLogs.inventoryItemId, inventoryItemId));
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

  // Inventory Item Price History
  async getInventoryItemPriceHistory(inventoryItemId: string): Promise<InventoryItemPriceHistory[]> {
    return db
      .select()
      .from(inventoryItemPriceHistory)
      .where(eq(inventoryItemPriceHistory.inventoryItemId, inventoryItemId))
      .orderBy(inventoryItemPriceHistory.effectiveAt);
  }

  async createInventoryItemPriceHistory(insertHistory: InsertInventoryItemPriceHistory): Promise<InventoryItemPriceHistory> {
    const [history] = await db.insert(inventoryItemPriceHistory).values(insertHistory).returning();
    return history;
  }

  // Inventory item search for count entry
  async searchInventoryItems(term: string): Promise<InventoryItem[]> {
    const searchTerm = `%${term.toLowerCase()}%`;
    return db
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.active, 1)
        )
      );
  }

  // Inventory count aggregations
  async getInventoryCountAggregations(countId: string): Promise<Array<{
    inventoryItemId: string;
    inventoryItemName: string;
    totalQty: number;
    totalValue: number;
    countLineIds: string[];
  }>> {
    return [];
  }

  async getInventoryItemCountDetails(inventoryItemId: string, countId: string): Promise<Array<{
    countLineId: string;
    userId: string;
    userName: string;
    storageLocationId: string;
    locationName: string;
    qty: number;
    unitId: string;
    unitName: string;
    costPerCase: number;
    totalValue: number;
    countedAt: Date;
  }>> {
    return [];
  }
}

export const storage = new DatabaseStorage();
