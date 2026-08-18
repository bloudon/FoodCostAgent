/**
 * DB integration tests for the vendor-item uniqueness invariant and the
 * shared get-or-create contract (PM-gated invariant task).
 *
 * Runs against the connected dev database using freshly generated random
 * vendor/item ids, so it cannot collide with real data or parallel suites;
 * all rows it creates are deleted in afterAll.
 *
 * Also contains call-site race-guard invariant tests (see the bottom describe
 * block) that simulate a concurrent import winning the creation race and verify
 * that every call site correctly skips the recordVendorPrice write against the
 * pre-existing row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { ensureVendorItemUniquenessSchema } from "../migrations/vendorItemUniqueness";
import { getOrCreateVendorItem } from "./vendorItemResolution";
import { OrderGuideProcessor } from "./orderGuideProcessor";

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

// ─────────────────────────────────────────────────────────────────────────────
// Call-site race-guard invariants
//
// Each test pre-inserts a vendor_item row (simulating the concurrent "winner"
// that completed the insert before the loser arrived), then drives the relevant
// call site and asserts:
//   (a) exactly one DB row — no duplicate was created,
//   (b) the pre-existing row's price fields are untouched — recordVendorPrice
//       was NOT called against it, and
//   (c) the resolution counter reports created=false / vendorItemCreated=false.
//
// All IDs are freshly generated and deleted in afterAll so this suite runs
// safely in parallel with the resolver suite above.
// ─────────────────────────────────────────────────────────────────────────────

// ── Minimal storage stubs ────────────────────────────────────────────────────

/**
 * Storage stub for createVendorItemForExisting call-site tests.
 * getVendorItems returns [] so the pre-check finds no row (simulating the
 * race window where the concurrent winner inserted between the check and the
 * getOrCreateVendorItem call inside the function).
 */
function makeMatchedPathStorage(inventoryItemId: string, unitId: string) {
  return {
    getVendorItems: async () => [],
    getInventoryItem: async (_id: string) => ({
      id: inventoryItemId,
      unitId,
      name: "Race Test Item",
      manufacturer: null,
      isVariableWeight: 0,
      caseSize: 1,
      avgCostPerUnit: 0,
      pricePerUnit: 0,
    }),
    getUnits: async () => [
      { id: unitId, name: "pound", abbreviation: "lb", toBaseRatio: 1, kind: "weight" },
    ],
    updateVendorItem: async () => {},
    updateInventoryItem: async () => {},
  };
}

/**
 * Storage stub for createNewInventoryAndVendorItem call-site tests.
 * getVendorItems and getInventoryItems both return [] (no dedup match);
 * createInventoryItem returns a fake item whose id is controlled by the test
 * so it matches the pre-inserted vendor_item row.
 */
function makeNewItemPathStorage(createdInventoryItemId: string, unitId: string) {
  return {
    getVendorItems: async () => [],
    getInventoryItems: async () => [],
    createInventoryItem: async () => ({
      id: createdInventoryItemId,
      name: "Race Test Product",
      unitId,
      caseSize: 1,
      avgCostPerUnit: 0,
      pricePerUnit: 0,
      manufacturer: null,
      isVariableWeight: 0,
      casePkgCount: null,
      containerSize: null,
      containerLabel: null,
    }),
    getStoreInventoryItems: async () => [],
    createStoreInventoryItem: async () => {},
    setInventoryItemLocations: async () => {},
    updateInventoryItem: async () => {},
    getUnits: async () => [
      { id: unitId, name: "pound", abbreviation: "lb", toBaseRatio: 1, kind: "weight" },
    ],
  };
}

// ── Shared IDs for the race-guard suite ─────────────────────────────────────

const rVendorId = randomUUID();
const rItemId   = randomUUID();
const rUnitId   = randomUUID();

