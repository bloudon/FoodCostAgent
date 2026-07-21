/**
 * M3B — Routing: DB Integration Tests
 *
 * Verifies the database-level contracts for the vendor routing feature:
 *
 *   1. Tenant isolation — storage.getPurchaseOrder(poId, wrongCompanyId) returns
 *      undefined while the PO exists for the correct company, which is exactly
 *      the condition that causes the route to return 403 ("Access denied").
 *
 *   2. DB-backed idempotency — inserting a po_routing_audit row creates a unique
 *      (sourcePOLineId, vendorItemId) entry; querying it back by that key returns
 *      the existing audit so a second routing call can skip re-routing.
 *
 *   3. Savings snapshot persistence — the projectedSavingsPerCase field is stored
 *      correctly using the formula (fromUnitPrice - toUnitPrice) × toCaseSize.
 *
 * Pattern: insert minimal fixtures directly into the DB, invoke storage methods
 * or direct queries that mirror route endpoint behaviour, then assert on persisted
 * state.  All test rows use the "inttest-m3b-" prefix and are removed in afterEach.
 */

import { describe, it, expect, afterEach } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  companies,
  companyStores,
  vendors,
  inventoryItems,
  vendorItems,
  purchaseOrders,
  poLines,
  poRoutingAudit,
} from "@shared/schema";
import { storage } from "../storage";
import { routingIdempotencyKey, isAlreadyRouted, computeProjectedSavingsPerCase } from "./routingService";

// ─── Fixture constants ────────────────────────────────────────────────────────

const PREFIX = "inttest-m3bint-";
const POUND_UNIT_ID = "78e1a58e-8789-4581-9ef4-333032435678";

const COMPANY_A_ID  = `${PREFIX}co-A`;
const COMPANY_B_ID  = `${PREFIX}co-B`;
const STORE_A_ID    = `${PREFIX}store-A`;
const VENDOR_A_ID   = `${PREFIX}vendor-A`;
const VENDOR_B_ID   = `${PREFIX}vendor-B`;
const INV_ITEM_ID   = `${PREFIX}inv-item`;
const VI_A_ID       = `${PREFIX}vi-A`;
const VI_B_ID       = `${PREFIX}vi-B`;
const PO_A_ID       = `${PREFIX}po-A`;
const PO_B_ID       = `${PREFIX}po-B`;
const PO_LINE_ID    = `${PREFIX}po-line`;
const AUDIT_ROW_ID  = `${PREFIX}audit`;

// ─── Fixture helpers ──────────────────────────────────────────────────────────

