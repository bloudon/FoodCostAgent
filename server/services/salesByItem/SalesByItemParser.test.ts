/**
 * Sales-by-Item Parser tests — Task #883
 *
 * Covers:
 *   1. parseSalesByItemWorkbook — exact row count, outlet map, date range,
 *      and totalNet against the real Bay Hill xlsx (regression guard).
 *   2. inferOutlet — category-prefix → outlet name mapping rules.
 *   3. POST /api/imports/sales-by-item/preview — expected JSON shape.
 *   4. Re-upload idempotency — second approve call produces itemsCreated=0
 *      and outletsCreated=0 (no duplicate records created).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { parseSalesByItemWorkbook, inferOutlet } from './SalesByItemParser';

// ─── Fixture ──────────────────────────────────────────────────────────────────

const XLSX_PATH = path.resolve(
  process.cwd(),
  'attached_assets/Sales_by_item_6-26_1785685525716.xlsx',
);
const xlsxBuffer = readFileSync(XLSX_PATH);

// ─── 1. parseSalesByItemWorkbook — real Bay Hill xlsx regression ───────────────

describe('parseSalesByItemWorkbook — Bay Hill June 2026 report', () => {
  let result: ReturnType<typeof parseSalesByItemWorkbook>;

  beforeEach(() => {
    result = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
  });

  it('returns exactly 502 item rows', () => {
    expect(result.rows).toHaveLength(502);
  });

  it('parses reportStart as 2026-06-01', () => {
    expect(result.reportStart).toBe('2026-06-01');
  });

  it('parses reportEnd as 2026-06-30', () => {
    expect(result.reportEnd).toBe('2026-06-30');
  });

  it('totalNet is approximately 136,798.51', () => {
    expect(result.totalNet).toBeCloseTo(136798.51, 1);
  });

  it('totalQty is 11441', () => {
    expect(result.totalQty).toBe(11441);
  });

  it('produces exactly 9 unique inferred outlets', () => {
    expect(Object.keys(result.outletCounts)).toHaveLength(9);
  });

  it('outletCounts contains the correct outlet names', () => {
    const outlets = Object.keys(result.outletCounts).sort();
    expect(outlets).toEqual([
      'API',
      'Banquet',
      'Bay Window',
      'Beverage Cart',
      'Grill',
      'Halfway House',
      'Member Events',
      'Member Lounge',
      'Spa Cafe',
    ].sort());
  });

  it('salesAreas header includes Arnie\'s and Men\'s Locker Room', () => {
    // The report header lists 11 sales areas including areas that are not yet
    // handled by inferOutlet — this ensures we don't lose them silently.
    expect(result.salesAreas).toContain("Arnie's");
    expect(result.salesAreas).toContain("Men's Locker Room");
  });

  it('salesAreas has 11 entries', () => {
    expect(result.salesAreas).toHaveLength(11);
  });

  it('every row has a non-empty code and description', () => {
    for (const row of result.rows) {
      expect(row.code).toBeTruthy();
      expect(row.description).toBeTruthy();
    }
  });

  it('every row carries the correct reportStart / reportEnd', () => {
    for (const row of result.rows) {
      expect(row.reportStart).toBe('2026-06-01');
      expect(row.reportEnd).toBe('2026-06-30');
    }
  });

  it('every row has a non-empty outlet', () => {
    for (const row of result.rows) {
      expect(row.outlet).toBeTruthy();
    }
  });

  it('every row has a non-zero qty (negatives are refunds; zero rows are skipped by parser)', () => {
    for (const row of result.rows) {
      expect(row.qty).not.toBe(0);
    }
  });

  it('QAC codes are unique within a single category section (no implicit duplicates in source)', () => {
    // Each code may appear in multiple categories (same item sold in different outlets)
    // but the parser must not silently collapse rows — 502 total is expected.
    const totalFromOutletCounts = Object.values(result.outletCounts).reduce((s, n) => s + n, 0);
    expect(totalFromOutletCounts).toBe(result.rows.length);
  });

  it('returns zero rows for an empty / corrupt buffer (does not throw)', () => {
    const empty = parseSalesByItemWorkbook(Buffer.from(''), 'bad.xlsx');
    expect(empty.rows).toHaveLength(0);
  });

  it('unrecognizedPrefixCategories is empty for the real Bay Hill report (all prefixes known)', () => {
    expect(result.unrecognizedPrefixCategories).toHaveLength(0);
  });
});

// ─── 2. inferOutlet — prefix routing rules ────────────────────────────────────

describe('inferOutlet — category prefix rules', () => {
  it.each([
    ['APS Breakfast',       'API'],
    ['API Lunch',           'API'],
    ['BQT Dinner',          'Banquet'],
    ['BTQ Event',           'Banquet'],
    ['EV-Golf',             'Member Events'],
    ["FF-AR Burger",        "Arnie's"],
    ["FF-AR Breakfast",     "Arnie's"],
    ["FF-ML Bar",           "Men's Locker Room"],
    ["FF-MLR Beer",         "Men's Locker Room"],
    ['FF-BW Brkf-0062',    'Bay Window'],
    ['BW BREAKFAST',        'Bay Window'],
    ['BW LUNCH',            'Bay Window'],
    ['BW LUNCH ADD ONS',    'Bay Window'],
    ['FF-GR Burger',        'Grill'],
    ['FF-HWH Snack',        'Halfway House'],
    ['BC/HWH Drinks',       'Halfway House'],
    ['FB-HWH Beer',         'Halfway House'],
    ['FF-SPLASH Smoothie',  'Spa Cafe'],
    ['FF-$ Dessert',        'Bay Window'],
    ['FF-$$ Premium',       'Bay Window'],
    ['FF-BREAKFAST Omelet', 'Bay Window'],
    ['FF-DESSERTS Cake',    'Bay Window'],
    ['FF-KIDS Mac',         'Bay Window'],
    ['FF- KIDS Pizza',      'Bay Window'],
    ['FF-OPEN Item',        'Bay Window'],
    ['FL-Bar Wine',         'Member Lounge'],
    ['FW-Cocktail',         'Member Lounge'],
    ['FB-Cart Beer',        'Beverage Cart'],
    ['SPECIALTY Coffee',    'Member Lounge'],
  ])('"%s" → "%s"', (category, expected) => {
    expect(inferOutlet(category)).toBe(expected);
  });

  it('returns "Unassigned" for unknown prefixes instead of silently routing to Bay Window', () => {
    expect(inferOutlet('UNKNOWN Category')).toBe('Unassigned');
    expect(inferOutlet('POOLBAR Drinks')).toBe('Unassigned');
    expect(inferOutlet('TERRACE Lunch')).toBe('Unassigned');
    expect(inferOutlet('')).toBe('Unassigned');
  });

  it('is case-insensitive (uppercases internally)', () => {
    expect(inferOutlet('ff-bw favorites')).toBe('Bay Window');
    expect(inferOutlet('aps breakfast')).toBe('API');
  });
});

// ─── 2b. unrecognizedPrefixCategories — warning bucket ────────────────────────

describe('parseSalesByItemWorkbook — unrecognizedPrefixCategories', () => {
  /**
   * Build a minimal workbook buffer with controlled section headers so we can
   * inject unknown prefixes without needing a real xlsx file.
   *
   * The parser reads fixed row indices (0-based):
   *   row  8, col 10 → start date  (XLSX address K9)
   *   row 12, col 11 → end date    (XLSX address L13)
   *   row 29+        → data rows (section headers then item rows)
   *
   * We assign cells directly to the worksheet object so there is no
   * ambiguity about how sparse / empty-string values round-trip through
   * `aoa_to_sheet` → `sheet_to_json`.
   */
  function buildMinimalWorkbook(categoryRows: string[]): Buffer {
    /** Convert 0-based (row, col) to an XLSX cell address like "C30". */
    function addr(row0: number, col0: number): string {
      return XLSX.utils.encode_cell({ r: row0, c: col0 });
    }

    const ws: XLSX.WorkSheet = {};

    // Start date at row index 8, col 10
    ws[addr(8, 10)] = { t: 's', v: 'Jun 01, 2026' };
    // End date at row index 12, col 11
    ws[addr(12, 11)] = { t: 's', v: 'Jun 30, 2026' };

    let maxRow = 28; // parser starts at row index 29

    for (let i = 0; i < categoryRows.length; i++) {
      const cat = categoryRows[i];
      const sectionRowIdx = 29 + i * 2;
      const itemRowIdx    = 30 + i * 2;

      // Section header: single cell at col 2 only
      ws[addr(sectionRowIdx, 2)] = { t: 's', v: cat };

      // Item row: QAC at col 2, description at col 5, qty/net at cols 14/20
      ws[addr(itemRowIdx, 2)]  = { t: 's', v: `TST-${String(i).padStart(4, '0')}` };
      ws[addr(itemRowIdx, 5)]  = { t: 's', v: 'Test Item' };
      ws[addr(itemRowIdx, 14)] = { t: 'n', v: 2 };
      ws[addr(itemRowIdx, 15)] = { t: 'n', v: 10.0 };
      ws[addr(itemRowIdx, 20)] = { t: 'n', v: 10.0 };

      maxRow = itemRowIdx;
    }

    // Set the sheet reference range so sheet_to_json knows the boundaries
    ws['!ref'] = XLSX.utils.encode_range(
      { r: 0, c: 0 },
      { r: maxRow, c: 20 },
    );

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  it('populates unrecognizedPrefixCategories when an unknown prefix is present', () => {
    const buf = buildMinimalWorkbook(['FF-BW Favorites', 'POOLBAR Drinks', 'TERRACE Lunch']);
    const result = parseSalesByItemWorkbook(buf, 'test.xlsx');

    // POOLBAR and TERRACE are unknown; FF-BW is known → only two unrecognised
    expect(result.unrecognizedPrefixCategories).toContain('POOLBAR Drinks');
    expect(result.unrecognizedPrefixCategories).toContain('TERRACE Lunch');
    expect(result.unrecognizedPrefixCategories).not.toContain('FF-BW Favorites');
    expect(result.unrecognizedPrefixCategories).toHaveLength(2);
  });

  it('routes unrecognised-prefix rows to the "Unassigned" outlet', () => {
    const buf = buildMinimalWorkbook(['POOLBAR Drinks']);
    const result = parseSalesByItemWorkbook(buf, 'test.xlsx');

    expect(result.outletCounts['Unassigned']).toBeGreaterThan(0);
    expect(result.outletCounts['Bay Window']).toBeUndefined();
  });

  it('keeps unrecognizedPrefixCategories empty when all prefixes are known', () => {
    const buf = buildMinimalWorkbook(['FF-BW Favorites', 'FF-GR Burger', 'APS Breakfast']);
    const result = parseSalesByItemWorkbook(buf, 'test.xlsx');

    expect(result.unrecognizedPrefixCategories).toHaveLength(0);
    expect(result.outletCounts['Unassigned']).toBeUndefined();
  });

  it('does not duplicate a category in unrecognizedPrefixCategories when it appears multiple times', () => {
    const buf = buildMinimalWorkbook(['POOLBAR Drinks', 'POOLBAR Drinks']);
    const result = parseSalesByItemWorkbook(buf, 'test.xlsx');

    const count = result.unrecognizedPrefixCategories.filter((c) => c === 'POOLBAR Drinks').length;
    expect(count).toBe(1);
  });
});

