/**
 * PM directive (#1158 follow-up): measure WHY applyRemediationManifest costs
 * ~105 s/group in production before changing anything.
 *
 * Seeds a synthetic company/scope shaped like the Bay Hill Batch 1 manifest
 * (848 groups, ~1,900 superseded identities, ~1,259 count-line repoints,
 * ~932 legacy location mappings, multi-location assignment unions), then:
 *   1. times one full buildRemediationReport (the whole-scope discovery pass),
 *   2. times APPLY with k=1 and k=3 group manifests,
 *   3. logs every SQL statement (table + wall time) so the per-group
 *      transaction segments can be attributed.
 *
 * READ-ONLY toward real data: everything is created under a fresh synthetic
 * companyId and deleted afterwards. Never run against production.
 *
 * Usage: pnpm exec tsx scripts/benchmarkRemediationApply.ts [--groups 848] [--apply 3]
 */
import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';

// ── Query instrumentation: patch the driver client before anything uses it ──
type QueryLogEntry = { at: number; ms: number; table: string; verb: string };
const queryLog: QueryLogEntry[] = [];
let logEnabled = false;

function classify(text: string): { table: string; verb: string } {
  const t = text.replace(/\s+/g, ' ');
  const verb = (t.match(/^\s*(select|insert|update|delete|begin|commit|rollback|set)/i)?.[1] ?? 'other').toLowerCase();
  const m =
    t.match(/from\s+"([a-z_]+)"/i) ??
    t.match(/into\s+"([a-z_]+)"/i) ??
    t.match(/update\s+"([a-z_]+)"/i);
  return { table: m?.[1] ?? (verb === 'begin' || verb === 'commit' ? '(tx)' : '(none)'), verb };
}

async function patchDriver() {
  const neon = await import('@neondatabase/serverless');
  const proto = (neon as any).Client.prototype;
  const original = proto.query;
  proto.query = function (...args: any[]) {
    const first = args[0];
    const text: string = typeof first === 'string' ? first : (first?.text ?? '');
    const start = Date.now();
    const result = original.apply(this, args);
    if (logEnabled && text) {
      const finish = () => {
        const { table, verb } = classify(text);
        queryLog.push({ at: start, ms: Date.now() - start, table, verb });
      };
      if (result?.then) result.then(finish, finish);
      else finish();
    }
    return result;
  };
}

function summarizeLog(entries: QueryLogEntry[]): string {
  const byTable = new Map<string, { n: number; ms: number }>();
  for (const e of entries) {
    const key = `${e.verb} ${e.table}`;
    const agg = byTable.get(key) ?? { n: 0, ms: 0 };
    agg.n += 1;
    agg.ms += e.ms;
    byTable.set(key, agg);
  }
  const rows = [...byTable.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 15);
  const total = entries.reduce((s, e) => s + e.ms, 0);
  return (
    `  queries=${entries.length} totalDbMs=${total}\n` +
    rows.map(([k, v]) => `    ${k}: n=${v.n} ms=${v.ms}`).join('\n')
  );
}

