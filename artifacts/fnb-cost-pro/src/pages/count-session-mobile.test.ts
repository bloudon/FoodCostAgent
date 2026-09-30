import { describe, expect, it } from "vitest";
import {
  buildSessionLocations,
  formatMobileCountQuantity,
  getRenderedMobileCountLines,
  isMobileBarcodeFallbackCandidate,
  mobileCountLinesQueryKey,
  mobileCategoryAnchor,
  sortMobileCountLines,
} from "./count-session-mobile";
import {
  buildPreviousCountLineMap,
  countLineIdentity,
  formatPreviousCountQuantity,
} from "@/lib/previous-count-lines";

describe("buildSessionLocations", () => {
  it("keeps canonical-only locations supplied by enriched count lines", () => {
    const result = buildSessionLocations(
      [{
        storageLocationId: "canonical-cellar",
        storageLocationName: "Orderly Cellar",
        inventoryItem: {
          storageLocationId: "canonical-cellar",
          storageLocationName: "Orderly Cellar",
        },
      }],
      [{ id: "legacy-walk-in", name: "Legacy Walk-In", sortOrder: 1 }],
    );

    expect(result).toEqual([{
      id: "canonical-cellar",
      name: "Orderly Cellar",
      sortOrder: 999,
      allowCaseCounting: 0,
    }]);
  });

  it("preserves configured legacy location behavior for legacy count lines", () => {
    const legacy = {
      id: "legacy-walk-in",
      name: "Legacy Walk-In",
      sortOrder: 1,
      allowCaseCounting: 1,
    };
    expect(buildSessionLocations(
      [{ storageLocationId: legacy.id }],
      [legacy],
    )).toEqual([legacy]);
  });
});


describe("sortMobileCountLines", () => {
  const lines = [
    { id: "z", inventoryItem: { name: "Zebra", category: "Produce" } },
    { id: "a", inventoryItem: { name: "Apple", category: "Produce" } },
    { id: "b", inventoryItem: { name: "Beef", category: "Meat" } },
  ];

  it("sorts names within stable category groups", () => {
    expect(sortMobileCountLines(lines, "asc").map((line) => line.id))
      .toEqual(["a", "z", "b"]);
    expect(sortMobileCountLines(lines, "desc").map((line) => line.id))
      .toEqual(["z", "a", "b"]);
  });

  it("creates deterministic DOM-safe category anchors", () => {
    expect(mobileCategoryAnchor("Meat & Seafood"))
      .toBe("mobile-category-Meat-20-26-20Seafood");
  });
});

describe("getRenderedMobileCountLines", () => {
  it("bounds the initial mobile render for a 5,669-line session", () => {
    const lines = Array.from({ length: 5_669 }, (_, index) => ({ id: `line-${index}` }));

    expect(getRenderedMobileCountLines(lines)).toHaveLength(120);
    expect(getRenderedMobileCountLines(lines, 240)).toHaveLength(240);
    expect(lines).toHaveLength(5_669);
  });

  it("uses one compact cache key for mobile edits and entry history", () => {
    expect(mobileCountLinesQueryKey("count-1")).toEqual([
      "/api/inventory-count-lines",
      "count-1",
      "mobile-compact",
    ]);
  });
});

describe("isMobileBarcodeFallbackCandidate", () => {
  it("keeps PLU/SKU fallback matching available for compact mobile items", () => {
    expect(isMobileBarcodeFallbackCandidate(
      { barcode: null, pluSku: "4021" },
      "000000004021",
    )).toBe(true);
    expect(isMobileBarcodeFallbackCandidate(
      { barcode: "123456", pluSku: "9999" },
      "000000004021",
    )).toBe(false);
  });
});

describe("formatMobileCountQuantity", () => {
  it("shows package counts in practical cases and containers", () => {
    expect(formatMobileCountQuantity({
      qty: 10500,
      unitAbbreviation: "mL",
      caseQty: 1,
      containerQty: 2,
      looseUnits: 0,
      inventoryItem: {
        casePkgCount: 12,
        containerSize: 750,
        containerLabel: "bottle",
        sourcePackSizeRaw: "1/3 GAL",
      },
    }, "case")).toEqual({
      summary: "1 case + 2 bottles",
      unitLabel: "Cases / bottles",
    });
  });

  it("shows practical package units before an item has been counted", () => {
    expect(formatMobileCountQuantity({
      qty: 0,
      unitAbbreviation: "mL",
      caseQty: null,
      containerQty: null,
      looseUnits: null,
      inventoryItem: {
        casePkgCount: 12,
        containerSize: 750,
        containerLabel: "bottle",
        sourcePackSizeRaw: "1/3 GAL",
      },
    }, "case")).toEqual({
      summary: "Not counted",
      unitLabel: "Cases / bottles",
    });
  });

  it("keeps canonical units for an old count without package parts", () => {
    expect(formatMobileCountQuantity({
      qty: 1500,
      unitAbbreviation: "mL",
      caseQty: null,
      containerQty: null,
      looseUnits: null,
      inventoryItem: {
        casePkgCount: 12,
        containerSize: 750,
        containerLabel: "bottle",
      },
    }, "case")).toEqual({
      summary: "Historical: 1500.00 mL (review)",
      unitLabel: "Cases / bottles",
    });
  });

  it("keeps canonical units for direct counts", () => {
    expect(formatMobileCountQuantity({
      qty: 2.5,
      unitAbbreviation: "lb",
      inventoryItem: {},
    }, "simple")).toEqual({
      summary: "2.50 lb",
      unitLabel: "lb",
    });
  });

  it("preserves canonical fallback for legacy loose package counts", () => {
    expect(formatMobileCountQuantity({
      qty: 750,
      unitAbbreviation: "mL",
      caseQty: 0,
      containerQty: 1,
      looseUnits: 750,
      inventoryItem: {
        casePkgCount: 12,
        containerSize: 750,
        containerLabel: "bottle",
      },
    }, "case")).toEqual({
      summary: "Historical: 750.00 mL (review)",
      unitLabel: "Cases / bottles",
    });
  });
});

describe("previous count line helpers", () => {
  it("keeps prior quantities separated by item and location", () => {
    const map = buildPreviousCountLineMap([
      { inventoryItemId: "apple", storageLocationId: "walk-in", qty: 2 },
      { inventoryItemId: "apple", storageLocationId: "freezer", qty: 0 },
    ]);

    expect(map.get(countLineIdentity({
      inventoryItemId: "apple",
      storageLocationId: "walk-in",
    }))?.qty).toBe(2);
    expect(map.get(countLineIdentity({
      inventoryItemId: "apple",
      storageLocationId: "freezer",
    }))?.qty).toBe(0);
  });

  it("formats previous package parts in practical units", () => {
    expect(formatPreviousCountQuantity(
      { qty: 10500, caseQty: 1, containerQty: 2, looseUnits: 0 },
      {
        unitAbbreviation: "mL",
        inventoryItem: {
          countMode: "package",
          casePkgCount: 12,
          containerSize: 750,
          containerLabel: "bottle",
        },
      },
    )).toBe("1 case + 2 bottles");
  });

  it("keeps a previous canonical-unit ID change out of today's bottle count", () => {
    expect(formatPreviousCountQuantity(
      { qty: 10500, unitId: "old-ml", caseQty: 1, containerQty: 2, looseUnits: 0 },
      {
        unitId: "new-ml", unitAbbreviation: "mL",
        inventoryItem: { countMode: "package", casePkgCount: 12, containerSize: 750, containerLabel: "bottle" },
      },
    )).toBe("Historical: 10500.00 previous canonical units (review)");
  });
});