-- =============================================================================
-- purge-test-data.sql
-- Run on VPS with:  psql "$DATABASE_URL" -f scripts/purge-test-data.sql
--
-- Keeps the three real accounts; deletes every other company and all data
-- belonging to it.  Safe to re-run (deleting from already-empty tables is a
-- no-op).
--
-- ACCOUNTS KEPT
--   Brian's Pizza   — admin@pizza.com  (admin / full-data account)
--   Stacy's Pizza   — Stacyloudon@gmail.com (secondary test user)
--   Big City Pizza  — identified by company name (131 inventory items)
-- =============================================================================

DO $$
DECLARE
  keep_ids text[];
  n        int;
BEGIN
  -- Resolve keep IDs dynamically so this script works on any environment
  -- regardless of UUID values.
  SELECT ARRAY(
    SELECT DISTINCT u.company_id
    FROM   users u
    WHERE  lower(u.email) IN (
      'admin@pizza.com',
      'stacyloudon@gmail.com'
    )
    UNION
    SELECT c.id
    FROM   companies c
    WHERE  lower(c.name) = 'big city pizza'
  ) INTO keep_ids;

  IF array_length(keep_ids, 1) IS NULL OR array_length(keep_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Could not resolve any keep-company IDs — aborting.';
  END IF;

  RAISE NOTICE 'Keeping company IDs: %', keep_ids;

  -- ------------------------------------------------------------------
  -- Delete in dependency order (children before parents)
  -- ------------------------------------------------------------------

  -- QuickBooks
  DELETE FROM quickbooks_sync_logs       WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'quickbooks_sync_logs: %', n;
  DELETE FROM quickbooks_token_logs      WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'quickbooks_token_logs: %', n;
  DELETE FROM quickbooks_vendor_mappings WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'quickbooks_vendor_mappings: %', n;
  DELETE FROM quickbooks_connections     WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'quickbooks_connections: %', n;

  -- POS / sales
  DELETE FROM pos_sales              WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'pos_sales: %', n;
  DELETE FROM daily_menu_item_sales  WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'daily_menu_item_sales: %', n;
  DELETE FROM sales_upload_batches   WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'sales_upload_batches: %', n;

  -- Operations
  DELETE FROM waste_logs             WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'waste_logs: %', n;
  DELETE FROM recipe_cost_snapshots  WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'recipe_cost_snapshots: %', n;
  DELETE FROM theoretical_usage_runs WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'theoretical_usage_runs: %', n;
  DELETE FROM transfer_logs          WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'transfer_logs: %', n;
  DELETE FROM transfer_orders        WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'transfer_orders: %', n;
  DELETE FROM purchase_orders        WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'purchase_orders: %', n;
  DELETE FROM receipts               WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'receipts: %', n;

  -- Menu
  DELETE FROM menu_import_sessions   WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'menu_import_sessions: %', n;
  DELETE FROM menu_departments       WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'menu_departments: %', n;
  DELETE FROM store_menu_items       WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'store_menu_items: %', n;
  DELETE FROM menu_item_sizes        WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'menu_item_sizes: %', n;
  DELETE FROM menu_items             WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'menu_items: %', n;

  -- Recipes (recipe_components links via recipe_id, not company_id)
  DELETE FROM store_recipes      WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'store_recipes: %', n;
  DELETE FROM recipe_components  WHERE recipe_id IN (SELECT id FROM recipes WHERE company_id <> ALL(keep_ids)); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'recipe_components: %', n;
  DELETE FROM recipes            WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'recipes: %', n;

  -- Inventory
  DELETE FROM inventory_counts      WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'inventory_counts: %', n;
  DELETE FROM store_inventory_items WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'store_inventory_items: %', n;
  DELETE FROM inventory_items       WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'inventory_items: %', n;

  -- Order guides (order_guide_stores links via order_guide_id)
  DELETE FROM order_guide_stores WHERE order_guide_id IN (SELECT id FROM order_guides WHERE company_id <> ALL(keep_ids)); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'order_guide_stores: %', n;
  DELETE FROM order_guides       WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'order_guides: %', n;

  -- Vendors / setup
  DELETE FROM vendors           WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'vendors: %', n;
  DELETE FROM categories        WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'categories: %', n;
  DELETE FROM storage_locations WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'storage_locations: %', n;
  DELETE FROM dayparts          WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'dayparts: %', n;

  -- Auth / onboarding
  DELETE FROM api_credentials     WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'api_credentials: %', n;
  DELETE FROM invitations         WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'invitations: %', n;
  DELETE FROM onboarding_progress WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'onboarding_progress: %', n;
  DELETE FROM company_stores      WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'company_stores: %', n;
  DELETE FROM users               WHERE company_id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'users: %', n;

  -- Companies last
  DELETE FROM companies WHERE id <> ALL(keep_ids); GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE 'companies deleted: %', n;

  RAISE NOTICE '=== Purge complete ===';
  RAISE NOTICE 'Remaining companies: %', (SELECT count(*) FROM companies);
  RAISE NOTICE 'Remaining users:     %', (SELECT count(*) FROM users);
END $$;
