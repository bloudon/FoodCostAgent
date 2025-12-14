import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, unique, index } from "drizzle-orm/pg-core";
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
  posProvider: text("pos_provider"), // POS provider: thrive, toast, hungerrush, clover, other, none
  tccAccountId: text("tcc_account_id"), // The Chef's Companion (Thrive POS) account ID - only required for Thrive POS users
  preferredUnitSystem: text("preferred_unit_system").notNull().default("imperial"), // imperial, metric, or both
  status: text("status").notNull().default("active"), // active, inactive, suspended
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companies)
  .omit({ id: true, createdAt: true })
  .extend({
    posProvider: z.enum(['thrive', 'toast', 'hungerrush', 'clover', 'other', 'none']).optional(),
    tccAccountId: z.string().uuid("TCC Account ID must be a valid UUID").optional(), // Only required if posProvider is 'thrive'
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

// Users table (supports both username/password and SSO authentication)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"), // nullable for SSO users
  ssoProvider: text("sso_provider"), // "google", "github", "apple", "x", "password", null
  ssoId: text("sso_id"), // Unique ID from SSO provider (e.g., Replit's sub claim)
  profileImageUrl: text("profile_image_url"), // Profile image from SSO provider
  role: text("role").notNull().default("store_user"), // global_admin, company_admin, store_manager, store_user
  companyId: varchar("company_id"), // nullable for global_admin, required for all others
  firstName: text("first_name"),
  lastName: text("last_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  active: integer("active").notNull().default(1), // 1=active, 0=inactive
}, (table) => ({
  // Index for fast SSO lookups
  ssoProviderIdIdx: index("users_sso_provider_id_idx").on(table.ssoProvider, table.ssoId),
}));

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

// User Invitations (for inviting users to join a company via email)
export const invitations = pgTable("invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  companyId: varchar("company_id").notNull(),
  role: text("role").notNull().default("store_user"), // Role being offered (store_user, store_manager, company_admin)
  storeIds: text("store_ids").array().notNull().default(sql`'{}'::text[]`), // Store assignments for store_user/store_manager roles
  token: text("token").notNull().unique(), // Secure random token for invitation link
  invitedBy: varchar("invited_by"), // User ID who sent the invitation
  expiresAt: timestamp("expires_at").notNull(), // Invitation expiration (default: 7 days)
  acceptedAt: timestamp("accepted_at"), // When invitation was accepted (null = pending)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Index for fast lookups by email and token
  emailCompanyIdx: index("invitations_email_company_idx").on(table.email, table.companyId),
  tokenIdx: index("invitations_token_idx").on(table.token),
}));

export const insertInvitationSchema = createInsertSchema(invitations).omit({ id: true, createdAt: true });
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Invitation = typeof invitations.$inferSelect;

// SSO Sessions table (for Passport.js session storage)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: text("sess").notNull(), // Store as text instead of jsonb for compatibility
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Auth Sessions (for username/password authentication)
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
}, (table) => ({
  // Optimize auth lookups and session cleanup queries
  userIdIdx: index("auth_sessions_user_id_idx").on(table.userId),
  expiresAtIdx: index("auth_sessions_expires_at_idx").on(table.expiresAt),
  tokenHashIdx: index("auth_sessions_token_hash_idx").on(table.tokenHash),
}));

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
  allowCaseCounting: integer("allow_case_counting").notNull().default(0), // 1 if items in this location should show case count fields
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
  isTareWeightCategory: integer("is_tare_weight_category").notNull().default(0), // 1 if this is a tare weight category (enables case counting)
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
  abbreviation: text("abbreviation").notNull(), // 'lb', 'oz', 'g', 'ml', 'tsp', 'tbsp', 'ea', etc.
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
  pricePerUnit: real("price_per_unit").notNull().default(0), // most recent price per base unit (last cost method)
  avgCostPerUnit: real("avg_cost_per_unit").notNull().default(0), // weighted average cost per base unit
  yieldPercent: real("yield_percent").notNull().default(95), // usable yield percentage after trimming/waste (0-100), defaults to 95%
  parLevel: real("par_level"), // default target inventory level (can be overridden at store level)
  reorderLevel: real("reorder_level"), // default reorder level (can be overridden at store level)
  imageUrl: text("image_url"),
  isPowerItem: integer("is_power_item").notNull().default(0), // 1 = high-cost power item for frequent tracking
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Optimize company-scoped inventory queries
  companyActiveIdx: index("inventory_items_company_active_idx").on(table.companyId, table.active),
  companyNameIdx: index("inventory_items_company_name_idx").on(table.companyId, table.name),
}));

