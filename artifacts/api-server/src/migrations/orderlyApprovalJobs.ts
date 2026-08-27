import { sql } from 'drizzle-orm';
import type { db as Database } from '../db';

/** Creates the durable, one-job-per-batch Orderly approval status store. */
export async function ensureOrderlyApprovalJobsSchema(
  runner: typeof Database,
  schemaName = 'public',
): Promise<void> {
  const batches = sql.raw(`"${schemaName}"."inventory_import_batches"`);
  const jobs = sql.raw(`"${schemaName}"."orderly_import_approval_jobs"`);
  await runner.transaction(async (tx: any) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext('fnb_orderly_approval_jobs_schema'))
    `);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS ${jobs} (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        batch_id VARCHAR NOT NULL REFERENCES ${batches}(id) ON DELETE CASCADE,
        company_id VARCHAR NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        phase TEXT NOT NULL DEFAULT 'queued',
        progress_percent INTEGER NOT NULL DEFAULT 5,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        force_duplicate_date INTEGER NOT NULL DEFAULT 0,
        started_by VARCHAR,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        timeout_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP,
        result JSONB,
        error_code TEXT,
        error_message TEXT,
        CONSTRAINT orderly_import_approval_jobs_batch_unique UNIQUE (batch_id)
      )
    `);
    await tx.execute(sql`
      ALTER TABLE ${jobs}
        ADD COLUMN IF NOT EXISTS force_duplicate_date INTEGER NOT NULL DEFAULT 0
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS orderly_import_approval_jobs_batch_company_idx
        ON ${jobs}(batch_id, company_id)
    `);
  });
}