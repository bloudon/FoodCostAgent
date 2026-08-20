/**
 * Bounded DEV-only APPLY for the PM-approved Orderly adoption evidence
 * manifest. This is intentionally CLI-only: no HTTP route may invoke it.
 *
 * The only permitted persistent changes are:
 * - a new safe vendor_items row using FnB's ordinary creation defaults
 * - a missing ORDERLY vendor_item_external_mappings provenance row
 */
import { and, count, eq } from 'drizzle-orm';
import {
  inventoryItemPriceHistory,
  inventoryItems,
  vendorItemExternalMappings,
  vendorItems,
  vendors,
} from '@workspace/db';
import { db } from '../../db';
import { getOrCreateVendorItem } from '../../services/vendorItemResolution';
import {
  revalidateOrderlyAdoptionEvidenceManifest,
  type ManifestRevalidationOutcome,
  type OrderlyAdoptionEvidenceManifest,
  type OrderlyAdoptionFrozenCandidate,
} from './orderlyVendorProductAdoptionManifest';
import {
  BAY_HILL_ORDERLY_PROPERTY_ID,
  previewOrderlyVendorProductAdoption,
  type CatalogFingerprint,
  type HarvillAdoptionMetrics,
} from './orderlyVendorProductAdoptionPreview';

type Runner = typeof db | any;

export const PM_APPROVED_ORDERLY_ADOPTION_MANIFEST_ID =
  'orderly-adoption-evidence-v1:08047d80abef1790e2afb553e8c91d89481e892f2012313ee4cf3c50c6f90137';

export interface OrderlyAdoptionApplyCandidateOutcome {
  packSizeId: string;
  outcome: ManifestRevalidationOutcome;
  reason: string;
}

export interface OrderlyAdoptionIntegrityCheck {
  duplicateReliableVendorProductIdentities: number;
  duplicateOrderlyPackSizeMappings: number;
  orphanOrderlyMappings: number;
  harvillSprbrPackRegression: {
    passed: boolean;
    sourceGeometry: {
      sprbr5: { outerCount: number | null; innerSize: number | null; normalizedUom: string | null };
      sprbr: { outerCount: number | null; innerSize: number | null; normalizedUom: string | null };
    };
    sprbr5: { vendorItemId: string; caseSize: number; innerPackSize: number | null; packUom: string | null };
    sprbr: { vendorItemId: string; caseSize: number; innerPackSize: number | null; packUom: string | null };
  };
}

export interface OrderlyVendorProductAdoptionApplyReport {
  mode: 'dev-only-apply';
  manifestId: string;
  manifestSha256: string;
  sourcePropertyId: string;
  canonicalSourceFingerprint: string;
  catalog: {
    before: CatalogFingerprint;
    after: CatalogFingerprint;
    vendorCountBefore: number;
    vendorCountAfter: number;
  };
  outcomes: {
    createVendorItemAndMapping: number;
    createMappingOnly: number;
    alreadySatisfied: number;
    driftedHold: number;
    newVendorItemsCreated: number;
    mappingsCreated: number;
    driftedHoldReasons: Array<{ reason: string; count: number }>;
    candidates: OrderlyAdoptionApplyCandidateOutcome[];
  };
  integrity: OrderlyAdoptionIntegrityCheck;
  harvill: HarvillAdoptionMetrics;
}

export class OrderlyVendorProductAdoptionApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderlyVendorProductAdoptionApplyError';
  }
}

class CandidateDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CandidateDriftError';
  }
}

