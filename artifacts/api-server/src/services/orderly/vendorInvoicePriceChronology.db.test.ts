/**
 * Historical price chronology — DB integration test (Task #1178, plan step 5).
 *
 * Required scenario: importing a May invoice AFTER an August price exists must
 *   - retain the May observation in price history (effectiveAt = invoice date)
 *   - leave the August price as the CURRENT vendor price (no regression)
 *
 * Also proves the forward direction: an observation newer than the current
 * pricedAt updates the current price and stamps pricedAt to the business date.
 */
import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  companies,
  inventoryItems,
  vendors,
  vendorItems,
  inventoryItemPriceHistory,
} from "@workspace/db";
import { recordVendorPrice } from "../vendorPriceService";

const POUND_UNIT_ID = "78e1a58e-8789-4581-9ef4-333032435678";
const PREFIX = "inttest-chrono-";
const TEST_COMPANY_ID = `${PREFIX}company-001`;
const TEST_INV_ITEM_ID = `${PREFIX}inv-item-001`;
const TEST_VENDOR_ID = `${PREFIX}vendor-001`;
const TEST_VI_ID = `${PREFIX}vi-001`;

const AUGUST_PRICED_AT = new Date("2026-08-10T12:00:00Z");
const AUGUST_CASE_PRICE = 42.5;
const MAY_EFFECTIVE_AT = new Date("2026-05-01T12:00:00Z");
const MAY_CASE_PRICE = 38.75;

async function insertFixtures() {
  await db.insert(companies).values({
    id: TEST_COMPANY_ID,
    name: "Chronology Test Co",
    country: "US",
    timezone: "America/New_York",
    preferredUnitSystem: "imperial",
    costingMethod: "last_cost",
    status: "active",
  }).onConflictDoNothing();
  await db.insert(inventoryItems).values({
    id: TEST_INV_ITEM_ID,
    companyId: TEST_COMPANY_ID,
    name: "Chronology Coffee",
    unitId: POUND_UNIT_ID,
    caseSize: 1,
    pricePerUnit: AUGUST_CASE_PRICE,
    avgCostPerUnit: AUGUST_CASE_PRICE,
    yieldPercent: 100,
    active: 1,
  }).onConflictDoNothing();
  await db.insert(vendors).values({
    id: TEST_VENDOR_ID,
    companyId: TEST_COMPANY_ID,
    name: "Chronology Vendor",
    orderGuideType: "manual",
    active: 1,
    receiveByUnit: 0,
    requires1099: 0,
  }).onConflictDoNothing();
  // Vendor item already priced in August (the "newer price exists" premise).
  await db.insert(vendorItems).values({
    id: TEST_VI_ID,
    vendorId: TEST_VENDOR_ID,
    inventoryItemId: TEST_INV_ITEM_ID,
    purchaseUnitId: POUND_UNIT_ID,
    caseSize: 1,
    innerPackSize: 1,
    packUom: "lb",
    lastPrice: AUGUST_CASE_PRICE,
    lastCasePrice: AUGUST_CASE_PRICE,
    priceSource: "invoice_scan",
    pricedAt: AUGUST_PRICED_AT,
    active: 1,
  }).onConflictDoNothing();
}

async function deleteFixtures() {
  await db.delete(inventoryItemPriceHistory)
    .where(eq(inventoryItemPriceHistory.inventoryItemId, TEST_INV_ITEM_ID));
  await db.delete(vendorItems).where(eq(vendorItems.id, TEST_VI_ID));
  await db.delete(vendors).where(eq(vendors.id, TEST_VENDOR_ID));
  await db.delete(inventoryItems).where(eq(inventoryItems.id, TEST_INV_ITEM_ID));
  await db.delete(companies).where(eq(companies.id, TEST_COMPANY_ID));
}

describe("Historical invoice price chronology", () => {
  afterEach(deleteFixtures);

  it("May observation after August price: May lands in history, August stays current", async () => {
    await insertFixtures();

    await recordVendorPrice({
      vendorItemId: TEST_VI_ID,
      inventoryItemId: TEST_INV_ITEM_ID,
      companyId: TEST_COMPANY_ID,
      priceBasis: "case",
      price: MAY_CASE_PRICE,
      caseSize: 1,
      innerPackSize: 1,
      packUom: "lb",
      inventoryUnitName: "pound",
      source: "historical_invoice_import",
      representsActualPurchase: true,
      referenceId: "chrono-test-may",
      effectiveAt: MAY_EFFECTIVE_AT,
    });

    // Current vendor price must be untouched (August remains current).
    const [vi] = await db.select().from(vendorItems).where(eq(vendorItems.id, TEST_VI_ID));
    expect(vi.lastCasePrice).toBeCloseTo(AUGUST_CASE_PRICE, 6);
    expect(vi.lastPrice).toBeCloseTo(AUGUST_CASE_PRICE, 6);
    expect(vi.pricedAt?.toISOString()).toBe(AUGUST_PRICED_AT.toISOString());
    expect(vi.priceSource).toBe("invoice_scan");

    // Inventory cost must be untouched.
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, TEST_INV_ITEM_ID));
    expect(item.pricePerUnit).toBeCloseTo(AUGUST_CASE_PRICE, 6);
    expect(item.avgCostPerUnit).toBeCloseTo(AUGUST_CASE_PRICE, 6);

    // History must retain the May observation at the invoice date.
    const history = await db.select().from(inventoryItemPriceHistory)
      .where(eq(inventoryItemPriceHistory.inventoryItemId, TEST_INV_ITEM_ID));
    expect(history).toHaveLength(1);
    expect(history[0].source).toBe("historical_invoice_import");
    expect(history[0].vendorItemId).toBe(TEST_VI_ID);
    expect(history[0].pricePerUnit).toBeCloseTo(MAY_CASE_PRICE, 6);
    expect(history[0].casePrice).toBeCloseTo(MAY_CASE_PRICE, 6);
    expect(history[0].effectiveAt.toISOString()).toBe(MAY_EFFECTIVE_AT.toISOString());
  });

  it("observation newer than current pricedAt becomes the current price", async () => {
    await insertFixtures();
    const SEPT = new Date("2026-09-02T12:00:00Z");
    const SEPT_PRICE = 45.0;

    await recordVendorPrice({
      vendorItemId: TEST_VI_ID,
      inventoryItemId: TEST_INV_ITEM_ID,
      companyId: TEST_COMPANY_ID,
      priceBasis: "case",
      price: SEPT_PRICE,
      caseSize: 1,
      innerPackSize: 1,
      packUom: "lb",
      inventoryUnitName: "pound",
      source: "historical_invoice_import",
      representsActualPurchase: true,
      effectiveAt: SEPT,
    });

    const [vi] = await db.select().from(vendorItems).where(eq(vendorItems.id, TEST_VI_ID));
    expect(vi.lastCasePrice).toBeCloseTo(SEPT_PRICE, 6);
    expect(vi.priceSource).toBe("historical_invoice_import");
    expect(vi.pricedAt?.toISOString()).toBe(SEPT.toISOString());

    const history = await db.select().from(inventoryItemPriceHistory)
      .where(eq(inventoryItemPriceHistory.inventoryItemId, TEST_INV_ITEM_ID));
    expect(history).toHaveLength(1);
    expect(history[0].effectiveAt.toISOString()).toBe(SEPT.toISOString());
  });
});
