import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, doublePrecision, timestamp, unique, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
  posProvider: text("pos_provider"), // POS provider: square, thrive, toast, hungerrush, clover, spoton, other, none
  primarySalesMethod: text("primary_sales_method"), // pos_connector | manual_upload | null — DB CHECK enforced in startup migration
  tccAccountId: text("tcc_account_id"), // The Chef's Companion (Thrive POS) account ID - only required for Thrive POS users
  preferredUnitSystem: text("preferred_unit_system").notNull().default("imperial"), // imperial, metric, or both
  costingMethod: text("costing_method").notNull().default("last_cost"), // last_cost or weighted_average
  status: text("status").notNull().default("active"), // active, inactive, suspended
  // Branding
  brandImagePath: text("brand_image_path"), // Company brand background override (replaces global carousel)
  // Stripe subscription fields
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status"), // active, past_due, canceled, trialing, incomplete
  subscriptionPlan: text("subscription_plan"), // platform, enterprise
  billingInterval: text("billing_interval"), // monthly, annual, custom
  subscriptionTerm: text("subscription_term"), // monthly, quarterly, annual (legacy — superseded by billing_interval)
  subscriptionCurrentPeriodEnd: timestamp("subscription_current_period_end"),
  hasBar: integer("has_bar"), // 0 = no, 1 = yes, null = not yet answered
  licensedLocationCount: integer("licensed_location_count").notNull().default(1), // number of licensed operating locations (1 = base platform, >1 = additional seats purchased)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Canonical list of all posProvider values the DB can hold.
 *  Keep this in sync with the `pos_provider` column comment above and any
 *  migrations that add new POS providers.  All form enums reference this
 *  constant so a single edit is sufficient when a new provider is added. */
export const POS_PROVIDER_VALUES = ['square', 'thrive', 'toast', 'hungerrush', 'clover', 'spoton', 'other', 'none'] as const;
export type PosProvider = typeof POS_PROVIDER_VALUES[number];

export const insertCompanySchema = createInsertSchema(companies)
  .omit({ id: true, createdAt: true })
  .extend({
    posProvider: z.enum(POS_PROVIDER_VALUES).optional(),
    primarySalesMethod: z.enum(['pos_connector', 'manual_upload']).nullish(),
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
  description: text("description"), // Optional short description / notes for the store
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
  preferredLanguage: text("preferred_language").notNull().default("en"), // "en" | "es"
  lastSeenVersion: text("last_seen_version"), // last app version the user acknowledged in the What's New banner
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
  notificationSentAt: timestamp("notification_sent_at"), // When the pending-approval admin notification was sent (null = not yet sent)
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
  lastActiveAt: timestamp("last_active_at").defaultNow(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  selectedCompanyId: varchar("selected_company_id"),
  source: varchar("source").default("web"),
}, (table) => ({
  userIdIdx: index("auth_sessions_user_id_idx").on(table.userId),
  expiresAtIdx: index("auth_sessions_expires_at_idx").on(table.expiresAt),
  tokenHashIdx: index("auth_sessions_token_hash_idx").on(table.tokenHash),
  lastActiveAtIdx: index("auth_sessions_last_active_at_idx").on(table.lastActiveAt),
}));

export const insertAuthSessionSchema = createInsertSchema(authSessions).omit({ id: true, createdAt: true });
export type InsertAuthSession = z.infer<typeof insertAuthSessionSchema>;
export type AuthSession = typeof authSessions.$inferSelect;

// Email OTPs (persistent one-time codes for signup verification)
// Stored in the DB so server restarts do not invalidate pending signups.
export const emailOtps = pgTable("email_otps", {
  email: text("email").primaryKey(), // lower-cased email — one active OTP per address
  otp: text("otp").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailOtpSchema = createInsertSchema(emailOtps);
export type InsertEmailOtp = z.infer<typeof insertEmailOtpSchema>;
export type EmailOtp = typeof emailOtps.$inferSelect;

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

// Company-scoped accounting accounts used for current classification and
// future export readiness. Historical source GL values remain separate evidence.
export const accountingAccounts = pgTable("accounting_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  accountType: text("account_type"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueCompanyAccountCode: unique().on(table.companyId, table.code),
  companyActiveIdx: index("accounting_accounts_company_active_idx").on(table.companyId, table.isActive),
}));

export const insertAccountingAccountSchema = createInsertSchema(accountingAccounts)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    code: z.string().trim().min(1),
    name: z.string().trim().min(1),
    accountType: z.string().trim().min(1).nullable().optional(),
    isActive: z.union([z.literal(0), z.literal(1)]).default(1),
  });
export type InsertAccountingAccount = z.infer<typeof insertAccountingAccountSchema>;
export type AccountingAccount = typeof accountingAccounts.$inferSelect;

// Categories
export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  showAsIngredient: integer("show_as_ingredient").notNull().default(1), // 1 if items in this category can be used as ingredients
  isCatchWeightCategory: integer("is_catch_weight_category").notNull().default(0), // 1 if this is a catch weight category (proteins sold/tracked by actual per-package weight)
  isActive: integer("is_active").notNull().default(1), // 1 = active, 0 = deactivated (soft delete)
  accountingAccountId: varchar("accounting_account_id"),
}, (table) => ({
  uniqueCompanyCategory: unique().on(table.companyId, table.name),
}));

export const insertCategorySchema = createInsertSchema(categories).omit({ id: true, accountingAccountId: true });
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
  manufacturer: text("manufacturer"), // optional product manufacturer/brand
  categoryId: varchar("category_id"), // Reference to categories table
  accountingAccountId: varchar("accounting_account_id"), // Optional current-account exception; managed by accounting service
  pluSku: text("plu_sku"),
  /** Canonical inventory unit — the stable, vendor-independent unit for all
   *  cost calculations (e.g. LB, FL OZ, EA). Never changes because a vendor
   *  changes their pack format. price_per_unit and avg_cost_per_unit are
   *  expressed per one of this unit. */
  unitId: varchar("unit_id").notNull(),
  /** Convenience cache: total canonical units in the primary vendor's purchase
   *  unit (e.g. 20 when unit_id = LB and the primary case ships 20 LB).
   *  Authoritative pack geometry lives on vendor_items. */
  caseSize: real("case_size").notNull().default(20),
  /** Size of each inner container expressed in the item's canonical unit
   *  (e.g. 13 for a 13-oz can when canonical unit = OZ). */
  containerSize: real("container_size"),
  /** Human label for the inner container: "can", "bottle", "bag". */
  containerLabel: text("container_label"),
  /** Unit used to display/enter containerSize when it differs from the
   *  canonical unit (e.g. oz when the canonical unit is lb). */
  containerUnitId: varchar("container_unit_id"),
  /** Number of inner containers per purchase unit (e.g. 16 cans per case). */
  casePkgCount: real("case_pkg_count"),
  barcode: text("barcode"),
  active: integer("active").notNull().default(1), // 1 = active, 0 = inactive
  /** Most recent cost per 1 canonical inventory unit (last-cost method).
   *  Updated on vendor price sync and receipt processing. */
  pricePerUnit: real("price_per_unit").notNull().default(0),
  /** Weighted-average cost per 1 canonical inventory unit.
   *  Updated incrementally as purchases are received. */
  avgCostPerUnit: real("avg_cost_per_unit").notNull().default(0),
  yieldPercent: real("yield_percent").notNull().default(100), // usable yield percentage after trimming/waste (0-100), defaults to 100%
  parLevel: real("par_level"), // default target inventory level (can be overridden at store level)
  reorderLevel: real("reorder_level"), // default reorder level (can be overridden at store level)
  imageUrl: text("image_url"),
  isPowerItem: integer("is_power_item").notNull().default(0), // 1 = high-cost power item for frequent tracking
  isVariableWeight: integer("is_variable_weight").notNull().default(0), // 1 = catch weight item (actual weight differs from ordered)
  // ── Supersession (duplicate-identity remediation) ─────────────────────────
  // Set when an accidental duplicate identity is retired in favour of a
  // canonical item. The row is never deleted: it stays queryable so historical
  // references and audits can still be traced back to the identity that was
  // originally written. Server-only — never accepted from client payloads.
  supersededByItemId: varchar("superseded_by_item_id"), // inventory_items.id that replaced this one
  supersededAt: timestamp("superseded_at"),
  supersededReason: text("superseded_reason"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // Optimize company-scoped inventory queries
  companyActiveIdx: index("inventory_items_company_active_idx").on(table.companyId, table.active),
  companyNameIdx: index("inventory_items_company_name_idx").on(table.companyId, table.name),
  supersededIdx: index("inventory_items_superseded_idx").on(table.supersededByItemId),
}));

export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({
  id: true,
  updatedAt: true,
  accountingAccountId: true,
  // Supersession is written only by the remediation service.
  supersededByItemId: true,
  supersededAt: true,
  supersededReason: true,
}).extend({
  categoryId: z.string().nullable().optional(),
  unitId: z.string().min(1, "Unit is required"),
  yieldPercent: z.number().min(1).max(100).default(100),
  containerSize: z.number().positive().nullable().optional(),
  containerLabel: z.string().nullable().optional(),
  containerUnitId: z.string().nullable().optional(),
  casePkgCount: z.number().positive().nullable().optional(),
});
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItems.$inferSelect;

// Inventory Item Units — per-item recipe/issue unit whitelist with item-specific
// conversion factors. Lets recipes call for an apple in EA, LB, OZ, or CS even
// though the inventory unit is, say, LB.
//
// Field direction: `unitsPerCanonical` answers "how many of THIS unit equal
// 1 canonical inventory unit?" Examples for an item whose canonical unit is LB:
//   - EA row: unitsPerCanonical = 4   (4 apples per LB)
//   - LB row: unitsPerCanonical = 1   (1 LB per LB — the identity row)
//   - OZ row: unitsPerCanonical = 16  (16 oz per LB)
//   - CS row: unitsPerCanonical = 0.05 (1/20 case per LB, i.e. a 20-LB case)
//
// Costing formula: qty_in_canonical = recipe_qty / unitsPerCanonical
//   Example: 2 EA apples → 2 / 4 = 0.5 LB; multiply by price_per_unit ($/LB).
//
// Previously named `qtyPerInventoryUnit` (DB column name unchanged for
// zero-downtime compatibility: "qty_per_inventory_unit").
export const inventoryItemUnits = pgTable("inventory_item_units", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  unitId: varchar("unit_id").notNull(),
  /** How many of this unit equal 1 canonical inventory unit. Always > 0.
   *  Costing: qty_in_canonical = recipe_qty / unitsPerCanonical.
   *  DB column: qty_per_inventory_unit (unchanged for compatibility). */
  unitsPerCanonical: real("qty_per_inventory_unit").notNull(),
  isIssueUnit: integer("is_issue_unit").notNull().default(0), // 1 = transfer/issue unit only, 0 = recipe unit
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueItemUnit: unique().on(table.inventoryItemId, table.unitId, table.isIssueUnit),
  itemIdx: index("inventory_item_units_item_idx").on(table.inventoryItemId),
  companyIdx: index("inventory_item_units_company_idx").on(table.companyId),
}));

