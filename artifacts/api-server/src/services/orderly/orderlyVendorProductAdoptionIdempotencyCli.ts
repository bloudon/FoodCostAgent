/**
 * Read-only idempotency proof for the PM-approved Orderly adoption manifest.
 *
 * This is deliberately separate from the source projection preview. It checks
 * the exact frozen mapping and vendor-product identities that APPLY would
 * encounter on a rerun, without opening any insert or update path.
 */
import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { and, count, eq } from 'drizzle-orm';
import {
  inventoryItemPriceHistory,
  inventoryItems,
  vendorItemExternalMappings,
  vendorItems,
  vendors,
} from '@workspace/db';
import { assertBenchDatabaseAllowed } from '../../../scripts/benchGuard';
import { db } from '../../db';
import {
  PM_APPROVED_ORDERLY_ADOPTION_MANIFEST_ID,
} from './orderlyVendorProductAdoptionApply';
import {
  verifyOrderlyAdoptionEvidenceManifest,
  type OrderlyAdoptionEvidenceManifest,
  type OrderlyAdoptionFrozenCandidate,
} from './orderlyVendorProductAdoptionManifest';

type Runner = typeof db | any;
type Report = Record<string, any>;

const manifestPath = resolve(process.env.ORDERLY_ADOPTION_MANIFEST_PATH
  ?? '../../reports/orderly-vendor-product-adoption-manifest-24472.json');
const applyReportPath = resolve(process.env.ORDERLY_ADOPTION_APPLY_REPORT_PATH
  ?? '../../reports/orderly-vendor-product-adoption-apply-24472.json');
const outputPath = resolve(process.env.ORDERLY_ADOPTION_IDEMPOTENCY_REPORT_PATH
  ?? '../../reports/orderly-vendor-product-adoption-idempotency-24472.json');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Orderly adoption idempotency check is DEV-only and refuses NODE_ENV=production.');
}
assertBenchDatabaseAllowed('orderly-vendor-product-adoption-idempotency');

const envelope = JSON.parse(await readFile(manifestPath, 'utf8')) as
  & OrderlyAdoptionEvidenceManifest
  & { generatedAt?: string; sourceAcquisition?: string };
const { generatedAt: _generatedAt, sourceAcquisition: _sourceAcquisition, ...manifest } = envelope;
if (!verifyOrderlyAdoptionEvidenceManifest(manifest)) {
  throw new Error('Frozen manifest ID/hash is invalid; refusing idempotency check.');
}
if (manifest.manifestId !== PM_APPROVED_ORDERLY_ADOPTION_MANIFEST_ID) {
  throw new Error('Manifest is valid but is not the explicitly approved manifest.');
}
const applyReport = JSON.parse(await readFile(applyReportPath, 'utf8')) as Report;

async function readCatalogFingerprint(runner: Runner, companyId: string) {
  const [inventoryCount, vendorItemCount, mappingCount, priceCount] = await Promise.all([
    runner.select({ value: count() }).from(inventoryItems).where(eq(inventoryItems.companyId, companyId)),
    runner
      .select({ value: count() })
      .from(vendorItems)
      .innerJoin(vendors, and(eq(vendors.id, vendorItems.vendorId), eq(vendors.companyId, companyId))),
    runner.select({ value: count() }).from(vendorItemExternalMappings)
      .where(eq(vendorItemExternalMappings.companyId, companyId)),
    runner
      .select({ value: count() })
      .from(inventoryItemPriceHistory)
      .innerJoin(inventoryItems, and(
        eq(inventoryItems.id, inventoryItemPriceHistory.inventoryItemId),
        eq(inventoryItems.companyId, companyId),
      )),
  ]);
  return {
    inventoryItemCount: Number(inventoryCount[0]?.value ?? 0),
    vendorItemCount: Number(vendorItemCount[0]?.value ?? 0),
    vendorItemMappingCount: Number(mappingCount[0]?.value ?? 0),
    priceHistoryCount: Number(priceCount[0]?.value ?? 0),
  };
}

