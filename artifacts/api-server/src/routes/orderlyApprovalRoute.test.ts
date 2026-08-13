/**
 * HTTP-level regression tests for POST
 * /api/inventory-import/orderly/batches/:batchId/approve
 *
 * These exist because the service-boundary tests call `applyBatchApproval`
 * directly and therefore cannot catch a broken ROUTE→SERVICE connector.
 *
 * Specifically, the route previously read the acting user from `req.userId`,
 * which `requireAuth` never sets — so every real HTTP approval failed with 401
 * while all direct-service tests still passed. These tests mount the real
 * production route module so that class of regression is caught.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { db } from '../db';
import { eq, inArray } from 'drizzle-orm';
import {
  users,
  userStores,
  companies as companiesTable,
  companyStores,
  inventoryImportBatches,
  inventoryImportRows,
  importSourcePropertyBindings,
  inventoryItems,
  inventoryLocations,
  storeInventoryItems,
  vendors,
} from '@workspace/db';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;

const IDs = vi.hoisted(() => {
  const RUN = Date.now().toString(36);
  return {
    RUN,
    company: `oar-co-${RUN}`,
    store: `oar-store-${RUN}`,
    otherStore: `oar-other-${RUN}`,
    admin: `oar-admin-${RUN}`,
    scoped: `oar-scoped-${RUN}`,
    binding: `oar-bind-${RUN}`,
    sourceProperty: `24472-${RUN}`,
  };
});

/** Which seeded user the stubbed auth middleware injects for a given request. */
const authState = vi.hoisted(() => ({ userId: '' as string }));

// Stub auth: inject the seeded identity the way the real requireAuth does —
// `req.user` (full object) and `req.companyId`. Deliberately does NOT set
// `req.userId`, matching production behavior, so the route must read `user.id`.
vi.mock('../auth', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: authState.userId, companyId: IDs.company };
    req.companyId = IDs.company;
    next();
  }),
  optionalAuth: vi.fn((_req: any, _res: any, next: any) => next()),
  requireTier: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireRole: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

let registerOrderlyImportRoutes: (app: express.Express) => void;

let batchSeq = 0;
async function stageBatch(opts: { targetStoreId?: string | null; withBinding?: boolean }) {
  const id = `oar-batch-${IDs.RUN}-${batchSeq++}`;
  await db.insert(inventoryImportBatches).values({
    id,
    companyId: IDs.company,
    sourceSystem: 'ORDERLY',
    fileHash: `hash-${id}`,
    originalFilename: `${id}.xlsx`,
    sheetName: 'Inventory Detail',
    parserVersion: '1.0',
    inventoryDate: null,
    inventoryDateConfirmed: 0,
    status: 'pending_review',
    sourceRowCount: 1,
    targetStoreId: opts.targetStoreId ?? null,
    sourcePropertyBindingId: opts.withBinding ? IDs.binding : null,
    sourcePropertyId: opts.withBinding ? IDs.sourceProperty : null,
  });
  await db.insert(inventoryImportRows).values({
    batchId: id,
    rowIndex: 1,
    sheetName: 'Inventory Detail',
    rawData: { desc: 'Route Test Item' },
    rawDescription: `Route Test Item ${id}`,
    cleanedDescription: `Route Test Item ${id}`,
    caseQuantity: 1,
    packagePrice: 5,
    itemCodeStatus: 'missing',
    supplierStatus: 'missing',
    rowStatus: 'new_item_candidate',
  });
  return id;
}

async function batchState(batchId: string) {
  const [row] = await db
    .select({
      status: inventoryImportBatches.status,
      targetStoreId: inventoryImportBatches.targetStoreId,
      approvedBy: inventoryImportBatches.approvedBy,
    })
    .from(inventoryImportBatches)
    .where(eq(inventoryImportBatches.id, batchId));
  return row;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  registerOrderlyImportRoutes(app);
  return app;
}

