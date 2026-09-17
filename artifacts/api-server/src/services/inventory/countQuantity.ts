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

export class InvalidCountGeometryError extends Error {}

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

  const hasContainerGeometry =
    item.containerSize != null ||
    item.casePkgCount != null ||
    item.containerUnitId != null ||
    Boolean(item.containerLabel);

  if (hasContainerGeometry) {
    const hasCompleteContainerGeometry =
      item.containerSize != null &&
      Number.isFinite(item.containerSize) &&
      item.containerSize > 0 &&
      item.casePkgCount != null &&
      Number.isFinite(item.casePkgCount) &&
      item.casePkgCount > 0 &&
      (item.containerUnitId != null || Boolean(item.containerLabel));

    if (!hasCompleteContainerGeometry) {
      throw new InvalidCountGeometryError(
        "Container counting is unavailable because this item's pack conversion is incomplete",
      );
    }

    return (
      parts.caseQty * item.casePkgCount! * item.containerSize! +
      parts.containerQty * item.containerSize! +
      parts.looseUnits
    );
  }

  if (
    item.caseSize == null ||
    !Number.isFinite(item.caseSize) ||
    item.caseSize <= 0
  ) {
    throw new InvalidCountGeometryError(
      "Case counting is unavailable because this item's case conversion is incomplete",
    );
  }

  if (parts.containerQty > 0) {
    throw new InvalidCountGeometryError(
      "Container quantity cannot be used without a valid container conversion",
    );
  }

  return parts.caseQty * item.caseSize + parts.looseUnits;
}