/**
 * Generates a read-only `packSize.isActive` overlay for a frozen Orderly
 * evidence manifest. It never calls APPLY and never mutates catalog data.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { historicalInvoiceLines, historicalInvoices } from '@workspace/db';
import { db } from '../../db';
import {
  buildOrderlyActiveStatusOverlay,
  type UnresolvedHarvillSourceCode,
} from './orderlyVendorProductActiveStatusOverlay';
import {
  verifyOrderlyAdoptionEvidenceManifest,
  type OrderlyAdoptionEvidenceManifest,
} from './orderlyVendorProductAdoptionManifest';

const manifestPath = resolve(process.env.ORDERLY_ADOPTION_MANIFEST_PATH
  ?? '../../reports/orderly-vendor-product-adoption-manifest-24472.json');
const sourcePath = resolve(process.env.ORDERLY_SPECS_JSON_PATH
  ?? '../../attached_assets/allSpecsForRestaurant_24472_raw_1787184647052.json');
const outputPath = resolve(process.env.ORDERLY_ACTIVE_STATUS_OVERLAY_PATH
  ?? '../../reports/orderly-vendor-product-adoption-active-status-overlay-24472.json');

const manifestEnvelope = JSON.parse(await readFile(manifestPath, 'utf8')) as
  & OrderlyAdoptionEvidenceManifest
  & { generatedAt?: string; sourceAcquisition?: string };
// The JSON artifact adds operational metadata outside the signed manifest
// payload. Remove only that known envelope before verifying its deterministic
// content hash.
const {
  generatedAt: _generatedAt,
  sourceAcquisition: _sourceAcquisition,
  ...manifest
} = manifestEnvelope;
if (!verifyOrderlyAdoptionEvidenceManifest(manifest)) {
  throw new Error('Evidence manifest ID/hash is invalid; refusing active-status overlay.');
}
const sourceBytes = await readFile(sourcePath);
const rawSourceFileSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (manifest.rawSourceFileSha256 && manifest.rawSourceFileSha256 !== rawSourceFileSha256) {
  throw new Error('Raw source file SHA-256 differs from the frozen manifest; refusing active-status overlay.');
}
const specs: unknown = JSON.parse(sourceBytes.toString('utf8'));
if (!Array.isArray(specs)) throw new Error('Orderly source must be a root JSON array.');

const harvillVendorId = manifest.candidates.find(candidate =>
  candidate.sourceIdentity.supplierId === '32976',
)?.resolvedVendorId ?? null;
const unresolvedRows = harvillVendorId
  ? await db
    .select({
      sourceCode: historicalInvoiceLines.sourceExternalId,
      lineTotal: historicalInvoiceLines.lineTotal,
      invoiceDate: historicalInvoices.invoiceDate,
    })
    .from(historicalInvoiceLines)
    .innerJoin(historicalInvoices, and(
      eq(historicalInvoices.id, historicalInvoiceLines.invoiceId),
      eq(historicalInvoices.companyId, historicalInvoiceLines.companyId),
    ))
    .where(and(
      eq(historicalInvoices.vendorId, harvillVendorId),
      eq(historicalInvoiceLines.resolutionStatus, 'unresolved'),
      isNull(historicalInvoiceLines.inventoryItemId),
      isNull(historicalInvoiceLines.vendorItemId),
    ))
  : [];
const unresolvedByCode = new Map<string, UnresolvedHarvillSourceCode>();
for (const row of unresolvedRows) {
  if (!row.sourceCode?.trim()) continue;
  const key = row.sourceCode.trim().toLowerCase();
  const previous = unresolvedByCode.get(key);
  const date = row.invoiceDate ?? null;
  unresolvedByCode.set(key, {
    sourceCode: previous?.sourceCode ?? row.sourceCode,
    lineCount: (previous?.lineCount ?? 0) + 1,
    dollars: Math.round(((previous?.dollars ?? 0) + Number(row.lineTotal ?? 0)) * 100) / 100,
    earliestInvoiceDate: !previous?.earliestInvoiceDate || (date && date < previous.earliestInvoiceDate)
      ? date
      : previous.earliestInvoiceDate,
    latestInvoiceDate: !previous?.latestInvoiceDate || (date && date > previous.latestInvoiceDate)
      ? date
      : previous.latestInvoiceDate,
  });
}

const overlay = buildOrderlyActiveStatusOverlay({
  manifest,
  specs,
  unresolvedHarvillSourceCodes: [...unresolvedByCode.values()],
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  rawSourceFileSha256,
  ...overlay,
}, null, 2)}\n`);
console.log(JSON.stringify({
  mode: 'read-only',
  manifestId: overlay.manifestId,
  rawSourceFileSha256,
  sourceStatusCoverage: overlay.sourceStatusCoverage,
  candidateStatusCoverage: Object.fromEntries(
    Object.entries(overlay.candidateStatusCoverage).map(([status, bucket]) => [
      status,
      {
        candidateCount: bucket.candidateCount,
        createVendorItemAndMappingCount: bucket.createVendorItemAndMappingCount,
        createMappingOnlyCount: bucket.createMappingOnlyCount,
        harvillCandidateCount: bucket.harvill.candidateCount,
        harvillUnresolvedSourceCodeCount: bucket.harvill.currentlyUnresolvedSourceCodes.length,
      },
    ]),
  ),
  outputPath,
}, null, 2));