export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({ id: true, updatedAt: true }).extend({
  categoryId: z.string().nullable().optional(),
  unitId: z.string().min(1, "Unit is required"),
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
  // Optimize store-scoped inventory lookups
  storeActiveIdx: index("store_inventory_items_store_active_idx").on(table.storeId, table.active),
  companyStoreIdx: index("store_inventory_items_company_store_idx").on(table.companyId, table.storeId),
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
  deliveryDays: text("delivery_days").array(), // Days of week when vendor delivers (e.g., ["Monday", "Wednesday", "Friday"])
  leadDaysAhead: integer("lead_days_ahead"), // Number of days ahead to place orders before delivery
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
  taxId: text("tax_id"), // Tax ID / EIN for 1099 reporting
  requires1099: integer("requires_1099").notNull().default(0), // 1 = requires 1099, 0 = does not require
  paymentTerms: text("payment_terms"), // e.g., "Net 30", "COD", "Net 15"
  creditLimit: real("credit_limit"), // Maximum credit limit
  certifications: text("certifications").array(), // e.g., ["Organic", "Kosher", "Halal", "Non-GMO"]
  qbVendorId: text("qb_vendor_id"), // QuickBooks vendor ID (if synced from QB)
  sourceOfTruth: text("source_of_truth").notNull().default("manual"), // "quickbooks" or "manual" - indicates which system manages core fields
  lastSyncAt: timestamp("last_sync_at"), // Timestamp of last sync from QuickBooks
  syncStatus: text("sync_status"), // "synced", "conflict", "error", "pending", null for manual vendors
});

export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true }).extend({
  orderGuideType: z.string().min(1).default("manual"),
  deliveryDays: z.array(z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])).optional(),
  leadDaysAhead: z.number().int().min(0).max(30).optional(),
  active: z.number().int().min(0).max(1).default(1).optional(),
  requires1099: z.number().int().min(0).max(1).default(0).optional(),
  creditLimit: z.number().min(0).optional(),
  certifications: z.array(z.string()).optional(),
  qbVendorId: z.string().optional(),
  sourceOfTruth: z.enum(["quickbooks", "manual"]).default("manual").optional(),
  lastSyncAt: z.date().optional(),
  syncStatus: z.enum(["synced", "conflict", "error", "pending"]).optional(),
});
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

// Store-Vendor Assignments (many-to-many linking vendors to stores)
export const storeVendors = pgTable("store_vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").notNull(),
  vendorId: varchar("vendor_id").notNull(),
  isPrimary: integer("is_primary").notNull().default(0), // 1 = primary vendor for this store
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
  accountNumber: text("account_number"), // Store-specific vendor account number (optional)
}, (table) => ({
  storeIdx: index("store_vendors_store_idx").on(table.storeId),
  vendorIdx: index("store_vendors_vendor_idx").on(table.vendorId),
  uniqueStoreVendor: index("store_vendors_unique_idx").on(table.storeId, table.vendorId),
}));

export const insertStoreVendorSchema = createInsertSchema(storeVendors).omit({ id: true }).extend({
  accountNumber: z.string().optional(),
});
export type InsertStoreVendor = z.infer<typeof insertStoreVendorSchema>;
export type StoreVendor = typeof storeVendors.$inferSelect;

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
  isPlaceholder: integer("is_placeholder").notNull().default(0), // 1 if this is a placeholder/seed recipe that needs to be properly built
  parentRecipeId: varchar("parent_recipe_id"), // For size variants - links to the parent/base recipe
  sizeName: text("size_name"), // Size variant name (e.g., "Small", "Large")
  isActive: integer("is_active").notNull().default(1), // 1 = active, 0 = inactive (deactivated recipes hidden from normal views)
});

export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true, companyId: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipes.$inferSelect;

// Store Recipes (junction table - which recipes are available at which stores)
export const storeRecipes = pgTable("store_recipes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(), // Denormalized for constraint enforcement
  storeId: varchar("store_id").notNull(),
  recipeId: varchar("recipe_id").notNull(),
  active: integer("active").notNull().default(1), // Store-specific active status
}, (table) => ({
  uniqueStoreRecipe: unique().on(table.storeId, table.recipeId),
}));

