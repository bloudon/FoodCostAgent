import { sql } from 'drizzle-orm';
import type { db as Database } from '../db';

/** Additive only: older count lines intentionally have no physical-pack snapshot. */
export async function ensureCountPackSnapshotSchema(runner: typeof Database): Promise<void> {
  await runner.execute(sql`
    ALTER TABLE inventory_count_lines
      ADD COLUMN IF NOT EXISTS count_pack_snapshot JSONB
  `);
}