-- =============================================================================
-- cleanup-calorie-annotations.sql
-- Run with: psql "$DATABASE_URL" -f scripts/cleanup-calorie-annotations.sql
--
-- One-time (but idempotent) cleanup for menu_items rows whose name field
-- contains a calorie annotation that was baked in before the menuScanner fix.
--
-- What it does:
--   1. Finds rows where name still contains a calorie annotation pattern,
--      e.g. "Grilled Salmon (560 cal)" or "BBQ Ribs (570-680 calories)"
--   2. Extracts the leading integer from the annotation and writes it to
--      calorie_count — only when calorie_count is currently NULL (never
--      overwrites an operator-entered value).
--   3. Strips the annotation from name and trims trailing/leading whitespace.
--
-- Pattern examples matched (case-insensitive):
--   "(560 cal)"  "(570-680 cal)"  "(315 calories)"  "(160 Cal.)"  "(570 CAL)"
--
-- Safe to re-run: the WHERE clause only selects rows that still contain the
-- pattern, so a second run is always a no-op.
-- =============================================================================

DO $$
DECLARE
  rows_updated integer;
BEGIN
  UPDATE menu_items
  SET
    -- Preserve any operator-entered calorie_count; only fill when NULL
    calorie_count = COALESCE(
      calorie_count,
      (regexp_match(name, '\((\d+)[\d\s\-–]*\s*[Cc][Aa][Ll][a-zA-Z.]*\)'))[1]::integer
    ),
    -- Remove the annotation and clean up any extra whitespace
    name = trim(regexp_replace(name, '\s*\(\d[\d\s\-–]*\s*cal[a-z.]*\)\s*', '', 'gi'))
  WHERE name ~* '\(\d[\d\s\-–]*\s*cal[a-z.]*\)';

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE 'cleanup-calorie-annotations: % row(s) updated', rows_updated;
END $$;
