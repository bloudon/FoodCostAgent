/**
 * Service-boundary tests for the authoritative import approval contract.
 *
 * These tests call the REAL shared service (`applyBatchApproval`) directly —
 * not a route, not a helper — against a live database. That is the point of
 * the contract: the shared ingestion layer must be safe when invoked
 * independently of any HTTP route.
 *
 * Required cases covered here:
 *   1.  authorized user + correct company/store/source succeeds
 *   2.  wrong company rejected
 *   3.  user without target-store permission rejected
 *   4.  source-property mismatch rejected
 *   5.  target substitution rejected
 *   6.  cross-company destination rejected
 *   7.  null/omitted authorization context cannot bypass enforcement
 *   8.  failed authorization produces zero writes
 *   9.  valid retry remains idempotent
 *   10. already-bound valid destination cannot be changed by the request
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../../db';
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
  inventoryItemExternalMappings,
  inventoryLocations,
  storeInventoryItems,
  vendors,
} from '@workspace/db';
import { applyBatchApproval, ImportApprovalError } from './orderlyDomain';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;

const RUN = Date.now().toString(36);
const ID = {
  companyA: `iap-coA-${RUN}`,
  companyB: `iap-coB-${RUN}`,
  storeBayHill: `iap-bayhill-${RUN}`,
  storeOther: `iap-other-${RUN}`,
  storeCompanyB: `iap-costore-b-${RUN}`,
  adminA: `iap-adminA-${RUN}`,
  adminB: `iap-adminB-${RUN}`,
  scopedManager: `iap-scoped-manager-${RUN}`,
  inactiveUser: `iap-inactive-${RUN}`,
  bindingBayHill: `iap-bind-bh-${RUN}`,
  bindingOther: `iap-bind-other-${RUN}`,
};

/** Orderly restaurant id for the Bay Hill property (the approved source). */
const BAY_HILL_SOURCE_PROPERTY = `24472-${RUN}`;
/** A different source property — must never be approvable into Bay Hill. */
const LATROBE_SOURCE_PROPERTY = `31337-${RUN}`;

let batchSeq = 0;

/** Stage a batch directly (bypassing the route) so the service is tested alone. */
async function stageBatch(opts: {
  companyId: string;
  targetStoreId?: string | null;
  sourcePropertyBindingId?: string | null;
  sourcePropertyId?: string | null;
  status?: string;
  rows?: Array<{
    sourceItemCode?: string | null;
    itemCodeStatus?: string;
    rawDescription?: string;
    cleanedDescription?: string;
    supplierRaw?: string | null;
    caseQuantity?: number | null;
    innerPackQuantity?: number | null;
    baseUnitQuantity?: number | null;
    baseUnit?: string | null;
  }>;
}): Promise<string> {
  const id = `iap-batch-${RUN}-${batchSeq++}`;
  await db.insert(inventoryImportBatches).values({
    id,
    companyId: opts.companyId,
    sourceSystem: 'ORDERLY',
    fileHash: `hash-${id}`,
    originalFilename: `${id}.xlsx`,
    sheetName: 'Inventory Detail',
    parserVersion: '1.0',
    inventoryDate: null,
    inventoryDateConfirmed: 0,
    status: opts.status ?? 'pending_review',
    sourceRowCount: 1,
    targetStoreId: opts.targetStoreId ?? null,
    sourcePropertyBindingId: opts.sourcePropertyBindingId ?? null,
    sourcePropertyId: opts.sourcePropertyId ?? null,
  });

  // One simple row so an approved run has real work to do. Targeted callers
  // can stage evidence edge cases without bypassing the shared service.
  const rows = opts.rows ?? [{}];
  await db.insert(inventoryImportRows).values(rows.map((row, index) => ({
    batchId: id,
    rowIndex: index + 1,
    sheetName: 'Inventory Detail',
    rawData: { desc: row.rawDescription ?? 'Test Item' },
    rawDescription: row.rawDescription ?? `Boundary Test Item ${id}`,
    cleanedDescription: row.cleanedDescription ?? row.rawDescription ?? `Boundary Test Item ${id}`,
    sourceItemCode: row.sourceItemCode ?? null,
    supplierRaw: row.supplierRaw ?? null,
    caseQuantity: row.caseQuantity ?? 1,
    innerPackQuantity: row.innerPackQuantity ?? null,
    baseUnitQuantity: row.baseUnitQuantity ?? null,
    baseUnit: row.baseUnit ?? null,
    packagePrice: 10,
    itemCodeStatus: row.itemCodeStatus ?? 'missing',
    supplierStatus: row.supplierRaw ? 'valid' : 'missing',
    rowStatus: 'new_item_candidate',
  })));

  return id;
}

