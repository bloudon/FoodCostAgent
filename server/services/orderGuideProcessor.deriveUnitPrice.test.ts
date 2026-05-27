import { describe, it, expect } from 'vitest';
import { deriveUnitPrice } from './orderGuideProcessor';

// ─── "each" unit family ───────────────────────────────────────────────────────

describe('deriveUnitPrice — each unit', () => {
  it('pretzels 12/10 Oz, unit=each → $40.53 ÷ 12 = $3.3775/ea', () => {
    const { unitPrice, unitLabel, divisor } = deriveUnitPrice(40.53, 12, 10, 'OZ', 'each');
    expect(unitPrice).toBeCloseTo(40.53 / 12);
    expect(unitLabel).toBe('ea');
    expect(divisor).toBe(12);
  });

  it('beef philly 40/4 Oz, unit=each → $84.50 ÷ 40 = $2.1125/ea', () => {
    const { unitPrice, unitLabel } = deriveUnitPrice(84.50, 40, 4, 'OZ', 'each');
    expect(unitPrice).toBeCloseTo(84.50 / 40);
    expect(unitLabel).toBe('ea');
  });

  it('"piece" is treated as each family', () => {
    const { unitLabel } = deriveUnitPrice(50, 10, 2, 'OZ', 'piece');
    expect(unitLabel).toBe('ea');
  });

  it('"count" is treated as each family', () => {
    const { unitPrice } = deriveUnitPrice(60, 12, 3, 'OZ', 'count');
    expect(unitPrice).toBeCloseTo(60 / 12);
  });

  it('"ct" is treated as each family', () => {
    const { unitPrice } = deriveUnitPrice(24, 8, 5, 'OZ', 'ct');
    expect(unitPrice).toBeCloseTo(24 / 8);
  });
});

// ─── "lb" unit family ─────────────────────────────────────────────────────────

describe('deriveUnitPrice — lb unit', () => {
  it('beef philly 40/4 Oz, unit=pound → $84.50 ÷ 10 lb = $8.45/lb', () => {
    // 40 × 4 oz = 160 oz = 10 lb
    const { unitPrice, unitLabel, divisor } = deriveUnitPrice(84.50, 40, 4, 'OZ', 'pound');
    expect(unitPrice).toBeCloseTo(8.45);
    expect(unitLabel).toBe('lb');
    expect(divisor).toBeCloseTo(10);
  });

  it('"lb" unit name works identically to "pound"', () => {
    const { unitPrice } = deriveUnitPrice(84.50, 40, 4, 'OZ', 'lb');
    expect(unitPrice).toBeCloseTo(8.45);
  });

  it('6/5 LB pack, unit=pound → $60 ÷ 30 lb = $2.00/lb', () => {
    const { unitPrice, unitLabel, divisor } = deriveUnitPrice(60, 6, 5, 'LB', 'pound');
    expect(unitPrice).toBeCloseTo(2.00);
    expect(unitLabel).toBe('lb');
    expect(divisor).toBeCloseTo(30);
  });

  it('packUom=oz converts to lbs correctly for 1/10 Oz, unit=lb', () => {
    // 1 × 10 oz = 0.625 lb; $5 ÷ 0.625 = $8/lb
    const { unitPrice } = deriveUnitPrice(5, 1, 10, 'oz', 'pound');
    expect(unitPrice).toBeCloseTo(5 / (10 / 16));
  });
});

// ─── "oz" unit family ─────────────────────────────────────────────────────────

describe('deriveUnitPrice — oz unit', () => {
  it('pretzels 12/10 Oz, unit=ounce → $40.53 ÷ 120 = $0.3378/oz', () => {
    const { unitPrice, unitLabel, divisor } = deriveUnitPrice(40.53, 12, 10, 'OZ', 'ounce');
    expect(unitPrice).toBeCloseTo(40.53 / 120);
    expect(unitLabel).toBe('oz');
    expect(divisor).toBe(120);
  });

  it('"oz" unit name works identically to "ounce"', () => {
    const { unitPrice } = deriveUnitPrice(40.53, 12, 10, 'OZ', 'oz');
    expect(unitPrice).toBeCloseTo(40.53 / 120);
  });
});

// ─── default / fallback ───────────────────────────────────────────────────────

describe('deriveUnitPrice — default fallback', () => {
  it('unknown unit falls back to outerCount × innerSize divisor', () => {
    const { unitPrice, divisor } = deriveUnitPrice(100, 4, 5, 'GAL', 'gallon');
    expect(divisor).toBe(20);
    expect(unitPrice).toBeCloseTo(5);
  });

  it('empty inventory unit name falls back gracefully', () => {
    const { unitPrice } = deriveUnitPrice(100, 5, 4, 'OZ', '');
    expect(unitPrice).toBeCloseTo(100 / 20);
  });

  it('empty packUom does not throw', () => {
    const { unitPrice } = deriveUnitPrice(50, 10, 1, '', 'pound');
    // lb family + no oz packUom → treat innerSize as lb → 10 × 1 = 10 lb
    expect(unitPrice).toBeCloseTo(5);
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('deriveUnitPrice — edge cases', () => {
  it('outerCount=0 uses safeOuter=1 to prevent division by zero', () => {
    const { unitPrice } = deriveUnitPrice(10, 0, 1, 'OZ', 'each');
    expect(Number.isFinite(unitPrice)).toBe(true);
    expect(unitPrice).toBeCloseTo(10);
  });

  it('innerSize=0 uses safeInner=1 to prevent division by zero', () => {
    const { unitPrice } = deriveUnitPrice(10, 12, 0, 'OZ', 'oz');
    expect(Number.isFinite(unitPrice)).toBe(true);
  });

  it('case sensitivity: packUom and inventoryUnitName are normalised', () => {
    const a = deriveUnitPrice(84.50, 40, 4, 'OZ', 'pound');
    const b = deriveUnitPrice(84.50, 40, 4, 'oz', 'POUND');
    expect(a.unitPrice).toBeCloseTo(b.unitPrice);
  });
});
