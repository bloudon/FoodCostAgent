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
    // M3A: Vendor price integrity — provenance tracking on vendor_items
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS price_source text`);
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS priced_at timestamp`);
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS price_source_reference_id text`);
    // M3A: Source and case price tracking on inventory_item_price_history
    await db.execute(sql`ALTER TABLE inventory_item_price_history ADD COLUMN IF NOT EXISTS source text`);
    await db.execute(sql`ALTER TABLE inventory_item_price_history ADD COLUMN IF NOT EXISTS case_price real`);
    // M3A: Index to speed up source-filtered history lookups
    await db.execute(sql`CREATE INDEX IF NOT EXISTS iiph_source_idx ON inventory_item_price_history (source)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS vi_price_source_idx ON vendor_items (price_source)`);
    // M3A: Provenance-aware legacy backfill — classify existing vendor_item rows by source
    // before falling back to legacy_unknown.  Emits four migration report categories:
    //   repaired      — rows where source could be confidently determined (receipt or order_guide_import)
    //   ambiguous     — receipt rows that ALSO had a non-zero lastCasePrice (dual-signal, uncertain)
    //   invalid-pack  — rows with zero or null caseSize (unit price derivation would be wrong)
    //   needs-refresh — legacy_unknown rows requiring a real price update from an operator
    {
      // Step 1: rows with a provable receipt link AND no competing order-guide signal.
      // Rows that also have last_case_price > 0 are AMBIGUOUS (dual-signal — cannot
      // safely attribute to receipt alone) and are intentionally left for Step 3 →
      // legacy_unknown.  This avoids misclassifying untrusted legacy rows as "receipt".
      const receiptResult = await db.execute(sql`
        UPDATE vendor_items
        SET price_source = 'receipt'
        WHERE price_source IS NULL
          AND (last_case_price IS NULL OR last_case_price = 0)
          AND EXISTS (
            SELECT 1 FROM receipt_lines rl
            WHERE rl.vendor_item_id = vendor_items.id
              AND rl.price_each > 0
          )
      `);
      // Step 2: rows with a non-zero lastCasePrice AND no receipt link → "order_guide_import"
      // (ambiguous rows with BOTH signals skip here because last_case_price > 0 but they
      // also have a receipt link — they're already handled as legacy_unknown in Step 3)
      const ogResult = await db.execute(sql`
        UPDATE vendor_items
        SET price_source = 'order_guide_import'
        WHERE price_source IS NULL
          AND last_case_price IS NOT NULL
          AND last_case_price > 0
          AND NOT EXISTS (
            SELECT 1 FROM receipt_lines rl
            WHERE rl.vendor_item_id = vendor_items.id
              AND rl.price_each > 0
          )
      `);
      // Step 3: all remaining NULL rows → "legacy_unknown"
      const luResult = await db.execute(sql`
        UPDATE vendor_items
        SET price_source = 'legacy_unknown'
        WHERE price_source IS NULL
      `);

      // Step 4: Semantic repair — re-derive lastPrice for order_guide_import rows
      // where case_size > 0 and the stored unit price is inconsistent with
      // lastCasePrice / caseSize (i.e. pre-M3A the derivation was wrong or missing).
      // This corrects case↔unit drift left by legacy import paths.
      const semanticRepairResult = await db.execute(sql`
        UPDATE vendor_items
        SET last_price = last_case_price / case_size
        WHERE price_source = 'order_guide_import'
          AND last_case_price IS NOT NULL AND last_case_price > 0
          AND case_size IS NOT NULL AND case_size > 0
          AND ABS(COALESCE(last_price, 0) - (last_case_price / case_size)) > 0.0001
      `);
      const semanticRepairCount = (semanticRepairResult as any).rowCount ?? 0;

      const receiptCount = (receiptResult as any).rowCount ?? 0;
      const ogCount      = (ogResult as any).rowCount ?? 0;
      const luCount      = (luResult as any).rowCount ?? 0;
      const repairedCount = receiptCount + ogCount;

      if (repairedCount + luCount > 0) {
        // Ambiguous: receipt-tagged rows that also have a non-zero lastCasePrice
        // (both receipt and order-guide signals present — provenance is uncertain)
        const ambiguousResult = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM vendor_items
          WHERE price_source = 'receipt'
            AND last_case_price IS NOT NULL AND last_case_price > 0
        `);
        const ambiguousCount = Number((ambiguousResult as any).rows?.[0]?.cnt ?? 0);

        // Invalid-pack: rows where caseSize is zero or NULL (unit-price derivation is wrong)
        const invalidPackResult = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM vendor_items
          WHERE case_size IS NULL OR case_size <= 0
        `);
        const invalidPackCount = Number((invalidPackResult as any).rows?.[0]?.cnt ?? 0);

        console.log(
          `[M3A backfill] vendor_items price_source:` +
          ` repaired=${repairedCount} (receipt=${receiptCount}, order_guide_import=${ogCount}),` +
          ` semantic-repair=${semanticRepairCount},` +
          ` ambiguous=${ambiguousCount},` +
          ` invalid-pack=${invalidPackCount},` +
          ` needs-refresh=${luCount}`
        );
      }
    }
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
        ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_ordering_mode_mvp_check;
        -- Remap legacy 'integrated' value to 'connector' before enforcing the new constraint
        UPDATE platform_vendor_registry SET ordering_mode = 'connector' WHERE ordering_mode = 'integrated';
        -- Remap legacy 'file_export' value (no direct equivalent) to 'contact_vendor'
        UPDATE platform_vendor_registry SET ordering_mode = 'contact_vendor' WHERE ordering_mode = 'file_export';
        ALTER TABLE platform_vendor_registry ADD CONSTRAINT pvr_ordering_mode_mvp_check
          CHECK (ordering_mode IN ('connector','portal_link','public_ecommerce','contact_vendor'));
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
    // M3B: PO routing audit table (one row per routed line)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS po_routing_audit (
        id                         varchar   PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id                 varchar   NOT NULL,
        source_po_id               varchar   NOT NULL,
        source_po_line_id          varchar   NOT NULL,
        destination_po_id          varchar   NOT NULL,
        vendor_item_id             varchar   NOT NULL,
        inventory_item_id          varchar   NOT NULL,
        user_id                    varchar,
        routed_at                  timestamp NOT NULL DEFAULT now(),
        from_unit_price            real      NOT NULL,
        to_unit_price              real      NOT NULL,
        from_case_price            real,
        to_case_price              real,
        ordered_qty                real      NOT NULL,
        projected_savings_per_case real
      )
    `);
    // Idempotent backfill: add inventory_item_id column if migrated from earlier startup
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS inventory_item_id varchar NOT NULL DEFAULT ''`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS po_routing_audit_company_idx        ON po_routing_audit (company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS po_routing_audit_source_po_idx      ON po_routing_audit (source_po_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS po_routing_audit_source_po_line_idx ON po_routing_audit (source_po_line_id)`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_audit_line_vi     ON po_routing_audit (source_po_line_id, vendor_item_id)`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS operator_name varchar`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS savings_reliable integer`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS projected_line_savings real`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS savings_reliability_reasons text`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_vendor_item_id varchar`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_case_size real`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_inner_pack_size real`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_priced_at timestamp`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_price_source text`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS target_case_size real`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS target_inner_pack_size real`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS target_priced_at timestamp`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS target_price_source text`);
    await db.execute(sql`ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS destination_po_line_id varchar`);

    // v064 — Extension Pilot: browser-extension price sync infrastructure
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS price_transport text`);
    await db.execute(sql`ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS transport text`);
    await db.execute(sql`ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS sync_job_id varchar`);
    await db.execute(sql`ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS customer_supplier_connection_id varchar`);
    await db.execute(sql`ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS external_supplier_id text`);
    await db.execute(sql`ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS external_supplier_name text`);
    await db.execute(sql`ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS external_location_id text`);
    await db.execute(sql`ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS external_order_guide_id text`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS extension_pairing_codes (
        id              varchar   PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id      varchar   NOT NULL,
        user_id         varchar   NOT NULL,
        connector_id    text      NOT NULL,
        code_hash       text      NOT NULL UNIQUE,
        installation_id text,
        expires_at      timestamp NOT NULL,
        claimed_at      timestamp,
        token_id        varchar,
        created_at      timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ext_pairing_company_idx ON extension_pairing_codes (company_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS extension_tokens (
        id              varchar   PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id      varchar   NOT NULL,
        user_id         varchar   NOT NULL,
        connector_id    text      NOT NULL,
        installation_id text      NOT NULL,
        token           text      NOT NULL UNIQUE,
        scope           jsonb     NOT NULL,
        expires_at      timestamp NOT NULL,
        revoked_at      timestamp,
        created_at      timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ext_tokens_token_idx   ON extension_tokens (token)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ext_tokens_company_idx ON extension_tokens (company_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS extension_sync_jobs (
        id                              varchar   PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id                      varchar   NOT NULL,
        user_id                         varchar   NOT NULL,
        connector_id                    text      NOT NULL,
        token_id                        varchar,
        vendor_id                       varchar,
        store_id                        varchar,
        customer_supplier_connection_id varchar,
        external_supplier_id            text,
        external_supplier_name          text,
        external_location_id            text,
        external_order_guide_id         text,
        status                          text      NOT NULL DEFAULT 'PENDING',
        events                          jsonb     NOT NULL DEFAULT '[]'::jsonb,
        error_message                   text,
        order_guide_id                  varchar,
        item_count                      integer,
        created_at                      timestamp NOT NULL DEFAULT now(),
        updated_at                      timestamp NOT NULL DEFAULT now(),
        completed_at                    timestamp
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ext_sync_jobs_company_idx ON extension_sync_jobs (company_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ext_sync_jobs_status_idx  ON extension_sync_jobs (status)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS extension_ingestion_batches (
        id                               varchar   PRIMARY KEY DEFAULT gen_random_uuid(),
        sync_job_id                      varchar   NOT NULL,
        batch_id                         text      NOT NULL,
        company_id                       varchar   NOT NULL,
        connector_id                     text      NOT NULL,
        extension_version                text,
        parser_version                   text,
        captured_at                      timestamp,
        source_url                       text,
        captured_external_supplier_id    text,
        captured_external_supplier_name  text,
        captured_external_location_id    text,
        captured_external_order_guide_id text,
        items_seen                       integer   NOT NULL DEFAULT 0,
        items_matched                    integer   NOT NULL DEFAULT 0,
        items_updated                    integer   NOT NULL DEFAULT 0,
        items_review                     integer   NOT NULL DEFAULT 0,
        items_rejected                   integer   NOT NULL DEFAULT 0,
        processing_errors                integer   NOT NULL DEFAULT 0,
        status                           text      NOT NULL DEFAULT 'processing',
        processed_at                     timestamp,
        created_at                       timestamp NOT NULL DEFAULT now(),
        UNIQUE (sync_job_id, batch_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS ext_ingest_sync_job_idx ON extension_ingestion_batches (sync_job_id)`);

    // v065 — Extension Pilot: capture completeness fields + captureWarning
    await db.execute(sql`ALTER TABLE extension_sync_jobs ADD COLUMN IF NOT EXISTS capture_warning text`);
    await db.execute(sql`ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS paginated_pages integer`);
    await db.execute(sql`ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS expected_row_count integer`);
    await db.execute(sql`ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS visible_row_count integer`);
    await db.execute(sql`ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS captured_row_count integer`);
    await db.execute(sql`ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS capture_warning text`);

    // POS connector tables (created on db:push; ensure they exist for ALTER TABLE below)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pos_connections (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id varchar NOT NULL,
        provider text NOT NULL,
        merchant_id text NOT NULL,
        access_token text NOT NULL,
        refresh_token text,
        token_expires_at timestamp,
        sync_cursor jsonb,
        last_synced_at timestamp,
        status text NOT NULL DEFAULT 'active',
        connected_by_user_id varchar NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pos_location_mappings (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id varchar NOT NULL,
        company_id varchar NOT NULL,
        external_location_id text NOT NULL,
        external_location_name text NOT NULL,
        store_id varchar,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    // Task #544: store the IANA timezone reported by the POS for each location
    await db.execute(sql`ALTER TABLE pos_location_mappings ADD COLUMN IF NOT EXISTS external_timezone text`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pos_item_mappings (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id varchar NOT NULL,
        company_id varchar NOT NULL,
        external_item_id text NOT NULL,
        external_variation_id text NOT NULL,
        external_item_name text NOT NULL,
        external_variation_name text NOT NULL,
        menu_item_id varchar,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pos_sync_jobs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id varchar NOT NULL,
        company_id varchar NOT NULL,
        job_type text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        started_at timestamp,
        completed_at timestamp,
        days_backfilled integer,
        rows_ingested integer NOT NULL DEFAULT 0,
        rows_skipped integer NOT NULL DEFAULT 0,
        error_message text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`ALTER TABLE pos_sync_jobs ADD COLUMN IF NOT EXISTS rows_skipped integer NOT NULL DEFAULT 0`);
    // Task #546: ad hoc items JSON log — must come after the CREATE TABLE above
    await db.execute(sql`ALTER TABLE pos_sync_jobs ADD COLUMN IF NOT EXISTS adhoc_items jsonb`);
    // Task #540: token_key_version — 0=plain-text, 1=AES-256-GCM encrypted
    await db.execute(sql`ALTER TABLE pos_connections ADD COLUMN IF NOT EXISTS token_key_version integer NOT NULL DEFAULT 0`);
    // Task #541: token_refreshed_at — tracks last proactive token refresh for 7-day cadence
    await db.execute(sql`ALTER TABLE pos_connections ADD COLUMN IF NOT EXISTS token_refreshed_at timestamp`);
    // Task #542: partial unique index — enforces at most one running sync job per connection atomically
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS pos_sync_jobs_one_running_per_connection
        ON pos_sync_jobs (connection_id) WHERE status = 'running'
    `);
    // Task #543: POS idempotency — order/line tracking columns on daily_menu_item_sales
    await db.execute(sql`ALTER TABLE daily_menu_item_sales ADD COLUMN IF NOT EXISTS connection_id varchar`);
    await db.execute(sql`ALTER TABLE daily_menu_item_sales ADD COLUMN IF NOT EXISTS external_order_id text`);
    await db.execute(sql`ALTER TABLE daily_menu_item_sales ADD COLUMN IF NOT EXISTS external_line_item_id text`);

    // Drop the old full unique constraint on (companyId…sourceBatchId) — it blocks per-line
    // POS ingestion because multiple orders in the same batch can sell the same menu item.
    // We replace it with a partial version scoped to CSV rows (WHERE connection_id IS NULL).
    await db.execute(sql`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          WHERE t.relname = 'daily_menu_item_sales'
            AND c.contype = 'u'
            AND EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = t.oid
                AND a.attname = 'source_batch_id'
                AND a.attnum = ANY(c.conkey)
            )
        ) LOOP
          EXECUTE format('ALTER TABLE daily_menu_item_sales DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END $$
    `);

    // CSV idempotency — one aggregate row per company/store/menuItem/date/daypart/batch,
    // but ONLY for non-POS rows (connection_id IS NULL).
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS dmis_csv_aggregate_uniq
        ON daily_menu_item_sales (company_id, store_id, menu_item_id, sales_date, daypart_id, source_batch_id)
        WHERE connection_id IS NULL
    `);

    // POS idempotency — one row per (connection, order, line item); partial so CSV rows
    // (any NULL field) are never blocked by this constraint.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS dmis_pos_line_uniq
        ON daily_menu_item_sales (connection_id, external_order_id, external_line_item_id)
        WHERE connection_id IS NOT NULL
          AND external_order_id IS NOT NULL
          AND external_line_item_id IS NOT NULL
    `);

    // Task #612: primary_sales_method on companies (CHECK enforced in v066 migration above)
    await db.execute(sql`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS primary_sales_method text
          CHECK (primary_sales_method IN ('pos_connector', 'manual_upload'))
    `);
    // Task #612: deduplicate before creating the unique index.
    // If a company somehow has multiple active connections (old OAuth path had no guard),
    // keep the newest and mark the rest 'disconnected' — never fail startup on duplicates.
    await db.execute(sql`
      UPDATE pos_connections
         SET status = 'disconnected', updated_at = NOW()
       WHERE id IN (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY company_id
                    ORDER BY created_at DESC
                  ) AS rn
           FROM pos_connections
           WHERE status = 'active'
         ) ranked
         WHERE rn > 1
       )
    `);
    // Now safe to create the unique index — duplicates are resolved above.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS pos_connections_one_active_per_company
        ON pos_connections (company_id) WHERE status = 'active'
    `);

    // Task #632: ignored flag on item mappings (reconciliation experience)
    await db.execute(sql`
      ALTER TABLE pos_item_mappings
        ADD COLUMN IF NOT EXISTS ignored INTEGER NOT NULL DEFAULT 0
    `);

    // Task #635: Menu Portfolio — menus, menu_sections, menu_entries tables
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS menus (
        id         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id varchar NOT NULL,
        name       text    NOT NULL,
        menu_type  text,
        status     text    NOT NULL DEFAULT 'draft',
        description text,
        effective_start timestamp,
        effective_end   timestamp,
        created_by varchar,
        updated_by varchar,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS menus_company_idx ON menus (company_id)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS menu_sections (
        id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        menu_id      varchar NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        company_id   varchar NOT NULL,
        name         text    NOT NULL,
        display_order integer NOT NULL DEFAULT 0,
        created_at   timestamp NOT NULL DEFAULT now(),
        updated_at   timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS menu_sections_menu_idx ON menu_sections (menu_id)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS menu_entries (
        id                   varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        menu_id              varchar NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        menu_section_id      varchar REFERENCES menu_sections(id) ON DELETE SET NULL,
        menu_item_id         varchar NOT NULL,
        company_id           varchar NOT NULL,
        display_order        integer NOT NULL DEFAULT 0,
        price                real,
        display_name_override text,
        description_override  text,
        featured             integer NOT NULL DEFAULT 0,
        active               integer NOT NULL DEFAULT 1,
        created_at           timestamp NOT NULL DEFAULT now(),
        updated_at           timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS menu_entries_menu_item_uniq
        ON menu_entries (menu_id, menu_item_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS menu_entries_menu_idx    ON menu_entries (menu_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS menu_entries_section_idx ON menu_entries (menu_section_id)
    `);
    // Idempotent FK: menu_entries.menu_item_id → menu_items.id
    // ON DELETE CASCADE so removing a canonical item also removes its menu placements.
    await db.execute(sql`
      DO $$ BEGIN
        ALTER TABLE menu_entries
          ADD CONSTRAINT menu_entries_menu_item_id_fk
          FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    // Task #635: Main Menu seed — for every company that has no menus yet,
    // create one "Main Menu" (live) mirroring the company's existing menu-item catalogue.
    // This is idempotent: companies that already have at least one menu are skipped entirely.
    try {
      // Collect company IDs that have menu items but no menus yet
      const seedRows = await db.execute(sql`
        SELECT DISTINCT mi.company_id
        FROM   menu_items mi
        WHERE  NOT EXISTS (
          SELECT 1 FROM menus m WHERE m.company_id = mi.company_id
        )
      `);
      const companiesNeedingSeeds: string[] = ((seedRows as any).rows ?? []).map((r: any) => r.company_id);

      for (const companyId of companiesNeedingSeeds) {
        // 1. Create Main Menu (live)
        const menuRows = await db.execute(sql`
          INSERT INTO menus (company_id, name, status)
          VALUES (${companyId}, 'Main Menu', 'live')
          RETURNING id
        `);
        const menuId: string = ((menuRows as any).rows ?? [])[0]?.id;
        if (!menuId) continue;

        // 2. Create sections from company's menu_departments (sorted by sort_order)
        const deptRows = await db.execute(sql`
          SELECT id, name, sort_order
          FROM   menu_departments
          WHERE  company_id = ${companyId}
          ORDER  BY sort_order ASC, name ASC
        `);
        const departments: { id: string; name: string; sort_order: number }[] =
          (deptRows as any).rows ?? [];
        const deptSectionMap = new Map<string, string>(); // deptId → sectionId

        for (let i = 0; i < departments.length; i++) {
          const dept = departments[i];
          const secRows = await db.execute(sql`
            INSERT INTO menu_sections (menu_id, company_id, name, display_order)
            VALUES (${menuId}, ${companyId}, ${dept.name}, ${i})
            RETURNING id
          `);
          const secId: string = ((secRows as any).rows ?? [])[0]?.id;
          if (secId) deptSectionMap.set(dept.id, secId);
        }

        // 3. Add all active menu items as entries (top-level items only; variants skipped)
        const itemRows = await db.execute(sql`
          SELECT id, menu_department_id, price, sort_order
          FROM   menu_items
          WHERE  company_id        = ${companyId}
            AND  active            = 1
            AND  parent_menu_item_id IS NULL
          ORDER  BY sort_order ASC, name ASC
        `);
        const items: { id: string; menu_department_id: string | null; price: number | null; sort_order: number }[] =
          (itemRows as any).rows ?? [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const sectionId = item.menu_department_id ? (deptSectionMap.get(item.menu_department_id) ?? null) : null;
          try {
            await db.execute(sql`
              INSERT INTO menu_entries
                (menu_id, menu_section_id, menu_item_id, company_id, display_order, price)
              VALUES
                (${menuId}, ${sectionId}, ${item.id}, ${companyId}, ${i}, ${item.price ?? null})
              ON CONFLICT (menu_id, menu_item_id) DO NOTHING
            `);
          } catch {
            // ignore per-row errors; entire seed continues
          }
        }

        log(`🍽️  Main Menu seeded for company ${companyId}: ${items.length} item(s), ${departments.length} section(s)`);
      }
    } catch (seedErr) {
      console.warn('⚠️ Main Menu seed skipped (non-fatal):', seedErr);
    }

    // Task #540: Re-encrypt any existing plain-text tokens when the key is available
    if (process.env.POS_TOKEN_ENCRYPTION_KEY) {
      const { encryptToken, isEncryptedToken } = await import("./utils/tokenCrypto");
      const plainRows = await db.execute(sql`
        SELECT id, access_token, refresh_token FROM pos_connections WHERE token_key_version = 0
      `);
      const rows = (plainRows as any).rows ?? [];
      if (rows.length > 0) {
        console.log(`[POS] Re-encrypting ${rows.length} plain-text token row(s)…`);
        for (const row of rows) {
          const encAccess = isEncryptedToken(row.access_token) ? row.access_token : encryptToken(row.access_token);
          const encRefresh = row.refresh_token
            ? (isEncryptedToken(row.refresh_token) ? row.refresh_token : encryptToken(row.refresh_token))
            : null;
          await db.execute(sql`
            UPDATE pos_connections
            SET access_token = ${encAccess},
                refresh_token = ${encRefresh},
                token_key_version = 1,
                updated_at = now()
            WHERE id = ${row.id}
          `);
        }
        console.log(`[POS] Re-encryption complete for ${rows.length} row(s).`);
      }
    }

    // Task #638: Menu scheduling, locations, and forecasting
    await db.execute(sql`ALTER TABLE menus ADD COLUMN IF NOT EXISTS recurrence_days text[]`);
    await db.execute(sql`ALTER TABLE menus ADD COLUMN IF NOT EXISTS recurrence_time_start text`);
    await db.execute(sql`ALTER TABLE menus ADD COLUMN IF NOT EXISTS recurrence_time_end text`);
    await db.execute(sql`ALTER TABLE menu_entries ADD COLUMN IF NOT EXISTS forecast_qty real`);
    await db.execute(sql`ALTER TABLE menu_entries ADD COLUMN IF NOT EXISTS forecast_pct real`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS menu_location_assignments (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        menu_id varchar NOT NULL,
        store_id varchar NOT NULL,
        company_id varchar NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT menu_location_assignments_menu_store_uniq UNIQUE (menu_id, store_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS menu_location_assignments_menu_idx ON menu_location_assignments (menu_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS menu_location_assignments_company_idx ON menu_location_assignments (company_id)`);

    // Task #724 — Vendor pack geometry: normalized pricing on vendor_items
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS canonical_qty_per_purchase_unit double precision`);
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS normalized_price_per_canonical_unit double precision`);
    // 'verified'|'parsed'|'inferred'|'incomplete'|'conflicting'|'variable_weight'
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pack_geometry_status text`);
    // 'manual'|'vendor_portal'|'invoice'|'csv_order_guide'|'legacy_migration'|'ai_parse'|'receipt_confirmation'
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pack_geometry_source text`);
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pack_geometry_updated_at timestamp`);
    // 'purchase_unit' (default) | 'canonical_unit' (already per-canonical, e.g. lb-priced meats)
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pricing_basis text DEFAULT 'purchase_unit'`);
    // 1 = weight varies per delivery; no definitive normalized price possible
    await db.execute(sql`ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS is_variable_weight integer DEFAULT 0`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS vi_pack_geometry_status_idx ON vendor_items (pack_geometry_status)`);

    // Backfill pack geometry for all existing vendor items that haven't been classified yet.
    // Runs asynchronously in the background so it doesn't block startup.
    // Non-fatal: errors are caught inside backfillVendorPackGeometry().
    setImmediate(async () => {
      try {
        const { backfillVendorPackGeometry } = await import("./services/vendorPackGeometry");
        await backfillVendorPackGeometry();
      } catch (e: any) {
        console.warn("[PackGeometry] Backfill error (non-fatal):", e?.message ?? e);
      }
    });

    console.log('✅ Startup migrations applied');
  } catch (err) {
    console.error('⚠️ Startup migrations error (non-fatal):', err);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Startup] ❌ Unhandled rejection:', reason);
  process.exit(1);
});

await (async () => {
  console.log('[Startup] 1 — runStartupMigrations');
  // Apply schema migrations that may be missing on the VPS database
  await runStartupMigrations();

  console.log('[Startup] 2 — setupSsoAuth');
  // Setup SSO authentication (must be before registerRoutes) - skip on VPS with local auth
  if (process.env.AUTH_MODE !== 'local') {
    try {
      await setupSsoAuth(app);
    } catch (err) {
      console.error('⚠️ SSO setup failed (non-fatal on VPS — set AUTH_MODE=local to skip):', err);
    }
  }

  console.log('[Startup] 3 — registerRoutes');
  const server = await registerRoutes(app);
  
  // Setup WebSocket for real-time POS streaming
  setupWebSocket(server);

  try {
    await seedDatabase();
  } catch (err) {
    console.error('⚠️ Seed error (non-fatal):', err);
  }

  // Warn operators if the contact-form recipient address is not configured.
  // Without CONTACT_EMAIL, submissions fall back to info@fnbcostpro.com which
  // requires an active mailbox at that domain.
  if (!process.env.CONTACT_EMAIL) {
    console.warn(
      '[Startup] ⚠️  CONTACT_EMAIL is not set — contact-form submissions will be sent to the default address (info@fnbcostpro.com). ' +
      'Set CONTACT_EMAIL in your environment to route them to a real inbox.'
    );
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

  // POS nightly incremental sync — hourly pass; fires each connection at 4 AM local time
  const POS_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const { runTimezoneAwareIncrementalSyncs, refreshAllPosTokens, backfillLocationTimezones } = await import("./services/posSyncJobs");

  // Backfill externalTimezone for any active connections that existed before #544.
  // Runs once, 30 seconds after startup, so the server is already serving requests.
  // Non-blocking — errors are caught inside backfillLocationTimezones().
  setTimeout(() => {
    backfillLocationTimezones().catch((e: any) =>
      console.warn("⚠️  POS timezone backfill error:", e.message),
    );
  }, 30_000);

  // POS token refresh job — runs daily to stay inside Square's 7-day renewal window.
  // Runs independently of the nightly sync so disconnected accounts still get refreshed.
  const POS_TOKEN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const POS_TOKEN_REFRESH_JITTER_MS = 30 * 60 * 1000; // ±30 minutes

  const refreshPosTokensJob = async () => {
    try {
      const results = await refreshAllPosTokens();
      if (results.success > 0 || results.failed > 0) {
        log(`🔄 POS token refresh: ${results.success} success, ${results.failed} failed`);
      }
    } catch (error) {
      console.error("❌ POS token refresh job error:", error);
    }
  };

  // Delay 5 minutes after startup, then run every 24h with ±30min jitter
  setTimeout(refreshPosTokensJob, 5 * 60 * 1000);
  setInterval(() => {
    const jitter = Math.random() * POS_TOKEN_REFRESH_JITTER_MS * 2 - POS_TOKEN_REFRESH_JITTER_MS;
    setTimeout(refreshPosTokensJob, Math.max(0, jitter));
  }, POS_TOKEN_REFRESH_INTERVAL_MS);
  log(
    `🔄 POS token refresh job scheduled (every ${POS_TOKEN_REFRESH_INTERVAL_MS / 1000 / 60 / 60}h ` +
    `±${POS_TOKEN_REFRESH_JITTER_MS / 1000 / 60}min, first run in 5min)`,
  );
  // Hourly pass fires at the top of each hour.  The handler checks which
  // connections have a location in the 4 AM window (timezone-aware) and
  // runs incremental sync only for those.  Connections with no timezone
  // data fall back to UTC 4 AM so they always get a nightly sync.
  const scheduleHourlyPosSync = () => {
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setUTCMinutes(0, 0, 0);
    nextHour.setUTCHours(nextHour.getUTCHours() + 1); // top of next UTC hour
    const msUntilFirst = nextHour.getTime() - now.getTime();

    setTimeout(() => {
      runTimezoneAwareIncrementalSyncs().catch((e: any) =>
        console.error("❌ POS hourly sync error:", e),
      );
      setInterval(() => {
        runTimezoneAwareIncrementalSyncs().catch((e: any) =>
          console.error("❌ POS hourly sync error:", e),
        );
      }, POS_SYNC_INTERVAL_MS);
    }, msUntilFirst);

    log(`🔄 POS hourly sync pass scheduled (first run at ${nextHour.toISOString()})`);
  };
  scheduleHourlyPosSync();

  // Menu scheduled → live activation — runs every 5 minutes
  // Promotes menus whose effectiveStart has passed from 'scheduled' to 'live'
  const MENU_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const activateScheduledMenusJob = async () => {
    try {
      const { activateScheduledMenus } = await import("./services/menuForecastService");
      const count = await activateScheduledMenus();
      if (count > 0) {
        log(`📅 Menu scheduler: activated ${count} scheduled menu(s) to live`);
      }
    } catch (error) {
      console.error("❌ Menu scheduler error:", error);
    }
  };
  // First run 2 minutes after startup, then every 5 minutes
  setTimeout(activateScheduledMenusJob, 2 * 60 * 1000);
  setInterval(activateScheduledMenusJob, MENU_SCHEDULER_INTERVAL_MS);
  log(`🔄 Menu scheduler job scheduled (every ${MENU_SCHEDULER_INTERVAL_MS / 1000 / 60} minutes, first run in 2min)`);

  // POS stuck-job auto-cleanup — runs every 15 minutes, expires running jobs > 60 min old.
  // This is a safety net for the double-fault case where a job gets stuck in running state
  // and the error handler itself failed to mark it failed.
  const POS_STUCK_JOB_CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  const releaseStuckPosJobsJob = async () => {
    try {
      const released = await storage.releaseStalePosSyncLocks(60);
      if (released > 0) {
        log(`🔒 POS stuck-job cleanup: released ${released} stale lock(s) (>60 min running)`);
      }
    } catch (error) {
      console.error("❌ POS stuck-job cleanup error:", error);
    }
  };
  // Delay 2 minutes after startup so the server is ready, then run every 15 min
  setTimeout(releaseStuckPosJobsJob, 2 * 60 * 1000);
  setInterval(releaseStuckPosJobsJob, POS_STUCK_JOB_CLEANUP_INTERVAL_MS);
  log(`🔄 POS stuck-job cleanup scheduled (every ${POS_STUCK_JOB_CLEANUP_INTERVAL_MS / 1000 / 60} minutes, first run in 2min)`);

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
