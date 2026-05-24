/**
 * Unit tests for pack-size mismatch detection helpers used in the order guide review flow.
 *
 * Tests cover:
 *   hasPackSizeMismatch — the core mismatch predicate
 *   formatStoredPackSize — display formatting of the stored (prior) pack size
 *
 * These functions are deliberately pure (no I/O, no React) so every branch can
 * be verified with straightforward in-process unit tests, without needing a
 * browser or a live database connection.
 */

import { describe, it, expect } from 'vitest';
import { hasPackSizeMismatch, formatStoredPackSize } from './orderGuidePackSize';

// ---------------------------------------------------------------------------
// hasPackSizeMismatch
// ---------------------------------------------------------------------------

describe('hasPackSizeMismatch', () => {
  describe('null storedCaseSize → no prior vendor item', () => {
    it('returns false when storedCaseSize is null (new item — no prior vendor record)', () => {
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: 1, storedCaseSize: null, storedInnerPackSize: null })).toBe(false);
    });

    it('returns false when storedCaseSize is null regardless of innerPack values', () => {
      expect(hasPackSizeMismatch({ caseSize: 12, innerPack: 5, storedCaseSize: null, storedInnerPackSize: 3 })).toBe(false);
    });
  });

  describe('identical sizes → no mismatch', () => {
    it('returns false when caseSize and innerPack exactly match stored values', () => {
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: 1, storedCaseSize: 6, storedInnerPackSize: 1 })).toBe(false);
    });

    it('returns false when storedInnerPackSize is null and imported innerPack is 1 (both default to 1)', () => {
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: 1, storedCaseSize: 6, storedInnerPackSize: null })).toBe(false);
    });

    it('returns false when imported innerPack is null and storedInnerPackSize is null (both default to 1)', () => {
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: null, storedCaseSize: 6, storedInnerPackSize: null })).toBe(false);
    });

    it('returns false when imported caseSize is null and storedCaseSize is 1 (both default to 1)', () => {
      expect(hasPackSizeMismatch({ caseSize: null, innerPack: null, storedCaseSize: 1, storedInnerPackSize: null })).toBe(false);
    });
  });

  describe('caseSize mismatch', () => {
    it('returns true when imported caseSize is larger than stored caseSize', () => {
      expect(hasPackSizeMismatch({ caseSize: 12, innerPack: 1, storedCaseSize: 6, storedInnerPackSize: 1 })).toBe(true);
    });

    it('returns true when imported caseSize is smaller than stored caseSize', () => {
      expect(hasPackSizeMismatch({ caseSize: 4, innerPack: 1, storedCaseSize: 6, storedInnerPackSize: 1 })).toBe(true);
    });
  });

  describe('innerPack mismatch (caseSize unchanged)', () => {
    it('returns true when only innerPack differs', () => {
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: 5, storedCaseSize: 6, storedInnerPackSize: 3 })).toBe(true);
    });

    it('returns true when stored innerPack is null (defaults to 1) but imported innerPack is > 1', () => {
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: 3, storedCaseSize: 6, storedInnerPackSize: null })).toBe(true);
    });
  });

  describe('both caseSize and innerPack changed', () => {
    it('returns true when both dimensions differ from stored values', () => {
      expect(hasPackSizeMismatch({ caseSize: 12, innerPack: 6, storedCaseSize: 6, storedInnerPackSize: 3 })).toBe(true);
    });
  });

  describe('floating-point tolerance (±0.001)', () => {
    it('returns true for a difference of exactly 0.001 (boundary — strictly greater-than check triggers mismatch)', () => {
      expect(hasPackSizeMismatch({ caseSize: 6.001, innerPack: 1, storedCaseSize: 6.0, storedInnerPackSize: 1 })).toBe(true);
    });

    it('returns false for a difference of 0.0005 (well within tolerance)', () => {
      expect(hasPackSizeMismatch({ caseSize: 6.0005, innerPack: 1, storedCaseSize: 6.0, storedInnerPackSize: 1 })).toBe(false);
    });

    it('returns true for a difference of 0.002 (outside tolerance)', () => {
      expect(hasPackSizeMismatch({ caseSize: 6.002, innerPack: 1, storedCaseSize: 6.0, storedInnerPackSize: 1 })).toBe(true);
    });

    it('returns true for a difference of 0.0011 (just outside tolerance)', () => {
      expect(hasPackSizeMismatch({ caseSize: 6.0011, innerPack: 1, storedCaseSize: 6.0, storedInnerPackSize: 1 })).toBe(true);
    });

    it('applies the same floating-point tolerance to innerPack comparison', () => {
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: 1.002, storedCaseSize: 6, storedInnerPackSize: 1 })).toBe(true);
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: 1.0005, storedCaseSize: 6, storedInnerPackSize: 1 })).toBe(false);
    });

    it('returns false for floating-point values that are mathematically identical', () => {
      expect(hasPackSizeMismatch({ caseSize: 6.5, innerPack: 2.5, storedCaseSize: 6.5, storedInnerPackSize: 2.5 })).toBe(false);
    });
  });

  describe('null / undefined imported values default correctly', () => {
    it('treats null caseSize as 1 for comparison', () => {
      expect(hasPackSizeMismatch({ caseSize: null, innerPack: 1, storedCaseSize: 1, storedInnerPackSize: 1 })).toBe(false);
      expect(hasPackSizeMismatch({ caseSize: null, innerPack: 1, storedCaseSize: 6, storedInnerPackSize: 1 })).toBe(true);
    });

    it('treats null innerPack as 1 for comparison', () => {
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: null, storedCaseSize: 6, storedInnerPackSize: 1 })).toBe(false);
      expect(hasPackSizeMismatch({ caseSize: 6, innerPack: null, storedCaseSize: 6, storedInnerPackSize: 5 })).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// formatStoredPackSize
// ---------------------------------------------------------------------------

describe('formatStoredPackSize', () => {
  it('returns "-" when storedCaseSize is null', () => {
    expect(formatStoredPackSize({ storedCaseSize: null, storedInnerPackSize: null, uom: 'LB' })).toBe('-');
  });

  it('returns just the caseSize with UOM when innerPack is null', () => {
    expect(formatStoredPackSize({ storedCaseSize: 6, storedInnerPackSize: null, uom: 'LB' })).toBe('6 LB');
  });

  it('returns just the caseSize with UOM when innerPack is 1 (single-pack)', () => {
    expect(formatStoredPackSize({ storedCaseSize: 6, storedInnerPackSize: 1, uom: 'LB' })).toBe('6 LB');
  });

  it('returns "caseSize × innerPack UOM" when innerPack > 1', () => {
    expect(formatStoredPackSize({ storedCaseSize: 6, storedInnerPackSize: 5, uom: 'LB' })).toBe('6 × 5 LB');
  });

  it('omits UOM suffix when uom is null', () => {
    expect(formatStoredPackSize({ storedCaseSize: 6, storedInnerPackSize: null, uom: null })).toBe('6');
  });

  it('omits UOM suffix when uom is undefined', () => {
    expect(formatStoredPackSize({ storedCaseSize: 6, storedInnerPackSize: 5 })).toBe('6 × 5');
  });

  it('omits UOM suffix in compound format when uom is null', () => {
    expect(formatStoredPackSize({ storedCaseSize: 12, storedInnerPackSize: 4, uom: null })).toBe('12 × 4');
  });

  it('handles decimal caseSize values', () => {
    expect(formatStoredPackSize({ storedCaseSize: 6.5, storedInnerPackSize: null, uom: 'LB' })).toBe('6.5 LB');
  });

  it('handles decimal innerPackSize values', () => {
    expect(formatStoredPackSize({ storedCaseSize: 6, storedInnerPackSize: 2.5, uom: 'KG' })).toBe('6 × 2.5 KG');
  });
});
