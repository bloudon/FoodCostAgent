import { sql } from 'drizzle-orm';
import type { db as Database } from '../db';

/** Creates the immutable, effective-dated approved supplier-pack decision store. */
export async function ensureInventoryItemPackTransitionsSchema(
  runner: typeof Database,
): Promise<void> {
  await runner.transaction(async (tx: any) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext('fnb_inventory_item_pack_transitions_schema'))
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory_item_pack_transitions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id VARCHAR NOT NULL,
        inventory_item_id VARCHAR NOT NULL,
        from_vendor_item_id VARCHAR NOT NULL,
        to_vendor_item_id VARCHAR NOT NULL,
        effective_date TEXT NOT NULL,
        evidence_note TEXT NOT NULL,
        approved_by VARCHAR NOT NULL,
        from_pack_snapshot JSONB NOT NULL,
        to_pack_snapshot JSONB NOT NULL,
        counting_standard_confirmed INTEGER NOT NULL DEFAULT 0,
        operational_pack_snapshot JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT inventory_item_pack_transitions_unique
          UNIQUE (company_id, inventory_item_id, from_vendor_item_id, to_vendor_item_id, effective_date),
        CONSTRAINT inventory_item_pack_transitions_from_to_distinct_check
          CHECK (from_vendor_item_id <> to_vendor_item_id)
      )
    `);
    await tx.execute(sql`
      ALTER TABLE inventory_item_pack_transitions
        ADD COLUMN IF NOT EXISTS counting_standard_confirmed INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS operational_pack_snapshot JSONB
    `);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_pack_transitions_one_date_idx
        ON inventory_item_pack_transitions(company_id, inventory_item_id, effective_date)
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS inventory_item_pack_transitions_company_item_effective_date_idx
        ON inventory_item_pack_transitions(company_id, inventory_item_id, effective_date)
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory_item_pack_transition_corrections (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        original_transition_id VARCHAR NOT NULL REFERENCES inventory_item_pack_transitions(id),
        supersedes_correction_id VARCHAR REFERENCES inventory_item_pack_transition_corrections(id),
        company_id VARCHAR NOT NULL,
        inventory_item_id VARCHAR NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('correct', 'void')),
        effective_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        from_vendor_item_id VARCHAR,
        to_vendor_item_id VARCHAR,
        from_pack_snapshot JSONB,
        to_pack_snapshot JSONB,
        decided_by VARCHAR NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT pack_correction_payload_check CHECK (
          (decision = 'void' AND from_vendor_item_id IS NULL AND to_vendor_item_id IS NULL
            AND from_pack_snapshot IS NULL AND to_pack_snapshot IS NULL)
          OR (decision = 'correct' AND from_vendor_item_id IS NOT NULL AND to_vendor_item_id IS NOT NULL
            AND from_vendor_item_id <> to_vendor_item_id
            AND from_pack_snapshot IS NOT NULL AND to_pack_snapshot IS NOT NULL)
        )
      )
    `);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS pack_corrections_first_decision_idx
        ON inventory_item_pack_transition_corrections(original_transition_id)
        WHERE supersedes_correction_id IS NULL
    `);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS pack_corrections_superseded_idx
        ON inventory_item_pack_transition_corrections(supersedes_correction_id)
        WHERE supersedes_correction_id IS NOT NULL
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS pack_transition_corrections_original_idx
        ON inventory_item_pack_transition_corrections(original_transition_id)
    `);
    await tx.execute(sql`
      CREATE OR REPLACE FUNCTION reject_pack_transition_correction_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Supplier pack corrections are append-only';
      END;
      $$
    `);
    await tx.execute(sql`
      DROP TRIGGER IF EXISTS pack_transition_corrections_immutable ON inventory_item_pack_transition_corrections
    `);
    await tx.execute(sql`
      CREATE TRIGGER pack_transition_corrections_immutable
      BEFORE UPDATE OR DELETE ON inventory_item_pack_transition_corrections
      FOR EACH ROW EXECUTE FUNCTION reject_pack_transition_correction_mutation()
    `);
    await tx.execute(sql`
      DROP TRIGGER IF EXISTS pack_transitions_immutable ON inventory_item_pack_transitions
    `);
    await tx.execute(sql`
      CREATE TRIGGER pack_transitions_immutable
      BEFORE UPDATE OR DELETE ON inventory_item_pack_transitions
      FOR EACH ROW EXECUTE FUNCTION reject_pack_transition_correction_mutation()
    `);
  });
}