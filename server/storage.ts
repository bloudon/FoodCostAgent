import { eq, and, or, gte, lte, isNull, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  users, type User, type InsertUser,
  authSessions, type AuthSession, type InsertAuthSession,
  companies, type Company, type InsertCompany,
  companyStores, type CompanyStore, type InsertCompanyStore,
  storageLocations, type StorageLocation, type InsertStorageLocation,
  categories, type Category, type InsertCategory,
  units, type Unit, type InsertUnit,
  unitConversions, type UnitConversion, type InsertUnitConversion,
  inventoryItems, type InventoryItem, type InsertInventoryItem,
  inventoryItemLocations, type InventoryItemLocation, type InsertInventoryItemLocation,
  inventoryItemPriceHistory, type InventoryItemPriceHistory, type InsertInventoryItemPriceHistory,
  storeInventoryItems, type StoreInventoryItem, type InsertStoreInventoryItem,
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
  transferOrders, type TransferOrder, type InsertTransferOrder,
  transferOrderLines, type TransferOrderLine, type InsertTransferOrderLine,
  wasteLogs, type WasteLog, type InsertWasteLog,
  companySettings, type CompanySettings, type InsertCompanySettings,
  systemPreferences, type SystemPreferences, type InsertSystemPreferences,
  vendorCredentials, type VendorCredentials, type InsertVendorCredentials,
  ediMessages, type EdiMessage, type InsertEdiMessage,
  orderGuides, type OrderGuide, type InsertOrderGuide,
  orderGuideLines, type OrderGuideLine, type InsertOrderGuideLine,
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Auth Sessions
  createAuthSession(session: InsertAuthSession): Promise<AuthSession>;
  getAuthSessionByToken(tokenHash: string): Promise<AuthSession | undefined>;
  updateAuthSession(id: string, updates: Partial<AuthSession>): Promise<AuthSession | undefined>;
  revokeAuthSession(id: string): Promise<void>;
  cleanExpiredSessions(): Promise<void>;

  // Storage Locations
  getStorageLocations(): Promise<StorageLocation[]>;
  getStorageLocation(id: string): Promise<StorageLocation | undefined>;
  createStorageLocation(location: InsertStorageLocation): Promise<StorageLocation>;
  updateStorageLocation(id: string, location: Partial<StorageLocation>): Promise<StorageLocation | undefined>;
  deleteStorageLocation(id: string): Promise<void>;

  // Categories
  getCategories(): Promise<Category[]>;
  getCategory(id: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: string, category: Partial<Category>): Promise<Category | undefined>;
  deleteCategory(id: string): Promise<void>;

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
  getInventoryItems(locationId?: string, storeId?: string, companyId?: string): Promise<InventoryItem[]>;
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
  getInventoryItemLocationsBatch(inventoryItemIds: string[]): Promise<Map<string, InventoryItemLocation[]>>;
  setInventoryItemLocations(inventoryItemId: string, locationIds: string[], primaryLocationId?: string): Promise<void>;

  // Store Inventory Items
  getStoreInventoryItem(storeId: string, inventoryItemId: string): Promise<StoreInventoryItem | undefined>;
  updateStoreInventoryItemActive(storeId: string, inventoryItemId: string, active: number): Promise<void>;

  // Vendors
  getVendors(companyId?: string): Promise<Vendor[]>;
  getVendor(id: string, companyId?: string): Promise<Vendor | undefined>;
  createVendor(vendor: InsertVendor): Promise<Vendor>;
  updateVendor(id: string, vendor: Partial<Vendor>): Promise<Vendor | undefined>;
  deleteVendor(id: string): Promise<void>;

  // Vendor Items
  getVendorItems(vendorId?: string): Promise<VendorItem[]>;
  getVendorItem(id: string): Promise<VendorItem | undefined>;
  createVendorItem(vendorItem: InsertVendorItem): Promise<VendorItem>;
  updateVendorItem(id: string, vendorItem: Partial<InsertVendorItem>): Promise<VendorItem | undefined>;
  deleteVendorItem(id: string): Promise<void>;

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
  getInventoryCounts(companyId?: string, storeId?: string, storageLocationId?: string): Promise<InventoryCount[]>;
  getInventoryCount(id: string): Promise<InventoryCount | undefined>;
  createInventoryCount(count: InsertInventoryCount): Promise<InventoryCount>;
  deleteInventoryCount(id: string): Promise<void>;

  // Inventory Count Lines
  getInventoryCountLines(countId: string): Promise<InventoryCountLine[]>;
  getInventoryCountLine(id: string): Promise<InventoryCountLine | undefined>;
  createInventoryCountLine(line: InsertInventoryCountLine): Promise<InventoryCountLine>;
  updateInventoryCountLine(id: string, line: Partial<InventoryCountLine>): Promise<InventoryCountLine | undefined>;
  deleteInventoryCountLine(id: string): Promise<void>;

  // Purchase Orders
  getPurchaseOrders(companyId: string, storeId?: string): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: string, companyId: string): Promise<PurchaseOrder | undefined>;
  createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: string, po: Partial<PurchaseOrder>): Promise<PurchaseOrder | undefined>;
  deletePurchaseOrder(id: string): Promise<void>;

  // PO Lines
  getPOLines(poId: string): Promise<POLine[]>;
  createPOLine(line: InsertPOLine): Promise<POLine>;
  deletePOLine(id: string): Promise<void>;

  // Receipts
  getReceipts(companyId: string, storeId?: string): Promise<Receipt[]>;
  getReceipt(id: string): Promise<Receipt | undefined>;
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;
  updateReceipt(id: string, data: Partial<InsertReceipt>): Promise<void>;

  // Receipt Lines
  getReceiptLines(receiptId: string): Promise<ReceiptLine[]>;
  getReceiptLinesByReceiptId(receiptId: string): Promise<ReceiptLine[]>;
  createReceiptLine(line: InsertReceiptLine): Promise<ReceiptLine>;
  updateReceiptLine(id: string, data: Partial<InsertReceiptLine>): Promise<void>;

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
  getTransferLogs(companyId: string, inventoryItemId?: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<TransferLog[]>;
  createTransferLog(transfer: InsertTransferLog): Promise<TransferLog>;

  // Transfer Orders
  getTransferOrders(companyId: string, storeId?: string): Promise<TransferOrder[]>;
  getTransferOrder(id: string): Promise<TransferOrder | undefined>;
  createTransferOrder(order: InsertTransferOrder): Promise<TransferOrder>;
  updateTransferOrder(id: string, order: Partial<TransferOrder>): Promise<TransferOrder | undefined>;
  deleteTransferOrder(id: string): Promise<void>;

  // Transfer Order Lines
  getTransferOrderLines(transferOrderId: string): Promise<TransferOrderLine[]>;
  createTransferOrderLine(line: InsertTransferOrderLine): Promise<TransferOrderLine>;
  updateTransferOrderLine(id: string, line: Partial<TransferOrderLine>): Promise<TransferOrderLine | undefined>;
  deleteTransferOrderLine(id: string): Promise<void>;

  // Waste Logs
  getWasteLogs(companyId: string, inventoryItemId?: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<WasteLog[]>;
  createWasteLog(waste: InsertWasteLog): Promise<WasteLog>;

  // Companies
  getCompanies(): Promise<Company[]>;
  getCompany(id: string): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, company: Partial<Company>): Promise<Company | undefined>;

  // Company Stores
  getCompanyStores(companyId: string): Promise<CompanyStore[]>;
  getCompanyStore(id: string): Promise<CompanyStore | undefined>;
  createCompanyStore(store: InsertCompanyStore): Promise<CompanyStore>;
  updateCompanyStore(id: string, store: Partial<CompanyStore>): Promise<CompanyStore | undefined>;
  deleteCompanyStore(id: string): Promise<void>;

  // Company Settings
  getCompanySettings(): Promise<CompanySettings | undefined>;
  updateCompanySettings(settings: Partial<CompanySettings>): Promise<CompanySettings>;

  // System Preferences
  getSystemPreferences(): Promise<SystemPreferences | undefined>;
  updateSystemPreferences(preferences: Partial<SystemPreferences>): Promise<SystemPreferences>;

  // Vendor Credentials
  getVendorCredentials(): Promise<VendorCredentials[]>;
  getVendorCredentialsByKey(vendorKey: string): Promise<VendorCredentials | undefined>;
  createVendorCredentials(credentials: InsertVendorCredentials): Promise<VendorCredentials>;
  updateVendorCredentials(id: string, credentials: Partial<VendorCredentials>): Promise<VendorCredentials | undefined>;
  deleteVendorCredentials(id: string): Promise<void>;

  // EDI Messages
  getEdiMessages(vendorKey?: string, limit?: number): Promise<EdiMessage[]>;
  getEdiMessage(id: string): Promise<EdiMessage | undefined>;
  createEdiMessage(message: InsertEdiMessage): Promise<EdiMessage>;
  updateEdiMessage(id: string, updates: Partial<EdiMessage>): Promise<EdiMessage | undefined>;

  // Order Guides
  getOrderGuides(vendorKey?: string, limit?: number): Promise<OrderGuide[]>;
  getOrderGuide(id: string): Promise<OrderGuide | undefined>;
  createOrderGuide(guide: InsertOrderGuide): Promise<OrderGuide>;

  // Order Guide Lines
  getOrderGuideLines(orderGuideId: string): Promise<OrderGuideLine[]>;
  createOrderGuideLine(line: InsertOrderGuideLine): Promise<OrderGuideLine>;
  createOrderGuideLinesBatch(lines: InsertOrderGuideLine[]): Promise<OrderGuideLine[]>;

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
    pricePerUnit: number;
    caseSize: number;
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

  async updateAuthSession(id: string, updates: Partial<AuthSession>): Promise<AuthSession | undefined> {
    const [session] = await db
      .update(authSessions)
      .set(updates)
      .where(eq(authSessions.id, id))
      .returning();
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

  // Categories
  async getCategories(): Promise<Category[]> {
    return db.select().from(categories).orderBy(categories.sortOrder);
  }

  async getCategory(id: string): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.id, id));
    return category || undefined;
  }

  async createCategory(insertCategory: InsertCategory): Promise<Category> {
    const [category] = await db.insert(categories).values(insertCategory).returning();
    return category;
  }

  async updateCategory(id: string, updates: Partial<Category>): Promise<Category | undefined> {
    const [category] = await db
      .update(categories)
      .set(updates)
      .where(eq(categories.id, id))
      .returning();
    return category || undefined;
  }

  async deleteCategory(id: string): Promise<void> {
    await db.delete(categories).where(eq(categories.id, id));
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
  async getInventoryItems(locationId?: string, storeId?: string, companyId?: string): Promise<InventoryItem[]> {
    // Build base query with company filtering
    let query = db.select({ inventoryItem: inventoryItems }).from(inventoryItems);
    const conditions = [];
    
    // Always filter by company if provided (multi-tenant safety)
    if (companyId) {
      conditions.push(eq(inventoryItems.companyId, companyId));
    }
    
    // Filter by store: show only items that have a store_inventory_items record for this store
    if (storeId) {
      query = query.innerJoin(storeInventoryItems, eq(storeInventoryItems.inventoryItemId, inventoryItems.id));
      conditions.push(eq(storeInventoryItems.storeId, storeId));
    }
    
    // Legacy: filter by storage location (DEPRECATED)
    if (locationId) {
      query = query.innerJoin(inventoryItemLocations, eq(inventoryItemLocations.inventoryItemId, inventoryItems.id));
      conditions.push(eq(inventoryItemLocations.storageLocationId, locationId));
    }
    
    // Apply all conditions
    if (conditions.length > 0) {
      const result = await query.where(and(...conditions));
      // Extract just the inventory item from the joined results
      return result.map(row => row.inventoryItem);
    }
    
    // Fallback: return all items (should only happen if no filters provided)
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
      const key = `${item.name}-${item.categoryId || 'null'}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          name: item.name,
          category: item.categoryId,
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

  async getInventoryItemLocationsBatch(inventoryItemIds: string[]): Promise<Map<string, InventoryItemLocation[]>> {
    if (inventoryItemIds.length === 0) {
      return new Map();
    }

    const allLocations = await db
      .select()
      .from(inventoryItemLocations)
      .where(inArray(inventoryItemLocations.inventoryItemId, inventoryItemIds));

    // Group by inventory item ID
    const grouped = new Map<string, InventoryItemLocation[]>();
    for (const location of allLocations) {
      const existing = grouped.get(location.inventoryItemId) || [];
      existing.push(location);
      grouped.set(location.inventoryItemId, existing);
    }

    return grouped;
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
    }
  }

  // Store Inventory Items
  async getStoreInventoryItem(storeId: string, inventoryItemId: string): Promise<StoreInventoryItem | undefined> {
    const [item] = await db
      .select()
      .from(storeInventoryItems)
      .where(
        and(
          eq(storeInventoryItems.storeId, storeId),
          eq(storeInventoryItems.inventoryItemId, inventoryItemId)
        )
      );
    return item || undefined;
  }

  async updateStoreInventoryItemActive(storeId: string, inventoryItemId: string, active: number): Promise<void> {
    await db
      .update(storeInventoryItems)
      .set({ active })
      .where(
        and(
          eq(storeInventoryItems.storeId, storeId),
          eq(storeInventoryItems.inventoryItemId, inventoryItemId)
        )
      );
  }

  // Vendors
  async getVendors(companyId?: string): Promise<Vendor[]> {
    if (companyId) {
      return db.select().from(vendors).where(eq(vendors.companyId, companyId));
    }
    return db.select().from(vendors);
  }

  async getVendor(id: string, companyId?: string): Promise<Vendor | undefined> {
    if (companyId) {
      const [vendor] = await db.select().from(vendors).where(
        and(eq(vendors.id, id), eq(vendors.companyId, companyId))
      );
      return vendor || undefined;
    }
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

  async updateVendorItem(id: string, updates: Partial<InsertVendorItem>): Promise<VendorItem | undefined> {
    const [vendorItem] = await db
      .update(vendorItems)
      .set(updates)
      .where(eq(vendorItems.id, id))
      .returning();
    return vendorItem || undefined;
  }

  async deleteVendorItem(id: string): Promise<void> {
    await db.delete(vendorItems).where(eq(vendorItems.id, id));
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
  async getInventoryCounts(companyId?: string, storeId?: string, storageLocationId?: string): Promise<InventoryCount[]> {
    const conditions = [];
    
    if (companyId) {
      conditions.push(eq(inventoryCounts.companyId, companyId));
    }
    if (storeId) {
      conditions.push(eq(inventoryCounts.storeId, storeId));
    }
    if (storageLocationId) {
      conditions.push(eq(inventoryCounts.storageLocationId, storageLocationId));
    }
    
    if (conditions.length === 0) {
      return db.select().from(inventoryCounts);
    }
    
    return db.select().from(inventoryCounts).where(and(...conditions));
  }

  async getInventoryCount(id: string): Promise<InventoryCount | undefined> {
    const [count] = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, id));
    return count || undefined;
  }

  async createInventoryCount(insertCount: InsertInventoryCount): Promise<InventoryCount> {
    const [count] = await db.insert(inventoryCounts).values(insertCount).returning();
    return count;
  }

  async deleteInventoryCount(id: string): Promise<void> {
    // First delete all count lines for this session (cascade)
    await db.delete(inventoryCountLines).where(eq(inventoryCountLines.inventoryCountId, id));
    // Then delete the count session itself
    await db.delete(inventoryCounts).where(eq(inventoryCounts.id, id));
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
  async getPurchaseOrders(companyId: string, storeId?: string): Promise<PurchaseOrder[]> {
    const conditions = [eq(purchaseOrders.companyId, companyId)];
    if (storeId) {
      conditions.push(eq(purchaseOrders.storeId, storeId));
    }
    return db.select().from(purchaseOrders).where(and(...conditions));
  }

  async getPurchaseOrder(id: string, companyId: string): Promise<PurchaseOrder | undefined> {
    const [po] = await db.select().from(purchaseOrders).where(
      and(
        eq(purchaseOrders.id, id),
        eq(purchaseOrders.companyId, companyId)
      )
    );
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

  async deletePurchaseOrder(id: string): Promise<void> {
    await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
  }

  // PO Lines
  async getPOLines(poId: string): Promise<POLine[]> {
    return db.select().from(poLines).where(eq(poLines.purchaseOrderId, poId));
  }

  async createPOLine(insertLine: InsertPOLine): Promise<POLine> {
    const [line] = await db.insert(poLines).values(insertLine).returning();
    return line;
  }

  async deletePOLine(id: string): Promise<void> {
    await db.delete(poLines).where(eq(poLines.id, id));
  }

  // Receipts
  async getReceipts(companyId: string, storeId?: string): Promise<Receipt[]> {
    const conditions = [eq(receipts.companyId, companyId)];
    if (storeId) {
      conditions.push(eq(receipts.storeId, storeId));
    }
    return db.select().from(receipts).where(and(...conditions));
  }

  async getReceipt(id: string): Promise<Receipt | undefined> {
    const [receipt] = await db.select().from(receipts).where(eq(receipts.id, id));
    return receipt || undefined;
  }

  async createReceipt(insertReceipt: InsertReceipt): Promise<Receipt> {
    const [receipt] = await db.insert(receipts).values(insertReceipt).returning();
    return receipt;
  }

  async updateReceipt(id: string, data: Partial<InsertReceipt>): Promise<void> {
    await db.update(receipts).set(data).where(eq(receipts.id, id));
  }

  // Receipt Lines
  async getReceiptLines(receiptId: string): Promise<ReceiptLine[]> {
    return db.select().from(receiptLines).where(eq(receiptLines.receiptId, receiptId));
  }

  async getReceiptLinesByReceiptId(receiptId: string): Promise<ReceiptLine[]> {
    return db.select().from(receiptLines).where(eq(receiptLines.receiptId, receiptId));
  }

  async createReceiptLine(insertLine: InsertReceiptLine): Promise<ReceiptLine> {
    // Ensure priceEach is set (convert from pricePerUnit if needed)
    const dataToInsert = {
      ...insertLine,
      priceEach: insertLine.priceEach ?? insertLine.pricePerUnit ?? 0
    };
    const [line] = await db.insert(receiptLines).values(dataToInsert).returning();
    return line;
  }

  async updateReceiptLine(id: string, data: Partial<InsertReceiptLine>): Promise<void> {
    await db.update(receiptLines).set(data).where(eq(receiptLines.id, id));
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
  async getTransferLogs(companyId: string, inventoryItemId?: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<TransferLog[]> {
    let query = db.select().from(transferLogs);
    const conditions = [eq(transferLogs.companyId, companyId)];
    
    if (inventoryItemId) {
      conditions.push(eq(transferLogs.inventoryItemId, inventoryItemId));
    }
    if (storeId) {
      conditions.push(
        or(
          eq(transferLogs.fromStoreId, storeId),
          eq(transferLogs.toStoreId, storeId)
        )!
      );
    }
    if (startDate) {
      conditions.push(gte(transferLogs.transferredAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(transferLogs.transferredAt, endDate));
    }
    
    return query.where(and(...conditions));
  }

  async createTransferLog(insertTransfer: InsertTransferLog): Promise<TransferLog> {
    const [transfer] = await db.insert(transferLogs).values(insertTransfer).returning();
    return transfer;
  }

  // Transfer Orders
  async getTransferOrders(companyId: string, storeId?: string): Promise<TransferOrder[]> {
    const conditions = [eq(transferOrders.companyId, companyId)];
    if (storeId) {
      conditions.push(
        or(
          eq(transferOrders.fromStoreId, storeId),
          eq(transferOrders.toStoreId, storeId)
        )!
      );
    }
    return db.select().from(transferOrders).where(and(...conditions)).orderBy(transferOrders.createdAt);
  }

  async getTransferOrder(id: string): Promise<TransferOrder | undefined> {
    const [order] = await db.select().from(transferOrders).where(eq(transferOrders.id, id));
    return order || undefined;
  }

  async createTransferOrder(insertOrder: InsertTransferOrder): Promise<TransferOrder> {
    const [order] = await db.insert(transferOrders).values(insertOrder).returning();
    return order;
  }

  async updateTransferOrder(id: string, updates: Partial<TransferOrder>): Promise<TransferOrder | undefined> {
    const [order] = await db
      .update(transferOrders)
      .set(updates)
      .where(eq(transferOrders.id, id))
      .returning();
    return order || undefined;
  }

  async deleteTransferOrder(id: string): Promise<void> {
    await db.delete(transferOrders).where(eq(transferOrders.id, id));
  }

  // Transfer Order Lines
  async getTransferOrderLines(transferOrderId: string): Promise<TransferOrderLine[]> {
    return db.select().from(transferOrderLines).where(eq(transferOrderLines.transferOrderId, transferOrderId));
  }

  async createTransferOrderLine(insertLine: InsertTransferOrderLine): Promise<TransferOrderLine> {
    const [line] = await db.insert(transferOrderLines).values(insertLine).returning();
    return line;
  }

  async updateTransferOrderLine(id: string, updates: Partial<TransferOrderLine>): Promise<TransferOrderLine | undefined> {
    const [line] = await db
      .update(transferOrderLines)
      .set(updates)
      .where(eq(transferOrderLines.id, id))
      .returning();
    return line || undefined;
  }

  async deleteTransferOrderLine(id: string): Promise<void> {
    await db.delete(transferOrderLines).where(eq(transferOrderLines.id, id));
  }

  // Waste Logs
  async getWasteLogs(companyId: string, inventoryItemId?: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<WasteLog[]> {
    let query = db.select().from(wasteLogs);
    const conditions = [eq(wasteLogs.companyId, companyId)];
    
    if (inventoryItemId) {
      conditions.push(eq(wasteLogs.inventoryItemId, inventoryItemId));
    }
    if (storeId) {
      conditions.push(eq(wasteLogs.storeId, storeId));
    }
    if (startDate) {
      conditions.push(gte(wasteLogs.wastedAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(wasteLogs.wastedAt, endDate));
    }
    
    return query.where(and(...conditions));
  }

  async createWasteLog(insertWaste: InsertWasteLog): Promise<WasteLog> {
    const [waste] = await db.insert(wasteLogs).values(insertWaste).returning();
    return waste;
  }

  // Companies
  async getCompanies(): Promise<Company[]> {
    return await db.select().from(companies);
  }

  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company || undefined;
  }

  async createCompany(insertCompany: InsertCompany): Promise<Company> {
    const [company] = await db.insert(companies).values(insertCompany).returning();
    return company;
  }

  async updateCompany(id: string, updates: Partial<Company>): Promise<Company | undefined> {
    const [company] = await db
      .update(companies)
      .set(updates)
      .where(eq(companies.id, id))
      .returning();
    return company || undefined;
  }

  // Company Stores
  async getCompanyStores(companyId: string): Promise<CompanyStore[]> {
    return await db.select().from(companyStores).where(eq(companyStores.companyId, companyId));
  }

  async getCompanyStore(id: string): Promise<CompanyStore | undefined> {
    const [store] = await db.select().from(companyStores).where(eq(companyStores.id, id));
    return store || undefined;
  }

  async createCompanyStore(insertStore: InsertCompanyStore): Promise<CompanyStore> {
    const [store] = await db.insert(companyStores).values(insertStore).returning();
    return store;
  }

  async updateCompanyStore(id: string, updates: Partial<CompanyStore>): Promise<CompanyStore | undefined> {
    const [store] = await db
      .update(companyStores)
      .set(updates)
      .where(eq(companyStores.id, id))
      .returning();
    return store || undefined;
  }

  async deleteCompanyStore(id: string): Promise<void> {
    await db.delete(companyStores).where(eq(companyStores.id, id));
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

  // Vendor Credentials
  async getVendorCredentials(): Promise<VendorCredentials[]> {
    return await db.select().from(vendorCredentials);
  }

  async getVendorCredentialsByKey(vendorKey: string): Promise<VendorCredentials | undefined> {
    const [creds] = await db
      .select()
      .from(vendorCredentials)
      .where(eq(vendorCredentials.vendorKey, vendorKey))
      .limit(1);
    return creds || undefined;
  }

  async createVendorCredentials(credentials: InsertVendorCredentials): Promise<VendorCredentials> {
    const [created] = await db
      .insert(vendorCredentials)
      .values(credentials)
      .returning();
    return created;
  }

  async updateVendorCredentials(id: string, updates: Partial<VendorCredentials>): Promise<VendorCredentials | undefined> {
    const [updated] = await db
      .update(vendorCredentials)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(vendorCredentials.id, id))
      .returning();
    return updated;
  }

  async deleteVendorCredentials(id: string): Promise<void> {
    await db.delete(vendorCredentials).where(eq(vendorCredentials.id, id));
  }

  // EDI Messages
  async getEdiMessages(vendorKey?: string, limit: number = 100): Promise<EdiMessage[]> {
    let query = db.select().from(ediMessages);
    
    if (vendorKey) {
      query = query.where(eq(ediMessages.vendorKey, vendorKey)) as any;
    }
    
    return query.orderBy(ediMessages.createdAt).limit(limit);
  }

  async getEdiMessage(id: string): Promise<EdiMessage | undefined> {
    const results = await db.select().from(ediMessages).where(eq(ediMessages.id, id));
    return results[0];
  }

  async createEdiMessage(message: InsertEdiMessage): Promise<EdiMessage> {
    const results = await db.insert(ediMessages).values(message).returning();
    return results[0];
  }

  async updateEdiMessage(id: string, updates: Partial<EdiMessage>): Promise<EdiMessage | undefined> {
    const results = await db
      .update(ediMessages)
      .set(updates)
      .where(eq(ediMessages.id, id))
      .returning();
    return results[0];
  }

  // Order Guides
  async getOrderGuides(vendorKey?: string, limit: number = 50): Promise<OrderGuide[]> {
    let query = db.select().from(orderGuides);
    
    if (vendorKey) {
      query = query.where(eq(orderGuides.vendorKey, vendorKey)) as any;
    }
    
    return query.orderBy(orderGuides.fetchedAt).limit(limit);
  }

  async getOrderGuide(id: string): Promise<OrderGuide | undefined> {
    const results = await db.select().from(orderGuides).where(eq(orderGuides.id, id));
    return results[0];
  }

  async createOrderGuide(guide: InsertOrderGuide): Promise<OrderGuide> {
    const results = await db.insert(orderGuides).values(guide).returning();
    return results[0];
  }

  // Order Guide Lines
  async getOrderGuideLines(orderGuideId: string): Promise<OrderGuideLine[]> {
    return db
      .select()
      .from(orderGuideLines)
      .where(eq(orderGuideLines.orderGuideId, orderGuideId));
  }

  async createOrderGuideLine(line: InsertOrderGuideLine): Promise<OrderGuideLine> {
    const results = await db.insert(orderGuideLines).values(line).returning();
    return results[0];
  }

  async createOrderGuideLinesBatch(lines: InsertOrderGuideLine[]): Promise<OrderGuideLine[]> {
    if (lines.length === 0) return [];
    return db.insert(orderGuideLines).values(lines).returning();
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
    pricePerUnit: number;
    caseSize: number;
    totalValue: number;
    countedAt: Date;
  }>> {
    return [];
  }
}

export const storage = new DatabaseStorage();
