/**
 * Unit tests for wasteInterpreter service.
 *
 * Covers resolveSpokenWasteEntries logic:
 *  - Exact name match → score 1.0, resolved
 *  - Prefix/substring match → resolved with appropriate score
 *  - Levenshtein fuzzy fallback (typo) → resolved
 *  - Ambiguous match (two similarly-scored items, narrow margin) → ambiguous
 *  - No close match → unresolved
 *  - Unit variant normalization: spoken "lbs" matches configured "lb" unit
 *  - Unit variant normalization: spoken "pounds" matches configured "lb" unit
 *  - Spoken unit with NO configured match → needs_unit + warning
 *  - No spoken unit → defaults to canonical unit
 *  - Menu item resolution (no unit logic)
 *  - wasteType=null searches both pools
 */

import { describe, it, expect } from "vitest";
import { resolveSpokenWasteEntries } from "./wasteInterpreter";
import type { ResolveInput } from "./wasteInterpreter";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const UNIT_LB  = { id: "u-lb",  name: "lb",     abbreviation: "lb"  };
const UNIT_OZ  = { id: "u-oz",  name: "oz",      abbreviation: "oz"  };
const UNIT_EA  = { id: "u-ea",  name: "each",    abbreviation: "ea"  };
const UNIT_CS  = { id: "u-cs",  name: "case",    abbreviation: "cs"  };
const UNIT_GAL = { id: "u-gal", name: "gallon",  abbreviation: "gal" };

const ALL_UNITS = [UNIT_LB, UNIT_OZ, UNIT_EA, UNIT_CS, UNIT_GAL];

const INV_CHICKEN = {
  id: "inv-chicken",
  name: "Chicken Breast",
  categoryId: "cat-protein",
  unitId: UNIT_LB.id,
  active: 1,
};
const INV_TOMATO = {
  id: "inv-tomato",
  name: "Tomato",
  categoryId: "cat-produce",
  unitId: UNIT_LB.id,
  active: 1,
};
const INV_CHICKEN_THIGH = {
  id: "inv-chicken-thigh",
  name: "Chicken Thigh",
  categoryId: "cat-protein",
  unitId: UNIT_LB.id,
  active: 1,
};
const INV_MILK = {
  id: "inv-milk",
  name: "Whole Milk",
  categoryId: "cat-dairy",
  unitId: UNIT_GAL.id,
  active: 1,
};
const INV_PLATES = {
  id: "inv-plates",
  name: "Paper Plates",
  categoryId: "cat-supplies",
  unitId: UNIT_CS.id,
  active: 1,
};

const MENU_BURGER = {
  id: "menu-burger",
  name: "Classic Burger",
  department: "Entrées",
  active: 1,
};

function makeInput(overrides: Partial<ResolveInput> = {}): ResolveInput {
  return {
    inventoryItems: [INV_CHICKEN, INV_TOMATO, INV_CHICKEN_THIGH, INV_MILK, INV_PLATES],
    menuItems: [MENU_BURGER],
    units: ALL_UNITS,
    itemUnits: [],
    entries: [],
    ...overrides,
  };
}

// ── Exact match ───────────────────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — exact match", () => {
  it("resolves an exact name match with score 1.0", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        entries: [
          {
            sourceText: "two pounds of chicken breast",
            wasteType: "inventory",
            spokenItem: "Chicken Breast",
            qty: 2,
            spokenUnit: "pounds",
            reasonCode: "SPOILED",
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("resolved");
    expect(result.matchScore).toBe(1.0);
    expect(result.itemId).toBe(INV_CHICKEN.id);
    expect(result.itemName).toBe("Chicken Breast");
    expect(result.unitId).toBe(UNIT_LB.id);
    expect(result.unitName).toBe("lb");
    expect(result.warnings).toHaveLength(0);
  });

  it("is case-insensitive on the spoken item name", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        entries: [
          {
            sourceText: "chicken breast",
            wasteType: "inventory",
            spokenItem: "chicken breast",
            qty: 1,
            spokenUnit: null,
            reasonCode: null,
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("resolved");
    expect(result.matchScore).toBe(1.0);
  });
});

// ── Prefix / substring match ──────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — prefix match", () => {
  it("resolves when spoken name is a prefix of the catalog name", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        // Only chicken breast in inventory pool so margin is high
        inventoryItems: [INV_CHICKEN],
        entries: [
          {
            sourceText: "chicken",
            wasteType: "inventory",
            spokenItem: "Chicken",
            qty: 3,
            spokenUnit: "lb",
            reasonCode: "DAMAGED",
            notes: null,
          },
        ],
      }),
    );

    // score should be 0.85 (prefix rule) and margin is 0.85 (only one candidate)
    expect(result.resolutionStatus).toBe("resolved");
    expect(result.matchScore).toBeGreaterThanOrEqual(0.75);
  });
});

