import { describe, it, expect } from 'vitest';
import { normalizeVendorUnit, extractPackInfoFromName } from './PdfOrderGuide';

// ─── normalizeVendorUnit ─────────────────────────────────────────────────────

describe('normalizeVendorUnit', () => {
  describe('weight', () => {
    it.each([
      ['lb', 'lb.'],
      ['LB', 'lb.'],
      ['lbs', 'lb.'],
      ['pound', 'lb.'],
      ['pounds', 'lb.'],
      ['oz', 'oz'],
      ['OZ', 'oz'],
      ['ounce', 'oz'],
      ['ounces', 'oz'],
      ['kg', 'kg'],
      ['KG', 'kg'],
      ['g', 'g'],
      ['gram', 'g'],
      ['grams', 'g'],
    ])('normalizes %s → %s', (input, expected) => {
      expect(normalizeVendorUnit(input)).toBe(expected);
    });
  });

  describe('volume', () => {
    it.each([
      ['gal', 'gal'],
      ['GAL', 'gal'],
      ['gallon', 'gal'],
      ['gallons', 'gal'],
      ['qt', 'qt'],
      ['quart', 'qt'],
      ['pt', 'pt'],
      ['pint', 'pt'],
      ['floz', 'fl oz'],
      ['FLOZ', 'fl oz'],
      ['ml', 'ml'],
      ['ML', 'ml'],
      ['l', 'l'],
      ['liter', 'l'],
      ['litre', 'l'],
    ])('normalizes %s → %s', (input, expected) => {
      expect(normalizeVendorUnit(input)).toBe(expected);
    });
  });

  describe('count-like units', () => {
    it.each([
      ['ea', 'each'],
      ['EA', 'each'],
      ['each', 'each'],
      ['ct', 'each'],
      ['CT', 'each'],
      ['count', 'each'],
      ['pc', 'each'],
      ['pcs', 'each'],
      ['piece', 'each'],
      ['pieces', 'each'],
    ])('normalizes %s → each', (input, expected) => {
      expect(normalizeVendorUnit(input)).toBe(expected);
    });
  });

  describe('sale-only units (should return null)', () => {
    it.each(['cs', 'CS', 'case', 'Case', 'pkg', 'pack', 'pk', 'can', 'bag'])(
      'returns null for %s',
      (input) => {
        expect(normalizeVendorUnit(input)).toBeNull();
      }
    );
  });

  describe('unknown units', () => {
    it('returns null for unrecognized units', () => {
      expect(normalizeVendorUnit('xyz')).toBeNull();
      expect(normalizeVendorUnit('dozen')).toBeNull();
      expect(normalizeVendorUnit('')).toBeNull();
    });
  });
});

// ─── extractPackInfoFromName ─────────────────────────────────────────────────

