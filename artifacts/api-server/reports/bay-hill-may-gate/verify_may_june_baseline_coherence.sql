-- ============================================================================
-- PM scope: Verify the May/June production baseline remains coherent after
-- duplicate remediation. Identify only concrete material mapping errors.
-- ============================================================================
-- Run on the VPS:
--   psql "$DATABASE_URL" -P pager=off -f verify_may_june_baseline_coherence.sql > /tmp/baseline_check.txt 2>&1
--
-- STRICTLY READ-ONLY (SELECT only). No writes, no re-import, no unwind.
-- Default disposition if Sections 2-5 are clean: ACCEPT baseline as-is.
-- ============================================================================

\echo '=== Section A: May/June batches and sessions (scope identification) ==='
SELECT c.id AS session_id, c.source_batch_id AS batch_id, c.source_filename,
       c.source_inventory_date, c.applied, c.is_historical_import,
       c.imported_snapshot_total
FROM inventory_counts c
WHERE c.source_system = 'ORDERLY'
  AND (c.source_inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
       OR c.source_filename ILIKE '%may%2026%'
       OR c.source_filename ILIKE '%jun%2026%')
ORDER BY c.source_inventory_date;

\echo ''
\echo '=== Section B: valuation integrity per session (focus 4) ==='
-- lines_valuation is a float aggregate; cent-level noise vs snapshot total is
-- expected and NOT a finding. Material = dollars, not cents.
SELECT c.id AS session_id, c.source_inventory_date,
       c.imported_snapshot_total,
       COUNT(l.id) AS line_count,
       ROUND(SUM(l.qty * l.unit_cost)::numeric, 2) AS lines_valuation,
       ROUND((SUM(l.qty * l.unit_cost) - c.imported_snapshot_total)::numeric, 2) AS delta
FROM inventory_counts c
JOIN inventory_count_lines l ON l.inventory_count_id = c.id
WHERE c.source_system = 'ORDERLY'
  AND (c.source_inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
       OR c.source_filename ILIKE '%may%2026%'
       OR c.source_filename ILIKE '%jun%2026%')
GROUP BY c.id, c.source_inventory_date, c.imported_snapshot_total
ORDER BY c.source_inventory_date;

\echo ''
\echo '=== Section C: May/June lines still referencing SUPERSEDED items (focus 1) ==='
-- Expected: zero rows. Remediation apply repoints references; any row here is
-- a concrete mapping error to correct.
SELECT c.source_inventory_date, l.inventory_count_id AS session_id,
       l.id AS line_id, i.id AS item_id, i.name,
       i.superseded_by_item_id, i.superseded_at,
       ROUND((l.qty * l.unit_cost)::numeric, 2) AS line_value
FROM inventory_count_lines l
JOIN inventory_counts c ON c.id = l.inventory_count_id
JOIN inventory_items i ON i.id = l.inventory_item_id
WHERE c.source_system = 'ORDERLY'
  AND (c.source_inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
       OR c.source_filename ILIKE '%may%2026%' OR c.source_filename ILIKE '%jun%2026%')
  AND i.superseded_by_item_id IS NOT NULL
ORDER BY c.source_inventory_date, i.name;

\echo ''
\echo '=== Section C2: May/June lines referencing inactive-but-not-superseded items ==='
-- Broken references outside the remediation path. Expected: zero rows.
SELECT c.source_inventory_date, l.id AS line_id, i.id AS item_id, i.name, i.active
FROM inventory_count_lines l
JOIN inventory_counts c ON c.id = l.inventory_count_id
JOIN inventory_items i ON i.id = l.inventory_item_id
WHERE c.source_system = 'ORDERLY'
  AND (c.source_inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
       OR c.source_filename ILIKE '%may%2026%' OR c.source_filename ILIKE '%jun%2026%')
  AND i.active = 0 AND i.superseded_by_item_id IS NULL;

\echo ''
\echo '=== Section D: remediation audit summary (context for focus 2) ==='
SELECT result, classification, COUNT(*) AS groups,
       ROUND(SUM(COALESCE(valuation_delta,0))::numeric, 2) AS total_valuation_delta
FROM inventory_item_remediation_audit
GROUP BY result, classification
ORDER BY result, classification;

