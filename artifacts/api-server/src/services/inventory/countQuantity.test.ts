import { describe, expect, it } from "vitest";
import {
  calculateCanonicalCountQuantity,
  InvalidCountGeometryError,
} from "./countQuantity";

const wine = {
  unitId: "ml",
  caseSize: 9000,
  containerSize: 750,
  casePkgCount: 12,
  containerUnitId: "bottle",
  containerLabel: null,
};

describe("calculateCanonicalCountQuantity", () => {
  it("converts decimal bottles to canonical milliliters", () => {
    expect(calculateCanonicalCountQuantity(wine, "ml", {
      caseQty: 0,
      containerQty: 5.5,
      looseUnits: 0,
    })).toBe(4125);
  });

  it("preserves unrounded case, container, and loose-unit math", () => {
    expect(calculateCanonicalCountQuantity(wine, "ml", {
      caseQty: 1,
      containerQty: 0.5,
      looseUnits: 12.25,
    })).toBe(9387.25);
  });

  it("supports legacy two-level case geometry", () => {
    expect(calculateCanonicalCountQuantity({
      ...wine,
      caseSize: 24,
      containerSize: null,
      casePkgCount: null,
      containerUnitId: null,
      containerLabel: null,
    }, "ml", {
      caseQty: 2,
      containerQty: 0,
      looseUnits: 3,
    })).toBe(51);
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