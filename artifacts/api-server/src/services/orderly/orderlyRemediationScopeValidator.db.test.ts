/**
 * DB-backed coverage for the shared scope validator and the manifest-aware
 * preflight gate (Task #1141).
 *
 * These exist because of a specific production incident: an APPLY of an
 * 848-group manifest was authorized after a preflight that only checked schema
 * objects and the source-property binding. It then discovered cross-property
 * external mappings DURING mutation, group by group, and had to be terminated.
 * It stopped correctly and changed nothing — but every blocker it found was
 * answerable by a read-only query before the first transaction opened.
 *
 * The invariant under test:
 *
 *   APPLY must never discover a scope blocker that manifest-aware read-only
 *   preflight could have discovered first.
 *
 * That is a claim about real database rows — cross-property mappings, NULL
 * scope columns, count provenance, unique constraints — so it cannot be proven
 * against a mock. A mock would simply return whatever the mock author believed
 * the schema does, which is exactly the assumption that failed in production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
  inventoryItemRemediationAudit,
  inventoryItems,
  storageLocations,
  storeInventoryItems,
  units,
  users,
} from '@workspace/db';
import {
  evaluateGroupScope,
  evaluateManifestScope,
  assertGroupExclusiveToScope,
  resolveScopedBatches,
  type ManifestGroupItems,
  type LegacyAdoptionAuthorization,
  type LegacyAdoptionPolicy,
  type RemediationScope,
} from './orderlyRemediationScopeValidator';
import {
  preflightManifestScope,
  RemediationManifestBlockedError,
  verifySuspendedRunMutationFree,
} from './orderlyDuplicateRemediationPreflight';
import { buildForensicReport, formatForensicReport } from './orderlyRemediationForensics';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = vi.hoisted(() => `v${Date.now().toString(36)}`);

const ID = {
  company: `sv-co-${RUN}`,
  otherCompany: `sv-co-other-${RUN}`,
  store: `sv-store-${RUN}`,
  storeB: `sv-store-b-${RUN}`,
  admin: `sv-admin-${RUN}`,
  binding: `sv-binding-${RUN}`,
  bindingB: `sv-binding-b-${RUN}`,
  property: `sv-prop-${RUN}`,
  propertyB: `sv-prop-b-${RUN}`,
  storageA: `sv-sloc-a-${RUN}`,
  batch: `sv-batch-${RUN}`,
  legacyBatch: `sv-batch-legacy-${RUN}`,
  foreignBatch: `sv-batch-foreign-${RUN}`,
  count: `sv-count-${RUN}`,
  legacyCount: `sv-count-legacy-${RUN}`,
  foreignCount: `sv-count-foreign-${RUN}`,
};

const scope: RemediationScope = {
  companyId: ID.company,
  storeId: ID.store,
  sourceSystem: 'ORDERLY',
  sourcePropertyId: ID.property,
};

function legacyAuthorization(groupCount: number): LegacyAdoptionAuthorization {
  const policy: LegacyAdoptionPolicy = {
    policyId: `test-legacy-adoption-${RUN}`,
    scope,
    manifestId: `legacy-manifest-${RUN}`,
    reportHash: `legacy-report-${RUN}`,
    unapprovedReportHash: `legacy-remainder-${RUN}`,
    expectedGroupCount: groupCount,
    expectedScopedLegacyBatchCount: 2,
  };
  return {
    policy,
    manifestId: policy.manifestId,
    reportHash: policy.reportHash,
    unapprovedReportHash: policy.unapprovedReportHash,
    groupCount,
  };
}

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

interface ItemSpec {
  /** Give the item a mapping. `property: undefined` means "omit the column". */
  mapping?: {
    code: string;
    companyId?: string;
    sourceSystem?: string;
    /** `null` writes the legacy empty-string value the column defaults to. */
    sourcePropertyId?: string | null;
  };
  /** Attach an in-scope import row so the item has scoped provenance. */
  scopedImportRow?: string;
  /** Attach an out-of-scope import row. */
  foreignImportRow?: string;
  /** Attach an in-scope count line. */
  scopedCountLine?: boolean;
  /** Attach a store_inventory_items row at the OTHER store. */
  otherStoreRow?: boolean;
}

let rowIndex = 0;

async function makeItem(name: string, spec: ItemSpec = {}): Promise<string> {
  const [item] = await db
    .insert(inventoryItems)
    .values({
      companyId: ID.company,
      name: `${name} ${RUN}`,
      unitId: eachUnit,
      caseSize: 6,
      pricePerUnit: 10,
      avgCostPerUnit: 10,
      active: 1,
      yieldPercent: 100,
    })
    .returning({ id: inventoryItems.id });
  createdItemIds.push(item.id);

  if (spec.mapping) {
    await db.insert(inventoryItemExternalMappings).values({
      companyId: spec.mapping.companyId ?? ID.company,
      inventoryItemId: item.id,
      sourceSystem: spec.mapping.sourceSystem ?? 'ORDERLY',
      // The column is NOT NULL with a '' default, so "missing scope" on this
      // schema is the empty string. The validator must treat '' and NULL the
      // same way — as an unanswered ownership question, not as permission.
      sourcePropertyId:
        spec.mapping.sourcePropertyId === null ? '' : spec.mapping.sourcePropertyId ?? ID.property,
      sourceExternalId: spec.mapping.code,
      matchStrategy: 'code',
      confidenceScore: 1,
    });
  }
  if (spec.scopedImportRow) {
    await stageRow(ID.batch, spec.scopedImportRow, item.id);
  }
  if (spec.foreignImportRow) {
    await stageRow(ID.foreignBatch, spec.foreignImportRow, item.id);
  }
  if (spec.scopedCountLine) {
    await db.insert(inventoryCountLines).values({
      inventoryCountId: ID.count,
      inventoryItemId: item.id,
      storageLocationId: ID.storageA,
      qty: 2,
      unitId: eachUnit,
      unitCost: 10,
      userId: ID.admin,
    });
  }
  if (spec.otherStoreRow) {
    await db.insert(storeInventoryItems).values({
      companyId: ID.company,
      storeId: ID.storeB,
      inventoryItemId: item.id,
      onHandQty: 3,
      active: 1,
    });
  }
  return item.id;
}

