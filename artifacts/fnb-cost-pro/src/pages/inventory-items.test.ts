import { describe, expect, it } from "vitest";
import { filterInventoryItems } from "./inventory-items";

const item = (overrides: Record<string, unknown>) => ({
  id: "item",
  name: "Inventory Item",
  manufacturer: null,
  categoryId: "category-a",
  category: "Category A",
  internalItemNumber: null,
  pluSku: "",
  pricePerUnit: 1,
  avgCostPerUnit: 1,
  effectiveUnitCost: 1,
  unitId: "unit",
  caseSize: 1,
  imageUrl: null,
  parLevel: null,
  reorderLevel: null,
  storageLocationId: "",
  onHandQty: 0,
  active: 1,
  isPowerItem: 0,
  vendorSkus: [],
  latestCasePrice: null,
  latestCasePriceVendor: null,
  locations: [{ id: "location-a", name: "Location A", isPrimary: true }],
  unit: null,
  ...overrides,
}) as any;

describe("filterInventoryItems", () => {
  const items = [
    item({ id: "matching" }),
    item({ id: "other-category", categoryId: "category-b" }),
    item({
      id: "other-location",
      locations: [{ id: "location-b", name: "Location B", isPrimary: true }],
    }),
  ];

  it("filters by category ID", () => {
    expect(filterInventoryItems(items, {
      search: "",
      locationId: "all",
      categoryId: "category-b",
      active: "active",
    }).map((entry) => entry.id)).toEqual(["other-category"]);
  });

  it("filters by canonical location ID", () => {
    expect(filterInventoryItems(items, {
      search: "",
      locationId: "location-b",
      categoryId: "all",
      active: "active",
    }).map((entry) => entry.id)).toEqual(["other-location"]);
  });

  it("returns the actual category and location intersection", () => {
    expect(filterInventoryItems(items, {
      search: "",
      locationId: "location-a",
      categoryId: "category-a",
      active: "active",
    }).map((entry) => entry.id)).toEqual(["matching"]);
  });
});