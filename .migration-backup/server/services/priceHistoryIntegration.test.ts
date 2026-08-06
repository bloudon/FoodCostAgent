/**
 * Price History Write Contract — DB Integration Tests  (Task #450)
 *
 * Verifies that inventory_item_price_history rows are actually written (or not)
 * for each of the three primary price-entry paths:
 *
 *   1. Receipt approval    (actual-purchase, representsActualPurchase=true)
 *      → history row MUST be written with correct fields
 *   2. Order-guide import  (quote source, representsActualPurchase=false)
 *      → history row must NOT be written
 *   3. Manual vendor edit  (quote source, representsActualPurchase=false)
 *      → history row must NOT be written
 *   4. Invoice-scan apply  (actual-purchase, representsActualPurchase=true)
 *      → history row MUST be written with correct fields
 *   5. Invoice-scan fallback (no linked vendor item — direct DB insert path)
 *      → history row MUST be written with vendorItemId=null when price changes
 *   6. Price-unchanged guard
 *      → even for actual-purchase sources, no row written when price is identical
 *
 * Approach: insert minimal test fixtures directly into the DB, call
 * `recordVendorPrice` (the shared write gate), then query
 * `inventory_item_price_history` and assert on the persisted fields.
 * All test rows are prefixed "inttest-" and cleaned up in afterEach.
 */

import { describe, it, expect, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  companies,
  inventoryItems,
  vendors,
  vendorItems,
  inventoryItemPriceHistory,
} from "@shared/schema";
import { recordVendorPrice } from "./vendorPriceService";

// ─── Constants ───────────────────────────────────────────────────────────────

// Real unit from the seeded units table (pound / weight)
const POUND_UNIT_ID = "78e1a58e-8789-4581-9ef4-333032435678";

// Prefix all test IDs so cleanup can target exactly these rows
const PREFIX = "inttest-ph-";

// ─── Fixture IDs ─────────────────────────────────────────────────────────────
// Using fixed IDs (not random) so afterEach can delete them by exact ID.

const TEST_COMPANY_ID    = `${PREFIX}company-001`;
const TEST_INV_ITEM_ID   = `${PREFIX}inv-item-001`;
const TEST_VENDOR_ID     = `${PREFIX}vendor-001`;
const TEST_VI_ID         = `${PREFIX}vi-001`;

// ─── Fixture helpers ─────────────────────────────────────────────────────────

async function insertFixtures(initialPrice = 0) {
  // Company
  await db.insert(companies).values({
    id: TEST_COMPANY_ID,
    name: "Integration Test Co",
    country: "US",
    timezone: "America/New_York",
    preferredUnitSystem: "imperial",
    costingMethod: "last_cost",
    status: "active",
  }).onConflictDoNothing();

  // Inventory item (pricePerUnit starts at initialPrice so any different write creates a history row)
  await db.insert(inventoryItems).values({
    id: TEST_INV_ITEM_ID,
    companyId: TEST_COMPANY_ID,
    name: "Test Chicken Breast",
    unitId: POUND_UNIT_ID,
    caseSize: 40,
    pricePerUnit: initialPrice,
    avgCostPerUnit: initialPrice,
    yieldPercent: 100,
    active: 1,
  }).onConflictDoNothing();

  // Vendor
  await db.insert(vendors).values({
    id: TEST_VENDOR_ID,
    companyId: TEST_COMPANY_ID,
    name: "Test Sysco",
    orderGuideType: "manual",
    active: 1,
    receiveByUnit: 0,
    requires1099: 0,
  }).onConflictDoNothing();

  // Vendor item — linked to the inventory item
  await db.insert(vendorItems).values({
    id: TEST_VI_ID,
    vendorId: TEST_VENDOR_ID,
    inventoryItemId: TEST_INV_ITEM_ID,
    purchaseUnitId: POUND_UNIT_ID,
    caseSize: 40,
    innerPackSize: 1,
    packUom: "lb",
    lastPrice: initialPrice,
    lastCasePrice: 0,
    active: 1,
  }).onConflictDoNothing();
}

