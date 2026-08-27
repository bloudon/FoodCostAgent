import { describe, expect, it } from 'vitest';
import {
  comparePackGeometry,
  isSupportedPackUnit,
  normalizePackGeometry,
  toCatalogPackGeometry,
} from './packGeometry';

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

  it.each([
    ['case quantity', { caseQuantity: null, innerPackQuantity: 1, baseUnitQuantity: 24, baseUnit: 'EA' }],
    ['inner-pack quantity', { caseQuantity: 1, innerPackQuantity: null, baseUnitQuantity: 24, baseUnit: 'EA' }],
    ['base-unit quantity', { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: null, baseUnit: 'EA' }],
  ])('treats missing %s as unconfirmed rather than assuming one', (_missingTier, incomplete) => {
    const normalized = normalizePackGeometry(incomplete);
    const comparison = comparePackGeometry(
      incomplete,
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 24, baseUnit: 'EA' },
    );

    expect(normalized).toMatchObject({ status: 'unknown', totalBaseUnits: null });
    expect(comparison).toMatchObject({ status: 'unknown', totalBaseUnits: null });
  });

  it.each([
    [
      '5/50 ML',
      { caseQuantity: 5, innerPackQuantity: 1, baseUnitQuantity: 50, baseUnit: 'ML' },
      { canonicalUnit: 'ML', containerSize: 50, casePkgCount: 5, caseSize: 250 },
    ],
    [
      '2/12 EA',
      { caseQuantity: 2, innerPackQuantity: 12, baseUnitQuantity: 1, baseUnit: 'EA' },
      { canonicalUnit: 'EA', containerSize: 1, casePkgCount: 24, caseSize: 24 },
    ],
    [
      '6/12 OZ',
      { caseQuantity: 6, innerPackQuantity: 1, baseUnitQuantity: 12, baseUnit: 'OZ' },
      { canonicalUnit: 'OZ', containerSize: 12, casePkgCount: 6, caseSize: 72 },
    ],
  ])('maps %s into the catalog container hierarchy', (_label, source, expected) => {
    expect(toCatalogPackGeometry(source)).toEqual(expected);
  });

  it('normalizes liters before deriving the catalog hierarchy', () => {
    expect(toCatalogPackGeometry({
      caseQuantity: 6,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'LT',
    })).toEqual({
      canonicalUnit: 'ML',
      containerSize: 1000,
      casePkgCount: 6,
      caseSize: 6000,
    });
  });

  it('keeps the Milk whole-case evidence distinct', () => {
    expect(toCatalogPackGeometry({
      caseQuantity: 4,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'GALLON',
    })).toEqual({
      canonicalUnit: 'ML',
      containerSize: 3785.41,
      casePkgCount: 4,
      caseSize: 15141.64,
    });
    expect(toCatalogPackGeometry({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'GALLON',
    })).toEqual({
      canonicalUnit: 'ML',
      containerSize: 3785.41,
      casePkgCount: 1,
      caseSize: 3785.41,
    });
    expect(comparePackGeometry(
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 1, baseUnit: 'GALLON' },
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 3785.41, baseUnit: 'ML' },
    )).toMatchObject({
      status: 'compatible',
      normalizedUnit: 'ML',
      totalBaseUnits: 3785.41,
    });
  });

  it('normalizes QT and GAL against equivalent ML volume evidence', () => {
    expect(comparePackGeometry(
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 1, baseUnit: 'QT' },
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 946.353, baseUnit: 'ML' },
    )).toMatchObject({
      status: 'compatible',
      normalizedUnit: 'ML',
      totalBaseUnits: 946.353,
    });

    expect(comparePackGeometry(
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 1, baseUnit: 'GAL' },
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 3785.41, baseUnit: 'ML' },
    ).status).toBe('compatible');
  });

  it('normalizes kilograms and dozens without treating them as opaque units', () => {
    expect(comparePackGeometry(
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 1, baseUnit: 'KG' },
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 35.27396195, baseUnit: 'OZ' },
    ).status).toBe('compatible');
    expect(comparePackGeometry(
      { caseQuantity: 9, innerPackQuantity: 12, baseUnitQuantity: 1, baseUnit: 'DZ' },
      { caseQuantity: 1, innerPackQuantity: 1296, baseUnitQuantity: 1, baseUnit: 'EA' },
    )).toMatchObject({
      status: 'compatible',
      normalizedUnit: 'EA',
      totalBaseUnits: 1296,
    });
  });

  it('keeps Case and other unsupported units unknown', () => {
    expect(isSupportedPackUnit('Case')).toBe(false);
    expect(normalizePackGeometry({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'Case',
    })).toMatchObject({ status: 'unknown', totalBaseUnits: null });
    expect(toCatalogPackGeometry({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'FURLONG',
    })).toBeNull();
  });

  it('fails closed when normalized pack multiplication overflows', () => {
    const overflow = {
      caseQuantity: Number.MAX_VALUE,
      innerPackQuantity: Number.MAX_VALUE,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
    };

    expect(normalizePackGeometry(overflow)).toMatchObject({
      status: 'unknown',
      totalBaseUnits: null,
    });
    expect(comparePackGeometry(overflow, overflow)).toMatchObject({
      status: 'unknown',
      totalBaseUnits: null,
    });
  });
});