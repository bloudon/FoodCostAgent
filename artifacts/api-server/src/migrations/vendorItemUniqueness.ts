/**
 * Vendor-item uniqueness invariant (PM-approved after the Gate 2 duplicate
 * cleanup; exact index text taken from that task's approved report).
 *
 * The defect this prevents: vendor_items had only a primary key, so four
 * independent insert paths could (and did) create thousands of duplicate
 * (vendor, inventory item, SKU) rows — the Orderly importer's
 * onConflictDoNothing() was a silent no-op without any constraint to
 * conflict with.
 *
 * Scope, per PM:
 *  - Partial unique index on (vendor_id, inventory_item_id, vendor_sku)
 *    WHERE vendor_sku is non-null and non-blank.
 *  - NULL/blank-SKU rows deliberately remain UNCONSTRAINED. Their disposition
 *    (Class C) was held, and this migration must not broaden that decision.
 *
 * Fail closed: before creating the index we verify the live data satisfies
 * it. If violating rows exist (e.g. this schema is applied to a database that
 * never ran the Gate 2 cleanup), startup aborts with the violating keys
 * rather than letting CREATE INDEX fail half-way or, worse, being skipped.
 */
import { sql } from 'drizzle-orm';
import type { db as Database } from '../db';

export const VENDOR_ITEM_UNIQUE_INDEX_NAME = 'vendor_items_vendor_item_sku_uniq';

function rowsOf(r: any): any[] {
  return Array.isArray(r) ? r : r.rows;
}

export async function ensureVendorItemUniquenessSchema(
  runner: typeof Database,
  schemaName = 'public',
): Promise<void> {
  const table = sql.raw(`"${schemaName}"."vendor_items"`);

  // Skip the (comparatively expensive) verification scan when the index
  // already exists — the constraint itself is then the guarantee.
  const existing = rowsOf(
    await runner.execute(sql`
      SELECT 1 FROM pg_indexes
      WHERE schemaname = ${schemaName} AND indexname = ${VENDOR_ITEM_UNIQUE_INDEX_NAME}`),
  );
  if (existing.length > 0) return;

  const violations = rowsOf(
    await runner.execute(sql`
      SELECT vendor_id, inventory_item_id, vendor_sku, count(*)::int AS n
      FROM ${table}
      WHERE vendor_sku IS NOT NULL AND btrim(vendor_sku) <> ''
      GROUP BY vendor_id, inventory_item_id, vendor_sku
      HAVING count(*) > 1
      LIMIT 20`),
  );
  if (violations.length > 0) {
    throw new Error(
      `Cannot create ${VENDOR_ITEM_UNIQUE_INDEX_NAME}: live data violates the invariant. ` +
        `Run the Gate 2 duplicate cleanup first. Sample violating keys: ${JSON.stringify(violations)}`,
    );
  }

  // PM-approved constraint text. (CONCURRENTLY is not usable inside the
  // startup path: Neon serverless runs this through a pooled connection and
  // CONCURRENTLY cannot run in any transaction context; the verified-empty
  // violation set keeps the lock window trivial.)
  await runner.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${VENDOR_ITEM_UNIQUE_INDEX_NAME}
      ON "${schemaName}"."vendor_items" (vendor_id, inventory_item_id, vendor_sku)
      WHERE vendor_sku IS NOT NULL AND btrim(vendor_sku) <> ''`));
}
