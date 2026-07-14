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
    // Task #400: Store the detect confidence/reason on user-submitted entries for admin review
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS detection_confidence text`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS detection_reason text`);
    // Task #402: Track re-submissions on rejected entries
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS submission_count int NOT NULL DEFAULT 1`);
    await db.execute(sql`ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS submitted_by_company_ids text[] NOT NULL DEFAULT '{}'`);
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
    // Seed connected distributors — DO UPDATE keeps metadata current on every deploy.
    // exact_aliases: abbreviations matched EXACTLY; aliases: longer names matched via ILIKE contains.
    // FreshPoint added as sysco alias (it's a Sysco subsidiary sharing the same CSV column format).
    await db.execute(sql`
      INSERT INTO platform_vendor_registry
        (normalized_name, exact_aliases, aliases, website_domains, connector_id, category, website, ordering_url, portal_status, status, source)
      VALUES
        ('sysco',
         ARRAY['sygma'],
         ARRAY['sysco corporation','sysco foods','sysco foodservice','sysco food service','sygma network','sysco guest supply','freshpoint','fresh point'],
         ARRAY['sysco.com','shop.sysco.com','syscofoodservice.com','sygmanetwork.com','freshpoint.com'],
         'sysco','Broadline','https://www.sysco.com','https://shop.sysco.com','Self-serve portal','approved','seed'),
        ('gordon food service',
         ARRAY['gfs'],
         ARRAY['gordon food service','gordon''s food service','gordon foodservice','gordon food svc','gordon food'],
         ARRAY['gfs.com','gordonfoodservice.com'],
         'gfs','Broadline','https://www.gfs.com','https://www.gfs.com/store','Self-serve portal','approved','seed'),
        ('us foods',
         ARRAY['usfoods'],
         ARRAY['us foods','us foodservice','us food service','us foods inc','u.s. foods','u.s. foodservice'],
         ARRAY['usfoods.com','usfood.com','usfoodservice.com'],
         'usfoods','Broadline','https://www.usfoods.com','https://www.usfoods.com/our-services/online-ordering.html','Self-serve portal','approved','seed'),
        ('performance food group',
         ARRAY['pfg'],
         ARRAY['performance food group','performance net','pfg foodservice'],
         ARRAY['pfgc.com','performancenet.com'],
         'pfg','Broadline','https://www.pfgc.com','https://www.performancenet.com','Self-serve portal (Performance Net)','approved','seed'),
        ('performance food service',
         ARRAY['pfs','reinhart','vistar'],
         ARRAY['performance food service','performance food','performance foodservice','reinhart foodservice','vistar corporation'],
         ARRAY['performancefoodservice.com','reinhartfoodservice.com','vistar.com'],
         'pfs','Broadline','https://www.pfgc.com',NULL,'Contact rep','approved','seed'),
        ('ben e. keith',
         ARRAY['bek'],
         ARRAY['ben e keith','ben e. keith foods','ben e. keith beverages','bek foods'],
         ARRAY['bek.com','benekeith.com'],
         'bek','Broadline','https://www.bek.com','https://www.bek.com','Self-serve portal (My BEK)','approved','seed'),
        ('southern foods',
         ARRAY['sofo'],
         ARRAY['sofo foods','southern food','southern food service','southern food group'],
         ARRAY['sofofoods.com','southernfoods.com'],
         'sofo','Broadline','https://www.sofofoods.com',NULL,'Contact rep','approved','seed')
      ON CONFLICT (normalized_name, (COALESCE(connector_id, ''))) DO UPDATE
        SET exact_aliases  = EXCLUDED.exact_aliases,
            aliases        = EXCLUDED.aliases,
            website_domains= EXCLUDED.website_domains,
            category       = EXCLUDED.category,
            website        = EXCLUDED.website,
            ordering_url   = EXCLUDED.ordering_url,
            portal_status  = EXCLUDED.portal_status
    `);
    // Task #407: Seed 141 U.S. food purveyors — vendors without a CSV/EDI connector (connector_id = NULL).
    // Uses ON CONFLICT on normalized_name where connector_id IS NULL (covered by the COALESCE index above).
    await db.execute(sql`
      INSERT INTO platform_vendor_registry
        (normalized_name, aliases, website_domains, connector_id, category, website, ordering_url, portal_status, status, source)
      VALUES
        -- Broadline Distributors
        ('reinhart foodservice',ARRAY['reinhart','reinhart foods'],ARRAY['reinhartfoodservice.com'],NULL,'Broadline','https://www.reinhartfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('cheney brothers',ARRAY['cheney brothers inc','cheney bro'],ARRAY['cheneybrothers.com'],NULL,'Broadline','https://www.cheneybrothers.com',NULL,'Contact rep','approved','seed'),
        ('nicholas & company',ARRAY['nicholas and company','nicholas co'],ARRAY['nicholasandco.com'],NULL,'Broadline','https://www.nicholasandco.com',NULL,'Contact rep','approved','seed'),
        ('labatt food service',ARRAY['labatt foodservice','labatt'],ARRAY['labattfoodservice.com'],NULL,'Broadline','https://www.labattfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('shamrock foods',ARRAY['shamrock food','shamrock foodservice'],ARRAY['shamrockfoods.com'],NULL,'Broadline','https://www.shamrockfoods.com',NULL,'Contact rep','approved','seed'),
        ('ace endico',ARRAY['ace endico corporation'],ARRAY['aceendico.com'],NULL,'Broadline','https://www.aceendico.com',NULL,'Contact rep','approved','seed'),
        ('roma food',ARRAY['roma foods','roma food enterprises'],ARRAY['romafood.com'],NULL,'Broadline','https://www.romafood.com',NULL,'Contact rep','approved','seed'),
        ('martin brothers',ARRAY['martin brothers distributing','martin bro'],ARRAY['martinbrothers.com'],NULL,'Broadline','https://www.martinbrothers.com',NULL,'Contact rep','approved','seed'),
        ('dot foods',ARRAY['dot foods inc'],ARRAY['dotfoods.com'],NULL,'Redistributor','https://www.dotfoods.com',NULL,'Contact rep','approved','seed'),
        ('restaurant depot',ARRAY['jetro cash & carry','jetro'],ARRAY['restaurantdepot.com','jetro.com'],NULL,'Cash & Carry','https://www.restaurantdepot.com',NULL,'Self-serve portal','approved','seed'),
        ('food services of america',ARRAY['fsa','foods services of america'],ARRAY['fsafood.com'],NULL,'Broadline','https://www.fsafood.com',NULL,'Contact rep','approved','seed'),
        ('maines paper & food service',ARRAY['maines','maines food service'],ARRAY['mainesfoodservice.com'],NULL,'Broadline','https://www.mainesfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('lipari foods',ARRAY['lipari'],ARRAY['liparifoods.com'],NULL,'Broadline','https://www.liparifoods.com',NULL,'Contact rep','approved','seed'),
        ('merchants food service',ARRAY['merchants foodservice'],ARRAY['merchantsfoodservice.com'],NULL,'Broadline','https://www.merchantsfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('honor foods',ARRAY['honor foods inc'],ARRAY['honorfoods.com'],NULL,'Broadline','https://www.honorfoods.com',NULL,'Contact rep','approved','seed'),
        ('vistar',ARRAY['vistar corporation'],ARRAY['vistar.com'],NULL,'Convenience & Vending','https://www.vistar.com',NULL,'Contact rep','approved','seed'),
        ('piazza produce',ARRAY['piazza produce & specialty foods','piazza'],ARRAY['piazzaproduce.com'],NULL,'Broadline','https://www.piazzaproduce.com',NULL,'Contact rep','approved','seed'),
        ('glazier foods',ARRAY['glazier food company'],ARRAY['glazierfoods.com'],NULL,'Broadline','https://www.glazierfoods.com',NULL,'Contact rep','approved','seed'),
        ('clark food service',ARRAY['clark foodservice'],ARRAY['clarkfoodservice.com'],NULL,'Broadline','https://www.clarkfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('associated wholesale grocers',ARRAY['awg'],ARRAY['awginc.com'],NULL,'Wholesale','https://www.awginc.com',NULL,'Contact rep','approved','seed'),
        ('amcon distributing',ARRAY['amcon'],ARRAY['amcon.com'],NULL,'Broadline','https://www.amcon.com',NULL,'Contact rep','approved','seed'),
        ('c&s wholesale grocers',ARRAY['c and s wholesale','cs wholesale'],ARRAY['cswg.com'],NULL,'Wholesale','https://www.cswg.com',NULL,'Contact rep','approved','seed'),
        ('webstaurant store',ARRAY['webstaurantstore'],ARRAY['webstaurantstore.com'],NULL,'Online Retail','https://www.webstaurantstore.com','https://www.webstaurantstore.com','Self-serve portal','approved','seed'),
        -- Produce Distributors
        ('baldor specialty foods',ARRAY['baldor'],ARRAY['baldorfood.com'],NULL,'Produce & Specialty','https://www.baldorfood.com',NULL,'Contact rep','approved','seed'),
        ('four seasons produce',ARRAY['four seasons'],ARRAY['fsproduce.com'],NULL,'Produce','https://www.fsproduce.com',NULL,'Contact rep','approved','seed'),
        ('robinson fresh',ARRAY['robinson fresh llc'],ARRAY['robinsonfresh.com'],NULL,'Produce','https://www.robinsonfresh.com',NULL,'Contact rep','approved','seed'),
        ('produce alliance',ARRAY[],ARRAY['producealliance.com'],NULL,'Produce','https://www.producealliance.com',NULL,'Contact rep','approved','seed'),
        ('markon cooperative',ARRAY['markon'],ARRAY['markon.com'],NULL,'Produce','https://www.markon.com',NULL,'Contact rep','approved','seed'),
        ('pro*act',ARRAY['proact','pro act'],ARRAY['proactusa.com'],NULL,'Produce','https://www.proactusa.com',NULL,'Contact rep','approved','seed'),
        ('church brothers farms',ARRAY['church brothers'],ARRAY['churchbrothers.com'],NULL,'Produce','https://www.churchbrothers.com',NULL,'Contact rep','approved','seed'),
        ('earthbound farm',ARRAY['earthbound'],ARRAY['earthboundfarm.com'],NULL,'Organic Produce','https://www.earthboundfarm.com',NULL,'Contact rep','approved','seed'),
        ('dole foodservice',ARRAY['dole food service','dole'],ARRAY['dolefoodservice.com','dole.com'],NULL,'Produce','https://www.dolefoodservice.com',NULL,'Contact rep','approved','seed'),
        ('ready pac foods',ARRAY['ready pac','ready pac biase'],ARRAY['readypac.com'],NULL,'Produce & Value-Added','https://www.readypac.com',NULL,'Contact rep','approved','seed'),
        ('grimmway farms',ARRAY['grimmway'],ARRAY['grimmway.com'],NULL,'Produce','https://www.grimmway.com',NULL,'Contact rep','approved','seed'),
        ('mann packing',ARRAY['mann farms'],ARRAY['freshfrommann.com'],NULL,'Produce','https://www.freshfrommann.com',NULL,'Contact rep','approved','seed'),
        ('cal-organic farms',ARRAY['cal organic','calorganic'],ARRAY['calorganic.com'],NULL,'Organic Produce','https://www.calorganic.com',NULL,'Contact rep','approved','seed'),
        ('paradise produce',ARRAY[],ARRAY[],NULL,'Produce',NULL,NULL,'Contact rep','approved','seed'),
        -- Protein Distributors
        ('tyson foodservice',ARRAY['tyson food service','tyson'],ARRAY['tysonfoodservice.com'],NULL,'Protein','https://www.tysonfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('jbs foodservice',ARRAY['jbs usa','jbs food service'],ARRAY['jbssa.com'],NULL,'Protein','https://www.jbssa.com',NULL,'Contact rep','approved','seed'),
        ('smithfield culinary',ARRAY['smithfield foods','smithfield food service'],ARRAY['smithfieldculinary.com'],NULL,'Protein','https://www.smithfieldculinary.com',NULL,'Contact rep','approved','seed'),
        ('cargill meat solutions',ARRAY['cargill','cargill meat'],ARRAY['cargill.com'],NULL,'Protein','https://www.cargill.com',NULL,'Contact rep','approved','seed'),
        ('perdue foodservice',ARRAY['perdue food service','perdue farms'],ARRAY['perduefoodservice.com'],NULL,'Protein','https://www.perduefoodservice.com',NULL,'Contact rep','approved','seed'),
        ('wayne-sanderson farms',ARRAY['wayne sanderson','wayne farms','sanderson farms'],ARRAY['waynesandersonfarms.com','sandersonfarms.com'],NULL,'Protein','https://www.waynesandersonfarms.com',NULL,'Contact rep','approved','seed'),
        ('national beef packing',ARRAY['national beef'],ARRAY['nationalbeef.com'],NULL,'Protein','https://www.nationalbeef.com',NULL,'Contact rep','approved','seed'),
        ('greater omaha packing',ARRAY['greater omaha'],ARRAY['greateromaha.com'],NULL,'Protein','https://www.greateromaha.com',NULL,'Contact rep','approved','seed'),
        ('allen harim',ARRAY['allen harim foods'],ARRAY['allenharimfoods.com'],NULL,'Protein','https://www.allenharimfoods.com',NULL,'Contact rep','approved','seed'),
        ('koch foods',ARRAY['koch food'],ARRAY['kochfoods.com'],NULL,'Protein','https://www.kochfoods.com',NULL,'Contact rep','approved','seed'),
        ('pilgrim''s pride',ARRAY['pilgrims pride','pilgrims'],ARRAY['pilgrims.com'],NULL,'Protein','https://www.pilgrims.com',NULL,'Contact rep','approved','seed'),
        ('keystone foods',ARRAY['keystone food'],ARRAY['keystonefoods.com'],NULL,'Protein','https://www.keystonefoods.com',NULL,'Contact rep','approved','seed'),
        ('case farms',ARRAY['case farms llc'],ARRAY['casefarms.com'],NULL,'Protein','https://www.casefarms.com',NULL,'Contact rep','approved','seed'),
        ('harvest meat company',ARRAY['harvest meat'],ARRAY['harvestmeat.com'],NULL,'Protein','https://www.harvestmeat.com',NULL,'Contact rep','approved','seed'),
        -- Seafood Distributors
        ('high liner foods',ARRAY['high liner'],ARRAY['highlinerfoods.com'],NULL,'Seafood','https://www.highlinerfoods.com',NULL,'Contact rep','approved','seed'),
        ('gorton''s commercial',ARRAY['gortons','gorton fish'],ARRAY['gortons.com'],NULL,'Seafood','https://www.gortons.com',NULL,'Contact rep','approved','seed'),
        ('orca bay seafoods',ARRAY['orca bay'],ARRAY['orcabayseafoods.com'],NULL,'Seafood','https://www.orcabayseafoods.com',NULL,'Contact rep','approved','seed'),
        ('ocean beauty seafoods',ARRAY['ocean beauty'],ARRAY['oceanbeauty.com'],NULL,'Seafood','https://www.oceanbeauty.com',NULL,'Contact rep','approved','seed'),
        ('pacific seafood',ARRAY['pacific seafood group'],ARRAY['pacificseafood.com'],NULL,'Seafood','https://www.pacificseafood.com',NULL,'Contact rep','approved','seed'),
        ('trident seafoods',ARRAY['trident seafood'],ARRAY['tridentseafoods.com'],NULL,'Seafood','https://www.tridentseafoods.com',NULL,'Contact rep','approved','seed'),
        ('bumble bee foodservice',ARRAY['bumble bee foods','bumble bee'],ARRAY['bumblebeefoods.com'],NULL,'Seafood','https://www.bumblebeefoods.com',NULL,'Contact rep','approved','seed'),
        ('starkist foodservice',ARRAY['starkist food service','starkist'],ARRAY['starkist.com'],NULL,'Seafood','https://www.starkist.com',NULL,'Contact rep','approved','seed'),
        ('true north seafood',ARRAY['true north'],ARRAY['truenorthseafood.com'],NULL,'Seafood','https://www.truenorthseafood.com',NULL,'Contact rep','approved','seed'),
        ('harbor seafood',ARRAY['harbor fish','harbor foods'],ARRAY[],NULL,'Seafood',NULL,NULL,'Contact rep','approved','seed'),
        ('premier catch',ARRAY['premier catch seafood'],ARRAY['premiercatch.com'],NULL,'Seafood','https://www.premiercatch.com',NULL,'Contact rep','approved','seed'),
        -- Dairy & Eggs
        ('dairy farmers of america',ARRAY['dfa','dfa milk'],ARRAY['dfamilk.com'],NULL,'Dairy','https://www.dfamilk.com',NULL,'Contact rep','approved','seed'),
        ('land o''lakes foodservice',ARRAY['land o lakes','landolakes'],ARRAY['landolakesfoodservice.com'],NULL,'Dairy','https://www.landolakesfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('darigold foodservice',ARRAY['darigold food service','darigold'],ARRAY['darigold.com'],NULL,'Dairy','https://www.darigold.com',NULL,'Contact rep','approved','seed'),
        ('saputo usa',ARRAY['saputo cheese','saputo dairy'],ARRAY['saputo.com'],NULL,'Dairy','https://www.saputo.com',NULL,'Contact rep','approved','seed'),
        ('bel brands usa',ARRAY['bel brands','bel cheese'],ARRAY['belbrandsusa.com'],NULL,'Dairy','https://www.belbrandsusa.com',NULL,'Contact rep','approved','seed'),
        ('lactalis usa',ARRAY['lactalis american group','lactalis'],ARRAY['lactalisusa.com'],NULL,'Dairy','https://www.lactalisusa.com',NULL,'Contact rep','approved','seed'),
        ('tillamook foodservice',ARRAY['tillamook food service','tillamook creamery'],ARRAY['tillamook.com'],NULL,'Dairy','https://www.tillamook.com',NULL,'Contact rep','approved','seed'),
        ('organic valley foodservice',ARRAY['organic valley food service','organic valley'],ARRAY['organicvalley.coop'],NULL,'Organic Dairy','https://www.organicvalley.coop',NULL,'Contact rep','approved','seed'),
        ('horizon organic foodservice',ARRAY['horizon organic food service','horizon organic'],ARRAY['horizonorganic.com'],NULL,'Organic Dairy','https://www.horizonorganic.com',NULL,'Contact rep','approved','seed'),
        ('crystal farms',ARRAY['crystal farms dairy'],ARRAY['crystalfarms.com'],NULL,'Dairy','https://www.crystalfarms.com',NULL,'Contact rep','approved','seed'),
        ('hillandale farms',ARRAY['hillandale'],ARRAY['hillandalefarms.com'],NULL,'Eggs','https://www.hillandalefarms.com',NULL,'Contact rep','approved','seed'),
        ('cal-maine foods',ARRAY['cal maine','calmaine'],ARRAY['calmaine.com'],NULL,'Eggs','https://www.calmaine.com',NULL,'Contact rep','approved','seed'),
        ('rose acre farms',ARRAY['rose acre'],ARRAY['roseacre.com'],NULL,'Eggs','https://www.roseacre.com',NULL,'Contact rep','approved','seed'),
        ('michael foods',ARRAY['michael foods inc','michael food'],ARRAY['michaelfoods.com'],NULL,'Eggs & Potato','https://www.michaelfoods.com',NULL,'Contact rep','approved','seed'),
        -- Beverage Distributors
        ('coca-cola north america',ARRAY['coca cola','coke','coca-cola','coke foodservice'],ARRAY['coca-cola.com','coca-colacompany.com'],NULL,'Beverage','https://www.coca-colacompany.com',NULL,'Contact rep','approved','seed'),
        ('pepsico foodservice',ARRAY['pepsi food service','pepsico','pepsi'],ARRAY['pepsicofoodservice.com'],NULL,'Beverage','https://www.pepsicofoodservice.com',NULL,'Contact rep','approved','seed'),
        ('reyes beverage group',ARRAY['reyes beverage'],ARRAY['reyesbeveragegroup.com'],NULL,'Beverage Distributor','https://www.reyesbeveragegroup.com',NULL,'Contact rep','approved','seed'),
        ('swire coca-cola usa',ARRAY['swire coca cola','swire cc'],ARRAY['swirecc.com'],NULL,'Beverage Distributor','https://www.swirecc.com',NULL,'Contact rep','approved','seed'),
        ('southern glazer''s wine & spirits',ARRAY['southern glazers','southern wine spirits'],ARRAY['sgws.com'],NULL,'Beverage Distributor','https://www.sgws.com',NULL,'Contact rep','approved','seed'),
        ('republic national distributing',ARRAY['rndc','republic national'],ARRAY['rndc-usa.com'],NULL,'Beverage Distributor','https://www.rndc-usa.com',NULL,'Contact rep','approved','seed'),
        ('breakthru beverage group',ARRAY['breakthru beverage'],ARRAY['breakthrubev.com'],NULL,'Beverage Distributor','https://www.breakthrubev.com',NULL,'Contact rep','approved','seed'),
        ('national distributing company',ARRAY['ndc','national distributing'],ARRAY['ndc.com'],NULL,'Beverage Distributor','https://www.ndc.com',NULL,'Contact rep','approved','seed'),
        ('glazer''s beer and beverage',ARRAY['glazers beer','glazer beer'],ARRAY['glazersbeer.com'],NULL,'Beverage Distributor','https://www.glazersbeer.com',NULL,'Contact rep','approved','seed'),
        ('red bull north america',ARRAY['red bull'],ARRAY['redbull.com'],NULL,'Beverage','https://www.redbull.com',NULL,'Contact rep','approved','seed'),
        -- Specialty & Gourmet
        ('chefs'' warehouse',ARRAY['chefs warehouse inc','the chefs warehouse'],ARRAY['chefswarehouse.com'],NULL,'Specialty & Gourmet','https://www.chefswarehouse.com',NULL,'Contact rep','approved','seed'),
        ('gourmet foods international',ARRAY['gfi','gourmet foods intl'],ARRAY['gfi-atl.com'],NULL,'Specialty & Gourmet','https://www.gfi-atl.com',NULL,'Contact rep','approved','seed'),
        ('cuisine solutions',ARRAY['cuisine solutions inc'],ARRAY['cuisinesolutions.com'],NULL,'Specialty & Sous Vide','https://www.cuisinesolutions.com',NULL,'Contact rep','approved','seed'),
        ('la preferida',ARRAY['la preferida inc'],ARRAY['lapreferida.com'],NULL,'Ethnic & Specialty','https://www.lapreferida.com',NULL,'Contact rep','approved','seed'),
        ('goya foods',ARRAY['goya'],ARRAY['goya.com'],NULL,'Ethnic & Specialty','https://www.goya.com',NULL,'Contact rep','approved','seed'),
        ('megamex foods',ARRAY['megamex'],ARRAY['megamexfoods.com'],NULL,'Ethnic & Specialty','https://www.megamexfoods.com',NULL,'Contact rep','approved','seed'),
        ('don miguel mexican foods',ARRAY['don miguel'],ARRAY['donmiguel.com'],NULL,'Ethnic & Specialty','https://www.donmiguel.com',NULL,'Contact rep','approved','seed'),
        -- Frozen & Manufactured Foods
        ('schwan food company',ARRAY['schwan''s food service','schwan food service'],ARRAY['schwansfoodservice.com'],NULL,'Frozen','https://www.schwansfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('conagra foodservice',ARRAY['conagra food service','conagra brands'],ARRAY['conagrabrands.com'],NULL,'Frozen & Center of Plate','https://www.conagrabrands.com',NULL,'Contact rep','approved','seed'),
        ('mccain foods usa',ARRAY['mccain food service','mccain'],ARRAY['mccainusafoodservice.com'],NULL,'Frozen Potato','https://www.mccainusafoodservice.com',NULL,'Contact rep','approved','seed'),
        ('lamb weston',ARRAY['lamb weston holdings'],ARRAY['lambweston.com'],NULL,'Frozen Potato','https://www.lambweston.com',NULL,'Contact rep','approved','seed'),
        ('simplot food group',ARRAY['simplot','j.r. simplot'],ARRAY['simplotfoods.com'],NULL,'Frozen Potato','https://www.simplotfoods.com',NULL,'Contact rep','approved','seed'),
        ('rich products corporation',ARRAY['rich''s','rich products'],ARRAY['richs.com'],NULL,'Frozen Bakery & Dairy','https://www.richs.com',NULL,'Contact rep','approved','seed'),
        ('bridgford foods',ARRAY['bridgford'],ARRAY['bridgford.com'],NULL,'Frozen','https://www.bridgford.com',NULL,'Contact rep','approved','seed'),
        ('bob evans foodservice',ARRAY['bob evans food service','bob evans'],ARRAY['bobevans.com'],NULL,'Frozen & Prepared','https://www.bobevans.com',NULL,'Contact rep','approved','seed'),
        ('cavendish farms',ARRAY['cavendish'],ARRAY['cavendishfarms.com'],NULL,'Frozen Potato','https://www.cavendishfarms.com',NULL,'Contact rep','approved','seed'),
        -- Dry Goods, Grocery & Natural
        ('kehe distributors',ARRAY['kehe','keHE'],ARRAY['kehe.com'],NULL,'Natural & Specialty','https://www.kehe.com',NULL,'Contact rep','approved','seed'),
        ('unfi foodservice',ARRAY['unfi','united natural foods'],ARRAY['unfi.com'],NULL,'Natural & Organic','https://www.unfi.com',NULL,'Contact rep','approved','seed'),
        ('tree top food service',ARRAY['tree top','treetop'],ARRAY['treetop.com'],NULL,'Fruit & Beverage','https://www.treetop.com',NULL,'Contact rep','approved','seed'),
        ('pacific foods',ARRAY['pacific foods of oregon'],ARRAY['pacificfoods.com'],NULL,'Soup & Broth','https://www.pacificfoods.com',NULL,'Contact rep','approved','seed'),
        ('kraft heinz foodservice',ARRAY['kraft heinz food service','kraft foodservice','heinz foodservice'],ARRAY['kraftheinzfoodservice.com'],NULL,'Manufactured Foods','https://www.kraftheinzfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('campbell''s foodservice',ARRAY['campbells food service','campbell soup'],ARRAY['campbellsfoodservice.com'],NULL,'Soup & Manufactured Foods','https://www.campbellsfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('mccormick foodservice',ARRAY['mccormick food service','mccormick & company'],ARRAY['mccormickfoodservice.com'],NULL,'Spices & Sauces','https://www.mccormickfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('nestle professional',ARRAY['nestlé professional','nestle food service'],ARRAY['nestleprofessional.com'],NULL,'Manufactured Foods','https://www.nestleprofessional.com',NULL,'Contact rep','approved','seed'),
        ('unilever food solutions',ARRAY['unilever foodservice','ufs'],ARRAY['unileverfoodsolutions.us'],NULL,'Manufactured Foods','https://www.unileverfoodsolutions.us',NULL,'Contact rep','approved','seed'),
        ('del monte foodservice',ARRAY['del monte food service'],ARRAY['delmonte.com'],NULL,'Canned & Prepared','https://www.delmonte.com',NULL,'Contact rep','approved','seed'),
        ('bush''s best foodservice',ARRAY['bushs best food service','bush brothers','bush''s beans'],ARRAY['bushbeans.com'],NULL,'Canned Goods','https://www.bushbeans.com',NULL,'Contact rep','approved','seed'),
        ('barilla america foodservice',ARRAY['barilla food service','barilla'],ARRAY['barilla.com'],NULL,'Pasta','https://www.barilla.com',NULL,'Contact rep','approved','seed'),
        -- Paper, Packaging & Non-food Supplies
        ('imperial dade',ARRAY['imperial bag','imperial paper'],ARRAY['imperialdade.com'],NULL,'Paper & Packaging','https://www.imperialdade.com',NULL,'Contact rep','approved','seed'),
        ('bunzl distribution',ARRAY['bunzl'],ARRAY['bunzldistribution.com'],NULL,'Paper & Packaging','https://www.bunzldistribution.com',NULL,'Contact rep','approved','seed'),
        ('waxie sanitary supply',ARRAY['waxie'],ARRAY['waxie.com'],NULL,'Sanitation & Supplies','https://www.waxie.com',NULL,'Contact rep','approved','seed'),
        ('american paper & twine',ARRAY['american paper twine','apt'],ARRAY['americanpaper.com'],NULL,'Paper & Packaging','https://www.americanpaper.com',NULL,'Contact rep','approved','seed'),
        -- Specialty/National Brands (manufacturer-direct)
        ('molson coors beverage',ARRAY['molson coors','coors','miller coors'],ARRAY['molsoncoors.com'],NULL,'Beverage','https://www.molsoncoors.com',NULL,'Contact rep','approved','seed'),
        ('boston beer company',ARRAY['boston beer','samuel adams','sam adams'],ARRAY['bostonbeer.com'],NULL,'Beverage','https://www.bostonbeer.com',NULL,'Contact rep','approved','seed'),
        ('diageo north america',ARRAY['diageo'],ARRAY['diageo.com'],NULL,'Spirits','https://www.diageo.com',NULL,'Contact rep','approved','seed'),
        ('brown-forman distributing',ARRAY['brown forman','jack daniels distillery'],ARRAY['brown-forman.com'],NULL,'Spirits','https://www.brown-forman.com',NULL,'Contact rep','approved','seed'),
        -- Regional & Specialty
        ('shamrock farms',ARRAY['shamrock farm','shamrock dairy'],ARRAY['shamrockfarms.com'],NULL,'Dairy','https://www.shamrockfarms.com',NULL,'Contact rep','approved','seed'),
        ('oregon potato company',ARRAY['oregon potato'],ARRAY['oregonpotato.com'],NULL,'Produce','https://www.oregonpotato.com',NULL,'Contact rep','approved','seed'),
        ('draper valley farms',ARRAY['draper valley'],ARRAY['drapervalleyfarms.com'],NULL,'Protein','https://www.drapervalleyfarms.com',NULL,'Contact rep','approved','seed'),
        ('birds eye foodservice',ARRAY['birds eye food service','birds eye'],ARRAY['birdseye.com'],NULL,'Frozen Vegetables','https://www.birdseye.com',NULL,'Contact rep','approved','seed'),
        ('us foods chef''store',ARRAY['chef''store','chefstore'],ARRAY['chefstore.com'],NULL,'Cash & Carry','https://www.chefstore.com','https://www.chefstore.com','Self-serve portal','approved','seed'),
        ('pacific coast producers',ARRAY['pacific coast prod'],ARRAY['pacificcoastproducers.com'],NULL,'Canned Produce','https://www.pacificcoastproducers.com',NULL,'Contact rep','approved','seed'),
        ('fresh express',ARRAY['fresh express inc'],ARRAY['freshexpress.com'],NULL,'Produce','https://www.freshexpress.com',NULL,'Contact rep','approved','seed'),
        ('flowers foods foodservice',ARRAY['flowers foods food service','flowers bakeries'],ARRAY['flowersfoodservice.com'],NULL,'Bakery','https://www.flowersfoodservice.com',NULL,'Contact rep','approved','seed'),
        ('sara lee foodservice',ARRAY['sara lee food service'],ARRAY['saralee.com'],NULL,'Frozen Bakery','https://www.saralee.com',NULL,'Contact rep','approved','seed'),
        ('frito-lay foodservice',ARRAY['frito lay food service','frito lay'],ARRAY['fritolay.com'],NULL,'Snacks','https://www.fritolay.com',NULL,'Contact rep','approved','seed'),
        ('georgia-pacific professional',ARRAY['georgia pacific','gp professional'],ARRAY['gppro.com'],NULL,'Paper & Sanitation','https://www.gppro.com',NULL,'Contact rep','approved','seed'),
        ('uline',ARRAY[],ARRAY['uline.com'],NULL,'Packaging & Supplies','https://www.uline.com','https://www.uline.com','Self-serve portal','approved','seed')
      ON CONFLICT (normalized_name, (COALESCE(connector_id, ''))) DO UPDATE
        SET category     = EXCLUDED.category,
            website      = EXCLUDED.website,
            ordering_url = EXCLUDED.ordering_url,
            portal_status= EXCLUDED.portal_status,
            aliases      = EXCLUDED.aliases,
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
