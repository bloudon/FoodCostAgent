/**
 * Read-only production readiness check for the accepted Orderly adoption.
 *
 * This command deliberately refuses to calculate adoption classifications or
 * write catalog/audit data. The later production preview is a separate,
 * PM-authorized operation during the writer-quiescence window.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
  runOrderlyProductionPreflight,
  sha256File,
} from './orderlyVendorProductAdoptionProductionPreflight';
import type { OrderlyAdoptionEvidenceManifest } from './orderlyVendorProductAdoptionManifest';

const require = createRequire(import.meta.url);
const { version: apiVersion } = require('../../../package.json') as { version: string };

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') continue; // pnpm/npm pass-through separator — skip, not an option
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index++;
    }
  }
  return args;
}

function required(args: Args, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`--${name} is required.`);
  }
  return value.trim();
}

function git(command: string[]): string {
  try {
    return execFileSync('git', command, { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(
      `Unable to run git ${command.join(' ')}. Production preflight requires an exact deployed Git build identity.`,
    );
  }
}

if (process.env.NODE_ENV !== 'production') {
  throw new Error('Orderly production preflight requires NODE_ENV=production and refuses non-production environments.');
}

const args = parseArgs(process.argv.slice(2));
const allowed = new Set([
  'manifest', 'source', 'out',
  'expected-company-id', 'expected-store-id',
  'expected-db-host', 'expected-db-port', 'expected-db-name',
  'expected-git-sha', 'expected-api-version', 'expected-build-id',
  'api-port',
]);
for (const key of Object.keys(args)) {
  if (!allowed.has(key)) throw new Error(`Unknown option --${key}.`);
}

const expectedGitSha = required(args, 'expected-git-sha');
const expectedApiVersion = required(args, 'expected-api-version');
const runningGitSha = git(['rev-parse', 'HEAD']);
const workingTreeClean = git(['status', '--porcelain']) === '';
const buildId = `api@${apiVersion}:${runningGitSha}`;

async function readLiveApiBuildId(port: number): Promise<string | null> {
  const url = `http://127.0.0.1:${port}/api/build-info`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    throw new Error('Unable to reach the active API build-info endpoint; refusing to trust the checkout alone.');
  }
  if (!response.ok) {
    throw new Error(`Active API build-info endpoint returned HTTP ${response.status}; refusing preflight.`);
  }
  const body: unknown = await response.json();
  const build = body && typeof body === 'object' && 'buildId' in body
    ? (body as { buildId?: unknown; service?: unknown }).buildId
    : null;
  if (!body || typeof body !== 'object' || (body as { service?: unknown }).service !== 'fnb-cost-pro-api') {
    throw new Error('Local build-info endpoint did not identify the FnB Cost Pro API; refusing preflight.');
  }
  return typeof build === 'string' && build.trim() ? build : null;
}

function requiredPort(args: Args): number {
  const raw = required(args, 'api-port');
  if (!/^[1-9]\d{0,4}$/.test(raw)) throw new Error('--api-port must be an integer from 1 through 65535.');
  const port = Number(raw);
  if (port > 65535) throw new Error('--api-port must be an integer from 1 through 65535.');
  return port;
}

const manifestPath = resolve(required(args, 'manifest'));
const sourcePath = resolve(required(args, 'source'));
const outputPath = resolve(required(args, 'out'));
const manifestEnvelope = JSON.parse(await readFile(manifestPath, 'utf8')) as
  & OrderlyAdoptionEvidenceManifest
  & { generatedAt?: string; sourceAcquisition?: string };
const { generatedAt: _generatedAt, sourceAcquisition: _sourceAcquisition, ...manifest } = manifestEnvelope;
const sourceBytes = await readFile(sourcePath);
const rawSpecs: unknown = JSON.parse(sourceBytes.toString('utf8'));
if (!Array.isArray(rawSpecs)) throw new Error('--source must contain a root JSON array.');
const liveApiPort = requiredPort(args);
const liveApiBuildId = await readLiveApiBuildId(liveApiPort);

const report = await runOrderlyProductionPreflight({
  manifest,
  rawSpecs,
  rawSourceFileSha256: sha256File(sourceBytes),
  scope: {
    companyId: required(args, 'expected-company-id'),
    storeId: required(args, 'expected-store-id'),
    sourceSystem: 'ORDERLY',
    sourcePropertyId: manifest.sourcePropertyId,
  },
  build: {
    gitSha: runningGitSha,
    apiVersion,
    buildId,
    workingTreeClean,
  },
  liveApiBuildId,
  liveApiPort,
  expectedBuild: {
    gitSha: expectedGitSha,
    apiVersion: expectedApiVersion,
    buildId: required(args, 'expected-build-id'),
  },
  expectedDatabase: {
    host: required(args, 'expected-db-host'),
    port: required(args, 'expected-db-port'),
    database: required(args, 'expected-db-name'),
  },
});

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  mode: report.mode,
  isProductionPreview: report.isProductionPreview,
  writesExecuted: report.writesExecuted,
  manifestId: report.evidence.manifestId,
  candidateCount: report.evidence.candidateCount,
  catalogUnchanged: report.catalog.unchanged,
  outputPath,
  nextAllowedStep: report.nextAllowedStep,
}, null, 2));