\echo ''
\echo '=== Section D2: stopped/unmerged audit groups touching May/June lines (focus 2) ==='
-- Groups the remediation program stopped on, whose items are referenced by
-- May/June count lines. These are the "held/remainder groups affecting those
-- sessions". Expected: few or none; each needs individual review, not action.
SELECT a.source_external_id AS group_code, a.result, a.failure_reason,
       a.canonical_item_id,
       COUNT(DISTINCT l.id) AS mayjune_lines_touching
FROM inventory_item_remediation_audit a
JOIN inventory_count_lines l
  ON l.inventory_item_id = a.canonical_item_id
  OR l.inventory_item_id = ANY (a.superseded_item_ids)
JOIN inventory_counts c ON c.id = l.inventory_count_id
WHERE a.result <> 'applied'
  AND c.source_system = 'ORDERLY'
  AND (c.source_inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
       OR c.source_filename ILIKE '%may%2026%' OR c.source_filename ILIKE '%jun%2026%')
GROUP BY a.source_external_id, a.result, a.failure_reason, a.canonical_item_id
ORDER BY mayjune_lines_touching DESC;

\echo ''
\echo '=== Section E: potential residual duplicate identities among May/June items ==='
-- Conservative flag list: ACTIVE items referenced by May/June lines sharing an
-- identical normalized name. Same-name rows are REVIEW CANDIDATES only — many
-- are legitimately distinct products. Expected: small list for eyeballing.
WITH mayjune_items AS (
  SELECT DISTINCT l.inventory_item_id
  FROM inventory_count_lines l
  JOIN inventory_counts c ON c.id = l.inventory_count_id
  WHERE c.source_system = 'ORDERLY'
    AND (c.source_inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
         OR c.source_filename ILIKE '%may%2026%' OR c.source_filename ILIKE '%jun%2026%')
)
SELECT LOWER(TRIM(i.name)) AS normalized_name,
       COUNT(*) AS active_items,
       ARRAY_AGG(i.id ORDER BY i.id) AS item_ids
FROM inventory_items i
JOIN mayjune_items m ON m.inventory_item_id = i.id
WHERE i.active = 1
GROUP BY LOWER(TRIM(i.name))
HAVING COUNT(*) > 1
ORDER BY active_items DESC, normalized_name;

\echo ''
\echo '=== Section F: old-only resolutions — unmapped-item lines (focus 3) ==='
-- The legacy matcher resolved ~421 more pairs than the current model would.
-- Lines whose item carries NO Orderly external mapping approximate that
-- old-only (name-matched, blank-code) population. This is a REVIEW LIST for
-- "demonstrably wrong" checks only — being resolved differently today is NOT
-- an error by itself (PM directive).
SELECT c.source_inventory_date, COUNT(*) AS unmapped_item_lines,
       ROUND(SUM(l.qty * l.unit_cost)::numeric, 2) AS unmapped_lines_value
FROM inventory_count_lines l
JOIN inventory_counts c ON c.id = l.inventory_count_id
WHERE c.source_system = 'ORDERLY'
  AND (c.source_inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
       OR c.source_filename ILIKE '%may%2026%' OR c.source_filename ILIKE '%jun%2026%')
  AND NOT EXISTS (
    SELECT 1 FROM inventory_item_external_mappings m
    WHERE m.inventory_item_id = l.inventory_item_id
      AND m.source_system = 'ORDERLY')
GROUP BY c.source_inventory_date
ORDER BY c.source_inventory_date;

\echo ''
\echo '=== Section F2: sample of unmapped-item lines (largest values first, cap 40) ==='
SELECT c.source_inventory_date, i.name,
       ROUND((l.qty * l.unit_cost)::numeric, 2) AS line_value
FROM inventory_count_lines l
JOIN inventory_counts c ON c.id = l.inventory_count_id
JOIN inventory_items i ON i.id = l.inventory_item_id
WHERE c.source_system = 'ORDERLY'
  AND (c.source_inventory_date IN ('2026-05-31','2026-06-01','2026-06-30','2026-07-01')
       OR c.source_filename ILIKE '%may%2026%' OR c.source_filename ILIKE '%jun%2026%')
  AND NOT EXISTS (
    SELECT 1 FROM inventory_item_external_mappings m
    WHERE m.inventory_item_id = l.inventory_item_id
      AND m.source_system = 'ORDERLY')
ORDER BY (l.qty * l.unit_cost) DESC NULLS LAST
LIMIT 40;
