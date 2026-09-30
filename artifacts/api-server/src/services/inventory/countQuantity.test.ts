import { describe, expect, it } from "vitest";
import {
  calculateCanonicalCountQuantity,
  directMeasurementCountBlock,
  getCountInputMode,
  getOperationalContainerLabel,
  InvalidCountGeometryError,
  makeCountPackSnapshot,
  inferSavedLegacyCaseQuantity,
  resolveOperationalPackSizeRaw,
  validateCountDelta,
  validateDirectCountQuantity,
} from "./countQuantity";

const wine = {
  unitId: "ml",
  caseSize: 9000,
  containerSize: 750,
  casePkgCount: 12,
  containerUnitId: "bottle",
  containerLabel: "bottle",
};

describe("direct measurement count safety", () => {
  it("blocks direct weight/volume units unless the item is explicitly catch weight", () => {
    expect(directMeasurementCountBlock("direct", "weight")).toContain("explicit catch-weight");
    expect(directMeasurementCountBlock("direct", "volume")).toContain("verified physical package");
    expect(directMeasurementCountBlock("direct", null)).toContain("canonical unit metadata is unavailable");
    expect(directMeasurementCountBlock("catch", "weight")).toBeNull();
    expect(directMeasurementCountBlock("package", "volume")).toBeNull();
  });
});

