/**
 * Explicit DEV-only entrypoint for the single PM-approved Orderly adoption
 * manifest. This never accepts live Orderly credentials: it requires the
 * reviewed Claude-authenticated raw export file and verifies its SHA-256.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assertBenchDatabaseAllowed } from '../../../scripts/benchGuard';
import {
  applyOrderlyVendorProductAdoptionManifest,
  PM_APPROVED_ORDERLY_ADOPTION_MANIFEST_ID,
} from './orderlyVendorProductAdoptionApply';
import { verifyOrderlyAdoptionEvidenceManifest, type OrderlyAdoptionEvidenceManifest } from './orderlyVendorProductAdoptionManifest';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Orderly adoption APPLY is DEV-only and refuses NODE_ENV=production.');
}
assertBenchDatabaseAllowed('orderly-vendor-product-adoption-apply');

const manifestPath = resolve(process.env.ORDERLY_ADOPTION_MANIFEST_PATH
  ?? '../../reports/orderly-vendor-product-adoption-manifest-24472.json');
const sourcePath = resolve(process.env.ORDERLY_SPECS_JSON_PATH
  ?? '../../attached_assets/allSpecsForRestaurant_24472_raw_1787184647052.json');
const outputPath = resolve(process.env.ORDERLY_ADOPTION_APPLY_REPORT_PATH
  ?? '../../reports/orderly-vendor-product-adoption-apply-24472.json');

const confirmation = process.env.ORDERLY_ADOPTION_APPLY_CONFIRM;
if (confirmation !== `DEV_ONLY:${PM_APPROVED_ORDERLY_ADOPTION_MANIFEST_ID}`) {
  throw new Error('Set ORDERLY_ADOPTION_APPLY_CONFIRM to the exact DEV_ONLY:<approved-manifest-id> value to run APPLY.');
}
const envelope = JSON.parse(await readFile(manifestPath, 'utf8')) as
  & OrderlyAdoptionEvidenceManifest
  & { generatedAt?: string; sourceAcquisition?: string };
const { generatedAt: _generatedAt, sourceAcquisition: _sourceAcquisition, ...manifest } = envelope;
if (!verifyOrderlyAdoptionEvidenceManifest(manifest)) {
  throw new Error('Frozen manifest ID/hash is invalid; refusing APPLY.');
}
if (manifest.manifestId !== PM_APPROVED_ORDERLY_ADOPTION_MANIFEST_ID) {
  throw new Error('Manifest is valid but is not the explicitly approved manifest; refusing APPLY.');
}
const sourceBytes = await readFile(sourcePath);
const rawSourceFileSha256 = createHash('sha256').update(sourceBytes).digest('hex');
if (!manifest.rawSourceFileSha256 || manifest.rawSourceFileSha256 !== rawSourceFileSha256) {
  throw new Error('Supplied raw export SHA-256 does not match the frozen manifest; refusing APPLY.');
}
const rawSpecs: unknown = JSON.parse(sourceBytes.toString('utf8'));
if (!Array.isArray(rawSpecs)) throw new Error('Orderly source must be a root JSON array.');

const report = await applyOrderlyVendorProductAdoptionManifest({ manifest, rawSpecs });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  rawSourceFileSha256,
  ...report,
}, null, 2)}\n`);
console.log(JSON.stringify({
  mode: report.mode,
  manifestId: report.manifestId,
  canonicalSourceFingerprint: report.canonicalSourceFingerprint,
  catalog: report.catalog,
  outcomes: {
    createVendorItemAndMapping: report.outcomes.createVendorItemAndMapping,
    createMappingOnly: report.outcomes.createMappingOnly,
    alreadySatisfied: report.outcomes.alreadySatisfied,
    driftedHold: report.outcomes.driftedHold,
    newVendorItemsCreated: report.outcomes.newVendorItemsCreated,
    mappingsCreated: report.outcomes.mappingsCreated,
  },
  integrity: report.integrity,
  harvill: report.harvill,
  outputPath,
}, null, 2));