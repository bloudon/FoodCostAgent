/**
 * DB-backed coverage for the Orderly duplicate-identity remediation service
 * (Task #1121).
 *
 * These run against a real database because every guarantee under review is a
 * database guarantee: uniqueness collisions, transaction rollback, evidence
 * preservation, and immutability triggers cannot be proven against a mock.
 *
 * Fixtures deliberately mirror the confirmed production defect: one reliable
 * Orderly Item Code that resolved to several inventory items, each carrying its
 * own count rows for different physical locations.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, pool } from '../../db';
import {
  companies as companiesTable,
  companyStores,
  historicalInvoiceImportBatches,
  historicalInvoices,
  historicalInvoiceLines,
  importSourcePropertyBindings,
  inventoryCountLines,
  inventoryCounts,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItemExternalMappings,
  inventoryItemLocationAssignments,
  inventoryItemLocations,
  inventoryItemRemediationAudit,
  inventoryItemUnits,
  inventoryItems,
  inventoryLocations,
  recipeComponents,
  recipes,
  storageLocations,
  storeInventoryItems,
  units,
  users,
  vendorItems,
  vendors,
} from '@workspace/db';
import {
  applyRemediationManifest,
  buildApplyManifest,
  buildRemediationReport,
  computeReportHash,
  computeUnapprovedRemainderHash,
  reconcilePeriods,
  RemediationScopeError,
  resolveScope,
  REMEDIATION_REPORT_VERSION,
  StaleReportError,
  type ApplyManifest,
  type RemediationScope,
} from './orderlyDuplicateRemediation';
import { preflightRemediationDatabase } from './orderlyDuplicateRemediationPreflight';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = vi.hoisted(() => Date.now().toString(36));

const ID = {
  company: `rem-co-${RUN}`,
  otherCompany: `rem-co-other-${RUN}`,
  store: `rem-store-${RUN}`,
  storeB: `rem-store-b-${RUN}`,
  admin: `rem-admin-${RUN}`,
  binding: `rem-binding-${RUN}`,
  bindingB: `rem-binding-b-${RUN}`,
  property: `rem-prop-${RUN}`,
  propertyB: `rem-prop-b-${RUN}`,
  locationA: `rem-loc-a-${RUN}`,
  locationB: `rem-loc-b-${RUN}`,
  storageA: `rem-sloc-a-${RUN}`,
  storageB: `rem-sloc-b-${RUN}`,
  mayCount: `rem-count-may-${RUN}`,
  juneCount: `rem-count-jun-${RUN}`,
  mayBatch: `rem-batch-may-${RUN}`,
  juneBatch: `rem-batch-jun-${RUN}`,
  // Reconciliation noise: same store and same May window, but out of scope.
  pendingCount: `rem-count-pending-${RUN}`,
  pendingBatch: `rem-batch-pending-${RUN}`,
  foreignPropCount: `rem-count-fprop-${RUN}`,
  foreignPropBatch: `rem-batch-fprop-${RUN}`,
  // Right company, system, property and store — but the batch itself was never
  // approved, so anything sourced from it is unreviewed evidence.
  unapprovedBatch: `rem-batch-unapproved-${RUN}`,
  unapprovedCount: `rem-count-unapproved-${RUN}`,
  rejectedBatch: `rem-batch-rejected-${RUN}`,
  noiseItem: `rem-item-noise-${RUN}`,
};

let eachUnit = '';
let caseUnit = '';

const scope: RemediationScope = {
  companyId: ID.company,
  storeId: ID.store,
  sourceSystem: 'ORDERLY',
  sourcePropertyId: ID.property,
};

/** Item ids created by the current test's fixture, cleaned between tests. */
let createdItemIds: string[] = [];

async function unitId(abbreviation: string): Promise<string> {
  const [row] = await db
    .select({ id: units.id })
    .from(units)
    .where(eq(units.abbreviation, abbreviation))
    .limit(1);
  if (!row) throw new Error(`Expected seeded "${abbreviation}" unit`);
  return row.id;
}

interface ItemSpec {
  name: string;
  /** Storage-location count rows: [countSessionId, storageLocationId, qty, unitCost] */
  countRows?: Array<[string, string, number, number]>;
  /** inventory_locations assignments. */
  locationIds?: string[];
  /** Create a store_inventory_items row. */
  storeLinked?: boolean;
  /** Give this item the authoritative external mapping for the code. */
  authoritativeMapping?: boolean;
  categoryId?: string | null;
  barcode?: string | null;
  unitAbbreviation?: string;
}

/** Creates one candidate inventory item plus the references the spec asks for. */
async function makeItem(code: string, spec: ItemSpec): Promise<string> {
  const [item] = await db
    .insert(inventoryItems)
    .values({
      companyId: ID.company,
      name: spec.name,
      unitId: spec.unitAbbreviation ? await unitId(spec.unitAbbreviation) : eachUnit,
      caseSize: 6,
      pricePerUnit: 25,
      avgCostPerUnit: 25,
      active: 1,
      yieldPercent: 100,
      barcode: spec.barcode ?? null,
      categoryId: spec.categoryId ?? null,
    })
    .returning({ id: inventoryItems.id });
  createdItemIds.push(item.id);

  if (spec.authoritativeMapping) {
    await db.insert(inventoryItemExternalMappings).values({
      companyId: ID.company,
      inventoryItemId: item.id,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property,
      sourceExternalId: code,
      sourceDescription: spec.name,
      matchStrategy: 'code',
      confidenceScore: 1,
    });
  }
  if (spec.storeLinked) {
    await db.insert(storeInventoryItems).values({
      companyId: ID.company,
      storeId: ID.store,
      inventoryItemId: item.id,
      onHandQty: 4,
      active: 1,
    });
  }
  for (const locationId of spec.locationIds ?? []) {
    await db.insert(inventoryItemLocationAssignments).values({
      companyId: ID.company,
      inventoryItemId: item.id,
      locationId,
      isPrimary: 0,
      active: 1,
    });
  }
  for (const [countId, storageLocationId, qty, unitCost] of spec.countRows ?? []) {
    await db.insert(inventoryCountLines).values({
      inventoryCountId: countId,
      inventoryItemId: item.id,
      storageLocationId,
      qty,
      unitId: eachUnit,
      unitCost,
      userId: ID.admin,
    });
  }
  return item.id;
}

/** Stages an approved import batch row that resolved to `itemId`. */
async function stageResolvedRow(
  batchId: string,
  rowIndex: number,
  code: string,
  itemId: string,
  overrides: {
    description?: string;
    caseQuantity?: number | null;
    baseUnit?: string | null;
    storageLocation?: string;
    totalCost?: number;
    itemCodeStatus?: string;
  } = {},
): Promise<void> {
  await db.insert(inventoryImportRows).values({
    batchId,
    rowIndex,
    sheetName: 'Inventory Detail',
    rawData: { description: overrides.description ?? 'Chambord', code },
    rawDescription: overrides.description ?? 'Chambord',
    cleanedDescription: overrides.description ?? 'Chambord',
    caseQuantity: overrides.caseQuantity === undefined ? 6 : overrides.caseQuantity,
    baseUnit: overrides.baseUnit === undefined ? 'ML' : overrides.baseUnit,
    packagePrice: 30,
    totalCost: overrides.totalCost ?? 30,
    sourceItemCode: code,
    itemCodeStatus: overrides.itemCodeStatus ?? 'valid',
    supplierStatus: 'blank',
    storageLocation: overrides.storageLocation ?? 'Liquor Cage',
    rowStatus: 'matched_existing',
    resolvedInventoryItemId: itemId,
  });
}

beforeAll(async () => {
  if (SKIP) return;
  eachUnit = await unitId('ea');
  caseUnit = await unitId('cs').catch(async () => unitId('ea'));

  await db.insert(companiesTable).values([
    { id: ID.company, name: `Remediation Co ${RUN}` },
    { id: ID.otherCompany, name: `Remediation Other ${RUN}` },
  ]);
  await db.insert(companyStores).values([
    { id: ID.store, companyId: ID.company, code: `RM${RUN}`.slice(0, 10), name: 'Bay Hill', status: 'active' },
    { id: ID.storeB, companyId: ID.company, code: `RMB${RUN}`.slice(0, 10), name: 'Second Club', status: 'active' },
  ]);
  await db.insert(users).values({
    id: ID.admin,
    email: `remediation-${RUN}@test.local`,
    role: 'company_admin',
    companyId: ID.company,
    active: 1,
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
  await db.insert(inventoryLocations).values([
    { id: ID.locationA, companyId: ID.company, name: 'Liquor Cage', normalizedName: 'liquor cage' },
    { id: ID.locationB, companyId: ID.company, name: 'Pool Cafe', normalizedName: 'pool cafe' },
  ]);
  await db.insert(storageLocations).values([
    { id: ID.storageA, companyId: ID.company, name: `Liquor Cage ${RUN}` },
    { id: ID.storageB, companyId: ID.company, name: `Pool Cafe ${RUN}` },
  ]);
  // Two applied Orderly count sessions — the May/June historical evidence.
  await db.insert(inventoryCounts).values([
    {
      id: ID.mayCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 4, 31)),
      userId: ID.admin,
      name: 'Orderly — May 2026',
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.mayBatch,
      sourceInventoryDate: '2026-05-31',
    },
    {
      id: ID.juneCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 5, 30)),
      userId: ID.admin,
      name: 'Orderly — June 2026',
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.juneBatch,
      sourceInventoryDate: '2026-06-30',
    },
    // ── Reconciliation noise, both inside the May window and this store ──
    // A session that was never applied: its quantities are not part of the
    // period's on-hand value.
    {
      id: ID.pendingCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 4, 30)),
      userId: ID.admin,
      name: 'Orderly — May 2026 (pending, never applied)',
      applied: 0,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.pendingBatch,
      sourceInventoryDate: '2026-05-30',
    },
    // An applied session fed by a DIFFERENT Orderly source property into the
    // same store. Real data, but not the property being remediated.
    {
      id: ID.foreignPropCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 4, 29)),
      userId: ID.admin,
      name: 'Orderly — May 2026 (other property)',
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.foreignPropBatch,
      sourceInventoryDate: '2026-05-29',
    },
    // An applied session in the right store AND the right source property, but
    // fed by a batch still awaiting approval. Everything about it looks in
    // scope except the one thing that matters: nobody reviewed it.
    {
      id: ID.unapprovedCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 5, 20)),
      userId: ID.admin,
      name: 'Orderly — June 2026 (batch not approved)',
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.unapprovedBatch,
      sourceInventoryDate: '2026-06-20',
    },
  ]);
  await db.insert(inventoryImportBatches).values([
    {
      id: ID.mayBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-may-${RUN}`,
      originalFilename: 'may.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-05-31',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 5, 1)),
      targetStoreId: ID.store,
      sourcePropertyBindingId: ID.binding,
      sourcePropertyId: ID.property,
    },
    {
      id: ID.juneBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-jun-${RUN}`,
      originalFilename: 'june.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-06-30',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 6, 1)),
      targetStoreId: ID.store,
      sourcePropertyBindingId: ID.binding,
      sourcePropertyId: ID.property,
    },
    // Batch behind the never-applied session: approved and in-property, so only
    // the session's applied=0 keeps it out of the baseline.
    {
      id: ID.pendingBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-pending-${RUN}`,
      originalFilename: 'may-pending.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-05-30',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 5, 1)),
      targetStoreId: ID.store,
      sourcePropertyBindingId: ID.binding,
      sourcePropertyId: ID.property,
    },
    // Batch behind the other-property session: applied and in-store, so only
    // the source property keeps it out of the baseline.
    {
      id: ID.foreignPropBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-fprop-${RUN}`,
      originalFilename: 'may-other-property.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-05-29',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 5, 1)),
      targetStoreId: ID.store,
      sourcePropertyBindingId: ID.bindingB,
      sourcePropertyId: ID.propertyB,
    },
    // In-company, in-system, in-property, in-store — but NOT approved. Only the
    // status keeps its rows and its count session out of scope.
    {
      id: ID.unapprovedBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-unapproved-${RUN}`,
      originalFilename: 'june-awaiting-approval.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-06-20',
      inventoryDateConfirmed: 1,
      status: 'pending_review',
      targetStoreId: ID.store,
      sourcePropertyBindingId: ID.binding,
      sourcePropertyId: ID.property,
    },
    {
      id: ID.rejectedBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-rejected-${RUN}`,
      originalFilename: 'june-rejected.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-06-21',
      inventoryDateConfirmed: 1,
      status: 'rejected',
      targetStoreId: ID.store,
      sourcePropertyBindingId: ID.binding,
      sourcePropertyId: ID.property,
    },
  ]);

  // A single item carrying large count values in BOTH out-of-scope sessions.
  // If reconciliation ignores applied/source-property scoping, these inflate
  // the May total by 9,999 and the assertions below fail loudly.
  await db.insert(inventoryItems).values({
    id: ID.noiseItem,
    companyId: ID.company,
    name: `Reconciliation Noise ${RUN}`,
    unitId: eachUnit,
    active: 1,
  });
  await db.insert(inventoryCountLines).values([
    {
      inventoryCountId: ID.pendingCount,
      inventoryItemId: ID.noiseItem,
      storageLocationId: ID.storageA,
      qty: 1000,
      unitId: eachUnit,
      unitCost: 5,
    },
    {
      inventoryCountId: ID.foreignPropCount,
      inventoryItemId: ID.noiseItem,
      storageLocationId: ID.storageA,
      qty: 999,
      unitId: eachUnit,
      unitCost: 5,
    },
  ]);
});

