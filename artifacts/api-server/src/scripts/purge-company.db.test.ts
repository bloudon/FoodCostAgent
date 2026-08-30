/**
 * Opt-in integration coverage. This never runs merely because an application
 * DATABASE_URL exists: set RUN_DB_TESTS=1 against an isolated PostgreSQL test DB.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  companies, companyStores, historicalSessionUnresolvedRows, inventoryCountEntries,
  inventoryCountLines, inventoryCounts, inventoryImportBatches, inventoryImportRows,
  inventoryItems, importSourcePropertyBindings, orderlyImportApprovalJobs, orderlyImportReviewDecisions,
  shelfScanSessions, storageLocations, units, users,
} from "@workspace/db";
import { ensureHistoricalSessionUnresolvedRowsSchema } from "../migrations/historicalSessionUnresolvedRows";
import { ensureOrderlyApprovalJobsSchema } from "../migrations/orderlyApprovalJobs";
import { ensureOrderlyReviewDecisionsSchema } from "../migrations/orderlyReviewDecisions";
import { purgeCompanyData } from "./purge-company";

const SKIP = !process.env.DATABASE_URL || process.env.RUN_DB_TESTS !== "1";
const RUN = Date.now().toString(36);
const controlCompanyId = `purge-control-${RUN}`;
const controlStoreId = `${controlCompanyId}-store`;
const controlBindingId = `${controlCompanyId}-binding`;

async function seed(companyId: string) {
  const ids = {
    store: `${companyId}-store`, user: `${companyId}-user`, location: `${companyId}-location`,
    item: `${companyId}-item`, batch: `${companyId}-batch`, row: `${companyId}-row`,
    count: `${companyId}-count`, line: `${companyId}-line`, scan: `${companyId}-scan`,
    binding: `${companyId}-binding`,
  };
  const [unit] = await db.select({ id: units.id }).from(units)
    .where(eq(units.abbreviation, "ea")).limit(1);
  if (!unit) throw new Error('DB fixture requires the seeded "ea" unit');
  await db.insert(companies).values({ id: companyId, name: `Purge ${companyId}` });
  await db.insert(companyStores).values({ id: ids.store, companyId, code: companyId.slice(0, 12), name: "Purge Store" });
  await db.insert(importSourcePropertyBindings).values({
    id: ids.binding, companyId, sourceSystem: "ORDERLY",
    sourcePropertyId: `property-${companyId}`, destinationStoreId: ids.store,
  });
  await db.insert(users).values({ id: ids.user, companyId, email: `${companyId}@test.invalid`, role: "company_admin", active: 1 });
  await db.insert(storageLocations).values({ id: ids.location, companyId, name: "Purge Location" });
  await db.insert(inventoryItems).values({ id: ids.item, companyId, name: "Purge Item", unitId: unit.id, pricePerUnit: 1 });
  await db.insert(inventoryImportBatches).values({
    id: ids.batch, companyId, fileHash: `hash-${companyId}`, originalFilename: "fixture.xlsx",
    parserVersion: "test", sourceSystem: "ORDERLY", sourceRowCount: 1,
    sourcePropertyBindingId: ids.binding, sourcePropertyId: `property-${companyId}`,
  });
  await db.insert(inventoryImportRows).values({
    id: ids.row, batchId: ids.batch, rowIndex: 1, rawData: { raw: "target payload" },
  });
  await db.insert(inventoryCounts).values({
    id: ids.count, companyId, storeId: ids.store, userId: ids.user, countDate: new Date(),
    applied: 1, sourceBatchId: ids.batch, isHistoricalImport: 1,
  });
  await db.insert(inventoryCountLines).values({
    id: ids.line, inventoryCountId: ids.count, inventoryItemId: ids.item,
    storageLocationId: ids.location, unitId: unit.id, qty: 1, unitCost: 1,
  });
  await db.insert(inventoryCountEntries).values({ inventoryCountLineId: ids.line, qty: 1 });
  await db.insert(shelfScanSessions).values({ id: ids.scan, companyId, storeId: ids.store, userId: ids.user, inventoryCountId: ids.count });
  await db.insert(historicalSessionUnresolvedRows).values({ sessionId: ids.count, importRowId: ids.row, sourceEvidenceHash: `evidence-${companyId}` });
  await db.insert(orderlyImportReviewDecisions).values({ batchId: ids.batch, companyId, rowIndex: 1, decision: { action: "review" } });
  await db.insert(orderlyImportApprovalJobs).values({
    batchId: ids.batch, companyId, timeoutAt: new Date(Date.now() + 60_000),
  });
  return ids;
}

async function exists(table: any, id: string) {
  return (await db.select({ id: table.id }).from(table).where(eq(table.id, id))).length > 0;
}

async function countBy(table: any, column: string, value: string) {
  return (await db.select({ id: table.id }).from(table).where(eq(table[column], value))).length;
}

beforeAll(async () => {
  if (SKIP) return;
  await ensureHistoricalSessionUnresolvedRowsSchema(db as any);
  await ensureOrderlyApprovalJobsSchema(db as any);
  await ensureOrderlyReviewDecisionsSchema(db as any);
  await db.insert(companies).values({ id: controlCompanyId, name: `Control ${RUN}` });
  await db.insert(companyStores).values({ id: controlStoreId, companyId: controlCompanyId, code: `control-${RUN}`.slice(0, 12), name: "Control Store" });
  await db.insert(importSourcePropertyBindings).values({
    id: controlBindingId, companyId: controlCompanyId, sourceSystem: "ORDERLY",
    sourcePropertyId: `property-${controlCompanyId}`, destinationStoreId: controlStoreId,
  });
});

afterAll(async () => {
  if (SKIP) return;
  await db.execute(sql`DROP FUNCTION IF EXISTS purge_company_test_failure() CASCADE`);
  await db.delete(importSourcePropertyBindings).where(eq(importSourcePropertyBindings.companyId, controlCompanyId)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, controlCompanyId)).catch(() => {});
  await db.delete(companies).where(eq(companies.id, controlCompanyId)).catch(() => {});
});

describe.skipIf(SKIP)("company purge import dependencies", () => {
  it("removes imported raw evidence and count dependencies without crossing tenants", async () => {
    const target = `purge-target-${RUN}`;
    const ids = await seed(target);

    await purgeCompanyData(target);

    await expect(exists(companies, target)).resolves.toBe(false);
    await expect(exists(inventoryImportBatches, ids.batch)).resolves.toBe(false);
    await expect(exists(inventoryImportRows, ids.row)).resolves.toBe(false);
    await expect(exists(inventoryCounts, ids.count)).resolves.toBe(false);
    await expect(exists(inventoryCountLines, ids.line)).resolves.toBe(false);
    await expect(exists(shelfScanSessions, ids.scan)).resolves.toBe(false);
    await expect(exists(importSourcePropertyBindings, ids.binding)).resolves.toBe(false);
    await expect(countBy(inventoryCountEntries, "inventoryCountLineId", ids.line)).resolves.toBe(0);
    await expect(countBy(historicalSessionUnresolvedRows, "sessionId", ids.count)).resolves.toBe(0);
    await expect(countBy(orderlyImportReviewDecisions, "batchId", ids.batch)).resolves.toBe(0);
    await expect(countBy(orderlyImportApprovalJobs, "batchId", ids.batch)).resolves.toBe(0);
    await expect(exists(companies, controlCompanyId)).resolves.toBe(true);
    await expect(exists(importSourcePropertyBindings, controlBindingId)).resolves.toBe(true);
  });

  it("rolls back all target deletes when an import-batch dependency fails", async () => {
    const target = `purge-rollback-${RUN}`;
    const ids = await seed(target);
    const escapedBatchId = ids.batch.replace(/'/g, "''");
    await db.execute(sql.raw(`
      CREATE FUNCTION purge_company_test_failure() RETURNS trigger AS $$
      BEGIN
        IF OLD.id = '${escapedBatchId}' THEN RAISE EXCEPTION 'purge fixture failure'; END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `));
    await db.execute(sql`
      CREATE TRIGGER purge_company_test_failure_trigger BEFORE DELETE ON inventory_import_batches
      FOR EACH ROW EXECUTE FUNCTION purge_company_test_failure()
    `);

    await expect(purgeCompanyData(target)).rejects.toThrow("Failed query");
    await expect(exists(companies, target)).resolves.toBe(true);
    await expect(exists(inventoryCounts, ids.count)).resolves.toBe(true);
    await expect(exists(inventoryImportRows, ids.row)).resolves.toBe(true);
    await expect(exists(shelfScanSessions, ids.scan)).resolves.toBe(true);
    await expect(exists(importSourcePropertyBindings, ids.binding)).resolves.toBe(true);

    await db.execute(sql`DROP FUNCTION purge_company_test_failure() CASCADE`);
    await purgeCompanyData(target);
  });
});