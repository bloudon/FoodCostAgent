import { describe, expect, it } from "vitest";
import { getCountSessionTotals } from "./count-session-totals";

describe("getCountSessionTotals", () => {
  it("separates distinct inventory items from item-location lines", () => {
    expect(getCountSessionTotals([
      { inventoryItemId: "apple" },
      { inventoryItemId: "apple" },
      { inventoryItemId: "beef" },
    ])).toEqual({
      distinctItems: 2,
      itemLocationLines: 3,
    });
  });

  it("returns zero totals before count lines load", () => {
    expect(getCountSessionTotals(undefined)).toEqual({
      distinctItems: 0,
      itemLocationLines: 0,
    });
  });
});