/** Removes the per-test fixture so each test starts from a clean catalog. */
async function resetFixture(): Promise<void> {
  await db.delete(inventoryImportRows).where(inArray(inventoryImportRows.batchId, [ID.mayBatch, ID.juneBatch]));
  await db.delete(inventoryItemRemediationAudit).where(eq(inventoryItemRemediationAudit.companyId, ID.company));
  if (createdItemIds.length > 0) {
    await db.delete(inventoryItemUnits).where(inArray(inventoryItemUnits.inventoryItemId, createdItemIds));
    await db.delete(inventoryCountLines).where(inArray(inventoryCountLines.inventoryItemId, createdItemIds));
    await db.delete(storeInventoryItems).where(inArray(storeInventoryItems.inventoryItemId, createdItemIds));
    await db
      .delete(inventoryItemLocationAssignments)
      .where(inArray(inventoryItemLocationAssignments.inventoryItemId, createdItemIds));
    await db
      .delete(inventoryItemLocations)
      .where(inArray(inventoryItemLocations.inventoryItemId, createdItemIds));
    await db
      .delete(inventoryItemExternalMappings)
      .where(inArray(inventoryItemExternalMappings.inventoryItemId, createdItemIds));
    await db.delete(vendorItems).where(inArray(vendorItems.inventoryItemId, createdItemIds));
    await db.delete(recipeComponents).where(inArray(recipeComponents.componentId, createdItemIds));
    await db.delete(inventoryItems).where(inArray(inventoryItems.id, createdItemIds)).catch(() => {});
  }
  createdItemIds = [];
}

beforeEach(async () => {
  if (SKIP) return;
  await resetFixture();
});

afterAll(async () => {
  if (SKIP) return;
  await resetFixture();
  await db.delete(historicalInvoiceLines).where(eq(historicalInvoiceLines.companyId, ID.company)).catch(() => {});
  await db.delete(historicalInvoices).where(eq(historicalInvoices.companyId, ID.company)).catch(() => {});
  await db
    .delete(historicalInvoiceImportBatches)
    .where(eq(historicalInvoiceImportBatches.companyId, ID.company))
    .catch(() => {});
  await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.companyId, ID.company)).catch(() => {});
  await db
    .delete(inventoryCountLines)
    .where(
      inArray(inventoryCountLines.inventoryCountId, [
        ID.mayCount,
        ID.juneCount,
        ID.pendingCount,
        ID.foreignPropCount,
        ID.unapprovedCount,
      ]),
    )
    .catch(() => {});
  await db.delete(inventoryItems).where(eq(inventoryItems.id, ID.noiseItem)).catch(() => {});
  await db.delete(inventoryCounts).where(eq(inventoryCounts.companyId, ID.company)).catch(() => {});
  await db.delete(storageLocations).where(eq(storageLocations.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryLocations).where(eq(inventoryLocations.companyId, ID.company)).catch(() => {});
  await db.delete(recipes).where(eq(recipes.companyId, ID.company)).catch(() => {});
  await db.delete(vendors).where(eq(vendors.companyId, ID.company)).catch(() => {});
  await db.delete(importSourcePropertyBindings).where(eq(importSourcePropertyBindings.companyId, ID.company)).catch(() => {});
  await db.delete(users).where(eq(users.id, ID.admin)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, ID.company)).catch(() => {});
  await db.delete(companiesTable).where(inArray(companiesTable.id, [ID.company, ID.otherCompany])).catch(() => {});
});

/**
 * The canonical production shape: one Item Code, three items, each holding the
 * count rows for its own physical location.
 */
/** Stable ordering so a fetched row set can be compared before/after a call. */
function sortById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

async function seedChambordDefect(code = `chambord-${RUN}`): Promise<{
  code: string;
  canonical: string;
  dupeB: string;
  dupeC: string;
}> {
  const canonical = await makeItem(code, {
    name: 'Chambord',
    authoritativeMapping: true,
    storeLinked: true,
    locationIds: [ID.locationA],
    countRows: [
      [ID.mayCount, ID.storageA, 4, 25],
      [ID.juneCount, ID.storageA, 5, 25],
    ],
    categoryId: null,
    barcode: '0001',
  });
  const dupeB = await makeItem(code, {
    name: 'Chambord',
    locationIds: [ID.locationB],
    countRows: [[ID.mayCount, ID.storageB, 2, 25]],
  });
  const dupeC = await makeItem(code, {
    name: 'Chambord',
    countRows: [[ID.juneCount, ID.storageB, 3, 25]],
  });

  await stageResolvedRow(ID.mayBatch, 1, code, canonical, { storageLocation: 'Liquor Cage' });
  await stageResolvedRow(ID.mayBatch, 2, code, dupeB, { storageLocation: 'Pool Cafe' });
  await stageResolvedRow(ID.juneBatch, 1, code, canonical, { storageLocation: 'Liquor Cage' });
  await stageResolvedRow(ID.juneBatch, 2, code, dupeC, { storageLocation: 'Pool Cafe' });

  return { code, canonical, dupeB, dupeC };
}

/**
 * Asserts a stopped group left the world exactly as it was: nothing superseded,
 * nothing deactivated, and no count line moved onto another item.
 *
 * A stop that still mutated is the failure mode these tests exist to catch, so
 * checking only the returned failure code would miss it.
 */
async function expectNoMutation(code: string): Promise<void> {
  const mappings = (await db
    .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
    .from(inventoryItemExternalMappings)
    .where(
      and(
        eq(inventoryItemExternalMappings.companyId, ID.company),
        eq(inventoryItemExternalMappings.sourceExternalId, code),
      ),
    )) as Array<{ inventoryItemId: string }>;

  const rows = (await db
    .select({
      id: inventoryItems.id,
      active: inventoryItems.active,
      superseded: inventoryItems.supersededByItemId,
      supersededAt: inventoryItems.supersededAt,
    })
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, createdItemIds))) as Array<{
    id: string;
    active: number;
    superseded: string | null;
    supersededAt: Date | null;
  }>;

  for (const row of rows) {
    expect(row.superseded).toBeNull();
    expect(row.supersededAt).toBeNull();
    expect(row.active).toBe(1);
  }
  // The authoritative mapping still points where it did before.
  expect(mappings.length).toBeGreaterThan(0);

  // No 'applied' audit row was written for this group.
  const audits = (await db
    .select({ result: inventoryItemRemediationAudit.result })
    .from(inventoryItemRemediationAudit)
    .where(
      and(
        eq(inventoryItemRemediationAudit.companyId, ID.company),
        eq(inventoryItemRemediationAudit.sourceExternalId, code),
      ),
    )) as Array<{ result: string }>;
  expect(audits.filter(row => row.result === 'applied')).toHaveLength(0);
}

describe.skipIf(SKIP)('remediation scope boundary', () => {
  it('refuses a store that belongs to another company', async () => {
    await expect(
      resolveScope({ companyId: ID.otherCompany, storeId: ID.store, sourceSystem: 'ORDERLY' }),
    ).rejects.toThrow(/does not belong to company/);
  });

  it('refuses a source property that is not bound to the requested store', async () => {
    await expect(
      resolveScope({
        companyId: ID.company,
        storeId: ID.store,
        sourceSystem: 'ORDERLY',
        sourcePropertyId: ID.propertyB,
      }),
    ).rejects.toThrow(/is not bound to store/);
  });

  it('resolves the bound source property for an authorized store', async () => {
    const resolved = await resolveScope({
      companyId: ID.company,
      storeId: ID.store,
      sourceSystem: 'ORDERLY',
    });
    expect(resolved).toEqual(scope);
  });

  it('preflights required schema and binding using only reads', async () => {
    const beforeAudits = await db
      .select({ id: inventoryItemRemediationAudit.id })
      .from(inventoryItemRemediationAudit)
      .where(eq(inventoryItemRemediationAudit.companyId, ID.company));
    const result = await preflightRemediationDatabase(scope);
    const afterAudits = await db
      .select({ id: inventoryItemRemediationAudit.id })
      .from(inventoryItemRemediationAudit)
      .where(eq(inventoryItemRemediationAudit.companyId, ID.company));

    expect(result.scope).toEqual(scope);
    expect(result.verifiedIndexes).toContain('inv_item_remediation_audit_group_idx');
    expect(afterAudits).toEqual(beforeAudits);
  });
});