async function stageRow(batchId: string, code: string, itemId: string): Promise<void> {
  await db.insert(inventoryImportRows).values({
    batchId,
    rowIndex: rowIndex++,
    sheetName: 'Inventory Detail',
    rawData: { code },
    rawDescription: code,
    cleanedDescription: code,
    caseQuantity: 6,
    baseUnit: 'ML',
    packagePrice: 10,
    totalCost: 10,
    sourceItemCode: code,
    itemCodeStatus: 'valid',
    supplierStatus: 'blank',
    storageLocation: 'Liquor Cage',
    rowStatus: 'matched_existing',
    resolvedInventoryItemId: itemId,
  });
}

/** A clean, fully in-scope group: canonical + one duplicate. */
async function makeCleanGroup(code: string): Promise<ManifestGroupItems> {
  const canonical = await makeItem(`${code} canonical`, {
    mapping: { code },
    scopedImportRow: code,
    scopedCountLine: true,
  });
  const duplicate = await makeItem(`${code} duplicate`, {
    scopedImportRow: code,
    scopedCountLine: true,
  });
  return { sourceExternalId: code, canonicalItemId: canonical, supersededItemIds: [duplicate] };
}

beforeAll(async () => {
  if (SKIP) return;
  eachUnit = await unitId('ea');

  await db.insert(companiesTable).values([
    { id: ID.company, name: `Scope Validator Co ${RUN}` },
    { id: ID.otherCompany, name: `Scope Validator Other ${RUN}` },
  ]);
  await db.insert(companyStores).values([
    { id: ID.store, companyId: ID.company, code: `SV${RUN}`.slice(0, 10), name: 'Bay Hill', status: 'active' },
    { id: ID.storeB, companyId: ID.company, code: `SVB${RUN}`.slice(0, 10), name: 'Second Club', status: 'active' },
  ]);
  await db.insert(users).values({
    id: ID.admin,
    email: `scope-validator-${RUN}@test.local`,
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
  await db.insert(storageLocations).values({
    id: ID.storageA,
    companyId: ID.company,
    name: `Liquor Cage ${RUN}`,
  });
  await db.insert(inventoryImportBatches).values([
    {
      id: ID.batch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `sv-hash-${RUN}`,
      originalFilename: 'scope.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-05-31',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 5, 1)),
      // Deliberately pre-binding: scope comes from its count session plus the
      // one active store binding, not from NULL being treated as permission.
      targetStoreId: null,
      sourcePropertyBindingId: null,
      sourcePropertyId: null,
    },
    {
      id: ID.legacyBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `sv-hash-legacy-${RUN}`,
      originalFilename: 'scope-legacy.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-04-30',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 4, 1)),
      targetStoreId: null,
      sourcePropertyBindingId: null,
      sourcePropertyId: null,
    },
    {
      id: ID.foreignBatch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `sv-hash-foreign-${RUN}`,
      originalFilename: 'scope-foreign.xlsx',
      parserVersion: '1.0',
      inventoryDate: '2026-05-30',
      inventoryDateConfirmed: 1,
      status: 'approved',
      approvedAt: new Date(Date.UTC(2026, 5, 1)),
      targetStoreId: ID.storeB,
      sourcePropertyBindingId: ID.bindingB,
      sourcePropertyId: ID.propertyB,
    },
  ]);
  await db.insert(inventoryCounts).values([
    {
      id: ID.count,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 4, 31)),
      userId: ID.admin,
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.batch,
      sourceInventoryDate: '2026-05-31',
    },
    {
      id: ID.foreignCount,
      companyId: ID.company,
      storeId: ID.storeB,
      countDate: new Date(Date.UTC(2026, 4, 30)),
      userId: ID.admin,
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.foreignBatch,
      sourceInventoryDate: '2026-05-30',
    },
    {
      id: ID.legacyCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date(Date.UTC(2026, 3, 30)),
      userId: ID.admin,
      applied: 1,
      sourceSystem: 'ORDERLY',
      sourceBatchId: ID.legacyBatch,
      sourceInventoryDate: '2026-04-30',
    },
  ]);
});

