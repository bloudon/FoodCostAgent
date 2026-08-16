import { sql } from 'drizzle-orm';
import type { db as Database } from '../db';

/**
 * Minimal integrity-preserving relationship for historical import rows that
 * cannot safely resolve to an inventory item. The import row remains the
 * authoritative source of evidence; the hash detects any later drift.
 */
export async function ensureHistoricalSessionUnresolvedRowsSchema(
  runner: typeof Database,
  schemaName = 'public',
): Promise<void> {
  const qualify = (table: string) => sql.raw(`"${schemaName}"."${table}"`);
  const counts = qualify('inventory_counts');
  const links = qualify('historical_session_unresolved_rows');

  await runner.execute(sql`
    ALTER TABLE ${counts}
      ADD COLUMN IF NOT EXISTS is_historical_import INTEGER NOT NULL DEFAULT 0
  `);

  await runner.execute(sql`
    CREATE TABLE IF NOT EXISTS ${links} (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id VARCHAR NOT NULL REFERENCES ${counts}(id) ON DELETE RESTRICT,
      import_row_id VARCHAR NOT NULL REFERENCES ${qualify('inventory_import_rows')}(id) ON DELETE RESTRICT,
      source_evidence_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(session_id, import_row_id)
    )
  `);

  await runner.execute(sql`
    CREATE INDEX IF NOT EXISTS historical_session_unresolved_rows_session_idx
      ON ${links}(session_id);
    CREATE INDEX IF NOT EXISTS historical_session_unresolved_rows_import_row_idx
      ON ${links}(import_row_id);
    CREATE INDEX IF NOT EXISTS inventory_counts_historical_import_idx
      ON ${counts}(company_id, is_historical_import);
  `);
}