export const insertStoreRecipeSchema = createInsertSchema(storeRecipes).omit({ id: true });
export type InsertStoreRecipe = z.infer<typeof insertStoreRecipeSchema>;
export type StoreRecipe = typeof storeRecipes.$inferSelect;

// Recipe Components
export const recipeComponents = pgTable("recipe_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recipeId: varchar("recipe_id").notNull(),
  componentType: text("component_type").notNull(), // 'inventory_item' | 'recipe'
  componentId: varchar("component_id").notNull(), // inventory_item_id or recipe_id
  qty: real("qty").notNull(),
  unitId: varchar("unit_id").notNull(),
  yieldOverride: real("yield_override"), // Optional yield % override (0-100) for this ingredient in this recipe
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
  countDate: timestamp("count_date").notNull(), // Official inventory date (stored as local midnight)
  countedAt: timestamp("counted_at").notNull().defaultNow(), // When the count session was created (local time)
  userId: varchar("user_id").notNull(),
  note: text("note"),
  applied: integer("applied").notNull().default(0), // 0 = not applied, 1 = applied to on-hand quantities
  appliedAt: timestamp("applied_at"), // When the count was applied (local time)
  appliedBy: varchar("applied_by"), // User who applied the count
  isPowerSession: integer("is_power_session").notNull().default(0), // 1 = power inventory session (only power items)
});

export const insertInventoryCountSchema = createInsertSchema(inventoryCounts).omit({ id: true, countedAt: true }).extend({
  countDate: z.string().transform(val => {
    // Convert YYYY-MM-DD string to Date at midnight UTC to avoid timezone shifts
    const [year, month, day] = val.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }),
});
export type InsertInventoryCount = z.infer<typeof insertInventoryCountSchema>;
export type InventoryCount = typeof inventoryCounts.$inferSelect;

// Inventory Count Lines - Per-Location Tracking
export const inventoryCountLines = pgTable("inventory_count_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryCountId: varchar("inventory_count_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  storageLocationId: varchar("storage_location_id").notNull(), // Track qty per storage location
  qty: real("qty").notNull().default(0), // quantity in base units (calculated from caseQty + looseUnits or entered directly)
  caseQty: real("case_qty"), // number of full cases (for case counting)
  looseUnits: real("loose_units"), // number of loose units from opened cases (for case counting)
  unitId: varchar("unit_id").notNull(),
  unitCost: real("unit_cost").notNull().default(0), // price per unit at time of count (snapshot)
  userId: varchar("user_id"),
  countedAt: timestamp("counted_at").defaultNow(),
}, (table) => ({
  // Ensure one line per item per location per count
  uniqueCountItemLocation: unique().on(table.inventoryCountId, table.inventoryItemId, table.storageLocationId),
  // Optimize count line queries
  countIdIdx: index("inventory_count_lines_count_id_idx").on(table.inventoryCountId),
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
}, (table) => ({
  // Optimize PO queries by company, store, and status
  companyStoreStatusIdx: index("purchase_orders_company_store_status_idx").on(table.companyId, table.storeId, table.status),
  createdAtIdx: index("purchase_orders_created_at_idx").on(table.createdAt),
}));

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true, createdAt: true }).extend({
  expectedDate: z.string().min(1, "Expected date is required").transform(val => new Date(val)),
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
  receivedBy: varchar("received_by"), // User who received/completed the order
}, (table) => ({
  // Optimize receipt queries by company, store, and date
  companyStoreReceivedIdx: index("receipts_company_store_received_idx").on(table.companyId, table.storeId, table.receivedAt),
  poIdIdx: index("receipts_po_id_idx").on(table.purchaseOrderId),
}));

export const insertReceiptSchema = createInsertSchema(receipts).omit({ id: true, receivedAt: true, receivedBy: true });
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
}, (table) => ({
  // Optimize POS sales queries by company, store, and date
  companyStoreOccurredIdx: index("pos_sales_company_store_occurred_idx").on(table.companyId, table.storeId, table.occurredAt),
}));

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

// Menu Item Sizes - Managed size options for menu items
// Global defaults seeded for all companies, plus company-specific custom sizes
export const menuItemSizes = pgTable("menu_item_sizes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id"), // Null for global defaults that apply to all companies
  name: text("name").notNull(), // "One Size", "Large", "Medium", "Small", "Lunch", "Kids"
  sortOrder: integer("sort_order").notNull().default(0),
  isDefault: integer("is_default").notNull().default(0), // 1 = "One Size" (no variants needed)
  active: integer("active").notNull().default(1),
}, (table) => ({
  uniqueCompanyName: unique().on(table.companyId, table.name),
}));

