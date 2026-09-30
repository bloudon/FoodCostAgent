import { describe, expect, it } from "vitest";
import {
  buildCurrentVendorEvent,
  buildPriceObservationEvent,
  formatSupplierPackLabel,
  normalizeCurrentVendorPrice,
  normalizeHistoricalInvoicePrice,
  resolveHistoricalInvoiceSku,
  resolveSupplierSku,
  trustedInvoiceVendorItemId,
} from "./supplierPackChronology";

describe("supplier pack chronology evidence formatting", () => {
  it("formats only a complete explicitly stored current pack", () => {
    expect(formatSupplierPackLabel({
      caseSize: 4,
      innerPackSize: 5,
      packUom: "lb",
    })).toBe("4 × 5 lb");
    expect(formatSupplierPackLabel({
      caseSize: 4,
      innerPackSize: null,
      packUom: "lb",
    })).toBeNull();
  });

  it("normalizes a current vendor case price only with verified geometry", () => {
    expect(normalizeCurrentVendorPrice({
      casePrice: 62,
      canonicalQuantity: 20,
      geometryStatus: "verified",
      pricingBasis: "purchase_unit",
    })).toEqual({
      canonicalQuantity: 20,
      casePrice: 62,
      pricePerCanonicalUnit: 3.1,
    });
  });

  it.each([
    { geometryStatus: "parsed", pricingBasis: "purchase_unit" },
    { geometryStatus: "verified", pricingBasis: "unknown" },
    { geometryStatus: "verified", pricingBasis: "purchase_unit", canonicalQuantity: 0 },
  ])("does not normalize unverified, non-purchase, or invalid current prices: %o", (fixture) => {
    expect(normalizeCurrentVendorPrice({
      casePrice: 62,
      canonicalQuantity: fixture.canonicalQuantity ?? 20,
      geometryStatus: fixture.geometryStatus,
      pricingBasis: fixture.pricingBasis,
    })).toEqual({
      canonicalQuantity: null,
      casePrice: 62,
      pricePerCanonicalUnit: null,
    });
  });

  it("normalizes verified canonical-unit basis using the stored case price and quantity", () => {
    expect(normalizeCurrentVendorPrice({
      casePrice: 46.85,
      canonicalQuantity: 30,
      geometryStatus: "verified",
      pricingBasis: "canonical_unit",
      storedNormalizedPrice: 1.561666,
    })).toEqual({
      canonicalQuantity: 30,
      casePrice: 46.85,
      pricePerCanonicalUnit: 46.85 / 30,
    });
    expect(normalizeCurrentVendorPrice({
      casePrice: 40.96,
      canonicalQuantity: 60,
      geometryStatus: "verified",
      pricingBasis: "canonical_unit",
      storedNormalizedPrice: 0.682666,
    }).pricePerCanonicalUnit).toBeCloseTo(40.96 / 60, 6);
  });

  it("rejects current normalization when the stored normalized price contradicts case price and quantity", () => {
    expect(normalizeCurrentVendorPrice({
      casePrice: 46.85,
      canonicalQuantity: 30,
      geometryStatus: "verified",
      pricingBasis: "canonical_unit",
      storedNormalizedPrice: 1.75,
    })).toEqual({
      canonicalQuantity: 30,
      casePrice: 46.85,
      pricePerCanonicalUnit: null,
    });
  });

  it("normalizes an invoice price only with explicit purchase basis and geometry", () => {
    expect(normalizeHistoricalInvoicePrice({
      unitPrice: 48,
      pricingBasis: "purchase_unit",
      canonicalQuantity: 12,
    })).toEqual({
      canonicalQuantity: 12,
      casePrice: 48,
      pricePerCanonicalUnit: 4,
    });
  });

  it("does not infer invoice price or pack geometry from a raw pack string", () => {
    expect(normalizeHistoricalInvoicePrice({
      unitPrice: 48,
      pricingBasis: null,
      canonicalQuantity: null,
    })).toEqual({
      canonicalQuantity: null,
      casePrice: null,
      pricePerCanonicalUnit: null,
    });
  });

  it("keeps historical price observations price-only, preserving their recorded unit price", () => {
    const event = buildPriceObservationEvent({
      id: "history-1",
      effectiveAt: new Date("2024-03-12T09:00:00.000Z"),
      source: "receipt",
      vendorItemId: "vendor-item-1",
      vendorName: "Example Vendor",
      sku: "SKU-1",
      pricePerUnit: 1.25,
      casePrice: 25,
    });
    expect(event).toMatchObject({
      date: "2024-03-12T09:00:00.000Z",
      priceDate: "2024-03-12T09:00:00.000Z",
      source: "receipt",
      evidenceType: "price_observation",
      vendorItemId: "vendor-item-1",
      casePrice: 25,
      observedUnitPrice: 1.25,
      packLabel: null,
      rawPack: null,
      canonicalQuantity: null,
      pricePerCanonicalUnit: null,
      packEvidenceDate: null,
    });
  });

  it("labels current vendor data as current and keeps price and pack evidence dates distinct", () => {
    const event = buildCurrentVendorEvent({
      vendorItemId: "vendor-item-1",
      vendorName: "Example Vendor",
      sku: null,
      caseSize: 4,
      innerPackSize: 5,
      packUom: "lb",
      canonicalQuantity: 20,
      geometryStatus: "verified",
      pricingBasis: "purchase_unit",
      casePrice: 62,
      storedNormalizedPrice: 3.1,
      pricedAt: new Date("2025-02-10T12:00:00.000Z"),
      packGeometryUpdatedAt: new Date("2025-01-03T12:00:00.000Z"),
      priceSource: "manual",
      evidenceRef: "price-ref",
    }, ["EXTERNAL-SKU"]);
    expect(event).toMatchObject({
      date: "2025-02-10T12:00:00.000Z",
      priceDate: "2025-02-10T12:00:00.000Z",
      packEvidenceDate: "2025-01-03T12:00:00.000Z",
      source: "CURRENT RECORD",
      priceSource: "manual",
      sku: "EXTERNAL-SKU",
      packLabel: "4 × 5 lb",
      pricePerCanonicalUnit: 3.1,
    });
  });

  it("uses an external mapping only as an unambiguous company-scoped SKU fallback", () => {
    expect(resolveSupplierSku(null, ["EXT-1"])).toBe("EXT-1");
    expect(resolveSupplierSku("DIRECT-SKU", ["EXT-1"])).toBe("DIRECT-SKU");
    expect(resolveSupplierSku(null, ["EXT-1", "EXT-2"])).toBeNull();
  });

  it("does not attach an unrelated invoice vendor item but retains its raw line SKU", () => {
    const itemVendorItemIds = new Set(["item-vendor-product"]);
    expect(trustedInvoiceVendorItemId("other-vendor-product", itemVendorItemIds)).toBeNull();
    expect(resolveHistoricalInvoiceSku({
      rawSku: "RAW-LINE-SKU",
      invoiceVendorItemId: "other-vendor-product",
      itemVendorItemIds,
      currentVendorSku: "UNRELATED-CURRENT-SKU",
      mappingSourceExternalIds: ["UNRELATED-MAPPED-SKU"],
    })).toBe("RAW-LINE-SKU");
  });

  it("does not map a current SKU fallback onto an untrusted invoice vendor item", () => {
    expect(resolveHistoricalInvoiceSku({
      rawSku: null,
      invoiceVendorItemId: "foreign-or-unlinked-id",
      itemVendorItemIds: new Set(["item-vendor-product"]),
      currentVendorSku: null,
      mappingSourceExternalIds: ["UNRELATED-MAPPED-SKU"],
    })).toBeNull();
  });
});