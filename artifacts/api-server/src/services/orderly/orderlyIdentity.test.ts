import { describe, expect, it } from 'vitest';
import {
  buildOrderlyIdentityGroup,
  canonicalOrderlyPackKey,
  deriveOrderlyAlternateSourceId,
  normalizeOrderlyProductName,
} from './orderlyIdentity';

describe('Orderly derived product identities', () => {
  it('normalizes Unicode punctuation while retaining meaningful qualifiers', () => {
    expect(normalizeOrderlyProductName('  Café—Ground  Red  ’Reserve’  '))
      .toBe('café ground red reserve');
  });

  it('uses all normalized pack evidence rather than case quantity alone', () => {
    const sixOneLiter = canonicalOrderlyPackKey({
      caseQuantity: 6,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'LT',
    });
    const fiveFiftyMilliliter = canonicalOrderlyPackKey({
      caseQuantity: 5,
      innerPackQuantity: 1,
      baseUnitQuantity: 50,
      baseUnit: 'ML',
    });

    expect(sixOneLiter).not.toBe(fiveFiftyMilliliter);
  });

  it('builds a stable ALT source identity for location siblings', () => {
    const sourceId = deriveOrderlyAlternateSourceId('Red Breast Irish Whiskey 12Yr', {
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ml',
    });
    const group = buildOrderlyIdentityGroup({
      rowIndex: 12,
      cleanedDescription: 'RED BREAST Irish Whiskey 12yr',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
    });

    expect(sourceId).toBe('ALT|red breast irish whiskey 12yr|case=1|inner=1|base=750|unit=ml');
    expect(group?.alternateSourceId).toBe(sourceId);
  });
});