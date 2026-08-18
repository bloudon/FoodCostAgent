/**
 * HTTP-level regression for BATCH_STORE_MISMATCH on
 * POST /api/inventory-import/orderly/batches/:batchId/create-count-session
 *
 * The service rejects a caller-supplied storeId that disagrees with the
 * approved batch destination, even when the caller has access to that store.
 * This test proves the contract holds end-to-end through the real HTTP route
 * — a gap the DB-level service test cannot catch if the route ever strips or
 * mis-maps the error code before sending the response.
 *
 * Specifically: a multi-store company_admin user posting create-count-session
 * with an accessible-but-wrong storeId must receive 409 with code
 * BATCH_STORE_MISMATCH, and no inventory_counts row may be created.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { db } from '../db';
import { eq, inArray } from 'drizzle-orm';
import {
  users,
  companies as companiesTable,
  companyStores,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryCounts,
  inventoryItems,
  units,
} from '@workspace/db';

// ── Skip when there is no real DB ────────────────────────────────────────────
const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;

// ── Stable IDs for this test run ─────────────────────────────────────────────
const IDs = vi.hoisted(() => {
  const RUN = Date.now().toString(36);
  return {
    RUN,
    company:    `ccs-co-${RUN}`,
    storeA:     `ccs-store-a-${RUN}`,   // the store the batch was approved for
    storeB:     `ccs-store-b-${RUN}`,   // a different, accessible store
    admin:      `ccs-admin-${RUN}`,
    batch:      `ccs-batch-${RUN}`,
    item:       `ccs-item-${RUN}`,
  };
});

/** Which user the stubbed auth middleware injects. */
const authState = vi.hoisted(() => ({ userId: '' as string }));

// Stub auth — inject a company_admin identity the same way requireAuth does.
vi.mock('../auth', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: authState.userId, companyId: IDs.company, role: 'company_admin' };
    req.companyId = IDs.company;
    next();
  }),
  optionalAuth:  vi.fn((_req: any, _res: any, next: any) => next()),
  requireTier:   vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireRole:   vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

let registerOrderlyImportRoutes: (app: express.Express) => void;

function buildApp() {
  const app = express();
  app.use(express.json());
  registerOrderlyImportRoutes(app);
  return app;
}

const url = (batchId: string) =>
  `/api/inventory-import/orderly/batches/${batchId}/create-count-session`;

