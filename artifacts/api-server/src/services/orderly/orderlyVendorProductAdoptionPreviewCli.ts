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
import { createOrderlyAdoptionEvidenceManifest } from './orderlyVendorProductAdoptionManifest';
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

async function readSpecs(): Promise<{
  specs: unknown[];
  source: 'file' | 'live_orderly';
  rawSourceFileSha256: string | null;
}> {
  const filePath = process.env.ORDERLY_SPECS_JSON_PATH?.trim();
  if (filePath) {
    const bytes = await readFile(resolve(filePath));
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(parsed)) throw new Error('ORDERLY_SPECS_JSON_PATH must contain a root JSON array.');
    return {
      specs: parsed,
      source: 'file',
      rawSourceFileSha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  const specs = await fetchBayHillOrderlySpecs({
    session: { headers: readSessionHeaders() },
  });
  return { specs, source: 'live_orderly', rawSourceFileSha256: null };
}

const { specs, source, rawSourceFileSha256 } = await readSpecs();
const canonicalSourceJsonSha256 = createHash('sha256').update(JSON.stringify(specs)).digest('hex');
const report = await previewOrderlyVendorProductAdoption(specs);
const manifest = createOrderlyAdoptionEvidenceManifest({ report, rawSourceFileSha256 });
const outputPath = resolve(
  process.env.ORDERLY_ADOPTION_REPORT_PATH?.trim()
    || '../../reports/orderly-vendor-product-adoption-preview.json',
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceAcquisition: source,
  // Backward-compatible alias. This is deterministic parsed-JSON serialization,
  // not the raw file byte hash used for chain of custody.
  sourcePayloadSha256: canonicalSourceJsonSha256,
  canonicalSourceJsonSha256,
  rawSourceFileSha256,
  ...report,
}, null, 2)}\n`);
const manifestPath = resolve(
  process.env.ORDERLY_ADOPTION_MANIFEST_PATH?.trim()
    || outputPath.replace(/\.json$/i, '.manifest.json'),
);
await writeFile(manifestPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceAcquisition: source,
  ...manifest,
}, null, 2)}\n`);

console.log(JSON.stringify({
  mode: report.mode,
  sourceSystem: report.sourceSystem,
  sourcePropertyId: report.sourcePropertyId,
  sourceAcquisition: source,
  rawSourceFileSha256,
  canonicalSourceJsonSha256,
  canonicalLogicalSourceFingerprint: manifest.canonicalSourceFingerprint,
  manifestId: manifest.manifestId,
  manifestSha256: manifest.manifestSha256,
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
  manifestPath,
}, null, 2));