async function resetFixture(): Promise<void> {
  await db.delete(inventoryItemRemediationAudit).where(eq(inventoryItemRemediationAudit.companyId, ID.company));
  await db
    .delete(inventoryImportRows)
    .where(inArray(inventoryImportRows.batchId, [ID.batch, ID.legacyBatch, ID.foreignBatch]));
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
  await db.delete(inventoryCountLines).where(eq(inventoryCountLines.storageLocationId, ID.storageA)).catch(() => {});
  await db.delete(inventoryCounts).where(eq(inventoryCounts.companyId, ID.company)).catch(() => {});
  await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.companyId, ID.company)).catch(() => {});
  await db.delete(storageLocations).where(eq(storageLocations.companyId, ID.company)).catch(() => {});
  await db
    .delete(importSourcePropertyBindings)
    .where(eq(importSourcePropertyBindings.companyId, ID.company))
    .catch(() => {});
  await db.delete(users).where(eq(users.id, ID.admin)).catch(() => {});
  await db.delete(companyStores).where(eq(companyStores.companyId, ID.company)).catch(() => {});
  await db
    .delete(companiesTable)
    .where(inArray(companiesTable.id, [ID.company, ID.otherCompany]))
    .catch(() => {});
});

const maybe = SKIP ? describe.skip : describe;

maybe('manifest-aware scope preflight', () => {
  it('passes a manifest whose groups are all in scope', async () => {
    const groups = [await makeCleanGroup(`${RUN}-c1`), await makeCleanGroup(`${RUN}-c2`)];

    const evaluation = await preflightManifestScope(scope, groups, db);

    expect(evaluation.totalGroups).toBe(2);
    expect(evaluation.blockedGroups).toBe(0);
    expect(evaluation.cleanGroups).toBe(2);
    expect(evaluation.groups.every(group => group.inScope)).toBe(true);
  });

  /**
   * THE regression for the production incident. A single bad group anywhere in
   * the manifest must fail the WHOLE manifest before mutation, not be
   * discovered when APPLY happens to reach it.
   */
  it('fails the entire manifest when any single group is blocked', async () => {
    const clean = await makeCleanGroup(`${RUN}-ok`);
    const code = `${RUN}-bad`;
    const canonical = await makeItem('bad canonical', {
      mapping: { code },
      scopedImportRow: code,
    });
    // The exact production shape: a sibling carrying another property's mapping.
    const duplicate = await makeItem('bad duplicate', {
      mapping: { code: `${code}-other`, sourcePropertyId: ID.propertyB },
      scopedImportRow: code,
    });
    const blocked: ManifestGroupItems = {
      sourceExternalId: code,
      canonicalItemId: canonical,
      supersededItemIds: [duplicate],
    };

    await expect(preflightManifestScope(scope, [clean, blocked], db)).rejects.toBeInstanceOf(
      RemediationManifestBlockedError,
    );
  });

  /**
   * Blocked groups must be enumerated COMPLETELY. Stopping at the first failure
   * is what turns one blocked manifest into a sequence of failed production
   * runs, each discovering the next blocker.
   */
  it('enumerates every blocked group and every blocker within a group', async () => {
    const clean = await makeCleanGroup(`${RUN}-clean`);

    const codeA = `${RUN}-blockA`;
    const canonicalA = await makeItem('A canonical', { mapping: { code: codeA }, scopedImportRow: codeA });
    const dupeA = await makeItem('A duplicate', {
      mapping: { code: `${codeA}-x`, sourcePropertyId: ID.propertyB },
      scopedImportRow: codeA,
    });

    const codeB = `${RUN}-blockB`;
    const canonicalB = await makeItem('B canonical', { mapping: { code: codeB }, scopedImportRow: codeB });
    // Two DIFFERENT blocker kinds on one group: a foreign mapping, a foreign
    // store row, and an out-of-scope import row.
    const dupeB = await makeItem('B duplicate', {
      mapping: { code: `${codeB}-x`, sourcePropertyId: ID.propertyB },
      foreignImportRow: codeB,
      otherStoreRow: true,
    });

    const groups: ManifestGroupItems[] = [
      clean,
      { sourceExternalId: codeA, canonicalItemId: canonicalA, supersededItemIds: [dupeA] },
      { sourceExternalId: codeB, canonicalItemId: canonicalB, supersededItemIds: [dupeB] },
    ];

    const evaluation = await evaluateManifestScope(db, scope, groups);

    expect(evaluation.totalGroups).toBe(3);
    expect(evaluation.blockedGroups).toBe(2);
    expect(evaluation.blockers.map(blocker => blocker.sourceExternalId).sort()).toEqual(
      [codeA, codeB].sort(),
    );

    const blockerB = evaluation.blockers.find(blocker => blocker.sourceExternalId === codeB)!;
    const kinds = blockerB.violations.map(violation => violation.kind).sort();
    expect(kinds).toContain('EXTERNAL_MAPPING_OTHER_SOURCE_OR_PROPERTY');
    expect(kinds).toContain('STORE_INVENTORY_OTHER_STORE');
    expect(kinds).toContain('IMPORT_ROWS_OUTSIDE_SCOPE');
  });

  it('performs zero writes while evaluating a blocked manifest', async () => {
    const code = `${RUN}-nowrite`;
    const canonical = await makeItem('nowrite canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('nowrite duplicate', {
      mapping: { code: `${code}-x`, sourcePropertyId: ID.propertyB },
      scopedImportRow: code,
    });
    const groups: ManifestGroupItems[] = [
      { sourceExternalId: code, canonicalItemId: canonical, supersededItemIds: [duplicate] },
    ];

    const before = await snapshotMutableState();
    await expect(preflightManifestScope(scope, groups, db)).rejects.toBeInstanceOf(
      RemediationManifestBlockedError,
    );
    const after = await snapshotMutableState();

    expect(after).toEqual(before);
  });

  it('refuses a manifest with no approved groups rather than reporting success', async () => {
    await expect(preflightManifestScope(scope, [], db)).rejects.toThrow(/no approved groups/i);
  });
});