export const insertInventoryItemUnitSchema = createInsertSchema(inventoryItemUnits)
  .omit({ id: true, createdAt: true })
  .extend({
    unitsPerCanonical: z.number().positive("Qty must be greater than zero"),
    isIssueUnit: z.number().int().min(0).max(1).optional().default(0),
    sortOrder: z.number().int().optional().default(0),
  });
export type InsertInventoryItemUnit = z.infer<typeof insertInventoryItemUnitSchema>;
export type InventoryItemUnit = typeof inventoryItemUnits.$inferSelect;

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
  casePrice: real("case_price"),        // M3A: case price at time of record
  source: text("source"),               // M3A: mirrors vendor_items.priceSource
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
  receiveByUnit: integer("receive_by_unit").notNull().default(0), // 1 = default to receiving by unit (not by case)
});

export const insertVendorSchema = createInsertSchema(vendors).omit({ id: true }).extend({
  orderGuideType: z.string().min(1).default("manual"),
  deliveryDays: z.array(z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])).optional(),
  leadDaysAhead: z.number().int().min(0).max(30).optional(),
  active: z.number().int().min(0).max(1).default(1).optional(),
  requires1099: z.number().int().min(0).max(1).default(0).optional(),
  receiveByUnit: z.number().int().min(0).max(1).default(0).optional(),
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
  brandName: text("brand_name"), // Brand name from vendor order guide
  purchaseUnitId: varchar("purchase_unit_id").notNull(),
  caseSize: real("case_size").notNull().default(1), // number of purchase units per case
  innerPackSize: real("inner_pack_size"),
  packUom: text("pack_uom"), // pack dimension unit (e.g. "oz", "lb", "cs") — used for unit-aware price derivation
  lastPrice: real("last_price").notNull().default(0), // derived unit price (casePrice / (caseSize * innerPackSize))
  lastCasePrice: real("last_case_price").notNull().default(0), // entered case price (primary entry field)
  active: integer("active").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow(),               // tracks last price/qty update for recency selection
  // M3A — Vendor price integrity: source provenance tracking
  priceSource: text("price_source"),                  // "order_guide_import"|"invoice_scan"|"receipt"|"po_create"|"manual"|"legacy_unknown"|"connector"
  pricedAt: timestamp("priced_at"),                   // when this price was captured
  priceSourceReferenceId: text("price_source_reference_id"), // receipt ID, invoice ID, etc.
  // Extension pilot: how the price arrived (e.g. "browser_extension")
  priceTransport: text("price_transport"),

  // ── Pack Geometry (v066) ───────────────────────────────────────────────────
  // Total canonical inventory units contained in one orderable purchase unit.
  // Examples: 4-pack × 5 LB = 20; 12 × 750 ML = 9000 (if canonical = ML); 30-ct eggs = 30.
  // Always server-derived; never accepted from client requests unvalidated.
  canonicalQtyPerPurchaseUnit: doublePrecision("canonical_qty_per_purchase_unit"),
  // always server-derived: last_price / canonical_qty_per_purchase_unit.
  // Cleared when geometry is incomplete or conflicting.
  normalizedPricePerCanonicalUnit: doublePrecision("normalized_price_per_canonical_unit"),
  // How was the geometry established?
  // 'verified'|'parsed'|'inferred'|'incomplete'|'conflicting'|'variable_weight'
  packGeometryStatus: text("pack_geometry_status"),
  // Where did the geometry value originate?
  // 'manual'|'vendor_portal'|'invoice'|'csv_order_guide'|'legacy_migration'|'ai_parse'|'receipt_confirmation'
  packGeometrySource: text("pack_geometry_source"),
  packGeometryUpdatedAt: timestamp("pack_geometry_updated_at"),
  // 'purchase_unit' (default): last_price is price per purchase unit (CS, each, etc.)
  // 'canonical_unit': last_price is already price per canonical unit (e.g. lb-priced meats)
  pricingBasis: text("pricing_basis").default("purchase_unit"),
  // 1 = weight varies by actual delivered weight (meats, seafood, cheese by case).
  // These items cannot have a definitive normalized price from an estimated weight.
  isVariableWeight: integer("is_variable_weight").default(0),
});

export const insertVendorItemSchema = createInsertSchema(vendorItems).omit({
  id: true,
  // ── Derived geometry fields — server-only, never accepted from clients ────
  // These are computed by the vendorPackGeometry service after every price or
  // pack-structure write. Accepting them from clients would allow overwriting
  // server-authoritative normalized prices with arbitrary values.
  canonicalQtyPerPurchaseUnit: true,
  normalizedPricePerCanonicalUnit: true,
  packGeometryStatus: true,
  packGeometrySource: true,
  packGeometryUpdatedAt: true,
  // Note: pricingBasis and isVariableWeight ARE user-settable inputs (not derived).
});
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
  instructions: text("instructions"), // Step-by-step preparation instructions
  imagePath: text("image_path"), // Object storage path for recipe reference photo (cropped dish photo when AI crop succeeds)
  sourceImagePath: text("source_image_path"), // Original scanned image path before AI crop (preserved as backup)
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
  componentId: varchar("component_id").notNull(), // inventory_item_id or recipe_id; may be a placeholder UUID if missingItemName is set
  qty: real("qty").notNull(),
  unitId: varchar("unit_id").notNull(),
  yieldOverride: real("yield_override"), // Optional yield % override (0-100) for this ingredient in this recipe
  sortOrder: integer("sort_order").notNull().default(0), // For drag-and-drop ordering
  missingItemName: text("missing_item_name"), // Name of unmatched ingredient (placeholder components from recipe scan)
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
  name: text("name"), // Optional display name for the session; falls back to countDate when null
  note: text("note"),
  applied: integer("applied").notNull().default(0), // 0 = not applied, 1 = applied to on-hand quantities
  appliedAt: timestamp("applied_at"), // When the count was applied (local time)
  appliedBy: varchar("applied_by"), // User who applied the count
  isPowerSession: integer("is_power_session").notNull().default(0), // 1 = power inventory session (only power items)
  // Source import metadata — set when session is created from an Orderly (or other) import batch
  sourceSystem: text("source_system"),                    // e.g. "ORDERLY"
  sourceBatchId: varchar("source_batch_id"),              // inventory_import_batches.id
  sourceFilename: text("source_filename"),                // original filename from the import
  sourceInventoryDate: text("source_inventory_date"),     // YYYY-MM-DD from the Orderly report
  importedSnapshotTotal: real("imported_snapshot_total"), // total value from source for reconciliation
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
  containerQty: real("container_qty"), // number of loose containers (for three-level counting with container size)
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

// Inventory Count Entries — individual count additions within a single line
export const inventoryCountEntries = pgTable("inventory_count_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryCountLineId: varchar("inventory_count_line_id").notNull(),
  qty: real("qty").notNull(),
  userId: varchar("user_id"),
  enteredAt: timestamp("entered_at").defaultNow(),
}, (table) => ({
  lineIdIdx: index("inventory_count_entries_line_id_idx").on(table.inventoryCountLineId),
}));

export const insertInventoryCountEntrySchema = createInsertSchema(inventoryCountEntries).omit({
  id: true,
  enteredAt: true,
});
export type InsertInventoryCountEntry = z.infer<typeof insertInventoryCountEntrySchema>;
export type InventoryCountEntry = typeof inventoryCountEntries.$inferSelect;

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

// PO Export Logs — audit trail for every supplier-formatted order file generated
export const poExportLogs = pgTable("po_export_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  purchaseOrderId: varchar("purchase_order_id").notNull(),
  companyId: varchar("company_id").notNull(),
  vendorId: varchar("vendor_id").notNull(),
  connectorId: text("connector_id").notNull(),           // "sysco" | "gfs" | "usfoods" | "generic"
  exportedBy: varchar("exported_by").notNull(),
  exportedAt: timestamp("exported_at").notNull().defaultNow(),
  fileFormat: text("file_format").notNull().default("csv"),
  filePath: text("file_path"),                           // object storage path (nullable until storage added)
  lineCount: integer("line_count"),
  warnings: jsonb("warnings"),                           // string[]
  manuallyConfirmedAt: timestamp("manually_confirmed_at"),
  manuallyConfirmedBy: varchar("manually_confirmed_by"),
}, (table) => ({
  poIdx: index("po_export_logs_po_idx").on(table.purchaseOrderId),
  companyIdx: index("po_export_logs_company_idx").on(table.companyId),
}));

export const insertPoExportLogSchema = createInsertSchema(poExportLogs).omit({ id: true, exportedAt: true });
export type InsertPoExportLog = z.infer<typeof insertPoExportLogSchema>;
export type PoExportLog = typeof poExportLogs.$inferSelect;

// PO Routing Audit — one row per routed line, captures price snapshot + savings projection
export const poRoutingAudit = pgTable("po_routing_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  sourcePoId: varchar("source_po_id").notNull(),
  sourcePOLineId: varchar("source_po_line_id").notNull(),
  destinationPoId: varchar("destination_po_id").notNull(),
  vendorItemId: varchar("vendor_item_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  userId: varchar("user_id"),
  operatorName: varchar("operator_name"),
  routedAt: timestamp("routed_at").notNull().defaultNow(),
  fromUnitPrice: real("from_unit_price").notNull(),
  toUnitPrice: real("to_unit_price").notNull(),
  fromCasePrice: real("from_case_price"),
  toCasePrice: real("to_case_price"),
  orderedQty: real("ordered_qty").notNull(),
  projectedSavingsPerCase: real("projected_savings_per_case"),
  savingsReliable: integer("savings_reliable"),
  projectedLineSavings: real("projected_line_savings"),
  savingsReliabilityReasons: text("savings_reliability_reasons"),
  sourceVendorItemId: varchar("source_vendor_item_id"),
  sourceCaseSize: real("source_case_size"),
  sourceInnerPackSize: real("source_inner_pack_size"),
  sourcePricedAt: timestamp("source_priced_at"),
  sourcePriceSource: text("source_price_source"),
  targetCaseSize: real("target_case_size"),
  targetInnerPackSize: real("target_inner_pack_size"),
  targetPricedAt: timestamp("target_priced_at"),
  targetPriceSource: text("target_price_source"),
  destinationPoLineId: varchar("destination_po_line_id"),
}, (table) => ({
  companyIdx: index("po_routing_audit_company_idx").on(table.companyId),
  sourcePoIdx: index("po_routing_audit_source_po_idx").on(table.sourcePoId),
  sourcePOLineIdx: index("po_routing_audit_source_po_line_idx").on(table.sourcePOLineId),
  // Unique constraint guarantees idempotency at the DB level: one audit row per (line, target vendor item)
  uniqLineVi: uniqueIndex("uq_routing_audit_line_vi").on(table.sourcePOLineId, table.vendorItemId),
}));