describe("calculateCanonicalCountQuantity", () => {
  it("shows July's saved one-case/30 count without treating August zero placeholders as a new pack", () => {
    const july = { qty: 30, caseQty: 1, containerQty: 0, looseUnits: 0, countPackSnapshot: null };
    const august = { qty: 0, caseQty: null, containerQty: null, looseUnits: null, countPackSnapshot: null };
    expect(inferSavedLegacyCaseQuantity(july)).toBe(30);
    expect(inferSavedLegacyCaseQuantity(august)).toBeNull();
    expect(inferSavedLegacyCaseQuantity({ ...july, containerQty: 2 })).toBeNull();
    expect(inferSavedLegacyCaseQuantity({ ...july, countPackSnapshot: { casePkgCount: 60 } })).toBeNull();
  });

  it("freezes the conversion used by a future package entry without changing its counted quantity", () => {
    const chip = {
      unitId: "ea", caseSize: 60, containerSize: 1,
      casePkgCount: 60, containerUnitId: "ea", containerLabel: "bag",
    };
    const snapshot = makeCountPackSnapshot(chip, new Date("2026-09-24T12:00:00Z"));
    expect(snapshot).toEqual({
      unitId: "ea", caseSize: 60, containerSize: 1, casePkgCount: 60,
      containerLabel: "bag", recordedAt: "2026-09-24T12:00:00.000Z",
    });
    expect(calculateCanonicalCountQuantity(chip, "ea", { caseQty: 1, containerQty: 0, looseUnits: 0 })).toBe(60);
    expect(() => makeCountPackSnapshot({ ...chip, casePkgCount: null })).toThrow(InvalidCountGeometryError);
  });

  it("classifies explicit package geometry separately from legacy signals", () => {
    expect(getCountInputMode(wine)).toBe("package");
    expect(getCountInputMode({ ...wine, containerLabel: null })).toBe("package");
    expect(getCountInputMode({ unitId: "each", caseSize: null, containerSize: null, casePkgCount: null, containerUnitId: null, containerLabel: null })).toBe("direct");
    expect(getCountInputMode({ unitId: "each", caseSize: 20, containerSize: null, casePkgCount: null, containerUnitId: null, containerLabel: null })).toBe("direct");
    expect(getCountInputMode({ unitId: "ml", caseSize: null, containerSize: null, casePkgCount: null, containerUnitId: "ml", containerLabel: null })).toBe("direct");
    expect(getCountInputMode(wine, true)).toBe("catch");
  });

  it("validates direct quantities as finite and non-negative", () => {
    expect(validateDirectCountQuantity(2.5)).toBe(2.5);
    expect(() => validateDirectCountQuantity(Number.NaN)).toThrow("finite");
    expect(() => validateDirectCountQuantity(-1)).toThrow("non-negative");
  });

  it("allows finite negative deltas for decrementing without allowing non-finite values", () => {
    expect(validateCountDelta(-1)).toBe(-1);
    expect(validateCountDelta(2.5)).toBe(2.5);
    expect(() => validateCountDelta(Number.NaN)).toThrow("finite");
    expect(() => validateCountDelta(Number.NEGATIVE_INFINITY)).toThrow("finite");
  });

  it("uses configured labels first and resolves obvious physical containers", () => {
    expect(getOperationalContainerLabel(wine, "Wine")).toBe("bottle");
    expect(getOperationalContainerLabel({ ...wine, name: "12 Year Single Malt", containerLabel: null }, "Liquor")).toBe("bottle");
    expect(getOperationalContainerLabel({ ...wine, name: "20 oz Palmer Can", containerLabel: null }, "Beverages")).toBe("can");
    expect(getOperationalContainerLabel({ ...wine, name: "Unknown", containerLabel: null }, "Other")).toBe("container");
  });

  it("uses retained source pack notation only when mappings agree", () => {
    expect(resolveOperationalPackSizeRaw(["1/3 GAL", " 1/3 gal "])).toBe("1/3 GAL");
    expect(resolveOperationalPackSizeRaw(["1/3 GAL", "1/2 GAL"])).toBeNull();
    expect(resolveOperationalPackSizeRaw(["1/3 GAL", null])).toBeNull();
    expect(resolveOperationalPackSizeRaw([null, ""])).toBeNull();
  });

  it("converts decimal bottles to canonical milliliters", () => {
    expect(calculateCanonicalCountQuantity(wine, "ml", {
      caseQty: 0,
      containerQty: 5.5,
      looseUnits: 0,
    })).toBe(4125);
  });

  it("preserves unrounded case and fractional-container math", () => {
    expect(calculateCanonicalCountQuantity(wine, "ml", {
      caseQty: 1,
      containerQty: 0.5,
      looseUnits: 0,
    })).toBe(9375);
  });

  it("counts fractions of a whole case as EA without allowing an invented inner container", () => {
    const wholeCase = {
      unitId: "ea", caseSize: 1, containerSize: 1, casePkgCount: 1,
      containerUnitId: "ea", containerLabel: "whole case",
    };
    expect(calculateCanonicalCountQuantity(wholeCase, "ea", {
      caseQty: 0.25, containerQty: 0, looseUnits: 0,
    })).toBe(0.25);
    expect(makeCountPackSnapshot(wholeCase).containerLabel).toBe("whole case");
    expect(() => calculateCanonicalCountQuantity(wholeCase, "ea", {
      caseQty: 0, containerQty: 1, looseUnits: 0,
    })).toThrow("cases only");
    expect(calculateCanonicalCountQuantity({
      ...wine, containerLabel: "whole case",
    }, "ml", {
      caseQty: 0, containerQty: 1, looseUnits: 0,
    })).toBe(750);
  });

  it("uses complete numeric package geometry when a specific physical label is unavailable", () => {
    expect(calculateCanonicalCountQuantity({
      ...wine,
      containerLabel: null,
    }, "ml", {
      caseQty: 0,
      containerQty: 2,
      looseUnits: 0,
    })).toBe(1500);
  });

  it("rejects canonical loose quantity for package counting", () => {
    expect(() => calculateCanonicalCountQuantity(wine, "ml", {
      caseQty: 0,
      containerQty: 1,
      looseUnits: 12.25,
    })).toThrow("Canonical loose quantity cannot be entered");
  });

  it("fails closed when container geometry is incomplete", () => {
    expect(() => calculateCanonicalCountQuantity({
      ...wine,
      casePkgCount: null,
    }, "ml", {
      caseQty: 0,
      containerQty: 5.5,
      looseUnits: 0,
    })).toThrow(InvalidCountGeometryError);
  });

  it("fails closed when the count line is not canonical", () => {
    expect(() => calculateCanonicalCountQuantity(wine, "bottle", {
      caseQty: 0,
      containerQty: 5.5,
      looseUnits: 0,
    })).toThrow("does not match");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "fails closed for an invalid container size of %s",
    (containerSize) => {
      expect(() => calculateCanonicalCountQuantity({
        ...wine,
        containerSize,
      }, "ml", {
        caseQty: 0,
        containerQty: 1,
        looseUnits: 0,
      })).toThrow(InvalidCountGeometryError);
    },
  );

  it("fails closed for non-finite entered quantities", () => {
    expect(() => calculateCanonicalCountQuantity(wine, "ml", {
      caseQty: 0,
      containerQty: Number.NaN,
      looseUnits: 0,
    })).toThrow("finite");
  });
});