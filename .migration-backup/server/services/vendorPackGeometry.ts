/**
 * Vendor Pack Geometry Service
 *
 * Normalizes vendor-item pricing so every vendor quote is comparable on an
 * apples-to-apples basis: "price per canonical inventory unit".
 *
 * DESIGN RULES:
 *   - `canonical_qty_per_purchase_unit` answers: "how many canonical inventory
 *     units are contained in one purchaseable unit from this vendor?"
 *     Examples: 4×5 LB case → 20 LB; 12×750 ML → 9000 ML; 30-ct eggs → 30 EA.
 *   - `normalized_price_per_canonical_unit` = last_price / canonical_qty.
 *     Always server-derived; never accepted directly from clients.
 *   - Variable-weight items (meats, seafood, cheese sold by case weight) are
 *     excluded from automatic normalization — invoiced weight varies per delivery.
 *   - Dimensional mismatch (e.g. pack in KG but item tracked in GAL) is flagged
 *     as `conflicting`; geometry is stored as null so comparisons are suppressed.
 *
 * Two public surfaces:
 *   computePackGeometry()          — pure, no DB; use in unit tests and inline hot-paths
 *   updateVendorItemPackGeometry() — persists computed geometry to vendor_items via DB
 *   backfillVendorPackGeometry()   — one-time startup migration; classifies all rows
 */

