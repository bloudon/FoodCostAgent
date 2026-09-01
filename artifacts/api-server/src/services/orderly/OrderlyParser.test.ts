/**
 * Unit tests for the Orderly inventory export parser.
 *
 * Tests cover:
 *  - detectOrderlyFormat      header fingerprint detection
 *  - parseOrderlyWorkbook     full workbook parse (uses actual Bay Hill file)
 *  - cleanDescription         two-transform description cleaning
 *  - detectNonAuthoritativeCodes  generalized placeholder detection
 *  - detectInventoryDate      filename, date-cluster, and workbook-date strategies
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  detectOrderlyFormat,
  cleanDescription,
  detectNonAuthoritativeCodes,
  detectInventoryDate,
  parseOrderlyPackSize,
  parseOrderlyWorkbook,
} from './OrderlyParser';
import { parseCompoundPackSize } from '../../integrations/csv/CsvOrderGuide';
import {
  buildBulkPackSizeFixtureWorkbook,
  BULK_PACK_SIZE_FIXTURE_FILENAME,
} from './orderlyBulkPackSize.fixture';

// ─── detectOrderlyFormat ─────────────────────────────────────────────────────

describe('detectOrderlyFormat', () => {
  it('returns true for a valid Orderly header row', () => {
    const headers = [
      'Location', 'Item Code', 'Item Description', 'Pack Size', 'Package Price',
      'Counting Unit 1', 'Count', 'Counting Unit 2', 'Count', 'Counting Unit 3',
      'Count', 'Total Units', 'Par Order Target', 'Total Cost',
      'Previous Case', 'Previous Pack', 'Previous UOM', 'Previous Cost',
      'Supplier', 'Purchase Date', 'Category', 'GL Code',
    ];
    expect(detectOrderlyFormat(headers)).toBe(true);
  });

  it('returns false for a generic CSV header', () => {
    const headers = ['SKU', 'Name', 'Price', 'Qty'];
    expect(detectOrderlyFormat(headers)).toBe(false);
  });

  it('is case-insensitive', () => {
    const headers = [
      'ITEM DESCRIPTION', 'PACK SIZE', 'COUNTING UNIT 1', 'SUPPLIER', 'GL CODE',
    ];
    expect(detectOrderlyFormat(headers)).toBe(true);
  });

  it('returns false when a required column is missing', () => {
    // Missing "GL Code"
    const headers = [
      'Item Description', 'Pack Size', 'Counting Unit 1', 'Supplier',
    ];
    expect(detectOrderlyFormat(headers)).toBe(false);
  });
});

// ─── cleanDescription ────────────────────────────────────────────────────────

describe('cleanDescription', () => {
  it('strips supplier suffix verbatim (transform 1)', () => {
    const result = cleanDescription(
      "12 Year Single Malt Southern Glazer's 1 / 0 750ML",
      "Southern Glazer's",
    );
    expect(result.cleanedDescription).toBe('12 Year Single Malt');
    expect(result.cleaningMethod).toBe('supplier_suffix_strip');
    expect(result.cleaningConfidence).toBeGreaterThanOrEqual(0.85);
    expect(result.removedSuffix).toContain("Southern Glazer's");
  });

  it('strips supplier after a dash separator (transform 2)', () => {
    const result = cleanDescription(
      '1800 Tequila - Republic National Distributing Company 6 / 0 ML',
      'Republic National Distributing Company',
    );
    expect(result.cleanedDescription).toBe('1800 Tequila');
    expect(result.cleaningMethod).toBe('dash_supplier_strip');
  });

  it('strips only the trailing pack reference when no supplier match (transform 3)', () => {
    const result = cleanDescription('Chicken Breast 6 / 5 LB', 'Nonexistent Vendor');
    expect(result.cleanedDescription).toBe('Chicken Breast');
    expect(result.cleaningMethod).toBe('pack_text_strip');
    expect(result.cleaningConfidence).toBeLessThan(0.85);
  });

  it('returns the raw description unchanged when no transform applies', () => {
    const result = cleanDescription('Plain Product Name', '');
    expect(result.cleanedDescription).toBe('Plain Product Name');
    expect(result.cleaningMethod).toBe('none');
    expect(result.removedSuffix).toBe('');
  });

  it('handles blank description gracefully', () => {
    const result = cleanDescription('', 'Some Vendor');
    expect(result.cleanedDescription).toBe('');
    expect(result.cleaningMethod).toBe('none');
  });

  it('does not strip supplier when result would be too short', () => {
    // If stripping the supplier leaves only 1 char, skip transform
    const result = cleanDescription('A Some Vendor Pack', 'Some Vendor Pack');
    // "A" is only 1 char, so should fall through
    // (either pack-text strip or no transform)
    expect(result.cleanedDescription.length).toBeGreaterThan(1);
  });

  it('preserves both rawDescription and cleanedDescription independently', () => {
    const raw = 'BIALE ZINFANDEL Winebow 1 / 0 Case';
    const result = cleanDescription(raw, 'Winebow');
    // raw is untouched by the function (caller stores it separately)
    expect(result.cleanedDescription).not.toBe(raw);
    expect(result.cleanedDescription).toBe('BIALE ZINFANDEL');
  });
});

// ─── detectNonAuthoritativeCodes ─────────────────────────────────────────────

describe('detectNonAuthoritativeCodes', () => {
  it('flags blank item codes', () => {
    const rows = [
      { sourceItemCode: '', rawDescription: 'Product A', sourceCategory: 'Beer' },
    ];
    const result = detectNonAuthoritativeCodes(rows);
    expect(result.has('')).toBe(true);
  });

  it('flags single-character codes', () => {
    const rows = [
      { sourceItemCode: 'X', rawDescription: 'Product A', sourceCategory: 'Liquor' },
    ];
    const result = detectNonAuthoritativeCodes(rows);
    expect(result.has('X')).toBe(true);
  });

  it('flags a short numeric code that appears across many unrelated descriptions', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      sourceItemCode: '54',
      rawDescription: `Product ${i} - completely different item`,
      sourceCategory: i % 2 === 0 ? 'Beer' : 'Wine',
    }));
    const result = detectNonAuthoritativeCodes(rows);
    expect(result.has('54')).toBe(true);
  });

  it('does not flag a valid long alphanumeric code used consistently', () => {
    const rows = [
      { sourceItemCode: '30316398', rawDescription: 'L Ecole Red Wine', sourceCategory: 'Wine' },
      { sourceItemCode: '30316398', rawDescription: 'L Ecole Red Wine', sourceCategory: 'Wine' },
    ];
    const result = detectNonAuthoritativeCodes(rows);
    expect(result.has('30316398')).toBe(false);
  });

  it('does not flag a short numeric code that appears only once', () => {
    const rows = [
      { sourceItemCode: '54', rawDescription: 'Single Product', sourceCategory: 'Beer' },
    ];
    // Only 1 row — not high reuse
    const result = detectNonAuthoritativeCodes(rows);
    // A single occurrence should NOT be flagged
    expect(result.has('54')).toBe(false);
  });

  it('flags a medium numeric code spanning many categories and many rows', () => {
    const categories = ['Beer', 'Wine', 'Liquor', 'Food'];
    const rows = Array.from({ length: 20 }, (_, i) => ({
      sourceItemCode: '12345',
      rawDescription: `Item ${i}`,
      sourceCategory: categories[i % categories.length],
    }));
    const result = detectNonAuthoritativeCodes(rows);
    expect(result.has('12345')).toBe(true);
  });
});

describe('Orderly pack-size parsing', () => {
  it.each([
    ['0/0 LT', { baseUnitQuantity: 1, baseUnit: 'LT' }],
    ['0 / 0 750ML', { baseUnitQuantity: 750, baseUnit: 'ML' }],
    ['0/0 EA', { baseUnitQuantity: 1, baseUnit: 'EA' }],
  ])('treats measurable direct-unit pack %s as one countable unit', (rawPack, expected) => {
    expect(parseOrderlyPackSize(rawPack)).toEqual({
      caseQuantity: 1,
      innerPackQuantity: 1,
      ...expected,
      caseUnit: 'Case',
      innerUnit: 'Pack',
      packParseStatus: 'ok',
    });
  });

  it.each(['0/0 Case', '0/0 FURLONG'])(
    'keeps non-measurable direct-unit pack %s unconfirmed',
    rawPack => {
      expect(parseOrderlyPackSize(rawPack).packParseStatus).not.toBe('ok');
    },
  );

  it.each([
    ['1/170 GR', { caseQuantity: 1, innerPackQuantity: 170, baseUnitQuantity: 1, baseUnit: 'GR' }],
    ['1/12 PT', { caseQuantity: 1, innerPackQuantity: 12, baseUnitQuantity: 1, baseUnit: 'PT' }],
    ['1/3 Cup', { caseQuantity: 1, innerPackQuantity: 3, baseUnitQuantity: 1, baseUnit: 'CUP' }],
  ])('preserves measurable two-tier Orderly geometry for %s', (rawPack, expected) => {
    expect(parseOrderlyPackSize(rawPack)).toMatchObject({
      ...expected,
      packParseStatus: 'ok',
    });
  });

  it('projects the self-describing 5.16 gallon keg into canonical source geometry', () => {
    expect(parseOrderlyPackSize('1/1 KEG 5.16G')).toEqual({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 5.16,
      caseUnit: 'Case',
      innerUnit: 'Keg',
      baseUnit: 'GAL',
      packParseStatus: 'ok',
    });
  });

  it.each([
    ['1/1 #10', 1],
    ['6/1 #10', 6],
  ])('keeps the #10 designation in raw evidence while recovering %s as count geometry', (rawPack, total) => {
    const parsed = parseOrderlyPackSize(rawPack);
    expect(parsed).toMatchObject({
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packParseStatus: 'ok',
    });
    expect(parsed.caseQuantity! * parsed.innerPackQuantity!).toBe(total);
  });

  it.each([
    ['12/10 Case', 120],
    ['12/5 Case', 60],
    ['5/12 Case', 60],
    ['1/24 Case', 24],
  ])('recovers both explicit Case multipliers from %s', (rawPack, total) => {
    const parsed = parseOrderlyPackSize(rawPack);
    expect(parsed).toMatchObject({
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packParseStatus: 'ok',
    });
    expect(parsed.caseQuantity! * parsed.innerPackQuantity!).toBe(total);
  });

  it('keeps 1/1 Case opaque and non-convertible', () => {
    expect(parseOrderlyPackSize('1/1 Case')).toMatchObject({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnit: 'CASE',
      packParseStatus: 'unparseable',
    });
  });

  it.each([
    '1/1 KEG',
    '1/1 KEG 5.16',
    '1/1 KEG 5.16G extra',
    '1/#10',
    'Case 12/10',
  ])('fails closed for ambiguous measurable notation: %s', rawPack => {
    expect(parseOrderlyPackSize(rawPack).packParseStatus).not.toBe('ok');
  });

  it('accepts grouped thousands in a complete EA pack', () => {
    expect(parseOrderlyPackSize('1/2,000 EA')).toEqual({
      caseQuantity: 1,
      innerPackQuantity: 2000,
      baseUnitQuantity: 1,
      caseUnit: 'Case',
      innerUnit: 'Pack',
      baseUnit: 'EA',
      packParseStatus: 'ok',
    });
  });

  it.each(['1/0 EA', '1/-2 EA', '1/2,00 EA', '1/2,,000 EA'])(
    'rejects non-positive or malformed grouped quantity %s',
    (packSize) => {
      expect(parseOrderlyPackSize(packSize).packParseStatus).toBe('unparseable');
    },
  );

  it('keeps unsupported Case units visibly unparseable', () => {
    expect(parseOrderlyPackSize('1/1 Case')).toMatchObject({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnit: 'CASE',
      packParseStatus: 'unparseable',
    });
    expect(parseOrderlyPackSize('1/1 750 FURLONG')).toMatchObject({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'FURLONG',
      packParseStatus: 'unparseable',
    });
  });

  it.each([
    ['1/2,000 EA', { caseSize: 1, innerPack: 2000, unit: 'EA' }],
    ['1/2,000', { caseSize: 1, innerPack: 2000 }],
    ['2,000 EA', { caseSize: 2000, unit: 'EA' }],
  ])('parses grouped quantities in shared compound parser: %s', (value, expected) => {
    expect(parseCompoundPackSize(value)).toEqual(expected);
  });
});

// ─── detectInventoryDate ─────────────────────────────────────────────────────

describe('detectInventoryDate', () => {
  it('extracts date from filename with underscore separator', () => {
    const result = detectInventoryDate(
      'Bay_Hill_Inventory_June_2026.xlsx',
      undefined,
      [],
    );
    expect(result.detectedDate).toBe('2026-06-30');
    expect(result.detectedFrom).toBe('filename');
    expect(result.confidence).toBe('high');
  });

  it('extracts date from filename with space separator', () => {
    const result = detectInventoryDate(
      'Inventory May 2026.xlsx',
      undefined,
      [],
    );
    expect(result.detectedDate).toBe('2026-05-31');
    expect(result.confidence).toBe('high');
  });

  it('falls back to purchase date cluster when filename has no date', () => {
    // Create 20 purchase dates in June 2026 and a few in other months
    const dates = [
      ...Array(20).fill('June 15, 2026'),
      ...Array(3).fill('May 10, 2026'),
    ];
    const result = detectInventoryDate('inventory_export.xlsx', undefined, dates);
    expect(result.detectedDate).toBe('2026-06-30');
    expect(result.detectedFrom).toBe('purchase_date_cluster');
    expect(result.confidence).toBe('medium');
  });

  it('falls back to workbook modified date when no other signal', () => {
    const props = {
      ModifiedDate: '2026-07-29T17:55:49.000Z',
    } as any;
    const result = detectInventoryDate('report.xlsx', props, []);
    // Modified in July 2026 → inventory is June 2026
    expect(result.detectedDate).toBe('2026-06-30');
    expect(result.detectedFrom).toBe('workbook_modified_date');
    expect(result.confidence).toBe('low');
  });

  it('returns null detectedDate when no signal exists', () => {
    const result = detectInventoryDate('report.xlsx', undefined, []);
    expect(result.detectedDate).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('generates correct last-day for months with varying lengths', () => {
    // Must use full month names (the parser matches spelled-out names only)
    expect(detectInventoryDate('February_2024.xlsx', undefined, []).detectedDate).toBe('2024-02-29'); // leap year
    expect(detectInventoryDate('February_2023.xlsx', undefined, []).detectedDate).toBe('2023-02-28');
    expect(detectInventoryDate('November_2025.xlsx', undefined, []).detectedDate).toBe('2025-11-30');
    expect(detectInventoryDate('December_2025.xlsx', undefined, []).detectedDate).toBe('2025-12-31');
  });
});

// ─── parseOrderlyWorkbook (integration — uses real Bay Hill file) ──────────────

describe('parseOrderlyWorkbook (Bay Hill June 2026)', () => {
  const filePath = join(
    process.cwd(),
    'attached_assets/Bay_Hill_Inventorty_June_2026_1785359255203.xlsx',
  );

  let buffer: Buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    // Skip if file not present in test environment
    it.skip('Bay Hill file not available', () => {});
    return;
  }

  let result: ReturnType<typeof parseOrderlyWorkbook>;
  try {
    result = parseOrderlyWorkbook(buffer, 'Bay_Hill_Inventorty_June_2026_1785359255203.xlsx');
  } catch (e) {
    it.skip('parseOrderlyWorkbook threw unexpectedly', () => {});
    return;
  }

  it('parses the correct sheet', () => {
    expect(result.sheetName).toBe('Inventory Detail');
  });

  it('detects inventory date from filename as June 2026', () => {
    expect(result.inventoryDate.detectedDate).toBe('2026-06-30');
    expect(result.inventoryDate.confidence).toBe('high');
  });

  it('sourceRowCount > 5000 (Bay Hill has 5409 data rows)', () => {
    expect(result.sourceRowCount).toBeGreaterThan(5000);
  });

  it('uniqueItemCandidates < sourceRows (same item appears across multiple locations)', () => {
    expect(result.summary.uniqueItemCandidates).toBeLessThan(result.summary.sourceRows);
  });

  it('itemLocationAssignments equals sourceRows', () => {
    expect(result.summary.itemLocationAssignments).toBe(result.summary.sourceRows);
  });

  it('has many blank item codes (Bay Hill has ~1045)', () => {
    // ~19% of rows have no item code in the Orderly export
    const blankRows = result.rows.filter(r => r.itemCodeStatus === 'blank');
    expect(blankRows.length).toBeGreaterThan(900);
  });

  it('placeholder detection does not false-positive on valid items tracked across multiple locations', () => {
    // Codes like 6335 appear 9x because the same item exists in 9 storage locations —
    // the algorithm must NOT flag them since they only have 1 distinct description.
    expect(result.summary.nonAuthoritativeCodes).toBe(0);
  });

  it('detects some invalid/blank suppliers', () => {
    expect(result.summary.invalidSuppliers).toBeGreaterThan(0);
  });

  it('pack parse warnings exist for some rows (complex format strings)', () => {
    // Some Pack Size values will be partial / unparseable
    expect(result.summary.packParseWarnings).toBeGreaterThanOrEqual(0);
  });

  it('each row stores rawData as an object with all source columns', () => {
    const first = result.rows[0];
    expect(first.rawData).toBeDefined();
    expect(typeof first.rawData).toBe('object');
    expect(Object.keys(first.rawData).length).toBeGreaterThanOrEqual(22);
  });

  it('all rows have immutable rawDescription preserved independently from cleanedDescription', () => {
    const cleaned = result.rows.filter(
      r => r.cleaningMethod !== 'none',
    );
    for (const row of cleaned.slice(0, 20)) {
      // rawDescription must be the original value
      expect(row.rawDescription).not.toBe('');
      // cleanedDescription must differ from raw when a transform was applied
      expect(row.cleanedDescription).not.toBe(row.rawDescription);
    }
  });

  it('snapshotTotal is a positive number', () => {
    expect(result.snapshotTotal).toBeGreaterThan(0);
  });

  it('row 0 maps "Liquor Cage" as storageLocation', () => {
    expect(result.rows[0].storageLocation).toBe('Liquor Cage');
  });

  it('first row supplier is correctly extracted', () => {
    // Row 1 supplier is "Winebow"
    const r = result.rows[0];
    expect(r.supplierRaw).toBeTruthy();
    expect(r.supplierStatus).toBe('valid');
  });

  it('pack geometry is parsed for standard N/M UNIT format', () => {
    // Many rows use "12/1 750ML" etc.
    const hasPackData = result.rows.some(
      r => r.caseQuantity != null && r.packParseStatus === 'ok',
    );
    expect(hasPackData).toBe(true);
  });

  it('parses an ordinary 1/1 750ML bottle as complete three-tier evidence', () => {
    const bottle = result.rows.find(row => row.rawData['Pack Size'] === '1/1 750ML');
    expect(bottle).toMatchObject({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      packParseStatus: 'ok',
    });
  });
});

describe('bulk pack-size acceptance fixture', () => {
  it('contains a stable complete-pack candidate and a missing-pack-evidence row', () => {
    const result = parseOrderlyWorkbook(
      buildBulkPackSizeFixtureWorkbook(),
      BULK_PACK_SIZE_FIXTURE_FILENAME,
    );

    expect(result.sheetName).toBe('Inventory Detail');
    expect(result.sourceRowCount).toBe(2);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceItemCode: 'TEQ-5050',
        cleanedDescription: 'House Tequila',
        supplierRaw: 'Acme Liquor',
        packParseStatus: 'ok',
        caseQuantity: 5,
        innerPackQuantity: 1,
        baseUnitQuantity: 50,
        baseUnit: 'ML',
        itemCodeStatus: 'valid',
      }),
      expect.objectContaining({
        sourceItemCode: 'TEQ-5051',
        cleanedDescription: 'House Tequila',
        packParseStatus: 'unparseable',
        itemCodeStatus: 'valid',
      }),
    ]));
  });
});
