/**
 * Race-guard tests for the three production call sites that use
 * getOrCreateVendorItem and gate recordVendorPrice on `resolution.created`.
 *
 * These tests import and exercise the REAL shared functions from
 * vendorItemCallSites.ts — the same code that routes.ts calls.  Removing
 * or disabling a guard in vendorItemCallSites.ts causes the corresponding
 * test here to fail immediately; a handler clone cannot provide that guarantee.
 *
 * recordVendorPrice is mocked so every call is captured.  Tests assert:
 *   (a) the mock is NOT called when the resolver returns an existing row,
 *   (b) the sentinel price remains intact in the DB, and
 *   (c) resolveVendorItemForManualCreate returns created=false (HTTP 200).
 *
 * Uses the real dev database; fresh random ids prevent collision with other
 * suites; rows are cleaned up in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";

// ── Mock the price service BEFORE any module that transitively imports it ─────
// vi.mock is hoisted by vitest's transformer, so it runs before all imports.
vi.mock("../services/vendorPriceService", () => ({
  recordVendorPrice:              vi.fn().mockResolvedValue(undefined),
  updateVendorItemPackGeometry:   vi.fn().mockResolvedValue(undefined),
  isPriceStale:                   vi.fn().mockReturnValue(false),
  getPriceFreshness:              vi.fn().mockReturnValue("fresh"),
  effectivePackQty:               vi.fn().mockReturnValue(1),
  isIncompatibleUnit:             vi.fn().mockReturnValue(false),
  ACTUAL_PURCHASE_SOURCES: new Set(["receipt", "invoice_scan", "historical_invoice_import"]),
  QUOTE_SOURCES:           new Set(["order_guide_import", "connector", "po_create", "manual", "legacy_unknown"]),
}));

// Import AFTER mock setup — gets the mocked version.
import { recordVendorPrice } from "../services/vendorPriceService";

// The real call-site helpers from vendorItemCallSites.ts —
// these are exactly what routes.ts calls from its handler functions.
import {
  resolveVendorItemForManualCreate,
  resolveVendorItemForPoLine,
} from "./vendorItemCallSites";

// ─── Shared IDs ──────────────────────────────────────────────────────────────

const csVendorId = randomUUID();
const csUnitId   = randomUUID();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Insert a sentinel vendor_item row and return its inventoryItemId. */
async function insertSentinel(
  inventoryItemId: string,
  sku: string | null,
  opts: { lastCasePrice: number; lastPrice: number; caseSize: number; priceSource: string },
) {
  await db.execute(sql`
    INSERT INTO vendor_items
      (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id,
       case_size, active, last_case_price, last_price, price_source, priced_at)
    VALUES
      (${csVendorId}, ${inventoryItemId}, ${sku}, ${csUnitId},
       ${opts.caseSize}, 1, ${opts.lastCasePrice}, ${opts.lastPrice},
       ${opts.priceSource}, NOW())
  `);
}

