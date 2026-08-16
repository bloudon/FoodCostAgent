/**
 * Fail-closed database-identity guard for benchmark tooling.
 *
 * The benchmark scripts seed, APPLY-mutate, and delete synthetic tenants. They
 * must be impossible to point at the production database by accident, and
 * `NODE_ENV` alone is NOT a database identity (reviewer finding). Layers, all
 * mandatory, checked BEFORE anything opens a database connection:
 *
 *  1. `NODE_ENV=production` is refused outright, opt-in or not.
 *  2. Code-owned production identity: the FnB Cost Pro production database is
 *     the VPS-local PostgreSQL instance (see the Bay Hill production runbook),
 *     so loopback hosts are rejected unconditionally. This cannot be
 *     overridden by any environment variable.
 *  3. Declared production identity is REQUIRED: `PRODUCTION_DATABASE_URL` or
 *     `REMEDIATION_PRODUCTION_DB_HOST` must be present; if neither is
 *     available the guard refuses (missing configuration is never permission).
 *     The declared production host is rejected regardless of opt-in.
 *  4. Explicit per-run opt-in: `REMEDIATION_BENCH_ALLOW_DB_HOST` must be set
 *     and exactly equal the hostname of `DATABASE_URL`. This pins the run to
 *     one named endpoint (for Neon the host embeds the endpoint id) — no
 *     wildcard, no hostname-pattern allowlist.
 */

/** Hosts of the documented production database endpoint. Code-owned; not configurable. */
const PRODUCTION_DB_HOSTS = ['127.0.0.1', 'localhost', '::1'];

export function assertBenchDatabaseAllowed(scriptName: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`[${scriptName}] refusing to run with NODE_ENV=production`);
  }
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (!dbUrl) throw new Error(`[${scriptName}] DATABASE_URL is not set`);
  let host: string;
  try {
    host = new URL(dbUrl).hostname;
  } catch {
    throw new Error(`[${scriptName}] DATABASE_URL is not a parseable URL; refusing`);
  }

  if (PRODUCTION_DB_HOSTS.includes(host)) {
    throw new Error(
      `[${scriptName}] refusing: DATABASE_URL targets ${host}, the documented production ` +
        `database endpoint (VPS-local PostgreSQL). This rejection is code-owned and cannot be opted around.`,
    );
  }

  let declaredProdHost = process.env.REMEDIATION_PRODUCTION_DB_HOST?.trim() || undefined;
  if (!declaredProdHost && process.env.PRODUCTION_DATABASE_URL) {
    try {
      declaredProdHost = new URL(process.env.PRODUCTION_DATABASE_URL).hostname;
    } catch {
      throw new Error(`[${scriptName}] PRODUCTION_DATABASE_URL is set but unparseable; refusing`);
    }
  }
  if (!declaredProdHost) {
    throw new Error(
      `[${scriptName}] refusing: production database identity unavailable. Set ` +
        `REMEDIATION_PRODUCTION_DB_HOST (host only, no credentials) or PRODUCTION_DATABASE_URL ` +
        `so this run can prove it is NOT targeting production. Missing configuration is not permission.`,
    );
  }
  if (declaredProdHost === host) {
    throw new Error(
      `[${scriptName}] refusing: DATABASE_URL host matches the declared production host (${host})`,
    );
  }

  const optIn = process.env.REMEDIATION_BENCH_ALLOW_DB_HOST;
  if (!optIn || optIn !== host) {
    throw new Error(
      `[${scriptName}] refusing: set REMEDIATION_BENCH_ALLOW_DB_HOST to the exact ` +
        `database host to opt this run in (connected host: ${host}). ` +
        `This script mutates data and must never run against production.`,
    );
  }
}
