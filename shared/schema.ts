import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Companies table (root entity for multi-tenant isolation)
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  contactEmail: text("contact_email"),
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country").notNull().default("US"),
  timezone: text("timezone").notNull().default("America/New_York"),
  logoImagePath: text("logo_image_path"), // Company logo image path
  tccAccountId: text("tcc_account_id").notNull().default(sql`gen_random_uuid()`), // The Chef's Companion (Thrive POS) account ID
  status: text("status").notNull().default("active"), // active, inactive, suspended
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companies)
  .omit({ id: true, createdAt: true })
  .extend({
    tccAccountId: z.string().uuid("TCC Account ID must be a valid UUID"),
  });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

// Company Stores (physical store locations for each company)
export const companyStores = pgTable("company_stores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  code: text("code").notNull(), // Store code (e.g., "S001", "S002")
  name: text("name").notNull(), // Store name (e.g., "Downtown Store", "Airport Location")
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  timezone: text("timezone"),
  tccLocationId: text("tcc_location_id"), // Thrive Control Center location ID (optional UUID)
  posLocationId: text("pos_location_id"), // POS system location identifier (e.g., "City View Pizza- Spring Garden")
  status: text("status").notNull().default("active"), // active, inactive, closed
  openedAt: timestamp("opened_at"),
  closedAt: timestamp("closed_at"),
});

export const insertCompanyStoreSchema = createInsertSchema(companyStores)
  .omit({ id: true })
  .extend({
    tccLocationId: z.preprocess(
      (val) => val === "" ? null : val,
      z.string().uuid("TCC Location ID must be a valid UUID").nullable().optional()
    ),
  });
export type InsertCompanyStore = z.infer<typeof insertCompanyStoreSchema>;
export type CompanyStore = typeof companyStores.$inferSelect;

// Store Storage Locations (storage areas within each store)
export const storeStorageLocations = pgTable("store_storage_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull(),
  name: text("name").notNull(), // e.g., "Walk-In Cooler", "Dry Storage", "Walk-In Freezer"
  type: text("type"), // cooler, freezer, dry_storage, prep_area, etc.
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: integer("is_default").notNull().default(0), // 1 if this is the default location for the store
});

export const insertStoreStorageLocationSchema = createInsertSchema(storeStorageLocations).omit({ id: true });
export type InsertStoreStorageLocation = z.infer<typeof insertStoreStorageLocationSchema>;
export type StoreStorageLocation = typeof storeStorageLocations.$inferSelect;

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("store_user"), // global_admin, company_admin, store_manager, store_user
  companyId: varchar("company_id"), // nullable for global_admin, required for all others
  firstName: text("first_name"),
  lastName: text("last_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  active: integer("active").notNull().default(1), // 1=active, 0=inactive
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// User-Store assignments (for store_manager and store_user roles)
export const userStores = pgTable("user_stores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  storeId: varchar("store_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueUserStore: unique().on(table.userId, table.storeId),
}));

export const insertUserStoreSchema = createInsertSchema(userStores).omit({ id: true, createdAt: true });
export type InsertUserStore = z.infer<typeof insertUserStoreSchema>;
export type UserStore = typeof userStores.$inferSelect;

// Auth Sessions
export const authSessions = pgTable("auth_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  selectedCompanyId: varchar("selected_company_id"), // For global_admin users to track selected company
});

export const insertAuthSessionSchema = createInsertSchema(authSessions).omit({ id: true, createdAt: true });
export type InsertAuthSession = z.infer<typeof insertAuthSessionSchema>;
export type AuthSession = typeof authSessions.$inferSelect;

// API Credentials (for HMAC authentication of inbound data feeds)
export const apiCredentials = pgTable("api_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(), // e.g., "POS System Feed", "Sysco EDI Feed"
  description: text("description"), // Optional notes about this credential
  apiKeyId: varchar("api_key_id").notNull().unique(), // Public identifier (shown to external systems)
  secretKey: text("secret_key").notNull(), // HMAC secret (encrypted at rest, never shown again after creation)
  isActive: integer("is_active").notNull().default(1), // 1=active, 0=inactive
  allowedIps: text("allowed_ips").array(), // Optional IP whitelist (e.g., ["192.168.1.100", "10.0.0.0/24"])
  lastUsedAt: timestamp("last_used_at"), // Last successful authentication timestamp
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: varchar("created_by"), // User ID who created this credential
});