import { eq, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { vendorItems, inventoryItems } from "@shared/schema";
import { effectivePackQty, isIncompatibleUnit } from "./vendorPriceService";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PackGeometryStatus =
  | "verified"        // user explicitly set canonical_qty
  | "parsed"          // derived unambiguously from numeric case_size/inner_pack_size
  | "inferred"        // derived from pack_uom text parsing (less confident)
  | "incomplete"      // missing required fields (null case_size, null price, etc.)
  | "conflicting"     // dimensional mismatch between purchase unit and canonical unit
  | "variable_weight";// weight varies by delivery; no definitive normalized price

export type PackGeometrySource =
  | "manual"
  | "vendor_portal"
  | "invoice"
  | "csv_order_guide"
  | "legacy_migration"
  | "ai_parse"
  | "receipt_confirmation";

export type PricingBasis = "purchase_unit" | "canonical_unit";

// Input to the pure computation function.
export interface PackGeometryInput {
  /** Number of inner packs per outer (purchase) unit. Usually 1 for simple items. */
  caseSize: number;
  /** Units per inner pack (e.g. 5 LB per bag in a 4-bag case). 1 when unused. */
  innerPackSize?: number | null;
  /** Dimension label of the inner pack unit (e.g. "lb", "oz", "ml"). */
  packUom?: string | null;
  /** The vendor's price for one purchase unit (used when pricingBasis = purchase_unit). */
  lastPrice: number;
  /** Whether last_price is price per purchase unit or already price per canonical unit. */
  pricingBasis?: PricingBasis | null;
  /** True → item is sold by case but invoiced by actual weight. Skip normalization. */
  isVariableWeight?: boolean | number | null;
  /** Unit kind of the purchase unit ("weight"|"volume"|"count") — used for compat check. */
  purchaseUnitKind?: string | null;
  /** Unit kind of the canonical inventory unit. */
  canonicalUnitKind?: string | null;
  /** Abbreviation/name of the canonical inventory unit (e.g. "lb", "fl oz"). */
  canonicalUnitName?: string | null;
  /**
   * When the caller has already resolved the canonical qty (e.g. from a
   * user-entered value), supply it here.  status becomes "verified".
   */
  providedCanonicalQty?: number | null;
}

export interface PackGeometryResult {
  canonicalQty: number | null;
  normalizedPrice: number | null;
  status: PackGeometryStatus;
}

// ─── Pure Computation ─────────────────────────────────────────────────────────

/**
 * Compute pack geometry from raw vendor-item fields.  No I/O — safe to call in
 * tight loops and unit tests.
 *
 * Returns (canonicalQty, normalizedPrice, status).  Normalized price is null
 * whenever geometry is not fully deterministic (conflicting, incomplete,
 * variable_weight).
 */
export function computePackGeometry(input: PackGeometryInput): PackGeometryResult {
  const {
    caseSize,
    innerPackSize = 1,
    packUom = "",
    lastPrice,
    pricingBasis = "purchase_unit",
    isVariableWeight: isVW,
    canonicalUnitName = "",
    providedCanonicalQty,
  } = input;

  // ── Variable weight: no reliable normalized price ──────────────────────────
  if (isVW === true || isVW === 1) {
    return { canonicalQty: null, normalizedPrice: null, status: "variable_weight" };
  }

  // ── Pricing basis: canonical_unit ─────────────────────────────────────────
  // last_price is already per canonical unit (e.g. lb-priced meat bought by the lb)
  if (pricingBasis === "canonical_unit") {
    return {
      canonicalQty: 1,
      normalizedPrice: lastPrice >= 0 ? lastPrice : null,
      status: "verified",
    };
  }

  // ── Dimensional compatibility ──────────────────────────────────────────────
  // Only flag when both families are known and differ.
  if (isIncompatibleUnit(packUom ?? "", canonicalUnitName ?? "")) {
    return { canonicalQty: null, normalizedPrice: null, status: "conflicting" };
  }

  // ── Explicit canonical qty (user-supplied or caller-derived) ─────────────
  if (providedCanonicalQty != null) {
    if (providedCanonicalQty <= 0) {
      // Reject zero/negative — these are data errors.
      return { canonicalQty: null, normalizedPrice: null, status: "incomplete" };
    }
    return {
      canonicalQty: providedCanonicalQty,
      normalizedPrice: lastPrice > 0 ? lastPrice / providedCanonicalQty : null,
      status: "verified",
    };
  }

  // ── Derive from pack fields ────────────────────────────────────────────────
  const safeCase = caseSize ?? 0;
  const safeInner = innerPackSize ?? 1;

  if (safeCase <= 0) {
    return { canonicalQty: null, normalizedPrice: null, status: "incomplete" };
  }

  const { qty, invalidPackGeometry } = effectivePackQty(
    safeCase,
    safeInner,
    packUom ?? "",
    canonicalUnitName ?? "",
  );

  if (invalidPackGeometry || qty <= 0) {
    return { canonicalQty: null, normalizedPrice: null, status: "incomplete" };
  }

  const normalizedPrice = lastPrice > 0 ? lastPrice / qty : null;

  // When lastPrice is 0 (no price yet), geometry is still useful — store it.
  return {
    canonicalQty: qty,
    normalizedPrice,
    status: "parsed",
  };
}

// ─── DB Parameters ────────────────────────────────────────────────────────────

export interface UpdateVendorItemPackGeometryParams {
  /** ID of the vendor_item row to update. */
  vendorItemId: string;
  /**
   * Optional pre-resolved canonical quantity.  When supplied, status = "verified".
   * When omitted, computed from the row's case_size/inner_pack_size/pack_uom.
   */
  canonicalQty?: number | null;
  /** How the geometry was established. Defaults to "manual". */
  source: PackGeometrySource;
  /** Override pricing_basis stored on the row. */
  pricingBasis?: PricingBasis | null;
}

/**
 * Persist pack geometry onto a vendor_item row.
 *
 * Reads the current row + linked inventory item from DB, runs
 * computePackGeometry(), then writes canonical_qty, normalized_price,
 * status, source, and timestamp back to vendor_items.
 */
export async function updateVendorItemPackGeometry(
  params: UpdateVendorItemPackGeometryParams,
): Promise<void> {
  const { vendorItemId, canonicalQty: providedCanonicalQty, source, pricingBasis } = params;

  // Load the vendor item and its canonical unit in one join.
  const [row] = await db
    .select({
      id: vendorItems.id,
      caseSize: vendorItems.caseSize,
      innerPackSize: vendorItems.innerPackSize,
      packUom: vendorItems.packUom,
      // Both prices fetched; the correct one is selected below based on pricingBasis.
      // • lastCasePrice = purchase-unit price (divide by canonicalQty → normalized)
      // • lastPrice     = already-normalized price; use when pricingBasis = canonical_unit
      lastCasePrice: vendorItems.lastCasePrice,
      lastPrice: vendorItems.lastPrice,
      isVariableWeight: vendorItems.isVariableWeight,
      pricingBasis: vendorItems.pricingBasis,
      inventoryItemId: vendorItems.inventoryItemId,
    })
    .from(vendorItems)
    .leftJoin(inventoryItems, eq(vendorItems.inventoryItemId, inventoryItems.id))
    .where(eq(vendorItems.id, vendorItemId))
    .limit(1);

  if (!row) return;

  // Resolve unit name for the linked inventory item's canonical unit.
  // We need the unit abbreviation for `effectivePackQty` and `isIncompatibleUnit`.
  let canonicalUnitName: string | null = null;
  if (row.inventoryItemId) {
    const [invItem] = await db
      .select({ unitId: inventoryItems.unitId })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, row.inventoryItemId))
      .limit(1);
    if (invItem) {
      // Look up the unit abbreviation from the units table.
      const { units } = await import("@shared/schema");
      const [unit] = await db
        .select({ name: units.name, kind: units.kind })
        .from(units)
        .where(eq(units.id, invItem.unitId))
        .limit(1);
      canonicalUnitName = unit?.name ?? null;
    }
  }

  const effectivePricingBasis = (pricingBasis ?? row.pricingBasis ?? "purchase_unit") as PricingBasis;
  const effectiveVW = row.isVariableWeight;

  // Select the correct price for the computation:
  // • canonical_unit → lastPrice is already per canonical unit; computePackGeometry
  //   returns it unchanged with canonicalQty = 1 (handled by the pricingBasis branch)
  // • purchase_unit  → lastCasePrice is per purchase unit; computePackGeometry
  //   divides by effectivePackQty to produce normalizedPricePerCanonicalUnit
  const priceInput = effectivePricingBasis === "canonical_unit"
    ? row.lastPrice
    : row.lastCasePrice;

  const result = computePackGeometry({
    caseSize: row.caseSize,
    innerPackSize: row.innerPackSize,
    packUom: row.packUom,
    lastPrice: priceInput,
    pricingBasis: effectivePricingBasis,
    isVariableWeight: effectiveVW,
    canonicalUnitName,
    providedCanonicalQty,
  });

  const now = new Date();
  await db
    .update(vendorItems)
    .set({
      canonicalQtyPerPurchaseUnit: result.canonicalQty,
      normalizedPricePerCanonicalUnit: result.normalizedPrice,
      packGeometryStatus: result.status,
      packGeometrySource: source,
      packGeometryUpdatedAt: now,
      pricingBasis: effectivePricingBasis,
      updatedAt: now,
    })
    .where(eq(vendorItems.id, vendorItemId));
}

