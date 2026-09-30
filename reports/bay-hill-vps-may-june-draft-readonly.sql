-- Operator-only, read-only evidence collection. Do not run against the Replit development DB.
-- Invoke from the VPS checkout using the operator's established read-only psql connection:
-- psql -X -v ON_ERROR_STOP=1 -f reports/bay-hill-vps-may-june-draft-readonly.sql
-- Do not paste a connection string.
-- Do not commit raw output. Review the tenant/store/session list before interpreting row matches.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF (SELECT count(*) FROM companies WHERE name = 'Bay Hill CC') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Bay Hill CC company; stop';
  END IF;
END $$;

\echo 'A. Tenant/store and candidate sessions; applied=0 is only a draft indicator, not proof of no lines'
SELECT c.name AS company, s.id AS store_id, s.name AS store_name,
       ic.id AS session_id, ic.count_date::date AS count_date,
       ic.source_inventory_date, ic.name AS session_name, ic.applied,
       ic.is_historical_import, ic.source_system, ic.source_batch_id,
       count(l.id) AS persisted_lines,
       count(l.id) FILTER (WHERE l.qty <> 0) AS nonzero_lines,
       count(l.id) FILTER (WHERE l.case_qty IS NOT NULL OR l.container_qty IS NOT NULL OR l.loose_units IS NOT NULL) AS lines_with_parts
FROM companies c
JOIN company_stores s ON s.company_id = c.id
JOIN inventory_counts ic ON ic.company_id = c.id AND ic.store_id = s.id
LEFT JOIN inventory_count_lines l ON l.inventory_count_id = ic.id
WHERE c.name = 'Bay Hill CC'
  AND (ic.count_date::date BETWEEN DATE '2026-05-01' AND DATE '2026-07-02'
       OR ic.source_inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
       OR (ic.applied = 0 AND (ic.name ILIKE '%May%2026%' OR ic.name ILIKE '%June%2026%')))
GROUP BY c.name,s.id,s.name,ic.id,ic.count_date,ic.source_inventory_date,
         ic.name,ic.applied,ic.is_historical_import,ic.source_system,ic.source_batch_id
ORDER BY ic.count_date,ic.id;

\echo 'B. Candidate approved source batches; independently verify property/store identity'
SELECT b.id AS batch_id, b.inventory_date, b.status, b.source_system,
       b.source_property_id, b.target_store_id, b.original_filename,
       count(r.id) AS source_rows,
       count(r.id) FILTER (WHERE r.resolved_inventory_item_id IS NOT NULL) AS resolved_rows
FROM inventory_import_batches b
JOIN companies c ON c.id = b.company_id
LEFT JOIN inventory_import_rows r ON r.batch_id = b.id
WHERE c.name = 'Bay Hill CC' AND b.inventory_date IN
      ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
GROUP BY b.id
ORDER BY b.inventory_date,b.id;