async function insertBaseFixtures() {
  // Company A — the owner of the test PO
  await db.insert(companies).values({
    id: COMPANY_A_ID,
    name: "M3B Int Test — Company A",
    country: "US",
    timezone: "America/New_York",
    preferredUnitSystem: "imperial",
    costingMethod: "last_cost",
    status: "active",
  }).onConflictDoNothing();

  // Company B — the "attacker" in tenant-isolation tests
  await db.insert(companies).values({
    id: COMPANY_B_ID,
    name: "M3B Int Test — Company B",
    country: "US",
    timezone: "America/New_York",
    preferredUnitSystem: "imperial",
    costingMethod: "last_cost",
    status: "active",
  }).onConflictDoNothing();

  // Store owned by Company A
  await db.insert(companyStores).values({
    id: STORE_A_ID,
    companyId: COMPANY_A_ID,
    code: "M3B-S01",
    name: "M3B Int Test Store A",
    status: "active",
  }).onConflictDoNothing();

  // Vendors for Company A
  await db.insert(vendors).values({
    id: VENDOR_A_ID,
    companyId: COMPANY_A_ID,
    name: "M3B Source Vendor",
    orderGuideType: "manual",
    active: 1,
    receiveByUnit: 0,
    requires1099: 0,
  }).onConflictDoNothing();

  await db.insert(vendors).values({
    id: VENDOR_B_ID,
    companyId: COMPANY_A_ID,
    name: "M3B Target Vendor",
    orderGuideType: "manual",
    active: 1,
    receiveByUnit: 0,
    requires1099: 0,
  }).onConflictDoNothing();

  // Inventory item shared by both vendor items
  await db.insert(inventoryItems).values({
    id: INV_ITEM_ID,
    companyId: COMPANY_A_ID,
    name: "M3B Test Chicken Breast",
    unitId: POUND_UNIT_ID,
    caseSize: 40,
    pricePerUnit: 3.00,
    avgCostPerUnit: 3.00,
    yieldPercent: 100,
    active: 1,
  }).onConflictDoNothing();

  // Vendor item for source vendor (Company A, Vendor A)
  await db.insert(vendorItems).values({
    id: VI_A_ID,
    vendorId: VENDOR_A_ID,
    inventoryItemId: INV_ITEM_ID,
    purchaseUnitId: POUND_UNIT_ID,
    caseSize: 40,
    innerPackSize: 1,
    packUom: "lb",
    lastPrice: 3.00,
    lastCasePrice: 120.00,
    priceSource: "receipt",
    pricedAt: new Date(Date.now() - 2 * 86_400_000), // 2 days ago — fresh
    active: 1,
  }).onConflictDoNothing();

  // Vendor item for target vendor (Company A, Vendor B) — cheaper
  await db.insert(vendorItems).values({
    id: VI_B_ID,
    vendorId: VENDOR_B_ID,
    inventoryItemId: INV_ITEM_ID,
    purchaseUnitId: POUND_UNIT_ID,
    caseSize: 40,
    innerPackSize: 1,
    packUom: "lb",
    lastPrice: 2.50,
    lastCasePrice: 100.00,
    priceSource: "receipt",
    pricedAt: new Date(Date.now() - 3 * 86_400_000), // 3 days ago — fresh
    active: 1,
  }).onConflictDoNothing();

  // Source PO owned by Company A (from Vendor A)
  await db.insert(purchaseOrders).values({
    id: PO_A_ID,
    companyId: COMPANY_A_ID,
    storeId: STORE_A_ID,
    vendorId: VENDOR_A_ID,
    status: "pending",
    expectedDate: new Date(Date.now() + 7 * 86_400_000),
  }).onConflictDoNothing();

  // Destination PO (Vendor B) for idempotency tests
  await db.insert(purchaseOrders).values({
    id: PO_B_ID,
    companyId: COMPANY_A_ID,
    storeId: STORE_A_ID,
    vendorId: VENDOR_B_ID,
    status: "pending",
    expectedDate: new Date(Date.now() + 7 * 86_400_000),
  }).onConflictDoNothing();

  // PO line on the source PO
  await db.insert(poLines).values({
    id: PO_LINE_ID,
    purchaseOrderId: PO_A_ID,
    vendorItemId: VI_A_ID,
    orderedQty: 5,
    caseQuantity: 5,
    unitId: POUND_UNIT_ID,
    priceEach: 3.00,
  }).onConflictDoNothing();
}

async function deleteAllFixtures() {
  await db.delete(poRoutingAudit).where(eq(poRoutingAudit.id, AUDIT_ROW_ID));
  await db.delete(poLines).where(eq(poLines.id, PO_LINE_ID));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, PO_A_ID));
  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, PO_B_ID));
  await db.delete(vendorItems).where(eq(vendorItems.id, VI_A_ID));
  await db.delete(vendorItems).where(eq(vendorItems.id, VI_B_ID));
  await db.delete(inventoryItems).where(eq(inventoryItems.id, INV_ITEM_ID));
  await db.delete(vendors).where(eq(vendors.id, VENDOR_A_ID));
  await db.delete(vendors).where(eq(vendors.id, VENDOR_B_ID));
  await db.delete(companyStores).where(eq(companyStores.id, STORE_A_ID));
  await db.delete(companies).where(eq(companies.id, COMPANY_A_ID));
  await db.delete(companies).where(eq(companies.id, COMPANY_B_ID));
}

// ─── Helper: insert one audit row ────────────────────────────────────────────

