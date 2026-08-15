/**
 * DB-backed regression for the zero-group discovery defect.
 *
 * Production ran REPORT mode against a scope with known duplicate identities
 * (one Orderly Item Code held by six inventory items) and reported
 * `groupsExamined: 0`. Preflight passed and scope resolution passed, so the
 * exclusion happened before any row was examined.
 *
 * Root cause reproduced here: `target_store_id` and `source_property_id` were
 * added to `inventory_import_batches` with the source-property binding
 * contract. Batches imported BEFORE that contract carry NULL in one or both.
 * Discovery required both to equal the scope exactly, so every legacy batch —
 * and therefore every duplicate that only legacy provenance can prove — was
 * filtered out before grouping.
 *
 * The fix does NOT simply drop the predicate. A legacy batch is adopted only
 * when it is provably this store's (all of its count sessions are here, and at
 * least one exists) AND this store has exactly one active source property, so
 * no other property could own it. These tests pin both the visibility the fix
 * restores and the boundaries it must keep.
 *
 * A separate fixture from `orderlyDuplicateRemediation.db.test.ts` on purpose:
 * that suite's batches are all fully bound, which is exactly the condition
 * under test here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  companies as companiesTable,
  companyStores,
  importSourcePropertyBindings,
  inventoryCountLines,
  inventoryCounts,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItemExternalMappings,
  inventoryItems,
  storageLocations,
  storeInventoryItems,
  units,
  users,
} from '@workspace/db';
import {
  buildRemediationReport,
  resolveScopedBatches,
  type RemediationScope,
} from './orderlyDuplicateRemediation';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = vi.hoisted(() => `lg${Date.now().toString(36)}`);

const ID = {
  company: `${RUN}-co`,
  // Store with exactly ONE active source property: legacy adoption is allowed.
  store: `${RUN}-store`,
  property: `${RUN}-prop`,
  binding: `${RUN}-binding`,
  // Store fed by TWO active source properties: adoption must be refused.
  dualStore: `${RUN}-store-dual`,
  dualPropertyA: `${RUN}-prop-dual-a`,
  dualPropertyB: `${RUN}-prop-dual-b`,
  dualBindingA: `${RUN}-binding-dual-a`,
  dualBindingB: `${RUN}-binding-dual-b`,
  // A second single-property store, used to prove cross-store leakage fails.
  otherStore: `${RUN}-store-other`,
  otherProperty: `${RUN}-prop-other`,
  otherBinding: `${RUN}-binding-other`,
  admin: `${RUN}-admin`,
  storage: `${RUN}-storage`,
  // Legacy batch: both scope columns NULL, count session in the scoped store.
  legacyBatch: `${RUN}-batch-legacy`,
  legacyCount: `${RUN}-count-legacy`,
  // Legacy batch whose only sessions live at another store.
  foreignBatch: `${RUN}-batch-foreign`,
  foreignCount: `${RUN}-count-foreign`,
  // Legacy batch with no count sessions at all.
  orphanBatch: `${RUN}-batch-orphan`,
  // Legacy batch under the dual-property store.
  dualBatch: `${RUN}-batch-dual`,
  dualCount: `${RUN}-count-dual`,
  // Batch with store set but property NULL — half-migrated.
  halfBatch: `${RUN}-batch-half`,
  halfCount: `${RUN}-count-half`,
};

const scope: RemediationScope = {
  companyId: ID.company,
  storeId: ID.store,
  sourceSystem: 'ORDERLY',
  sourcePropertyId: ID.property,
};

let eachUnit = '';
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

async function makeItem(
  name: string,
  options: {
    mappingCode?: string;
    mappingProperty?: string;
    countRows?: Array<[string, number, number]>;
    storeLinkedTo?: string;
  } = {},
): Promise<string> {
  const [item] = await db
    .insert(inventoryItems)
    .values({
      companyId: ID.company,
      name,
      unitId: eachUnit,
      caseSize: 6,
      pricePerUnit: 12,
      avgCostPerUnit: 12,
      active: 1,
      yieldPercent: 100,
    })
    .returning({ id: inventoryItems.id });
  createdItemIds.push(item.id);

  if (options.mappingCode) {
    await db.insert(inventoryItemExternalMappings).values({
      companyId: ID.company,
      inventoryItemId: item.id,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: options.mappingProperty ?? ID.property,
      sourceExternalId: options.mappingCode,
      sourceDescription: name,
      matchStrategy: 'code',
      confidenceScore: 1,
    });
  }
  if (options.storeLinkedTo) {
    await db.insert(storeInventoryItems).values({
      companyId: ID.company,
      storeId: options.storeLinkedTo,
      inventoryItemId: item.id,
      onHandQty: 3,
      active: 1,
    });
  }
  for (const [countId, qty, unitCost] of options.countRows ?? []) {
    await db.insert(inventoryCountLines).values({
      inventoryCountId: countId,
      inventoryItemId: item.id,
      storageLocationId: ID.storage,
      qty,
      unitId: eachUnit,
      unitCost,
      userId: ID.admin,
    });
  }
  return item.id;
}

async function stageRow(
  batchId: string,
  rowIndex: number,
  code: string,
  itemId: string,
  description = 'Sauce - Tabasco',
): Promise<void> {
  await db.insert(inventoryImportRows).values({
    batchId,
    rowIndex,
    sheetName: 'Inventory Detail',
    rawData: { description, code },
    rawDescription: description,
    cleanedDescription: description,
    caseQuantity: 12,
    baseUnit: 'OZ',
    packagePrice: 12,
    totalCost: 12,
    sourceItemCode: code,
    itemCodeStatus: 'valid',
    supplierStatus: 'blank',
    storageLocation: 'Dry Storage',
    rowStatus: 'matched_existing',
    resolvedInventoryItemId: itemId,
  });
}

beforeAll(async () => {
  if (SKIP) return;
  eachUnit = await unitId('ea');

  await db.insert(companiesTable).values({ id: ID.company, name: `Legacy Scope Co ${RUN}` });
  await db.insert(companyStores).values([
    { id: ID.store, companyId: ID.company, code: `LS${RUN}`.slice(0, 10), name: 'Bay Hill', status: 'active' },
    { id: ID.dualStore, companyId: ID.company, code: `LD${RUN}`.slice(0, 10), name: 'Dual Feed', status: 'active' },
    { id: ID.otherStore, companyId: ID.company, code: `LO${RUN}`.slice(0, 10), name: 'Other Club', status: 'active' },
  ]);
  await db.insert(users).values({
    id: ID.admin,
    email: `legacy-scope-${RUN}@test.local`,
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
      destinationStoreId: ID.store,
      active: 1,
    },
    {
      id: ID.dualBindingA,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.dualPropertyA,
      destinationStoreId: ID.dualStore,
      active: 1,
    },
    {
      id: ID.dualBindingB,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.dualPropertyB,
      destinationStoreId: ID.dualStore,
      active: 1,
    },
    {
      id: ID.otherBinding,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.otherProperty,
      destinationStoreId: ID.otherStore,
      active: 1,
    },
  ]);
  await db.insert(storageLocations).values({
    id: ID.storage,
    companyId: ID.company,
    name: `Dry Storage ${RUN}`,
  });

  // Every batch below is APPROVED. The only thing that varies is how much of
  // the scope contract its columns carry, which is the defect under test.
  await db.insert(inventoryImportBatches).values([
    {
      id: ID.legacyBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-legacy-${RUN}`,
      originalFilename: 'may-legacy.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-05-31',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 5, 1)),
      // The defect: pre-binding batch, both scope columns unset.
      targetStoreId: null,
      sourcePropertyBindingId: null,
      sourcePropertyId: null,
    },
    {
      id: ID.foreignBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-foreign-${RUN}`,
      originalFilename: 'may-foreign.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-05-31',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 5, 1)),
      targetStoreId: null,
      sourcePropertyId: null,
    },
    {
      id: ID.orphanBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-orphan-${RUN}`,
      originalFilename: 'may-orphan.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-05-31',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 5, 1)),
      targetStoreId: null,
      sourcePropertyId: null,
    },
    {
      id: ID.dualBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-dual-${RUN}`,
      originalFilename: 'may-dual.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-05-31',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 5, 1)),
      targetStoreId: null,
      sourcePropertyId: null,
    },
    {
      id: ID.halfBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `hash-half-${RUN}`,
      originalFilename: 'june-half.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-06-30',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 6, 1)),
      // Half-migrated: store recorded, property still unset.
      targetStoreId: ID.store,
      sourcePropertyId: null,
    },
  ]);

  await db.insert(inventoryCounts).values([
    {
      id: ID.legacyCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 4, 31)),
      userId: ID.admin,
      name: 'Orderly — May 2026 (legacy)',
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.legacyBatch,
      sourceInventoryDate: '2026-05-31',
    },
    {
      id: ID.foreignCount,
      companyId: ID.company,
      storeId: ID.otherStore,
      countDate: new Date(Date.UTC(2026, 4, 31)),
      userId: ID.admin,
      name: 'Orderly — May 2026 (other store)',
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.foreignBatch,
      sourceInventoryDate: '2026-05-31',
    },
    {
      id: ID.dualCount,
      companyId: ID.company,
      storeId: ID.dualStore,
      countDate: new Date(Date.UTC(2026, 4, 31)),
      userId: ID.admin,
      name: 'Orderly — May 2026 (dual-feed store)',
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.dualBatch,
      sourceInventoryDate: '2026-05-31',
    },
    {
      id: ID.halfCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 5, 30)),
      userId: ID.admin,
      name: 'Orderly — June 2026 (half-migrated)',
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.halfBatch,
      sourceInventoryDate: '2026-06-30',
    },
  ]);
});

async function resetFixture(): Promise<void> {
  await db
    .delete(inventoryImportRows)
    .where(
      inArray(inventoryImportRows.batchId, [
        ID.legacyBatch,
        ID.foreignBatch,
        ID.orphanBatch,
        ID.dualBatch,
        ID.halfBatch,
      ]),
    );
  if (createdItemIds.length > 0) {
    await db.delete(inventoryCountLines).where(inArray(inventoryCountLines.inventoryItemId, createdItemIds));
    await db.delete(storeInventoryItems).where(inArray(storeInventoryItems.inventoryItemId, createdItemIds));
    await db
      .delete(inventoryItemExternalMappings)
      .where(inArray(inventoryItemExternalMappings.inventoryItemId, createdItemIds));
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
  await db.delete(inventoryCounts).where(eq(inventoryCounts.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.companyId, ID.company)).catch(() => {});
  await db.delete(storageLocations).where(eq(storageLocations.companyId, ID.company)).catch(() => {});
  await db
    .delete(importSourcePropertyBindings)
    .where(eq(importSourcePropertyBindings.companyId, ID.company))
    .catch(() => {});
  await db.delete(users).where(eq(users.id, ID.admin)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, ID.company)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, ID.company)).catch(() => {});
});

/**
 * The production shape: one reliable Item Code resolved to several items by a
 * LEGACY batch, and only some of those items carry an external mapping.
 */
