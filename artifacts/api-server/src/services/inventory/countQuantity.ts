type CountGeometry = {
  unitId: string;
  caseSize: number | null;
  containerSize: number | null;
  casePkgCount: number | null;
  containerUnitId: string | null;
  containerLabel: string | null;
};

type CountParts = {
  caseQty: number;
  containerQty: number;
  looseUnits: number;
};

export type CountPackSnapshot = {
  unitId: string;
  caseSize: number | null;
  containerSize: number;
  casePkgCount: number;
  containerLabel: string | null;
  recordedAt: string;
};

/** Record the conversion actually used for a package entry, never today's replacement. */
export function makeCountPackSnapshot(item: CountGeometry, now = new Date()): CountPackSnapshot {
  if (getCountInputMode(item) !== "package") {
    throw new InvalidCountGeometryError("Cannot snapshot incomplete package geometry");
  }
  return {
    unitId: item.unitId,
    caseSize: item.caseSize,
    containerSize: item.containerSize!,
    casePkgCount: item.casePkgCount!,
    containerLabel: item.containerLabel,
    recordedAt: now.toISOString(),
  };
}

/** Legacy saved count arithmetic is evidence of units counted, not supplier identity. */
export function inferSavedLegacyCaseQuantity(line: {
  qty: number;
  caseQty: number | null;
  containerQty: number | null;
  looseUnits: number | null;
  countPackSnapshot: unknown;
}): number | null {
  if (line.countPackSnapshot != null ||
      line.caseQty == null || line.caseQty <= 0 ||
      Number(line.containerQty ?? 0) !== 0 ||
      Number(line.looseUnits ?? 0) !== 0 ||
      !Number.isFinite(line.qty) || line.qty <= 0) return null;
  const implied = line.qty / line.caseQty;
  return Number.isFinite(implied) && implied > 0 ? implied : null;
}

export class InvalidCountGeometryError extends Error {}

export type CountInputMode = "catch" | "direct" | "package" | "unconfigured";

/** Measurement units are not a physical package definition for direct counts. */
export function directMeasurementCountBlock(
  countMode: CountInputMode,
  unitKind: string | null | undefined,
): string | null {
  if (countMode === "catch") return null;
  if (countMode === "direct" && !unitKind) {
    return "Direct counting is blocked because the item's canonical unit metadata is unavailable.";
  }
  if (countMode === "direct" && (unitKind === "weight" || unitKind === "volume")) {
    return "Direct counting in a measurement unit requires an explicit catch-weight setup or verified physical package geometry.";
  }
  return null;
}

/**
 * Item-level count policy. Package geometry is deliberately opt-in: a
 * canonical unit or legacy caseSize never becomes an employee-facing count
 * unit by inference.
 */
export function getCountInputMode(
  item: CountGeometry,
  isCatchWeightCategory = false,
): CountInputMode {
  if (isCatchWeightCategory) return "catch";

  const hasPackageSignals =
    item.containerSize != null ||
    item.casePkgCount != null ||
    item.containerLabel != null;
  if (!hasPackageSignals) return "direct";

  const hasCompleteOperationalGeometry =
    item.containerSize != null &&
    Number.isFinite(item.containerSize) &&
    item.containerSize > 0 &&
    item.casePkgCount != null &&
    Number.isFinite(item.casePkgCount) &&
    item.casePkgCount > 0;

  return hasCompleteOperationalGeometry ? "package" : "unconfigured";
}

export type CountStatus = "historicalLoose" | "ready" | "incomplete" | null;

export function resolveOperationalPackSizeRaw(
  rawValues: Array<string | null | undefined>,
): string | null {
  if (rawValues.length === 0) return null;
  const distinct = new Map<string, string>();
  for (const value of rawValues) {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    const key = trimmed.toUpperCase();
    if (!distinct.has(key)) distinct.set(key, trimmed);
  }
  return distinct.size === 1 ? Array.from(distinct.values())[0] : null;
}

export function getOperationalContainerLabel(
  item: Pick<CountGeometry, "containerLabel"> & { name?: string | null },
  categoryName?: string | null,
): string {
  const configured = item.containerLabel?.trim();
  if (configured) return configured.toLowerCase();

  const itemName = item.name?.toLowerCase() ?? "";
  const category = categoryName?.toLowerCase() ?? "";
  if (/\bkegs?\b/.test(itemName) || /\bkegs?\b/.test(category)) return "keg";
  if (/\bcans?\b/.test(itemName) || /\bcans?\b/.test(category)) return "can";
  if (/\bbottles?\b|\bbtl\b/.test(itemName)) return "bottle";
  if (category.includes("liquor") || category.includes("wine") || category.includes("bottled beer")) {
    return "bottle";
  }
  if (/\bbags?\b/.test(itemName)) return "bag";
  if (/\bbox(?:es)?\b/.test(itemName)) return "box";
  return "container";
}

export function getCountStatus(
  mode: CountInputMode,
  looseUnits: number | null | undefined,
): CountStatus {
  if (Number(looseUnits ?? 0) > 0) return "historicalLoose";
  if (mode === "package") return "ready";
  if (mode === "unconfigured") return "incomplete";
  return null;
}

export function getCountMetadata(
  item: CountGeometry,
  isCatchWeightCategory: boolean,
  looseUnits: number | null | undefined,
) {
  const countMode = getCountInputMode(item, isCatchWeightCategory);
  return {
    countMode,
    countStatus: getCountStatus(countMode, looseUnits),
  };
}

export function validateDirectCountQuantity(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidCountGeometryError(
      "Quantity must be a finite, non-negative number",
    );
  }
  return value;
}

export function validateCountDelta(value: number): number {
  if (!Number.isFinite(value)) {
    throw new InvalidCountGeometryError("Count delta must be a finite number");
  }
  return value;
}

export function calculateCanonicalCountQuantity(
  item: CountGeometry,
  lineUnitId: string,
  parts: CountParts,
): number {
  if (lineUnitId !== item.unitId) {
    throw new InvalidCountGeometryError(
      "Count line unit does not match the item's canonical inventory unit",
    );
  }

  for (const [label, value] of Object.entries(parts)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new InvalidCountGeometryError(
        `${label} must be a finite, non-negative number`,
      );
    }
  }

  if (parts.looseUnits !== 0) {
    throw new InvalidCountGeometryError(
      "Canonical loose quantity cannot be entered for package counting",
    );
  }

  const hasCompleteOperationalGeometry =
    item.containerSize != null &&
    Number.isFinite(item.containerSize) &&
    item.containerSize > 0 &&
    item.casePkgCount != null &&
    Number.isFinite(item.casePkgCount) &&
    item.casePkgCount > 0;

  if (!hasCompleteOperationalGeometry) {
    throw new InvalidCountGeometryError(
      "Package counting is unavailable because this item's operational counting method is incomplete",
    );
  }
  // A whole case is itself the stock unit. There is no confirmed inner
  // container, even if the generic package equation would accept one.
  if (item.containerLabel?.trim().toLowerCase() === "whole case" &&
      item.caseSize === 1 && item.containerSize === 1 &&
      item.casePkgCount === 1 && item.containerUnitId === item.unitId &&
      parts.containerQty !== 0) {
    throw new InvalidCountGeometryError(
      "Whole-case counting accepts cases only; contents are unspecified",
    );
  }

  return (
    parts.caseQty * item.casePkgCount! * item.containerSize! +
    parts.containerQty * item.containerSize!
  );
}