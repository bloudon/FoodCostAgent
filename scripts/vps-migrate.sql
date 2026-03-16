-- VPS migration script: Tasks #13 and #14
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
