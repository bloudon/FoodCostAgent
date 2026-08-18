/**
 * Regression: a lost vendor-item creation race in the order-guide import
 * must not perform ANY side effects — no price stamp and no structural sync
 * of case size / brand / variable-weight metadata onto the shared inventory
 * item (the race winner's data must stand).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('./vendorItemResolution', () => ({
  getOrCreateVendorItem: vi.fn(),
}));
vi.mock('./vendorPriceService', () => ({
  recordVendorPrice: vi.fn(),
}));

import { OrderGuideProcessor } from './orderGuideProcessor';
import { getOrCreateVendorItem } from './vendorItemResolution';
import { recordVendorPrice } from './vendorPriceService';

const line = {
  vendorSku: 'RACE-SKU',
  matchedInventoryItemId: 'item-1',
  caseSize: 6,
  innerPack: 4,
  price: 42,
  uom: 'lb',
};

function makeProcessor() {
  const storage: any = {
    getVendorItems: vi.fn().mockResolvedValue([]), // initial lookup misses
    getInventoryItem: vi.fn().mockResolvedValue({ id: 'item-1', unitId: 'unit-1', caseSize: 24 }),
    getUnits: vi.fn().mockResolvedValue([{ id: 'unit-1', name: 'pound', kind: 'weight', toBaseRatio: 1 }]),
    updateVendorItem: vi.fn(),
    updateInventoryItem: vi.fn(),
  };
  const processor = new OrderGuideProcessor(storage);
  const syncSpy = vi
    .spyOn(processor as any, 'syncVendorDataToInventoryItem')
    .mockResolvedValue(undefined);
  return { processor, storage, syncSpy };
}

beforeEach(() => {
  vi.mocked(getOrCreateVendorItem).mockReset();
  vi.mocked(recordVendorPrice).mockReset();
});

describe('createVendorItemForExisting — identity is the full (vendor, item, SKU) triple', () => {
  it('same vendor+SKU on a DIFFERENT inventory item does not mutate the other row; resolves the correct triple', async () => {
    const { processor, storage, syncSpy } = makeProcessor();
    // Existing row shares vendor + SKU but belongs to another inventory item.
    const otherItemRow = { id: 'other-vi', vendorId: 'v1', inventoryItemId: 'OTHER-item', vendorSku: 'RACE-SKU', caseSize: 99 };
    storage.getVendorItems.mockResolvedValue([otherItemRow]);
    vi.mocked(getOrCreateVendorItem).mockResolvedValue({
      vendorItem: { id: 'new-vi', vendorId: 'v1', inventoryItemId: 'item-1', vendorSku: 'RACE-SKU', caseSize: 6 } as any,
      created: true,
    });

    const created = await (processor as any).createVendorItemForExisting(line, 'v1', 'c1');

    expect(created).toBe(true);
    // The other item's row is never structurally updated or price-stamped.
    expect(storage.updateVendorItem).not.toHaveBeenCalled();
    // Resolution went through the shared resolver with the FULL triple.
    expect(vi.mocked(getOrCreateVendorItem).mock.calls[0][1]).toMatchObject({
      vendorId: 'v1',
      inventoryItemId: 'item-1',
      vendorSku: 'RACE-SKU',
    });
    // Price stamped against the correct (new) row only.
    expect(vi.mocked(recordVendorPrice).mock.calls[0][0]).toMatchObject({ vendorItemId: 'new-vi' });
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it('same-triple existing row takes the intentional re-import refresh path (no resolver call, no duplicate)', async () => {
    const { processor, storage } = makeProcessor();
    const sameTripleRow = { id: 'existing-vi', vendorId: 'v1', inventoryItemId: 'item-1', vendorSku: 'RACE-SKU', caseSize: 12 };
    storage.getVendorItems.mockResolvedValue([sameTripleRow]);

    const created = await (processor as any).createVendorItemForExisting(line, 'v1', 'c1');

    expect(created).toBe(false);
    expect(getOrCreateVendorItem).not.toHaveBeenCalled();
    // Refresh writes target the same-triple row only, through the shared gate.
    expect(vi.mocked(storage.updateVendorItem).mock.calls[0][0]).toBe('existing-vi');
    expect(vi.mocked(recordVendorPrice).mock.calls[0][0]).toMatchObject({ vendorItemId: 'existing-vi' });
  });
});

describe('createVendorItemForExisting — resolver race outcomes', () => {
  it('lost race (created: false): no price stamp, no inventory sync, reports not-created', async () => {
    const { processor, storage, syncSpy } = makeProcessor();
    vi.mocked(getOrCreateVendorItem).mockResolvedValue({
      vendorItem: { id: 'winner-vi', vendorId: 'v1', inventoryItemId: 'item-1', vendorSku: 'RACE-SKU', caseSize: 12 } as any,
      created: false,
    });

    const created = await (processor as any).createVendorItemForExisting(line, 'v1', 'c1');

    expect(created).toBe(false);
    expect(recordVendorPrice).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalled();
    expect(storage.updateInventoryItem).not.toHaveBeenCalled();
    expect(storage.updateVendorItem).not.toHaveBeenCalled();
  });

  it('won race (created: true): stamps price and syncs structural data', async () => {
    const { processor, syncSpy } = makeProcessor();
    vi.mocked(getOrCreateVendorItem).mockResolvedValue({
      vendorItem: { id: 'new-vi', vendorId: 'v1', inventoryItemId: 'item-1', vendorSku: 'RACE-SKU', caseSize: 6 } as any,
      created: true,
    });

    const created = await (processor as any).createVendorItemForExisting(line, 'v1', 'c1');

    expect(created).toBe(true);
    expect(recordVendorPrice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordVendorPrice).mock.calls[0][0]).toMatchObject({ vendorItemId: 'new-vi', source: 'order_guide_import' });
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
});
