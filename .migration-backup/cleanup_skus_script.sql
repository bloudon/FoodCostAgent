-- Clean up menu item SKUs: remove pipes and create abbreviations
-- This script updates SKUs in stages to avoid unique constraint violations

-- First, update all items to temporary values to avoid conflicts
UPDATE menu_items
SET plu_sku = 'TEMP_' || id
WHERE plu_sku LIKE '%|%' OR plu_sku = name OR LENGTH(plu_sku) > 10;

-- Now update to proper abbreviated SKUs
-- For items with pipes or that equal their name, create abbreviations
WITH abbreviated_skus AS (
  SELECT 
    id,
    name,
    company_id,
    UPPER(
      SUBSTRING(
        REGEXP_REPLACE(
          REGEXP_REPLACE(name, '[^A-Za-z0-9 ]', '', 'g'),
          '\s+',
          '',
          'g'
        ),
        1,
        10
      )
    ) AS base_sku,
    ROW_NUMBER() OVER (PARTITION BY company_id, 
      UPPER(
        SUBSTRING(
          REGEXP_REPLACE(
            REGEXP_REPLACE(name, '[^A-Za-z0-9 ]', '', 'g'),
            '\s+',
            '',
            'g'
          ),
          1,
          10
        )
      )
      ORDER BY name
    ) AS sku_num
  FROM menu_items
  WHERE plu_sku LIKE 'TEMP_%'
)
UPDATE menu_items m
SET plu_sku = CASE 
  WHEN a.sku_num = 1 THEN a.base_sku
  ELSE SUBSTRING(a.base_sku, 1, 10 - LENGTH(a.sku_num::text)) || a.sku_num::text
END
FROM abbreviated_skus a
WHERE m.id = a.id;

-- Show results
SELECT name, plu_sku FROM menu_items WHERE LENGTH(plu_sku) <= 10 ORDER BY name LIMIT 50;