describe.skipIf(SKIP)('report mode', () => {
  it('reports a defect group from source-code provenance and makes no writes', async () => {
    const { code, canonical, dupeB, dupeC } = await seedChambordDefect();

    const before = await db
      .select({ id: inventoryItems.id, active: inventoryItems.active })
      .from(inventoryItems)
      .where(eq(inventoryItems.companyId, ID.company));
    const beforeCountLines = await db
      .select({ id: inventoryCountLines.id, inventoryItemId: inventoryCountLines.inventoryItemId })
      .from(inventoryCountLines)
      .where(inArray(inventoryCountLines.inventoryItemId, [canonical, dupeB, dupeC]));

    const report = await buildRemediationReport(scope);

    expect(report.reportVersion).toBe(REMEDIATION_REPORT_VERSION);
    expect(report.groups).toHaveLength(1);
    const [group] = report.groups;
    expect(group.sourceExternalId).toBe(code);
    expect(group.classification).toBe('SAFE_CANDIDATE');
    expect(group.candidateItemIds.sort()).toEqual([canonical, dupeB, dupeC].sort());
    expect(group.proposedCanonicalItemId).toBe(canonical);
    expect(group.canonicalSelectionReason).toMatch(/authoritative external mapping/);
    expect(group.alternativeCandidateIds.sort()).toEqual([dupeB, dupeC].sort());
    expect(group.evidence.importInventoryDates).toEqual(['2026-05-31', '2026-06-30']);
    expect(group.referencesToRepoint.inventoryCountLines).toBe(2);
    expect(group.referencesToRepoint.inventoryItemLocationAssignments).toBe(1);
    // 4*25 + 5*25 + 2*25 + 3*25
    expect(group.valuationContribution).toBeCloseTo(350, 2);
    expect(report.totals).toMatchObject({ safeCandidates: 1, itemsThatWouldBeSuperseded: 2 });

    // Read-only proof.
    const after = await db
      .select({ id: inventoryItems.id, active: inventoryItems.active })
      .from(inventoryItems)
      .where(eq(inventoryItems.companyId, ID.company));
    expect(after).toEqual(before);
    const afterCountLines = await db
      .select({ id: inventoryCountLines.id, inventoryItemId: inventoryCountLines.inventoryItemId })
      .from(inventoryCountLines)
      .where(inArray(inventoryCountLines.inventoryItemId, [canonical, dupeB, dupeC]));
    expect(afterCountLines).toEqual(beforeCountLines);
    const audits = await db
      .select({ id: inventoryItemRemediationAudit.id })
      .from(inventoryItemRemediationAudit)
      .where(eq(inventoryItemRemediationAudit.companyId, ID.company));
    expect(audits).toHaveLength(0);
  });

  it('ignores same-name items that share no reliable source code', async () => {
    // Three "Heavy Cream" items, but only two carry the reliable code.
    const code = `heavycream-${RUN}`;
    const first = await makeItem(code, { name: 'Heavy Cream', authoritativeMapping: true, storeLinked: true });
    const second = await makeItem(code, { name: 'Heavy Cream' });
    const nameOnly = await makeItem(code, { name: 'Heavy Cream' });
    await stageResolvedRow(ID.mayBatch, 1, code, first, { description: 'Heavy Cream' });
    await stageResolvedRow(ID.juneBatch, 1, code, second, { description: 'Heavy Cream' });

    const report = await buildRemediationReport(scope);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].candidateItemIds).not.toContain(nameOnly);
    expect(report.groups[0].candidateItemIds.sort()).toEqual([first, second].sort());
  });

  it('ignores rows whose item code is not reliable', async () => {
    const code = `placeholder-${RUN}`;
    const first = await makeItem(code, { name: 'Sweet n Low', storeLinked: true });
    const second = await makeItem(code, { name: 'Sweet n Low' });
    await stageResolvedRow(ID.mayBatch, 1, code, first, { itemCodeStatus: 'placeholder' });
    await stageResolvedRow(ID.juneBatch, 1, code, second, { itemCodeStatus: 'placeholder' });

    const report = await buildRemediationReport(scope);
    expect(report.groups).toHaveLength(0);
  });

  it('does not see items from another source property', async () => {
    const code = `crossprop-${RUN}`;
    const first = await makeItem(code, { name: 'Buttermilk', authoritativeMapping: true, storeLinked: true });
    const second = await makeItem(code, { name: 'Buttermilk' });
    await stageResolvedRow(ID.mayBatch, 1, code, first);
    await stageResolvedRow(ID.juneBatch, 1, code, second);

    const otherScope: RemediationScope = { ...scope, storeId: ID.storeB, sourcePropertyId: ID.propertyB };
    const report = await buildRemediationReport(otherScope);
    expect(report.groups).toHaveLength(0);
  });

  it('classifies incompatible pack evidence as CONFLICT and never proposes a canonical', async () => {
    const code = `conflict-${RUN}`;
    const first = await makeItem(code, { name: 'Beef - Brisket', authoritativeMapping: true, storeLinked: true });
    const second = await makeItem(code, { name: 'Beef - Brisket' });
    await stageResolvedRow(ID.mayBatch, 1, code, first, { caseQuantity: 6, baseUnit: 'LB' });
    await stageResolvedRow(ID.juneBatch, 1, code, second, { caseQuantity: 12, baseUnit: 'LB' });

    const report = await buildRemediationReport(scope);
    expect(report.groups[0].classification).toBe('CONFLICT');
    expect(report.groups[0].evidence.conflictReasons).toContain('incompatible case quantities');
    expect(report.groups[0].proposedCanonicalItemId).toBeNull();
  });

  it('classifies materially different products as CONFLICT', async () => {
    const code = `descconflict-${RUN}`;
    const first = await makeItem(code, { name: 'Sauce - Tabasco', authoritativeMapping: true, storeLinked: true });
    const second = await makeItem(code, { name: 'Napkins - Cocktail' });
    await stageResolvedRow(ID.mayBatch, 1, code, first, { description: 'Sauce Tabasco Bottle' });
    await stageResolvedRow(ID.juneBatch, 1, code, second, { description: 'Napkins Cocktail Paper' });

    const report = await buildRemediationReport(scope);
    expect(report.groups[0].classification).toBe('CONFLICT');
    expect(report.groups[0].evidence.conflictReasons).toContain(
      'materially different normalized product descriptions',
    );
  });

  it('classifies two equally supported candidates as AMBIGUOUS rather than manufacturing a winner', async () => {
    const code = `ambiguous-${RUN}`;
    // Neither item has a mapping, both come from the same batch, both have the
    // same reference volume, store linkage, history, and metadata.
    const first = await makeItem(code, {
      name: 'Onions - Yellow',
      countRows: [[ID.mayCount, ID.storageA, 2, 10]],
    });
    const second = await makeItem(code, {
      name: 'Onions - Yellow',
      countRows: [[ID.mayCount, ID.storageB, 2, 10]],
    });
    await stageResolvedRow(ID.mayBatch, 1, code, first);
    await stageResolvedRow(ID.mayBatch, 2, code, second);

    const report = await buildRemediationReport(scope);
    const [group] = report.groups;
    expect(group.classification).toBe('AMBIGUOUS');
    expect(group.proposedCanonicalItemId).toBeNull();
    expect(group.evidence.ambiguityReasons[0]).toMatch(/equally supported/);
    expect(group.alternativeCandidateIds.sort()).toEqual([first, second].sort());
  });

  it('prefers the earliest valid import identity when no mapping exists', async () => {
    const code = `earliest-${RUN}`;
    const early = await makeItem(code, { name: 'Apples - Granny Smith' });
    const late = await makeItem(code, { name: 'Apples - Granny Smith' });
    await stageResolvedRow(ID.mayBatch, 1, code, early);
    await stageResolvedRow(ID.juneBatch, 1, code, late);

    const report = await buildRemediationReport(scope);
    expect(report.groups[0].classification).toBe('SAFE_CANDIDATE');
    expect(report.groups[0].proposedCanonicalItemId).toBe(early);
    expect(report.groups[0].canonicalSelectionReason).toMatch(/earliest valid import-created identity/);
  });

  it('reports immutable historical invoice evidence as CONFLICT instead of planning a repoint', async () => {
    const code = `immutable-${RUN}`;
    const first = await makeItem(code, { name: 'Mayonnaise - Extra Heavy', authoritativeMapping: true, storeLinked: true });
    const second = await makeItem(code, { name: 'Mayonnaise - Extra Heavy' });
    await stageResolvedRow(ID.mayBatch, 1, code, first);
    await stageResolvedRow(ID.juneBatch, 1, code, second);

    const batchId = `rem-hib-${RUN}`;
    const invoiceId = `rem-hi-${RUN}`;
    await db.insert(historicalInvoiceImportBatches).values({
      id: batchId,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property,
      sourcePropertyBindingId: ID.binding,
      destinationStoreId: ID.store,
      cutoverDate: '2026-07-01',
      windowStart: '2026-05-01',
      windowEnd: '2026-06-30',
      payloadHash: `hib-${RUN}`,
      status: 'completed',
      importedBy: ID.admin,
    });
    await db.insert(historicalInvoices).values({
      id: invoiceId,
      companyId: ID.company,
      storeId: ID.store,
      importBatchId: batchId,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property,
      sourceInvoiceId: `inv-${RUN}`,
      invoiceDate: '2026-05-15',
      invoicePeriod: '2026-05',
      sourceSnapshot: {},
      materialHash: `mh-${RUN}`,
    });
    await db.insert(historicalInvoiceLines).values({
      companyId: ID.company,
      invoiceId,
      sourceLineId: `line-${RUN}`,
      inventoryItemId: second,
      resolutionStatus: 'resolved',
      packSnapshot: {},
      catchWeightSnapshot: {},
      glSnapshot: {},
      financialSnapshot: {},
      sourceSnapshot: {},
      materialHash: `mlh-${RUN}`,
    });

    const report = await buildRemediationReport(scope);
    expect(report.groups[0].classification).toBe('CONFLICT');
    expect(report.groups[0].evidence.conflictReasons.join(' ')).toMatch(/immutable historical invoice/);

    await db.delete(historicalInvoiceLines).where(eq(historicalInvoiceLines.invoiceId, invoiceId));
    await db.delete(historicalInvoices).where(eq(historicalInvoices.id, invoiceId));
    await db.delete(historicalInvoiceImportBatches).where(eq(historicalInvoiceImportBatches.id, batchId));
  });
});

describe.skipIf(SKIP)('manifest construction', () => {
  it('refuses to build a manifest from a non-safe group', async () => {
    const code = `manifestconflict-${RUN}`;
    const first = await makeItem(code, { name: 'Chicken - Breast', authoritativeMapping: true, storeLinked: true });
    const second = await makeItem(code, { name: 'Chicken - Breast' });
    await stageResolvedRow(ID.mayBatch, 1, code, first, { caseQuantity: 4 });
    await stageResolvedRow(ID.juneBatch, 1, code, second, { caseQuantity: 9 });

    const report = await buildRemediationReport(scope);
    expect(() => buildApplyManifest(report, [code], 'm1')).toThrow(/CONFLICT/);
  });

  it('refuses codes that are not in the report', async () => {
    await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    expect(() => buildApplyManifest(report, ['not-a-code'], 'm1')).toThrow(/not present in the report/);
  });

  it('includes only the explicitly approved groups', async () => {
    const first = await seedChambordDefect(`multi-a-${RUN}`);
    const secondCode = `multi-b-${RUN}`;
    const itemA = await makeItem(secondCode, { name: 'Buttermilk', authoritativeMapping: true, storeLinked: true });
    const itemB = await makeItem(secondCode, { name: 'Buttermilk' });
    await stageResolvedRow(ID.mayBatch, 10, secondCode, itemA, { description: 'Buttermilk' });
    await stageResolvedRow(ID.juneBatch, 10, secondCode, itemB, { description: 'Buttermilk' });

    const report = await buildRemediationReport(scope);
    expect(report.totals.safeCandidates).toBe(2);
    const manifest = buildApplyManifest(report, [first.code], 'm-partial');
    expect(manifest.groups).toHaveLength(1);
    expect(manifest.groups[0].sourceExternalId).toBe(first.code);
  });
});

