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

// Storage Locations
export const storageLocations = pgTable("storage_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertStorageLocationSchema = createInsertSchema(storageLocations).omit({ id: true });
export type InsertStorageLocation = z.infer<typeof insertStorageLocationSchema>;
export type StorageLocation = typeof storageLocations.$inferSelect;

// Units
export const units = pgTable("units", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'weight' | 'volume' | 'count'
  toBaseRatio: real("to_base_ratio").notNull(), // converts to base micro-unit
});

export const insertUnitSchema = createInsertSchema(units).omit({ id: true });
export type InsertUnit = z.infer<typeof insertUnitSchema>;
export type Unit = typeof units.$inferSelect;

// Products
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  category: text("category"), // Custom category entered by user
  pluSku: text("plu_sku"),
  baseUnitId: varchar("base_unit_id").notNull(), // micro-unit reference
  microUnitId: varchar("micro_unit_id").notNull(),
  microUnitsPerPurchaseUnit: real("micro_units_per_purchase_unit").notNull().default(1),
  barcode: text("barcode"),
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
  lastCost: real("last_cost").notNull().default(0), // cost per micro-unit
  storageLocationIds: text("storage_location_ids").array(), // array of storage location IDs
  yieldAmount: real("yield_amount"), // package yield/size
  yieldUnitId: varchar("yield_unit_id"), // unit for yield
  imageUrl: text("image_url"),
  parLevel: real("par_level"), // target inventory level
  reorderLevel: real("reorder_level"), // level at which to reorder
});

export const insertProductSchema = createInsertSchema(products).omit({ id: true }).extend({
  category: z.string().optional(),
  storageLocationIds: z.array(z.string()).optional(),
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

// Vendors
export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  accountNumber: text("account_number"),
});

export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true });
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

// Vendor Products (cross-reference)
export const vendorProducts = pgTable("vendor_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").notNull(),
  productId: varchar("product_id").notNull(),
  vendorSku: text("vendor_sku"),
  purchaseUnitId: varchar("purchase_unit_id").notNull(),
  caseSize: real("case_size").notNull().default(1), // number of purchase units per case
  innerPackSize: real("inner_pack_size"),
  lastPrice: real("last_price").notNull().default(0),
  leadTimeDays: integer("lead_time_days"),
  active: integer("active").notNull().default(1),
});

export const insertVendorProductSchema = createInsertSchema(vendorProducts).omit({ id: true });
export type InsertVendorProduct = z.infer<typeof insertVendorProductSchema>;
export type VendorProduct = typeof vendorProducts.$inferSelect;

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
  componentType: text("component_type").notNull(), // 'product' | 'recipe'
  componentId: varchar("component_id").notNull(), // product_id or recipe_id
  qty: real("qty").notNull(),
  unitId: varchar("unit_id").notNull(),
});

export const insertRecipeComponentSchema = createInsertSchema(recipeComponents).omit({ id: true });
export type InsertRecipeComponent = z.infer<typeof insertRecipeComponentSchema>;
export type RecipeComponent = typeof recipeComponents.$inferSelect;

// Inventory Levels
export const inventoryLevels = pgTable("inventory_levels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  productId: varchar("product_id").notNull(),
  storageLocationId: varchar("storage_location_id").notNull(),
  onHandMicroUnits: real("on_hand_micro_units").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertInventoryLevelSchema = createInsertSchema(inventoryLevels).omit({ id: true, updatedAt: true });
export type InsertInventoryLevel = z.infer<typeof insertInventoryLevelSchema>;
export type InventoryLevel = typeof inventoryLevels.$inferSelect;

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
  productId: varchar("product_id").notNull(),
  qty: real("qty").notNull(),
  unitId: varchar("unit_id").notNull(),
  derivedMicroUnits: real("derived_micro_units").notNull(), // normalized value
});

export const insertInventoryCountLineSchema = createInsertSchema(inventoryCountLines).omit({ id: true });
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
  vendorProductId: varchar("vendor_product_id").notNull(),
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
  vendorProductId: varchar("vendor_product_id").notNull(),
  receivedQty: real("received_qty").notNull(),
  unitId: varchar("unit_id").notNull(),
  priceEach: real("price_each").notNull(),
  derivedMicroUnits: real("derived_micro_units").notNull(),
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
  productId: varchar("product_id").notNull(),
  fromLocationId: varchar("from_location_id").notNull(),
  toLocationId: varchar("to_location_id").notNull(),
  qty: real("qty").notNull(),
  unitId: varchar("unit_id").notNull(),
  derivedMicroUnits: real("derived_micro_units").notNull(),
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
  productId: varchar("product_id").notNull(),
  storageLocationId: varchar("storage_location_id").notNull(),
  qty: real("qty").notNull(),
  unitId: varchar("unit_id").notNull(),
  derivedMicroUnits: real("derived_micro_units").notNull(),
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
  weightUnit: text("weight_unit").notNull().default("pound"), // pound or kilogram
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

