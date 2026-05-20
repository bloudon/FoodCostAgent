import { describe, it, expect } from "vitest";
import {
  classifyToken,
  isExcludedFromAvgPrice,
  BATCH_PREP_KEYWORDS,
} from "../server/services/menuInsightsService";

describe("classifyToken", () => {
  it("classifies tokens containing batch prep keywords as batch_prep", () => {
    const batchCases = [
      "house dough",
      "marinara sauce",
      "spice mix",
      "chicken stock",
      "beef broth",
      "lemon marinade",
      "tomato base",
      "herb blend",
      "teriyaki glaze",
      "dry rub",
      "garlic spread",
      "balsamic vinaigrette",
      "roasted garlic aioli",
      "strawberry puree",
      "red wine reduction",
    ];
    for (const token of batchCases) {
      expect(classifyToken(token), `Expected "${token}" to be batch_prep`).toBe("batch_prep");
    }
  });

  it("classifies tokens without batch prep keywords as direct_item", () => {
    const directCases = [
      "romaine lettuce",
      "chicken breast",
      "cheddar cheese",
      "roma tomato",
      "olive oil",
      "lemon",
      "sea salt",
      "black pepper",
    ];
    for (const token of directCases) {
      expect(classifyToken(token), `Expected "${token}" to be direct_item`).toBe("direct_item");
    }
  });

  it("is case-insensitive for keyword matching", () => {
    expect(classifyToken("Garlic SAUCE")).toBe("batch_prep");
    expect(classifyToken("DOUGH")).toBe("batch_prep");
    expect(classifyToken("Chicken Breast")).toBe("direct_item");
  });

  it("matches keywords as substrings within the token", () => {
    expect(classifyToken("mushroom-based")).toBe("batch_prep");
    expect(classifyToken("sauced")).toBe("batch_prep");
    expect(classifyToken("mixed greens")).toBe("batch_prep");
  });

  it("exports all expected batch prep keywords", () => {
    expect(BATCH_PREP_KEYWORDS.length).toBeGreaterThanOrEqual(15);
    const required = ["dough", "sauce", "mix", "stock", "broth", "reduction"];
    for (const kw of required) {
      expect(BATCH_PREP_KEYWORDS).toContain(kw);
    }
  });
});

describe("isExcludedFromAvgPrice", () => {
  it("excludes null price", () => {
    expect(isExcludedFromAvgPrice(null, "Entrees")).toBe(true);
  });

  it("excludes undefined price", () => {
    expect(isExcludedFromAvgPrice(undefined, "Entrees")).toBe(true);
  });

  it("excludes zero price", () => {
    expect(isExcludedFromAvgPrice(0, "Entrees")).toBe(true);
  });

  it("excludes items priced below $1.00", () => {
    expect(isExcludedFromAvgPrice(0.5, "Entrees")).toBe(true);
    expect(isExcludedFromAvgPrice(0.99, "Entrees")).toBe(true);
  });

  it("does not exclude items at exactly $1.00 in a normal department", () => {
    expect(isExcludedFromAvgPrice(1.0, "Entrees")).toBe(false);
  });

  it("does not exclude items above $1.00 in a normal department", () => {
    expect(isExcludedFromAvgPrice(12.99, "Entrees")).toBe(false);
    expect(isExcludedFromAvgPrice(5.0, null)).toBe(false);
  });

  it("excludes items in departments containing 'side'", () => {
    expect(isExcludedFromAvgPrice(3.99, "Side Dishes")).toBe(true);
    expect(isExcludedFromAvgPrice(2.5, "sides")).toBe(true);
  });

  it("excludes items in departments containing 'add'", () => {
    expect(isExcludedFromAvgPrice(1.5, "Add-ons")).toBe(true);
    expect(isExcludedFromAvgPrice(2.0, "Additions")).toBe(true);
  });

  it("excludes items in departments containing 'modifier'", () => {
    expect(isExcludedFromAvgPrice(0.5, "Modifiers")).toBe(true);
    expect(isExcludedFromAvgPrice(2.5, "Item Modifiers")).toBe(true);
  });

  it("excludes items in departments containing 'extra'", () => {
    expect(isExcludedFromAvgPrice(1.5, "Extras")).toBe(true);
    expect(isExcludedFromAvgPrice(3.0, "Extra Toppings")).toBe(true);
  });

  it("is case-insensitive for department name matching", () => {
    expect(isExcludedFromAvgPrice(5.0, "SIDE DISHES")).toBe(true);
    expect(isExcludedFromAvgPrice(5.0, "ENTREES")).toBe(false);
  });

  it("does not exclude items with null department name but valid price", () => {
    expect(isExcludedFromAvgPrice(10.0, null)).toBe(false);
    expect(isExcludedFromAvgPrice(10.0, undefined)).toBe(false);
  });
});
