/**
 * Shared vendor-item call-site helpers — extracted from routes.ts so the
 * race-guard logic (getOrCreateVendorItem + conditional price stamp) lives in
 * one importable unit instead of being inlined across three route handlers.
 *
 * Tested directly in vendorItemResolution.callsites.test.ts: importing and
 * asserting against these real functions means removing the guard from this
 * file causes the tests to fail (a handler-clone cannot provide that guarantee).
 *
 * Both call sites that feed into routes.ts must go through the functions here.
 * Do NOT bypass them by calling getOrCreateVendorItem + recordVendorPrice inline
 * in a new route; add a new helper here instead.
 */
import { db } from "../db";
import { getOrCreateVendorItem } from "./vendorItemResolution";
import { recordVendorPrice } from "./vendorPriceService";
import type { InsertVendorItem, VendorItem } from "@workspace/db";

// ── Manual POST /api/vendor-items ────────────────────────────────────────────

export interface ManualCreateResult {
  vendorItem: VendorItem;
  /**
   * true only when this call inserted the row (HTTP 201 appropriate).
   * false when the resolver returned an existing row (HTTP 200 appropriate).
   */
  created: boolean;
}

/**
 * Resolves or creates the vendor item for a manual POST request, then stamps
 * the price ONLY when this call created the row.
 *
 * Extracted from routes.ts POST /api/vendor-items (lines ~9983–10004).
 *
 * Race-guard invariant:
 *   A duplicate POST that resolves to a pre-existing row must never overwrite
 *   that row's pricing.  When created=false, recordVendorPrice is not called
 *   and the caller should return 200 (not 201).
 */
export async function resolveVendorItemForManualCreate(
  createData: InsertVendorItem,
  enteredCasePrice: number | null | undefined,
  caseSize: number,
): Promise<ManualCreateResult> {
  const { vendorItem, created } = await getOrCreateVendorItem(db, createData);

  // Guard: existing row → return immediately, no price stamp.
  if (!created) {
    return { vendorItem, created: false };
  }

  if (enteredCasePrice && enteredCasePrice > 0) {
    await recordVendorPrice({
      vendorItemId:             vendorItem.id,
      inventoryItemId:          vendorItem.inventoryItemId ?? undefined,
      priceBasis:               "case",
      price:                    enteredCasePrice,
      caseSize,
      source:                   "manual",
      representsActualPurchase: false,
    });
  }

  return { vendorItem, created: true };
}

// ── PO create / PO patch ─────────────────────────────────────────────────────

export interface PoLineResult {
  vendorItemId: string;
  /** true only when this call inserted the row. */
  created: boolean;
}

/**
 * Resolves or creates the vendor item for a PO line that carries only an
 * inventoryItemId (no vendorItemId), then stamps the price ONLY when this
 * call created the row.
 *
 * Extracted from routes.ts:
 *   POST  /api/purchase-orders          (lines ~13386–13415)
 *   PATCH /api/purchase-orders/:id      (lines ~13477–13507)
 *
 * Race-guard invariant:
 *   When a storage-layer check missed the concurrent winner's INSERT (the
 *   storage.getVendorItems() call returned [] just before the winner committed),
 *   getOrCreateVendorItem returns the winner's row with created=false.
 *   Stamping the PO line's priceEach onto that row would overwrite the winner's
 *   pack-derived pricing; the guard prevents this.
 */
export async function resolveVendorItemForPoLine(params: {
  vendorId: string;
  inventoryItemId: string;
  purchaseUnitId: string;
  priceEach: number;
}): Promise<PoLineResult> {
  const { vendorId, inventoryItemId, purchaseUnitId, priceEach } = params;

  const resolution = await getOrCreateVendorItem(db, {
    vendorId,
    inventoryItemId,
    purchaseUnitId,
    caseSize: 1,
    active: 1,
  });

  // Guard: stamp price ONLY when this call created the row.
  if (resolution.created && priceEach > 0) {
    await recordVendorPrice({
      vendorItemId:             resolution.vendorItem.id,
      inventoryItemId,
      priceBasis:               "unit",
      price:                    priceEach,
      caseSize:                 1,
      source:                   "po_create",
      representsActualPurchase: false,
    });
  }

  return { vendorItemId: resolution.vendorItem.id, created: resolution.created };
}
