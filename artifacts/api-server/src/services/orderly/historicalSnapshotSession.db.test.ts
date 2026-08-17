/**
 * DB-backed regressions for historical Orderly snapshot sessions.
 *
 * The reconciliation gap that motivated this work was invisible to unit tests:
 * the service reported a clean import while a quarter of the source value had
 * no home in the database. These tests therefore drive the real creation path
 * and then read the persisted rows back, rather than asserting on the in-memory
 * return value alone.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  companies as companiesTable,
  companyStores,
  historicalSessionUnresolvedRows,
  inventoryCountLines,
  inventoryCounts,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItems,
  storageLocations,
  units,
  users,
} from '@workspace/db';
import { createCountSession, previewCountSession } from './orderlyCountSession';
import { ensureHistoricalSessionUnresolvedRowsSchema } from '../../migrations/historicalSessionUnresolvedRows';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = vi.hoisted(() => Date.now().toString(36));
const ID = {
  company: `hs-co-${RUN}`,
  store: `hs-store-${RUN}`,
  admin: `hs-admin-${RUN}`,
  property: `hs-prop-${RUN}`,
  batch: `hs-batch-${RUN}`,
  itemA: `hs-item-a-${RUN}`,
  itemB: `hs-item-b-${RUN}`,
};

let eachUnitId = '';

/**
 * Three-row fixture mirroring the shape of the real May population:
 * one resolved row with counts, one resolved row with no counted quantity, and
 * one blank-code row that carries real value but no identity.
 */
const RESOLVED_VALUE = 1200.5;
const ZERO_GEOMETRY_VALUE = 0;
const UNRESOLVED_VALUE = 349.5;
const SOURCE_TOTAL = RESOLVED_VALUE + ZERO_GEOMETRY_VALUE + UNRESOLVED_VALUE;

beforeAll(async () => {
  if (SKIP) return;
  await ensureHistoricalSessionUnresolvedRowsSchema(db as any);

  const [unit] = await db.select({ id: units.id }).from(units).where(eq(units.abbreviation, 'ea')).limit(1);
  if (!unit) throw new Error('Expected seeded "ea" unit');
  eachUnitId = unit.id;

  await db.insert(companiesTable).values({ id: ID.company, name: `Historical Snapshot ${RUN}` });
  await db.insert(companyStores).values({
    id: ID.store,
    companyId: ID.company,
    code: `HS${RUN}`.slice(0, 10),
    name: 'Bay Hill',
    status: 'active',
  });
  await db.insert(users).values({
    id: ID.admin,
    email: `historical-snapshot-${RUN}@test.local`,
    role: 'company_admin',
    companyId: ID.company,
    active: 1,
  });
  await db.insert(inventoryItems).values([
    { id: ID.itemA, companyId: ID.company, name: `Counted Item ${RUN}`, unitId: eachUnitId, pricePerUnit: 10 },
    { id: ID.itemB, companyId: ID.company, name: `Uncounted Item ${RUN}`, unitId: eachUnitId, pricePerUnit: 10 },
  ]);

  await db.insert(inventoryImportBatches).values({
    id: ID.batch,
    companyId: ID.company,
    sourceSystem: 'ORDERLY',
    fileHash: `hash-${ID.batch}`,
    originalFilename: 'May_2026.xlsx',
    sheetName: 'Inventory Detail',
    parserVersion: '1.0',
    inventoryDate: '2026-05-31',
    inventoryDateConfirmed: 1,
    status: 'approved',
    sourceRowCount: 3,
    snapshotTotal: SOURCE_TOTAL,
    targetStoreId: ID.store,
    sourcePropertyId: ID.property,
  });

  await db.insert(inventoryImportRows).values([
    {
      batchId: ID.batch,
      rowIndex: 1,
      sheetName: 'Inventory Detail',
      rawData: { 'Item Code': 'AAA', 'Total Cost': `$${RESOLVED_VALUE.toFixed(2)}` },
      rawDescription: 'Counted Item',
      cleanedDescription: 'Counted Item',
      sourceItemCode: 'AAA',
      itemCodeStatus: 'valid',
      storageLocation: 'Liquor Cage',
      totalUnits: 5,
      totalCost: RESOLVED_VALUE,
      packagePrice: 240.1,
      rowStatus: 'matched',
      resolvedInventoryItemId: ID.itemA,
    },
    {
      batchId: ID.batch,
      rowIndex: 2,
      sheetName: 'Inventory Detail',
      rawData: { 'Item Code': 'BBB', 'Total Cost': '$0.00' },
      rawDescription: 'Uncounted Item',
      cleanedDescription: 'Uncounted Item',
      sourceItemCode: 'BBB',
      itemCodeStatus: 'valid',
      storageLocation: 'Liquor Cage',
      totalUnits: 0,
      totalCost: 0,
      rowStatus: 'matched',
      resolvedInventoryItemId: ID.itemB,
    },
    {
      batchId: ID.batch,
      rowIndex: 3,
      sheetName: 'Inventory Detail',
      rawData: { 'Item Code': '', 'Total Cost': `$${UNRESOLVED_VALUE.toFixed(2)}` },
      rawDescription: 'Blank Code Item',
      cleanedDescription: 'Blank Code Item',
      sourceItemCode: null,
      itemCodeStatus: 'blank',
      storageLocation: 'Bay Window Bar',
      totalUnits: 3,
      totalCost: UNRESOLVED_VALUE,
      rowStatus: 'unresolved',
      resolvedInventoryItemId: null,
    },
  ]);
});

