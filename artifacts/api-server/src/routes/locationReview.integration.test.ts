/**
 * Real HTTP integration coverage for the Bay Hill location review.
 *
 * Run only with the disposable local database command documented below.  This
 * file intentionally does not fall back to the workspace DATABASE_URL.
 */
import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  companies as companiesTable, companyStores, inventoryCounts, inventoryCountEntries,
  importSourcePropertyBindings, inventoryCountLines, inventoryImportBatches, inventoryImportRows, inventoryItems,
  inventoryItemExternalMappings, inventoryItemLocationAssignments, inventoryLocations,
  storageLocations, storeInventoryItems, units,
} from "@workspace/db";

const TEST_DATABASE = "fnb_location_test";
const IS_ISOLATED = process.env.DATABASE_URL === `postgres://runner@127.0.0.1:54329/${TEST_DATABASE}` &&
  process.env.STORAGE_MODE === "local" && !process.env.NEON_DATABASE_URL;
const RUN = `lr-${Date.now().toString(36)}`;
const ids = {
  company: `${RUN}-company`, store: `${RUN}-store`, unit: `${RUN}-unit`,
  july: `${RUN}-july`, august: `${RUN}-august`, batch: `${RUN}-batch`,
  freezer: `${RUN}-freezer`, reach: `${RUN}-reach`, dry: `${RUN}-dry`,
  cake: `${RUN}-cake`, potato: `${RUN}-potato`,
  cakeMain: `${RUN}-cake-main`, potatoMain: `${RUN}-potato-main`,
  cakeSupported: `${RUN}-cake-supported`, potatoSupported: `${RUN}-potato-supported`,
  cakeSupportedLine: `${RUN}-cake-supported-line`, potatoSupportedLine: `${RUN}-potato-supported-line`,
};

const auth = vi.hoisted(() => ({ role: "company_admin", companyId: "", storeId: "" }));
vi.mock("../auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth")>();
  return {
    ...actual,
    requireAuth: vi.fn((req: any, _res: any, next: any) => {
      req.user = { id: `${RUN}-user`, role: auth.role, companyId: auth.companyId };
      req.companyId = auth.companyId;
      next();
    }),
    optionalAuth: vi.fn((_req: any, _res: any, next: any) => next()),
    requireTier: vi.fn(() => (_req: any, _res: any, next: any) => next()),
    requireCompanyAdmin: vi.fn((_req: any, _res: any, next: any) => next()),
    requireRole: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  };
});

let app: express.Express;
let registerRoutes: typeof import("../routes").registerRoutes;

const reviewUrl = `/api/inventory-counts/${ids.august}/location-review`;

