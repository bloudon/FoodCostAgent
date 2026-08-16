/**
 * Integrity regressions for historical snapshot creation.
 *
 * These cover three failure modes that all share one shape: the snapshot looks
 * clean while the persisted valuation is wrong or unrecoverable.
 *
 *  1. Immutability is granted before the persisted valuation is verified, so a
 *     failed verification leaves behind a protected session that no guarded API
 *     can repair or delete.
 *  2. Count-line economics are derived from the parsed convenience column while
 *     reconciliation measures the raw source cell, so a raw/parsed discrepancy
 *     reconciles on screen and diverges in the database.
 *  3. A resolved row carrying value but no countable quantity is dropped from
 *     both the count lines and the retained evidence, silently deleting value
 *     that reconciliation counted on the source side.
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
const RUN = vi.hoisted(() => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`);

const ID = {
  company: `hi-co-${RUN}`,
  store: `hi-store-${RUN}`,
  admin: `hi-admin-${RUN}`,
  property: `hi-prop-${RUN}`,
  itemA: `hi-item-a-${RUN}`,
  itemB: `hi-item-b-${RUN}`,
  /** Raw source cell disagrees with the parsed column. */
  batchRawParsed: `hi-batch-raw-${RUN}`,
  /** Resolved row with value but no countable quantity. */
  batchNoGeometry: `hi-batch-geo-${RUN}`,
  /** Forces in-transaction verification to fail. */
  batchRollback: `hi-batch-rb-${RUN}`,
};

let eachUnitId = '';

/**
 * The raw cell is authoritative; the parsed column is stale by $400. Line
 * economics must follow the raw cell, or the snapshot reconciles against a
 * number it did not actually persist.
 */
const RAW_VALUE = 1000;
const STALE_PARSED_VALUE = 600;
const RAW_QTY = 4;

/** Resolved, valued, but nothing was counted — cannot become a count line. */
const NO_GEOMETRY_VALUE = 275.25;

/** Value that will fail to persist, forcing rollback. */
const ROLLBACK_VALUE = 900;

