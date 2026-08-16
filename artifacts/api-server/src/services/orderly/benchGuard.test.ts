/**
 * Reviewer-mandated coverage: the benchmark tooling must refuse a
 * production-shaped Neon DATABASE_URL before importing anything that opens a
 * database connection, regardless of NODE_ENV. Spawns each script as a real
 * subprocess with test env vars stripped.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const API_SERVER_ROOT = path.resolve(__dirname, '../../..');
const PROD_SHAPED_URL =
  'postgresql://user:secret@ep-prod-shaped-12345.us-east-2.aws.neon.tech/neondb?sslmode=require';

function runScript(script: string, args: string[], env: Record<string, string | undefined>) {
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (['VITEST', 'NODE_ENV', 'DATABASE_URL', 'REMEDIATION_BENCH_ALLOW_DB_HOST', 'PRODUCTION_DATABASE_URL'].includes(k)) continue;
    cleanEnv[k] = v;
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) cleanEnv[k] = v;
  return spawnSync('pnpm', ['exec', 'tsx', script, ...args], {
    cwd: API_SERVER_ROOT,
    env: cleanEnv,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe.each([
  ['scripts/benchmarkRemediationApply.ts', ['--groups', '1']],
  ['scripts/benchCleanup.ts', ['bench-abc123']],
])('bench guard for %s', (script, args) => {
  it('refuses a production-shaped Neon URL without the exact-host opt-in, before any DB import', () => {
    const result = runScript(script, args, { DATABASE_URL: PROD_SHAPED_URL });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toMatch(/refusing/i);
    expect(output).toMatch(/REMEDIATION_BENCH_ALLOW_DB_HOST/);
    // Refusal happened before the DB module loaded (its driver banner never printed).
    expect(output).not.toContain('Using Neon serverless PostgreSQL driver');
  });

  it('refuses when the opted-in host matches PRODUCTION_DATABASE_URL', () => {
    const result = runScript(script, args, {
      DATABASE_URL: PROD_SHAPED_URL,
      REMEDIATION_BENCH_ALLOW_DB_HOST: 'ep-prod-shaped-12345.us-east-2.aws.neon.tech',
      PRODUCTION_DATABASE_URL: PROD_SHAPED_URL,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toMatch(/matches PRODUCTION_DATABASE_URL/);
    expect(output).not.toContain('Using Neon serverless PostgreSQL driver');
  });

  it('refuses NODE_ENV=production even with the exact-host opt-in', () => {
    const result = runScript(script, args, {
      NODE_ENV: 'production',
      DATABASE_URL: PROD_SHAPED_URL,
      REMEDIATION_BENCH_ALLOW_DB_HOST: 'ep-prod-shaped-12345.us-east-2.aws.neon.tech',
    });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toMatch(/NODE_ENV=production/);
    expect(output).not.toContain('Using Neon serverless PostgreSQL driver');
  });
});