afterAll(async () => {
  if (SKIP) return;
  const sessions = await db
    .select({ id: inventoryCounts.id })
    .from(inventoryCounts)
    .where(eq(inventoryCounts.companyId, ID.company));
  const sessionIds = sessions.map(s => s.id);
  if (sessionIds.length) {
    await db.delete(historicalSessionUnresolvedRows)
      .where(inArray(historicalSessionUnresolvedRows.sessionId, sessionIds)).catch(() => {});
    await db.delete(inventoryCountLines)
      .where(inArray(inventoryCountLines.inventoryCountId, sessionIds)).catch(() => {});
  }
  await db.delete(inventoryCounts).where(eq(inventoryCounts.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryImportRows).where(eq(inventoryImportRows.batchId, ID.batch)).catch(() => {});
  await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.id, ID.batch)).catch(() => {});
  await db.delete(inventoryItems).where(eq(inventoryItems.companyId, ID.company)).catch(() => {});
  await db.delete(storageLocations).where(eq(storageLocations.companyId, ID.company)).catch(() => {});
  await db.delete(users).where(eq(users.id, ID.admin)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, ID.company)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, ID.company)).catch(() => {});
});

describe.skipIf(SKIP)('historical snapshot session', () => {
  let countId = '';

  it('classifies resolved, zero-geometry and unresolved rows in preview', async () => {
    const preview = await previewCountSession(ID.batch, ID.company);

    expect(preview.includedRows).toHaveLength(1);
    expect(preview.excludedRows.filter(r => r.reason === 'missing_count_geometry')).toHaveLength(1);
    expect(preview.excludedRows.filter(r => r.reason === 'no_item_resolved')).toHaveLength(1);

    expect(preview.unresolvedRowCount).toBe(1);
    expect(preview.unresolvedTotal).toBeCloseTo(UNRESOLVED_VALUE, 2);
    expect(preview.historicalSnapshotTotal).toBeCloseTo(SOURCE_TOTAL, 2);
    expect(preview.identityUnresolved).toBe(true);

    // The point of the change: the snapshot reconciles, even though a fifth of
    // the value never received a canonical identity.
    expect(preview.reconciliationDelta).toBeCloseTo(0, 2);
    expect(preview.reconciliationExceedsTolerance).toBe(false);
  });

  it('rejects a storeId that disagrees with the approved batch destination, even for an accessible store', async () => {
    const otherStoreId = `hs-store-other-${RUN}`;
    await db.insert(companyStores).values({
      id: otherStoreId,
      companyId: ID.company,
      code: `HSO${RUN}`.slice(0, 10),
      name: 'Other Accessible Store',
      status: 'active',
    });

    await expect(
      createCountSession({
        batchId: ID.batch,
        companyId: ID.company,
        userId: ID.admin,
        storeId: otherStoreId,
      }),
    ).rejects.toMatchObject({ code: 'BATCH_STORE_MISMATCH' });

    // Fail closed: the rejected call must have created nothing.
    const sessions = await db
      .select({ id: inventoryCounts.id })
      .from(inventoryCounts)
      .where(eq(inventoryCounts.sourceBatchId, ID.batch));
    expect(sessions).toHaveLength(0);
  });

  it('persists the snapshot with linked unresolved evidence and reconciles to zero', async () => {
    const result = await createCountSession({
      batchId: ID.batch,
      companyId: ID.company,
      userId: ID.admin,
      storeId: ID.store,
    });
    countId = result.countId;

    expect(result.linesCreated).toBe(1);
    expect(result.unresolvedRowCount).toBe(1);
    expect(result.unresolvedTotal).toBeCloseTo(UNRESOLVED_VALUE, 2);
    expect(result.historicalSnapshotTotal).toBeCloseTo(SOURCE_TOTAL, 2);
    expect(result.reconciliationDelta).toBeCloseTo(0, 2);
    expect(result.identityUnresolved).toBe(true);

    const [session] = await db
      .select({
        applied: inventoryCounts.applied,
        isHistoricalImport: inventoryCounts.isHistoricalImport,
      })
      .from(inventoryCounts)
      .where(eq(inventoryCounts.id, countId));
    expect(session.isHistoricalImport).toBe(1);
    // A historical snapshot must never touch live on-hand.
    expect(session.applied).toBe(0);

    const links = await db
      .select({ importRowId: historicalSessionUnresolvedRows.importRowId })
      .from(historicalSessionUnresolvedRows)
      .where(eq(historicalSessionUnresolvedRows.sessionId, countId));
    expect(links).toHaveLength(1);

    const [linkedRow] = await db
      .select({ sourceItemCode: inventoryImportRows.sourceItemCode })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.id, links[0].importRowId));
    expect(linkedRow.sourceItemCode).toBeNull();
  });

  it('refuses to create a second session for the same batch', async () => {
    await expect(
      createCountSession({
        batchId: ID.batch,
        companyId: ID.company,
        userId: ID.admin,
        storeId: ID.store,
      }),
    ).rejects.toThrow(/already exists/);

    const links = await db
      .select({ id: historicalSessionUnresolvedRows.id })
      .from(historicalSessionUnresolvedRows)
      .where(eq(historicalSessionUnresolvedRows.sessionId, countId));
    expect(links).toHaveLength(1);
  });

  it('rejects a duplicate evidence link for the same session and row', async () => {
    const [existing] = await db
      .select({
        importRowId: historicalSessionUnresolvedRows.importRowId,
        sourceEvidenceHash: historicalSessionUnresolvedRows.sourceEvidenceHash,
      })
      .from(historicalSessionUnresolvedRows)
      .where(eq(historicalSessionUnresolvedRows.sessionId, countId));

    await expect(
      db.insert(historicalSessionUnresolvedRows).values({
        sessionId: countId,
        importRowId: existing.importRowId,
        sourceEvidenceHash: existing.sourceEvidenceHash,
      }),
    ).rejects.toThrow();
  });

  it('keeps the retained import row from being deleted out from under the snapshot', async () => {
    const [link] = await db
      .select({ importRowId: historicalSessionUnresolvedRows.importRowId })
      .from(historicalSessionUnresolvedRows)
      .where(eq(historicalSessionUnresolvedRows.sessionId, countId));

    await expect(
      db.delete(inventoryImportRows).where(eq(inventoryImportRows.id, link.importRowId)),
    ).rejects.toThrow();
  });
});
