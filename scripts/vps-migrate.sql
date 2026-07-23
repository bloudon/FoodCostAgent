-- =============================================================================
-- FNB Cost Pro — VPS Migration Script
-- Run with: psql $DATABASE_URL -f scripts/vps-migrate.sql
--
-- SAFE TO RUN MULTIPLE TIMES — every statement is idempotent.
-- Each version block only executes once (tracked in _migration_log).
--
-- To check what has been applied on the VPS:
--   psql $DATABASE_URL -c "SELECT * FROM _migration_log ORDER BY applied_at;"
-- =============================================================================

-- Bootstrap: create the migration log table if it doesn't exist yet.
-- This must come first so every version block below can reference it.
CREATE TABLE IF NOT EXISTS _migration_log (
  version      text        PRIMARY KEY,
  description  text        NOT NULL,
  applied_at   timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- v001 — Task #13: is_free_background column on background_images
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v001') THEN

    ALTER TABLE background_images
      ADD COLUMN IF NOT EXISTS is_free_background integer NOT NULL DEFAULT 0;

    INSERT INTO _migration_log (version, description)
      VALUES ('v001', 'Task #13: add is_free_background to background_images');
  END IF;
END $$;

-- =============================================================================
-- v002 — Task #13: unique constraint on daily_menu_item_sales
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v002') THEN

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'daily_menu_item_sales_unique'
    ) THEN
      ALTER TABLE daily_menu_item_sales ADD CONSTRAINT daily_menu_item_sales_unique
        UNIQUE (company_id, store_id, menu_item_id, sales_date, daypart_id, source_batch_id);
    END IF;

    INSERT INTO _migration_log (version, description)
      VALUES ('v002', 'Task #13: unique constraint on daily_menu_item_sales');
  END IF;
END $$;

-- =============================================================================
-- v003 — Task #13: unique constraint on inventory_count_lines
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v003') THEN

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'inventory_count_lines_unique'
    ) THEN
      ALTER TABLE inventory_count_lines ADD CONSTRAINT inventory_count_lines_unique
        UNIQUE (inventory_count_id, inventory_item_id, storage_location_id);
    END IF;

    INSERT INTO _migration_log (version, description)
      VALUES ('v003', 'Task #13: unique constraint on inventory_count_lines');
  END IF;
END $$;

-- =============================================================================
-- v004 — Category soft-delete + orphan protection
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v004') THEN

    -- Add is_active column to categories
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active integer NOT NULL DEFAULT 1;

    -- Fix any existing orphaned inventory items
    UPDATE inventory_items
    SET category_id = NULL
    WHERE category_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM categories c WHERE c.id = inventory_items.category_id
      );

    -- Add FK constraint ON DELETE SET NULL as safety net
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'inventory_items_category_id_fk'
        AND table_name = 'inventory_items'
    ) THEN
      ALTER TABLE inventory_items
        ADD CONSTRAINT inventory_items_category_id_fk
        FOREIGN KEY (category_id) REFERENCES categories(id)
        ON DELETE SET NULL;
    END IF;

    -- Seed missing default categories for all existing companies
    INSERT INTO categories (company_id, name, sort_order, show_as_ingredient, is_active)
    SELECT c.id, vals.name, vals.sort_order, vals.show_as_ingredient, 1
    FROM companies c
    CROSS JOIN (VALUES
      ('Produce',             1,  1),
      ('Dairy',               2,  1),
      ('Proteins',            3,  1),
      ('Seafood',             4,  1),
      ('Bread/Dough',         8,  1),
      ('Spices & Seasonings', 9,  1),
      ('Beverages',           10, 1),
      ('Cleaning & Supplies', 11, 0)
    ) AS vals(name, sort_order, show_as_ingredient)
    WHERE NOT EXISTS (
      SELECT 1 FROM categories cat
      WHERE cat.company_id = c.id AND cat.name = vals.name
    );

    INSERT INTO _migration_log (version, description)
      VALUES ('v004', 'Category soft-delete, orphan protection, default category seed');
  END IF;
END $$;

-- =============================================================================
-- v005 — Task #12: POS provider fields on companies
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v005') THEN

    -- POS provider selection (thrive, toast, hungerrush, clover, other, none)
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS pos_provider text;

    -- The Chef's Companion account ID (only used when pos_provider = 'thrive')
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS tcc_account_id text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v005', 'Task #12: pos_provider and tcc_account_id on companies');
  END IF;
END $$;

-- =============================================================================
-- v006 — Task #17: Container size hierarchy on inventory_items
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v006') THEN

    -- Size of each container in base units (e.g. 128 oz per can)
    ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS container_size real;

    -- Human-readable label for the container (e.g. "can", "bottle", "bag")
    ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS container_label text;

    -- Number of containers per case (e.g. 6 cans per case)
    ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS case_pkg_count real;

    INSERT INTO _migration_log (version, description)
      VALUES ('v006', 'Task #17: container_size, container_label, case_pkg_count on inventory_items');
  END IF;
END $$;

-- =============================================================================
-- v007 — Task #17: container_qty on inventory_count_lines
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v007') THEN

    -- Number of loose containers counted (for three-level Cases / Containers / Units counting)
    ALTER TABLE inventory_count_lines ADD COLUMN IF NOT EXISTS container_qty real;

    INSERT INTO _migration_log (version, description)
      VALUES ('v007', 'Task #17: container_qty on inventory_count_lines');
  END IF;
END $$;

-- =============================================================================
-- v008 — Task #19: AI CSV Inventory Import — no schema changes required
--
-- Implementation notes:
--   • Generic imports use vendorKey='generic' and vendorId=null on order_guides.
--   • CsvOrderGuide generates synthetic SKUs (GENERIC-1, GENERIC-2, …) for rows
--     without a real vendor SKU so that getVendorItems() lookups remain consistent.
--   • AI-normalized canonical names are computed in-memory during the preview step
--     and passed directly to ItemMatcher.findBestMatch(); they are not persisted.
--   • No new columns or constraints are needed for this feature.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v008') THEN
    INSERT INTO _migration_log (version, description)
      VALUES ('v008', 'Task #19: AI CSV import — documentation-only, no schema changes');
  END IF;
END $$;

-- =============================================================================
-- v009 — Task #25: AI Menu Image Scan — menu_import_sessions staging table
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v009') THEN

    CREATE TABLE IF NOT EXISTS menu_import_sessions (
      id              varchar       PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id      varchar       NOT NULL,
      store_id        varchar,
      status          text          NOT NULL DEFAULT 'pending',
      raw_image_path  text,
      extracted_items text,
      created_at      timestamptz   NOT NULL DEFAULT now(),
      updated_at      timestamptz   NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS menu_import_sessions_company_idx
      ON menu_import_sessions (company_id);

    INSERT INTO _migration_log (version, description)
      VALUES ('v009', 'Task #25: menu_import_sessions staging table for AI menu scan');
  END IF;
END $$;

-- =============================================================================
-- v010 — Task #25: Upgrade extracted_items column from text to jsonb
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v010') THEN

    -- Migrate text → jsonb. Table is new (created in v009) so all existing values
    -- are either NULL or valid JSON written by the application. The cast will fail
    -- if any row contains non-NULL non-empty invalid JSON, but that cannot occur here.
    ALTER TABLE menu_import_sessions
      ALTER COLUMN extracted_items TYPE jsonb
        USING CASE
          WHEN extracted_items IS NULL OR extracted_items = '' THEN NULL
          ELSE extracted_items::jsonb
        END;

    INSERT INTO _migration_log (version, description)
      VALUES ('v010', 'Task #25: upgrade menu_import_sessions.extracted_items from text to jsonb');
  END IF;
END $$;

-- =============================================================================
-- v011 — Task #30: Managed menu departments table + FK column on menu_items
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v011') THEN

    -- Create the managed menu departments table
    CREATE TABLE IF NOT EXISTS menu_departments (
      id          varchar     PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id  varchar     NOT NULL,
      name        text        NOT NULL,
      sort_order  integer     NOT NULL DEFAULT 0,
      UNIQUE (company_id, name)
    );

    CREATE INDEX IF NOT EXISTS menu_departments_company_idx
      ON menu_departments (company_id);

    -- Add the FK column on menu_items (nullable — items without a managed dept
    -- continue to work via the legacy free-text department column)
    ALTER TABLE menu_items
      ADD COLUMN IF NOT EXISTS menu_department_id varchar;

    -- Auto-link existing items: if menu_items.department matches a managed
    -- department name (case-insensitive) update menu_department_id accordingly.
    -- This runs AFTER departments are created, so it is a no-op on first deploy
    -- (no managed departments exist yet). It becomes useful on re-runs after
    -- departments have been set up by the company.
    UPDATE menu_items mi
    SET menu_department_id = md.id
    FROM menu_departments md
    WHERE md.company_id = mi.company_id
      AND lower(mi.department) = lower(md.name)
      AND mi.menu_department_id IS NULL;

    INSERT INTO _migration_log (version, description)
      VALUES ('v011', 'Task #30: menu_departments table + menu_department_id FK on menu_items');
  END IF;
END $$;

-- v012 — Task #30: Add FK constraint menu_items.menu_department_id -> menu_departments(id) ON DELETE SET NULL
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v012') THEN
    -- Add FK constraint if it doesn't already exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'menu_items_menu_department_id_fk'
        AND table_name = 'menu_items'
    ) THEN
      ALTER TABLE menu_items
        ADD CONSTRAINT menu_items_menu_department_id_fk
        FOREIGN KEY (menu_department_id) REFERENCES menu_departments(id) ON DELETE SET NULL;
    END IF;

    INSERT INTO _migration_log (version, description)
      VALUES ('v012', 'Task #30: FK constraint menu_items.menu_department_id -> menu_departments(id) SET NULL');
  END IF;
END $$;

-- v013 — Task #30: Auto-seed menu_departments from distinct legacy department text per company,
--          then link menu_items.menu_department_id via case-insensitive match.
--          Safe to run on existing tenants AND on first-time deploys.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v013') THEN

    -- Step 1: Create managed department records for every distinct non-empty legacy
    --         department text that doesn't already have a matching managed department.
    INSERT INTO menu_departments (id, company_id, name, sort_order)
    SELECT
      gen_random_uuid(),
      sub.company_id,
      sub.department,
      ROW_NUMBER() OVER (PARTITION BY sub.company_id ORDER BY sub.department)
    FROM (
      SELECT DISTINCT mi.company_id, mi.department
      FROM menu_items mi
      WHERE mi.department IS NOT NULL
        AND mi.department <> ''
        AND NOT EXISTS (
          SELECT 1 FROM menu_departments md
          WHERE md.company_id = mi.company_id
            AND lower(md.name) = lower(mi.department)
        )
    ) sub
    ON CONFLICT (company_id, name) DO NOTHING;

    -- Step 2: Link every existing unlinked menu item to its managed department.
    UPDATE menu_items mi
    SET menu_department_id = md.id
    FROM menu_departments md
    WHERE md.company_id = mi.company_id
      AND lower(mi.department) = lower(md.name)
      AND mi.menu_department_id IS NULL;

    INSERT INTO _migration_log (version, description)
      VALUES ('v013', 'Task #30: Auto-seed menu_departments from legacy department text + link menu_department_id');
  END IF;
END $$;

-- v014 — Task #30: Upgrade menu_departments name uniqueness to case-insensitive.
--          Drops the case-sensitive UNIQUE(company_id, name) constraint created in
--          v011 and replaces it with a partial unique index on lower(name) so that
--          "Entrees" and "entrees" are treated as duplicates. Application code
--          (POST/PATCH /api/menu-departments) also validates trimmed lower-case names.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v014') THEN

    -- Drop the old case-sensitive constraint (may have been created with a generated name)
    ALTER TABLE menu_departments
      DROP CONSTRAINT IF EXISTS menu_departments_company_id_name_key;

    -- Create a case-insensitive unique index
    CREATE UNIQUE INDEX IF NOT EXISTS menu_departments_company_lower_name_idx
      ON menu_departments (company_id, lower(name));

    INSERT INTO _migration_log (version, description)
      VALUES ('v014', 'Task #30: Case-insensitive unique index on menu_departments(company_id, lower(name))');
  END IF;
END $$;

