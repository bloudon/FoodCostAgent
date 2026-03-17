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
