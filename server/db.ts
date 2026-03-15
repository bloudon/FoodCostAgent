import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isLocalDb = process.env.STORAGE_MODE === 'local' || process.env.AUTH_MODE === 'local';

let pool: any;
let db: any;

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