export const insertMenuItemSizeSchema = createInsertSchema(menuItemSizes).omit({ id: true });
export type InsertMenuItemSize = z.infer<typeof insertMenuItemSizeSchema>;
export type MenuItemSize = typeof menuItemSizes.$inferSelect;

// Menu Items - Hierarchical structure: Parent menu items can have size variants (children)
// Single-sized items: parentMenuItemId = null, size = null (or a default size)
// Multi-sized items: Parent has parentMenuItemId = null, children have parentMenuItemId pointing to parent
export const menuItems = pgTable("menu_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  department: text("department"), // e.g., "Pizza", "Appetizers", "Beverages"
  category: text("category"), // e.g., "Specialty Pizza*", "Chicken Fingers"
  size: text("size"), // Legacy field - e.g., "Lg", "Sm", kept for backwards compatibility
  menuItemSizeId: varchar("menu_item_size_id"), // Links to managed size (null for variant group parents)
  pluSku: text("plu_sku").notNull(), // Unique identifier: "{Item}|{Size}" or actual PLU code
  parentMenuItemId: varchar("parent_menu_item_id"), // For size variants - links to parent menu item (null for parent/single items)
  recipeId: varchar("recipe_id"), // Nullable - menu items can exist without recipes initially
  servingSizeQty: real("serving_size_qty").default(1),
  servingUnitId: varchar("serving_unit_id"), // Nullable until recipe is linked
  isRecipeItem: integer("is_recipe_item").notNull().default(1), // 0 for non-recipe items (napkins, plates)
  active: integer("active").notNull().default(1), // 0 = inactive, 1 = active
  price: real("price"), // Menu item price (nullable until set)
  sortOrder: integer("sort_order").notNull().default(0), // For ordering size variants
}, (table) => ({
  uniqueCompanyPlu: unique().on(table.companyId, table.pluSku),
  parentMenuItemIdx: index("menu_items_parent_idx").on(table.parentMenuItemId),
  menuItemSizeIdx: index("menu_items_size_idx").on(table.menuItemSizeId),
}));

export const insertMenuItemSchema = createInsertSchema(menuItems).omit({ id: true });
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type MenuItem = typeof menuItems.$inferSelect;

// Store Menu Items (junction table - which menu items are available at which stores)
export const storeMenuItems = pgTable("store_menu_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(), // Denormalized for constraint enforcement
  storeId: varchar("store_id").notNull(),
  menuItemId: varchar("menu_item_id").notNull(),
  active: integer("active").notNull().default(1), // Store-specific active status
}, (table) => ({
  uniqueStoreMenuItem: unique().on(table.storeId, table.menuItemId),
}));

export const insertStoreMenuItemSchema = createInsertSchema(storeMenuItems).omit({ id: true });
export type InsertStoreMenuItem = z.infer<typeof insertStoreMenuItemSchema>;
export type StoreMenuItem = typeof storeMenuItems.$inferSelect;

// ============ THEORETICAL FOOD COST (TFC) MODULE ============

// Dayparts (configurable meal periods for sales analysis)
export const dayparts = pgTable("dayparts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(), // "Breakfast", "Lunch", "Dinner", "Late Night"
  startTime: text("start_time"), // "06:00" (24-hour format, nullable for all-day)
  endTime: text("end_time"), // "11:00" (24-hour format, nullable for all-day)
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
}, (table) => ({
  uniqueCompanyName: unique().on(table.companyId, table.name),
}));

export const insertDaypartSchema = createInsertSchema(dayparts).omit({ id: true });
export type InsertDaypart = z.infer<typeof insertDaypartSchema>;
export type Daypart = typeof dayparts.$inferSelect;

// Sales Upload Batches (tracks CSV ingestion metadata)
export const salesUploadBatches = pgTable("sales_upload_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(),
  uploadedBy: varchar("uploaded_by").notNull(), // user ID
  fileName: text("file_name").notNull(),
  salesDate: timestamp("sales_date").notNull(), // Date of sales in batch (stored as local midnight)
  daypartId: varchar("daypart_id"), // Nullable for all-day aggregates
  status: text("status").notNull().default("processing"), // processing, completed, failed
  rowsProcessed: integer("rows_processed").notNull().default(0),
  rowsFailed: integer("rows_failed").notNull().default(0),
  errorLog: text("error_log"), // JSON array of error messages
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  companyStoreDateIdx: index("sales_batches_company_store_date_idx").on(table.companyId, table.storeId, table.salesDate),
}));

