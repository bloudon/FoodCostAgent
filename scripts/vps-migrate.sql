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
