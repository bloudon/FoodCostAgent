/**
 * M3A — Vendor Price Integrity Service
 *
 * Single write-gate for all vendor-item price events.
 *
 * RULES:
 *   Quote sources  (order_guide_import, connector, po_create, manual, legacy_unknown)
 *     → stamp vendor_items.(lastCasePrice, lastPrice, priceSource, pricedAt) only.
 *     → NEVER touch inventory_items.pricePerUnit or avgCostPerUnit.
 *
 *   Actual-purchase sources  (receipt, invoice_scan)
 *     → stamp vendor_items AND update inventory_items cost AND write history row.
 *
 * Contract:
 *   - Callers supply priceBasis ("case" | "unit") + a single price value.
 *   - The service derives both lastCasePrice and lastPrice internally using pack
 *     geometry (caseSize, innerPackSize, packUom, inventoryUnitName).
 *   - All writes are atomic: the service opens its own transaction when no external
 *     txOrDb is provided, preventing partial writes.
 *   - Incompatible-unit rows are flagged (incompatibleUnit=true) rather than
 *     silently computing wrong unit prices.
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
  | "connector"
  | "invoice_scan"
  | "receipt"
  | "po_create"
  | "manual"
  | "legacy_unknown";

export const ACTUAL_PURCHASE_SOURCES: ReadonlySet<VendorPriceSource> = new Set([
  "receipt",
  "invoice_scan",
]);

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
   * inventory cost and write history.  Optional for quote sources.
   */
  inventoryItemId?: string;

  /**
   * Required when representsActualPurchase=true for the tenant safety check.
   */
  companyId?: string;

  /**
   * Explicit price basis — which value `price` represents.
   * The service derives the counterpart price from pack geometry.
   *   "case" → price is the case price; service divides by pack qty for unit price
   *   "unit" → price is the unit price; service multiplies by pack qty for case price
   */
  priceBasis: "case" | "unit";

  /** The observed price in the specified basis. Must be ≥ 0. */
  price: number;

  /**
   * Pack geometry — used to derive the counterpart price.
   * Provide values from the vendor_item row so derivation is consistent.
   */
  caseSize: number;
  innerPackSize?: number;
  packUom?: string;
  inventoryUnitName?: string;

  source: VendorPriceSource;

  /**
   * true  → receipt / invoice scan — update inventory cost + write history.
   * false → quote — stamp vendor_items provenance fields only.
   */
  representsActualPurchase: boolean;

  /**
   * ID of the source document (receipt.id, invoice batch id, etc.).
   * Stored in priceSourceReferenceId and history note.
   */
  referenceId?: string;

  /** User who triggered the event — stored in history recordedBy. */
  userId?: string;

  /**
   * Current company-wide on-hand quantity in inventory base units.
   * Used for WAC numerator on actual purchases.  Omit for simple last-cost.
   */
  currentOnHandQty?: number;

  /** Quantity received (for WAC).  Required together with currentOnHandQty. */
  receivedQty?: number;
}

export interface DerivedPrices {
  casePrice: number;
  unitPrice: number;
  incompatibleUnit: boolean;
  /**
   * true when caseSize or innerPackSize was ≤ 0 (invalid pack geometry).
   * Derivation still proceeds with clamped values so callers can warn
   * operators rather than crashing, but the result should not be trusted.
   */
  invalidPackGeometry: boolean;
}

// ─── Pure Helpers (exported for unit testing) ─────────────────────────────────

/**
 * Detect whether the packUom and inventoryUnitName are from incompatible
 * measurement families (e.g. pack in kg but item tracked in gallons).
 * Returns true when the unit families are known and different.
 */
export function isIncompatibleUnit(
  packUom: string,
  inventoryUnitName: string
): boolean {
  const WEIGHT = new Set(["lb", "lbs", "pound", "pounds", "oz", "ounce", "ounces", "kg", "g", "gram", "grams"]);
  const VOLUME = new Set(["gal", "gallon", "gallons", "qt", "quart", "l", "liter", "litre", "ml", "fl oz", "floz"]);
  const COUNT  = new Set(["each", "ea", "pc", "piece", "unit", "ct", "count"]);

  const family = (u: string) => {
    const s = u.toLowerCase().trim();
    return WEIGHT.has(s) ? "weight" : VOLUME.has(s) ? "volume" : COUNT.has(s) ? "count" : null;
  };

  const pFam = family(packUom || "");
  const iFam = family(inventoryUnitName || "");
  if (!pFam || !iFam) return false;
  return pFam !== iFam;
}