async function insertAuditRow({
  fromUnitPrice,
  toUnitPrice,
  toCaseSize,
}: {
  fromUnitPrice: number;
  toUnitPrice: number;
  toCaseSize: number;
}) {
  const projectedSavingsPerCase = computeProjectedSavingsPerCase(fromUnitPrice, toUnitPrice, toCaseSize);
  await db.insert(poRoutingAudit).values({
    id: AUDIT_ROW_ID,
    companyId: COMPANY_A_ID,
    sourcePoId: PO_A_ID,
    sourcePOLineId: PO_LINE_ID,
    destinationPoId: PO_B_ID,
    vendorItemId: VI_B_ID,
    inventoryItemId: INV_ITEM_ID,
    userId: null,
    fromUnitPrice,
    toUnitPrice,
    fromCasePrice: fromUnitPrice * toCaseSize,
    toCasePrice: toUnitPrice * toCaseSize,
    orderedQty: 5,
    projectedSavingsPerCase,
  }).onConflictDoNothing();
  return projectedSavingsPerCase;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("DB integration — tenant isolation (routing 403 gate)", () => {
  afterEach(deleteAllFixtures);

  it("storage.getPurchaseOrder returns undefined for wrong companyId (cross-company request)", async () => {
    await insertBaseFixtures();

    // storage.getPurchaseOrder does: SELECT WHERE id = ? AND company_id = ?
    // Company B tries to access Company A's PO → must be undefined
    const po = await storage.getPurchaseOrder(PO_A_ID, COMPANY_B_ID);
    expect(po).toBeUndefined();
  });

  it("storage.getPurchaseOrder returns the PO for the correct owner company", async () => {
    await insertBaseFixtures();

    // Company A accesses its own PO → must be found
    const po = await storage.getPurchaseOrder(PO_A_ID, COMPANY_A_ID);
    expect(po).toBeDefined();
    expect(po?.id).toBe(PO_A_ID);
    expect(po?.companyId).toBe(COMPANY_A_ID);
    expect(po?.status).toBe("pending");
  });

  it("PO exists for company A but not company B — proves route returns 403 not 404", async () => {
    await insertBaseFixtures();

    // Route endpoint logic:
    // 1. storage.getPurchaseOrder(poId, companyBId) → undefined (cross-company)
    // 2. db.select from purchaseOrders where id = poId → finds row → 403

    const poFromB = await storage.getPurchaseOrder(PO_A_ID, COMPANY_B_ID);
    expect(poFromB).toBeUndefined(); // tenant isolation holds

    // Cross-company existence check (no company filter)
    const [anyPo] = await db
      .select({ id: purchaseOrders.id, companyId: purchaseOrders.companyId })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, PO_A_ID))
      .limit(1);

    // PO exists → route would return 403 ("Access denied"), not 404 ("not found")
    expect(anyPo).toBeDefined();
    expect(anyPo?.companyId).toBe(COMPANY_A_ID);
  });

  it("company B has no POs — cross-company access on any ID returns undefined (not 403)", async () => {
    await insertBaseFixtures();

    // If a completely unknown PO ID is used, neither the company-scoped nor
    // the any-company query finds a row → route returns 404.
    const unknownPoId = `${PREFIX}po-does-not-exist`;
    const poFromB = await storage.getPurchaseOrder(unknownPoId, COMPANY_B_ID);
    expect(poFromB).toBeUndefined();

    const [anyPo] = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, unknownPoId))
      .limit(1);

    // No row found anywhere → route would return 404, not 403
    expect(anyPo).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DB-backed idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("DB integration — idempotency (second routing call returns prior audit)", () => {
  afterEach(deleteAllFixtures);

  it("querying audit by sourcePOLineId+companyId finds the existing row", async () => {
    await insertBaseFixtures();
    await insertAuditRow({ fromUnitPrice: 3.00, toUnitPrice: 2.50, toCaseSize: 40 });

    // This mirrors the pre-transaction idempotency check in the route endpoint:
    // SELECT FROM po_routing_audit WHERE sourcePOLineId IN [...] AND companyId = ?
    const existingAudits = await db
      .select()
      .from(poRoutingAudit)
      .where(
        and(
          inArray(poRoutingAudit.sourcePOLineId, [PO_LINE_ID]),
          eq(poRoutingAudit.companyId, COMPANY_A_ID)
        )
      );

    expect(existingAudits).toHaveLength(1);
    expect(existingAudits[0].sourcePOLineId).toBe(PO_LINE_ID);
    expect(existingAudits[0].vendorItemId).toBe(VI_B_ID);
  });

  it("isAlreadyRouted returns true when audit row exists for the same (poLineId, vendorItemId) pair", async () => {
    await insertBaseFixtures();
    await insertAuditRow({ fromUnitPrice: 3.00, toUnitPrice: 2.50, toCaseSize: 40 });

    // Build the alreadyRoutedLookup Map exactly as the route endpoint does
    const existingAudits = await db
      .select()
      .from(poRoutingAudit)
      .where(
        and(
          inArray(poRoutingAudit.sourcePOLineId, [PO_LINE_ID]),
          eq(poRoutingAudit.companyId, COMPANY_A_ID)
        )
      );

    const alreadyRoutedLookup = new Map(
      existingAudits.map(a => [routingIdempotencyKey(a.sourcePOLineId, a.vendorItemId), a])
    );

    // Same pair → already routed
    expect(isAlreadyRouted(alreadyRoutedLookup, PO_LINE_ID, VI_B_ID)).toBe(true);

    // Different targetVendorItemId → not already routed
    expect(isAlreadyRouted(alreadyRoutedLookup, PO_LINE_ID, VI_A_ID)).toBe(false);

    // Different poLineId → not already routed
    expect(isAlreadyRouted(alreadyRoutedLookup, `${PREFIX}other-line`, VI_B_ID)).toBe(false);
  });

  it("prior audit row contains the destinationPoId — returned to caller on idempotent request", async () => {
    await insertBaseFixtures();
    await insertAuditRow({ fromUnitPrice: 3.00, toUnitPrice: 2.50, toCaseSize: 40 });

    const existingAudits = await db
      .select()
      .from(poRoutingAudit)
      .where(
        and(
          inArray(poRoutingAudit.sourcePOLineId, [PO_LINE_ID]),
          eq(poRoutingAudit.companyId, COMPANY_A_ID)
        )
      );

    const alreadyRoutedLookup = new Map(
      existingAudits.map(a => [routingIdempotencyKey(a.sourcePOLineId, a.vendorItemId), a])
    );

    const priorAudit = alreadyRoutedLookup.get(routingIdempotencyKey(PO_LINE_ID, VI_B_ID)) as typeof existingAudits[0];
    expect(priorAudit).toBeDefined();

    // Route endpoint returns this destinationPoId to the caller on an idempotent request
    expect(priorAudit.destinationPoId).toBe(PO_B_ID);
    expect(priorAudit.id).toBe(AUDIT_ROW_ID);
  });

  it("DB unique constraint prevents duplicate audit rows for the same (sourcePOLineId, vendorItemId)", async () => {
    await insertBaseFixtures();
    await insertAuditRow({ fromUnitPrice: 3.00, toUnitPrice: 2.50, toCaseSize: 40 });

    // Attempt to insert a duplicate — should silently conflict (onConflictDoNothing)
    await db.insert(poRoutingAudit).values({
      companyId: COMPANY_A_ID,
      sourcePoId: PO_A_ID,
      sourcePOLineId: PO_LINE_ID,
      destinationPoId: PO_B_ID,
      vendorItemId: VI_B_ID,
      inventoryItemId: INV_ITEM_ID,
      userId: null,
      fromUnitPrice: 3.00,
      toUnitPrice: 2.50,
      fromCasePrice: 120.00,
      toCasePrice: 100.00,
      orderedQty: 5,
      projectedSavingsPerCase: 20.0,
    }).onConflictDoNothing();

    // Only one row should exist
    const rows = await db
      .select()
      .from(poRoutingAudit)
      .where(
        and(
          eq(poRoutingAudit.sourcePOLineId, PO_LINE_ID),
          eq(poRoutingAudit.vendorItemId, VI_B_ID)
        )
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(AUDIT_ROW_ID); // original row preserved
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Savings snapshot persistence
// ─────────────────────────────────────────────────────────────────────────────

describe("DB integration — savings snapshot persisted in audit row", () => {
  afterEach(deleteAllFixtures);

  it("projectedSavingsPerCase is stored as (fromUnitPrice - toUnitPrice) × toCaseSize", async () => {
    await insertBaseFixtures();

    const fromUnitPrice = 3.00;
    const toUnitPrice   = 2.50;
    const toCaseSize    = 40;
    const expectedSavings = computeProjectedSavingsPerCase(fromUnitPrice, toUnitPrice, toCaseSize);
    // = (3.00 - 2.50) × 40 = $20.00/case

    await insertAuditRow({ fromUnitPrice, toUnitPrice, toCaseSize });

    const [row] = await db
      .select()
      .from(poRoutingAudit)
      .where(eq(poRoutingAudit.id, AUDIT_ROW_ID));

    expect(row).toBeDefined();
    expect(row.projectedSavingsPerCase).toBeCloseTo(expectedSavings, 4);
    expect(row.projectedSavingsPerCase).toBeCloseTo(20.0, 4);
  });

  it("negative savings (target more expensive) are also persisted correctly", async () => {
    await insertBaseFixtures();

    const fromUnitPrice = 2.00;
    const toUnitPrice   = 3.00; // target is more expensive
    const toCaseSize    = 40;
    const expectedSavings = computeProjectedSavingsPerCase(fromUnitPrice, toUnitPrice, toCaseSize);
    // = (2.00 - 3.00) × 40 = -$40.00/case

    await insertAuditRow({ fromUnitPrice, toUnitPrice, toCaseSize });

    const [row] = await db
      .select()
      .from(poRoutingAudit)
      .where(eq(poRoutingAudit.id, AUDIT_ROW_ID));

    expect(row.projectedSavingsPerCase).toBeCloseTo(expectedSavings, 4);
    expect(row.projectedSavingsPerCase).toBeCloseTo(-40.0, 4);
  });

  it("audit row contains correct fromUnitPrice, toUnitPrice, fromCasePrice, toCasePrice", async () => {
    await insertBaseFixtures();
    await insertAuditRow({ fromUnitPrice: 3.00, toUnitPrice: 2.50, toCaseSize: 40 });

    const [row] = await db
      .select()
      .from(poRoutingAudit)
      .where(eq(poRoutingAudit.id, AUDIT_ROW_ID));

    expect(row.fromUnitPrice).toBeCloseTo(3.00, 4);
    expect(row.toUnitPrice).toBeCloseTo(2.50, 4);
    expect(row.fromCasePrice).toBeCloseTo(120.0, 2);  // 3.00 × 40
    expect(row.toCasePrice).toBeCloseTo(100.0, 2);    // 2.50 × 40
    expect(row.orderedQty).toBeCloseTo(5, 2);
    expect(row.companyId).toBe(COMPANY_A_ID);
    expect(row.sourcePoId).toBe(PO_A_ID);
    expect(row.destinationPoId).toBe(PO_B_ID);
    expect(row.vendorItemId).toBe(VI_B_ID);
    expect(row.inventoryItemId).toBe(INV_ITEM_ID);
    expect(row.routedAt).toBeInstanceOf(Date);
  });

  it("zero savings (prices identical) is stored as 0.0 not null", async () => {
    await insertBaseFixtures();
    await insertAuditRow({ fromUnitPrice: 2.50, toUnitPrice: 2.50, toCaseSize: 40 });

    const [row] = await db
      .select()
      .from(poRoutingAudit)
      .where(eq(poRoutingAudit.id, AUDIT_ROW_ID));

    expect(row.projectedSavingsPerCase).toBeCloseTo(0.0, 4);
  });
});