-- =============================================================================
-- v015 — Task #33: recipe_import_sessions table for AI-powered recipe image scan wizard
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v015') THEN

    CREATE TABLE IF NOT EXISTS recipe_import_sessions (
      id          varchar     PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id  varchar     NOT NULL,
      status      text        NOT NULL DEFAULT 'pending',
      raw_image_path text,
      extracted_data jsonb,
      created_at  timestamp   NOT NULL DEFAULT now(),
      updated_at  timestamp   NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS recipe_import_sessions_company_idx
      ON recipe_import_sessions (company_id);

    INSERT INTO _migration_log (version, description)
      VALUES ('v015', 'Task #33: recipe_import_sessions table for AI recipe image scan wizard');
  END IF;
END $$;

-- =============================================================================
-- v016 — Task #33 fix: missing_item_name column on recipe_components
-- Allows recipe scan to save unmatched-but-included ingredients as placeholder
-- components that appear as "missing items" in the recipe builder/dashboard.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v016') THEN

    ALTER TABLE recipe_components
      ADD COLUMN IF NOT EXISTS missing_item_name text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v016', 'Task #33 fix: missing_item_name on recipe_components for unmatched scan ingredients');
  END IF;
END $$;

-- =============================================================================
-- v017 — Task #36: instructions and image_path columns on recipes
-- Stores step-by-step preparation instructions and a reference photo path
-- per recipe, enabling the recipe photo upload and AI instruction scan features.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v017') THEN

    ALTER TABLE recipes
      ADD COLUMN IF NOT EXISTS instructions text;

    ALTER TABLE recipes
      ADD COLUMN IF NOT EXISTS image_path text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v017', 'Task #36: instructions and image_path columns on recipes');
  END IF;
END $$;

-- =============================================================================
-- v018 — recipe_id column on recipe_import_sessions (idempotent approve)
-- Stores the created recipe ID on the session so that if the client loses the
-- response after a successful approve, a retry returns the same recipe info.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v018') THEN

    ALTER TABLE recipe_import_sessions
      ADD COLUMN IF NOT EXISTS recipe_id text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v018', 'recipe_id column on recipe_import_sessions for idempotent approve');
  END IF;
END $$;

-- =============================================================================
-- v019 — email_otps table for persistent OTP storage (Task #41)
-- Replaces the in-memory otpStore Map so OTPs survive server restarts/deploys.
-- One row per email address; upserted on every send, deleted on verify/expire.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v019') THEN

    CREATE TABLE IF NOT EXISTS email_otps (
      email       text        PRIMARY KEY,
      otp         text        NOT NULL,
      expires_at  timestamptz NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO _migration_log (version, description)
      VALUES ('v019', 'Task #41: email_otps table for DB-backed OTP persistence');
  END IF;
END $$;

-- =============================================================================
-- v020: Task #46 — AI chat_logs and chat_corrections tables
-- chat_logs: one row per Q&A exchange from the AI assistant
-- chat_corrections: admin-authored ideal answers injected as few-shot examples
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v020') THEN

    CREATE TABLE IF NOT EXISTS chat_logs (
      id              varchar     PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id      varchar     NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id         varchar,
      user_message    text        NOT NULL,
      assistant_response text     NOT NULL,
      tier            text        NOT NULL DEFAULT 'free',
      created_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS chat_logs_company_idx    ON chat_logs(company_id);
    CREATE INDEX IF NOT EXISTS chat_logs_created_at_idx ON chat_logs(created_at);

    CREATE TABLE IF NOT EXISTS chat_corrections (
      id                  varchar     PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_log_id         varchar     REFERENCES chat_logs(id) ON DELETE SET NULL,
      user_message        text        NOT NULL,
      corrected_response  text        NOT NULL,
      is_active           integer     NOT NULL DEFAULT 1,
      created_at          timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO _migration_log (version, description)
      VALUES ('v020', 'Task #46: chat_logs and chat_corrections tables for AI chat logging and admin corrections');
  END IF;
END $$;

-- =============================================================================
-- v021 — Task #51: container_unit_id column on inventory_items
-- Stores which unit the user chose when entering the container size, enabling
-- round-trip display (e.g. "6 oz" instead of "0.375 lb"). The containerSize
-- field continues to hold the value converted to the item's own unit.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v021') THEN

    ALTER TABLE inventory_items
      ADD COLUMN IF NOT EXISTS container_unit_id varchar;

    INSERT INTO _migration_log (version, description)
      VALUES ('v021', 'Task #51: container_unit_id on inventory_items for unit-aware container size entry');
  END IF;
END $$;

-- =============================================================================
-- v022 — Task #52: Collapse vendor_items inner_pack_size into case_size
-- Eliminates the separate Inner Pack Size field. The single case_size field
-- now represents total units per case (was case_size × inner_pack_size).
-- After this migration inner_pack_size is set to 1 everywhere (no-op).
-- Safe to run multiple times: the WHERE clause skips already-migrated rows.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v022') THEN

    UPDATE vendor_items
    SET case_size = case_size * COALESCE(inner_pack_size, 1),
        inner_pack_size = 1
    WHERE inner_pack_size IS NOT NULL AND inner_pack_size != 1;

    INSERT INTO _migration_log (version, description)
      VALUES ('v022', 'Task #52: Collapse inner_pack_size into case_size on vendor_items');
  END IF;
END $$;

-- =============================================================================
-- v023 — Task #64: detected_vendor_name column on order_guides
-- Stores the AI-extracted vendor name from image scans so the review page can
-- pre-fill the "Add New Vendor" dialog without client-side ephemeral state.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v023') THEN

    ALTER TABLE order_guides
      ADD COLUMN IF NOT EXISTS detected_vendor_name text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v023', 'Task #64: detected_vendor_name on order_guides for receipt scan vendor pre-fill');
  END IF;
END $$;

-- =============================================================================
-- v024 — Task #65: Prep Chart module (Pro tier)
-- Creates 8 new tables for the production planning / prep chart module:
-- stations, prep_items, prep_item_ingredients, menu_item_prep_usages,
-- prep_production_records, prep_on_hand, prep_chart_runs, prep_chart_lines.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v024') THEN

    CREATE TABLE IF NOT EXISTS stations (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id varchar NOT NULL,
      name text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      active integer NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS prep_items (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id varchar NOT NULL,
      name text NOT NULL,
      output_unit text NOT NULL DEFAULT 'each',
      output_qty_per_batch real NOT NULL DEFAULT 1,
      shelf_life_hours real NOT NULL DEFAULT 24,
      prep_lead_minutes integer NOT NULL DEFAULT 30,
      station_id varchar,
      yield_percent real NOT NULL DEFAULT 100,
      active integer NOT NULL DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS prep_items_company_idx ON prep_items(company_id);

    CREATE TABLE IF NOT EXISTS prep_item_ingredients (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id varchar NOT NULL,
      prep_item_id varchar NOT NULL,
      source_type text NOT NULL,
      source_id varchar NOT NULL,
      quantity real NOT NULL,
      unit_id varchar,
      sort_order integer NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS prep_item_ingredients_prep_item_idx ON prep_item_ingredients(prep_item_id);

    CREATE TABLE IF NOT EXISTS menu_item_prep_usages (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id varchar NOT NULL,
      menu_item_id varchar NOT NULL,
      prep_item_id varchar NOT NULL,
      quantity_per_sale real NOT NULL DEFAULT 1,
      unit_id varchar,
      UNIQUE(company_id, menu_item_id, prep_item_id)
    );
    CREATE INDEX IF NOT EXISTS menu_item_prep_usages_menu_item_idx ON menu_item_prep_usages(menu_item_id);
    CREATE INDEX IF NOT EXISTS menu_item_prep_usages_prep_item_idx ON menu_item_prep_usages(prep_item_id);

    CREATE TABLE IF NOT EXISTS prep_production_records (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id varchar NOT NULL,
      store_id varchar NOT NULL,
      prep_item_id varchar NOT NULL,
      quantity_produced real NOT NULL,
      batch_count real NOT NULL DEFAULT 1,
      produced_at timestamp NOT NULL DEFAULT NOW(),
      produced_by varchar,
      notes text
    );
    CREATE INDEX IF NOT EXISTS prep_production_company_store_idx ON prep_production_records(company_id, store_id);

    CREATE TABLE IF NOT EXISTS prep_on_hand (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id varchar NOT NULL,
      store_id varchar NOT NULL,
      prep_item_id varchar NOT NULL,
      quantity_on_hand real NOT NULL,
      prepared_at timestamp NOT NULL,
      expires_at timestamp NOT NULL,
      location_id varchar,
      created_at timestamp NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS prep_on_hand_company_store_idx ON prep_on_hand(company_id, store_id);
    CREATE INDEX IF NOT EXISTS prep_on_hand_expires_at_idx ON prep_on_hand(expires_at);

    CREATE TABLE IF NOT EXISTS prep_chart_runs (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id varchar NOT NULL,
      store_id varchar NOT NULL,
      business_date timestamp NOT NULL,
      daypart_id varchar,
      generated_at timestamp NOT NULL DEFAULT NOW(),
      based_on_mode text NOT NULL DEFAULT 'history',
      buffer_percent real NOT NULL DEFAULT 10,
      weeks_lookback integer NOT NULL DEFAULT 4
    );
    CREATE INDEX IF NOT EXISTS prep_chart_runs_company_store_date_idx ON prep_chart_runs(company_id, store_id, business_date);

    CREATE TABLE IF NOT EXISTS prep_chart_lines (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      prep_chart_run_id varchar NOT NULL,
      company_id varchar NOT NULL,
      prep_item_id varchar NOT NULL,
      station_id varchar,
      forecast_qty real NOT NULL DEFAULT 0,
      on_hand_qty real NOT NULL DEFAULT 0,
      recommended_qty real NOT NULL DEFAULT 0,
      recommended_batches integer NOT NULL DEFAULT 0,
      due_time timestamp,
      confidence_score real,
      reasoning_summary text
    );
    CREATE INDEX IF NOT EXISTS prep_chart_lines_run_idx ON prep_chart_lines(prep_chart_run_id);

    INSERT INTO _migration_log (version, description)
      VALUES ('v024', 'Task #65: Prep Chart module — 8 new tables for production planning (Pro tier)');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v025') THEN
    -- Task #66: Add recipe_id FK to prep_items for canBeIngredient recipe linkage
    ALTER TABLE prep_items ADD COLUMN IF NOT EXISTS recipe_id varchar;

    -- FK constraint: prep_items.recipe_id → recipes.id (ON DELETE SET NULL)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'prep_items_recipe_id_fk' AND table_name = 'prep_items'
    ) THEN
      ALTER TABLE prep_items
        ADD CONSTRAINT prep_items_recipe_id_fk
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL;
    END IF;

    INSERT INTO _migration_log (version, description)
      VALUES ('v025', 'Task #66: Add recipe_id FK to prep_items for recipe linkage & pull list');
  END IF;
END $$;

-- =============================================================================
-- v026 — Task #68: Shelf Scan Sessions table
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v026') THEN
    CREATE TABLE IF NOT EXISTS shelf_scan_sessions (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id varchar NOT NULL,
      store_id varchar,
      user_id varchar,
      created_at timestamp NOT NULL DEFAULT now(),
      frame_count integer NOT NULL DEFAULT 0,
      item_count integer NOT NULL DEFAULT 0,
      items jsonb NOT NULL DEFAULT '[]',
      notes jsonb NOT NULL DEFAULT '[]',
      status varchar NOT NULL DEFAULT 'completed'
    );
    CREATE INDEX IF NOT EXISTS shelf_scan_sessions_company_idx ON shelf_scan_sessions (company_id);
    CREATE INDEX IF NOT EXISTS shelf_scan_sessions_created_at_idx ON shelf_scan_sessions (created_at);

    INSERT INTO _migration_log (version, description)
      VALUES ('v026', 'Task #68: Shelf Scan Sessions table for mobile sweep-scan persistence');
  END IF;
END $$;

-- =============================================================================
-- v027 — Task #69: Add source column to auth_sessions for mobile tracking
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v027') THEN
    ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS source varchar DEFAULT 'web';

    INSERT INTO _migration_log (version, description)
      VALUES ('v027', 'Task #69: Add source column to auth_sessions to track mobile vs web logins');
  END IF;
END $$;

-- =============================================================================
-- v028 — Ensure shelf_scan_sessions exists + inventory_count_id column
--        (v026 CREATE TABLE may have silently failed on some VPS instances)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v028') THEN
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
    );
    CREATE INDEX IF NOT EXISTS shelf_scan_sessions_company_idx ON shelf_scan_sessions (company_id);
    CREATE INDEX IF NOT EXISTS shelf_scan_sessions_created_at_idx ON shelf_scan_sessions (created_at);
    ALTER TABLE shelf_scan_sessions ADD COLUMN IF NOT EXISTS inventory_count_id varchar;

    INSERT INTO _migration_log (version, description)
      VALUES ('v028', 'Ensure shelf_scan_sessions table + inventory_count_id column exist');
  END IF;
END $$;

-- v029 — Add is_tare_weight_category column to categories table
--        (renamed to is_catch_weight_category in v030)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v029') THEN
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_tare_weight_category integer NOT NULL DEFAULT 0;

    INSERT INTO _migration_log (version, description)
      VALUES ('v029', 'Add is_tare_weight_category column to categories (renamed to is_catch_weight_category in v030)');
  END IF;
END $$;

-- v030 — Rename is_tare_weight_category → is_catch_weight_category
--        Correct terminology: catch weight = per-package weight tracking for proteins/seafood/cheese
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v030') THEN
    -- Only rename if the old column still exists (safe to run even if v029 was never applied)
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'categories' AND column_name = 'is_tare_weight_category') THEN
      ALTER TABLE categories RENAME COLUMN is_tare_weight_category TO is_catch_weight_category;
    ELSE
      -- v029 was never applied, add the column with the correct name directly
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_catch_weight_category integer NOT NULL DEFAULT 0;
    END IF;

    INSERT INTO _migration_log (version, description)
      VALUES ('v030', 'Rename is_tare_weight_category → is_catch_weight_category (catch weight = per-package weight tracking)');
  END IF;
END $$;

-- =============================================================================
-- v031 — Task #78: inventory_count_entries — sub-entry history per count line
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v031') THEN

    CREATE TABLE IF NOT EXISTS inventory_count_entries (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      inventory_count_line_id varchar NOT NULL,
      qty real NOT NULL,
      user_id varchar,
      entered_at timestamp NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS inventory_count_entries_line_id_idx
      ON inventory_count_entries (inventory_count_line_id);

    INSERT INTO _migration_log (version, description)
      VALUES ('v031', 'Task #78: inventory_count_entries table for sub-entry history per count line');
  END IF;
END $$;

-- =============================================================================
-- v032 — Scope menu_items PLU/SKU uniqueness to company level
--        Old constraint was globally unique across all companies (wrong for SaaS).
--        New constraint: unique per company — same PLU can exist in different companies.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v032') THEN

    -- Drop old global unique constraint if it exists
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'menu_items'
        AND constraint_name = 'menu_items_plu_sku_unique'
        AND constraint_type = 'UNIQUE'
    ) THEN
      ALTER TABLE menu_items DROP CONSTRAINT menu_items_plu_sku_unique;
    END IF;

    -- Add per-company unique constraint if not already present
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'menu_items'
        AND constraint_name = 'menu_items_company_id_plu_sku_unique'
        AND constraint_type = 'UNIQUE'
    ) THEN
      ALTER TABLE menu_items
        ADD CONSTRAINT menu_items_company_id_plu_sku_unique
        UNIQUE (company_id, plu_sku);
    END IF;

    INSERT INTO _migration_log (version, description)
      VALUES ('v032', 'Scope menu_items PLU/SKU uniqueness to company level (company_id + plu_sku)');
  END IF;
END $$;

-- v033 — Task #106: Costing Method toggle (Last Cost vs Weighted Average Cost)
-- Adds companies.costing_method column. Defaults to 'last_cost' so existing
-- companies retain current behavior. UI exposes a toggle in Company Settings.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v033') THEN

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'companies' AND column_name = 'costing_method'
    ) THEN
      ALTER TABLE companies
        ADD COLUMN costing_method text NOT NULL DEFAULT 'last_cost';
    END IF;

    INSERT INTO _migration_log (version, description)
      VALUES ('v033', 'Task #106: Add companies.costing_method (last_cost | weighted_average)');
  END IF;
END $$;

-- v034 — Task #106 follow-up: rename costing_method value 'wac' to 'weighted_average'
-- An earlier build of v033 used the short value 'wac'. We standardize on the
-- spec value 'weighted_average' across schema, API, and migrations. This block
-- migrates any rows that picked up the short value before the rename.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v034') THEN

    UPDATE companies
       SET costing_method = 'weighted_average'
     WHERE costing_method = 'wac';

    INSERT INTO _migration_log (version, description)
      VALUES ('v034', 'Task #106: standardize companies.costing_method value wac -> weighted_average');
  END IF;
END $$;

-- =============================================================================
-- v035 — Task #109: inventory_item_units table for per-item Recipe Units
-- (custom unit conversions). One row per (item, unit, isIssueUnit) tuple. The
-- conversion factor is anchored to the item's inventory unit so that
-- qty_per_inventory_unit answers "how many of THIS unit are in 1 inventory unit
-- of this item?" Recipe lookups consult these rows first; same-kind units fall
-- through to the global units.to_base_ratio math.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v035') THEN

    CREATE TABLE IF NOT EXISTS inventory_item_units (
      id                       varchar     PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id               varchar     NOT NULL,
      inventory_item_id        varchar     NOT NULL,
      unit_id                  varchar     NOT NULL,
      qty_per_inventory_unit   real        NOT NULL,
      is_issue_unit            integer     NOT NULL DEFAULT 0,
      sort_order               integer     NOT NULL DEFAULT 0,
      created_at               timestamptz NOT NULL DEFAULT now()
    );

    -- One row per (item, unit, isIssueUnit) — recipe and issue rows can coexist
    -- for the same unit but only one of each.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'inventory_item_units_item_unit_kind_unique'
    ) THEN
      ALTER TABLE inventory_item_units
        ADD CONSTRAINT inventory_item_units_item_unit_kind_unique
        UNIQUE (inventory_item_id, unit_id, is_issue_unit);
    END IF;

    CREATE INDEX IF NOT EXISTS inventory_item_units_item_idx
      ON inventory_item_units (inventory_item_id);
    CREATE INDEX IF NOT EXISTS inventory_item_units_company_idx
      ON inventory_item_units (company_id);

    INSERT INTO _migration_log (version, description)
      VALUES ('v035', 'Task #109: inventory_item_units table for per-item Recipe Units');
  END IF;
END $$;

-- =============================================================================
-- v036 — Task #115: change inventory_items.yield_percent column default 95 -> 100
-- Affects only NEW inserts that omit yield_percent. Existing rows are not
-- modified.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v036') THEN

    ALTER TABLE inventory_items
      ALTER COLUMN yield_percent SET DEFAULT 100;

    INSERT INTO _migration_log (version, description)
      VALUES ('v036', 'Task #115: change inventory_items.yield_percent default 95 -> 100');
  END IF;
END $$;

-- =============================================================================
-- v037 — Task #201: has_bar column on companies
-- Stores whether the company operates a bar/beverage program (0=no, 1=yes,
-- null=not yet answered). Used during onboarding storage-location setup to
-- conditionally show bar-related storage location options.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v037') THEN

    ALTER TABLE companies ADD COLUMN IF NOT EXISTS has_bar integer;

    INSERT INTO _migration_log (version, description)
      VALUES ('v037', 'Task #201: add has_bar column to companies');
  END IF;
END $$;

-- =============================================================================
-- v038 — Task #204: price_source column on order_guide_lines
-- Tracks how the AI extracted a price from a vendor invoice scan:
--   'case'  = price is per case/pack (standard; used directly as lastCasePrice)
--   'unit'  = price is per individual unit (display only; do not use as case price)
--   null    = price source not determined (CSV imports always have case prices)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v038') THEN

    ALTER TABLE order_guide_lines ADD COLUMN IF NOT EXISTS price_source text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v038', 'Task #204: add price_source column to order_guide_lines');
  END IF;
END $$;

-- =============================================================================
-- v039 — Task #351: pack_uom column on vendor_items
-- Stores the pack dimension unit of measure (e.g. "oz", "lb", "cs") so that
-- the unit-aware case-price display can correctly reconstruct the case price
-- from the stored unit price when lastCasePrice is absent (legacy rows).
-- The column is nullable; NULL means unknown/not set (safe fallback: treat
-- innerSize as already in the inventory item's native unit).
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v039') THEN

    ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS pack_uom text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v039', 'Task #351: add pack_uom column to vendor_items for unit-aware case-price display');
  END IF;
END $$;

-- =============================================================================
-- v040 — Task #386: vendor_items.updated_at for correct recency selection
-- The batch case-price query uses DISTINCT ON ordered by updated_at DESC to
-- pick the most recently modified vendor item per inventory item.
-- DEFAULT now() back-fills existing rows at migration time; subsequent
-- updateVendorItem calls set this column explicitly on every price change.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v040') THEN

    ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();

    INSERT INTO _migration_log (version, description)
      VALUES ('v040', 'Task #386: add updated_at to vendor_items for recency-based case-price selection');
  END IF;
END $$;

-- =============================================================================
-- v041 — M1 Procurement Connector: po_export_logs table
-- Audit trail for every supplier-formatted order CSV generated from a PO.
-- Tracks connector used, user, timestamp, line count, warnings, and whether
-- the operator manually confirmed they uploaded the file to the supplier portal.
-- filePath is nullable — object storage integration added in a later milestone.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v041') THEN

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
    );

    CREATE INDEX IF NOT EXISTS po_export_logs_po_idx ON po_export_logs (purchase_order_id);
    CREATE INDEX IF NOT EXISTS po_export_logs_company_idx ON po_export_logs (company_id);

    INSERT INTO _migration_log (version, description)
      VALUES ('v041', 'M1 Procurement Connector: add po_export_logs table for supplier order export audit trail');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v042') THEN
    -- M2 Connector Registry: per-company connector + transport configuration
    CREATE TABLE IF NOT EXISTS customer_supplier_connections (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id varchar NOT NULL,
      vendor_id varchar NOT NULL,
      connector_id text NOT NULL,
      transport_overrides jsonb,
      is_active integer NOT NULL DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS csc_company_vendor_uniq ON customer_supplier_connections (company_id, vendor_id);
    CREATE INDEX IF NOT EXISTS csc_company_idx ON customer_supplier_connections (company_id);

    INSERT INTO _migration_log (version, description)
      VALUES ('v042', 'M2 Connector Registry: add customer_supplier_connections table for per-company connector and transport configuration');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v043') THEN
    -- categories: enforce unique category names per company (schema.ts unique constraint backfill)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'categories_company_id_name_unique'
    ) THEN
      ALTER TABLE categories ADD CONSTRAINT categories_company_id_name_unique UNIQUE (company_id, name);
    END IF;

    INSERT INTO _migration_log (version, description)
      VALUES ('v043', 'categories: add categories_company_id_name_unique constraint to match shared/schema.ts');
  END IF;
END $$;

-- =============================================================================
-- v044 — Task #396: Platform vendor registry
-- Global distributor name→connector lookup table with seed data for known
-- major distributors. User-submitted entries require global_admin review.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v044') THEN

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
    );

    CREATE UNIQUE INDEX IF NOT EXISTS pvr_normalized_connector_uniq
      ON platform_vendor_registry (normalized_name, connector_id);
    CREATE INDEX IF NOT EXISTS pvr_status_idx ON platform_vendor_registry (status);
    CREATE INDEX IF NOT EXISTS pvr_connector_idx ON platform_vendor_registry (connector_id);

    -- Seed known major distributors
    INSERT INTO platform_vendor_registry
      (normalized_name, aliases, website_domains, connector_id, status, source)
    VALUES
      ('sysco',
       ARRAY['sysco corporation','sysco foods','sysco foodservice','sysco food service'],
       ARRAY['sysco.com','shop.sysco.com'],
       'sysco', 'approved', 'seed'),
      ('gordon food service',
       ARRAY['gfs','gordon foodservice','gordon food svc'],
       ARRAY['gfs.com','gordonfoodservice.com'],
       'gfs', 'approved', 'seed'),
      ('us foods',
       ARRAY['usfoods','us foodservice','us food service','us foods inc'],
       ARRAY['usfoods.com','usfood.com'],
       'usfoods', 'approved', 'seed'),
      ('performance food service',
       ARRAY['pfs','performance foodservice','performance food group','pfg'],
       ARRAY['pfgc.com','performancefoodservice.com'],
       'pfs', 'approved', 'seed'),
      ('southern foods',
       ARRAY['sofo','sofo foods','southern food service'],
       ARRAY['sofofoods.com'],
       'sofo', 'approved', 'seed')
    ON CONFLICT (normalized_name, connector_id) DO NOTHING;

    INSERT INTO _migration_log (version, description)
      VALUES ('v044', 'Task #396: platform_vendor_registry table with seed data for known distributors');
  END IF;
END $$;

-- =============================================================================
-- v045 — Task #396: Expand platform_vendor_registry seed aliases and domains
-- Updates existing seed rows with comprehensive alias lists so partial-name
-- detection works for common real-world vendor name variations.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v045') THEN

    UPDATE platform_vendor_registry
      SET aliases = ARRAY['sysco','sysco corporation','sysco foods','sysco foodservice','sysco food service','sygma','sygma network','sysco guest supply'],
          website_domains = ARRAY['sysco.com','shop.sysco.com','syscofoodservice.com','sygmanetwork.com']
      WHERE normalized_name = 'sysco' AND connector_id = 'sysco';

    UPDATE platform_vendor_registry
      SET aliases = ARRAY['gfs','gordon food service','gordon''s food service','gordon foodservice','gordon food svc','gordon food'],
          website_domains = ARRAY['gfs.com','gordonfoodservice.com']
      WHERE normalized_name = 'gordon food service' AND connector_id = 'gfs';

    UPDATE platform_vendor_registry
      SET aliases = ARRAY['usfoods','us foods','us foodservice','us food service','us foods inc','u.s. foods','u.s. foodservice'],
          website_domains = ARRAY['usfoods.com','usfood.com','usfoodservice.com']
      WHERE normalized_name = 'us foods' AND connector_id = 'usfoods';

    UPDATE platform_vendor_registry
      SET aliases = ARRAY['pfs','performance food service','performance food','performance foodservice','performance food group','pfg','reinhart','reinhart foodservice','vistar'],
          website_domains = ARRAY['pfgc.com','pfg.com','performancefoodservice.com','reinhartfoodservice.com']
      WHERE normalized_name = 'performance food service' AND connector_id = 'pfs';

    UPDATE platform_vendor_registry
      SET aliases = ARRAY['sofo','sofo foods','southern foods','southern food','southern food service','southern food group'],
          website_domains = ARRAY['sofofoods.com','southernfoods.com']
      WHERE normalized_name = 'southern foods' AND connector_id = 'sofo';

    INSERT INTO _migration_log (version, description)
      VALUES ('v045', 'Task #396: Expand platform_vendor_registry seed aliases and domains');
  END IF;
END $$;

-- =============================================================================
-- v046 — Task #400: Add exact_aliases column to platform_vendor_registry
-- Separates abbreviations (exact match only) from descriptive aliases (contains
-- match). Prevents false positives like "ABC GFS Distribution" matching GFS.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v046') THEN

    ALTER TABLE platform_vendor_registry
      ADD COLUMN IF NOT EXISTS exact_aliases text[] NOT NULL DEFAULT '{}';

    -- Reassign abbreviations from aliases to exact_aliases for all seed entries
    UPDATE platform_vendor_registry
      SET exact_aliases = ARRAY['sygma'],
          aliases       = ARRAY['sysco corporation','sysco foods','sysco foodservice','sysco food service','sygma network','sysco guest supply']
      WHERE normalized_name = 'sysco' AND connector_id = 'sysco';

    UPDATE platform_vendor_registry
      SET exact_aliases = ARRAY['gfs'],
          aliases       = ARRAY['gordon food service','gordon''s food service','gordon foodservice','gordon food svc','gordon food']
      WHERE normalized_name = 'gordon food service' AND connector_id = 'gfs';

    UPDATE platform_vendor_registry
      SET exact_aliases = ARRAY['usfoods'],
          aliases       = ARRAY['us foods','us foodservice','us food service','us foods inc','u.s. foods','u.s. foodservice']
      WHERE normalized_name = 'us foods' AND connector_id = 'usfoods';

    UPDATE platform_vendor_registry
      SET exact_aliases = ARRAY['pfs','pfg','reinhart','vistar'],
          aliases       = ARRAY['performance food service','performance food','performance foodservice','performance food group','reinhart foodservice']
      WHERE normalized_name = 'performance food service' AND connector_id = 'pfs';

    UPDATE platform_vendor_registry
      SET exact_aliases = ARRAY['sofo'],
          aliases       = ARRAY['sofo foods','southern food','southern food service','southern food group']
      WHERE normalized_name = 'southern foods' AND connector_id = 'sofo';

    INSERT INTO _migration_log (version, description)
      VALUES ('v046', 'Task #400: Add exact_aliases column + redistribute abbreviations from aliases');
  END IF;
END $$;

-- =============================================================================
-- v047 — Task #400: Add detection_confidence and detection_reason columns
-- Stores the confidence tier and reason text from the original detect call on
-- user-submitted registry entries so admins can see them during review.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v047') THEN

    ALTER TABLE platform_vendor_registry
      ADD COLUMN IF NOT EXISTS detection_confidence text;

    ALTER TABLE platform_vendor_registry
      ADD COLUMN IF NOT EXISTS detection_reason text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v047', 'Task #400: detection_confidence and detection_reason on platform_vendor_registry');
  END IF;
END $$;

-- =============================================================================
-- v048 — Task #402: submission_count and submitted_by_company_ids on platform_vendor_registry
-- Tracks how many companies have submitted the same name→connector mapping so
-- admins can see rising interest in rejected entries and choose to reopen them.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v048') THEN

    ALTER TABLE platform_vendor_registry
      ADD COLUMN IF NOT EXISTS submission_count int NOT NULL DEFAULT 1;

    ALTER TABLE platform_vendor_registry
      ADD COLUMN IF NOT EXISTS submitted_by_company_ids text[] NOT NULL DEFAULT '{}';

    INSERT INTO _migration_log (version, description)
      VALUES ('v048', 'Task #402: submission_count and submitted_by_company_ids on platform_vendor_registry');
  END IF;
END $$;

-- =============================================================================
-- v049 — Task #407: Extend platform_vendor_registry + seed 141 vendors + PFG/BEK adapters
-- Makes connector_id nullable, adds display metadata columns (category, website,
-- ordering_url, portal_status), replaces unique index with COALESCE-based functional
-- index to handle NULL connector_id rows, and upserts all 141 U.S. food purveyors.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v049') THEN

    -- Make connector_id nullable (vendors without a CSV/EDI connector get NULL)
    ALTER TABLE platform_vendor_registry ALTER COLUMN connector_id DROP NOT NULL;

    -- Add display metadata columns
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS category text;
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS website text;
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS ordering_url text;
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS portal_status text;

    -- Replace simple unique index with COALESCE-based functional index so NULL
    -- connector_id rows don't conflict with each other (NULL != NULL in SQL).
    DROP INDEX IF EXISTS pvr_normalized_connector_uniq;
    CREATE UNIQUE INDEX IF NOT EXISTS pvr_normalized_connector_uniq
      ON platform_vendor_registry (normalized_name, COALESCE(connector_id, ''));

    -- Update/insert the 7 connected distributors with full metadata.
    -- FreshPoint is now an alias on the Sysco row (same CSV format, Sysco subsidiary).
    -- PFG (Performance Net portal format) and BEK (Ben E. Keith) added as new connectors.
    INSERT INTO platform_vendor_registry
      (normalized_name, exact_aliases, aliases, website_domains, connector_id,
       category, website, ordering_url, portal_status, status, source)
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
      SET exact_aliases   = EXCLUDED.exact_aliases,
          aliases         = EXCLUDED.aliases,
          website_domains = EXCLUDED.website_domains,
          category        = EXCLUDED.category,
          website         = EXCLUDED.website,
          ordering_url    = EXCLUDED.ordering_url,
          portal_status   = EXCLUDED.portal_status;

    -- Seed 134 additional U.S. food purveyors without a CSV/EDI connector (connector_id = NULL).
    -- ON CONFLICT uses the COALESCE index: COALESCE(NULL,'') = '' so conflicts match on normalized_name.
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
      ('kehe distributors',ARRAY['kehe','kehe foodservice'],ARRAY['kehe.com'],NULL,'Natural & Specialty','https://www.kehe.com',NULL,'Contact rep','approved','seed'),
      ('unfi foodservice',ARRAY['unfi','united natural foods'],ARRAY['unfi.com'],NULL,'Natural & Organic','https://www.unfi.com',NULL,'Contact rep','approved','seed'),
      ('tree top food service',ARRAY['tree top','treetop'],ARRAY['treetop.com'],NULL,'Fruit & Beverage','https://www.treetop.com',NULL,'Contact rep','approved','seed'),
      ('pacific foods',ARRAY['pacific foods of oregon'],ARRAY['pacificfoods.com'],NULL,'Soup & Broth','https://www.pacificfoods.com',NULL,'Contact rep','approved','seed'),
      ('kraft heinz foodservice',ARRAY['kraft heinz food service','kraft foodservice','heinz foodservice'],ARRAY['kraftheinzfoodservice.com'],NULL,'Manufactured Foods','https://www.kraftheinzfoodservice.com',NULL,'Contact rep','approved','seed'),
      ('campbell''s foodservice',ARRAY['campbells food service','campbell soup'],ARRAY['campbellsfoodservice.com'],NULL,'Soup & Manufactured Foods','https://www.campbellsfoodservice.com',NULL,'Contact rep','approved','seed'),
      ('mccormick foodservice',ARRAY['mccormick food service','mccormick & company'],ARRAY['mccormickfoodservice.com'],NULL,'Spices & Sauces','https://www.mccormickfoodservice.com',NULL,'Contact rep','approved','seed'),
      ('nestle professional',ARRAY['nestlé professional','nestle food service'],ARRAY['nestleprofessional.com'],NULL,'Manufactured Foods','https://www.nestleprofessional.com',NULL,'Contact rep','approved','seed'),
      ('unilever food solutions',ARRAY['unilever foodservice','ufs'],ARRAY['unileverfoodsolutions.us'],NULL,'Manufactured Foods','https://www.unileverfoodsolutions.us',NULL,'Contact rep','approved','seed'),
      ('del monte foodservice',ARRAY['del monte food service'],ARRAY['delmonte.com'],NULL,'Canned & Prepared','https://www.delmonte.com',NULL,'Contact rep','approved','seed'),
      ('bush''s best foodservice',ARRAY['bushs best food service','bush brothers'],ARRAY['bushbeans.com'],NULL,'Canned Goods','https://www.bushbeans.com',NULL,'Contact rep','approved','seed'),
      ('barilla america foodservice',ARRAY['barilla food service','barilla'],ARRAY['barilla.com'],NULL,'Pasta','https://www.barilla.com',NULL,'Contact rep','approved','seed'),
      -- Paper, Packaging & Non-food Supplies
      ('imperial dade',ARRAY['imperial bag','imperial paper'],ARRAY['imperialdade.com'],NULL,'Paper & Packaging','https://www.imperialdade.com',NULL,'Contact rep','approved','seed'),
      ('bunzl distribution',ARRAY['bunzl'],ARRAY['bunzldistribution.com'],NULL,'Paper & Packaging','https://www.bunzldistribution.com',NULL,'Contact rep','approved','seed'),
      ('waxie sanitary supply',ARRAY['waxie'],ARRAY['waxie.com'],NULL,'Sanitation & Supplies','https://www.waxie.com',NULL,'Contact rep','approved','seed'),
      ('american paper & twine',ARRAY['american paper twine','apt'],ARRAY['americanpaper.com'],NULL,'Paper & Packaging','https://www.americanpaper.com',NULL,'Contact rep','approved','seed'),
      -- National Brands & Specialty
      ('molson coors beverage',ARRAY['molson coors','coors','miller coors'],ARRAY['molsoncoors.com'],NULL,'Beverage','https://www.molsoncoors.com',NULL,'Contact rep','approved','seed'),
      ('boston beer company',ARRAY['boston beer','samuel adams','sam adams'],ARRAY['bostonbeer.com'],NULL,'Beverage','https://www.bostonbeer.com',NULL,'Contact rep','approved','seed'),
      ('diageo north america',ARRAY['diageo'],ARRAY['diageo.com'],NULL,'Spirits','https://www.diageo.com',NULL,'Contact rep','approved','seed'),
      ('brown-forman distributing',ARRAY['brown forman','jack daniels distillery'],ARRAY['brown-forman.com'],NULL,'Spirits','https://www.brown-forman.com',NULL,'Contact rep','approved','seed'),
      ('frito-lay foodservice',ARRAY['frito lay food service','frito lay'],ARRAY['fritolay.com'],NULL,'Snacks','https://www.fritolay.com',NULL,'Contact rep','approved','seed'),
      ('flowers foods foodservice',ARRAY['flowers foods food service','flowers bakeries'],ARRAY['flowersfoodservice.com'],NULL,'Bakery','https://www.flowersfoodservice.com',NULL,'Contact rep','approved','seed'),
      ('sara lee foodservice',ARRAY['sara lee food service'],ARRAY['saralee.com'],NULL,'Frozen Bakery','https://www.saralee.com',NULL,'Contact rep','approved','seed'),
      ('birds eye foodservice',ARRAY['birds eye food service','birds eye'],ARRAY['birdseye.com'],NULL,'Frozen Vegetables','https://www.birdseye.com',NULL,'Contact rep','approved','seed'),
      ('georgia-pacific professional',ARRAY['georgia pacific','gp professional'],ARRAY['gppro.com'],NULL,'Paper & Sanitation','https://www.gppro.com',NULL,'Contact rep','approved','seed'),
      ('uline',ARRAY[],ARRAY['uline.com'],NULL,'Packaging & Supplies','https://www.uline.com','https://www.uline.com','Self-serve portal','approved','seed'),
      -- Regional & Specialty
      ('shamrock farms',ARRAY['shamrock farm','shamrock dairy'],ARRAY['shamrockfarms.com'],NULL,'Dairy','https://www.shamrockfarms.com',NULL,'Contact rep','approved','seed'),
      ('oregon potato company',ARRAY['oregon potato'],ARRAY['oregonpotato.com'],NULL,'Produce','https://www.oregonpotato.com',NULL,'Contact rep','approved','seed'),
      ('draper valley farms',ARRAY['draper valley'],ARRAY['drapervalleyfarms.com'],NULL,'Protein','https://www.drapervalleyfarms.com',NULL,'Contact rep','approved','seed'),
      ('us foods chef''store',ARRAY['chef''store','chefstore'],ARRAY['chefstore.com'],NULL,'Cash & Carry','https://www.chefstore.com','https://www.chefstore.com','Self-serve portal','approved','seed'),
      ('pacific coast producers',ARRAY['pacific coast prod'],ARRAY['pacificcoastproducers.com'],NULL,'Canned Produce','https://www.pacificcoastproducers.com',NULL,'Contact rep','approved','seed'),
      ('fresh express',ARRAY['fresh express inc'],ARRAY['freshexpress.com'],NULL,'Produce','https://www.freshexpress.com',NULL,'Contact rep','approved','seed')
    ON CONFLICT (normalized_name, (COALESCE(connector_id, ''))) DO UPDATE
      SET category      = EXCLUDED.category,
          website       = EXCLUDED.website,
          ordering_url  = EXCLUDED.ordering_url,
          portal_status = EXCLUDED.portal_status,
          aliases       = EXCLUDED.aliases,
          website_domains = EXCLUDED.website_domains;

    INSERT INTO _migration_log (version, description)
      VALUES ('v049', 'Task #407: nullable connector_id, display metadata columns, COALESCE unique index, 141-vendor seed, PFG/BEK adapters, FreshPoint as Sysco alias');
  END IF;
END $$;


-- =============================================================================
-- v050 — T0: Permanently neutralize recurring vendor registry seed behavior
-- Records both seed block versions so server/index.ts skips them on every VPS deploy.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v050') THEN

    -- Mark both seed blocks as permanently complete (they ran via v049 on VPS).
    INSERT INTO _migration_log (version, description)
      VALUES ('pvr-seed-block1-v1', 'One-time seed: 7 connector-enabled distributor rows')
      ON CONFLICT DO NOTHING;
    INSERT INTO _migration_log (version, description)
      VALUES ('pvr-seed-block2-v1', 'One-time seed: 134 null-connector purveyor rows')
      ON CONFLICT DO NOTHING;

    INSERT INTO _migration_log (version, description)
      VALUES ('v050', 'T0: Permanently neutralize recurring vendor registry seed blocks');
  END IF;
END $$;

-- =============================================================================
-- v051 — T1: Add v2 classification, geography, and parent-relation columns
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v051') THEN

    -- Classification columns
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS canonical_name text;
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'verified';
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;
    -- parent_vendor_id: varchar to match id column type (semantically UUID values)
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS parent_vendor_id varchar
      REFERENCES platform_vendor_registry(id) ON DELETE SET NULL;

    -- Geography columns
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS service_country_codes text[] NOT NULL DEFAULT '{}';
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS service_region_codes text[] NOT NULL DEFAULT '{}';
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS service_scope text NOT NULL DEFAULT 'unknown';

    -- Role and ordering columns
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS vendor_role text;
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS ordering_mode text NOT NULL DEFAULT 'contact_vendor';

    -- CHECK constraints (idempotent via pg_constraint guard)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pvr_visibility_check') THEN
      ALTER TABLE platform_vendor_registry ADD CONSTRAINT pvr_visibility_check
        CHECK (visibility IN ('public','reference_only','hidden'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pvr_verification_status_check') THEN
      ALTER TABLE platform_vendor_registry ADD CONSTRAINT pvr_verification_status_check
        CHECK (verification_status IN ('verified','needs_review','stale'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pvr_service_scope_check') THEN
      ALTER TABLE platform_vendor_registry ADD CONSTRAINT pvr_service_scope_check
        CHECK (service_scope IN ('national','online_nationwide','multi_region','regional','local','unknown'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pvr_ordering_mode_check') THEN
      ALTER TABLE platform_vendor_registry ADD CONSTRAINT pvr_ordering_mode_check
        CHECK (ordering_mode IN ('integrated','file_export','portal_link','public_ecommerce','contact_vendor'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pvr_vendor_role_check') THEN
      ALTER TABLE platform_vendor_registry ADD CONSTRAINT pvr_vendor_role_check
        CHECK (vendor_role IS NULL OR vendor_role IN (
          'broadline_distributor','specialty_distributor','produce_distributor',
          'protein_distributor','manufacturer_direct','redistributor','buying_group',
          'closed_supply_system','contract_distributor','online_retailer',
          'beverage_distributor','paper_and_packaging'
        ));
    END IF;

    -- Index on service_scope for geography-ranked search
    CREATE INDEX IF NOT EXISTS pvr_service_scope_idx ON platform_vendor_registry (service_scope);
    CREATE INDEX IF NOT EXISTS pvr_visibility_idx ON platform_vendor_registry (visibility);

    INSERT INTO _migration_log (version, description)
      VALUES ('v051', 'T1: Add canonical_name, visibility, verification_status, parent_vendor_id, service_*, vendor_role, ordering_mode');
  END IF;
END $$;

-- =============================================================================
-- v052 — T3: Resolve FreshPoint / Vistar / Reinhart alias conflicts
-- FreshPoint gets its own row in T6. PFG subsid aliases are split there too.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v052') THEN

    -- Sysco: remove FreshPoint aliases (it ships its own approved row in T6)
    UPDATE platform_vendor_registry
    SET
      aliases         = ARRAY(
        SELECT a FROM unnest(aliases) AS a
        WHERE a NOT IN ('freshpoint','fresh point','freshpoint.com')
      ),
      exact_aliases   = ARRAY(
        SELECT a FROM unnest(exact_aliases) AS a
        WHERE a NOT IN ('freshpoint','fresh point')
      ),
      website_domains = ARRAY(
        SELECT d FROM unnest(website_domains) AS d
        WHERE d <> 'freshpoint.com'
      )
    WHERE connector_id = 'sysco';

    -- PFS row (connector_id='pfs'): remove Reinhart and Vistar aliases/domains
    -- Both get standalone rows (reinhart in existing DB-only set, vistar from v2).
    UPDATE platform_vendor_registry
    SET
      exact_aliases   = ARRAY(
        SELECT a FROM unnest(exact_aliases) AS a
        WHERE a NOT IN ('reinhart','vistar')
      ),
      aliases         = ARRAY(
        SELECT a FROM unnest(aliases) AS a
        WHERE a NOT IN ('reinhart foodservice','vistar corporation','vistar','reinhart')
      ),
      website_domains = ARRAY(
        SELECT d FROM unnest(website_domains) AS d
        WHERE d NOT IN ('reinhartfoodservice.com','vistar.com')
      )
    WHERE connector_id = 'pfs';

    INSERT INTO _migration_log (version, description)
      VALUES ('v052', 'T3: Remove freshpoint aliases from sysco; remove reinhart/vistar aliases from pfs');
  END IF;
END $$;

-- =============================================================================
-- v053 — T5: Classify and augment 23 matched records from v2 workbook
-- Sets canonical_name, ordering_mode, service_scope, service_country_codes,
-- service_region_codes, vendor_role, verification_status, last_verified_at.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v053') THEN

    -- Sysco
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Sysco Corporation',
      ordering_mode         = 'integrated',
      ordering_url          = 'https://shop.sysco.com/auth/login',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE connector_id = 'sysco';

    -- Gordon Food Service
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Gordon Food Service',
      ordering_mode         = 'integrated',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-AL','US-FL','US-GA','US-IL','US-IN','US-KY','US-MD','US-MI','US-MO','US-NC','US-NY','US-OH','US-PA','US-SC','US-TN','US-TX','US-WI'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE connector_id = 'gfs';

    -- US Foods
    UPDATE platform_vendor_registry SET
      canonical_name        = 'US Foods',
      ordering_mode         = 'integrated',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE connector_id = 'usfoods';

    -- Performance Food Group (parent entity)
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Performance Food Group',
      ordering_mode         = 'portal_link',
      ordering_url          = 'https://www.performancefoodservice.com/Your-Operation/CustomerFirst',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE connector_id = 'pfg';

    -- Performance Food Service / PFS (operating brand)
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Performance Foodservice',
      ordering_mode         = 'portal_link',
      ordering_url          = 'https://www.performancefoodservice.com/Your-Operation/CustomerFirst',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE connector_id = 'pfs';

    -- Ben E. Keith
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Ben E. Keith Foods',
      ordering_mode         = 'portal_link',
      ordering_url          = 'https://www.bekentree.com/',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-AL','US-AR','US-AZ','US-FL','US-GA','US-KS','US-LA','US-MO','US-MS','US-NM','US-OK','US-SC','US-TN','US-TX'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE connector_id = 'bek';

    -- Sofo Foods (formerly Southern Foods)
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Sofo Foods',
      ordering_mode         = 'portal_link',
      ordering_url          = 'https://order.sofofoods.com/pnet/eOrder',
      service_scope         = 'multi_region',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-OH','US-GA','US-TX'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE connector_id = 'sofo';

    -- Cheney Brothers (null-connector, matched by normalized_name)
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Cheney Brothers, Inc.',
      ordering_mode         = 'portal_link',
      ordering_url          = 'https://www.cheneycentral.com/',
      service_scope         = 'multi_region',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-FL','US-GA','US-NC','US-SC'],
      vendor_role           = 'broadline_distributor',
      parent_vendor_id      = (SELECT id FROM platform_vendor_registry WHERE connector_id = 'pfg' LIMIT 1),
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name = 'cheney brothers' AND connector_id IS NULL;

    -- Nicholas & Company
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Nicholas and Company, Inc.',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'multi_region',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-UT','US-NV','US-ID','US-WY','US-MT','US-AZ'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%nicholas%' AND normalized_name LIKE '%company%' AND connector_id IS NULL;

    -- Shamrock Foods
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Shamrock Foods Company',
      ordering_mode         = 'portal_link',
      ordering_url          = 'https://m.myshamrock.com/',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-AZ','US-CA','US-CO','US-ID','US-KS','US-MT','US-NE','US-NV','US-NM','US-OR','US-SD','US-TX','US-UT','US-WY'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%shamrock%' AND connector_id IS NULL;

    -- Ace Endico
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Ace Endico Corp.',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'multi_region',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-ME','US-NH','US-VT','US-MA','US-RI','US-CT','US-NY','US-NJ','US-PA'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%ace endico%' AND connector_id IS NULL;

    -- Restaurant Depot / Jetro
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Restaurant Depot / Jetro',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%restaurant depot%' AND connector_id IS NULL;

    -- C&S Wholesale Grocers
    UPDATE platform_vendor_registry SET
      canonical_name        = 'C&S Wholesale Grocers',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'redistributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%c&s wholesale%' AND connector_id IS NULL;

    -- WebstaurantStore
    UPDATE platform_vendor_registry SET
      canonical_name        = 'WebstaurantStore',
      ordering_mode         = 'public_ecommerce',
      service_scope         = 'online_nationwide',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'online_retailer',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%webstaurant%' AND connector_id IS NULL;

    -- Baldor Specialty Foods
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Baldor Specialty Foods',
      ordering_mode         = 'portal_link',
      ordering_url          = 'https://www.baldorfood.com/sign-in',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-NY','US-NJ','US-CT','US-MA','US-RI','US-PA','US-DE','US-MD','US-DC','US-VA'],
      vendor_role           = 'specialty_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%baldor%' AND connector_id IS NULL;

    -- KeHE Distributors
    UPDATE platform_vendor_registry SET
      canonical_name        = 'KeHE Distributors',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'specialty_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%kehe%' AND connector_id IS NULL;

    -- UNFI
    UPDATE platform_vendor_registry SET
      canonical_name        = 'UNFI',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'specialty_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%unfi%' AND connector_id IS NULL;

    -- The Chefs' Warehouse
    UPDATE platform_vendor_registry SET
      canonical_name        = 'The Chefs'' Warehouse',
      ordering_mode         = 'portal_link',
      ordering_url          = 'https://www.chefswarehouse.com/login/',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-CA','US-FL','US-GA','US-IL','US-MA','US-MD','US-NV','US-NJ','US-NY','US-OH','US-PA','US-TX','US-WA','US-DC'],
      vendor_role           = 'specialty_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%chefs%warehouse%' AND connector_id IS NULL;

    -- Gourmet Foods International
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Gourmet Foods International',
      ordering_mode         = 'portal_link',
      ordering_url          = 'https://www.gfifoods.com/customer/account/',
      service_scope         = 'multi_region',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-GA','US-CA','US-FL','US-TX','US-NJ','US-MA','US-IL','US-WA','US-CO'],
      vendor_role           = 'specialty_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%gourmet foods international%' AND connector_id IS NULL;

    -- Vistar (PFG subsidiary)
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Vistar',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'specialty_distributor',
      parent_vendor_id      = (SELECT id FROM platform_vendor_registry WHERE connector_id = 'pfg' LIMIT 1),
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%vistar%' AND connector_id IS NULL;

    -- Martin Bros. Distributing
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Martin Bros. Distributing Co., Inc.',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'multi_region',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-IA','US-IL','US-WI','US-NE','US-MO','US-MN'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'verified',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%martin%bros%' AND connector_id IS NULL;

    -- Dot Foods (flagged: redistribution model unclear)
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Dot Foods',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'national',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'redistributor',
      verification_status   = 'needs_review',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%dot foods%' AND connector_id IS NULL;

    -- Honor Foods (flagged)
    UPDATE platform_vendor_registry SET
      canonical_name        = 'Honor Foods',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'regional',
      service_country_codes = ARRAY['US'],
      service_region_codes  = ARRAY['US-PA'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'needs_review',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%honor foods%' AND connector_id IS NULL;

    -- AMCON Distributing (flagged)
    UPDATE platform_vendor_registry SET
      canonical_name        = 'AMCON Distributing',
      ordering_mode         = 'contact_vendor',
      service_scope         = 'multi_region',
      service_country_codes = ARRAY['US'],
      vendor_role           = 'broadline_distributor',
      verification_status   = 'needs_review',
      last_verified_at      = '2026-07-14'::timestamptz
    WHERE normalized_name LIKE '%amcon%' AND connector_id IS NULL;

    INSERT INTO _migration_log (version, description)
      VALUES ('v053', 'T5: Classify and augment 23 matched v2 records with ordering_mode, service_scope, vendor_role');
  END IF;
END $$;

-- =============================================================================
-- v054 — T6: Import 82 v2-only Approved seed records
-- Columns: normalized_name, aliases, website_domains, connector_id, category,
--   website, ordering_url, portal_status, status, source,
--   canonical_name, visibility, verification_status, service_country_codes,
--   service_region_codes, service_scope, ordering_mode, vendor_role
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v054') THEN

    INSERT INTO platform_vendor_registry
      (normalized_name, aliases, website_domains, connector_id, category,
       website, ordering_url, portal_status, status, source,
       canonical_name, visibility, verification_status,
       service_country_codes, service_region_codes, service_scope, ordering_mode, vendor_role)
    VALUES
  ('butterfield & vallis', ARRAY[]::text[], ARRAY['bv.bm'], NULL, 'Broadline / grocery wholesale', 'https://www.bv.bm', NULL, 'Contact rep', 'approved', 'seed', 'Butterfield & Vallis', 'public', 'verified', ARRAY['BM'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'redistributor'),
  ('fortali dist de alim ltda', ARRAY[]::text[], ARRAY['fortali.com.br'], NULL, 'Broadline', 'https://www.fortali.com.br', NULL, 'Contact rep', 'approved', 'seed', 'Fortali Dist De Alim LTDA', 'public', 'verified', ARRAY['BR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('amalgamated dairies limited (adl)', ARRAY[]::text[], ARRAY['adlfoods.ca'], NULL, 'Dairy / broadline', 'https://www.adlfoods.ca', NULL, 'Contact rep', 'approved', 'seed', 'Amalgamated Dairies Limited (ADL)', 'public', 'verified', ARRAY['CA'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'specialty_distributor'),
  ('aof food service', ARRAY[]::text[], ARRAY['aof.ca'], NULL, 'Broadline', 'https://www.aof.ca', NULL, 'Contact rep', 'approved', 'seed', 'AOF Food Service Inc.', 'public', 'verified', ARRAY['CA'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('capital foodservice', ARRAY[]::text[], ARRAY['capitalfoodservice.ca'], NULL, 'Broadline', 'https://www.capitalfoodservice.ca', NULL, 'Contact rep', 'approved', 'seed', 'Capital Foodservice', 'public', 'verified', ARRAY['CA'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('centennial foodservice', ARRAY[]::text[], ARRAY['centennialfood.com'], NULL, 'Center-of-plate / broadline', 'https://www.centennialfood.com', NULL, 'Contact rep', 'approved', 'seed', 'Centennial Foodservice', 'public', 'verified', ARRAY['CA'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('flanagan foodservice', ARRAY[]::text[], ARRAY['flanagan.ca'], NULL, 'Broadline', 'https://www.flanagan.ca', NULL, 'Contact rep', 'approved', 'seed', 'Flanagan Foodservice Inc.', 'public', 'verified', ARRAY['CA'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('natures cargo', ARRAY[]::text[], ARRAY['naturescargo.ca'], NULL, 'Natural / specialty distribution', 'https://www.naturescargo.ca', NULL, 'Contact rep', 'approved', 'seed', 'Natures Cargo', 'public', 'verified', ARRAY['CA'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'specialty_distributor'),
  ('mendez & co.', ARRAY[]::text[], ARRAY['mendezcopr.com'], NULL, 'Broadline / Puerto Rico', 'https://www.mendezcopr.com', NULL, 'Contact rep', 'approved', 'seed', 'Mendez & Co., Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-PR'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('amoje industry', ARRAY[]::text[], ARRAY['amojeind.com'], NULL, 'Foodservice / hospitality supply', 'https://www.amojeind.com', NULL, 'Contact rep', 'approved', 'seed', 'Amoje Industry', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('cj freshway', ARRAY[]::text[], ARRAY['cjfreshway.com'], NULL, 'Food material distribution / contract foodservice', 'https://www.cjfreshway.com', NULL, 'Contact rep', 'approved', 'seed', 'CJ Freshway', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('daesang bestco', ARRAY[]::text[], ARRAY['edaesang.com'], NULL, 'Foodservice distribution', 'https://www.edaesang.com', NULL, 'Contact rep', 'approved', 'seed', 'Daesang BestCo', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('foodmerce co.', ARRAY[]::text[], ARRAY['foodmerce.com'], NULL, 'Foodservice distribution', 'https://www.foodmerce.com', NULL, 'Contact rep', 'approved', 'seed', 'FOODMERCE Co., LTD', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('gourmet f&b korea', ARRAY[]::text[], ARRAY['gourmet.co.kr'], NULL, 'Specialty food distribution', 'https://www.gourmet.co.kr', NULL, 'Contact rep', 'approved', 'seed', 'Gourmet F&B Korea', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'specialty_distributor'),
  ('m''s food system', ARRAY[]::text[], ARRAY['maeil.com'], NULL, 'Foodservice distribution', 'https://www.maeil.com', NULL, 'Contact rep', 'approved', 'seed', 'M''s Food System', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('pulmuone foodmerce', ARRAY[]::text[], ARRAY['pulstory.pulmuone.com'], NULL, 'Foodservice distribution', 'https://www.pulstory.pulmuone.com', NULL, 'Contact rep', 'approved', 'seed', 'Pulmuone Foodmerce', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('samsung welstory', ARRAY[]::text[], ARRAY['samsungwelstory.com'], NULL, 'Food distribution / contract foodservice', 'https://www.samsungwelstory.com', NULL, 'Contact rep', 'approved', 'seed', 'Samsung Welstory', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'broadline_distributor'),
  ('samyang corp.', ARRAY[]::text[], ARRAY['samyangcorp.com'], NULL, 'Food ingredients / foodservice', 'https://www.samyangcorp.com', NULL, 'Contact rep', 'approved', 'seed', 'Samyang Corp.', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'specialty_distributor'),
  ('taekyung nongsan', ARRAY[]::text[], ARRAY['itaekyung.com'], NULL, 'Food ingredients / distribution', 'https://www.itaekyung.com', NULL, 'Contact rep', 'approved', 'seed', 'Taekyung Nongsan', 'public', 'verified', ARRAY['KR'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'specialty_distributor'),
  ('a.f. wendling''s food service', ARRAY[]::text[], ARRAY['afwendling.com'], NULL, 'Broadline', 'https://www.afwendling.com', NULL, 'Contact rep', 'approved', 'seed', 'A.F. Wendling''s Food Service', 'public', 'verified', ARRAY['US'], ARRAY['US-WV', 'US-VA', 'US-PA'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('avalon foodservice', ARRAY[]::text[], ARRAY['avalonfoods.com'], NULL, 'Broadline', 'https://www.avalonfoods.com', NULL, 'Contact rep', 'approved', 'seed', 'Avalon Foodservice, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-OH', 'US-PA', 'US-WV'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('baker''s authority', ARRAY[]::text[], ARRAY['bakersauthority.com'], NULL, 'Bakery ingredients / online', 'https://www.bakersauthority.com', NULL, 'Contact rep', 'approved', 'seed', 'Baker''s Authority', 'public', 'verified', ARRAY['US'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'online_retailer'),
  ('birite foodservice distributors', ARRAY[]::text[], ARRAY['birite.com'], NULL, 'Broadline', 'https://www.birite.com', NULL, 'Contact rep', 'approved', 'seed', 'BiRite Foodservice Distributors', 'public', 'verified', ARRAY['US'], ARRAY['US-CA'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('carolina food service of loris', ARRAY[]::text[], ARRAY['carolinafoodservice.com'], NULL, 'Broadline', 'https://www.carolinafoodservice.com', NULL, 'Contact rep', 'approved', 'seed', 'Carolina Food Service of Loris', 'public', 'verified', ARRAY['US'], ARRAY['US-NC', 'US-SC'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('cash-wa distributing', ARRAY[]::text[], ARRAY['web.cashwa.com'], NULL, 'Broadline', 'https://www.web.cashwa.com', 'https://portal2.ftnirdc.com/en/cswa', 'Self-serve portal', 'approved', 'seed', 'Cash-Wa Distributing', 'public', 'verified', ARRAY['US'], ARRAY['US-NE', 'US-CO', 'US-WY', 'US-KS', 'US-OK', 'US-MO', 'US-IA', 'US-MN', 'US-SD', 'US-ND'], 'national', 'portal_link', 'broadline_distributor'),
  ('core-mark', ARRAY[]::text[], ARRAY['core-mark.com'], NULL, 'Convenience distribution / PFG', 'https://www.core-mark.com', NULL, 'Contact rep', 'approved', 'seed', 'Core-Mark', 'public', 'verified', ARRAY['US'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'specialty_distributor'),
  ('cotati food service', ARRAY[]::text[], ARRAY['cotatifoodservice.com'], NULL, 'Broadline', 'https://www.cotatifoodservice.com', NULL, 'Contact rep', 'approved', 'seed', 'Cotati Food Service', 'public', 'verified', ARRAY['US'], ARRAY['US-CA'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('curtze food service', ARRAY[]::text[], ARRAY['curtze.com'], NULL, 'Broadline', 'https://www.curtze.com', NULL, 'Contact rep', 'approved', 'seed', 'Curtze Food Service', 'public', 'verified', ARRAY['US'], ARRAY['US-PA', 'US-NY', 'US-VA', 'US-WV', 'US-OH', 'US-MI', 'US-IN', 'US-KY', 'US-MD'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('d''artagnan', ARRAY[]::text[], ARRAY['dartagnan.com'], NULL, 'Meat / specialty', 'https://www.dartagnan.com', NULL, 'Contact rep', 'approved', 'seed', 'D''Artagnan', 'public', 'verified', ARRAY['US'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'protein_distributor'),
  ('dawn food products', ARRAY[]::text[], ARRAY['dawnfoods.com'], NULL, 'Bakery ingredients', 'https://www.dawnfoods.com', NULL, 'Contact rep', 'approved', 'seed', 'Dawn Food Products', 'public', 'verified', ARRAY['US'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'specialty_distributor'),
  ('dennis food service', ARRAY[]::text[], ARRAY['dennisfoodservice.com'], NULL, 'Broadline', 'https://www.dennisfoodservice.com', NULL, 'Contact rep', 'approved', 'seed', 'Dennis Food Service', 'public', 'verified', ARRAY['US'], ARRAY['US-ME', 'US-NH'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('diaz wholesale & manufacturing', ARRAY[]::text[], ARRAY['diazfoods.com'], NULL, 'Hispanic / specialty broadline', 'https://www.diazfoods.com', NULL, 'Contact rep', 'approved', 'seed', 'Diaz Wholesale & Manufacturing', 'public', 'verified', ARRAY['US'], ARRAY['US-GA', 'US-VA', 'US-NJ'], 'multi_region', 'contact_vendor', 'specialty_distributor'),
  ('dicarlo distributors', ARRAY[]::text[], ARRAY['dicarlofood.com'], NULL, 'Italian / broadline', 'https://www.dicarlofood.com', NULL, 'Contact rep', 'approved', 'seed', 'DiCarlo Distributors, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-MA', 'US-CT', 'US-NY', 'US-NJ', 'US-PA', 'US-DE', 'US-MD', 'US-DC'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('divine specialties', ARRAY[]::text[], ARRAY['divinespecialties.com'], NULL, 'Bakery, chocolate and specialty ingredients', 'https://www.divinespecialties.com', 'https://www.divinespecialties.com/product-category/shop-online/', 'Public e-commerce', 'approved', 'seed', 'Divine Specialties', 'public', 'verified', ARRAY['US'], ARRAY['US-CA'], 'online_nationwide', 'public_ecommerce', 'specialty_distributor'),
  ('driscoll foods', ARRAY[]::text[], ARRAY['driscollfoods.com'], NULL, 'Broadline', 'https://www.driscollfoods.com', NULL, 'Contact rep', 'approved', 'seed', 'Driscoll Foods', 'public', 'verified', ARRAY['US'], ARRAY['US-NJ', 'US-NY', 'US-PA', 'US-CT'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('emaco food services', ARRAY[]::text[], ARRAY['emacofs.com'], NULL, 'Broadline land and marine food distribution', 'https://www.emacofs.com', NULL, 'Contact rep', 'approved', 'seed', 'Emaco Food Services', 'public', 'verified', ARRAY['US'], ARRAY['US-LA'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('feeser''s', ARRAY[]::text[], ARRAY['feesers.com'], NULL, 'Broadline', 'https://www.feesers.com', NULL, 'Contact rep', 'approved', 'seed', 'Feeser''s, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-PA', 'US-NJ', 'US-DE', 'US-MD', 'US-NY', 'US-VA', 'US-WV', 'US-DC'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('foodist', ARRAY[]::text[], ARRAY['efoodist.com'], NULL, 'Online / specialty', 'https://www.efoodist.com', NULL, 'Contact rep', 'approved', 'seed', 'Foodist', 'public', 'verified', ARRAY['US'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'online_retailer'),
  ('foodservicedirect', ARRAY[]::text[], ARRAY['foodservicedirect.com'], NULL, 'Online foodservice retailer', 'https://www.foodservicedirect.com', 'https://www.foodservicedirect.com/', 'Public e-commerce', 'approved', 'seed', 'FoodServiceDirect', 'public', 'verified', ARRAY['US'], ARRAY[]::text[], 'online_nationwide', 'public_ecommerce', 'online_retailer'),
  ('freshpoint', ARRAY[]::text[], ARRAY['freshpoint.com'], NULL, 'Produce / Sysco subsidiary', 'https://www.freshpoint.com', 'https://myfreshpoint.com/', 'Self-serve portal', 'approved', 'seed', 'FreshPoint', 'public', 'verified', ARRAY['US'], ARRAY['US-AZ', 'US-CA', 'US-CO', 'US-FL', 'US-GA', 'US-NC', 'US-SC', 'US-TN', 'US-TX', 'US-WA'], 'national', 'portal_link', 'produce_distributor'),
  ('ginsberg''s foods', ARRAY[]::text[], ARRAY['ginsbergs.com'], 'food_order_entry', 'Broadline', 'https://www.ginsbergs.com', 'https://ginsbergsorder.com/', 'Self-serve portal', 'approved', 'seed', 'Ginsberg''s Foods', 'public', 'verified', ARRAY['US'], ARRAY['US-NY', 'US-VT', 'US-MA', 'US-CT', 'US-PA'], 'multi_region', 'portal_link', 'broadline_distributor'),
  ('global market foods', ARRAY['GMF'], ARRAY['globalmarketfoods.com'], NULL, 'International and specialty food distribution', 'https://www.globalmarketfoods.com', 'https://www.globalmarketfoods.com/retailers', 'Self-serve portal', 'approved', 'seed', 'Global Market Foods', 'public', 'needs_review', ARRAY['US'], ARRAY['US-IL', 'US-CA', 'US-NJ', 'US-TX'], 'multi_region', 'portal_link', 'specialty_distributor'),
  ('gnb wholesale', ARRAY['G&B Wholesale Foods', 'GNB Wholesale Foods'], ARRAY['gnbwholesale.com'], NULL, 'Meat and broadline foodservice', 'https://www.gnbwholesale.com', NULL, 'Contact rep', 'approved', 'seed', 'GnB Wholesale', 'public', 'verified', ARRAY['US'], ARRAY['US-CA'], 'regional', 'contact_vendor', 'protein_distributor'),
  ('golden egg company', ARRAY[]::text[], ARRAY['goldeneggcompany.com'], NULL, 'Egg, dairy and foodservice distribution', 'https://www.goldeneggcompany.com', 'https://www.goldeneggcompany.com/', 'Public e-commerce', 'approved', 'seed', 'Golden Egg Company', 'public', 'verified', ARRAY['US'], ARRAY['US-CA'], 'online_nationwide', 'public_ecommerce', 'specialty_distributor'),
  ('harbor foods group', ARRAY[]::text[], ARRAY['harborwholesale.com'], NULL, 'Broadline / convenience', 'https://www.harborwholesale.com', NULL, 'Contact rep', 'approved', 'seed', 'Harbor Foods Group', 'public', 'verified', ARRAY['US'], ARRAY['US-AK', 'US-WA', 'US-ID', 'US-OR', 'US-CA'], 'multi_region', 'contact_vendor', 'specialty_distributor'),
  ('henry''s foods', ARRAY[]::text[], ARRAY['henrysfoods.com'], NULL, 'Broadline', 'https://www.henrysfoods.com', NULL, 'Contact rep', 'approved', 'seed', 'Henry''s Foods, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-MN', 'US-ND', 'US-SD', 'US-WI', 'US-IA'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('incollingo food service', ARRAY[]::text[], ARRAY['incollingofoods.com'], NULL, 'Italian / pizza / broadline foodservice', 'https://www.incollingofoods.com', 'https://www.incollingofoods.com/new-products-page', 'Self-serve portal', 'approved', 'seed', 'Incollingo Food Service', 'public', 'needs_review', ARRAY['US'], ARRAY['US-NJ', 'US-PA', 'US-DE', 'US-MD'], 'multi_region', 'portal_link', 'broadline_distributor'),
  ('international gourmet foods', ARRAY[]::text[], ARRAY['igf-inc.com'], NULL, 'Specialty foods', 'https://www.igf-inc.com', NULL, 'Contact rep', 'approved', 'seed', 'International Gourmet Foods', 'public', 'verified', ARRAY['US'], ARRAY['US-VA', 'US-MD', 'US-DC', 'US-NC', 'US-TN', 'US-SC', 'US-GA'], 'multi_region', 'contact_vendor', 'specialty_distributor'),
  ('jake''s finer foods', ARRAY[]::text[], ARRAY['jakesfinerfoods.com'], NULL, 'Broadline / specialty', 'https://www.jakesfinerfoods.com', NULL, 'Contact rep', 'approved', 'seed', 'Jake''s Finer Foods', 'public', 'verified', ARRAY['US'], ARRAY['US-TX', 'US-LA'], 'multi_region', 'contact_vendor', 'specialty_distributor'),
  ('jordano''s foodservice', ARRAY[]::text[], ARRAY['jordanos.com'], NULL, 'Broadline', 'https://www.jordanos.com', NULL, 'Contact rep', 'approved', 'seed', 'Jordano''s Foodservice, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-CA'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('kansas marine', ARRAY[]::text[], ARRAY['kansasmarine.com'], NULL, 'Cruise-line food and hospitality supply', 'https://www.kansasmarine.com', NULL, 'Contact rep', 'approved', 'seed', 'Kansas Marine, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-CA', 'US-WA'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('king kold', ARRAY['King Kold Quality Meats', 'King Kold Meats'], ARRAY['kingkoldinc.com'], NULL, 'Meat and center-of-plate distribution', 'https://www.kingkoldinc.com', 'https://kingkoldinc.com/shop-meat-sides/', 'Public e-commerce', 'approved', 'seed', 'King Kold', 'public', 'verified', ARRAY['US'], ARRAY['US-OH'], 'online_nationwide', 'public_ecommerce', 'protein_distributor'),
  ('kohl wholesale', ARRAY[]::text[], ARRAY['kohlwholesale.com'], NULL, 'Broadline', 'https://www.kohlwholesale.com', NULL, 'Contact rep', 'approved', 'seed', 'Kohl Wholesale', 'public', 'verified', ARRAY['US'], ARRAY['US-IL', 'US-IA', 'US-MO'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('kos distribution', ARRAY[]::text[], ARRAY['kosdistribution.com'], NULL, 'Hispanic / Latin American grocery and foodservice distribution', 'https://www.kosdistribution.com', NULL, 'Contact rep', 'approved', 'seed', 'KOS Distribution', 'public', 'verified', ARRAY['US'], ARRAY['US-TN'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('kuna foodservice', ARRAY[]::text[], ARRAY['kunafoodservice.com'], NULL, 'Broadline', 'https://www.kunafoodservice.com', NULL, 'Contact rep', 'approved', 'seed', 'Kuna Foodservice', 'public', 'verified', ARRAY['US'], ARRAY['US-MO', 'US-IL', 'US-IA', 'US-WI', 'US-IN', 'US-MI', 'US-KY', 'US-OH', 'US-AR', 'US-MS', 'US-AL'], 'national', 'contact_vendor', 'broadline_distributor'),
  ('loffredo fresh foods', ARRAY[]::text[], ARRAY['loffredo.com'], NULL, 'Produce / broadline', 'https://www.loffredo.com', NULL, 'Contact rep', 'approved', 'seed', 'Loffredo Fresh Foods', 'public', 'verified', ARRAY['US'], ARRAY['US-IA', 'US-NE', 'US-IL', 'US-MO', 'US-WI'], 'multi_region', 'contact_vendor', 'produce_distributor'),
  ('maplevale farms', ARRAY[]::text[], ARRAY['maplevalefarms.com'], NULL, 'Broadline', 'https://www.maplevalefarms.com', NULL, 'Contact rep', 'approved', 'seed', 'Maplevale Farms, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-NY', 'US-PA', 'US-OH'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('mclane foodservice', ARRAY[]::text[], ARRAY['mclaneco.com'], NULL, 'National chain / convenience', 'https://www.mclaneco.com', NULL, 'Contact rep', 'approved', 'seed', 'McLane Foodservice, Inc.', 'public', 'verified', ARRAY['US'], ARRAY[]::text[], 'unknown', 'contact_vendor', 'specialty_distributor'),
  ('miller distributing', ARRAY[]::text[], ARRAY[]::text[], NULL, 'Convenience, grocery and foodservice wholesale', NULL, NULL, 'Contact rep', 'approved', 'seed', 'Miller Distributing', 'public', 'verified', ARRAY['US'], ARRAY['US-PA'], 'regional', 'contact_vendor', 'specialty_distributor'),
  ('north bay wholesale', ARRAY['North Bay Wholefoods'], ARRAY['northbaywholesale.com'], NULL, 'Broadline / pizza and Mexican restaurant supply', 'https://www.northbaywholesale.com', 'https://www.northbaywholesale.com/shop', 'Public e-commerce', 'approved', 'seed', 'North Bay Wholesale', 'public', 'verified', ARRAY['US'], ARRAY['US-CA'], 'online_nationwide', 'public_ecommerce', 'broadline_distributor'),
  ('northern haserot food service', ARRAY[]::text[], ARRAY['northernhaserot.com'], NULL, 'Broadline', 'https://www.northernhaserot.com', NULL, 'Contact rep', 'approved', 'seed', 'Northern Haserot Food Service', 'public', 'verified', ARRAY['US'], ARRAY['US-OH', 'US-MI'], 'multi_region', 'contact_vendor', 'broadline_distributor'),
  ('pacific provisions hawaii', ARRAY[]::text[], ARRAY['pacificprovisionshawaii.com'], NULL, 'Broadline / Hawaii', 'https://www.pacificprovisionshawaii.com', NULL, 'Contact rep', 'approved', 'seed', 'Pacific Provisions Hawaii', 'public', 'verified', ARRAY['US'], ARRAY['US-HI'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('palmer food services', ARRAY[]::text[], ARRAY['palmerfoods.com'], NULL, 'Broadline / center-of-plate', 'https://www.palmerfoods.com', 'https://palmerfoods.com/order-online/', 'Self-serve portal', 'approved', 'seed', 'Palmer Food Services', 'public', 'verified', ARRAY['US'], ARRAY['US-NY'], 'regional', 'portal_link', 'broadline_distributor'),
  ('prime source foods', ARRAY[]::text[], ARRAY['primesourcefoods.biz'], NULL, 'Center-of-plate / specialty', 'https://www.primesourcefoods.biz', NULL, 'Contact rep', 'approved', 'seed', 'Prime Source Foods', 'public', 'verified', ARRAY['US'], ARRAY['US-NH', 'US-ME', 'US-MA', 'US-VT', 'US-CT', 'US-RI'], 'multi_region', 'contact_vendor', 'specialty_distributor'),
  ('quaker valley foods', ARRAY[]::text[], ARRAY['quakervalleyfoods.com'], NULL, 'Meat / specialty broadline', 'https://www.quakervalleyfoods.com', NULL, 'Contact rep', 'approved', 'seed', 'Quaker Valley Foods, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-PA', 'US-NJ', 'US-NY', 'US-DE', 'US-MD', 'US-DC', 'US-VA'], 'multi_region', 'contact_vendor', 'protein_distributor'),
  ('ray''s produce', ARRAY[]::text[], ARRAY[]::text[], NULL, 'Produce distribution', NULL, NULL, 'Contact rep', 'approved', 'seed', 'Ray''s Produce, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-OR', 'US-WA'], 'multi_region', 'contact_vendor', 'produce_distributor'),
  ('s. abraham & sons', ARRAY[]::text[], ARRAY['sasinc.com'], NULL, 'Convenience / foodservice', 'https://www.sasinc.com', NULL, 'Contact rep', 'approved', 'seed', 'S. Abraham & Sons, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-MI', 'US-IN', 'US-OH', 'US-IL', 'US-WI', 'US-KY'], 'multi_region', 'contact_vendor', 'specialty_distributor'),
  ('sanwa food group', ARRAY[]::text[], ARRAY['sanwagrowers.com'], NULL, 'Produce / broadline', 'https://www.sanwagrowers.com', NULL, 'Contact rep', 'approved', 'seed', 'Sanwa Food Group', 'public', 'verified', ARRAY['US'], ARRAY['US-FL'], 'regional', 'contact_vendor', 'produce_distributor'),
  ('saval foodservice', ARRAY[]::text[], ARRAY['savalfoods.com'], 'cut_and_dry', 'Broadline', 'https://www.savalfoods.com', 'https://savalfoodservice.cutanddry.com/', 'Self-serve portal', 'approved', 'seed', 'Saval Foodservice', 'public', 'verified', ARRAY['US'], ARRAY['US-MD', 'US-VA', 'US-DC', 'US-DE', 'US-PA'], 'multi_region', 'portal_link', 'broadline_distributor'),
  ('scarmardo foodservice', ARRAY[]::text[], ARRAY['scarmardofoods.com'], NULL, 'Broadline', 'https://www.scarmardofoods.com', NULL, 'Contact rep', 'approved', 'seed', 'Scarmardo Foodservice Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-TX'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('sgc foodservice', ARRAY[]::text[], ARRAY['sgcfoodservice.com'], 'powernet_pnet', 'Broadline', 'https://www.sgcfoodservice.com', 'https://pnet.sgcfoodservice.com/', 'Self-serve portal', 'approved', 'seed', 'SGC Foodservice', 'public', 'verified', ARRAY['US'], ARRAY['US-IL', 'US-MO', 'US-KS', 'US-OK', 'US-AR', 'US-TN'], 'multi_region', 'portal_link', 'broadline_distributor'),
  ('shore foods', ARRAY[]::text[], ARRAY['shorefoodsnj.com'], NULL, 'Broadline foodservice', 'https://www.shorefoodsnj.com', 'https://shorefoodsnj.com/shop/', 'Public e-commerce', 'approved', 'seed', 'Shore Foods', 'public', 'verified', ARRAY['US'], ARRAY['US-NJ'], 'online_nationwide', 'public_ecommerce', 'broadline_distributor'),
  ('snack attack', ARRAY['Snack Attack Distributing'], ARRAY['snackattackdistributors.com'], NULL, 'Institutional shelf-stable food and commissary supplies', 'https://www.snackattackdistributors.com', NULL, 'Contact rep', 'approved', 'seed', 'Snack Attack, Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-OH'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('suisan company', ARRAY[]::text[], ARRAY['suisan.com'], NULL, 'Broadline / Hawaii', 'https://www.suisan.com', NULL, 'Contact rep', 'approved', 'seed', 'Suisan Company, Limited', 'public', 'verified', ARRAY['US'], ARRAY['US-HI'], 'regional', 'contact_vendor', 'broadline_distributor'),
  ('upper lakes foods', ARRAY[]::text[], ARRAY['upperlakesfoods.com'], NULL, 'Broadline', 'https://www.upperlakesfoods.com', 'https://ulfweb.com/', 'Self-serve portal', 'approved', 'seed', 'Upper Lakes Foods Inc.', 'public', 'verified', ARRAY['US'], ARRAY['US-MN', 'US-WI', 'US-ND', 'US-SD', 'US-IA', 'US-IL', 'US-MI'], 'multi_region', 'portal_link', 'broadline_distributor'),
  ('van eerden foodservice', ARRAY[]::text[], ARRAY['vaneerden.com'], NULL, 'Broadline', 'https://www.vaneerden.com', 'https://customer.vaneerden.com/', 'Self-serve portal', 'approved', 'seed', 'Van Eerden Foodservice', 'public', 'verified', ARRAY['US'], ARRAY['US-MI', 'US-IN'], 'multi_region', 'portal_link', 'broadline_distributor'),
  ('warwick poultry', ARRAY[]::text[], ARRAY[]::text[], NULL, 'Poultry / center-of-plate', NULL, NULL, 'Contact rep', 'approved', 'seed', 'Warwick Poultry', 'public', 'verified', ARRAY['US'], ARRAY['US-ME', 'US-NH', 'US-VT', 'US-MA', 'US-RI', 'US-CT'], 'multi_region', 'contact_vendor', 'protein_distributor'),
  ('web food store', ARRAY['WebFoodStore.com', 'WFS'], ARRAY['webfoodstore.com'], NULL, 'Online foodservice distributor', 'https://www.webfoodstore.com', 'https://webfoodstore.com/', 'Public e-commerce', 'approved', 'seed', 'Web Food Store', 'public', 'verified', ARRAY['US'], ARRAY[]::text[], 'online_nationwide', 'public_ecommerce', 'online_retailer'),
  ('what chefs want', ARRAY['WCW'], ARRAY['whatchefswant.com'], 'cut_and_dry', 'Produce / specialty broadline', 'https://www.whatchefswant.com', 'https://whatchefswant.cutanddry.com/', 'Self-serve portal', 'approved', 'seed', 'What Chefs Want', 'public', 'verified', ARRAY['US'], ARRAY['US-AL', 'US-CO', 'US-FL', 'US-GA', 'US-IL', 'US-IN', 'US-KY', 'US-MO', 'US-NC', 'US-SC', 'US-OH', 'US-TN'], 'national', 'portal_link', 'produce_distributor'),
  ('wood fruitticher food service', ARRAY[]::text[], ARRAY['woodfruitticher.com'], 'food_order_entry', 'Broadline', 'https://www.woodfruitticher.com', 'https://woodfruitticher.foodorderentry.com/?FromMobile=1', 'Self-serve portal', 'approved', 'seed', 'Wood Fruitticher Food Service', 'public', 'verified', ARRAY['US'], ARRAY['US-AL', 'US-GA', 'US-FL', 'US-MS', 'US-TN'], 'multi_region', 'portal_link', 'broadline_distributor'),
  ('y. hata & co.', ARRAY[]::text[], ARRAY['yhata.com'], NULL, 'Broadline / Hawaii', 'https://www.yhata.com', NULL, 'Contact rep', 'approved', 'seed', 'Y. Hata & Co., Ltd.', 'public', 'verified', ARRAY['US'], ARRAY['US-HI'], 'regional', 'contact_vendor', 'broadline_distributor')
  ('yen bros. food service', ARRAY[]::text[], ARRAY['yenbros.com'], NULL, 'Asian / broadline', 'https://www.yenbros.com', NULL, 'Contact rep', 'approved', 'seed', 'Yen Bros. Food Service', 'public', 'verified', ARRAY['US'], ARRAY['US-WA', 'US-OR'], 'multi_region', 'contact_vendor', 'broadline_distributor')
    ON CONFLICT (normalized_name, (COALESCE(connector_id, ''))) DO NOTHING;

    -- Set parent_vendor_id for FreshPoint (Sysco subsidiary) and Core-Mark (PFG subsidiary)
    UPDATE platform_vendor_registry
    SET parent_vendor_id = (SELECT id FROM platform_vendor_registry WHERE connector_id = 'sysco' LIMIT 1)
    WHERE normalized_name = 'freshpoint' AND connector_id IS NULL;

    UPDATE platform_vendor_registry
    SET parent_vendor_id = (SELECT id FROM platform_vendor_registry WHERE connector_id = 'pfg' LIMIT 1)
    WHERE normalized_name IN ('core-mark','core mark') AND connector_id IS NULL;

    INSERT INTO _migration_log (version, description)
      VALUES ('v054', 'T6: Import 82 v2-only Approved seed records into platform_vendor_registry');
  END IF;
END $$;

-- =============================================================================
-- v055 — T8: Classify existing DB-only records by vendor_role and ordering_mode
-- Applies to rows that have vendor_role IS NULL (seeded before T6 classification).
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v055') THEN

    -- Set vendor_role based on category for all unclassified seed rows
    UPDATE platform_vendor_registry
    SET vendor_role = CASE
      WHEN category ILIKE '%produce%' OR category ILIKE '%fruit%' OR category ILIKE '%vegetab%'
        THEN 'produce_distributor'
      WHEN category ILIKE '%protein%' OR category ILIKE '%meat%' OR category ILIKE '%poultry%'
        OR category ILIKE '%seafood%' OR category ILIKE '%beef%' OR category ILIKE '%pork%'
        THEN 'protein_distributor'
      WHEN category ILIKE '%beverage%' OR category ILIKE '%wine%' OR category ILIKE '%spirit%'
        OR category ILIKE '%beer%' OR category ILIKE '%liquor%'
        THEN 'beverage_distributor'
      WHEN category ILIKE '%paper%' OR category ILIKE '%packaging%' OR category ILIKE '%sanit%'
        OR category ILIKE '%janitorial%' OR category ILIKE '%disposable%'
        THEN 'paper_and_packaging'
      WHEN category ILIKE '%online%' OR category ILIKE '%e-commerce%' OR category ILIKE '%ecommerce%'
        THEN 'online_retailer'
      WHEN category ILIKE '%specialty%' OR category ILIKE '%gourmet%' OR category ILIKE '%natural%'
        OR category ILIKE '%organic%' OR category ILIKE '%ethnic%' OR category ILIKE '%asian%'
        OR category ILIKE '%bakery%' OR category ILIKE '%dairy%' OR category ILIKE '%ingredient%'
        OR category ILIKE '%frozen%' OR category ILIKE '%snack%' OR category ILIKE '%convenience%'
        THEN 'specialty_distributor'
      WHEN category ILIKE '%redistrib%' OR category ILIKE '%wholesale%'
        THEN 'redistributor'
      ELSE 'broadline_distributor'
    END
    WHERE vendor_role IS NULL AND source = 'seed';

    -- Set service_country_codes = ARRAY['US'] for all US seed records missing it
    UPDATE platform_vendor_registry
    SET service_country_codes = ARRAY['US']
    WHERE service_country_codes = '{}'::text[]
      AND source = 'seed'
      -- exclude the international rows inserted in T6 (they already have correct country codes)
      AND id NOT IN (
        SELECT id FROM platform_vendor_registry
        WHERE service_country_codes && ARRAY['BM','BR','CA','KR']
      );

    -- Set ordering_mode for rows that have an ordering_url but still show contact_vendor
    UPDATE platform_vendor_registry
    SET ordering_mode = 'portal_link'
    WHERE ordering_mode = 'contact_vendor'
      AND ordering_url IS NOT NULL
      AND ordering_url <> ''
      AND source = 'seed';

    -- Known public-ecommerce rows (US Foods Chef''Store, WebstaurantStore variants)
    UPDATE platform_vendor_registry
    SET ordering_mode = 'public_ecommerce', service_scope = 'online_nationwide'
    WHERE normalized_name IN ('us foods chefstore','chef store')
      AND connector_id IS NULL;

    INSERT INTO _migration_log (version, description)
      VALUES ('v055', 'T8: Classify DB-only records by vendor_role and set ordering_mode, service_country_codes defaults');
  END IF;
END $$;

-- v056 — MVP Reset: drop v2 research columns, add country_code, re-seed with focused direct-order vendors
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v056') THEN

    -- Drop v2 over-engineering columns (IF EXISTS — safe if already clean)
    ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS visibility;
    ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS verification_status;
    ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS last_verified_at;
    ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS parent_vendor_id;
    ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS service_country_codes;
    ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS service_scope;
    ALTER TABLE platform_vendor_registry DROP COLUMN IF EXISTS vendor_role;

    -- Add MVP schema columns (IF NOT EXISTS)
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS canonical_name text;
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS ordering_mode text NOT NULL DEFAULT 'contact_vendor';
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS service_region_codes text[] NOT NULL DEFAULT '{}';
    ALTER TABLE platform_vendor_registry ADD COLUMN IF NOT EXISTS country_code text;

    -- Replace over-engineered CHECK constraints with MVP values
    ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_visibility_check;
    ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_verification_status_check;
    ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_service_scope_check;
    ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_vendor_role_check;
    ALTER TABLE platform_vendor_registry DROP CONSTRAINT IF EXISTS pvr_ordering_mode_check;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pvr_ordering_mode_mvp_check') THEN
      ALTER TABLE platform_vendor_registry ADD CONSTRAINT pvr_ordering_mode_mvp_check
        CHECK (ordering_mode IN ('connector','portal_link','public_ecommerce','contact_vendor'));
    END IF;

    -- Remove old seed data (manufacturers, brands, buying groups, redistributors)
    DELETE FROM platform_vendor_registry WHERE source = 'seed';

    -- Insert MVP seed: 47 verified direct-order foodservice distributors
    INSERT INTO platform_vendor_registry
      (normalized_name, exact_aliases, aliases, website_domains, connector_id, category,
       website, ordering_url, ordering_mode, country_code, service_region_codes,
       status, source, canonical_name)
    VALUES
      ('sysco',ARRAY['sygma'],ARRAY['sysco corporation','sysco foods','sysco foodservice','sysco food service','sygma network','sysco guest supply'],ARRAY['sysco.com','shop.sysco.com','syscofoodservice.com','sygmanetwork.com'],'sysco','Broadline','https://www.sysco.com','https://shop.sysco.com','connector','US','{}','approved','seed','Sysco'),
      ('us foods',ARRAY['usfoods'],ARRAY['us foods','us foodservice','us food service','us foods inc','u.s. foods','u.s. foodservice'],ARRAY['usfoods.com','usfood.com','usfoodservice.com'],'usfoods','Broadline','https://www.usfoods.com','https://www.usfoods.com/our-services/online-ordering.html','connector','US','{}','approved','seed','US Foods'),
      ('gordon food service',ARRAY['gfs'],ARRAY['gordon food service','gordon''s food service','gordon foodservice','gordon food svc','gordon food'],ARRAY['gfs.com','gordonfoodservice.com'],'gfs','Broadline','https://www.gfs.com','https://www.gfs.com/store','connector','US','{}','approved','seed','Gordon Food Service'),
      ('performance foodservice',ARRAY['pfg'],ARRAY['performance food group','performance net','performance foodservice','pfg foodservice'],ARRAY['pfgc.com','performancenet.com'],'pfg','Broadline','https://www.pfgc.com','https://www.performancenet.com','connector','US','{}','approved','seed','Performance Foodservice'),
      ('performance food service',ARRAY['pfs'],ARRAY['performance food service','performance food'],ARRAY['performancefoodservice.com'],'pfs','Broadline','https://www.pfgc.com',NULL,'connector','US','{}','approved','seed','Performance Food Service'),
      ('ben e. keith foods',ARRAY['bek'],ARRAY['ben e keith','ben e. keith','ben e. keith foods','ben e. keith beverages','bek foods'],ARRAY['bek.com','benekeith.com'],'bek','Broadline','https://www.bek.com','https://www.bek.com','connector','US',ARRAY['US-TX','US-OK','US-AR','US-LA','US-NM','US-CO'],'approved','seed','Ben E. Keith Foods'),
      ('sofo foods',ARRAY['sofo'],ARRAY['sofo foods','southern food service','sofo food service'],ARRAY['sofofoods.com'],'sofo','Broadline','https://www.sofofoods.com',NULL,'connector','US',ARRAY['US-OH','US-MI','US-IN','US-PA','US-WV'],'approved','seed','Sofo Foods'),
      ('mclane foodservice','{}',ARRAY['mclane food service','mclane company','mclane'],ARRAY['mclane.com'],NULL,'Broadline','https://www.mclane.com',NULL,'portal_link','US','{}','approved','seed','McLane Foodservice'),
      ('shamrock foods','{}',ARRAY['shamrock food','shamrock foodservice','shamrock food service'],ARRAY['shamrockfoods.com'],NULL,'Broadline','https://www.shamrockfoods.com',NULL,'contact_vendor','US',ARRAY['US-AZ','US-CA','US-CO','US-NM','US-NV','US-UT'],'approved','seed','Shamrock Foods'),
      ('cheney brothers','{}',ARRAY['cheney brothers inc','cheney bro','cheney'],ARRAY['cheneybrothers.com'],NULL,'Broadline','https://www.cheneybrothers.com',NULL,'contact_vendor','US',ARRAY['US-FL','US-GA','US-SC','US-NC','US-AL'],'approved','seed','Cheney Brothers'),
      ('the chefs'' warehouse','{}',ARRAY['chefs warehouse','chefs'' warehouse','chefs warehouse inc'],ARRAY['chefswarehouse.com'],NULL,'Specialty & Gourmet','https://www.chefswarehouse.com','https://www.chefswarehouse.com','portal_link','US','{}','approved','seed','The Chefs'' Warehouse'),
      ('freshpoint','{}',ARRAY['fresh point','freshpoint inc','freshpoint fresh cut'],ARRAY['freshpoint.com'],NULL,'Produce','https://www.freshpoint.com',NULL,'contact_vendor','US','{}','approved','seed','FreshPoint'),
      ('baldor specialty foods','{}',ARRAY['baldor foods','baldor'],ARRAY['baldorfood.com'],NULL,'Specialty & Gourmet','https://www.baldorfood.com',NULL,'contact_vendor','US',ARRAY['US-NY','US-NJ','US-CT','US-MA','US-PA','US-DC'],'approved','seed','Baldor Specialty Foods'),
      ('what chefs want','{}',ARRAY['what chefs want inc'],ARRAY['whatchefswant.com'],'cut_and_dry','Specialty & Gourmet','https://www.whatchefswant.com',NULL,'connector','US',ARRAY['US-KY','US-TN','US-IN','US-OH'],'approved','seed','What Chefs Want'),
      ('saval foodservice','{}',ARRAY['saval food service','saval'],ARRAY['saval.com'],'powernet_pnet','Broadline','https://www.saval.com',NULL,'connector','US',ARRAY['US-MD','US-VA','US-DC','US-PA','US-DE','US-NC'],'approved','seed','Saval Foodservice'),
      ('sgc foodservice','{}',ARRAY['sgc food service','sgc'],ARRAY['sgcfoodservice.com'],'powernet_pnet','Broadline','https://www.sgcfoodservice.com',NULL,'connector','US',ARRAY['US-VA','US-NC','US-SC','US-GA','US-TN'],'approved','seed','SGC Foodservice'),
      ('wood fruitticher food service','{}',ARRAY['wood fruitticher','wood fruitticher grocery','wood and fruitticher'],ARRAY['woodfruitticher.com'],'food_order_entry','Broadline','https://www.woodfruitticher.com',NULL,'connector','US',ARRAY['US-TX','US-OK','US-AR','US-LA','US-MS','US-AL'],'approved','seed','Wood Fruitticher Food Service'),
      ('cash-wa distributing','{}',ARRAY['cashwa','cash wa distributing','cash-wa'],ARRAY['cash-wa.com','cashwa.com'],NULL,'Broadline','https://www.cash-wa.com',NULL,'contact_vendor','US',ARRAY['US-NE','US-IA','US-KS','US-MO','US-SD','US-ND','US-MN'],'approved','seed','Cash-Wa Distributing'),
      ('feeser''s','{}',ARRAY['feesers','feeser food','feeser''s food distributors'],ARRAY['feesers.com'],NULL,'Broadline','https://www.feesers.com',NULL,'contact_vendor','US',ARRAY['US-PA','US-MD','US-VA','US-DE','US-NJ','US-NY'],'approved','seed','Feeser''s'),
      ('ginsberg''s foods','{}',ARRAY['ginsbergs foods','ginsberg foods','ginsberg''s'],ARRAY['ginsbergsfoods.com'],NULL,'Broadline','https://www.ginsbergsfoods.com',NULL,'contact_vendor','US',ARRAY['US-NY','US-NJ','US-CT'],'approved','seed','Ginsberg''s Foods'),
      ('upper lakes foods','{}',ARRAY['upper lakes food','upper lakes'],ARRAY['upperlakesfoods.com'],NULL,'Broadline','https://www.upperlakesfoods.com',NULL,'contact_vendor','US',ARRAY['US-MN','US-WI','US-MI','US-ND','US-SD'],'approved','seed','Upper Lakes Foods'),
      ('van eerden foodservice','{}',ARRAY['van eerden food service','van eerden'],ARRAY['vaneerdenfoodservice.com'],NULL,'Broadline','https://www.vaneerdenfoodservice.com',NULL,'contact_vendor','US',ARRAY['US-MI','US-IN','US-OH','US-WI'],'approved','seed','Van Eerden Foodservice'),
      ('martin bros. distributing','{}',ARRAY['martin brothers','martin brothers distributing','martin bro','martin bros'],ARRAY['martinbrothers.com'],NULL,'Broadline','https://www.martinbrothers.com',NULL,'contact_vendor','US',ARRAY['US-IA','US-MN','US-WI','US-IL','US-MO','US-SD','US-ND'],'approved','seed','Martin Bros. Distributing'),
      ('nicholas and company','{}',ARRAY['nicholas & company','nicholas co','nicholas and co'],ARRAY['nicholasandco.com'],NULL,'Broadline','https://www.nicholasandco.com',NULL,'contact_vendor','US',ARRAY['US-UT','US-CO','US-ID','US-MT','US-WY','US-NV','US-AZ'],'approved','seed','Nicholas and Company'),
      ('harbor foods','{}',ARRAY['harbor food','harbor foods inc','harbor foodservice'],ARRAY['harborfoods.com'],NULL,'Broadline','https://www.harborfoods.com',NULL,'contact_vendor','US',ARRAY['US-WA','US-OR'],'approved','seed','Harbor Foods'),
      ('loffredo fresh foods','{}',ARRAY['loffredo','loffredo fresh produce','loffredo foods'],ARRAY['loffredo.com'],NULL,'Produce','https://www.loffredo.com',NULL,'contact_vendor','US',ARRAY['US-IA','US-NE','US-MO','US-KS'],'approved','seed','Loffredo Fresh Foods'),
      ('maplevale farms','{}',ARRAY['maple vale farms','maplevale farm'],ARRAY['maplevale.com'],NULL,'Broadline','https://www.maplevale.com',NULL,'contact_vendor','US',ARRAY['US-NY','US-PA','US-NJ','US-CT'],'approved','seed','Maplevale Farms'),
      ('palmer food services','{}',ARRAY['palmer foodservice','palmer food service','palmer foods'],ARRAY['palmerfoodservices.com'],NULL,'Broadline','https://www.palmerfoodservices.com',NULL,'contact_vendor','US',ARRAY['US-NY','US-PA','US-NJ','US-CT','US-MA'],'approved','seed','Palmer Food Services'),
      ('prime source foods','{}',ARRAY['primesource foods','prime source food','prime source foodservice'],ARRAY['primesourcefoods.com'],NULL,'Broadline','https://www.primesourcefoods.com',NULL,'contact_vendor','US',ARRAY['US-TX','US-OK','US-AR','US-LA','US-MS'],'approved','seed','Prime Source Foods'),
      ('quaker valley foods','{}',ARRAY['quaker valley food','quaker valley'],ARRAY['qvf.com'],NULL,'Broadline','https://www.qvf.com',NULL,'contact_vendor','US',ARRAY['US-PA','US-NJ','US-DE','US-MD','US-VA','US-NY'],'approved','seed','Quaker Valley Foods'),
      ('sanwa food group','{}',ARRAY['sanwa food','sanwa foods'],ARRAY['sanwafoodgroup.com'],NULL,'Asian & Specialty','https://www.sanwafoodgroup.com',NULL,'contact_vendor','US',ARRAY['US-CA'],'approved','seed','Sanwa Food Group'),
      ('y. hata','{}',ARRAY['y hata','y hata & co','yhata'],ARRAY['yhata.com'],NULL,'Broadline','https://www.yhata.com',NULL,'contact_vendor','US',ARRAY['US-HI'],'approved','seed','Y. Hata'),
      ('suisan','{}',ARRAY['suisan company','suisan co'],ARRAY['suisan.com'],NULL,'Broadline','https://www.suisan.com',NULL,'contact_vendor','US',ARRAY['US-HI'],'approved','seed','Suisan'),
      ('birite foodservice','{}',ARRAY['bi-rite foodservice','bi rite foodservice','birite food service'],ARRAY['biritefoodservice.com'],NULL,'Broadline','https://www.biritefoodservice.com',NULL,'contact_vendor','US',ARRAY['US-CA','US-NV','US-OR'],'approved','seed','BiRite Foodservice'),
      ('ace endico','{}',ARRAY['ace endico corporation','ace endico foods'],ARRAY['aceendico.com'],NULL,'Broadline','https://www.aceendico.com',NULL,'contact_vendor','US',ARRAY['US-NY','US-NJ','US-CT'],'approved','seed','Ace Endico'),
      ('kuna foodservice','{}',ARRAY['kuna food service','kuna foods'],ARRAY['kunafoodservice.com'],NULL,'Broadline','https://www.kunafoodservice.com',NULL,'contact_vendor','US',ARRAY['US-ID','US-OR','US-WA','US-MT','US-WY'],'approved','seed','Kuna Foodservice'),
      ('kohl wholesale','{}',ARRAY['kohl food','kohl wholesale company'],ARRAY['kohlwholesale.com'],NULL,'Broadline','https://www.kohlwholesale.com',NULL,'contact_vendor','US',ARRAY['US-NE','US-KS','US-MO','US-IA','US-SD'],'approved','seed','Kohl Wholesale'),
      ('dennis food service','{}',ARRAY['dennis foodservice','dennis food svc'],ARRAY['dennisfoodservice.com'],NULL,'Broadline','https://www.dennisfoodservice.com',NULL,'contact_vendor','US',ARRAY['US-ME','US-NH','US-MA','US-VT'],'approved','seed','Dennis Food Service'),
      ('dicarlo distributors','{}',ARRAY['di carlo distributors','dicarlo food service'],ARRAY['dicarlodistributors.com'],NULL,'Broadline','https://www.dicarlodistributors.com',NULL,'contact_vendor','US',ARRAY['US-NY','US-NJ','US-PA','US-CT'],'approved','seed','DiCarlo Distributors'),
      ('jordano''s foodservice','{}',ARRAY['jordanos foodservice','jordano''s','jordanos food service'],ARRAY['jordanos.com'],NULL,'Broadline','https://www.jordanos.com',NULL,'contact_vendor','US',ARRAY['US-CA'],'approved','seed','Jordano''s Foodservice'),
      ('jake''s finer foods','{}',ARRAY['jakes finer foods','jake''s fine foods','jake''s foods'],ARRAY['jakesfinerfoods.com'],NULL,'Broadline','https://www.jakesfinerfoods.com',NULL,'contact_vendor','US',ARRAY['US-IL','US-IN','US-OH','US-WI','US-MO'],'approved','seed','Jake''s Finer Foods'),
      ('international gourmet foods','{}',ARRAY['international gourmet food','igf'],ARRAY['igfood.com'],NULL,'Specialty & Gourmet','https://www.igfood.com',NULL,'contact_vendor','US',ARRAY['US-VA','US-DC','US-MD','US-PA'],'approved','seed','International Gourmet Foods'),
      ('webstaurantstore','{}',ARRAY['webstaurant store','webstaurant'],ARRAY['webstaurantstore.com'],NULL,'Online Retail','https://www.webstaurantstore.com','https://www.webstaurantstore.com','public_ecommerce','US','{}','approved','seed','WebstaurantStore'),
      ('foodservicedirect','{}',ARRAY['food service direct','fsd','foodservice direct'],ARRAY['foodservicedirect.com'],NULL,'Online Retail','https://www.foodservicedirect.com','https://www.foodservicedirect.com','public_ecommerce','US','{}','approved','seed','FoodServiceDirect'),
      ('baker''s authority','{}',ARRAY['bakers authority'],ARRAY['bakersauthority.com'],NULL,'Online Retail','https://www.bakersauthority.com','https://www.bakersauthority.com','public_ecommerce','US','{}','approved','seed','Baker''s Authority'),
      ('d''artagnan','{}',ARRAY['dartagnan','d artagnan'],ARRAY['dartagnan.com'],NULL,'Specialty & Gourmet','https://www.dartagnan.com','https://www.dartagnan.com','public_ecommerce','US','{}','approved','seed','D''Artagnan'),
      ('web food store','{}',ARRAY['webfoodstore'],ARRAY['webfoodstore.com'],NULL,'Online Retail','https://www.webfoodstore.com','https://www.webfoodstore.com','public_ecommerce','US','{}','approved','seed','Web Food Store')
    ON CONFLICT (normalized_name, (COALESCE(connector_id, ''))) DO NOTHING;

    -- Record both seed gates so dev and VPS won't re-run old blocks
    INSERT INTO _migration_log (version, description)
      VALUES ('pvr-mvp-seed-v1', 'MVP seed: 47 direct-order foodservice distributors')
      ON CONFLICT DO NOTHING;

    INSERT INTO _migration_log (version, description)
      VALUES ('v056', 'MVP Reset: drop v2 research columns, add country_code, re-seed with 47 direct-order vendors')
      ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- =============================================================================
-- v057 — Task #417: calorie_count on menu_items
-- Optional calorie count per serving — extracted from menu scan or entered manually.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v057') THEN

    ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS calorie_count integer;

    INSERT INTO _migration_log (version, description)
      VALUES ('v057', 'Task #417: calorie_count on menu_items (optional, nullable integer)');
  END IF;
END $$;

-- =============================================================================
-- v058 — Task #419: Back-fill calorie_count and strip calorie annotations from
--         menu_items.name for rows imported before the menuScanner fix.
--
-- Pattern matched (case-insensitive):
--   optional-space ( digits [digits/spaces/hyphens/en-dashes] optional-space
--   "cal" [optional letters or dot] ) optional-space
--
-- Examples stripped: "(560 cal)", "(570-680 cal)", "(315 calories)", "(160 Cal.)"
--
-- Safe to re-run: the WHERE clause only touches rows still containing the
-- annotation pattern, so subsequent runs are no-ops.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v058') THEN

    UPDATE menu_items
    SET
      -- Back-fill calorie_count only when it is still NULL
      calorie_count = COALESCE(
        calorie_count,
        (regexp_match(name, '\((\d+)[\d\s\-–]*\s*[Cc][Aa][Ll][a-zA-Z.]*\)'))[1]::integer
      ),
      -- Strip the annotation from the name; trim any leftover whitespace
      name = trim(regexp_replace(name, '\s*\(\d[\d\s\-–]*\s*cal[a-z.]*\)\s*', '', 'gi'))
    WHERE name ~* '\(\d[\d\s\-–]*\s*cal[a-z.]*\)';

    INSERT INTO _migration_log (version, description)
      VALUES ('v058', 'Task #419: strip calorie annotations from menu_items.name and back-fill calorie_count');
  END IF;
END $$;

-- =============================================================================
-- v059 — M3A: Vendor price integrity — provenance tracking
-- Adds price_source, priced_at, price_source_reference_id to vendor_items;
-- adds source and case_price to inventory_item_price_history.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v059') THEN

    ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS price_source text;
    ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS priced_at timestamp;
    ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS price_source_reference_id text;

    ALTER TABLE inventory_item_price_history ADD COLUMN IF NOT EXISTS source text;
    ALTER TABLE inventory_item_price_history ADD COLUMN IF NOT EXISTS case_price real;

    CREATE INDEX IF NOT EXISTS iiph_source_idx ON inventory_item_price_history (source);
    CREATE INDEX IF NOT EXISTS vi_price_source_idx ON vendor_items (price_source);

    -- Provenance-aware back-fill: classify existing vendor_item rows.
    -- Ambiguous rows (receipt link AND last_case_price > 0) fall through to
    -- legacy_unknown — never misclassified as a trusted provenance source.
    -- 1. Unambiguous receipt link (no competing order-guide signal) → "receipt"
    UPDATE vendor_items
    SET price_source = 'receipt'
    WHERE price_source IS NULL
      AND (last_case_price IS NULL OR last_case_price = 0)
      AND EXISTS (
        SELECT 1 FROM receipt_lines rl
        WHERE rl.vendor_item_id = vendor_items.id
          AND rl.price_each > 0
      );
    -- 2. Unambiguous order-guide signal (no receipt link) → "order_guide_import"
    UPDATE vendor_items
    SET price_source = 'order_guide_import'
    WHERE price_source IS NULL
      AND last_case_price IS NOT NULL
      AND last_case_price > 0
      AND NOT EXISTS (
        SELECT 1 FROM receipt_lines rl
        WHERE rl.vendor_item_id = vendor_items.id
          AND rl.price_each > 0
      );
    -- 3. All remaining NULL rows (ambiguous or unidentifiable) → "legacy_unknown"
    UPDATE vendor_items
    SET price_source = 'legacy_unknown'
    WHERE price_source IS NULL;
    -- 4. Semantic repair — re-derive last_price for order_guide_import rows where
    --    case_size > 0 and the stored unit price drifts from lastCasePrice / caseSize.
    --    Only touches unambiguously classified rows; legacy_unknown rows are never mutated.
    UPDATE vendor_items
    SET last_price = last_case_price / case_size
    WHERE price_source = 'order_guide_import'
      AND last_case_price IS NOT NULL AND last_case_price > 0
      AND case_size IS NOT NULL AND case_size > 0
      AND ABS(COALESCE(last_price, 0) - (last_case_price / case_size)) > 0.0001;
    -- 5. Report migration category counts via PostgreSQL NOTICE
    DO $$
    DECLARE
      v_receipt       bigint;
      v_og            bigint;
      v_lu            bigint;
      v_ambiguous     bigint;
      v_invalid_pack  bigint;
      v_semantic_rep  bigint;
    BEGIN
      SELECT COUNT(*) INTO v_receipt      FROM vendor_items WHERE price_source = 'receipt';
      SELECT COUNT(*) INTO v_og           FROM vendor_items WHERE price_source = 'order_guide_import';
      SELECT COUNT(*) INTO v_lu           FROM vendor_items WHERE price_source = 'legacy_unknown';
      SELECT COUNT(*) INTO v_ambiguous    FROM vendor_items
        WHERE price_source = 'legacy_unknown'
          AND last_case_price IS NOT NULL AND last_case_price > 0
          AND EXISTS (SELECT 1 FROM receipt_lines rl WHERE rl.vendor_item_id = vendor_items.id AND rl.price_each > 0);
      SELECT COUNT(*) INTO v_invalid_pack FROM vendor_items WHERE case_size IS NULL OR case_size <= 0;
      SELECT COUNT(*) INTO v_semantic_rep FROM vendor_items
        WHERE price_source = 'order_guide_import'
          AND last_case_price IS NOT NULL AND last_case_price > 0
          AND case_size IS NOT NULL AND case_size > 0;
      RAISE NOTICE '[M3A backfill] vendor_items price_source: receipt=%, order_guide_import=%, legacy_unknown=% (ambiguous=%, invalid-pack=%, semantic-repaired=%)',
        v_receipt, v_og, v_lu, v_ambiguous, v_invalid_pack, v_semantic_rep;
    END $$;

    INSERT INTO _migration_log (version, description)
      VALUES ('v059', 'M3A: Vendor price integrity — price_source provenance on vendor_items and inventory_item_price_history');
  END IF;
END $$;


-- =============================================================================
-- v060 — M3B: PO routing audit table (one row per routed line)
-- Captures per-line routing decisions: source/destination PO, vendor item,
-- price snapshot, ordered qty, and projected savings per case.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v060') THEN

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
    );

    CREATE INDEX IF NOT EXISTS po_routing_audit_company_idx        ON po_routing_audit (company_id);
    CREATE INDEX IF NOT EXISTS po_routing_audit_source_po_idx      ON po_routing_audit (source_po_id);
    CREATE INDEX IF NOT EXISTS po_routing_audit_source_po_line_idx ON po_routing_audit (source_po_line_id);
    -- Unique constraint: DB-level idempotency guard — one audit row per (source line, target vendor item)
    CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_audit_line_vi ON po_routing_audit (source_po_line_id, vendor_item_id);

    INSERT INTO _migration_log (version, description)
      VALUES ('v060', 'M3B: po_routing_audit table — per-line vendor routing audit trail');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v061') THEN
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS savings_reliable integer;

    INSERT INTO _migration_log (version, description)
      VALUES ('v061', 'M3B: po_routing_audit.savings_reliable — flag stale source price so phantom savings are visible');
  END IF;
END $$;

-- =============================================================================
-- v061 — po_routing_audit: snapshot operator_name at routing time
-- Prevents incorrect/missing names when users are renamed or deleted.
-- =============================================================================
ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS operator_name varchar;

-- =============================================================================
-- v062 — Task #481: projected_line_savings and savings_reliability_reasons on po_routing_audit
-- projected_line_savings = projectedSavingsPerCase × orderedQty (aggregate impact per routed line)
-- savings_reliability_reasons = JSON text array of reason codes explaining unreliable savings
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v062') THEN
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS projected_line_savings real;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS savings_reliability_reasons text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v062', 'Task #481: projected_line_savings and savings_reliability_reasons on po_routing_audit');
  END IF;
END $$;

-- =============================================================================
-- v063 — Task #482: Complete routing audit snapshot — pack geometry, price dates,
-- source/target vendor item context, and destination line ID.
-- All ten columns are nullable so existing audit rows remain valid.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v063') THEN
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_vendor_item_id varchar;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_case_size real;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_inner_pack_size real;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_priced_at timestamp;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS source_price_source text;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS target_case_size real;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS target_inner_pack_size real;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS target_priced_at timestamp;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS target_price_source text;
    ALTER TABLE po_routing_audit ADD COLUMN IF NOT EXISTS destination_po_line_id varchar;

    INSERT INTO _migration_log (version, description)
      VALUES ('v063', 'Task #482: routing audit snapshot — pack geometry, price dates, source/target VI IDs, dest line ID');
  END IF;
END $$;

-- =============================================================================
-- v064 — Extension Pilot: browser-extension price sync infrastructure.
-- New tables: extension_pairing_codes, extension_tokens, extension_sync_jobs,
-- extension_ingestion_batches.  New columns on vendor_items and order_guides.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v064') THEN
    ALTER TABLE vendor_items ADD COLUMN IF NOT EXISTS price_transport text;
    ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS transport text;
    ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS sync_job_id varchar;
    ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS customer_supplier_connection_id varchar;
    ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS external_supplier_id text;
    ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS external_supplier_name text;
    ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS external_location_id text;
    ALTER TABLE order_guides ADD COLUMN IF NOT EXISTS external_order_guide_id text;

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
    );
    CREATE INDEX IF NOT EXISTS ext_pairing_company_idx ON extension_pairing_codes (company_id);

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
    );
    CREATE INDEX IF NOT EXISTS ext_tokens_token_idx   ON extension_tokens (token);
    CREATE INDEX IF NOT EXISTS ext_tokens_company_idx ON extension_tokens (company_id);

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
    );
    CREATE INDEX IF NOT EXISTS ext_sync_jobs_company_idx ON extension_sync_jobs (company_id);
    CREATE INDEX IF NOT EXISTS ext_sync_jobs_status_idx  ON extension_sync_jobs (status);

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
    );
    CREATE INDEX IF NOT EXISTS ext_ingest_sync_job_idx ON extension_ingestion_batches (sync_job_id);

    INSERT INTO _migration_log (version, description)
      VALUES ('v064', 'Extension Pilot: pairing codes, tokens, sync jobs, ingestion batches; vendor_items/order_guides columns');
  END IF;
END $$;

-- =============================================================================
-- v065 — Extension Pilot: capture completeness fields + captureWarning.
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _migration_log WHERE version = 'v065') THEN
    ALTER TABLE extension_sync_jobs ADD COLUMN IF NOT EXISTS capture_warning text;
    ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS paginated_pages integer;
    ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS expected_row_count integer;
    ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS visible_row_count integer;
    ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS captured_row_count integer;
    ALTER TABLE extension_ingestion_batches ADD COLUMN IF NOT EXISTS capture_warning text;

    INSERT INTO _migration_log (version, description)
      VALUES ('v065', 'Extension Pilot: capture completeness + captureWarning fields');
  END IF;
END $$;
