-- VPS migration script: Tasks #13, #14, and category protection
-- Run with: psql $DATABASE_URL -f scripts/vps-migrate.sql

ALTER TABLE background_images ADD COLUMN IF NOT EXISTS is_free_background integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_menu_item_sales_unique'
  ) THEN
    ALTER TABLE daily_menu_item_sales ADD CONSTRAINT daily_menu_item_sales_unique
      UNIQUE (company_id, store_id, menu_item_id, sales_date, daypart_id, source_batch_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_count_lines_unique'
  ) THEN
    ALTER TABLE inventory_count_lines ADD CONSTRAINT inventory_count_lines_unique
      UNIQUE (inventory_count_id, inventory_item_id, storage_location_id);
  END IF;
END $$;

-- ============================================================
-- Category soft-delete + orphan protection (current task)
-- ============================================================

-- 1. Add is_active column to categories (soft-delete support)
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active integer NOT NULL DEFAULT 1;

-- 2. Fix any existing orphaned inventory items (category_id pointing to deleted category)
UPDATE inventory_items
SET category_id = NULL
WHERE category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM categories c WHERE c.id = inventory_items.category_id
  );

-- 3. Add FK constraint ON DELETE SET NULL as database-level safety net
DO $$
BEGIN
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
END $$;

-- 4. Restore missing categories for every existing company
--    (Produce, Dairy, Proteins, Seafood, Bread/Dough, Spices & Seasonings, Beverages, Cleaning & Supplies)
--    Only inserts if the named category does not already exist for that company.
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