export type PoRoutingAuditRecord = typeof poRoutingAudit.$inferSelect;

// Receipts
export const receipts = pgTable("receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(), // Store receiving the items
  purchaseOrderId: varchar("purchase_order_id").notNull(),
  status: text("status").notNull().default("draft"), // draft, completed
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  receivedBy: varchar("received_by"), // User who received/completed the order
  receiveByUnit: integer("receive_by_unit").notNull().default(0), // 1 = quantities are individual units (no case math)
}, (table) => ({
  // Optimize receipt queries by company, store, and date
  companyStoreReceivedIdx: index("receipts_company_store_received_idx").on(table.companyId, table.storeId, table.receivedAt),
  poIdIdx: index("receipts_po_id_idx").on(table.purchaseOrderId),
}));

export const insertReceiptSchema = createInsertSchema(receipts).omit({ id: true, receivedAt: true, receivedBy: true }).extend({
  receiveByUnit: z.number().int().min(0).max(1).default(0).optional(),
});
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
// ── Multi-Menu Portfolio ──────────────────────────────────────────────────────
//
// Three-layer model:
//   Menu          — business container (Dinner, Brunch, Holiday 2026, etc.)
//   MenuSection   — ordered presentation sections within one menu
//   MenuEntry     — placement of a canonical menu_item inside a specific menu
//
// Canonical menu_items, recipes, POS mappings, and store_menu_items are unchanged.
// menu_items.price is preserved as the item's default selling price.
// menu_entries.price is copied from menu_items.price at placement time and is
// subsequently independent — changing the item default never alters a live entry.

export const menus = pgTable("menus", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  menuType: text("menu_type"), // dinner | lunch | brunch | catering | event | other | null
  status: text("status").notNull().default("draft"), // draft | ready | scheduled | live | retired
  description: text("description"),
  effectiveStart: timestamp("effective_start"),
  effectiveEnd: timestamp("effective_end"),
  recurrenceDays: text("recurrence_days").array(),    // e.g. ["Sunday","Saturday"]
  recurrenceTimeStart: text("recurrence_time_start"), // e.g. "09:00"
  recurrenceTimeEnd:   text("recurrence_time_end"),   // e.g. "14:00"
  createdBy: varchar("created_by"),
  updatedBy: varchar("updated_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("menus_company_idx").on(table.companyId),
}));

export const insertMenuSchema = createInsertSchema(menus).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMenu = z.infer<typeof insertMenuSchema>;
export type Menu = typeof menus.$inferSelect;

export const menuSections = pgTable("menu_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  menuId: varchar("menu_id").notNull(), // FK → menus.id (CASCADE enforced via startup migration)
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  menuIdx: index("menu_sections_menu_idx").on(table.menuId),
}));

export const insertMenuSectionSchema = createInsertSchema(menuSections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMenuSection = z.infer<typeof insertMenuSectionSchema>;
export type MenuSection = typeof menuSections.$inferSelect;

export const menuEntries = pgTable("menu_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  menuId: varchar("menu_id").notNull().references(() => menus.id, { onDelete: "cascade" }),
  menuSectionId: varchar("menu_section_id").references(() => menuSections.id, { onDelete: "set null" }),
  menuItemId: varchar("menu_item_id").notNull().references(() => menuItems.id, { onDelete: "cascade" }), // canonical — entries are removed if the item is deleted
  companyId: varchar("company_id").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  price: real("price"),                       // entry-specific price, independent after placement
  displayNameOverride: text("display_name_override"),
  descriptionOverride: text("description_override"),
  featured: integer("featured").notNull().default(0), // 1 = featured / special
  active: integer("active").notNull().default(1),
  forecastQty: real("forecast_qty"),  // operator-entered expected covers per service period
  forecastPct: real("forecast_pct"),  // mix % derived from forecastQty / total; stored for overrides
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  // An item may appear on multiple menus but only once per menu
  uniqueMenuItem: unique().on(table.menuId, table.menuItemId),
  menuIdx: index("menu_entries_menu_idx").on(table.menuId),
  sectionIdx: index("menu_entries_section_idx").on(table.menuSectionId),
}));

export const insertMenuEntrySchema = createInsertSchema(menuEntries).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMenuEntry = z.infer<typeof insertMenuEntrySchema>;
export type MenuEntry = typeof menuEntries.$inferSelect;

// Menu Location Assignments — maps a menu to specific store locations
export const menuLocationAssignments = pgTable("menu_location_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  menuId: varchar("menu_id").notNull(),
  storeId: varchar("store_id").notNull(),
  companyId: varchar("company_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueMenuStore: unique().on(table.menuId, table.storeId),
  menuIdx: index("menu_location_assignments_menu_idx").on(table.menuId),
  companyIdx: index("menu_location_assignments_company_idx").on(table.companyId),
}));

export const insertMenuLocationAssignmentSchema = createInsertSchema(menuLocationAssignments).omit({ id: true, createdAt: true });
export type InsertMenuLocationAssignment = z.infer<typeof insertMenuLocationAssignmentSchema>;
export type MenuLocationAssignment = typeof menuLocationAssignments.$inferSelect;

// Menu Departments (company-level menu section taxonomy)
// Note: uniqueness is enforced case-insensitively at DB level via
// UNIQUE INDEX menu_departments_company_lower_name_idx ON (company_id, lower(name)).
// The server normalises names (trim) before insert/update so duplicates are caught
// with a 409 response. No ORM-level unique constraint is declared here to avoid
// drift with the DB's case-insensitive index.
export const menuDepartments = pgTable("menu_departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertMenuDepartmentSchema = createInsertSchema(menuDepartments).omit({ id: true });
export type InsertMenuDepartment = z.infer<typeof insertMenuDepartmentSchema>;
export type MenuDepartment = typeof menuDepartments.$inferSelect;

export const menuItems = pgTable("menu_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  menuDepartmentId: varchar("menu_department_id").references(() => menuDepartments.id, { onDelete: "set null" }), // FK to menu_departments (managed)
  department: text("department"), // Legacy free-text field kept for POS import compatibility
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
  description: text("description"), // Description text extracted from menu scan (e.g. "crispy flatbread, garlic oil, pesto...")
  calorieCount: integer("calorie_count"), // Optional calorie count per serving (extracted from menu scan or entered manually)
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

// Menu Item Recipes (prep-style recipe links — one menu item → multiple recipe cost rows)
// Example: "Chicken Wings" linked to "Bone-In Wings" recipe and "Boneless Wings" recipe,
// each with its own label, so the menu item card can show both costs side by side.
export const menuItemRecipes = pgTable("menu_item_recipes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  menuItemId: varchar("menu_item_id").notNull(),
  recipeId: varchar("recipe_id").notNull(),
  prepStyleLabel: text("prep_style_label").notNull(), // e.g. "Bone-In", "Boneless"
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => ({
  menuItemIdx: index("menu_item_recipes_menu_item_idx").on(table.menuItemId),
  uniqueMenuItemRecipe: unique().on(table.menuItemId, table.recipeId),
}));

export const insertMenuItemRecipeSchema = createInsertSchema(menuItemRecipes).omit({ id: true });
export type InsertMenuItemRecipe = z.infer<typeof insertMenuItemRecipeSchema>;
export type MenuItemRecipe = typeof menuItemRecipes.$inferSelect;

// ─────────── THEORETICAL FOOD COST (TFC) MODULE ───────────

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
  // POS-specific idempotency fields (nullable for CSV-sourced rows)
  outletLocationId: varchar("outlet_location_id"), // FK to inventory_locations (outlet type); populated by Sales-by-Item CSV import
  connectionId: varchar("connection_id"),       // POS connection that produced this row
  externalOrderId: text("external_order_id"),   // POS system order ID (e.g. Square order UUID)
  externalLineItemId: text("external_line_item_id"), // POS line item UID (unique within an order)
}, (table) => ({
  // NOTE: idempotency constraints are both managed as partial unique indexes via startup
  // migration rather than table-level Drizzle constraints because Drizzle cannot express
  // partial (WHERE clause) unique indexes in the table definition DSL.
  //
  // CSV rows  → dmis_csv_aggregate_uniq  on (companyId … sourceBatchId) WHERE connectionId IS NULL
  // POS rows  → dmis_pos_line_uniq       on (connectionId, externalOrderId, externalLineItemId)
  //                                         WHERE all three are NOT NULL
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

// Voice Interpret Logs — one row per spoken entry from POST /api/waste/interpret
export const voiceInterpretLogs = pgTable("voice_interpret_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(),
  spokenItem: text("spoken_item").notNull(),
  resolutionStatus: text("resolution_status").notNull(), // resolved | ambiguous | unresolved | needs_unit
  matchedItemId: varchar("matched_item_id"), // nullable — only set when resolved/ambiguous
  matchScore: real("match_score").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  companyCreatedIdx: index("voice_interpret_logs_company_created_idx").on(table.companyId, table.createdAt),
  statusIdx: index("voice_interpret_logs_status_idx").on(table.resolutionStatus),
}));

export const insertVoiceInterpretLogSchema = createInsertSchema(voiceInterpretLogs).omit({ id: true, createdAt: true });
export type InsertVoiceInterpretLog = z.infer<typeof insertVoiceInterpretLogSchema>;
export type VoiceInterpretLog = typeof voiceInterpretLogs.$inferSelect;

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
  detectedVendorName: text("detected_vendor_name"), // AI-extracted vendor name from image scans (for pre-filling "Add Vendor" dialog)
  // Extension pilot: multi-vendor portal identity (e.g. Cut+Dry hosts multiple distributors)
  transport: text("transport"),                                   // "browser_extension" | null
  syncJobId: varchar("sync_job_id"),                             // links to extension_sync_jobs
  customerSupplierConnectionId: varchar("customer_supplier_connection_id"), // which CSC triggered this
  externalSupplierId: text("external_supplier_id"),              // supplier ID within the portal platform
  externalSupplierName: text("external_supplier_name"),          // human-readable name on portal
  externalLocationId: text("external_location_id"),              // delivery location when available
  externalOrderGuideId: text("external_order_guide_id"),         // specific order guide captured
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
  priceSource: text("price_source"), // 'case' | 'unit' | null — how the price was extracted
  gtin: text("gtin"), // Global Trade Item Number / UPC
  category: text("category"),
  brandName: text("brand_name"),
  // Matching workflow fields
  matchStatus: text("match_status").notNull().default("pending"), // auto_matched, needs_review, new_item, user_confirmed, user_rejected
  matchedInventoryItemId: varchar("matched_inventory_item_id"), // Nullable - linked inventory item
  matchConfidence: real("match_confidence"), // 0-100 confidence score
  userDecision: text("user_decision"), // approved, rejected, create_new, null=pending
  createdInventoryItemId: varchar("created_inventory_item_id"), // If new inventory item was created from this line
  isVariableWeight: integer("is_variable_weight").notNull().default(0), // 1 = catch weight item from vendor
  isSuspectedCatchWeight: integer("is_suspected_catch_weight").notNull().default(0), // 1 = heuristically suspected catch-weight (protein + LB pack or weight-range name)
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

// QuickBooks Reconciliations (invoice # + total recorded before export)
export const qbReconciliations = pgTable("qb_reconciliations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  purchaseOrderId: varchar("purchase_order_id").notNull().unique(),
  receiptId: varchar("receipt_id").notNull(),
  invoiceNumber: text("invoice_number"), // vendor invoice # (optional)
  invoiceDate: timestamp("invoice_date"), // date on vendor invoice
  invoiceTotal: real("invoice_total").notNull(), // total from vendor invoice
  taxAmount: real("tax_amount").notNull().default(0), // tax / other charges
  receiptTotal: real("receipt_total").notNull(), // total from our receipt
  variance: real("variance").notNull().default(0), // (invoiceTotal + taxAmount) - receiptTotal
  initials: varchar("initials", { length: 10 }).notNull(), // employee sign-off (required)
  notes: text("notes"),
  reconciledBy: varchar("reconciled_by"), // userId
  reconciledAt: timestamp("reconciled_at").notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("qb_reconciliations_company_idx").on(table.companyId),
  poIdx: index("qb_reconciliations_po_idx").on(table.purchaseOrderId),
}));

