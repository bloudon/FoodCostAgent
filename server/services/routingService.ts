/**
 * M3B — Routing Decision Service
 *
 * Pure decision functions extracted from POST /api/purchase-orders/:id/route-lines.
 * Imported by the route handler and independently testable without Express or a DB.
 *
 * Rules mirrored exactly from the route endpoint (Task #460):
 *   - Same inventoryItemId required on source and target vendor items
 *   - Target VI must be active, have a valid price, non-legacy source,
 *     fresh price (≤14 days), compatible unit, and valid pack geometry
 *   - Projected savings = (fromUnitPrice - toUnitPrice) × toCaseSize
 *   - Idempotency key = "${sourcePOLineId}:${targetVendorItemId}"
 *   - Merge: routing into a destination PO that already has a line for the
 *     same targetVendorItemId increments orderedQty rather than inserting
 */

import {
  getPriceFreshness,
  isIncompatibleUnit,
  effectivePackQty,
} from "./vendorPriceService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Minimal snapshot of a vendor_item row needed for eligibility evaluation.
 * Matches the columns loaded from DB in the route endpoint.
 */
export interface TargetViSnapshot {
  inventoryItemId: string | null;
  active: number | null;
  lastPrice: number | null;
  priceSource: string | null;
  pricedAt: Date | null;
  packUom: string | null;
  caseSize: number | null;
  innerPackSize: number | null;
}

// ─── Pure Decision Functions ──────────────────────────────────────────────────

/**
 * Verify that the target vendor item maps to the same inventory item as the
 * source PO line.  Called separately so unmapped-product rejection can be
 * tested independently from the VI eligibility gauntlet.
 */
export function checkInventoryItemMatch(
  sourceInventoryItemId: string | null | undefined,
  targetInventoryItemId: string | null | undefined,
): EligibilityResult {
  if (!sourceInventoryItemId) {
    return { eligible: false, reason: "Source vendor item has no linked inventory item" };
  }
  if (targetInventoryItemId !== sourceInventoryItemId) {
    return {
      eligible: false,
      reason: "Target vendor item maps to a different product — same inventory item required",
    };
  }
  return { eligible: true };
}

/**
 * Run the full eligibility gauntlet for a target vendor item.
 * Checks are applied in the same order as the route endpoint so that the
 * first failing check determines the rejection reason.
 *
 * @param targetVi         Vendor item row fields needed for the checks.
 * @param inventoryUnitName  Human-readable unit name (e.g. "pound") for the
 *                          source inventory item — used for unit-family compatibility.
 */
export function checkTargetViEligibility(
  targetVi: TargetViSnapshot,
  inventoryUnitName: string,
): EligibilityResult {
  if (!targetVi.active) {
    return { eligible: false, reason: "Target vendor item is inactive" };
  }
  if (!targetVi.lastPrice || targetVi.lastPrice <= 0) {
    return { eligible: false, reason: "Target vendor item has no valid price" };
  }
  if (targetVi.priceSource === "legacy_unknown") {
    return {
      eligible: false,
      reason: "Target vendor price is unverified — update the price before routing",
    };
  }
  if (getPriceFreshness(targetVi.pricedAt) === "stale") {
    return {
      eligible: false,
      reason: "Target vendor price is stale (older than 14 days)",
    };
  }
  if (isIncompatibleUnit(targetVi.packUom ?? "", inventoryUnitName)) {
    return {
      eligible: false,
      reason: "Target vendor pack unit is incompatible with this item's inventory unit",
    };
  }
  // Pass raw caseSize (no || 1 coercion) so caseSize=0/null correctly triggers
  // invalidPackGeometry — mirrors the route endpoint logic exactly.
  const { invalidPackGeometry } = effectivePackQty(
    targetVi.caseSize ?? 0,
    targetVi.innerPackSize ?? 1,
    targetVi.packUom ?? "",
    inventoryUnitName,
  );
  if (invalidPackGeometry) {
    return { eligible: false, reason: "Target vendor item has invalid pack geometry" };
  }
  return { eligible: true };
}

/**
 * Compute the projected savings per case when routing a line from one vendor
 * to another.  Mirrors the formula used in the route endpoint exactly:
 *
 *   projectedSavingsPerCase = (fromUnitPrice − toUnitPrice) × toCaseSize
 *
 * Positive result → cheaper at target vendor.
 * Negative result → target vendor is more expensive (routing still proceeds
 * if operator explicitly requested it).
 */
export function computeProjectedSavingsPerCase(
  fromUnitPrice: number,
  toUnitPrice: number,
  toCaseSize: number,
): number {
  return (fromUnitPrice - toUnitPrice) * toCaseSize;
}

/**
 * Compute the merged orderedQty when a line for the same targetVendorItemId
 * already exists in the destination PO.
 */
export function mergeOrderedQty(existingQty: number, routedQty: number): number {
  return existingQty + routedQty;
}

/**
 * Build the string key used for both in-memory and DB idempotency lookups.
 * A (sourcePOLineId, targetVendorItemId) pair is only ever routed once.
 */
export function routingIdempotencyKey(
  poLineId: string,
  targetVendorItemId: string,
): string {
  return `${poLineId}:${targetVendorItemId}`;
}

/**
 * Determine whether a routing request for a given (poLineId, targetVendorItemId)
 * pair has already been completed.  Returns true when a prior audit entry exists
 * with the same key, meaning the caller should return the existing result instead
 * of re-routing.
 */
export function isAlreadyRouted(
  alreadyRoutedLookup: Map<string, unknown>,
  poLineId: string,
  targetVendorItemId: string,
): boolean {
  return alreadyRoutedLookup.has(routingIdempotencyKey(poLineId, targetVendorItemId));
}

/**
 * Determine whether an existing destination PO line should be merged into
 * (same targetVendorItemId) or whether a new line should be inserted.
 *
 * @param existingLines   Lines already present in the destination PO.
 * @param targetVendorItemId  The vendor item being routed to.
 * @returns true  → increment orderedQty on the existing line
 * @returns false → insert a new line
 */
export function shouldMergeIntoExistingLine(
  existingLines: Array<{ vendorItemId: string }>,
  targetVendorItemId: string,
): boolean {
  return existingLines.some((l) => l.vendorItemId === targetVendorItemId);
}