/** Fetch last_case_price for the (csVendorId, itemId) pair. */
async function readPrice(inventoryItemId: string): Promise<number> {
  const raw = (await db.execute(sql`
    SELECT last_case_price FROM vendor_items
    WHERE vendor_id = ${csVendorId} AND inventory_item_id = ${inventoryItemId}
    LIMIT 1
  `)) as any;
  const rows = Array.isArray(raw) ? raw : raw.rows;
  return parseFloat(String(rows[0]?.last_case_price ?? 0));
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

afterAll(async () => {
  await db.execute(sql`DELETE FROM vendor_items WHERE vendor_id = ${csVendorId}`);
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Manual POST /api/vendor-items — resolveVendorItemForManualCreate
//
// This is the function routes.ts calls from its POST /api/vendor-items handler.
// Tests below call it directly: any guard change in vendorItemCallSites.ts
// breaks the test; a change only in a test-specific clone would not.
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveVendorItemForManualCreate — real production call-site function", () => {
  it("returns created=false and does NOT call recordVendorPrice when row already exists", async () => {
    const itemId = randomUUID();
    const sku    = "CS-MANUAL-EXISTING-1";

    // Concurrent winner: the row the guard must protect.
    await insertSentinel(itemId, sku, {
      lastCasePrice: 60.00,
      lastPrice: 7.50,
      caseSize: 8,
      priceSource: "manual",
    });

    // Simulate the manual POST body after normalization (routes.ts ~9979):
    // enteredCasePrice and caseSize from the request, createData without price fields.
    const createData = {
      vendorId:        csVendorId,
      inventoryItemId: itemId,
      vendorSku:       sku,
      purchaseUnitId:  csUnitId,
      caseSize:        24,      // caller sent 24 — must NOT overwrite winner's 8
      innerPackSize:   1,
      active:          1,
    } as any;

    const result = await resolveVendorItemForManualCreate(
      createData,
      99.99,   // enteredCasePrice — must NOT be written
      24,      // caseSize
    );

    // Guard fired: existing row → created=false.
    expect(result.created).toBe(false);

    // recordVendorPrice was NOT called at all.
    expect(vi.mocked(recordVendorPrice)).not.toHaveBeenCalled();

    // Sentinel price untouched in the DB.
    const price = await readPrice(itemId);
    expect(price).toBeCloseTo(60.00, 2);
  });

  it("returns created=true and calls recordVendorPrice once for a genuinely new row", async () => {
    const itemId = randomUUID();
    const sku    = "CS-MANUAL-NEW-1";

    const createData = {
      vendorId:        csVendorId,
      inventoryItemId: itemId,
      vendorSku:       sku,
      purchaseUnitId:  csUnitId,
      caseSize:        6,
      innerPackSize:   1,
      active:          1,
    } as any;

    const result = await resolveVendorItemForManualCreate(
      createData,
      42.00,   // enteredCasePrice
      6,       // caseSize
    );

    expect(result.created).toBe(true);
    expect(vi.mocked(recordVendorPrice)).toHaveBeenCalledOnce();
    expect(vi.mocked(recordVendorPrice)).toHaveBeenCalledWith(
      expect.objectContaining({ source: "manual", price: 42.00, priceBasis: "case" }),
    );
  });

  it("skips recordVendorPrice even when a non-zero price is supplied and the row exists", async () => {
    const itemId = randomUUID();
    const sku    = "CS-MANUAL-EXISTING-PRICE-1";

    await insertSentinel(itemId, sku, {
      lastCasePrice: 30.00, lastPrice: 5.00, caseSize: 4, priceSource: "manual",
    });

    const createData = {
      vendorId:        csVendorId,
      inventoryItemId: itemId,
      vendorSku:       sku,
      purchaseUnitId:  csUnitId,
      caseSize:        12,
      innerPackSize:   1,
      active:          1,
    } as any;

    // Pass a large price — guard must still block the write.
    await resolveVendorItemForManualCreate(createData, 999.00, 12);

    expect(vi.mocked(recordVendorPrice)).not.toHaveBeenCalled();
    expect(await readPrice(itemId)).toBeCloseTo(30.00, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PO create & PO patch — resolveVendorItemForPoLine
//
// Both PO routes delegate to resolveVendorItemForPoLine (vendorItemCallSites.ts)
// when the storage-layer check returns no existing vendor item.  The tests below
// call this shared function directly: any guard removal breaks the tests.
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveVendorItemForPoLine — real production call-site function", () => {
  it("returns created=false and does NOT call recordVendorPrice when storage check missed a concurrent winner", async () => {
    const itemId = randomUUID();

    // Concurrent winner inserted between storage.getVendorItems() returning []
    // and the call to resolveVendorItemForPoLine (the race window).
    await insertSentinel(itemId, null /* NULL-SKU pair */, {
      lastCasePrice: 55.00, lastPrice: 13.75, caseSize: 4, priceSource: "po_create",
    });

    const result = await resolveVendorItemForPoLine({
      vendorId:        csVendorId,
      inventoryItemId: itemId,
      purchaseUnitId:  csUnitId,
      priceEach:       99.99,   // would-be price — must NOT be written
    });

    expect(result.created).toBe(false);

    // Guard fired: recordVendorPrice NOT called.
    expect(vi.mocked(recordVendorPrice)).not.toHaveBeenCalled();

    // Sentinel price untouched.
    expect(await readPrice(itemId)).toBeCloseTo(55.00, 2);
  });

  it("returns created=true and calls recordVendorPrice once for a genuinely new PO pair", async () => {
    const itemId = randomUUID();

    const result = await resolveVendorItemForPoLine({
      vendorId:        csVendorId,
      inventoryItemId: itemId,
      purchaseUnitId:  csUnitId,
      priceEach:       18.50,
    });

    expect(result.created).toBe(true);
    expect(vi.mocked(recordVendorPrice)).toHaveBeenCalledOnce();
    expect(vi.mocked(recordVendorPrice)).toHaveBeenCalledWith(
      expect.objectContaining({ source: "po_create", price: 18.50, priceBasis: "unit" }),
    );
  });

  it("skips recordVendorPrice when priceEach is zero even for a new row", async () => {
    const itemId = randomUUID();

    const result = await resolveVendorItemForPoLine({
      vendorId:        csVendorId,
      inventoryItemId: itemId,
      purchaseUnitId:  csUnitId,
      priceEach:       0,   // zero → guard condition `priceEach > 0` is false
    });

    expect(result.created).toBe(true);
    expect(vi.mocked(recordVendorPrice)).not.toHaveBeenCalled();
  });

  it("skips recordVendorPrice when storage check missed AND priceEach > 0 (double protection)", async () => {
    // A second variant of the race scenario to confirm the created-flag guard
    // is evaluated at the actual insert outcome, not at call time.
    const itemId = randomUUID();

    await insertSentinel(itemId, null, {
      lastCasePrice: 22.00, lastPrice: 5.50, caseSize: 2, priceSource: "po_create",
    });

    const result = await resolveVendorItemForPoLine({
      vendorId:        csVendorId,
      inventoryItemId: itemId,
      purchaseUnitId:  csUnitId,
      priceEach:       88.00,   // would-be price — still must NOT be written
    });

    expect(result.created).toBe(false);
    expect(vi.mocked(recordVendorPrice)).not.toHaveBeenCalled();
    expect(await readPrice(itemId)).toBeCloseTo(22.00, 2);
  });
});
