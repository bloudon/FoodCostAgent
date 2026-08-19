import {
  effectivePackQty,
  getPriceFreshness,
  isIncompatibleUnit,
  isPriceStale,
} from "./vendorPriceService";

export type VendorPriceComparisonUnit = {
  id: string;
  name: string;
};

export type VendorPriceComparisonItem = {
  unitId: string;
};

export type VendorPriceComparisonSourceRow = {
  vendorCompanyId: string;
  vendorName: string | null;
  vi: {
    id: string;
    vendorId: string;
    vendorSku: string | null;
    purchaseUnitId: string;
    lastPrice: number | null;
    lastCasePrice: number | null;
    caseSize: number | null;
    innerPackSize: number | null;
    packUom: string | null;
    updatedAt: Date | null;
    priceSource: string | null;
    pricedAt: Date | null;
  };
};

export function buildSingleItemVendorPrices(params: {
  companyId: string;
  item: VendorPriceComparisonItem;
  sourceRows: VendorPriceComparisonSourceRow[];
  units: VendorPriceComparisonUnit[];
}) {
  const { companyId, item, sourceRows, units } = params;
  const inventoryUnit = units.find((unit) => unit.id === item.unitId);

  return sourceRows
    .filter((row) => row.vendorCompanyId === companyId)
    .filter((row) => row.vi.lastPrice != null && row.vi.lastPrice > 0)
    .map((row) => {
      const { vi } = row;
      const purchaseUnit = units.find((unit) => unit.id === vi.purchaseUnitId);
      const unitPrice = vi.lastPrice!;
      const caseSize = vi.caseSize ?? 0;
      const casePrice =
        vi.lastCasePrice != null && vi.lastCasePrice > 0
          ? vi.lastCasePrice
          : unitPrice * Math.max(caseSize, 1);
      const pricedAtDate =
        vi.pricedAt instanceof Date
          ? vi.pricedAt
          : vi.pricedAt
            ? new Date(vi.pricedAt)
            : null;
      const { invalidPackGeometry } = effectivePackQty(
        caseSize,
        vi.innerPackSize ?? 1,
        vi.packUom ?? "",
        inventoryUnit?.name ?? "",
      );

      return {
        vendorItemId: vi.id,
        vendorId: vi.vendorId,
        vendorName: row.vendorName || "Unknown",
        vendorSku: vi.vendorSku,
        casePrice,
        unitPrice,
        caseSize,
        unitName: purchaseUnit?.name ?? "",
        lastUpdated: vi.updatedAt,
        priceSource: vi.priceSource,
        pricedAt: pricedAtDate ? pricedAtDate.toISOString() : null,
        daysSincePriced: pricedAtDate
          ? Math.floor((Date.now() - pricedAtDate.getTime()) / 86_400_000)
          : null,
        stale: isPriceStale(pricedAtDate),
        freshnessStatus: getPriceFreshness(pricedAtDate),
        confirmed: vi.priceSource === "receipt" || vi.priceSource === "invoice_scan",
        incompatibleUnit: isIncompatibleUnit(
          vi.packUom ?? "",
          inventoryUnit?.name ?? "",
        ),
        invalidPackGeometry,
      };
    })
    .sort((a, b) => a.unitPrice - b.unitPrice);
}