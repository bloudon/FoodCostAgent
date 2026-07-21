/**
 * M3A — Vendor Price Integrity Service
 *
 * Single source of truth for all vendor price writes.
 *
 * RULE:
 *   Quote sources  (order_guide_import, connector, po_create, manual)
 *     → update vendor_items only; never touch inventory_items.pricePerUnit / avgCostPerUnit.
 *
 *   Actual-purchase sources  (receipt, invoice_scan)
 *     → update vendor_items AND inventory_items cost fields AND write price history.
 *
 * All callers must go through recordVendorPrice() instead of writing directly.
 */

import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
  vendorItems,
  inventoryItems,
  inventoryItemPriceHistory,
  type VendorItem,
} from "@shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VendorPriceSource =
  | "order_guide_import"
  | "invoice_scan"
  | "receipt"
  | "po_create"
  | "manual"
  | "legacy_unknown";

export interface RecordVendorPriceParams {
  vendorItemId: string;
  inventoryItemId: string;
  companyId: string;

  /** The entered case price (primary entry field). */
  casePrice: number;
  /** The derived unit price (casePrice ÷ effective case quantity in base units). */
  unitPrice: number;

  source: VendorPriceSource;

  /**
   * When true this price represents an actual completed purchase (receipt,
   * invoice scan). The inventory item's last-cost and WAC are updated.
   * When false (quote) only the vendor_items row is updated.
   */
  representsActualPurchase: boolean;

  /**
   * Reference ID linking this price event to the triggering document
   * (receipt.id, invoice batch id, etc.).  Optional.
   */
  referenceId?: string;

  /** User who triggered the write. Optional — stored in history. */
  userId?: string;

  /**
   * For WAC calculation on actual purchases: current on-hand quantity at the
   * receiving store in base units. Only used when representsActualPurchase=true.
   * Leave undefined to skip WAC update (uses unitPrice as new last cost only).
   */
  currentOnHandQty?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Sources that represent completed purchase events and may update actual cost. */
export const ACTUAL_PURCHASE_SOURCES: ReadonlySet<VendorPriceSource> = new Set([
  "receipt",
  "invoice_scan",
]);

/** Sources that represent quotes / catalogue data — must NOT update actual cost. */
export const QUOTE_SOURCES: ReadonlySet<VendorPriceSource> = new Set([
  "order_guide_import",
  "connector",
  "po_create",
  "manual",
  "legacy_unknown",
]);

// ─── Main Function ────────────────────────────────────────────────────────────

/**
 * Record a vendor price event.
 *
 * Always stamps vendor_items with priceSource / pricedAt / lastCasePrice /
 * lastPrice.  Only updates inventory_items cost fields and writes price history
 * when representsActualPurchase=true.
 */
export async function recordVendorPrice(
  params: RecordVendorPriceParams
): Promise<void> {
  const {
    vendorItemId,
    inventoryItemId,
    companyId,
    casePrice,
    unitPrice,
    source,
    representsActualPurchase,
    referenceId,
    userId,
    currentOnHandQty,
  } = params;

  const now = new Date();

  // ── 1. Always update vendor_items ──────────────────────────────────────────
  await db
    .update(vendorItems)
    .set({
      lastCasePrice: casePrice,
      lastPrice: unitPrice,
      priceSource: source,
      pricedAt: now,
      ...(referenceId ? { priceSourceReferenceId: referenceId } : {}),
      updatedAt: now,
    })
    .where(eq(vendorItems.id, vendorItemId));

  // ── 2. Quote path — stop here ───────────────────────────────────────────────
  if (!representsActualPurchase) {
    return;
  }

  // ── 3. Actual-purchase path — update inventory item cost ───────────────────
  // Fetch current item for WAC calculation (tenant-scoped).
  const [item] = await db
    .select({
      pricePerUnit: inventoryItems.pricePerUnit,
      avgCostPerUnit: inventoryItems.avgCostPerUnit,
    })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.id, inventoryItemId),
        eq(inventoryItems.companyId, companyId)
      )
    )
    .limit(1);

  if (!item) return; // Item not found or wrong tenant — abort silently.

  // WAC = (currentQty × currentAvgCost + receivedQty × newUnitPrice) / totalQty
  // If no on-hand qty provided, just stamp last cost (no WAC update).
  let newAvgCost: number;
  if (currentOnHandQty !== undefined && currentOnHandQty >= 0) {
    const currentAvg = item.avgCostPerUnit ?? item.pricePerUnit ?? 0;
    const totalValue = currentOnHandQty * currentAvg + unitPrice;
    const totalQty = currentOnHandQty + 1; // +1 represents the received unit
    newAvgCost = totalQty > 0 ? totalValue / totalQty : unitPrice;
  } else {
    newAvgCost = item.avgCostPerUnit ?? unitPrice;
  }

  await db
    .update(inventoryItems)
    .set({
      pricePerUnit: unitPrice,
      avgCostPerUnit: newAvgCost,
      updatedAt: now,
    })
    .where(
      and(
        eq(inventoryItems.id, inventoryItemId),
        eq(inventoryItems.companyId, companyId)
      )
    );

  // ── 4. Write price history ─────────────────────────────────────────────────
  const prevPrice = item.pricePerUnit ?? 0;
  if (Math.abs(unitPrice - prevPrice) > 0.00001) {
    await db.insert(inventoryItemPriceHistory).values({
      inventoryItemId,
      pricePerUnit: unitPrice,
      casePrice,
      source,
      vendorItemId,
      effectiveAt: now,
      recordedBy: userId ?? null,
      note: `Price updated via ${source} (Last: $${unitPrice.toFixed(4)}, WAC: $${newAvgCost.toFixed(4)})`,
    });
  }
}
