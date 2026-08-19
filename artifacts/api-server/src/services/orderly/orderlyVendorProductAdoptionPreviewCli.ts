/**
 * Bounded, read-only Orderly vendor-product adoption preview.
 *
 * Source input (choose one):
 *   ORDERLY_SPECS_JSON_PATH=/path/to/root-array.json
 *   ORDERLY_SESSION_HEADERS_JSON='{"<observed-header>":"<session-value>"}'
 *
 * Optional:
 *   ORDERLY_ADOPTION_REPORT_PATH=/path/to/report.json
 *
 * This command never calls the APPLY function and never writes catalog data.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fetchBayHillOrderlySpecs } from './bayHillOrderlyAdapter';
import { previewOrderlyVendorProductAdoption } from './orderlyVendorProductAdoptionPreview';

function readSessionHeaders(): Record<string, string> {
  const encoded = process.env.ORDERLY_SESSION_HEADERS_JSON?.trim();
  if (!encoded) {
    throw new Error(
      'Provide ORDERLY_SPECS_JSON_PATH or set ORDERLY_SESSION_HEADERS_JSON in Replit Secrets.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('ORDERLY_SESSION_HEADERS_JSON must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ORDERLY_SESSION_HEADERS_JSON must be a JSON object.');
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!name.trim() || typeof value !== 'string' || !value.trim()) {
      throw new Error('ORDERLY_SESSION_HEADERS_JSON values must be non-empty header strings.');
    }
    headers[name] = value;
  }
  return headers;
}

async function readSpecs(): Promise<{ specs: unknown[]; source: 'file' | 'live_orderly' }> {
  const filePath = process.env.ORDERLY_SPECS_JSON_PATH?.trim();
  if (filePath) {
    const parsed: unknown = JSON.parse(await readFile(resolve(filePath), 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('ORDERLY_SPECS_JSON_PATH must contain a root JSON array.');
    return { specs: parsed, source: 'file' };
  }
  const specs = await fetchBayHillOrderlySpecs({
    session: { headers: readSessionHeaders() },
  });
  return { specs, source: 'live_orderly' };
}

const { specs, source } = await readSpecs();
const payloadHash = createHash('sha256').update(JSON.stringify(specs)).digest('hex');
const report = await previewOrderlyVendorProductAdoption(specs);
const outputPath = resolve(
  process.env.ORDERLY_ADOPTION_REPORT_PATH?.trim()
    || '../../reports/orderly-vendor-product-adoption-preview.json',
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceAcquisition: source,
  sourcePayloadSha256: payloadHash,
  ...report,
}, null, 2)}\n`);

console.log(JSON.stringify({
  mode: report.mode,
  sourceSystem: report.sourceSystem,
  sourcePropertyId: report.sourcePropertyId,
  sourceAcquisition: source,
  sourcePayloadSha256: payloadHash,
  totalRelationships: report.classifier.totalConsidered,
  withPackSizeId: report.classifier.withPackSizeId,
  withoutPackSizeId: report.classifier.withoutPackSizeId,
  classCounts: report.classifier.classCounts,
  proposedNewVendorItems: report.classifier.proposedNewVendorItemCount,
  proposedMappings: report.classifier.proposedMappingCount,
  proposedPriceObservations: report.classifier.proposedPriceObservationCount,
  harvill: report.harvill,
  mutationCheck: report.mutationCheck,
  applyGate: report.applyGate,
  reportPath: outputPath,
}, null, 2));