describe("Call-site race-guard invariants", () => {
  afterAll(async () => {
    await db.execute(
      sql`DELETE FROM vendor_items WHERE vendor_id = ${rVendorId}`,
    );
  });

  // ── Helper: read price columns for a specific (vendor, item, sku) triple ──
  async function priceCols(inventoryItemId: string, sku: string) {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT last_case_price, last_price, price_source, priced_at
        FROM vendor_items
        WHERE vendor_id        = ${rVendorId}
          AND inventory_item_id = ${inventoryItemId}
          AND vendor_sku        = ${sku}
      `),
    ) as Array<{
      last_case_price: string | number;
      last_price:      string | number;
      price_source:    string | null;
      priced_at:       Date   | string | null;
    }>;
    return rows;
  }

  // ─── 1. getOrCreateVendorItem — real-SKU path ─────────────────────────────
  it("real-SKU path: returns created=false and leaves sentinel price intact (lost race)", async () => {
    const sku = "RACE-GUARD-SKU-1";

    // Concurrent winner pre-creates the row with a sentinel price.
    await db.execute(sql`
      INSERT INTO vendor_items
        (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id,
         case_size, active, last_case_price, last_price, price_source, priced_at)
      VALUES
        (${rVendorId}, ${rItemId}, ${sku}, ${rUnitId},
         6, 1, 42.00, 7.00, 'order_guide_import', NOW())
    `);

    // Lost-race call: same identity, different caseSize and would-be price.
    const res = await getOrCreateVendorItem(db, {
      vendorId:        rVendorId,
      inventoryItemId: rItemId,
      vendorSku:       sku,
      purchaseUnitId:  rUnitId,
      caseSize:        99,   // different — must NOT overwrite winner's 6
      active:          1,
    });

    expect(res.created).toBe(false);
    expect(res.vendorItem.caseSize).toBe(6);  // winner's pack geometry preserved

    // Exactly one row; sentinel price fields unchanged.
    const cols = await priceCols(rItemId, sku);
    expect(cols).toHaveLength(1);
    expect(parseFloat(String(cols[0].last_case_price))).toBeCloseTo(42.00, 2);
    expect(parseFloat(String(cols[0].last_price))).toBeCloseTo(7.00, 2);
    expect(cols[0].price_source).toBe("order_guide_import");
    expect(cols[0].priced_at).not.toBeNull();
  });

  // ─── 2. NULL-SKU path — PO create / patch call site ───────────────────────
  //
  // The PO create and patch routes use the NULL-SKU path and gate the
  // recordVendorPrice call on `resolution.created`:
  //   if (resolution.created && line.priceEach > 0) { await recordVendorPrice(...) }
  //
  // When the pair already exists, resolution.created=false and the gate blocks
  // the stamp, leaving the pre-existing row's price fields untouched.
  it("NULL-SKU path: returns created=false and leaves sentinel price intact (PO call site)", async () => {
    const poItemId = randomUUID();  // distinct pair for isolation

    await db.execute(sql`
      INSERT INTO vendor_items
        (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id,
         case_size, active, last_case_price, last_price, price_source, priced_at)
      VALUES
        (${rVendorId}, ${poItemId}, 'RACE-PO-SKU', ${rUnitId},
         4, 1, 55.00, 13.75, 'po_create', NOW())
    `);

    // PO path always calls with vendorSku=null.
    const res = await getOrCreateVendorItem(db, {
      vendorId:        rVendorId,
      inventoryItemId: poItemId,
      vendorSku:       null,   // NULL-SKU reuse-any-pair path
      purchaseUnitId:  rUnitId,
      caseSize:        1,      // PO always sends 1 — must NOT overwrite winner's 4
      active:          1,
    });

    expect(res.created).toBe(false);
    // Winner's caseSize preserved — 1 was NOT written.
    expect(res.vendorItem.caseSize).toBe(4);

    const rows = rowsOf(
      await db.execute(sql`
        SELECT last_case_price, last_price FROM vendor_items
        WHERE vendor_id = ${rVendorId} AND inventory_item_id = ${poItemId}
      `),
    ) as Array<{ last_case_price: string | number; last_price: string | number }>;

    expect(rows).toHaveLength(1);
    expect(parseFloat(String(rows[0].last_case_price))).toBeCloseTo(55.00, 2);
    expect(parseFloat(String(rows[0].last_price))).toBeCloseTo(13.75, 2);

    await db.execute(
      sql`DELETE FROM vendor_items WHERE vendor_id = ${rVendorId} AND inventory_item_id = ${poItemId}`,
    );
  });

  // ─── 3. createVendorItemForExisting — order-guide matched path ────────────
  //
  // Simulates the race window inside createVendorItemForExisting:
  //   storage.getVendorItems() returns [] (pre-check finds nothing),
  //   but the DB already has the row (concurrent winner inserted it).
  // getOrCreateVendorItem sees the existing row and returns created=false,
  // so the price-stamp branch is skipped.
  it("createVendorItemForExisting: skips price stamp and returns false when race loser", async () => {
    const sku = "RACE-GUARD-EXISTING-1";

    // Concurrent winner's row with sentinel price.
    await db.execute(sql`
      INSERT INTO vendor_items
        (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id,
         case_size, active, last_case_price, last_price, price_source, priced_at)
      VALUES
        (${rVendorId}, ${rItemId}, ${sku}, ${rUnitId},
         6, 1, 42.00, 7.00, 'order_guide_import', NOW())
    `);

    const storage = makeMatchedPathStorage(rItemId, rUnitId);
    const processor = new OrderGuideProcessor(storage as any);

    // Drive the matched-path call site with a different price to make a
    // potential overwrite detectable.
    const result: boolean = await (processor as any).createVendorItemForExisting(
      {
        vendorSku:              sku,
        matchedInventoryItemId: rItemId,
        caseSize:               12,    // different — must NOT overwrite winner's 6
        innerPack:              null,
        price:                  99.99, // would-be price — must NOT be written
        uom:                    "CS",
      },
      rVendorId,
      "company-race",
    );

    // false = resolver returned existing row (created=false) — price stamp skipped.
    expect(result).toBe(false);

    const cols = await priceCols(rItemId, sku);
    expect(cols).toHaveLength(1);
    expect(parseFloat(String(cols[0].last_case_price))).toBeCloseTo(42.00, 2);
    expect(cols[0].price_source).toBe("order_guide_import");
  });

  // ─── 4. createNewInventoryAndVendorItem — order-guide new-item path ────────
  //
  // Simulates the race window inside createNewInventoryAndVendorItem:
  //   storage.getVendorItems() returns [] (SKU dedup check finds nothing),
  //   storage.createInventoryItem() returns an item with a controlled id,
  //   but the DB already has a vendor_item for (vendor, controlledId, sku).
  // getOrCreateVendorItem sees the existing row and returns created=false,
  // so vendorItemCreated=false and the price-stamp branch is skipped.
  it("createNewInventoryAndVendorItem: skips price stamp and reports vendorItemCreated=false when race loser", async () => {
    const sku       = "RACE-GUARD-NEW-1";
    const newItemId = randomUUID();  // controlled id returned by createInventoryItem stub

    // Concurrent winner's row — same (vendor, newItemId, sku) triple.
    await db.execute(sql`
      INSERT INTO vendor_items
        (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id,
         case_size, active, last_case_price, last_price, price_source, priced_at)
      VALUES
        (${rVendorId}, ${newItemId}, ${sku}, ${rUnitId},
         6, 1, 77.00, 12.83, 'order_guide_import', NOW())
    `);

    const storage = makeNewItemPathStorage(newItemId, rUnitId);
    const processor = new OrderGuideProcessor(storage as any);

    // Defaults: storageLocationId=null prevents setInventoryItemLocations call.
    const defaults = {
      categoryId:        null,
      unitId:            rUnitId,
      storageLocationId: null,
      categories:        [{ id: "cat-test", name: "Dry/Pantry" }],
      units:             [{ id: rUnitId, name: "pound", abbreviation: "lb", toBaseRatio: 1, kind: "weight" }],
    };

    const result: { inventoryCreated: boolean; vendorItemCreated: boolean; storeAssignmentsCreated: number } =
      await (processor as any).createNewInventoryAndVendorItem(
        {
          vendorSku:             sku,
          productName:           "Race Test Product",
          caseSize:              12,    // different — must NOT overwrite winner's 6
          innerPack:             null,
          price:                 99.99, // would-be price — must NOT be written
          uom:                   "CS",
          brandName:             null,
          category:              null,
          isVariableWeight:      0,
          isSuspectedCatchWeight: 0,
        },
        rVendorId,
        "company-race",
        ["store-race"],
        defaults,
      );

    // vendorItemCreated=false: getOrCreateVendorItem returned the existing row.
    expect(result.vendorItemCreated).toBe(false);

    // Exactly one row; sentinel price intact — no price stamp on the existing row.
    const rows = rowsOf(
      await db.execute(sql`
        SELECT last_case_price, price_source FROM vendor_items
        WHERE vendor_id         = ${rVendorId}
          AND inventory_item_id = ${newItemId}
          AND vendor_sku        = ${sku}
      `),
    ) as Array<{ last_case_price: string | number; price_source: string | null }>;

    expect(rows).toHaveLength(1);
    expect(parseFloat(String(rows[0].last_case_price))).toBeCloseTo(77.00, 2);
    expect(rows[0].price_source).toBe("order_guide_import");

    await db.execute(
      sql`DELETE FROM vendor_items WHERE vendor_id = ${rVendorId} AND inventory_item_id = ${newItemId}`,
    );
  });

  // ─── 5. Deterministic ON CONFLICT DO NOTHING recovery path ─────────────────
  //
  // Forces the select→nothing→insert→ON CONFLICT→reselect branch by:
  //   a) pre-inserting the winner row directly so the constraint exists, then
  //   b) proxying the executor so its first .select() resolves to [] (race
  //      window: the winner's INSERT appeared to the real SELECT but here we
  //      simulate the moment before it committed, forcing our INSERT to fire).
  //
  // Because the winner row is already in the DB, our INSERT hits ON CONFLICT
  // DO NOTHING deterministically (no timing dependency).  The reselect (second
  // .select() — real executor) then finds the winner; created=false is returned.
  it("ON CONFLICT DO NOTHING recovery path: reselect finds the concurrent winner deterministically", async () => {
    const conflictSku = "RACE-CONFLICT-PROOF-SKU";

    // Winner row with a sentinel last_case_price — the reselect must return this.
    await db.execute(sql`
      INSERT INTO vendor_items
        (vendor_id, inventory_item_id, vendor_sku, purchase_unit_id,
         case_size, active, last_case_price, last_price, price_source, priced_at)
      VALUES
        (${rVendorId}, ${rItemId}, ${conflictSku}, ${rUnitId},
         6, 1, 77.00, 12.83, 'order_guide_import', NOW())
    `);

    let firstSelectDone = false;

    // Proxy the executor so only the first .select() returns [].
    // All other calls (the INSERT and the reselect) pass through to the real db.
    //
    // The fake chain is a plain thenable: every chained method (.from, .where,
    // .limit) returns itself so the final `await chain` resolves to [].
    const makeEmptyChain = (): any => {
      const chain: any = {
        from:  () => chain,
        where: () => chain,
        limit: () => chain,
        then(resolve: any, reject: any) { return Promise.resolve([]).then(resolve, reject); },
      };
      return chain;
    };

    const instrumentedDb = new Proxy(db as object, {
      get(target: any, prop: string | symbol) {
        if (prop === "select" && !firstSelectDone) {
          firstSelectDone = true;
          return () => makeEmptyChain();   // race window: no row seen yet
        }
        return target[prop];
      },
    }) as typeof db;

    // Call with the same identity as the pre-inserted winner.
    const result = await getOrCreateVendorItem(instrumentedDb, {
      vendorId:        rVendorId,
      inventoryItemId: rItemId,
      vendorSku:       conflictSku,
      purchaseUnitId:  rUnitId,
      caseSize:        6,
      active:          1,
    });

    // The ON CONFLICT recovery path was taken: our INSERT conflicted and the
    // reselect returned the winner's row.
    expect(result.created).toBe(false);
    expect(result.vendorItem.vendorSku).toBe(conflictSku);
    // Winner's sentinel price is intact — no overwrite from our failed INSERT.
    expect(parseFloat(String(result.vendorItem.lastCasePrice))).toBeCloseTo(77.00, 2);

    // Exactly one row — no duplicate from the ON CONFLICT insert.
    const count = rowsOf(
      await db.execute(sql`
        SELECT count(*)::int AS n FROM vendor_items
        WHERE vendor_id         = ${rVendorId}
          AND inventory_item_id = ${rItemId}
          AND vendor_sku        = ${conflictSku}
      `),
    ) as Array<{ n: number }>;
    expect(count[0].n).toBe(1);
  });
});