/** Snapshot the state that a rejected approval must never change. */
async function snapshotBatch(batchId: string) {
  const [row] = await db
    .select({
      status: inventoryImportBatches.status,
      targetStoreId: inventoryImportBatches.targetStoreId,
      approvedAt: inventoryImportBatches.approvedAt,
      approvedBy: inventoryImportBatches.approvedBy,
    })
    .from(inventoryImportBatches)
    .where(eq(inventoryImportBatches.id, batchId));
  return row;
}

/** Count domain records that an approval would create. */
async function countDomainRecords(companyId: string) {
  const [items, locs, vends, mappings] = await Promise.all([
    db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.companyId, companyId)),
    db.select({ id: inventoryLocations.id }).from(inventoryLocations).where(eq(inventoryLocations.companyId, companyId)),
    db.select({ id: vendors.id }).from(vendors).where(eq(vendors.companyId, companyId)),
    db.select({ id: inventoryItemExternalMappings.id }).from(inventoryItemExternalMappings).where(eq(inventoryItemExternalMappings.companyId, companyId)),
  ]);
  return { items: items.length, locations: locs.length, vendors: vends.length, mappings: mappings.length };
}

beforeAll(async () => {
  if (SKIP) return;

  await db.insert(companiesTable).values([
    { id: ID.companyA, name: `IAP Co A ${RUN}` },
    { id: ID.companyB, name: `IAP Co B ${RUN}` },
  ]);

  await db.insert(companyStores).values([
    { id: ID.storeBayHill, companyId: ID.companyA, code: `BH${RUN}`.slice(0, 10), name: 'Bay Hill', status: 'active' },
    { id: ID.storeOther, companyId: ID.companyA, code: `OT${RUN}`.slice(0, 10), name: 'Other Club', status: 'active' },
    { id: ID.storeCompanyB, companyId: ID.companyB, code: `CB${RUN}`.slice(0, 10), name: 'Company B Store', status: 'active' },
  ]);

  await db.insert(users).values([
    // Company admin for company A — authorized for all company A stores.
    { id: ID.adminA, email: `iap-admina-${RUN}@test.local`, role: 'company_admin', companyId: ID.companyA, active: 1 },
    // Company admin for company B — must not touch company A.
    { id: ID.adminB, email: `iap-adminb-${RUN}@test.local`, role: 'company_admin', companyId: ID.companyB, active: 1 },
    // Store manager in company A assigned ONLY to "Other Club" — not Bay Hill.
    // This must reach the destination guard after passing the approval role gate.
    { id: ID.scopedManager, email: `iap-scoped-manager-${RUN}@test.local`, role: 'store_manager', companyId: ID.companyA, active: 1 },
    // Deactivated user in company A.
    { id: ID.inactiveUser, email: `iap-inactive-${RUN}@test.local`, role: 'company_admin', companyId: ID.companyA, active: 0 },
  ]);

  await db.insert(userStores).values([
    { userId: ID.scopedManager, storeId: ID.storeOther },
  ]);

  await db.insert(importSourcePropertyBindings).values([
    {
      id: ID.bindingBayHill,
      companyId: ID.companyA,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
      sourcePropertyLabel: 'Bay Hill',
      destinationStoreId: ID.storeBayHill,
      active: 1,
    },
    {
      id: ID.bindingOther,
      companyId: ID.companyA,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: LATROBE_SOURCE_PROPERTY,
      sourcePropertyLabel: 'Latrobe',
      destinationStoreId: ID.storeOther,
      active: 1,
    },
  ]);
});

