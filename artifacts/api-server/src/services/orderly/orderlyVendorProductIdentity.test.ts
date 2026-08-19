import { describe, expect, it } from 'vitest';
import {
  classifyOrderlyVendorProductIdentity,
  type OrderlyVendorProductCandidate,
} from './orderlyVendorProductIdentity';

function candidate(
  id: string,
  inventoryItemId: string,
  overrides: Partial<OrderlyVendorProductCandidate> = {},
): OrderlyVendorProductCandidate {
  return {
    id,
    vendorId: 'vendor-1',
    inventoryItemId,
    vendorSku: null,
    brandName: null,
    purchaseUnitId: 'unit-each',
    caseSize: 6,
    innerPackSize: 4,
    packUom: 'oz',
    lastPrice: 1,
    lastCasePrice: 24,
    active: 1,
    priceSource: null,
    canonicalQtyPerPurchaseUnit: 24,
    pricingBasis: 'purchase_unit',
    isVariableWeight: 0,
    packGeometryStatus: 'verified',
    pricedAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe('classifyOrderlyVendorProductIdentity', () => {
  it('elects the authoritative mapped vendor product among equivalent sibling rows', () => {
    const mapped = candidate('mapped', 'item-1');
    const newerSibling = candidate('newer', 'item-1', { updatedAt: new Date('2026-08-01') });
    const decision = classifyOrderlyVendorProductIdentity({
      candidates: [newerSibling, mapped],
      mappedInventoryItemIds: ['item-1'],
      mappedVendorItemIds: ['mapped'],
      sourcePackRawValues: ['6/4 OZ'],
      sourceDescriptions: ['Chicken Breast'],
    });
    expect(decision.classification).toBe('SAFE_CANDIDATE');
    expect(decision.canonicalVendorItem?.id).toBe('mapped');
  });

  it('fails closed when a mapped product collides with a same-code candidate for another inventory item', () => {
    const decision = classifyOrderlyVendorProductIdentity({
      candidates: [
        candidate('mapped', 'item-1'),
        candidate('same-code-collision', 'item-2'),
      ],
      mappedInventoryItemIds: ['item-1'],
      mappedVendorItemIds: ['mapped'],
      sourcePackRawValues: ['6/4 OZ'],
      sourceDescriptions: ['Chicken Breast'],
    });
    expect(decision.classification).toBe('AMBIGUOUS');
    expect(decision.reasons).toContain(
      'The source item code is associated with more than one inventory item.',
    );
  });

  it('fails closed when one source identity carries materially different descriptions', () => {
    const decision = classifyOrderlyVendorProductIdentity({
      candidates: [candidate('mapped', 'item-1')],
      mappedInventoryItemIds: ['item-1'],
      mappedVendorItemIds: ['mapped'],
      sourcePackRawValues: ['6/4 OZ', '6/4 OZ'],
      sourceDescriptions: ['Chicken Breast', 'Dishwasher Detergent'],
    });
    expect(decision.classification).toBe('CONFLICT');
    expect(decision.reasons).toContain(
      'The source item code appears with materially different product descriptions.',
    );
  });
});