async function findCompanyId(runner: Runner, candidate: OrderlyAdoptionFrozenCandidate) {
  const [vendor] = await runner
    .select({ companyId: vendors.companyId })
    .from(vendors)
    .where(eq(vendors.id, candidate.resolvedVendorId))
    .limit(1);
  if (!vendor?.companyId) throw new Error(`Frozen vendor ${candidate.resolvedVendorId} is no longer present.`);
  return vendor.companyId;
}

async function findMapping(runner: Runner, companyId: string, candidate: OrderlyAdoptionFrozenCandidate) {
  const [mapping] = await runner
    .select({
      id: vendorItemExternalMappings.id,
      vendorItemId: vendorItemExternalMappings.vendorItemId,
    })
    .from(vendorItemExternalMappings)
    .where(and(
      eq(vendorItemExternalMappings.companyId, companyId),
      eq(vendorItemExternalMappings.sourceSystem, candidate.proposedProvenanceMapping.sourceSystem),
      eq(vendorItemExternalMappings.sourcePropertyId, candidate.proposedProvenanceMapping.sourcePropertyId),
      eq(vendorItemExternalMappings.sourceExternalId, candidate.proposedProvenanceMapping.sourceExternalId),
    ))
    .limit(1);
  return mapping ?? null;
}

async function findVendorItem(runner: Runner, vendorItemId: string) {
  const [item] = await runner
    .select({
      id: vendorItems.id,
      vendorId: vendorItems.vendorId,
      inventoryItemId: vendorItems.inventoryItemId,
      vendorSku: vendorItems.vendorSku,
      caseSize: vendorItems.caseSize,
      innerPackSize: vendorItems.innerPackSize,
      packUom: vendorItems.packUom,
    })
    .from(vendorItems)
    .where(eq(vendorItems.id, vendorItemId))
    .limit(1);
  return item ?? null;
}

async function findFrozenTarget(runner: Runner, candidate: OrderlyAdoptionFrozenCandidate) {
  if (candidate.vendorItemTarget.kind === 'existing') {
    return findVendorItem(runner, candidate.vendorItemTarget.vendorItemId);
  }
  const expected = candidate.vendorItemTarget.logicalIdentity;
  if (expected.vendorSku == null) return null;
  const [item] = await runner
    .select({
      id: vendorItems.id,
      vendorId: vendorItems.vendorId,
      inventoryItemId: vendorItems.inventoryItemId,
      vendorSku: vendorItems.vendorSku,
      caseSize: vendorItems.caseSize,
      innerPackSize: vendorItems.innerPackSize,
      packUom: vendorItems.packUom,
    })
    .from(vendorItems)
    .where(and(
      eq(vendorItems.vendorId, expected.vendorId),
      eq(vendorItems.inventoryItemId, expected.inventoryItemId),
      eq(vendorItems.vendorSku, expected.vendorSku),
    ))
    .limit(1);
  return item ?? null;
}

function targetMatches(
  item: Awaited<ReturnType<typeof findVendorItem>>,
  candidate: OrderlyAdoptionFrozenCandidate,
) {
  if (!item) return false;
  if (candidate.vendorItemTarget.kind === 'existing') {
    return item.id === candidate.vendorItemTarget.vendorItemId;
  }
  const expected = candidate.vendorItemTarget.logicalIdentity;
  return item.vendorId === expected.vendorId
    && item.inventoryItemId === expected.inventoryItemId
    && item.vendorSku === expected.vendorSku
    && Number(item.caseSize) === Number(expected.caseSize)
    && Number(item.innerPackSize) === Number(expected.innerPackSize)
    && item.packUom === expected.packUom;
}

