/**
 * Tests for assessRecipeCostResult — the pure recipe-cost assessment function.
 *
 * Covers every UnresolvedReason code plus a valid zero-cost case, ensuring
 * that $0 from an incomplete recipe is distinguishable from a genuinely
 * free recipe.
 */

import { describe, it, expect } from "vitest";
import { assessRecipeCostResult } from "./recipeCostCalculator";
import type { RecipeCostResult } from "./costing";
import type { Unit, InventoryItemUnit } from "@workspace/db";

// ---------------------------------------------------------------------------
// Shared fixtures — mirror the real seed units enough for the tests
// ---------------------------------------------------------------------------

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

const OZ: Unit = {
  id: "unit-oz",
  name: "ounce (weight)",
  abbreviation: "oz",
  kind: "weight",
  toBaseRatio: 28.3495,
  system: "imperial",
  sortOrder: 2,
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

const ALL_UNITS = [LB, OZ, EACH];

// A company that uses the default 'last_cost' method
const LAST_COST_COMPANY = { costingMethod: "last_cost" };

// A simple item priced at $5/lb
const ITEM_BEEF = {
  id: "item-beef",
  unitId: LB.id,
  pricePerUnit: 5.0,
  avgCostPerUnit: 0,
  yieldPercent: 100,
};

// An item with no price on file
const ITEM_NO_PRICE = {
  id: "item-no-price",
  unitId: LB.id,
  pricePerUnit: 0,
  avgCostPerUnit: 0,
  yieldPercent: 100,
};

// A simple recipe with valid yield
const BASE_RECIPE = {
  id: "recipe-base",
  yieldQty: 1,
  yieldUnitId: EACH.id,
  isPlaceholder: 0,
};

function makeItemsMap(...items: typeof ITEM_BEEF[]) {
  return new Map(items.map((i) => [i.id, i]));
}

function emptySubCosts(): Map<string, RecipeCostResult> {
  return new Map();
}

function noPerItemUnits(): Map<string, InventoryItemUnit[]> {
  return new Map();
}

// ---------------------------------------------------------------------------
// 1. VALID ZERO-COST RECIPE (distinguishable from unresolved)
// ---------------------------------------------------------------------------

describe("Valid zero-cost recipe", () => {
  it("returns isResolved=true, cost=0 for an empty recipe with valid yield", () => {
    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [],
      ALL_UNITS,
      makeItemsMap(),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(true);
    expect(result.cost).toBe(0);
    expect(result.unresolvedReasons).toEqual([]);
  });

  it("correctly costs a simple matched ingredient (1 LB beef at $5/lb = $5)", () => {
    const comp = {
      componentType: "inventory_item",
      componentId: ITEM_BEEF.id,
      qty: 1,
      unitId: LB.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [comp],
      ALL_UNITS,
      makeItemsMap(ITEM_BEEF),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(true);
    expect(result.cost).toBeCloseTo(5.0);
    expect(result.unresolvedReasons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. PLACEHOLDER — recipe.isPlaceholder=1
// ---------------------------------------------------------------------------

describe("UnresolvedReason: PLACEHOLDER (isPlaceholder=1)", () => {
  it("flags recipe marked isPlaceholder=1", () => {
    const placeholderRecipe = { ...BASE_RECIPE, isPlaceholder: 1 };

    const result = assessRecipeCostResult(
      placeholderRecipe,
      [],
      ALL_UNITS,
      makeItemsMap(),
      new Map([[placeholderRecipe.id, placeholderRecipe]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("PLACEHOLDER");
  });
});

// ---------------------------------------------------------------------------
// 3. PLACEHOLDER — component with missingItemName
// ---------------------------------------------------------------------------

describe("UnresolvedReason: PLACEHOLDER (missingItemName on component)", () => {
  it("flags a component whose missingItemName is set (seeded stub)", () => {
    const placeholderComp = {
      componentType: "inventory_item",
      componentId: "random-uuid-that-does-not-exist",
      qty: 1,
      unitId: EACH.id,
      yieldOverride: null,
      missingItemName: "Unknown ingredient from scan",
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [placeholderComp],
      ALL_UNITS,
      makeItemsMap(),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("PLACEHOLDER");
    // The placeholder component contributes $0 — the recipe cost stays at 0
    expect(result.cost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. MISSING_ITEM — componentId not in itemsMap
// ---------------------------------------------------------------------------

describe("UnresolvedReason: MISSING_ITEM", () => {
  it("flags a component whose inventory item does not exist", () => {
    const missingComp = {
      componentType: "inventory_item",
      componentId: "non-existent-item-id",
      qty: 2,
      unitId: LB.id,
      yieldOverride: null,
      missingItemName: null, // no missingItemName → genuine MISSING_ITEM
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [missingComp],
      ALL_UNITS,
      makeItemsMap(), // empty — item not found
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("MISSING_ITEM");
    expect(result.cost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. MISSING_PRICE — item exists but effective cost is $0
// ---------------------------------------------------------------------------

describe("UnresolvedReason: MISSING_PRICE", () => {
  it("flags a component whose item has no price on file", () => {
    const comp = {
      componentType: "inventory_item",
      componentId: ITEM_NO_PRICE.id,
      qty: 1,
      unitId: LB.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [comp],
      ALL_UNITS,
      makeItemsMap(ITEM_NO_PRICE),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("MISSING_PRICE");
    // Cost is $0 because the price is missing — distinguishable via isResolved
    expect(result.cost).toBe(0);
  });

  it("distinguishes MISSING_PRICE from a valid zero-cost item (sanity check)", () => {
    // An empty recipe with valid yield is resolved at $0
    const validZero = assessRecipeCostResult(
      BASE_RECIPE,
      [],
      ALL_UNITS,
      makeItemsMap(),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );
    expect(validZero.isResolved).toBe(true);

    // A recipe whose single item has no price is unresolved at $0
    const comp = {
      componentType: "inventory_item",
      componentId: ITEM_NO_PRICE.id,
      qty: 1,
      unitId: LB.id,
      yieldOverride: null,
      missingItemName: null,
    };
    const unresolved = assessRecipeCostResult(
      BASE_RECIPE,
      [comp],
      ALL_UNITS,
      makeItemsMap(ITEM_NO_PRICE),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );
    expect(unresolved.isResolved).toBe(false);
    expect(unresolved.cost).toBe(0);

    // Both cost $0, but only the first is resolved
    expect(validZero.cost).toBe(unresolved.cost);
    expect(validZero.isResolved).not.toBe(unresolved.isResolved);
  });
});

// ---------------------------------------------------------------------------
// 6. MISSING_CONVERSION — incompatible units (count ↔ weight)
// ---------------------------------------------------------------------------

describe("UnresolvedReason: MISSING_CONVERSION", () => {
  it("flags a component where the recipe unit is incompatible with the item unit", () => {
    // Recipe calls for EACH (count) of a per-LB item — no conversion possible
    const comp = {
      componentType: "inventory_item",
      componentId: ITEM_BEEF.id,
      qty: 1,
      unitId: EACH.id, // count vs. weight → no conversion
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [comp],
      ALL_UNITS,
      makeItemsMap(ITEM_BEEF),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("MISSING_CONVERSION");
    expect(result.cost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. MISSING_CHILD_RECIPE — sub-recipe component not in recipesMap
// ---------------------------------------------------------------------------

describe("UnresolvedReason: MISSING_CHILD_RECIPE", () => {
  it("flags a recipe-type component whose child recipe does not exist", () => {
    const childComp = {
      componentType: "recipe",
      componentId: "non-existent-recipe-id",
      qty: 1,
      unitId: EACH.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [childComp],
      ALL_UNITS,
      makeItemsMap(),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]), // child recipe not in map
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("MISSING_CHILD_RECIPE");
    expect(result.cost).toBe(0);
  });

  it("also flags MISSING_CHILD_RECIPE when the recipe exists but has no pre-computed cost entry", () => {
    const childRecipe = {
      id: "recipe-child",
      yieldQty: 1,
      yieldUnitId: EACH.id,
      isPlaceholder: 0,
    };
    const childComp = {
      componentType: "recipe",
      componentId: childRecipe.id,
      qty: 1,
      unitId: EACH.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [childComp],
      ALL_UNITS,
      makeItemsMap(),
      new Map([
        [BASE_RECIPE.id, BASE_RECIPE],
        [childRecipe.id, childRecipe],
      ]),
      emptySubCosts(), // no pre-computed cost for the child
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("MISSING_CHILD_RECIPE");
  });
});

// ---------------------------------------------------------------------------
// 8. INVALID_YIELD — recipe.yieldQty ≤ 0
// ---------------------------------------------------------------------------

describe("UnresolvedReason: INVALID_YIELD", () => {
  it("flags a recipe with yieldQty = 0", () => {
    const badYieldRecipe = { ...BASE_RECIPE, yieldQty: 0 };

    const result = assessRecipeCostResult(
      badYieldRecipe,
      [],
      ALL_UNITS,
      makeItemsMap(),
      new Map([[badYieldRecipe.id, badYieldRecipe]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("INVALID_YIELD");
  });

  it("flags a recipe with negative yieldQty", () => {
    const badYieldRecipe = { ...BASE_RECIPE, yieldQty: -1 };

    const result = assessRecipeCostResult(
      badYieldRecipe,
      [],
      ALL_UNITS,
      makeItemsMap(),
      new Map([[badYieldRecipe.id, badYieldRecipe]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("INVALID_YIELD");
  });
});

// ---------------------------------------------------------------------------
// 9. Valid sub-recipe is costed correctly (regression: was wrongly MISSING_CHILD_RECIPE)
// ---------------------------------------------------------------------------

describe("Valid sub-recipe costing", () => {
  it("parent resolves correctly when sub-recipe is present in both recipesMap and subCostsMap", () => {
    // Sauce recipe: 0.5 lb beef at $5/lb = $2.50, yield = 1 each
    const sauceRecipe: import("./recipeCostCalculator").RecipeShape = {
      id: "recipe-sauce",
      yieldQty: 1,
      yieldUnitId: EACH.id,
      isPlaceholder: 0,
    };

    // Pre-computed sauce cost (as calculateRecipeCostDetailed would produce)
    const sauceCostResult: RecipeCostResult = {
      cost: 2.5,
      isResolved: true,
      unresolvedReasons: [],
    };

    // Parent recipe uses 1 each of sauce (which costs $2.50 for yield of 1 each)
    const parentRecipe: import("./recipeCostCalculator").RecipeShape = {
      id: "recipe-parent",
      yieldQty: 1,
      yieldUnitId: EACH.id,
      isPlaceholder: 0,
    };

    const childComp: import("./recipeCostCalculator").ComponentShape = {
      componentType: "recipe",
      componentId: sauceRecipe.id,
      qty: 1,
      unitId: EACH.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      parentRecipe,
      [childComp],
      ALL_UNITS,
      makeItemsMap(),
      // Both the parent and the child are in recipesMap — mirrors the fixed async path
      new Map([
        [parentRecipe.id, parentRecipe],
        [sauceRecipe.id, sauceRecipe],
      ]),
      new Map([[sauceRecipe.id, sauceCostResult]]),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(true);
    expect(result.cost).toBeCloseTo(2.5); // 1 each × ($2.50 / 1 each)
    expect(result.unresolvedReasons).toEqual([]);
  });

  it("returns MISSING_CHILD_RECIPE when sub-recipe is absent from recipesMap (even if cost is pre-computed)", () => {
    // Edge: subCostsMap has a result but recipesMap is missing the child
    // (needed to read yieldQty for cost-per-unit calculation)
    const sauceRecipe: import("./recipeCostCalculator").RecipeShape = {
      id: "recipe-sauce",
      yieldQty: 1,
      yieldUnitId: EACH.id,
      isPlaceholder: 0,
    };
    const sauceCostResult: RecipeCostResult = {
      cost: 2.5,
      isResolved: true,
      unresolvedReasons: [],
    };
    const parentRecipe: import("./recipeCostCalculator").RecipeShape = {
      id: "recipe-parent",
      yieldQty: 1,
      yieldUnitId: EACH.id,
      isPlaceholder: 0,
    };
    const childComp: import("./recipeCostCalculator").ComponentShape = {
      componentType: "recipe",
      componentId: sauceRecipe.id,
      qty: 1,
      unitId: EACH.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      parentRecipe,
      [childComp],
      ALL_UNITS,
      makeItemsMap(),
      new Map([[parentRecipe.id, parentRecipe]]), // child NOT in map
      new Map([[sauceRecipe.id, sauceCostResult]]),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("MISSING_CHILD_RECIPE");
  });

  it("accumulates parent ingredient cost with sub-recipe cost correctly", () => {
    // Parent has: 1 lb beef ($5) + 1 each sauce ($2.50) = $7.50
    const sauceRecipe: import("./recipeCostCalculator").RecipeShape = {
      id: "recipe-sauce",
      yieldQty: 1,
      yieldUnitId: EACH.id,
      isPlaceholder: 0,
    };
    const sauceCostResult: RecipeCostResult = {
      cost: 2.5,
      isResolved: true,
      unresolvedReasons: [],
    };
    const parentRecipe: import("./recipeCostCalculator").RecipeShape = {
      id: "recipe-parent",
      yieldQty: 1,
      yieldUnitId: EACH.id,
      isPlaceholder: 0,
    };
    const beefComp: import("./recipeCostCalculator").ComponentShape = {
      componentType: "inventory_item",
      componentId: ITEM_BEEF.id,
      qty: 1,
      unitId: LB.id,
      yieldOverride: null,
      missingItemName: null,
    };
    const sauceComp: import("./recipeCostCalculator").ComponentShape = {
      componentType: "recipe",
      componentId: sauceRecipe.id,
      qty: 1,
      unitId: EACH.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      parentRecipe,
      [beefComp, sauceComp],
      ALL_UNITS,
      makeItemsMap(ITEM_BEEF),
      new Map([
        [parentRecipe.id, parentRecipe],
        [sauceRecipe.id, sauceRecipe],
      ]),
      new Map([[sauceRecipe.id, sauceCostResult]]),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(true);
    expect(result.cost).toBeCloseTo(7.5); // $5 beef + $2.50 sauce
    expect(result.unresolvedReasons).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Child-recipe unresolved reasons propagate to the parent
// ---------------------------------------------------------------------------

describe("Unresolved reason propagation from sub-recipes", () => {
  it("propagates MISSING_PRICE from a child recipe into the parent result", () => {
    const childRecipe = {
      id: "recipe-child",
      yieldQty: 1,
      yieldUnitId: EACH.id,
      isPlaceholder: 0,
    };

    // Simulate a pre-computed child result that is unresolved
    const childCostResult: RecipeCostResult = {
      cost: 0,
      isResolved: false,
      unresolvedReasons: ["MISSING_PRICE"],
    };

    const childComp = {
      componentType: "recipe",
      componentId: childRecipe.id,
      qty: 1,
      unitId: EACH.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [childComp],
      ALL_UNITS,
      makeItemsMap(),
      new Map([
        [BASE_RECIPE.id, BASE_RECIPE],
        [childRecipe.id, childRecipe],
      ]),
      new Map([[childRecipe.id, childCostResult]]),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("MISSING_PRICE");
  });
});

// ---------------------------------------------------------------------------
// 10. Multiple reasons in one recipe
// ---------------------------------------------------------------------------

describe("Multiple unresolved reasons in one recipe", () => {
  it("accumulates all distinct reason codes when multiple components fail", () => {
    const missingItemComp = {
      componentType: "inventory_item",
      componentId: "ghost-item",
      qty: 1,
      unitId: LB.id,
      yieldOverride: null,
      missingItemName: null,
    };
    const badUnitComp = {
      componentType: "inventory_item",
      componentId: ITEM_BEEF.id,
      qty: 1,
      unitId: EACH.id, // incompatible
      yieldOverride: null,
      missingItemName: null,
    };
    const noPriceComp = {
      componentType: "inventory_item",
      componentId: ITEM_NO_PRICE.id,
      qty: 1,
      unitId: LB.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [missingItemComp, badUnitComp, noPriceComp],
      ALL_UNITS,
      makeItemsMap(ITEM_BEEF, ITEM_NO_PRICE),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      LAST_COST_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("MISSING_ITEM");
    expect(result.unresolvedReasons).toContain("MISSING_CONVERSION");
    expect(result.unresolvedReasons).toContain("MISSING_PRICE");
    // Each reason appears exactly once (Set de-duplication)
    expect(result.unresolvedReasons.length).toBe(
      new Set(result.unresolvedReasons).size
    );
  });
});

// ---------------------------------------------------------------------------
// 11. Weighted-average costing method — MISSING_PRICE still detected
// ---------------------------------------------------------------------------

describe("Costing method: weighted_average", () => {
  const WAC_COMPANY = { costingMethod: "weighted_average" };

  it("uses avgCostPerUnit when available and reports resolved", () => {
    const itemWithWAC = {
      id: "item-wac",
      unitId: LB.id,
      pricePerUnit: 0,
      avgCostPerUnit: 4.5,
      yieldPercent: 100,
    };
    const comp = {
      componentType: "inventory_item",
      componentId: itemWithWAC.id,
      qty: 2,
      unitId: LB.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [comp],
      ALL_UNITS,
      makeItemsMap(itemWithWAC),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      WAC_COMPANY
    );

    expect(result.isResolved).toBe(true);
    expect(result.cost).toBeCloseTo(9.0); // 2 lb × $4.50/lb
  });

  it("flags MISSING_PRICE when both pricePerUnit and avgCostPerUnit are 0", () => {
    const comp = {
      componentType: "inventory_item",
      componentId: ITEM_NO_PRICE.id,
      qty: 1,
      unitId: LB.id,
      yieldOverride: null,
      missingItemName: null,
    };

    const result = assessRecipeCostResult(
      BASE_RECIPE,
      [comp],
      ALL_UNITS,
      makeItemsMap(ITEM_NO_PRICE),
      new Map([[BASE_RECIPE.id, BASE_RECIPE]]),
      emptySubCosts(),
      noPerItemUnits(),
      WAC_COMPANY
    );

    expect(result.isResolved).toBe(false);
    expect(result.unresolvedReasons).toContain("MISSING_PRICE");
  });
});