export const insertApiCredentialSchema = createInsertSchema(apiCredentials)
  .omit({ id: true, createdAt: true, lastUsedAt: true })
  .extend({
    apiKeyId: z.string().min(32, "API Key ID must be at least 32 characters"),
    secretKey: z.string().min(32, "Secret key must be at least 32 characters"),
  });
export type InsertApiCredential = z.infer<typeof insertApiCredentialSchema>;
export type ApiCredential = typeof apiCredentials.$inferSelect;

// API Credential Locations (maps credentials to specific store locations)
export const apiCredentialLocations = pgTable("api_credential_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  apiCredentialId: varchar("api_credential_id").notNull(),
  storeId: varchar("store_id").notNull(), // Store location this credential can access
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueCredentialStore: unique().on(table.apiCredentialId, table.storeId),
}));

export const insertApiCredentialLocationSchema = createInsertSchema(apiCredentialLocations)
  .omit({ id: true, createdAt: true });
export type InsertApiCredentialLocation = z.infer<typeof insertApiCredentialLocationSchema>;
export type ApiCredentialLocation = typeof apiCredentialLocations.$inferSelect;

// Storage Locations
export const storageLocations = pgTable("storage_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertStorageLocationSchema = createInsertSchema(storageLocations).omit({ id: true });
export type InsertStorageLocation = z.infer<typeof insertStorageLocationSchema>;
export type StorageLocation = typeof storageLocations.$inferSelect;

// Categories
export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  showAsIngredient: integer("show_as_ingredient").notNull().default(1), // 1 if items in this category can be used as ingredients
}, (table) => ({
  uniqueCompanyCategory: unique().on(table.companyId, table.name),
}));

export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

// Units
export const units = pgTable("units", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'weight' | 'volume' | 'count'
  toBaseRatio: real("to_base_ratio").notNull(), // converts to base micro-unit
  system: text("system").notNull(), // 'imperial' | 'metric' | 'both'
});

export const insertUnitSchema = createInsertSchema(units).omit({ id: true });
export type InsertUnit = z.infer<typeof insertUnitSchema>;
export type Unit = typeof units.$inferSelect;

// Unit Conversions (for common conversions like 1 pound = 16 oz)
export const unitConversions = pgTable("unit_conversions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromUnitId: varchar("from_unit_id").notNull(),
  toUnitId: varchar("to_unit_id").notNull(),
  conversionFactor: real("conversion_factor").notNull(), // how many toUnits in 1 fromUnit
});

export const insertUnitConversionSchema = createInsertSchema(unitConversions).omit({ id: true });
export type InsertUnitConversion = z.infer<typeof insertUnitConversionSchema>;
export type UnitConversion = typeof unitConversions.$inferSelect;

// Inventory Items (company-level catalog - quantities tracked at store level)
export const inventoryItems = pgTable("inventory_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  categoryId: varchar("category_id"), // Reference to categories table
  pluSku: text("plu_sku"),
  unitId: varchar("unit_id").notNull(), // unit reference (pounds by default)
  caseSize: real("case_size").notNull().default(20), // case size in base units
  barcode: text("barcode"),
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
  pricePerUnit: real("price_per_unit").notNull().default(0), // price per base unit (case cost = pricePerUnit × caseSize)
  yieldPercent: real("yield_percent").notNull().default(95), // usable yield percentage after trimming/waste (0-100), defaults to 95%
  parLevel: real("par_level"), // default target inventory level (can be overridden at store level)
  reorderLevel: real("reorder_level"), // default reorder level (can be overridden at store level)
  imageUrl: text("image_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({ id: true, updatedAt: true }).extend({
  categoryId: z.string().optional(),
  yieldPercent: z.number().min(1).max(100).default(95),
});
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItems.$inferSelect;