export const insertQbReconciliationSchema = createInsertSchema(qbReconciliations)
  .omit({ id: true, reconciledAt: true });
export type InsertQbReconciliation = z.infer<typeof insertQbReconciliationSchema>;
export type QbReconciliation = typeof qbReconciliations.$inferSelect;

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

// Menu Import Sessions (AI-powered menu image scan staging)
export const menuImportSessions = pgTable("menu_import_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id"),
  status: text("status").notNull().default("pending"), // pending, approved, cancelled
  rawImagePath: text("raw_image_path"), // objectPath of the uploaded menu image
  description: text("description"), // Optional session-level note (e.g. "Dinner menu — spring 2025"). Not required but useful for distinguishing multiple scan sessions.
  extractedItems: jsonb("extracted_items").$type<Array<{ name: string; description?: string; category?: string; size?: string; price?: number | null; department?: string }>>(), // JSONB array of extracted menu items; each item's description holds the ingredient/preparation text extracted by GPT-4o Vision
  disabledVariantGroupKeys: jsonb("disabled_variant_group_keys").$type<string[]>(), // Variant group keys the user has opted out of auto-linking
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("menu_import_sessions_company_idx").on(table.companyId),
}));

export const insertMenuImportSessionSchema = createInsertSchema(menuImportSessions)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMenuImportSession = z.infer<typeof insertMenuImportSessionSchema>;
export type MenuImportSession = typeof menuImportSessions.$inferSelect;

// Background Images (global admin managed carousel images)
export const backgroundImages = pgTable("background_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  objectPath: text("object_path"),      // Path in object storage (for uploaded files)
  externalUrl: text("external_url"),    // External URL (Unsplash, CDN, etc.)
  label: text("label"),                 // Descriptive label for admin UI
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active").notNull().default(1), // 1 = active, 0 = inactive
  isFreeBackground: integer("is_free_background").notNull().default(0), // 1 = designated free-tier background
  isMobileAvailable: integer("is_mobile_available").notNull().default(0), // 1 = included in mobile app backgrounds
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBackgroundImageSchema = createInsertSchema(backgroundImages)
  .omit({ id: true, createdAt: true });
export type InsertBackgroundImage = z.infer<typeof insertBackgroundImageSchema>;
export type BackgroundImage = typeof backgroundImages.$inferSelect;

// Recipe Import Sessions (AI-powered recipe image scan staging)
export type RecipeIngredientMatch = {
  name: string;
  qty: number;
  unit: string;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  matchConfidence: 'high' | 'medium' | 'low' | 'none';
  include: boolean;
};

export type RecipeExtractedData = {
  recipeName: string;
  yieldQty: number;
  yieldUnit: string;
  canBeIngredient?: number;
  ingredients: RecipeIngredientMatch[];
};

export const recipeImportSessions = pgTable("recipe_import_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  status: text("status").notNull().default("pending"), // pending, approved, cancelled
  rawImagePath: text("raw_image_path"),
  extractedData: jsonb("extracted_data").$type<RecipeExtractedData>(),
  recipeId: varchar("recipe_id"), // set on approval, enables idempotent retry
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("recipe_import_sessions_company_idx").on(table.companyId),
}));

export const insertRecipeImportSessionSchema = createInsertSchema(recipeImportSessions)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecipeImportSession = z.infer<typeof insertRecipeImportSessionSchema>;
export type RecipeImportSession = typeof recipeImportSessions.$inferSelect;

// AI Chat Logs — one row per Q&A exchange
export const chatLogs = pgTable("chat_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id"), // nullable — logged from session when available
  userMessage: text("user_message").notNull(),
  assistantResponse: text("assistant_response").notNull(),
  tier: text("tier").notNull().default("free"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("chat_logs_company_idx").on(table.companyId),
  createdAtIdx: index("chat_logs_created_at_idx").on(table.createdAt),
}));

export const insertChatLogSchema = createInsertSchema(chatLogs).omit({ id: true, createdAt: true });
export type InsertChatLog = z.infer<typeof insertChatLogSchema>;
export type ChatLog = typeof chatLogs.$inferSelect;

// AI Chat Corrections — admin-authored ideal answers injected as few-shot examples
export const chatCorrections = pgTable("chat_corrections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatLogId: varchar("chat_log_id").references(() => chatLogs.id, { onDelete: "set null" }), // nullable FK → chat_logs
  userMessage: text("user_message").notNull(), // the question pattern this correction addresses
  correctedResponse: text("corrected_response").notNull(), // the ideal answer
  isActive: integer("is_active").notNull().default(1), // 1 = injected into prompts, 0 = disabled (project convention: integer for booleans)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertChatCorrectionSchema = createInsertSchema(chatCorrections).omit({ id: true, createdAt: true });
export type InsertChatCorrection = z.infer<typeof insertChatCorrectionSchema>;

// AI Token Usage — one row per AI request; the metering ledger for usage-based billing
export const aiTokenUsage = pgTable("ai_token_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: varchar("user_id"), // nullable — logged from session when available
  feature: text("feature").notNull().default("chat"), // chat | invoice_scan | recipe_scan | menu_scan | csv_import ...
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  toolCalls: integer("tool_calls").notNull().default(0), // number of data-tool invocations in the request
  isEstimated: integer("is_estimated").notNull().default(0), // 1 = stream aborted before authoritative usage; counts estimated from chars
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  companyCreatedIdx: index("ai_token_usage_company_created_idx").on(table.companyId, table.createdAt),
}));

export const insertAiTokenUsageSchema = createInsertSchema(aiTokenUsage).omit({ id: true, createdAt: true });
export type InsertAiTokenUsage = z.infer<typeof insertAiTokenUsageSchema>;
export type AiTokenUsage = typeof aiTokenUsage.$inferSelect;

// AI usage overage acknowledgments — one row per company per billing period once the
// company accepts overage billing (warning + acceptance when the included threshold is crossed)
export const aiUsageAcknowledgments = pgTable("ai_usage_acknowledgments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  periodKey: varchar("period_key", { length: 7 }).notNull(), // canonical "YYYY-MM" usage month
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  acceptedByUserId: varchar("accepted_by_user_id"),
  acceptedAt: timestamp("accepted_at").notNull().defaultNow(),
}, (table) => ({
  companyPeriodUnique: unique("ai_usage_ack_company_period_unique").on(table.companyId, table.periodKey),
}));
export type AiUsageAcknowledgment = typeof aiUsageAcknowledgments.$inferSelect;

// AI overage billings — idempotency ledger of overage charges pushed to Stripe invoices
export const aiOverageBillings = pgTable("ai_overage_billings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  periodKey: varchar("period_key", { length: 7 }).notNull(), // canonical "YYYY-MM" usage month
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  overageTokens: integer("overage_tokens").notNull().default(0),
  amountCents: integer("amount_cents").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | billed | failed
  stripeInvoiceItemId: text("stripe_invoice_item_id"),
  stripeInvoiceId: text("stripe_invoice_id"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  companyPeriodUnique: unique("ai_overage_billing_company_period_unique").on(table.companyId, table.periodKey),
}));
export type AiOverageBilling = typeof aiOverageBillings.$inferSelect;

// ─────────── PREP CHART MODULE (Pro tier) ───────────

// Stations — kitchen production areas (Grill, Cold Prep, Fryer, etc.)
export const stations = pgTable("stations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
});

export const insertStationSchema = createInsertSchema(stations).omit({ id: true });
export type InsertStation = z.infer<typeof insertStationSchema>;
export type Station = typeof stations.$inferSelect;

// Prep Items — batch-produced kitchen outputs with shelf-life and lead-time
export const prepItems = pgTable("prep_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  outputUnit: text("output_unit").notNull().default("each"), // unit label for output (oz, lb, each, cup…)
  outputQtyPerBatch: real("output_qty_per_batch").notNull().default(1), // qty produced per batch
  shelfLifeHours: real("shelf_life_hours").notNull().default(24), // hours before it expires
  prepLeadMinutes: integer("prep_lead_minutes").notNull().default(30), // minutes needed to produce
  stationId: varchar("station_id"), // FK → stations (nullable)
  yieldPercent: real("yield_percent").notNull().default(100),
  active: integer("active").notNull().default(1),
  recipeId: varchar("recipe_id"), // nullable FK → recipes.id — links to a canBeIngredient recipe for ingredient inheritance
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("prep_items_company_idx").on(table.companyId),
}));

export const insertPrepItemSchema = createInsertSchema(prepItems).omit({ id: true, createdAt: true, updatedAt: true }).extend({
  recipeId: z.string().nullable().optional(),
});
export type InsertPrepItem = z.infer<typeof insertPrepItemSchema>;
export type PrepItem = typeof prepItems.$inferSelect;

// Prep Item Ingredients — what goes into a prep item (raw inventory or another prep item)
export const prepItemIngredients = pgTable("prep_item_ingredients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  prepItemId: varchar("prep_item_id").notNull(), // parent prep item
  sourceType: text("source_type").notNull(), // 'inventory_item' or 'prep_item'
  sourceId: varchar("source_id").notNull(), // ID in the referenced table
  quantity: real("quantity").notNull(),
  unitId: varchar("unit_id"), // nullable — references units.id
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => ({
  prepItemIdx: index("prep_item_ingredients_prep_item_idx").on(table.prepItemId),
}));

export const insertPrepItemIngredientSchema = createInsertSchema(prepItemIngredients).omit({ id: true });
export type InsertPrepItemIngredient = z.infer<typeof insertPrepItemIngredientSchema>;
export type PrepItemIngredient = typeof prepItemIngredients.$inferSelect;

