type VendorPriceRow = {
  lastPrice: number;
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
): VendorPricePresentation {
  const purchaseUnit = displayUnit(vendorItem.unit?.name);
  const canonicalUnit = displayUnit(canonicalUnitName);
  const normalized = vendorItem.normalizedPricePerCanonicalUnit;

  if (normalized != null && Number.isFinite(normalized) && normalized >= 0) {
    return {
      purchasePrice: `$${vendorItem.lastPrice.toFixed(2)}/${purchaseUnit}`,
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
    purchasePrice: `$${vendorItem.lastPrice.toFixed(2)}/${purchaseUnit}`,
    canonicalPrice: null,
    canonicalStatus,
  };
}