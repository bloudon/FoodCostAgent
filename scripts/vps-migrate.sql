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
