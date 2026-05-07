/**
 * Pure price-resolution utilities extracted from the onboarding invoice-scan routes.
 * Keeping these out of routes.ts makes them independently unit-testable.
 */

export type PriceSource = "unit" | "case" | "zero";

export interface RawScannedItem {
  unitPrice: number | null | undefined;
  casePrice: number | null | undefined;
}

/**
 * Determine how the price was sourced from a raw AI-scanned item.
 *
 * "unit"  — the AI returned a unit-level price
 * "case"  — only a case price was returned; unitPrice will be the case price as fallback
 * "zero"  — neither price was available; resolvedUnitPrice will be 0
 */
export function resolvePriceSource(item: RawScannedItem): PriceSource {
  if (item.unitPrice != null) return "unit";
  if (item.casePrice != null) return "case";
  return "zero";
}

/**
 * Resolve the effective unit price for a scanned item.
 * Result is always a number (never null/undefined).
 *
 * Falls back to casePrice when unitPrice is absent, then to 0.
 * This is the logic used in POST /api/onboarding/invoice-scan.
 */
export function resolveScannedItemUnitPrice(item: RawScannedItem): number {
  return item.unitPrice ?? item.casePrice ?? 0;
}

export interface ApplyLineItem {
  unitPrice?: number | null;
  casePrice?: number | null;
}

/**
 * Compute the effective unit price for an apply-line item.
 * Used when creating or updating inventory items from a reviewed invoice.
 * Result is always a number (never null/undefined).
 *
 * This is the logic used in POST /api/onboarding/invoice-scan/apply.
 */
export function resolveApplyLineUnitPrice(line: ApplyLineItem): number {
  return line.unitPrice ?? line.casePrice ?? 0;
}
