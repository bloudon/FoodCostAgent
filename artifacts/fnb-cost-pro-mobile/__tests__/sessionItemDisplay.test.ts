import { describe, expect, it } from "vitest";
import { formatCurrentCount, formatPackLine } from "@/lib/sessionItemDisplay";

describe("session item display", () => {
  it("uses verified package geometry and names the operational unit", () => {
    expect(
      formatPackLine({
        countMode: "package",
        unit: "oz",
        quantity: 108,
        caseQty: 1,
        containerQty: 6,
        looseUnits: 0,
        casePkgCount: 48,
        containerSize: 2,
        containerLabel: "bottle",
      }),
    ).toBe("cs + bottle · 48 × 2 oz");
  });

  it("does not invent a container label for incomplete geometry", () => {
    expect(
      formatPackLine({
        countMode: "unconfigured",
        unit: "oz",
        quantity: 12,
        caseQty: null,
        containerQty: null,
        looseUnits: null,
        casePkgCount: null,
        containerSize: null,
        containerLabel: null,
      }),
    ).toBe("oz");
  });

  it("does not invent a package unit when sizes exist but the label is missing", () => {
    const item = {
      countMode: "package" as const,
      unit: "oz",
      quantity: 108,
      caseQty: 1,
      containerQty: 6,
      looseUnits: 0,
      casePkgCount: 48,
      containerSize: 2,
      containerLabel: null,
    };
    expect(formatPackLine(item)).toBe("oz");
    expect(formatCurrentCount(item)).toBe("108");
  });

  it("shows package counts in the configured order", () => {
    expect(
      formatCurrentCount({
        countMode: "package",
        unit: "oz",
        quantity: 108,
        caseQty: 1,
        containerQty: 6,
        looseUnits: 0,
        casePkgCount: 48,
        containerSize: 2,
        containerLabel: "bottle",
      }),
    ).toBe("1 · 6");
  });

  it("shows a fractional whole-case count and leaves package contents unspecified", () => {
    const item = {
      countMode: "package" as const,
      unit: "EA",
      quantity: 1.5,
      caseQty: 1.5,
      containerQty: 0,
      looseUnits: 0,
      casePkgCount: 1,
      containerSize: 1,
      containerLabel: "whole case",
    };
    expect(formatPackLine(item)).toBe("Whole cases · Contents unspecified");
    expect(formatCurrentCount(item)).toBe("1.5 whole cases");
    expect(formatCurrentCount({ ...item, quantity: 2 })).toBe("2");
  });
});