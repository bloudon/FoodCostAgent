-- ============================================================================
-- PM HOLD — Read-only verification of existing May 2026 Bay Hill data in PROD
-- ============================================================================
-- Run on the VPS as:
--   psql "$DATABASE_URL" -f verify_may_production_readonly.sql
--
-- STRICTLY READ-ONLY. Contains only SELECT statements. No approvals, no
-- session creation, no deletes. Do NOT run any import/approve/apply commands.
--
-- If Section 0 shows that historical-model tables are missing, later sections
-- will error for those tables — that outcome itself is the answer (the
-- existing May data predates the historical model and needs migration).
-- ============================================================================

\echo '=== Section 0: which tables exist (historical model present?) ==='
SELECT t.name,
       to_regclass(t.name) IS NOT NULL AS exists
FROM (VALUES
  ('inventory_import_batches'),
  ('inventory_import_rows'),
  ('inventory_counts'),
  ('inventory_count_lines'),
  ('historical_session_unresolved_rows')
) AS t(name);

\echo ''
\echo '=== Section 1: May 2026 import batches (item 1, 5, 6, 9) ==='
SELECT id            AS batch_id,
       company_id,
       original_filename,
       inventory_date,
       inventory_date_confirmed,
       status,
       source_row_count,
       snapshot_total,
       uploaded_at,
       approved_at
FROM inventory_import_batches
WHERE original_filename ILIKE '%may%2026%'
   OR inventory_date IN ('2026-05-31', '2026-06-01')
ORDER BY uploaded_at;

\echo ''
\echo '=== Section 2: May 2026 count sessions (items 2, 3, 4, 5, 6, 9) ==='
SELECT c.id          AS session_id,
       c.company_id,
       c.store_id,
       c.name,
       c.count_date,
       c.applied,
       c.applied_at,
       c.is_historical_import,
       c.source_system,
       c.source_batch_id,
       c.source_filename,
       c.source_inventory_date,
       c.imported_snapshot_total,
       c.counted_at
FROM inventory_counts c
WHERE c.source_filename ILIKE '%may%2026%'
   OR c.source_inventory_date IN ('2026-05-31', '2026-06-01')
   OR c.count_date::text LIKE '2026-05-3%'
   OR c.count_date::text LIKE '2026-06-01%'
ORDER BY c.counted_at;

\echo ''
\echo '=== Section 3: resolved line count + valuation per May session (items 7, 9) ==='
SELECT l.inventory_count_id                       AS session_id,
       COUNT(*)                                   AS line_count,
       ROUND(SUM(l.qty * l.unit_cost)::numeric,2) AS lines_valuation
FROM inventory_count_lines l
WHERE l.inventory_count_id IN (
  SELECT id FROM inventory_counts
  WHERE source_filename ILIKE '%may%2026%'
     OR source_inventory_date IN ('2026-05-31', '2026-06-01')
     OR count_date::text LIKE '2026-05-3%'
     OR count_date::text LIKE '2026-06-01%')
GROUP BY l.inventory_count_id;

\echo ''
\echo '=== Section 4: unresolved historical evidence per May session (item 8) ==='
SELECT u.session_id,
       COUNT(*) AS unresolved_evidence_count
FROM historical_session_unresolved_rows u
GROUP BY u.session_id;

\echo ''
\echo '=== Section 5: import rows per May batch (source-row sanity for item 9) ==='
SELECT r.batch_id,
       COUNT(*)                                  AS row_count,
       ROUND(SUM(COALESCE(r.total_cost,0))::numeric,2) AS rows_total_cost
FROM inventory_import_rows r
WHERE r.batch_id IN (
  SELECT id FROM inventory_import_batches
  WHERE original_filename ILIKE '%may%2026%'
     OR inventory_date IN ('2026-05-31', '2026-06-01'))
GROUP BY r.batch_id;