// DEPRECATED: Inventory Item Locations (replaced by store_inventory_items.primaryLocationId)
// This table references the legacy global storage_locations table and breaks tenant isolation
// Location tracking is now handled at the store level via store_inventory_items table
export const inventoryItemLocations = pgTable("inventory_item_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  storageLocationId: varchar("storage_location_id").notNull(), // DEPRECATED: references global storage_locations
  isPrimary: integer("is_primary").notNull().default(0), // 1 if this is the primary location
});

export const insertInventoryItemLocationSchema = createInsertSchema(inventoryItemLocations).omit({ id: true });
export type InsertInventoryItemLocation = z.infer<typeof insertInventoryItemLocationSchema>;
export type InventoryItemLocation = typeof inventoryItemLocations.$inferSelect;

// Inventory Item Price History
export const inventoryItemPriceHistory = pgTable("inventory_item_price_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  effectiveAt: timestamp("effective_at").notNull(),
  pricePerUnit: real("price_per_unit").notNull(),
  vendorItemId: varchar("vendor_item_id"),
  note: text("note"),
  recordedBy: varchar("recorded_by"), // userId
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInventoryItemPriceHistorySchema = createInsertSchema(inventoryItemPriceHistory).omit({ id: true, createdAt: true });
export type InsertInventoryItemPriceHistory = z.infer<typeof insertInventoryItemPriceHistorySchema>;
export type InventoryItemPriceHistory = typeof inventoryItemPriceHistory.$inferSelect;

// Store Inventory Items (store-level quantities for company catalog items)
export const storeInventoryItems = pgTable("store_inventory_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(), // Denormalized for constraint enforcement
  storeId: varchar("store_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  primaryLocationId: varchar("primary_location_id"), // Primary storage location within the store
  onHandQty: real("on_hand_qty").notNull().default(0), // quantity on hand in base units
  active: integer("active").notNull().default(1), // 1 = active at this store, 0 = inactive at this store
  parLevel: real("par_level"), // target inventory level for this store
  reorderLevel: real("reorder_level"), // reorder level for this store
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueStoreItem: unique().on(table.storeId, table.inventoryItemId),
}));

export const insertStoreInventoryItemSchema = createInsertSchema(storeInventoryItems).omit({ id: true, updatedAt: true });
export type InsertStoreInventoryItem = z.infer<typeof insertStoreInventoryItemSchema>;
export type StoreInventoryItem = typeof storeInventoryItems.$inferSelect;

// Vendors
export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  accountNumber: text("account_number"),
  orderGuideType: text("order_guide_type").notNull().default("manual"), // "electronic" or "manual"
  phone: text("phone"),
  website: text("website"),
});

export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true }).extend({
  orderGuideType: z.string().min(1).default("manual"),
});
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

// Vendor Items (cross-reference)
export const vendorItems = pgTable("vendor_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  vendorSku: text("vendor_sku"),
  purchaseUnitId: varchar("purchase_unit_id").notNull(),
  caseSize: real("case_size").notNull().default(1), // number of purchase units per case
  innerPackSize: real("inner_pack_size"),
  lastPrice: real("last_price").notNull().default(0),
  leadTimeDays: integer("lead_time_days"),
  active: integer("active").notNull().default(1),
});

export const insertVendorItemSchema = createInsertSchema(vendorItems).omit({ id: true });
export type InsertVendorItem = z.infer<typeof insertVendorItemSchema>;
export type VendorItem = typeof vendorItems.$inferSelect;

// Recipes
export const recipes = pgTable("recipes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  yieldQty: real("yield_qty").notNull(),
  yieldUnitId: varchar("yield_unit_id").notNull(),
  computedCost: real("computed_cost").notNull().default(0), // cached cost
  canBeIngredient: integer("can_be_ingredient").notNull().default(0), // 1 if recipe can be used as ingredient in other recipes
});

export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true, companyId: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipes.$inferSelect;