describe('extractPackInfoFromName', () => {
  describe('Pass 1 — slash+digit format (N/Nunit)', () => {
    it('parses 4/1gal', () => {
      const r = extractPackInfoFromName('Canola Oil - 4/1gal');
      expect(r.caseSize).toBe(4);
      expect(r.innerPack).toBe(1);
      expect(r.unit).toBe('gal');
      expect(r.caseSizeRaw).toBe('4/1gal');
    });

    it('parses 12/32oz', () => {
      const r = extractPackInfoFromName('Paper Towels - 12/32oz');
      expect(r.caseSize).toBe(12);
      expect(r.innerPack).toBe(32);
      expect(r.unit).toBe('oz');
    });

    it('parses 2/5lb', () => {
      const r = extractPackInfoFromName('Pasta - 2/5lb');
      expect(r.caseSize).toBe(2);
      expect(r.innerPack).toBe(5);
      expect(r.unit).toBe('lb.');
    });

    it('parses with space before unit: "6/5 lb"', () => {
      const r = extractPackInfoFromName('Chicken Breast - 6/5 lb');
      expect(r.caseSize).toBe(6);
      expect(r.innerPack).toBe(5);
      expect(r.unit).toBe('lb.');
    });

    it('parses 4/1 gal (with space)', () => {
      const r = extractPackInfoFromName('Vegetable Oil - 4/1 gal');
      expect(r.caseSize).toBe(4);
      expect(r.innerPack).toBe(1);
      expect(r.unit).toBe('gal');
    });

    it('parses 6/750ml', () => {
      const r = extractPackInfoFromName('Wine Vinegar - 6/750ml');
      expect(r.caseSize).toBe(6);
      expect(r.innerPack).toBe(750);
      expect(r.unit).toBe('ml');
    });
  });

  describe('Pass 1 — FL OZ two-word variants', () => {
    it('parses 12/32 FL OZ (spaced, uppercase)', () => {
      const r = extractPackInfoFromName('Juice - 12/32 FL OZ');
      expect(r.caseSize).toBe(12);
      expect(r.innerPack).toBe(32);
      expect(r.unit).toBe('fl oz');
    });

    it('parses 24/12 fl oz (spaced, lowercase)', () => {
      const r = extractPackInfoFromName('Soda - 24/12 fl oz');
      expect(r.caseSize).toBe(24);
      expect(r.innerPack).toBe(12);
      expect(r.unit).toBe('fl oz');
    });

    it('parses 6/32 fl. oz (period variant)', () => {
      const r = extractPackInfoFromName('Sauce - 6/32 fl. oz');
      expect(r.caseSize).toBe(6);
      expect(r.innerPack).toBe(32);
      expect(r.unit).toBe('fl oz');
    });

    it('parses 12/32FLOZ (no space, uppercase)', () => {
      const r = extractPackInfoFromName('Drink - 12/32FLOZ');
      expect(r.caseSize).toBe(12);
      expect(r.innerPack).toBe(32);
      expect(r.unit).toBe('fl oz');
    });
  });

  describe('Pass 2 — named-unit format (N/WORD)', () => {
    it('parses 2,500/Case', () => {
      const r = extractPackInfoFromName('Lid - 1.5, 2, 2.5oz - 62mm PET Clear PLastic - 2,500/Case');
      expect(r.caseSize).toBe(2500);
      expect(r.innerPack).toBeNull();
      expect(r.unit).toBeNull();
      expect(r.caseSizeRaw).toBe('2,500/Case');
    });

    it('parses 500/CS', () => {
      const r = extractPackInfoFromName('Lid - 7" Clear Round Plastic Dome Lid - 500/CS');
      expect(r.caseSize).toBe(500);
      expect(r.innerPack).toBeNull();
      expect(r.unit).toBeNull();
    });

    it('parses 24/Pack', () => {
      const r = extractPackInfoFromName('Water Bottles - 24/Pack');
      expect(r.caseSize).toBe(24);
      expect(r.innerPack).toBeNull();
      expect(r.unit).toBeNull();
    });

    it('parses 100/CT', () => {
      const r = extractPackInfoFromName('Gloves - 100/CT');
      expect(r.caseSize).toBe(100);
      expect(r.innerPack).toBeNull();
      expect(r.unit).toBeNull();
    });
  });

  describe('no match cases', () => {
    it('returns all nulls for a plain product name', () => {
      const r = extractPackInfoFromName('Chicken Breast Boneless Skinless');
      expect(r.caseSize).toBeNull();
      expect(r.caseSizeRaw).toBeNull();
      expect(r.innerPack).toBeNull();
      expect(r.unit).toBeNull();
    });

    it('returns all nulls for a name with no pack string', () => {
      const r = extractPackInfoFromName('Green Beans Fresh');
      expect(r.caseSize).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles comma-separated thousands in caseSize', () => {
      const r = extractPackInfoFromName('Napkins - 1,000/Case');
      expect(r.caseSize).toBe(1000);
    });

    it('returns null unit for unknown unit suffix', () => {
      const r = extractPackInfoFromName('Widget - 12/6xyz');
      expect(r.caseSize).toBe(12);
      expect(r.innerPack).toBe(6);
      expect(r.unit).toBeNull();
    });
  });
});
