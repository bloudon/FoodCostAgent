import { describe, expect, it } from 'vitest';
import type {
  AdoptionClassificationResult,
  AdoptionClassifierSummary,
} from './orderlyVendorProductAdoptionClassifier';
import {
  createOrderlyAdoptionEvidenceManifest,
  revalidateOrderlyAdoptionEvidenceManifest,
} from './orderlyVendorProductAdoptionManifest';
import type { OrderlyVendorProductAdoptionPreviewReport } from './orderlyVendorProductAdoptionPreview';

function relationship(input: {
  id: string;
  sku: string;
  classification: AdoptionClassificationResult['classification'];
  existingVendorItemId?: string | null;
  reason?: string;
}): AdoptionClassificationResult {
  const safe = input.classification === 'safe_new_vendor_product'
    || input.classification === 'safe_same_vendor_alternate_product'
    || input.classification === 'mapping_only_gap';
  return {
    entry: {
      specId: `spec-${input.id}`,
      packSizeId: input.id,
      hasPackSizeId: true,
      supplierId: 'supplier-7',
      supplierName: 'Approved Vendor',
      resolvedSku: input.sku,
      normalizedSku: input.sku.toLowerCase(),
      productDescription: 'Example product',
      packDescription: null,
      active: true,
      packSizeDesc: '1/5 LB',
      pack: 1,
      size: 5,
      uom: 'POUND',
      normalizedPackGeometry: {
        outerCount: 1,
        innerSize: 5,
        normalizedUom: 'lb',
        rawPackString: '1/5 LB',
      },
      hasCatalogPrice: false,
      fallbackIdentity: null,
    },
    classification: input.classification,
    reasons: input.reason ? [input.reason] : [],
    inferredCanonicalItemId: safe ? 'inventory-1' : null,
    resolvedVendorId: safe ? 'vendor-1' : null,
    existingVendorItemId: input.existingVendorItemId ?? null,
    existingMappingFound: false,
    proposedVendorItem: safe && !input.existingVendorItemId ? {
      vendorId: 'vendor-1',
      inventoryItemId: 'inventory-1',
      vendorSku: input.sku,
      caseSize: 1,
      innerPackSize: 5,
      packUom: 'lb',
      active: true,
    } : null,
    proposedMapping: safe ? {
      sourceSystem: 'ORDERLY',
      sourcePropertyId: '24472',
      sourceExternalId: input.id,
      identityKind: 'packSizeId',
    } : null,
  };
}

function report(relationships: AdoptionClassificationResult[]): OrderlyVendorProductAdoptionPreviewReport {
  const classCounts: AdoptionClassifierSummary['classCounts'] = {
    already_present: 0,
    safe_new_vendor_product: relationships.filter(row => row.classification === 'safe_new_vendor_product').length,
    safe_same_vendor_alternate_product: relationships.filter(row => row.classification === 'safe_same_vendor_alternate_product').length,
    mapping_only_gap: relationships.filter(row => row.classification === 'mapping_only_gap').length,
    conflicting_source_identity: relationships.filter(row => row.classification === 'conflicting_source_identity').length,
    pack_geometry_conflict: relationships.filter(row => row.classification === 'pack_geometry_conflict').length,
    missing_canonical_inventory_identity: relationships.filter(row => row.classification === 'missing_canonical_inventory_identity').length,
    otherwise_held: relationships.filter(row => row.classification === 'otherwise_held').length,
  };
  return {
    mode: 'read-only',
    sourceSystem: 'ORDERLY',
    sourcePropertyId: '24472',
    companyId: 'company-1',
    destinationStoreId: 'store-1',
    bindingId: 'binding-1',
    approvedBatchCount: 2,
    approvedCanonicalItemCount: 1,
    geometryEvidenceConflictCount: 0,
    classifier: {
      totalConsidered: relationships.length,
      withPackSizeId: relationships.length,
      withoutPackSizeId: 0,
      classCounts,
      proposedNewVendorItemCount: classCounts.safe_new_vendor_product + classCounts.safe_same_vendor_alternate_product,
      proposedMappingCount: classCounts.safe_new_vendor_product + classCounts.safe_same_vendor_alternate_product + classCounts.mapping_only_gap,
      proposedPriceObservationCount: 0,
      catalogPricesLackingApprovedLineage: 0,
      identityConflictCount: 0,
      relationships,
    },
    harvill: {
      vendorId: null,
      totalHistoricalLines: 0,
      totalHistoricalDollars: 0,
      unresolvedLinesBefore: 0,
      unresolvedDistinctCodesBefore: 0,
      unresolvedDollarsBefore: 0,
      catalogResolvableLinesBefore: 0,
      catalogResolvableDollarsBefore: 0,
      catalogResolvableLinesAfter: 0,
      catalogResolvableDollarsAfter: 0,
      overallLineMatchRateBefore: 0,
      overallLineMatchRateAfter: 0,
      newlyResolvableDistinctCodes: 0,
      newlyResolvableLines: 0,
      newlyResolvableDollars: 0,
      residualDistinctCodes: 0,
      residuals: [],
    },
    mutationCheck: {
      before: { inventoryItemCount: 1, vendorItemCount: 1, vendorItemMappingCount: 0, priceHistoryCount: 0 },
      after: { inventoryItemCount: 1, vendorItemCount: 1, vendorItemMappingCount: 0, priceHistoryCount: 0 },
      unchanged: true,
    },
    applyGate: { status: 'PM_HELD', writesExecuted: 0 },
  };
}

