export type SessionItemDisplayData = {
  unit: string | null;
  quantity: number;
  caseQty: number | null;
  containerQty: number | null;
  looseUnits: number | null;
  casePkgCount: number | null;
  containerSize: number | null;
  containerLabel: string | null;
  countMode?: "catch" | "direct" | "package" | "unconfigured" | null;
};

export function isWholeCaseConfiguration(
  item: Pick<SessionItemDisplayData, "unit" | "containerLabel" | "containerSize" | "casePkgCount">,
): boolean {
  const unit = item.unit?.trim().toLowerCase();
  return item.containerLabel?.trim().toLowerCase() === "whole case" &&
    item.containerSize === 1 &&
    item.casePkgCount === 1 &&
    (unit === "ea" || unit === "each");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function hasVerifiedPackageGeometry(item: SessionItemDisplayData): boolean {
  return (
    item.countMode === "package" &&
    Boolean(item.containerLabel?.trim()) &&
    item.containerSize != null &&
    item.casePkgCount != null &&
    item.containerSize > 0 &&
    item.casePkgCount > 0
  );
}

/** Only exposes package terminology when the API confirms complete geometry. */
export function formatPackLine(item: SessionItemDisplayData): string {
  if (hasVerifiedPackageGeometry(item) && isWholeCaseConfiguration(item)) {
    return "Whole cases · Contents unspecified";
  }
  if (hasVerifiedPackageGeometry(item)) {
    const label = item.containerLabel!.trim();
    const unit = item.unit?.trim();
    const units = unit ? ` ${unit}` : "";
    return `cs + ${label} · ${formatNumber(item.casePkgCount!)} × ${formatNumber(item.containerSize!)}${units}`;
  }
  return item.unit?.trim() || "ea";
}

export function formatCurrentCount(item: SessionItemDisplayData): string {
  if (hasVerifiedPackageGeometry(item) && isWholeCaseConfiguration(item)) {
    if (
      item.caseQty != null &&
      (item.containerQty == null || item.containerQty === 0) &&
      (item.looseUnits == null || item.looseUnits === 0) &&
      Math.abs(item.caseQty - item.quantity) <= Math.max(0.01, item.quantity * 1e-6)
    ) {
      return `${formatNumber(item.caseQty)} ${item.caseQty === 1 ? "whole case" : "whole cases"}`;
    }
    return formatNumber(item.quantity);
  }
  if (
    hasVerifiedPackageGeometry(item) &&
    item.caseQty != null &&
    item.containerQty != null
  ) {
    return `${formatNumber(item.caseQty)} · ${formatNumber(item.containerQty)}`;
  }
  return formatNumber(item.quantity);
}