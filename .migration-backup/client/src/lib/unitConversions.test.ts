import { describe, it, expect } from "vitest";
import { getSuggestedConversionFactor, getWaterDensityConversionFactor } from "./unitConversions";

describe("getSuggestedConversionFactor", () => {
  // Same-unit pairs always return null
  describe("same-unit pairs", () => {
    it("returns null for identical volume units", () => {
      expect(getSuggestedConversionFactor("liter", "liter")).toBeNull();
    });

    it("returns null for identical weight units", () => {
      expect(getSuggestedConversionFactor("kilogram", "kilogram")).toBeNull();
    });

    it("returns null for identical count units", () => {
      expect(getSuggestedConversionFactor("each", "each")).toBeNull();
    });
  });

  // Same-kind volume pairs
  describe("same-kind volume pairs", () => {
    it("converts liter (inventory) to milliliter (recipe)", () => {
      // 1 liter = 1000 ml, so factor = inventoryRatio / recipeRatio = 1000 / 1 = 1000
      expect(getSuggestedConversionFactor("milliliter", "liter")).toBe(1000);
    });

    it("converts gallon (inventory) to cup (recipe)", () => {
      // 1 gallon = 3785.41 ml, 1 cup = 236.588 ml
      // factor = 3785.41 / 236.588 ≈ 16
      const factor = getSuggestedConversionFactor("cup", "gallon");
      expect(factor).not.toBeNull();
      expect(factor!).toBeCloseTo(16, 1);
    });

    it("converts quart (inventory) to cup (recipe)", () => {
      // 1 quart = 946.353 ml, 1 cup = 236.588 ml
      // factor = 946.353 / 236.588 ≈ 4
      const factor = getSuggestedConversionFactor("cup", "quart");
      expect(factor).not.toBeNull();
      expect(factor!).toBeCloseTo(4, 1);
    });

    it("converts tablespoon (inventory) to teaspoon (recipe)", () => {
      // 1 tablespoon = 14.7868 ml, 1 teaspoon = 4.92892 ml
      // factor ≈ 3
      const factor = getSuggestedConversionFactor("teaspoon", "tablespoon");
      expect(factor).not.toBeNull();
      expect(factor!).toBeCloseTo(3, 1);
    });

    it("converts fluid ounce (inventory) to milliliter (recipe)", () => {
      // 1 fl oz = 29.5735 ml, 1 ml = 1 ml → factor ≈ 29.5735
      const factor = getSuggestedConversionFactor("milliliter", "fluid ounce");
      expect(factor).not.toBeNull();
      expect(factor!).toBeCloseTo(29.5735, 2);
    });
  });

  // Same-kind weight pairs
  describe("same-kind weight pairs", () => {
    it("converts kilogram (inventory) to gram (recipe)", () => {
      // 1 kg = 1000 g, 1 g = 1 g → factor = 1000
      expect(getSuggestedConversionFactor("gram", "kilogram")).toBe(1000);
    });

    it("converts pound (inventory) to ounce (recipe)", () => {
      // 1 lb = 453.592 g, 1 oz = 28.3495 g → factor ≈ 16
      const factor = getSuggestedConversionFactor("ounce (weight)", "pound");
      expect(factor).not.toBeNull();
      expect(factor!).toBeCloseTo(16, 1);
    });

    it("converts gram (inventory) to kilogram (recipe)", () => {
      // 1 g = 1 g, 1 kg = 1000 g → factor = 1 / 1000 = 0.001
      const factor = getSuggestedConversionFactor("kilogram", "gram");
      expect(factor).not.toBeNull();
      expect(factor!).toBeCloseTo(0.001, 5);
    });
  });

  // Cross-kind pairs must return null
  describe("cross-kind pairs (volume ↔ weight, etc.)", () => {
    it("returns null for cup (volume recipe) vs pound (weight inventory)", () => {
      expect(getSuggestedConversionFactor("cup", "pound")).toBeNull();
    });

    it("returns null for gram (weight recipe) vs liter (volume inventory)", () => {
      expect(getSuggestedConversionFactor("gram", "liter")).toBeNull();
    });

    it("returns null for each (count recipe) vs kilogram (weight inventory)", () => {
      expect(getSuggestedConversionFactor("each", "kilogram")).toBeNull();
    });

    it("returns null for milliliter (volume recipe) vs ounce weight (weight inventory)", () => {
      expect(getSuggestedConversionFactor("milliliter", "ounce (weight)")).toBeNull();
    });
  });

  // Case-insensitive lookup
  describe("case-insensitive lookup", () => {
    it("matches 'Liter' and 'Milliliter' regardless of case", () => {
      expect(getSuggestedConversionFactor("Milliliter", "Liter")).toBe(1000);
    });

    it("matches 'GRAM' and 'KILOGRAM'", () => {
      expect(getSuggestedConversionFactor("GRAM", "KILOGRAM")).toBe(1000);
    });

    it("matches 'Cup' and 'Quart' with mixed case", () => {
      const factor = getSuggestedConversionFactor("Cup", "Quart");
      expect(factor).not.toBeNull();
      expect(factor!).toBeCloseTo(4, 1);
    });

    it("handles leading/trailing whitespace", () => {
      expect(getSuggestedConversionFactor("  gram  ", "  kilogram  ")).toBe(1000);
    });
  });

  // Cross-kind pairs must return null (getSuggestedConversionFactor)
  describe("cross-kind pairs (volume ↔ weight, etc.)", () => {
    it("returns null when recipe unit is unknown", () => {
      expect(getSuggestedConversionFactor("smidgen", "liter")).toBeNull();
    });

    it("returns null when inventory unit is unknown", () => {
      expect(getSuggestedConversionFactor("gram", "stone")).toBeNull();
    });

    it("returns null when both units are unknown", () => {
      expect(getSuggestedConversionFactor("foo", "bar")).toBeNull();
    });

    it("returns null for empty strings", () => {
      expect(getSuggestedConversionFactor("", "")).toBeNull();
    });
  });
});

