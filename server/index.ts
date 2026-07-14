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
        aliases text[] NOT NULL DEFAULT '{}',
        website_domains text[] NOT NULL DEFAULT '{}',
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
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS exact_aliases text[] NOT NULL DEFAULT '{}'`);
    // Seed known distributor entries — DO UPDATE so aliases/domains/exact_aliases stay current on every deploy
    // exact_aliases: abbreviations that must match EXACTLY (e.g. "gfs") — prevents "ABC GFS Distribution" false-positives
    // aliases: longer descriptive names matched via ILIKE contains
    await db.execute(sql`
      INSERT INTO platform_vendor_registry (normalized_name, exact_aliases, aliases, website_domains, connector_id, status, source) VALUES
        ('sysco',
         ARRAY['sygma'],
         ARRAY['sysco corporation','sysco foods','sysco foodservice','sysco food service','sygma network','sysco guest supply'],
         ARRAY['sysco.com','shop.sysco.com','syscofoodservice.com','sygmanetwork.com'],
         'sysco', 'approved', 'seed'),
        ('gordon food service',
         ARRAY['gfs'],
         ARRAY['gordon food service','gordon''s food service','gordon foodservice','gordon food svc','gordon food'],
         ARRAY['gfs.com','gordonfoodservice.com'],
         'gfs', 'approved', 'seed'),
        ('us foods',
         ARRAY['usfoods'],
         ARRAY['us foods','us foodservice','us food service','us foods inc','u.s. foods','u.s. foodservice'],
         ARRAY['usfoods.com','usfood.com','usfoodservice.com'],
         'usfoods', 'approved', 'seed'),
        ('performance food service',
         ARRAY['pfs','pfg','reinhart','vistar'],
         ARRAY['performance food service','performance food','performance foodservice','performance food group','reinhart foodservice'],
         ARRAY['pfgc.com','pfg.com','performancefoodservice.com','reinhartfoodservice.com'],
         'pfs', 'approved', 'seed'),
        ('southern foods',
         ARRAY['sofo'],
         ARRAY['sofo foods','southern food','southern food service','southern food group'],
         ARRAY['sofofoods.com','southernfoods.com'],
         'sofo', 'approved', 'seed')
      ON CONFLICT (normalized_name, connector_id) DO UPDATE
        SET exact_aliases = EXCLUDED.exact_aliases,
            aliases = EXCLUDED.aliases,
            website_domains = EXCLUDED.website_domains
    `);
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