async function seedLegacyTabascoDefect(code: string): Promise<string[]> {
  const canonical = await makeItem('Sauce - Tabasco', {
    mappingCode: code,
    storeLinkedTo: ID.store,
    countRows: [[ID.legacyCount, 4, 12]],
  });
  // Deliberately UNMAPPED duplicates: production had incomplete mapping
  // coverage, which is why a mapping-driven discovery pass would miss them.
  const dupeB = await makeItem('Sauce - Tabasco', { countRows: [[ID.legacyCount, 2, 12]] });
  const dupeC = await makeItem('Sauce - Tabasco', { countRows: [[ID.legacyCount, 1, 12]] });

  await stageRow(ID.legacyBatch, 1, code, canonical);
  await stageRow(ID.legacyBatch, 2, code, dupeB);
  await stageRow(ID.legacyBatch, 3, code, dupeC);
  return [canonical, dupeB, dupeC];
}

describe.skipIf(SKIP)('legacy batch scope resolution', () => {
  it('adopts an unset-scope batch that is provably this store and property', async () => {
    const resolution = await resolveScopedBatches(scope);
    const adopted = resolution.batches.filter(batch => batch.attribution === 'adopted');

    expect(resolution.legacyAdoptionPermitted).toBe(true);
    expect(adopted.map(batch => batch.id).sort()).toEqual([ID.halfBatch, ID.legacyBatch].sort());
  });

  it('refuses a legacy batch whose count sessions belong to another store', async () => {
    const resolution = await resolveScopedBatches(scope);

    expect(resolution.batches.map(batch => batch.id)).not.toContain(ID.foreignBatch);
    expect(resolution.rejected.find(row => row.id === ID.foreignBatch)?.reason).toMatch(
      /another store or company/,
    );
  });

  it('refuses a legacy batch with no count sessions rather than assuming it is in scope', async () => {
    const resolution = await resolveScopedBatches(scope);

    expect(resolution.batches.map(batch => batch.id)).not.toContain(ID.orphanBatch);
    expect(resolution.rejected.find(row => row.id === ID.orphanBatch)?.reason).toMatch(
      /no count sessions/,
    );
  });

  it('refuses every legacy batch when two source properties feed the same store', async () => {
    const dualScope: RemediationScope = {
      companyId: ID.company,
      storeId: ID.dualStore,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.dualPropertyA,
    };

    const resolution = await resolveScopedBatches(dualScope);

    expect(resolution.legacyAdoptionPermitted).toBe(false);
    expect(resolution.batches).toHaveLength(0);
    expect(resolution.rejected.find(row => row.id === ID.dualBatch)?.reason).toMatch(/ambiguous/);
  });

  it('never adopts a legacy batch into a store that is not its own', async () => {
    const otherScope: RemediationScope = {
      companyId: ID.company,
      storeId: ID.otherStore,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.otherProperty,
    };

    const resolution = await resolveScopedBatches(otherScope);

    // The legacy batch's sessions are all at ID.store, so this scope may not
    // claim it — the fix must not turn "unset" into "belongs to whoever asks".
    expect(resolution.batches.map(batch => batch.id)).not.toContain(ID.legacyBatch);
  });
});