await db.transaction(async (tx: Runner) => {
  await tx.execute('SET TRANSACTION READ ONLY');
  const companyId = await findCompanyId(tx, manifest.candidates[0]);
  const before = await readCatalogFingerprint(tx, companyId);
  const candidates = [];

  for (const candidate of manifest.candidates) {
    const mapping = await findMapping(tx, companyId, candidate);
    const mappedItem = mapping ? await findVendorItem(tx, mapping.vendorItemId) : null;
    if (mapping && targetMatches(mappedItem, candidate)) {
      candidates.push({
        packSizeId: candidate.sourceIdentity.packSizeId,
        outcome: 'ALREADY_SATISFIED',
        reason: 'Exact frozen ORDERLY mapping and vendor-product target are present.',
        vendorItemId: mapping.vendorItemId,
        mappingId: mapping.id,
      });
      continue;
    }

    const targetItem = await findFrozenTarget(tx, candidate);
    candidates.push({
      packSizeId: candidate.sourceIdentity.packSizeId,
      outcome: 'DRIFTED_HOLD',
      reason: mapping
        ? 'Existing frozen ORDERLY mapping points to a different vendor-product target.'
        : targetItem
          ? 'Frozen vendor-product identity exists, but its exact ORDERLY mapping is missing.'
          : 'Frozen vendor-product identity and exact ORDERLY mapping are missing.',
      vendorItemId: mapping?.vendorItemId ?? targetItem?.id ?? null,
      mappingId: mapping?.id ?? null,
    });
  }

  const after = await readCatalogFingerprint(tx, companyId);
  const alreadySatisfied = candidates.filter(row => row.outcome === 'ALREADY_SATISFIED').length;
  const driftedHold = candidates.filter(row => row.outcome === 'DRIFTED_HOLD').length;
  const expectedAlreadySatisfied = Number(applyReport.outcomes?.mappingsCreated ?? -1);
  const expectedDriftedHold = Number(applyReport.outcomes?.driftedHold ?? -1);
  if (
    candidates.length !== manifest.candidateCount
    || alreadySatisfied !== expectedAlreadySatisfied
    || driftedHold !== expectedDriftedHold
    || expectedAlreadySatisfied + expectedDriftedHold !== manifest.candidateCount
    || JSON.stringify(before) !== JSON.stringify(after)
  ) {
    throw new Error(
      `Idempotency proof failed: candidates=${candidates.length}; ` +
      `alreadySatisfied=${alreadySatisfied}; driftedHold=${driftedHold}; ` +
      `expectedAlreadySatisfied=${expectedAlreadySatisfied}; expectedDriftedHold=${expectedDriftedHold}; ` +
      `catalogUnchanged=${JSON.stringify(before) === JSON.stringify(after)}.`,
    );
  }

  const report = {
    mode: 'read-only-idempotency-dry-run',
    writesExecuted: 0,
    evidence: {
      manifestId: manifest.manifestId,
      manifestSha256: manifest.manifestSha256,
      rawSourceFileSha256: manifest.rawSourceFileSha256,
      canonicalSourceFingerprint: manifest.canonicalSourceFingerprint,
      sourcePropertyId: manifest.sourcePropertyId,
    },
    companyId,
    candidateCount: candidates.length,
    outcomes: {
      alreadySatisfied,
      driftedHold,
      createVendorItemAndMapping: 0,
      createMappingOnly: 0,
      totalCreateActions: 0,
      driftReasons: [...new Set(candidates
        .filter(row => row.outcome === 'DRIFTED_HOLD')
        .map(row => row.reason))],
    },
    catalog: { before, after, unchanged: true },
    candidates,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...report,
  }, null, 2)}\n`);
  console.log(JSON.stringify({
    mode: report.mode,
    writesExecuted: report.writesExecuted,
    evidence: report.evidence,
    candidateCount: report.candidateCount,
    outcomes: report.outcomes,
    catalog: report.catalog,
    outputPath,
  }, null, 2));
});