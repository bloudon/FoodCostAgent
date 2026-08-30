/**
 * DB-backed identity regressions for the Bay Hill Orderly XLSX importer.
 *
 * These exercise the authoritative approval transaction rather than a mocked
 * preview, proving that repeated reliable Item Codes cannot independently
 * create inventory items before a mapping is visible.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  companies as companiesTable,
  categories,
  companyStores,
  importSourcePropertyBindings,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItemExternalMappings,
  inventoryItemRelationships,
  inventoryItemLocationAssignments,
  inventoryItems,
  inventoryLocations,
  insertInventoryItemSchema,
  orderlyImportReviewDecisions,
  orderlyImportApprovalJobs,
  storeInventoryItems,
  units,
  users,
  vendorItemExternalMappings,
  vendorItems,
  vendors,
} from '@workspace/db';
import {
  applyBatchApproval,
  assertSupersededDecisionTarget,
  getOrderlyReviewDecisions,
  ImportApprovalError,
  runResolutionPreview,
  saveOrderlyReviewDecisionChanges,
} from './orderlyDomain';
import { ensureInventoryItemNumberSchema } from '../../migrations/inventoryItemNumbers';
import { ensureOrderlyPackIdentityEvidenceSchema } from '../../migrations/orderlyPackIdentityEvidence';
import { ensureOrderlyApprovalJobsSchema } from '../../migrations/orderlyApprovalJobs';
import {
  claimApprovalJob,
  getApprovalJob,
  recoverExpiredApprovalJobs,
  runApprovalJob,
} from './orderlyApprovalJobs';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = vi.hoisted(() => Date.now().toString(36).toUpperCase());
const ID = {
  company: `oid-co-${RUN}`,
  store: `oid-store-${RUN}`,
  admin: `oid-admin-${RUN}`,
  binding: `oid-binding-${RUN}`,
  property: `oid-prop-a-${RUN}`,
  // A second authorized Orderly property in the same company. Both clubs can
  // legitimately export the same Item Code for different products.
  storeB: `oid-store-b-${RUN}`,
  bindingB: `oid-binding-b-${RUN}`,
  propertyB: `oid-prop-b-${RUN}`,
};
let batchSequence = 0;
let chambordItemId: string | null = null;

/** Seeded 'each' unit, used when a fixture needs a pre-existing catalog item. */
let cachedEachUnitId: string | null = null;
async function eachUnitId(): Promise<string> {
  if (cachedEachUnitId) return cachedEachUnitId;
  const [row] = await db
    .select({ id: units.id })
    .from(units)
    .where(eq(units.abbreviation, 'ea'))
    .limit(1);
  if (!row) throw new Error('Expected seeded "ea" unit for identity fixtures');
  cachedEachUnitId = row.id;
  return row.id;
}

type SourceRow = {
  code: string | null;
  description: string;
  location: string;
  supplier?: string | null;
  packSizeRaw?: string | null;
  caseQuantity?: number | null;
  innerPackQuantity?: number | null;
  baseUnitQuantity?: number | null;
  baseUnit?: string | null;
  packagePrice?: number | null;
  totalCost?: number;
};

async function stageBatch(
  rows: SourceRow[],
  inventoryDate: string,
  property: 'A' | 'B' = 'A',
): Promise<string> {
  const id = `oid-batch-${RUN}-${batchSequence++}`;
  await db.insert(inventoryImportBatches).values({
    id,
    companyId: ID.company,
    sourceSystem: 'ORDERLY',
    fileHash: `hash-${id}`,
    originalFilename: `${id}.xlsx`,
    sheetName: 'Inventory Detail',
    parserVersion: '1.0',
    inventoryDate,
    inventoryDateConfirmed: 1,
    status: 'pending_review',
    sourceRowCount: rows.length,
    targetStoreId: property === 'A' ? ID.store : ID.storeB,
    sourcePropertyBindingId: property === 'A' ? ID.binding : ID.bindingB,
    sourcePropertyId: property === 'A' ? ID.property : ID.propertyB,
  });
  const stagedRows = rows.map((row, index) => ({
    batchId: id,
    rowIndex: index + 1,
    sheetName: 'Inventory Detail',
    rawData: {
      description: row.description,
      location: row.location,
      ...(row.packSizeRaw ? { 'Pack Size': row.packSizeRaw } : {}),
    },
    rawDescription: row.description,
    cleanedDescription: row.description,
    caseQuantity: row.caseQuantity === undefined ? 6 : row.caseQuantity,
    innerPackQuantity: row.innerPackQuantity === undefined ? 1 : row.innerPackQuantity,
    baseUnitQuantity: row.baseUnitQuantity === undefined ? 1 : row.baseUnitQuantity,
    baseUnit: row.baseUnit === undefined ? 'ML' : row.baseUnit,
    packagePrice: row.packagePrice === undefined ? 30 : row.packagePrice,
    totalCost: row.totalCost ?? 30,
    sourceItemCode: row.code,
    itemCodeStatus: row.code ? 'valid' : 'blank',
    supplierRaw: row.supplier ?? null,
    supplierStatus: row.supplier ? 'valid' : 'blank',
    storageLocation: row.location,
    rowStatus: 'new_item_candidate',
  }));
  // Keep production-sized fixtures below PostgreSQL/driver bind-parameter
  // limits without changing their persisted row order or content.
  for (let offset = 0; offset < stagedRows.length; offset += 500) {
    await db.insert(inventoryImportRows).values(stagedRows.slice(offset, offset + 500));
  }
  return id;
}

/**
 * Approval must fail before touching any table its transaction can mutate.
 * Keep this broader than an item count: a partial resolution, mapping, vendor,
 * location, relationship, or store link would be just as corrupting.
 */
async function approvalWriteSnapshot(batchId: string) {
  const [
    batches,
    rows,
    itemIds,
    categoryIds,
    externalMappingIds,
    relationshipIds,
    locationIds,
    assignmentIds,
    storeItemIds,
    vendorRows,
  ] = await Promise.all([
    db.select({
      status: inventoryImportBatches.status,
      approvedAt: inventoryImportBatches.approvedAt,
      targetStoreId: inventoryImportBatches.targetStoreId,
    }).from(inventoryImportBatches).where(eq(inventoryImportBatches.id, batchId)),
    db.select({
      id: inventoryImportRows.id,
      rowStatus: inventoryImportRows.rowStatus,
      resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
      caseQuantity: inventoryImportRows.caseQuantity,
      innerPackQuantity: inventoryImportRows.innerPackQuantity,
      baseUnitQuantity: inventoryImportRows.baseUnitQuantity,
      baseUnit: inventoryImportRows.baseUnit,
    }).from(inventoryImportRows).where(eq(inventoryImportRows.batchId, batchId)).orderBy(inventoryImportRows.id),
    db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.companyId, ID.company)).orderBy(inventoryItems.id),
    db.select({ id: categories.id }).from(categories).where(eq(categories.companyId, ID.company)).orderBy(categories.id),
    db.select({ id: inventoryItemExternalMappings.id }).from(inventoryItemExternalMappings).where(eq(inventoryItemExternalMappings.companyId, ID.company)).orderBy(inventoryItemExternalMappings.id),
    db.select({ id: inventoryItemRelationships.id }).from(inventoryItemRelationships).where(eq(inventoryItemRelationships.companyId, ID.company)).orderBy(inventoryItemRelationships.id),
    db.select({ id: inventoryLocations.id }).from(inventoryLocations).where(eq(inventoryLocations.companyId, ID.company)).orderBy(inventoryLocations.id),
    db.select({ id: inventoryItemLocationAssignments.id }).from(inventoryItemLocationAssignments).where(eq(inventoryItemLocationAssignments.companyId, ID.company)).orderBy(inventoryItemLocationAssignments.id),
    db.select({ id: storeInventoryItems.id }).from(storeInventoryItems).where(eq(storeInventoryItems.companyId, ID.company)).orderBy(storeInventoryItems.id),
    db.select({ id: vendors.id }).from(vendors).where(eq(vendors.companyId, ID.company)).orderBy(vendors.id),
  ]);
  const vendorIds = vendorRows.map(row => row.id);
  const vendorItemRows = vendorIds.length
    ? await db.select({ id: vendorItems.id }).from(vendorItems).where(inArray(vendorItems.vendorId, vendorIds)).orderBy(vendorItems.id)
    : [];
  const vendorItemIds = vendorItemRows.map(row => row.id);
  const vendorExternalMappingIds = vendorItemIds.length
    ? await db.select({ id: vendorItemExternalMappings.id })
      .from(vendorItemExternalMappings)
      .where(and(
        eq(vendorItemExternalMappings.companyId, ID.company),
        inArray(vendorItemExternalMappings.vendorItemId, vendorItemIds),
      ))
      .orderBy(vendorItemExternalMappings.id)
    : [];

  return {
    batches,
    rows,
    itemIds,
    categoryIds,
    externalMappingIds,
    relationshipIds,
    locationIds,
    assignmentIds,
    storeItemIds,
    vendorRows,
    vendorItemRows,
    vendorExternalMappingIds,
  };
}


const approvalAuth = { actingUserId: ID.admin, companyId: ID.company };

beforeAll(async () => {
  if (SKIP) return;
  await ensureInventoryItemNumberSchema(db);
  await ensureOrderlyPackIdentityEvidenceSchema(db);
  await ensureOrderlyApprovalJobsSchema(db);
  await db.insert(companiesTable).values({ id: ID.company, name: `Orderly Identity ${RUN}` });
  await db.insert(companyStores).values({
    id: ID.store,
    companyId: ID.company,
    code: `OI${RUN}`.slice(0, 10),
    name: 'Bay Hill',
    status: 'active',
  });
  await db.insert(users).values({
    id: ID.admin,
    email: `orderly-identity-${RUN}@test.local`,
    role: 'company_admin',
    companyId: ID.company,
    active: 1,
  });
  await db.insert(companyStores).values({
    id: ID.storeB,
    companyId: ID.company,
    code: `OIB${RUN}`.slice(0, 10),
    name: 'Second Club',
    status: 'active',
  });
  await db.insert(importSourcePropertyBindings).values([
    {
      id: ID.binding,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property,
      sourcePropertyLabel: 'Bay Hill',
      destinationStoreId: ID.store,
      active: 1,
    },
    {
      id: ID.bindingB,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.propertyB,
      sourcePropertyLabel: 'Second Club',
      destinationStoreId: ID.storeB,
      active: 1,
    },
  ]);
});

afterAll(async () => {
  if (SKIP) return;
  const batches = await db
    .select({ id: inventoryImportBatches.id })
    .from(inventoryImportBatches)
    .where(eq(inventoryImportBatches.companyId, ID.company));
  const batchIds = batches.map(batch => batch.id);
  if (batchIds.length) {
    await db.delete(orderlyImportApprovalJobs).where(inArray(orderlyImportApprovalJobs.batchId, batchIds)).catch(() => {});
    await db.delete(inventoryImportRows).where(inArray(inventoryImportRows.batchId, batchIds)).catch(() => {});
  }
  const vendorRows = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(eq(vendors.companyId, ID.company));
  const vendorIds = vendorRows.map(vendor => vendor.id);
  await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.companyId, ID.company)).catch(() => {});
  await db.delete(storeInventoryItems).where(eq(storeInventoryItems.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryItemLocationAssignments).where(eq(inventoryItemLocationAssignments.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryItemExternalMappings).where(eq(inventoryItemExternalMappings.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryItemRelationships).where(eq(inventoryItemRelationships.companyId, ID.company)).catch(() => {});
  await db.delete(vendorItemExternalMappings).where(eq(vendorItemExternalMappings.companyId, ID.company)).catch(() => {});
  if (vendorIds.length) {
    await db.delete(vendorItems).where(inArray(vendorItems.vendorId, vendorIds)).catch(() => {});
  }
  await db.delete(inventoryItems).where(eq(inventoryItems.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryLocations).where(eq(inventoryLocations.companyId, ID.company)).catch(() => {});
  await db.delete(vendors).where(eq(vendors.companyId, ID.company)).catch(() => {});
  await db.delete(importSourcePropertyBindings).where(eq(importSourcePropertyBindings.companyId, ID.company)).catch(() => {});
  await db.delete(users).where(eq(users.id, ID.admin)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, ID.company)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, ID.company)).catch(() => {});
});

