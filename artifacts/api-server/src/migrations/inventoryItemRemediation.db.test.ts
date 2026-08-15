/**
 * Validates the remediation migration against a CLEAN database.
 *
 * The point of this file is the gap the completion review found: the required
 * objects existed only because they had been applied by hand to the development
 * database. Running the migration against the same database that already has
 * them proves nothing — it would pass even if the migration were empty. So this
 * builds a scratch schema containing only a bare inventory_items table, runs the
 * migration into it, and asserts the objects the service depends on now exist
 * with the shape the Drizzle schema declares.
 *
 * It also runs the migration twice to prove it is idempotent, which is what
 * makes it safe on the database where the DDL was already applied manually.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { ensureInventoryItemRemediationSchema } from './inventoryItemRemediation';

const SKIP = !process.env.DATABASE_URL;
const SCHEMA = `remediation_migration_test_${Date.now().toString(36)}`;

beforeAll(async () => {
  if (SKIP) return;
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`));
  await db.execute(sql.raw(`CREATE SCHEMA "${SCHEMA}"`));
  // A bare inventory_items, as a fresh deployment would have it: no supersession
  // columns, no audit table.
  await db.execute(
    sql.raw(`
      CREATE TABLE "${SCHEMA}".inventory_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        name TEXT NOT NULL
      )
    `),
  );
});

afterAll(async () => {
  if (SKIP) return;
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`));
});

async function columnsOf(table: string): Promise<Record<string, string>> {
  const result = (await db.execute(
    sql.raw(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = '${table}'
    `),
  )) as unknown as { rows: Array<{ column_name: string; data_type: string }> };
  return Object.fromEntries(result.rows.map(row => [row.column_name, row.data_type]));
}

describe.skipIf(SKIP)('inventory item remediation migration (clean database)', () => {
  it('creates every object the remediation service depends on', async () => {
    const before = await columnsOf('inventory_items');
    expect(before.superseded_by_item_id).toBeUndefined();

    await ensureInventoryItemRemediationSchema(db, SCHEMA);

    const items = await columnsOf('inventory_items');
    expect(items.superseded_by_item_id).toBe('character varying');
    expect(items.superseded_at).toBe('timestamp with time zone');
    expect(items.superseded_reason).toBe('text');

    // The audit table is what makes reruns idempotent, so its absence would be
    // a correctness bug, not just a missing log.
    const audit = await columnsOf('inventory_item_remediation_audit');
    expect(Object.keys(audit).length).toBeGreaterThan(0);
    expect(audit.source_external_id).toBe('text');
    expect(audit.manifest_id).toBe('text');
    expect(audit.report_hash).toBe('text');
    expect(audit.result).toBe('text');
    expect(audit.canonical_item_id).toBe('character varying');
    expect(audit.superseded_item_ids).toBe('ARRAY');
    expect(audit.references_moved).toBe('jsonb');
    expect(audit.evidence).toBe('jsonb');
    expect(audit.operator_id).toBe('character varying');

    const indexes = (await db.execute(
      sql.raw(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${SCHEMA}'
      `),
    )) as unknown as { rows: Array<{ indexname: string }> };
    const names = indexes.rows.map(row => row.indexname);
    expect(names).toContain('inventory_items_superseded_idx');
    expect(names).toContain('inv_item_remediation_audit_group_idx');
  });

  it('is idempotent, so it is safe where the DDL was already applied by hand', async () => {
    await expect(ensureInventoryItemRemediationSchema(db, SCHEMA)).resolves.toBeUndefined();
    const audit = await columnsOf('inventory_item_remediation_audit');
    expect(audit.report_hash).toBe('text');
  });

  it('accepts the row shape the service actually writes', async () => {
    // Column-existence alone would not catch a NOT NULL the service never
    // populates, so write one row of each result kind.
    await db.execute(
      sql.raw(`
        INSERT INTO "${SCHEMA}".inventory_item_remediation_audit
          (company_id, store_id, source_system, source_property_id, source_external_id,
           manifest_id, report_hash, report_version, canonical_item_id,
           canonical_selection_reason, superseded_item_ids, classification, result,
           references_moved, evidence, valuation_before, valuation_after, valuation_delta,
           operator_id)
        VALUES
          ('co', 'store', 'ORDERLY', 'prop', 'code-1', 'manifest-1', 'hash', '1.0.0',
           'item-1', 'authoritative mapping', ARRAY['item-2','item-3'], 'SAFE_CANDIDATE',
           'applied', '{"inventoryCountLines":3}'::jsonb, '{"importBatchIds":[]}'::jsonb,
           10.5, 10.5, 0, 'operator-1')
      `),
    );
    // A stopped row carries no valuation and a failure reason instead.
    await db.execute(
      sql.raw(`
        INSERT INTO "${SCHEMA}".inventory_item_remediation_audit
          (company_id, source_system, source_property_id, source_external_id,
           manifest_id, report_hash, report_version, canonical_item_id,
           canonical_selection_reason, superseded_item_ids, classification, result,
           failure_reason, references_moved, evidence, operator_id)
        VALUES
          ('co', 'ORDERLY', 'prop', 'code-2', 'manifest-1', 'hash', '1.0.0',
           'item-9', 'tie', ARRAY[]::text[], 'SAFE_CANDIDATE', 'stopped',
           'UNIQUENESS_COLLISION: par level 10 vs 96', '{}'::jsonb, '{}'::jsonb, 'operator-1')
      `),
    );

    const rows = (await db.execute(
      sql.raw(`
        SELECT result, superseded_item_ids, failure_reason
        FROM "${SCHEMA}".inventory_item_remediation_audit ORDER BY source_external_id
      `),
    )) as unknown as {
      rows: Array<{ result: string; superseded_item_ids: string[]; failure_reason: string | null }>;
    };
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].result).toBe('applied');
    expect(rows.rows[0].superseded_item_ids).toEqual(['item-2', 'item-3']);
    expect(rows.rows[1].result).toBe('stopped');
    expect(rows.rows[1].failure_reason).toMatch(/par level/);
  });
});