/**
 * Preflight and APPLY must agree, because they are the same function. These
 * assert the semantics rather than the call site, so a future refactor that
 * reintroduces a second implementation fails here.
 */
maybe('shared validator semantics', () => {
  it('produces the identical decision and stop reason for the same group', async () => {
    const code = `${RUN}-parity`;
    const canonical = await makeItem('parity canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('parity duplicate', {
      mapping: { code: `${code}-x`, sourcePropertyId: ID.propertyB },
      scopedImportRow: code,
    });
    const group: ManifestGroupItems = {
      sourceExternalId: code,
      canonicalItemId: canonical,
      supersededItemIds: [duplicate],
    };

    // The preflight path: evaluated for the whole manifest, up front.
    const manifest = await evaluateManifestScope(db, scope, [group]);
    // The APPLY path: evaluated for one group, at mutation time.
    const single = await evaluateGroupScope(db, scope, group);

    expect(single.inScope).toBe(manifest.groups[0].inScope);
    expect(single.stopReason).toBe(manifest.groups[0].stopReason);
    expect(single.violations.map(violation => violation.kind)).toEqual(
      manifest.groups[0].violations.map(violation => violation.kind),
    );
  });

  it('emits a byte-identical stop reason across repeated evaluations', async () => {
    const code = `${RUN}-determinism`;
    const canonical = await makeItem('determinism canonical', {
      mapping: { code },
      scopedImportRow: code,
    });
    // Several blocker kinds at once — the case where nondeterministic ordering
    // would previously produce a differently worded message for one state.
    const duplicate = await makeItem('determinism duplicate', {
      mapping: { code: `${code}-x`, sourcePropertyId: ID.propertyB },
      foreignImportRow: code,
      otherStoreRow: true,
    });
    const group: ManifestGroupItems = {
      sourceExternalId: code,
      canonicalItemId: canonical,
      supersededItemIds: [duplicate],
    };

    const reasons = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt++) {
      const evaluation = await evaluateGroupScope(db, scope, group);
      reasons.add(evaluation.stopReason!);
    }
    expect(reasons.size).toBe(1);
  });
});

maybe('NULL and empty source-property scope', () => {
  /**
   * A missing property is an unanswered ownership question, so it must block —
   * silently treating it as in-scope is how a foreign property's records would
   * get rewritten under this property's approval.
   */
  it('blocks a mapping whose source property is unset', async () => {
    const code = `${RUN}-null`;
    const canonical = await makeItem('null canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('null duplicate', {
      mapping: { code: `${code}-legacy`, sourcePropertyId: null },
      scopedImportRow: code,
      scopedCountLine: true,
    });

    const evaluation = await evaluateGroupScope(db, scope, {
      sourceExternalId: code,
      canonicalItemId: canonical,
      supersededItemIds: [duplicate],
    });

    expect(evaluation.inScope).toBe(false);
    expect(evaluation.violations.map(violation => violation.kind)).toContain(
      'EXTERNAL_MAPPING_OTHER_SOURCE_OR_PROPERTY',
    );
  });

  /**
   * With positive provenance — all of the item's history inside this scope, and
   * only one property bound to this store — an unset mapping is class A. That
   * is a DIAGNOSIS, not an authorization: it must still block.
   */
  it('classifies an unset mapping with clean in-scope provenance as A, and still blocks it', async () => {
    const code = `${RUN}-nullA`;
    const canonical = await makeItem('nullA canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('nullA duplicate', {
      mapping: { code: `${code}-legacy`, sourcePropertyId: null },
      scopedImportRow: code,
      scopedCountLine: true,
    });

    const evaluation = await evaluateGroupScope(db, scope, {
      sourceExternalId: code,
      canonicalItemId: canonical,
      supersededItemIds: [duplicate],
    });

    const legacy = evaluation.mappings.find(mapping => mapping.sourceExternalId === `${code}-legacy`)!;
    expect(legacy.inScope).toBe(false);
    expect(legacy.classification).toBe('A_LEGACY_MISSING_SCOPE');
    // The whole point: class A does not unblock anything.
    expect(evaluation.inScope).toBe(false);
  });

  /**
   * Without positive provenance, the same NULL is class C. Absence of evidence
   * must not be read as evidence of belonging.
   */
  it('classifies an unset mapping without in-scope provenance as C, not A', async () => {
    const code = `${RUN}-nullC`;
    const canonical = await makeItem('nullC canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('nullC duplicate', {
      mapping: { code: `${code}-legacy`, sourcePropertyId: null },
      // No scoped import row, and history at another store.
      foreignImportRow: code,
      otherStoreRow: true,
    });

    const evaluation = await evaluateGroupScope(db, scope, {
      sourceExternalId: code,
      canonicalItemId: canonical,
      supersededItemIds: [duplicate],
    });

    const legacy = evaluation.mappings.find(mapping => mapping.sourceExternalId === `${code}-legacy`)!;
    expect(legacy.classification).toBe('C_AMBIGUOUS');
    expect(evaluation.inScope).toBe(false);
  });

  it('classifies a mapping bound to a different property as B', async () => {
    const code = `${RUN}-classB`;
    const canonical = await makeItem('classB canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('classB duplicate', {
      mapping: { code: `${code}-x`, sourcePropertyId: ID.propertyB },
      scopedImportRow: code,
    });

    const evaluation = await evaluateGroupScope(db, scope, {
      sourceExternalId: code,
      canonicalItemId: canonical,
      supersededItemIds: [duplicate],
    });

    const foreign = evaluation.mappings.find(mapping => mapping.sourceExternalId === `${code}-x`)!;
    expect(foreign.classification).toBe('B_DEMONSTRABLY_FOREIGN');
    expect(foreign.classificationReason).toContain(ID.propertyB);
  });

  it('classifies a mapping from another source system as B', async () => {
    const code = `${RUN}-classBsys`;
    const canonical = await makeItem('classBsys canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('classBsys duplicate', {
      mapping: { code: `${code}-sysco`, sourceSystem: 'SYSCO' },
      scopedImportRow: code,
    });

    const evaluation = await evaluateGroupScope(db, scope, {
      sourceExternalId: code,
      canonicalItemId: canonical,
      supersededItemIds: [duplicate],
    });

    const foreign = evaluation.mappings.find(mapping => mapping.sourceExternalId === `${code}-sysco`)!;
    expect(foreign.classification).toBe('B_DEMONSTRABLY_FOREIGN');
    expect(foreign.classificationReason).toMatch(/source system/i);
  });
});

