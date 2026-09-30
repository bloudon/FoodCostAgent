import { describe, expect, it } from 'vitest';
import augustWorkbook from '../../data/august-2026-orderly-reference.json';
import {
  assessAugustSourceQuantity,
  hasConfirmedAugustEntry,
  hasPhysicalCountEvidence,
  normalizeAugustLocation,
  sourceToCanonicalFactor,
} from './augustReference';

const sourceRow = (overrides: Record<string, unknown> = {}) => ({
  rowIndex: 2,
  rawData: { 'Total Units': 20 },
  caseQuantity: 1,
  innerPackQuantity: 4,
  baseUnitQuantity: 5,
  baseUnit: 'LB',
  countUnit1: 'Case',
  count1: 1,
  countUnit2: 'Pack',
  count2: 0,
  countUnit3: 'LB',
  count3: 0,
  totalUnits: 20,
  ...overrides,
} as any);

describe('August Orderly reference evidence', () => {
  it('retains the supplied workbook rows and immutable file provenance', () => {
    expect(augustWorkbook.provenance).toMatchObject({
      sourceFile: '0_August_2026_1790114973419.xlsx',
      sha256: '444f6b696bd0fa4659b83c02d9b6790928ed1d759aa7ce4d06c5978a656846cb',
      sheetName: 'Inventory Detail',
      sourceInventoryDate: '2026-08-31',
      sourceRowCount: 5584,
    });
    expect(augustWorkbook.rows).toHaveLength(5584);
    expect(augustWorkbook.rows[0]).toMatchObject({
      workbookRow: 2,
      rawData: { Location: 'Liquor Cage', 'Counting Unit 1': 'Case' },
    });
  });

  it('reconstructs retained dated case tiers, but only with a matching raw source total', () => {
    expect(assessAugustSourceQuantity(sourceRow())).toMatchObject({
      status: 'evidenced',
      sourceUnit: 'lb',
      quantity: 20,
    });
    expect(assessAugustSourceQuantity(sourceRow({ rawData: {} })).status).toBe('unresolved');
  });

  it('does not turn a numeric total without dated pack geometry into a unit claim', () => {
    const finding = assessAugustSourceQuantity(sourceRow({
      caseQuantity: null,
      innerPackQuantity: null,
      baseUnitQuantity: null,
      count1: 0,
      count2: 0,
      count3: 20,
      rawData: { 'Total Units': 20 },
    }));
    expect(finding.status).toBe('unresolved');
  });

  it('treats zero as evidence only when all dated tier counts and the raw total are explicit', () => {
    const explicitZero = sourceRow({
      count1: 0,
      count2: 0,
      count3: 0,
      totalUnits: 0,
      rawData: { 'Total Units': 0 },
    });
    expect(assessAugustSourceQuantity(explicitZero)).toMatchObject({
      status: 'evidenced',
      quantity: 0,
    });
    expect(assessAugustSourceQuantity(sourceRow({
      count1: null,
      count2: 0,
      count3: 0,
      totalUnits: 0,
      rawData: { 'Total Units': 0 },
    })).status).toBe('unresolved');
    expect(assessAugustSourceQuantity(sourceRow({
      rawData: { 'Total Units': '' },
    })).status).toBe('unresolved');
  });

  it('requires same-kind lb/oz conversion and normalizes location whitespace', () => {
    expect(sourceToCanonicalFactor('lb', 'oz', 'weight', 'weight')).toBe(16);
    expect(sourceToCanonicalFactor('lb', 'ml', 'weight', 'volume')).toBeNull();
    expect(normalizeAugustLocation('  Walk-In   Cooler ')).toBe('walk-in cooler');
  });

  it('distinguishes seeded zero placeholders from explicit zero physical entries', () => {
    const seeded = { quantity: 0, hasEntry: false, caseQty: null, containerQty: null, looseUnits: null };
    expect(hasPhysicalCountEvidence(seeded)).toBe(false);
    expect(hasPhysicalCountEvidence({ ...seeded, hasEntry: true })).toBe(true);
    expect(hasPhysicalCountEvidence({ ...seeded, quantity: 2 })).toBe(true);
    expect(hasPhysicalCountEvidence({ ...seeded, caseQty: 0 })).toBe(true);
  });
  it('preserves earlier draft entries without treating them as newly confirmed August readings', () => {
    expect(hasConfirmedAugustEntry(new Date('2026-09-23T12:00:00Z'))).toBe(false);
    expect(hasConfirmedAugustEntry(new Date('2026-09-29T12:00:00Z'))).toBe(true);
    expect(hasConfirmedAugustEntry(null)).toBe(false);
    expect(hasConfirmedAugustEntry('not-a-date')).toBe(false);
  });
});