describe.skipIf(SKIP)('apply mode', () => {
  it('repoints history without rewriting it, supersedes duplicates, and holds valuation flat', async () => {
    const { code, canonical, dupeB, dupeC } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-apply-${RUN}`);

    const linesBefore = await db
      .select({
        id: inventoryCountLines.id,
        inventoryCountId: inventoryCountLines.inventoryCountId,
        storageLocationId: inventoryCountLines.storageLocationId,
        qty: inventoryCountLines.qty,
        unitCost: inventoryCountLines.unitCost,
      })
      .from(inventoryCountLines)
      .where(inArray(inventoryCountLines.inventoryItemId, [canonical, dupeB, dupeC]));

    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.applied).toBe(1);
    expect(result.stopped).toBe(0);
    const [applied] = result.groups;
    expect(applied.result).toBe('applied');
    if (applied.result !== 'applied') throw new Error('expected applied');
    expect(applied.canonicalItemId).toBe(canonical);
    expect(applied.referencesMoved.inventoryCountLines).toBe(2);
    expect(applied.valuationDelta).toBeCloseTo(0, 2);

    // Every count row survives, unchanged except for the FK.
    const linesAfter = await db
      .select({
        id: inventoryCountLines.id,
        inventoryItemId: inventoryCountLines.inventoryItemId,
        inventoryCountId: inventoryCountLines.inventoryCountId,
        storageLocationId: inventoryCountLines.storageLocationId,
        qty: inventoryCountLines.qty,
        unitCost: inventoryCountLines.unitCost,
      })
      .from(inventoryCountLines)
      .where(inArray(inventoryCountLines.id, linesBefore.map((line: { id: string }) => line.id)));
    expect(linesAfter).toHaveLength(linesBefore.length);
    for (const before of linesBefore as Array<{
      id: string;
      inventoryCountId: string;
      storageLocationId: string;
      qty: number;
      unitCost: number;
    }>) {
      const after = (linesAfter as Array<Record<string, unknown>>).find(line => line.id === before.id)!;
      expect(after.inventoryItemId).toBe(canonical);
      expect(after.inventoryCountId).toBe(before.inventoryCountId);
      expect(after.storageLocationId).toBe(before.storageLocationId);
      expect(after.qty).toBe(before.qty);
      expect(after.unitCost).toBe(before.unitCost);
    }

    // Count sessions keep their source batch identity and applied state.
    const sessions = await db
      .select({
        id: inventoryCounts.id,
        sourceBatchId: inventoryCounts.sourceBatchId,
        applied: inventoryCounts.applied,
        countDate: inventoryCounts.countDate,
      })
      .from(inventoryCounts)
      .where(inArray(inventoryCounts.id, [ID.mayCount, ID.juneCount]));
    for (const session of sessions as Array<{ sourceBatchId: string | null; applied: number }>) {
      expect(session.sourceBatchId).toBeTruthy();
      expect(session.applied).toBe(1);
    }

    // Duplicates are superseded, not deleted.
    const dupes = await db
      .select({
        id: inventoryItems.id,
        active: inventoryItems.active,
        supersededByItemId: inventoryItems.supersededByItemId,
        supersededReason: inventoryItems.supersededReason,
      })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [dupeB, dupeC]));
    expect(dupes).toHaveLength(2);
    for (const dupe of dupes as Array<{ active: number; supersededByItemId: string | null; supersededReason: string | null }>) {
      expect(dupe.active).toBe(0);
      expect(dupe.supersededByItemId).toBe(canonical);
      expect(dupe.supersededReason).toContain(code);
    }

    // Mappings consolidated onto one authoritative row.
    const mappings = await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(
        and(
          eq(inventoryItemExternalMappings.companyId, ID.company),
          eq(inventoryItemExternalMappings.sourceExternalId, code),
        ),
      );
    expect(mappings).toEqual([{ inventoryItemId: canonical }]);

    // Import-row provenance points at the canonical item; source facts intact.
    const importRows = await db
      .select({
        resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
        totalCost: inventoryImportRows.totalCost,
        storageLocation: inventoryImportRows.storageLocation,
      })
      .from(inventoryImportRows)
      .where(
        and(
          inArray(inventoryImportRows.batchId, [ID.mayBatch, ID.juneBatch]),
          eq(inventoryImportRows.sourceItemCode, code),
        ),
      );
    expect(importRows).toHaveLength(4);
    for (const row of importRows as Array<{ resolvedInventoryItemId: string | null; totalCost: number | null }>) {
      expect(row.resolvedInventoryItemId).toBe(canonical);
      expect(row.totalCost).toBe(30);
    }

    // Audit output.
    const audits = await db
      .select()
      .from(inventoryItemRemediationAudit)
      .where(eq(inventoryItemRemediationAudit.companyId, ID.company));
    expect(audits).toHaveLength(1);
    const audit = audits[0] as Record<string, unknown>;
    expect(audit.result).toBe('applied');
    expect(audit.canonicalItemId).toBe(canonical);
    expect((audit.supersededItemIds as string[]).sort()).toEqual([dupeB, dupeC].sort());
    expect(audit.manifestId).toBe(manifest.manifestId);
    expect(audit.reportHash).toBe(report.reportHash);
    expect(audit.classification).toBe('SAFE_CANDIDATE');
    expect(audit.canonicalSelectionReason).toMatch(/authoritative external mapping/);
    expect(Number(audit.valuationDelta)).toBeCloseTo(0, 2);
    expect((audit.referencesMoved as { moved: Record<string, number> }).moved.inventoryCountLines).toBe(2);
  });

  it('is idempotent — a rerun of the same manifest is a no-op', async () => {
    const { code } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-idem-${RUN}`);

    await applyRemediationManifest(manifest, ID.admin);
    const second = await applyRemediationManifest(manifest, ID.admin);

    expect(second.applied).toBe(0);
    expect(second.alreadyRemediated).toBe(1);
    expect(second.groups[0].result).toBe('already_remediated');

    const audits = await db
      .select({ result: inventoryItemRemediationAudit.result })
      .from(inventoryItemRemediationAudit)
      .where(eq(inventoryItemRemediationAudit.companyId, ID.company));
    expect(audits.map((a: { result: string }) => a.result).sort()).toEqual(['already_remediated', 'applied']);
  });

  it('rejects a manifest whose material facts have drifted as STALE_REPORT', async () => {
    const { code, canonical, dupeB } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-stale-${RUN}`);

    // A new duplicate arrives after the report was reviewed.
    const dupeD = await makeItem(code, { name: 'Chambord' });
    await stageResolvedRow(ID.juneBatch, 5, code, dupeD, { storageLocation: 'Member Lounge' });

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.stopped).toBe(1);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('STALE_REPORT');
    expect(stopped.failureReason).toMatch(/current candidates/);

    // No mutation.
    const items = await db
      .select({ id: inventoryItems.id, active: inventoryItems.active, supersededByItemId: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [canonical, dupeB, dupeD]));
    for (const item of items as Array<{ active: number; supersededByItemId: string | null }>) {
      expect(item.active).toBe(1);
      expect(item.supersededByItemId).toBeNull();
    }
  });

  it('rejects drift that the named checks miss, via the per-group hash', async () => {
    // The candidate set, canonical, and classification all stay the same — only
    // the volume of evidence that would move changes. Nothing but the hash
    // comparison catches this.
    const { code, canonical, dupeB } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-hashdrift-${RUN}`);

    await db.insert(inventoryItemLocationAssignments).values({
      companyId: ID.company,
      inventoryItemId: dupeB,
      locationId: ID.locationA,
      isPrimary: 0,
      active: 1,
    });

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.stopped).toBe(1);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('STALE_REPORT');
    expect(stopped.failureReason).toMatch(/no longer matches the reviewed evidence/);

    const items = await db
      .select({ active: inventoryItems.active, supersededByItemId: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [canonical, dupeB]));
    for (const item of items as Array<{ active: number; supersededByItemId: string | null }>) {
      expect(item.active).toBe(1);
      expect(item.supersededByItemId).toBeNull();
    }
  });

  it('stops the group when a shared unit has a different conversion factor', async () => {
    // unique(item, unit, isIssueUnit) does NOT cover unitsPerCanonical. Both
    // items declare a "case", but one means 6 and the other 12. Deduping on the
    // key alone would drop one silently and change every recipe and transfer
    // cost derived from it, so the group must stop untouched instead.
    const { code, canonical, dupeB } = await seedChambordDefect();
    await db.insert(inventoryItemUnits).values([
      {
        companyId: ID.company,
        inventoryItemId: canonical,
        unitId: caseUnit,
        unitsPerCanonical: 6,
        isIssueUnit: 0,
      },
      {
        companyId: ID.company,
        inventoryItemId: dupeB,
        unitId: caseUnit,
        unitsPerCanonical: 12,
        isIssueUnit: 0,
      },
    ]);

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-unitconflict-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.applied).toBe(0);
    expect(result.stopped).toBe(1);
    expect(result.groups[0].failureCode).toBe('UNIQUENESS_COLLISION');
    expect(result.groups[0].failureReason).toMatch(/conversion factor/i);

    // Both conversion factors survive, and nothing was superseded.
    const unitRows = (await db
      .select({
        inventoryItemId: inventoryItemUnits.inventoryItemId,
        unitsPerCanonical: inventoryItemUnits.unitsPerCanonical,
      })
      .from(inventoryItemUnits)
      .where(inArray(inventoryItemUnits.inventoryItemId, [canonical, dupeB]))) as Array<{
      inventoryItemId: string;
      unitsPerCanonical: number;
    }>;
    expect(unitRows).toHaveLength(2);
    expect(
      unitRows.find(row => row.inventoryItemId === canonical)?.unitsPerCanonical,
    ).toBe(6);
    expect(unitRows.find(row => row.inventoryItemId === dupeB)?.unitsPerCanonical).toBe(12);

    const items = (await db
      .select({ active: inventoryItems.active, supersededByItemId: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [canonical, dupeB]))) as Array<{
      active: number;
      supersededByItemId: string | null;
    }>;
    for (const item of items) {
      expect(item.active).toBe(1);
      expect(item.supersededByItemId).toBeNull();
    }
  });

  it('stops the group when a shared location assignment has different par metadata', async () => {
    // unique(item, location) does NOT cover parTarget / isPrimary / active.
    // Both items are assigned to location A with different par targets and
    // primary designations — deliberate manager configuration that a blind
    // delete would discard.
    const code = `parconflict-${RUN}`;
    const canonical = await makeItem(code, {
      name: 'Par Conflict',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 1, 10]],
    });
    const dupe = await makeItem(code, {
      name: 'Par Conflict',
      countRows: [[ID.juneCount, ID.storageB, 1, 10]],
    });
    await stageResolvedRow(ID.mayBatch, 40, code, canonical, { description: 'Par Conflict' });
    await stageResolvedRow(ID.juneBatch, 40, code, dupe, { description: 'Par Conflict' });

    await db.insert(inventoryItemLocationAssignments).values([
      {
        companyId: ID.company,
        inventoryItemId: canonical,
        locationId: ID.locationA,
        parTarget: 12,
        isPrimary: 1,
        active: 1,
      },
      {
        companyId: ID.company,
        inventoryItemId: dupe,
        locationId: ID.locationA,
        parTarget: 40,
        isPrimary: 0,
        active: 1,
      },
    ]);

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-parconflict-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.applied).toBe(0);
    expect(result.stopped).toBe(1);
    expect(result.groups[0].failureCode).toBe('UNIQUENESS_COLLISION');
    expect(result.groups[0].failureReason).toMatch(/par target/i);

    // Both assignments survive untouched, on their original items.
    const assignments = (await db
      .select({
        inventoryItemId: inventoryItemLocationAssignments.inventoryItemId,
        parTarget: inventoryItemLocationAssignments.parTarget,
        isPrimary: inventoryItemLocationAssignments.isPrimary,
      })
      .from(inventoryItemLocationAssignments)
      .where(
        inArray(inventoryItemLocationAssignments.inventoryItemId, [canonical, dupe]),
      )) as Array<{ inventoryItemId: string; parTarget: number | null; isPrimary: number }>;
    expect(assignments).toHaveLength(2);
    const canonicalAssignment = assignments.find(row => row.inventoryItemId === canonical);
    const dupeAssignment = assignments.find(row => row.inventoryItemId === dupe);
    expect(canonicalAssignment?.parTarget).toBe(12);
    expect(canonicalAssignment?.isPrimary).toBe(1);
    expect(dupeAssignment?.parTarget).toBe(40);
    expect(dupeAssignment?.isPrimary).toBe(0);

    const items = (await db
      .select({ active: inventoryItems.active, supersededByItemId: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [canonical, dupe]))) as Array<{
      active: number;
      supersededByItemId: string | null;
    }>;
    for (const item of items) {
      expect(item.active).toBe(1);
      expect(item.supersededByItemId).toBeNull();
    }
  });

  it('refuses a group whose duplicate is also mapped to another Orderly property', async () => {
    // An inventory item is a COMPANY-level row, so the same duplicate can carry
    // an identity binding for a second Orderly club. Approval covers one
    // property, so repointing here would rewrite that club's identity.
    const { code, dupeB } = await seedChambordDefect();
    await db.insert(inventoryItemExternalMappings).values({
      companyId: ID.company,
      inventoryItemId: dupeB,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.propertyB,
      sourceExternalId: `${code}-otherclub`,
      sourceDescription: 'Chambord (other club)',
      matchStrategy: 'code',
      confidenceScore: 1,
    });

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-xprop-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.applied).toBe(0);
    expect(result.stopped).toBe(1);
    const [stopped] = result.groups;
    expect(stopped.result).toBe('stopped');
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('OUT_OF_SCOPE_REFERENCE');

    // The foreign-property mapping is untouched and still points at dupeB.
    const foreign = (await db
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(
        and(
          eq(inventoryItemExternalMappings.sourcePropertyId, ID.propertyB),
          eq(inventoryItemExternalMappings.sourceExternalId, `${code}-otherclub`),
        ),
      )) as Array<{ inventoryItemId: string }>;
    expect(foreign).toHaveLength(1);
    expect(foreign[0].inventoryItemId).toBe(dupeB);

    // Nothing was superseded — the stop happened before any mutation.
    const [stillLive] = (await db
      .select({ active: inventoryItems.active, superseded: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, dupeB))) as Array<{
      active: number;
      superseded: string | null;
    }>;
    expect(stillLive.active).toBe(1);
    expect(stillLive.superseded).toBeNull();
  });

  it('refuses a group whose duplicate holds stock at a store outside the approved scope', async () => {
    const { code, dupeC } = await seedChambordDefect();
    await db.insert(storeInventoryItems).values({
      companyId: ID.company,
      storeId: ID.storeB,
      inventoryItemId: dupeC,
      onHandQty: 9,
      active: 1,
    });

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-xstore-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.stopped).toBe(1);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('OUT_OF_SCOPE_REFERENCE');

    // The other store's stock row survives, still on the duplicate.
    const [otherStore] = (await db
      .select({ onHandQty: storeInventoryItems.onHandQty })
      .from(storeInventoryItems)
      .where(
        and(
          eq(storeInventoryItems.storeId, ID.storeB),
          eq(storeInventoryItems.inventoryItemId, dupeC),
        ),
      )) as Array<{ onHandQty: number }>;
    expect(otherStore.onHandQty).toBe(9);
  });

  it('refuses when a duplicate carries count history from another source property in the same store', async () => {
    // Two Orderly properties legitimately feed THIS store. A Bay Hill approval
    // must not repoint the other property's count history — repointing moves
    // count lines by item id, and the item is company-level, so a store-only
    // scope check would let this through silently.
    const code = `crossprop-${RUN}`;
    const canonical = await makeItem(code, {
      name: 'Cross Property Gin',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 4, 25]],
    });
    const dupe = await makeItem(code, {
      name: 'Cross Property Gin',
      countRows: [
        [ID.juneCount, ID.storageB, 2, 25],
        // Same store, applied, real — but fed by the OTHER property's batch.
        [ID.foreignPropCount, ID.storageB, 7, 25],
      ],
    });
    await stageResolvedRow(ID.mayBatch, 60, code, canonical, { storageLocation: 'Liquor Cage' });
    await stageResolvedRow(ID.juneBatch, 60, code, dupe, { storageLocation: 'Pool Cafe' });

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-crossprop-${RUN}`);

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(0);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('OUT_OF_SCOPE_REFERENCE');
    await expectNoMutation(code);

    // The foreign property's count line is untouched and still on the duplicate.
    const [foreign] = (await db
      .select({ itemId: inventoryCountLines.inventoryItemId, qty: inventoryCountLines.qty })
      .from(inventoryCountLines)
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.foreignPropCount),
          eq(inventoryCountLines.inventoryItemId, dupe),
        ),
      )) as Array<{ itemId: string; qty: number }>;
    expect(foreign?.itemId).toBe(dupe);
    expect(foreign?.qty).toBe(7);
  });

  it('refuses when a duplicate carries count history sourced from an unapproved batch', async () => {
    // Right company, system, property and store — the batch is simply still
    // awaiting approval, so its count history is unreviewed evidence. Discovery
    // requires status='approved'; the scope assertion must use the same
    // predicate or apply silently repoints history discovery would never show.
    const code = `unapprovedcount-${RUN}`;
    const canonical = await makeItem(code, {
      name: 'Unapproved Batch Vodka',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 4, 25]],
    });
    const dupe = await makeItem(code, {
      name: 'Unapproved Batch Vodka',
      countRows: [
        [ID.juneCount, ID.storageB, 2, 25],
        [ID.unapprovedCount, ID.storageB, 8, 25],
      ],
    });
    await stageResolvedRow(ID.mayBatch, 62, code, canonical, { storageLocation: 'Liquor Cage' });
    await stageResolvedRow(ID.juneBatch, 62, code, dupe, { storageLocation: 'Pool Cafe' });

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-unapprovedcount-${RUN}`);

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(0);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('OUT_OF_SCOPE_REFERENCE');
    await expectNoMutation(code);

    // The unapproved batch's count line stayed on the duplicate, untouched.
    const [line] = (await db
      .select({ itemId: inventoryCountLines.inventoryItemId, qty: inventoryCountLines.qty })
      .from(inventoryCountLines)
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.unapprovedCount),
          eq(inventoryCountLines.inventoryItemId, dupe),
        ),
      )) as Array<{ itemId: string; qty: number }>;
    expect(line?.itemId).toBe(dupe);
    expect(line?.qty).toBe(8);
  });

  it('refuses when a duplicate carries import rows from a rejected batch', async () => {
    // Same boundary on the provenance side: consolidating rows from a rejected
    // batch onto the canonical would attach evidence a reviewer threw out.
    const code = `rejectedrows-${RUN}`;
    const canonical = await makeItem(code, {
      name: 'Rejected Batch Whiskey',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 4, 25]],
    });
    const dupe = await makeItem(code, {
      name: 'Rejected Batch Whiskey',
      countRows: [[ID.juneCount, ID.storageB, 2, 25]],
    });
    await stageResolvedRow(ID.mayBatch, 63, code, canonical, { storageLocation: 'Liquor Cage' });
    await stageResolvedRow(ID.juneBatch, 63, code, dupe, { storageLocation: 'Pool Cafe' });
    // The out-of-scope reference, on the duplicate that would be merged away.
    await stageResolvedRow(ID.rejectedBatch, 1, code, dupe, { storageLocation: 'Pool Cafe' });

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-rejectedrows-${RUN}`);

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(0);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('OUT_OF_SCOPE_REFERENCE');
    await expectNoMutation(code);

    // The rejected batch's row still resolves to the duplicate.
    const [row] = (await db
      .select({ resolved: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(
        and(
          eq(inventoryImportRows.batchId, ID.rejectedBatch),
          eq(inventoryImportRows.sourceItemCode, code),
        ),
      )) as Array<{ resolved: string | null }>;
    expect(row?.resolved).toBe(dupe);
  });

  it('refuses when a duplicate carries count history with no import provenance', async () => {
    // A manual session cannot be attributed to the approved property at all, so
    // it is treated as out of scope rather than assumed safe — the fail-closed
    // half of the provenance join.
    const code = `manualprov-${RUN}`;
    const manualCountId = `manual-count-${RUN}`;
    await db.insert(inventoryCounts).values({
      id: manualCountId,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 5, 15)),
      userId: ID.admin,
      name: 'Manual spot count',
      applied: 1,
      // No sourceSystem / sourceBatchId: provenance is unprovable.
    });

    const canonical = await makeItem(code, {
      name: 'Manual Provenance Rum',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 3, 25]],
    });
    const dupe = await makeItem(code, {
      name: 'Manual Provenance Rum',
      countRows: [[manualCountId, ID.storageB, 6, 25]],
    });
    await stageResolvedRow(ID.mayBatch, 61, code, canonical, { storageLocation: 'Liquor Cage' });
    await stageResolvedRow(ID.juneBatch, 61, code, dupe, { storageLocation: 'Pool Cafe' });

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-manualprov-${RUN}`);

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(0);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('OUT_OF_SCOPE_REFERENCE');
    await expectNoMutation(code);

    await db.delete(inventoryCountLines).where(eq(inventoryCountLines.inventoryCountId, manualCountId));
    await db.delete(inventoryCounts).where(eq(inventoryCounts.id, manualCountId));
  });

  it('stops when a count-line quantity is edited in place after review', async () => {
    // The line count, session count and location count are all unchanged by an
    // in-place edit, so a hash built from counts alone would still validate and
    // the repair would move history the reviewer never approved — recording a
    // stale valuationBefore in the audit while doing it.
    const { code, canonical } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-qtyedit-${RUN}`);

    await db
      .update(inventoryCountLines)
      .set({ qty: 99 })
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.juneCount),
          eq(inventoryCountLines.inventoryItemId, canonical),
        ),
      );

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(0);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('STALE_REPORT');
    await expectNoMutation(code);
  });

  it('stops when a count-line unit cost is edited in place after review', async () => {
    // Cost edits move valuation without touching any count, so this is the
    // clearest case of a hash that binds structure but not value.
    const { code, canonical } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-costedit-${RUN}`);

    await db
      .update(inventoryCountLines)
      .set({ unitCost: 999 })
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.mayCount),
          eq(inventoryCountLines.inventoryItemId, canonical),
        ),
      );

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(0);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('STALE_REPORT');
    await expectNoMutation(code);
  });

  it('stops when compatible import evidence is edited after review', async () => {
    // EVERY row for this code is relabelled to the SAME new description, so the
    // group stays compatible: one distinct description, unchanged candidate set,
    // unchanged classification, unchanged reference counts. (Relabelling only
    // one batch would make the descriptions disagree and trip the compatibility
    // check instead, which would pass this test without proving anything about
    // the hash.) Only binding the source evidence values catches this.
    const { code } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-importedit-${RUN}`);
    expect(report.groups.find(group => group.sourceExternalId === code)?.classification).toBe(
      'SAFE_CANDIDATE',
    );

    await db
      .update(inventoryImportRows)
      .set({ cleanedDescription: 'Chambord Liqueur (relabelled)' })
      .where(eq(inventoryImportRows.sourceItemCode, code));

    // The group must still be repairable — otherwise the stop below would be a
    // classification change, not the evidence binding under test.
    const after = await buildRemediationReport(scope);
    expect(after.groups.find(group => group.sourceExternalId === code)?.classification).toBe(
      'SAFE_CANDIDATE',
    );

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(0);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('STALE_REPORT');
    await expectNoMutation(code);
  });

  it('stops under lock when a count-line value changes between review and mutation', async () => {
    // Same edit, but applied to a manifest whose pre-transaction check has
    // already passed against a hash captured from the edited state — only the
    // recheck taken UNDER the row locks can catch this one.
    const { code, canonical } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-lockedit-${RUN}`);

    // Make the outer check pass by pointing the approval at a hash that matches
    // the edited world, then edit — so the ONLY thing standing between the
    // manifest and a bad repoint is the under-lock re-derivation.
    await db
      .update(inventoryCountLines)
      .set({ qty: 12 })
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.juneCount),
          eq(inventoryCountLines.inventoryItemId, canonical),
        ),
      );
    const edited = await buildRemediationReport(scope);
    const editedGroup = edited.groups.find(group => group.sourceExternalId === code)!;
    const staleManifest = {
      ...manifest,
      reportHash: edited.reportHash,
      unapprovedRemainderHash: computeUnapprovedRemainderHash(edited, manifest.groups),
      groups: manifest.groups.map(approval => ({
        ...approval,
        groupHash: computeReportHash(edited.scope, [editedGroup]),
      })),
    };

    // Now change it again, after the manifest was bound.
    await db
      .update(inventoryCountLines)
      .set({ qty: 33 })
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.juneCount),
          eq(inventoryCountLines.inventoryItemId, canonical),
        ),
      );

    const result = await applyRemediationManifest(staleManifest, ID.admin);
    expect(result.applied).toBe(0);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('STALE_REPORT');
    await expectNoMutation(code);
  });

  it('stops when a reference is added after the report was reviewed', async () => {
    // The manifest is built from a clean report, then a new count line lands on
    // a duplicate before apply runs. That line was never reviewed, so the
    // repoint must not sweep it up. (This is caught by the pre-transaction
    // staleness check; the test below covers the narrower window that only the
    // under-lock recheck can close.)
    const { code, dupeB } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-concurrent-${RUN}`);

    await db.insert(inventoryCountLines).values({
      inventoryCountId: ID.juneCount,
      inventoryItemId: dupeB,
      storageLocationId: ID.storageA,
      qty: 7,
      unitId: eachUnit,
      unitCost: 25,
    });

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(0);
    expect(result.stopped).toBe(1);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('STALE_REPORT');

    // The concurrently-written line is still on the duplicate, unmoved.
    const [line] = (await db
      .select({ inventoryItemId: inventoryCountLines.inventoryItemId })
      .from(inventoryCountLines)
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.juneCount),
          eq(inventoryCountLines.storageLocationId, ID.storageA),
          eq(inventoryCountLines.qty, 7),
        ),
      )) as Array<{ inventoryItemId: string }>;
    expect(line.inventoryItemId).toBe(dupeB);
  });

  it('does not repoint evidence a concurrent writer edited in place after apply began', async () => {
    // The precise window under test: a writer UPDATEs an existing count line's
    // qty/unit cost while apply is running. That update neither touches nor
    // locks the inventory item the line points at, so an items-only lock would
    // let it commit between the under-lock snapshot and the bulk repoint — and
    // the repair would move and audit values nobody reviewed.
    //
    // Driven deterministically with a second connection holding an open
    // transaction, so the interleaving is forced rather than raced:
    //   1. writer BEGINs and UPDATEs the line, holding its row lock
    //   2. apply starts and blocks trying to lock that same line
    //   3. writer COMMITs, releasing it
    //   4. apply must NOT proceed against the pre-edit values
    const { code, canonical } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-inplace-race-${RUN}`);

    // A line on the CANONICAL item: it is read for valuation and hashed as
    // evidence, but never repointed, so nothing else in the repair would
    // incidentally lock or notice it.
    const [target] = (await db
      .select({ id: inventoryCountLines.id, qty: inventoryCountLines.qty })
      .from(inventoryCountLines)
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.mayCount),
          eq(inventoryCountLines.inventoryItemId, canonical),
        ),
      )) as Array<{ id: string; qty: number }>;
    expect(target.qty).toBe(4);

    const writer = await pool.connect();
    let applyResult: Awaited<ReturnType<typeof applyRemediationManifest>>;
    try {
      await writer.query('BEGIN');
      await writer.query('UPDATE inventory_count_lines SET qty = $1 WHERE id = $2', [
        41,
        target.id,
      ]);

      // Apply now runs into the writer's uncommitted row lock.
      const applyPromise = applyRemediationManifest(manifest, ID.admin);
      // Give it time to reach the lock and block on it.
      await new Promise(resolve => setTimeout(resolve, 750));
      await writer.query('COMMIT');
      applyResult = await applyPromise;
    } finally {
      writer.release();
    }

    // Whichever guard fires — the lock forcing apply to see the new value, or
    // serialization catching the conflict — the group must not be repaired.
    expect(applyResult.applied).toBe(0);
    const [stopped] = applyResult.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('STALE_REPORT');
    await expectNoMutation(code);

    // The writer's edit survived intact and stayed on the canonical item.
    const [after] = (await db
      .select({ qty: inventoryCountLines.qty, itemId: inventoryCountLines.inventoryItemId })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.id, target.id))) as Array<{ qty: number; itemId: string }>;
    expect(after.qty).toBe(41);
    expect(after.itemId).toBe(canonical);

    // No audit row claims a repair, and none records the pre-edit valuation.
    const audits = (await db
      .select({
        result: inventoryItemRemediationAudit.result,
        valuationBefore: inventoryItemRemediationAudit.valuationBefore,
      })
      .from(inventoryItemRemediationAudit)
      .where(
        and(
          eq(inventoryItemRemediationAudit.companyId, ID.company),
          eq(inventoryItemRemediationAudit.sourceExternalId, code),
        ),
      )) as Array<{ result: string; valuationBefore: number }>;
    expect(audits.filter(row => row.result === 'applied')).toHaveLength(0);
  });

  it('never applies the same group twice when two operators apply concurrently', async () => {
    // Both runs read a clean report and both pass the pre-transaction staleness
    // check, so the outer check cannot separate them — only the row lock and the
    // recheck taken under it can. Exactly one may mutate; the other must find
    // the world changed and stop without a second, double-counting repoint.
    const { code, canonical, dupeB, dupeC } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifestA = buildApplyManifest(report, [code], `m-race-a-${RUN}`);
    const manifestB = buildApplyManifest(report, [code], `m-race-b-${RUN}`);

    const [runA, runB] = await Promise.all([
      applyRemediationManifest(manifestA, ID.admin),
      applyRemediationManifest(manifestB, ID.admin),
    ]);

    // One repair, total — the other run must not have mutated anything.
    expect(runA.applied + runB.applied).toBe(1);
    expect(runA.stopped + runB.stopped + runA.alreadyRemediated + runB.alreadyRemediated).toBe(1);

    // Each duplicate is superseded exactly once, onto the canonical.
    const dupes = (await db
      .select({
        id: inventoryItems.id,
        active: inventoryItems.active,
        superseded: inventoryItems.supersededByItemId,
      })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [dupeB, dupeC]))) as Array<{
      id: string;
      active: number;
      superseded: string | null;
    }>;
    for (const dupe of dupes) {
      expect(dupe.active).toBe(0);
      expect(dupe.superseded).toBe(canonical);
    }

    // The June history landed once, not twice: 5 (canonical) + 3 (dupeC).
    const juneLines = (await db
      .select({ qty: inventoryCountLines.qty })
      .from(inventoryCountLines)
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.juneCount),
          eq(inventoryCountLines.inventoryItemId, canonical),
        ),
      )) as Array<{ qty: number }>;
    expect(juneLines.map(line => line.qty).sort()).toEqual([3, 5]);

    // Exactly one 'applied' audit row exists for this group.
    const auditRows = (await db
      .select({ result: inventoryItemRemediationAudit.result })
      .from(inventoryItemRemediationAudit)
      .where(
        and(
          eq(inventoryItemRemediationAudit.companyId, ID.company),
          eq(inventoryItemRemediationAudit.sourceExternalId, code),
        ),
      )) as Array<{ result: string }>;
    expect(auditRows.filter(row => row.result === 'applied')).toHaveLength(1);
  });

  it('re-derives store on-hand from the count history it just repointed', async () => {
    // The canonical's on-hand was computed when the June count was applied to the
    // PRE-MERGE identities, so it only ever saw the canonical's own line (5) —
    // the 3 counted at Pool Cafe landed on a duplicate. After repointing, the
    // authoritative history for June says 5 + 3 = 8, and the live store value
    // must follow it or ordering runs against an understated quantity.
    const { code, canonical, dupeB } = await seedChambordDefect();
    await db
      .update(storeInventoryItems)
      .set({ onHandQty: 5 })
      .where(eq(storeInventoryItems.inventoryItemId, canonical));

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-onhand-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(1);

    const [storeRow] = (await db
      .select({ onHandQty: storeInventoryItems.onHandQty })
      .from(storeInventoryItems)
      .where(eq(storeInventoryItems.inventoryItemId, canonical))) as Array<{ onHandQty: number }>;
    // June (the latest APPLIED session) totals: 5 on the canonical + 3 moved
    // across from dupeC. The May session's quantities must NOT be added in —
    // applying a count overwrites on-hand, it does not accumulate.
    expect(storeRow.onHandQty).toBe(8);

    // The count rows themselves are untouched; only the derived rollup moved.
    const juneLines = (await db
      .select({ qty: inventoryCountLines.qty })
      .from(inventoryCountLines)
      .where(
        and(
          eq(inventoryCountLines.inventoryCountId, ID.juneCount),
          eq(inventoryCountLines.inventoryItemId, canonical),
        ),
      )) as Array<{ qty: number }>;
    expect(juneLines.map(line => line.qty).sort()).toEqual([3, 5]);
    void dupeB;
  });

  it('leaves on-hand alone when the canonical is absent from the latest applied count', async () => {
    // The apply handler only writes items present in the session, so inventing a
    // 0 here would fabricate a stock-out for an item nobody counted.
    const code = `onhandabsent-${RUN}`;
    const canonical = await makeItem(code, {
      name: 'Not In June',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 6, 10]],
    });
    const dupe = await makeItem(code, {
      name: 'Not In June',
      countRows: [[ID.mayCount, ID.storageB, 2, 10]],
    });
    await stageResolvedRow(ID.mayBatch, 44, code, canonical, { description: 'Not In June' });
    await stageResolvedRow(ID.mayBatch, 45, code, dupe, { description: 'Not In June' });
    await db
      .update(storeInventoryItems)
      .set({ onHandQty: 42 })
      .where(eq(storeInventoryItems.inventoryItemId, canonical));

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-onhandabsent-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(1);

    const [storeRow] = (await db
      .select({ onHandQty: storeInventoryItems.onHandQty })
      .from(storeInventoryItems)
      .where(eq(storeInventoryItems.inventoryItemId, canonical))) as Array<{ onHandQty: number }>;
    expect(storeRow.onHandQty).toBe(42);
  });

  it('stops the group when duplicate store-inventory settings differ', async () => {
    // unique(storeId, inventoryItemId) omits primaryLocationId, parLevel,
    // reorderLevel and active — live per-store manager settings. The canonical
    // already has a row for this store, so the duplicate's row would be dropped;
    // it must stop instead.
    const code = `storeconflict-${RUN}`;
    const canonical = await makeItem(code, {
      name: 'Store Conflict',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 1, 10]],
    });
    const dupe = await makeItem(code, {
      name: 'Store Conflict',
      storeLinked: true,
      countRows: [[ID.juneCount, ID.storageB, 1, 10]],
    });
    await stageResolvedRow(ID.mayBatch, 41, code, canonical, { description: 'Store Conflict' });
    await stageResolvedRow(ID.juneBatch, 41, code, dupe, { description: 'Store Conflict' });

    await db
      .update(storeInventoryItems)
      .set({ parLevel: 10, reorderLevel: 4 })
      .where(eq(storeInventoryItems.inventoryItemId, canonical));
    await db
      .update(storeInventoryItems)
      .set({ parLevel: 96, reorderLevel: 4 })
      .where(eq(storeInventoryItems.inventoryItemId, dupe));

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-storeconflict-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.applied).toBe(0);
    expect(result.stopped).toBe(1);
    expect(result.groups[0].failureCode).toBe('UNIQUENESS_COLLISION');
    expect(result.groups[0].failureReason).toMatch(/par level/i);

    // Both store rows survive with their own settings.
    const storeRows = (await db
      .select({
        inventoryItemId: storeInventoryItems.inventoryItemId,
        parLevel: storeInventoryItems.parLevel,
      })
      .from(storeInventoryItems)
      .where(inArray(storeInventoryItems.inventoryItemId, [canonical, dupe]))) as Array<{
      inventoryItemId: string;
      parLevel: number | null;
    }>;
    expect(storeRows).toHaveLength(2);
    expect(storeRows.find(row => row.inventoryItemId === canonical)?.parLevel).toBe(10);
    expect(storeRows.find(row => row.inventoryItemId === dupe)?.parLevel).toBe(96);

    const items = (await db
      .select({ active: inventoryItems.active, supersededByItemId: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [canonical, dupe]))) as Array<{
      active: number;
      supersededByItemId: string | null;
    }>;
    for (const item of items) {
      expect(item.active).toBe(1);
      expect(item.supersededByItemId).toBeNull();
    }
  });

  it('stops the group when the deprecated item-location primary flag differs', async () => {
    const code = `legacyconflict-${RUN}`;
    const canonical = await makeItem(code, {
      name: 'Legacy Conflict',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 1, 10]],
    });
    const dupe = await makeItem(code, {
      name: 'Legacy Conflict',
      countRows: [[ID.juneCount, ID.storageB, 1, 10]],
    });
    await stageResolvedRow(ID.mayBatch, 42, code, canonical, { description: 'Legacy Conflict' });
    await stageResolvedRow(ID.juneBatch, 42, code, dupe, { description: 'Legacy Conflict' });

    await db.insert(inventoryItemLocations).values([
      { inventoryItemId: canonical, storageLocationId: ID.storageA, isPrimary: 1 },
      { inventoryItemId: dupe, storageLocationId: ID.storageA, isPrimary: 0 },
    ]);

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-legacyconflict-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.applied).toBe(0);
    expect(result.stopped).toBe(1);
    expect(result.groups[0].failureCode).toBe('UNIQUENESS_COLLISION');
    expect(result.groups[0].failureReason).toMatch(/primary/i);

    const legacy = (await db
      .select({
        inventoryItemId: inventoryItemLocations.inventoryItemId,
        isPrimary: inventoryItemLocations.isPrimary,
      })
      .from(inventoryItemLocations)
      .where(inArray(inventoryItemLocations.inventoryItemId, [canonical, dupe]))) as Array<{
      inventoryItemId: string;
      isPrimary: number;
    }>;
    expect(legacy).toHaveLength(2);
    expect(legacy.find(row => row.inventoryItemId === canonical)?.isPrimary).toBe(1);
    expect(legacy.find(row => row.inventoryItemId === dupe)?.isPrimary).toBe(0);

    const items = (await db
      .select({ supersededByItemId: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [canonical, dupe]))) as Array<{
      supersededByItemId: string | null;
    }>;
    for (const item of items) expect(item.supersededByItemId).toBeNull();
  });

  it('merges identical store-inventory rows rather than stopping unnecessarily', async () => {
    // Identical settings are genuinely redundant. onHandQty is deliberately not
    // compared — it is recomputed from the repointed count history, so equal
    // settings with differing quantities must still merge.
    const code = `storesame-${RUN}`;
    const canonical = await makeItem(code, {
      name: 'Store Same',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 1, 10]],
    });
    const dupe = await makeItem(code, {
      name: 'Store Same',
      storeLinked: true,
      countRows: [[ID.juneCount, ID.storageB, 1, 10]],
    });
    await stageResolvedRow(ID.mayBatch, 43, code, canonical, { description: 'Store Same' });
    await stageResolvedRow(ID.juneBatch, 43, code, dupe, { description: 'Store Same' });

    await db
      .update(storeInventoryItems)
      .set({ parLevel: 12, reorderLevel: 3, onHandQty: 7 })
      .where(eq(storeInventoryItems.inventoryItemId, canonical));
    await db
      .update(storeInventoryItems)
      .set({ parLevel: 12, reorderLevel: 3, onHandQty: 99 })
      .where(eq(storeInventoryItems.inventoryItemId, dupe));

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-storesame-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.applied).toBe(1);
    const storeRows = (await db
      .select({ id: storeInventoryItems.id, parLevel: storeInventoryItems.parLevel })
      .from(storeInventoryItems)
      .where(inArray(storeInventoryItems.inventoryItemId, [canonical, dupe]))) as Array<{
      id: string;
      parLevel: number | null;
    }>;
    expect(storeRows).toHaveLength(1);
    expect(storeRows[0].parLevel).toBe(12);
  });

  it('merges identical unit rows rather than stopping unnecessarily', async () => {
    // The rule is "stop on disagreement", not "stop whenever the key repeats" —
    // genuinely identical configuration is redundant and safe to consolidate.
    const { code, canonical, dupeB } = await seedChambordDefect();
    await db.insert(inventoryItemUnits).values([
      {
        companyId: ID.company,
        inventoryItemId: canonical,
        unitId: caseUnit,
        unitsPerCanonical: 6,
        isIssueUnit: 0,
      },
      {
        companyId: ID.company,
        inventoryItemId: dupeB,
        unitId: caseUnit,
        unitsPerCanonical: 6,
        isIssueUnit: 0,
      },
    ]);

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-unitsame-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.applied).toBe(1);
    const surviving = (await db
      .select({ unitsPerCanonical: inventoryItemUnits.unitsPerCanonical })
      .from(inventoryItemUnits)
      .where(eq(inventoryItemUnits.inventoryItemId, canonical))) as Array<{
      unitsPerCanonical: number;
    }>;
    expect(surviving).toHaveLength(1);
    expect(surviving[0].unitsPerCanonical).toBe(6);
  });

  it('binds the approval to conversion factors, not just row counts', async () => {
    // A post-review edit that leaves the row COUNT unchanged must still
    // invalidate the approval, or the apply would run against evidence the
    // reviewer never saw.
    const { code, canonical } = await seedChambordDefect();
    await db.insert(inventoryItemUnits).values({
      companyId: ID.company,
      inventoryItemId: canonical,
      unitId: caseUnit,
      unitsPerCanonical: 6,
      isIssueUnit: 0,
    });

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-cfgdrift-${RUN}`);

    // Same row, same key, different factor — counts are identical.
    await db
      .update(inventoryItemUnits)
      .set({ unitsPerCanonical: 24 })
      .where(eq(inventoryItemUnits.inventoryItemId, canonical));

    // Per-group drift stops that group (report-level drift is what throws), so
    // the guarantee under test is that the edit is DETECTED and nothing is
    // mutated — not the specific failure channel.
    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(0);
    expect(result.stopped).toBe(1);
    expect(result.groups[0].failureCode).toBe('STALE_REPORT');
    expect(result.groups[0].failureReason).toMatch(/no longer matches the reviewed evidence/);

    const items = (await db
      .select({ active: inventoryItems.active, supersededByItemId: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, canonical))) as Array<{
      active: number;
      supersededByItemId: string | null;
    }>;
    expect(items[0].active).toBe(1);
    expect(items[0].supersededByItemId).toBeNull();
  });

  it('rolls the whole repair back when the audit row cannot be written', async () => {
    // The audit row is the only durable evidence that a group was remediated —
    // discovery reads it back to recognize a rerun. Committing the repair
    // without it would leave an applied but untracked repair that cannot be
    // resumed or reconciled, so an audit failure must undo everything.
    const { code, canonical, dupeB, dupeC } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifestId = `m-auditfail-${RUN}`;
    const manifest = buildApplyManifest(report, [code], manifestId);

    const countsBefore = await db
      .select({
        id: inventoryCountLines.id,
        inventoryItemId: inventoryCountLines.inventoryCountId,
        itemId: inventoryCountLines.inventoryItemId,
        qty: inventoryCountLines.qty,
        unitCost: inventoryCountLines.unitCost,
      })
      .from(inventoryCountLines)
      .where(inArray(inventoryCountLines.inventoryItemId, [canonical, dupeB, dupeC]));

    // Force the audit insert — and only the audit insert — to fail.
    // The manifest id must be inlined: a CREATE FUNCTION body cannot take a
    // bind parameter. RUN is a generated hex suffix, so there is nothing to
    // escape beyond the fixed prefix.
    await db.execute(
      sql.raw(`
      create or replace function fail_audit_${RUN}() returns trigger as $$
      begin
        if new.manifest_id = '${manifestId}' and new.result = 'applied' then
          raise exception 'forced audit failure for rollback test';
        end if;
        return new;
      end;
      $$ language plpgsql;
    `),
    );
    await db.execute(sql`
      create trigger ${sql.raw(`fail_audit_trg_${RUN}`)}
      before insert on inventory_item_remediation_audit
      for each row execute function ${sql.raw(`fail_audit_${RUN}`)}();
    `);

    try {
      const result = await applyRemediationManifest(manifest, ID.admin);
      // The group must not be reported as applied.
      expect(result.applied).toBe(0);
      expect(result.stopped).toBe(1);
    } finally {
      await db.execute(
        sql`drop trigger if exists ${sql.raw(`fail_audit_trg_${RUN}`)} on inventory_item_remediation_audit;`,
      );
      await db.execute(sql`drop function if exists ${sql.raw(`fail_audit_${RUN}`)}();`);
    }

    // Nothing may have been mutated: no supersession, no repointing.
    const items = (await db
      .select({
        id: inventoryItems.id,
        active: inventoryItems.active,
        supersededByItemId: inventoryItems.supersededByItemId,
        supersededAt: inventoryItems.supersededAt,
      })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [canonical, dupeB, dupeC]))) as Array<{
      active: number;
      supersededByItemId: string | null;
      supersededAt: Date | null;
    }>;
    for (const item of items) {
      expect(item.active).toBe(1);
      expect(item.supersededByItemId).toBeNull();
      expect(item.supersededAt).toBeNull();
    }

    const countsAfter = await db
      .select({
        id: inventoryCountLines.id,
        inventoryItemId: inventoryCountLines.inventoryCountId,
        itemId: inventoryCountLines.inventoryItemId,
        qty: inventoryCountLines.qty,
        unitCost: inventoryCountLines.unitCost,
      })
      .from(inventoryCountLines)
      .where(inArray(inventoryCountLines.inventoryItemId, [canonical, dupeB, dupeC]));
    expect(sortById(countsAfter)).toEqual(sortById(countsBefore));

    // No 'applied' audit row survived — that insert rolled back with the repair.
    // The 'stopped' row written afterwards SHOULD survive: the operator must be
    // able to see that the group was attempted and why it failed.
    const audits = (await db
      .select({
        result: inventoryItemRemediationAudit.result,
        failureReason: inventoryItemRemediationAudit.failureReason,
      })
      .from(inventoryItemRemediationAudit)
      .where(eq(inventoryItemRemediationAudit.manifestId, manifestId))) as Array<{
      result: string;
      failureReason: string | null;
    }>;
    expect(audits.filter(row => row.result === 'applied')).toHaveLength(0);
    expect(audits.filter(row => row.result === 'stopped')).toHaveLength(1);
    expect(audits[0].failureReason).toMatch(/forced audit failure/);

    // And the group is still reported as a repairable duplicate.
    const rediscovered = await buildRemediationReport(scope);
    const group = rediscovered.groups.find(g => g.sourceExternalId === code);
    expect(group?.classification).toBe('SAFE_CANDIDATE');
  });

  it('repoints deprecated inventory_item_locations rows instead of stranding them', async () => {
    // storage.ts still inner-joins this deprecated table when filtering items by
    // location, so a row left on a superseded item would keep that item visible
    // in those reads.
    const { code, canonical, dupeB } = await seedChambordDefect();
    await db.insert(inventoryItemLocations).values([
      { inventoryItemId: canonical, storageLocationId: ID.storageA, isPrimary: 1 },
      { inventoryItemId: dupeB, storageLocationId: ID.storageB, isPrimary: 1 },
      // Collides with the canonical's row and AGREES with it, so it is genuinely
      // redundant and may be dropped rather than duplicated. A colliding row
      // that disagreed would stop the group instead — covered separately.
      { inventoryItemId: dupeB, storageLocationId: ID.storageA, isPrimary: 1 },
    ]);

    const report = await buildRemediationReport(scope);
    const group = report.groups.find(g => g.sourceExternalId === code);
    expect(group?.referencesToRepoint.inventoryItemLocations).toBe(2);

    const manifest = buildApplyManifest(report, [code], `m-legacyloc-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(1);

    // No legacy row may remain on any superseded item.
    const stranded = await db
      .select({ n: sql<number>`count(*)` })
      .from(inventoryItemLocations)
      .where(eq(inventoryItemLocations.inventoryItemId, dupeB));
    expect(Number((stranded[0] as { n: number | string }).n)).toBe(0);

    // The distinct location moved across; the colliding one was not duplicated.
    const kept = (await db
      .select({ storageLocationId: inventoryItemLocations.storageLocationId })
      .from(inventoryItemLocations)
      .where(eq(inventoryItemLocations.inventoryItemId, canonical))) as Array<{
      storageLocationId: string;
    }>;
    expect(kept.map(row => row.storageLocationId).sort()).toEqual(
      [ID.storageA, ID.storageB].sort(),
    );
  });

  it('rejects the whole manifest when an unapproved group changed after review', async () => {
    // The approved group is untouched — the drift is entirely in a DIFFERENT
    // group the reviewer chose not to approve. Per-group hashes cannot see this;
    // only the whole-report authorization boundary catches it.
    const { code, canonical, dupeB } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-remainder-${RUN}`);

    // A brand-new duplicate group appears in the same scope after review.
    const otherCode = `sweetnlow-${RUN}`;
    await seedChambordDefect(otherCode);

    await expect(applyRemediationManifest(manifest, ID.admin)).rejects.toThrow(StaleReportError);
    await expect(applyRemediationManifest(manifest, ID.admin)).rejects.toThrow(
      /changed outside the approved groups/,
    );

    // Nothing was mutated: the refusal happens before any group is processed.
    const items = await db
      .select({ active: inventoryItems.active, supersededByItemId: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [canonical, dupeB]));
    for (const item of items as Array<{ active: number; supersededByItemId: string | null }>) {
      expect(item.active).toBe(1);
      expect(item.supersededByItemId).toBeNull();
    }
    const audits = await db
      .select({ n: sql<number>`count(*)` })
      .from(inventoryItemRemediationAudit)
      .where(eq(inventoryItemRemediationAudit.manifestId, `m-remainder-${RUN}`));
    expect(Number((audits[0] as { n: number | string }).n)).toBe(0);
  });

  it('stays idempotent on rerun even though applying changes the full report hash', async () => {
    // Guards the reason the boundary hashes the unapproved remainder rather than
    // the full report: a successful apply legitimately changes the full hash.
    const { code } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-rerun-${RUN}`);

    const first = await applyRemediationManifest(manifest, ID.admin);
    expect(first.applied).toBe(1);

    const after = await buildRemediationReport(scope);
    expect(after.reportHash).not.toBe(report.reportHash);
    expect(computeUnapprovedRemainderHash(after, manifest.groups)).toBe(
      manifest.unapprovedReportHash,
    );

    const second = await applyRemediationManifest(manifest, ID.admin);
    expect(second.applied).toBe(0);
    expect(second.stopped).toBe(0);
    expect(second.alreadyRemediated).toBe(1);
  });

  it('rejects a manifest whose remainder hash is missing', async () => {
    const { code } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const base = buildApplyManifest(report, [code], `m-noremainder-${RUN}`);
    const manifest: ApplyManifest = { ...base, unapprovedReportHash: '' };

    await expect(applyRemediationManifest(manifest, ID.admin)).rejects.toThrow(
      /no unapproved-remainder hash/,
    );
  });

  it('rejects a manifest whose group hash is missing', async () => {
    const { code } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const base = buildApplyManifest(report, [code], `m-nohash-${RUN}`);
    const manifest: ApplyManifest = {
      ...base,
      groups: base.groups.map(group => ({ ...group, groupHash: '' })),
    };

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.stopped).toBe(1);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('MANIFEST_MISMATCH');
  });

  it('rejects a manifest from an older report version', async () => {
    const { code } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest: ApplyManifest = {
      ...buildApplyManifest(report, [code], `m-version-${RUN}`),
      reportVersion: '0.0.1',
    };
    await expect(applyRemediationManifest(manifest, ID.admin)).rejects.toThrow(StaleReportError);
  });

  it('stops a group whose classification changed to CONFLICT before apply', async () => {
    const { code, canonical, dupeB, dupeC } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-conflict-${RUN}`);

    // Incompatible pack evidence lands after review.
    await db
      .update(inventoryImportRows)
      .set({ caseQuantity: 24 })
      .where(
        and(eq(inventoryImportRows.batchId, ID.juneBatch), eq(inventoryImportRows.sourceItemCode, code)),
      );

    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.stopped).toBe(1);
    const items = await db
      .select({ active: inventoryItems.active })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [canonical, dupeB, dupeC]));
    for (const item of items as Array<{ active: number }>) expect(item.active).toBe(1);
  });

  it('stops a group on a count uniqueness collision without partial mutation', async () => {
    const code = `collision-${RUN}`;
    // Both items hold a count row for the SAME session and storage location:
    // repointing would need two legitimate rows to become one.
    const first = await makeItem(code, {
      name: 'Heavy Cream',
      authoritativeMapping: true,
      storeLinked: true,
      locationIds: [ID.locationA],
      countRows: [[ID.mayCount, ID.storageA, 4, 10]],
    });
    const second = await makeItem(code, {
      name: 'Heavy Cream',
      locationIds: [ID.locationB],
      countRows: [[ID.mayCount, ID.storageA, 3, 10]],
    });
    await stageResolvedRow(ID.mayBatch, 1, code, first, { description: 'Heavy Cream' });
    await stageResolvedRow(ID.juneBatch, 1, code, second, { description: 'Heavy Cream' });

    const report = await buildRemediationReport(scope);
    expect(report.groups[0].classification).toBe('SAFE_CANDIDATE');
    const manifest = buildApplyManifest(report, [code], `m-collision-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);

    expect(result.stopped).toBe(1);
    const [stopped] = result.groups;
    if (stopped.result !== 'stopped') throw new Error('expected stopped');
    expect(stopped.failureCode).toBe('UNIQUENESS_COLLISION');
    expect(stopped.failureReason).toMatch(new RegExp(ID.storageA));

    // Nothing partially applied: both count rows, both location assignments,
    // both mappings, and both items are untouched.
    const lines = await db
      .select({ inventoryItemId: inventoryCountLines.inventoryItemId, qty: inventoryCountLines.qty })
      .from(inventoryCountLines)
      .where(inArray(inventoryCountLines.inventoryItemId, [first, second]));
    expect(lines).toHaveLength(2);
    expect(new Set((lines as Array<{ inventoryItemId: string }>).map(line => line.inventoryItemId))).toEqual(
      new Set([first, second]),
    );
    const assignments = await db
      .select({ inventoryItemId: inventoryItemLocationAssignments.inventoryItemId })
      .from(inventoryItemLocationAssignments)
      .where(inArray(inventoryItemLocationAssignments.inventoryItemId, [first, second]));
    expect(assignments).toHaveLength(2);
    const items = await db
      .select({ id: inventoryItems.id, active: inventoryItems.active, supersededByItemId: inventoryItems.supersededByItemId })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, [first, second]));
    for (const item of items as Array<{ active: number; supersededByItemId: string | null }>) {
      expect(item.active).toBe(1);
      expect(item.supersededByItemId).toBeNull();
    }

    // The stop is auditable.
    const audits = await db
      .select({ result: inventoryItemRemediationAudit.result, failureReason: inventoryItemRemediationAudit.failureReason })
      .from(inventoryItemRemediationAudit)
      .where(eq(inventoryItemRemediationAudit.companyId, ID.company));
    expect(audits).toHaveLength(1);
    expect((audits[0] as { result: string }).result).toBe('stopped');
    expect((audits[0] as { failureReason: string }).failureReason).toMatch(/UNIQUENESS_COLLISION/);
  });

  it('repoints vendor items and recipe components onto the canonical item', async () => {
    const { code, canonical, dupeB } = await seedChambordDefect();

    const [vendor] = await db
      .insert(vendors)
      .values({ companyId: ID.company, name: `Vendor ${RUN}` })
      .returning({ id: vendors.id });
    await db.insert(vendorItems).values({
      vendorId: vendor.id,
      inventoryItemId: dupeB,
      purchaseUnitId: caseUnit,
      caseSize: 6,
      lastPrice: 5,
      lastCasePrice: 30,
      active: 1,
    });
    const [recipe] = await db
      .insert(recipes)
      .values({ companyId: ID.company, name: `Recipe ${RUN}`, yieldQty: 1, yieldUnitId: eachUnit })
      .returning({ id: recipes.id });
    await db.insert(recipeComponents).values({
      recipeId: recipe.id,
      componentType: 'inventory_item',
      componentId: dupeB,
      qty: 2,
      unitId: eachUnit,
    });

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-refs-${RUN}`);
    const result = await applyRemediationManifest(manifest, ID.admin);
    expect(result.applied).toBe(1);

    const movedVendorItems = await db
      .select({ inventoryItemId: vendorItems.inventoryItemId })
      .from(vendorItems)
      .where(eq(vendorItems.vendorId, vendor.id));
    expect(movedVendorItems).toEqual([{ inventoryItemId: canonical }]);

    const movedComponents = await db
      .select({ componentId: recipeComponents.componentId })
      .from(recipeComponents)
      .where(eq(recipeComponents.recipeId, recipe.id));
    expect(movedComponents).toEqual([{ componentId: canonical }]);

    await db.delete(recipeComponents).where(eq(recipeComponents.recipeId, recipe.id));
    await db.delete(recipes).where(eq(recipes.id, recipe.id));
    await db.delete(vendorItems).where(eq(vendorItems.vendorId, vendor.id));
    await db.delete(vendors).where(eq(vendors.id, vendor.id));
  });

  it('keeps one store inventory row per store without double-counting on-hand', async () => {
    const code = `storeinv-${RUN}`;
    const first = await makeItem(code, {
      name: 'Chicken - Breast',
      authoritativeMapping: true,
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageA, 4, 10]],
    });
    const second = await makeItem(code, {
      name: 'Chicken - Breast',
      storeLinked: true,
      countRows: [[ID.mayCount, ID.storageB, 2, 10]],
    });
    await stageResolvedRow(ID.mayBatch, 1, code, first, { description: 'Chicken Breast' });
    await stageResolvedRow(ID.juneBatch, 1, code, second, { description: 'Chicken Breast' });

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-storeinv-${RUN}`);
    await applyRemediationManifest(manifest, ID.admin);

    const storeRows = await db
      .select({ inventoryItemId: storeInventoryItems.inventoryItemId, onHandQty: storeInventoryItems.onHandQty })
      .from(storeInventoryItems)
      .where(inArray(storeInventoryItems.inventoryItemId, [first, second]));
    expect(storeRows).toEqual([{ inventoryItemId: first, onHandQty: 4 }]);
  });
});