maybe('narrow legacy-adoption authorization', () => {
  it('allows a positively proven Class A mapping only under the exact policy binding', async () => {
    const code = `${RUN}-legacy-allow`;
    const canonical = await makeItem('legacy allow canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('legacy allow duplicate', {
      mapping: { code: `${code}-legacy`, sourcePropertyId: null },
      scopedImportRow: code,
      scopedCountLine: true,
    });
    const group = { sourceExternalId: code, canonicalItemId: canonical, supersededItemIds: [duplicate] };

    const evaluation = await preflightManifestScope(scope, [group], db, {
      legacyAdoptionAuthorization: legacyAuthorization(1),
    });

    expect(evaluation.cleanGroups).toBe(1);
    const mapping = evaluation.groups[0].mappings.find(
      candidate => candidate.sourceExternalId === `${code}-legacy`,
    )!;
    expect(mapping.classification).toBe('A_LEGACY_MISSING_SCOPE');
    expect(mapping.authorizedByLegacyAdoptionPolicy).toBe(true);
    expect(mapping.inScope).toBe(true);
  });

  it('keeps arbitrary missing scope blocked when its binding is not exact', async () => {
    const code = `${RUN}-legacy-binding-mismatch`;
    const canonical = await makeItem('binding mismatch canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('binding mismatch duplicate', {
      mapping: { code: `${code}-legacy`, sourcePropertyId: null },
      scopedImportRow: code,
      scopedCountLine: true,
    });
    const authorization = legacyAuthorization(1);
    authorization.reportHash = 'not-the-reviewed-report';

    const evaluation = await evaluateManifestScope(db, scope, [
      { sourceExternalId: code, canonicalItemId: canonical, supersededItemIds: [duplicate] },
    ], { legacyAdoptionAuthorization: authorization });

    expect(evaluation.blockedGroups).toBe(1);
    expect(evaluation.groups[0].mappings.some(mapping => mapping.classification === 'A_LEGACY_MISSING_SCOPE')).toBe(
      true,
    );
    expect(evaluation.groups[0].mappings.some(mapping => mapping.authorizedByLegacyAdoptionPolicy)).toBe(false);
  });

  it('keeps Class B foreign-property and foreign-source mappings blocked under the policy', async () => {
    const propertyCode = `${RUN}-legacy-B-property`;
    const propertyCanonical = await makeItem('B property canonical', {
      mapping: { code: propertyCode },
      scopedImportRow: propertyCode,
    });
    const propertyDuplicate = await makeItem('B property duplicate', {
      mapping: { code: `${propertyCode}-foreign`, sourcePropertyId: ID.propertyB },
      scopedImportRow: propertyCode,
    });
    const sourceCode = `${RUN}-legacy-B-source`;
    const sourceCanonical = await makeItem('B source canonical', { mapping: { code: sourceCode }, scopedImportRow: sourceCode });
    const sourceDuplicate = await makeItem('B source duplicate', {
      mapping: { code: `${sourceCode}-foreign`, sourceSystem: 'SYSCO' },
      scopedImportRow: sourceCode,
    });
    const groups = [
      { sourceExternalId: propertyCode, canonicalItemId: propertyCanonical, supersededItemIds: [propertyDuplicate] },
      { sourceExternalId: sourceCode, canonicalItemId: sourceCanonical, supersededItemIds: [sourceDuplicate] },
    ];

    const evaluation = await evaluateManifestScope(db, scope, groups, {
      legacyAdoptionAuthorization: legacyAuthorization(2),
    });

    expect(evaluation.blockedGroups).toBe(2);
    expect(evaluation.groups.flatMap(group => group.mappings).every(
      mapping => mapping.classification !== 'B_DEMONSTRABLY_FOREIGN' || !mapping.inScope,
    )).toBe(true);
  });

  it('keeps Class C and mixed A+B / A+C groups blocked under the policy', async () => {
    const codeB = `${RUN}-legacy-mixed-B`;
    const canonicalB = await makeItem('mixed B canonical', { mapping: { code: codeB }, scopedImportRow: codeB });
    const classA = await makeItem('mixed B class A', {
      mapping: { code: `${codeB}-legacy`, sourcePropertyId: null },
      scopedImportRow: codeB,
      scopedCountLine: true,
    });
    const classB = await makeItem('mixed B class B', {
      mapping: { code: `${codeB}-foreign`, sourcePropertyId: ID.propertyB },
      scopedImportRow: codeB,
    });
    const codeC = `${RUN}-legacy-mixed-C`;
    const canonicalC = await makeItem('mixed C canonical', { mapping: { code: codeC }, scopedImportRow: codeC });
    const classA2 = await makeItem('mixed C class A', {
      mapping: { code: `${codeC}-legacy`, sourcePropertyId: null },
      scopedImportRow: codeC,
      scopedCountLine: true,
    });
    const classC = await makeItem('mixed C class C', {
      mapping: { code: `${codeC}-unknown`, sourcePropertyId: null },
      foreignImportRow: codeC,
      otherStoreRow: true,
    });
    const groups = [
      { sourceExternalId: codeB, canonicalItemId: canonicalB, supersededItemIds: [classA, classB] },
      { sourceExternalId: codeC, canonicalItemId: canonicalC, supersededItemIds: [classA2, classC] },
    ];

    const evaluation = await evaluateManifestScope(db, scope, groups, {
      legacyAdoptionAuthorization: legacyAuthorization(2),
    });

    expect(evaluation.blockedGroups).toBe(2);
    expect(evaluation.groups[0].mappings.some(mapping => mapping.classification === 'B_DEMONSTRABLY_FOREIGN')).toBe(true);
    expect(evaluation.groups[1].mappings.some(mapping => mapping.classification === 'C_AMBIGUOUS')).toBe(true);
  });

  it('gives preflight and the APPLY adapter the same legacy-adoption result', async () => {
    const code = `${RUN}-legacy-parity`;
    const canonical = await makeItem('legacy parity canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('legacy parity duplicate', {
      mapping: { code: `${code}-legacy`, sourcePropertyId: null },
      scopedImportRow: code,
      scopedCountLine: true,
    });
    const authorization = legacyAuthorization(1);
    const manifest = await evaluateManifestScope(db, scope, [
      { sourceExternalId: code, canonicalItemId: canonical, supersededItemIds: [duplicate] },
    ], { legacyAdoptionAuthorization: authorization });

    await expect(
      assertGroupExclusiveToScope(
        db,
        scope,
        [canonical, duplicate],
        code,
        authorization,
      ),
    ).resolves.toBeUndefined();
    expect(manifest.groups[0].inScope).toBe(true);
  });
});

