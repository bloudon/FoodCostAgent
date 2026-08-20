/**
 * Builds an audit-ready, read-only verification artifact by comparing the
 * frozen pre-APPLY preview with a fresh post-APPLY preview. The projection
 * itself measures against the catalog it sees, so this explicit comparison is
 * required to retain the historical migration lift.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { OrderlyAdoptionEvidenceManifest } from './orderlyVendorProductAdoptionManifest';

type Report = Record<string, any>;

async function readJson(path: string): Promise<Report> {
  return JSON.parse(await readFile(path, 'utf8')) as Report;
}

const baselinePath = resolve(process.env.ORDERLY_ADOPTION_BASELINE_REPORT_PATH
  ?? '../../reports/orderly-vendor-product-adoption-preview-24472.json');
const postApplyPath = resolve(process.env.ORDERLY_ADOPTION_POST_APPLY_PREVIEW_PATH
  ?? '../../reports/orderly-vendor-product-adoption-post-apply-preview-24472.json');
const applyPath = resolve(process.env.ORDERLY_ADOPTION_APPLY_REPORT_PATH
  ?? '../../reports/orderly-vendor-product-adoption-apply-24472.json');
const manifestPath = resolve(process.env.ORDERLY_ADOPTION_MANIFEST_PATH
  ?? '../../reports/orderly-vendor-product-adoption-manifest-24472.json');
const outputPath = resolve(process.env.ORDERLY_ADOPTION_POST_APPLY_VERIFICATION_PATH
  ?? '../../reports/orderly-vendor-product-adoption-post-apply-verification-24472.json');

const [baseline, postApply, apply, envelope] = await Promise.all([
  readJson(baselinePath),
  readJson(postApplyPath),
  readJson(applyPath),
  readJson(manifestPath),
]);
const {
  generatedAt: _generatedAt,
  sourceAcquisition: _sourceAcquisition,
  ...manifest
} = envelope as OrderlyAdoptionEvidenceManifest & { generatedAt?: string; sourceAcquisition?: string };

if (
  baseline.mode !== 'read-only'
  || postApply.mode !== 'read-only'
  || apply.mode !== 'dev-only-apply'
  || manifest.sourcePropertyId !== '24472'
  || apply.manifestId !== manifest.manifestId
  || apply.manifestSha256 !== manifest.manifestSha256
  || apply.canonicalSourceFingerprint !== manifest.canonicalSourceFingerprint
  || baseline.rawSourceFileSha256 !== manifest.rawSourceFileSha256
  || postApply.rawSourceFileSha256 !== manifest.rawSourceFileSha256
  || apply.rawSourceFileSha256 !== manifest.rawSourceFileSha256
) {
  throw new Error('Apply, manifest, baseline, and post-APPLY preview do not bind to the same reviewed evidence.');
}
if (
  JSON.stringify(apply.catalog.after) !== JSON.stringify(postApply.mutationCheck.before)
  || !postApply.mutationCheck.unchanged
) {
  throw new Error('Post-APPLY catalog fingerprint is not the committed APPLY fingerprint.');
}

const baselineHarvill = baseline.harvill;
const postHarvill = postApply.harvill;
const actualCatalogResolvableLines = postHarvill.catalogResolvableLinesBefore;
const actualCatalogResolvableDollars = postHarvill.catalogResolvableDollarsBefore;
const actualLineMatchRate = postHarvill.overallLineMatchRateBefore;
const lift = {
  newlyResolvableDistinctCodes:
    baselineHarvill.unresolvedDistinctCodesBefore - postHarvill.residualDistinctCodes,
  newlyResolvableLines:
    actualCatalogResolvableLines - baselineHarvill.catalogResolvableLinesBefore,
  newlyResolvableDollars:
    Math.round((actualCatalogResolvableDollars - baselineHarvill.catalogResolvableDollarsBefore) * 100) / 100,
  lineMatchRatePointIncrease:
    Math.round((actualLineMatchRate - baselineHarvill.overallLineMatchRateBefore) * 100) / 100,
};
if (
  lift.newlyResolvableDistinctCodes < 0
  || lift.newlyResolvableLines < 0
  || lift.newlyResolvableDollars < 0
) {
  throw new Error('Post-APPLY Harvill resolution regressed; refusing verification artifact.');
}

const verification = {
  verificationFormat: 'orderly-adoption-post-apply-verification-v1',
  generatedAt: new Date().toISOString(),
  mode: 'read-only-verification',
  evidence: {
    manifestId: manifest.manifestId,
    manifestSha256: manifest.manifestSha256,
    rawSourceFileSha256: manifest.rawSourceFileSha256,
    canonicalSourceFingerprint: manifest.canonicalSourceFingerprint,
    sourcePropertyId: manifest.sourcePropertyId,
  },
  catalog: apply.catalog,
  outcomes: apply.outcomes,
  integrity: apply.integrity,
  harvill: {
    frozenBaseline: {
      catalogResolvableLines: baselineHarvill.catalogResolvableLinesBefore,
      catalogResolvableDollars: baselineHarvill.catalogResolvableDollarsBefore,
      lineMatchRate: baselineHarvill.overallLineMatchRateBefore,
      unresolvedDistinctCodes: baselineHarvill.unresolvedDistinctCodesBefore,
    },
    actualPostApply: {
      catalogResolvableLines: actualCatalogResolvableLines,
      catalogResolvableDollars: actualCatalogResolvableDollars,
      lineMatchRate: actualLineMatchRate,
      residualDistinctCodes: postHarvill.residualDistinctCodes,
      residuals: postHarvill.residuals,
    },
    lift,
  },
  postApplyPreviewMutationCheck: postApply.mutationCheck,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\n`);
console.log(JSON.stringify({
  manifestId: verification.evidence.manifestId,
  catalog: verification.catalog,
  outcomes: {
    createVendorItemAndMapping: verification.outcomes.createVendorItemAndMapping,
    createMappingOnly: verification.outcomes.createMappingOnly,
    alreadySatisfied: verification.outcomes.alreadySatisfied,
    driftedHold: verification.outcomes.driftedHold,
  },
  harvill: verification.harvill,
  outputPath,
}, null, 2));