// ── Levenshtein fuzzy fallback ────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — Levenshtein fallback", () => {
  it("identifies the closest item via edit-distance scoring (ambiguous)", () => {
    // "Tomatto" is 1 edit away from "Tomato".  The fuzzy-only score path is capped
    // at 0.70 (below the resolved threshold of 0.75) so the status is "ambiguous",
    // but the top candidate MUST be INV_TOMATO — that is what Levenshtein buys us.
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_TOMATO],
        entries: [
          {
            sourceText: "tomatto",
            wasteType: "inventory",
            spokenItem: "Tomatto",
            qty: 2,
            spokenUnit: "lb",
            reasonCode: "SPOILED",
            notes: null,
          },
        ],
      }),
    );

    // Top candidate must be the tomato item (Levenshtein similarity is highest)
    expect(result.itemId).toBe(INV_TOMATO.id);
    // Score must be > 0 (edit-distance matched) but below the resolved threshold
    expect(result.matchScore).toBeGreaterThan(0.4);
    expect(result.matchScore).toBeLessThan(0.75);
    // Status is ambiguous (not unresolved) — caller can still present the suggestion
    expect(result.resolutionStatus).toBe("ambiguous");
  });
});

// ── Ambiguous match ───────────────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — ambiguous", () => {
  it("returns ambiguous when two items score similarly (narrow margin)", () => {
    // "Chicken" matches both "Chicken Breast" and "Chicken Thigh" at the same
    // prefix/substring level — margin should fall below RESOLVE_MARGIN_MIN (0.15)
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_CHICKEN, INV_CHICKEN_THIGH],
        entries: [
          {
            sourceText: "chicken",
            wasteType: "inventory",
            spokenItem: "chicken",
            qty: 2,
            spokenUnit: "lb",
            reasonCode: null,
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("ambiguous");
    // Both candidates should appear in the top candidates list
    const ids = result.candidates.map(c => c.itemId);
    expect(ids).toContain(INV_CHICKEN.id);
    expect(ids).toContain(INV_CHICKEN_THIGH.id);
  });
});

// ── Unresolved ────────────────────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — unresolved", () => {
  it("returns unresolved when spoken item has no close match", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        entries: [
          {
            sourceText: "xyzzy fribble",
            wasteType: "inventory",
            spokenItem: "xyzzy fribble",
            qty: 1,
            spokenUnit: "lb",
            reasonCode: null,
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("unresolved");
    expect(result.itemId).toBeNull();
    expect(result.unitId).toBeNull();
  });
});

// ── Unit variant normalization ────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — unit variant normalization", () => {
  it("maps spoken 'lbs' to the configured 'lb' unit", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_CHICKEN],
        entries: [
          {
            sourceText: "3 lbs chicken breast",
            wasteType: "inventory",
            spokenItem: "Chicken Breast",
            qty: 3,
            spokenUnit: "lbs",
            reasonCode: "SPOILED",
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("resolved");
    expect(result.unitId).toBe(UNIT_LB.id);
    expect(result.unitName).toBe("lb");
    expect(result.warnings).toHaveLength(0);
  });

  it("maps spoken 'pounds' to the configured 'lb' unit", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_CHICKEN],
        entries: [
          {
            sourceText: "2 pounds chicken breast",
            wasteType: "inventory",
            spokenItem: "Chicken Breast",
            qty: 2,
            spokenUnit: "pounds",
            reasonCode: null,
            notes: null,
          },
        ],
      }),
    );

    expect(result.unitId).toBe(UNIT_LB.id);
    expect(result.warnings).toHaveLength(0);
  });

  it("maps spoken 'each' / 'eaches' to 'each' unit", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_PLATES],
        units: ALL_UNITS,
        itemUnits: [{ inventoryItemId: INV_PLATES.id, unitId: UNIT_EA.id }],
        entries: [
          {
            sourceText: "5 eaches of paper plates",
            wasteType: "inventory",
            spokenItem: "Paper Plates",
            qty: 5,
            spokenUnit: "eaches",
            reasonCode: "DAMAGED",
            notes: null,
          },
        ],
      }),
    );

    expect(result.unitId).toBe(UNIT_EA.id);
    expect(result.warnings).toHaveLength(0);
  });

  it("maps spoken 'gallons' to configured 'gallon' unit", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_MILK],
        entries: [
          {
            sourceText: "1 gallon whole milk",
            wasteType: "inventory",
            spokenItem: "Whole Milk",
            qty: 1,
            spokenUnit: "gallons",
            reasonCode: "SPOILED",
            notes: null,
          },
        ],
      }),
    );

    expect(result.unitId).toBe(UNIT_GAL.id);
    expect(result.warnings).toHaveLength(0);
  });
});

