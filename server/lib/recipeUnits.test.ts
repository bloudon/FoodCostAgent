import { describe, it, expect } from "vitest";
import { convertToInventoryUnits } from "./recipeUnits";
import type { Unit, InventoryItemUnit } from "@shared/schema";

// Minimal unit stubs that mirror seed.ts values for the relevant units.
// Weight base = gram (1 g = 1), Volume base = milliliter (1 mL = 1).
const LB: Unit = {
  id: "unit-lb",
  name: "pound",
  abbreviation: "lb.",
  kind: "weight",
  toBaseRatio: 453.592,
  system: "imperial",
  sortOrder: 1,
  companyId: null,
};
const OZ_WEIGHT: Unit = {
  id: "unit-oz",
  name: "ounce (weight)",
  abbreviation: "oz",
  kind: "weight",
  toBaseRatio: 28.3495,
  system: "imperial",
  sortOrder: 2,
  companyId: null,
};
const CUP: Unit = {
  id: "unit-cup",
  name: "cup",
  abbreviation: "c",
  kind: "volume",
  toBaseRatio: 236.588,
  system: "imperial",
  sortOrder: 10,
  companyId: null,
};
const TBSP: Unit = {
  id: "unit-tbsp",
  name: "tablespoon",
  abbreviation: "tbsp",
  kind: "volume",
  toBaseRatio: 14.7868,
  system: "imperial",
  sortOrder: 11,
  companyId: null,
};
const TSP: Unit = {
  id: "unit-tsp",
  name: "teaspoon",
  abbreviation: "tsp",
  kind: "volume",
  toBaseRatio: 4.92892,
  system: "imperial",
  sortOrder: 12,
  companyId: null,
};
const EACH: Unit = {
  id: "unit-each",
  name: "each",
  abbreviation: "ea",
  kind: "count",
  toBaseRatio: 1,
  system: null,
  sortOrder: 20,
  companyId: null,
};

const ALL_UNITS = [LB, OZ_WEIGHT, CUP, TBSP, TSP, EACH];

// Inventory item priced by pound
const ITEM_BY_LB = { id: "item-oil", unitId: LB.id };

describe("convertToInventoryUnits — water-density fallback", () => {
  const noOverrides: InventoryItemUnit[] = [];

  it("trivial case: same unit → returns qty unchanged", () => {
    expect(convertToInventoryUnits(2, LB, ITEM_BY_LB, ALL_UNITS, noOverrides)).toBe(2);
  });

  it("1 cup of a per-lb item → ≈ 0.5216 lb (water density: 1 mL = 1 g)", () => {
    const result = convertToInventoryUnits(1, CUP, ITEM_BY_LB, ALL_UNITS, noOverrides);
    expect(result).not.toBeNull();
    // 1 cup × 236.588 mL / 453.592 g/lb ≈ 0.5216 lb
    expect(result!).toBeCloseTo(0.5216, 3);
  });

  it("1 tablespoon of a per-lb item → ≈ 0.0326 lb", () => {
    const result = convertToInventoryUnits(1, TBSP, ITEM_BY_LB, ALL_UNITS, noOverrides);
    expect(result).not.toBeNull();
    // 1 tbsp × 14.7868 mL / 453.592 g/lb ≈ 0.0326 lb
    expect(result!).toBeCloseTo(0.0326, 3);
  });

  it("1 teaspoon of a per-lb item → ≈ 0.0109 lb (≈ 0.17 oz — chef's benchmark)", () => {
    const result = convertToInventoryUnits(1, TSP, ITEM_BY_LB, ALL_UNITS, noOverrides);
    expect(result).not.toBeNull();
    // 1 tsp × 4.92892 mL / 453.592 g/lb ≈ 0.01087 lb (≈ 0.174 oz)
    expect(result!).toBeCloseTo(0.01087, 4);
  });

  it("count unit against a per-lb item → null (uncostable — no density path for count)", () => {
    expect(
      convertToInventoryUnits(1, EACH, ITEM_BY_LB, ALL_UNITS, noOverrides)
    ).toBeNull();
  });
});

describe("convertToInventoryUnits — explicit per-item override WINS over water-density", () => {
  // Olive oil is denser than water: ~0.917 g/mL.
  // Water-density alone would say 1 cup = 0.5216 lb.
  // Chef saved: 1.84 cups per lb (= 1 lb / 0.917 g/mL / 236.588 mL × 453.592 g ≈ 2.09
  // — but we use an arbitrary saved value of 1.84 to test override behaviour).
  const OIL_CUP_OVERRIDE: InventoryItemUnit = {
    id: "override-oil-cup",
    inventoryItemId: ITEM_BY_LB.id,
    unitId: CUP.id,
    qtyPerInventoryUnit: 1.84, // cups per lb — olive-oil density factor
    isIssueUnit: 0,
    sortOrder: 1,
    companyId: "company-1",
    createdAt: new Date(),
  };

  it("uses the saved per-item factor (not water-density) when override exists", () => {
    const result = convertToInventoryUnits(
      1,
      CUP,
      ITEM_BY_LB,
      ALL_UNITS,
      [OIL_CUP_OVERRIDE]
    );
    expect(result).not.toBeNull();
    // qty / qtyPerInventoryUnit = 1 / 1.84 ≈ 0.5435 lb
    // Water-density would give 0.5216 lb — different, proves override is used.
    expect(result!).toBeCloseTo(1 / 1.84, 4);
    // Confirm it is NOT the water-density value
    expect(result!).not.toBeCloseTo(0.5216, 3);
  });

  it("zero qtyPerInventoryUnit override is ignored, falls back to water-density", () => {
    const BAD_OVERRIDE: InventoryItemUnit = { ...OIL_CUP_OVERRIDE, qtyPerInventoryUnit: 0 };
    const result = convertToInventoryUnits(1, CUP, ITEM_BY_LB, ALL_UNITS, [BAD_OVERRIDE]);
    expect(result).not.toBeNull();
    // Falls through to water-density: ≈ 0.5216 lb
    expect(result!).toBeCloseTo(0.5216, 3);
  });

  it("issue-unit override (isIssueUnit=1) is ignored for recipe costing, falls back to water-density", () => {
    const ISSUE_OVERRIDE: InventoryItemUnit = { ...OIL_CUP_OVERRIDE, isIssueUnit: 1 };
    const result = convertToInventoryUnits(1, CUP, ITEM_BY_LB, ALL_UNITS, [ISSUE_OVERRIDE]);
    expect(result).not.toBeNull();
    // Issue-unit rows are skipped for recipe costing — falls to water-density
    expect(result!).toBeCloseTo(0.5216, 3);
  });
});

describe("convertToInventoryUnits — same-kind conversions still work", () => {
  const noOverrides: InventoryItemUnit[] = [];

  it("oz → lb (same weight kind): 16 oz = 1 lb", () => {
    const result = convertToInventoryUnits(16, OZ_WEIGHT, ITEM_BY_LB, ALL_UNITS, noOverrides);
    expect(result).not.toBeNull();
    // 16 × 28.3495 / 453.592 ≈ 1.0 lb
    expect(result!).toBeCloseTo(1.0, 3);
  });
});