beforeAll(async () => {
  if (SKIP) return;
  await ensureHistoricalSessionUnresolvedRowsSchema(db as any);

  const [unit] = await db.select({ id: units.id }).from(units).where(eq(units.abbreviation, 'ea')).limit(1);
  if (!unit) throw new Error('Expected seeded "ea" unit');
  eachUnitId = unit.id;

  await db.insert(companiesTable).values({ id: ID.company, name: `Historical Integrity ${RUN}` });
  await db.insert(companyStores).values({
    id: ID.store,
    companyId: ID.company,
    code: `HI${RUN}`.slice(0, 10),
    name: 'Bay Hill',
    status: 'active',
  });
  await db.insert(users).values({
    id: ID.admin,
    email: `historical-integrity-${RUN}@test.local`,
    role: 'company_admin',
    companyId: ID.company,
    active: 1,
  });
  await db.insert(inventoryItems).values([
    { id: ID.itemA, companyId: ID.company, name: `Integrity Item A ${RUN}`, unitId: eachUnitId, pricePerUnit: 7 },
    { id: ID.itemB, companyId: ID.company, name: `Integrity Item B ${RUN}`, unitId: eachUnitId, pricePerUnit: 7 },
  ]);

  const batchDefaults = {
    companyId: ID.company,
    sourceSystem: 'ORDERLY' as const,
    sheetName: 'Inventory Detail',
    parserVersion: '1.0',
    inventoryDate: '2026-05-31',
    inventoryDateConfirmed: 1,
    status: 'approved' as const,
    targetStoreId: ID.store,
    sourcePropertyId: ID.property,
  };

  await db.insert(inventoryImportBatches).values([
    {
      ...batchDefaults,
      id: ID.batchRawParsed,
      fileHash: `hash-${ID.batchRawParsed}`,
      originalFilename: 'May_2026_raw_parsed.xlsx',
      sourceRowCount: 1,
      snapshotTotal: RAW_VALUE,
    },
    {
      ...batchDefaults,
      id: ID.batchNoGeometry,
      fileHash: `hash-${ID.batchNoGeometry}`,
      originalFilename: 'May_2026_no_geometry.xlsx',
      sourceRowCount: 2,
      snapshotTotal: RAW_VALUE + NO_GEOMETRY_VALUE,
    },
    {
      ...batchDefaults,
      id: ID.batchRollback,
      fileHash: `hash-${ID.batchRollback}`,
      originalFilename: 'May_2026_rollback.xlsx',
      sourceRowCount: 1,
      snapshotTotal: ROLLBACK_VALUE,
    },
  ]);

  await db.insert(inventoryImportRows).values([
    // Raw cell says $1000; the parsed column says $600.
    {
      batchId: ID.batchRawParsed,
      rowIndex: 1,
      sheetName: 'Inventory Detail',
      rawData: { 'Item Code': 'AAA', 'Total Cost': `$${RAW_VALUE.toFixed(2)}` },
      rawDescription: 'Raw vs parsed',
      cleanedDescription: 'Raw vs parsed',
      sourceItemCode: 'AAA',
      itemCodeStatus: 'valid',
      storageLocation: 'Liquor Cage',
      totalUnits: RAW_QTY,
      totalCost: STALE_PARSED_VALUE,
      packagePrice: 1,
      rowStatus: 'matched',
      resolvedInventoryItemId: ID.itemA,
    },

    // A normally counted row, plus a resolved row that carries value with
    // nothing counted against it.
    {
      batchId: ID.batchNoGeometry,
      rowIndex: 1,
      sheetName: 'Inventory Detail',
      rawData: { 'Item Code': 'AAA', 'Total Cost': `$${RAW_VALUE.toFixed(2)}` },
      rawDescription: 'Counted',
      cleanedDescription: 'Counted',
      sourceItemCode: 'AAA',
      itemCodeStatus: 'valid',
      storageLocation: 'Liquor Cage',
      totalUnits: RAW_QTY,
      totalCost: RAW_VALUE,
      rowStatus: 'matched',
      resolvedInventoryItemId: ID.itemA,
    },
    {
      batchId: ID.batchNoGeometry,
      rowIndex: 2,
      sheetName: 'Inventory Detail',
      rawData: { 'Item Code': 'BBB', 'Total Cost': `$${NO_GEOMETRY_VALUE.toFixed(2)}` },
      rawDescription: 'Valued but uncounted',
      cleanedDescription: 'Valued but uncounted',
      sourceItemCode: 'BBB',
      itemCodeStatus: 'valid',
      storageLocation: 'Liquor Cage',
      totalUnits: 0,
      count1: 0,
      count2: 0,
      count3: 0,
      totalCost: NO_GEOMETRY_VALUE,
      rowStatus: 'matched',
      resolvedInventoryItemId: ID.itemB,
    },

    // Geometry passes (count1 > 0) but the persisted quantity resolves to zero
    // because totalUnits is an explicit 0, so the line cannot carry the row's
    // value. Verification must catch the shortfall and roll the snapshot back.
    {
      batchId: ID.batchRollback,
      rowIndex: 1,
      sheetName: 'Inventory Detail',
      rawData: { 'Item Code': 'AAA', 'Total Cost': `$${ROLLBACK_VALUE.toFixed(2)}` },
      rawDescription: 'Unpersistable value',
      cleanedDescription: 'Unpersistable value',
      sourceItemCode: 'AAA',
      itemCodeStatus: 'valid',
      storageLocation: 'Liquor Cage',
      totalUnits: 0,
      count1: 2,
      totalCost: ROLLBACK_VALUE,
      rowStatus: 'matched',
      resolvedInventoryItemId: ID.itemA,
    },
  ]);
});

afterAll(async () => {
  if (SKIP) return;
  const batchIds = [ID.batchRawParsed, ID.batchNoGeometry, ID.batchRollback];
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
  await db.delete(inventoryImportRows).where(inArray(inventoryImportRows.batchId, batchIds)).catch(() => {});
  await db.delete(inventoryImportBatches).where(inArray(inventoryImportBatches.id, batchIds)).catch(() => {});
  await db.delete(inventoryItems).where(eq(inventoryItems.companyId, ID.company)).catch(() => {});
  await db.delete(storageLocations).where(eq(storageLocations.companyId, ID.company)).catch(() => {});
  await db.delete(users).where(eq(users.id, ID.admin)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, ID.company)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, ID.company)).catch(() => {});
});