// ── needs_unit ────────────────────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — needs_unit", () => {
  it("returns needs_unit when spoken unit does not match any configured unit for the item", () => {
    // Chicken Breast is configured in 'lb'. Spoken 'ounce' would need a configured
    // oz unit on the item — without itemUnits containing oz, it should fail.
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_CHICKEN],
        // No item-level oz unit configured; only canonical lb is available
        itemUnits: [],
        entries: [
          {
            sourceText: "five ounces of chicken breast",
            wasteType: "inventory",
            spokenItem: "Chicken Breast",
            qty: 5,
            spokenUnit: "ounces",
            reasonCode: null,
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("needs_unit");
    expect(result.unitId).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/lb|ounce/i);
  });

  it("exposes canonicalUnitId even when needs_unit", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_CHICKEN],
        itemUnits: [],
        entries: [
          {
            sourceText: "1 case chicken breast",
            wasteType: "inventory",
            spokenItem: "Chicken Breast",
            qty: 1,
            spokenUnit: "case",
            reasonCode: null,
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("needs_unit");
    expect(result.canonicalUnitId).toBe(UNIT_LB.id);
    expect(result.canonicalUnitName).toBe("lb");
  });

  it("resolves (not needs_unit) when spoken unit IS configured as an extra item unit", () => {
    // If oz is added as a configured extra unit, it should resolve fine
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_CHICKEN],
        itemUnits: [{ inventoryItemId: INV_CHICKEN.id, unitId: UNIT_OZ.id }],
        entries: [
          {
            sourceText: "8 oz chicken breast",
            wasteType: "inventory",
            spokenItem: "Chicken Breast",
            qty: 8,
            spokenUnit: "oz",
            reasonCode: null,
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("resolved");
    expect(result.unitId).toBe(UNIT_OZ.id);
    expect(result.warnings).toHaveLength(0);
  });
});

// ── No unit spoken ────────────────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — no unit spoken", () => {
  it("defaults to canonical unit when no spokenUnit is provided", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_CHICKEN],
        entries: [
          {
            sourceText: "some chicken breast",
            wasteType: "inventory",
            spokenItem: "Chicken Breast",
            qty: null,
            spokenUnit: null,
            reasonCode: null,
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("resolved");
    expect(result.unitId).toBe(UNIT_LB.id);
    expect(result.canonicalUnitId).toBe(UNIT_LB.id);
  });
});

// ── Menu item resolution ──────────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — menu item", () => {
  it("resolves a menu item by name (no unit logic applied)", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        entries: [
          {
            sourceText: "classic burger",
            wasteType: "menu_item",
            spokenItem: "Classic Burger",
            qty: 2,
            spokenUnit: null,
            reasonCode: "OVERPRODUCTION",
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("resolved");
    expect(result.itemId).toBe(MENU_BURGER.id);
    expect(result.wasteType).toBe("menu_item");
    // No unit for menu items
    expect(result.unitId).toBeNull();
    expect(result.canonicalUnitId).toBeNull();
  });
});

// ── wasteType null searches both pools ───────────────────────────────────────

describe("resolveSpokenWasteEntries — wasteType null", () => {
  it("searches both inventory and menu item pools when wasteType is null", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        entries: [
          {
            sourceText: "classic burger overproduction",
            wasteType: null,
            spokenItem: "Classic Burger",
            qty: 1,
            spokenUnit: null,
            reasonCode: "OVERPRODUCTION",
            notes: null,
          },
        ],
      }),
    );

    expect(result.itemId).toBe(MENU_BURGER.id);
    expect(result.wasteType).toBe("menu_item");
    expect(result.resolutionStatus).not.toBe("unresolved");
  });
});

// ── Multiple entries ──────────────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — multiple entries", () => {
  it("returns one resolved entry per input entry", () => {
    const results = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [INV_CHICKEN, INV_TOMATO],
        entries: [
          {
            sourceText: "2 lb chicken breast",
            wasteType: "inventory",
            spokenItem: "Chicken Breast",
            qty: 2,
            spokenUnit: "lb",
            reasonCode: "SPOILED",
            notes: null,
          },
          {
            sourceText: "1 lb tomato",
            wasteType: "inventory",
            spokenItem: "Tomato",
            qty: 1,
            spokenUnit: "lb",
            reasonCode: "SPOILED",
            notes: null,
          },
        ],
      }),
    );

    expect(results).toHaveLength(2);
    expect(results[0].itemId).toBe(INV_CHICKEN.id);
    expect(results[1].itemId).toBe(INV_TOMATO.id);
  });
});

// ── Inactive items excluded ───────────────────────────────────────────────────

describe("resolveSpokenWasteEntries — inactive items excluded", () => {
  it("does not match inactive inventory items", () => {
    const [result] = resolveSpokenWasteEntries(
      makeInput({
        inventoryItems: [{ ...INV_CHICKEN, active: 0 }],
        entries: [
          {
            sourceText: "chicken breast",
            wasteType: "inventory",
            spokenItem: "Chicken Breast",
            qty: 1,
            spokenUnit: "lb",
            reasonCode: null,
            notes: null,
          },
        ],
      }),
    );

    expect(result.resolutionStatus).toBe("unresolved");
    expect(result.itemId).toBeNull();
  });
});