afterAll(async () => {
  if (SKIP) return;
  const companyIds = [ID.companyA, ID.companyB];

  // Batch rows first (FK-free but keeps the DB tidy).
  const batches = await db
    .select({ id: inventoryImportBatches.id })
    .from(inventoryImportBatches)
    .where(inArray(inventoryImportBatches.companyId, companyIds));
  const batchIds = (batches as Array<{ id: string }>).map(b => b.id);
  if (batchIds.length > 0) {
    await db.delete(inventoryImportRows).where(inArray(inventoryImportRows.batchId, batchIds)).catch(() => {});
  }
  await db.delete(inventoryImportBatches).where(inArray(inventoryImportBatches.companyId, companyIds)).catch(() => {});
  await db.delete(importSourcePropertyBindings).where(inArray(importSourcePropertyBindings.companyId, companyIds)).catch(() => {});
  await db.delete(storeInventoryItems).where(inArray(storeInventoryItems.companyId, companyIds)).catch(() => {});
  await db.delete(inventoryItems).where(inArray(inventoryItems.companyId, companyIds)).catch(() => {});
  await db.delete(inventoryLocations).where(inArray(inventoryLocations.companyId, companyIds)).catch(() => {});
  await db.delete(vendors).where(inArray(vendors.companyId, companyIds)).catch(() => {});
  await db.delete(userStores).where(eq(userStores.userId, ID.scopedManager)).catch(() => {});
  await db.delete(users).where(inArray(users.id, [ID.adminA, ID.adminB, ID.scopedManager, ID.inactiveUser])).catch(() => {});
  await db.delete(companyStores).where(inArray(companyStores.companyId, companyIds)).catch(() => {});
  await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds)).catch(() => {});
});

// ─── 1. Authorized success ────────────────────────────────────────────────────

describe.skipIf(SKIP)('applyBatchApproval — authorized approval', () => {
  it('succeeds for an authorized user with matching company, store, and source property', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
    });

    const result = await applyBatchApproval(batchId, {
      actingUserId: ID.adminA,
      companyId: ID.companyA,
    });

    expect(result.batchId).toBe(batchId);
    expect(result.targetStoreId).toBe(ID.storeBayHill);

    const after = await snapshotBatch(batchId);
    expect(after?.status).toBe('approved');
    expect(after?.approvedBy).toBe(ID.adminA);
    expect(after?.targetStoreId).toBe(ID.storeBayHill);
  });

  // ── 9. Idempotent retry ────────────────────────────────────────────────────
  it('rejects a retry of an already-approved batch and leaves it unchanged', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
    });

    await applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA });
    const afterFirst = await snapshotBatch(batchId);

    // Second call must not double-apply.
    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow(/already been approved/i);

    const afterSecond = await snapshotBatch(batchId);
    expect(afterSecond?.status).toBe('approved');
    expect(afterSecond?.targetStoreId).toBe(afterFirst?.targetStoreId);
    expect(afterSecond?.approvedAt?.toISOString()).toBe(afterFirst?.approvedAt?.toISOString());
  });

  it('blocks a descriptive pseudo-code before any item or external mapping can be created', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
      rows: [{
        sourceItemCode: 'ONIONS',
        itemCodeStatus: 'valid',
        rawDescription: 'Onions',
        supplierRaw: 'Evidence Vendor',
        caseQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'EA',
      }],
    });
    const beforeBatch = await snapshotBatch(batchId);
    const beforeDomain = await countDomainRecords(ID.companyA);

    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow(/look like descriptions require manual source review/i);

    expect(await snapshotBatch(batchId)).toEqual(beforeBatch);
    expect(await countDomainRecords(ID.companyA)).toEqual(beforeDomain);
  });

  it('blocks numeric-looking description text in Item Code before it can persist a mapping', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
      rows: [{
        sourceItemCode: '2% Milk',
        itemCodeStatus: 'valid',
        rawDescription: 'Milk - 2%',
        supplierRaw: 'Evidence Vendor',
        caseQuantity: 1,
        baseUnitQuantity: 1,
        baseUnit: 'EA',
      }],
    });
    const beforeBatch = await snapshotBatch(batchId);
    const beforeDomain = await countDomainRecords(ID.companyA);

    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow(/look like descriptions require manual source review/i);

    expect(await snapshotBatch(batchId)).toEqual(beforeBatch);
    expect(await countDomainRecords(ID.companyA)).toEqual(beforeDomain);
  });

  it('blocks contradictory same-vendor code pack evidence before any approval write', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
      rows: [
        {
          sourceItemCode: 'MILK-1',
          itemCodeStatus: 'valid',
          rawDescription: 'Milk - Whole',
          supplierRaw: 'Evidence Vendor',
          caseQuantity: 1,
          baseUnitQuantity: 1,
          baseUnit: 'EA',
        },
        {
          sourceItemCode: 'MILK-1',
          itemCodeStatus: 'valid',
          rawDescription: 'Milk - Whole',
          supplierRaw: 'Evidence Vendor',
          caseQuantity: 4,
          baseUnitQuantity: 1,
          baseUnit: 'EA',
        },
      ],
    });
    const beforeBatch = await snapshotBatch(batchId);
    const beforeDomain = await countDomainRecords(ID.companyA);

    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow(/contradictory pack evidence/i);

    expect(await snapshotBatch(batchId)).toEqual(beforeBatch);
    expect(await countDomainRecords(ID.companyA)).toEqual(beforeDomain);
  });

  it('serializes concurrent approval calls so only one can apply the batch', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
    });
    const before = await countDomainRecords(ID.companyA);

    const results = await Promise.allSettled([
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.objectContaining({ code: 'CONFLICT' }) });

    const after = await snapshotBatch(batchId);
    expect(after?.status).toBe('approved');
    const domainAfter = await countDomainRecords(ID.companyA);
    expect(domainAfter.items).toBe(before.items + 1);
  });
});