export const insertSalesUploadBatchSchema = createInsertSchema(salesUploadBatches).omit({ id: true, uploadedAt: true });
export type InsertSalesUploadBatch = z.infer<typeof insertSalesUploadBatchSchema>;
export type SalesUploadBatch = typeof salesUploadBatches.$inferSelect;

// Daily Menu Item Sales (aggregated sales by menu item, day, daypart)
export const dailyMenuItemSales = pgTable("daily_menu_item_sales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(),
  menuItemId: varchar("menu_item_id").notNull(),
  salesDate: timestamp("sales_date").notNull(), // Date of sales (stored as local midnight)
  daypartId: varchar("daypart_id"), // Nullable for all-day aggregates
  qtySold: real("qty_sold").notNull(),
  netSales: real("net_sales").notNull().default(0), // Total revenue (price * qty)
  sourceBatchId: varchar("source_batch_id").notNull(), // FK to sales_upload_batches
}, (table) => ({
  // Idempotency: one aggregate row per company/store/menuItem/date/daypart/batch
  uniqueSaleAggregate: unique().on(table.companyId, table.storeId, table.menuItemId, table.salesDate, table.daypartId, table.sourceBatchId),
  companyStoreDateIdx: index("daily_sales_company_store_date_idx").on(table.companyId, table.storeId, table.salesDate),
}));

export const insertDailyMenuItemSalesSchema = createInsertSchema(dailyMenuItemSales).omit({ id: true });
export type InsertDailyMenuItemSales = z.infer<typeof insertDailyMenuItemSalesSchema>;
export type DailyMenuItemSales = typeof dailyMenuItemSales.$inferSelect;

// Recipe Cost Snapshots (captures recipe cost at point in time for variance analysis)
export const recipeCostSnapshots = pgTable("recipe_cost_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recipeId: varchar("recipe_id").notNull(),
  companyId: varchar("company_id").notNull(),
  effectiveDate: timestamp("effective_date").notNull(), // Date this cost is effective (stored as local midnight)
  computedCost: real("computed_cost").notNull(), // Snapshot of recipe.computedCost
  yieldQty: real("yield_qty").notNull(), // Snapshot of recipe.yieldQty
  yieldUnitId: varchar("yield_unit_id").notNull(), // Snapshot of recipe.yieldUnitId
  costPerServing: real("cost_per_serving").notNull(), // computedCost / yieldQty (normalized to serving)
  menuItemId: varchar("menu_item_id"), // Optional link to specific menu item
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  recipeEffectiveDateIdx: index("recipe_snapshots_recipe_date_idx").on(table.recipeId, table.effectiveDate),
  uniqueRecipeDate: unique().on(table.recipeId, table.effectiveDate), // One snapshot per recipe per day
}));

export const insertRecipeCostSnapshotSchema = createInsertSchema(recipeCostSnapshots).omit({ id: true, createdAt: true });
export type InsertRecipeCostSnapshot = z.infer<typeof insertRecipeCostSnapshotSchema>;
export type RecipeCostSnapshot = typeof recipeCostSnapshots.$inferSelect;

// Theoretical Usage Runs (execution logs for theoretical usage calculations)
export const theoreticalUsageRuns = pgTable("theoretical_usage_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(),
  salesDate: timestamp("sales_date").notNull(), // Date being calculated (stored as local midnight)
  sourceBatchId: varchar("source_batch_id").notNull(), // FK to sales_upload_batches
  status: text("status").notNull().default("running"), // running, completed, failed
  itemsProcessed: integer("items_processed").notNull().default(0),
  totalMenuItemsSold: integer("total_menu_items_sold").notNull().default(0), // Total quantity of menu items sold
  totalRevenue: real("total_revenue").notNull().default(0), // Total sales revenue
  totalTheoreticalCost: real("total_theoretical_cost").notNull().default(0), // Total cost using last cost
  totalTheoreticalCostWAC: real("total_theoretical_cost_wac").notNull().default(0), // Total cost using WAC
  errorLog: text("error_log"), // JSON array of calculation errors
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  companyStoreDateIdx: index("usage_runs_company_store_date_idx").on(table.companyId, table.storeId, table.salesDate),
}));

export const insertTheoreticalUsageRunSchema = createInsertSchema(theoreticalUsageRuns).omit({ id: true, startedAt: true });
export type InsertTheoreticalUsageRun = z.infer<typeof insertTheoreticalUsageRunSchema>;
export type TheoreticalUsageRun = typeof theoreticalUsageRuns.$inferSelect;