/**
 * Compute effective pack quantity (in inventory base units) from pack geometry.
 * Returns { qty, invalidPackGeometry } so callers can flag operator-visible
 * warnings when the raw geometry is invalid (≤ 0) rather than silently coercing.
 */
export function effectivePackQty(
  caseSize: number,
  innerPackSize: number,
  packUom: string,
  inventoryUnitName: string
): { qty: number; invalidPackGeometry: boolean } {
  const invalidPackGeometry = caseSize <= 0 || innerPackSize <= 0;
  const safeOuter = Math.max(caseSize, 1);
  const safeInner = Math.max(innerPackSize, 1);
  const invUnit = (inventoryUnitName || "").toLowerCase().trim();
  const pUom    = (packUom || "").toLowerCase().trim();

  // "each" family: price per individual countable item — divide by outer count only
  if (["each", "ea", "piece", "unit", "count", "ct"].includes(invUnit)) {
    return { qty: safeOuter, invalidPackGeometry };
  }
  // "lb" family — handle oz→lb conversion
  if (["pound", "lb", "lbs"].includes(invUnit)) {
    if (["oz", "ounce", "ounces"].includes(pUom)) {
      return { qty: Math.max((safeOuter * safeInner) / 16, 0.0001), invalidPackGeometry };
    }
    return { qty: safeOuter * safeInner, invalidPackGeometry };
  }
  // "oz" family
  if (["ounce", "oz", "ounces"].includes(invUnit)) {
    return { qty: safeOuter * safeInner, invalidPackGeometry };
  }
  // Default: treat innerSize as total units in inventory's native unit
  return { qty: safeOuter * safeInner, invalidPackGeometry };
}

/**
 * Derive both casePrice and unitPrice from an explicit basis + pack geometry.
 * Returns incompatibleUnit=true when unit families are known and mismatched.
 * Returns invalidPackGeometry=true when caseSize/innerPackSize ≤ 0 — the
 * derivation still proceeds with clamped values so callers can warn operators.
 */
export function derivePrices(
  priceBasis: "case" | "unit",
  price: number,
  caseSize: number,
  innerPackSize: number = 1,
  packUom: string = "",
  inventoryUnitName: string = ""
): DerivedPrices {
  const incompatibleUnit = isIncompatibleUnit(packUom, inventoryUnitName);
  const { qty, invalidPackGeometry } = effectivePackQty(caseSize, innerPackSize, packUom, inventoryUnitName);

  if (priceBasis === "case") {
    const casePrice = price;
    const unitPrice = qty > 0 ? casePrice / qty : casePrice;
    return { casePrice, unitPrice, incompatibleUnit, invalidPackGeometry };
  } else {
    const unitPrice = price;
    const casePrice = unitPrice * qty;
    return { casePrice, unitPrice, incompatibleUnit, invalidPackGeometry };
  }
}

/**
 * Quote-source guard: prevents any quote source from accidentally being passed
 * as representsActualPurchase=true and opening the inventory-cost write branch.
 *
 * All sources in QUOTE_SOURCES are blocked regardless of the caller's flag.
 * Returns the corrected representsActualPurchase value.
 */
export function guardQuoteAsActual(
  source: VendorPriceSource,
  representsActualPurchase: boolean
): boolean {
  if (representsActualPurchase && QUOTE_SOURCES.has(source)) {
    console.warn(
      `[VendorPriceService] ⚠️  Caller passed representsActualPurchase=true with source="${source}". ` +
        `Quote sources must never update actual inventory cost. Overriding to false.`
    );
    return false;
  }
  return representsActualPurchase;
}

/**
 * Compute weighted average cost from current holdings + new receipt.
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
 * Cross-shopping price freshness thresholds (M3 purchasing rules).
 *
 * These govern whether a vendor price is eligible for cross-shop recommendations.
 * They are SEPARATE from PRICE_MAINTENANCE_ALERT_DAYS (90 days) in the dashboard
 * stale-vendor-prices endpoint, which is a routine maintenance warning.
 * Do NOT consolidate these two thresholds.
 */
