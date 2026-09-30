import { describe, expect, it } from "vitest";
import { abbreviateCountUnit, getCountUnitDisplay } from "./count-unit-display";

describe("operational count row display", () => {
  it("uses physical sized packages rather than canonical ounce or mL counts", () => {
    expect(getCountUnitDisplay({
      qty: 48, unitAbbreviation: "oz", unitCost: 0.72625,
      caseQty: 1, containerQty: 0, looseUnits: 0,
      inventoryItem: { containerSize: 2, casePkgCount: 24, containerLabel: "2 oz package" },
    }, "case")).toMatchObject({
      summary: "1 case", total: "24 2 oz packages",
      caseDetail: "1 case = 24 2 oz packages", price: "$1.45/2 oz package",
    });
    expect(getCountUnitDisplay({
      qty: 250, unitAbbreviation: "mL", unitCost: 0.076,
      caseQty: 0, containerQty: 1, looseUnits: 0,
      inventoryItem: { containerSize: 250, casePkgCount: 1, containerLabel: "250 mL package" },
    }, "case")).toMatchObject({
      summary: "1 250 mL package", caseDetail: "1 case = 1 250 mL package",
      price: "$19.00/250 mL package",
    });
  });

  it("does not pluralize each or abbreviate a size as if it were a unit", () => {
    expect(getCountUnitDisplay({
      qty: 6, unitAbbreviation: "ea", unitCost: 3,
      caseQty: 1, containerQty: 0, looseUnits: 0,
      inventoryItem: { containerSize: 1, casePkgCount: 6, containerLabel: "each" },
    }, "case")).toMatchObject({ total: "6 each", caseDetail: "1 case = 6 each" });
    expect(abbreviateCountUnit("2 oz package")).toBe("pkg");
    expect(abbreviateCountUnit("each")).toBe("ea");
  });

  it("converts a reconciled mL breakdown into physical totals and a real bottle price", () => {
    const display = getCountUnitDisplay({
      qty: 10125, unitAbbreviation: "mL", unitCost: 0.012,
      caseQty: 1, containerQty: 1.5, looseUnits: 0,
      inventoryItem: { containerSize: 750, casePkgCount: 12, containerLabel: "bottle" },
    }, "case");
    expect(display).toMatchObject({
      status: "ready", summary: "1 case + 1.5 bottles", total: "13.5 bottles",
      caseDetail: "1 case = 12 bottles", price: "$9.00/bottle",
    });
  });

  it("converts an oz-based carton without relabeling the canonical count or cost", () => {
    expect(getCountUnitDisplay({
      qty: 64, unitAbbreviation: "oz", unitCost: 0.25,
      caseQty: 0, containerQty: 2, looseUnits: 0,
      inventoryItem: { containerSize: 32, casePkgCount: 6, containerLabel: "carton" },
    }, "case")).toMatchObject({
      summary: "2 cartons", total: "2 cartons", price: "$8.00/carton",
    });
  });

  it("displays whole-case stock as one fractional count without inventing contents", () => {
    const inventoryItem = {
      containerSize: 1, casePkgCount: 1, containerLabel: "whole case",
      unitName: "Each",
    };
    expect(getCountUnitDisplay({
      qty: 1.5, unitAbbreviation: "EA", unitCost: 12.5,
      caseQty: 1.5, containerQty: 0, looseUnits: 0,
      inventoryItem,
    }, "case")).toMatchObject({
      status: "ready",
      summary: "1.5 whole cases",
      total: "1.5 whole cases",
      unitLabel: "Whole cases",
      caseDetail: "Contents unspecified",
      price: "$12.50/whole case",
    });
    expect(getCountUnitDisplay({
      qty: 2, unitAbbreviation: "EA", caseQty: 1, containerQty: 0,
      inventoryItem,
    }, "case")).toMatchObject({
      status: "historical",
      summary: "Historical: 2.00 EA (review)",
    });
  });

  it("marks canonical-only and inconsistent saved amounts as historical, without guessing package counts", () => {
    const inventoryItem = { containerSize: 750, casePkgCount: 12, containerLabel: "bottle" };
    for (const parts of [
      { caseQty: null, containerQty: null, looseUnits: null },
      { caseQty: 0, containerQty: 1, looseUnits: 0 },
    ]) {
      expect(getCountUnitDisplay({ qty: 1500, unitAbbreviation: "mL", inventoryItem, ...parts }, "case"))
        .toMatchObject({ status: "historical", summary: "Historical: 1500.00 mL (review)", containers: null });
    }
  });

  it("requires geometry rather than falling back to mL entry or a made-up price", () => {
    expect(getCountUnitDisplay({
      qty: 0, unitAbbreviation: "mL", unitCost: 0.01,
      inventoryItem: { containerSize: null, casePkgCount: 12, containerLabel: "bottle" },
    }, "case")).toMatchObject({
      status: "configuration", summary: "Counting setup required", price: "Price unavailable",
    });
  });

  it("does not interpret a saved count under a different unit ID with current item geometry", () => {
    expect(getCountUnitDisplay({
      qty: 750, unitId: "historical-unit", unitAbbreviation: "mL", unitCost: 0.01,
      caseQty: 0, containerQty: 1, looseUnits: 0,
      inventoryItem: { unitId: "current-unit", containerSize: 750, casePkgCount: 12, containerLabel: "bottle" },
    }, "case")).toMatchObject({
      status: "historical", summary: "Historical: 750.00 mL (review)",
      containers: null, price: "Price unavailable", caseDetail: null,
    });
  });
});