describe.skipIf(SKIP)('historical snapshot integrity', () => {
  it('values count lines from the raw source cell, not the parsed column', async () => {
    const result = await createCountSession({
      batchId: ID.batchRawParsed,
      companyId: ID.company,
      userId: ID.admin,
      storeId: ID.store,
    });

    const lines = await db
      .select({ qty: inventoryCountLines.qty, unitCost: inventoryCountLines.unitCost })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryCountId, result.countId));
    expect(lines).toHaveLength(1);

    // Persisted economics must reflect the authoritative $1000, not the stale
    // parsed $600 — otherwise reconciliation compares against a total the
    // database does not actually hold.
    const persistedValue = lines[0].qty * lines[0].unitCost;
    expect(persistedValue).toBeCloseTo(RAW_VALUE, 2);
    expect(persistedValue).not.toBeCloseTo(STALE_PARSED_VALUE, 2);

    expect(result.importableTotal).toBeCloseTo(RAW_VALUE, 2);
    expect(result.reconciliationDelta).toBeCloseTo(0, 2);
  });

  it('retains a resolved row that carries value but was never counted', async () => {
    const preview = await previewCountSession(ID.batchNoGeometry, ID.company);

    // It cannot become a count line — there is no quantity to persist — but its
    // value must survive as evidence rather than vanishing from the snapshot.
    expect(preview.excludedRows.filter(r => r.reason === 'missing_count_geometry')).toHaveLength(1);
    expect(preview.unresolvedRowCount).toBe(1);
    expect(preview.unresolvedTotal).toBeCloseTo(NO_GEOMETRY_VALUE, 2);
    expect(preview.reconciliationDelta).toBeCloseTo(0, 2);

    const result = await createCountSession({
      batchId: ID.batchNoGeometry,
      companyId: ID.company,
      userId: ID.admin,
      storeId: ID.store,
    });

    expect(result.linesCreated).toBe(1);
    expect(result.unresolvedRowCount).toBe(1);
    expect(result.unresolvedTotal).toBeCloseTo(NO_GEOMETRY_VALUE, 2);
    expect(result.historicalSnapshotTotal).toBeCloseTo(RAW_VALUE + NO_GEOMETRY_VALUE, 2);
    expect(result.reconciliationDelta).toBeCloseTo(0, 2);

    // The retained row is the uncounted one, linked by evidence.
    const links = await db
      .select({ importRowId: historicalSessionUnresolvedRows.importRowId })
      .from(historicalSessionUnresolvedRows)
      .where(eq(historicalSessionUnresolvedRows.sessionId, result.countId));
    expect(links).toHaveLength(1);
    const [retained] = await db
      .select({ rowIndex: inventoryImportRows.rowIndex })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.id, links[0].importRowId));
    expect(retained.rowIndex).toBe(2);
  });

  it('rolls the whole snapshot back when the persisted valuation does not reconcile', async () => {
    await expect(
      createCountSession({
        batchId: ID.batchRollback,
        companyId: ID.company,
        userId: ID.admin,
        storeId: ID.store,
      }),
    ).rejects.toThrow(/does not reconcile|rolled back/i);

    // Nothing may survive: no session, no lines, no evidence links. A protected
    // historical session left behind here could not be repaired or deleted
    // through any guarded API.
    const sessions = await db
      .select({ id: inventoryCounts.id, isHistoricalImport: inventoryCounts.isHistoricalImport })
      .from(inventoryCounts)
      .where(eq(inventoryCounts.sourceBatchId, ID.batchRollback));
    expect(sessions).toHaveLength(0);
  });

  it('leaves the batch importable again after a rolled-back attempt', async () => {
    // The rollback must not poison the batch via the "already converted" guard —
    // a failed import that permanently blocks retry is its own dead end.
    await expect(
      createCountSession({
        batchId: ID.batchRollback,
        companyId: ID.company,
        userId: ID.admin,
        storeId: ID.store,
      }),
    ).rejects.toThrow(/does not reconcile|rolled back/i);
  });
});
