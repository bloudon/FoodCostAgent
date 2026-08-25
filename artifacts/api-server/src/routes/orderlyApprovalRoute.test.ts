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
  inventoryItemExternalMappings,
  importSourcePropertyBindings,
  inventoryItems,
  inventoryLocations,
  storeInventoryItems,
  units,
  vendors,
} from '@workspace/db';
import { ensureOrderlyReviewDecisionsSchema } from '../migrations/orderlyReviewDecisions';
import { applyBatchApproval } from '../services/orderly/orderlyDomain';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;

const IDs = vi.hoisted(() => {
  const RUN = Date.now().toString(36);
  return {
    RUN,
    company: `oar-co-${RUN}`,
    store: `oar-store-${RUN}`,
    otherStore: `oar-other-${RUN}`,
    admin: `oar-admin-${RUN}`,
    manager: `oar-manager-${RUN}`,
    scoped: `oar-scoped-${RUN}`,
    staff: `oar-staff-${RUN}`,
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
    const role = authState.userId === IDs.manager
      ? 'store_manager'
      : authState.userId === IDs.scoped || authState.userId === IDs.staff
        ? 'store_user'
        : 'company_admin';
    req.user = { id: authState.userId, companyId: IDs.company, role };
    req.companyId = IDs.company;
    next();
  }),
  optionalAuth: vi.fn((_req: any, _res: any, next: any) => next()),
  requireTier: vi.fn(() => (_req: any, _res: any, next: any) => next()),
  requireRole: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

let registerOrderlyImportRoutes: (app: express.Express) => void;

let batchSeq = 0;
let cachedEachUnitId: string | null = null;

async function eachUnitId() {
  if (cachedEachUnitId) return cachedEachUnitId;
  const [unit] = await db
    .select({ id: units.id })
    .from(units)
    .where(eq(units.abbreviation, 'ea'))
    .limit(1);
  if (!unit) throw new Error('Expected seeded "ea" unit for Orderly approval route fixtures');
  cachedEachUnitId = unit.id;
  return unit.id;
}

async function stageBatch(opts: {
  targetStoreId?: string | null;
  withBinding?: boolean;
  sourceSystem?: string;
  status?: string;
}) {
  const id = `oar-batch-${IDs.RUN}-${batchSeq++}`;
  await db.insert(inventoryImportBatches).values({
    id,
    companyId: IDs.company,
    sourceSystem: opts.sourceSystem ?? 'ORDERLY',
    fileHash: `hash-${id}`,
    originalFilename: `${id}.xlsx`,
    sheetName: 'Inventory Detail',
    parserVersion: '1.0',
    inventoryDate: null,
    inventoryDateConfirmed: 0,
    status: opts.status ?? 'pending_review',
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

  await ensureOrderlyReviewDecisionsSchema(db);
  ({ registerOrderlyImportRoutes } = await import('./orderlyImportRoutes'));

  await db.insert(companiesTable).values({ id: IDs.company, name: `OAR Co ${IDs.RUN}` });
  await db.insert(companyStores).values([
    { id: IDs.store, companyId: IDs.company, code: `RA${IDs.RUN}`.slice(0, 10), name: 'Bay Hill', status: 'active' },
    { id: IDs.otherStore, companyId: IDs.company, code: `RB${IDs.RUN}`.slice(0, 10), name: 'Other', status: 'active' },
  ]);
  await db.insert(users).values([
    { id: IDs.admin, email: `oar-admin-${IDs.RUN}@test.local`, role: 'company_admin', companyId: IDs.company, active: 1 },
    { id: IDs.manager, email: `oar-manager-${IDs.RUN}@test.local`, role: 'store_manager', companyId: IDs.company, active: 1 },
    { id: IDs.scoped, email: `oar-scoped-${IDs.RUN}@test.local`, role: 'store_user', companyId: IDs.company, active: 1 },
    { id: IDs.staff, email: `oar-staff-${IDs.RUN}@test.local`, role: 'store_user', companyId: IDs.company, active: 1 },
  ]);
  // Scoped user can reach only the "Other" store — never Bay Hill. The
  // manager and staff fixtures can reach Bay Hill, so role and destination
  // authorization are tested independently.
  await db.insert(userStores).values([
    { userId: IDs.manager, storeId: IDs.store },
    { userId: IDs.scoped, storeId: IDs.otherStore },
    { userId: IDs.staff, storeId: IDs.store },
  ]);
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
  await db.delete(userStores).where(inArray(userStores.userId, [IDs.manager, IDs.scoped, IDs.staff])).catch(() => {});
  await db.delete(users).where(inArray(users.id, [IDs.admin, IDs.manager, IDs.scoped, IDs.staff])).catch(() => {});
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

  it('allows an assigned store manager to approve the destination store', async () => {
    authState.userId = IDs.manager;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const res = await supertest(buildApp()).post(url(batchId)).send({});

    expect(res.status).toBe(200);
    expect((await batchState(batchId))?.status).toBe('approved');
    expect((await batchState(batchId))?.approvedBy).toBe(IDs.manager);
  });

  it('rejects an unsaved client override instead of silently changing the persisted review draft', async () => {
    authState.userId = IDs.admin;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const res = await supertest(buildApp()).post(url(batchId)).send({
      rowDecisions: [{ rowIndex: 1, inventoryItemId: 'forged-item-id' }],
    });

    expect(res.status).toBe(400);
    expect((await batchState(batchId))?.status).toBe('pending_review');
  });

  it('returns 403 (not 401) when the user lacks access to the destination store', async () => {
    authState.userId = IDs.scoped;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const res = await supertest(buildApp()).post(url(batchId)).send({ rowDecisions: [] });

    expect(res.status).toBe(403);
    expect((await batchState(batchId))?.status).toBe('pending_review');
  });

  it('rejects a destination-authorized store user before any approval write', async () => {
    authState.userId = IDs.staff;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const res = await supertest(buildApp()).post(url(batchId)).send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('company admins and managers');
    expect((await batchState(batchId))?.status).toBe('pending_review');
  });

  it('rejects a direct service approval from a destination-authorized store user', async () => {
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    await expect(
      applyBatchApproval(batchId, { actingUserId: IDs.staff, companyId: IDs.company }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Only company admins and managers can approve Orderly imports.',
    });
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

  it('rejects a non-Orderly batch instead of applying Orderly approval logic', async () => {
    authState.userId = IDs.admin;
    const batchId = await stageBatch({
      targetStoreId: IDs.store,
      withBinding: true,
      sourceSystem: 'INVOICE',
    });

    const res = await supertest(buildApp()).post(url(batchId)).send({});

    expect(res.status).toBe(404);
    expect((await batchState(batchId))?.status).toBe('pending_review');
  });

  it.each(['cancelled', 'failed', 'processing'])(
    'rejects %s batches before any approval write',
    async (status) => {
      authState.userId = IDs.admin;
      const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true, status });

      const res = await supertest(buildApp()).post(url(batchId)).send({});

      expect(res.status).toBe(409);
      expect((await batchState(batchId))?.status).toBe(status);
    },
  );
});

describe.skipIf(SKIP)('Orderly review decision drafts', () => {
  const decisionsUrl = (id: string) => `/api/inventory-import/orderly/batches/${id}/review-decisions`;
  const approvalUrl = (id: string) => `/api/inventory-import/orderly/batches/${id}/approve`;

  it('stores a draft decision and returns it after a separate read', async () => {
    authState.userId = IDs.admin;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const saved = await supertest(buildApp())
      .put(decisionsUrl(batchId))
      .send({
        changes: [{
          rowIndex: 1,
          expectedRevision: null,
          decision: { inventoryItemId: null },
        }],
      });

    expect(saved.status).toBe(200);
    expect(saved.body.decisions).toHaveLength(1);
    expect(saved.body.decisions[0]).toMatchObject({
      rowIndex: 1,
      revision: 1,
      decision: { inventoryItemId: null },
    });

    const reloaded = await supertest(buildApp()).get(decisionsUrl(batchId));
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.decisions).toHaveLength(1);
    expect(reloaded.body.decisions[0]).toMatchObject({
      rowIndex: 1,
      revision: 1,
      decision: { inventoryItemId: null },
    });
  });

  it('rejects draft access for a non-Orderly batch', async () => {
    authState.userId = IDs.admin;
    const batchId = await stageBatch({
      targetStoreId: IDs.store,
      withBinding: true,
      sourceSystem: 'INVOICE',
    });

    const [read, write, preview] = await Promise.all([
      supertest(buildApp()).get(decisionsUrl(batchId)),
      supertest(buildApp()).put(decisionsUrl(batchId)).send({
        changes: [{
          rowIndex: 1,
          expectedRevision: null,
          decision: { inventoryItemId: null },
        }],
      }),
      supertest(buildApp()).get(`/api/inventory-import/orderly/batches/${batchId}/resolution-preview`),
    ]);

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
    expect(preview.status).toBe(404);
    expect((await batchState(batchId))?.status).toBe('pending_review');
  });

  it('rejects a stale reviewer revision rather than silently overwriting a saved draft', async () => {
    authState.userId = IDs.admin;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const firstSave = await supertest(buildApp())
      .put(decisionsUrl(batchId))
      .send({
        changes: [{
          rowIndex: 1,
          expectedRevision: null,
          decision: { inventoryItemId: null },
        }],
      });
    expect(firstSave.status).toBe(200);

    const staleSave = await supertest(buildApp())
      .put(decisionsUrl(batchId))
      .send({
        changes: [{
          rowIndex: 1,
          expectedRevision: null,
          decision: { inventoryItemId: null },
        }],
      });
    expect(staleSave.status).toBe(409);

    const reloaded = await supertest(buildApp()).get(decisionsUrl(batchId));
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.decisions).toHaveLength(1);
    expect(reloaded.body.decisions[0].revision).toBe(1);
  });

  it('still allows a destination-authorized store user to save a review draft', async () => {
    authState.userId = IDs.staff;
    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });

    const saved = await supertest(buildApp())
      .put(decisionsUrl(batchId))
      .send({
        changes: [{
          rowIndex: 1,
          expectedRevision: null,
          decision: { inventoryItemId: null },
        }],
      });

    expect(saved.status).toBe(200);
    expect(saved.body.decisions[0]).toMatchObject({
      rowIndex: 1,
      revision: 1,
      decision: { inventoryItemId: null },
    });
    const reloaded = await supertest(buildApp()).get(decisionsUrl(batchId));
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.decisions[0]).toMatchObject({
      rowIndex: 1,
      revision: 1,
      decision: { inventoryItemId: null },
    });

    const preview = await supertest(buildApp())
      .get(`/api/inventory-import/orderly/batches/${batchId}/resolution-preview`);
    expect(preview.status).toBe(200);
    expect((await batchState(batchId))?.status).toBe('pending_review');
  });

  it('uses a saved compatible link when approval receives an empty request body', async () => {
    authState.userId = IDs.admin;
    const sourceItemCode = `DRAFT-${IDs.RUN}`.toUpperCase();
    const candidateName = `Saved Draft Candidate ${IDs.RUN}`;
    const [candidate] = await db
      .insert(inventoryItems)
      .values({
        companyId: IDs.company,
        name: candidateName,
        unitId: await eachUnitId(),
        caseSize: 6,
        pricePerUnit: 30,
        avgCostPerUnit: 30,
        active: 1,
        yieldPercent: 100,
      })
      .returning({ id: inventoryItems.id });

    await db.insert(inventoryItemExternalMappings).values({
      companyId: IDs.company,
      inventoryItemId: candidate.id,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: IDs.sourceProperty,
      sourceExternalId: `PRIOR-${IDs.RUN}`.toUpperCase(),
      sourceDescription: candidateName,
      caseQuantity: 6,
      innerPackQuantity: 1,
      baseUnitQuantity: 1,
      baseUnit: 'EA',
      matchStrategy: 'manual',
    });

    const batchId = await stageBatch({ targetStoreId: IDs.store, withBinding: true });
    await db
      .update(inventoryImportRows)
      .set({
        rawDescription: candidateName,
        cleanedDescription: candidateName,
        sourceItemCode,
        itemCodeStatus: 'valid',
        caseQuantity: 6,
        innerPackQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'EA',
      })
      .where(eq(inventoryImportRows.batchId, batchId));

    const saved = await supertest(buildApp())
      .put(decisionsUrl(batchId))
      .send({
        changes: [{
          rowIndex: 1,
          expectedRevision: null,
          decision: { action: 'link_existing', inventoryItemId: candidate.id },
        }],
      });
    expect(saved.status).toBe(200);

    const approval = await supertest(buildApp()).post(approvalUrl(batchId)).send({});
    expect(approval.status).toBe(200);
    expect(approval.body.itemsCreated).toBe(0);

    const [approvedRow] = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    expect(approvedRow.resolvedInventoryItemId).toBe(candidate.id);

    const mappings = await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(
        eq(inventoryItemExternalMappings.sourceExternalId, sourceItemCode),
      );
    expect(mappings).toEqual([{ inventoryItemId: candidate.id }]);
  });
});
