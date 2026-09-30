export type CountDisplayMode = "case" | "catch" | "simple";

export function formatPhysicalQuantity(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function pluralizeCountUnit(label: string, value: number): string {
  if (label.toLowerCase() === "each") return label;
  return value === 1 || label.endsWith("s") ? label : `${label}s`;
}

export function abbreviateCountUnit(label: string): string {
  const unit = label.trim().toLowerCase();
  if (unit === "each") return "ea";
  if (unit === "package" || unit.endsWith(" package")) return "pkg";
  if (unit === "container") return "ctr";
  if (unit === "bottle") return "btl";
  if (unit === "carton") return "ctn";
  return unit.slice(0, 3);
}

type CountLineDisplay = {
  qty: number;
  unitId?: string | null;
  caseQty?: number | null;
  containerQty?: number | null;
  looseUnits?: number | null;
  unitAbbreviation?: string | null;
  unitCost?: number | null;
  inventoryItem?: {
    unitId?: string | null;
    unitAbbreviation?: string | null;
    unitName?: string | null;
    containerSize?: number | null;
    casePkgCount?: number | null;
    containerLabel?: string | null;
  } | null;
};

export function isWholeCaseConfiguration(
  item: CountLineDisplay["inventoryItem"],
  canonicalUnit?: string | null,
): boolean {
  const unit = (canonicalUnit || item?.unitAbbreviation || item?.unitName || "").trim().toLowerCase();
  return item?.containerLabel?.trim().toLowerCase() === "whole case" &&
    Number(item.containerSize) === 1 &&
    Number(item.casePkgCount) === 1 &&
    (unit === "ea" || unit === "each");
}

/**
 * A package breakdown is evidence only when it reconciles to the saved
 * canonical quantity. Never divide an old canonical-only count by today's
 * package size and call the result a physical count.
 */
export function getCountUnitDisplay(line: CountLineDisplay, mode: CountDisplayMode) {
  const item = line.inventoryItem;
  const canonicalUnit = line.unitAbbreviation || item?.unitName || "unit";
  const canonicalQty = Number(line.qty);
  const canonical = `${Number.isFinite(canonicalQty) ? canonicalQty.toFixed(2) : "—"} ${canonicalUnit}`;
  const canonicalCost = line.unitCost == null ? null : Number(line.unitCost);
  const costAvailable = canonicalCost != null && Number.isFinite(canonicalCost) && canonicalCost >= 0;

  if (mode !== "case") {
    return {
      isPackage: false, status: "ready" as const,
      summary: canonical, total: canonical,
      unitLabel: canonicalUnit, caseDetail: null,
      price: costAvailable ? `$${canonicalCost!.toFixed(2)}/${canonicalUnit}` : "Price unavailable",
      containerLabel: null, containers: null,
    };
  }

  // A saved count's units can predate a change to the item. Today's package
  // geometry and price per canonical unit cannot interpret those old units.
  if (line.unitId && item?.unitId && line.unitId !== item.unitId) {
    const historical = `Historical: ${canonical} (review)`;
    return {
      isPackage: true, status: "historical" as const,
      summary: historical, total: historical,
      unitLabel: "Package count needs review", caseDetail: null,
      price: "Price unavailable", containerLabel: null, containers: null,
    };
  }

  const wholeCase = isWholeCaseConfiguration(item, line.unitAbbreviation);
  if (wholeCase) {
    const cases = Number(line.caseQty ?? 0);
    const containers = Number(line.containerQty ?? 0);
    const hasParts = line.caseQty != null || line.containerQty != null;
    const reconciled = hasParts && Number(line.looseUnits ?? 0) === 0 &&
      Number.isFinite(canonicalQty) && canonicalQty >= 0 &&
      Number.isFinite(cases) && cases >= 0 &&
      Number.isFinite(containers) && containers === 0 &&
      Math.abs(cases - canonicalQty) <= Math.max(0.01, canonicalQty * 1e-6);
    if (reconciled) {
      return {
        isPackage: true, status: "ready" as const,
        summary: `${formatPhysicalQuantity(cases)} ${pluralizeCountUnit("whole case", cases)}`,
        total: `${formatPhysicalQuantity(cases)} ${pluralizeCountUnit("whole case", cases)}`,
        unitLabel: "Whole cases", caseDetail: "Contents unspecified",
        price: costAvailable ? `$${canonicalCost!.toFixed(2)}/whole case` : "Price unavailable",
        containerLabel: "whole case", containers: cases,
      };
    }

    const historical = Number.isFinite(canonicalQty) && canonicalQty > 0 || hasParts ||
      Number(line.looseUnits ?? 0) > 0;
    return {
      isPackage: true, status: historical ? "historical" as const : "uncounted" as const,
      summary: historical ? `Historical: ${canonical} (review)` : "Not counted",
      total: historical ? `Historical: ${canonical} (review)` : "Not counted",
      unitLabel: "Whole cases", caseDetail: "Contents unspecified",
      price: costAvailable ? `$${canonicalCost!.toFixed(2)}/whole case` : "Price unavailable",
      containerLabel: "whole case", containers: null,
    };
  }

  const containerSize = Number(item?.containerSize);
  const casePkgCount = Number(item?.casePkgCount);
  const geometryReady =
    item?.containerSize != null && item?.casePkgCount != null &&
    Number.isFinite(containerSize) && containerSize > 0 &&
    Number.isFinite(casePkgCount) && casePkgCount > 0;
  const containerLabel = item?.containerLabel?.trim() || "container";
  const unitLabel = `Cases / ${pluralizeCountUnit(containerLabel, 2)}`;
  const caseDetail = geometryReady ? `1 case = ${formatPhysicalQuantity(casePkgCount)} ${pluralizeCountUnit(containerLabel, casePkgCount)}` : null;
  const price = geometryReady && costAvailable && Number.isFinite(canonicalCost! * containerSize)
    ? `$${(canonicalCost! * containerSize).toFixed(2)}/${containerLabel}`
    : "Price unavailable";
  const cases = Number(line.caseQty ?? 0);
  const containers = Number(line.containerQty ?? 0);
  const hasParts = line.caseQty != null || line.containerQty != null;
  const calculated = (cases * casePkgCount + containers) * containerSize;
  const reconciled = geometryReady && hasParts && Number(line.looseUnits ?? 0) === 0 &&
    Number.isFinite(canonicalQty) && canonicalQty >= 0 &&
    Number.isFinite(cases) && cases >= 0 &&
    Number.isFinite(containers) && containers >= 0 &&
    Math.abs(calculated - canonicalQty) <= Math.max(0.01, canonicalQty * 1e-6);

  if (reconciled) {
    const parts: string[] = [];
    if (cases > 0) parts.push(`${formatPhysicalQuantity(cases)} ${pluralizeCountUnit("case", cases)}`);
    if (containers > 0) parts.push(`${formatPhysicalQuantity(containers)} ${pluralizeCountUnit(containerLabel, containers)}`);
    const totalContainers = cases * casePkgCount + containers;
    return {
      isPackage: true, status: "ready" as const,
      summary: parts.length ? parts.join(" + ") : `0 ${pluralizeCountUnit(containerLabel, 0)}`,
      total: `${formatPhysicalQuantity(totalContainers)} ${pluralizeCountUnit(containerLabel, totalContainers)}`,
      unitLabel, caseDetail, price, containerLabel, containers: totalContainers,
    };
  }

  const historical = Number.isFinite(canonicalQty) && canonicalQty > 0 ||
    hasParts || Number(line.looseUnits ?? 0) > 0;
  return {
    isPackage: true, status: historical ? "historical" as const : geometryReady ? "uncounted" as const : "configuration" as const,
    summary: historical ? `Historical: ${canonical} (review)` : geometryReady ? "Not counted" : "Counting setup required",
    total: historical ? `Historical: ${canonical} (review)` : geometryReady ? "Not counted" : "Counting setup required",
    unitLabel, caseDetail, price, containerLabel, containers: null,
  };
}