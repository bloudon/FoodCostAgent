import { sql } from 'drizzle-orm';
import type { db as Database } from '../db';

/**
 * Creates the durable review-draft store for pending Orderly imports.
 *
 * This is intentionally separate from immutable import rows and catalog
 * writes: reviewers may save and revise a decision many times before the
 * single approval transaction consumes it.
 */
export async function ensureOrderlyReviewDecisionsSchema(
  runner: typeof Database,
  schemaName = 'public',
): Promise<void> {
  const batches = sql.raw(`"${schemaName}"."inventory_import_batches"`);
  const decisions = sql.raw(`"${schemaName}"."orderly_import_review_decisions"`);
  await runner.transaction(async (tx: any) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext('fnb_orderly_review_decisions_schema'))
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS ${decisions} (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id VARCHAR NOT NULL REFERENCES ${batches}(id) ON DELETE CASCADE,
        company_id VARCHAR NOT NULL,
        row_index INTEGER NOT NULL,
        decision JSONB NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_by VARCHAR,
        updated_by VARCHAR,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT orderly_import_review_decisions_batch_row_unique UNIQUE (batch_id, row_index)
      )
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS orderly_import_review_decisions_batch_company_idx
        ON ${decisions}(batch_id, company_id)
    `);
  });
}