beforeAll(async () => {
  if (SKIP) return;

  ({ registerOrderlyImportRoutes } = await import('./orderlyImportRoutes'));

  await db.insert(companiesTable).values({ id: IDs.company, name: `OAR Co ${IDs.RUN}` });
  await db.insert(companyStores).values([
    { id: IDs.store, companyId: IDs.company, code: `RA${IDs.RUN}`.slice(0, 10), name: 'Bay Hill', status: 'active' },
    { id: IDs.otherStore, companyId: IDs.company, code: `RB${IDs.RUN}`.slice(0, 10), name: 'Other', status: 'active' },
  ]);
  await db.insert(users).values([
    { id: IDs.admin, email: `oar-admin-${IDs.RUN}@test.local`, role: 'company_admin', companyId: IDs.company, active: 1 },
    { id: IDs.scoped, email: `oar-scoped-${IDs.RUN}@test.local`, role: 'store_user', companyId: IDs.company, active: 1 },
  ]);
  // Scoped user can reach only the "Other" store — never Bay Hill.
  await db.insert(userStores).values([{ userId: IDs.scoped, storeId: IDs.otherStore }]);
  await db.insert(importSourcePropertyBindings).values({
    id: IDs.binding,
    companyId: IDs.company,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: IDs.sourceProperty,
    sourcePropertyLabel: 'Bay Hill',
    destinationStoreId: IDs.store,
    active: 1,
  });
});

afterAll(async () => {
  if (SKIP) return;
  const batches = await db
    .select({ id: inventoryImportBatches.id })
    .from(inventoryImportBatches)
    .where(eq(inventoryImportBatches.companyId, IDs.company));
  const ids = (batches as Array<{ id: string }>).map(b => b.id);
  if (ids.length) await db.delete(inventoryImportRows).where(inArray(inventoryImportRows.batchId, ids)).catch(() => {});
  await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.companyId, IDs.company)).catch(() => {});
  await db.delete(importSourcePropertyBindings).where(eq(importSourcePropertyBindings.companyId, IDs.company)).catch(() => {});
  await db.delete(storeInventoryItems).where(eq(storeInventoryItems.companyId, IDs.company)).catch(() => {});
  await db.delete(inventoryItems).where(eq(inventoryItems.companyId, IDs.company)).catch(() => {});
  await db.delete(inventoryLocations).where(eq(inventoryLocations.companyId, IDs.company)).catch(() => {});
  await db.delete(vendors).where(eq(vendors.companyId, IDs.company)).catch(() => {});
  await db.delete(userStores).where(eq(userStores.userId, IDs.scoped)).catch(() => {});
  await db.delete(users).where(inArray(users.id, [IDs.admin, IDs.scoped])).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, IDs.company)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, IDs.company)).catch(() => {});
});

describe.skipIf(SKIP)('POST /api/inventory-import/orderly/batches/:batchId/approve', () => {
  const url = (id: string) => `/api/inventory-import/orderly/batches/${id}/approve`;

  it('approves over HTTP for an authorized user (regression: acting user must reach the service)', async () => {
    authState.userId = IDs.admin;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const res = await supertest(buildApp()).post(url(batchId)).send({ rowDecisions: [] });

    // The original bug returned 401 here because the route read req.userId.
    expect(res.status).toBe(200);
    expect(res.body.targetStoreId).toBe(IDs.store);

    const after = await batchState(batchId);
    expect(after?.status).toBe('approved');
    expect(after?.approvedBy).toBe(IDs.admin); // real identity recorded, not null
  });

  it('returns 403 (not 401) when the user lacks access to the destination store', async () => {
    authState.userId = IDs.scoped;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const res = await supertest(buildApp()).post(url(batchId)).send({ rowDecisions: [] });

    expect(res.status).toBe(403);
    expect((await batchState(batchId))?.status).toBe('pending_review');
  });

  it('ignores a client-supplied storeId and keeps the approved binding destination', async () => {
    authState.userId = IDs.admin;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const res = await supertest(buildApp())
      .post(url(batchId))
      .send({ rowDecisions: [], storeId: IDs.otherStore }); // attempted redirect

    expect(res.status).toBe(200);
    expect(res.body.targetStoreId).toBe(IDs.store);
    expect((await batchState(batchId))?.targetStoreId).toBe(IDs.store);
  });

  it('returns 409 when the batch was already approved', async () => {
    authState.userId = IDs.admin;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    await supertest(buildApp()).post(url(batchId)).send({ rowDecisions: [] });
    const res = await supertest(buildApp()).post(url(batchId)).send({ rowDecisions: [] });

    expect(res.status).toBe(409);
  });

  it('returns 404 for a batch that does not exist', async () => {
    authState.userId = IDs.admin;
    const res = await supertest(buildApp())
      .post(url(`missing-${IDs.RUN}`))
      .send({ rowDecisions: [] });

    expect(res.status).toBe(404);
  });
});