describe("getWaterDensityConversionFactor", () => {
  // The factor represents "how many recipeUnits per 1 inventoryUnit" — the same
  // convention as getSuggestedConversionFactor and the popover's convFactor field.
  // e.g. cup→pound returns ~1.917 (≈ 1.917 cups fit in 1 lb of water at 1g/mL).
  // The server uses qty_in_inventory = qty_recipe × from.toBaseRatio / item.toBaseRatio
  // which is the inverse: qty / factor == qty × (cup_mL / lb_g) == qty × 0.5216.

  describe("volume → weight cross-kind pairs", () => {
    it("cup → pound: ~1.917 cups per lb (factor for popover)", () => {
      const f = getWaterDensityConversionFactor("cup", "pound");
      expect(f).not.toBeNull();
      // 453.592 g/lb ÷ 236.588 mL/cup ≈ 1.917
      expect(f!).toBeCloseTo(1.917, 1);
    });

    it("tablespoon → pound: ~30.68 tbsp per lb", () => {
      const f = getWaterDensityConversionFactor("tablespoon", "pound");
      expect(f).not.toBeNull();
      // 453.592 / 14.787 ≈ 30.68
      expect(f!).toBeCloseTo(30.68, 0);
    });

    it("teaspoon → pound: ~92.03 tsp per lb", () => {
      const f = getWaterDensityConversionFactor("teaspoon", "pound");
      expect(f).not.toBeNull();
      // 453.592 / 4.929 ≈ 92.03
      expect(f!).toBeCloseTo(92.03, 0);
    });

    it("cup → ounce (weight): ~0.12 cups per oz-weight", () => {
      // weight ounce is stored as "ounce (weight)" in the lookup
      const f = getWaterDensityConversionFactor("cup", "ounce (weight)");
      expect(f).not.toBeNull();
      // inventoryEntry.ratio / recipeEntry.ratio = 28.3495 / 236.588 ≈ 0.1198
      // meaning 0.1198 cups equal 1 oz-weight of water
      expect(f!).toBeCloseTo(0.1198, 3);
    });

    it("liter → kilogram: ~1.0 liter per kg", () => {
      const f = getWaterDensityConversionFactor("liter", "kilogram");
      expect(f).not.toBeNull();
      // 1000 g/kg ÷ 1000 mL/L = 1.0
      expect(f!).toBeCloseTo(1.0, 3);
    });
  });

  describe("weight → volume cross-kind pairs (inverse)", () => {
    it("pound → cup: ~0.5216 lb per cup (inverse factor)", () => {
      const f = getWaterDensityConversionFactor("pound", "cup");
      expect(f).not.toBeNull();
      // 236.588 mL/cup ÷ 453.592 g/lb ≈ 0.5216
      expect(f!).toBeCloseTo(0.5216, 2);
    });

    it("ounce (weight) → tablespoon: ~0.12 oz per tbsp", () => {
      const f = getWaterDensityConversionFactor("ounce (weight)", "tablespoon");
      expect(f).not.toBeNull();
      // 14.787 / 28.3495 ≈ 0.5217
      expect(f!).toBeGreaterThan(0);
    });
  });

  describe("same-kind pairs (must return null)", () => {
    it("returns null for cup → tablespoon (same volume kind)", () => {
      expect(getWaterDensityConversionFactor("cup", "tablespoon")).toBeNull();
    });

    it("returns null for pound → ounce (weight) (same weight kind)", () => {
      expect(getWaterDensityConversionFactor("pound", "ounce (weight)")).toBeNull();
    });

    it("returns null for count → count pairs", () => {
      expect(getWaterDensityConversionFactor("each", "dozen")).toBeNull();
    });
  });

  describe("count cross-kind (must return null)", () => {
    it("returns null for cup → each (volume → count)", () => {
      expect(getWaterDensityConversionFactor("cup", "each")).toBeNull();
    });

    it("returns null for pound → each (weight → count)", () => {
      expect(getWaterDensityConversionFactor("pound", "each")).toBeNull();
    });
  });

  describe("unknown units", () => {
    it("returns null for unknown recipe unit", () => {
      expect(getWaterDensityConversionFactor("smidgen", "pound")).toBeNull();
    });

    it("returns null for unknown inventory unit", () => {
      expect(getWaterDensityConversionFactor("cup", "stone")).toBeNull();
    });
  });
});
