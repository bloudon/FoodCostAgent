import { sql } from 'drizzle-orm';
import type { db as Database } from '../db';

/**
 * Orderly provenance mappings are one row per packSize.id, while vendor_items
 * intentionally permits only one (vendor, inventory item, SKU) relationship.
 * Preserve the source code and normalized pack facts on the provenance row so
 * reused source codes with conflicting pack identities remain detectable.
 */
export async function ensureOrderlyPackIdentityEvidenceSchema(
  runner: typeof Database,
  schemaName = 'public',
): Promise<void> {
  const mappings = sql.raw(`"${schemaName}"."vendor_item_external_mappings"`);
  const itemMappings = sql.raw(`"${schemaName}"."inventory_item_external_mappings"`);
  await runner.transaction(async (tx: any) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext('fnb_orderly_pack_identity_evidence_schema'))
    `);
    await tx.execute(sql`
      ALTER TABLE ${mappings}
        ADD COLUMN IF NOT EXISTS source_item_code TEXT,
        ADD COLUMN IF NOT EXISTS case_quantity REAL,
        ADD COLUMN IF NOT EXISTS inner_pack_quantity REAL,
        ADD COLUMN IF NOT EXISTS base_unit_quantity REAL,
        ADD COLUMN IF NOT EXISTS base_unit TEXT
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS vendor_item_external_mappings_orderly_code_idx
        ON ${mappings}(company_id, source_system, source_property_id, source_item_code)
    `);
    await tx.execute(sql`
      ALTER TABLE ${itemMappings}
        ADD COLUMN IF NOT EXISTS pack_size_raw TEXT
    `);
  });
}