// Recipe Components
export const recipeComponents = pgTable("recipe_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recipeId: varchar("recipe_id").notNull(),
  componentType: text("component_type").notNull(), // 'inventory_item' | 'recipe'
  componentId: varchar("component_id").notNull(), // inventory_item_id or recipe_id
  qty: real("qty").notNull(),
  unitId: varchar("unit_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0), // For drag-and-drop ordering
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRecipeComponentSchema = createInsertSchema(recipeComponents).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export type InsertRecipeComponent = z.infer<typeof insertRecipeComponentSchema>;
export type RecipeComponent = typeof recipeComponents.$inferSelect;

// Inventory Counts
export const inventoryCounts = pgTable("inventory_counts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(), // Store where count is performed
  countDate: timestamp("count_date").notNull(), // Official inventory date of record (chosen by user)
  countedAt: timestamp("counted_at").notNull().defaultNow(), // When the count session was created
  userId: varchar("user_id").notNull(),
  note: text("note"),
});

export const insertInventoryCountSchema = createInsertSchema(inventoryCounts).omit({ id: true, countedAt: true }).extend({
  countDate: z.string().transform(val => new Date(val)),
});
export type InsertInventoryCount = z.infer<typeof insertInventoryCountSchema>;
export type InventoryCount = typeof inventoryCounts.$inferSelect;

// Inventory Count Lines - Per-Location Tracking
export const inventoryCountLines = pgTable("inventory_count_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryCountId: varchar("inventory_count_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  storageLocationId: varchar("storage_location_id").notNull(), // Track qty per storage location
  qty: real("qty").notNull().default(0), // quantity in base units
  unitId: varchar("unit_id").notNull(),
  unitCost: real("unit_cost").notNull().default(0), // price per unit at time of count (snapshot)
  userId: varchar("user_id"),
  countedAt: timestamp("counted_at").defaultNow(),
}, (table) => ({
  // Ensure one line per item per location per count
  uniqueCountItemLocation: unique().on(table.inventoryCountId, table.inventoryItemId, table.storageLocationId),
}));

export const insertInventoryCountLineSchema = createInsertSchema(inventoryCountLines).omit({ 
  id: true,
  countedAt: true
});
export type InsertInventoryCountLine = z.infer<typeof insertInventoryCountLineSchema>;
export type InventoryCountLine = typeof inventoryCountLines.$inferSelect;

// Purchase Orders
export const purchaseOrders = pgTable("purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(), // Store receiving the order
  vendorId: varchar("vendor_id").notNull(),
  status: text("status").notNull().default("pending"), // pending, ordered, received
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expectedDate: timestamp("expected_date"),
  notes: text("notes"),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true, createdAt: true }).extend({
  expectedDate: z.string().nullable().optional().transform(val => val ? new Date(val) : null),
});
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

// PO Lines
export const poLines = pgTable("po_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id").notNull(),
  vendorItemId: varchar("vendor_item_id").notNull(),
  orderedQty: real("ordered_qty").notNull(),
  caseQuantity: real("case_quantity"), // For case-based ordering (non-Misc Grocery vendors)
  unitId: varchar("unit_id").notNull(),
  priceEach: real("price_each").notNull(), // Unit price (price per single unit)
});

export const insertPOLineSchema = createInsertSchema(poLines).omit({ id: true });
export type InsertPOLine = z.infer<typeof insertPOLineSchema>;
export type POLine = typeof poLines.$inferSelect;

// Receipts
export const receipts = pgTable("receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(), // Store receiving the items
  purchaseOrderId: varchar("purchase_order_id").notNull(),
  status: text("status").notNull().default("draft"), // draft, completed
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

export const insertReceiptSchema = createInsertSchema(receipts).omit({ id: true, receivedAt: true });
export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type Receipt = typeof receipts.$inferSelect;

// Receipt Lines
export const receiptLines = pgTable("receipt_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  receiptId: varchar("receipt_id").notNull(),
  vendorItemId: varchar("vendor_item_id").notNull(),
  receivedQty: real("received_qty").notNull(), // quantity in base units
  unitId: varchar("unit_id").notNull(),
  priceEach: real("price_each").notNull(),
});

