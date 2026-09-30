import { describe, expect, it } from "vitest";
import { getVendorPricePresentation } from "./vendor-price-presentation";

describe("getVendorPricePresentation", () => {
  it("keeps purchase-unit and canonical-unit prices distinct", () => {
    expect(getVendorPricePresentation({
      lastPrice: 203.16 / 9000,
      lastCasePrice: 203.16,
      caseSize: 12,
      normalizedPricePerCanonicalUnit: 203.16 / 9000,
      packGeometryStatus: "verified",
      unit: { name: "milliliter" },
    }, "milliliter", "Bottle")).toEqual({
      purchasePrice: "$16.93/bottle",
      canonicalPrice: "$0.022573/milliliter",
      canonicalStatus: "available",
    });
  });

  it("never labels a purchase-unit price as canonical when geometry is missing", () => {
    expect(getVendorPricePresentation({
      lastPrice: 16.93,
      normalizedPricePerCanonicalUnit: null,
      packGeometryStatus: "incomplete",
      unit: { name: "Bottle" },
    }, "milliliter")).toEqual({
      purchasePrice: "$16.93/bottle",
      canonicalPrice: null,
      canonicalStatus: "required",
    });
  });

  it("does not invent a physical purchase unit when the item has no container label", () => {
    expect(getVendorPricePresentation({
      lastPrice: 0.022573,
      lastCasePrice: 203.16,
      caseSize: 12,
      normalizedPricePerCanonicalUnit: 0.022573,
      packGeometryStatus: "verified",
      unit: { name: "milliliter" },
    }, "milliliter")).toEqual({
      purchasePrice: "$0.02/milliliter",
      canonicalPrice: "$0.022573/milliliter",
      canonicalStatus: "available",
    });
  });
});