describe.skipIf(SKIP)('reconciliation', () => {
  it('reports period valuation before and after remediation as unchanged', async () => {
    const { code } = await seedChambordDefect();
    // May: 4*25 (canonical) + 2*25 (dupeB) = 150. June: 5*25 + 3*25 = 200.
    const expectations = [
      { label: 'May 2026', fromDate: '2026-05-01', toDate: '2026-06-01', expectedTotal: 150 },
      { label: 'June 2026', fromDate: '2026-06-02', toDate: '2026-07-01', expectedTotal: 200 },
    ];

    const before = await reconcilePeriods(scope, expectations);
    expect(before.every(period => period.matches)).toBe(true);

    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-recon-${RUN}`);
    await applyRemediationManifest(manifest, ID.admin);

    const after = await reconcilePeriods(scope, expectations);
    expect(after.map(period => period.actualTotal)).toEqual(before.map(period => period.actualTotal));
    expect(after.every(period => period.matches && period.delta === 0)).toBe(true);
  });

  it('reports zero remaining safe candidates after a successful apply', async () => {
    const { code } = await seedChambordDefect();
    const report = await buildRemediationReport(scope);
    const manifest = buildApplyManifest(report, [code], `m-post-${RUN}`);
    await applyRemediationManifest(manifest, ID.admin);

    const post = await buildRemediationReport(scope);
    expect(post.totals.safeCandidates).toBe(0);
    expect(post.groups[0].classification).toBe('NOT_DEFECT_RELATED');
  });

  it('excludes unapplied sessions and other source properties from the baseline', async () => {
    // Both noise sessions sit in the same store and the same May window, and
    // together carry 9,995 of value (1000×5 unapplied + 999×5 other-property).
    // A reconciliation scoped only by company/store/source system would fold
    // them in, so the remediated period would appear to be off by thousands —
    // or, worse, a genuinely broken total could be masked by them.
    await seedChambordDefect();

    const [may] = await reconcilePeriods(scope, [
      { label: 'May 2026', fromDate: '2026-05-01', toDate: '2026-06-01', expectedTotal: 150 },
    ]);

    expect(may.actualTotal).toBe(150);
    expect(may.matches).toBe(true);
    expect(may.countSessionIds).toEqual([ID.mayCount]);
    expect(may.countSessionIds).not.toContain(ID.pendingCount);
    expect(may.countSessionIds).not.toContain(ID.foreignPropCount);
  });

  it('flags a period mismatch rather than silently passing', async () => {
    await seedChambordDefect();
    const [period] = await reconcilePeriods(scope, [
      { label: 'May 2026', fromDate: '2026-05-01', toDate: '2026-06-01', expectedTotal: 999.99 },
    ]);
    expect(period.matches).toBe(false);
    expect(period.delta).not.toBe(0);
  });
});

describe.skipIf(SKIP)('report hash', () => {
  it('changes when the candidate set changes and is stable otherwise', async () => {
    const { code } = await seedChambordDefect();
    const first = await buildRemediationReport(scope);
    const second = await buildRemediationReport(scope);
    expect(second.reportHash).toBe(first.reportHash);

    const extra = await makeItem(code, { name: 'Chambord' });
    await stageResolvedRow(ID.juneBatch, 9, code, extra, { storageLocation: 'Member Lounge' });
    const third = await buildRemediationReport(scope);
    expect(third.reportHash).not.toBe(first.reportHash);
    expect(computeReportHash(scope, third.groups)).toBe(third.reportHash);
  });
});
