import { describe, it, expect } from 'vitest';
import { extractNameCount } from './orderGuideProcessor';
import { isBottleOrCanWithFluidOz } from '../../shared/orderGuideUtils';

/**
 * Unit tests for extractNameCount().
 *
 * The regex recognises two families of patterns:
 *   1. <number> <count-keyword>  — slices, CT, count, pcs, pks, pieces, portions, servings
 *      and weight keywords       — oz, fl oz, lb/lbs/pound, g/grams
 *   2. (box|pack|bag|tray) of <number>
 *
 * Intentionally unsupported (return null):
 *   - "EA" unit  (e.g. "80 EA")
 *   - Raw numbers with no keyword   (e.g. "Widget 10")
 *   - Keywords with no leading number (e.g. bare "Box")
 */

describe('extractNameCount — count-keyword patterns', () => {
  it('"16 Slices" → 16', () => {
    expect(extractNameCount('Cheesecake Strawberry Swirl 16 Slices Frozen')).toBe(16);
  });

  it('"12 CT" → 12', () => {
    expect(extractNameCount('Burger Buns 12 CT')).toBe(12);
  });

  it('"24 Pcs" → 24', () => {
    expect(extractNameCount('Dinner Rolls 24 Pcs')).toBe(24);
  });

  it('"6 PK" → 6', () => {
    expect(extractNameCount('Party Mix 6 PK')).toBe(6);
  });

  it('"10 Portions" → 10', () => {
    expect(extractNameCount('Chicken Portions 10 Portions')).toBe(10);
  });

  it('"8 Servings" → 8', () => {
    expect(extractNameCount('Yogurt Parfait 8 Servings')).toBe(8);
  });
});

describe('extractNameCount — intentionally unsupported patterns (return null)', () => {
  it('plain product name with no number → null', () => {
    expect(extractNameCount('Chicken Wings')).toBeNull();
  });

  it('"80 EA" → null (EA is not a recognised unit)', () => {
    expect(extractNameCount('Plastic Forks 80 EA')).toBeNull();
  });

  it('bare "Box" with no number → null (no trailing count word)', () => {
    expect(extractNameCount('Box')).toBeNull();
  });

  it('raw number with no unit keyword → null', () => {
    expect(extractNameCount('Widget 10')).toBeNull();
  });

  it('number followed by an unrecognised unit → null', () => {
    expect(extractNameCount('Item 42 SKUs')).toBeNull();
  });
});

