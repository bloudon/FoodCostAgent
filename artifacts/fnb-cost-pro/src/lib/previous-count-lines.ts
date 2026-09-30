import { getCountUnitDisplay, type CountDisplayMode } from "./count-unit-display";

export type CountLineIdentity = {
  inventoryItemId: string;
  storageLocationId: string;
};

export function countLineIdentity(line: CountLineIdentity): string {
  return `${line.inventoryItemId}\u0000${line.storageLocationId}`;
}

export function buildPreviousCountLineMap<T extends CountLineIdentity>(
  lines: T[] = [],
): Map<string, T> {
  return new Map(lines.map((line) => [countLineIdentity(line), line]));
}

export function getPreviousCountUnitDisplay(
  previousLine: any | undefined,
  currentLine: any,
  mode?: CountDisplayMode,
) {
  if (!previousLine) return null;
  const item = currentLine.inventoryItem;
  const effectiveMode = mode ?? (item?.countMode === "package" || item?.countMode === "unconfigured" ? "case" : "simple");
  const previous = {
    ...previousLine,
    inventoryItem: item,
    unitAbbreviation: previousLine.unitAbbreviation || currentLine.unitAbbreviation,
  };
  const display = getCountUnitDisplay(previous, effectiveMode);
  const currentUnitId = currentLine.unitId || item?.unitId;
  const idMismatch = previousLine.unitId && currentUnitId && previousLine.unitId !== currentUnitId;
  const labelMismatch = previousLine.unitAbbreviation && currentLine.unitAbbreviation &&
    previousLine.unitAbbreviation !== currentLine.unitAbbreviation;
  if (effectiveMode === "case" && (idMismatch || labelMismatch)) {
    const historical = `Historical: ${Number(previousLine.qty || 0).toFixed(2)} ${previousLine.unitAbbreviation || "previous canonical units"} (review)`;
    return { ...display, status: "historical" as const, summary: historical, total: historical, containers: null };
  }
  return display;
}

export function formatPreviousCountQuantity(
  previousLine: any | undefined,
  currentLine: any,
): string | null {
  return getPreviousCountUnitDisplay(previousLine, currentLine)?.summary ?? null;
}