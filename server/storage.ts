import { eq, and, or, gt, gte, lte, isNull, inArray, sql, desc, asc } from "drizzle-orm";
import { db } from "./db";
import { cache, CacheKeys } from "./cache";
import {
  users, type User, type InsertUser,
  authSessions, type AuthSession, type InsertAuthSession,
  apiCredentials, type ApiCredential, type InsertApiCredential,
  apiCredentialLocations, type ApiCredentialLocation, type InsertApiCredentialLocation,
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
  storeMenuItems, type StoreMenuItem, type InsertStoreMenuItem,
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
  userStores, type UserStore, type InsertUserStore,
  invitations, type Invitation, type InsertInvitation,
  salesUploadBatches, type SalesUploadBatch, type InsertSalesUploadBatch,
  dailyMenuItemSales, type DailyMenuItemSales, type InsertDailyMenuItemSales,
  recipeCostSnapshots, type RecipeCostSnapshot, type InsertRecipeCostSnapshot,
  theoreticalUsageRuns, type TheoreticalUsageRun, type InsertTheoreticalUsageRun,
  theoreticalUsageLines, type TheoreticalUsageLine, type InsertTheoreticalUsageLine,
  dayparts, type Daypart, type InsertDaypart,
  quickbooksConnections, type QuickBooksConnection, type InsertQuickBooksConnection,
  quickbooksVendorMappings, type QuickBooksVendorMapping, type InsertQuickBooksVendorMapping,
  quickbooksSyncLogs, type QuickBooksSyncLog, type InsertQuickBooksSyncLog,
  quickbooksTokenLogs, type QuickBooksTokenLog, type InsertQuickBooksTokenLog,
  onboardingProgress, type OnboardingProgress, type InsertOnboardingProgress,
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserBySsoId(ssoProvider: string, ssoId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<User>): Promise<User | undefined>;
  getUsers(companyId?: string): Promise<User[]>;
  
  // User-Store assignments
  getUserStores(userId: string): Promise<UserStore[]>;
  assignUserToStore(userId: string, storeId: string): Promise<UserStore>;
  removeUserFromStore(userId: string, storeId: string): Promise<void>;

  // Invitations
  createInvitation(invitation: InsertInvitation): Promise<Invitation>;
  getInvitationByToken(token: string): Promise<Invitation | undefined>;
  getInvitationByEmail(email: string, companyId: string): Promise<Invitation | undefined>;
  getPendingInvitations(companyId: string): Promise<Invitation[]>;
  acceptInvitation(token: string): Promise<Invitation | undefined>;
  revokeInvitation(id: string, companyId: string | null): Promise<void>;
  cleanExpiredInvitations(): Promise<void>;

  // Auth Sessions
  createAuthSession(session: InsertAuthSession): Promise<AuthSession>;
  getAuthSessionByToken(tokenHash: string): Promise<AuthSession | undefined>;
  updateAuthSession(id: string, updates: Partial<AuthSession>): Promise<AuthSession | undefined>;
  revokeAuthSession(id: string): Promise<void>;
  cleanExpiredSessions(): Promise<void>;

  // API Credentials (HMAC authentication for inbound data feeds)
  getApiCredentials(companyId: string): Promise<Array<ApiCredential & { locationCount: number }>>;
  getApiCredential(id: string, companyId: string): Promise<ApiCredential | undefined>;
  getApiCredentialByKeyId(apiKeyId: string): Promise<ApiCredential | undefined>;
  createApiCredential(credential: InsertApiCredential): Promise<ApiCredential>;
  updateApiCredential(id: string, companyId: string, updates: Partial<ApiCredential>): Promise<ApiCredential | undefined>;
  deleteApiCredential(id: string, companyId: string): Promise<void>;
  updateApiCredentialLastUsed(apiKeyId: string): Promise<void>;
  
  // API Credential Locations
  getApiCredentialLocations(apiCredentialId: string): Promise<ApiCredentialLocation[]>;
  setApiCredentialLocations(apiCredentialId: string, storeIds: string[]): Promise<void>;
  verifyApiCredentialLocation(apiCredentialId: string, storeId: string): Promise<boolean>;

  // Storage Locations
  getStorageLocations(companyId: string): Promise<StorageLocation[]>;
  getStorageLocation(id: string, companyId: string): Promise<StorageLocation | undefined>;
  createStorageLocation(location: InsertStorageLocation): Promise<StorageLocation>;
  updateStorageLocation(id: string, companyId: string, location: Partial<StorageLocation>): Promise<StorageLocation | undefined>;
  deleteStorageLocation(id: string, companyId: string): Promise<void>;
  reorderStorageLocations(companyId: string, locationOrders: { id: string; sortOrder: number }[]): Promise<void>;

  // Categories
  getCategories(companyId: string): Promise<Category[]>;
  getCategory(id: string, companyId: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory): Promise<Category>;
  updateCategory(id: string, companyId: string, category: Partial<Category>): Promise<Category | undefined>;
  deleteCategory(id: string, companyId: string): Promise<void>;
  reorderCategories(companyId: string, categoryOrders: { id: string; sortOrder: number }[]): Promise<void>;

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
  updateInventoryItem(id: string, item: Partial<InventoryItem>, companyId?: string): Promise<InventoryItem | undefined>;
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
  getStoreInventoryItems(storeId: string): Promise<StoreInventoryItem[]>;
  getInventoryItemStores(inventoryItemId: string): Promise<StoreInventoryItem[]>;
  createStoreInventoryItem(insertItem: InsertStoreInventoryItem): Promise<StoreInventoryItem>;
  updateStoreInventoryItemActive(storeId: string, inventoryItemId: string, active: number): Promise<void>;
  updateStoreInventoryItem(storeId: string, inventoryItemId: string, updates: Partial<StoreInventoryItem>): Promise<StoreInventoryItem | undefined>;
  updateStoreInventoryItemQuantity(storeId: string, inventoryItemId: string, quantityDelta: number): Promise<StoreInventoryItem | undefined>;
  removeStoreInventoryItem(storeId: string, inventoryItemId: string): Promise<void>;

  // Vendors
  getVendors(companyId?: string): Promise<Vendor[]>;
  getVendor(id: string, companyId?: string): Promise<Vendor | undefined>;
  createVendor(vendor: InsertVendor): Promise<Vendor>;
  updateVendor(id: string, vendor: Partial<Vendor>, companyId?: string): Promise<Vendor | undefined>;
  deleteVendor(id: string, companyId?: string): Promise<void>;

  // Vendor Items
  getVendorItems(vendorId?: string, companyId?: string, storeId?: string): Promise<VendorItem[]>;
  getVendorItem(id: string): Promise<VendorItem | undefined>;
  createVendorItem(vendorItem: InsertVendorItem): Promise<VendorItem>;
  updateVendorItem(id: string, vendorItem: Partial<InsertVendorItem>): Promise<VendorItem | undefined>;
  deleteVendorItem(id: string): Promise<void>;

  // Recipes
  getRecipes(companyId?: string): Promise<Recipe[]>;
  getRecipe(id: string, companyId?: string): Promise<Recipe | undefined>;
  createRecipe(recipe: InsertRecipe): Promise<Recipe>;
  updateRecipe(id: string, recipe: Partial<Recipe>, companyId?: string): Promise<Recipe | undefined>;

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

  // Item Usage Calculation
  getItemUsageBetweenCounts(storeId: string, previousCountId: string, currentCountId: string): Promise<Array<{
    inventoryItemId: string;
    inventoryItemName: string;
    category: string | null;
    previousQty: number;
    receivedQty: number;
    transferredQty: number;
    currentQty: number;
    usage: number;
    unitId: string;
    unitName: string;
    pricePerUnit: number;
    isNegativeUsage: boolean;
    previousCountId: string;
    currentCountId: string;
    receiptIds: string[];
    transferOrderIds: string[];
  }>>;

  // Estimated On-Hand Calculation
  getEstimatedOnHand(companyId: string, storeId: string): Promise<Array<{
    inventoryItemId: string;
    lastCountQty: number;
    lastCountDate: string | null;
    receivedQty: number;
    wasteQty: number;
    theoreticalUsageQty: number;
    transferredOutQty: number;
    transferredInQty: number;
    estimatedOnHand: number;
  }>>;

  // Estimated On-Hand Breakdown (detailed with dates)
  getEstimatedOnHandBreakdown(companyId: string, storeId: string, inventoryItemId: string): Promise<{
    inventoryItemId: string;
    inventoryItemName: string;
    unitName: string;
    lastCount: {
      qty: number;
      date: string;
    } | null;
    receipts: Array<{
      date: string;
      qty: number;
      vendorName: string;
      poId: string | null;
    }>;
    waste: Array<{
      date: string;
      qty: number;
      reason: string;
    }>;
    theoreticalUsage: Array<{
      date: string;
      qty: number;
    }>;
    transfersOut: Array<{
      date: string;
      qty: number;
      toStoreName: string;
      transferId: string;
    }>;
    transfersIn: Array<{
      date: string;
      qty: number;
      fromStoreName: string;
      transferId: string;
    }>;
    summary: {
      lastCountQty: number;
      receivedQty: number;
      wasteQty: number;
      theoreticalUsageQty: number;
      transferredOutQty: number;
      transferredInQty: number;
      estimatedOnHand: number;
    };
  } | null>;

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

  // TFC - Dayparts
  getDayparts(companyId: string): Promise<Daypart[]>;
  getDaypart(id: string, companyId: string): Promise<Daypart | undefined>;
  createDaypart(daypart: InsertDaypart): Promise<Daypart>;
  updateDaypart(id: string, companyId: string, updates: Partial<Daypart>): Promise<Daypart | undefined>;

  // TFC - Sales Upload Batches
  createSalesUploadBatch(batch: InsertSalesUploadBatch): Promise<SalesUploadBatch>;
  getSalesUploadBatch(id: string, companyId: string): Promise<SalesUploadBatch | undefined>;
  getSalesUploadBatches(companyId: string, storeId?: string): Promise<SalesUploadBatch[]>;
  updateSalesUploadBatchStatus(id: string, companyId: string, status: string, completedAt?: Date, rowsProcessed?: number, rowsFailed?: number, errorLog?: string): Promise<void>;

  // TFC - Daily Menu Item Sales
  createDailyMenuItemSales(sales: InsertDailyMenuItemSales[]): Promise<DailyMenuItemSales[]>;
  getDailyMenuItemSales(companyId: string, storeId: string, startDate: Date, endDate: Date): Promise<DailyMenuItemSales[]>;

  // TFC - Recipe Cost Snapshots
  createRecipeCostSnapshot(snapshot: InsertRecipeCostSnapshot): Promise<RecipeCostSnapshot>;
  getRecipeCostSnapshot(recipeId: string, effectiveDate: Date): Promise<RecipeCostSnapshot | undefined>;

  // TFC - Theoretical Usage Runs
  createTheoreticalUsageRun(run: InsertTheoreticalUsageRun): Promise<TheoreticalUsageRun>;
  getTheoreticalUsageRun(id: string, companyId: string): Promise<TheoreticalUsageRun | undefined>;
  getTheoreticalUsageRuns(companyId: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<TheoreticalUsageRun[]>;
  updateTheoreticalUsageRun(id: string, companyId: string, updates: Partial<TheoreticalUsageRun>): Promise<TheoreticalUsageRun | undefined>;

  // TFC - Theoretical Usage Lines
  createTheoreticalUsageLines(lines: InsertTheoreticalUsageLine[]): Promise<TheoreticalUsageLine[]>;
  getTheoreticalUsageLines(runId: string): Promise<TheoreticalUsageLine[]>;

  // QuickBooks - Connections
  getQuickBooksConnection(companyId: string, storeId?: string): Promise<QuickBooksConnection | undefined>;
  getAllQuickBooksConnections(): Promise<QuickBooksConnection[]>;
  createQuickBooksConnection(connection: InsertQuickBooksConnection): Promise<QuickBooksConnection>;
  updateQuickBooksConnection(id: string, companyId: string, updates: Partial<QuickBooksConnection>): Promise<QuickBooksConnection | undefined>;
  updateQuickBooksTokens(companyId: string, storeId: string | null, tokens: { accessToken: string; refreshToken: string; accessTokenExpiresAt: Date; refreshTokenExpiresAt: Date }): Promise<void>;
  disconnectQuickBooks(companyId: string, storeId?: string): Promise<void>;
  logQuickBooksTokenEvent(log: InsertQuickBooksTokenLog): Promise<void>;
  
  // QuickBooks - Vendor Mappings
  getQuickBooksVendorMapping(vendorId: string, companyId: string): Promise<QuickBooksVendorMapping | undefined>;
  getQuickBooksVendorMappings(companyId: string): Promise<QuickBooksVendorMapping[]>;
  createQuickBooksVendorMapping(mapping: InsertQuickBooksVendorMapping): Promise<QuickBooksVendorMapping>;
  updateQuickBooksVendorMapping(id: string, companyId: string, updates: Partial<QuickBooksVendorMapping>): Promise<QuickBooksVendorMapping | undefined>;
  deleteQuickBooksVendorMapping(id: string, companyId: string): Promise<void>;
  
  // QuickBooks - Sync Logs
  getQuickBooksSyncLog(purchaseOrderId: string, companyId: string): Promise<QuickBooksSyncLog | undefined>;
  getQuickBooksSyncLogs(companyId: string, syncStatus?: string): Promise<QuickBooksSyncLog[]>;
  createQuickBooksSyncLog(log: InsertQuickBooksSyncLog): Promise<QuickBooksSyncLog>;
  updateQuickBooksSyncLog(id: string, companyId: string, updates: Partial<QuickBooksSyncLog>): Promise<QuickBooksSyncLog | undefined>;
  
  // Onboarding Progress
  getOnboardingProgress(companyId: string): Promise<OnboardingProgress | undefined>;
  createOnboardingProgress(progress: InsertOnboardingProgress): Promise<OnboardingProgress>;
  updateOnboardingProgress(companyId: string, updates: Partial<OnboardingProgress>): Promise<OnboardingProgress | undefined>;
  completeOnboarding(companyId: string): Promise<OnboardingProgress | undefined>;
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

  async getUserBySsoId(ssoProvider: string, ssoId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      and(
        eq(users.ssoProvider, ssoProvider),
        eq(users.ssoId, ssoId)
      )
    );
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async getUsers(companyId?: string): Promise<User[]> {
    if (companyId) {
      return await db.select().from(users).where(eq(users.companyId, companyId));
    }
    return await db.select().from(users);
  }

  // User-Store assignments
  async getUserStores(userId: string): Promise<UserStore[]> {
    return await db.select().from(userStores).where(eq(userStores.userId, userId));
  }

  async assignUserToStore(userId: string, storeId: string): Promise<UserStore> {
    const [userStore] = await db.insert(userStores)
      .values({ userId, storeId })
      .returning();
    return userStore;
  }

  async removeUserFromStore(userId: string, storeId: string): Promise<void> {
    await db.delete(userStores)
      .where(and(
        eq(userStores.userId, userId),
        eq(userStores.storeId, storeId)
      ));
  }

  // Invitations
  async createInvitation(insertInvitation: InsertInvitation): Promise<Invitation> {
    const [invitation] = await db.insert(invitations).values(insertInvitation).returning();
    return invitation;
  }

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(and(
        eq(invitations.token, token),
        isNull(invitations.acceptedAt),
        gte(invitations.expiresAt, new Date())
      ));
    return invitation || undefined;
  }

  async getInvitationByEmail(email: string, companyId: string): Promise<Invitation | undefined> {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(and(
        eq(invitations.email, email),
        eq(invitations.companyId, companyId),
        isNull(invitations.acceptedAt),
        gte(invitations.expiresAt, new Date())
      ))
      .orderBy(invitations.createdAt)
      .limit(1);
    return invitation || undefined;
  }

  async getPendingInvitations(companyId: string): Promise<Invitation[]> {
    return await db
      .select()
      .from(invitations)
      .where(and(
        eq(invitations.companyId, companyId),
        isNull(invitations.acceptedAt),
        gte(invitations.expiresAt, new Date())
      ))
      .orderBy(invitations.createdAt);
  }

  async acceptInvitation(token: string): Promise<Invitation | undefined> {
    const [invitation] = await db
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(
        eq(invitations.token, token),
        isNull(invitations.acceptedAt),
        gte(invitations.expiresAt, new Date())
      ))
      .returning();
    return invitation || undefined;
  }

  async revokeInvitation(id: string, companyId: string | null): Promise<void> {
    console.log(`[revokeInvitation] Attempting to delete invitation ${id} for company ${companyId}`);
    
    // Build WHERE conditions
    const conditions = companyId
      ? and(eq(invitations.id, id), eq(invitations.companyId, companyId))
      : eq(invitations.id, id);
    
    const deleted = await db.delete(invitations)
      .where(conditions)
      .returning();
    
    console.log(`[revokeInvitation] Deleted ${deleted.length} invitations`);
    
    if (deleted.length === 0) {
      throw new Error("Invitation not found or already revoked");
    }
  }

  async cleanExpiredInvitations(): Promise<void> {
    await db.delete(invitations)
      .where(lte(invitations.expiresAt, new Date()));
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
    
    // Invalidate cache when session is updated (Phase 2 optimization)
    if (session) {
      await cache.del(CacheKeys.session(session.tokenHash));
    }
    
    return session || undefined;
  }

  async revokeAuthSession(id: string): Promise<void> {
    // Get session before revoking to invalidate cache
    const session = await db.query.authSessions.findFirst({
      where: eq(authSessions.id, id),
    });
    
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.id, id));
    
    // Invalidate cache when session is revoked (Phase 2 optimization)
    if (session) {
      await cache.del(CacheKeys.session(session.tokenHash));
      if (session.userId) {
        await cache.del(CacheKeys.user(session.userId));
      }
    }
  }

  async cleanExpiredSessions(): Promise<void> {
    await db
      .delete(authSessions)
      .where(lte(authSessions.expiresAt, new Date()));
  }

  // API Credentials
  async getApiCredentials(companyId: string): Promise<Array<ApiCredential & { locationCount: number }>> {
    const credentials = await db.select().from(apiCredentials)
      .where(eq(apiCredentials.companyId, companyId))
      .orderBy(apiCredentials.createdAt);
    
    // Get location counts for each credential
    const credentialsWithCounts = await Promise.all(
      credentials.map(async (cred) => {
        const locations = await db.select().from(apiCredentialLocations)
          .where(eq(apiCredentialLocations.apiCredentialId, cred.id));
        return {
          ...cred,
          locationCount: locations.length
        };
      })
    );
    
    return credentialsWithCounts;
  }

  async getApiCredential(id: string, companyId: string): Promise<ApiCredential | undefined> {
    const [credential] = await db.select().from(apiCredentials)
      .where(and(
        eq(apiCredentials.id, id),
        eq(apiCredentials.companyId, companyId)
      ));
    return credential;
  }

  async getApiCredentialByKeyId(apiKeyId: string): Promise<ApiCredential | undefined> {
    const [credential] = await db.select().from(apiCredentials)
      .where(eq(apiCredentials.apiKeyId, apiKeyId));
    return credential;
  }

  async createApiCredential(credential: InsertApiCredential): Promise<ApiCredential> {
    const [newCredential] = await db.insert(apiCredentials)
      .values(credential)
      .returning();
    return newCredential;
  }

  async updateApiCredential(id: string, companyId: string, updates: Partial<ApiCredential>): Promise<ApiCredential | undefined> {
    const [updated] = await db.update(apiCredentials)
      .set(updates)
      .where(and(
        eq(apiCredentials.id, id),
        eq(apiCredentials.companyId, companyId)
      ))
      .returning();
    return updated;
  }

  async deleteApiCredential(id: string, companyId: string): Promise<void> {
    // First delete all location mappings
    await db.delete(apiCredentialLocations)
      .where(eq(apiCredentialLocations.apiCredentialId, id));
    
    // Then delete the credential
    await db.delete(apiCredentials)
      .where(and(
        eq(apiCredentials.id, id),
        eq(apiCredentials.companyId, companyId)
      ));
  }

  async updateApiCredentialLastUsed(apiKeyId: string): Promise<void> {
    await db.update(apiCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiCredentials.apiKeyId, apiKeyId));
  }

  // API Credential Locations
  async getApiCredentialLocations(apiCredentialId: string): Promise<ApiCredentialLocation[]> {
    return db.select().from(apiCredentialLocations)
      .where(eq(apiCredentialLocations.apiCredentialId, apiCredentialId));
  }

  async setApiCredentialLocations(apiCredentialId: string, storeIds: string[]): Promise<void> {
    // Delete existing location mappings
    await db.delete(apiCredentialLocations)
      .where(eq(apiCredentialLocations.apiCredentialId, apiCredentialId));
    
    // Insert new location mappings
    if (storeIds.length > 0) {
      await db.insert(apiCredentialLocations)
        .values(storeIds.map(storeId => ({
          apiCredentialId,
          storeId
        })));
    }
  }

  async verifyApiCredentialLocation(apiCredentialId: string, storeId: string): Promise<boolean> {
    const [location] = await db.select().from(apiCredentialLocations)
      .where(and(
        eq(apiCredentialLocations.apiCredentialId, apiCredentialId),
        eq(apiCredentialLocations.storeId, storeId)
      ));
    return !!location;
  }

  // Storage Locations
  async getStorageLocations(companyId: string): Promise<StorageLocation[]> {
    return db.select().from(storageLocations)
      .where(eq(storageLocations.companyId, companyId))
      .orderBy(storageLocations.sortOrder);
  }

  async getStorageLocation(id: string, companyId: string): Promise<StorageLocation | undefined> {
    const [location] = await db.select().from(storageLocations)
      .where(and(
        eq(storageLocations.id, id),
        eq(storageLocations.companyId, companyId)
      ));
    return location || undefined;
  }

  async createStorageLocation(insertLocation: InsertStorageLocation): Promise<StorageLocation> {
    const [location] = await db.insert(storageLocations).values(insertLocation).returning();
    return location;
  }

  async updateStorageLocation(id: string, companyId: string, updates: Partial<StorageLocation>): Promise<StorageLocation | undefined> {
    const [location] = await db
      .update(storageLocations)
      .set(updates)
      .where(and(
        eq(storageLocations.id, id),
        eq(storageLocations.companyId, companyId)
      ))
      .returning();
    return location || undefined;
  }

  async deleteStorageLocation(id: string, companyId: string): Promise<void> {
    await db.delete(storageLocations)
      .where(and(
        eq(storageLocations.id, id),
        eq(storageLocations.companyId, companyId)
      ));
  }

  async reorderStorageLocations(companyId: string, locationOrders: { id: string; sortOrder: number }[]): Promise<void> {
    // Update all locations in a transaction
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of locationOrders) {
        await tx
          .update(storageLocations)
          .set({ sortOrder })
          .where(and(
            eq(storageLocations.id, id),
            eq(storageLocations.companyId, companyId)
          ));
      }
    });
  }

  // Categories
  async getCategories(companyId: string): Promise<Category[]> {
    return db.select().from(categories)
      .where(eq(categories.companyId, companyId))
      .orderBy(categories.sortOrder);
  }

  async getCategory(id: string, companyId: string): Promise<Category | undefined> {
    const [category] = await db.select().from(categories)
      .where(and(
        eq(categories.id, id),
        eq(categories.companyId, companyId)
      ));
    return category || undefined;
  }

  async createCategory(insertCategory: InsertCategory): Promise<Category> {
    const [category] = await db.insert(categories).values(insertCategory).returning();
    return category;
  }

  async updateCategory(id: string, companyId: string, updates: Partial<Category>): Promise<Category | undefined> {
    // Strip companyId from updates to prevent cross-tenant reassignment
    const { companyId: _, ...safeUpdates } = updates;
    const [category] = await db
      .update(categories)
      .set(safeUpdates)
      .where(and(
        eq(categories.id, id),
        eq(categories.companyId, companyId)
      ))
      .returning();
    return category || undefined;
  }

  async deleteCategory(id: string, companyId: string): Promise<void> {
    await db.delete(categories)
      .where(and(
        eq(categories.id, id),
        eq(categories.companyId, companyId)
      ));
  }

  async reorderCategories(companyId: string, categoryOrders: { id: string; sortOrder: number }[]): Promise<void> {
    // Update all categories in a transaction
    await db.transaction(async (tx) => {
      for (const { id, sortOrder } of categoryOrders) {
        await tx
          .update(categories)
          .set({ sortOrder })
          .where(and(
            eq(categories.id, id),
            eq(categories.companyId, companyId)
          ));
      }
    });
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
    const conditions = [];
    
    // Always filter by company if provided (multi-tenant safety)
    if (companyId) {
      conditions.push(eq(inventoryItems.companyId, companyId));
    }
    
    // When filtering by store, we need to join with store_inventory_items and use store-specific active status
    // Use INNER JOIN to only show items that have been associated with this store
    if (storeId) {
      let query = db.select({ 
        inventoryItem: inventoryItems,
        storeActive: storeInventoryItems.active,
        onHandQty: storeInventoryItems.onHandQty,
        parLevel: storeInventoryItems.parLevel,
        reorderLevel: storeInventoryItems.reorderLevel
      }).from(inventoryItems)
        .innerJoin(storeInventoryItems, and(
          eq(storeInventoryItems.inventoryItemId, inventoryItems.id),
          eq(storeInventoryItems.storeId, storeId)
        ));
      
      // Legacy: filter by storage location (DEPRECATED)
      if (locationId) {
        query = query.innerJoin(inventoryItemLocations, eq(inventoryItemLocations.inventoryItemId, inventoryItems.id));
        conditions.push(eq(inventoryItemLocations.storageLocationId, locationId));
      }
      
      const result = await query.where(conditions.length > 0 ? and(...conditions) : undefined);
      // Use store-specific values (active status, onHandQty, par/reorder levels)
      return result.map(row => ({
        ...row.inventoryItem,
        active: row.storeActive,
        onHandQty: row.onHandQty,
        parLevel: row.parLevel ?? row.inventoryItem.parLevel,
        reorderLevel: row.reorderLevel ?? row.inventoryItem.reorderLevel
      }));
    }
    
    // No store filter - return items with global active status
    let query = db.select().from(inventoryItems);
    
    // Legacy: filter by storage location (DEPRECATED)
    if (locationId) {
      query = query.innerJoin(inventoryItemLocations, eq(inventoryItemLocations.inventoryItemId, inventoryItems.id));
      conditions.push(eq(inventoryItemLocations.storageLocationId, locationId));
    }
    
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    
    // Fallback: return all items
    return query;
  }

  async getInventoryItem(id: string, storeId?: string): Promise<InventoryItem | undefined> {
    // If storeId provided, join with store_inventory_items to get store-specific values
    if (storeId) {
      const result = await db.select({ 
        inventoryItem: inventoryItems,
        storeActive: storeInventoryItems.active,
        onHandQty: storeInventoryItems.onHandQty,
        parLevel: storeInventoryItems.parLevel,
        reorderLevel: storeInventoryItems.reorderLevel
      }).from(inventoryItems)
        .innerJoin(storeInventoryItems, and(
          eq(storeInventoryItems.inventoryItemId, inventoryItems.id),
          eq(storeInventoryItems.storeId, storeId)
        ))
        .where(eq(inventoryItems.id, id));
      
      if (result.length === 0) return undefined;
      
      const row = result[0];
      return {
        ...row.inventoryItem,
        active: row.storeActive,
        onHandQty: row.onHandQty,
        parLevel: row.parLevel ?? row.inventoryItem.parLevel,
        reorderLevel: row.reorderLevel ?? row.inventoryItem.reorderLevel
      };
    }
    
    // No storeId - return global item
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
    return item || undefined;
  }

  async createInventoryItem(insertItem: InsertInventoryItem): Promise<InventoryItem> {
    const [item] = await db.insert(inventoryItems).values(insertItem).returning();
    return item;
  }

  async updateInventoryItem(id: string, updates: Partial<InventoryItem>, companyId?: string): Promise<InventoryItem | undefined> {
    const conditions = [eq(inventoryItems.id, id)];
    if (companyId) {
      conditions.push(eq(inventoryItems.companyId, companyId));
    }
    const [item] = await db
      .update(inventoryItems)
      .set(updates)
      .where(and(...conditions))
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

  async createStoreInventoryItem(insertItem: InsertStoreInventoryItem): Promise<StoreInventoryItem> {
    const [item] = await db.insert(storeInventoryItems).values(insertItem).returning();
    return item;
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

  async updateStoreInventoryItem(storeId: string, inventoryItemId: string, updates: Partial<StoreInventoryItem>): Promise<StoreInventoryItem | undefined> {
    const [updated] = await db
      .update(storeInventoryItems)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(storeInventoryItems.storeId, storeId),
          eq(storeInventoryItems.inventoryItemId, inventoryItemId)
        )
      )
      .returning();
    return updated || undefined;
  }

  async updateStoreInventoryItemQuantity(storeId: string, inventoryItemId: string, quantityDelta: number): Promise<StoreInventoryItem | undefined> {
    const [updated] = await db
      .update(storeInventoryItems)
      .set({ 
        onHandQty: sql`${storeInventoryItems.onHandQty} + ${quantityDelta}`,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(storeInventoryItems.storeId, storeId),
          eq(storeInventoryItems.inventoryItemId, inventoryItemId)
        )
      )
      .returning();
    return updated || undefined;
  }

  async getStoreInventoryItems(storeId: string): Promise<StoreInventoryItem[]> {
    return db
      .select()
      .from(storeInventoryItems)
      .where(eq(storeInventoryItems.storeId, storeId));
  }

  async getInventoryItemStores(inventoryItemId: string): Promise<StoreInventoryItem[]> {
    return db
      .select()
      .from(storeInventoryItems)
      .where(eq(storeInventoryItems.inventoryItemId, inventoryItemId));
  }

  async removeStoreInventoryItem(storeId: string, inventoryItemId: string): Promise<void> {
    await db
      .delete(storeInventoryItems)
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

  async updateVendor(id: string, updates: Partial<Vendor>, companyId?: string): Promise<Vendor | undefined> {
    const conditions = [eq(vendors.id, id)];
    if (companyId) {
      conditions.push(eq(vendors.companyId, companyId));
    }
    const [vendor] = await db
      .update(vendors)
      .set(updates)
      .where(and(...conditions))
      .returning();
    return vendor || undefined;
  }

  async deleteVendor(id: string, companyId?: string): Promise<void> {
    const conditions = [eq(vendors.id, id)];
    if (companyId) {
      conditions.push(eq(vendors.companyId, companyId));
    }
    await db.delete(vendors).where(and(...conditions));
  }

  // Vendor Items
  async getVendorItems(vendorId?: string, companyId?: string, storeId?: string): Promise<VendorItem[]> {
    // Build conditions
    const conditions = [];
    
    if (vendorId) {
      conditions.push(eq(vendorItems.vendorId, vendorId));
    }
    
    // Filter by store: only show vendor items where the inventory item is active at the selected store
    if (storeId) {
      const result = await db
        .select({
          id: vendorItems.id,
          vendorId: vendorItems.vendorId,
          inventoryItemId: vendorItems.inventoryItemId,
          vendorSku: vendorItems.vendorSku,
          purchaseUnitId: vendorItems.purchaseUnitId,
          caseSize: vendorItems.caseSize,
          innerPackSize: vendorItems.innerPackSize,
          lastPrice: vendorItems.lastPrice,
          active: vendorItems.active,
        })
        .from(vendorItems)
        .innerJoin(storeInventoryItems, and(
          eq(storeInventoryItems.inventoryItemId, vendorItems.inventoryItemId),
          eq(storeInventoryItems.storeId, storeId),
          eq(storeInventoryItems.active, 1)
        ))
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      
      return result;
    }
    
    // Filter by company if provided - join with vendors table
    if (companyId) {
      const companyConditions = [eq(vendors.companyId, companyId)];
      
      // Also apply vendorId filter if provided
      if (conditions.length > 0) {
        companyConditions.push(...conditions);
      }
      
      return db
        .select({
          id: vendorItems.id,
          vendorId: vendorItems.vendorId,
          inventoryItemId: vendorItems.inventoryItemId,
          vendorSku: vendorItems.vendorSku,
          purchaseUnitId: vendorItems.purchaseUnitId,
          caseSize: vendorItems.caseSize,
          innerPackSize: vendorItems.innerPackSize,
          lastPrice: vendorItems.lastPrice,
          active: vendorItems.active,
        })
        .from(vendorItems)
        .innerJoin(vendors, eq(vendorItems.vendorId, vendors.id))
        .where(and(...companyConditions));
    }
    
    if (conditions.length > 0) {
      return db.select().from(vendorItems).where(and(...conditions));
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
  async getRecipes(companyId?: string): Promise<Recipe[]> {
    if (companyId) {
      return db.select().from(recipes).where(eq(recipes.companyId, companyId));
    }
    return db.select().from(recipes);
  }

  async getRecipe(id: string, companyId?: string): Promise<Recipe | undefined> {
    if (companyId) {
      const [recipe] = await db.select().from(recipes).where(and(eq(recipes.id, id), eq(recipes.companyId, companyId)));
      return recipe || undefined;
    }
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    return recipe || undefined;
  }

  async createRecipe(insertRecipe: InsertRecipe): Promise<Recipe> {
    const [recipe] = await db.insert(recipes).values(insertRecipe).returning();
    return recipe;
  }

  async updateRecipe(id: string, updates: Partial<Recipe>, companyId?: string): Promise<Recipe | undefined> {
    const conditions = [eq(recipes.id, id)];
    if (companyId) {
      conditions.push(eq(recipes.companyId, companyId));
    }
    const [recipe] = await db
      .update(recipes)
      .set(updates)
      .where(and(...conditions))
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
    return db.select()
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryCountId, countId))
      .orderBy(inventoryCountLines.id); // Maintain stable order by insertion (ID)
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

  // Item Usage Calculation
  async getItemUsageBetweenCounts(storeId: string, previousCountId: string, currentCountId: string): Promise<Array<{
    inventoryItemId: string;
    inventoryItemName: string;
    category: string | null;
    previousQty: number;
    receivedQty: number;
    transferredQty: number;
    currentQty: number;
    usage: number;
    unitId: string;
    unitName: string;
    pricePerUnit: number;
    isNegativeUsage: boolean;
    previousCountId: string;
    currentCountId: string;
    receiptIds: string[];
    transferOrderIds: string[];
  }>> {
    // Get both count records to retrieve their count dates
    const [previousCount] = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, previousCountId));
    const [currentCount] = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, currentCountId));

    if (!previousCount || !currentCount) {
      return [];
    }

    // Validate both counts belong to the same store and company (data isolation)
    if (previousCount.storeId !== storeId || currentCount.storeId !== storeId) {
      return [];
    }

    if (previousCount.companyId !== currentCount.companyId) {
      return [];
    }

    const companyId = previousCount.companyId;

    // CRITICAL: Verify the store actually belongs to this company to prevent cross-tenant data access
    const [store] = await db.select().from(companyStores).where(eq(companyStores.id, storeId));
    if (!store || store.companyId !== companyId) {
      return [];
    }

    // Get all count lines for previous count, aggregated by inventoryItemId
    const previousLines = await db
      .select({
        inventoryItemId: inventoryCountLines.inventoryItemId,
        totalQty: sql<number>`SUM(${inventoryCountLines.qty})`.as('total_qty'),
        unitId: inventoryCountLines.unitId,
      })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryCountId, previousCountId))
      .groupBy(inventoryCountLines.inventoryItemId, inventoryCountLines.unitId);

    // Get all count lines for current count, aggregated by inventoryItemId
    const currentLines = await db
      .select({
        inventoryItemId: inventoryCountLines.inventoryItemId,
        totalQty: sql<number>`SUM(${inventoryCountLines.qty})`.as('total_qty'),
        unitId: inventoryCountLines.unitId,
      })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryCountId, currentCountId))
      .groupBy(inventoryCountLines.inventoryItemId, inventoryCountLines.unitId);

    // Get all receipts for purchase orders delivered between the two count dates
    // Use expected delivery date (when inventory arrived) with fallback to receivedAt
    // CRITICAL: Filter by companyId to ensure multi-tenant data isolation
    const allReceipts = await db
      .select({
        inventoryItemId: vendorItems.inventoryItemId,
        receiptId: receipts.id,
        receivedQty: receiptLines.receivedQty,
        purchaseOrderId: receipts.purchaseOrderId,
        expectedDate: purchaseOrders.expectedDate,
        receivedAt: receipts.receivedAt,
      })
      .from(receiptLines)
      .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
      .innerJoin(vendorItems, eq(receiptLines.vendorItemId, vendorItems.id))
      .innerJoin(purchaseOrders, eq(receipts.purchaseOrderId, purchaseOrders.id))
      .where(
        and(
          eq(receipts.companyId, companyId),
          eq(receipts.storeId, storeId),
          inArray(receipts.status, ['locked', 'completed'])
        )
      );

    // Filter by delivery date (expectedDate if available, otherwise receivedAt)
    const receivedItems = allReceipts.filter(item => {
      const deliveryDate = item.expectedDate || item.receivedAt;
      if (!deliveryDate) return false;
      
      const deliveryTimestamp = new Date(deliveryDate).getTime();
      const startTimestamp = new Date(previousCount.countDate).getTime();
      const endTimestamp = new Date(currentCount.countDate).getTime();
      
      return deliveryTimestamp >= startTimestamp && deliveryTimestamp <= endTimestamp;
    });

    // Get all outbound transfers between the two count dates for this store
    // CRITICAL: Filter by companyId to ensure multi-tenant data isolation
    const transferredItems = await db
      .select({
        inventoryItemId: transferOrderLines.inventoryItemId,
        transferOrderId: transferOrders.id,
        shippedQty: transferOrderLines.shippedQty,
      })
      .from(transferOrderLines)
      .innerJoin(transferOrders, eq(transferOrderLines.transferOrderId, transferOrders.id))
      .where(
        and(
          eq(transferOrders.companyId, companyId),
          eq(transferOrders.fromStoreId, storeId),
          gte(transferOrders.completedAt, previousCount.countDate),
          lte(transferOrders.completedAt, currentCount.countDate),
          eq(transferOrders.status, 'completed')
        )
      );

    // Create maps for easy lookup
    const previousMap = new Map(previousLines.map(l => [l.inventoryItemId, { qty: l.totalQty, unitId: l.unitId }]));
    const currentMap = new Map(currentLines.map(l => [l.inventoryItemId, { qty: l.totalQty, unitId: l.unitId }]));
    
    // Aggregate received items by inventory item with receipt IDs
    const receivedMap = new Map<string, { qty: number; receiptIds: Set<string> }>();
    for (const item of receivedItems) {
      if (!receivedMap.has(item.inventoryItemId)) {
        receivedMap.set(item.inventoryItemId, { qty: 0, receiptIds: new Set() });
      }
      const existing = receivedMap.get(item.inventoryItemId)!;
      existing.qty += item.receivedQty;
      existing.receiptIds.add(item.receiptId);
    }

    // Aggregate transferred items by inventory item with transfer order IDs
    const transferredMap = new Map<string, { qty: number; transferOrderIds: Set<string> }>();
    for (const item of transferredItems) {
      if (!transferredMap.has(item.inventoryItemId)) {
        transferredMap.set(item.inventoryItemId, { qty: 0, transferOrderIds: new Set() });
      }
      const existing = transferredMap.get(item.inventoryItemId)!;
      existing.qty += item.shippedQty || 0;
      existing.transferOrderIds.add(item.transferOrderId);
    }

    // Get all unique inventory item IDs from all sources
    const allItemIds = new Set([
      ...Array.from(previousMap.keys()),
      ...Array.from(currentMap.keys()),
    ]);

    // Get inventory item details for all items including price
    const itemDetails = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        categoryId: inventoryItems.categoryId,
        unitId: inventoryItems.unitId,
        unitName: units.name,
        avgCostPerUnit: inventoryItems.avgCostPerUnit,
      })
      .from(inventoryItems)
      .innerJoin(units, eq(inventoryItems.unitId, units.id))
      .where(inArray(inventoryItems.id, Array.from(allItemIds)));

    const itemDetailsMap = new Map(itemDetails.map(item => [item.id, item]));

    // Calculate usage for each item
    const usageData = Array.from(allItemIds).map(itemId => {
      const item = itemDetailsMap.get(itemId);
      const previousQty = previousMap.get(itemId)?.qty || 0;
      const currentQty = currentMap.get(itemId)?.qty || 0;
      const receivedData = receivedMap.get(itemId);
      const receivedQty = receivedData?.qty || 0;
      const receiptIds = receivedData ? Array.from(receivedData.receiptIds) : [];
      const transferredData = transferredMap.get(itemId);
      const transferredQty = transferredData?.qty || 0;
      const transferOrderIds = transferredData ? Array.from(transferredData.transferOrderIds) : [];
      
      // Usage = Previous + Received - Transferred - Current
      const usage = (previousQty + receivedQty - transferredQty) - currentQty;
      const isNegativeUsage = usage < 0;

      return {
        inventoryItemId: itemId,
        inventoryItemName: item?.name || 'Unknown',
        category: item?.categoryId || null,
        previousQty,
        receivedQty,
        transferredQty,
        currentQty,
        usage,
        unitId: item?.unitId || '',
        unitName: item?.unitName || 'unit',
        pricePerUnit: item?.avgCostPerUnit || 0,
        isNegativeUsage,
        previousCountId,
        currentCountId,
        receiptIds,
        transferOrderIds,
      };
    });

    return usageData;
  }

  // Estimated On-Hand Calculation
  async getEstimatedOnHand(companyId: string, storeId: string): Promise<Array<{
    inventoryItemId: string;
    lastCountQty: number;
    lastCountDate: string | null;
    receivedQty: number;
    wasteQty: number;
    theoreticalUsageQty: number;
    transferredOutQty: number;
    transferredInQty: number;
    estimatedOnHand: number;
  }>> {
    // Get the most recent inventory count for this store
    const counts = await db
      .select()
      .from(inventoryCounts)
      .where(and(
        eq(inventoryCounts.companyId, companyId),
        eq(inventoryCounts.storeId, storeId)
      ))
      .orderBy(desc(inventoryCounts.countDate));
    
    if (counts.length === 0) {
      return [];
    }
    
    const lastCount = counts[0];
    const lastCountDate = lastCount.countDate; // Keep as Date object for WHERE clause comparisons
    
    // Convert to YYYY-MM-DD string for API response (use UTC methods)
    const year = lastCountDate.getUTCFullYear();
    const month = String(lastCountDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(lastCountDate.getUTCDate()).padStart(2, '0');
    const lastCountDateString = `${year}-${month}-${day}`;
    
    // Get all items from the last count, aggregated by inventoryItemId
    const countLines = await db
      .select({
        inventoryItemId: inventoryCountLines.inventoryItemId,
        totalQty: sql<number>`SUM(${inventoryCountLines.qty})`.as('total_qty'),
      })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryCountId, lastCount.id))
      .groupBy(inventoryCountLines.inventoryItemId);
    
    const lastCountMap = new Map(countLines.map(l => [l.inventoryItemId, l.totalQty]));
    
    // Get all receipts since the last count
    const allReceipts = await db
      .select({
        inventoryItemId: vendorItems.inventoryItemId,
        receivedQty: receiptLines.receivedQty,
        expectedDate: purchaseOrders.expectedDate,
        receivedAt: receipts.receivedAt,
      })
      .from(receiptLines)
      .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
      .innerJoin(vendorItems, eq(receiptLines.vendorItemId, vendorItems.id))
      .innerJoin(purchaseOrders, eq(receipts.purchaseOrderId, purchaseOrders.id))
      .where(
        and(
          eq(receipts.companyId, companyId),
          eq(receipts.storeId, storeId),
          inArray(receipts.status, ['locked', 'completed'])
        )
      );
    
    // Filter receipts by delivery date after last count
    const receivedItems = allReceipts.filter(item => {
      const deliveryDate = item.expectedDate || item.receivedAt;
      if (!deliveryDate) return false;
      return new Date(deliveryDate) > new Date(lastCountDate);
    });
    
    // Aggregate received quantities by item
    const receivedMap = new Map<string, number>();
    for (const item of receivedItems) {
      receivedMap.set(item.inventoryItemId, (receivedMap.get(item.inventoryItemId) || 0) + item.receivedQty);
    }
    
    // Get waste logs since last count
    const wasteLogsData = await db
      .select({
        inventoryItemId: wasteLogs.inventoryItemId,
        qty: wasteLogs.qty,
      })
      .from(wasteLogs)
      .where(
        and(
          eq(wasteLogs.companyId, companyId),
          eq(wasteLogs.storeId, storeId),
          eq(wasteLogs.wasteType, 'inventory'),
          gte(wasteLogs.wastedAt, lastCountDate)
        )
      );
    
    // Aggregate waste by item
    const wasteMap = new Map<string, number>();
    for (const waste of wasteLogsData) {
      if (waste.inventoryItemId) {
        wasteMap.set(waste.inventoryItemId, (wasteMap.get(waste.inventoryItemId) || 0) + waste.qty);
      }
    }
    
    // Get theoretical usage since last count
    // Use gt() not gte() - sales on the same day as count are excluded
    const theoreticalUsageRunsData = await db
      .select()
      .from(theoreticalUsageRuns)
      .where(
        and(
          eq(theoreticalUsageRuns.companyId, companyId),
          eq(theoreticalUsageRuns.storeId, storeId),
          gt(theoreticalUsageRuns.salesDate, lastCountDate),
          eq(theoreticalUsageRuns.status, 'completed')
        )
      );
    
    const runIds = theoreticalUsageRunsData.map(r => r.id);
    
    let theoreticalUsageLinesData: any[] = [];
    if (runIds.length > 0) {
      theoreticalUsageLinesData = await db
        .select({
          inventoryItemId: theoreticalUsageLines.inventoryItemId,
          requiredQtyBaseUnit: theoreticalUsageLines.requiredQtyBaseUnit,
        })
        .from(theoreticalUsageLines)
        .where(inArray(theoreticalUsageLines.runId, runIds));
    }
    
    // Aggregate theoretical usage by item
    const theoreticalMap = new Map<string, number>();
    for (const line of theoreticalUsageLinesData) {
      theoreticalMap.set(line.inventoryItemId, (theoreticalMap.get(line.inventoryItemId) || 0) + line.requiredQtyBaseUnit);
    }
    
    // Get outbound transfers since last count
    const transferredItems = await db
      .select({
        inventoryItemId: transferOrderLines.inventoryItemId,
        shippedQty: transferOrderLines.shippedQty,
      })
      .from(transferOrderLines)
      .innerJoin(transferOrders, eq(transferOrderLines.transferOrderId, transferOrders.id))
      .where(
        and(
          eq(transferOrders.companyId, companyId),
          eq(transferOrders.fromStoreId, storeId),
          gte(transferOrders.completedAt, lastCountDate),
          eq(transferOrders.status, 'completed')
        )
      );
    
    // Aggregate transferred quantities by item
    const transferredMap = new Map<string, number>();
    for (const item of transferredItems) {
      transferredMap.set(item.inventoryItemId, (transferredMap.get(item.inventoryItemId) || 0) + (item.shippedQty || 0));
    }
    
    // Get inbound transfers since last count (where this store is the destination)
    const transferredInItems = await db
      .select({
        inventoryItemId: transferOrderLines.inventoryItemId,
        shippedQty: transferOrderLines.shippedQty,
      })
      .from(transferOrderLines)
      .innerJoin(transferOrders, eq(transferOrderLines.transferOrderId, transferOrders.id))
      .where(
        and(
          eq(transferOrders.companyId, companyId),
          eq(transferOrders.toStoreId, storeId),
          gte(transferOrders.completedAt, lastCountDate),
          eq(transferOrders.status, 'completed')
        )
      );
    
    // Aggregate transferred in quantities by item
    const transferredInMap = new Map<string, number>();
    for (const item of transferredInItems) {
      transferredInMap.set(item.inventoryItemId, (transferredInMap.get(item.inventoryItemId) || 0) + (item.shippedQty || 0));
    }
    
    // Get all unique inventory item IDs
    const allItemIds = new Set([
      ...Array.from(lastCountMap.keys()),
      ...Array.from(receivedMap.keys()),
      ...Array.from(wasteMap.keys()),
      ...Array.from(theoreticalMap.keys()),
      ...Array.from(transferredMap.keys()),
      ...Array.from(transferredInMap.keys()),
    ]);
    
    // Calculate estimated on-hand for each item
    const estimatedOnHandData = Array.from(allItemIds).map(itemId => {
      const lastCountQty = lastCountMap.get(itemId) || 0;
      const receivedQty = receivedMap.get(itemId) || 0;
      const wasteQty = wasteMap.get(itemId) || 0;
      const theoreticalUsageQty = theoreticalMap.get(itemId) || 0;
      const transferredOutQty = transferredMap.get(itemId) || 0;
      const transferredInQty = transferredInMap.get(itemId) || 0;
      
      // Formula: On-Hand = Last Count + Received + Transferred In - Waste - Theoretical Usage - Transferred Out
      const estimatedOnHand = lastCountQty + receivedQty + transferredInQty - wasteQty - theoreticalUsageQty - transferredOutQty;
      
      return {
        inventoryItemId: itemId,
        lastCountQty,
        lastCountDate: lastCountDateString, // YYYY-MM-DD string extracted from timestamp using UTC methods
        receivedQty,
        wasteQty,
        theoreticalUsageQty,
        transferredOutQty,
        transferredInQty,
        estimatedOnHand: Math.max(0, estimatedOnHand), // Don't show negative on-hand
      };
    });
    
    return estimatedOnHandData;
  }

  // Estimated On-Hand Breakdown (detailed with dates)
  async getEstimatedOnHandBreakdown(companyId: string, storeId: string, inventoryItemId: string): Promise<{
    inventoryItemId: string;
    inventoryItemName: string;
    unitName: string;
    lastCount: {
      qty: number;
      date: string;
    } | null;
    receipts: Array<{
      date: string;
      qty: number;
      vendorName: string;
      poId: string;
    }>;
    waste: Array<{
      date: string;
      qty: number;
      reason: string;
    }>;
    theoreticalUsage: Array<{
      date: string;
      qty: number;
    }>;
    transfersOut: Array<{
      date: string;
      qty: number;
      toStoreName: string;
      transferId: string;
    }>;
    transfersIn: Array<{
      date: string;
      qty: number;
      fromStoreName: string;
      transferId: string;
    }>;
    summary: {
      lastCountQty: number;
      receivedQty: number;
      wasteQty: number;
      theoreticalUsageQty: number;
      transferredOutQty: number;
      transferredInQty: number;
      estimatedOnHand: number;
    };
  } | null> {
    // Get inventory item details
    const [item] = await db
      .select({
        id: inventoryItems.id,
        name: inventoryItems.name,
        unitName: units.name,
      })
      .from(inventoryItems)
      .leftJoin(units, eq(inventoryItems.unitId, units.id))
      .where(
        and(
          eq(inventoryItems.id, inventoryItemId),
          eq(inventoryItems.companyId, companyId)
        )
      );
    
    if (!item) return null;
    
    // Get the most recent inventory count for this store
    const counts = await db
      .select()
      .from(inventoryCounts)
      .where(and(
        eq(inventoryCounts.companyId, companyId),
        eq(inventoryCounts.storeId, storeId)
      ))
      .orderBy(desc(inventoryCounts.countDate));
    
    if (counts.length === 0) return null;
    
    const lastCount = counts[0];
    const lastCountDate = lastCount.countDate;
    
    // Helper function to convert Date to YYYY-MM-DD using UTC methods
    const toDateString = (date: Date): string => {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    // Get count quantity for this specific item
    const [countLine] = await db
      .select({
        qty: sql<number>`SUM(${inventoryCountLines.qty})`.as('total_qty'),
      })
      .from(inventoryCountLines)
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, lastCount.id),
          eq(inventoryCountLines.inventoryItemId, inventoryItemId)
        )
      )
      .groupBy(inventoryCountLines.inventoryItemId);
    
    const lastCountQty = countLine?.qty || 0;
    const lastCountInfo = {
      qty: lastCountQty,
      date: toDateString(lastCountDate),
    };
    
    // Get receipts since last count
    const receiptsData = await db
      .select({
        receivedQty: receiptLines.receivedQty,
        expectedDate: purchaseOrders.expectedDate,
        receivedAt: receipts.receivedAt,
        vendorName: vendors.name,
        poId: purchaseOrders.id,
      })
      .from(receiptLines)
      .innerJoin(receipts, eq(receiptLines.receiptId, receipts.id))
      .innerJoin(vendorItems, eq(receiptLines.vendorItemId, vendorItems.id))
      .leftJoin(purchaseOrders, eq(receipts.purchaseOrderId, purchaseOrders.id))
      .leftJoin(vendors, eq(purchaseOrders.vendorId, vendors.id))
      .where(
        and(
          eq(vendorItems.inventoryItemId, inventoryItemId),
          eq(receipts.companyId, companyId),
          eq(receipts.storeId, storeId),
          inArray(receipts.status, ['locked', 'completed'])
        )
      );
    
    // Filter and format receipts
    const formattedReceipts = receiptsData
      .filter(r => {
        const deliveryDate = r.expectedDate || r.receivedAt;
        if (!deliveryDate) return false;
        return new Date(deliveryDate) > new Date(lastCountDate);
      })
      .map(r => ({
        date: toDateString(r.expectedDate || r.receivedAt!),
        qty: r.receivedQty,
        vendorName: r.vendorName || 'Direct Receipt',
        poId: r.poId || null,
      }));
    
    // Get waste logs since last count
    const wasteData = await db
      .select({
        qty: wasteLogs.qty,
        wastedAt: wasteLogs.wastedAt,
        reasonCode: wasteLogs.reasonCode,
      })
      .from(wasteLogs)
      .where(
        and(
          eq(wasteLogs.inventoryItemId, inventoryItemId),
          eq(wasteLogs.companyId, companyId),
          eq(wasteLogs.storeId, storeId),
          eq(wasteLogs.wasteType, 'inventory'),
          gte(wasteLogs.wastedAt, lastCountDate)
        )
      );
    
    // Helper function to convert reasonCode to human-readable text
    const formatReasonCode = (code: string): string => {
      const reasonMap: Record<string, string> = {
        'SPOILED': 'Spoiled',
        'DAMAGED': 'Damaged',
        'OVERPRODUCTION': 'Overproduction',
        'DROPPED': 'Dropped',
        'EXPIRED': 'Expired',
        'CONTAMINATED': 'Contaminated',
        'OTHER': 'Other',
      };
      return reasonMap[code] || code || 'No reason provided';
    };
    
    const waste = wasteData.map(w => ({
      date: toDateString(w.wastedAt),
      qty: w.qty,
      reason: formatReasonCode(w.reasonCode),
    }));
    
    // Get theoretical usage since last count
    const theoreticalUsageRunsData = await db
      .select({
        id: theoreticalUsageRuns.id,
        salesDate: theoreticalUsageRuns.salesDate,
      })
      .from(theoreticalUsageRuns)
      .where(
        and(
          eq(theoreticalUsageRuns.companyId, companyId),
          eq(theoreticalUsageRuns.storeId, storeId),
          gt(theoreticalUsageRuns.salesDate, lastCountDate),
          eq(theoreticalUsageRuns.status, 'completed')
        )
      );
    
    const runIds = theoreticalUsageRunsData.map(r => r.id);
    
    let theoreticalUsageData: Array<{ date: string; qty: number }> = [];
    if (runIds.length > 0) {
      const lines = await db
        .select({
          runId: theoreticalUsageLines.runId,
          requiredQtyBaseUnit: theoreticalUsageLines.requiredQtyBaseUnit,
        })
        .from(theoreticalUsageLines)
        .where(
          and(
            inArray(theoreticalUsageLines.runId, runIds),
            eq(theoreticalUsageLines.inventoryItemId, inventoryItemId)
          )
        );
      
      // Group by date
      const usageByDate = new Map<string, number>();
      for (const line of lines) {
        const run = theoreticalUsageRunsData.find(r => r.id === line.runId);
        if (run) {
          const dateStr = toDateString(run.salesDate);
          usageByDate.set(dateStr, (usageByDate.get(dateStr) || 0) + line.requiredQtyBaseUnit);
        }
      }
      
      theoreticalUsageData = Array.from(usageByDate.entries()).map(([date, qty]) => ({
        date,
        qty,
      }));
    }
    
    // Get outbound transfers since last count
    const transfersOutData = await db
      .select({
        shippedQty: transferOrderLines.shippedQty,
        completedAt: transferOrders.completedAt,
        toStoreId: transferOrders.toStoreId,
        transferId: transferOrders.id,
      })
      .from(transferOrderLines)
      .innerJoin(transferOrders, eq(transferOrderLines.transferOrderId, transferOrders.id))
      .where(
        and(
          eq(transferOrderLines.inventoryItemId, inventoryItemId),
          eq(transferOrders.companyId, companyId),
          eq(transferOrders.fromStoreId, storeId),
          gte(transferOrders.completedAt, lastCountDate),
          eq(transferOrders.status, 'completed')
        )
      );
    
    // Get inbound transfers since last count (where this store is the destination)
    const transfersInData = await db
      .select({
        shippedQty: transferOrderLines.shippedQty,
        completedAt: transferOrders.completedAt,
        fromStoreId: transferOrders.fromStoreId,
        transferId: transferOrders.id,
      })
      .from(transferOrderLines)
      .innerJoin(transferOrders, eq(transferOrderLines.transferOrderId, transferOrders.id))
      .where(
        and(
          eq(transferOrderLines.inventoryItemId, inventoryItemId),
          eq(transferOrders.companyId, companyId),
          eq(transferOrders.toStoreId, storeId),
          gte(transferOrders.completedAt, lastCountDate),
          eq(transferOrders.status, 'completed')
        )
      );
    
    // Get store names for outbound transfers
    const toStoreIds = [...new Set(transfersOutData.map(t => t.toStoreId))];
    const fromStoreIds = [...new Set(transfersInData.map(t => t.fromStoreId))];
    const allStoreIds = [...new Set([...toStoreIds, ...fromStoreIds])];
    
    let storeNamesMap = new Map<string, string>();
    if (allStoreIds.length > 0) {
      const storesData = await db
        .select({
          id: companyStores.id,
          name: companyStores.name,
        })
        .from(companyStores)
        .where(inArray(companyStores.id, allStoreIds));
      
      storeNamesMap = new Map(storesData.map(s => [s.id, s.name]));
    }
    
    const transfersOut = transfersOutData
      .filter(t => t.completedAt !== null)
      .map(t => ({
        date: toDateString(t.completedAt!),
        qty: t.shippedQty || 0,
        toStoreName: storeNamesMap.get(t.toStoreId) || 'Unknown Store',
        transferId: t.transferId,
      }));
    
    const transfersIn = transfersInData
      .filter(t => t.completedAt !== null)
      .map(t => ({
        date: toDateString(t.completedAt!),
        qty: t.shippedQty || 0,
        fromStoreName: storeNamesMap.get(t.fromStoreId) || 'Unknown Store',
        transferId: t.transferId,
      }));
    
    // Calculate totals
    const receivedQty = formattedReceipts.reduce((sum, r) => sum + r.qty, 0);
    const wasteQty = waste.reduce((sum, w) => sum + w.qty, 0);
    const theoreticalUsageQty = theoreticalUsageData.reduce((sum, t) => sum + t.qty, 0);
    const transferredOutQty = transfersOut.reduce((sum, t) => sum + t.qty, 0);
    const transferredInQty = transfersIn.reduce((sum, t) => sum + t.qty, 0);
    const estimatedOnHand = Math.max(0, lastCountQty + receivedQty + transferredInQty - wasteQty - theoreticalUsageQty - transferredOutQty);
    
    return {
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      unitName: item.unitName || 'unit',
      lastCount: lastCountInfo,
      receipts: formattedReceipts,
      waste,
      theoreticalUsage: theoreticalUsageData,
      transfersOut,
      transfersIn,
      summary: {
        lastCountQty,
        receivedQty,
        wasteQty,
        theoreticalUsageQty,
        transferredOutQty,
        transferredInQty,
        estimatedOnHand,
      },
    };
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
    return db
      .select({
        id: receiptLines.id,
        receiptId: receiptLines.receiptId,
        vendorItemId: receiptLines.vendorItemId,
        receivedQty: receiptLines.receivedQty,
        unitId: receiptLines.unitId,
        priceEach: receiptLines.priceEach,
        unitName: units.name,
      })
      .from(receiptLines)
      .leftJoin(units, eq(receiptLines.unitId, units.id))
      .where(eq(receiptLines.receiptId, receiptId));
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
  async getWasteLogs(companyId: string, inventoryItemId?: string, storeId?: string, startDate?: Date, endDate?: Date): Promise<any[]> {
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
    
    const logs = await db
      .select({
        id: wasteLogs.id,
        wasteType: wasteLogs.wasteType,
        inventoryItemId: wasteLogs.inventoryItemId,
        menuItemId: wasteLogs.menuItemId,
        inventoryItemName: inventoryItems.name,
        menuItemName: menuItems.name,
        qty: wasteLogs.qty,
        unitId: wasteLogs.unitId,
        unitName: units.name,
        reasonCode: wasteLogs.reasonCode,
        notes: wasteLogs.notes,
        wastedAt: wasteLogs.wastedAt,
        totalValue: wasteLogs.totalValue,
        storeId: wasteLogs.storeId,
        storeName: companyStores.name,
      })
      .from(wasteLogs)
      .leftJoin(inventoryItems, eq(wasteLogs.inventoryItemId, inventoryItems.id))
      .leftJoin(menuItems, eq(wasteLogs.menuItemId, menuItems.id))
      .leftJoin(units, eq(wasteLogs.unitId, units.id))
      .leftJoin(companyStores, eq(wasteLogs.storeId, companyStores.id))
      .where(and(...conditions));
    
    return logs;
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
    return await db.transaction(async (tx) => {
      // Create the company
      const [company] = await tx.insert(companies).values(insertCompany).returning();
      
      // Create default categories for the new company
      await tx.insert(categories).values([
        {
          companyId: company.id,
          name: "Frozen",
          sortOrder: 1,
          showAsIngredient: 1,
        },
        {
          companyId: company.id,
          name: "Walk-In",
          sortOrder: 2,
          showAsIngredient: 1,
        },
        {
          companyId: company.id,
          name: "Dry/Pantry",
          sortOrder: 3,
          showAsIngredient: 1,
        },
      ]);
      
      return company;
    });
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

  // TFC - Dayparts
  async getDayparts(companyId: string): Promise<Daypart[]> {
    return db
      .select()
      .from(dayparts)
      .where(eq(dayparts.companyId, companyId))
      .orderBy(dayparts.sortOrder);
  }

  async getDaypart(id: string, companyId: string): Promise<Daypart | undefined> {
    const [daypart] = await db
      .select()
      .from(dayparts)
      .where(and(eq(dayparts.id, id), eq(dayparts.companyId, companyId)));
    return daypart || undefined;
  }

  async createDaypart(insertDaypart: InsertDaypart): Promise<Daypart> {
    const [daypart] = await db.insert(dayparts).values(insertDaypart).returning();
    return daypart;
  }

  async updateDaypart(id: string, companyId: string, updates: Partial<Daypart>): Promise<Daypart | undefined> {
    const [daypart] = await db
      .update(dayparts)
      .set(updates)
      .where(and(eq(dayparts.id, id), eq(dayparts.companyId, companyId)))
      .returning();
    return daypart || undefined;
  }

  // TFC - Sales Upload Batches
  async createSalesUploadBatch(batch: InsertSalesUploadBatch): Promise<SalesUploadBatch> {
    const [newBatch] = await db.insert(salesUploadBatches).values(batch).returning();
    return newBatch;
  }

  async getSalesUploadBatch(id: string, companyId: string): Promise<SalesUploadBatch | undefined> {
    const [batch] = await db
      .select()
      .from(salesUploadBatches)
      .where(and(eq(salesUploadBatches.id, id), eq(salesUploadBatches.companyId, companyId)));
    return batch || undefined;
  }

  async getSalesUploadBatches(companyId: string, storeId?: string): Promise<SalesUploadBatch[]> {
    const conditions = [eq(salesUploadBatches.companyId, companyId)];
    if (storeId) {
      conditions.push(eq(salesUploadBatches.storeId, storeId));
    }
    return db
      .select()
      .from(salesUploadBatches)
      .where(and(...conditions))
      .orderBy(salesUploadBatches.uploadedAt);
  }

  async updateSalesUploadBatchStatus(
    id: string,
    companyId: string,
    status: string,
    completedAt?: Date,
    rowsProcessed?: number,
    rowsFailed?: number,
    errorLog?: string
  ): Promise<void> {
    const updates: Partial<SalesUploadBatch> = { status };
    if (completedAt !== undefined) updates.completedAt = completedAt;
    if (rowsProcessed !== undefined) updates.rowsProcessed = rowsProcessed;
    if (rowsFailed !== undefined) updates.rowsFailed = rowsFailed;
    if (errorLog !== undefined) updates.errorLog = errorLog;

    await db
      .update(salesUploadBatches)
      .set(updates)
      .where(and(eq(salesUploadBatches.id, id), eq(salesUploadBatches.companyId, companyId)));
  }

  // TFC - Daily Menu Item Sales
  async createDailyMenuItemSales(sales: InsertDailyMenuItemSales[]): Promise<DailyMenuItemSales[]> {
    if (sales.length === 0) return [];
    return db.insert(dailyMenuItemSales).values(sales).returning();
  }

  async getDailyMenuItemSales(
    companyId: string,
    storeId: string,
    startDate: Date,
    endDate: Date
  ): Promise<DailyMenuItemSales[]> {
    return db
      .select()
      .from(dailyMenuItemSales)
      .where(
        and(
          eq(dailyMenuItemSales.companyId, companyId),
          eq(dailyMenuItemSales.storeId, storeId),
          gte(dailyMenuItemSales.salesDate, startDate),
          lte(dailyMenuItemSales.salesDate, endDate)
        )
      )
      .orderBy(dailyMenuItemSales.salesDate);
  }

  // TFC - Recipe Cost Snapshots
  async createRecipeCostSnapshot(snapshot: InsertRecipeCostSnapshot): Promise<RecipeCostSnapshot> {
    const [newSnapshot] = await db.insert(recipeCostSnapshots).values(snapshot).returning();
    return newSnapshot;
  }

  async getRecipeCostSnapshot(recipeId: string, effectiveDate: Date): Promise<RecipeCostSnapshot | undefined> {
    const [snapshot] = await db
      .select()
      .from(recipeCostSnapshots)
      .where(
        and(
          eq(recipeCostSnapshots.recipeId, recipeId),
          lte(recipeCostSnapshots.effectiveDate, effectiveDate)
        )
      )
      .orderBy(recipeCostSnapshots.effectiveDate)
      .limit(1);
    return snapshot || undefined;
  }

  // TFC - Theoretical Usage Runs
  async createTheoreticalUsageRun(run: InsertTheoreticalUsageRun): Promise<TheoreticalUsageRun> {
    const [newRun] = await db.insert(theoreticalUsageRuns).values(run).returning();
    return newRun;
  }

  async getTheoreticalUsageRun(id: string, companyId: string): Promise<TheoreticalUsageRun | undefined> {
    const [run] = await db
      .select()
      .from(theoreticalUsageRuns)
      .where(and(eq(theoreticalUsageRuns.id, id), eq(theoreticalUsageRuns.companyId, companyId)));
    return run || undefined;
  }

  async getTheoreticalUsageRuns(
    companyId: string,
    storeId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<TheoreticalUsageRun[]> {
    const conditions = [eq(theoreticalUsageRuns.companyId, companyId)];
    if (storeId) {
      conditions.push(eq(theoreticalUsageRuns.storeId, storeId));
    }
    if (startDate) {
      conditions.push(gte(theoreticalUsageRuns.salesDate, startDate));
    }
    if (endDate) {
      conditions.push(lte(theoreticalUsageRuns.salesDate, endDate));
    }
    return db
      .select()
      .from(theoreticalUsageRuns)
      .where(and(...conditions))
      .orderBy(desc(theoreticalUsageRuns.salesDate));
  }

  async updateTheoreticalUsageRun(
    id: string,
    companyId: string,
    updates: Partial<TheoreticalUsageRun>
  ): Promise<TheoreticalUsageRun | undefined> {
    const [run] = await db
      .update(theoreticalUsageRuns)
      .set(updates)
      .where(and(eq(theoreticalUsageRuns.id, id), eq(theoreticalUsageRuns.companyId, companyId)))
      .returning();
    return run || undefined;
  }

  // TFC - Theoretical Usage Lines
  async createTheoreticalUsageLines(lines: InsertTheoreticalUsageLine[]): Promise<TheoreticalUsageLine[]> {
    if (lines.length === 0) return [];
    return db.insert(theoreticalUsageLines).values(lines).returning();
  }

  async getTheoreticalUsageLines(runId: string): Promise<TheoreticalUsageLine[]> {
    return db
      .select()
      .from(theoreticalUsageLines)
      .where(eq(theoreticalUsageLines.runId, runId))
      .orderBy(theoreticalUsageLines.inventoryItemId);
  }

  async getTheoreticalUsageLinesForRuns(
    runIds: string[],
    inventoryItemId: string
  ): Promise<TheoreticalUsageLine[]> {
    if (runIds.length === 0) return [];
    
    return db
      .select()
      .from(theoreticalUsageLines)
      .where(
        and(
          inArray(theoreticalUsageLines.runId, runIds),
          eq(theoreticalUsageLines.inventoryItemId, inventoryItemId)
        )
      );
  }

  // QuickBooks - Connections
  async getQuickBooksConnection(companyId: string, storeId?: string): Promise<QuickBooksConnection | undefined> {
    // Store-level connection overrides company-level connection
    // First check for store-level connection if storeId provided
    if (storeId) {
      const [storeConnection] = await db
        .select()
        .from(quickbooksConnections)
        .where(
          and(
            eq(quickbooksConnections.companyId, companyId),
            eq(quickbooksConnections.storeId, storeId),
            eq(quickbooksConnections.isActive, 1)
          )
        );
      
      if (storeConnection) {
        return storeConnection;
      }
    }

    // Fall back to company-level connection (storeId is null)
    const [companyConnection] = await db
      .select()
      .from(quickbooksConnections)
      .where(
        and(
          eq(quickbooksConnections.companyId, companyId),
          isNull(quickbooksConnections.storeId),
          eq(quickbooksConnections.isActive, 1)
        )
      );
    
    return companyConnection || undefined;
  }

  async createQuickBooksConnection(connection: InsertQuickBooksConnection): Promise<QuickBooksConnection> {
    const [newConnection] = await db
      .insert(quickbooksConnections)
      .values(connection)
      .returning();
    return newConnection;
  }

  async updateQuickBooksConnection(id: string, companyId: string, updates: Partial<QuickBooksConnection>): Promise<QuickBooksConnection | undefined> {
    const [updated] = await db
      .update(quickbooksConnections)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(quickbooksConnections.id, id),
          eq(quickbooksConnections.companyId, companyId)
        )
      )
      .returning();
    return updated || undefined;
  }

  async updateQuickBooksTokens(
    companyId: string,
    storeId: string | null,
    tokens: { accessToken: string; refreshToken: string; accessTokenExpiresAt: Date; refreshTokenExpiresAt: Date }
  ): Promise<void> {
    const whereConditions = storeId
      ? and(
          eq(quickbooksConnections.companyId, companyId),
          eq(quickbooksConnections.storeId, storeId)
        )
      : and(
          eq(quickbooksConnections.companyId, companyId),
          isNull(quickbooksConnections.storeId)
        );

    await db
      .update(quickbooksConnections)
      .set({ ...tokens, updatedAt: new Date() })
      .where(whereConditions);
  }

  async disconnectQuickBooks(companyId: string, storeId?: string): Promise<void> {
    const whereConditions = storeId
      ? and(
          eq(quickbooksConnections.companyId, companyId),
          eq(quickbooksConnections.storeId, storeId)
        )
      : and(
          eq(quickbooksConnections.companyId, companyId),
          isNull(quickbooksConnections.storeId)
        );

    await db
      .update(quickbooksConnections)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(whereConditions);
  }

  async getAllQuickBooksConnections(): Promise<QuickBooksConnection[]> {
    // Return all active connections with non-expired refresh tokens
    const now = new Date();
    return db
      .select()
      .from(quickbooksConnections)
      .where(
        and(
          eq(quickbooksConnections.isActive, 1),
          gte(quickbooksConnections.refreshTokenExpiresAt, now)
        )
      );
  }

  async logQuickBooksTokenEvent(log: InsertQuickBooksTokenLog): Promise<void> {
    await db.insert(quickbooksTokenLogs).values(log);
  }

  // QuickBooks - Vendor Mappings
  async getQuickBooksVendorMapping(vendorId: string, companyId: string): Promise<QuickBooksVendorMapping | undefined> {
    const [mapping] = await db
      .select()
      .from(quickbooksVendorMappings)
      .where(
        and(
          eq(quickbooksVendorMappings.vendorId, vendorId),
          eq(quickbooksVendorMappings.companyId, companyId)
        )
      );
    return mapping || undefined;
  }

  async getQuickBooksVendorMappings(companyId: string): Promise<QuickBooksVendorMapping[]> {
    return db
      .select()
      .from(quickbooksVendorMappings)
      .where(eq(quickbooksVendorMappings.companyId, companyId));
  }

  async createQuickBooksVendorMapping(mapping: InsertQuickBooksVendorMapping): Promise<QuickBooksVendorMapping> {
    const [newMapping] = await db
      .insert(quickbooksVendorMappings)
      .values(mapping)
      .returning();
    return newMapping;
  }

  async updateQuickBooksVendorMapping(id: string, companyId: string, updates: Partial<QuickBooksVendorMapping>): Promise<QuickBooksVendorMapping | undefined> {
    const [updated] = await db
      .update(quickbooksVendorMappings)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(quickbooksVendorMappings.id, id),
          eq(quickbooksVendorMappings.companyId, companyId)
        )
      )
      .returning();
    return updated || undefined;
  }

  async deleteQuickBooksVendorMapping(id: string, companyId: string): Promise<void> {
    await db
      .delete(quickbooksVendorMappings)
      .where(
        and(
          eq(quickbooksVendorMappings.id, id),
          eq(quickbooksVendorMappings.companyId, companyId)
        )
      );
  }

  // QuickBooks - Sync Logs
  async getQuickBooksSyncLog(purchaseOrderId: string, companyId: string): Promise<QuickBooksSyncLog | undefined> {
    const [log] = await db
      .select()
      .from(quickbooksSyncLogs)
      .where(
        and(
          eq(quickbooksSyncLogs.purchaseOrderId, purchaseOrderId),
          eq(quickbooksSyncLogs.companyId, companyId)
        )
      )
      .orderBy(desc(quickbooksSyncLogs.createdAt));
    return log || undefined;
  }

  async getQuickBooksSyncLogs(companyId: string, syncStatus?: string): Promise<QuickBooksSyncLog[]> {
    if (syncStatus) {
      return db
        .select()
        .from(quickbooksSyncLogs)
        .where(
          and(
            eq(quickbooksSyncLogs.companyId, companyId),
            eq(quickbooksSyncLogs.syncStatus, syncStatus)
          )
        )
        .orderBy(desc(quickbooksSyncLogs.createdAt));
    }
    
    return db
      .select()
      .from(quickbooksSyncLogs)
      .where(eq(quickbooksSyncLogs.companyId, companyId))
      .orderBy(desc(quickbooksSyncLogs.createdAt));
  }

  async createQuickBooksSyncLog(log: InsertQuickBooksSyncLog): Promise<QuickBooksSyncLog> {
    const [newLog] = await db
      .insert(quickbooksSyncLogs)
      .values(log)
      .returning();
    return newLog;
  }

  async updateQuickBooksSyncLog(id: string, companyId: string, updates: Partial<QuickBooksSyncLog>): Promise<QuickBooksSyncLog | undefined> {
    const [updated] = await db
      .update(quickbooksSyncLogs)
      .set(updates)
      .where(
        and(
          eq(quickbooksSyncLogs.id, id),
          eq(quickbooksSyncLogs.companyId, companyId)
        )
      )
      .returning();
    return updated || undefined;
  }

  // Onboarding Progress
  async getOnboardingProgress(companyId: string): Promise<OnboardingProgress | undefined> {
    const [progress] = await db
      .select()
      .from(onboardingProgress)
      .where(eq(onboardingProgress.companyId, companyId));
    return progress || undefined;
  }

  async createOnboardingProgress(insertProgress: InsertOnboardingProgress): Promise<OnboardingProgress> {
    const [progress] = await db
      .insert(onboardingProgress)
      .values(insertProgress)
      .returning();
    return progress;
  }

  async updateOnboardingProgress(companyId: string, updates: Partial<OnboardingProgress>): Promise<OnboardingProgress | undefined> {
    const [updated] = await db
      .update(onboardingProgress)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(onboardingProgress.companyId, companyId))
      .returning();
    return updated || undefined;
  }

  async completeOnboarding(companyId: string): Promise<OnboardingProgress | undefined> {
    const [completed] = await db
      .update(onboardingProgress)
      .set({ 
        isCompleted: 1, 
        completedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(onboardingProgress.companyId, companyId))
      .returning();
    return completed || undefined;
  }
}

export const storage = new DatabaseStorage();
