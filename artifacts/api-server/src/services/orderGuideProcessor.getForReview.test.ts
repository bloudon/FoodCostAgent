/**
 * Service-level unit tests for OrderGuideProcessor.getForReview() — pack-size mismatch logic.
 *
 * These tests are fully deterministic: no network calls, no database connections.
 * The `../db` module is mocked before any imports resolve, and the IStorage interface
 * is satisfied with minimal in-memory stubs.
 *
 * Scenarios verified:
 *   1. Guide has no vendor assigned → storedCaseSize / storedInnerPackSize are null for
 *      every matched line (no DB lookup attempted).
 *   2. Guide has a vendor + matched line has a prior vendor item with DIFFERENT sizes →
 *      stored sizes are populated on the enriched line.
 *   3. Guide has a vendor + matched line has a prior vendor item with IDENTICAL sizes →
 *      stored sizes are populated (the frontend's hasPackSizeMismatch decides display).
 *   4. Matched line has NO prior vendor item (vendor assigned but no vendor_items row) →
 *      storedCaseSize / storedInnerPackSize are null.
 *   5. Line has matchStatus = "new" (unmatched) → storedCaseSize / storedInnerPackSize
 *      are null regardless of what vendorItems might contain.
 *   6. Multiple matched lines — only the ones with vendor item records get stored sizes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB module BEFORE importing the module under test.
// vi.mock() is hoisted to the top of the file by vitest's transformer.
// ---------------------------------------------------------------------------

const mockDbSelectResult = vi.fn<() => Promise<Array<{
  inventoryItemId: string;
  caseSize: number;
  innerPackSize: number | null;
}>>>();

vi.mock('../db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mockDbSelectResult(),
      }),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER the mock is in place.
// ---------------------------------------------------------------------------

import { OrderGuideProcessor } from './orderGuideProcessor';

// ---------------------------------------------------------------------------
// Minimal IStorage stub — only the three methods getForReview() calls.
// ---------------------------------------------------------------------------

function makeStorage(opts: {
  guide: {
    id: string;
    vendorId: string | null;
    companyId?: string;
    vendorKey?: string;
    source?: string;
    rowCount?: number;
    status?: string;
    fetchedAt?: Date;
    fileName?: string | null;
    effectiveDate?: Date | null;
    expirationDate?: Date | null;
    approvedAt?: Date | null;
    approvedBy?: string | null;
    detectedVendorName?: string | null;
  };
  lines: Array<{
    id: string;
    orderGuideId: string;
    matchStatus: string;
    matchedInventoryItemId: string | null;
    vendorSku?: string;
    productName?: string;
    caseSize?: number | null;
    innerPack?: number | null;
    priceSource?: string | null;
    price?: number | null;
    packSize?: string | null;
    uom?: string | null;
    caseSizeRaw?: string | null;
    innerPackRaw?: string | null;
    matchConfidence?: number | null;
    gtin?: string | null;
    category?: string | null;
    brandName?: string | null;
    userDecision?: string | null;
    createdInventoryItemId?: string | null;
    isVariableWeight?: number;
  }>;
  inventoryItemName?: string;
}) {
  const guide = {
    companyId: 'company-1',
    vendorKey: 'generic',
    source: 'scan',
    rowCount: opts.lines.length,
    status: 'pending_review',
    fetchedAt: new Date(),
    fileName: null,
    effectiveDate: null,
    expirationDate: null,
    approvedAt: null,
    approvedBy: null,
    detectedVendorName: null,
    ...opts.guide,
  };

  const lines = opts.lines.map(l => ({
    vendorSku: 'SKU-001',
    productName: 'Test Product',
    caseSize: 6,
    innerPack: 1,
    priceSource: 'case',
    price: 10.00,
    packSize: null,
    uom: 'LB',
    caseSizeRaw: '6',
    innerPackRaw: null,
    matchConfidence: 0.9,
    gtin: null,
    category: null,
    brandName: null,
    userDecision: null,
    createdInventoryItemId: null,
    isVariableWeight: 0,
    ...l,
  }));

  return {
    getOrderGuide: vi.fn().mockResolvedValue(guide),
    getOrderGuideLines: vi.fn().mockResolvedValue(lines),
    getInventoryItem: vi.fn().mockResolvedValue(
      opts.inventoryItemName
        ? { id: 'inv-1', name: opts.inventoryItemName }
        : undefined,
    ),
  } as unknown as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrderGuideProcessor.getForReview — storedCaseSize / storedInnerPackSize population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets storedCaseSize and storedInnerPackSize to null when guide has no vendor assigned', async () => {
    // Guide has vendorId = null → the processor must skip the DB lookup entirely.
    mockDbSelectResult.mockResolvedValue([]);

    const storage = makeStorage({
      guide: { id: 'og-1', vendorId: null },
      lines: [{
        id: 'line-1',
        orderGuideId: 'og-1',
        matchStatus: 'matched',
        matchedInventoryItemId: 'inv-1',
        caseSize: 6,
        innerPack: 1,
      }],
      inventoryItemName: 'Chicken Breast',
    });

    const processor = new OrderGuideProcessor(storage);
    const result = await processor.getForReview('og-1');

    expect(result.lines.matched).toHaveLength(1);
    const line = result.lines.matched[0];
    expect(line.storedCaseSize, 'No vendor → stored sizes must be null').toBeNull();
    expect(line.storedInnerPackSize, 'No vendor → stored inner pack must be null').toBeNull();
  });

  it('populates storedCaseSize and storedInnerPackSize when a prior vendor item exists', async () => {
    // Prior vendor item has caseSize=4, innerPackSize=3 — different from the imported line.
    mockDbSelectResult.mockResolvedValue([
      { inventoryItemId: 'inv-1', caseSize: 4, innerPackSize: 3 },
    ]);

    const storage = makeStorage({
      guide: { id: 'og-2', vendorId: 'vendor-1' },
      lines: [{
        id: 'line-2',
        orderGuideId: 'og-2',
        matchStatus: 'matched',
        matchedInventoryItemId: 'inv-1',
        caseSize: 6,
        innerPack: 5,
      }],
      inventoryItemName: 'Chicken Breast',
    });

    const processor = new OrderGuideProcessor(storage);
    const result = await processor.getForReview('og-2');

    const line = result.lines.matched[0];
    expect(line.storedCaseSize, 'Stored caseSize from vendor item must be returned').toBe(4);
    expect(line.storedInnerPackSize, 'Stored innerPackSize from vendor item must be returned').toBe(3);
  });

  it('populates storedCaseSize correctly even when stored sizes MATCH the imported sizes', async () => {
    // Sizes are identical — the processor still populates them; hasPackSizeMismatch decides display.
    mockDbSelectResult.mockResolvedValue([
      { inventoryItemId: 'inv-1', caseSize: 6, innerPackSize: 1 },
    ]);

    const storage = makeStorage({
      guide: { id: 'og-3', vendorId: 'vendor-1' },
      lines: [{
        id: 'line-3',
        orderGuideId: 'og-3',
        matchStatus: 'matched',
        matchedInventoryItemId: 'inv-1',
        caseSize: 6,
        innerPack: 1,
      }],
      inventoryItemName: 'Chicken Breast',
    });

    const processor = new OrderGuideProcessor(storage);
    const result = await processor.getForReview('og-3');

    const line = result.lines.matched[0];
    expect(line.storedCaseSize).toBe(6);
    expect(line.storedInnerPackSize).toBe(1);
  });

  it('sets storedCaseSize to null when guide has a vendor but no prior vendor item exists for the matched item', async () => {
    // Vendor is assigned but there is no vendor_items row for this inventory item.
    mockDbSelectResult.mockResolvedValue([]);

    const storage = makeStorage({
      guide: { id: 'og-4', vendorId: 'vendor-1' },
      lines: [{
        id: 'line-4',
        orderGuideId: 'og-4',
        matchStatus: 'matched',
        matchedInventoryItemId: 'inv-1',
        caseSize: 6,
        innerPack: 1,
      }],
      inventoryItemName: 'Chicken Breast',
    });

    const processor = new OrderGuideProcessor(storage);
    const result = await processor.getForReview('og-4');

    const line = result.lines.matched[0];
    expect(line.storedCaseSize, 'No matching vendor item → stored sizes must be null').toBeNull();
    expect(line.storedInnerPackSize, 'No matching vendor item → stored inner pack must be null').toBeNull();
  });

  it('sets storedCaseSize to null for new-item lines (matchedInventoryItemId = null)', async () => {
    // New-item lines have no matched inventory item → no vendor item lookup → nulls.
    mockDbSelectResult.mockResolvedValue([]);

    const storage = makeStorage({
      guide: { id: 'og-5', vendorId: 'vendor-1' },
      lines: [{
        id: 'line-5',
        orderGuideId: 'og-5',
        matchStatus: 'new',
        matchedInventoryItemId: null,
        caseSize: 6,
        innerPack: 1,
      }],
    });

    const processor = new OrderGuideProcessor(storage);
    const result = await processor.getForReview('og-5');

    expect(result.lines.new).toHaveLength(1);
    const line = result.lines.new[0];
    expect(line.storedCaseSize, 'New item line must have null storedCaseSize').toBeNull();
    expect(line.storedInnerPackSize, 'New item line must have null storedInnerPackSize').toBeNull();
  });

  it('correctly populates storedInnerPackSize = null when the vendor item has no innerPackSize', async () => {
    // innerPackSize is null in the vendor_items row (single-unit pack).
    mockDbSelectResult.mockResolvedValue([
      { inventoryItemId: 'inv-1', caseSize: 6, innerPackSize: null },
    ]);

    const storage = makeStorage({
      guide: { id: 'og-6', vendorId: 'vendor-1' },
      lines: [{
        id: 'line-6',
        orderGuideId: 'og-6',
        matchStatus: 'matched',
        matchedInventoryItemId: 'inv-1',
        caseSize: 6,
        innerPack: 1,
      }],
      inventoryItemName: 'Cheddar Cheese',
    });

    const processor = new OrderGuideProcessor(storage);
    const result = await processor.getForReview('og-6');

    const line = result.lines.matched[0];
    expect(line.storedCaseSize).toBe(6);
    expect(line.storedInnerPackSize).toBeNull();
  });

  it('only populates storedCaseSize for lines that have a matching vendor item — other matched lines remain null', async () => {
    // Two matched lines: one has a vendor item record, the other does not.
    mockDbSelectResult.mockResolvedValue([
      { inventoryItemId: 'inv-1', caseSize: 4, innerPackSize: null },
      // inv-2 is intentionally absent → no vendor item exists for it
    ]);

    const storage = makeStorage({
      guide: { id: 'og-7', vendorId: 'vendor-1' },
      lines: [
        {
          id: 'line-7a',
          orderGuideId: 'og-7',
          matchStatus: 'matched',
          matchedInventoryItemId: 'inv-1',
          caseSize: 6,
          innerPack: 1,
        },
        {
          id: 'line-7b',
          orderGuideId: 'og-7',
          matchStatus: 'matched',
          matchedInventoryItemId: 'inv-2',
          caseSize: 12,
          innerPack: 1,
        },
      ],
      inventoryItemName: 'Some Item',
    });

    const processor = new OrderGuideProcessor(storage);
    const result = await processor.getForReview('og-7');

    expect(result.lines.matched).toHaveLength(2);

    const lineA = result.lines.matched.find(l => l.id === 'line-7a')!;
    const lineB = result.lines.matched.find(l => l.id === 'line-7b')!;

    expect(lineA.storedCaseSize, 'Line with vendor item must have stored size').toBe(4);
    expect(lineB.storedCaseSize, 'Line without vendor item must have null stored size').toBeNull();
  });

  it('throws when the order guide does not exist', async () => {
    const storage = {
      getOrderGuide: vi.fn().mockResolvedValue(undefined),
      getOrderGuideLines: vi.fn().mockResolvedValue([]),
      getInventoryItem: vi.fn().mockResolvedValue(undefined),
    } as unknown as any;

    const processor = new OrderGuideProcessor(storage);
    await expect(processor.getForReview('nonexistent-id')).rejects.toThrow('Order guide not found');
  });

  it('groups lines by matchStatus into matched / ambiguous / new buckets', async () => {
    mockDbSelectResult.mockResolvedValue([]);

    const storage = makeStorage({
      guide: { id: 'og-8', vendorId: null },
      lines: [
        { id: 'l-m', orderGuideId: 'og-8', matchStatus: 'matched', matchedInventoryItemId: 'inv-1' },
        { id: 'l-a', orderGuideId: 'og-8', matchStatus: 'ambiguous', matchedInventoryItemId: 'inv-2' },
        { id: 'l-n', orderGuideId: 'og-8', matchStatus: 'new', matchedInventoryItemId: null },
      ],
      inventoryItemName: 'Item',
    });

    const processor = new OrderGuideProcessor(storage);
    const result = await processor.getForReview('og-8');

    expect(result.lines.matched).toHaveLength(1);
    expect(result.lines.ambiguous).toHaveLength(1);
    expect(result.lines.new).toHaveLength(1);
    expect(result.summary.total).toBe(3);
    expect(result.summary.matched).toBe(1);
    expect(result.summary.ambiguous).toBe(1);
    expect(result.summary.new).toBe(1);
  });
});
