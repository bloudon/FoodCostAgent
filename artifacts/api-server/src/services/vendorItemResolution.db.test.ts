/**
 * DB integration tests for the vendor-item uniqueness invariant and the
 * shared get-or-create contract (PM-gated invariant task).
 *
 * Runs against the connected dev database using freshly generated random
 * vendor/item ids, so it cannot collide with real data or parallel suites;
 * all rows it creates are deleted in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { ensureVendorItemUniquenessSchema } from "../migrations/vendorItemUniqueness";
import { getOrCreateVendorItem } from "./vendorItemResolution";

const rowsOf = (r: any) => (Array.isArray(r) ? r : r.rows);

const vendorId = randomUUID();
const otherVendorId = randomUUID();
const itemId = randomUUID();
const unitId = randomUUID();
const createdIds: string[] = [];

function baseValues(overrides: Record<string, unknown> = {}) {
  return {
    vendorId,
    inventoryItemId: itemId,
    purchaseUnitId: unitId,
    caseSize: 1,
    active: 1,
    ...overrides,
  } as any;
}

beforeAll(async () => {
  await ensureVendorItemUniquenessSchema(db);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM vendor_items WHERE vendor_id IN (${vendorId}, ${otherVendorId})`);
});

describe("vendor_items uniqueness index", () => {
  it("rejects a raw duplicate insert for a real SKU", async () => {
    const insert = () =>
      db.execute(sql`
        INSERT INTO vendor_items (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id, case_size, active)
        VALUES (${otherVendorId}, ${itemId}, 'DUP-SKU', ${unitId}, 1, 1)`);
    await insert();
    // The Neon driver wraps the pg error; the constraint name lives on cause.
    const err: any = await insert().then(
      () => null,
      (e) => e,
    );
    expect(err).not.toBeNull();
    const detail = `${err.message} ${err.cause?.message ?? ""} ${err.cause?.constraint ?? ""}`;
    expect(detail).toMatch(/vendor_items_vendor_item_sku_uniq|duplicate key/);
  });

  it("does NOT constrain NULL-SKU rows (PM: NULL-SKU behavior unchanged)", async () => {
    const insert = () =>
      db.execute(sql`
        INSERT INTO vendor_items (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id, case_size, active)
        VALUES (${otherVendorId}, ${itemId}, NULL, ${unitId}, 1, 1)`);
    await insert();
    await expect(insert()).resolves.toBeDefined(); // second NULL-SKU row allowed at DB level
  });

  it("does NOT constrain blank-SKU rows", async () => {
    const insert = () =>
      db.execute(sql`
        INSERT INTO vendor_items (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id, case_size, active)
        VALUES (${otherVendorId}, ${itemId}, '  ', ${unitId}, 1, 1)`);
    await insert();
    await expect(insert()).resolves.toBeDefined();
  });
});

describe("getOrCreateVendorItem", () => {
  it("creates once, then resolves to the same row for the same (vendor, item, SKU)", async () => {
    const first = await getOrCreateVendorItem(db, baseValues({ vendorSku: "SKU-1" }));
    expect(first.created).toBe(true);
    createdIds.push(first.vendorItem.id);

    const second = await getOrCreateVendorItem(db, baseValues({ vendorSku: "SKU-1", caseSize: 99 }));
    expect(second.created).toBe(false);
    expect(second.vendorItem.id).toBe(first.vendorItem.id);
    // Resolution never mutates the existing row.
    expect(second.vendorItem.caseSize).toBe(1);
  });

  it("resolves to a row created by another path (raw insert) instead of duplicating", async () => {
    await db.execute(sql`
      INSERT INTO vendor_items (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id, case_size, active)
      VALUES (${vendorId}, ${itemId}, 'SKU-RAW', ${unitId}, 1, 1)`);
    const res = await getOrCreateVendorItem(db, baseValues({ vendorSku: "SKU-RAW" }));
    expect(res.created).toBe(false);
    const n = rowsOf(await db.execute(sql`
      SELECT count(*)::int AS n FROM vendor_items
      WHERE vendor_id = ${vendorId} AND inventory_item_id = ${itemId} AND vendor_sku = 'SKU-RAW'`))[0].n;
    expect(n).toBe(1);
  });

  it("treats distinct SKUs as distinct identities", async () => {
    const a = await getOrCreateVendorItem(db, baseValues({ vendorSku: "SKU-A" }));
    const b = await getOrCreateVendorItem(db, baseValues({ vendorSku: "SKU-B" }));
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.vendorItem.id).not.toBe(b.vendorItem.id);
  });

  it("does not normalize SKUs — raw identity only", async () => {
    const lower = await getOrCreateVendorItem(db, baseValues({ vendorSku: "sku-case" }));
    const upper = await getOrCreateVendorItem(db, baseValues({ vendorSku: "SKU-CASE" }));
    expect(upper.vendorItem.id).not.toBe(lower.vendorItem.id);
  });

  it("NULL-SKU path reuses ANY existing row for the (vendor, item) pair (PO behavior preserved)", async () => {
    // Pair already has SKU'd rows from the tests above — a NULL-SKU request
    // must reuse one, not create a parallel SKU-less row.
    const res = await getOrCreateVendorItem(db, baseValues({ vendorSku: null }));
    expect(res.created).toBe(false);
  });

  it("NULL-SKU path creates when the pair has no row at all", async () => {
    const freshItem = randomUUID();
    const res = await getOrCreateVendorItem(db, baseValues({ inventoryItemId: freshItem, vendorSku: null }));
    expect(res.created).toBe(true);
    expect(res.vendorItem.vendorSku).toBeNull();
  });

  it("refuses rows without vendorId or inventoryItemId", async () => {
    await expect(getOrCreateVendorItem(db, baseValues({ vendorId: null }))).rejects.toThrow(/requires vendorId/);
  });
});