async function main() {
  // Fail-closed environment guard: this script seeds and deletes synthetic
  // tenants. It must never run against a production database.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[bench] refusing to run with NODE_ENV=production');
  }
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (!/neon\.tech|localhost|127\.0\.0\.1/.test(dbUrl)) {
    throw new Error(
      '[bench] DATABASE_URL host is not on the dev allowlist (neon.tech/localhost); refusing to run',
    );
  }

  await patchDriver();

  const { db } = await import('../src/db');
  const schema = await import('@workspace/db');
  const {
    companies, companyStores, users, importSourcePropertyBindings,
    inventoryLocations, storageLocations, inventoryCounts, inventoryImportBatches,
    inventoryImportRows, inventoryItems, inventoryItemExternalMappings,
    inventoryItemLocationAssignments, inventoryItemLocations, inventoryCountLines,
    storeInventoryItems, inventoryItemRemediationAudit, units,
  } = schema as any;
  const svc = await import('../src/services/orderly/orderlyDuplicateRemediation');

  const args = process.argv.slice(2);
  const opt = (name: string, dflt: number) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };
  const GROUPS = opt('groups', 848);
  const APPLY_K = opt('apply', 3);

  const RUN = `bench-${Date.now().toString(36)}`;
  const ID = {
    company: `${RUN}-co`, store: `${RUN}-store`, admin: `${RUN}-admin`,
    binding: `${RUN}-binding`, property: `${RUN}-prop`,
    locA: `${RUN}-loc-a`, locB: `${RUN}-loc-b`,
    storA: `${RUN}-slocA`, storB: `${RUN}-slocB`,
    mayBatch: `${RUN}-batch-may`, juneBatch: `${RUN}-batch-jun`, julyBatch: `${RUN}-batch-jul`,
    mayCount: `${RUN}-count-may`, juneCount: `${RUN}-count-jun`, julyCount: `${RUN}-count-jul`,
  };
  const scope = {
    companyId: ID.company, storeId: ID.store,
    sourceSystem: 'ORDERLY' as const, sourcePropertyId: ID.property,
  };

  const [ea] = await db.select({ id: units.id }).from(units).where(eq(units.abbreviation, 'ea')).limit(1);
  if (!ea) throw new Error('no "ea" unit');
  const eachUnit = ea.id;

  console.log(`[bench] seeding ${GROUPS} groups under synthetic company ${ID.company} ...`);
  const t0 = Date.now();

  await db.insert(companies).values({ id: ID.company, name: `Bench Co ${RUN}` });
  await db.insert(companyStores).values({ id: ID.store, companyId: ID.company, code: RUN.slice(-9), name: 'Bench Bay Hill', status: 'active' });
  await db.insert(users).values({ id: ID.admin, email: `${RUN}@test.local`, role: 'company_admin', companyId: ID.company, active: 1 });
  await db.insert(importSourcePropertyBindings).values({
    id: ID.binding, companyId: ID.company, sourceSystem: 'ORDERLY',
    sourcePropertyId: ID.property, sourcePropertyLabel: 'Bench', destinationStoreId: ID.store, active: 1,
  });
  await db.insert(inventoryLocations).values([
    { id: ID.locA, companyId: ID.company, name: `Cage ${RUN}`, normalizedName: `cage ${RUN}` },
    { id: ID.locB, companyId: ID.company, name: `Cafe ${RUN}`, normalizedName: `cafe ${RUN}` },
  ]);
  await db.insert(storageLocations).values([
    { id: ID.storA, companyId: ID.company, name: `Cage ${RUN}` },
    { id: ID.storB, companyId: ID.company, name: `Cafe ${RUN}` },
  ]);
  await db.insert(inventoryImportBatches).values([
    {
      id: ID.mayBatch, companyId: ID.company, sourceSystem: 'ORDERLY', fileHash: `h-may-${RUN}`,
      originalFilename: 'may.xlsx', parserVersion: '1.0', inventoryDate: '2026-05-31',
      inventoryDateConfirmed: 1, status: 'approved', approvedAt: new Date(Date.UTC(2026, 5, 1)),
      targetStoreId: ID.store, sourcePropertyBindingId: ID.binding, sourcePropertyId: ID.property,
    },
    {
      id: ID.juneBatch, companyId: ID.company, sourceSystem: 'ORDERLY', fileHash: `h-jun-${RUN}`,
      originalFilename: 'june.xlsx', parserVersion: '1.0', inventoryDate: '2026-06-30',
      inventoryDateConfirmed: 1, status: 'approved', approvedAt: new Date(Date.UTC(2026, 6, 1)),
      targetStoreId: ID.store, sourcePropertyBindingId: ID.binding, sourcePropertyId: ID.property,
    },
    {
      id: ID.julyBatch, companyId: ID.company, sourceSystem: 'ORDERLY', fileHash: `h-jul-${RUN}`,
      originalFilename: 'july.xlsx', parserVersion: '1.0', inventoryDate: '2026-07-31',
      inventoryDateConfirmed: 1, status: 'approved', approvedAt: new Date(Date.UTC(2026, 7, 1)),
      targetStoreId: ID.store, sourcePropertyBindingId: ID.binding, sourcePropertyId: ID.property,
    },
  ]);
  await db.insert(inventoryCounts).values([
    {
      id: ID.mayCount, companyId: ID.company, storeId: ID.store, countDate: new Date(Date.UTC(2026, 4, 31)),
      userId: ID.admin, name: 'May', applied: 1, sourceSystem: 'ORDERLY', sourceBatchId: ID.mayBatch, sourceInventoryDate: '2026-05-31',
    },
    {
      id: ID.juneCount, companyId: ID.company, storeId: ID.store, countDate: new Date(Date.UTC(2026, 5, 30)),
      userId: ID.admin, name: 'June', applied: 1, sourceSystem: 'ORDERLY', sourceBatchId: ID.juneBatch, sourceInventoryDate: '2026-06-30',
    },
    {
      id: ID.julyCount, companyId: ID.company, storeId: ID.store, countDate: new Date(Date.UTC(2026, 6, 31)),
      userId: ID.admin, name: 'July', applied: 1, sourceSystem: 'ORDERLY', sourceBatchId: ID.julyBatch, sourceInventoryDate: '2026-07-31',
    },
  ]);

  // Shape: first 204 groups carry 3 duplicates, the rest 2 → 1,900 superseded
  // identities at 848 groups. ~1,259 dup count lines; ~932 legacy location rows.
  const itemValues: any[] = [];
  const groupSpecs: Array<{ code: string; canonicalIdx: number; dupIdx: number[] }> = [];
  let itemIdx = 0;
  for (let g = 0; g < GROUPS; g++) {
    const dups = g < Math.round(GROUPS * 0.24) ? 3 : 2;
    const canonicalIdx = itemIdx++;
    const dupIdx: number[] = [];
    for (let d = 0; d < dups; d++) dupIdx.push(itemIdx++);
    groupSpecs.push({ code: `BENCH-${RUN}-${String(g).padStart(4, '0')}`, canonicalIdx, dupIdx });
    for (let c = 0; c < 1 + dups; c++) {
      itemValues.push({
        companyId: ID.company, name: `Bench Item G${g}`, unitId: eachUnit,
        caseSize: 6, pricePerUnit: 25, avgCostPerUnit: 25, active: 1, yieldPercent: 100,
      });
    }
  }
  const itemIds: string[] = [];
  for (let i = 0; i < itemValues.length; i += 400) {
    const inserted = await db.insert(inventoryItems).values(itemValues.slice(i, i + 400)).returning({ id: inventoryItems.id });
    for (const row of inserted) itemIds.push(row.id);
  }

  const mappingValues: any[] = [];
  const importRowValues: any[] = [];
  const storeRowValues: any[] = [];
  const assignValues: any[] = [];
  const legacyLocValues: any[] = [];
  const countLineValues: any[] = [];
  let dupCountLines = 0;
  let legacyRows = 0;
  let rowIndex = 0;
  for (const spec of groupSpecs) {
    const canonical = itemIds[spec.canonicalIdx];
    mappingValues.push({
      companyId: ID.company, inventoryItemId: canonical, sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property, sourceExternalId: spec.code,
      sourceDescription: 'Bench', matchStrategy: 'code', confidenceScore: 1,
    });
    storeRowValues.push({ companyId: ID.company, storeId: ID.store, inventoryItemId: canonical, onHandQty: 4, active: 1 });
    assignValues.push({ companyId: ID.company, inventoryItemId: canonical, locationId: ID.locA, isPrimary: 0, active: 1 });
    importRowValues.push({
      batchId: ID.mayBatch, rowIndex: rowIndex++, sheetName: 'Inventory Detail',
      rawData: { code: spec.code }, rawDescription: 'Bench Bottle', cleanedDescription: 'Bench Bottle',
      caseQuantity: 6, baseUnit: 'ML', packagePrice: 30, totalCost: 30, sourceItemCode: spec.code,
      itemCodeStatus: 'valid', supplierStatus: 'blank', storageLocation: 'Cage',
      rowStatus: 'matched_existing', resolvedInventoryItemId: canonical,
    });
    countLineValues.push({
      inventoryCountId: ID.mayCount, inventoryItemId: canonical, storageLocationId: ID.storA,
      qty: 3, unitId: eachUnit, unitCost: 25, userId: ID.admin,
    });
    for (const [d, di] of spec.dupIdx.entries()) {
      const dup = itemIds[di];
      // Multi-location union: dup lives in the OTHER location.
      assignValues.push({ companyId: ID.company, inventoryItemId: dup, locationId: ID.locB, isPrimary: 0, active: 1 });
      importRowValues.push({
        batchId: ID.juneBatch, rowIndex: rowIndex++, sheetName: 'Inventory Detail',
        rawData: { code: spec.code }, rawDescription: 'Bench Bottle', cleanedDescription: 'Bench Bottle',
        caseQuantity: 6, baseUnit: 'ML', packagePrice: 30, totalCost: 30, sourceItemCode: spec.code,
        itemCodeStatus: 'valid', supplierStatus: 'blank', storageLocation: 'Cafe',
        rowStatus: 'matched_existing', resolvedInventoryItemId: dup,
      });
      if (d < 2 && dupCountLines < Math.round(GROUPS * 1.485)) {
        dupCountLines++;
        countLineValues.push({
          inventoryCountId: d === 0 ? ID.juneCount : ID.julyCount, inventoryItemId: dup, storageLocationId: ID.storB,
          qty: 2, unitId: eachUnit, unitCost: 25, userId: ID.admin,
        });
      }
      if (legacyRows < Math.round(GROUPS * 1.1)) {
        legacyRows++;
        legacyLocValues.push({ inventoryItemId: dup, storageLocationId: ID.storB, isPrimary: 0 });
      }
    }
  }
  const chunkedInsert = async (table: any, values: any[]) => {
    for (let i = 0; i < values.length; i += 500) await db.insert(table).values(values.slice(i, i + 500));
  };
  await chunkedInsert(inventoryItemExternalMappings, mappingValues);
  await chunkedInsert(storeInventoryItems, storeRowValues);
  await chunkedInsert(inventoryItemLocationAssignments, assignValues);
  await chunkedInsert(inventoryImportRows, importRowValues);
  await chunkedInsert(inventoryCountLines, countLineValues);
  await chunkedInsert(inventoryItemLocations, legacyLocValues);
  console.log(
    `[bench] seeded in ${Date.now() - t0} ms: items=${itemIds.length} dups=${itemIds.length - GROUPS} ` +
    `dupCountLines=${dupCountLines} legacyLocRows=${legacyRows}`,
  );

  const cleanup = async () => {
    console.log('[bench] cleaning up ...');
    const ids = itemIds;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await db.delete(inventoryCountLines).where(inArray(inventoryCountLines.inventoryItemId, chunk));
      await db.delete(inventoryItemLocations).where(inArray(inventoryItemLocations.inventoryItemId, chunk));
      await db.delete(inventoryItemLocationAssignments).where(inArray(inventoryItemLocationAssignments.inventoryItemId, chunk));
      await db.delete(storeInventoryItems).where(inArray(storeInventoryItems.inventoryItemId, chunk));
      await db.delete(inventoryItemExternalMappings).where(inArray(inventoryItemExternalMappings.inventoryItemId, chunk));
      await db.delete(inventoryImportRows).where(inArray(inventoryImportRows.resolvedInventoryItemId, chunk));
    }
    await db.delete(inventoryItemRemediationAudit).where(eq(inventoryItemRemediationAudit.companyId, ID.company));
    await db.delete(inventoryCounts).where(eq(inventoryCounts.companyId, ID.company));
    await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.companyId, ID.company));
    for (let i = 0; i < ids.length; i += 500) {
      await db.delete(inventoryItems).where(inArray(inventoryItems.id, ids.slice(i, i + 500)));
    }
    await db.delete(storageLocations).where(eq(storageLocations.companyId, ID.company));
    await db.delete(inventoryLocations).where(eq(inventoryLocations.companyId, ID.company));
    await db.delete(importSourcePropertyBindings).where(eq(importSourcePropertyBindings.companyId, ID.company));
    await db.delete(users).where(eq(users.id, ID.admin));
    await db.delete(companyStores).where(eq(companyStores.companyId, ID.company));
    await db.delete(companies).where(eq(companies.id, ID.company));
    console.log('[bench] cleanup done');
  };

  const heartbeat = setInterval(() => {
    console.log(`[bench] heartbeat: queries so far in current phase = ${queryLog.length}`);
  }, 15000);
  heartbeat.unref();

  try {
    // ── Phase 1: one full discovery report ─────────────────────────────────
    queryLog.length = 0; logEnabled = true;
    let t = Date.now();
    const report = await svc.buildRemediationReport(scope, db);
    const reportMs = Date.now() - t;
    logEnabled = false;
    console.log(`\n[bench] buildRemediationReport (full scope): ${reportMs} ms, groups=${report.totals.groupsExamined} safe=${report.totals.safeCandidates}`);
    console.log(summarizeLog(queryLog));

    const safeCodes = report.groups
      .filter((g: any) => g.classification === 'SAFE_CANDIDATE')
      .map((g: any) => g.sourceExternalId);
    if (safeCodes.length !== GROUPS) {
      console.log(`[bench] WARNING expected ${GROUPS} safe groups, got ${safeCodes.length}`);
      const bad = report.groups.find((g: any) => g.classification !== 'SAFE_CANDIDATE');
      if (bad) console.log('[bench] first non-safe group:', JSON.stringify({ code: bad.sourceExternalId, cls: bad.classification, conflicts: bad.evidence.conflictReasons, ambig: bad.evidence.ambiguityReasons }));
    }

    // ── Phase 2: APPLY with k groups ───────────────────────────────────────
    for (const k of [1, APPLY_K]) {
      const manifest = svc.buildApplyManifest(report, safeCodes.slice(0, k), `${RUN}-manifest-k${k}`);
      queryLog.length = 0; logEnabled = true;
      t = Date.now();
      const result = await svc.applyRemediationManifest(manifest, ID.admin, db);
      const ms = Date.now() - t;
      logEnabled = false;
      console.log(`\n[bench] APPLY k=${k}: ${ms} ms total — applied=${result.applied} stopped=${result.stopped}`);
      if (result.stopped > 0) console.log('[bench] stop reasons:', JSON.stringify(result.groups.filter((g: any) => g.result === 'stopped').slice(0, 2)));
      // Transaction segments: queries between each begin/commit pair.
      const txSegments: QueryLogEntry[][] = [];
      let current: QueryLogEntry[] | null = null;
      for (const e of queryLog) {
        if (e.verb === 'begin') current = [];
        else if (e.verb === 'commit' || e.verb === 'rollback') { if (current) txSegments.push(current); current = null; }
        else if (current) current.push(e);
      }
      console.log(`[bench] overall query profile (k=${k}):`);
      console.log(summarizeLog(queryLog));
      txSegments.forEach((seg, i) => {
        console.log(`[bench] tx segment ${i + 1} (per-group transaction):`);
        console.log(summarizeLog(seg));
      });
    }
  } catch (err) {
    console.error('[bench] PHASE FAILED:', err);
    const blockers = (err as any)?.evaluation?.blockers;
    if (blockers) console.error('[bench] blockers detail:', JSON.stringify(blockers, null, 2).slice(0, 3000));
    process.exitCode = 1;
  } finally {
    logEnabled = false;
    await cleanup();
    process.exit(process.exitCode ?? 0);
  }
}

main().catch(err => { console.error('[bench] FAILED:', err); process.exit(1); });
