import 'dotenv/config';
import pg from 'pg';

type IndexSpec = {
  name: string;
  createSql: string;
  expectedKeyColumns: string[];
};

const INDEXES: IndexSpec[] = [
  {
    name: 'inv_import_batches_orderly_history_idx',
    createSql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS inv_import_batches_orderly_history_idx
        ON inventory_import_batches (
          company_id,
          source_system,
          source_property_id,
          status,
          inventory_date DESC,
          uploaded_at DESC,
          id DESC
        )
    `,
    expectedKeyColumns: [
      'company_id',
      'source_system',
      'source_property_id',
      'status',
      'inventory_date desc',
      'uploaded_at desc',
      'id desc',
    ],
  },
  {
    name: 'inv_import_rows_batch_code_idx',
    createSql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS inv_import_rows_batch_code_idx
        ON inventory_import_rows (batch_id, source_item_code)
    `,
    expectedKeyColumns: [
      'batch_id',
      'source_item_code',
    ],
  },
];

async function readIndex(
  client: pg.Client,
  name: string,
): Promise<{ valid: boolean; definition: string; keyColumns: string[] } | null> {
  const result = await client.query<{
    valid: boolean;
    definition: string;
    keyColumns: string[];
  }>(`
    SELECT
      i.indisvalid AS valid,
      pg_get_indexdef(c.oid) AS definition,
      ARRAY(
        SELECT
          pg_get_indexdef(c.oid, key_position, true) ||
          CASE
            WHEN (i.indoption[key_position - 1] & 1) = 1 THEN ' DESC'
            ELSE ''
          END
        FROM generate_series(1, i.indnkeyatts) AS key_position
        ORDER BY key_position
      ) AS "keyColumns"
    FROM pg_class c
    INNER JOIN pg_index i ON i.indexrelid = c.oid
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname = $1
  `, [name]);
  return result.rows[0] ?? null;
}

function assertExpectedIndex(
  spec: IndexSpec,
  state: { valid: boolean; definition: string; keyColumns: string[] } | null,
): asserts state is { valid: true; definition: string; keyColumns: string[] } {
  if (!state) {
    throw new Error(`Index ${spec.name} was not found after creation.`);
  }
  if (!state.valid) {
    throw new Error(
      `Index ${spec.name} exists but is invalid. Drop it with DROP INDEX CONCURRENTLY before retrying.`,
    );
  }
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const actualKeys = state.keyColumns.map(normalize);
  const expectedKeys = spec.expectedKeyColumns.map(normalize);
  if (actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(
      `Index ${spec.name} has unexpected ordered keys. ` +
      `Expected [${expectedKeys.join(', ')}], received [${actualKeys.join(', ')}]. ` +
      'Drop it with DROP INDEX CONCURRENTLY and rerun this command.',
    );
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }

  const client = new pg.Client({ connectionString });
  let lockAcquired = false;
  await client.connect();
  try {
    // CONCURRENTLY cannot run inside a transaction. A dedicated session gives
    // us bounded lock waits and a non-blocking single-operator guard.
    await client.query(`SET lock_timeout = '5s'`);
    await client.query(`SET statement_timeout = '30min'`);
    const lock = await client.query<{ acquired: boolean }>(`
      SELECT pg_try_advisory_lock(hashtext('fnb_orderly_preview_performance_indexes')) AS acquired
    `);
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error('Another Orderly preview index operation is already running.');
    }

    const database = await client.query<{ database: string }>(
      'SELECT current_database() AS database',
    );
    const verified: Array<{ name: string; definition: string }> = [];
    for (const spec of INDEXES) {
      const before = await readIndex(client, spec.name);
      if (before && !before.valid) {
        assertExpectedIndex(spec, before);
      }
      if (!before) {
        await client.query(spec.createSql);
      }
      const after = await readIndex(client, spec.name);
      assertExpectedIndex(spec, after);
      verified.push({ name: spec.name, definition: after.definition });
    }

    console.log(JSON.stringify({
      status: 'ok',
      database: database.rows[0]?.database ?? null,
      indexes: verified,
    }, null, 2));
  } finally {
    if (lockAcquired) {
      await client.query(
        `SELECT pg_advisory_unlock(hashtext('fnb_orderly_preview_performance_indexes'))`,
      ).catch(() => undefined);
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});