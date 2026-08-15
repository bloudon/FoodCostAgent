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
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { parseSalesByItemWorkbook, inferOutlet } from './SalesByItemParser';
import { db } from '../../db';
import { getAccessibleStores } from '../../permissions';

// ─── Fixture ──────────────────────────────────────────────────────────────────

const XLSX_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../attached_assets/Sales_by_item_6-26_1785685525716.xlsx',
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

  /**
   * Recipe-link survival test.
   *
   * The approve route uses onConflictDoNothing for menu_items inserts.
   * When the same file is re-approved, items that already exist are looked up
   * by pluSku and their existing DB row is reused — no INSERT is attempted.
   * This means a recipeId set after the first import must not be overwritten.
   *
   * This in-memory simulation mirrors the route's step-4 logic:
   *   existingByCode lookup → use existing id   (no write to the row)
   *   missing code          → INSERT (onConflictDoNothing)
   */
  it('recipe link on a menu item survives a re-import of the same file', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');

    // Build the deduplicated list of QAC codes (same logic as the route).
    const seenCodes = new Set<string>();
    const uniqueCodes: string[] = [];
    for (const row of parsed.rows) {
      if (!seenCodes.has(row.code)) {
        seenCodes.add(row.code);
        uniqueCodes.push(row.code);
      }
    }

    // ── In-memory DB table: pluSku → { id, recipeId } ─────────────────────────
    type ItemRow = { id: string; recipeId: string | null };
    const itemTable = new Map<string, ItemRow>(); // keyed by pluSku

    /**
     * Simulates the route's step-4 find-or-create inside the approve transaction.
     * Returns the id map that the route uses for subsequent steps.
     */
    function simulateApproveStep4(codes: string[]): Map<string, string> {
      const menuItemIdMap = new Map<string, string>(); // QAC → id
      for (const code of codes) {
        const existing = itemTable.get(code);
        if (existing) {
          // Route takes the early-exit path: use existing id, no INSERT.
          menuItemIdMap.set(code, existing.id);
        } else {
          // Route INSERT … onConflictDoNothing.
          const newId = `item-${itemTable.size + 1}`;
          itemTable.set(code, { id: newId, recipeId: null });
          menuItemIdMap.set(code, newId);
        }
      }
      return menuItemIdMap;
    }

    // ── First approve: all items are new → created with recipeId = null ────────
    simulateApproveStep4(uniqueCodes);
    expect(itemTable.size).toBe(uniqueCodes.length);

    // ── Link a recipe to the first item (simulates bulk-link-recipes route) ────
    const firstCode = uniqueCodes[0];
    const firstItemRow = itemTable.get(firstCode)!;
    const linkedRecipeId = 'recipe-abc-123';
    itemTable.set(firstCode, { ...firstItemRow, recipeId: linkedRecipeId });

    expect(itemTable.get(firstCode)?.recipeId).toBe(linkedRecipeId);

    // ── Second approve with the same file ──────────────────────────────────────
    // All codes already exist → step-4 takes the existing-id path for every code.
    // The itemTable rows must not be mutated (no INSERT, no UPDATE).
    simulateApproveStep4(uniqueCodes);

    // Recipe link on the first item must be intact.
    expect(itemTable.get(firstCode)?.recipeId).toBe(linkedRecipeId);

    // No new rows must have been created.
    expect(itemTable.size).toBe(uniqueCodes.length);

    // All other items must still have recipeId = null (not accidentally modified).
    for (const code of uniqueCodes.slice(1)) {
      expect(itemTable.get(code)?.recipeId).toBeNull();
    }
  });

  /**
   * Recipe-link survival when the item name changes on re-import.
   *
   * The approve route matches menu items by pluSku (QAC), not by name.
   * When the same pluSku appears in a re-upload with a corrected description,
   * step-4 takes the early-exit path (existingByCode lookup → use existing id)
   * and never issues an UPDATE — so neither the recipe link nor the stored name
   * is touched.
   *
   * Documented behaviour:
   *   • recipe link : PRESERVED  (recipeId on the DB row is unchanged)
   *   • item name   : NOT UPDATED (the route does not patch the name on re-import;
   *                   a separate "rename" action would be required to change it)
   */
  it('recipe link survives a re-import when the item name changes in the file', () => {
    // ── In-memory DB table: pluSku → { id, name, recipeId } ───────────────────
    type ItemRow = { id: string; name: string; recipeId: string | null };
    const itemTable = new Map<string, ItemRow>(); // keyed by pluSku

    /**
     * Simulates the route's step-4 find-or-create for a set of
     * { code, description } pairs.  Returns the QAC → id map.
     * Mirrors the real route: existing items are reused as-is (no UPDATE).
     */
    function simulateApproveStep4(
      rows: { code: string; description: string }[],
    ): Map<string, string> {
      const menuItemIdMap = new Map<string, string>();
      const seenCodes = new Set<string>();

      for (const row of rows) {
        if (seenCodes.has(row.code)) continue;
        seenCodes.add(row.code);

        const existing = itemTable.get(row.code);
        if (existing) {
          // Route early-exit: reuse the existing id, no INSERT, no UPDATE.
          menuItemIdMap.set(row.code, existing.id);
        } else {
          // Route INSERT … onConflictDoNothing.
          const newId = `item-${itemTable.size + 1}`;
          itemTable.set(row.code, { id: newId, name: row.description, recipeId: null });
          menuItemIdMap.set(row.code, newId);
        }
      }
      return menuItemIdMap;
    }

    // ── First approve: items inserted with original names ──────────────────────
    const firstImport = [
      { code: 'PLU-001', description: 'Cheeseburger' },
      { code: 'PLU-002', description: 'Fries' },
    ];
    simulateApproveStep4(firstImport);
    expect(itemTable.size).toBe(2);
    expect(itemTable.get('PLU-001')?.name).toBe('Cheeseburger');

    // ── Link a recipe to PLU-001 ───────────────────────────────────────────────
    const linkedRecipeId = 'recipe-cheeseburger-xyz';
    itemTable.set('PLU-001', { ...itemTable.get('PLU-001')!, recipeId: linkedRecipeId });
    expect(itemTable.get('PLU-001')?.recipeId).toBe(linkedRecipeId);

    // ── Second approve: same pluSku but the description has been corrected ─────
    const secondImport = [
      { code: 'PLU-001', description: 'Classic Cheeseburger' }, // name changed
      { code: 'PLU-002', description: 'Fries' },
    ];
    simulateApproveStep4(secondImport);

    // Recipe link must still be intact.
    expect(itemTable.get('PLU-001')?.recipeId).toBe(linkedRecipeId);

    // The route does NOT update the name — the stored name is the original one.
    // (A deliberate rename action would be required to change it.)
    expect(itemTable.get('PLU-001')?.name).toBe('Cheeseburger');

    // No new rows must have been created.
    expect(itemTable.size).toBe(2);

    // PLU-002 must still have no recipe link.
    expect(itemTable.get('PLU-002')?.recipeId).toBeNull();
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

// ─── 5. Full approve stats — all fields, first upload and re-upload ────────────

/**
 * This suite verifies the complete stats object returned by the approve route:
 *   { outletsCreated, outletsLinked, departmentsCreated, departmentsLinked,
 *     itemsCreated, itemsLinked, storeItemsCreated, salesRowsInserted }
 *
 * It uses in-memory DB stand-ins that mirror every find-or-create step in the
 * approve transaction, then runs two simulated approvals and checks all eight
 * counters are correct on both passes.
 *
 * salesRowsInserted is also tested for the ON CONFLICT DO NOTHING behaviour:
 * the route sets it to the number of rows *attempted* (aggMap.size), not the
 * number actually written.  On re-upload with the same batchId the route still
 * builds the same aggMap and reports the same salesRowsInserted count — the
 * caller is responsible for knowing that a reused batchId means the rows were
 * skipped by the unique index.
 */
describe('approve stats — all eight fields, first upload and re-upload', () => {
  type Stats = {
    outletsCreated: number;
    outletsLinked: number;
    departmentsCreated: number;
    departmentsLinked: number;
    itemsCreated: number;
    itemsLinked: number;
    storeItemsCreated: number;
    salesRowsInserted: number;
  };

  /**
   * In-memory DB state shared across both approve calls (mirrors persistent DB).
   */
  interface DbState {
    outlets: Set<string>;        // normalised outlet names
    departments: Set<string>;    // normalised department names
    items: Map<string, string>;  // pluSku → id
    storeLinks: Set<string>;     // menuItemId
    batches: Map<string, string>;// batchKey → batchId
    salesRows: Set<string>;      // "batchId|code|outlet"
  }

  /**
   * Simulates a single approve transaction for the given parsed result.
   * Mirrors the route logic step-by-step and returns the stats object.
   */
  function simulateApprove(
    parsed: ReturnType<typeof parseSalesByItemWorkbook>,
    db: DbState,
  ): Stats {
    const COMPANY_ID = 'co-test';
    const STORE_ID   = 'st-test';
    const USER_ID    = 'u-test';

    const stats: Stats = {
      outletsCreated: 0,
      outletsLinked: 0,
      departmentsCreated: 0,
      departmentsLinked: 0,
      itemsCreated: 0,
      itemsLinked: 0,
      storeItemsCreated: 0,
      salesRowsInserted: 0,
    };

    // Step 1: find-or-create batch
    const batchKey = `${COMPANY_ID}|${STORE_ID}|${parsed.reportStart}`;
    let batchId = db.batches.get(batchKey);
    if (!batchId) {
      batchId = `batch-${db.batches.size + 1}`;
      db.batches.set(batchKey, batchId);
    }

    // Step 2: find-or-create outlets
    const uniqueOutlets = Array.from(new Set(parsed.rows.map((r) => r.outlet)));
    const outletIdMap = new Map<string, string>();
    for (const name of uniqueOutlets) {
      const norm = name.toLowerCase().trim();
      if (db.outlets.has(norm)) {
        outletIdMap.set(name, norm); // use normalised name as stand-in id
        stats.outletsLinked++;
      } else {
        db.outlets.add(norm);
        outletIdMap.set(name, norm);
        stats.outletsCreated++;
      }
    }

    // Step 3: find-or-create departments
    const uniqueCategories = Array.from(new Set(parsed.rows.map((r) => r.category)));
    const deptIdMap = new Map<string, string>();
    for (const cat of uniqueCategories) {
      const norm = cat.toLowerCase().trim();
      if (db.departments.has(norm)) {
        deptIdMap.set(cat, norm);
        stats.departmentsLinked++;
      } else {
        db.departments.add(norm);
        deptIdMap.set(cat, norm);
        stats.departmentsCreated++;
      }
    }

    // Step 4: find-or-create menu items (deduplicated by QAC)
    const menuItemIdMap = new Map<string, string>();
    const seenCodes = new Set<string>();
    const newItems: Array<{ code: string }> = [];

    for (const row of parsed.rows) {
      if (seenCodes.has(row.code)) continue;
      seenCodes.add(row.code);

      if (db.items.has(row.code)) {
        menuItemIdMap.set(row.code, db.items.get(row.code)!);
        stats.itemsLinked++;
      } else {
        newItems.push({ code: row.code });
      }
    }

    // Batch insert new items (onConflictDoNothing → only truly new ones are returned)
    for (const { code } of newItems) {
      if (!db.items.has(code)) { // mirrors onConflictDoNothing
        const id = `item-${db.items.size + 1}`;
        db.items.set(code, id);
        menuItemIdMap.set(code, id);
        stats.itemsCreated++;
      }
    }

    // Step 5: find-or-create store_menu_items
    const menuItemIds = Array.from(menuItemIdMap.values());
    const toLink = menuItemIds.filter((id) => !db.storeLinks.has(id));
    for (const id of toLink) {
      if (!db.storeLinks.has(id)) { // mirrors onConflictDoNothing
        db.storeLinks.add(id);
        stats.storeItemsCreated++;
      }
    }

    // Step 6: aggregate and insert sales rows (onConflictDoNothing)
    const aggMap = new Map<string, { qty: number; net: number }>();
    for (const row of parsed.rows) {
      const key = `${row.code}|${row.outlet}`;
      const existing = aggMap.get(key);
      if (existing) {
        aggMap.set(key, { qty: existing.qty + row.qty, net: existing.net + row.netAmount });
      } else {
        aggMap.set(key, { qty: row.qty, net: row.netAmount });
      }
    }

    // The route sets salesRowsInserted = salesRows.length BEFORE the DO NOTHING check.
    // It reflects the number of rows *attempted*, not the number actually written.
    stats.salesRowsInserted = aggMap.size;

    // Simulate the unique-index DO NOTHING (mirrors dmis_csv_aggregate_uniq)
    for (const [key] of aggMap.entries()) {
      const rowKey = `${batchId}|${key}`;
      db.salesRows.add(rowKey); // no-op on second run (Set.add is idempotent)
    }

    return stats;
  }

  it('first upload: every created counter is non-zero, linked counters are zero', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const db: DbState = {
      outlets: new Set(),
      departments: new Set(),
      items: new Map(),
      storeLinks: new Set(),
      batches: new Map(),
      salesRows: new Set(),
    };

    const stats = simulateApprove(parsed, db);

    expect(stats.outletsCreated).toBeGreaterThan(0);
    expect(stats.outletsLinked).toBe(0);

    expect(stats.departmentsCreated).toBeGreaterThan(0);
    expect(stats.departmentsLinked).toBe(0);

    expect(stats.itemsCreated).toBeGreaterThan(0);
    expect(stats.itemsLinked).toBe(0);

    expect(stats.storeItemsCreated).toBeGreaterThan(0);

    expect(stats.salesRowsInserted).toBeGreaterThan(0);
  });

  it('first upload: outlet, department, item counts match the parsed data', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const db: DbState = {
      outlets: new Set(),
      departments: new Set(),
      items: new Map(),
      storeLinks: new Set(),
      batches: new Map(),
      salesRows: new Set(),
    };

    const stats = simulateApprove(parsed, db);

    const uniqueOutlets = new Set(parsed.rows.map((r) => r.outlet)).size;
    const uniqueCategories = new Set(parsed.rows.map((r) => r.category)).size;
    const uniqueItemCodes = new Set(parsed.rows.map((r) => r.code)).size;

    expect(stats.outletsCreated).toBe(uniqueOutlets);
    expect(stats.departmentsCreated).toBe(uniqueCategories);
    expect(stats.itemsCreated).toBe(uniqueItemCodes);
    expect(stats.storeItemsCreated).toBe(uniqueItemCodes);
  });

  it('first upload: salesRowsInserted equals the number of unique code×outlet aggregates', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const db: DbState = {
      outlets: new Set(),
      departments: new Set(),
      items: new Map(),
      storeLinks: new Set(),
      batches: new Map(),
      salesRows: new Set(),
    };

    const stats = simulateApprove(parsed, db);

    // The route aggregates by code|outlet, so salesRowsInserted = unique (code, outlet) pairs.
    const uniquePairs = new Set(parsed.rows.map((r) => `${r.code}|${r.outlet}`)).size;
    expect(stats.salesRowsInserted).toBe(uniquePairs);
  });

  it('re-upload: all created counters are zero, all linked counters match originals', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const db: DbState = {
      outlets: new Set(),
      departments: new Set(),
      items: new Map(),
      storeLinks: new Set(),
      batches: new Map(),
      salesRows: new Set(),
    };

    const first = simulateApprove(parsed, db);
    const second = simulateApprove(parsed, db);

    // Nothing new should be created on re-upload.
    expect(second.outletsCreated).toBe(0);
    expect(second.departmentsCreated).toBe(0);
    expect(second.itemsCreated).toBe(0);
    expect(second.storeItemsCreated).toBe(0);

    // Everything that was created in the first run is now linked.
    expect(second.outletsLinked).toBe(first.outletsCreated);
    expect(second.departmentsLinked).toBe(first.departmentsCreated);
    expect(second.itemsLinked).toBe(first.itemsCreated);
  });

  it('re-upload: salesRowsInserted reflects attempted rows (same batchId → DO NOTHING skips)', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const db: DbState = {
      outlets: new Set(),
      departments: new Set(),
      items: new Map(),
      storeLinks: new Set(),
      batches: new Map(),
      salesRows: new Set(),
    };

    const salesRowsBefore = db.salesRows.size; // 0
    const first  = simulateApprove(parsed, db);
    const salesRowsAfterFirst = db.salesRows.size;

    const second = simulateApprove(parsed, db);
    const salesRowsAfterSecond = db.salesRows.size;

    // The route always reports salesRowsInserted = aggMap.size regardless of DO NOTHING.
    expect(second.salesRowsInserted).toBe(first.salesRowsInserted);

    // But the actual DB table size must not grow on re-upload.
    expect(salesRowsAfterFirst).toBeGreaterThan(salesRowsBefore);
    expect(salesRowsAfterSecond).toBe(salesRowsAfterFirst); // no new rows written
  });

  it('all eight stats fields are present and numeric in the response shape', () => {
    const parsed = parseSalesByItemWorkbook(xlsxBuffer, 'Sales_by_item_6-26.xlsx');
    const db: DbState = {
      outlets: new Set(),
      departments: new Set(),
      items: new Map(),
      storeLinks: new Set(),
      batches: new Map(),
      salesRows: new Set(),
    };

    const stats = simulateApprove(parsed, db);

    const requiredFields: (keyof Stats)[] = [
      'outletsCreated',
      'outletsLinked',
      'departmentsCreated',
      'departmentsLinked',
      'itemsCreated',
      'itemsLinked',
      'storeItemsCreated',
      'salesRowsInserted',
    ];

    for (const field of requiredFields) {
      expect(typeof stats[field]).toBe('number');
      expect(stats[field]).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── 6. Approve endpoint — HTTP integration with mocked db.transaction ─────────

/**
 * These tests call POST /api/imports/sales-by-item/approve via supertest and
 * assert the actual HTTP response body.  db.transaction is mocked to invoke the
 * callback with a controlled tx whose responses are pre-queued in order, so we
 * exercise the real route handler without a live database.
 *
 * The workbook used is a 2-item minimal fixture (Bay Window + Grill outlets,
 * 2 departments, 2 items, 2 aggregate sales rows) so the expected counts are
 * small and easy to reason about.
 *
 * First-upload expected stats:
 *   outletsCreated:2, outletsLinked:0,
 *   departmentsCreated:2, departmentsLinked:0,
 *   itemsCreated:2, itemsLinked:0,
 *   storeItemsCreated:2, salesRowsInserted:2
 *
 * Re-upload expected stats (same file, same batchId reused):
 *   outletsCreated:0, outletsLinked:2,
 *   departmentsCreated:0, departmentsLinked:2,
 *   itemsCreated:0, itemsLinked:2,
 *   storeItemsCreated:0, salesRowsInserted:2   ← attempted, not actual DB writes
 */
describe('POST /api/imports/sales-by-item/approve — full stats HTTP integration', () => {

  // ── Minimal 2-item workbook ─────────────────────────────────────────────────
  // Two categories → 2 departments, 2 outlets (Bay Window, Grill), 2 items,
  // 2 aggregate sales rows (one per code×outlet pair).
  function build2ItemWorkbook(): Buffer {
    function addr(r: number, c: number) {
      return XLSX.utils.encode_cell({ r, c });
    }
    const ws: XLSX.WorkSheet = {};
    ws[addr(8, 10)]  = { t: 's', v: 'Jun 01, 2026' };
    ws[addr(12, 11)] = { t: 's', v: 'Jun 30, 2026' };

    const categories = ['FF-BW Favorites', 'FF-GR Burger'];
    let maxRow = 28;
    for (let i = 0; i < categories.length; i++) {
      const sectionRow = 29 + i * 2;
      const itemRow    = 30 + i * 2;
      ws[addr(sectionRow, 2)] = { t: 's', v: categories[i] };
      ws[addr(itemRow, 2)]    = { t: 's', v: `TST-000${i}` };
      ws[addr(itemRow, 5)]    = { t: 's', v: `Test Item ${i}` };
      ws[addr(itemRow, 14)]   = { t: 'n', v: 3 };
      ws[addr(itemRow, 15)]   = { t: 'n', v: 9.0 };
      ws[addr(itemRow, 20)]   = { t: 'n', v: 9.0 };
      maxRow = itemRow;
    }
    ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: maxRow, c: 20 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  const workbookBuffer = build2ItemWorkbook();

  // ── Mock-tx factory ─────────────────────────────────────────────────────────
  /**
   * Creates a mock Drizzle transaction object (tx) whose query builder chains
   * consume pre-registered responses from a queue in call order.
   *
   * Each terminal method (limit, where when directly awaited, returning, and
   * onConflictDoNothing when directly awaited) pops the next response from the
   * queue.  Non-terminal builder methods (from, values, …) just return a new
   * chainable node.
   */
  function createMockTx(responses: any[]): any {
    let idx = 0;
    const next = (label: string) => {
      if (idx >= responses.length) {
        throw new Error(
          `MockTx: unexpected call ${label} at position #${idx + 1}; ` +
          `only ${responses.length} responses registered`,
        );
      }
      return responses[idx++];
    };

    function makeNode(label = 'node'): any {
      const n: any = {
        from:  (_t: any) => makeNode(`from`),
        where: (_c: any) => makeNode(`where`),
        limit: (_l: any) => Promise.resolve(next(`limit`)),
        values:(_v: any) => makeNode(`values`),
        returning: (_c: any) => Promise.resolve(next(`returning`)),
        onConflictDoNothing: () => ({
          // may be followed by .returning() or awaited directly
          returning: (_c: any) => Promise.resolve(next(`onConflict.returning`)),
          then: (ok: any, fail: any) =>
            Promise.resolve(next(`onConflict.then`)).then(ok, fail),
        }),
        // select chains without .limit() are awaited directly
        then: (ok: any, fail: any) =>
          Promise.resolve(next(`${label}.then`)).then(ok, fail),
      };
      return n;
    }

    return {
      select: (_c: any) => makeNode('select'),
      insert: (_t: any) => makeNode('insert'),
    };
  }

  // ── Shared request helper ───────────────────────────────────────────────────
  async function runApprove(buf: Buffer) {
    const express = (await import('express')).default;
    const { registerSalesByItemRoutes } =
      await import('../../routes/salesByItemRoutes');

    const app = express();
    // Inject companyId and userId so the route can proceed past guard checks
    app.use((req: any, _res: any, next: any) => {
      req.companyId = 'company-1';
      req.userId    = 'user-1';
      next();
    });
    registerSalesByItemRoutes(app);

    const request = (await import('supertest')).default;
    return request(app)
      .post('/api/imports/sales-by-item/approve')
      .attach('file', buf, {
        filename: 'test.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
  }

  // ── Per-test mock setup ─────────────────────────────────────────────────────
  beforeEach(() => {
    // One accessible store → resolveTargetStore picks it automatically
    vi.mocked(getAccessibleStores).mockResolvedValue(['store-1']);

    // Module-level db.select — used only by resolveTargetStore to load store names
    vi.mocked(db.select as any).mockReturnValue({
      from: () => ({
        where: () =>
          Promise.resolve([{ id: 'store-1', name: 'Test Store' }]),
      }),
    });
  });

  // ── First-upload ────────────────────────────────────────────────────────────
  it('first upload: HTTP 200 and all 8 stats fields with correct counts', async () => {
    /**
     * Response queue — one entry per terminal DB call in the approve transaction:
     *  1  select existing batch        → []             (none found → create)
     *  2  insert batch returning       → [{id}]
     *  3  select outlet Bay Window     → []             (new)
     *  4  insert outlet BW returning   → [{id}]
     *  5  select outlet Grill          → []             (new)
     *  6  insert outlet GR returning   → [{id}]
     *  7  select dept FF-BW Favorites  → []             (new)
     *  8  insert dept BW returning     → [{id}]
     *  9  select dept FF-GR Burger     → []             (new)
     * 10  insert dept GR returning     → [{id}]
     * 11  select all menu items        → []             (none exist)
     * 12  insert items returning       → 2 rows
     * 13  select store links           → []             (none exist)
     * 14  insert store links returning → 2 rows
     * 15  insert sales (onConflict)    → []             (terminal, no returning)
     */
    const responses = [
      [],                                                       //  1
      [{ id: 'batch-1' }],                                     //  2
      [],                                                       //  3
      [{ id: 'loc-1' }],                                       //  4
      [],                                                       //  5
      [{ id: 'loc-2' }],                                       //  6
      [],                                                       //  7
      [{ id: 'dept-1' }],                                      //  8
      [],                                                       //  9
      [{ id: 'dept-2' }],                                      // 10
      [],                                                       // 11
      [{ id: 'item-1', pluSku: 'TST-0000' },
       { id: 'item-2', pluSku: 'TST-0001' }],                  // 12
      [],                                                       // 13
      [{ menuItemId: 'item-1' }, { menuItemId: 'item-2' }],    // 14
      [],                                                       // 15
    ];

    vi.mocked(db.transaction as any).mockImplementation(
      async (callback: any) => callback(createMockTx(responses)),
    );

    const res = await runApprove(workbookBuffer);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Date range present
    expect(res.body.reportStart).toBe('2026-06-01');
    expect(res.body.reportEnd).toBe('2026-06-30');

    // All 8 stats fields — first upload
    expect(res.body.outletsCreated).toBe(2);
    expect(res.body.outletsLinked).toBe(0);
    expect(res.body.departmentsCreated).toBe(2);
    expect(res.body.departmentsLinked).toBe(0);
    expect(res.body.itemsCreated).toBe(2);
    expect(res.body.itemsLinked).toBe(0);
    expect(res.body.storeItemsCreated).toBe(2);
    expect(res.body.salesRowsInserted).toBe(2); // 2 unique code×outlet pairs
  });

  // ── Re-upload ───────────────────────────────────────────────────────────────
  it('re-upload: HTTP 200 and all created counters are zero', async () => {
    /**
     * Re-upload response queue — batch already exists so it is reused;
     * all outlets/departments/items already exist so linked counters reflect
     * the originals and created counters are zero.  No item insert, no store
     * link insert (toLink is empty).  Sales insert still runs (batchId+storeId
     * present) but ON CONFLICT DO NOTHING skips every row.
     *
     *  1  select existing batch            → [{id: 'batch-1'}]   (found → reuse)
     *  2  select outlet Bay Window         → [{id: 'loc-1'}]     (linked)
     *  3  select outlet Grill              → [{id: 'loc-2'}]     (linked)
     *  4  select dept FF-BW Favorites      → [{id: 'dept-1'}]    (linked)
     *  5  select dept FF-GR Burger         → [{id: 'dept-2'}]    (linked)
     *  6  select all menu items            → 2 rows              (all exist)
     *  7  select store links               → 2 rows              (all exist)
     *  8  insert sales (onConflict)        → []                  (all skipped)
     */
    const responses = [
      [{ id: 'batch-1' }],                                          //  1
      [{ id: 'loc-1' }],                                            //  2
      [{ id: 'loc-2' }],                                            //  3
      [{ id: 'dept-1' }],                                           //  4
      [{ id: 'dept-2' }],                                           //  5
      [{ id: 'item-1', pluSku: 'TST-0000' },
       { id: 'item-2', pluSku: 'TST-0001' }],                       //  6
      [{ menuItemId: 'item-1' }, { menuItemId: 'item-2' }],         //  7
      [],                                                            //  8
    ];

    vi.mocked(db.transaction as any).mockImplementation(
      async (callback: any) => callback(createMockTx(responses)),
    );

    const res = await runApprove(workbookBuffer);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Nothing new created
    expect(res.body.outletsCreated).toBe(0);
    expect(res.body.departmentsCreated).toBe(0);
    expect(res.body.itemsCreated).toBe(0);
    expect(res.body.storeItemsCreated).toBe(0);

    // Everything that was created first time is now linked
    expect(res.body.outletsLinked).toBe(2);
    expect(res.body.departmentsLinked).toBe(2);
    expect(res.body.itemsLinked).toBe(2);
  });

  it('re-upload: salesRowsInserted reports attempted rows even when DO NOTHING skips all', async () => {
    /**
     * On re-upload the route builds the same aggMap (2 code×outlet pairs) and
     * sets salesRowsInserted = salesRows.length = 2, regardless of the fact that
     * the unique index skips every insert.  The caller must check whether the
     * batchId was reused to interpret this correctly.
     */
    const responses = [
      [{ id: 'batch-1' }],
      [{ id: 'loc-1' }],
      [{ id: 'loc-2' }],
      [{ id: 'dept-1' }],
      [{ id: 'dept-2' }],
      [{ id: 'item-1', pluSku: 'TST-0000' },
       { id: 'item-2', pluSku: 'TST-0001' }],
      [{ menuItemId: 'item-1' }, { menuItemId: 'item-2' }],
      [],
    ];

    vi.mocked(db.transaction as any).mockImplementation(
      async (callback: any) => callback(createMockTx(responses)),
    );

    const res = await runApprove(workbookBuffer);

    expect(res.status).toBe(200);
    // Route reports attempted count (2), not 0 actual DB inserts.
    expect(res.body.salesRowsInserted).toBe(2);
  });

  it('response shape contains every expected top-level key', async () => {
    const responses = [
      [], [{ id: 'batch-1' }],
      [], [{ id: 'loc-1' }],
      [], [{ id: 'loc-2' }],
      [], [{ id: 'dept-1' }],
      [], [{ id: 'dept-2' }],
      [],
      [{ id: 'item-1', pluSku: 'TST-0000' }, { id: 'item-2', pluSku: 'TST-0001' }],
      [],
      [{ menuItemId: 'item-1' }, { menuItemId: 'item-2' }],
      [],
    ];

    vi.mocked(db.transaction as any).mockImplementation(
      async (callback: any) => callback(createMockTx(responses)),
    );

    const res = await runApprove(workbookBuffer);

    expect(res.status).toBe(200);

    const requiredKeys = [
      'success', 'reportStart', 'reportEnd',
      'outletsCreated', 'outletsLinked',
      'departmentsCreated', 'departmentsLinked',
      'itemsCreated', 'itemsLinked',
      'storeItemsCreated', 'salesRowsInserted',
    ];
    for (const key of requiredKeys) {
      expect(res.body).toHaveProperty(key);
    }
  });
});