// ─── 2/3/6. Authorization rejections ──────────────────────────────────────────

describe.skipIf(SKIP)('applyBatchApproval — authorization enforcement', () => {
  let batchId: string;

  beforeEach(async () => {
    batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
    });
  });

  it('rejects a user acting for the wrong company', async () => {
    // adminB belongs to company B but names company A.
    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminB, companyId: ID.companyA }),
    ).rejects.toThrow(ImportApprovalError);

    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  it('rejects when the batch belongs to another company than the claimed one', async () => {
    // Company B admin approving with its own (correct) company context, but the
    // batch is owned by company A → scoped read finds nothing.
    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminB, companyId: ID.companyB }),
    ).rejects.toThrow(/not found/i);

    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  it('rejects a user without permission for the target store', async () => {
    // The manager is in company A but assigned only to "Other Club", so this
    // reaches the destination-scope guard after passing the role gate.
    const beforeCounts = await countDomainRecords(ID.companyA);
    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.scopedManager, companyId: ID.companyA }),
    ).rejects.toThrow(/do not have access/i);

    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
    expect(await countDomainRecords(ID.companyA)).toEqual(beforeCounts);
  });

  it('rejects an inactive acting user', async () => {
    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.inactiveUser, companyId: ID.companyA }),
    ).rejects.toThrow(/could not be verified/i);

    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  it('rejects an acting user id that does not exist', async () => {
    await expect(
      applyBatchApproval(batchId, { actingUserId: `ghost-${RUN}`, companyId: ID.companyA }),
    ).rejects.toThrow(/could not be verified/i);

    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  // ── 6. Cross-company destination ──────────────────────────────────────────
  it('rejects a destination store owned by a different company', async () => {
    const crossBatch = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeCompanyB, // store belongs to company B
    });

    await expect(
      applyBatchApproval(crossBatch, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow(/does not belong to this company/i);

    expect((await snapshotBatch(crossBatch))?.status).toBe('pending_review');
  });
});

// ─── 7. Omitted / null authorization context ──────────────────────────────────

