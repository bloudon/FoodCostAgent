type VendorPriceRow = {
  lastPrice: number;
  lastCasePrice?: number;
  caseSize?: number;
  normalizedPricePerCanonicalUnit: number | null;
  packGeometryStatus: string | null;
  unit?: { name: string } | null;
};

export type VendorPricePresentation = {
  purchasePrice: string;
  canonicalPrice: string | null;
  canonicalStatus: "available" | "required" | "conflicting" | "variable_weight";
};

function displayUnit(name: string | null | undefined): string {
  return name?.trim().toLowerCase() || "purchase unit";
}

export function getVendorPricePresentation(
  vendorItem: VendorPriceRow,
  canonicalUnitName: string | null | undefined,
  physicalPurchaseUnitName?: string | null,
): VendorPricePresentation {
  const hasPhysicalPurchasePrice =
    Boolean(physicalPurchaseUnitName?.trim()) &&
    vendorItem.lastCasePrice != null &&
    Number.isFinite(vendorItem.lastCasePrice) &&
    vendorItem.lastCasePrice >= 0 &&
    vendorItem.caseSize != null &&
    Number.isFinite(vendorItem.caseSize) &&
    vendorItem.caseSize > 0;
  const purchaseUnit = displayUnit(
    hasPhysicalPurchasePrice ? physicalPurchaseUnitName : vendorItem.unit?.name,
  );
  const purchasePrice = hasPhysicalPurchasePrice
    ? vendorItem.lastCasePrice! / vendorItem.caseSize!
    : vendorItem.lastPrice;
  const canonicalUnit = displayUnit(canonicalUnitName);
  const normalized = vendorItem.normalizedPricePerCanonicalUnit;

  if (normalized != null && Number.isFinite(normalized) && normalized >= 0) {
    return {
      purchasePrice: `$${purchasePrice.toFixed(2)}/${purchaseUnit}`,
      canonicalPrice: `$${normalized.toFixed(6)}/${canonicalUnit}`,
      canonicalStatus: "available",
    };
  }

  const canonicalStatus =
    vendorItem.packGeometryStatus === "conflicting"
      ? "conflicting"
      : vendorItem.packGeometryStatus === "variable_weight"
        ? "variable_weight"
        : "required";

  return {
    purchasePrice: `$${purchasePrice.toFixed(2)}/${purchaseUnit}`,
    canonicalPrice: null,
    canonicalStatus,
  };
}