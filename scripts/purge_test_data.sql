BEGIN;

-- ============================================================
-- SAFETY CHECK: Abort immediately if Brian's Pizza is missing
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM companies WHERE id = 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
  ) THEN
    RAISE EXCEPTION 'Safety abort: Brian''s Pizza not found. Verify the company ID before running.';
  END IF;
END $$;

-- Preview what will be deleted
SELECT id, name FROM companies WHERE id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

-- ============================================================
-- ROUND 1: Deepest child tables (no direct company_id)
-- ============================================================

-- inventory_count_lines -> inventory_counts
DELETE FROM inventory_count_lines
WHERE inventory_count_id IN (
  SELECT id FROM inventory_counts
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- po_lines -> purchase_orders
DELETE FROM po_lines
WHERE purchase_order_id IN (
  SELECT id FROM purchase_orders
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- receipt_lines -> receipts
DELETE FROM receipt_lines
WHERE receipt_id IN (
  SELECT id FROM receipts
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- pos_sales_lines -> pos_sales
DELETE FROM pos_sales_lines
WHERE pos_sales_id IN (
  SELECT id FROM pos_sales
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- order_guide_lines -> order_guides
DELETE FROM order_guide_lines
WHERE order_guide_id IN (
  SELECT id FROM order_guides
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- order_guide_stores -> order_guides
DELETE FROM order_guide_stores
WHERE order_guide_id IN (
  SELECT id FROM order_guides
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- theoretical_usage_lines -> theoretical_usage_runs
DELETE FROM theoretical_usage_lines
WHERE run_id IN (
  SELECT id FROM theoretical_usage_runs
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- transfer_order_lines -> transfer_orders
DELETE FROM transfer_order_lines
WHERE transfer_order_id IN (
  SELECT id FROM transfer_orders
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- api_credential_locations -> api_credentials
DELETE FROM api_credential_locations
WHERE api_credential_id IN (
  SELECT id FROM api_credentials
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- store_storage_locations -> company_stores
DELETE FROM store_storage_locations
WHERE store_id IN (
  SELECT id FROM company_stores
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- inventory_item_locations -> inventory_items
DELETE FROM inventory_item_locations
WHERE inventory_item_id IN (
  SELECT id FROM inventory_items
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- inventory_item_price_history -> inventory_items
DELETE FROM inventory_item_price_history
WHERE inventory_item_id IN (
  SELECT id FROM inventory_items
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- store_vendors -> vendors
DELETE FROM store_vendors
WHERE vendor_id IN (
  SELECT id FROM vendors
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- vendor_items -> vendors
DELETE FROM vendor_items
WHERE vendor_id IN (
  SELECT id FROM vendors
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- recipe_versions -> recipes (no direct company_id)
DELETE FROM recipe_versions
WHERE recipe_id IN (
  SELECT id FROM recipes
  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- user_stores -> users
DELETE FROM user_stores
WHERE user_id IN (
  SELECT id FROM users
  WHERE company_id IS NOT NULL
    AND company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- auth_sessions -> users
DELETE FROM auth_sessions
WHERE user_id IN (
  SELECT id FROM users
  WHERE company_id IS NOT NULL
    AND company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- ============================================================
-- ROUND 2: Tables with direct company_id (children cleared)
-- ============================================================

DELETE FROM store_inventory_items    WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

-- recipe_components has no company_id column on VPS — delete via parent recipe
DELETE FROM recipe_components
WHERE recipe_id IN (
  SELECT id FROM recipes WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

-- store_recipes has no company_id column on VPS — delete via parent recipe
DELETE FROM store_recipes
WHERE recipe_id IN (
  SELECT id FROM recipes WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1'
);

DELETE FROM recipe_cost_snapshots    WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM store_menu_items         WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM daily_menu_item_sales    WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM sales_upload_batches     WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM waste_logs               WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM transfer_logs            WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM recipe_import_sessions   WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM menu_import_sessions     WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM quickbooks_vendor_mappings WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM quickbooks_sync_logs     WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM quickbooks_token_logs    WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM invitations              WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM onboarding_progress      WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM company_settings         WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

-- ============================================================
-- ROUND 3: Mid-level parents (children cleared above)
-- ============================================================

DELETE FROM inventory_counts         WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM purchase_orders          WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM receipts                 WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM pos_sales                WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM order_guides             WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM theoretical_usage_runs   WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM transfer_orders          WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM api_credentials          WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM quickbooks_connections   WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM inventory_items          WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM recipes                  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM vendors                  WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM menu_departments         WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM menu_items               WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM dayparts                 WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM storage_locations        WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';
DELETE FROM categories               WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

-- menu_item_sizes: nullable company_id — preserve global defaults (NULL)
DELETE FROM menu_item_sizes
WHERE company_id IS NOT NULL
  AND company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

-- ============================================================
-- ROUND 4: Users, stores
-- ============================================================

DELETE FROM users
WHERE company_id IS NOT NULL
  AND company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

DELETE FROM company_stores WHERE company_id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

-- ============================================================
-- ROUND 5: Companies
-- ============================================================

DELETE FROM companies WHERE id != 'ad95ecda-74a9-49d7-833b-6d7d2f48efd1';

-- ============================================================
-- Verify result
-- ============================================================
SELECT id, name FROM companies;
SELECT email, role, company_id FROM users ORDER BY role, email;

COMMIT;
