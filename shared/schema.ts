import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("viewer"), // admin, manager, counter, viewer
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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
});

export const insertAuthSessionSchema = createInsertSchema(authSessions).omit({ id: true, createdAt: true });
export type InsertAuthSession = z.infer<typeof insertAuthSessionSchema>;
export type AuthSession = typeof authSessions.$inferSelect;

// Storage Locations
export const storageLocations = pgTable("storage_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertStorageLocationSchema = createInsertSchema(storageLocations).omit({ id: true });
export type InsertStorageLocation = z.infer<typeof insertStorageLocationSchema>;
export type StorageLocation = typeof storageLocations.$inferSelect;

// Categories
export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
});

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

// Inventory Items (replaces Products - one record per item per location)
export const inventoryItems = pgTable("inventory_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  categoryId: varchar("category_id"), // Reference to categories table
  pluSku: text("plu_sku"),
  unitId: varchar("unit_id").notNull(), // unit reference (pounds by default)
  caseSize: real("case_size").notNull().default(20), // case size in base units
  barcode: text("barcode"),
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
  pricePerUnit: real("price_per_unit").notNull().default(0), // price per base unit (case cost = pricePerUnit × caseSize)
  storageLocationId: varchar("storage_location_id").notNull(), // primary storage location
  onHandQty: real("on_hand_qty").notNull().default(0), // quantity on hand in base units
  yieldPercent: real("yield_percent"), // usable yield percentage after trimming/waste (0-100)
  imageUrl: text("image_url"),
  parLevel: real("par_level"), // target inventory level in base units
  reorderLevel: real("reorder_level"), // level at which to reorder in base units
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({ id: true, updatedAt: true }).extend({
  categoryId: z.string().optional(),
});
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItems.$inferSelect;

// Inventory Item Locations (many-to-many: items can exist in multiple storage locations)
export const inventoryItemLocations = pgTable("inventory_item_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  storageLocationId: varchar("storage_location_id").notNull(),
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

// Vendors
export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  accountNumber: text("account_number"),
});

export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true });
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
  name: text("name").notNull(),
  yieldQty: real("yield_qty").notNull(),
  yieldUnitId: varchar("yield_unit_id").notNull(),
  wastePercent: real("waste_percent").notNull().default(0),
  computedCost: real("computed_cost").notNull().default(0), // cached cost
});

export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true });
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
});

export const insertRecipeComponentSchema = createInsertSchema(recipeComponents).omit({ id: true });
export type InsertRecipeComponent = z.infer<typeof insertRecipeComponentSchema>;
export type RecipeComponent = typeof recipeComponents.$inferSelect;

// Inventory Counts
export const inventoryCounts = pgTable("inventory_counts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  countedAt: timestamp("counted_at").notNull().defaultNow(),
  storageLocationId: varchar("storage_location_id").notNull(),
  userId: varchar("user_id").notNull(),
  note: text("note"),
});

export const insertInventoryCountSchema = createInsertSchema(inventoryCounts).omit({ id: true, countedAt: true });
export type InsertInventoryCount = z.infer<typeof insertInventoryCountSchema>;
export type InventoryCount = typeof inventoryCounts.$inferSelect;

// Inventory Count Lines
export const inventoryCountLines = pgTable("inventory_count_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryCountId: varchar("inventory_count_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  qty: real("qty").notNull().default(0), // quantity in base units
  unitId: varchar("unit_id").notNull(),
  userId: varchar("user_id"),
  countedAt: timestamp("counted_at").defaultNow(),
});

export const insertInventoryCountLineSchema = createInsertSchema(inventoryCountLines).omit({ 
  id: true,
  countedAt: true
});
export type InsertInventoryCountLine = z.infer<typeof insertInventoryCountLineSchema>;
export type InventoryCountLine = typeof inventoryCountLines.$inferSelect;

// Purchase Orders
export const purchaseOrders = pgTable("purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull(),
  status: text("status").notNull().default("pending"), // pending, ordered, received
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expectedDate: timestamp("expected_date"),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true, createdAt: true });
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

// PO Lines
export const poLines = pgTable("po_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id").notNull(),
  vendorItemId: varchar("vendor_item_id").notNull(),
  orderedQty: real("ordered_qty").notNull(),
  unitId: varchar("unit_id").notNull(),
  priceEach: real("price_each").notNull(),
});

export const insertPOLineSchema = createInsertSchema(poLines).omit({ id: true });
export type InsertPOLine = z.infer<typeof insertPOLineSchema>;
export type POLine = typeof poLines.$inferSelect;

// Receipts
export const receipts = pgTable("receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id").notNull(),
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

export const insertReceiptLineSchema = createInsertSchema(receiptLines).omit({ id: true });
export type InsertReceiptLine = z.infer<typeof insertReceiptLineSchema>;
export type ReceiptLine = typeof receiptLines.$inferSelect;

// POS Sales
export const posSales = pgTable("pos_sales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull().default("main"),
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
  name: text("name").notNull(),
  pluSku: text("plu_sku").notNull().unique(),
  recipeId: varchar("recipe_id").notNull(),
  servingSizeQty: real("serving_size_qty").notNull().default(1),
  servingUnitId: varchar("serving_unit_id").notNull(),
});

export const insertMenuItemSchema = createInsertSchema(menuItems).omit({ id: true });
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type MenuItem = typeof menuItems.$inferSelect;

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

// Transfer Logs (for tracking stock movements between locations)
export const transferLogs = pgTable("transfer_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  fromLocationId: varchar("from_location_id").notNull(),
  toLocationId: varchar("to_location_id").notNull(),
  qty: real("qty").notNull(), // quantity in base units
  unitId: varchar("unit_id").notNull(),
  transferredAt: timestamp("transferred_at").notNull().defaultNow(),
  transferredBy: varchar("transferred_by"),
  reason: text("reason"),
});

export const insertTransferLogSchema = createInsertSchema(transferLogs).omit({ id: true, transferredAt: true });
export type InsertTransferLog = z.infer<typeof insertTransferLogSchema>;
export type TransferLog = typeof transferLogs.$inferSelect;

// Waste Logs (for tracking waste and spoilage)
export const wasteLogs = pgTable("waste_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  storageLocationId: varchar("storage_location_id").notNull(),
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