// ── Seed ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (SKIP) return;

  ({ registerOrderlyImportRoutes } = await import('./orderlyImportRoutes'));

  // Look up a seeded unit (needed for the inventory item).
  const [eachUnit] = await db
    .select({ id: units.id })
    .from(units)
    // @ts-ignore
    .where(eq(units.abbreviation, 'ea'))
    .limit(1);
  if (!eachUnit) throw new Error('Seeded "ea" unit not found');
  const eachUnitId = eachUnit.id;

  await db.insert(companiesTable).values({
    id: IDs.company,
    name: `CCS Test Co ${IDs.RUN}`,
  });

  await db.insert(companyStores).values([
    {
      id: IDs.storeA,
      companyId: IDs.company,
      code: `CSA${IDs.RUN}`.slice(0, 10),
      name: 'Store A (approved destination)',
      status: 'active',
    },
    {
      id: IDs.storeB,
      companyId: IDs.company,
      code: `CSB${IDs.RUN}`.slice(0, 10),
      name: 'Store B (accessible but wrong)',
      status: 'active',
    },
  ]);

  await db.insert(users).values({
    id: IDs.admin,
    email: `ccs-admin-${IDs.RUN}@test.local`,
    role: 'company_admin',
    companyId: IDs.company,
    active: 1,
  });

  // company_admin has access to every store — no userStores row needed.

  await db.insert(inventoryItems).values({
    id: IDs.item,
    companyId: IDs.company,
    name: `CCS Item ${IDs.RUN}`,
    unitId: eachUnitId,
    pricePerUnit: 10,
  });

  // An approved batch whose authoritative destination is storeA.
  await db.insert(inventoryImportBatches).values({
    id: IDs.batch,
    companyId: IDs.company,
    sourceSystem: 'ORDERLY',
    fileHash: `hash-${IDs.batch}`,
    originalFilename: 'May_2026.xlsx',
    sheetName: 'Inventory Detail',
    parserVersion: '1.0',
    inventoryDate: '2026-05-31',
    inventoryDateConfirmed: 1,
    status: 'approved',
    sourceRowCount: 1,
    snapshotTotal: 120.0,
    targetStoreId: IDs.storeA,  // ← approved for storeA only
    sourcePropertyId: `ccs-prop-${IDs.RUN}`,
  });

  // One resolved row so the preview's includedRows is non-empty.
  // rawData must contain a valid 'Total Cost' cell (read by authoritativeSourceValue).
  await db.insert(inventoryImportRows).values({
    batchId: IDs.batch,
    rowIndex: 1,
    sheetName: 'Inventory Detail',
    rawData: { 'Total Cost': '$120.00' },
    rawDescription: 'CCS Test Item',
    cleanedDescription: 'CCS Test Item',
    sourceItemCode: 'CCS001',
    itemCodeStatus: 'valid',
    storageLocation: 'Dry Store',
    totalUnits: 12,
    totalCost: 120.0,
    packagePrice: 10.0,
    rowStatus: 'matched',
    resolvedInventoryItemId: IDs.item,
  });
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (SKIP) return;

  // Remove any sessions that may have slipped through (should be zero).
  const sessions = await db
    .select({ id: inventoryCounts.id })
    .from(inventoryCounts)
    // @ts-ignore
    .where(eq(inventoryCounts.sourceBatchId, IDs.batch));
  if (sessions.length) {
    await db
      .delete(inventoryCounts)
      // @ts-ignore
      .where(inArray(inventoryCounts.id, sessions.map(s => s.id)))
      .catch(() => {});
  }

  await db
    .delete(inventoryImportRows)
    // @ts-ignore
    .where(eq(inventoryImportRows.batchId, IDs.batch))
    .catch(() => {});
  await db
    .delete(inventoryImportBatches)
    // @ts-ignore
    .where(eq(inventoryImportBatches.id, IDs.batch))
    .catch(() => {});
  await db
    .delete(inventoryItems)
    // @ts-ignore
    .where(eq(inventoryItems.companyId, IDs.company))
    .catch(() => {});
  await db
    .delete(users)
    // @ts-ignore
    .where(eq(users.id, IDs.admin))
    .catch(() => {});
  await db
    .delete(companyStores)
    // @ts-ignore
    .where(eq(companyStores.companyId, IDs.company))
    .catch(() => {});
  await db
    .delete(companiesTable)
    // @ts-ignore
    .where(eq(companiesTable.id, IDs.company))
    .catch(() => {});
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)(
  'POST /api/.../batches/:batchId/create-count-session — BATCH_STORE_MISMATCH',
  () => {
    it(
      'returns 409 with code BATCH_STORE_MISMATCH when an accessible-but-wrong storeId is supplied',
      async () => {
        authState.userId = IDs.admin;

        const res = await supertest(buildApp())
          .post(url(IDs.batch))
          .send({ storeId: IDs.storeB }); // accessible store, but NOT the approved destination

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('BATCH_STORE_MISMATCH');
      },
    );

    it('creates no inventory_counts row when the request is rejected with BATCH_STORE_MISMATCH', async () => {
      authState.userId = IDs.admin;

      // Repeat the mismatched call (idempotent — no side effects on rejection).
      await supertest(buildApp())
        .post(url(IDs.batch))
        .send({ storeId: IDs.storeB });

      const sessions = await db
        .select({ id: inventoryCounts.id })
        .from(inventoryCounts)
        // @ts-ignore
        .where(eq(inventoryCounts.sourceBatchId, IDs.batch));

      expect(sessions).toHaveLength(0);
    });
  },
);
