import { describe, expect, it } from "vitest";
import {
  buildSessionLocations,
  mobileCategoryAnchor,
  sortMobileCountLines,
} from "./count-session-mobile";

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