import { describe, it, expect } from "vitest";
import { getLabelForPath } from "./route-config";

describe("getLabelForPath", () => {
  // Home — should return undefined (no label shown)
  it("returns undefined for '/'", () => {
    expect(getLabelForPath("/")).toBeUndefined();
  });

  // Static top-level routes
  it("returns label for exact static route", () => {
    expect(getLabelForPath("/recipes")).toBe("Recipes");
    expect(getLabelForPath("/inventory-items")).toBe("Inventory Items");
    expect(getLabelForPath("/settings")).toBe("Settings");
  });

  // Dynamic param at end
  it("returns label for route with trailing :id param", () => {
    expect(getLabelForPath("/inventory-items/42")).toBe("Item Detail");
    expect(getLabelForPath("/purchase-orders/99")).toBe("Order Detail");
    expect(getLabelForPath("/count/7")).toBe("Count Session");
  });

  // Dynamic param in the middle of the path
  it("returns correct label for route with mid-path :id param", () => {
    expect(getLabelForPath("/order-guides/123/review")).toBe("Order Guide Review");
  });

  // Two-segment dynamic routes
  it("returns label for /count/:id/mobile", () => {
    expect(getLabelForPath("/count/5/mobile")).toBe("Count Session");
  });

  // Receiving route: /receiving/:poId
  it("returns label for /receiving/:poId", () => {
    expect(getLabelForPath("/receiving/77")).toBe("Receive Delivery");
  });

  // Prefers longer (more specific) pattern over shorter prefix
  it("prefers /inventory-items/new over /inventory-items/:id", () => {
    expect(getLabelForPath("/inventory-items/new")).toBe("New Item");
  });

  it("prefers /inventory-items/par-levels over /inventory-items/:id", () => {
    expect(getLabelForPath("/inventory-items/par-levels")).toBe("Par Levels");
  });

  // Unmatched path
  it("returns undefined for an unrecognised path", () => {
    expect(getLabelForPath("/this/does/not/exist")).toBeUndefined();
  });
});