describe('Orderly adoption evidence manifest', () => {
  const rows = [
    relationship({ id: 'pack-new', sku: 'NEW', classification: 'safe_new_vendor_product' }),
    relationship({ id: 'pack-map', sku: 'EXISTING', classification: 'mapping_only_gap', existingVendorItemId: 'vi-1' }),
    relationship({
      id: 'pack-held',
      sku: 'HELD',
      classification: 'otherwise_held',
      reason: 'Supplier "4121" not found in company snapshot.',
    }),
  ];

  it('freezes only safe candidates deterministically and summarizes held reasons', () => {
    const first = createOrderlyAdoptionEvidenceManifest({
      report: report(rows),
      rawSourceFileSha256: 'raw-file-hash',
    });
    const reordered = createOrderlyAdoptionEvidenceManifest({
      report: report([...rows].reverse()),
      rawSourceFileSha256: 'raw-file-hash',
    });

    expect(first.manifestId).toBe(reordered.manifestId);
    expect(first.manifestSha256).toBe(reordered.manifestSha256);
    expect(first.candidateCount).toBe(2);
    expect(first.candidateClassCounts).toEqual({
      createVendorItemAndMapping: 1,
      createMappingOnly: 1,
    });
    expect(first.candidates.map(candidate => candidate.sourceIdentity.packSizeId)).toEqual(['pack-map', 'pack-new']);
    expect(first.heldPopulationSummary.otherwiseHeldReasons).toEqual([
      { reason: 'Supplier "4121" not found in company snapshot.', count: 1 },
    ]);
  });

  it('returns only safe outcomes from a fresh matching preview and fails closed on source drift', () => {
    const reviewed = report(rows);
    const manifest = createOrderlyAdoptionEvidenceManifest({
      report: reviewed,
      rawSourceFileSha256: 'raw-file-hash',
    });
    const matching = revalidateOrderlyAdoptionEvidenceManifest({ manifest, currentReport: report(rows) });
    expect(matching.manifestIntegrityValid).toBe(true);
    expect(matching.sourceFingerprintMatches).toBe(true);
    expect(matching.outcomes).toEqual([
      expect.objectContaining({ packSizeId: 'pack-map', outcome: 'CREATE_MAPPING_ONLY' }),
      expect.objectContaining({ packSizeId: 'pack-new', outcome: 'CREATE_VENDOR_ITEM_AND_MAPPING' }),
    ]);

    const driftedRows = rows.map(row => row.entry.packSizeId === 'pack-new'
      ? relationship({ id: 'pack-new', sku: 'CHANGED-SKU', classification: 'safe_new_vendor_product' })
      : row);
    const drifted = revalidateOrderlyAdoptionEvidenceManifest({
      manifest,
      currentReport: report(driftedRows),
    });
    expect(drifted.sourceFingerprintMatches).toBe(false);
    expect(drifted.outcomes.every(row => row.outcome === 'DRIFTED_HOLD')).toBe(true);
  });

  it('fails closed if the deterministic manifest identity is altered', () => {
    const manifest = createOrderlyAdoptionEvidenceManifest({
      report: report(rows),
      rawSourceFileSha256: 'raw-file-hash',
    });
    const tampered = {
      ...manifest,
      candidateCount: manifest.candidateCount + 1,
    };
    const result = revalidateOrderlyAdoptionEvidenceManifest({
      manifest: tampered,
      currentReport: report(rows),
    });
    expect(result.manifestIntegrityValid).toBe(false);
    expect(result.outcomes.every(row => row.outcome === 'DRIFTED_HOLD')).toBe(true);
  });
});