maybe('tenant and scope isolation', () => {
  it('does not consider another store’s batches in scope', async () => {
    const resolution = await resolveScopedBatches(scope, db);
    const ids = resolution.batches.map(batch => batch.id);
    expect(ids).toContain(ID.batch);
    expect(ids).not.toContain(ID.foreignBatch);
  });

  it('blocks a group whose count history lives in another store’s session', async () => {
    const code = `${RUN}-foreigncount`;
    const canonical = await makeItem('foreigncount canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('foreigncount duplicate', { scopedImportRow: code });
    // A count line in the OTHER store's session. Repointing moves count lines
    // by item id, so without this check one property's approval could rewrite
    // another store's history.
    await db.insert(inventoryCountLines).values({
      inventoryCountId: ID.foreignCount,
      inventoryItemId: duplicate,
      storageLocationId: ID.storageA,
      qty: 5,
      unitId: eachUnit,
      unitCost: 10,
      userId: ID.admin,
    });

    const evaluation = await evaluateGroupScope(db, scope, {
      sourceExternalId: code,
      canonicalItemId: canonical,
      supersededItemIds: [duplicate],
    });

    expect(evaluation.inScope).toBe(false);
    expect(evaluation.violations.map(violation => violation.kind)).toContain(
      'COUNT_LINES_OUTSIDE_SCOPE',
    );
  });
});

/**
 * The forensic report is the PM-required deliverable an operator actually reads
 * to decide what to do about a blocked manifest. Its per-group evidence comes
 * from the shared validator (covered above), but its AGGREGATION — the summary
 * counts and distributions — is its own logic, and a miscount there would
 * misrepresent the size of the problem without failing anything else.
 */
maybe('forensic report', () => {
  it('reports complete summary counts and distributions over the whole manifest', async () => {
    const clean = await makeCleanGroup(`${RUN}-fr-clean`);

    // One group whose only problem is a foreign property → class B.
    const codeB = `${RUN}-fr-b`;
    const canonicalB = await makeItem('fr B canonical', { mapping: { code: codeB }, scopedImportRow: codeB });
    const dupeB = await makeItem('fr B duplicate', {
      mapping: { code: `${codeB}-x`, sourcePropertyId: ID.propertyB },
      scopedImportRow: codeB,
    });

    // One group whose only problem is an unset property with clean provenance → class A.
    const codeA = `${RUN}-fr-a`;
    const canonicalA = await makeItem('fr A canonical', { mapping: { code: codeA }, scopedImportRow: codeA });
    const dupeA = await makeItem('fr A duplicate', {
      mapping: { code: `${codeA}-legacy`, sourcePropertyId: null },
      scopedImportRow: codeA,
      scopedCountLine: true,
    });

    const groups: ManifestGroupItems[] = [
      clean,
      { sourceExternalId: codeB, canonicalItemId: canonicalB, supersededItemIds: [dupeB] },
      { sourceExternalId: codeA, canonicalItemId: canonicalA, supersededItemIds: [dupeA] },
    ];

    const report = await buildForensicReport(
      {
        manifestId: `fr-manifest-${RUN}`,
        scope,
        reportHash: 'hash',
        unapprovedReportHash: 'unapproved',
        reportVersion: '1',
        groups,
      },
      db,
    );

    expect(report.totals.totalGroups).toBe(3);
    expect(report.totals.cleanGroups).toBe(1);
    expect(report.totals.blockedGroups).toBe(2);
    expect(report.totals.groupsWithClassA).toBe(1);
    expect(report.totals.groupsWithClassB).toBe(1);
    expect(report.totals.groupsWithClassC).toBe(0);

    // 5 mappings staged across the three groups; 2 of them are problematic.
    expect(report.totals.totalMappingsInspected).toBe(5);
    expect(report.totals.problematicMappings).toBe(2);
    expect(report.mappingClassDistribution.A_LEGACY_MISSING_SCOPE).toBe(1);
    expect(report.mappingClassDistribution.B_DEMONSTRABLY_FOREIGN).toBe(1);
    expect(report.mappingClassDistribution.C_AMBIGUOUS).toBe(0);

    expect(report.affectedSourceExternalIds).toEqual([codeA, codeB].sort());
    expect(report.blockerKindDistribution.EXTERNAL_MAPPING_OTHER_SOURCE_OR_PROPERTY).toBe(2);

    // Clean groups must still be present — the report is the full picture, not
    // just the failures.
    expect(report.groups).toHaveLength(3);
    const cleanReported = report.groups.find(
      group => group.sourceExternalId === clean.sourceExternalId,
    )!;
    expect(cleanReported.inScope).toBe(true);
    expect(cleanReported.blockerReason).toBeNull();
  });

  it('reports every PM-required field for a blocked group', async () => {
    const code = `${RUN}-fr-fields`;
    const canonical = await makeItem('fr fields canonical', {
      mapping: { code },
      scopedImportRow: code,
    });
    const duplicate = await makeItem('fr fields duplicate', {
      mapping: { code: `${code}-x`, sourcePropertyId: ID.propertyB },
      scopedImportRow: code,
    });

    const report = await buildForensicReport(
      {
        manifestId: `fr-fields-${RUN}`,
        scope,
        reportHash: 'hash',
        unapprovedReportHash: 'unapproved',
        reportVersion: '1',
        groups: [{ sourceExternalId: code, canonicalItemId: canonical, supersededItemIds: [duplicate] }],
      },
      db,
    );

    const group = report.groups[0];
    expect(group.sourceExternalId).toBe(code);
    expect(group.proposedCanonicalItemId).toBe(canonical);
    expect(group.siblingItemIds).toEqual([duplicate]);
    expect(group.inScope).toBe(false);
    expect(group.blockerReason).toContain('OUT_OF_SCOPE_REFERENCE');

    const foreign = group.mappings.find(mapping => mapping.sourceExternalId === `${code}-x`)!;
    expect(foreign.ownerInventoryItemId).toBe(duplicate);
    expect(foreign.sourceSystem).toBe('ORDERLY');
    expect(foreign.sourcePropertyId).toBe(ID.propertyB);
    expect(foreign.classification).toBe('B_DEMONSTRABLY_FOREIGN');
    expect(foreign.classificationReason).toBeTruthy();

    // Provenance for every item in the group, and the scope fields.
    expect(group.provenance.map(item => item.itemId).sort()).toEqual([canonical, duplicate].sort());
    expect(report.scope.companyId).toBe(ID.company);
    expect(report.scope.storeId).toBe(ID.store);
    expect(report.scope.sourcePropertyId).toBe(ID.property);

    // Offending-row samples are collected so an operator can go look at them.
    const violation = group.violations.find(
      item => item.kind === 'EXTERNAL_MAPPING_OTHER_SOURCE_OR_PROPERTY',
    )!;
    expect(violation.sampleIds.length).toBeGreaterThan(0);
  });

  it('renders a byte-identical report for unchanged data', async () => {
    const code = `${RUN}-fr-determinism`;
    const canonical = await makeItem('fr det canonical', { mapping: { code }, scopedImportRow: code });
    const duplicate = await makeItem('fr det duplicate', {
      mapping: { code: `${code}-x`, sourcePropertyId: ID.propertyB },
      foreignImportRow: code,
      otherStoreRow: true,
    });
    const input = {
      manifestId: `fr-det-${RUN}`,
      scope,
      reportHash: 'hash',
      unapprovedReportHash: 'unapproved',
      reportVersion: '1',
      groups: [{ sourceExternalId: code, canonicalItemId: canonical, supersededItemIds: [duplicate] }],
    };

    const rendered = new Set<string>();
    for (let attempt = 0; attempt < 3; attempt++) {
      rendered.add(formatForensicReport(await buildForensicReport(input, db)));
    }
    expect(rendered.size).toBe(1);
  });
});

maybe('suspended-run verification', () => {
  it('reports mutation-free when a manifest recorded only stops', async () => {
    const group = await makeCleanGroup(`${RUN}-suspended`);
    const manifestId = `sv-manifest-${RUN}`;

    await db.insert(inventoryItemRemediationAudit).values({
      companyId: ID.company,
      storeId: ID.store,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property,
      sourceExternalId: group.sourceExternalId,
      manifestId,
      reportHash: 'hash',
      reportVersion: '1',
      canonicalItemId: group.canonicalItemId,
      canonicalSelectionReason: 'test',
      supersededItemIds: group.supersededItemIds,
      classification: 'SAFE_CANDIDATE',
      result: 'stopped',
      failureReason: 'OUT_OF_SCOPE_REFERENCE: external mappings for another property (1)',
      referencesMoved: {},
      evidence: {},
      operatorId: ID.admin,
    });

    const verification = await verifySuspendedRunMutationFree(scope, manifestId, [group], db);

    expect(verification.auditCounts).toEqual({ applied: 0, alreadyRemediated: 0, stopped: 1 });
    expect(verification.mutationFree).toBe(true);
    expect(verification.supersededItemIds).toEqual([]);
    expect(verification.stoppedSourceExternalIds).toEqual([group.sourceExternalId]);
  });

  it('reports NOT mutation-free when an item named by the manifest is superseded', async () => {
    const group = await makeCleanGroup(`${RUN}-mutated`);
    const manifestId = `sv-manifest-mutated-${RUN}`;

    await db
      .update(inventoryItems)
      .set({ supersededByItemId: group.canonicalItemId, supersededAt: new Date() })
      .where(eq(inventoryItems.id, group.supersededItemIds[0]));

    const verification = await verifySuspendedRunMutationFree(scope, manifestId, [group], db);

    expect(verification.mutationFree).toBe(false);
    expect(verification.unexpectedlySupersededItemIds).toContain(group.supersededItemIds[0]);
  });

  /**
   * The verification is bounded to one manifest id. Another manifest's audit
   * rows must not contaminate the answer — otherwise "did THIS run mutate
   * anything" silently becomes "has anything ever been remediated here".
   */
  it('ignores audit rows belonging to a different manifest', async () => {
    const group = await makeCleanGroup(`${RUN}-bounded`);
    const otherManifest = `sv-manifest-other-${RUN}`;

    await db.insert(inventoryItemRemediationAudit).values({
      companyId: ID.company,
      storeId: ID.store,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property,
      sourceExternalId: group.sourceExternalId,
      manifestId: otherManifest,
      reportHash: 'hash',
      reportVersion: '1',
      canonicalItemId: group.canonicalItemId,
      canonicalSelectionReason: 'test',
      supersededItemIds: group.supersededItemIds,
      classification: 'SAFE_CANDIDATE',
      result: 'applied',
      failureReason: null,
      referencesMoved: {},
      evidence: {},
      operatorId: ID.admin,
    });

    const verification = await verifySuspendedRunMutationFree(
      scope,
      `sv-manifest-under-test-${RUN}`,
      [group],
      db,
    );

    expect(verification.auditCounts).toEqual({ applied: 0, alreadyRemediated: 0, stopped: 0 });
  });
});

/**
 * Snapshot of everything remediation is capable of changing, for the
 * zero-writes assertion. Deliberately covers supersession, mappings, count
 * lines and audit rows rather than a single table — a preflight that wrote to
 * any one of them would be a mutation.
 */
async function snapshotMutableState(): Promise<unknown> {
  const [items, mappings, countLines, audit] = await Promise.all([
    db
      .select({
        id: inventoryItems.id,
        active: inventoryItems.active,
        superseded: inventoryItems.supersededByItemId,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.companyId, ID.company))
      .orderBy(inventoryItems.id),
    db
      .select({
        id: inventoryItemExternalMappings.id,
        itemId: inventoryItemExternalMappings.inventoryItemId,
        property: inventoryItemExternalMappings.sourcePropertyId,
      })
      .from(inventoryItemExternalMappings)
      .where(eq(inventoryItemExternalMappings.companyId, ID.company))
      .orderBy(inventoryItemExternalMappings.id),
    db
      .select({ id: inventoryCountLines.id, itemId: inventoryCountLines.inventoryItemId })
      .from(inventoryCountLines)
      .innerJoin(inventoryCounts, eq(inventoryCounts.id, inventoryCountLines.inventoryCountId))
      .where(eq(inventoryCounts.companyId, ID.company))
      .orderBy(inventoryCountLines.id),
    db
      .select({ n: sql<number>`count(*)` })
      .from(inventoryItemRemediationAudit)
      .where(eq(inventoryItemRemediationAudit.companyId, ID.company)),
  ]);
  return { items, mappings, countLines, audit };
}