export const insertReceiptLineSchema = createInsertSchema(receiptLines).omit({ id: true }).extend({
  priceEach: z.number().optional(), // Make priceEach optional since we support pricePerUnit
  pricePerUnit: z.number().optional(), // Support pricePerUnit for frontend (same as priceEach)
}).refine(data => data.priceEach !== undefined || data.pricePerUnit !== undefined, {
  message: "Either priceEach or pricePerUnit must be provided",
});
export type InsertReceiptLine = z.infer<typeof insertReceiptLineSchema>;
export type ReceiptLine = typeof receiptLines.$inferSelect;

// POS Sales
export const posSales = pgTable("pos_sales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});

export const insertPOSSaleSchema = createInsertSchema(posSales).omit({ id: true, occurredAt: true });
export type InsertPOSSale = z.infer<typeof insertPOSSaleSchema>;
export type POSSale = typeof posSales.$inferSelect;

// POS Sales Lines
export const posSalesLines = pgTable("pos_sales_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  posSalesId: varchar("pos_sales_id").notNull(),
  pluSku: text("plu_sku").notNull(),
  qtySold: real("qty_sold").notNull(),
});

export const insertPOSSalesLineSchema = createInsertSchema(posSalesLines).omit({ id: true });
export type InsertPOSSalesLine = z.infer<typeof insertPOSSalesLineSchema>;
export type POSSalesLine = typeof posSalesLines.$inferSelect;

// Menu Items
export const menuItems = pgTable("menu_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  department: text("department"), // e.g., "Pizza", "Appetizers", "Beverages"
  category: text("category"), // e.g., "Specialty Pizza*", "Chicken Fingers"
  size: text("size"), // e.g., "Lg", "Sm", blank for no size
  pluSku: text("plu_sku").notNull(), // Unique identifier: "{Item}|{Size}" or actual PLU code
  recipeId: varchar("recipe_id"), // Nullable - menu items can exist without recipes initially
  servingSizeQty: real("serving_size_qty").default(1),
  servingUnitId: varchar("serving_unit_id"), // Nullable until recipe is linked
  isRecipeItem: integer("is_recipe_item").notNull().default(1), // 0 for non-recipe items (napkins, plates)
  active: integer("active").notNull().default(1), // 0 = inactive, 1 = active
}, (table) => ({
  uniqueCompanyPlu: unique().on(table.companyId, table.pluSku),
}));

export const insertMenuItemSchema = createInsertSchema(menuItems).omit({ id: true });
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type MenuItem = typeof menuItems.$inferSelect;

// Store Menu Items (junction table - which menu items are available at which stores)
export const storeMenuItems = pgTable("store_menu_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull(),
  menuItemId: varchar("menu_item_id").notNull(),
  active: integer("active").notNull().default(1), // Store-specific active status
}, (table) => ({
  uniqueStoreMenuItem: unique().on(table.storeId, table.menuItemId),
}));

export const insertStoreMenuItemSchema = createInsertSchema(storeMenuItems).omit({ id: true });
export type InsertStoreMenuItem = z.infer<typeof insertStoreMenuItemSchema>;
export type StoreMenuItem = typeof storeMenuItems.$inferSelect;

// Recipe Versions (for cost change tracking)
export const recipeVersions = pgTable("recipe_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recipeId: varchar("recipe_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  yieldQty: real("yield_qty").notNull(),
  yieldUnitId: varchar("yield_unit_id").notNull(),
  wastePercent: real("waste_percent").notNull().default(0),
  computedCost: real("computed_cost").notNull().default(0),
  components: text("components").notNull(), // JSON string of components
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: varchar("created_by"),
  changeReason: text("change_reason"),
});

export const insertRecipeVersionSchema = createInsertSchema(recipeVersions).omit({ id: true, createdAt: true });
export type InsertRecipeVersion = z.infer<typeof insertRecipeVersionSchema>;
export type RecipeVersion = typeof recipeVersions.$inferSelect;

