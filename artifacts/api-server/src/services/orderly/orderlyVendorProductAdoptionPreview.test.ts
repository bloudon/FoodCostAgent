import { describe, expect, it } from 'vitest';
import {
  applyOrderlyVendorProductAdoption,
  projectHarvillAdoptionMetrics,
} from './orderlyVendorProductAdoptionPreview';
import type {
  AdoptionClassifierSnapshot,
  AdoptionClassifierSummary,
} from './orderlyVendorProductAdoptionClassifier';

const snapshot: AdoptionClassifierSnapshot = {
  companyId: 'company-1',
  sourceSystem: 'ORDERLY',
  sourcePropertyId: '24472',
  vendors: [{
    vendorId: 'harvill-1',
    companyId: 'company-1',
    supplierExternalId: 'harvill-source',
    vendorName: 'Harvill',
  }],
  approvedCanonicalItemIds: [
    { inventoryItemId: 'item-1', companyId: 'company-1' },
    { inventoryItemId: 'item-2', companyId: 'company-1' },
  ],
  vendorItems: [{
    vendorItemId: 'vi-existing',
    vendorId: 'harvill-1',
    companyId: 'company-1',
    inventoryItemId: 'item-1',
    vendorSku: 'EXISTING',
    normalizedSku: 'existing',
    caseSize: 1,
    innerPackSize: 5,
    packUom: 'LB',
    active: 1,
  }],
  vendorItemExternalMappings: [],
  purchaseUnitEvidence: [],
};

const baseClassifier: AdoptionClassifierSummary = {
  totalConsidered: 2,
  withPackSizeId: 2,
  withoutPackSizeId: 0,
  classCounts: {
    already_present: 0,
    safe_new_vendor_product: 1,
    safe_same_vendor_alternate_product: 0,
    mapping_only_gap: 0,
    conflicting_source_identity: 0,
    pack_geometry_conflict: 1,
    missing_canonical_inventory_identity: 0,
    otherwise_held: 0,
  },
  proposedNewVendorItemCount: 1,
  proposedMappingCount: 1,
  proposedPriceObservationCount: 0,
  catalogPricesLackingApprovedLineage: 0,
  identityConflictCount: 1,
  relationships: [
    {
      entry: {
        specId: 'spec-1',
        packSizeId: 'ps-new',
        hasPackSizeId: true,
        supplierId: 'harvill-source',
        supplierName: 'Harvill',
        resolvedSku: 'NEW-SKU',
        normalizedSku: 'new-sku',
        productDescription: 'New item',
        packDescription: null,
        active: true,
        packSizeDesc: '1/5 LB',
        pack: 1,
        size: 5,
        uom: 'LB',
        normalizedPackGeometry: {
          outerCount: 1,
          innerSize: 5,
          normalizedUom: 'lb',
          rawPackString: '1/5 LB',
        },
        hasCatalogPrice: true,
        fallbackIdentity: null,
      },
      classification: 'safe_new_vendor_product',
      reasons: [],
      inferredCanonicalItemId: 'item-2',
      resolvedVendorId: 'harvill-1',
      existingVendorItemId: null,
      existingMappingFound: false,
      proposedVendorItem: {
        vendorId: 'harvill-1',
        inventoryItemId: 'item-2',
        vendorSku: 'NEW-SKU',
        caseSize: 1,
        innerPackSize: 5,
        packUom: 'lb',
        active: true,
      },
      proposedMapping: {
        sourceSystem: 'ORDERLY',
        sourcePropertyId: '24472',
        sourceExternalId: 'ps-new',
        identityKind: 'packSizeId',
      },
    },
  ],
};

describe('projectHarvillAdoptionMetrics', () => {
  it('reports newly resolvable dollars and exact residual classes without mutating inputs', () => {
    const lines = [
      {
        lineId: 'resolved',
        sourceExternalId: 'OLD',
        lineTotal: 10,
        resolutionStatus: 'resolved',
        inventoryItemId: 'item-1',
        vendorItemId: 'vi-existing',
        packSnapshot: { raw: '1/5 LB' },
      },
      {
        lineId: 'new',
        sourceExternalId: 'NEW-SKU',
        lineTotal: 31.45,
        resolutionStatus: 'unresolved',
        inventoryItemId: null,
        vendorItemId: null,
        packSnapshot: { raw: '1/5 LB' },
      },
      {
        lineId: 'held',
        sourceExternalId: 'HELD-SKU',
        lineTotal: 4.25,
        resolutionStatus: 'unresolved',
        inventoryItemId: null,
        vendorItemId: null,
        packSnapshot: { raw: '1/5 LB' },
      },
    ];
    const linesBefore = JSON.stringify(lines);
    const result = projectHarvillAdoptionMetrics({
      lines,
      harvillVendorId: 'harvill-1',
      snapshot,
      classifier: baseClassifier,
    });

    expect(result.totalHistoricalLines).toBe(3);
    expect(result.unresolvedLinesBefore).toBe(2);
    expect(result.catalogResolvableLinesBefore).toBe(1);
    expect(result.catalogResolvableLinesAfter).toBe(2);
    expect(result.newlyResolvableLines).toBe(1);
    expect(result.newlyResolvableDollars).toBe(31.45);
    expect(result.overallLineMatchRateBefore).toBe(33.33);
    expect(result.overallLineMatchRateAfter).toBe(66.67);
    expect(result.residuals).toEqual([{
      reason: 'no_authoritative_orderly_relationship',
      sourceCodeCount: 1,
      lineCount: 1,
      dollars: 4.25,
      sourceCodes: ['HELD-SKU'],
    }]);
    expect(JSON.stringify(lines)).toBe(linesBefore);
  });
});

describe('Orderly vendor-product adoption APPLY gate', () => {
  it('always fails closed while PM review is pending', async () => {
    await expect(applyOrderlyVendorProductAdoption()).rejects.toMatchObject({
      code: 'PM_APPLY_HELD',
    });
  });
});