// Menu Item Prep Usages — how much of a prep item is consumed per menu item sold
export const menuItemPrepUsages = pgTable("menu_item_prep_usages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  menuItemId: varchar("menu_item_id").notNull(),
  prepItemId: varchar("prep_item_id").notNull(),
  quantityPerSale: real("quantity_per_sale").notNull().default(1), // qty of prep item used per 1 menu item sold
  unitId: varchar("unit_id"), // nullable — references units.id
}, (table) => ({
  menuItemIdx: index("menu_item_prep_usages_menu_item_idx").on(table.menuItemId),
  prepItemIdx: index("menu_item_prep_usages_prep_item_idx").on(table.prepItemId),
  uniqueLink: unique().on(table.companyId, table.menuItemId, table.prepItemId),
}));

export const insertMenuItemPrepUsageSchema = createInsertSchema(menuItemPrepUsages).omit({ id: true });
export type InsertMenuItemPrepUsage = z.infer<typeof insertMenuItemPrepUsageSchema>;
export type MenuItemPrepUsage = typeof menuItemPrepUsages.$inferSelect;

// Prep Production Records — log of completed production runs
export const prepProductionRecords = pgTable("prep_production_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(),
  prepItemId: varchar("prep_item_id").notNull(),
  quantityProduced: real("quantity_produced").notNull(),
  batchCount: real("batch_count").notNull().default(1),
  producedAt: timestamp("produced_at").notNull().defaultNow(),
  producedBy: varchar("produced_by"), // userId (nullable)
  notes: text("notes"),
}, (table) => ({
  companyStoreIdx: index("prep_production_company_store_idx").on(table.companyId, table.storeId),
}));

export const insertPrepProductionRecordSchema = createInsertSchema(prepProductionRecords).omit({ id: true });
export type InsertPrepProductionRecord = z.infer<typeof insertPrepProductionRecordSchema>;
export type PrepProductionRecord = typeof prepProductionRecords.$inferSelect;

// Prep On Hand — current available prep stock (expires based on shelf_life_hours)
export const prepOnHand = pgTable("prep_on_hand", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(),
  prepItemId: varchar("prep_item_id").notNull(),
  quantityOnHand: real("quantity_on_hand").notNull(),
  preparedAt: timestamp("prepared_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(), // computed: preparedAt + shelfLifeHours
  locationId: varchar("location_id"), // nullable — storage location ID
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  companyStoreIdx: index("prep_on_hand_company_store_idx").on(table.companyId, table.storeId),
  expiresAtIdx: index("prep_on_hand_expires_at_idx").on(table.expiresAt),
}));

export const insertPrepOnHandSchema = createInsertSchema(prepOnHand).omit({ id: true, createdAt: true });
export type InsertPrepOnHand = z.infer<typeof insertPrepOnHandSchema>;
export type PrepOnHand = typeof prepOnHand.$inferSelect;

// Prep Chart Runs — generated recommendation snapshots
export const prepChartRuns = pgTable("prep_chart_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(),
  businessDate: timestamp("business_date").notNull(), // the date being planned for
  daypartId: varchar("daypart_id"), // nullable = all-day
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  basedOnMode: text("based_on_mode").notNull().default("history"), // 'history' | 'hybrid'
  bufferPercent: real("buffer_percent").notNull().default(10),
  weeksLookback: integer("weeks_lookback").notNull().default(4),
}, (table) => ({
  companyStoreDateIdx: index("prep_chart_runs_company_store_date_idx").on(table.companyId, table.storeId, table.businessDate),
}));

export const insertPrepChartRunSchema = createInsertSchema(prepChartRuns).omit({ id: true, generatedAt: true });
export type InsertPrepChartRun = z.infer<typeof insertPrepChartRunSchema>;
export type PrepChartRun = typeof prepChartRuns.$inferSelect;

// Prep Chart Lines — individual item recommendations within a run
export const prepChartLines = pgTable("prep_chart_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  prepChartRunId: varchar("prep_chart_run_id").notNull(),
  companyId: varchar("company_id").notNull(),
  prepItemId: varchar("prep_item_id").notNull(),
  stationId: varchar("station_id"), // nullable
  forecastQty: real("forecast_qty").notNull().default(0),
  onHandQty: real("on_hand_qty").notNull().default(0),
  recommendedQty: real("recommended_qty").notNull().default(0),
  recommendedBatches: integer("recommended_batches").notNull().default(0),
  dueTime: timestamp("due_time"), // nullable — when prep should be done by
  confidenceScore: real("confidence_score"), // nullable 0–1
  reasoningSummary: text("reasoning_summary"), // human-readable explanation
}, (table) => ({
  runIdx: index("prep_chart_lines_run_idx").on(table.prepChartRunId),
}));

export const insertPrepChartLineSchema = createInsertSchema(prepChartLines).omit({ id: true });
export type InsertPrepChartLine = z.infer<typeof insertPrepChartLineSchema>;
export type PrepChartLine = typeof prepChartLines.$inferSelect;
export type ChatCorrection = typeof chatCorrections.$inferSelect;

// ===== Shelf Scan Sessions =====
// Persisted records of mobile sweep-scan runs
export const shelfScanSessions = pgTable("shelf_scan_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id"),
  userId: varchar("user_id"),
  inventoryCountId: varchar("inventory_count_id"), // Optional FK to inventory_counts for session linking
  createdAt: timestamp("created_at").notNull().defaultNow(),
  frameCount: integer("frame_count").notNull().default(0),
  itemCount: integer("item_count").notNull().default(0),
  items: jsonb("items").notNull().default([]).$type<Array<{ name: string; quantity: number; unit: string; confidence: string }>>(),
  notes: jsonb("notes").notNull().default([]).$type<string[]>(),
  status: varchar("status").notNull().default("completed"),
}, (table) => ({
  companyIdx: index("shelf_scan_sessions_company_idx").on(table.companyId),
  createdAtIdx: index("shelf_scan_sessions_created_at_idx").on(table.createdAt),
}));

export const insertShelfScanSessionSchema = createInsertSchema(shelfScanSessions).omit({ id: true, createdAt: true });
export type InsertShelfScanSession = z.infer<typeof insertShelfScanSessionSchema>;
export type ShelfScanSession = typeof shelfScanSessions.$inferSelect;

// ===== Task #396: Platform Vendor Registry =====
// Global lookup table for known distributor names → connector mappings.
// Seeded entries are pre-approved; user-submitted entries require global_admin review.
export const platformVendorRegistry = pgTable("platform_vendor_registry", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Canonical lower-cased name, e.g. "sysco" */
  normalizedName: text("normalized_name").notNull(),
  /** Abbreviations/short codes requiring an exact match, e.g. ["gfs", "pfs"] — avoids substring false-positives */
  exactAliases: text("exact_aliases").array().notNull().default(sql`'{}'::text[]`),
  /** Longer names matched by contains (input ILIKE '%alias%'), e.g. ["sysco corporation", "sysco foods"] */
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  /** Website domains associated with this distributor, e.g. ["sysco.com"] */
  websiteDomains: text("website_domains").array().notNull().default(sql`'{}'::text[]`),
  /** Connector identifier — must match a key in connectorRegistry.ts; null for vendors without a CSV/EDI connector */
  connectorId: text("connector_id"),
  /** Distributor category, e.g. "Broadline", "Produce", "Protein", "Seafood", "Dairy", "Beverage" */
  category: text("category"),
  /** Primary website URL, e.g. "https://www.sysco.com" */
  website: text("website"),
  /** Customer ordering portal URL, e.g. "https://shop.sysco.com" */
  orderingUrl: text("ordering_url"),
  /** Human-readable portal status, e.g. "Self-serve portal", "Contact rep", "EDI only" */
  portalStatus: text("portal_status"),
  /** Lifecycle state: approved | pending | rejected */
  status: text("status").notNull().default("approved"),
  /** How this entry was created: seed | user_submitted */
  source: text("source").notNull().default("seed"),
  /** Company that submitted this entry (null for seeds) */
  submittedByCompanyId: varchar("submitted_by_company_id"),
  /** When a global_admin reviewed this entry */
  reviewedAt: timestamp("reviewed_at"),
  /** Optional notes from the reviewer */
  reviewNotes: text("review_notes"),
  /** Confidence tier from the original detect call (user_submitted entries only): high | medium | low */
  detectionConfidence: text("detection_confidence"),
  /** Human-readable reason for the confidence tier, e.g. "matched domain sysco.com" */
  detectionReason: text("detection_reason"),
  /** Total number of companies that have submitted this mapping (incremented on re-submission after rejection) */
  submissionCount: integer("submission_count").notNull().default(1),
  /** All company IDs that have submitted this mapping (deduped; seed rows use empty array) */
  submittedByCompanyIds: text("submitted_by_company_ids").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // NOTE: The actual DB unique constraint is a COALESCE-based functional index managed by
  // raw SQL migrations (vps-migrate.sql v049 / runStartupMigrations):
  //   CREATE UNIQUE INDEX pvr_normalized_connector_uniq
  //     ON platform_vendor_registry (normalized_name, COALESCE(connector_id, ''));
  // This handles NULL connector_id rows without index conflicts.
  // A plain uniqueIndex on (normalizedName, connectorId) is NOT declared here because
  // Drizzle cannot express functional/expression indexes, and the DB-level constraint
  // already enforces the correct uniqueness semantics.
  normalizedNameIdx: index("pvr_normalized_name_idx").on(table.normalizedName),
  statusIdx: index("pvr_status_idx").on(table.status),
  connectorIdx: index("pvr_connector_idx").on(table.connectorId),
}));

export const insertPlatformVendorRegistrySchema = createInsertSchema(platformVendorRegistry).omit({
  id: true, createdAt: true, reviewedAt: true,
});
export type InsertPlatformVendorRegistry = z.infer<typeof insertPlatformVendorRegistrySchema>;
export type PlatformVendorRegistry = typeof platformVendorRegistry.$inferSelect;

// ===== M2: Customer Supplier Connections =====
// Links a company's vendor to a connector with capability-transport configuration.
// When a row exists, capabilityRouter.ts uses it instead of name-based detection.
export const customerSupplierConnections = pgTable("customer_supplier_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  vendorId: varchar("vendor_id").notNull(),
  /** Connector identifier — must match a key in connectorRegistry.ts */
  connectorId: text("connector_id").notNull(),
  /**
   * Per-capability transport overrides stored as a JSON object.
   * Keys are ConnectorCapability values; values are ConnectorTransport values.
   * Example: { "purchase_order_export": "email" }
   * When absent for a capability, the connector's default transport is used.
   */
  transportOverrides: jsonb("transport_overrides"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  companyVendorUniq: uniqueIndex("csc_company_vendor_uniq").on(table.companyId, table.vendorId),
  companyIdx: index("csc_company_idx").on(table.companyId),
}));

export const insertCustomerSupplierConnectionSchema = createInsertSchema(customerSupplierConnections).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertCustomerSupplierConnection = z.infer<typeof insertCustomerSupplierConnectionSchema>;
export type CustomerSupplierConnection = typeof customerSupplierConnections.$inferSelect;

