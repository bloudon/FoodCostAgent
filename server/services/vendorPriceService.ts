/**
 * M3A — Vendor Price Integrity Service
 *
 * Single write-gate for all vendor-item price events.
 *
 * RULE:
 *   Quote sources  (order_guide_import, connector, po_create, manual, legacy_unknown)
 *     → update vendor_items price/source/pricedAt fields only.
 *     → NEVER touch inventory_items.pricePerUnit or avgCostPerUnit.
 *
 *   Actual-purchase sources  (receipt, invoice_scan)
 *     → update vendor_items AND inventory_items cost fields AND write history row.
 *
 * All callers that write lastPrice / lastCasePrice on vendor_items must call
 * recordVendorPrice() instead of writing those fields directly.
 *
 * Pass an optional `txOrDb` to participate in an existing transaction.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  vendorItems,
  inventoryItems,
  inventoryItemPriceHistory,
} from "@shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VendorPriceSource =
  | "order_guide_import"
  | "invoice_scan"
  | "receipt"
  | "po_create"
  | "manual"
  | "legacy_unknown";

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

export interface RecordVendorPriceParams {
  vendorItemId: string;

  /**
   * Required when representsActualPurchase=true so the service can update
   * inventory cost and write price history.  Optional for quote sources (the
   * service only writes vendor_items in that case).
   */
  inventoryItemId?: string;

  /**
   * Required when representsActualPurchase=true for the tenant safety check.
   */
  companyId?: string;

  /** The case price (primary entry field). */
  casePrice: number;

  /** The derived unit price (casePrice ÷ effective pack quantity in base units). */
  unitPrice: number;

  source: VendorPriceSource;

  /**
   * true  → receipt / invoice scan: update inventory cost + write history.
   * false → quote: update vendor_items price fields only.
   */
  representsActualPurchase: boolean;

  /**
   * Links this price event to a source document (receipt.id, etc.).
   */
  referenceId?: string;

  /** Acting user — stored in history rows. */
  userId?: string;

  /**
   * Current company-wide on-hand quantity in base units, used for WAC
   * numerator when completing a receipt.  Omit for simple last-cost.
   */
  currentOnHandQty?: number;

  /** Quantity received (for WAC). Used with currentOnHandQty. */
  receivedQty?: number;
}

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

/**
 * Runtime guard: quote sources must never claim to represent actual purchases.
 * Returns the corrected representsActualPurchase value.
 */
export function guardQuoteAsActual(
  source: VendorPriceSource,
  representsActualPurchase: boolean
): boolean {
  if (
    representsActualPurchase &&
    (source === "order_guide_import" || source === "connector")
  ) {
    console.warn(
      `[VendorPriceService] ⚠️  Caller passed representsActualPurchase=true with source="${source}". ` +
        `Quote sources must never update actual inventory cost. Overriding to false.`
    );
    return false;
  }
  return representsActualPurchase;
}

/**
 * Compute weighted average cost.
 * Pure function — exported for unit testing.
 */
export function computeWac(
  currentOnHandQty: number,
  currentAvgCost: number,
  receivedQty: number,
  receivedUnitPrice: number
): number {
  const totalQty = currentOnHandQty + receivedQty;
  if (totalQty <= 0) return receivedUnitPrice;
  return (currentOnHandQty * currentAvgCost + receivedQty * receivedUnitPrice) / totalQty;
}

/**
 * Returns true when a price is considered stale (older than 90 days or has no
 * pricedAt timestamp).
 * Pure function — exported for unit testing.
 */
export function isPriceStale(pricedAt: Date | null | undefined): boolean {
  if (!pricedAt) return true;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return pricedAt < ninetyDaysAgo;
}

// ─── Main Write Function ──────────────────────────────────────────────────────

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Record a vendor price event through the single shared write gate.
 *
 * Always updates vendor_items.(lastCasePrice, lastPrice, priceSource, pricedAt,
 * priceSourceReferenceId).
 *
 * Additionally, when representsActualPurchase=true:
 *   - Updates inventory_items.(pricePerUnit, avgCostPerUnit)
 *   - Inserts inventory_item_price_history if the price changed
 *
 * @param params  Price event parameters.
 * @param txOrDb  Optional Drizzle transaction handle.  Defaults to the module-
 *                level `db` singleton so the call is self-contained when the
 *                caller does not need a shared transaction.
 */
export async function recordVendorPrice(
  params: RecordVendorPriceParams,
  txOrDb: DbOrTx = db
): Promise<void> {
  const {
    vendorItemId,
    inventoryItemId,
    companyId,
    casePrice,
    unitPrice,
    source,
    referenceId,
    userId,
    currentOnHandQty,
    receivedQty,
  } = params;

  const representsActualPurchase = guardQuoteAsActual(
    source,
    params.representsActualPurchase
  );

  const now = new Date();

  // ── 1. Always stamp vendor_items price provenance ──────────────────────────
  await (txOrDb as typeof db)
    .update(vendorItems)
    .set({
      ...(casePrice > 0 ? { lastCasePrice: casePrice } : {}),
      ...(unitPrice > 0 ? { lastPrice: unitPrice } : {}),
      priceSource: source,
      pricedAt: now,
      ...(referenceId ? { priceSourceReferenceId: referenceId } : {}),
      updatedAt: now,
    })
    .where(eq(vendorItems.id, vendorItemId));

  // ── 2. Quote path — done ───────────────────────────────────────────────────
  if (!representsActualPurchase) return;

  if (!inventoryItemId || !companyId) {
    console.warn(
      `[VendorPriceService] representsActualPurchase=true but inventoryItemId or companyId missing. ` +
        `Skipping inventory cost update for vendorItemId=${vendorItemId}.`
    );
    return;
  }

  // ── 3. Fetch current inventory item ───────────────────────────────────────
  const [item] = await (txOrDb as typeof db)
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

  if (!item) return; // not found or wrong tenant — skip silently

  // ── 4. Compute WAC ─────────────────────────────────────────────────────────
  const newAvgCost =
    currentOnHandQty !== undefined &&
    receivedQty !== undefined &&
    receivedQty > 0
      ? computeWac(
          currentOnHandQty,
          item.avgCostPerUnit ?? item.pricePerUnit ?? 0,
          receivedQty,
          unitPrice
        )
      : (item.avgCostPerUnit ?? unitPrice);

  // ── 5. Update inventory item actual cost ───────────────────────────────────
  await (txOrDb as typeof db)
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

  // ── 6. Write price history when price changes (never for legacy_unknown) ───
  const prevPrice = item.pricePerUnit ?? 0;
  if (
    source !== "legacy_unknown" &&
    Math.abs(unitPrice - prevPrice) > 0.000001
  ) {
    await (txOrDb as typeof db)
      .insert(inventoryItemPriceHistory)
      .values({
        inventoryItemId,
        pricePerUnit: unitPrice,
        casePrice: casePrice > 0 ? casePrice : null,
        source,
        vendorItemId,
        effectiveAt: now,
        recordedBy: userId ?? null,
        note: `Price updated via ${source} (Last: $${unitPrice.toFixed(4)}, WAC: $${newAvgCost.toFixed(4)})`,
      });
  }
}