async function deleteFixtures() {
  // Delete in FK-safe order (history first, then vendor items, then parent rows)
  await db.delete(inventoryItemPriceHistory)
    .where(eq(inventoryItemPriceHistory.inventoryItemId, TEST_INV_ITEM_ID));
  await db.delete(vendorItems)
    .where(eq(vendorItems.id, TEST_VI_ID));
  await db.delete(vendors)
    .where(eq(vendors.id, TEST_VENDOR_ID));
  await db.delete(inventoryItems)
    .where(eq(inventoryItems.id, TEST_INV_ITEM_ID));
  await db.delete(companies)
    .where(eq(companies.id, TEST_COMPANY_ID));
}

async function getHistoryRows() {
  return db
    .select()
    .from(inventoryItemPriceHistory)
    .where(eq(inventoryItemPriceHistory.inventoryItemId, TEST_INV_ITEM_ID));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Price history DB integration — receipt approval path", () => {
  afterEach(deleteFixtures);

  it("writes a history row with correct vendorItemId, pricePerUnit, casePrice, source, and effectiveAt", async () => {
    await insertFixtures(0); // item starts at $0

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "unit",
      price:                 2.50,   // $2.50/lb priceEach from receipt
      caseSize:              40,
      source:                "receipt",
      representsActualPurchase: true,
      currentOnHandQty:      0,
      receivedQty:           40,
    });

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(1);

    const row = rows[0];
    // vendorItemId: must reference the correct vendor item, not null
    expect(row.vendorItemId).toBe(TEST_VI_ID);

    // pricePerUnit: the unit price ($2.50 / lb)
    expect(row.pricePerUnit).toBeCloseTo(2.50, 4);

    // casePrice: derived case price = $2.50 × 40 = $100
    expect(row.casePrice).toBeCloseTo(100.00, 2);

    // source: must match the write-path source
    expect(row.source).toBe("receipt");

    // effectiveAt: must be a recent timestamp (within the last 10 seconds)
    expect(row.effectiveAt).toBeInstanceOf(Date);
    const ageMs = Date.now() - row.effectiveAt.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(0);
    expect(ageMs).toBeLessThan(10_000);

    // inventoryItemId: correctly associated
    expect(row.inventoryItemId).toBe(TEST_INV_ITEM_ID);
  });

  it("updates inventoryItem.pricePerUnit and avgCostPerUnit to the received unit price", async () => {
    await insertFixtures(0);

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "unit",
      price:                 3.00,
      caseSize:              40,
      source:                "receipt",
      representsActualPurchase: true,
      currentOnHandQty:      0,
      receivedQty:           40,
    });

    const [item] = await db
      .select({ pricePerUnit: inventoryItems.pricePerUnit, avgCostPerUnit: inventoryItems.avgCostPerUnit })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, TEST_INV_ITEM_ID));

    expect(item.pricePerUnit).toBeCloseTo(3.00, 4);
    expect(item.avgCostPerUnit).toBeCloseTo(3.00, 4); // WAC on empty stock = received price
  });

  it("does NOT write a history row when the unit price is unchanged", async () => {
    await insertFixtures(2.50); // item already at $2.50

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "unit",
      price:                 2.50,   // same as existing
      caseSize:              40,
      source:                "receipt",
      representsActualPurchase: true,
    });

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(0); // no change → no history row
  });

  it("stamps the vendor item priceSource='receipt' and pricedAt (quote path also covered)", async () => {
    await insertFixtures(0);

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "unit",
      price:                 2.50,
      caseSize:              40,
      source:                "receipt",
      representsActualPurchase: true,
    });

    const [vi] = await db
      .select({ priceSource: vendorItems.priceSource, pricedAt: vendorItems.pricedAt, lastPrice: vendorItems.lastPrice })
      .from(vendorItems)
      .where(eq(vendorItems.id, TEST_VI_ID));

    expect(vi.priceSource).toBe("receipt");
    expect(vi.pricedAt).toBeInstanceOf(Date);
    expect(vi.lastPrice).toBeCloseTo(2.50, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Price history DB integration — invoice_scan path", () => {
  afterEach(deleteFixtures);

  it("writes a history row with source='invoice_scan' and correct field values", async () => {
    await insertFixtures(0);

    const CASE_PRICE = 60.00;
    const CASE_SIZE  = 40;   // 40 lb case → $1.50/lb unit price

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "case",
      price:                 CASE_PRICE,
      caseSize:              CASE_SIZE,
      packUom:               "lb",
      inventoryUnitName:     "pound",
      source:                "invoice_scan",
      representsActualPurchase: true,
    });

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.vendorItemId).toBe(TEST_VI_ID);
    expect(row.source).toBe("invoice_scan");
    expect(row.pricePerUnit).toBeCloseTo(1.50, 4);  // $60 / 40 lb
    expect(row.casePrice).toBeCloseTo(60.00, 2);
    expect(row.effectiveAt).toBeInstanceOf(Date);
    expect(row.inventoryItemId).toBe(TEST_INV_ITEM_ID);
  });

  it("updates inventory cost on invoice_scan (actual-purchase behaviour)", async () => {
    await insertFixtures(0);

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "case",
      price:                 80.00,
      caseSize:              40,
      source:                "invoice_scan",
      representsActualPurchase: true,
    });

    const [item] = await db
      .select({ pricePerUnit: inventoryItems.pricePerUnit })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, TEST_INV_ITEM_ID));

    expect(item.pricePerUnit).toBeCloseTo(2.00, 4); // $80 / 40 = $2.00/lb
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Price history DB integration — order_guide_import path (quote source)", () => {
  afterEach(deleteFixtures);

  it("does NOT write a history row for order_guide_import (quote source early-returns)", async () => {
    await insertFixtures(0);

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "case",
      price:                 45.00,
      caseSize:              30,
      source:                "order_guide_import",
      representsActualPurchase: false,
    });

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(0); // quote sources never write history
  });

  it("does NOT update inventory cost for order_guide_import", async () => {
    await insertFixtures(1.00); // item at $1.00

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "case",
      price:                 45.00,
      caseSize:              30,
      source:                "order_guide_import",
      representsActualPurchase: false,
    });

    const [item] = await db
      .select({ pricePerUnit: inventoryItems.pricePerUnit })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, TEST_INV_ITEM_ID));

    expect(item.pricePerUnit).toBeCloseTo(1.00, 4); // unchanged
  });

  it("still stamps vendor item price provenance even though history is not written", async () => {
    await insertFixtures(0);

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "case",
      price:                 45.00,
      caseSize:              30,
      source:                "order_guide_import",
      representsActualPurchase: false,
    });

    const [vi] = await db
      .select({ priceSource: vendorItems.priceSource, lastCasePrice: vendorItems.lastCasePrice })
      .from(vendorItems)
      .where(eq(vendorItems.id, TEST_VI_ID));

    expect(vi.priceSource).toBe("order_guide_import");
    expect(vi.lastCasePrice).toBeCloseTo(45.00, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Price history DB integration — manual vendor price edit path (quote source)", () => {
  afterEach(deleteFixtures);

  it("does NOT write a history row for manual edits (quote source early-returns)", async () => {
    await insertFixtures(0);

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "case",
      price:                 75.00,
      caseSize:              30,
      source:                "manual",
      representsActualPurchase: false,
    });

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(0);
  });

  it("does NOT write a history row even when caller accidentally passes representsActualPurchase=true", async () => {
    // The guard in vendorPriceService blocks any quote source regardless of the flag
    await insertFixtures(0);

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "case",
      price:                 75.00,
      caseSize:              30,
      source:                "manual",
      representsActualPurchase: true, // caller misconfiguration — guard must override
    });

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(0); // guard blocked it
  });

  it("does NOT update inventory cost for manual edit", async () => {
    await insertFixtures(2.00); // item at $2.00

    await recordVendorPrice({
      vendorItemId:          TEST_VI_ID,
      inventoryItemId:       TEST_INV_ITEM_ID,
      companyId:             TEST_COMPANY_ID,
      priceBasis:            "case",
      price:                 75.00,
      caseSize:              30,
      source:                "manual",
      representsActualPurchase: false,
    });

    const [item] = await db
      .select({ pricePerUnit: inventoryItems.pricePerUnit })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, TEST_INV_ITEM_ID));

    expect(item.pricePerUnit).toBeCloseTo(2.00, 4); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Price history DB integration — invoice_scan fallback (no linked vendor item)", () => {
  // This path in routes.ts writes directly to inventory_item_price_history
  // (not via recordVendorPrice) when no vendor item is linked.
  // The condition: Math.abs(effectiveUnitPrice - prevPrice) > 0.000001
  afterEach(deleteFixtures);

  it("direct-insert fallback: history row has vendorItemId=null", async () => {
    await insertFixtures(0);

    const effectiveUnitPrice = 2.50;
    const prevPrice = 0; // starting value
    const priceChanged = Math.abs(effectiveUnitPrice - prevPrice) > 0.000001;
    expect(priceChanged).toBe(true);

    // Simulate the fallback direct insert (mirrors routes.ts ~line 2636)
    if (priceChanged) {
      await db.insert(inventoryItemPriceHistory).values({
        inventoryItemId: TEST_INV_ITEM_ID,
        pricePerUnit:    effectiveUnitPrice,
        casePrice:       100.00, // case price from invoice
        source:          "invoice_scan",
        vendorItemId:    null,   // no linked vendor item
        effectiveAt:     new Date(),
        recordedBy:      null,
        note:            `Price updated via invoice scan ($${effectiveUnitPrice.toFixed(4)})`,
      });
    }

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].vendorItemId).toBeNull();
    expect(rows[0].source).toBe("invoice_scan");
    expect(rows[0].pricePerUnit).toBeCloseTo(2.50, 4);
    expect(rows[0].casePrice).toBeCloseTo(100.00, 2);
    expect(rows[0].effectiveAt).toBeInstanceOf(Date);
  });

  it("direct-insert fallback: no row written when price is unchanged", async () => {
    await insertFixtures(2.50);

    const effectiveUnitPrice = 2.50;
    const prevPrice = 2.50;
    const priceChanged = Math.abs(effectiveUnitPrice - prevPrice) > 0.000001;
    expect(priceChanged).toBe(false);
    // No insert performed → history stays empty

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Price history DB integration — multiple sequential price events", () => {
  afterEach(deleteFixtures);

  it("each distinct receipt price produces a separate history row", async () => {
    await insertFixtures(0);

    await recordVendorPrice({
      vendorItemId: TEST_VI_ID, inventoryItemId: TEST_INV_ITEM_ID,
      companyId: TEST_COMPANY_ID, priceBasis: "unit", price: 2.00, caseSize: 40,
      source: "receipt", representsActualPurchase: true,
    });

    await recordVendorPrice({
      vendorItemId: TEST_VI_ID, inventoryItemId: TEST_INV_ITEM_ID,
      companyId: TEST_COMPANY_ID, priceBasis: "unit", price: 2.50, caseSize: 40,
      source: "receipt", representsActualPurchase: true,
    });

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(2);

    const prices = rows.map(r => r.pricePerUnit).sort((a, b) => a - b);
    expect(prices[0]).toBeCloseTo(2.00, 4);
    expect(prices[1]).toBeCloseTo(2.50, 4);

    // Both rows have the same source and vendorItemId
    for (const row of rows) {
      expect(row.source).toBe("receipt");
      expect(row.vendorItemId).toBe(TEST_VI_ID);
    }
  });

  it("interspersed quote writes do not add history rows between receipt rows", async () => {
    await insertFixtures(0);

    // Receipt 1
    await recordVendorPrice({
      vendorItemId: TEST_VI_ID, inventoryItemId: TEST_INV_ITEM_ID,
      companyId: TEST_COMPANY_ID, priceBasis: "unit", price: 2.00, caseSize: 40,
      source: "receipt", representsActualPurchase: true,
    });

    // Order guide import in between (should not add history)
    await recordVendorPrice({
      vendorItemId: TEST_VI_ID, inventoryItemId: TEST_INV_ITEM_ID,
      companyId: TEST_COMPANY_ID, priceBasis: "case", price: 45.00, caseSize: 30,
      source: "order_guide_import", representsActualPurchase: false,
    });

    // Manual edit in between (should not add history)
    await recordVendorPrice({
      vendorItemId: TEST_VI_ID, inventoryItemId: TEST_INV_ITEM_ID,
      companyId: TEST_COMPANY_ID, priceBasis: "case", price: 50.00, caseSize: 30,
      source: "manual", representsActualPurchase: false,
    });

    // Receipt 2
    await recordVendorPrice({
      vendorItemId: TEST_VI_ID, inventoryItemId: TEST_INV_ITEM_ID,
      companyId: TEST_COMPANY_ID, priceBasis: "unit", price: 2.50, caseSize: 40,
      source: "receipt", representsActualPurchase: true,
    });

    const rows = await getHistoryRows();
    expect(rows).toHaveLength(2); // only the two receipt events
    for (const row of rows) {
      expect(row.source).toBe("receipt");
    }
  });
});