describe.skipIf(SKIP)('Orderly XLSX reliable Item Code identity', () => {
  it('makes a lost-response retry converge on one result without duplicating any approval writes', async () => {
    const batchId = await stageBatch([{
      code: `SAFE-RETRY-${RUN}`,
      description: `Safe Retry Item ${RUN}`,
      location: `Safe Retry Storage ${RUN}`,
      supplier: `Safe Retry Vendor ${RUN}`,
      caseQuantity: 6,
      innerPackQuantity: 1,
      baseUnitQuantity: 12,
      baseUnit: 'OZ',
      packagePrice: 36,
    }], '2028-01-31');

    const first = await claimApprovalJob(batchId, ID.company, ID.admin);
    expect(first.shouldRun).toBe(true);
    await db
      .update(orderlyImportApprovalJobs)
      .set({ status: 'timed_out', phase: 'stalled' })
      .where(eq(orderlyImportApprovalJobs.id, first.job.jobId));
    const reclaimed = await claimApprovalJob(batchId, ID.company, ID.admin);
    expect(reclaimed.shouldRun).toBe(true);
    expect(reclaimed.job.attemptCount).toBe(2);

    // The stale runner is fenced out before catalog mutation and cannot relabel
    // the reclaimed attempt as failed.
    await runApprovalJob(first.job.jobId, batchId, ID.company, ID.admin, 1, false);
    const [afterStaleRunner] = await db
      .select()
      .from(orderlyImportApprovalJobs)
      .where(eq(orderlyImportApprovalJobs.id, first.job.jobId));
    expect(afterStaleRunner).toMatchObject({ status: 'running', attemptCount: 2 });

    await runApprovalJob(
      reclaimed.job.jobId,
      batchId,
      ID.company,
      ID.admin,
      reclaimed.job.attemptCount,
      false,
    );
    const afterFirst = await approvalWriteSnapshot(batchId);

    const retry = await claimApprovalJob(batchId, ID.company, ID.admin);
    expect(retry.shouldRun).toBe(false);
    expect(retry.job.jobId).toBe(first.job.jobId);
    expect(retry.job.status).toBe('completed');
    expect(retry.job.attemptCount).toBe(2);
    expect(retry.job.result?.batchId).toBe(batchId);

    const afterRetry = await approvalWriteSnapshot(batchId);
    expect(afterRetry).toEqual(afterFirst);
  });

  it('serializes same-date approvals so only one unforced batch can commit', async () => {
    const firstBatch = await stageBatch([{
      code: `DATE-A-${RUN}`,
      description: `Date Serialized A ${RUN}`,
      location: 'Date Lock Storage',
    }], '2028-02-29');
    const secondBatch = await stageBatch([{
      code: `DATE-B-${RUN}`,
      description: `Date Serialized B ${RUN}`,
      location: 'Date Lock Storage',
    }], '2028-02-29');
    const [first, second] = await Promise.all([
      claimApprovalJob(firstBatch, ID.company, ID.admin),
      claimApprovalJob(secondBatch, ID.company, ID.admin),
    ]);

    await Promise.all([
      runApprovalJob(first.job.jobId, firstBatch, ID.company, ID.admin, first.job.attemptCount, false),
      runApprovalJob(second.job.jobId, secondBatch, ID.company, ID.admin, second.job.attemptCount, false),
    ]);

    const jobs = await db
      .select({ status: orderlyImportApprovalJobs.status })
      .from(orderlyImportApprovalJobs)
      .where(inArray(orderlyImportApprovalJobs.batchId, [firstBatch, secondBatch]));
    expect(jobs.map(job => job.status).sort()).toEqual(['completed', 'failed']);
    const approved = await db
      .select({ id: inventoryImportBatches.id })
      .from(inventoryImportBatches)
      .where(and(
        inArray(inventoryImportBatches.id, [firstBatch, secondBatch]),
        eq(inventoryImportBatches.status, 'approved'),
      ));
    expect(approved).toHaveLength(1);
  });

  it('recovers an expired running job without any browser status poll', async () => {
    const batchId = await stageBatch([{
      code: `RECOVER-${RUN}`,
      description: `Recovered Approval ${RUN}`,
      location: 'Recovery Storage',
    }], '2028-04-30');
    const claimed = await claimApprovalJob(batchId, ID.company, ID.admin);
    await db
      .update(orderlyImportApprovalJobs)
      .set({ timeoutAt: new Date(Date.now() - 1000) })
      .where(eq(orderlyImportApprovalJobs.id, claimed.job.jobId));

    expect(await recoverExpiredApprovalJobs()).toBe(1);
    const deadline = Date.now() + 10_000;
    let recoveredStatus = 'running';
    while (Date.now() < deadline) {
      const [job] = await db
        .select({ status: orderlyImportApprovalJobs.status })
        .from(orderlyImportApprovalJobs)
        .where(eq(orderlyImportApprovalJobs.id, claimed.job.jobId));
      recoveredStatus = job.status;
      if (recoveredStatus !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(recoveredStatus).toBe('completed');
  });

  it('serializes concurrent first claims onto one shared job', async () => {
    const batchId = await stageBatch([{
      code: `FIRST-CLAIM-${RUN}`,
      description: `Concurrent First Claim ${RUN}`,
      location: 'Claim Storage',
    }], '2028-05-31');

    const claims = await Promise.all([
      claimApprovalJob(batchId, ID.company, ID.admin),
      claimApprovalJob(batchId, ID.company, ID.admin),
    ]);
    expect(new Set(claims.map(claim => claim.job.jobId)).size).toBe(1);
    expect(claims.filter(claim => claim.shouldRun)).toHaveLength(1);

    const runner = claims.find(claim => claim.shouldRun)!;
    await runApprovalJob(
      runner.job.jobId,
      batchId,
      ID.company,
      ID.admin,
      runner.job.attemptCount,
      false,
    );
  });

  it('does not let an expired poll time out a concurrently reclaimed lease', async () => {
    const batchId = await stageBatch([{
      code: `POLL-RECLAIM-${RUN}`,
      description: `Poll Reclaim ${RUN}`,
      location: 'Poll Storage',
    }], '2028-06-30');
    const first = await claimApprovalJob(batchId, ID.company, ID.admin);
    await db
      .update(orderlyImportApprovalJobs)
      .set({ timeoutAt: new Date(Date.now() - 1000) })
      .where(eq(orderlyImportApprovalJobs.id, first.job.jobId));

    const [, reclaimed] = await Promise.all([
      getApprovalJob(batchId, ID.company),
      claimApprovalJob(batchId, ID.company, ID.admin),
    ]);
    expect(reclaimed.shouldRun).toBe(true);
    const current = await getApprovalJob(batchId, ID.company);
    expect(current).toMatchObject({
      jobId: first.job.jobId,
      status: 'running',
      attemptCount: 2,
    });

    await runApprovalJob(
      reclaimed.job.jobId,
      batchId,
      ID.company,
      ID.admin,
      reclaimed.job.attemptCount,
      false,
    );
  });

  it('keeps generated FnB item numbers out of public catalog payloads', () => {
    expect(insertInventoryItemSchema.shape).not.toHaveProperty('internalItemNumber');
    expect(
      insertInventoryItemSchema.partial().parse({ internalItemNumber: 100_001 }),
    ).not.toHaveProperty('internalItemNumber');
  });

  it('backfills legacy items and never rewinds the FnB number generator', async () => {
    const schemaName = `fnb_item_number_${RUN.toLowerCase()}`;
    await db.execute(sql.raw(`
      CREATE SCHEMA "${schemaName}";
      CREATE TABLE "${schemaName}"."inventory_items" (
        id TEXT PRIMARY KEY,
        internal_item_number INTEGER
      );
      INSERT INTO "${schemaName}"."inventory_items" (id, internal_item_number)
      VALUES ('legacy-null', NULL), ('legacy-existing', 500);
    `));

    try {
      await ensureInventoryItemNumberSchema(db, schemaName);
      await db.execute(sql.raw(`
        INSERT INTO "${schemaName}"."inventory_items" (id) VALUES ('after-first-run');
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM "${schemaName}"."inventory_items"
            WHERE internal_item_number IS NULL
          ) THEN
            RAISE EXCEPTION 'FnB number backfill left a null value';
          END IF;
          IF (SELECT COUNT(*) FROM "${schemaName}"."inventory_items")
             <> (SELECT COUNT(DISTINCT internal_item_number) FROM "${schemaName}"."inventory_items")
          THEN
            RAISE EXCEPTION 'FnB numbers are not unique after backfill';
          END IF;
        END $$;
        SELECT setval('${schemaName}.inventory_items_internal_number_seq'::regclass, 1000, true);
      `));

      await ensureInventoryItemNumberSchema(db, schemaName);
      await db.execute(sql.raw(`
        INSERT INTO "${schemaName}"."inventory_items" (id) VALUES ('after-rerun');
        DO $$
        BEGIN
          IF (
            SELECT internal_item_number FROM "${schemaName}"."inventory_items"
            WHERE id = 'after-rerun'
          ) <= 1000 THEN
            RAISE EXCEPTION 'FnB sequence moved backward during reconciliation';
          END IF;
        END $$;
      `));
    } finally {
      await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    }
  });

  it('creates canonical catalog geometry, costs, and raw provenance from complete Orderly packs', async () => {
    const batchId = await stageBatch([
      {
        code: `ML-500${RUN}`.slice(0, 20),
        description: `Pack Geometry ML ${RUN}`,
        location: 'Geometry Lab',
        packSizeRaw: '5/1 50ML',
        caseQuantity: 5,
        innerPackQuantity: 1,
        baseUnitQuantity: 50,
        baseUnit: 'ML',
        packagePrice: 25,
      },
      {
        code: `EA-212${RUN}`.slice(0, 20),
        description: `Pack Geometry EA ${RUN}`,
        location: 'Geometry Lab',
        packSizeRaw: '2/12 1EA',
        caseQuantity: 2,
        innerPackQuantity: 12,
        baseUnitQuantity: 1,
        baseUnit: 'EA',
        packagePrice: 24,
      },
      {
        code: `OZ-612${RUN}`.slice(0, 20),
        description: `Pack Geometry OZ ${RUN}`,
        location: 'Geometry Lab',
        packSizeRaw: '6/1 12OZ',
        caseQuantity: 6,
        innerPackQuantity: 1,
        baseUnitQuantity: 12,
        baseUnit: 'OZ',
        packagePrice: 36,
      },
    ], '2026-05-31');

    const result = await applyBatchApproval(batchId, approvalAuth);
    expect(result.itemsCreated).toBe(3);

    const approvedRows = await db
      .select({
        sourceItemCode: inventoryImportRows.sourceItemCode,
        inventoryItemId: inventoryImportRows.resolvedInventoryItemId,
      })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    const itemIds = approvedRows
      .map(row => row.inventoryItemId)
      .filter((id): id is string => Boolean(id));
    const items = await db
      .select({
        id: inventoryItems.id,
        unitId: inventoryItems.unitId,
        caseSize: inventoryItems.caseSize,
        containerSize: inventoryItems.containerSize,
        containerUnitId: inventoryItems.containerUnitId,
        casePkgCount: inventoryItems.casePkgCount,
        pricePerUnit: inventoryItems.pricePerUnit,
        avgCostPerUnit: inventoryItems.avgCostPerUnit,
      })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, itemIds));
    const unitIds = Array.from(new Set(items.flatMap(item => [
      item.unitId,
      item.containerUnitId,
    ].filter((id): id is string => Boolean(id)))));
    const unitRows = await db
      .select({ id: units.id, abbreviation: units.abbreviation })
      .from(units)
      .where(inArray(units.id, unitIds));
    const abbreviationById = new Map(unitRows.map(unit => [unit.id, unit.abbreviation.toUpperCase()]));
    const itemByCode = new Map(approvedRows.map(row => [
      row.sourceItemCode,
      items.find(item => item.id === row.inventoryItemId)!,
    ]));

    expect(itemByCode.get(`ML-500${RUN}`.slice(0, 20))).toMatchObject({
      caseSize: 250,
      containerSize: 50,
      casePkgCount: 5,
      pricePerUnit: 0.1,
      avgCostPerUnit: 0.1,
    });
    expect(itemByCode.get(`EA-212${RUN}`.slice(0, 20))).toMatchObject({
      caseSize: 24,
      containerSize: 1,
      casePkgCount: 24,
      pricePerUnit: 1,
      avgCostPerUnit: 1,
    });
    expect(itemByCode.get(`OZ-612${RUN}`.slice(0, 20))).toMatchObject({
      caseSize: 72,
      containerSize: 12,
      casePkgCount: 6,
      pricePerUnit: 0.5,
      avgCostPerUnit: 0.5,
    });
    for (const [code, expectedUnit] of [
      [`ML-500${RUN}`.slice(0, 20), 'ML'],
      [`EA-212${RUN}`.slice(0, 20), 'EA'],
      [`OZ-612${RUN}`.slice(0, 20), 'OZ'],
    ] as const) {
      const item = itemByCode.get(code)!;
      expect(abbreviationById.get(item.unitId)).toBe(expectedUnit);
      expect(abbreviationById.get(item.containerUnitId!)).toBe(expectedUnit);
    }

    const mappings = await db
      .select({
        sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
        packSizeRaw: inventoryItemExternalMappings.packSizeRaw,
        caseQuantity: inventoryItemExternalMappings.caseQuantity,
        innerPackQuantity: inventoryItemExternalMappings.innerPackQuantity,
        baseUnitQuantity: inventoryItemExternalMappings.baseUnitQuantity,
        baseUnit: inventoryItemExternalMappings.baseUnit,
      })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        inArray(inventoryItemExternalMappings.sourceExternalId, approvedRows.map(row => row.sourceItemCode!)),
      ));
    expect(mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packSizeRaw: '5/1 50ML',
        caseQuantity: 5,
        innerPackQuantity: 1,
        baseUnitQuantity: 50,
        baseUnit: 'ML',
      }),
      expect.objectContaining({ packSizeRaw: '2/12 1EA' }),
      expect.objectContaining({ packSizeRaw: '6/1 12OZ' }),
    ]));

    const followingBatch = await stageBatch([{
      code: `ML-500${RUN}`.slice(0, 20),
      description: `Pack Geometry ML ${RUN}`,
      location: 'Next Month',
      packSizeRaw: '5/1 50ML',
      caseQuantity: 5,
      innerPackQuantity: 1,
      baseUnitQuantity: 50,
      baseUnit: 'ML',
      packagePrice: 25,
    }], '2026-06-30');
    const followingPreview = await runResolutionPreview(followingBatch, ID.company);
    expect(followingPreview.rows[0].itemMatch).toMatchObject({
      strategy: 'external_mapping',
      requiresReview: false,
      sourcePackEvidence: {
        normalizedUnit: 'ML',
        totalBaseUnits: 250,
      },
    });
  });

  it('rehydrates measurable Case-count evidence before approval and reconciles an equivalent later pack', async () => {
    const sourceCode = `CASE-120-${RUN}`.slice(0, 20);
    const mayBatch = await stageBatch([{
      code: sourceCode,
      description: 'Captain Morgan Mini',
      location: 'Liquor Cage',
      packSizeRaw: '12/10 Case',
      caseQuantity: null,
      innerPackQuantity: null,
      baseUnitQuantity: null,
      baseUnit: null,
      packagePrice: 117.6,
    }], '2026-05-31');
    await db
      .update(inventoryImportRows)
      .set({ packParseStatus: 'unparseable' })
      .where(eq(inventoryImportRows.batchId, mayBatch));

    const mayPreview = await runResolutionPreview(mayBatch, ID.company);
    expect(mayPreview.rows[0]).toMatchObject({
      packSizeRaw: '12/10 Case',
      caseQuantity: 12,
      innerPackQuantity: 10,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packParseStatus: 'ok',
    });

    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({
        inventoryItemId: inventoryImportRows.resolvedInventoryItemId,
        caseQuantity: inventoryImportRows.caseQuantity,
        innerPackQuantity: inventoryImportRows.innerPackQuantity,
        baseUnitQuantity: inventoryImportRows.baseUnitQuantity,
        baseUnit: inventoryImportRows.baseUnit,
        packParseStatus: inventoryImportRows.packParseStatus,
      })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));
    expect(mayRow).toMatchObject({
      caseQuantity: 12,
      innerPackQuantity: 10,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packParseStatus: 'ok',
    });
    const [mayItem] = await db
      .select({
        caseSize: inventoryItems.caseSize,
        containerSize: inventoryItems.containerSize,
        casePkgCount: inventoryItems.casePkgCount,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, mayRow.inventoryItemId!));
    expect(mayItem).toEqual({
      caseSize: 120,
      containerSize: 1,
      casePkgCount: 120,
    });

    const [mayMapping] = await db
      .select({
        packSizeRaw: inventoryItemExternalMappings.packSizeRaw,
        caseQuantity: inventoryItemExternalMappings.caseQuantity,
        innerPackQuantity: inventoryItemExternalMappings.innerPackQuantity,
        baseUnitQuantity: inventoryItemExternalMappings.baseUnitQuantity,
        baseUnit: inventoryItemExternalMappings.baseUnit,
      })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourceExternalId, sourceCode),
      ));
    expect(mayMapping).toEqual({
      packSizeRaw: '12/10 Case',
      caseQuantity: 12,
      innerPackQuantity: 10,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
    });

    const juneBatch = await stageBatch([{
      code: sourceCode,
      description: 'Captain Morgan Mini',
      location: 'Banquet Bar',
      packSizeRaw: '1/120 EA',
      caseQuantity: null,
      innerPackQuantity: null,
      baseUnitQuantity: null,
      baseUnit: null,
      packagePrice: 117.6,
    }], '2026-06-30');
    await db
      .update(inventoryImportRows)
      .set({ packParseStatus: 'unparseable' })
      .where(eq(inventoryImportRows.batchId, juneBatch));

    const junePreview = await runResolutionPreview(juneBatch, ID.company);
    expect(junePreview.rows[0].itemMatch).toMatchObject({
      strategy: 'external_mapping',
      matchedId: mayRow.inventoryItemId,
      requiresReview: false,
    });
    expect(junePreview.rows[0].itemMatch.sourcePackEvidence).toMatchObject({
      normalizedUnit: 'EA',
      totalBaseUnits: 120,
    });

    const juneResult = await applyBatchApproval(juneBatch, approvalAuth);
    expect(juneResult.itemsCreated).toBe(0);
    const [juneRow] = await db
      .select({ inventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, juneBatch));
    expect(juneRow.inventoryItemId).toBe(mayRow.inventoryItemId);
  });

  it.each([
    [
      'incomplete geometry',
      { caseQuantity: 5, innerPackQuantity: null, baseUnitQuantity: 50, baseUnit: 'ML' },
    ],
    [
      'an unknown unit',
      { caseQuantity: 1, innerPackQuantity: 1, baseUnitQuantity: 1, baseUnit: 'FURLONG' },
    ],
  ])('imports a new item with %s using explicitly unknown pack geometry', async (_label, geometry) => {
    const batchId = await stageBatch([{
      code: `BAD-${batchSequence}-${RUN}`.slice(0, 24),
      description: `Invalid Geometry ${batchSequence} ${RUN}`,
      location: 'Geometry Lab',
      ...geometry,
    }], '2026-05-31');
    const before = await approvalWriteSnapshot(batchId);

    const result = await applyBatchApproval(batchId, approvalAuth);
    const after = await approvalWriteSnapshot(batchId);

    expect(result).toMatchObject({
      itemsCreated: 1,
      itemsLinked: 0,
      rowsHeldForReview: 0,
      rowsProcessed: 1,
      storeItemsCreated: 1,
      storeItemsSkipped: 0,
    });
    expect(after.batches[0]).toMatchObject({ status: 'approved' });
    expect(after.rows[0]).toMatchObject({
      ...geometry,
    });
    expect(after.rows[0].resolvedInventoryItemId).toBeTruthy();
    expect(after.itemIds).toHaveLength(before.itemIds.length + 1);
    expect(after.externalMappingIds).toHaveLength(before.externalMappingIds.length + 2);
    expect(after.relationshipIds).toEqual(before.relationshipIds);
    expect(after.assignmentIds).toHaveLength(before.assignmentIds.length + 1);
    expect(after.storeItemIds).toHaveLength(before.storeItemIds.length + 1);
    expect(after.vendorItemRows).toEqual(before.vendorItemRows);
    expect(after.vendorExternalMappingIds).toEqual(before.vendorExternalMappingIds);

    const [item] = await db
      .select({
        caseSize: inventoryItems.caseSize,
        containerSize: inventoryItems.containerSize,
        containerUnitId: inventoryItems.containerUnitId,
        casePkgCount: inventoryItems.casePkgCount,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, after.rows[0].resolvedInventoryItemId!));
    expect(item).toEqual({
      caseSize: 1,
      containerSize: null,
      containerUnitId: null,
      casePkgCount: null,
    });

    const nextBatch = await stageBatch([{
      code: `BAD-${batchSequence - 1}-${RUN}`.slice(0, 24),
      description: `Invalid Geometry ${batchSequence - 1} ${RUN}`,
      location: 'Geometry Lab',
      ...geometry,
    }], '2026-06-30');
    const nextPreview = await runResolutionPreview(nextBatch, ID.company);
    expect(nextPreview.rows[0].itemMatch).toMatchObject({
      strategy: 'external_mapping',
      matchedId: after.rows[0].resolvedInventoryItemId,
      sourcePackEvidence: {
        totalBaseUnits: null,
      },
    });
    expect(nextPreview.rows[0].itemMatch.packCompatibility).toBeUndefined();
  });

  it('creates one Chambord-equivalent item and preserves five location records in one workbook', async () => {
    const batchId = await stageBatch([
      { code: '9684722', description: 'Chambord', location: 'Liquor Cage', innerPackQuantity: 6 },
      { code: '9684722', description: 'Chambord', location: 'Bay Window Bar', innerPackQuantity: 0.3 },
      { code: '9684722', description: 'Chambord', location: 'Mens Locker Room', innerPackQuantity: 0 },
      { code: '9684722', description: 'Chambord', location: 'Member Lounge', innerPackQuantity: 6 },
      { code: '9684722', description: 'Chambord', location: 'Pool Cafe', innerPackQuantity: 0 },
    ], '2026-05-31');

    const preview = await runResolutionPreview(batchId, ID.company);
    expect(preview.identitySummary.uniqueReliableCodes).toBe(1);
    expect(preview.identitySummary.sameCodeCrossLocationGroups).toBe(1);
    expect(preview.identitySummary.packNotationCompatibilityWarnings).toBe(1);
    expect(preview.identitySummary.conflictingReliableCodeGroups).toEqual([]);

    const result = await applyBatchApproval(batchId, approvalAuth);
    expect(result.itemsCreated).toBe(1);

    const rows = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    const itemIds = new Set(rows.map(row => row.resolvedInventoryItemId));
    expect(itemIds.size).toBe(1);
    const [itemId] = [...itemIds];
    expect(itemId).toBeTruthy();
    chambordItemId = itemId ?? null;

    const mappings = await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourceExternalId, '9684722'),
      ));
    expect(mappings).toEqual([{ inventoryItemId: itemId }]);

    const assignments = await db
      .select({ locationId: inventoryItemLocationAssignments.locationId })
      .from(inventoryItemLocationAssignments)
      .where(eq(inventoryItemLocationAssignments.inventoryItemId, itemId!));
    expect(assignments).toHaveLength(5);
  });

  it('reuses the same item for a later month and an equivalent re-import', async () => {
    const expectedId = chambordItemId;
    expect(expectedId).toBeTruthy();

    const juneBatch = await stageBatch([
      { code: '9684722', description: 'Chambord', location: 'Liquor Cage', innerPackQuantity: 6 },
      { code: '9684722', description: 'Chambord', location: 'Pool Cafe', innerPackQuantity: 0.3 },
    ], '2026-06-30');
    const juneResult = await applyBatchApproval(juneBatch, approvalAuth);
    expect(juneResult.itemsCreated).toBe(0);

    const reimportBatch = await stageBatch([
      { code: '9684722', description: 'Chambord', location: 'Liquor Cage', innerPackQuantity: 6 },
    ], '2026-07-31');
    const reimportResult = await applyBatchApproval(reimportBatch, approvalAuth);
    expect(reimportResult.itemsCreated).toBe(0);

    const laterRows = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(inArray(inventoryImportRows.batchId, [juneBatch, reimportBatch]));
    expect(new Set(laterRows.map(row => row.resolvedInventoryItemId))).toEqual(new Set([expectedId]));
  });

  it('uses a later safe existing match for the whole reliable-code group, regardless of row order', async () => {
    const knownBatch = await stageBatch([
      { code: 'KNOWN-7000000', description: 'Known Product', location: 'Bar Back' },
    ], '2026-08-01');
    await applyBatchApproval(knownBatch, approvalAuth);
    const [knownRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, knownBatch));
    expect(knownRow.resolvedInventoryItemId).toBeTruthy();

    const groupedBatch = await stageBatch([
      { code: '7000001', description: 'Known Product Reserve', location: 'Liquor Cage' },
      { code: '7000001', description: 'Known Product', location: 'Pool Cafe' },
    ], '2026-08-15');
    const preview = await runResolutionPreview(groupedBatch, ID.company);
    const recodeCandidateId = preview.rows[1].itemMatch.possibleRecodeMatchedId;
    expect(recodeCandidateId).toBe(knownRow.resolvedInventoryItemId);
    const result = await applyBatchApproval(groupedBatch, approvalAuth, [{
      rowIndex: preview.rows[1].rowIndex,
      action: 'link_existing',
      inventoryItemId: recodeCandidateId,
    }]);
    expect(result.itemsCreated).toBe(0);

    const rows = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, groupedBatch));
    expect(rows.map(row => row.resolvedInventoryItemId)).toEqual([
      knownRow.resolvedInventoryItemId,
      knownRow.resolvedInventoryItemId,
    ]);
  });

  it('keeps a second authorized property identical Item Code as a separate item', async () => {
    // Same reliable code as the Chambord-equivalent group, but exported by a
    // different authorized Orderly club for a different product.
    const batchId = await stageBatch([
      { code: '9684722', description: 'Club Soda Case', location: 'Second Club Bar', caseQuantity: 24, baseUnit: 'EA' },
    ], '2026-05-31', 'B');

    const preview = await runResolutionPreview(batchId, ID.company);
    // Property A's mapping must not resolve property B's row.
    expect(preview.rows[0].itemMatch.strategy).not.toBe('external_mapping');

    const result = await applyBatchApproval(batchId, approvalAuth);
    expect(result.itemsCreated).toBe(1);

    const mappings = await db
      .select({
        sourcePropertyId: inventoryItemExternalMappings.sourcePropertyId,
        inventoryItemId: inventoryItemExternalMappings.inventoryItemId,
      })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourceExternalId, '9684722'),
      ));
    expect(mappings).toHaveLength(2);
    expect(new Set(mappings.map(m => m.sourcePropertyId))).toEqual(new Set([ID.property, ID.propertyB]));
    expect(new Set(mappings.map(m => m.inventoryItemId)).size).toBe(2);
  });

  it('creates only one item when two approvals of the same code run concurrently', async () => {
    const code = `7300${RUN}`.slice(0, 12);
    const [batchOne, batchTwo] = await Promise.all([
      stageBatch([{ code, description: 'Concurrent Product', location: 'Liquor Cage' }], '2026-10-31'),
      stageBatch([{ code, description: 'Concurrent Product', location: 'Pool Cafe' }], '2026-10-31'),
    ]);

    // Both previews are computed before either transaction commits, which is
    // exactly the race that previously produced duplicate inventory items.
    const settled = await Promise.allSettled([
      applyBatchApproval(batchOne, approvalAuth),
      applyBatchApproval(batchTwo, approvalAuth),
    ]);
    const succeeded = settled.filter(r => r.status === 'fulfilled');
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const mappings = await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourcePropertyId, ID.property),
        eq(inventoryItemExternalMappings.sourceExternalId, code),
      ));
    expect(mappings).toHaveLength(1);

    const items = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(
        eq(inventoryItems.companyId, ID.company),
        eq(inventoryItems.name, 'Concurrent Product'),
      ));
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(mappings[0].inventoryItemId);

    const rows = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(and(
        inArray(inventoryImportRows.batchId, [batchOne, batchTwo]),
        eq(inventoryImportRows.sourceItemCode, code),
      ));
    for (const row of rows) {
      if (row.resolvedInventoryItemId != null) {
        expect(row.resolvedInventoryItemId).toBe(items[0].id);
      }
    }
  });

  it('converges on one identity when concurrent approvals match the same code to different existing items', async () => {
    const code = `7400${RUN}`.slice(0, 12);
    // Two distinct pre-existing catalog items. Each batch's own description
    // matches a different one, so without a mapping authority the two
    // approvals would link the same code to two different items.
    const [itemA] = await db
      .insert(inventoryItems)
      .values({
        companyId: ID.company,
        name: 'Divergent Match Alpha',
        unitId: await eachUnitId(),
        caseSize: 6,
        pricePerUnit: 30,
        avgCostPerUnit: 30,
        active: 1,
        yieldPercent: 100,
      })
      .returning({ id: inventoryItems.id });
    const [itemB] = await db
      .insert(inventoryItems)
      .values({
        companyId: ID.company,
        name: 'Divergent Match Beta',
        unitId: await eachUnitId(),
        caseSize: 6,
        pricePerUnit: 30,
        avgCostPerUnit: 30,
        active: 1,
        yieldPercent: 100,
      })
      .returning({ id: inventoryItems.id });
    // Existing catalog items need confirmed source-pack evidence before a new
    // source code can be linked to them as a re-code.
    await db.insert(inventoryItemExternalMappings).values([
      {
        companyId: ID.company,
        inventoryItemId: itemA.id,
        sourceSystem: 'ORDERLY',
        sourcePropertyId: ID.property,
        sourceExternalId: `prior-alpha-${RUN}`,
        sourceDescription: 'Divergent Match Alpha',
        caseQuantity: 6,
        innerPackQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'ML',
        matchStrategy: 'manual',
      },
      {
        companyId: ID.company,
        inventoryItemId: itemB.id,
        sourceSystem: 'ORDERLY',
        sourcePropertyId: ID.property,
        sourceExternalId: `prior-beta-${RUN}`,
        sourceDescription: 'Divergent Match Beta',
        caseQuantity: 6,
        innerPackQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'ML',
        matchStrategy: 'manual',
      },
    ]);

    const [batchA, batchB] = await Promise.all([
      stageBatch([{ code, description: 'Divergent Match Alpha', location: 'Liquor Cage' }], '2026-12-31'),
      stageBatch([{ code, description: 'Divergent Match Beta', location: 'Pool Cafe' }], '2026-12-31'),
    ]);

    // Both approvals must succeed. Asserting this (rather than tolerating a
    // rejection) stops a future failure in one approval from being masked
    // while the postconditions below still happen to hold.
    const settled = await Promise.allSettled([
      applyBatchApproval(batchA, approvalAuth, [{
        rowIndex: 1,
        action: 'link_existing',
        inventoryItemId: itemA.id,
      }]),
      applyBatchApproval(batchB, approvalAuth, [{
        rowIndex: 1,
        action: 'link_existing',
        inventoryItemId: itemB.id,
      }]),
    ]);
    expect(settled.map(r => r.status)).toEqual(['fulfilled', 'fulfilled']);

    const mappings = await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourcePropertyId, ID.property),
        eq(inventoryItemExternalMappings.sourceExternalId, code),
      ));
    expect(mappings).toHaveLength(1);
    const winner = mappings[0].inventoryItemId;
    expect([itemA.id, itemB.id]).toContain(winner);

    // Losing the identity race must never delete a pre-existing catalog item.
    const survivors = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(
        eq(inventoryItems.companyId, ID.company),
        inArray(inventoryItems.id, [itemA.id, itemB.id]),
      ));
    expect(new Set(survivors.map(s => s.id))).toEqual(new Set([itemA.id, itemB.id]));

    // Every approved row for this code must adopt the mapping winner.
    const rows = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(and(
        inArray(inventoryImportRows.batchId, [batchA, batchB]),
        eq(inventoryImportRows.sourceItemCode, code),
      ));
    for (const row of rows) {
      if (row.resolvedInventoryItemId != null) {
        expect(row.resolvedInventoryItemId).toBe(winner);
      }
    }
  });

  it('adopts a mapping that was committed after the preview was computed', async () => {
    const code = `7500${RUN}`.slice(0, 12);
    const [existing] = await db
      .insert(inventoryItems)
      .values({
        companyId: ID.company,
        name: 'Late Mapping Winner',
        unitId: await eachUnitId(),
        caseSize: 6,
        pricePerUnit: 30,
        avgCostPerUnit: 30,
        active: 1,
        yieldPercent: 100,
      })
      .returning({ id: inventoryItems.id });

    const batchId = await stageBatch(
      [{ code, description: 'Completely Unrelated Description', location: 'Liquor Cage' }],
      '2027-01-31',
    );
    // Preview sees no mapping for this code.
    const preview = await runResolutionPreview(batchId, ID.company);
    expect(preview.rows[0].itemMatch.strategy).not.toBe('external_mapping');

    // A concurrent approval commits the mapping between preview and approval.
    await db.insert(inventoryItemExternalMappings).values({
      companyId: ID.company,
      inventoryItemId: existing.id,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property,
      sourceExternalId: code,
      sourceDescription: 'Late Mapping Winner',
      matchStrategy: 'manual',
    });

    const result = await applyBatchApproval(batchId, approvalAuth);
    expect(result.itemsCreated).toBe(0);

    const rows = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    expect(rows.map(row => row.resolvedInventoryItemId)).toEqual([existing.id]);

    const mappings = await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourcePropertyId, ID.property),
        eq(inventoryItemExternalMappings.sourceExternalId, code),
      ));
    expect(mappings).toEqual([{ inventoryItemId: existing.id }]);
  });

  it('flags a conflict between two later rows that are each compatible with the first row', async () => {
    // Row 1 has no usable description/unit evidence, so rows 2 and 3 are each
    // individually compatible with it while conflicting with each other.
    const batchId = await stageBatch([
      { code: '8800001', description: '', location: 'Dry Storeroom', caseQuantity: 0, baseUnit: '' },
      { code: '8800001', description: 'Kosher Salt Box', location: 'Dry Storeroom', caseQuantity: 12, baseUnit: 'LB' },
      { code: '8800001', description: 'Espresso Beans Bag', location: 'Main Kitchen', caseQuantity: 4, baseUnit: 'KG' },
    ], '2026-11-30');

    const preview = await runResolutionPreview(batchId, ID.company);
    expect(preview.identitySummary.conflictingReliableCodeGroups).toHaveLength(1);
    expect(preview.identitySummary.conflictingReliableCodeGroups[0].sourceItemCode).toBe('8800001');

    await expect(applyBatchApproval(batchId, approvalAuth)).rejects.toMatchObject<Partial<ImportApprovalError>>({
      code: 'CONFLICT',
    });
  });

  it('creates one FnB-numbered item for a new blank-code multi-location group', async () => {
    const batchId = await stageBatch([
      { code: null, description: 'House Cabernet', location: 'Member Lounge' },
      { code: null, description: 'House Cabernet', location: 'Pool Cafe' },
    ], '2026-08-31');

    const preview = await runResolutionPreview(batchId, ID.company);
    expect(preview.identitySummary.blankCodeRows).toBe(2);
    expect(preview.identitySummary.blankCodeUnresolved).toBe(0);
    expect(preview.summary.itemsWillCreate).toBe(1);
    expect(preview.identitySummary.blankCodeClassification).toEqual({
      confirmed: { rows: 2, valueTotal: 60 },
      reviewable: { rows: 0, valueTotal: 0 },
      conflicted: { rows: 0, valueTotal: 0 },
      held: { rows: 0, valueTotal: 0 },
    });
    expect(preview.summary.itemsHeldForReview).toBe(0);
    expect(preview.rows.map(row => ({
      heldForReview: row.heldForReview,
      holdReason: row.holdReason,
    }))).toEqual([
      { heldForReview: false, holdReason: null },
      { heldForReview: false, holdReason: null },
    ]);

    const result = await applyBatchApproval(batchId, approvalAuth);
    expect(result.itemsCreated).toBe(1);
    expect(result.rowsHeldForReview).toBe(0);
    const rows = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    expect(new Set(rows.map(row => row.resolvedInventoryItemId)).size).toBe(1);
    const [resolvedItemId] = rows.map(row => row.resolvedInventoryItemId);
    expect(resolvedItemId).toBeTruthy();
    const [createdItem] = await db
      .select({ internalItemNumber: inventoryItems.internalItemNumber })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, resolvedItemId!));
    expect(createdItem.internalItemNumber).toBeTypeOf('number');
    expect(createdItem.internalItemNumber).toBeGreaterThan(0);
  });

  it('creates one coded identity and reconciles its blank-code location sibling', async () => {
    const batchId = await stageBatch([
      { code: null, description: `Evidence-led Cabernet ${RUN}`, location: 'Member Lounge', caseQuantity: 6, baseUnit: 'ML' },
      { code: `ALT-7-${RUN}`, description: `Evidence-led Cabernet ${RUN}`, location: 'Pool Cafe', caseQuantity: 6, baseUnit: 'ML' },
    ], '2026-10-31');

    const preview = await runResolutionPreview(batchId, ID.company);
    expect(preview.identitySummary.blankCodeGroupsWithCodedSibling).toBe(1);
    expect(preview.identitySummary.identityGroupsNewCandidates).toBe(1);
    expect(preview.identitySummary.blankCodeClassification.confirmed).toEqual({
      rows: 1,
      valueTotal: 30,
    });
    const blankRow = preview.rows.find(row => row.itemCodeStatus === 'blank');
    expect(blankRow?.identityGroupRows).toHaveLength(2);
    expect(blankRow?.heldForReview).toBe(false);
    expect(blankRow?.holdReason).toBeNull();
    expect(preview.identitySummary.blankCodeSafelyMatched).toBe(1);
    expect(preview.identitySummary.blankCodeUnresolved).toBe(0);
    expect(preview.summary.itemsHeldForReview).toBe(0);

    const result = await applyBatchApproval(batchId, approvalAuth);
    expect(result.itemsCreated).toBe(1);
    expect(result.rowsHeldForReview).toBe(0);

    const rows = await db
      .select({
        resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
      })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    expect(rows[0].resolvedInventoryItemId).toBeTruthy();
    expect(rows[0].resolvedInventoryItemId).toBe(rows[1].resolvedInventoryItemId);

    const mappings = await db
      .select({ sourceExternalId: inventoryItemExternalMappings.sourceExternalId })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourcePropertyId, ID.property),
        eq(inventoryItemExternalMappings.inventoryItemId, rows[0].resolvedInventoryItemId!),
      ));
    expect(mappings.map(mapping => mapping.sourceExternalId)).toEqual(expect.arrayContaining([
      `ALT-7-${RUN}`,
      expect.stringMatching(/^ALT\|evidence led cabernet /),
    ]));
  });

  it('keeps a blank row held when multiple coded siblings could establish its identity', async () => {
    const batchId = await stageBatch([
      { code: null, description: `Multiple Code Evidence ${RUN}`, location: 'Member Lounge', caseQuantity: 6, baseUnit: 'ML' },
      { code: `MULTI-A-7-${RUN}`, description: `Multiple Code Evidence ${RUN}`, location: 'Pool Cafe', caseQuantity: 6, baseUnit: 'ML' },
      { code: `MULTI-B-7-${RUN}`, description: `Multiple Code Evidence ${RUN}`, location: 'Main Kitchen', caseQuantity: 6, baseUnit: 'ML' },
    ], '2026-11-15');

    const preview = await runResolutionPreview(batchId, ID.company);
    const blankRow = preview.rows.find(row => row.itemCodeStatus === 'blank');
    expect(preview.identitySummary.blankCodeClassification).toEqual({
      confirmed: { rows: 0, valueTotal: 0 },
      reviewable: { rows: 0, valueTotal: 0 },
      conflicted: { rows: 0, valueTotal: 0 },
      held: { rows: 1, valueTotal: 30 },
    });
    expect(preview.summary.itemsHeldForReview).toBe(1);
    expect(blankRow?.heldForReview).toBe(true);

    const result = await applyBatchApproval(batchId, approvalAuth);
    expect(result.rowsHeldForReview).toBe(1);

    const rows = await db
      .select({
        sourceItemCode: inventoryImportRows.sourceItemCode,
        resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
      })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    const resolvedByCode = new Map(rows.map(row => [row.sourceItemCode, row.resolvedInventoryItemId]));
    expect(resolvedByCode.get(null)).toBeNull();
    expect(resolvedByCode.get(`MULTI-A-7-${RUN}`)).toBeTruthy();
    expect(resolvedByCode.get(`MULTI-B-7-${RUN}`)).toBeTruthy();
  });

  it('does not let a direct blank-row match resolve another blank row in the same group', async () => {
    const unitId = await eachUnitId();
    const description = `Blank Group Location Evidence ${RUN}`;
    const [{ id: locationMatchedCandidateId }, { id: otherCandidateId }] = await db
      .insert(inventoryItems)
      .values([
        {
          companyId: ID.company,
          name: description,
          unitId,
          caseSize: 6,
          pricePerUnit: 30,
          avgCostPerUnit: 30,
          active: 1,
          yieldPercent: 100,
        },
        {
          companyId: ID.company,
          name: description,
          unitId,
          caseSize: 6,
          pricePerUnit: 30,
          avgCostPerUnit: 30,
          active: 1,
          yieldPercent: 100,
        },
      ])
      .returning({ id: inventoryItems.id });
    const locationId = `oid-location-${RUN}`;
    const historicalLocation = `History Bar ${RUN}`;
    await db.insert(inventoryLocations).values({
      id: locationId,
      companyId: ID.company,
      name: historicalLocation,
      normalizedName: historicalLocation.toLowerCase(),
      active: 1,
    });
    await db.insert(inventoryItemLocationAssignments).values({
      companyId: ID.company,
      inventoryItemId: locationMatchedCandidateId,
      locationId,
      active: 1,
    });

    const batchId = await stageBatch([
      { code: null, description, location: historicalLocation, caseQuantity: 6, baseUnit: 'ML' },
      { code: null, description, location: `New Bar ${RUN}`, caseQuantity: 6, baseUnit: 'ML' },
    ], '2026-11-20');

    const preview = await runResolutionPreview(batchId, ID.company);
    const matchedBlank = preview.rows.find(row => row.storageLocation === historicalLocation);
    const unresolvedBlank = preview.rows.find(row => row.storageLocation === `New Bar ${RUN}`);
    expect(matchedBlank?.itemMatch.strategy).toBe('location_history');
    expect(matchedBlank?.heldForReview).toBe(false);
    expect(unresolvedBlank?.itemMatch.confidence).toBe('ambiguous');
    expect(unresolvedBlank?.heldForReview).toBe(true);
    expect(preview.identitySummary.blankCodeClassification).toEqual({
      confirmed: { rows: 1, valueTotal: 30 },
      reviewable: { rows: 0, valueTotal: 0 },
      conflicted: { rows: 1, valueTotal: 30 },
      held: { rows: 0, valueTotal: 0 },
    });
    expect(preview.summary.itemsHeldForReview).toBe(1);

    const result = await applyBatchApproval(batchId, approvalAuth);
    expect(result.itemsLinked).toBe(1);
    expect(result.rowsHeldForReview).toBe(1);

    const rows = await db
      .select({
        storageLocation: inventoryImportRows.storageLocation,
        resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
      })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    const resolvedByLocation = new Map(rows.map(row => [row.storageLocation, row.resolvedInventoryItemId]));
    expect(resolvedByLocation.get(historicalLocation)).toBe(locationMatchedCandidateId);
    expect(resolvedByLocation.get(`New Bar ${RUN}`)).toBeNull();
    expect(otherCandidateId).not.toBe(locationMatchedCandidateId);
  });

  it('allows explicit links for ambiguous/fuzzy blanks and numbers a genuinely new blank group', async () => {
    const unitId = await eachUnitId();
    const [ambiguousA] = await db
      .insert(inventoryItems)
      .values({
        companyId: ID.company,
        name: `Held Ambiguous ${RUN}`,
        unitId,
        caseSize: 6,
        pricePerUnit: 30,
        avgCostPerUnit: 30,
        active: 1,
        yieldPercent: 100,
      })
      .returning({ id: inventoryItems.id });
    await db.insert(inventoryItems).values({
      companyId: ID.company,
      name: `Held Ambiguous ${RUN}`,
      unitId,
      caseSize: 6,
      pricePerUnit: 30,
      avgCostPerUnit: 30,
      active: 1,
      yieldPercent: 100,
    });
    const [fuzzyCandidate] = await db
      .insert(inventoryItems)
      .values({
        companyId: ID.company,
        name: `Held Fuzzy ${RUN} Special Variant`,
        unitId,
        caseSize: 6,
        pricePerUnit: 30,
        avgCostPerUnit: 30,
        active: 1,
        yieldPercent: 100,
      })
      .returning({ id: inventoryItems.id });

    const batchId = await stageBatch([
      { code: null, description: `Held Ambiguous ${RUN}`, location: 'Member Lounge' },
      { code: null, description: `Held Fuzzy ${RUN}`, location: 'Pool Cafe' },
      { code: null, description: `Held Unlinked Evidence ${RUN}`, location: 'Main Kitchen' },
    ], '2026-09-15');
    const preview = await runResolutionPreview(batchId, ID.company);
    const ambiguousRow = preview.rows.find(row => (
      row.itemMatch.confidence === 'ambiguous' && row.itemMatch.candidateIds.includes(ambiguousA.id)
    ));
    const fuzzyRow = preview.rows.find(row => (
      row.itemMatch.strategy === 'fuzzy' && row.itemMatch.matchedId === fuzzyCandidate.id
    ));
    const unlinkedRow = preview.rows.find(row => row.cleanedDescription === `Held Unlinked Evidence ${RUN}`);

    expect(ambiguousRow?.heldForReview).toBe(true);
    expect(fuzzyRow?.heldForReview).toBe(true);
    expect(unlinkedRow?.heldForReview).toBe(false);

    const result = await applyBatchApproval(batchId, approvalAuth, [
      { rowIndex: ambiguousRow!.rowIndex, inventoryItemId: ambiguousA.id },
      { rowIndex: fuzzyRow!.rowIndex, inventoryItemId: fuzzyCandidate.id },
    ]);
    expect(result.itemsCreated).toBe(1);
    expect(result.itemsLinked).toBe(2);
    expect(result.rowsHeldForReview).toBe(0);

    const rows = await db
      .select({
        rowIndex: inventoryImportRows.rowIndex,
        resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
      })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    const resolvedByIndex = new Map(rows.map(row => [row.rowIndex, row.resolvedInventoryItemId]));
    expect(resolvedByIndex.get(ambiguousRow!.rowIndex)).toBe(ambiguousA.id);
    expect(resolvedByIndex.get(fuzzyRow!.rowIndex)).toBe(fuzzyCandidate.id);
    const generatedItemId = resolvedByIndex.get(unlinkedRow!.rowIndex);
    expect(generatedItemId).toBeTruthy();
    const [generatedItem] = await db
      .select({ internalItemNumber: inventoryItems.internalItemNumber })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, generatedItemId!));
    expect(generatedItem.internalItemNumber).toBeGreaterThan(0);
  });

  it('returns a review conflict for incompatible same-code evidence and reports same-location duplicates separately', async () => {
    const batchId = await stageBatch([
      { code: '6115315', description: 'Sweet n Low', location: 'Dry Storeroom', caseQuantity: 1, baseUnit: 'EA', totalCost: 10 },
      { code: '6115315', description: 'Sweet n Low', location: 'Dry Storeroom', caseQuantity: 1, baseUnit: 'EA', totalCost: 10 },
      { code: '6115315', description: 'Ground Beef', location: 'Main Freezer', caseQuantity: 20, baseUnit: 'LB', totalCost: 80 },
    ], '2026-09-30');

    const preview = await runResolutionPreview(batchId, ID.company);
    expect(preview.identitySummary.sameCodeSameLocationDuplicateGroups).toBe(1);
    expect(preview.identitySummary.sameLocationDuplicateRowCount).toBe(1);
    expect(preview.identitySummary.sameLocationDuplicateSourceValueTotal).toBe(20);
    expect(preview.identitySummary.conflictingReliableCodeGroups).toHaveLength(1);

    const before = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(eq(inventoryItems.companyId, ID.company));
    await expect(applyBatchApproval(batchId, approvalAuth)).rejects.toMatchObject<Partial<ImportApprovalError>>({
      code: 'CONFLICT',
    });
    const after = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(eq(inventoryItems.companyId, ID.company));
    expect(after).toEqual(before); // conflict review must not mutate inventory identities
  });

  it('keeps an incompatible Casamigos pack as a separate comparable variant', async () => {
    const mayBatch = await stageBatch([
      {
        code: '446128',
        description: "Casamigo's Blanco",
        location: 'Liquor Cage',
        caseQuantity: 6,
        innerPackQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'LT',
      },
    ], '2026-05-31');
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));
    expect(mayRow.resolvedInventoryItemId).toBeTruthy();

    const juneBatch = await stageBatch([
      {
        code: '446117',
        description: "Casamigo's Blanco",
        location: 'Liquor Cage',
        caseQuantity: 5,
        innerPackQuantity: 1,
        baseUnitQuantity: 50,
        baseUnit: 'ML',
      },
    ], '2026-06-30');
    const preview = await runResolutionPreview(juneBatch, ID.company);
    expect(preview.rows[0].itemMatch.packCompatibility).toBe('incompatible');
    expect(preview.rows[0].itemMatch.candidatePackEvidence).toMatchObject({
      caseQuantity: 6,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'LT',
      normalizedUnit: 'ML',
      totalBaseUnits: 6000,
    });
    expect(preview.rows[0].itemMatch.sourcePackEvidence).toMatchObject({
      caseQuantity: 5,
      innerPackQuantity: 1,
      baseUnitQuantity: 50,
      baseUnit: 'ML',
      normalizedUnit: 'ML',
      totalBaseUnits: 250,
    });

    await expect(applyBatchApproval(juneBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'link_existing',
      inventoryItemId: mayRow.resolvedInventoryItemId,
    }])).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });

    await applyBatchApproval(juneBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'create_variant',
      comparableInventoryItemId: mayRow.resolvedInventoryItemId,
    }]);
    const [juneRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, juneBatch));
    expect(juneRow.resolvedInventoryItemId).toBeTruthy();
    expect(juneRow.resolvedInventoryItemId).not.toBe(mayRow.resolvedInventoryItemId);
    const [juneItem] = await db
      .select({ name: inventoryItems.name })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, juneRow.resolvedInventoryItemId!));
    expect(juneItem.name).toBe("Casamigo's Blanco — 5 × 50 ML");

    const links = await db
      .select({
        inventoryItemId: inventoryItemRelationships.inventoryItemId,
        relatedInventoryItemId: inventoryItemRelationships.relatedInventoryItemId,
      })
      .from(inventoryItemRelationships)
      .where(eq(inventoryItemRelationships.companyId, ID.company));
    expect(links).toEqual(expect.arrayContaining([
      {
        inventoryItemId: juneRow.resolvedInventoryItemId,
        relatedInventoryItemId: mayRow.resolvedInventoryItemId,
      },
      {
        inventoryItemId: mayRow.resolvedInventoryItemId,
        relatedInventoryItemId: juneRow.resolvedInventoryItemId,
      },
    ]));
  });

  it('keeps one inventory item and persists a different vendor pack with its own geometry and price', async () => {
    const mayBatch = await stageBatch([{
      code: 'CROSS-VENDOR-BASE-24',
      description: 'Cross Vendor Tomatoes',
      location: 'Dry Storage',
      supplier: 'Vendor Alpha',
      caseQuantity: 24,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 48,
    }], '2031-01-31');
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));
    if (!mayRow?.resolvedInventoryItemId) throw new Error('Expected the base item to resolve');

    const juneBatch = await stageBatch([{
      code: 'CROSS-VENDOR-ALT-12',
      description: 'Cross Vendor Tomatoes',
      location: 'Dry Storage',
      supplier: 'Vendor Beta',
      caseQuantity: 12,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 30,
    }], '2031-02-28');
    const preview = await runResolutionPreview(juneBatch, ID.company);
    expect(preview.rows[0].itemMatch).toMatchObject({
      packCompatibility: 'incompatible',
      crossVendorPackEligible: true,
      recommendedAction: 'link_vendor_pack',
      possibleRecodeMatchedId: mayRow.resolvedInventoryItemId,
    });

    await applyBatchApproval(juneBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'link_vendor_pack',
      inventoryItemId: mayRow.resolvedInventoryItemId,
    }]);

    const [juneRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, juneBatch));
    expect(juneRow.resolvedInventoryItemId).toBe(mayRow.resolvedInventoryItemId);

    const packs = await db
      .select({
        vendorName: vendors.name,
        vendorSku: vendorItems.vendorSku,
        canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
        lastCasePrice: vendorItems.lastCasePrice,
        normalizedPricePerCanonicalUnit: vendorItems.normalizedPricePerCanonicalUnit,
      })
      .from(vendorItems)
      .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
      .where(eq(vendorItems.inventoryItemId, mayRow.resolvedInventoryItemId))
      .orderBy(vendors.name);
    expect(packs).toEqual([
      {
        vendorName: 'Vendor Alpha',
        vendorSku: null,
        canonicalQtyPerPurchaseUnit: 24,
        lastCasePrice: 48,
        normalizedPricePerCanonicalUnit: 2,
      },
      {
        vendorName: 'Vendor Beta',
        vendorSku: null,
        canonicalQtyPerPurchaseUnit: 12,
        lastCasePrice: 30,
        normalizedPricePerCanonicalUnit: 2.5,
      },
    ]);

    const julyBatch = await stageBatch([{
      code: 'CROSS-VENDOR-ALT-12',
      description: 'Cross Vendor Tomatoes',
      location: 'Dry Storage',
      supplier: 'Vendor Beta',
      caseQuantity: 12,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 33,
    }], '2031-03-31');
    const julyPreview = await runResolutionPreview(julyBatch, ID.company);
    expect(julyPreview.rows[0].itemMatch).toMatchObject({
      strategy: 'external_mapping',
      matchedId: mayRow.resolvedInventoryItemId,
      requiresReview: false,
      packCompatibility: 'compatible',
      candidatePackEvidence: {
        caseQuantity: 12,
        innerPackQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'EA',
        normalizedUnit: 'EA',
        totalBaseUnits: 12,
      },
    });

    // A reviewer may have saved a separate-variant choice before the June
    // approval supplied the authoritative vendor/code/pack continuation.
    // Approval must converge only because the corrected preview now resolves
    // to that same reviewed item; a different target would remain a conflict.
    await db.insert(orderlyImportReviewDecisions).values({
      batchId: julyBatch,
      companyId: ID.company,
      rowIndex: 1,
      decision: {
        action: 'create_variant',
        comparableInventoryItemId: mayRow.resolvedInventoryItemId,
      },
      revision: 1,
      createdBy: ID.admin,
      updatedBy: ID.admin,
    });

    const julyResult = await applyBatchApproval(julyBatch, approvalAuth, null);
    expect(julyResult.itemsCreated).toBe(0);
    const [julyRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, julyBatch));
    expect(julyRow.resolvedInventoryItemId).toBe(mayRow.resolvedInventoryItemId);
  });

  it('keeps one item and two vendor products for identical opaque 1/1 Case geometry', async () => {
    const mayBatch = await stageBatch([{
      code: 'LETMIZ',
      description: 'Mizuna',
      location: 'Produce Walk-in',
      supplier: "Harvill's Produce Co., Inc.",
      packSizeRaw: '1/1 Case',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 0,
      baseUnit: 'CASE',
      packagePrice: 36.75,
    }], '2032-01-31');
    await db
      .update(inventoryImportRows)
      .set({ baseUnitQuantity: null })
      .where(eq(inventoryImportRows.batchId, mayBatch));
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));
    if (!mayRow?.resolvedInventoryItemId) throw new Error('Expected Mizuna to resolve');

    const julyBatch = await stageBatch([{
      code: '21425',
      description: 'Mizuna',
      location: 'Produce Walk-in',
      supplier: "Mr. Green's Produce",
      packSizeRaw: '1/1 Case',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 0,
      baseUnit: 'CASE',
      packagePrice: 28.82,
    }], '2032-02-29');
    await db
      .update(inventoryImportRows)
      .set({ baseUnitQuantity: null })
      .where(eq(inventoryImportRows.batchId, julyBatch));

    const preview = await runResolutionPreview(julyBatch, ID.company);
    expect(preview.rows[0].itemMatch).toMatchObject({
      possibleRecode: true,
      possibleRecodeMatchedId: mayRow.resolvedInventoryItemId,
      packCompatibility: 'compatible',
      recodeEvidenceClass: 'compatible_alternate',
      recommendedAction: 'create_variant',
    });
    expect(preview.rows[0].itemMatch.sourcePackEvidence).toMatchObject({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: null,
      baseUnit: 'CASE',
      normalizedUnit: null,
      totalBaseUnits: null,
    });

    await applyBatchApproval(julyBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'link_existing',
      inventoryItemId: mayRow.resolvedInventoryItemId,
    }]);
    const [julyRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, julyBatch));
    expect(julyRow.resolvedInventoryItemId).toBe(mayRow.resolvedInventoryItemId);

    const packs = await db
      .select({
        vendorName: vendors.name,
        caseSize: vendorItems.caseSize,
        innerPackSize: vendorItems.innerPackSize,
        packUom: vendorItems.packUom,
        lastCasePrice: vendorItems.lastCasePrice,
        canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
        normalizedPricePerCanonicalUnit: vendorItems.normalizedPricePerCanonicalUnit,
        packGeometryStatus: vendorItems.packGeometryStatus,
      })
      .from(vendorItems)
      .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
      .where(eq(vendorItems.inventoryItemId, mayRow.resolvedInventoryItemId))
      .orderBy(vendors.name);
    expect(packs).toEqual([
      {
        vendorName: "Harvill's Produce Co., Inc.",
        caseSize: 1,
        innerPackSize: 1,
        packUom: 'CASE',
        lastCasePrice: 36.75,
        canonicalQtyPerPurchaseUnit: null,
        normalizedPricePerCanonicalUnit: null,
        packGeometryStatus: 'incomplete',
      },
      {
        vendorName: "Mr. Green's Produce",
        caseSize: 1,
        innerPackSize: 1,
        packUom: 'CASE',
        lastCasePrice: 28.82,
        canonicalQtyPerPurchaseUnit: null,
        normalizedPricePerCanonicalUnit: null,
        packGeometryStatus: 'incomplete',
      },
    ]);
  });

  it('retains a verified same-vendor pack across resolved, opaque, and resolved months', async () => {
    const mayBatch = await stageBatch([{
      code: 'CARCB30HF',
      description: 'Bunny Luv BB Carrots',
      location: 'Produce Walk-in',
      supplier: "Harvill's Produce",
      packSizeRaw: '1/15 LB',
      caseQuantity: 1,
      innerPackQuantity: 15,
      baseUnitQuantity: 1,
      baseUnit: 'LB',
      packagePrice: 45,
      totalCost: 90,
    }], '2032-03-31');
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));
    if (!mayRow?.resolvedInventoryItemId) throw new Error('Expected carrots to resolve');

    const selectVendorPack = () => db
      .select({
        id: vendorItems.id,
        caseSize: vendorItems.caseSize,
        innerPackSize: vendorItems.innerPackSize,
        packUom: vendorItems.packUom,
        lastCasePrice: vendorItems.lastCasePrice,
        canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
        normalizedPricePerCanonicalUnit: vendorItems.normalizedPricePerCanonicalUnit,
        packGeometryStatus: vendorItems.packGeometryStatus,
        priceSourceReferenceId: vendorItems.priceSourceReferenceId,
      })
      .from(vendorItems)
      .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
      .where(and(
        eq(vendorItems.inventoryItemId, mayRow.resolvedInventoryItemId!),
        eq(vendors.name, "Harvill's Produce"),
      ))
      .limit(1);

    const [verifiedMayPack] = await selectVendorPack();
    expect(verifiedMayPack).toMatchObject({
      caseSize: 15,
      innerPackSize: 16,
      packUom: 'OZ',
      lastCasePrice: 45,
      canonicalQtyPerPurchaseUnit: 240,
      normalizedPricePerCanonicalUnit: 0.1875,
      packGeometryStatus: 'verified',
      priceSourceReferenceId: mayBatch,
    });

    const juneBatch = await stageBatch([
      {
        code: 'CARCB30HF',
        description: 'Bunny Luv BB Carrots',
        location: 'Produce Walk-in',
        supplier: "Harvill's Produce",
        packSizeRaw: '1/1 Case',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: null,
        baseUnit: 'CASE',
        packagePrice: 47,
        totalCost: 94,
      },
      {
        code: 'OPAQUE-SIBLING-WRITES',
        description: 'Sibling Approval Writes',
        location: 'New June Storage',
        supplier: 'New June Vendor',
        packSizeRaw: '1/12 EA',
        caseQuantity: 1,
        innerPackQuantity: 12,
        baseUnitQuantity: 1,
        baseUnit: 'EA',
        packagePrice: 24,
        totalCost: 48,
      },
    ], '2032-04-30');
    const junePreview = await runResolutionPreview(juneBatch, ID.company);
    const carrotsPreview = junePreview.rows.find(row => row.sourceItemCode === 'CARCB30HF');
    expect(carrotsPreview?.itemMatch).toMatchObject({
      strategy: 'external_mapping',
      matchedId: mayRow.resolvedInventoryItemId,
      requiresReview: false,
    });

    await applyBatchApproval(juneBatch, approvalAuth);
    const juneRows = await db
      .select({
        rowIndex: inventoryImportRows.rowIndex,
        resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
        totalCost: inventoryImportRows.totalCost,
      })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, juneBatch))
      .orderBy(inventoryImportRows.rowIndex);
    expect(juneRows[0]).toMatchObject({
      resolvedInventoryItemId: mayRow.resolvedInventoryItemId,
      totalCost: 94,
    });
    expect(juneRows[1].resolvedInventoryItemId).toBeTruthy();
    expect(juneRows[1].resolvedInventoryItemId).not.toBe(mayRow.resolvedInventoryItemId);
    expect((await selectVendorPack())[0]).toEqual(verifiedMayPack);
    const [siblingMapping] = await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourcePropertyId, ID.property),
        eq(inventoryItemExternalMappings.inventoryItemId, juneRows[1].resolvedInventoryItemId!),
      ));
    expect(siblingMapping.inventoryItemId).toBe(juneRows[1].resolvedInventoryItemId);
    const [siblingVendorPack] = await db
      .select({
        vendorName: vendors.name,
        canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
      })
      .from(vendorItems)
      .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
      .where(eq(vendorItems.inventoryItemId, juneRows[1].resolvedInventoryItemId!));
    expect(siblingVendorPack).toMatchObject({
      vendorName: 'New June Vendor',
      canonicalQtyPerPurchaseUnit: 12,
    });
    const [siblingLocation] = await db
      .select({ name: inventoryLocations.name })
      .from(inventoryItemLocationAssignments)
      .innerJoin(inventoryLocations, eq(inventoryLocations.id, inventoryItemLocationAssignments.locationId))
      .where(eq(inventoryItemLocationAssignments.inventoryItemId, juneRows[1].resolvedInventoryItemId!));
    expect(siblingLocation.name).toBe('New June Storage');

    const julyBatch = await stageBatch([{
      code: 'CARCB30HF',
      description: 'Bunny Luv BB Carrots',
      location: 'Produce Walk-in',
      supplier: "Harvill's Produce",
      packSizeRaw: '1/15 LB',
      caseQuantity: 1,
      innerPackQuantity: 15,
      baseUnitQuantity: 1,
      baseUnit: 'LB',
      packagePrice: 48,
      totalCost: 96,
    }], '2032-05-31');
    await applyBatchApproval(julyBatch, approvalAuth);
    const [verifiedJulyPack] = await selectVendorPack();
    expect(verifiedJulyPack).toMatchObject({
      id: verifiedMayPack.id,
      caseSize: 15,
      innerPackSize: 16,
      packUom: 'OZ',
      lastCasePrice: 48,
      canonicalQtyPerPurchaseUnit: 240,
      normalizedPricePerCanonicalUnit: 0.2,
      packGeometryStatus: 'verified',
      priceSourceReferenceId: julyBatch,
    });
  });

  it('still rejects a same-vendor resolved pack that contradicts persisted verified geometry', async () => {
    const mayBatch = await stageBatch([{
      code: 'SAME-VENDOR-RESOLVED-CONFLICT',
      description: 'Same Vendor Conflict',
      location: 'Produce Walk-in',
      supplier: 'Vendor Conflict',
      caseQuantity: 1,
      innerPackQuantity: 15,
      baseUnitQuantity: 1,
      baseUnit: 'LB',
      packagePrice: 45,
    }], '2032-06-30');
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));
    if (!mayRow?.resolvedInventoryItemId) throw new Error('Expected conflict fixture to resolve');

    await db
      .update(vendorItems)
      .set({ canonicalQtyPerPurchaseUnit: 120 })
      .where(eq(vendorItems.inventoryItemId, mayRow.resolvedInventoryItemId));

    const juneBatch = await stageBatch([{
      code: 'SAME-VENDOR-RESOLVED-CONFLICT',
      description: 'Same Vendor Conflict',
      location: 'Produce Walk-in',
      supplier: 'Vendor Conflict',
      caseQuantity: 1,
      innerPackQuantity: 15,
      baseUnitQuantity: 1,
      baseUnit: 'LB',
      packagePrice: 46,
    }], '2032-07-31');
    const preview = await runResolutionPreview(juneBatch, ID.company);
    expect(preview.rows[0].itemMatch).toMatchObject({
      matchedId: mayRow.resolvedInventoryItemId,
      requiresReview: false,
    });

    const before = await approvalWriteSnapshot(juneBatch);
    await expect(applyBatchApproval(juneBatch, approvalAuth))
      .rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });
    expect(await approvalWriteSnapshot(juneBatch)).toEqual(before);
  });

  it('fails closed when a safely superseded review target loses the authoritative mapping race', () => {
    expect(() => assertSupersededDecisionTarget(
      '4676306',
      'reviewed-june-item',
      'concurrent-winner-item',
    )).toThrowError(
      /Item Code 4676306 changed its authoritative target while approval was running/,
    );
    expect(() => assertSupersededDecisionTarget(
      '4676306',
      'reviewed-june-item',
      'reviewed-june-item',
    )).not.toThrow();
  });

  it('offers and applies a cross-vendor Avocado pack link when the new Item Code is descriptive', async () => {
    const mayBatch = await stageBatch([{
      code: 'AVOCADO-BASE-24',
      description: 'Avocado',
      location: 'Walk-in',
      supplier: 'Vendor Alpha',
      caseQuantity: 24,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 48,
    }], '2027-06-30');
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));
    if (!mayRow?.resolvedInventoryItemId) throw new Error('Expected Avocado to resolve');

    const juneBatch = await stageBatch([{
      code: 'Avocado 54 Count',
      description: 'Avocado',
      location: 'Walk-in',
      supplier: 'Vendor Beta',
      caseQuantity: 54,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 81,
    }], '2027-07-31');
    const preview = await runResolutionPreview(juneBatch, ID.company);
    expect(preview.rows[0]).toMatchObject({
      sourceCodeReliability: 'pseudo_code',
      itemMatch: {
        possibleRecode: true,
        possibleRecodeMatchedId: mayRow.resolvedInventoryItemId,
        packCompatibility: 'incompatible',
        recodeEvidenceClass: 'new_pack_size',
        crossVendorPackEligible: true,
        recommendedAction: 'link_vendor_pack',
      },
    });

    await expect(applyBatchApproval(juneBatch, approvalAuth)).rejects.toMatchObject<Partial<ImportApprovalError>>({
      code: 'CONFLICT',
    });
    await applyBatchApproval(juneBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'link_vendor_pack',
      inventoryItemId: mayRow.resolvedInventoryItemId,
    }]);

    const mappings = await db
      .select({
        sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
        sourcePropertyId: inventoryItemExternalMappings.sourcePropertyId,
      })
      .from(inventoryItemExternalMappings)
      .where(eq(inventoryItemExternalMappings.inventoryItemId, mayRow.resolvedInventoryItemId));
    expect(mappings.some(mapping => mapping.sourceExternalId === 'Avocado 54 Count')).toBe(false);
    expect(mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceExternalId: expect.stringMatching(/^ALT\|avocado\|/),
        sourcePropertyId: ID.property,
      }),
    ]));

    const packs = await db
      .select({
        vendorName: vendors.name,
        canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
        lastCasePrice: vendorItems.lastCasePrice,
        vendorSku: vendorItems.vendorSku,
      })
      .from(vendorItems)
      .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
      .where(eq(vendorItems.inventoryItemId, mayRow.resolvedInventoryItemId))
      .orderBy(vendors.name);
    expect(packs).toEqual(expect.arrayContaining([
      {
        vendorName: 'Vendor Alpha',
        canonicalQtyPerPurchaseUnit: 24,
        lastCasePrice: 48,
        vendorSku: null,
      },
      {
        vendorName: 'Vendor Beta',
        canonicalQtyPerPurchaseUnit: 54,
        lastCasePrice: 81,
        vendorSku: null,
      },
    ]));
  });

  it('classifies same-vendor 1/1 750ML against 6/1 750ML as a new pack and invalidates the old compatible link', async () => {
    const baseBatch = await stageBatch([{
      code: '623764',
      description: 'HEITZ CAB SAUV MARTHAS 18 WD',
      location: 'Wine Cellar',
      supplier: 'Vendor Gamma',
      packSizeRaw: '6/1 750ML',
      caseQuantity: 6,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      packagePrice: 600,
    }], '2027-05-31');
    await applyBatchApproval(baseBatch, approvalAuth);

    const juneBatch = await stageBatch([{
      code: '623764',
      description: 'HEITZ CAB SAUV MARTHAS 18 WD',
      location: 'Wine Cellar',
      supplier: 'Vendor Gamma',
      packSizeRaw: '1/1 750ML',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      packagePrice: 110,
    }], '2027-06-30');
    const preview = await runResolutionPreview(juneBatch, ID.company);
    expect(preview.rows[0].itemMatch).toMatchObject({
      mappedCodePackDrift: true,
      packCompatibility: 'incompatible',
      recodeEvidenceClass: 'new_pack_size',
      crossVendorPackEligible: false,
      recommendedAction: 'create_variant',
    });
    expect(preview.rows[0].itemMatch.sourcePackEvidence?.totalBaseUnits).toBe(750);
    expect(preview.rows[0].itemMatch.candidatePackEvidence?.totalBaseUnits).toBe(4500);

    const candidateId = preview.rows[0].itemMatch.possibleRecodeMatchedId!;
    await db.insert(orderlyImportReviewDecisions).values({
      batchId: juneBatch,
      companyId: ID.company,
      rowIndex: 1,
      decision: { action: 'link_existing', inventoryItemId: candidateId },
      revision: 1,
      createdBy: ID.admin,
      updatedBy: ID.admin,
    });

    const draft = await getOrderlyReviewDecisions(juneBatch, approvalAuth);
    expect(draft.decisions).toEqual([]);
    expect(draft.stale).toEqual([
      expect.objectContaining({
        rowIndex: 1,
        sourceItemCode: '623764',
        description: 'HEITZ CAB SAUV MARTHAS 18 WD',
      }),
    ]);
    await expect(applyBatchApproval(juneBatch, approvalAuth, null)).rejects.toThrow(
      /Approval preflight found 1 review conflict.*623764.*incoming 1\/1 750ML.*existing 6 × 1 × 750 × ML/,
    );

    await saveOrderlyReviewDecisionChanges(juneBatch, approvalAuth, [{
      rowIndex: 1,
      expectedRevision: 1,
      decision: {
        action: 'create_variant',
        comparableInventoryItemId: candidateId,
      },
    }]);
    const approved = await applyBatchApproval(juneBatch, approvalAuth, null);
    expect(approved.itemsCreated).toBe(1);

    const [approvedRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, juneBatch));
    expect(approvedRow.resolvedInventoryItemId).not.toBe(candidateId);

    const [codeMapping] = await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourcePropertyId, ID.property),
        eq(inventoryItemExternalMappings.sourceExternalId, '623764'),
      ));
    expect(codeMapping.inventoryItemId).toBe(candidateId);

    const rerunPreview = await runResolutionPreview(juneBatch, ID.company);
    expect(rerunPreview.rows[0].itemMatch).toMatchObject({
      strategy: 'alternate_identity',
      matchedId: approvedRow.resolvedInventoryItemId,
    });
  });

  it('reuses the latest approved same-vendor stable-code pack when legacy history lacks its pack mapping', async () => {
    const stableCode = `REPEAT-${RUN.toUpperCase()}`;
    const baseBatch = await stageBatch([{
      code: stableCode,
      description: 'Repeated Pack Identity',
      location: 'Wine Cellar',
      supplier: 'Vendor Gamma',
      packSizeRaw: '6/1 750ML',
      caseQuantity: 6,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      packagePrice: 600,
    }], '2027-05-31');
    await applyBatchApproval(baseBatch, approvalAuth);

    const changedPackBatch = await stageBatch([{
      code: stableCode,
      description: 'Repeated Pack Identity',
      location: 'Wine Cellar',
      supplier: 'Vendor Gamma',
      packSizeRaw: '1/1 750ML',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      packagePrice: 110,
    }], '2027-06-30');
    const changedPreview = await runResolutionPreview(changedPackBatch, ID.company);
    expect(changedPreview.rows[0].itemMatch).toMatchObject({
      recommendedAction: 'create_variant',
    });
    expect(changedPreview.rows[0].itemMatch.possibleRecodeMatchedId).toBeTruthy();
    await applyBatchApproval(changedPackBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'create_variant',
      comparableInventoryItemId: changedPreview.rows[0].itemMatch.possibleRecodeMatchedId!,
    }]);
    const [changedRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, changedPackBatch));
    expect(changedRow.resolvedInventoryItemId).toBeTruthy();
    const changedVendorPacks = await db
      .select({
        canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
      })
      .from(vendorItems)
      .where(eq(vendorItems.inventoryItemId, changedRow.resolvedInventoryItemId!));
    expect(changedVendorPacks).toEqual([
      expect.objectContaining({ canonicalQtyPerPurchaseUnit: 750 }),
    ]);

    // Simulate an approved pre-pack-identity month. The exact historical row
    // remains available, but its newer ALT|CODE mapping does not.
    await db
      .delete(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.inventoryItemId, changedRow.resolvedInventoryItemId!),
        sql`${inventoryItemExternalMappings.sourceExternalId} LIKE 'ALT|CODE=%'`,
      ));

    // A newer approved batch from another property is not an eligible
    // predecessor. The property-A preview must still select the newest
    // property-A batch first, then read only its matching codes.
    const interveningBatch = await stageBatch([{
      code: `UNRELATED-${RUN.toUpperCase()}`,
      description: 'Unrelated Partial Inventory Item',
      location: 'Dry Storage',
      supplier: 'Vendor Gamma',
      packSizeRaw: '1/1 EA',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 10,
    }], '2027-07-15', 'B');
    await applyBatchApproval(interveningBatch, approvalAuth);

    const repeatedBatch = await stageBatch([{
      code: stableCode,
      description: 'Repeated Pack Identity',
      location: 'Wine Cellar',
      supplier: 'Vendor Gamma',
      packSizeRaw: '1/1 750ML',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      packagePrice: 115,
    }], '2027-07-31');
    const repeatedPreview = await runResolutionPreview(repeatedBatch, ID.company);
    expect(repeatedPreview.rows[0].itemMatch).toMatchObject({
      strategy: 'alternate_identity',
      matchedId: changedRow.resolvedInventoryItemId,
      requiresReview: false,
    });
    expect(repeatedPreview.rows[0].itemMatch.possibleRecode).not.toBe(true);
    expect(repeatedPreview.rows[0].itemMatch.recodeEvidenceClass).not.toBe('new_pack_size');

    await expect(applyBatchApproval(repeatedBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'create_variant',
      comparableInventoryItemId: changedRow.resolvedInventoryItemId!,
    }])).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'INVALID_REQUEST' });

    const approved = await applyBatchApproval(repeatedBatch, approvalAuth);
    expect(approved.itemsCreated).toBe(0);
    const [repeatedRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, repeatedBatch));
    expect(repeatedRow.resolvedInventoryItemId).toBe(changedRow.resolvedInventoryItemId);
  });

  it('does not scan past the newest same-property predecessor batch for an older matching code', async () => {
    const stableCode = `LATEST-GATE-${RUN.toUpperCase()}`;
    const olderBatch = await stageBatch([{
      code: stableCode,
      description: 'Older Historical Identity',
      location: 'Wine Cellar',
      supplier: 'Vendor Gamma',
      packSizeRaw: '1/1 EA',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 10,
    }], '2027-08-31');
    await applyBatchApproval(olderBatch, approvalAuth);
    const [olderRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, olderBatch));
    expect(olderRow.resolvedInventoryItemId).toBeTruthy();

    // Remove direct mappings so only the prior-approved-row fallback could
    // recover this identity. The newer approved batch below intentionally does
    // not contain the code.
    await db
      .delete(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.inventoryItemId, olderRow.resolvedInventoryItemId!),
      ));

    const newestPredecessor = await stageBatch([{
      code: `LATEST-OTHER-${RUN.toUpperCase()}`,
      description: 'Newest Unrelated Identity',
      location: 'Dry Storage',
      supplier: 'Vendor Gamma',
      packSizeRaw: '1/1 EA',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 11,
    }], '2027-09-15');
    await applyBatchApproval(newestPredecessor, approvalAuth);

    const currentBatch = await stageBatch([{
      code: stableCode,
      description: 'QZXJ Incoming Identity',
      location: 'Main Bar',
      supplier: 'Vendor Gamma',
      packSizeRaw: '1/1 EA',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 12,
    }], '2027-09-30');
    const preview = await runResolutionPreview(currentBatch, ID.company);

    expect(preview.rows[0].itemMatch.matchedId).not.toBe(olderRow.resolvedInventoryItemId);
    expect(preview.rows[0].itemMatch.packCompatibilityReason)
      .not.toBe('the incoming pack matches the immediately prior approved month');
  });

  it('previews a production-sized repeated-code batch against bounded property-scoped history', async () => {
    const codes = [
      '11017',
      ...Array.from({ length: 23 }, (_, index) => `${810000 + index}`),
    ];
    const sourceRows = codes.map(code => ({
      code,
      description: `Large Fixture Item ${code}`,
      location: 'Large Fixture Storage',
      supplier: 'Vendor Gamma',
      packSizeRaw: '1/72 EA',
      caseQuantity: 1,
      innerPackQuantity: 72,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 36.96,
    }));
    const fixtureUnitId = await eachUnitId();
    const seededItems = await db
      .insert(inventoryItems)
      .values(sourceRows.flatMap(row => [
        {
          companyId: ID.company,
          name: `Older Sentinel ${row.code}`,
          unitId: fixtureUnitId,
          caseSize: row.caseQuantity,
          pricePerUnit: row.packagePrice,
          avgCostPerUnit: row.packagePrice,
          active: 1,
          yieldPercent: 100,
        },
        {
          companyId: ID.company,
          name: row.description,
          unitId: fixtureUnitId,
          // Deliberately differs from the source pack so catalog name/case
          // matching cannot make the historical-resolution assertion pass.
          caseSize: 40,
          pricePerUnit: row.packagePrice,
          avgCostPerUnit: row.packagePrice,
          active: 1,
          yieldPercent: 100,
        },
        {
          companyId: ID.company,
          name: `Wrong Property Sentinel ${row.code}`,
          unitId: fixtureUnitId,
          caseSize: row.caseQuantity,
          pricePerUnit: row.packagePrice,
          avgCostPerUnit: row.packagePrice,
          active: 1,
          yieldPercent: 100,
        },
      ]))
      .returning({ id: inventoryItems.id, name: inventoryItems.name });
    const seededItemIdByName = new Map(seededItems.map(item => [item.name, item.id]));
    const sentinelsByCode = new Map(sourceRows.map(row => [
      row.code,
      {
        older: seededItemIdByName.get(`Older Sentinel ${row.code}`)!,
        june: seededItemIdByName.get(row.description)!,
        wrongProperty: seededItemIdByName.get(`Wrong Property Sentinel ${row.code}`)!,
      },
    ]));
    const resolutionManifest = (kind: 'older' | 'june' | 'wrongProperty') =>
      JSON.stringify(sourceRows.map(row => ({
        code: row.code,
        item_id: sentinelsByCode.get(row.code)![kind],
      })));
    const approveHistoricalFixture = async (
      batchId: string,
      manifest: string,
    ) => {
      await db
        .update(inventoryImportBatches)
        .set({ status: 'approved', approvedAt: new Date(), approvedBy: ID.admin })
        .where(eq(inventoryImportBatches.id, batchId));
      await db.execute(sql`
        UPDATE inventory_import_rows AS target
        SET resolved_inventory_item_id = resolved.item_id
        FROM jsonb_to_recordset(${manifest}::jsonb)
          AS resolved(code text, item_id text)
        WHERE target.batch_id = ${batchId}
          AND target.source_item_code = resolved.code
      `);
    };

    // Several approved months make a history-first implementation do
    // materially more work than the latest-batch-first contract.
    for (const date of [
      '2030-01-31',
      '2030-02-28',
      '2030-03-31',
      '2030-04-30',
      '2030-05-31',
    ]) {
      const historicalBatch = await stageBatch(sourceRows, date);
      await approveHistoricalFixture(historicalBatch, resolutionManifest('older'));
    }
    const juneBatch = await stageBatch(sourceRows, '2030-06-30');
    await approveHistoricalFixture(juneBatch, resolutionManifest('june'));

    // A newer batch for another authorized property must not become the
    // predecessor for the current property.
    const wrongPropertyBatch = await stageBatch(sourceRows, '2030-07-15', 'B');
    await approveHistoricalFixture(
      wrongPropertyBatch,
      resolutionManifest('wrongProperty'),
    );

    const currentRows = Array.from({ length: 5518 }, (_, index) => {
      const source = sourceRows[index % sourceRows.length];
      return {
        ...source,
        location: index % 2 === 0 ? 'Large Fixture Storage' : 'Large Fixture Overflow',
      };
    });
    const currentBatch = await stageBatch(currentRows, '2030-07-31');

    const startedAt = Date.now();
    const preview = await runResolutionPreview(currentBatch, ID.company);
    const elapsedMs = Date.now() - startedAt;

    expect(preview.rows).toHaveLength(5518);
    expect(elapsedMs).toBeLessThan(30_000);
    const matchedByCode = new Map<string, string | null>();
    for (const row of preview.rows) {
      const code = row.sourceItemCode!;
      expect(row.itemMatch).toMatchObject({
        strategy: 'alternate_identity',
        matchedId: sentinelsByCode.get(code)!.june,
        requiresReview: false,
      });
      const previous = matchedByCode.get(code);
      if (previous === undefined) {
        matchedByCode.set(code, row.itemMatch.matchedId);
      } else {
        expect(row.itemMatch.matchedId).toBe(previous);
      }
    }
    expect(matchedByCode.size).toBe(codes.length);
  }, 30_000);

  it('writes a same-name same-vendor create_variant pack against the new item, not the comparison item', async () => {
    const baseBatch = await stageBatch([{
      code: 'CREAMER-BASE-384EA',
      description: 'Creamers Half and Half ind.',
      location: 'Dry Storage',
      supplier: 'Vendor Gamma',
      caseQuantity: 384,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 20,
    }], '2027-06-30');
    await applyBatchApproval(baseBatch, approvalAuth);

    const variantBatch = await stageBatch([{
      code: '7166386',
      description: 'Creamers Half and Half ind.',
      location: 'Dry Storage',
      supplier: 'Vendor Gamma',
      packSizeRaw: '384/9 ML',
      caseQuantity: 384,
      innerPackQuantity: 9,
      baseUnitQuantity: 1,
      baseUnit: 'ML',
      packagePrice: 20.15,
    }], '2027-07-31');
    const preview = await runResolutionPreview(variantBatch, ID.company);
    expect(preview.rows[0].itemMatch).toMatchObject({
      strategy: 'name_pack',
      confidence: 'high',
      matchedId: expect.any(String),
      packCompatibility: 'incompatible',
      crossVendorPackEligible: false,
      recommendedAction: 'create_variant',
    });
    await expect(applyBatchApproval(variantBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'link_vendor_pack',
      inventoryItemId: preview.rows[0].itemMatch.possibleRecodeMatchedId!,
    }])).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });

    const baseItemId = preview.rows[0].itemMatch.possibleRecodeMatchedId!;
    await applyBatchApproval(variantBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'create_variant',
      comparableInventoryItemId: baseItemId,
    }]);
    const [variantRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, variantBatch));
    expect(variantRow.resolvedInventoryItemId).toBeTruthy();
    expect(variantRow.resolvedInventoryItemId).not.toBe(baseItemId);
    const [variantVendorPack] = await db
      .select({
        inventoryItemId: vendorItems.inventoryItemId,
        canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
        lastCasePrice: vendorItems.lastCasePrice,
      })
      .from(vendorItems)
      .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
      .where(and(
        eq(vendors.name, 'Vendor Gamma'),
        eq(vendorItems.inventoryItemId, variantRow.resolvedInventoryItemId!),
      ));
    expect(variantVendorPack).toMatchObject({
      inventoryItemId: variantRow.resolvedInventoryItemId,
      canonicalQtyPerPurchaseUnit: expect.any(Number),
      lastCasePrice: 20.15,
    });
    const relationships = await db
      .select({
        inventoryItemId: inventoryItemRelationships.inventoryItemId,
        relatedInventoryItemId: inventoryItemRelationships.relatedInventoryItemId,
      })
      .from(inventoryItemRelationships)
      .where(eq(inventoryItemRelationships.companyId, ID.company));
    expect(relationships).toEqual(expect.arrayContaining([
      { inventoryItemId: baseItemId, relatedInventoryItemId: variantRow.resolvedInventoryItemId },
      { inventoryItemId: variantRow.resolvedInventoryItemId, relatedInventoryItemId: baseItemId },
    ]));
  });

  it('does not recommend or write a cross-vendor pack when its price is not positive', async () => {
    const baseBatch = await stageBatch([{
      code: 'NO-PRICE-BASE-24',
      description: 'No Price Cross Vendor Item',
      location: 'Dry Storage',
      supplier: 'Vendor Delta',
      caseQuantity: 24,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 48,
    }], '2027-08-31');
    await applyBatchApproval(baseBatch, approvalAuth);
    const [baseRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, baseBatch));
    if (!baseRow?.resolvedInventoryItemId) throw new Error('Expected the base item to resolve');

    const noPriceBatch = await stageBatch([{
      code: 'NO-PRICE-ALT-12',
      description: 'No Price Cross Vendor Item',
      location: 'Dry Storage',
      supplier: 'Vendor Epsilon',
      caseQuantity: 12,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      packagePrice: 0,
    }], '2027-09-30');
    const preview = await runResolutionPreview(noPriceBatch, ID.company);
    expect(preview.rows[0].itemMatch).toMatchObject({
      packCompatibility: 'incompatible',
      crossVendorPackEligible: false,
      recommendedAction: 'create_variant',
    });
    const before = await approvalWriteSnapshot(noPriceBatch);
    await expect(applyBatchApproval(noPriceBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'link_vendor_pack',
      inventoryItemId: baseRow.resolvedInventoryItemId,
    }])).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });
    expect(await approvalWriteSnapshot(noPriceBatch)).toEqual(before);
  });

  it('blocks a Milk-like catalog packSize conflict before a requested variant can write', async () => {
    const baseBatch = await stageBatch([
      {
        code: 'MILK-1000',
        description: 'Milk - Whole',
        location: 'Walk-in',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'GAL',
      },
    ], '2026-12-31');
    await applyBatchApproval(baseBatch, approvalAuth);
    const [baseRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, baseBatch));
    if (!baseRow?.resolvedInventoryItemId) throw new Error('Expected Milk base item to resolve');

    const [sysco] = await db.insert(vendors).values({
      companyId: ID.company,
      name: 'Sysco',
    }).returning({ id: vendors.id });
    const unitId = await eachUnitId();
    const [milkVendorItem] = await db.insert(vendorItems).values({
      vendorId: sysco.id,
      inventoryItemId: baseRow.resolvedInventoryItemId,
      vendorSku: '4676306',
      purchaseUnitId: unitId,
      caseSize: 1,
      innerPackSize: 1,
      packUom: 'GAL',
    }).returning({ id: vendorItems.id });
    await db.insert(vendorItemExternalMappings).values([
      {
        companyId: ID.company,
        vendorItemId: milkVendorItem.id,
        sourceSystem: 'ORDERLY',
        sourcePropertyId: ID.property,
        sourceExternalId: `milk-pack-1-gal-${RUN}`,
        sourceItemCode: '4676306',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'GAL',
      },
      {
        companyId: ID.company,
        vendorItemId: milkVendorItem.id,
        sourceSystem: 'ORDERLY',
        sourcePropertyId: ID.property,
        sourceExternalId: `milk-pack-4-gal-${RUN}`,
        sourceItemCode: '4676306',
        caseQuantity: 4,
        innerPackQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'GAL',
      },
    ]);

    // One workbook row is enough: the contradiction exists only in the
    // persisted Orderly catalog pack identities, not in this XLSX.
    const conflictBatch = await stageBatch([
      {
        code: '4676306',
        description: 'Milk - Whole',
        supplier: 'Sysco',
        location: 'Walk-in',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 250,
        baseUnit: 'EA',
      },
    ], '2027-01-31');
    const preview = await runResolutionPreview(conflictBatch, ID.company);
    expect(preview.recodeSummary).toMatchObject({
      newPackSizes: 0,
      sourceDataConflicts: 1,
    });
    expect(preview.rows[0].itemMatch).toMatchObject({
      matchedId: baseRow.resolvedInventoryItemId,
      possibleRecodeMatchedId: baseRow.resolvedInventoryItemId,
      recodeEvidenceClass: 'source_data_conflict',
      requiresReview: true,
      sourceDataConflict: {
        rowIndexes: [1],
      },
    });
    expect(preview.rows[0].itemMatch.sourceDataConflict?.reason).toContain(`milk-pack-1-gal-${RUN}`);
    expect(preview.rows[0].itemMatch.sourceDataConflict?.reason).toContain(`milk-pack-4-gal-${RUN}`);

    const before = await approvalWriteSnapshot(conflictBatch);
    await expect(applyBatchApproval(conflictBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'create_variant',
      comparableInventoryItemId: baseRow.resolvedInventoryItemId,
    }])).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });
    const after = await approvalWriteSnapshot(conflictBatch);
    expect(after).toEqual(before);
  });

  it('saves and applies a separate variant when the source pack evidence is incomplete', async () => {
    const mayBatch = await stageBatch([
      {
        code: '7710021',
        description: 'Evidence Tequila',
        location: 'Liquor Cage',
        caseQuantity: 6,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      },
    ], '2026-10-31');
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));

    const incompleteEvidenceBatch = await stageBatch([
      {
        code: '7710022',
        description: 'Evidence Tequila',
        location: 'Liquor Cage',
        caseQuantity: 5,
        innerPackQuantity: 1,
        baseUnitQuantity: 0,
        baseUnit: 'ML',
      },
    ], '2026-11-30');
    await db
      .update(inventoryImportRows)
      .set({ baseUnitQuantity: null, baseUnit: null })
      .where(eq(inventoryImportRows.batchId, incompleteEvidenceBatch));
    const preview = await runResolutionPreview(incompleteEvidenceBatch, ID.company);
    expect(preview.rows[0].itemMatch.recodeEvidenceClass).toBe('pack_evidence_missing');
    expect(preview.rows[0].itemMatch.packCompatibility).toBe('unknown');

    await expect(saveOrderlyReviewDecisionChanges(incompleteEvidenceBatch, approvalAuth, [{
      rowIndex: 1,
      expectedRevision: null,
      decision: {
        action: 'link_existing',
        inventoryItemId: mayRow.resolvedInventoryItemId,
      },
    }])).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });

    const saved = await saveOrderlyReviewDecisionChanges(incompleteEvidenceBatch, approvalAuth, [{
      rowIndex: 1,
      expectedRevision: null,
      decision: {
        action: 'create_variant',
        comparableInventoryItemId: mayRow.resolvedInventoryItemId,
      },
    }]);
    expect(saved.decisions).toEqual([
      expect.objectContaining({
        rowIndex: 1,
        revision: 1,
        decision: {
          action: 'create_variant',
          comparableInventoryItemId: mayRow.resolvedInventoryItemId,
        },
      }),
    ]);

    await applyBatchApproval(incompleteEvidenceBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'create_variant',
      comparableInventoryItemId: mayRow.resolvedInventoryItemId,
    }]);
    const [approvedRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, incompleteEvidenceBatch));
    expect(approvedRow.resolvedInventoryItemId).toBeTruthy();
    expect(approvedRow.resolvedInventoryItemId).not.toBe(mayRow.resolvedInventoryItemId);
  });

  it('rejects direct approval of a multi-row unknown-pack reliable-code group', async () => {
    const mayBatch = await stageBatch([{
      code: '7710031',
      description: 'Grouped Evidence Tequila',
      location: 'Liquor Cage',
      caseQuantity: 6,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
    }], '2026-12-31');
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));

    const unknownGroupBatch = await stageBatch([
      {
        code: '7710032',
        description: 'Grouped Evidence Tequila',
        location: 'Liquor Cage',
        caseQuantity: 5,
        innerPackQuantity: 1,
        baseUnitQuantity: 0,
        baseUnit: 'ML',
      },
      {
        code: '7710032',
        description: 'Grouped Evidence Tequila',
        location: 'Banquet Bar',
        caseQuantity: 5,
        innerPackQuantity: 1,
        baseUnitQuantity: 0,
        baseUnit: 'ML',
      },
    ], '2027-01-31');
    await db
      .update(inventoryImportRows)
      .set({ baseUnitQuantity: null, baseUnit: null })
      .where(eq(inventoryImportRows.batchId, unknownGroupBatch));
    const preview = await runResolutionPreview(unknownGroupBatch, ID.company);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.every(row =>
      row.itemMatch.recodeEvidenceClass === 'pack_evidence_missing' &&
      row.itemMatch.packCompatibility === 'unknown'
    )).toBe(true);

    const before = await approvalWriteSnapshot(unknownGroupBatch);
    await expect(applyBatchApproval(unknownGroupBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'create_variant',
      comparableInventoryItemId: mayRow.resolvedInventoryItemId,
    }])).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });
    expect(await approvalWriteSnapshot(unknownGroupBatch)).toEqual(before);

    await expect(applyBatchApproval(unknownGroupBatch, approvalAuth, [1, 2].map(rowIndex => ({
      rowIndex,
      action: 'create_variant' as const,
      comparableInventoryItemId: mayRow.resolvedInventoryItemId,
    })))).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });
    expect(await approvalWriteSnapshot(unknownGroupBatch)).toEqual(before);
  });

  it('accepts a true Red Breast 750 ml re-code only with an explicit compatible link', async () => {
    const mayBatch = await stageBatch([
      {
        code: '86276',
        description: 'Red Breast Irish Whiskey 12Yr',
        location: 'Liquor Cage',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      },
    ], '2026-05-31');
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));

    const juneBatch = await stageBatch([
      {
        code: '417747',
        description: 'Red Breast Irish Whiskey 12Yr',
        location: 'Liquor Cage',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      },
    ], '2026-06-30');
    const preview = await runResolutionPreview(juneBatch, ID.company);
    expect(preview.rows[0].itemMatch.packCompatibility).toBe('compatible');
    expect(preview.rows[0].itemMatch.candidatePackEvidence).toMatchObject({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      normalizedUnit: 'ML',
      totalBaseUnits: 750,
    });
    expect(preview.rows[0].itemMatch.sourcePackEvidence).toMatchObject({
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      normalizedUnit: 'ML',
      totalBaseUnits: 750,
    });

    await expect(applyBatchApproval(juneBatch, approvalAuth)).rejects.toMatchObject<Partial<ImportApprovalError>>({
      code: 'CONFLICT',
    });
    await applyBatchApproval(juneBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'link_existing',
      inventoryItemId: mayRow.resolvedInventoryItemId,
    }]);
    const [juneRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, juneBatch));
    expect(juneRow.resolvedInventoryItemId).toBe(mayRow.resolvedInventoryItemId);
  });

  it('saves compatible alternate-code rows as one atomic, rerun-safe code-group decision', async () => {
    const mayBatch = await stageBatch([
      {
        code: 'BASE-ALT-750',
        description: 'Atomic Group Whiskey',
        location: 'Liquor Cage',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      },
    ], '2027-02-28');
    await applyBatchApproval(mayBatch, approvalAuth);
    const [mayRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, mayBatch));
    if (!mayRow?.resolvedInventoryItemId) throw new Error('Expected the base item to resolve');

    const juneBatch = await stageBatch([
      {
        code: 'NEW-ALT-750',
        description: 'Atomic Group Whiskey',
        location: 'Liquor Cage',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      },
      {
        code: 'NEW-ALT-750',
        description: 'Atomic Group Whiskey',
        location: 'Main Bar',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      },
    ], '2027-03-31');
    const preview = await runResolutionPreview(juneBatch, ID.company);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows.every(row =>
      row.itemMatch.recodeEvidenceClass === 'compatible_alternate' &&
      row.itemMatch.packCompatibility === 'compatible' &&
      row.itemMatch.possibleRecodeMatchedId === mayRow.resolvedInventoryItemId
    )).toBe(true);

    const linkDecision = {
      action: 'link_existing' as const,
      inventoryItemId: mayRow.resolvedInventoryItemId,
    };
    await expect(saveOrderlyReviewDecisionChanges(
      juneBatch,
      approvalAuth,
      [{ rowIndex: 1, expectedRevision: null, decision: linkDecision }],
      { preserveExistingActions: true },
    )).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });
    expect(await db
      .select()
      .from(orderlyImportReviewDecisions)
      .where(eq(orderlyImportReviewDecisions.batchId, juneBatch))).toEqual([]);

    const saved = await saveOrderlyReviewDecisionChanges(
      juneBatch,
      approvalAuth,
      [1, 2].map(rowIndex => ({ rowIndex, expectedRevision: null, decision: linkDecision })),
      { preserveExistingActions: true },
    );
    expect(saved.decisions.map(decision => [decision.rowIndex, decision.revision])).toEqual([[1, 1], [2, 1]]);

    const rerun = await saveOrderlyReviewDecisionChanges(
      juneBatch,
      approvalAuth,
      [1, 2].map(rowIndex => ({ rowIndex, expectedRevision: 1, decision: linkDecision })),
      { preserveExistingActions: true },
    );
    expect(rerun.decisions.map(decision => [decision.rowIndex, decision.revision])).toEqual([[1, 1], [2, 1]]);

    await db
      .update(orderlyImportReviewDecisions)
      .set({
        decision: {
          action: 'create_variant',
          comparableInventoryItemId: mayRow.resolvedInventoryItemId,
        },
      })
      .where(and(
        eq(orderlyImportReviewDecisions.batchId, juneBatch),
        eq(orderlyImportReviewDecisions.rowIndex, 1),
      ));
    const beforeConflict = await db
      .select({
        rowIndex: orderlyImportReviewDecisions.rowIndex,
        decision: orderlyImportReviewDecisions.decision,
        revision: orderlyImportReviewDecisions.revision,
      })
      .from(orderlyImportReviewDecisions)
      .where(eq(orderlyImportReviewDecisions.batchId, juneBatch))
      .orderBy(orderlyImportReviewDecisions.rowIndex);

    await expect(saveOrderlyReviewDecisionChanges(
      juneBatch,
      approvalAuth,
      [1, 2].map(rowIndex => ({ rowIndex, expectedRevision: 1, decision: linkDecision })),
      { preserveExistingActions: true },
    )).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });
    const afterConflict = await db
      .select({
        rowIndex: orderlyImportReviewDecisions.rowIndex,
        decision: orderlyImportReviewDecisions.decision,
        revision: orderlyImportReviewDecisions.revision,
      })
      .from(orderlyImportReviewDecisions)
      .where(eq(orderlyImportReviewDecisions.batchId, juneBatch))
      .orderBy(orderlyImportReviewDecisions.rowIndex);
    expect(afterConflict).toEqual(beforeConflict);
  });

  it('keeps punctuation-colliding stable codes on separate items through preview and approval', async () => {
    const products = [
      { code: '638335', seedDescription: 'HUNDRED ACRE CAB SAUV MORG W CODE 638335', julyDescription: 'HUNDRED ACRE CAB SAUV MORG. W' },
      { code: '638336', seedDescription: 'HUNDRED ACRE CAB SAUV MORG W CODE 638336', julyDescription: 'HUNDRED ACRE CAB SAUV MORG W' },
      { code: '313642', seedDescription: 'MONTES PURPLE ANGEL CODE 313642', julyDescription: 'MONTES PURPLE ANGEL' },
      { code: '389849', seedDescription: 'MONTES PURPLE ANGEL CODE 389849', julyDescription: 'MONTES PURPLE ANGEL.' },
    ];
    const baseBatch = await stageBatch(products.map(product => ({
      code: product.code,
      description: product.seedDescription,
      location: 'Wine Cellar',
      supplier: 'Collision Vendor',
      packSizeRaw: '1/1 750ML',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      packagePrice: 100,
    })), '2027-06-30');
    await applyBatchApproval(baseBatch, approvalAuth);

    const baseRows = await db
      .select({
        sourceItemCode: inventoryImportRows.sourceItemCode,
        resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
      })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, baseBatch));
    const seededItemByCode = new Map(baseRows.map(row => [row.sourceItemCode, row.resolvedInventoryItemId]));
    expect(new Set(seededItemByCode.values()).size).toBe(4);

    const julyBatch = await stageBatch(products.flatMap(product =>
      ['Wine Cellar', 'Main Bar'].map(location => ({
        code: product.code,
        description: product.julyDescription,
        location,
        supplier: 'Collision Vendor',
        packSizeRaw: '1/1 750ML',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
        packagePrice: 105,
      }))
    ), '2027-07-31');

    const preview = await runResolutionPreview(julyBatch, ID.company);
    expect(preview.identitySummary.conflictingReliableCodeGroups).toEqual([]);
    expect(preview.identitySummary.identityGroupsRequiringReview).toBe(0);
    expect(preview.rows.every(row => (
      row.itemMatch.strategy === 'external_mapping' &&
      row.itemMatch.requiresReview === false &&
      row.itemMatch.matchedId === seededItemByCode.get(row.sourceItemCode)
    ))).toBe(true);
    expect(new Set(preview.rows.map(row => row.identityGroupStatus))).toEqual(new Set(['existing_item']));

    await applyBatchApproval(julyBatch, approvalAuth);
    const approvedRows = await db
      .select({
        sourceItemCode: inventoryImportRows.sourceItemCode,
        resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
      })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, julyBatch));
    expect(approvedRows.every(row =>
      row.resolvedInventoryItemId === seededItemByCode.get(row.sourceItemCode)
    )).toBe(true);

    const scopedPackMappings = await db
      .select({
        sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
        inventoryItemId: inventoryItemExternalMappings.inventoryItemId,
      })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourcePropertyId, ID.property),
        sql`${inventoryItemExternalMappings.sourceExternalId} LIKE 'ALT|CODE=%'`,
      ));
    for (const product of products) {
      expect(scopedPackMappings).toContainEqual(expect.objectContaining({
        sourceExternalId: expect.stringContaining(`ALT|CODE=${product.code}|`),
        inventoryItemId: seededItemByCode.get(product.code),
      }));
    }
  });

  it('never lets a pseudo-code group cache capture a stable code in either row order', async () => {
    for (const pseudoFirst of [true, false]) {
      const description = pseudoFirst
        ? `Alpha Cabernet Collision ${RUN}`
        : `Zulu Tequila Separation ${RUN}`;
      const stableCode = `MIXED-${RUN}-${pseudoFirst ? '1' : '2'}`;
      const pseudoRow: SourceRow = {
        code: 'HOUSE WINE',
        description,
        location: 'Wine Cellar',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      };
      const stableRow: SourceRow = {
        code: stableCode,
        description,
        location: 'Main Bar',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      };
      const batchId = await stageBatch(
        pseudoFirst ? [pseudoRow, stableRow] : [stableRow, pseudoRow],
        pseudoFirst ? '2027-08-31' : '2027-09-30',
      );

      const preview = await runResolutionPreview(batchId, ID.company);
      expect(preview.rows.find(row => row.sourceItemCode === stableCode)?.sourceCodeReliability).toBe('stable');
      expect(preview.rows.find(row => row.sourceItemCode === 'HOUSE WINE')?.sourceCodeReliability).toBe('pseudo_code');
      expect(preview.rows.every(row => row.identityGroupStatus === 'new_candidate')).toBe(true);

      await applyBatchApproval(batchId, approvalAuth);
      const rows = await db
        .select({
          sourceItemCode: inventoryImportRows.sourceItemCode,
          resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
        })
        .from(inventoryImportRows)
        .where(eq(inventoryImportRows.batchId, batchId));
      const stable = rows.find(row => row.sourceItemCode === stableCode);
      const pseudo = rows.find(row => row.sourceItemCode === 'HOUSE WINE');
      expect(stable?.resolvedInventoryItemId).toBeTruthy();
      expect(pseudo?.resolvedInventoryItemId).toBeTruthy();
      expect(stable?.resolvedInventoryItemId).not.toBe(pseudo?.resolvedInventoryItemId);

      const [stableMapping] = await db
        .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
        .from(inventoryItemExternalMappings)
        .where(and(
          eq(inventoryItemExternalMappings.companyId, ID.company),
          eq(inventoryItemExternalMappings.sourcePropertyId, ID.property),
          eq(inventoryItemExternalMappings.sourceExternalId, stableCode),
        ));
      expect(stableMapping.inventoryItemId).toBe(stable?.resolvedInventoryItemId);
    }
  });

  it('does not silently map a new stable code through an existing code sibling group', async () => {
    const existingCode = `638335-${RUN}`;
    const newCode = `638336-${RUN}`;
    const existingBatch = await stageBatch([{
      code: existingCode,
      description: 'HUNDRED ACRE CAB SAUV MORG. W',
      location: 'Wine Cellar',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
    }], '2027-10-31');
    await applyBatchApproval(existingBatch, approvalAuth);

    const collisionBatch = await stageBatch([
      {
        code: existingCode,
        description: 'HUNDRED ACRE CAB SAUV MORG. W',
        location: 'Wine Cellar',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      },
      {
        code: newCode,
        description: 'HUNDRED ACRE CAB SAUV MORG W',
        location: 'Main Bar',
        caseQuantity: 1,
        innerPackQuantity: 1,
        baseUnitQuantity: 750,
        baseUnit: 'ML',
      },
    ], '2027-11-30');
    const preview = await runResolutionPreview(collisionBatch, ID.company);
    const existingRow = preview.rows.find(row => row.sourceItemCode === existingCode)!;
    const newCodeRow = preview.rows.find(row => row.sourceItemCode === newCode)!;
    expect(existingRow.itemMatch).toMatchObject({
      strategy: 'external_mapping',
      requiresReview: false,
      matchedId: expect.any(String),
    });
    expect(newCodeRow.itemMatch).toMatchObject({
      possibleRecode: true,
      requiresReview: true,
      possibleRecodeMatchedId: existingRow.itemMatch.matchedId,
    });

    await expect(applyBatchApproval(collisionBatch, approvalAuth)).rejects.toThrow(
      new RegExp(`Item Code ${newCode}.*explicit .*decision`, 'i'),
    );
    const newCodeMappings = await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourcePropertyId, ID.property),
        eq(inventoryItemExternalMappings.sourceExternalId, newCode),
      ));
    expect(newCodeMappings).toEqual([]);
  });
});