describe('extractNameCount — null / undefined / empty input', () => {
  it('returns null for null', () => {
    expect(extractNameCount(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(extractNameCount(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractNameCount('')).toBeNull();
  });
});

describe('extractNameCount — edge cases', () => {
  it('count of exactly 1 → null (n ≤ 1 guard)', () => {
    expect(extractNameCount('Single Serve 1 CT')).toBeNull();
  });

  it('count of 0 → null', () => {
    expect(extractNameCount('Zero Count 0 CT')).toBeNull();
  });

  it('leading zero "08 Slices" → 8', () => {
    expect(extractNameCount('Rolls 08 Slices')).toBe(8);
  });

  it('leading zero "01 CT" → null (resolves to 1, filtered)', () => {
    expect(extractNameCount('Item 01 CT')).toBeNull();
  });

  it('case-insensitive — "16 SLICES" → 16', () => {
    expect(extractNameCount('Cheesecake 16 SLICES')).toBe(16);
  });

  it('case-insensitive — "16 slices" → 16', () => {
    expect(extractNameCount('Cheesecake 16 slices')).toBe(16);
  });

  it('singular keyword — "8 Slice" → 8', () => {
    expect(extractNameCount('Cheesecake 8 Slice')).toBe(8);
  });

  it('hyphen between number and unit — "12-CT" → 12', () => {
    expect(extractNameCount('Hot Dogs 12-CT')).toBe(12);
  });

  it('count embedded mid-name → correctly extracted', () => {
    expect(extractNameCount('Frozen Pizza 8 Slices Pepperoni')).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// isBottleOrCanWithFluidOz
// ---------------------------------------------------------------------------

describe('isBottleOrCanWithFluidOz — positive (should return true)', () => {
  it('"Soda Root Beer Plastic Bottle" + "OZ" → true', () => {
    expect(isBottleOrCanWithFluidOz('Soda Root Beer Plastic Bottle', 'OZ')).toBe(true);
  });

  it('"Soda Root Beer 12 Ounce Can Fridge Pack" + "oz" → true', () => {
    expect(isBottleOrCanWithFluidOz('Soda Root Beer 12 Ounce Can Fridge Pack', 'oz')).toBe(true);
  });

  it('"Water Bottles 24pk" + "oz" → true (plural "bottles")', () => {
    expect(isBottleOrCanWithFluidOz('Water Bottles 24pk', 'oz')).toBe(true);
  });

  it('"Beer Cans Variety Pack" + "oz" → true (plural "cans")', () => {
    expect(isBottleOrCanWithFluidOz('Beer Cans Variety Pack', 'oz')).toBe(true);
  });

  it('normalises "fl. oz." → matches', () => {
    expect(isBottleOrCanWithFluidOz('Juice Bottle', 'fl. oz.')).toBe(true);
  });

  it('normalises "fl. oz" → matches', () => {
    expect(isBottleOrCanWithFluidOz('Juice Bottle', 'fl. oz')).toBe(true);
  });

  it('normalises "floz" (no space) → matches', () => {
    expect(isBottleOrCanWithFluidOz('Juice Bottle', 'floz')).toBe(true);
  });

  it('normalises "oz." (trailing period) → matches', () => {
    expect(isBottleOrCanWithFluidOz('Soda Bottle', 'oz.')).toBe(true);
  });

  it('normalises "OUNCE" (uppercase) → matches', () => {
    expect(isBottleOrCanWithFluidOz('Sparkling Water Bottle', 'OUNCE')).toBe(true);
  });

  it('normalises "FL OZ" (uppercase, no period) → matches', () => {
    expect(isBottleOrCanWithFluidOz('Juice Can', 'FL OZ')).toBe(true);
  });
});

describe('isBottleOrCanWithFluidOz — negative (should return false)', () => {
  it('no bottle/can keyword → false', () => {
    expect(isBottleOrCanWithFluidOz('Chicken Wings 24 oz', 'oz')).toBe(false);
  });

  it('"canola oil" — "can" is not a whole word → false', () => {
    expect(isBottleOrCanWithFluidOz('Canola Oil', 'oz')).toBe(false);
  });

  it('"pelican" — "can" is not a whole word → false', () => {
    expect(isBottleOrCanWithFluidOz('Pelican Seafood Mix', 'oz')).toBe(false);
  });

  it('"canonical" — "can" is not a whole word → false', () => {
    expect(isBottleOrCanWithFluidOz('Canonical Brand Sauce', 'oz')).toBe(false);
  });

  it('bottle keyword present but UOM is LB (not fluid oz) → false', () => {
    expect(isBottleOrCanWithFluidOz('BBQ Sauce Bottle', 'LB')).toBe(false);
  });

  it('bottle keyword present but UOM is EA → false', () => {
    expect(isBottleOrCanWithFluidOz('Water Bottle', 'EA')).toBe(false);
  });

  it('null product name → false', () => {
    expect(isBottleOrCanWithFluidOz(null, 'oz')).toBe(false);
  });

  it('null UOM → false', () => {
    expect(isBottleOrCanWithFluidOz('Soda Bottle', null)).toBe(false);
  });

  it('both null → false', () => {
    expect(isBottleOrCanWithFluidOz(null, null)).toBe(false);
  });

  it('empty strings → false', () => {
    expect(isBottleOrCanWithFluidOz('', '')).toBe(false);
  });
});
