import { sql } from 'drizzle-orm';
import type { db as Database } from '../db';

/**
 * Gives every catalog item an FnB-owned, globally unique number. It is
 * intentionally independent of PLUs, vendor SKUs, and import-source codes.
 */
export async function ensureInventoryItemNumberSchema(
  runner: typeof Database,
  schemaName = 'public',
): Promise<void> {
  const items = sql.raw(`"${schemaName}"."inventory_items"`);
  const sequenceName = `"${schemaName}"."inventory_items_internal_number_seq"`;
  const sequenceRegclass = `'${schemaName}.inventory_items_internal_number_seq'::regclass`;

  await runner.transaction(async (tx: any) => {
    // Serialize schema reconciliation across independently deployed API nodes
    // and block catalog inserts while setval/backfill are in progress. Without
    // this table lock, a rolling node could issue nextval between the sequence
    // read and setval, allowing a number to be reissued.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fnb_inventory_item_number_schema'))`);
    await tx.execute(sql.raw(`
      CREATE SEQUENCE IF NOT EXISTS ${sequenceName};
      ALTER TABLE "${schemaName}"."inventory_items"
        ADD COLUMN IF NOT EXISTS internal_item_number INTEGER;
      ALTER TABLE "${schemaName}"."inventory_items"
        ALTER COLUMN internal_item_number
        SET DEFAULT nextval(${sequenceRegclass});
    `));
    await tx.execute(sql.raw(
      `LOCK TABLE "${schemaName}"."inventory_items" IN ACCESS EXCLUSIVE MODE;`,
    ));

    await tx.execute(sql.raw(`
      SELECT setval(
        ${sequenceRegclass},
        GREATEST(
          (SELECT last_value FROM ${sequenceName}),
          COALESCE((SELECT MAX(internal_item_number) FROM "${schemaName}"."inventory_items"), 0),
          1
        ),
        true
      );
      UPDATE "${schemaName}"."inventory_items"
        SET internal_item_number = nextval(${sequenceRegclass})
        WHERE internal_item_number IS NULL;
      ALTER TABLE "${schemaName}"."inventory_items"
        ALTER COLUMN internal_item_number SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_internal_number_uniq
        ON "${schemaName}"."inventory_items"(internal_item_number);
    `));
  });
}