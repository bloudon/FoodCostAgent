/**
 * Pure utility functions for pack-size mismatch detection in the order guide review flow.
 *
 * Extracted here so they can be unit-tested independently of the React component.
 */

export interface PackSizeLine {
  uom?: string | null;
  caseSize?: number | null;
  innerPack?: number | null;
  storedCaseSize?: number | null;
  storedInnerPackSize?: number | null;
}

/**
 * Returns true when the imported pack sizes differ from the vendor item's stored sizes
 * by more than the floating-point tolerance (0.001).
 *
 * Returns false when storedCaseSize is null — this means no prior vendor item exists
 * for the matched inventory item (or no vendor is assigned to the guide), so there is
 * nothing to compare against and no warning should be shown.
 */
export function hasPackSizeMismatch(line: PackSizeLine): boolean {
  if (line.storedCaseSize == null) return false;
  const importedCaseSize = line.caseSize ?? 1;
  const importedInnerPack = line.innerPack ?? 1;
  const storedCaseSize = line.storedCaseSize;
  const storedInnerPack = line.storedInnerPackSize ?? 1;
  return (
    Math.abs(importedCaseSize - storedCaseSize) > 0.001 ||
    Math.abs(importedInnerPack - storedInnerPack) > 0.001
  );
}

/**
 * Formats the stored (previously recorded) pack size for display in the mismatch tooltip.
 * Returns '-' when no stored size is available.
 */
export function formatStoredPackSize(line: PackSizeLine): string {
  if (line.storedCaseSize == null) return '-';
  if (line.storedInnerPackSize != null && line.storedInnerPackSize > 1) {
    const uom = line.uom ? ` ${line.uom}` : '';
    return `${line.storedCaseSize} × ${line.storedInnerPackSize}${uom}`;
  }
  const uom = line.uom ? ` ${line.uom}` : '';
  return `${line.storedCaseSize}${uom}`;
}
