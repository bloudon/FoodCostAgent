/**
 * DB-backed identity regressions for the Bay Hill Orderly XLSX importer.
 *
 * These exercise the authoritative approval transaction rather than a mocked
 * preview, proving that repeated reliable Item Codes cannot independently
 * create inventory items before a mapping is visible.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  companies as companiesTable,
  companyStores,
  importSourcePropertyBindings,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItemExternalMappings,
  inventoryItemRelationships,
  inventoryItemLocationAssignments,
  inventoryItems,
  inventoryLocations,
  storeInventoryItems,
  units,
  users,
} from '@workspace/db';
import {
  applyBatchApproval,
  ImportApprovalError,
  runResolutionPreview,
} from './orderlyDomain';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = vi.hoisted(() => Date.now().toString(36));
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
  caseQuantity?: number;
  innerPackQuantity?: number | null;
  baseUnitQuantity?: number | null;
  baseUnit?: string | null;
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
  await db.insert(inventoryImportRows).values(rows.map((row, index) => ({
    batchId: id,
    rowIndex: index + 1,
    sheetName: 'Inventory Detail',
    rawData: { description: row.description, location: row.location },
    rawDescription: row.description,
    cleanedDescription: row.description,
    caseQuantity: row.caseQuantity ?? 6,
    innerPackQuantity: row.innerPackQuantity ?? 1,
    baseUnitQuantity: row.baseUnitQuantity ?? 1,
    baseUnit: row.baseUnit ?? 'ML',
    packagePrice: 30,
    totalCost: row.totalCost ?? 30,
    sourceItemCode: row.code,
    itemCodeStatus: row.code ? 'valid' : 'blank',
    supplierStatus: 'blank',
    storageLocation: row.location,
    rowStatus: 'new_item_candidate',
  })));
  return id;
}

const approvalAuth = { actingUserId: ID.admin, companyId: ID.company };

beforeAll(async () => {
  if (SKIP) return;
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
    await db.delete(inventoryImportRows).where(inArray(inventoryImportRows.batchId, batchIds)).catch(() => {});
  }
  await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.companyId, ID.company)).catch(() => {});
  await db.delete(storeInventoryItems).where(eq(storeInventoryItems.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryItemLocationAssignments).where(eq(inventoryItemLocationAssignments.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryItemExternalMappings).where(eq(inventoryItemExternalMappings.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryItemRelationships).where(eq(inventoryItemRelationships.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryItems).where(eq(inventoryItems.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryLocations).where(eq(inventoryLocations.companyId, ID.company)).catch(() => {});
  await db.delete(importSourcePropertyBindings).where(eq(importSourcePropertyBindings.companyId, ID.company)).catch(() => {});
  await db.delete(users).where(eq(users.id, ID.admin)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, ID.company)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, ID.company)).catch(() => {});
});

describe.skipIf(SKIP)('Orderly XLSX reliable Item Code identity', () => {
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
    const mayRows = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(and(
        eq(inventoryImportRows.sourceItemCode, '9684722'),
        eq(inventoryImportRows.batchId, `oid-batch-${RUN}-0`),
      ));
    const expectedId = mayRows[0]?.resolvedInventoryItemId;
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
      { code: 'known-product-code', description: 'Known Product', location: 'Bar Back' },
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

  it('keeps blank-code multi-location evidence unresolved rather than auto-creating uncertain items', async () => {
    const batchId = await stageBatch([
      { code: null, description: 'House Cabernet', location: 'Member Lounge' },
      { code: null, description: 'House Cabernet', location: 'Pool Cafe' },
    ], '2026-08-31');

    const preview = await runResolutionPreview(batchId, ID.company);
    expect(preview.identitySummary.blankCodeRows).toBe(2);
    expect(preview.identitySummary.blankCodeUnresolved).toBe(2);
    expect(preview.summary.itemsHeldForReview).toBe(2);
    expect(preview.rows.map(row => ({
      heldForReview: row.heldForReview,
      holdReason: row.holdReason,
    }))).toEqual([
      { heldForReview: true, holdReason: 'blank_item_code' },
      { heldForReview: true, holdReason: 'blank_item_code' },
    ]);

    const result = await applyBatchApproval(batchId, approvalAuth);
    expect(result.itemsCreated).toBe(0);
    expect(result.rowsHeldForReview).toBe(2);
    const rows = await db
      .select({ resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.batchId, batchId));
    expect(rows.map(row => row.resolvedInventoryItemId)).toEqual([null, null]);
  });

  it('creates one coded identity and reconciles its blank-code location sibling', async () => {
    const batchId = await stageBatch([
      { code: null, description: `Evidence-led Cabernet ${RUN}`, location: 'Member Lounge', caseQuantity: 6, baseUnit: 'ML' },
      { code: `ALT-${RUN}`, description: `Evidence-led Cabernet ${RUN}`, location: 'Pool Cafe', caseQuantity: 6, baseUnit: 'ML' },
    ], '2026-10-31');

    const preview = await runResolutionPreview(batchId, ID.company);
    expect(preview.identitySummary.blankCodeGroupsWithCodedSibling).toBe(1);
    expect(preview.identitySummary.identityGroupsNewCandidates).toBe(1);
    expect(preview.rows.find(row => row.itemCodeStatus === 'blank')?.identityGroupRows).toHaveLength(2);

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
      `ALT-${RUN}`,
      expect.stringMatching(/^ALT\|evidence led cabernet /),
    ]));
  });

  it('allows explicit links for held ambiguous and fuzzy blank-code rows while leaving an unchosen row held', async () => {
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
    expect(unlinkedRow?.heldForReview).toBe(true);

    const result = await applyBatchApproval(batchId, approvalAuth, [
      { rowIndex: ambiguousRow!.rowIndex, inventoryItemId: ambiguousA.id },
      { rowIndex: fuzzyRow!.rowIndex, inventoryItemId: fuzzyCandidate.id },
    ]);
    expect(result.itemsCreated).toBe(0);
    expect(result.itemsLinked).toBe(2);
    expect(result.rowsHeldForReview).toBe(1);

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
    expect(resolvedByIndex.get(unlinkedRow!.rowIndex)).toBeNull();
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
});