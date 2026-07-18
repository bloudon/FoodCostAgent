import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import { registerRoutes, setupWebSocket } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { seedDatabase } from "./seed";
import { storage } from "./storage";
import { cache } from "./cache";
import { setupSsoAuth } from "./ssoAuth";
import { db } from "./db";
import { sql } from "drizzle-orm";

const app = express();
app.disable('etag');

// Enable gzip compression for responses >1KB (Phase 2 optimization)
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Raw body parser for webhooks (must come before JSON parser to handle non-JSON EDI payloads)
app.use('/webhooks/edi', express.raw({
  type: '*/*',
  verify: (req: any, res, buf, encoding) => {
    // Store raw body for HMAC verification
    req.rawBody = buf.toString((encoding as BufferEncoding) || 'utf8');
  }
}));

// Raw body parser for Stripe webhook (must come before JSON parser — Stripe needs raw Buffer for signature verification)
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// JSON parser for all other routes
app.use(express.json());

app.use(express.urlencoded({ extended: false }));
// Use SESSION_SECRET for signing cookies (required for signed cookies like invitation tokens)
app.use(cookieParser(process.env.SESSION_SECRET));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

async function runStartupMigrations() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS background_images (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        object_path text,
        external_url text,
        label text,
        sort_order integer NOT NULL DEFAULT 0,
        is_active integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS instructions text`);
    await db.execute(sql`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS image_path text`);
    await db.execute(sql`ALTER TABLE recipe_import_sessions ADD COLUMN IF NOT EXISTS recipe_id text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_image_path text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_customer_id text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_subscription_id text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_status text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_tier text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_term text`);
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz`);
    // auth_sessions columns added incrementally
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS revoked_at timestamptz`);
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now()`);
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_agent text`);
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip_address text`);
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS selected_company_id varchar`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS auth_sessions_last_active_at_idx ON auth_sessions (last_active_at)`);
    // Task #51: container_unit_id for unit-aware pack size entry
    await db.execute(sql`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS container_unit_id varchar`);
    // Task #52: Collapse vendor_items inner_pack_size into case_size (idempotent: WHERE skips migrated rows)
    await db.execute(sql`
      UPDATE vendor_items
      SET case_size = case_size * COALESCE(inner_pack_size, 1),
          inner_pack_size = 1
      WHERE inner_pack_size IS NOT NULL AND inner_pack_size != 1
    `);
    // Task #69: source column on auth_sessions to track mobile vs web logins
    await db.execute(sql`ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS source varchar DEFAULT 'web'`);
    // Task #70: name on inventory_counts + inventory_count_id on shelf_scan_sessions
    await db.execute(sql`ALTER TABLE inventory_counts ADD COLUMN IF NOT EXISTS name text`);
    // Ensure shelf_scan_sessions exists before altering it (VPS may be missing this table)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS shelf_scan_sessions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id varchar NOT NULL,
        store_id varchar,
        user_id varchar,
        inventory_count_id varchar,
        created_at timestamp NOT NULL DEFAULT now(),
        frame_count integer NOT NULL DEFAULT 0,
        item_count integer NOT NULL DEFAULT 0,
        items jsonb NOT NULL DEFAULT '[]',
        notes jsonb NOT NULL DEFAULT '[]',
        status varchar NOT NULL DEFAULT 'completed'
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS shelf_scan_sessions_company_idx ON shelf_scan_sessions (company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS shelf_scan_sessions_created_at_idx ON shelf_scan_sessions (created_at)`);
    await db.execute(sql`ALTER TABLE shelf_scan_sessions ADD COLUMN IF NOT EXISTS inventory_count_id varchar`);
    // Task #75: Rename is_tare_weight_category → is_catch_weight_category (correct food-service terminology)
    await db.execute(sql`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'categories' AND column_name = 'is_tare_weight_category')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'categories' AND column_name = 'is_catch_weight_category') THEN
          ALTER TABLE categories RENAME COLUMN is_tare_weight_category TO is_catch_weight_category;
        ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'categories' AND column_name = 'is_catch_weight_category') THEN
          ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_catch_weight_category integer NOT NULL DEFAULT 0;
        END IF;
      END $$
    `);
    // Task #78: inventory_count_entries — sub-entry history per count line
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory_count_entries (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        inventory_count_line_id varchar NOT NULL,
        qty real NOT NULL,
        user_id varchar,
        entered_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS inventory_count_entries_line_id_idx
      ON inventory_count_entries (inventory_count_line_id)
    `);
    // Mobile backgrounds flag on background_images
    await db.execute(sql`ALTER TABLE background_images ADD COLUMN IF NOT EXISTS is_mobile_available integer NOT NULL DEFAULT 0`);
    // Ensure is_free_background column exists (added after initial table creation)
    await db.execute(sql`ALTER TABLE background_images ADD COLUMN IF NOT EXISTS is_free_background integer NOT NULL DEFAULT 0`);
    // Optional description/notes field for company_stores (added for onboarding wizard Step 3)
    await db.execute(sql`ALTER TABLE company_stores ADD COLUMN IF NOT EXISTS description text`);
    // Task #201: hasBar — onboarding bar/beverage profile question
    await db.execute(sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS has_bar integer`);
    // Task #204: price_source on order_guide_lines — tracks whether extracted price is case or unit
    await db.execute(sql`ALTER TABLE order_guide_lines ADD COLUMN IF NOT EXISTS price_source text`);
    // Task #296: persist variant group opt-out preferences across menu import wizard refresh
    await db.execute(sql`ALTER TABLE menu_import_sessions ADD COLUMN IF NOT EXISTS disabled_variant_group_keys jsonb DEFAULT '[]'::jsonb`);
    // Task #298: last-seen version for What's New banner
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_version text`);
    // Task #351: pack_uom on vendor_items — stores pack dimension unit for unit-aware case-price display
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pack_uom text`);
    // Task #386: vendor_items.updated_at — tracks last price/qty change for correct recency selection in case-price batch query
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now()`);
    // M1 Procurement Connector: po_export_logs — audit trail for supplier-formatted order file exports
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS po_export_logs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id varchar NOT NULL,
        company_id varchar NOT NULL,
        vendor_id varchar NOT NULL,
        connector_id text NOT NULL,
        exported_by varchar NOT NULL,
        exported_at timestamp NOT NULL DEFAULT now(),
        file_format text NOT NULL DEFAULT 'csv',
        file_path text,
        line_count integer,
        warnings jsonb,
        manually_confirmed_at timestamp,
        manually_confirmed_by varchar
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS po_export_logs_po_idx ON po_export_logs (purchase_order_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS po_export_logs_company_idx ON po_export_logs (company_id)`);
    // M2 Connector Registry: customer_supplier_connections — per-company connector + transport configuration
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS customer_supplier_connections (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id varchar NOT NULL,
        vendor_id varchar NOT NULL,
        connector_id text NOT NULL,
        transport_overrides jsonb,
        is_active integer NOT NULL DEFAULT 1,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS csc_company_vendor_uniq ON customer_supplier_connections (company_id, vendor_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS csc_company_idx ON customer_supplier_connections (company_id)`);
    // categories_company_id_name_unique — enforce unique category names per company
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'categories_company_id_name_unique'
        ) THEN
          ALTER TABLE categories ADD CONSTRAINT categories_company_id_name_unique UNIQUE (company_id, name);
        END IF;
      END $$
    `);
    // Task #396: Platform vendor registry — global distributor name→connector lookup table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS platform_vendor_registry (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        normalized_name text NOT NULL,
        aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
        website_domains text[] NOT NULL DEFAULT ARRAY[]::text[],
        connector_id text NOT NULL,
        status text NOT NULL DEFAULT 'approved',
        source text NOT NULL DEFAULT 'seed',
        submitted_by_company_id varchar,
        reviewed_at timestamp,
        review_notes text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS pvr_normalized_connector_uniq ON platform_vendor_registry (normalized_name, connector_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS pvr_status_idx ON platform_vendor_registry (status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS pvr_connector_idx ON platform_vendor_registry (connector_id)`);
    // Task #400: Add exact_aliases column for abbreviation-only (non-substring) matching
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS exact_aliases text[] NOT NULL DEFAULT ARRAY[]::text[]`);
    // Task #400: Store the detect confidence/reason on user-submitted entries for admin review
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS detection_confidence text`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS detection_reason text`);
    // Task #402: Track re-submissions on rejected entries
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS submission_count int NOT NULL DEFAULT 1`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS submitted_by_company_ids text[] NOT NULL DEFAULT ARRAY[]::text[]`);
    // Task #417: calorie_count on menu_items — optional calorie count per serving
    await db.execute(sql`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS calorie_count integer`);
    // Task #407: Make connector_id nullable (vendors without a CSV/EDI connector get NULL)
    await db.execute(sql`ALTER TABLE platform_vendor_registry ALTER COLUMN connector_id DROP NOT NULL`);
    // Task #407: Add display metadata columns (category, website, ordering_url, portal_status)
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS category text`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS website text`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS ordering_url text`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS portal_status text`);
    // Task #407: Replace the simple unique index with a COALESCE-based functional index so NULL
    // connector_id rows can coexist without conflicting on NULL != NULL comparison.
    await db.execute(sql`DROP INDEX IF EXISTS pvr_normalized_connector_uniq`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS pvr_normalized_connector_uniq
        ON platform_vendor_registry (normalized_name, COALESCE(connector_id, ''))
    `);
    // T0: Ensure _migration_log table exists
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS _migration_log (
        version     text        PRIMARY KEY,
        description text        NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Schema: Add MVP columns (idempotent)
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS canonical_name text`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS ordering_mode text NOT NULL DEFAULT 'contact_vendor'`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS service_region_codes text[] NOT NULL DEFAULT ARRAY[]::text[]`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS country_code text`);

    // Schema: Drop v2 research columns not in MVP scope (IF EXISTS — safe on fresh or already-clean DBs)
    await db.execute(sql`ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS visibility`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS verification_status`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS last_verified_at`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS parent_vendor_id`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS service_country_codes`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS service_scope`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS vendor_role`);

    // Schema: Replace over-engineered CHECK constraints with MVP ordering_mode values
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_visibility_check;
        ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_verification_status_check;
        ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_service_scope_check;
        ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_vendor_role_check;
        ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_ordering_mode_check;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pvr_ordering_mode_mvp_check') THEN
          ALTER TABLE platform_vendor_registry ADD CONSTRAINT pvr_ordering_mode_mvp_check
            CHECK (ordering_mode IN ('connector','portal_link','public_ecommerce','contact_vendor'));
        END IF;
      END $$
    `);

    // MVP seed: focused direct-order foodservice distributors only
    {
      const _mvp = await db.execute(sql`SELECT 1 FROM _migration_log WHERE version = 'pvr-mvp-seed-v1'`);
      if (((_mvp as any).rows ?? []).length === 0) {
        // Clear all old seed rows before inserting clean MVP data
        await db.execute(sql`DELETE FROM platform_vendor_registry WHERE source = 'seed'`);
        await db.execute(sql`
          INSERT INTO platform_vendor_registry
            (normalized_name, exact_aliases, aliases, website_domains, connector_id, category,
             website, ordering_url, ordering_mode, country_code, service_region_codes,
             status, source, canonical_name)
          VALUES
            -- === National broadline (connector-enabled) ===
            ('sysco',
             ARRAY['sygma'],
             ARRAY['sysco corporation','sysco foods','sysco foodservice','sysco food service','sygma network','sysco guest supply'],
             ARRAY['sysco.com','shop.sysco.com','syscofoodservice.com','sygmanetwork.com'],
             'sysco','Broadline','https://www.sysco.com','https://shop.sysco.com',
             'connector','US',ARRAY[]::text[],'approved','seed','Sysco'),
            ('us foods',
             ARRAY['usfoods'],
             ARRAY['us foods','us foodservice','us food service','us foods inc','u.s. foods','u.s. foodservice'],
             ARRAY['usfoods.com','usfood.com','usfoodservice.com'],
             'usfoods','Broadline','https://www.usfoods.com','https://www.usfoods.com/our-services/online-ordering.html',
             'connector','US',ARRAY[]::text[],'approved','seed','US Foods'),
            ('gordon food service',
             ARRAY['gfs'],
             ARRAY['gordon food service','gordon''s food service','gordon foodservice','gordon food svc','gordon food'],
             ARRAY['gfs.com','gordonfoodservice.com'],
             'gfs','Broadline','https://www.gfs.com','https://www.gfs.com/store',
             'connector','US',ARRAY[]::text[],'approved','seed','Gordon Food Service'),
            ('performance foodservice',
             ARRAY['pfg'],
             ARRAY['performance food group','performance net','performance foodservice','pfg foodservice'],
             ARRAY['pfgc.com','performancenet.com'],
             'pfg','Broadline','https://www.pfgc.com','https://www.performancenet.com',
             'connector','US',ARRAY[]::text[],'approved','seed','Performance Foodservice'),
            ('performance food service',
             ARRAY['pfs'],
             ARRAY['performance food service','performance food'],
             ARRAY['performancefoodservice.com'],
             'pfs','Broadline','https://www.pfgc.com',NULL,
             'connector','US',ARRAY[]::text[],'approved','seed','Performance Food Service'),
            ('ben e. keith foods',
             ARRAY['bek'],
             ARRAY['ben e keith','ben e. keith','ben e. keith foods','ben e. keith beverages','bek foods'],
             ARRAY['bek.com','benekeith.com'],
             'bek','Broadline','https://www.bek.com','https://www.bek.com',
             'connector','US',ARRAY['US-TX','US-OK','US-AR','US-LA','US-NM','US-CO'],'approved','seed','Ben E. Keith Foods'),
            ('sofo foods',
             ARRAY['sofo'],
             ARRAY['sofo foods','southern food service','sofo food service'],
             ARRAY['sofofoods.com'],
             'sofo','Broadline','https://www.sofofoods.com',NULL,
             'connector','US',ARRAY['US-OH','US-MI','US-IN','US-PA','US-WV'],'approved','seed','Sofo Foods'),
            -- === National broadline (no connector) ===
            ('mclane foodservice',
             ARRAY[]::text[],
             ARRAY['mclane food service','mclane company','mclane'],
             ARRAY['mclane.com'],
             NULL,'Broadline','https://www.mclane.com',NULL,
             'portal_link','US',ARRAY[]::text[],'approved','seed','McLane Foodservice'),
            ('shamrock foods',
             ARRAY[]::text[],
             ARRAY['shamrock food','shamrock foodservice','shamrock food service'],
             ARRAY['shamrockfoods.com'],
             NULL,'Broadline','https://www.shamrockfoods.com',NULL,
             'contact_vendor','US',ARRAY['US-AZ','US-CA','US-CO','US-NM','US-NV','US-UT'],'approved','seed','Shamrock Foods'),
            ('cheney brothers',
             ARRAY[]::text[],
             ARRAY['cheney brothers inc','cheney bro','cheney'],
             ARRAY['cheneybrothers.com'],
             NULL,'Broadline','https://www.cheneybrothers.com',NULL,
             'contact_vendor','US',ARRAY['US-FL','US-GA','US-SC','US-NC','US-AL'],'approved','seed','Cheney Brothers'),
            -- === Specialty & regional ===
            ('the chefs'' warehouse',
             ARRAY[]::text[],
             ARRAY['chefs warehouse','chefs'' warehouse','chefs warehouse inc'],
             ARRAY['chefswarehouse.com'],
             NULL,'Specialty & Gourmet','https://www.chefswarehouse.com','https://www.chefswarehouse.com',
             'portal_link','US',ARRAY[]::text[],'approved','seed','The Chefs'' Warehouse'),
            ('freshpoint',
             ARRAY[]::text[],
             ARRAY['fresh point','freshpoint inc','freshpoint fresh cut'],
             ARRAY['freshpoint.com'],
             NULL,'Produce','https://www.freshpoint.com',NULL,
             'contact_vendor','US',ARRAY[]::text[],'approved','seed','FreshPoint'),
            ('baldor specialty foods',
             ARRAY[]::text[],
             ARRAY['baldor foods','baldor'],
             ARRAY['baldorfood.com'],
             NULL,'Specialty & Gourmet','https://www.baldorfood.com',NULL,
             'contact_vendor','US',ARRAY['US-NY','US-NJ','US-CT','US-MA','US-PA','US-DC'],'approved','seed','Baldor Specialty Foods'),
            ('what chefs want',
             ARRAY[]::text[],
             ARRAY['what chefs want inc'],
             ARRAY['whatchefswant.com'],
             'cut_and_dry','Specialty & Gourmet','https://www.whatchefswant.com',NULL,
             'connector','US',ARRAY['US-KY','US-TN','US-IN','US-OH'],'approved','seed','What Chefs Want'),
            ('saval foodservice',
             ARRAY[]::text[],
             ARRAY['saval food service','saval'],
             ARRAY['saval.com'],
             'powernet_pnet','Broadline','https://www.saval.com',NULL,
             'connector','US',ARRAY['US-MD','US-VA','US-DC','US-PA','US-DE','US-NC'],'approved','seed','Saval Foodservice'),
            ('sgc foodservice',
             ARRAY[]::text[],
             ARRAY['sgc food service','sgc'],
             ARRAY['sgcfoodservice.com'],
             'powernet_pnet','Broadline','https://www.sgcfoodservice.com',NULL,
             'connector','US',ARRAY['US-VA','US-NC','US-SC','US-GA','US-TN'],'approved','seed','SGC Foodservice'),
            ('wood fruitticher food service',
             ARRAY[]::text[],
             ARRAY['wood fruitticher','wood fruitticher grocery','wood and fruitticher'],
             ARRAY['woodfruitticher.com'],
             'food_order_entry','Broadline','https://www.woodfruitticher.com',NULL,
             'connector','US',ARRAY['US-TX','US-OK','US-AR','US-LA','US-MS','US-AL'],'approved','seed','Wood Fruitticher Food Service'),
            ('cash-wa distributing',
             ARRAY[]::text[],
             ARRAY['cashwa','cash wa distributing','cash-wa'],
             ARRAY['cash-wa.com','cashwa.com'],
             NULL,'Broadline','https://www.cash-wa.com',NULL,
             'contact_vendor','US',ARRAY['US-NE','US-IA','US-KS','US-MO','US-SD','US-ND','US-MN'],'approved','seed','Cash-Wa Distributing'),
            ('feeser''s',
             ARRAY[]::text[],
             ARRAY['feesers','feeser food','feeser''s food distributors'],
             ARRAY['feesers.com'],
             NULL,'Broadline','https://www.feesers.com',NULL,
             'contact_vendor','US',ARRAY['US-PA','US-MD','US-VA','US-DE','US-NJ','US-NY'],'approved','seed','Feeser''s'),
            ('ginsberg''s foods',
             ARRAY[]::text[],
             ARRAY['ginsbergs foods','ginsberg foods','ginsberg''s'],
             ARRAY['ginsbergsfoods.com'],
             NULL,'Broadline','https://www.ginsbergsfoods.com',NULL,
             'contact_vendor','US',ARRAY['US-NY','US-NJ','US-CT'],'approved','seed','Ginsberg''s Foods'),
            ('upper lakes foods',
             ARRAY[]::text[],
             ARRAY['upper lakes food','upper lakes'],
             ARRAY['upperlakesfoods.com'],
             NULL,'Broadline','https://www.upperlakesfoods.com',NULL,
             'contact_vendor','US',ARRAY['US-MN','US-WI','US-MI','US-ND','US-SD'],'approved','seed','Upper Lakes Foods'),
            ('van eerden foodservice',
             ARRAY[]::text[],
             ARRAY['van eerden food service','van eerden'],
             ARRAY['vaneerdenfoodservice.com'],
             NULL,'Broadline','https://www.vaneerdenfoodservice.com',NULL,
             'contact_vendor','US',ARRAY['US-MI','US-IN','US-OH','US-WI'],'approved','seed','Van Eerden Foodservice'),
            ('martin bros. distributing',
             ARRAY[]::text[],
             ARRAY['martin brothers','martin brothers distributing','martin bro','martin bros'],
             ARRAY['martinbrothers.com'],
             NULL,'Broadline','https://www.martinbrothers.com',NULL,
             'contact_vendor','US',ARRAY['US-IA','US-MN','US-WI','US-IL','US-MO','US-SD','US-ND'],'approved','seed','Martin Bros. Distributing'),
            ('nicholas and company',
             ARRAY[]::text[],
             ARRAY['nicholas & company','nicholas co','nicholas and co'],
             ARRAY['nicholasandco.com'],
             NULL,'Broadline','https://www.nicholasandco.com',NULL,
             'contact_vendor','US',ARRAY['US-UT','US-CO','US-ID','US-MT','US-WY','US-NV','US-AZ'],'approved','seed','Nicholas and Company'),
            ('harbor foods',
             ARRAY[]::text[],
             ARRAY['harbor food','harbor foods inc','harbor foodservice'],
             ARRAY['harborfoods.com'],
             NULL,'Broadline','https://www.harborfoods.com',NULL,
             'contact_vendor','US',ARRAY['US-WA','US-OR'],'approved','seed','Harbor Foods'),
            ('loffredo fresh foods',
             ARRAY[]::text[],
             ARRAY['loffredo','loffredo fresh produce','loffredo foods'],
             ARRAY['loffredo.com'],
             NULL,'Produce','https://www.loffredo.com',NULL,
             'contact_vendor','US',ARRAY['US-IA','US-NE','US-MO','US-KS'],'approved','seed','Loffredo Fresh Foods'),
            ('maplevale farms',
             ARRAY[]::text[],
             ARRAY['maple vale farms','maplevale farm'],
             ARRAY['maplevale.com'],
             NULL,'Broadline','https://www.maplevale.com',NULL,
             'contact_vendor','US',ARRAY['US-NY','US-PA','US-NJ','US-CT'],'approved','seed','Maplevale Farms'),
            ('palmer food services',
             ARRAY[]::text[],
             ARRAY['palmer foodservice','palmer food service','palmer foods'],
             ARRAY['palmerfoodservices.com'],
             NULL,'Broadline','https://www.palmerfoodservices.com',NULL,
             'contact_vendor','US',ARRAY['US-NY','US-PA','US-NJ','US-CT','US-MA'],'approved','seed','Palmer Food Services'),
            ('prime source foods',
             ARRAY[]::text[],
             ARRAY['primesource foods','prime source food','prime source foodservice'],
             ARRAY['primesourcefoods.com'],
             NULL,'Broadline','https://www.primesourcefoods.com',NULL,
             'contact_vendor','US',ARRAY['US-TX','US-OK','US-AR','US-LA','US-MS'],'approved','seed','Prime Source Foods'),
            ('quaker valley foods',
             ARRAY[]::text[],
             ARRAY['quaker valley food','quaker valley'],
             ARRAY['qvf.com'],
             NULL,'Broadline','https://www.qvf.com',NULL,
             'contact_vendor','US',ARRAY['US-PA','US-NJ','US-DE','US-MD','US-VA','US-NY'],'approved','seed','Quaker Valley Foods'),
            ('sanwa food group',
             ARRAY[]::text[],
             ARRAY['sanwa food','sanwa foods'],
             ARRAY['sanwafoodgroup.com'],
             NULL,'Asian & Specialty','https://www.sanwafoodgroup.com',NULL,
             'contact_vendor','US',ARRAY['US-CA'],'approved','seed','Sanwa Food Group'),
            ('y. hata',
             ARRAY[]::text[],
             ARRAY['y hata','y hata & co','yhata'],
             ARRAY['yhata.com'],
             NULL,'Broadline','https://www.yhata.com',NULL,
             'contact_vendor','US',ARRAY['US-HI'],'approved','seed','Y. Hata'),
            ('suisan',
             ARRAY[]::text[],
             ARRAY['suisan company','suisan co'],
             ARRAY['suisan.com'],
             NULL,'Broadline','https://www.suisan.com',NULL,
             'contact_vendor','US',ARRAY['US-HI'],'approved','seed','Suisan'),
            ('birite foodservice',
             ARRAY[]::text[],
             ARRAY['bi-rite foodservice','bi rite foodservice','birite food service'],
             ARRAY['biritefoodservice.com'],
             NULL,'Broadline','https://www.biritefoodservice.com',NULL,
             'contact_vendor','US',ARRAY['US-CA','US-NV','US-OR'],'approved','seed','BiRite Foodservice'),
            ('ace endico',
             ARRAY[]::text[],
             ARRAY['ace endico corporation','ace endico foods'],
             ARRAY['aceendico.com'],
             NULL,'Broadline','https://www.aceendico.com',NULL,
             'contact_vendor','US',ARRAY['US-NY','US-NJ','US-CT'],'approved','seed','Ace Endico'),
            ('kuna foodservice',
             ARRAY[]::text[],
             ARRAY['kuna food service','kuna foods'],
             ARRAY['kunafoodservice.com'],
             NULL,'Broadline','https://www.kunafoodservice.com',NULL,
             'contact_vendor','US',ARRAY['US-ID','US-OR','US-WA','US-MT','US-WY'],'approved','seed','Kuna Foodservice'),
            ('kohl wholesale',
             ARRAY[]::text[],
             ARRAY['kohl food','kohl wholesale company'],
             ARRAY['kohlwholesale.com'],
             NULL,'Broadline','https://www.kohlwholesale.com',NULL,
             'contact_vendor','US',ARRAY['US-NE','US-KS','US-MO','US-IA','US-SD'],'approved','seed','Kohl Wholesale'),
            ('dennis food service',
             ARRAY[]::text[],
             ARRAY['dennis foodservice','dennis food svc'],
             ARRAY['dennisfoodservice.com'],
             NULL,'Broadline','https://www.dennisfoodservice.com',NULL,
             'contact_vendor','US',ARRAY['US-ME','US-NH','US-MA','US-VT'],'approved','seed','Dennis Food Service'),
            ('dicarlo distributors',
             ARRAY[]::text[],
             ARRAY['di carlo distributors','dicarlo food service'],
             ARRAY['dicarlodistributors.com'],
             NULL,'Broadline','https://www.dicarlodistributors.com',NULL,
             'contact_vendor','US',ARRAY['US-NY','US-NJ','US-PA','US-CT'],'approved','seed','DiCarlo Distributors'),
            ('jordano''s foodservice',
             ARRAY[]::text[],
             ARRAY['jordanos foodservice','jordano''s','jordanos food service'],
             ARRAY['jordanos.com'],
             NULL,'Broadline','https://www.jordanos.com',NULL,
             'contact_vendor','US',ARRAY['US-CA'],'approved','seed','Jordano''s Foodservice'),
            ('jake''s finer foods',
             ARRAY[]::text[],
             ARRAY['jakes finer foods','jake''s fine foods','jake''s foods'],
             ARRAY['jakesfinerfoods.com'],
             NULL,'Broadline','https://www.jakesfinerfoods.com',NULL,
             'contact_vendor','US',ARRAY['US-IL','US-IN','US-OH','US-WI','US-MO'],'approved','seed','Jake''s Finer Foods'),
            ('international gourmet foods',
             ARRAY[]::text[],
             ARRAY['international gourmet food','igf'],
             ARRAY['igfood.com'],
             NULL,'Specialty & Gourmet','https://www.igfood.com',NULL,
             'contact_vendor','US',ARRAY['US-VA','US-DC','US-MD','US-PA'],'approved','seed','International Gourmet Foods'),
            -- === Online ordering vendors ===
            ('webstaurantstore',
             ARRAY[]::text[],
             ARRAY['webstaurant store','webstaurant'],
             ARRAY['webstaurantstore.com'],
             NULL,'Online Retail','https://www.webstaurantstore.com','https://www.webstaurantstore.com',
             'public_ecommerce','US',ARRAY[]::text[],'approved','seed','WebstaurantStore'),
            ('foodservicedirect',
             ARRAY[]::text[],
             ARRAY['food service direct','fsd','foodservice direct'],
             ARRAY['foodservicedirect.com'],
             NULL,'Online Retail','https://www.foodservicedirect.com','https://www.foodservicedirect.com',
             'public_ecommerce','US',ARRAY[]::text[],'approved','seed','FoodServiceDirect'),
            ('baker''s authority',
             ARRAY[]::text[],
             ARRAY['bakers authority'],
             ARRAY['bakersauthority.com'],
             NULL,'Online Retail','https://www.bakersauthority.com','https://www.bakersauthority.com',
             'public_ecommerce','US',ARRAY[]::text[],'approved','seed','Baker''s Authority'),
            ('d''artagnan',
             ARRAY[]::text[],
             ARRAY['dartagnan','d artagnan'],
             ARRAY['dartagnan.com'],
             NULL,'Specialty & Gourmet','https://www.dartagnan.com','https://www.dartagnan.com',
             'public_ecommerce','US',ARRAY[]::text[],'approved','seed','D''Artagnan'),
            ('web food store',
             ARRAY[]::text[],
             ARRAY['webfoodstore'],
             ARRAY['webfoodstore.com'],
             NULL,'Online Retail','https://www.webfoodstore.com','https://www.webfoodstore.com',
             'public_ecommerce','US',ARRAY[]::text[],'approved','seed','Web Food Store')
          ON CONFLICT (normalized_name, (COALESCE(connector_id, ''))) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO _migration_log (version, description)
          VALUES ('pvr-mvp-seed-v1', 'MVP seed: 47 direct-order foodservice distributors')
          ON CONFLICT DO NOTHING
        `);
      }
    }
    console.log('✅ Startup migrations applied');
  } catch (err) {
    console.error('⚠️ Startup migrations error (non-fatal):', err);
  }
}

(async () => {
  // Apply schema migrations that may be missing on the VPS database
  await runStartupMigrations();

  // Setup SSO authentication (must be before registerRoutes) - skip on VPS with local auth
  if (process.env.AUTH_MODE !== 'local') {
    await setupSsoAuth(app);
  }
  
  const server = await registerRoutes(app);
  
  // Setup WebSocket for real-time POS streaming
  setupWebSocket(server);

  try {
    await seedDatabase();
  } catch (err) {
    console.error('⚠️ Seed error (non-fatal):', err);
  }

  // Start background session cleanup job
  // Runs every hour to remove expired auth sessions and prevent table bloat
  const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const cleanupSessionsJob = async () => {
    try {
      await storage.cleanExpiredSessions();
      log('✅ Session cleanup completed');
    } catch (error) {
      console.error('❌ Session cleanup error:', error);
    }
  };
  
  // Run cleanup immediately on startup, then every hour
  cleanupSessionsJob();
  setInterval(cleanupSessionsJob, SESSION_CLEANUP_INTERVAL_MS);
  log(`🔄 Session cleanup job scheduled (every ${SESSION_CLEANUP_INTERVAL_MS / 1000 / 60} minutes)`);

  // Start QuickBooks token refresh job (if QB credentials configured)
  // Runs every hour with jitter to proactively refresh tokens before expiry
  const hasQuickBooksCredentials = !!process.env.QUICKBOOKS_CLIENT_ID && !!process.env.QUICKBOOKS_CLIENT_SECRET;
  if (hasQuickBooksCredentials) {
    const { refreshAllActiveConnections } = await import("./services/quickbooks");
    const QB_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    const QB_JITTER_MS = 10 * 60 * 1000; // ±10 minutes
    
    const refreshQuickBooksTokensJob = async () => {
      try {
        const results = await refreshAllActiveConnections();
        if (results.success > 0 || results.failed > 0) {
          log(`🔄 QuickBooks token refresh: ${results.success} success, ${results.failed} failed`);
        }
      } catch (error) {
        console.error('❌ QuickBooks token refresh job error:', error);
      }
    };
    
    // Run on startup, then every hour with random jitter
    refreshQuickBooksTokensJob();
    setInterval(() => {
      const jitter = Math.random() * QB_JITTER_MS * 2 - QB_JITTER_MS; // Random ±10min
      setTimeout(refreshQuickBooksTokensJob, jitter);
    }, QB_REFRESH_INTERVAL_MS);
    log(`🔄 QuickBooks token refresh job scheduled (every ${QB_REFRESH_INTERVAL_MS / 1000 / 60} minutes ±${QB_JITTER_MS / 1000 / 60}min)`);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    // In production, add a fast health check at root before serving static files
    // This ensures deployment health checks get quick 200 responses
    app.get('/', (req, res, next) => {
      // Health check probes typically:
      // 1. Have no User-Agent, or simple User-Agent (not a browser)
      // 2. Don't request HTML specifically (or use Accept: */*)
      // 3. Have no Referer header
      const userAgent = req.get('user-agent') || '';
      const hasReferer = !!req.get('referer');
      const accept = req.get('accept') || '';
      
      // If this looks like a health check probe, return immediately
      const isHealthCheck = 
        !hasReferer && 
        (!userAgent || !userAgent.includes('Mozilla')) &&
        (!accept || accept === '*/*' || !accept.includes('text/html'));
      
      if (isHealthCheck) {
        return res.status(200).send('OK');
      }
      
      // Otherwise, proceed to serve the SPA
      next();
    });
    
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
