/**
 * Fail-closed database-identity guard for benchmark tooling.
 *
 * The benchmark scripts seed, APPLY-mutate, and delete synthetic tenants. They
 * must be impossible to point at the production database by accident, and
 * `NODE_ENV` alone is NOT a database identity (reviewer finding). So:
 *
 *  1. Explicit per-run opt-in: `REMEDIATION_BENCH_ALLOW_DB_HOST` must be set
 *     and exactly equal the hostname of `DATABASE_URL`. This pins the run to
 *     one named database endpoint (for Neon the host embeds the endpoint id),
 *     so a production-shaped URL is refused unless an operator deliberately
 *     names that exact host — there is no wildcard and no hostname allowlist.
 *  2. `NODE_ENV=production` is refused outright, opt-in or not.
 *  3. If `PRODUCTION_DATABASE_URL` is present in the environment, its host is
 *     positively rejected even when named by the opt-in.
 *
 * Call this BEFORE importing anything that opens a database connection.
 */
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
  const optIn = process.env.REMEDIATION_BENCH_ALLOW_DB_HOST;
  if (!optIn || optIn !== host) {
    throw new Error(
      `[${scriptName}] refusing: set REMEDIATION_BENCH_ALLOW_DB_HOST to the exact ` +
        `database host to opt this run in (connected host: ${host || '(none)'}). ` +
        `This script mutates data and must never run against production.`,
    );
  }
  const prodUrl = process.env.PRODUCTION_DATABASE_URL;
  if (prodUrl) {
    try {
      if (new URL(prodUrl).hostname === host) {
        throw new Error(`[${scriptName}] refusing: DATABASE_URL host matches PRODUCTION_DATABASE_URL`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('refusing')) throw err;
      // Unparseable PRODUCTION_DATABASE_URL: ignore — the opt-in already gates.
    }
  }
}
