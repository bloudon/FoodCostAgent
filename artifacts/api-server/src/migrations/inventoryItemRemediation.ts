/**
 * Schema objects required by the Orderly duplicate-identity remediation
 * service (Task #1121).
 *
 * This lives in its own module, rather than as inline SQL in routes.ts, so it
 * can be executed against a clean database in a test. A migration that has only
 * ever run against the one database that already had the objects applied by
 * hand is not a migration — it is an assumption.
 *
 * Two objects are created:
 *
 *  - Supersession columns on inventory_items. Duplicates produced by the
 *    Orderly item-identity defect are deactivated and linked to the item that
 *    replaced them, never deleted, so the link has to be storable.
 *
 *  - inventory_item_remediation_audit. This is not merely a log: remediation
 *    reads its own applied rows back to recognize groups it has already
 *    repaired, which is what makes a rerun a no-op instead of a second merge.
 *    If this table is missing, a rerun would re-merge.
 *
 * Every statement is IF NOT EXISTS, so running it repeatedly is a no-op and it
 * is safe on a database where the objects were already applied manually.
 *
 * `schemaName` exists only so the test can build these objects in a scratch
 * schema; production always uses the default. It is never caller-controlled at
 * runtime, so interpolating it is not an injection surface.
 */
import { sql } from 'drizzle-orm';
import type { db as Database } from '../db';

export async function ensureInventoryItemRemediationSchema(
  runner: typeof Database,
  schemaName = 'public',
): Promise<void> {
  const qualify = (table: string) => sql.raw(`"${schemaName}"."${table}"`);
  const items = qualify('inventory_items');
  const audit = qualify('inventory_item_remediation_audit');

  await runner.execute(sql`
    ALTER TABLE ${items}
      ADD COLUMN IF NOT EXISTS superseded_by_item_id VARCHAR;
    ALTER TABLE ${items}
      ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
    ALTER TABLE ${items}
      ADD COLUMN IF NOT EXISTS superseded_reason TEXT;
  `);

  await runner.execute(sql`
    CREATE INDEX IF NOT EXISTS inventory_items_superseded_idx
      ON ${items}(superseded_by_item_id)
  `);

  await runner.execute(sql`
    CREATE TABLE IF NOT EXISTS ${audit} (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id VARCHAR NOT NULL,
      store_id VARCHAR,
      source_system TEXT NOT NULL,
      source_property_id TEXT NOT NULL,
      source_external_id TEXT NOT NULL,
      manifest_id TEXT NOT NULL,
      report_hash TEXT NOT NULL,
      report_version TEXT NOT NULL,
      canonical_item_id VARCHAR NOT NULL,
      canonical_selection_reason TEXT NOT NULL,
      superseded_item_ids TEXT[] NOT NULL,
      classification TEXT NOT NULL,
      result TEXT NOT NULL,
      failure_reason TEXT,
      references_moved JSONB NOT NULL,
      evidence JSONB NOT NULL,
      valuation_before REAL,
      valuation_after REAL,
      valuation_delta REAL,
      operator_id VARCHAR NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await runner.execute(sql`
    CREATE INDEX IF NOT EXISTS inv_item_remediation_audit_company_idx
      ON ${audit}(company_id, created_at);
    CREATE INDEX IF NOT EXISTS inv_item_remediation_audit_manifest_idx
      ON ${audit}(manifest_id);
    CREATE INDEX IF NOT EXISTS inv_item_remediation_audit_group_idx
      ON ${audit}(company_id, source_system, source_property_id, source_external_id);
  `);
}