\echo 'C. Every persisted draft line with possible source rows (not an asserted match)'
-- Period by the session's declared source date if present, otherwise its count date.
-- A session lacking source_batch_id has no authoritative row-level source link.
-- A source candidate requires same tenant, store, period, item ID AND normalized location.
-- Zero candidate rows, multiple candidate rows, and multiple candidate batches are all unresolved.
WITH tenant AS (
  SELECT id FROM companies WHERE name = 'Bay Hill CC'
), drafts AS (
  SELECT ic.*, CASE
    WHEN COALESCE(ic.source_inventory_date::date, ic.count_date::date)
         BETWEEN DATE '2026-05-01' AND DATE '2026-05-31'
      OR ic.source_inventory_date = '2026-06-01' THEN 'May'
    WHEN COALESCE(ic.source_inventory_date::date, ic.count_date::date)
         BETWEEN DATE '2026-06-02' AND DATE '2026-06-30'
      OR ic.source_inventory_date = '2026-07-01' THEN 'June'
    ELSE NULL END AS period
  FROM inventory_counts ic JOIN tenant t ON t.id = ic.company_id
  WHERE ic.applied = 0
), source_rows AS (
  SELECT b.id AS batch_id, b.target_store_id,
         CASE WHEN b.inventory_date IN ('2026-05-31','2026-06-01') THEN 'May'
              WHEN b.inventory_date IN ('2026-06-30','2026-07-01') THEN 'June' END AS period,
         r.id AS row_id, r.row_index, r.resolved_inventory_item_id,
         lower(regexp_replace(trim(coalesce(nullif(r.storage_location,''),'General Storage')), '\s+', ' ', 'g')) AS location_key,
         r.raw_data->>'Pack Size' AS source_pack, r.count_unit1, r.count1,
         r.count_unit2, r.count2, r.count_unit3, r.count3, r.total_units,
         r.raw_data->>'Total Units' AS raw_total_units
  FROM inventory_import_batches b
  JOIN tenant t ON t.id = b.company_id
  JOIN inventory_import_rows r ON r.batch_id = b.id
  WHERE b.status = 'approved' AND b.source_system = 'ORDERLY'
    AND b.inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
), lines AS (
  SELECT d.id AS session_id, d.period, d.source_batch_id, d.store_id,
         l.id AS line_id, l.inventory_item_id, i.name AS item_name,
         l.storage_location_id, sl.name AS location_name,
         lower(regexp_replace(trim(sl.name), '\s+', ' ', 'g')) AS location_key,
         l.unit_id, u.abbreviation AS saved_unit, l.qty, l.case_qty,
         l.container_qty, l.loose_units
  FROM drafts d
  JOIN inventory_count_lines l ON l.inventory_count_id = d.id
  JOIN inventory_items i ON i.id = l.inventory_item_id AND i.company_id = d.company_id
  JOIN storage_locations sl ON sl.id = l.storage_location_id AND sl.company_id = d.company_id
  LEFT JOIN units u ON u.id = l.unit_id
  WHERE d.period IS NOT NULL
)
SELECT l.session_id,l.period,l.source_batch_id,l.line_id,l.inventory_item_id,
       l.item_name,l.location_name,l.unit_id,l.saved_unit,l.qty,
       l.case_qty,l.container_qty,l.loose_units,
       count(sr.row_id) AS candidate_rows,
       count(DISTINCT sr.batch_id) AS candidate_batches,
       string_agg(sr.batch_id || ':' || sr.row_id || ':row-' || sr.row_index,
                  '; ' ORDER BY sr.batch_id,sr.row_index) AS source_row_refs,
       string_agg(coalesce(sr.source_pack,'?') || ' [' || coalesce(sr.count_unit1,'?') || '/' ||
                  coalesce(sr.count_unit2,'?') || '/' || coalesce(sr.count_unit3,'?') ||
                  '] parts=' || coalesce(sr.count1::text,'NULL') || '/' ||
                  coalesce(sr.count2::text,'NULL') || '/' || coalesce(sr.count3::text,'NULL') ||
                  ' total=' || coalesce(sr.total_units::text,'NULL') ||
                  ' raw=' || coalesce(sr.raw_total_units,'NULL'),
                  '; ' ORDER BY sr.batch_id,sr.row_index) AS source_evidence,
       CASE WHEN l.source_batch_id IS NULL THEN 'UNLINKED: candidate only'
            WHEN count(sr.row_id) = 1 THEN 'LINKED: review source tier/geometry before unit verdict'
            WHEN count(sr.row_id) = 0 THEN 'LINKED: no item/location source row'
            ELSE 'LINKED: multiple source rows; reconcile as group' END AS link_status
FROM lines l
LEFT JOIN source_rows sr ON sr.period = l.period
 AND sr.target_store_id = l.store_id
 AND sr.resolved_inventory_item_id = l.inventory_item_id
 AND sr.location_key = l.location_key
 AND (l.source_batch_id IS NULL OR sr.batch_id = l.source_batch_id)
GROUP BY l.session_id,l.period,l.source_batch_id,l.line_id,l.inventory_item_id,
         l.item_name,l.location_name,l.unit_id,l.saved_unit,l.qty,
         l.case_qty,l.container_qty,l.loose_units
ORDER BY l.period,l.session_id,l.item_name,l.location_name,l.line_id;

ROLLBACK;