// Theoretical Usage Lines (inventory items required based on recipe explosion)
export const theoreticalUsageLines = pgTable("theoretical_usage_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull(), // FK to theoretical_usage_runs
  inventoryItemId: varchar("inventory_item_id").notNull(),
  requiredQtyBaseUnit: real("required_qty_base_unit").notNull(), // Quantity in inventory item's base unit
  baseUnitId: varchar("base_unit_id").notNull(), // Inventory item's base unit
  costAtSale: real("cost_at_sale").notNull(), // Cost using snapshot price (pricePerUnit or avgCostPerUnit)
  sourceMenuItems: text("source_menu_items").notNull(), // JSON array of {menuItemId, menuItemName, qtySold}
}, (table) => ({
  runInventoryIdx: index("usage_lines_run_inventory_idx").on(table.runId, table.inventoryItemId),
}));

export const insertTheoreticalUsageLineSchema = createInsertSchema(theoreticalUsageLines).omit({ id: true });
export type InsertTheoreticalUsageLine = z.infer<typeof insertTheoreticalUsageLineSchema>;
export type TheoreticalUsageLine = typeof theoreticalUsageLines.$inferSelect;

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
}, (table) => ({
  // Optimize transfer log queries by company, stores, and date
  companyFromStoreTransferredIdx: index("transfer_logs_company_from_store_transferred_idx").on(table.companyId, table.fromStoreId, table.transferredAt),
  companyToStoreTransferredIdx: index("transfer_logs_company_to_store_transferred_idx").on(table.companyId, table.toStoreId, table.transferredAt),
}));

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
  createdBy: varchar("created_by"), // User who created the transfer order
  executedBy: varchar("executed_by"), // User who executed/shipped the transfer
  receivedBy: varchar("received_by"), // User who received/completed the transfer
});

export const insertTransferOrderSchema = createInsertSchema(transferOrders).omit({ id: true, createdAt: true, completedAt: true, executedBy: true, receivedBy: true }).extend({
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
  wasteType: text("waste_type").notNull(), // 'inventory' or 'menu_item'
  inventoryItemId: varchar("inventory_item_id"), // For inventory waste (nullable)
  menuItemId: varchar("menu_item_id"), // For menu item waste (nullable)
  qty: real("qty").notNull(), // quantity wasted (menu items = count, inventory = base units)
  unitId: varchar("unit_id"), // Unit for inventory waste (nullable for menu items)
  totalValue: real("total_value").notNull().default(0), // Calculated dollar value of waste
  reasonCode: text("reason_code").notNull(), // SPOILED, DAMAGED, OVERPRODUCTION, DROPPED, etc
  notes: text("notes"),
  wastedAt: timestamp("wasted_at").notNull().defaultNow(),
  loggedBy: varchar("logged_by"),
}, (table) => ({
  // Optimize waste log queries by company, store, and date (critical for date-filtered reports)
  companyStoreWastedIdx: index("waste_logs_company_store_wasted_idx").on(table.companyId, table.storeId, table.wastedAt),
  wasteTypeIdx: index("waste_logs_waste_type_idx").on(table.wasteType),
}));

export const insertWasteLogSchema = createInsertSchema(wasteLogs).omit({ id: true, wastedAt: true });
export type InsertWasteLog = z.infer<typeof insertWasteLogSchema>;
export type WasteLog = typeof wasteLogs.$inferSelect;

