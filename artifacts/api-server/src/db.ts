// IMPORTANT: Keep ALL imports here as static `import` statements — never use
// `await import(...)` at module scope in this file or any file it re-exports.
//
// Why: esbuild propagates top-level await (TLA) to every module that imports a
// file containing one.  When server/db.ts previously used `await import('pg')`,
// it produced 36 cascading TLA lines in dist/index.js.  On the VPS, Node.js
// exits with code 13 (ESM TLA stall) when any of those awaits do not resolve
// before the process is torn down, causing a crash-loop at startup.
//
// The only legitimate TLA in the bundle is the `await (async () => { ... })()`
// IIFE in server/index.ts that keeps the event loop alive.  Everything else
// must be a static import or moved inside an async function body.
// See: scripts/check-bundle-tla.js — run after build to enforce this invariant.
import * as schema from "@workspace/db";
import pg from "pg";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isLocalDb = process.env.STORAGE_MODE === 'local' || process.env.AUTH_MODE === 'local';

/**
 * Which driver this process selected. Exported for diagnostics only.
 *
 * The selection is environment-driven, so a process that loads a different
 * environment than the API (for example a standalone CLI that forgot
 * `dotenv/config`) silently picks the OTHER driver and fails on its first
 * query against a database the API talks to happily. Surfacing the mode makes
 * that class of mismatch visible instead of appearing as an opaque query error.
 */
export const dbDriverMode: 'node-postgres' | 'neon-serverless' = isLocalDb
  ? 'node-postgres'
  : 'neon-serverless';

/**
 * Connection target with all credentials stripped. Never returns the user,
 * the password, or the raw DATABASE_URL.
 */
export function describeDatabaseTarget(): {
  driver: string;
  host: string;
  port: string;
  database: string;
  sslmode: string;
} {
  const fallback = {
    driver: dbDriverMode,
    host: '(unparseable)',
    port: '(unparseable)',
    database: '(unparseable)',
    sslmode: '(unset)',
  };
  const raw = process.env.DATABASE_URL;
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    return {
      driver: dbDriverMode,
      host: url.hostname || '(none)',
      port: url.port || '5432',
      database: url.pathname.replace(/^\//, '') || '(none)',
      sslmode: url.searchParams.get('sslmode') ?? '(unset)',
    };
  } catch {
    return fallback;
  }
}

let pool: any;
let db: any;

if (isLocalDb) {
  const PgPool = pg.Pool;
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
  db = drizzleNodePg({ client: pool, schema });
  console.log('[DB] Using standard PostgreSQL driver (local/VPS mode)');
} else {
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
  db = drizzleNeon({ client: pool, schema });
  console.log('[DB] Using Neon serverless PostgreSQL driver');
}

export { pool, db };