function outcomeTotals(outcomes: readonly OrderlyAdoptionApplyCandidateOutcome[]) {
  const countOutcome = (outcome: ManifestRevalidationOutcome) =>
    outcomes.filter(row => row.outcome === outcome).length;
  const reasonCounts = new Map<string, number>();
  for (const row of outcomes.filter(row => row.outcome === 'DRIFTED_HOLD')) {
    reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
  }
  return {
    createVendorItemAndMapping: countOutcome('CREATE_VENDOR_ITEM_AND_MAPPING'),
    createMappingOnly: countOutcome('CREATE_MAPPING_ONLY'),
    alreadySatisfied: countOutcome('ALREADY_SATISFIED'),
    driftedHold: countOutcome('DRIFTED_HOLD'),
    driftedHoldReasons: [...reasonCounts]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

async function readCatalogFingerprint(runner: Runner, companyId: string): Promise<CatalogFingerprint> {
  const [inventoryCount, vendorItemCount, mappingCount, priceCount] = await Promise.all([
    runner.select({ value: count() }).from(inventoryItems).where(eq(inventoryItems.companyId, companyId)),
    runner
      .select({ value: count() })
      .from(vendorItems)
      .innerJoin(vendors, and(eq(vendors.id, vendorItems.vendorId), eq(vendors.companyId, companyId))),
    runner.select({ value: count() }).from(vendorItemExternalMappings).where(eq(vendorItemExternalMappings.companyId, companyId)),
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

async function readVendorCount(runner: Runner, companyId: string): Promise<number> {
  const rows = await runner.select({ value: count() }).from(vendors).where(eq(vendors.companyId, companyId));
  return Number(rows[0]?.value ?? 0);
}

async function mappingForCandidate(
  runner: Runner,
  companyId: string,
  candidate: OrderlyAdoptionFrozenCandidate,
) {
  const [mapping] = await runner
    .select({ vendorItemId: vendorItemExternalMappings.vendorItemId })
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

async function verifyExistingTarget(
  runner: Runner,
  candidate: OrderlyAdoptionFrozenCandidate,
) {
  if (candidate.vendorItemTarget.kind !== 'existing') return null;
  const [item] = await runner
    .select({
      id: vendorItems.id,
      vendorId: vendorItems.vendorId,
      inventoryItemId: vendorItems.inventoryItemId,
    })
    .from(vendorItems)
    .where(eq(vendorItems.id, candidate.vendorItemTarget.vendorItemId))
    .limit(1);
  if (
    !item
    || item.vendorId !== candidate.resolvedVendorId
    || item.inventoryItemId !== candidate.canonicalInventoryItemId
  ) {
    return null;
  }
  return item;
}

async function mappedVendorItemMatchesFrozenTarget(
  runner: Runner,
  mappingVendorItemId: string,
  candidate: OrderlyAdoptionFrozenCandidate,
): Promise<boolean> {
  if (candidate.vendorItemTarget.kind === 'existing') {
    return mappingVendorItemId === candidate.vendorItemTarget.vendorItemId;
  }
  const [item] = await runner
    .select({
      id: vendorItems.id,
      vendorId: vendorItems.vendorId,
      inventoryItemId: vendorItems.inventoryItemId,
      vendorSku: vendorItems.vendorSku,
    })
    .from(vendorItems)
    .where(eq(vendorItems.id, mappingVendorItemId))
    .limit(1);
  const expected = candidate.vendorItemTarget.logicalIdentity;
  return Boolean(
    item
    && item.vendorId === expected.vendorId
    && item.inventoryItemId === expected.inventoryItemId
    && item.vendorSku === expected.vendorSku,
  );
}

async function createProvenanceMapping(
  runner: Runner,
  companyId: string,
  vendorItemId: string,
  candidate: OrderlyAdoptionFrozenCandidate,
): Promise<boolean> {
  const inserted = await runner
    .insert(vendorItemExternalMappings)
    .values({
      companyId,
      vendorItemId,
      sourceSystem: candidate.proposedProvenanceMapping.sourceSystem,
      sourcePropertyId: candidate.proposedProvenanceMapping.sourcePropertyId,
      sourceExternalId: candidate.proposedProvenanceMapping.sourceExternalId,
      sourceDescription: [candidate.sourceIdentity.sourceSku, candidate.rawPackEvidence.packSizeDesc]
        .filter(Boolean)
        .join(' · ') || null,
      matchStrategy: 'orderly_adoption_manifest',
      confidenceScore: 1,
      confirmedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: vendorItemExternalMappings.id });
  if (inserted.length > 0) return true;

  const winner = await mappingForCandidate(runner, companyId, candidate);
  if (winner?.vendorItemId === vendorItemId) return false;
  throw new CandidateDriftError(
    'A conflicting ORDERLY packSize mapping appeared while this candidate was being applied.',
  );
}

async function applyCandidateUnderLock(
  runner: Runner,
  companyId: string,
  candidate: OrderlyAdoptionFrozenCandidate,
): Promise<OrderlyAdoptionApplyCandidateOutcome & { vendorItemCreated: boolean; mappingCreated: boolean }> {
  const existingMapping = await mappingForCandidate(runner, companyId, candidate);
  if (existingMapping) {
    const matches = await mappedVendorItemMatchesFrozenTarget(runner, existingMapping.vendorItemId, candidate);
    return matches
      ? {
        packSizeId: candidate.sourceIdentity.packSizeId,
        outcome: 'ALREADY_SATISFIED',
        reason: 'The exact frozen ORDERLY provenance mapping already exists.',
        vendorItemCreated: false,
        mappingCreated: false,
      }
      : {
        packSizeId: candidate.sourceIdentity.packSizeId,
        outcome: 'DRIFTED_HOLD',
        reason: 'Existing ORDERLY provenance mapping points to a different vendor product.',
        vendorItemCreated: false,
        mappingCreated: false,
      };
  }

  const [vendor, inventoryItem] = await Promise.all([
    runner
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(
        eq(vendors.id, candidate.resolvedVendorId),
        eq(vendors.companyId, companyId),
        eq(vendors.active, 1),
      ))
      .limit(1),
    runner
      .select({ id: inventoryItems.id, unitId: inventoryItems.unitId })
      .from(inventoryItems)
      .where(and(
        eq(inventoryItems.id, candidate.canonicalInventoryItemId),
        eq(inventoryItems.companyId, companyId),
      ))
      .limit(1),
  ]);
  if (!vendor[0] || !inventoryItem[0]?.unitId) {
    return {
      packSizeId: candidate.sourceIdentity.packSizeId,
      outcome: 'DRIFTED_HOLD',
      reason: 'Frozen vendor or canonical inventory target is no longer valid in the bound company.',
      vendorItemCreated: false,
      mappingCreated: false,
    };
  }

  if (candidate.vendorItemTarget.kind === 'existing') {
    const target = await verifyExistingTarget(runner, candidate);
    if (!target) {
      return {
        packSizeId: candidate.sourceIdentity.packSizeId,
        outcome: 'DRIFTED_HOLD',
        reason: 'Frozen existing vendor-product target no longer matches its vendor and canonical inventory item.',
        vendorItemCreated: false,
        mappingCreated: false,
      };
    }
    const mappingCreated = await createProvenanceMapping(runner, companyId, target.id, candidate);
    return {
      packSizeId: candidate.sourceIdentity.packSizeId,
      outcome: 'CREATE_MAPPING_ONLY',
      reason: 'Fresh target remained valid; created its missing ORDERLY provenance mapping.',
      vendorItemCreated: false,
      mappingCreated,
    };
  }

  const target = candidate.vendorItemTarget.logicalIdentity;
  if (
    !target.vendorSku?.trim()
    || target.caseSize == null
    || target.innerPackSize == null
    || !target.packUom
  ) {
    return {
      packSizeId: candidate.sourceIdentity.packSizeId,
      outcome: 'DRIFTED_HOLD',
      reason: 'Frozen new vendor-product target lacks complete reliable SKU or pack geometry.',
      vendorItemCreated: false,
      mappingCreated: false,
    };
  }
  const [unexpectedExisting] = await runner
    .select({ id: vendorItems.id })
    .from(vendorItems)
    .where(and(
      eq(vendorItems.vendorId, target.vendorId),
      eq(vendorItems.inventoryItemId, target.inventoryItemId),
      eq(vendorItems.vendorSku, target.vendorSku),
    ))
    .limit(1);
  if (unexpectedExisting) {
    return {
      packSizeId: candidate.sourceIdentity.packSizeId,
      outcome: 'DRIFTED_HOLD',
      reason: 'The frozen new vendor-product identity appeared after current-state revalidation.',
      vendorItemCreated: false,
      mappingCreated: false,
    };
  }

  // Omitting active and all price fields deliberately preserves FnB's normal
  // insert defaults and avoids turning the source's ambiguous isActive field
  // into a lifecycle or pricing action.
  const resolution = await getOrCreateVendorItem(runner as any, {
    vendorId: target.vendorId,
    inventoryItemId: target.inventoryItemId,
    vendorSku: target.vendorSku,
    purchaseUnitId: inventoryItem[0].unitId,
    caseSize: target.caseSize,
    innerPackSize: target.innerPackSize,
    packUom: target.packUom,
  });
  if (!resolution.created) {
    throw new CandidateDriftError(
      'A vendor product with the frozen identity appeared while this candidate was being applied.',
    );
  }
  const mappingCreated = await createProvenanceMapping(runner, companyId, resolution.vendorItem.id, candidate);
  return {
    packSizeId: candidate.sourceIdentity.packSizeId,
    outcome: 'CREATE_VENDOR_ITEM_AND_MAPPING',
    reason: 'Fresh target exactly matched the reviewed manifest; created vendor product and ORDERLY provenance mapping.',
    vendorItemCreated: true,
    mappingCreated,
  };
}

async function readIntegrity(
  runner: Runner,
  companyId: string,
  manifest: OrderlyAdoptionEvidenceManifest,
): Promise<OrderlyAdoptionIntegrityCheck> {
  const rows = await runner
    .select({
      id: vendorItems.id,
      vendorId: vendorItems.vendorId,
      inventoryItemId: vendorItems.inventoryItemId,
      vendorSku: vendorItems.vendorSku,
    })
    .from(vendorItems)
    .innerJoin(vendors, and(eq(vendors.id, vendorItems.vendorId), eq(vendors.companyId, companyId)));
  const reliableIdentities = new Map<string, number>();
  for (const row of rows) {
    if (!row.vendorSku?.trim()) continue;
    const key = `${row.vendorId}\u0000${row.inventoryItemId}\u0000${row.vendorSku}`;
    reliableIdentities.set(key, (reliableIdentities.get(key) ?? 0) + 1);
  }
  const duplicateReliableVendorProductIdentities = [...reliableIdentities.values()]
    .filter(value => value > 1)
    .reduce((sum, value) => sum + value - 1, 0);

  const mappings = await runner
    .select({
      vendorItemId: vendorItemExternalMappings.vendorItemId,
      sourceExternalId: vendorItemExternalMappings.sourceExternalId,
    })
    .from(vendorItemExternalMappings)
    .where(and(
      eq(vendorItemExternalMappings.companyId, companyId),
      eq(vendorItemExternalMappings.sourceSystem, 'ORDERLY'),
      eq(vendorItemExternalMappings.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
    ));
  const mappingsByPackSize = new Map<string, number>();
  for (const mapping of mappings) {
    mappingsByPackSize.set(mapping.sourceExternalId, (mappingsByPackSize.get(mapping.sourceExternalId) ?? 0) + 1);
  }
  const duplicateOrderlyPackSizeMappings = [...mappingsByPackSize.values()]
    .filter(value => value > 1)
    .reduce((sum, value) => sum + value - 1, 0);
  const validVendorItemIds = new Set(rows.map((row: any) => row.id));
  const orphanOrderlyMappings = mappings.filter((mapping: any) => !validVendorItemIds.has(mapping.vendorItemId)).length;

  const expected = new Map(['SPRBR5', 'SPRBR'].map(sku => {
    const candidate = manifest.candidates.find(row =>
      row.sourceIdentity.supplierId === '32976'
      && row.sourceIdentity.sourceSku.toUpperCase() === sku,
    );
    if (!candidate) throw new OrderlyVendorProductAdoptionApplyError(`Frozen manifest is missing Harvill ${sku}.`);
    return [sku, candidate] as const;
  }));
  const harvillProducts = new Map<string, {
    vendorItemId: string;
    vendorId: string;
    inventoryItemId: string;
    caseSize: number;
    innerPackSize: number | null;
    packUom: string | null;
  }>();
  for (const [sku, candidate] of expected) {
    const mapping = await mappingForCandidate(runner, companyId, candidate);
    if (!mapping) throw new OrderlyVendorProductAdoptionApplyError(`Harvill ${sku} lacks its expected ORDERLY mapping after APPLY.`);
    const [item] = await runner
      .select({
        id: vendorItems.id,
        vendorId: vendorItems.vendorId,
        inventoryItemId: vendorItems.inventoryItemId,
        caseSize: vendorItems.caseSize,
        innerPackSize: vendorItems.innerPackSize,
        packUom: vendorItems.packUom,
      })
      .from(vendorItems)
      .where(eq(vendorItems.id, mapping.vendorItemId))
      .limit(1);
    if (!item) throw new OrderlyVendorProductAdoptionApplyError(`Harvill ${sku} mapping is orphaned after APPLY.`);
    harvillProducts.set(sku, {
      vendorItemId: item.id,
      vendorId: item.vendorId,
      inventoryItemId: item.inventoryItemId,
      caseSize: item.caseSize,
      innerPackSize: item.innerPackSize,
      packUom: item.packUom,
    });
  }
  const sprbr5 = harvillProducts.get('SPRBR5')!;
  const sprbr = harvillProducts.get('SPRBR')!;
  const sprbr5Evidence = expected.get('SPRBR5')!.normalizedPackGeometry;
  const sprbrEvidence = expected.get('SPRBR')!.normalizedPackGeometry;
  const sprbrPackRegression = {
    passed: sprbr5.vendorItemId !== sprbr.vendorItemId
      && sprbr5.vendorId === sprbr.vendorId
      && sprbr5.inventoryItemId === sprbr.inventoryItemId
      // SPRBR5 was an existing mapping-only target. Its immutable frozen
      // source geometry, rather than mutable vendor-item columns that this
      // migration must not alter, proves the 1/5 LB half of the regression.
      && sprbr5Evidence.outerCount === 1
      && sprbr5Evidence.innerSize === 5
      && sprbr5Evidence.normalizedUom === 'lb'
      && sprbrEvidence.outerCount === 1
      && sprbrEvidence.innerSize === 25
      && sprbrEvidence.normalizedUom === 'lb'
      && sprbr.caseSize === 1
      && sprbr.innerPackSize === 25
      && sprbr.packUom === 'lb',
    sourceGeometry: {
      sprbr5: {
        outerCount: sprbr5Evidence.outerCount,
        innerSize: sprbr5Evidence.innerSize,
        normalizedUom: sprbr5Evidence.normalizedUom,
      },
      sprbr: {
        outerCount: sprbrEvidence.outerCount,
        innerSize: sprbrEvidence.innerSize,
        normalizedUom: sprbrEvidence.normalizedUom,
      },
    },
    sprbr5: {
      vendorItemId: sprbr5.vendorItemId,
      caseSize: sprbr5.caseSize,
      innerPackSize: sprbr5.innerPackSize,
      packUom: sprbr5.packUom,
    },
    sprbr: {
      vendorItemId: sprbr.vendorItemId,
      caseSize: sprbr.caseSize,
      innerPackSize: sprbr.innerPackSize,
      packUom: sprbr.packUom,
    },
  };

  return {
    duplicateReliableVendorProductIdentities,
    duplicateOrderlyPackSizeMappings,
    orphanOrderlyMappings,
    harvillSprbrPackRegression: sprbrPackRegression,
  };
}

export async function applyOrderlyVendorProductAdoptionManifest(input: {
  manifest: OrderlyAdoptionEvidenceManifest;
  rawSpecs: readonly unknown[];
  runner?: Runner;
}): Promise<OrderlyVendorProductAdoptionApplyReport> {
  const runner = input.runner ?? db;
  const { manifest, rawSpecs } = input;
  if (manifest.manifestId !== PM_APPROVED_ORDERLY_ADOPTION_MANIFEST_ID) {
    throw new OrderlyVendorProductAdoptionApplyError('This APPLY accepts only the explicitly PM-approved manifest ID.');
  }
  if (manifest.sourcePropertyId !== BAY_HILL_ORDERLY_PROPERTY_ID || manifest.sourceSystem !== 'ORDERLY') {
    throw new OrderlyVendorProductAdoptionApplyError('This APPLY accepts only ORDERLY property 24472.');
  }

  return runner.transaction(async (tx: Runner) => {
    // Serializes this explicit manifest apply. Per-candidate rechecks below
    // still defend against unrelated catalog writers.
    await tx.execute(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      (await import('drizzle-orm')).sql`SELECT pg_advisory_xact_lock(hashtext(${`orderly-adoption:${manifest.manifestId}`}))`,
    );
    const currentReport = await previewOrderlyVendorProductAdoption(rawSpecs, tx);
    const revalidation = revalidateOrderlyAdoptionEvidenceManifest({ manifest, currentReport });
    if (!revalidation.manifestIntegrityValid) {
      throw new OrderlyVendorProductAdoptionApplyError('Manifest ID/hash verification failed before APPLY.');
    }
    if (!revalidation.sourceFingerprintMatches) {
      throw new OrderlyVendorProductAdoptionApplyError('Canonical logical source fingerprint differs from the frozen manifest.');
    }

    const before = await readCatalogFingerprint(tx, currentReport.companyId);
    const vendorCountBefore = await readVendorCount(tx, currentReport.companyId);
    const candidateByPackSizeId = new Map(manifest.candidates.map(candidate => [candidate.sourceIdentity.packSizeId, candidate]));
    const outcomes: OrderlyAdoptionApplyCandidateOutcome[] = [];
    let newVendorItemsCreated = 0;
    let mappingsCreated = 0;

    for (const revalidated of revalidation.outcomes) {
      const candidate = candidateByPackSizeId.get(revalidated.packSizeId);
      if (!candidate) throw new OrderlyVendorProductAdoptionApplyError('Revalidation returned a candidate outside the frozen manifest.');
      if (revalidated.outcome === 'DRIFTED_HOLD' || revalidated.outcome === 'ALREADY_SATISFIED') {
        outcomes.push(revalidated);
        continue;
      }
      try {
        const applied = await tx.transaction(async (candidateTx: Runner) =>
          applyCandidateUnderLock(candidateTx, currentReport.companyId, candidate),
        );
        outcomes.push(applied);
        newVendorItemsCreated += applied.vendorItemCreated ? 1 : 0;
        mappingsCreated += applied.mappingCreated ? 1 : 0;
      } catch (error) {
        if (error instanceof CandidateDriftError) {
          outcomes.push({
            packSizeId: candidate.sourceIdentity.packSizeId,
            outcome: 'DRIFTED_HOLD',
            reason: error.message,
          });
          continue;
        }
        throw error;
      }
    }

    const after = await readCatalogFingerprint(tx, currentReport.companyId);
    const vendorCountAfter = await readVendorCount(tx, currentReport.companyId);
    if (
      after.inventoryItemCount !== before.inventoryItemCount
      || after.priceHistoryCount !== before.priceHistoryCount
      || vendorCountAfter !== vendorCountBefore
      || after.vendorItemCount !== before.vendorItemCount + newVendorItemsCreated
      || after.vendorItemMappingCount !== before.vendorItemMappingCount + mappingsCreated
    ) {
      throw new OrderlyVendorProductAdoptionApplyError('Post-write catalog counts violated the bounded APPLY contract.');
    }
    const integrity = await readIntegrity(tx, currentReport.companyId, manifest);
    if (
      integrity.duplicateReliableVendorProductIdentities !== 0
      || integrity.duplicateOrderlyPackSizeMappings !== 0
      || integrity.orphanOrderlyMappings !== 0
      || !integrity.harvillSprbrPackRegression.passed
    ) {
      throw new OrderlyVendorProductAdoptionApplyError(
        `Post-write integrity verification failed; transaction rolled back. ` +
        `duplicateVendorIdentities=${integrity.duplicateReliableVendorProductIdentities}; ` +
        `duplicateOrderlyMappings=${integrity.duplicateOrderlyPackSizeMappings}; ` +
        `orphanMappings=${integrity.orphanOrderlyMappings}; ` +
        `harvillSprbrRegressionPassed=${integrity.harvillSprbrPackRegression.passed}.`,
      );
    }

    const totals = outcomeTotals(outcomes);
    const postReport = await previewOrderlyVendorProductAdoption(rawSpecs, tx);
    return {
      mode: 'dev-only-apply' as const,
      manifestId: manifest.manifestId,
      manifestSha256: manifest.manifestSha256,
      sourcePropertyId: manifest.sourcePropertyId,
      canonicalSourceFingerprint: manifest.canonicalSourceFingerprint,
      catalog: { before, after, vendorCountBefore, vendorCountAfter },
      outcomes: {
        ...totals,
        newVendorItemsCreated,
        mappingsCreated,
        candidates: outcomes,
      },
      integrity,
      harvill: postReport.harvill,
    };
  });
}