// API schema for waste creation (frontend sends this, backend adds companyId, totalValue, loggedBy)
export const createWasteLogSchema = insertWasteLogSchema.omit({ 
  companyId: true, 
  totalValue: true, 
  loggedBy: true 
});
export type CreateWasteLog = z.infer<typeof createWasteLogSchema>;

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
  companyId: varchar("company_id").notNull(), // Multi-tenant isolation
  vendorId: varchar("vendor_id"), // Reference to vendor (nullable for legacy imports)
  vendorKey: text("vendor_key").notNull(), // sysco, gfs, usfoods
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  source: text("source").notNull(), // csv, api, edi, punchout
  rowCount: integer("row_count").notNull().default(0),
  fileName: text("file_name"),
  effectiveDate: timestamp("effective_date"),
  expirationDate: timestamp("expiration_date"),
  status: text("status").notNull().default("pending_review"), // pending_review, approved, rejected
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by"), // User ID who approved
}, (table) => ({
  companyIdx: index("order_guides_company_idx").on(table.companyId),
  vendorIdx: index("order_guides_vendor_idx").on(table.vendorId),
}));

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
  caseSize: real("case_size"),             // Parsed numeric case size for calculations
  caseSizeRaw: text("case_size_raw"),      // Original vendor pack string (e.g., "6/5 LB")
  innerPack: real("inner_pack"),           // Parsed numeric inner pack for calculations
  innerPackRaw: text("inner_pack_raw"),    // Original vendor inner pack string
  price: real("price"),
  gtin: text("gtin"), // Global Trade Item Number / UPC
  category: text("category"),
  brandName: text("brand_name"),
  // Matching workflow fields
  matchStatus: text("match_status").notNull().default("pending"), // auto_matched, needs_review, new_item, user_confirmed, user_rejected
  matchedInventoryItemId: varchar("matched_inventory_item_id"), // Nullable - linked inventory item
  matchConfidence: real("match_confidence"), // 0-100 confidence score
  userDecision: text("user_decision"), // approved, rejected, create_new, null=pending
  createdInventoryItemId: varchar("created_inventory_item_id"), // If new inventory item was created from this line
}, (table) => ({
  orderGuideIdx: index("order_guide_lines_guide_idx").on(table.orderGuideId),
  matchedItemIdx: index("order_guide_lines_matched_idx").on(table.matchedInventoryItemId),
}));

export const insertOrderGuideLineSchema = createInsertSchema(orderGuideLines).omit({ id: true });
export type InsertOrderGuideLine = z.infer<typeof insertOrderGuideLineSchema>;
export type OrderGuideLine = typeof orderGuideLines.$inferSelect;

// Order Guide Store Assignments (many-to-many linking order guides to stores)
export const orderGuideStores = pgTable("order_guide_stores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderGuideId: varchar("order_guide_id").notNull(),
  storeId: varchar("store_id").notNull(),
}, (table) => ({
  orderGuideIdx: index("order_guide_stores_guide_idx").on(table.orderGuideId),
  storeIdx: index("order_guide_stores_store_idx").on(table.storeId),
  uniqueGuideStore: index("order_guide_stores_unique_idx").on(table.orderGuideId, table.storeId),
}));

export const insertOrderGuideStoreSchema = createInsertSchema(orderGuideStores).omit({ id: true });
export type InsertOrderGuideStore = z.infer<typeof insertOrderGuideStoreSchema>;
export type OrderGuideStore = typeof orderGuideStores.$inferSelect;

// QuickBooks Connections (company or store level - company overrides store)
export const quickbooksConnections = pgTable("quickbooks_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(), // Always required for multi-tenant isolation
  storeId: varchar("store_id"), // If null, this is a company-level connection
  realmId: text("realm_id").notNull(), // QuickBooks company ID
  accessToken: text("access_token").notNull(), // Encrypted in storage layer
  refreshToken: text("refresh_token").notNull(), // Encrypted in storage layer
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(),
  isActive: integer("is_active").notNull().default(1), // 1=active, 0=disconnected
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Ensure one connection per company or per store
  companyStoreIdx: index("qb_connections_company_store_idx").on(table.companyId, table.storeId),
}));

export const insertQuickBooksConnectionSchema = createInsertSchema(quickbooksConnections)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuickBooksConnection = z.infer<typeof insertQuickBooksConnectionSchema>;
export type QuickBooksConnection = typeof quickbooksConnections.$inferSelect;

// QuickBooks Vendor Mappings (vendor sync and reconciliation)
export const quickbooksVendorMappings = pgTable("quickbooks_vendor_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  vendorId: varchar("vendor_id").notNull(), // Our vendor ID
  quickbooksVendorId: text("quickbooks_vendor_id").notNull(), // QB vendor ID
  quickbooksVendorName: text("quickbooks_vendor_name").notNull(), // QB vendor display name (cached for display)
  lastSyncAt: timestamp("last_sync_at"), // Timestamp of last sync from QuickBooks
  syncStatus: text("sync_status"), // "synced", "conflict", "error", "pending"
  conflictFlag: integer("conflict_flag").notNull().default(0), // 1 if there's a conflict that needs resolution, 0 otherwise
  conflictDetails: text("conflict_details"), // JSON string describing the conflict
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Ensure one mapping per vendor per company
  uniqueVendorMapping: unique().on(table.companyId, table.vendorId),
  vendorIdx: index("qb_vendor_mappings_vendor_idx").on(table.vendorId),
}));

