import { describe, expect, it } from 'vitest';
import { comparePackGeometry } from './packGeometry';

describe('Orderly source pack compatibility', () => {
  it('keeps Casamigos 6 × 1 L and 5 × 50 ml as incompatible pack variants', () => {
    const result = comparePackGeometry(
      { caseQuantity: 6, innerPackQuantity: 1, baseUnitQuantity: 1, baseUnit: 'LT' },
      { caseQuantity: 5, innerPackQuantity: 1, baseUnitQuantity: 50, baseUnit: 'ML' },
    );

    expect(result.status).toBe('incompatible');
    expect(result.reason).toContain('6000 ML versus 250 ML');
  });

  it('treats Stella 1 × 24 EA and 2 × 12 EA as equivalent packs', () => {
    const result = comparePackGeometry(
      { caseQuantity: 1, innerPackQuantity: 24, baseUnitQuantity: 1, baseUnit: 'EA' },
      { caseQuantity: 2, innerPackQuantity: 12, baseUnitQuantity: 1, baseUnit: 'each' },
    );

    expect(result.status).toBe('compatible');
    expect(result.normalizedUnit).toBe('EA');
    expect(result.totalBaseUnits).toBe(24);
  });

  it('permits a true Red Breast 750 ml re-code when pack geometry is unchanged', () => {
    const result = comparePackGeometry(
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 750, baseUnit: 'ML' },
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 750, baseUnit: 'ml' },
    );

    expect(result.status).toBe('compatible');
    expect(result.reason).toContain('750 ML');
  });

  it('fails closed when either source mapping lacks parsed geometry', () => {
    const result = comparePackGeometry(
      { caseQuantity: 1, innerPackQuantity: 24, baseUnitQuantity: 1, baseUnit: 'EA' },
      { caseQuantity: null, innerPackQuantity: null, baseUnitQuantity: null, baseUnit: null },
    );

    expect(result.status).toBe('unknown');
  });
});