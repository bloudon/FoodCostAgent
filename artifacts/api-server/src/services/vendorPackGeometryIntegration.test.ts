/**
 * Vendor Pack Geometry — Integration Tests
 *
 * These tests exercise the full recordVendorPrice → geometry persistence pipeline
 * against the real DB to catch pricing-basis regressions.
 *
 * Each test creates its own fixtures using unique IDs and cleans up in afterEach.
 */

import { describe, it, expect, afterEach } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  vendorItems,
  inventoryItems,
  vendors,
  companies as companiesTable,
  units as unitsTable,
} from "@workspace/db";
import { recordVendorPrice } from "./vendorPriceService";

// ─── Unique test IDs (prevent cross-test leakage) ────────────────────────────
const RUN = Date.now().toString(36);
const IDs = {
  company:       `test-pgint-co-${RUN}`,
  unit:          `test-pgint-unit-${RUN}`,
  invItem:       `test-pgint-inv-${RUN}`,
  vendor:        `test-pgint-vend-${RUN}`,
  vendorItem4x5: `test-pgint-vi-4x5-${RUN}`,
  vendorItem30ct:`test-pgint-vi-30ct-${RUN}`,
};

// ─── Cleanup helpers ──────────────────────────────────────────────────────────
afterEach(async () => {
  await db.delete(vendorItems).where(eq(vendorItems.vendorId, IDs.vendor));
  await db.delete(vendors).where(eq(vendors.id, IDs.vendor));
  await db.delete(inventoryItems).where(eq(inventoryItems.id, IDs.invItem));
  await db.delete(companiesTable).where(eq(companiesTable.id, IDs.company));
  // Note: units rows are global seed data — do not delete them.
});