/**
 * Invalidate pack geometry for all vendor items linked to an inventory item
 * whose canonical unit has just changed.  Marks them `conflicting` so the UI
 * surfaces a warning and operators can re-verify.
 *
 * Called from the PATCH /api/inventory-items/:id route whenever unitId changes.
 */
export async function invalidatePackGeometryForInventoryItem(
  inventoryItemId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(vendorItems)
    .set({
      canonicalQtyPerPurchaseUnit: null,
      normalizedPricePerCanonicalUnit: null,
      packGeometryStatus: "conflicting",
      packGeometryUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(vendorItems.inventoryItemId, inventoryItemId));
}

// ─── Backfill ─────────────────────────────────────────────────────────────────

export interface BackfillReport {
  total: number;
  normalized: number;
  alreadyValid: number;
  missingPrice: number;
  missingGeometry: number;
  ambiguousGeometry: number;
  dimensionMismatch: number;
  variableWeight: number;
  invalidZeroNegative: number;
  errors: number;
}

/**
 * Classify every existing vendor_item row and write geometry where unambiguous.
 * Safe to run at startup — skips rows that already have `pack_geometry_status` set.
 *
 * Returns a reconciliation report which is also written to a timestamped file and
 * logged to the console.
 */
export async function backfillVendorPackGeometry(): Promise<BackfillReport> {
  const { units } = await import("@shared/schema");
  const fs = await import("fs");
  const path = await import("path");

  const report: BackfillReport = {
    total: 0,
    normalized: 0,
    alreadyValid: 0,
    missingPrice: 0,
    missingGeometry: 0,
    ambiguousGeometry: 0,
    dimensionMismatch: 0,
    variableWeight: 0,
    invalidZeroNegative: 0,
    errors: 0,
  };

  // Load all rows that have not yet been classified.
  const rows = await db
    .select({
      id: vendorItems.id,
      inventoryItemId: vendorItems.inventoryItemId,
      caseSize: vendorItems.caseSize,
      innerPackSize: vendorItems.innerPackSize,
      packUom: vendorItems.packUom,
      lastPrice: vendorItems.lastPrice,
      lastCasePrice: vendorItems.lastCasePrice,
      isVariableWeight: vendorItems.isVariableWeight,
      packGeometryStatus: vendorItems.packGeometryStatus,
    })
    .from(vendorItems)
    .where(isNull(vendorItems.packGeometryStatus));

  report.total = rows.length;

  // Pre-load inventory items and units into Maps to avoid N+1 queries.
  const inventoryItemIds = [...new Set(rows.map((r) => r.inventoryItemId).filter(Boolean))];

  const invItemRows = inventoryItemIds.length > 0
    ? await db
        .select({ id: inventoryItems.id, unitId: inventoryItems.unitId })
        .from(inventoryItems)
        .where(
          inventoryItemIds.length === 1
            ? eq(inventoryItems.id, inventoryItemIds[0])
            : // drizzle inArray
              (await import("drizzle-orm")).inArray(inventoryItems.id, inventoryItemIds),
        )
    : [];

  const invItemMap = new Map(invItemRows.map((r) => [r.id, r]));

  const unitRows = await db.select({ id: units.id, name: units.name, kind: units.kind }).from(units);
  const unitMap = new Map(unitRows.map((u) => [u.id, u]));

  const now = new Date();
  const BATCH = 100;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (row) => {
        try {
          const invItem = row.inventoryItemId ? invItemMap.get(row.inventoryItemId) : null;
          const canonicalUnit = invItem ? unitMap.get(invItem.unitId) : null;
          const canonicalUnitName = canonicalUnit?.name ?? null;

          // Variable weight
          if (row.isVariableWeight === 1) {
            report.variableWeight++;
            await db
              .update(vendorItems)
              .set({
                packGeometryStatus: "variable_weight",
                packGeometrySource: "legacy_migration",
                packGeometryUpdatedAt: now,
              })
              .where(eq(vendorItems.id, row.id));
            return;
          }

          // Missing price — use lastCasePrice (purchase-unit price) as the authoritative
          // price input. lastPrice is already normalized (divided by pack qty) and must
          // not be used here, as it would cause double-division in computePackGeometry.
          if (!row.lastCasePrice || row.lastCasePrice <= 0) {
            report.missingPrice++;
            await db
              .update(vendorItems)
              .set({
                packGeometryStatus: "incomplete",
                packGeometrySource: "legacy_migration",
                packGeometryUpdatedAt: now,
              })
              .where(eq(vendorItems.id, row.id));
            return;
          }

          // Missing geometry
          if (!row.caseSize || row.caseSize <= 0) {
            report.missingGeometry++;
            await db
              .update(vendorItems)
              .set({
                packGeometryStatus: "incomplete",
                packGeometrySource: "legacy_migration",
                packGeometryUpdatedAt: now,
              })
              .where(eq(vendorItems.id, row.id));
            return;
          }

          // Dimension mismatch check
          if (isIncompatibleUnit(row.packUom ?? "", canonicalUnitName ?? "")) {
            report.dimensionMismatch++;
            await db
              .update(vendorItems)
              .set({
                packGeometryStatus: "conflicting",
                packGeometrySource: "legacy_migration",
                packGeometryUpdatedAt: now,
              })
              .where(eq(vendorItems.id, row.id));
            return;
          }

          // Compute — pass lastCasePrice (purchase-unit price) so the division
          // normalizedPrice = lastCasePrice / canonicalQty yields $/canonical-unit.
          const result = computePackGeometry({
            caseSize: row.caseSize,
            innerPackSize: row.innerPackSize,
            packUom: row.packUom,
            lastPrice: row.lastCasePrice,
            pricingBasis: "purchase_unit",
            canonicalUnitName,
          });

          if (result.status === "incomplete") {
            report.invalidZeroNegative++;
          } else if (result.canonicalQty != null && result.normalizedPrice != null) {
            report.normalized++;
          } else {
            report.ambiguousGeometry++;
          }

          await db
            .update(vendorItems)
            .set({
              canonicalQtyPerPurchaseUnit: result.canonicalQty,
              normalizedPricePerCanonicalUnit: result.normalizedPrice,
              packGeometryStatus: result.status,
              packGeometrySource: "legacy_migration",
              packGeometryUpdatedAt: now,
            })
            .where(eq(vendorItems.id, row.id));
        } catch (err) {
          report.errors++;
          console.error(`[packGeometry] backfill error for vendorItemId=${row.id}:`, err);
        }
      }),
    );
  }

  // Reconciliation report
  const reportLines = [
    `[PackGeometry Backfill] ${now.toISOString()}`,
    `  Total rows:           ${report.total}`,
    `  Successfully normalzd: ${report.normalized}`,
    `  Already valid:        ${report.alreadyValid}`,
    `  Missing price:        ${report.missingPrice}`,
    `  Missing geometry:     ${report.missingGeometry}`,
    `  Ambiguous geometry:   ${report.ambiguousGeometry}`,
    `  Dimension mismatches: ${report.dimensionMismatch}`,
    `  Variable weight:      ${report.variableWeight}`,
    `  Invalid (zero/neg):   ${report.invalidZeroNegative}`,
    `  Errors:               ${report.errors}`,
  ].join("\n");

  console.log(reportLines);

  try {
    const ts = now.toISOString().replace(/[:.]/g, "-");
    const outDir = path.join(process.cwd(), "logs");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `pack-geometry-backfill-${ts}.txt`), reportLines + "\n");
  } catch {
    // Non-fatal — report was already console.logged
  }

  return report;
}
