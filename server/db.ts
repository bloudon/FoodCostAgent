import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isLocalDb = process.env.STORAGE_MODE === 'local' || process.env.AUTH_MODE === 'local';

let pool: any;
let db: any;
// eslint-disable-next-line prefer-const
export let _startupKeepalive: ReturnType<typeof setInterval> | undefined;

if (isLocalDb) {
  const pgModule = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const PgPool = pgModule.default.Pool;
  pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: false,
  });
  pool.on('error', (err: any) => {
    console.error('[DB] Pool error (local):', err.message);
  });
  db = drizzle({ client: pool, schema });
  console.log('[DB] Using standard PostgreSQL driver (local/VPS mode)');
  // Keep the event loop alive while all the memoised `await init_*()` calls in the
  // ESM module body resolve as pure microtasks.  Without this, Node exits with
  // code 13 ("Unfinished Top-Level Await") because the macrotask queue is empty
  // even though the TLA chain is still running.  The interval is cleared at the
  // very start of the startup IIFE in server/index.ts once real I/O (DB socket)
  // takes over keeping the event loop alive.
  _startupKeepalive = setInterval(() => {/* noop – event-loop sentinel */}, 1_000_000);
} else {
  const { Pool: NeonPool, neonConfig } = await import('@neondatabase/serverless');
  const ws = (await import('ws')).default;
  const { drizzle } = await import('drizzle-orm/neon-serverless');
  neonConfig.webSocketConstructor = ws;
  pool = new NeonPool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err: any) => {
    // Neon compute suspensions send FATAL 57P01 — log and continue, don't crash
    console.error('[DB] Pool error (Neon):', err.message, `(code: ${err.code})`);
  });
  db = drizzle({ client: pool, schema });
  console.log('[DB] Using Neon serverless PostgreSQL driver');
}

export { pool, db };