// ─── Fixture setup ────────────────────────────────────────────────────────────
async function insertFixtures(unitName: string) {
  // Find or use an existing unit for the canonical unit.
  const [unit] = await db
    .select()
    .from(unitsTable)
    .where(eq(unitsTable.name, unitName))
    .limit(1);

  if (!unit) throw new Error(`Unit "${unitName}" not found in test DB. Run seed first.`);

  await db.insert(companiesTable).values({
    id: IDs.company,
    name: "Pack Geometry Test Co",
    country: "US",
    timezone: "America/New_York",
  }).onConflictDoNothing();

  await db.insert(inventoryItems).values({
    id: IDs.invItem,
    companyId: IDs.company,
    name: "Test Item",
    unitId: unit.id,
    pricePerUnit: 0,
  }).onConflictDoNothing();

  await db.insert(vendors).values({
    id: IDs.vendor,
    companyId: IDs.company,
    name: "Test Vendor",
  }).onConflictDoNothing();

  return { unit };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Pack geometry — DB integration (recordVendorPrice)", () => {
  /**
   * Test: 4×5 LB case at $62.00 → normalizedPricePerCanonicalUnit = $3.10/LB
   *
   * This is the canonical example from the task spec and verifies:
   * 1. The geometry service receives casePrice ($62), NOT unitPrice ($3.10)
   * 2. normalizedPrice = casePrice / canonicalQty = 62 / 20 = 3.10 exactly
   * 3. No double-division occurs
   */
  it("4×5 LB case at $62 persists normalizedPricePerCanonicalUnit=$3.10/LB", async () => {
    const { unit } = await insertFixtures("pound");

    await db.insert(vendorItems).values({
      id: IDs.vendorItem4x5,
      vendorId: IDs.vendor,
      inventoryItemId: IDs.invItem,
      purchaseUnitId: unit.id,     // buying in LBs
      caseSize: 4,                 // 4 bags per case
      innerPackSize: 5,            // 5 LB per bag → 20 LB total
      packUom: "lb",
      lastPrice: 0,
      lastCasePrice: 0,
      active: 1,
    }).onConflictDoNothing();

    // Record a case price of $62 for this 20-LB case
    await recordVendorPrice({
      vendorItemId: IDs.vendorItem4x5,
      inventoryItemId: IDs.invItem,
      companyId: IDs.company,
      priceBasis: "case",
      price: 62,
      caseSize: 4,
      innerPackSize: 5,
      packUom: "lb",
      inventoryUnitName: "pound",  // matches the "pound" unit row in the DB
      source: "manual",
      representsActualPurchase: false,
    });

    const [saved] = await db
      .select()
      .from(vendorItems)
      .where(eq(vendorItems.id, IDs.vendorItem4x5))
      .limit(1);

    expect(saved).toBeTruthy();
    // canonicalQty = effectivePackQty(4, 5, "lb", "lb") = 4 × 5 = 20 LB
    expect(saved.canonicalQtyPerPurchaseUnit).toBeCloseTo(20, 4);
    // normalizedPrice = lastCasePrice / canonicalQty = 62 / 20 = 3.10
    expect(saved.normalizedPricePerCanonicalUnit).toBeCloseTo(3.10, 4);
    // Should NOT be 0.155 (which would result from double-dividing: 3.10/20)
    expect(saved.normalizedPricePerCanonicalUnit).toBeGreaterThan(1);
    expect(saved.packGeometryStatus).toBe("parsed");
  });

  /**
   * Test: price update recalculates normalized price correctly
   *
   * Verifies that a subsequent price write doesn't accumulate errors.
   */
  it("price update recalculates normalizedPricePerCanonicalUnit correctly", async () => {
    const { unit } = await insertFixtures("pound");

    await db.insert(vendorItems).values({
      id: IDs.vendorItem4x5,
      vendorId: IDs.vendor,
      inventoryItemId: IDs.invItem,
      purchaseUnitId: unit.id,
      caseSize: 10,
      innerPackSize: 1,
      packUom: "lb",
      lastPrice: 0,
      lastCasePrice: 0,
      active: 1,
    }).onConflictDoNothing();

    const priceArgs = {
      vendorItemId: IDs.vendorItem4x5,
      inventoryItemId: IDs.invItem,
      companyId: IDs.company,
      priceBasis: "case" as const,
      caseSize: 10,
      packUom: "lb",
      inventoryUnitName: "pound",  // matches the "pound" unit row in the DB
      source: "manual" as const,
      representsActualPurchase: false,
    };

    // First write: $50 → $5.00/LB
    await recordVendorPrice({ ...priceArgs, price: 50 });
    const [first] = await db.select().from(vendorItems).where(eq(vendorItems.id, IDs.vendorItem4x5)).limit(1);
    expect(first.normalizedPricePerCanonicalUnit).toBeCloseTo(5.0, 4);

    // Second write: $70 → $7.00/LB
    await recordVendorPrice({ ...priceArgs, price: 70 });
    const [second] = await db.select().from(vendorItems).where(eq(vendorItems.id, IDs.vendorItem4x5)).limit(1);
    expect(second.normalizedPricePerCanonicalUnit).toBeCloseTo(7.0, 4);

    // The canonical qty should be stable across price updates
    expect(first.canonicalQtyPerPurchaseUnit).toBe(second.canonicalQtyPerPurchaseUnit);
  });

  /**
   * Test: canonical-unit pricing — meat bought by the pound at $5.99/LB
   * pricingBasis = "canonical_unit" → canonicalQty = 1, normalized = $5.99
   * Verifies the basis branch in both recordVendorPrice and updateVendorItemPackGeometry.
   */
  it("canonical-unit pricing: $5.99/LB → normalizedPricePerCanonicalUnit=$5.99, canonicalQty=1", async () => {
    const { unit } = await insertFixtures("pound");

    await db.insert(vendorItems).values({
      id: IDs.vendorItem4x5,
      vendorId: IDs.vendor,
      inventoryItemId: IDs.invItem,
      purchaseUnitId: unit.id,
      caseSize: 1,                 // buying individual pounds
      innerPackSize: 1,
      packUom: "lb",
      pricingBasis: "canonical_unit", // price quoted per pound (canonical unit)
      lastPrice: 0,
      lastCasePrice: 0,
      active: 1,
    }).onConflictDoNothing();

    // Record $5.99/LB via the "unit" price basis
    await recordVendorPrice({
      vendorItemId: IDs.vendorItem4x5,
      inventoryItemId: IDs.invItem,
      companyId: IDs.company,
      priceBasis: "unit",
      price: 5.99,
      caseSize: 1,
      innerPackSize: 1,
      packUom: "lb",
      inventoryUnitName: "pound",
      source: "manual",
      representsActualPurchase: false,
    });

    const [saved] = await db
      .select()
      .from(vendorItems)
      .where(eq(vendorItems.id, IDs.vendorItem4x5))
      .limit(1);

    expect(saved).toBeTruthy();
    // canonical_unit basis → canonicalQty = 1, normalizedPrice = price per LB
    expect(saved.canonicalQtyPerPurchaseUnit).toBeCloseTo(1, 4);
    expect(saved.normalizedPricePerCanonicalUnit).toBeCloseTo(5.99, 4);
    // Must NOT be double-divided (e.g. 5.99 / 1 is fine, but 5.99 / 20 = 0.2995 would be wrong)
    expect(saved.normalizedPricePerCanonicalUnit).toBeGreaterThan(5);
    expect(saved.packGeometryStatus).toBe("verified"); // canonical_unit always returns "verified"
  });

  /**
   * Test: 30-count eggs at $9 → normalizedPricePerCanonicalUnit = $0.30/EA
   */
  it("30-count eggs at $9 persists normalizedPricePerCanonicalUnit=$0.30/EA", async () => {
    const { unit } = await insertFixtures("each");

    await db.insert(vendorItems).values({
      id: IDs.vendorItem30ct,
      vendorId: IDs.vendor,
      inventoryItemId: IDs.invItem,
      purchaseUnitId: unit.id,
      caseSize: 30,
      innerPackSize: 1,
      packUom: "ea",
      lastPrice: 0,
      lastCasePrice: 0,
      active: 1,
    }).onConflictDoNothing();

    await recordVendorPrice({
      vendorItemId: IDs.vendorItem30ct,
      inventoryItemId: IDs.invItem,
      companyId: IDs.company,
      priceBasis: "case",
      price: 9,
      caseSize: 30,
      packUom: "ea",
      inventoryUnitName: "each",
      source: "order_guide_import",
      representsActualPurchase: false,
    });

    const [saved] = await db
      .select()
      .from(vendorItems)
      .where(eq(vendorItems.id, IDs.vendorItem30ct))
      .limit(1);

    expect(saved.canonicalQtyPerPurchaseUnit).toBeCloseTo(30, 4);
    expect(saved.normalizedPricePerCanonicalUnit).toBeCloseTo(0.30, 4);
    expect(saved.packGeometryStatus).toBe("parsed");
    expect(saved.packGeometrySource).toBe("csv_order_guide");
  });
});