// ===== Extension Pilot: Browser-Extension Price Sync =====

/**
 * Short-lived, single-use pairing codes.
 * The raw code is never stored — only its SHA-256 hex digest.
 * A web-session user generates one; the extension claims it once to obtain an extensionToken.
 */
export const extensionPairingCodes = pgTable("extension_pairing_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  userId: varchar("user_id").notNull(),
  connectorId: text("connector_id").notNull(),
  /** SHA-256 hex of the raw code shown to the user — never store the raw code. */
  codeHash: text("code_hash").notNull().unique(),
  /** Stable identifier for the extension installation — bound at claim time. */
  installationId: text("installation_id"),
  expiresAt: timestamp("expires_at").notNull(),
  claimedAt: timestamp("claimed_at"),
  /** Extension token created when this code was claimed. */
  tokenId: varchar("token_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type ExtensionPairingCode = typeof extensionPairingCodes.$inferSelect;

/**
 * Scoped, revocable bearer tokens issued to an extension installation.
 * Scope is a JSON object: { companyId, connectorId, vendorId, storeId, userId, permissions[] }
 */
export const extensionTokens = pgTable("extension_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  userId: varchar("user_id").notNull(),
  connectorId: text("connector_id").notNull(),
  installationId: text("installation_id").notNull(),
  /** 64-char hex bearer token — store plain (it's opaque, not a password). */
  token: text("token").notNull().unique(),
  scope: jsonb("scope").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tokenIdx: index("ext_tokens_token_idx").on(table.token),
  companyIdx: index("ext_tokens_company_idx").on(table.companyId),
}));
export type ExtensionToken = typeof extensionTokens.$inferSelect;

/**
 * One row per user-initiated price sync session.
 * The server owns all status transitions; the extension sends named events.
 *
 * Status state machine:
 *   PENDING → PORTAL_OPEN → CAPTURING → SUBMITTING → COMPLETE
 *                                                   → FAILED
 *                                                   → AUTH_REQUIRED
 *   (any non-terminal) → EXPIRED  (via server-side cron sweep)
 */
export const extensionSyncJobs = pgTable("extension_sync_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  userId: varchar("user_id").notNull(),
  connectorId: text("connector_id").notNull(),
  tokenId: varchar("token_id"),
  vendorId: varchar("vendor_id"),
  storeId: varchar("store_id"),
  customerSupplierConnectionId: varchar("customer_supplier_connection_id"),
  /** Expected external supplier — extension must verify before capture. */
  externalSupplierId: text("external_supplier_id"),
  externalSupplierName: text("external_supplier_name"),
  externalLocationId: text("external_location_id"),
  externalOrderGuideId: text("external_order_guide_id"),
  status: text("status").notNull().default("PENDING"),
  /** JSON array of { event, occurredAt, detail? } — appended by server on each event. */
  events: jsonb("events").notNull().default(sql`'[]'::jsonb`),
  errorMessage: text("error_message"),
  /** Set to "PARTIAL_CAPTURE" when capturedRowCount < visibleRowCount. */
  captureWarning: text("capture_warning"),
  /** Order guide record created for this sync (set on COMPLETE). */
  orderGuideId: varchar("order_guide_id"),
  itemCount: integer("item_count"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  companyIdx: index("ext_sync_jobs_company_idx").on(table.companyId),
  statusIdx: index("ext_sync_jobs_status_idx").on(table.status),
}));
export type ExtensionSyncJob = typeof extensionSyncJobs.$inferSelect;

/**
 * Per-batch ingestion record — idempotency key is (syncJobId, batchId).
 * Also holds per-batch diagnostics required by the pilot spec.
 */
export const extensionIngestionBatches = pgTable("extension_ingestion_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  syncJobId: varchar("sync_job_id").notNull(),
  /** Caller-supplied idempotency key — unique per sync job. */
  batchId: text("batch_id").notNull(),
  companyId: varchar("company_id").notNull(),
  connectorId: text("connector_id").notNull(),
  extensionVersion: text("extension_version"),
  parserVersion: text("parser_version"),
  capturedAt: timestamp("captured_at"),
  sourceUrl: text("source_url"),
  capturedExternalSupplierId: text("captured_external_supplier_id"),
  capturedExternalSupplierName: text("captured_external_supplier_name"),
  capturedExternalLocationId: text("captured_external_location_id"),
  capturedExternalOrderGuideId: text("captured_external_order_guide_id"),
  itemsSeen: integer("items_seen").notNull().default(0),
  itemsMatched: integer("items_matched").notNull().default(0),
  itemsUpdated: integer("items_updated").notNull().default(0),
  itemsReview: integer("items_review").notNull().default(0),
  itemsRejected: integer("items_rejected").notNull().default(0),
  processingErrors: integer("processing_errors").notNull().default(0),
  // Capture completeness — filled by content script, stored for audit
  paginatedPages: integer("paginated_pages"),
  /** Total rows the supplier portal claims to have (if exposed in the UI). */
  expectedRowCount: integer("expected_row_count"),
  /** Rows the content script actually found across all pages. */
  visibleRowCount: integer("visible_row_count"),
  /** Rows successfully parsed and included in the payload. */
  capturedRowCount: integer("captured_row_count"),
  /** "PARTIAL_CAPTURE" when capturedRowCount < visibleRowCount. */
  captureWarning: text("capture_warning"),
  status: text("status").notNull().default("processing"), // processing | complete | failed
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  syncJobIdx: index("ext_ingest_sync_job_idx").on(table.syncJobId),
  idempotencyKey: uniqueIndex("ext_ingest_idempotency").on(table.syncJobId, table.batchId),
}));
export type ExtensionIngestionBatch = typeof extensionIngestionBatches.$inferSelect;

// ─────────── POS CONNECTOR FOUNDATION ───────────

// POS Connections — one OAuth connection per company (Square, Clover, etc.)
export const posConnections = pgTable("pos_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  provider: text("provider").notNull(), // "square"
  merchantId: text("merchant_id").notNull(), // Square merchant ID
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"), // nullable (Square uses long-lived tokens)
  tokenExpiresAt: timestamp("token_expires_at"),
  /** 0 = plain-text (not yet encrypted), 1 = AES-256-GCM v1 (POS_TOKEN_ENCRYPTION_KEY) */
  tokenKeyVersion: integer("token_key_version").notNull().default(0),
  /** Last time a successful token refresh was performed (null = never refreshed since connect) */
  tokenRefreshedAt: timestamp("token_refreshed_at"),
  syncCursor: jsonb("sync_cursor"), // {[locationId]: cursor} per location
  lastSyncedAt: timestamp("last_synced_at"),
  status: text("status").notNull().default("active"), // active | disconnected | error
  connectedByUserId: varchar("connected_by_user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  companyProviderIdx: index("pos_connections_company_provider_idx").on(table.companyId, table.provider),
}));

export const insertPosConnectionSchema = createInsertSchema(posConnections).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPosConnection = z.infer<typeof insertPosConnectionSchema>;
export type PosConnection = typeof posConnections.$inferSelect;

// POS Location Mappings — Square location → FnB store
export const posLocationMappings = pgTable("pos_location_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull(),
  companyId: varchar("company_id").notNull(),
  externalLocationId: text("external_location_id").notNull(),
  externalLocationName: text("external_location_name").notNull(),
  storeId: varchar("store_id"), // nullable until mapped
  // IANA timezone string reported by the POS provider (e.g. "America/Los_Angeles").
  // Used by the hourly nightly-sync scheduler to fire each connection at 4 AM local time.
  externalTimezone: text("external_timezone"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  uniqueConnLocation: unique().on(table.connectionId, table.externalLocationId),
}));

export const insertPosLocationMappingSchema = createInsertSchema(posLocationMappings).omit({ id: true, createdAt: true });
export type InsertPosLocationMapping = z.infer<typeof insertPosLocationMappingSchema>;
export type PosLocationMapping = typeof posLocationMappings.$inferSelect;

// POS Item Mappings — Square catalog variation → FnB menu item
export const posItemMappings = pgTable("pos_item_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull(),
  companyId: varchar("company_id").notNull(),
  externalItemId: text("external_item_id").notNull(), // Square ITEM catalog object ID
  externalVariationId: text("external_variation_id").notNull(), // Square ITEM_VARIATION ID
  externalItemName: text("external_item_name").notNull(),
  externalVariationName: text("external_variation_name").notNull(),
  menuItemId: varchar("menu_item_id"), // nullable until mapped
  ignored: integer("ignored").notNull().default(0), // 1 = user explicitly ignored (modifier, discount, etc.)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  uniqueConnVariation: unique().on(table.connectionId, table.externalVariationId),
}));

export const insertPosItemMappingSchema = createInsertSchema(posItemMappings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPosItemMapping = z.infer<typeof insertPosItemMappingSchema>;
export type PosItemMapping = typeof posItemMappings.$inferSelect;

// POS Sync Jobs — tracks each sync run
export const posSyncJobs = pgTable("pos_sync_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull(),
  companyId: varchar("company_id").notNull(),
  jobType: text("job_type").notNull(), // backfill | incremental | manual
  status: text("status").notNull().default("pending"), // pending | running | completed | failed
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  daysBackfilled: integer("days_backfilled"),
  rowsIngested: integer("rows_ingested").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  // Ad hoc items — line items without a catalog_object_id (cannot be mapped).
  // Stored as JSON so managers can see what was sold but not tracked.
  // Shape: Array<{ name: string; quantity: number; orderId: string; reason: "no_catalog_id" | "custom_dollar_refund" }>
  adhocItems: jsonb("adhoc_items"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  connectionIdx: index("pos_sync_jobs_connection_idx").on(table.connectionId),
}));

export const insertPosSyncJobSchema = createInsertSchema(posSyncJobs).omit({ id: true, createdAt: true });
export type InsertPosSyncJob = z.infer<typeof insertPosSyncJobSchema>;
export type PosSyncJob = typeof posSyncJobs.$inferSelect;

// ─── Staged import source-property bindings ───────────────────────────────────

/**
 * import_source_property_bindings
 *
 * Generic, reusable contract that binds an external source system's *property*
 * (a restaurant / location / site in the source system) to exactly one FnB
 * company + destination store.
 *
 * This is deliberately NOT Orderly-specific: `sourceSystem` + `sourcePropertyId`
 * can represent any migration source (e.g. ORDERLY restaurant "24472").
 *
 * Authorization contract:
 *  - A staged import batch records which binding it was staged against.
 *  - Approval re-validates the binding independently of the caller, so a
 *    client-supplied destination can never redirect an approved batch and a
 *    source property from another site can never be approved into this store.
 *  - `sourceSystem + sourcePropertyId` is globally unique, so two companies
 *    cannot both claim the same source property.
 */