beforeAll(async () => {
  if (!IS_ISOLATED) {
    throw new Error("Refusing integration test outside the disposable local fnb_location_test database");
  }
  const [{ registerRoutes: register }] = await Promise.all([import("../routes")]);
  registerRoutes = register;
  await db.insert(units).values({ id: ids.unit, name: "Each", abbreviation: `ea-${RUN.slice(0, 6)}`, kind: "count", toBaseRatio: 1, system: "both" });
  const unit = { id: ids.unit };
  await db.insert(companiesTable).values({ id: ids.company, name: `Bay Hill test ${RUN}` });
  await db.insert(companyStores).values({ id: ids.store, companyId: ids.company, name: "Bay Hill CC's Store", code: RUN.slice(0, 10), status: "active" });
  await db.insert(importSourcePropertyBindings).values({
    companyId: ids.company, destinationStoreId: ids.store,
    sourceSystem: "ORDERLY", sourcePropertyId: "24472", active: 1,
  });
  await db.insert(storageLocations).values([
    { id: ids.freezer, companyId: ids.company, name: "Main freezer" },
    { id: ids.reach, companyId: ids.company, name: "Front Reach-in Freezer" },
    { id: ids.dry, companyId: ids.company, name: "Dry Storeroom" },
  ]);
  await db.insert(inventoryLocations).values([
    { id: ids.freezer, companyId: ids.company, name: "Main freezer", normalizedName: "main freezer", locationType: "storage", active: 1 },
    { id: ids.reach, companyId: ids.company, name: "Front Reach-in Freezer", normalizedName: "front reach-in freezer", locationType: "storage", active: 1 },
    { id: ids.dry, companyId: ids.company, name: "Dry Storeroom", normalizedName: "dry storeroom", locationType: "storage", active: 1 },
  ]);
  await db.insert(inventoryItems).values([
    { id: ids.cake, companyId: ids.company, name: "LEMON OLIVE OIL CAKE", unitId: unit.id },
    { id: ids.potato, companyId: ids.company, name: "POTATO INSTANT REAL MASH DEHT", unitId: unit.id },
  ]);
  await db.insert(storeInventoryItems).values([
    { id: `${RUN}-cake-stock`, companyId: ids.company, storeId: ids.store, inventoryItemId: ids.cake, onHandQty: 17 },
    { id: `${RUN}-potato-stock`, companyId: ids.company, storeId: ids.store, inventoryItemId: ids.potato, onHandQty: 23 },
  ]);
  await db.insert(inventoryItemExternalMappings).values([
    { companyId: ids.company, inventoryItemId: ids.cake, sourceSystem: "ORDERLY", sourcePropertyId: "24472", sourceExternalId: "9503" },
    { companyId: ids.company, inventoryItemId: ids.potato, sourceSystem: "ORDERLY", sourcePropertyId: "24472", sourceExternalId: "0726127" },
  ]);
  await db.insert(inventoryItemLocationAssignments).values([
    { id: ids.cakeMain, companyId: ids.company, inventoryItemId: ids.cake, locationId: ids.freezer, active: 1 },
    { id: ids.potatoMain, companyId: ids.company, inventoryItemId: ids.potato, locationId: ids.freezer, active: 1 },
    { id: ids.cakeSupported, companyId: ids.company, inventoryItemId: ids.cake, locationId: ids.reach, active: 1 },
    { id: ids.potatoSupported, companyId: ids.company, inventoryItemId: ids.potato, locationId: ids.dry, active: 1 },
  ]);
  await db.insert(inventoryImportBatches).values({
    id: ids.batch, companyId: ids.company, sourceSystem: "ORDERLY", sourcePropertyId: "24472",
    fileHash: `${RUN}-hash`, originalFilename: "July.xlsx", parserVersion: "1",
    inventoryDate: "2026-07-31", inventoryDateConfirmed: 1, status: "approved",
    targetStoreId: ids.store, sourceRowCount: 2,
  });
  await db.insert(inventoryImportRows).values([
    { batchId: ids.batch, rowIndex: 1, rawData: {}, cleanedDescription: "LEMON OLIVE OIL CAKE", sourceItemCode: "9503", storageLocation: "Front Reach-in Freezer", totalUnits: 0, resolvedInventoryItemId: ids.cake, rowStatus: "matched" },
    { batchId: ids.batch, rowIndex: 2, rawData: {}, cleanedDescription: "POTATO INSTANT REAL MASH DEHT", sourceItemCode: "0726127", storageLocation: "Dry Storeroom", totalUnits: 0, resolvedInventoryItemId: ids.potato, rowStatus: "matched" },
  ]);
  await db.insert(inventoryCounts).values([
    { id: ids.july, companyId: ids.company, storeId: ids.store, countDate: new Date("2026-07-31"), userId: `${RUN}-user`, isHistoricalImport: 1, sourceSystem: "ORDERLY", sourceBatchId: ids.batch },
    { id: ids.august, companyId: ids.company, storeId: ids.store, countDate: new Date("2026-08-31"), userId: `${RUN}-user` },
  ]);
  await db.insert(inventoryCountLines).values([
    { inventoryCountId: ids.july, inventoryItemId: ids.cake, storageLocationId: ids.reach, unitId: unit.id, qty: 5 },
    { inventoryCountId: ids.july, inventoryItemId: ids.potato, storageLocationId: ids.dry, unitId: unit.id, qty: 5 },
    { id: ids.cakeMain, inventoryCountId: ids.august, inventoryItemId: ids.cake, storageLocationId: ids.freezer, unitId: unit.id, qty: 0 },
    { id: ids.potatoMain, inventoryCountId: ids.august, inventoryItemId: ids.potato, storageLocationId: ids.freezer, unitId: unit.id, qty: 0 },
    { id: ids.cakeSupportedLine, inventoryCountId: ids.august, inventoryItemId: ids.cake, storageLocationId: ids.reach, unitId: unit.id, qty: 0 },
    { id: ids.potatoSupportedLine, inventoryCountId: ids.august, inventoryItemId: ids.potato, storageLocationId: ids.dry, unitId: unit.id, qty: 0 },
  ]);
  auth.companyId = ids.company;
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

afterAll(async () => {
  if (!IS_ISOLATED) return;
  await db.delete(inventoryCountEntries).where(inArray(inventoryCountEntries.inventoryCountLineId, [ids.cakeMain, ids.potatoMain, ids.cakeSupportedLine, ids.potatoSupportedLine])).catch(() => {});
  await db.delete(inventoryCountLines).where(inArray(inventoryCountLines.inventoryCountId, [ids.july, ids.august])).catch(() => {});
  await db.delete(inventoryCounts).where(inArray(inventoryCounts.id, [ids.july, ids.august])).catch(() => {});
  await db.delete(inventoryImportRows).where(eq(inventoryImportRows.batchId, ids.batch)).catch(() => {});
  await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.id, ids.batch)).catch(() => {});
  await db.delete(importSourcePropertyBindings).where(eq(importSourcePropertyBindings.companyId, ids.company)).catch(() => {});
  await db.delete(inventoryItemLocationAssignments).where(eq(inventoryItemLocationAssignments.companyId, ids.company)).catch(() => {});
  await db.delete(inventoryItemExternalMappings).where(eq(inventoryItemExternalMappings.companyId, ids.company)).catch(() => {});
  await db.delete(storeInventoryItems).where(eq(storeInventoryItems.companyId, ids.company)).catch(() => {});
  await db.delete(inventoryLocations).where(eq(inventoryLocations.companyId, ids.company)).catch(() => {});
  await db.delete(storageLocations).where(eq(storageLocations.companyId, ids.company)).catch(() => {});
  await db.delete(inventoryItems).where(eq(inventoryItems.companyId, ids.company)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, ids.company)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, ids.company)).catch(() => {});
  await db.delete(units).where(eq(units.id, ids.unit)).catch(() => {});
});

