import { describe, expect, it } from "vitest";
import { wholeCaseExclusionReasons, type WholeCaseEvidence } from "./wholeCasePolicy";

const eligible: WholeCaseEvidence = {
  unitId: "ea-unit", unit: "EA", caseSize: 1,
  containerSize: null, casePkgCount: null, containerLabel: "package", containerUnitId: null,
  isVariableWeight: 0, isCatchWeightCategory: 0,
  mappings: [{ sourceSystem: "ORDERLY", sourcePropertyId: "24472", packSizeRaw: "1/1 Case",
    caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: null, baseUnit: "CASE" }],
  products: [],
  savedParts: [],
};

describe("confirmed whole-case scope", () => {
  it("accepts exactly one whole-case stock unit without claiming its contents", () => {
    expect(wholeCaseExclusionReasons(eligible)).toEqual([]);
    expect(wholeCaseExclusionReasons({
      ...eligible, savedParts: [{ unitId: "ea-unit", qty: 0.5, caseQty: 0.5, containerQty: 0, looseUnits: 0 }],
    })).toEqual([]);
  });
  it.each([
    [{ ...eligible, unit: "OZ" }, "unit or case quantity changed"],
    [{ ...eligible, caseSize: 24 }, "unit or case quantity changed"],
    [{ ...eligible, mappings: [{ ...eligible.mappings[0], packSizeRaw: "1/24 Case" }] }, "missing or conflicting source pack"],
    [{ ...eligible, mappings: [...eligible.mappings, { ...eligible.mappings[0], packSizeRaw: "1/24 EA" }] }, "missing or conflicting source pack"],
    [{ ...eligible, products: [{ canonicalQtyPerPurchaseUnit: 24, packGeometryStatus: "verified", packUom: "EA", caseSize: 24, innerPackSize: 1, isVariableWeight: 0 }] }, "contradictory supplier geometry"],
    [{ ...eligible, products: [{ canonicalQtyPerPurchaseUnit: 1, packGeometryStatus: "verified", packUom: "LB", caseSize: 1, innerPackSize: 1, isVariableWeight: 0 }] }, "contradictory supplier geometry"],
    [{ ...eligible, containerSize: 24, casePkgCount: 1, containerLabel: "bottle", containerUnitId: "ea-unit" }, "existing operational geometry needs review"],
    [{ ...eligible, savedParts: [{ unitId: "ea-unit", qty: 1, caseQty: 0, containerQty: 1, looseUnits: 0 }] }, "saved package parts need historical review"],
    [{ ...eligible, savedParts: [{ unitId: "ea-unit", qty: 30, caseQty: 1, containerQty: 0, looseUnits: 0 }] }, "saved package parts need historical review"],
  ] as Array<[WholeCaseEvidence, string]>)("keeps ambiguous candidates held", (row, reason) => {
    expect(wholeCaseExclusionReasons(row)).toContain(reason);
  });
});