export const importSourcePropertyBindings = pgTable("import_source_property_bindings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  sourceSystem: text("source_system").notNull(),          // e.g. "ORDERLY"
  sourcePropertyId: text("source_property_id").notNull(), // e.g. "24472"
  sourcePropertyLabel: text("source_property_label"),     // human label, e.g. "Bay Hill"
  destinationStoreId: varchar("destination_store_id").notNull(), // company_stores.id
  active: integer("active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: varchar("created_by"),
}, (t) => ({
  // One FnB destination per source property, globally — prevents a second
  // company (or a second store) from claiming the same source property.
  uniqueSourceProperty: unique("import_source_property_unique").on(t.sourceSystem, t.sourcePropertyId),
  companyIdx: index("import_source_property_company_idx").on(t.companyId, t.sourceSystem),
}));

export const insertImportSourcePropertyBindingSchema = createInsertSchema(importSourcePropertyBindings).omit({ id: true, createdAt: true });
export type InsertImportSourcePropertyBinding = z.infer<typeof insertImportSourcePropertyBindingSchema>;
export type ImportSourcePropertyBinding = typeof importSourcePropertyBindings.$inferSelect;

// ─── Orderly Inventory Import ─────────────────────────────────────────────────

/**
 * inventory_import_batches
 * One record per uploaded Orderly inventory export file.
 * Source rows are immutable — if the parser improves, re-parse against rawData
 * without requiring another upload.
 */
export const inventoryImportBatches = pgTable("inventory_import_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  sourceSystem: text("source_system").notNull().default("ORDERLY"),
  fileHash: text("file_hash").notNull(),            // SHA-256 of uploaded buffer
  originalFilename: text("original_filename").notNull(),
  sheetName: text("sheet_name"),                    // e.g. "Inventory Detail"
  parserVersion: text("parser_version").notNull(),  // e.g. "1.0"
  inventoryDate: text("inventory_date"),            // ISO YYYY-MM-DD
  inventoryDateDetectedFrom: text("inventory_date_detected_from"),
  inventoryDateConfirmed: integer("inventory_date_confirmed").notNull().default(0),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  uploadedBy: varchar("uploaded_by"),
  status: text("status").notNull().default("pending_review"),
  sourceRowCount: integer("source_row_count").notNull().default(0),
  snapshotTotal: real("snapshot_total"),            // sum of total_cost across rows
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by"),
  forceNewBatchReason: text("force_new_batch_reason"), // set when admin forces duplicate
  targetStoreId: varchar("target_store_id"), // company_stores.id — store this batch is imported into
  // ── Source-property binding (durable authorization contract) ──────────────
  // Which approved import_source_property_bindings row this batch was staged
  // against, plus a snapshot of the source property it claims. Approval
  // re-validates all three against the live binding so a client cannot
  // redirect an approved batch to a different destination.
  sourcePropertyBindingId: varchar("source_property_binding_id"),
  sourcePropertyId: text("source_property_id"),
}, (t) => ({
  companySystemIdx: index("inv_import_batches_company_system_idx").on(t.companyId, t.sourceSystem),
  hashIdx: index("inv_import_batches_hash_idx").on(t.companyId, t.fileHash),
}));

export const insertInventoryImportBatchSchema = createInsertSchema(inventoryImportBatches).omit({ id: true, uploadedAt: true });
export type InsertInventoryImportBatch = z.infer<typeof insertInventoryImportBatchSchema>;
export type InventoryImportBatch = typeof inventoryImportBatches.$inferSelect;

/**
 * inventory_import_rows
 * One record per source row in the uploaded file.
 * rawData is immutable JSONB storing all original cell values so the parser
 * can be re-run without re-uploading the file.
 */
export const inventoryImportRows = pgTable("inventory_import_rows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id").notNull(),
  rowIndex: integer("row_index").notNull(),          // 1-based (header = 0)
  sheetName: text("sheet_name"),
  rawData: jsonb("raw_data").notNull(),              // all 22+ original cell values
  // Description (two separate transforms, both always stored)
  rawDescription: text("raw_description"),
  cleanedDescription: text("cleaned_description"),
  cleaningMethod: text("cleaning_method"),           // none | supplier_suffix_strip | dash_supplier_strip | pack_text_strip
  cleaningConfidence: real("cleaning_confidence"),   // 0–1
  removedSuffix: text("removed_suffix"),
  // Pack geometry (three-tier)
  caseQuantity: real("case_quantity"),
  innerPackQuantity: real("inner_pack_quantity"),
  baseUnitQuantity: real("base_unit_quantity"),
  caseUnit: text("case_unit"),
  innerUnit: text("inner_unit"),
  baseUnit: text("base_unit"),
  packParseStatus: text("pack_parse_status"),        // ok | partial | unparseable
  // Item code
  sourceItemCode: text("source_item_code"),
  itemCodeStatus: text("item_code_status"),          // valid | blank | placeholder | non_unique
  // Supplier
  supplierRaw: text("supplier_raw"),
  supplierStatus: text("supplier_status"),           // valid | blank | placeholder | ambiguous
  // Location & metadata
  storageLocation: text("storage_location"),
  sourceCategory: text("source_category"),
  sourceGlCode: text("source_gl_code"),
  sourceParTarget: real("source_par_target"),
  packagePrice: real("package_price"),
  // Three counting tiers
  countUnit1: text("count_unit1"),
  count1: real("count1"),
  countUnit2: text("count_unit2"),
  count2: real("count2"),
  countUnit3: text("count_unit3"),
  count3: real("count3"),
  totalUnits: real("total_units"),
  totalCost: real("total_cost"),
  // Previous period columns
  previousCase: real("previous_case"),
  previousPack: real("previous_pack"),
  previousUom: real("previous_uom"),
  previousCost: real("previous_cost"),
  // Row classification
  rowStatus: text("row_status").notNull().default("new_item_candidate"),
  // Resolved entity IDs — set during batch approval so count-session creation can trace back
  resolvedInventoryItemId: varchar("resolved_inventory_item_id"), // inventoryItems.id after approval
}, (t) => ({
  batchIdx: index("inv_import_rows_batch_idx").on(t.batchId),
  batchRowIdx: index("inv_import_rows_batch_row_idx").on(t.batchId, t.rowIndex),
}));

export const insertInventoryImportRowSchema = createInsertSchema(inventoryImportRows).omit({ id: true });
export type InsertInventoryImportRow = z.infer<typeof insertInventoryImportRowSchema>;
export type InventoryImportRow = typeof inventoryImportRows.$inferSelect;

// ─── Inventory Locations ─────────────────────────────────────────────────────
// First-class location hierarchy — supports multi-outlet clubs, bars, kitchens etc.
// Distinct from the legacy storageLocations table (company-scoped, flat, no hierarchy).
export const inventoryLocations = pgTable("inventory_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(), // lowercase trimmed for dedup
  locationType: text("location_type").notNull().default("storage"),
  // storage | operating_unit | cost_center | kitchen | bar | prep | cellar
  parentLocationId: varchar("parent_location_id"),          // nullable self-referential hierarchy
  outletOrCostCenterId: varchar("outlet_or_cost_center_id"), // optional POS outlet reference
  isCentralStorage: integer("is_central_storage").notNull().default(0),
  replenishesLocationIds: text("replenishes_location_ids").array(), // future predictive ordering
  active: integer("active").notNull().default(1),
  sourceSystem: text("source_system"),       // "ORDERLY" | "manual" | "square" etc.
  sourceExternalId: text("source_external_id"), // external ID from source system
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  companyActiveIdx: index("inv_locations_company_active_idx").on(t.companyId, t.active),
  normalizedIdx: index("inv_locations_normalized_idx").on(t.companyId, t.normalizedName),
}));

export const insertInventoryLocationSchema = createInsertSchema(inventoryLocations)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInventoryLocation = z.infer<typeof insertInventoryLocationSchema>;
export type InventoryLocation = typeof inventoryLocations.$inferSelect;

// ─── Inventory Item → Location Assignments ───────────────────────────────────
// Links inventory items to inventory_locations (NOT the deprecated inventory_item_locations table).
// Created during Orderly import approval; can also be created manually.
export const inventoryItemLocationAssignments = pgTable("inventory_item_location_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  locationId: varchar("location_id").notNull(), // references inventory_locations.id
  parTarget: real("par_target"),                // target par level at this location
  isPrimary: integer("is_primary").notNull().default(0),
  active: integer("active").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  uniqueItemLocation: unique().on(t.inventoryItemId, t.locationId),
  itemIdx: index("inv_item_loc_assign_item_idx").on(t.inventoryItemId),
  locationIdx: index("inv_item_loc_assign_loc_idx").on(t.locationId),
  companyIdx: index("inv_item_loc_assign_company_idx").on(t.companyId),
}));

export const insertInventoryItemLocationAssignmentSchema = createInsertSchema(inventoryItemLocationAssignments)
  .omit({ id: true, createdAt: true });
export type InsertInventoryItemLocationAssignment = z.infer<typeof insertInventoryItemLocationAssignmentSchema>;
export type InventoryItemLocationAssignment = typeof inventoryItemLocationAssignments.$inferSelect;

// ─── Inventory Item External Mappings ────────────────────────────────────────
// Stores source-system item codes so future imports auto-resolve items without
// user intervention. Created and confirmed during Orderly (or other) import approval.
export const inventoryItemExternalMappings = pgTable("inventory_item_external_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  inventoryItemId: varchar("inventory_item_id").notNull(),
  sourceSystem: text("source_system").notNull(),       // "ORDERLY" | "SYSCO" | "USFOODS" etc.
  // Source-property scope for the external code. A source item code is only
  // unique within one source property (e.g. one Orderly club), so identity must
  // be keyed by it. Legacy rows staged before property binding use "".
  sourcePropertyId: text("source_property_id").notNull().default(""),
  sourceExternalId: text("source_external_id").notNull(), // item code from source system
  sourceDescription: text("source_description"),       // description snapshot for drift detection
  matchStrategy: text("match_strategy"),               // "code" | "name_pack" | "fuzzy" | "manual"
  confidenceScore: real("confidence_score"),           // 0–1 match confidence at time of mapping
  createdAt: timestamp("created_at").notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at"),              // when a human confirmed this mapping
  confirmedBy: varchar("confirmed_by"),
}, (t) => ({
  uniqueSourceMapping: unique().on(t.companyId, t.sourceSystem, t.sourcePropertyId, t.sourceExternalId),
  itemIdx: index("inv_item_ext_mappings_item_idx").on(t.inventoryItemId),
  sourceIdx: index("inv_item_ext_mappings_source_idx").on(t.companyId, t.sourceSystem, t.sourcePropertyId, t.sourceExternalId),
}));

export const insertInventoryItemExternalMappingSchema = createInsertSchema(inventoryItemExternalMappings)
  .omit({ id: true, createdAt: true });
export type InsertInventoryItemExternalMapping = z.infer<typeof insertInventoryItemExternalMappingSchema>;
export type InventoryItemExternalMapping = typeof inventoryItemExternalMappings.$inferSelect;