describe("location-review real route integration", () => {
  beforeEach(() => { auth.role = "company_admin"; });

  it("returns the two actual unmatched warnings and refuses store users", async () => {
    const response = await supertest(app).get(reviewUrl).expect(200);
    expect(response.body.blockers).toEqual([]);
    expect(response.body.canRemove).toBe(true);
    expect(response.body.warnings).toHaveLength(2);
    expect(response.body.warnings.every((warning: any) => warning.eligibleForRemoval)).toBe(true);
    auth.role = "store_user";
    await supertest(app).post(`${reviewUrl}/resolve`).send({ expectedLineIds: [ids.cakeMain, ids.potatoMain] }).expect(403);
  });

  it("blocks removal when the dated source property is no longer bound to this store", async () => {
    await db.update(importSourcePropertyBindings).set({ active: 0 })
      .where(eq(importSourcePropertyBindings.companyId, ids.company));
    try {
      const response = await supertest(app).get(reviewUrl).expect(200);
      expect(response.body.blockers).toContain("Count store is not the active Bay Hill Orderly property destination");
      expect(response.body.canRemove).toBe(false);
      await supertest(app).post(`${reviewUrl}/resolve`)
        .send({ expectedLineIds: [ids.cakeMain, ids.potatoMain] }).expect(409);
      expect(await db.select().from(inventoryCountLines)
        .where(eq(inventoryCountLines.inventoryCountId, ids.august))).toHaveLength(4);
    } finally {
      await db.update(importSourcePropertyBindings).set({ active: 1 })
        .where(eq(importSourcePropertyBindings.companyId, ids.company));
    }
  });

  it("rejects stale IDs and preserves all rows", async () => {
    await supertest(app).post(`${reviewUrl}/resolve`).send({ expectedLineIds: [ids.cakeMain, "stale"] }).expect(409);
    const rows = await db.select({ id: inventoryCountLines.id }).from(inventoryCountLines).where(eq(inventoryCountLines.inventoryCountId, ids.august));
    expect(rows).toHaveLength(4);
  });

  it("refuses requests from a different company or inaccessible store", async () => {
    auth.companyId = "different-company";
    await supertest(app).get(reviewUrl).expect(404);
    await supertest(app).post(`${reviewUrl}/resolve`).send({ expectedLineIds: [ids.cakeMain, ids.potatoMain] }).expect(404);
    auth.companyId = ids.company;
    auth.role = "store_manager";
    auth.storeId = "other-store";
    await supertest(app).post(`${reviewUrl}/resolve`).send({ expectedLineIds: [ids.cakeMain, ids.potatoMain] }).expect(404);
    auth.storeId = "";
  });

  it("refuses entered/nonzero lines and rolls back", async () => {
    await db.update(inventoryCountLines).set({ qty: 2 }).where(eq(inventoryCountLines.id, ids.cakeMain));
    await supertest(app).post(`${reviewUrl}/resolve`).send({ expectedLineIds: [ids.cakeMain, ids.potatoMain] }).expect(409);
    await db.update(inventoryCountLines).set({ qty: 0 }).where(eq(inventoryCountLines.id, ids.cakeMain));
    await db.insert(inventoryCountEntries).values({ inventoryCountLineId: ids.cakeMain, qty: 1 });
    await supertest(app).post(`${reviewUrl}/resolve`).send({ expectedLineIds: [ids.cakeMain, ids.potatoMain] }).expect(409);
    expect((await db.select({ active: inventoryItemLocationAssignments.active }).from(inventoryItemLocationAssignments).where(eq(inventoryItemLocationAssignments.id, ids.cakeMain)))[0]?.active).toBe(1);
    await db.delete(inventoryCountEntries).where(eq(inventoryCountEntries.inventoryCountLineId, ids.cakeMain));
    await db.update(inventoryItemLocationAssignments).set({ active: 0 }).where(eq(inventoryItemLocationAssignments.id, ids.cakeMain));
    await supertest(app).post(`${reviewUrl}/resolve`).send({ expectedLineIds: [ids.cakeMain, ids.potatoMain] }).expect(409);
    expect(await db.select().from(inventoryCountLines).where(eq(inventoryCountLines.inventoryCountId, ids.august))).toHaveLength(4);
    await db.update(inventoryItemLocationAssignments).set({ active: 1 }).where(eq(inventoryItemLocationAssignments.id, ids.cakeMain));
  });

  it("deactivates exactly two assignments and deletes exactly two lines", async () => {
    const julyBefore = await db.select().from(inventoryCountLines).where(eq(inventoryCountLines.inventoryCountId, ids.july));
    const stockBefore = await db.select().from(storeInventoryItems).where(eq(storeInventoryItems.companyId, ids.company));
    const response = await supertest(app).post(`${reviewUrl}/resolve`).send({ expectedLineIds: [ids.cakeMain, ids.potatoMain] }).expect(200);
    expect(response.body).toEqual({ removed: 2, alreadyResolved: false });
    expect((await db.select().from(inventoryCountLines).where(eq(inventoryCountLines.inventoryCountId, ids.august)))).toHaveLength(2);
    expect(await db.select().from(inventoryCountLines).where(eq(inventoryCountLines.inventoryCountId, ids.july))).toEqual(julyBefore);
    expect(await db.select().from(storeInventoryItems).where(eq(storeInventoryItems.companyId, ids.company))).toEqual(stockBefore);
    expect((await db.select().from(inventoryItemLocationAssignments).where(eq(inventoryItemLocationAssignments.companyId, ids.company)))).toHaveLength(4);
    expect(await db.select().from(inventoryItemLocationAssignments).where(and(eq(inventoryItemLocationAssignments.companyId, ids.company), eq(inventoryItemLocationAssignments.active, 1)))).toHaveLength(2);
    expect((await supertest(app).get(reviewUrl).expect(200)).body.warnings).toHaveLength(0);
    await supertest(app).post(`${reviewUrl}/resolve`).send({ expectedLineIds: [ids.cakeMain, ids.potatoMain] }).expect(409);
  });
});