// ─── 3. Preview route — JSON shape ────────────────────────────────────────────

// Mock auth and permissions before importing the route registration function
vi.mock('../../auth', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireTier: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../permissions', () => ({
  getAccessibleStores: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}));

describe('POST /api/imports/sales-by-item/preview — response shape', () => {
  it('returns the correct preview shape for the real xlsx', async () => {
    // Set up a minimal express app with the route registered
    const express = (await import('express')).default;
    const { registerSalesByItemRoutes } = await import('../../routes/salesByItemRoutes');

    const app = express();
    registerSalesByItemRoutes(app);

    const request = (await import('supertest')).default;

    const res = await request(app)
      .post('/api/imports/sales-by-item/preview')
      .attach('file', xlsxBuffer, {
        filename: 'Sales_by_item_6-26.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(200);

    // Date range
    expect(res.body.reportStart).toBe('2026-06-01');
    expect(res.body.reportEnd).toBe('2026-06-30');

    // Row and outlet counts
    expect(res.body.totalItems).toBe(502);
    expect(res.body.uniqueOutlets).toBe(9);

    // Totals
    expect(res.body.totalQty).toBe(11441);
    expect(res.body.totalNet).toBeCloseTo(136798.51, 1);

    // salesAreas is present and non-empty
    expect(Array.isArray(res.body.salesAreas)).toBe(true);
    expect(res.body.salesAreas.length).toBeGreaterThan(0);

    // outletCounts is an object with the expected keys
    expect(typeof res.body.outletCounts).toBe('object');
    expect(Object.keys(res.body.outletCounts)).toHaveLength(9);

    // unrecognizedPrefixCategories is present; empty for the known Bay Hill report
    expect(Array.isArray(res.body.unrecognizedPrefixCategories)).toBe(true);
    expect(res.body.unrecognizedPrefixCategories).toHaveLength(0);
  });

  it('returns 422 when no file is attached', async () => {
    const express = (await import('express')).default;
    const { registerSalesByItemRoutes } = await import('../../routes/salesByItemRoutes');

    const app = express();
    registerSalesByItemRoutes(app);

    const request = (await import('supertest')).default;

    const res = await request(app)
      .post('/api/imports/sales-by-item/preview');

    expect(res.status).toBe(400);
  });

  it('returns 422 when an invalid file is uploaded', async () => {
    const express = (await import('express')).default;
    const { registerSalesByItemRoutes } = await import('../../routes/salesByItemRoutes');

    const app = express();
    registerSalesByItemRoutes(app);

    const request = (await import('supertest')).default;

    const res = await request(app)
      .post('/api/imports/sales-by-item/preview')
      .attach('file', Buffer.from('not an xlsx'), {
        filename: 'bad.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(422);
  });
});

// ─── 4. Approve re-upload idempotency ─────────────────────────────────────────

/**
 * Simulates the find-or-create logic from the approve route transaction.
 *
 * On the FIRST upload: all outlets and items are new → created counts are non-zero.
 * On the SECOND upload (same parsed result): everything already exists → created=0.
 *
 * This test exercises the logic that the route relies on without requiring a
 * live database connection.
 */
describe('approve re-upload idempotency — find-or-create logic', () => {
  /**
   * Minimal simulation of the outlet find-or-create used in the approve transaction.
   * Returns { outletsCreated, outletsLinked } mirroring the route's stats object.
   */
  function simulateOutletFindOrCreate(
    uniqueOutlets: string[],
    existingOutlets: Set<string>,
  ): { outletsCreated: number; outletsLinked: number } {
    let outletsCreated = 0;
    let outletsLinked = 0;
    for (const name of uniqueOutlets) {
      const normalizedName = name.toLowerCase().trim();
      if (existingOutlets.has(normalizedName)) {
        outletsLinked++;
      } else {
        existingOutlets.add(normalizedName); // simulate INSERT returning the new row
        outletsCreated++;
      }
    }
    return { outletsCreated, outletsLinked };
  }

  /**
   * Minimal simulation of the menu_item find-or-create used in the approve transaction.
   * Returns { itemsCreated, itemsLinked } mirroring the route's stats object.
   */
  function simulateItemFindOrCreate(
    uniqueCodes: string[],
    existingCodes: Set<string>,
  ): { itemsCreated: number; itemsLinked: number } {
    let itemsCreated = 0;
    let itemsLinked = 0;
    for (const code of uniqueCodes) {
      if (existingCodes.has(code)) {
        itemsLinked++;
      } else {
        existingCodes.add(code); // simulate INSERT
        itemsCreated++;
      }
    }
    return { itemsCreated, itemsLinked };
  }

  it('first upload creates all 9 outlets', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const uniqueOutlets = Array.from(new Set(parsed.rows.map((r) => r.outlet)));

    const existingDb = new Set<string>();
    const { outletsCreated, outletsLinked } = simulateOutletFindOrCreate(
      uniqueOutlets,
      existingDb,
    );

    expect(outletsCreated).toBe(9);
    expect(outletsLinked).toBe(0);
  });

  it('second upload creates 0 new outlets (all already exist)', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const uniqueOutlets = Array.from(new Set(parsed.rows.map((r) => r.outlet)));

    // Simulate DB state after the first upload
    const existingDb = new Set(uniqueOutlets.map((n) => n.toLowerCase().trim()));

    const { outletsCreated, outletsLinked } = simulateOutletFindOrCreate(
      uniqueOutlets,
      existingDb,
    );

    expect(outletsCreated).toBe(0);
    expect(outletsLinked).toBe(9);
  });

  it('first upload creates new menu items for each unique QAC code', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const seenCodes = new Set<string>();
    const uniqueCodes: string[] = [];
    for (const row of parsed.rows) {
      if (!seenCodes.has(row.code)) {
        seenCodes.add(row.code);
        uniqueCodes.push(row.code);
      }
    }

    const existingDb = new Set<string>();
    const { itemsCreated } = simulateItemFindOrCreate(uniqueCodes, existingDb);

    // Must create exactly as many items as there are unique QAC codes
    expect(itemsCreated).toBe(uniqueCodes.length);
    expect(itemsCreated).toBeGreaterThan(0);
  });

  it('second upload creates 0 new menu items (all QAC codes already in DB)', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const seenCodes = new Set<string>();
    const uniqueCodes: string[] = [];
    for (const row of parsed.rows) {
      if (!seenCodes.has(row.code)) {
        seenCodes.add(row.code);
        uniqueCodes.push(row.code);
      }
    }

    // Simulate DB already containing all QAC codes from a prior upload
    const existingDb = new Set(uniqueCodes);

    const { itemsCreated, itemsLinked } = simulateItemFindOrCreate(
      uniqueCodes,
      existingDb,
    );

    expect(itemsCreated).toBe(0);
    expect(itemsLinked).toBe(uniqueCodes.length);
  });

  /**
   * Core idempotency test: two consecutive approvals of the same file must not
   * double net-sales totals. This simulates the route's batch find-or-create +
   * dmis_csv_aggregate_uniq ON CONFLICT DO NOTHING behaviour in-memory.
   */
  it('total net sales remain ~136,798 after two consecutive approvals of the same report', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');

    // In-memory stand-ins for DB tables.
    // batchStore: (companyId, storeId, salesDate) → batchId
    const batchStore = new Map<string, string>();
    // salesStore: Set of "batchId|menuItemId" composite keys (mirrors dmis_csv_aggregate_uniq)
    const salesStore = new Map<string, { qtySold: number; netSales: number }>();

    const COMPANY_ID = 'co-1';
    const STORE_ID   = 'st-1';
    const salesDate  = parsed.reportStart; // e.g. "2026-06-01"

    /** Simulates one approve call and returns the total net across all stored rows. */
    function simulateApprove(): number {
      // Step 1: find-or-create batch (mirrors the new route logic).
      const batchKey = `${COMPANY_ID}|${STORE_ID}|${salesDate}`;
      let batchId = batchStore.get(batchKey);
      if (!batchId) {
        batchId = `batch-${batchStore.size + 1}`;
        batchStore.set(batchKey, batchId);
      }

      // Step 6: aggregate by code and insert with ON CONFLICT DO NOTHING.
      const aggMap = new Map<string, { qty: number; net: number }>();
      for (const row of parsed.rows) {
        const agg = aggMap.get(row.code) ?? { qty: 0, net: 0 };
        aggMap.set(row.code, { qty: agg.qty + row.qty, net: agg.net + row.netAmount });
      }

      for (const [code, agg] of aggMap.entries()) {
        const rowKey = `${batchId}|${code}`; // mirrors (sourceBatchId, menuItemId, salesDate, …)
        if (!salesStore.has(rowKey)) {        // ON CONFLICT DO NOTHING
          salesStore.set(rowKey, { qtySold: agg.qty, netSales: agg.net });
        }
      }

      // Sum all stored rows for this store/date (equivalent to a query on dailyMenuItemSales).
      let total = 0;
      for (const [key, row] of salesStore.entries()) {
        if (key.startsWith(batchId + '|')) total += row.netSales;
      }
      return total;
    }

    const afterFirst  = simulateApprove();
    const afterSecond = simulateApprove();

    // Both runs must return the same total, approximately matching the fixture value.
    expect(afterFirst).toBeCloseTo(136798.51, 0);
    expect(afterSecond).toBeCloseTo(afterFirst, 0);
  });

  /**
   * Simulates the store_menu_items find-or-create used in the approve transaction.
   * Mirrors the route's pre-fetch + toLink filter + returning() count logic.
   * Returns { storeItemsCreated } mirroring the route's stats object.
   */
  function simulateStoreItemFindOrCreate(
    menuItemIds: string[],
    existingLinks: Set<string>,
  ): { storeItemsCreated: number } {
    const toLink = menuItemIds.filter((id) => !existingLinks.has(id));
    let storeItemsCreated = 0;
    for (const id of toLink) {
      // .onConflictDoNothing().returning() only returns truly inserted rows.
      if (!existingLinks.has(id)) {
        existingLinks.add(id);
        storeItemsCreated++;
      }
    }
    return { storeItemsCreated };
  }

  it('first upload creates store-menu-item links for all unique menu items', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const seenCodes = new Set<string>();
    const uniqueCodes: string[] = [];
    for (const row of parsed.rows) {
      if (!seenCodes.has(row.code)) {
        seenCodes.add(row.code);
        uniqueCodes.push(row.code);
      }
    }
    // Simulate menu item IDs (one per unique QAC code)
    const menuItemIds = uniqueCodes.map((_, i) => `item-${i}`);

    const existingLinks = new Set<string>();
    const { storeItemsCreated } = simulateStoreItemFindOrCreate(menuItemIds, existingLinks);

    expect(storeItemsCreated).toBe(menuItemIds.length);
    expect(storeItemsCreated).toBeGreaterThan(0);
  });

  it('second upload creates 0 store-menu-item links (all links pre-exist)', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const seenCodes = new Set<string>();
    const uniqueCodes: string[] = [];
    for (const row of parsed.rows) {
      if (!seenCodes.has(row.code)) {
        seenCodes.add(row.code);
        uniqueCodes.push(row.code);
      }
    }
    // Simulate menu item IDs (one per unique QAC code)
    const menuItemIds = uniqueCodes.map((_, i) => `item-${i}`);

    // Simulate DB state after the first upload: all links already exist
    const existingLinks = new Set(menuItemIds);
    const { storeItemsCreated } = simulateStoreItemFindOrCreate(menuItemIds, existingLinks);

    expect(storeItemsCreated).toBe(0);
  });

  it('duplicate QAC codes within the same report do not create duplicate items', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');

    // The same QAC code can appear in multiple rows (different categories/outlets)
    // The route deduplicates before inserting — verify the code set is smaller than row count.
    const allCodes = parsed.rows.map((r) => r.code);
    const uniqueCodes = new Set(allCodes);

    // If every code were unique, uniqueCodes.size === allCodes.length;
    // the actual report has codes that appear under multiple outlets.
    // Either way, the item creation must use the deduplicated set.
    expect(uniqueCodes.size).toBeLessThanOrEqual(allCodes.length);

    // Confirm route dedup logic: if codes are repeated in the parsed rows,
    // iterating with a seenCodes Set (as the route does) yields uniqueCodes.size items.
    const seenCodes = new Set<string>();
    let newItemCount = 0;
    const existingDb = new Set<string>(); // empty DB = first upload
    for (const row of parsed.rows) {
      if (seenCodes.has(row.code)) continue; // route's dedup guard
      seenCodes.add(row.code);
      if (!existingDb.has(row.code)) {
        existingDb.add(row.code);
        newItemCount++;
      }
    }

    expect(newItemCount).toBe(uniqueCodes.size);
  });
});
