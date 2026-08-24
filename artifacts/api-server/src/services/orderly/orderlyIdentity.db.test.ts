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
  storeInventoryItems,
  units,
  users,
} from '@workspace/db';
import {
  applyBatchApproval,
  ImportApprovalError,
  runResolutionPreview,
} from './orderlyDomain';
import { ensureInventoryItemNumberSchema } from '../../migrations/inventoryItemNumbers';

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
  await ensureInventoryItemNumberSchema(db);
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
  it('keeps generated FnB item numbers out of public catalog payloads', () => {
    expect(insertInventoryItemSchema.shape).not.toHaveProperty('internalItemNumber');
    expect(
      insertInventoryItemSchema.partial().parse({ internalItemNumber: 100_001 }),
    ).not.toHaveProperty('internalItemNumber');
  });

  it('backfills legacy items and never rewinds the FnB number generator', async () => {
    const schemaName = `fnb_item_number_${RUN}`;
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
      { code: `ALT-${RUN}`, description: `Evidence-led Cabernet ${RUN}`, location: 'Pool Cafe', caseQuantity: 6, baseUnit: 'ML' },
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
      `ALT-${RUN}`,
      expect.stringMatching(/^ALT\|evidence led cabernet /),
    ]));
  });

  it('keeps a blank row held when multiple coded siblings could establish its identity', async () => {
    const batchId = await stageBatch([
      { code: null, description: `Multiple Code Evidence ${RUN}`, location: 'Member Lounge', caseQuantity: 6, baseUnit: 'ML' },
      { code: `MULTI-A-${RUN}`, description: `Multiple Code Evidence ${RUN}`, location: 'Pool Cafe', caseQuantity: 6, baseUnit: 'ML' },
      { code: `MULTI-B-${RUN}`, description: `Multiple Code Evidence ${RUN}`, location: 'Main Kitchen', caseQuantity: 6, baseUnit: 'ML' },
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
    expect(resolvedByCode.get(`MULTI-A-${RUN}`)).toBeTruthy();
    expect(resolvedByCode.get(`MULTI-B-${RUN}`)).toBeTruthy();
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

  it('refuses a separate variant when the source pack evidence is incomplete', async () => {
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

    await expect(applyBatchApproval(incompleteEvidenceBatch, approvalAuth, [{
      rowIndex: 1,
      action: 'create_variant',
      comparableInventoryItemId: mayRow.resolvedInventoryItemId,
    }])).rejects.toMatchObject<Partial<ImportApprovalError>>({ code: 'CONFLICT' });
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