export const CROSS_SHOP_PRICE_CURRENT_DAYS = 7;   // 0–7 days → "current"
export const CROSS_SHOP_PRICE_STALE_DAYS   = 14;  // >14 days → "stale" (excluded from recommendations)

/**
 * 3-tier price freshness:
 *   "current" — priced within the last 7 days
 *   "aging"   — priced 8–14 days ago (advisory; still eligible for recommendations)
 *   "stale"   — priced more than 14 days ago, or no timestamp
 */
export type PriceFreshness = "current" | "aging" | "stale";

export function getPriceFreshness(pricedAt: Date | null | undefined): PriceFreshness {
  if (!pricedAt) return "stale";
  const daysAgo = Math.floor((Date.now() - pricedAt.getTime()) / 86_400_000);
  if (daysAgo <= CROSS_SHOP_PRICE_CURRENT_DAYS) return "current";
  if (daysAgo <= CROSS_SHOP_PRICE_STALE_DAYS) return "aging";
  return "stale";
}

/**
 * Returns true when a price is stale (older than 14 days or missing timestamp).
 * Thin wrapper around getPriceFreshness for backward-compatible callsites.
 */
export function isPriceStale(pricedAt: Date | null | undefined): boolean {
  return getPriceFreshness(pricedAt) === "stale";
}

// ─── Internal Write Implementation ────────────────────────────────────────────

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function _executeWrite(
  params: RecordVendorPriceParams,
  txOrDb: DbOrTx
): Promise<void> {
  const {
    vendorItemId,
    inventoryItemId,
    companyId,
    priceBasis,
    price,
    caseSize,
    innerPackSize = 1,
    packUom = "",
    inventoryUnitName = "",
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

  // Derive both prices from the explicit basis + pack geometry
  const { casePrice, unitPrice, incompatibleUnit } = derivePrices(
    priceBasis,
    price,
    caseSize,
    innerPackSize,
    packUom,
    inventoryUnitName
  );

  if (incompatibleUnit) {
    console.warn(
      `[VendorPriceService] ⚠️  Incompatible unit: packUom="${packUom}" vs inventoryUnit="${inventoryUnitName}" ` +
        `for vendorItemId=${vendorItemId}. Price stamped but comparison results may be unreliable.`
    );
  }

  const now = new Date();
  const d = txOrDb as typeof db;

  // ── 1. Always stamp vendor_items price provenance ──────────────────────────
  await d
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

  // ── 3. Fetch current inventory item for WAC + change detection ─────────────
  const [item] = await d
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

  if (!item) return;

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
  await d
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

  // ── 6. Write price history when price changed (skip legacy_unknown) ─────────
  const prevPrice = item.pricePerUnit ?? 0;
  if (source !== "legacy_unknown" && Math.abs(unitPrice - prevPrice) > 0.000001) {
    await d.insert(inventoryItemPriceHistory).values({
      inventoryItemId,
      pricePerUnit: unitPrice,
      casePrice: casePrice > 0 ? casePrice : null,
      source,
      vendorItemId,
      effectiveAt: now,
      recordedBy: userId ?? null,
      note: `Price updated via ${source} (Last: $${unitPrice.toFixed(4)}, WAC: $${newAvgCost.toFixed(4)})${incompatibleUnit ? " [incompatible-unit]" : ""}`,
    });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Record a vendor price event through the single shared write gate.
 *
 * When no txOrDb is supplied, all writes are executed inside a new atomic
 * transaction (self-transactional).  Pass an existing Drizzle transaction
 * handle to participate in the caller's transaction.
 *
 * @param params  Price event parameters.
 * @param txOrDb  Optional Drizzle transaction handle.
 */
export async function recordVendorPrice(
  params: RecordVendorPriceParams,
  txOrDb?: DbOrTx
): Promise<void> {
  if (txOrDb && txOrDb !== db) {
    // Caller is managing the transaction — use it directly
    return _executeWrite(params, txOrDb);
  }
  // No external transaction — wrap in own atomic transaction
  return db.transaction(async (tx) => {
    await _executeWrite(params, tx);
  });
}
