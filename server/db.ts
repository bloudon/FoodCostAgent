import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isLocalDb = process.env.STORAGE_MODE === 'local' || process.env.AUTH_MODE === 'local';

let pool: any;
let db: any;
// Held until the startup IIFE fires so the socket is "in use" (not idle-pool).
// pg-pool unref()s idle connections' timers; a checked-out client is not unref'd,
// so the TCP socket keeps the event loop alive through the ESM TLA microtask chain.
export let _startupClient: any;

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

  // Check out a client and hold it (do NOT release yet).
  // pg-pool unref()'s idle connections' internal timers so Node can exit when
  // the pool is otherwise unused.  A *checked-out* client is never unref'd —
  // its TCP socket keeps the event loop alive through the entire ESM TLA
  // microtask chain until the startup IIFE fires and releases it.
  try {
    _startupClient = await pool.connect();
    console.log('[DB] Connection verified ✓');
  } catch (err: any) {
    // DB unreachable — log and continue; queries will surface the real error.
    console.error('[DB] Initial connection check failed:', err.message);
  }
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