// Transfer Logs (for tracking stock movements between stores)
export const transferLogs = pgTable("transfer_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  fromStoreId: varchar("from_store_id").notNull(), // Source store
  toStoreId: varchar("to_store_id").notNull(), // Destination store
  qty: real("qty").notNull(), // quantity in base units
  unitId: varchar("unit_id").notNull(),
  transferredAt: timestamp("transferred_at").notNull().defaultNow(),
  transferredBy: varchar("transferred_by"),
  reason: text("reason"),
});

export const insertTransferLogSchema = createInsertSchema(transferLogs).omit({ id: true, transferredAt: true });
export type InsertTransferLog = z.infer<typeof insertTransferLogSchema>;
export type TransferLog = typeof transferLogs.$inferSelect;

// Transfer Orders (for planning and tracking inventory transfers between company stores)
export const transferOrders = pgTable("transfer_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  fromStoreId: varchar("from_store_id").notNull(), // Source company store
  toStoreId: varchar("to_store_id").notNull(), // Destination company store
  status: text("status").notNull().default("pending"), // pending, in_transit, completed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expectedDate: timestamp("expected_date"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  createdBy: varchar("created_by"),
});

export const insertTransferOrderSchema = createInsertSchema(transferOrders).omit({ id: true, createdAt: true, completedAt: true }).extend({
  expectedDate: z.coerce.date().optional(),
});
export type InsertTransferOrder = z.infer<typeof insertTransferOrderSchema>;
export type TransferOrder = typeof transferOrders.$inferSelect;

// Transfer Order Lines
export const transferOrderLines = pgTable("transfer_order_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transferOrderId: varchar("transfer_order_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  requestedQty: real("requested_qty").notNull(), // quantity in base units
  shippedQty: real("shipped_qty").default(0), // actual quantity shipped
  unitId: varchar("unit_id").notNull(),
});

export const insertTransferOrderLineSchema = createInsertSchema(transferOrderLines).omit({ id: true });
export type InsertTransferOrderLine = z.infer<typeof insertTransferOrderLineSchema>;
export type TransferOrderLine = typeof transferOrderLines.$inferSelect;

// Waste Logs (for tracking waste and spoilage)
export const wasteLogs = pgTable("waste_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(), // Store where waste occurred
  inventoryItemId: varchar("inventory_item_id").notNull(),
  qty: real("qty").notNull(), // quantity in base units
  unitId: varchar("unit_id").notNull(),
  reasonCode: text("reason_code").notNull(), // SPOILED, DAMAGED, OVERPRODUCTION, etc
  notes: text("notes"),
  wastedAt: timestamp("wasted_at").notNull().defaultNow(),
  loggedBy: varchar("logged_by"),
});

export const insertWasteLogSchema = createInsertSchema(wasteLogs).omit({ id: true, wastedAt: true });
export type InsertWasteLog = z.infer<typeof insertWasteLogSchema>;
export type WasteLog = typeof wasteLogs.$inferSelect;

