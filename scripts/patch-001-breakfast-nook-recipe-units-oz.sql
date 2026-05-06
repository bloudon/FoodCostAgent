-- Patch 001: Correct Denver Omelet (bn-r-06) ingredient units from lb to oz
-- Applied once against the Breakfast Nook seed data (bn-company-0001).
-- The seed had quantities stored in their lb base-unit form (0.125, 0.0625 …)
-- instead of the natural recipe units an operator would recognise (2 oz, 1 oz …).
-- oz unit id: 85555087-8a50-4f1c-be7d-6da71cd57ff6
-- lb unit id:  78e1a58e-8789-4581-9ef4-333032435678

UPDATE recipe_components
SET    unit_id = '85555087-8a50-4f1c-be7d-6da71cd57ff6',
       qty     = 2
WHERE  recipe_id    = 'bn-r-06'
  AND  component_id = (SELECT id FROM inventory_items WHERE name = 'Ham'         AND company_id = 'bn-company-0001' LIMIT 1)
  AND  unit_id      = '78e1a58e-8789-4581-9ef4-333032435678';

UPDATE recipe_components
SET    unit_id = '85555087-8a50-4f1c-be7d-6da71cd57ff6',
       qty     = 1
WHERE  recipe_id    = 'bn-r-06'
  AND  component_id = (SELECT id FROM inventory_items WHERE name = 'Onions'       AND company_id = 'bn-company-0001' LIMIT 1)
  AND  unit_id      = '78e1a58e-8789-4581-9ef4-333032435678';

UPDATE recipe_components
SET    unit_id = '85555087-8a50-4f1c-be7d-6da71cd57ff6',
       qty     = 1
WHERE  recipe_id    = 'bn-r-06'
  AND  component_id = (SELECT id FROM inventory_items WHERE name ILIKE '%Bell Pepper%' AND company_id = 'bn-company-0001' LIMIT 1)
  AND  unit_id      = '78e1a58e-8789-4581-9ef4-333032435678';

UPDATE recipe_components
SET    unit_id = '85555087-8a50-4f1c-be7d-6da71cd57ff6',
       qty     = 1.5
WHERE  recipe_id    = 'bn-r-06'
  AND  component_id = (SELECT id FROM inventory_items WHERE name ILIKE '%Cheddar%' AND company_id = 'bn-company-0001' LIMIT 1)
  AND  unit_id      = '78e1a58e-8789-4581-9ef4-333032435678';

UPDATE recipe_components
SET    unit_id = '85555087-8a50-4f1c-be7d-6da71cd57ff6',
       qty     = 0.5
WHERE  recipe_id    = 'bn-r-06'
  AND  component_id = (SELECT id FROM inventory_items WHERE name = 'Butter'       AND company_id = 'bn-company-0001' LIMIT 1)
  AND  unit_id      = '78e1a58e-8789-4581-9ef4-333032435678';