export const insertQuickBooksVendorMappingSchema = createInsertSchema(quickbooksVendorMappings)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    lastSyncAt: z.date().optional(),
    syncStatus: z.enum(["synced", "conflict", "error", "pending"]).optional(),
    conflictFlag: z.number().int().min(0).max(1).default(0).optional(),
    conflictDetails: z.string().optional(),
  });
export type InsertQuickBooksVendorMapping = z.infer<typeof insertQuickBooksVendorMappingSchema>;
export type QuickBooksVendorMapping = typeof quickbooksVendorMappings.$inferSelect;

// QuickBooks Sync Logs (tracks all sync attempts with retry logic)
export const quickbooksSyncLogs = pgTable("quickbooks_sync_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  purchaseOrderId: varchar("purchase_order_id").notNull(), // PO being synced
  quickbooksBillId: text("quickbooks_bill_id"), // QB bill ID (null if sync failed)
  syncStatus: text("sync_status").notNull(), // 'pending', 'success', 'failed', 'retry_exhausted'
  attemptCount: integer("attempt_count").notNull().default(0), // Number of attempts (max 2: original + 1 retry)
  errorMessage: text("error_message"), // Error details if failed
  errorCode: text("error_code"), // QB API error code if available
  lastAttemptAt: timestamp("last_attempt_at"),
  succeededAt: timestamp("succeeded_at"), // When sync succeeded
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Fast lookups by PO and sync status for manual retry
  poIdx: index("qb_sync_logs_po_idx").on(table.purchaseOrderId),
  statusIdx: index("qb_sync_logs_status_idx").on(table.syncStatus),
  companyStatusIdx: index("qb_sync_logs_company_status_idx").on(table.companyId, table.syncStatus),
}));

export const insertQuickBooksSyncLogSchema = createInsertSchema(quickbooksSyncLogs)
  .omit({ id: true, createdAt: true });
export type InsertQuickBooksSyncLog = z.infer<typeof insertQuickBooksSyncLogSchema>;
export type QuickBooksSyncLog = typeof quickbooksSyncLogs.$inferSelect;

// QuickBooks Token Refresh Logs - Lightweight logging for token operations
export const quickbooksTokenLogs = pgTable("quickbooks_token_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id"), // Null for company-level connections
  eventType: text("event_type").notNull(), // 'refresh_success', 'refresh_failed', 'manual_refresh'
  status: text("status").notNull(), // 'success', 'error'
  errorCode: text("error_code"), // QB API error code if available
  errorMessage: text("error_message"), // Error details if failed
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
}, (table) => ({
  // Fast lookups by company and event type
  companyIdx: index("qb_token_logs_company_idx").on(table.companyId),
  eventTypeIdx: index("qb_token_logs_event_type_idx").on(table.eventType),
  occurredAtIdx: index("qb_token_logs_occurred_at_idx").on(table.occurredAt),
}));

export const insertQuickBooksTokenLogSchema = createInsertSchema(quickbooksTokenLogs)
  .omit({ id: true, occurredAt: true });
export type InsertQuickBooksTokenLog = z.infer<typeof insertQuickBooksTokenLogSchema>;
export type QuickBooksTokenLog = typeof quickbooksTokenLogs.$inferSelect;

// Onboarding Progress (tracks onboarding wizard completion for each company)
export const onboardingProgress = pgTable("onboarding_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().unique(), // One progress record per company
  currentStep: integer("current_step").notNull().default(1), // Current wizard step (1-7)
  completedSteps: integer("completed_steps").array().notNull().default(sql`'{}'::integer[]`), // Array of completed step numbers
  isCompleted: integer("is_completed").notNull().default(0), // 1 if onboarding fully completed
  skippedSteps: integer("skipped_steps").array().notNull().default(sql`'{}'::integer[]`), // Array of skipped step numbers
  stepData: text("step_data"), // JSON string for storing step-specific data/preferences
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"), // When onboarding was completed
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Fast lookup by company
  companyIdx: index("onboarding_progress_company_idx").on(table.companyId),
}));

export const insertOnboardingProgressSchema = createInsertSchema(onboardingProgress)
  .omit({ id: true, startedAt: true, updatedAt: true });
export type InsertOnboardingProgress = z.infer<typeof insertOnboardingProgressSchema>;
export type OnboardingProgress = typeof onboardingProgress.$inferSelect;