describe.skipIf(SKIP)('applyBatchApproval — fail-closed authorization context', () => {
  let batchId: string;

  beforeEach(async () => {
    batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
    });
  });

  it('rejects a null authorization context', async () => {
    await expect(applyBatchApproval(batchId, null)).rejects.toThrow(/authorization context is required/i);
    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  it('rejects an omitted authorization context', async () => {
    // @ts-expect-error — deliberately calling without the required argument
    await expect(applyBatchApproval(batchId)).rejects.toThrow(/authorization context is required/i);
    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  it('rejects an empty acting user id', async () => {
    await expect(
      applyBatchApproval(batchId, { actingUserId: '   ', companyId: ID.companyA }),
    ).rejects.toThrow(/acting user is required/i);
    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  it('rejects an empty company id', async () => {
    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: '' }),
    ).rejects.toThrow(/company context is required/i);
    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });
});

// ─── 4/5/10. Source-property and destination binding ──────────────────────────

describe.skipIf(SKIP)('applyBatchApproval — source-property binding contract', () => {
  // ── 4. Source-property mismatch ───────────────────────────────────────────
  it('rejects when the staged source property does not match its binding', async () => {
    // Batch claims the Bay Hill binding but records the Latrobe source property.
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: LATROBE_SOURCE_PROPERTY,
    });

    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow(/does not match its approved binding/i);

    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  it('rejects a source property from another property approved into this destination', async () => {
    // Latrobe's binding (destination = Other Club) but the batch was pointed at Bay Hill.
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingOther,
      sourcePropertyId: LATROBE_SOURCE_PROPERTY,
    });

    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow(/does not match its approved source property/i);

    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  // ── 5/10. Target substitution + immutable binding ─────────────────────────
  it('ignores a substituted destination and uses the approved binding destination', async () => {
    // The batch's stored target was tampered to "Other Club" while its binding
    // says Bay Hill. The service must refuse rather than silently redirect.
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeOther,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
    });

    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow(/does not match its approved source property/i);

    const after = await snapshotBatch(batchId);
    expect(after?.status).toBe('pending_review');
    // Destination is NOT rewritten by the failed attempt.
    expect(after?.targetStoreId).toBe(ID.storeOther);
  });

  it('rejects an incomplete binding (binding id without source property)', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: null,
    });

    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow(/incomplete source-property binding/i);

    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  it('resolves the destination from the binding when the batch has no stored target', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: null,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
    });

    const result = await applyBatchApproval(batchId, {
      actingUserId: ID.adminA,
      companyId: ID.companyA,
    });

    expect(result.targetStoreId).toBe(ID.storeBayHill);
  });
});

// ─── 8. Zero-write guarantee ──────────────────────────────────────────────────

describe.skipIf(SKIP)('applyBatchApproval — zero writes on rejected approval', () => {
  it('creates no domain records and changes no batch state when authorization fails', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
    });

    const beforeBatch = await snapshotBatch(batchId);
    const beforeCounts = await countDomainRecords(ID.companyA);

    // Unauthorized store access for this user.
    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.scopedUser, companyId: ID.companyA }),
    ).rejects.toThrow();

    const afterBatch = await snapshotBatch(batchId);
    const afterCounts = await countDomainRecords(ID.companyA);

    // No batch-state change
    expect(afterBatch?.status).toBe(beforeBatch?.status);
    expect(afterBatch?.targetStoreId).toBe(beforeBatch?.targetStoreId);
    expect(afterBatch?.approvedAt ?? null).toBe(beforeBatch?.approvedAt ?? null);
    expect(afterBatch?.approvedBy ?? null).toBe(beforeBatch?.approvedBy ?? null);

    // No created domain records
    expect(afterCounts).toEqual(beforeCounts);
  });

  it('creates no domain records when the authorization context is omitted', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeBayHill,
      sourcePropertyBindingId: ID.bindingBayHill,
      sourcePropertyId: BAY_HILL_SOURCE_PROPERTY,
    });

    const beforeCounts = await countDomainRecords(ID.companyA);

    await expect(applyBatchApproval(batchId, null)).rejects.toThrow();

    expect(await countDomainRecords(ID.companyA)).toEqual(beforeCounts);
    expect((await snapshotBatch(batchId))?.status).toBe('pending_review');
  });

  it('creates no store-inventory links for a rejected cross-company destination', async () => {
    const batchId = await stageBatch({
      companyId: ID.companyA,
      targetStoreId: ID.storeCompanyB,
    });

    await expect(
      applyBatchApproval(batchId, { actingUserId: ID.adminA, companyId: ID.companyA }),
    ).rejects.toThrow();

    const links = await db
      .select({ id: storeInventoryItems.id })
      .from(storeInventoryItems)
      .where(eq(storeInventoryItems.storeId, ID.storeCompanyB));

    expect(links.length).toBe(0);
  });
});