describe.skipIf(SKIP)('discovery over legacy provenance', () => {
  it('finds the duplicate group that unset scope columns previously hid', async () => {
    const code = `tabasco-${RUN}`;
    const items = await seedLegacyTabascoDefect(code);

    const report = await buildRemediationReport(scope);

    // Before the fix this was zero: the batch was filtered out before its rows
    // were ever read, so the group did not exist to be classified.
    expect(report.totals.groupsExamined).toBe(1);
    const [group] = report.groups;
    expect(group.sourceExternalId).toBe(code);
    expect(group.candidateItemIds.sort()).toEqual([...items].sort());
  });

  it('sees unmapped duplicates — visibility does not depend on mapping coverage', async () => {
    const code = `tabasco-unmapped-${RUN}`;
    const canonical = await makeItem('Sauce - Tabasco', {
      mappingCode: code,
      storeLinkedTo: ID.store,
      countRows: [[ID.legacyCount, 4, 12]],
    });
    const unmapped = await makeItem('Sauce - Tabasco', { countRows: [[ID.legacyCount, 2, 12]] });
    await stageRow(ID.legacyBatch, 1, code, canonical);
    await stageRow(ID.legacyBatch, 2, code, unmapped);

    const report = await buildRemediationReport(scope);

    const [group] = report.groups;
    expect(group.candidateItemIds).toContain(unmapped);
    // Missing mappings are a classification input, never a visibility filter.
    const unmappedCandidate = group.candidates.find(candidate => candidate.itemId === unmapped);
    expect(unmappedCandidate?.hasAuthoritativeMapping).toBe(false);
  });

  it('groups provenance spanning a legacy batch and a fully bound batch', async () => {
    const code = `tabasco-span-${RUN}`;
    const canonical = await makeItem('Sauce - Tabasco', {
      mappingCode: code,
      storeLinkedTo: ID.store,
      countRows: [[ID.legacyCount, 4, 12]],
    });
    const dupe = await makeItem('Sauce - Tabasco', { countRows: [[ID.halfCount, 3, 12]] });
    await stageRow(ID.legacyBatch, 1, code, canonical);
    await stageRow(ID.halfBatch, 1, code, dupe);

    const report = await buildRemediationReport(scope);

    const [group] = report.groups;
    expect(group.candidateItemIds.sort()).toEqual([canonical, dupe].sort());
    expect(group.evidence.importBatchIds.sort()).toEqual([ID.halfBatch, ID.legacyBatch].sort());
  });

  it('still reports nothing when the only provenance is another store\'s legacy batch', async () => {
    const code = `tabasco-foreign-${RUN}`;
    const a = await makeItem('Sauce - Tabasco', { countRows: [[ID.foreignCount, 1, 12]] });
    const b = await makeItem('Sauce - Tabasco', { countRows: [[ID.foreignCount, 2, 12]] });
    await stageRow(ID.foreignBatch, 1, code, a);
    await stageRow(ID.foreignBatch, 2, code, b);

    const report = await buildRemediationReport(scope);

    expect(report.totals.groupsExamined).toBe(0);
  });

  it('performs no writes while discovering through a legacy batch', async () => {
    const code = `tabasco-readonly-${RUN}`;
    await seedLegacyTabascoDefect(code);

    const snapshot = async () => ({
      items: await db
        .select({
          id: inventoryItems.id,
          active: inventoryItems.active,
          superseded: inventoryItems.supersededByItemId,
        })
        .from(inventoryItems)
        .where(eq(inventoryItems.companyId, ID.company)),
      lines: await db
        .select({ id: inventoryCountLines.id, itemId: inventoryCountLines.inventoryItemId })
        .from(inventoryCountLines)
        .where(inArray(inventoryCountLines.inventoryItemId, createdItemIds)),
      batches: await db
        .select({
          id: inventoryImportBatches.id,
          store: inventoryImportBatches.targetStoreId,
          property: inventoryImportBatches.sourcePropertyId,
        })
        .from(inventoryImportBatches)
        .where(eq(inventoryImportBatches.companyId, ID.company)),
      mappings: await db
        .select({ id: inventoryItemExternalMappings.id })
        .from(inventoryItemExternalMappings)
        .where(eq(inventoryItemExternalMappings.companyId, ID.company)),
    });

    const before = await snapshot();
    const first = await buildRemediationReport(scope);
    const after = await snapshot();

    expect(after).toEqual(before);
    // Discovery must not "repair" the legacy scope columns as a side effect.
    expect(after.batches.find(batch => batch.id === ID.legacyBatch)?.store).toBeNull();
    expect(after.batches.find(batch => batch.id === ID.legacyBatch)?.property).toBeNull();

    // Report hash is stable across identical reads.
    const second = await buildRemediationReport(scope);
    expect(second.reportHash).toBe(first.reportHash);
  });
});