// Company Settings
export const companySettings = pgTable("company_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  phone: text("phone"),
  email: text("email"),
  logoImagePath: text("logo_image_path"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySettingsSchema = createInsertSchema(companySettings).omit({ id: true, updatedAt: true });
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type CompanySettings = typeof companySettings.$inferSelect;

// System Preferences
export const systemPreferences = pgTable("system_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  unitSystem: text("unit_system").notNull().default("imperial"), // imperial or metric
  currency: text("currency").notNull().default("USD"),
  timezone: text("timezone").notNull().default("America/New_York"),
  posSystem: text("pos_system"), // square, toast, clover, custom, none
  posApiKey: text("pos_api_key"),
  posWebhookUrl: text("pos_webhook_url"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSystemPreferencesSchema = createInsertSchema(systemPreferences).omit({ id: true, updatedAt: true });
export type InsertSystemPreferences = z.infer<typeof insertSystemPreferencesSchema>;
export type SystemPreferences = typeof systemPreferences.$inferSelect;

// Vendor Credentials (for food distributor integrations)
export const vendorCredentials = pgTable("vendor_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorKey: text("vendor_key").notNull().unique(), // sysco, gfs, usfoods
  vendorName: text("vendor_name").notNull(), // Display name
  
  // API Credentials
  apiKey: text("api_key"),
  apiSecret: text("api_secret"),
  apiUrl: text("api_url"),
  username: text("username"),
  password: text("password"),
  accountNumber: text("account_number"),
  
  // EDI Configuration
  ediIsaId: text("edi_isa_id"),
  ediGsId: text("edi_gs_id"),
  ediQualifier: text("edi_qualifier"),
  as2Url: text("as2_url"),
  as2Identifier: text("as2_identifier"),
  
  // SFTP Configuration
  sftpHost: text("sftp_host"),
  sftpPort: integer("sftp_port"),
  sftpUsername: text("sftp_username"),
  sftpPassword: text("sftp_password"),
  sftpPath: text("sftp_path"),
  
  // PunchOut Configuration
  punchoutUrl: text("punchout_url"),
  punchoutDomain: text("punchout_domain"),
  punchoutIdentity: text("punchout_identity"),
  sharedSecret: text("shared_secret"),
  
  // Status
  isActive: integer("is_active").notNull().default(1), // 1 = active, 0 = inactive
  lastSyncedAt: timestamp("last_synced_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVendorCredentialsSchema = createInsertSchema(vendorCredentials).omit({ id: true, updatedAt: true });
export type InsertVendorCredentials = z.infer<typeof insertVendorCredentialsSchema>;
export type VendorCredentials = typeof vendorCredentials.$inferSelect;

// EDI Messages - Log of all EDI transmissions (sent/received)
export const ediMessages = pgTable("edi_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorKey: text("vendor_key").notNull(), // sysco, gfs, usfoods
  direction: text("direction").notNull(), // outbound, inbound
  docType: text("doc_type").notNull(), // 850 (PO), 810 (Invoice), 832 (Price Catalog), 997 (Ack)
  controlNumber: text("control_number"), // ISA control number
  status: text("status").notNull().default("pending"), // pending, sent, acknowledged, failed
  payloadJson: text("payload_json"), // JSON representation of the EDI data
  rawEdi: text("raw_edi"), // Raw X12 EDI content
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
});

export const insertEdiMessageSchema = createInsertSchema(ediMessages).omit({ id: true, createdAt: true });
export type InsertEdiMessage = z.infer<typeof insertEdiMessageSchema>;
export type EdiMessage = typeof ediMessages.$inferSelect;

// Order Guides - Metadata about fetched order guides
export const orderGuides = pgTable("order_guides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorKey: text("vendor_key").notNull(), // sysco, gfs, usfoods
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  source: text("source").notNull(), // csv, api, edi, punchout
  rowCount: integer("row_count").notNull().default(0),
  fileName: text("file_name"),
  effectiveDate: timestamp("effective_date"),
  expirationDate: timestamp("expiration_date"),
});

export const insertOrderGuideSchema = createInsertSchema(orderGuides).omit({ id: true, fetchedAt: true });
export type InsertOrderGuide = z.infer<typeof insertOrderGuideSchema>;
export type OrderGuide = typeof orderGuides.$inferSelect;

// Order Guide Lines - Product line items from order guides
export const orderGuideLines = pgTable("order_guide_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderGuideId: varchar("order_guide_id").notNull(),
  vendorSku: text("vendor_sku").notNull(),
  productName: text("product_name").notNull(),
  packSize: text("pack_size"),
  uom: text("uom"), // Unit of measure
  caseSize: real("case_size"),
  innerPack: real("inner_pack"),
  price: real("price"),
  gtin: text("gtin"), // Global Trade Item Number / UPC
  category: text("category"),
  brandName: text("brand_name"),
});

export const insertOrderGuideLineSchema = createInsertSchema(orderGuideLines).omit({ id: true });
export type InsertOrderGuideLine = z.infer<typeof insertOrderGuideLineSchema>;
export type OrderGuideLine = typeof orderGuideLines.$inferSelect;