// ─── Historical vendor invoice retention ─────────────────────────────────────
// These tables retain source evidence from migrations. They intentionally do not
// reference purchase orders, receipts, AP, or accounting exports.
export const vendorItemExternalMappings = pgTable("vendor_item_external_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  vendorItemId: varchar("vendor_item_id").notNull(),
  sourceSystem: text("source_system").notNull(),
  sourcePropertyId: text("source_property_id").notNull(),
  sourceExternalId: text("source_external_id").notNull(),
  sourceDescription: text("source_description"),
  matchStrategy: text("match_strategy"),
  confidenceScore: real("confidence_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at"),
  confirmedBy: varchar("confirmed_by"),
}, (t) => ({
  uniqueSourceMapping: unique().on(t.companyId, t.sourceSystem, t.sourcePropertyId, t.sourceExternalId),
  vendorItemIdx: index("vendor_item_ext_mappings_vendor_item_idx").on(t.vendorItemId),
  sourceIdx: index("vendor_item_ext_mappings_source_idx").on(t.companyId, t.sourceSystem, t.sourcePropertyId, t.sourceExternalId),
}));
export type VendorItemExternalMapping = typeof vendorItemExternalMappings.$inferSelect;

export const historicalInvoiceImportBatches = pgTable("historical_invoice_import_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  sourceSystem: text("source_system").notNull(),
  sourcePropertyId: text("source_property_id").notNull(),
  sourcePropertyBindingId: varchar("source_property_binding_id").notNull(),
  destinationStoreId: varchar("destination_store_id").notNull(),
  cutoverDate: text("cutover_date").notNull(),
  windowStart: text("window_start").notNull(),
  windowEnd: text("window_end").notNull(),
  payloadHash: text("payload_hash").notNull(),
  explainedZeroMonths: jsonb("explained_zero_months").notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("staged"), // staged | completed | completed_with_conflicts | rejected
  importedBy: varchar("imported_by").notNull(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  invoiceCount: integer("invoice_count").notNull().default(0),
  lineCount: integer("line_count").notNull().default(0),
  resolvedLineCount: integer("resolved_line_count").notNull().default(0),
  unresolvedLineCount: integer("unresolved_line_count").notNull().default(0),
  conflictCount: integer("conflict_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
}, (t) => ({
  companyIdx: index("historical_invoice_batches_company_idx").on(t.companyId, t.importedAt),
  sourceIdx: index("historical_invoice_batches_source_idx").on(t.companyId, t.sourceSystem, t.sourcePropertyId),
}));

export const historicalInvoices = pgTable("historical_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id").notNull(),
  vendorId: varchar("vendor_id"),
  importBatchId: varchar("import_batch_id").notNull(),
  sourceSystem: text("source_system").notNull(),
  sourcePropertyId: text("source_property_id").notNull(),
  sourceInvoiceId: text("source_invoice_id").notNull(),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date").notNull(),
  invoicePeriod: text("invoice_period").notNull(),
  vendorNameSnapshot: text("vendor_name_snapshot"),
  vendorExternalIdSnapshot: text("vendor_external_id_snapshot"),
  subtotal: real("subtotal").notNull().default(0),
  taxAmount: real("tax_amount").notNull().default(0),
  chargeAmount: real("charge_amount").notNull().default(0),
  creditAmount: real("credit_amount").notNull().default(0),
  totalAmount: real("total_amount").notNull().default(0),
  sourceSnapshot: jsonb("source_snapshot").notNull(),
  materialHash: text("material_hash").notNull(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
}, (t) => ({
  uniqueSourceInvoice: unique().on(t.companyId, t.sourceSystem, t.sourcePropertyId, t.sourceInvoiceId),
  companyDateIdx: index("historical_invoices_company_date_idx").on(t.companyId, t.storeId, t.invoiceDate),
}));

export const historicalInvoiceLines = pgTable("historical_invoice_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  invoiceId: varchar("invoice_id").notNull(),
  sourceLineId: text("source_line_id").notNull(),
  vendorItemId: varchar("vendor_item_id"),
  inventoryItemId: varchar("inventory_item_id"),
  resolutionStatus: text("resolution_status").notNull().default("unresolved"),
  productNameSnapshot: text("product_name_snapshot"),
  sourceExternalId: text("source_external_id"),
  quantity: real("quantity"),
  unitPrice: real("unit_price"),
  lineTotal: real("line_total"),
  packSnapshot: jsonb("pack_snapshot").notNull(),
  catchWeightSnapshot: jsonb("catch_weight_snapshot").notNull(),
  glSnapshot: jsonb("gl_snapshot").notNull(),
  financialSnapshot: jsonb("financial_snapshot").notNull(),
  sourceSnapshot: jsonb("source_snapshot").notNull(),
  materialHash: text("material_hash").notNull(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
}, (t) => ({
  uniqueSourceLine: unique().on(t.invoiceId, t.sourceLineId),
  invoiceIdx: index("historical_invoice_lines_invoice_idx").on(t.invoiceId),
  companyResolutionIdx: index("historical_invoice_lines_company_resolution_idx").on(t.companyId, t.resolutionStatus),
}));

export const historicalInvoiceImportConflicts = pgTable("historical_invoice_import_conflicts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  importBatchId: varchar("import_batch_id").notNull(),
  companyId: varchar("company_id").notNull(),
  historicalInvoiceId: varchar("historical_invoice_id"),
  sourceSystem: text("source_system").notNull(),
  sourcePropertyId: text("source_property_id").notNull(),
  sourceInvoiceId: text("source_invoice_id").notNull(),
  conflictType: text("conflict_type").notNull(), // invoice_changed | line_changed | line_missing
  existingMaterialHash: text("existing_material_hash").notNull(),
  incomingMaterialHash: text("incoming_material_hash").notNull(),
  incomingSnapshot: jsonb("incoming_snapshot").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  batchIdx: index("historical_invoice_conflicts_batch_idx").on(t.importBatchId),
  companyIdx: index("historical_invoice_conflicts_company_idx").on(t.companyId, t.createdAt),
}));

// ── Reporting ────────────────────────────────────────────────────────────────

export const REPORT_TYPE_VALUES = ['recipe_cost', 'inventory_value', 'purchase_activity'] as const;
export type ReportTypeValue = typeof REPORT_TYPE_VALUES[number];

export const reportFiltersSchema = z.object({
  reportType: z.enum(REPORT_TYPE_VALUES).optional(),
  storeId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  category: z.string().optional(),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const savedReports = pgTable("saved_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  reportType: text("report_type").notNull(),
  filters: jsonb("filters").notNull().default(sql`'{}'::jsonb`),
  isSystem: integer("is_system").notNull().default(0),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("saved_reports_company_idx").on(table.companyId),
}));

export const insertSavedReportSchema = createInsertSchema(savedReports)
  .omit({ id: true, createdAt: true })
  .extend({ reportType: z.enum(REPORT_TYPE_VALUES), filters: reportFiltersSchema.optional() });
export type InsertSavedReport = z.infer<typeof insertSavedReportSchema>;
export type SavedReport = typeof savedReports.$inferSelect;

export const reportSubscriptions = pgTable("report_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  reportType: text("report_type").notNull(),
  filters: jsonb("filters"),
  savedReportId: varchar("saved_report_id"),
  scheduleFrequency: text("schedule_frequency").notNull().default("daily"),
  scheduleHour: integer("schedule_hour").notNull().default(8),
  emailRecipients: text("email_recipients").array().notNull().default(sql`ARRAY[]::text[]`),
  isActive: integer("is_active").notNull().default(1),
  lastRunAt: timestamp("last_run_at"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("report_subscriptions_company_idx").on(table.companyId),
}));

export const insertReportSubscriptionSchema = createInsertSchema(reportSubscriptions)
  .omit({ id: true, createdAt: true, lastRunAt: true })
  .extend({
    reportType: z.enum(REPORT_TYPE_VALUES),
    scheduleFrequency: z.enum(['daily', 'weekly']),
    scheduleHour: z.number().int().min(0).max(23),
    emailRecipients: z.array(z.string().email("Invalid email")).min(1, "At least one recipient required"),
    filters: reportFiltersSchema.optional(),
  });
export type InsertReportSubscription = z.infer<typeof insertReportSubscriptionSchema>;
export type ReportSubscription = typeof reportSubscriptions.$inferSelect;

export const reportSubscriptionLogs = pgTable("report_subscription_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar("subscription_id").notNull(),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  status: text("status").notNull(),
  emailsSent: integer("emails_sent").default(0),
  errorMessage: text("error_message"),
}, (table) => ({
  subIdIdx: index("report_sub_logs_sub_idx").on(table.subscriptionId),
}));

export type ReportSubscriptionLog = typeof reportSubscriptionLogs.$inferSelect;

// ─── Duplicate-identity remediation audit ────────────────────────────────────
// One row per duplicate group an APPLY run attempted, successful or not.
// This is the durable audit trail for repointing historical references onto a
// canonical inventory item. Rows are append-only in practice: a rerun of an
// already-remediated group writes a new `already_remediated` row rather than
// editing the original.
export const inventoryItemRemediationAudit = pgTable("inventory_item_remediation_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  storeId: varchar("store_id"),
  sourceSystem: text("source_system").notNull(),         // e.g. "ORDERLY"
  sourcePropertyId: text("source_property_id").notNull(),
  sourceExternalId: text("source_external_id").notNull(), // the reliable source Item Code
  /** Report identity this apply was authorized against. */
  manifestId: text("manifest_id").notNull(),
  reportHash: text("report_hash").notNull(),
  reportVersion: text("report_version").notNull(),
  canonicalItemId: varchar("canonical_item_id").notNull(),
  canonicalSelectionReason: text("canonical_selection_reason").notNull(),
  supersededItemIds: text("superseded_item_ids").array().notNull(),
  classification: text("classification").notNull(),      // SAFE_CANDIDATE | AMBIGUOUS | CONFLICT | NOT_DEFECT_RELATED
  /** applied | already_remediated | stopped */
  result: text("result").notNull(),
  failureReason: text("failure_reason"),
  /** Per-table reference counts moved / left unchanged, evidence snapshots,
   *  location + count-row totals, and before/after valuation contribution. */
  referencesMoved: jsonb("references_moved").notNull(),
  evidence: jsonb("evidence").notNull(),
  valuationBefore: real("valuation_before"),
  valuationAfter: real("valuation_after"),
  valuationDelta: real("valuation_delta"),
  operatorId: varchar("operator_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  companyIdx: index("inv_item_remediation_audit_company_idx").on(t.companyId, t.createdAt),
  manifestIdx: index("inv_item_remediation_audit_manifest_idx").on(t.manifestId),
  groupIdx: index("inv_item_remediation_audit_group_idx").on(
    t.companyId, t.sourceSystem, t.sourcePropertyId, t.sourceExternalId,
  ),
}));

export type InventoryItemRemediationAudit = typeof inventoryItemRemediationAudit.$inferSelect;
