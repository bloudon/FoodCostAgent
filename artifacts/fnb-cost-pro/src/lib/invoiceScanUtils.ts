/**
 * Pure utility functions for the onboarding invoice scan flow.
 *
 * Extracted from the server-side route handlers so they can be unit-tested
 * independently of the database and HTTP layer.
 */

export type PriceSource = "unit" | "case" | "zero";
export type ScanAction = "update" | "create" | "skip";
export type MatchConfidence = "high" | "medium" | "none";

export interface RawScannedItem {
  unitPrice: number | null;
  casePrice: number | null;
}

export interface ResolvedPrice {
  resolvedUnitPrice: number;
  priceSource: PriceSource;
}

/**
 * Mirrors the price resolution logic in POST /api/onboarding/invoice-scan.
 *
 * Rules (same as the route):
 *   - If the AI returned a unitPrice → use it, priceSource = "unit"
 *   - Else if the AI returned a casePrice → fall back to it, priceSource = "case"
 *   - Otherwise → 0, priceSource = "zero"
 */
export function resolveScannedItemPrice(
  unitPrice: number | null,
  casePrice: number | null,
): ResolvedPrice {
  const priceSource: PriceSource =
    unitPrice != null ? "unit" :
    casePrice != null ? "case" :
    "zero";
  const resolvedUnitPrice = unitPrice ?? casePrice ?? 0;
  return { resolvedUnitPrice, priceSource };
}

/**
 * Mirrors the effectiveUnitPrice calculation used in both route handlers.
 *
 * Rules:
 *   - Prefer unitPrice when non-null
 *   - Fall back to casePrice when unitPrice is null
 *   - Fall back to 0 when both are absent
 */
export function resolveEffectiveUnitPrice(
  unitPrice: number | null | undefined,
  casePrice: number | null | undefined,
): number {
  return unitPrice ?? casePrice ?? 0;
}

/**
 * Computes the default action for a scanned item, matching the UI logic in
 * InvoiceScanStep (onboarding-setup.tsx):
 *   - "zero" price items → skip (user must explicitly choose to create them)
 *   - high / medium confidence match → update
 *   - no match  → create
 */
export function defaultScanAction(
  priceSource: PriceSource,
  matchConfidence: MatchConfidence,
): ScanAction {
  if (priceSource === "zero") return "skip";
  if (matchConfidence === "high" || matchConfidence === "medium") return "update";
  return "create";
}
