/**
 * Bay Hill May historical-session backfill.
 *
 * The May Dev session predates the historical-import model, so it holds 2,090
 * resolved count lines and none of the unresolved evidence that makes its
 * valuation reconcile. Until the evidence is attached, the immutability guard is
 * inert on the one real snapshot in the system.
 *
 * This adopts that session into the new model. It is deliberately NOT a flag
 * flip: the flag is written last, only after the evidence links exist and the
 * period reconciles to zero, so a session can never be marked "protected
 * historical import" while its value is still incomplete.
 *
 *   # read-only: prove the population and the arithmetic, write nothing
 *   pnpm --filter @workspace/api-server run orderly:may-backfill -- --mode verify
 *
 *   # link unresolved evidence, re-verify, then set the flag
 *   pnpm --filter @workspace/api-server run orderly:may-backfill -- \
 *     --mode apply --confirm-backfill
 *
 * Scope is hard-locked to the approved May session, batch, company and store.
 * The script refuses to run against anything else, and never writes to
 * inventory_count_lines, inventory_items or on-hand quantities.
 */

// MUST be first: ./db picks its driver from the environment at import time, so a
// standalone entry point that skips this loads an empty environment, selects the
// other driver, and fails on queries the API runs fine.
import 'dotenv/config';

import { eq, inArray, sql } from 'drizzle-orm';
import { db, dbDriverMode } from '../../db';
import {
  historicalSessionUnresolvedRows,
  inventoryCountLines,
  inventoryCounts,
  inventoryImportBatches,
  inventoryImportRows,
} from '@workspace/db';
import { ensureHistoricalSessionUnresolvedRowsSchema } from '../../migrations/historicalSessionUnresolvedRows';
import {
  authoritativeSourceValue,
  hasUsableCountGeometry,
  reconcileHistoricalSnapshot,
  sourceEvidenceHash,
} from './orderlyCountSession';

/** Approved scope. Anything else is refused rather than adapted to. */
const SCOPE = {
  sessionId: '595eb112-20a9-4a3e-9e7b-0a4ab6ac5c43',
  batchId: 'e1fe4dee-2fb4-454e-8fef-1e48bcc75216',
  companyId: '61971215-e3ed-49f3-8afc-6dbe1eef1fcc',
  storeId: '7126a705-64a6-4362-8b62-f08349640442',
  sourcePropertyId: '24472',
  /**
   * The batch's confirmed inventory date is the period-end count date, which the
   * operator confirmed as June 1 — the morning after the May period closed. It is
   * NOT a June dataset, so the date string alone cannot decide scope. The May
   * period is proven positively below from the source evidence instead.
   */
  inventoryDate: '2026-06-01',
  sourceFilename: 'May_2026.xlsx',
  /** Last day of the period being adopted. No source row may postdate this. */
  periodEnd: '2026-05-31',
} as const;

/** PM-stated acceptance figures. The run fails if reality disagrees. */
const EXPECTED = {
  sourceRows: 5358,
  sourceValue: 254286.67,
  unresolvedRows: 1039,
  unresolvedValue: 64636.77,
  resolvedValue: 189649.9,
  historicalTotal: 254286.67,
  countLines: 2090,
  delta: 0,
} as const;

const CENT = 0.005;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * `db.execute` returns a driver QueryResult under neon-serverless and a bare
 * array under node-postgres. Reading the wrong shape silently yields zero rows,
 * which would turn an evidence check into a false negative.
 */
function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function mustEqual(actual: number, expected: number, label: string): void {
  must(
    Math.abs(actual - expected) < CENT,
    `${label}: expected ${expected.toFixed(2)}, observed ${actual.toFixed(2)}`,
  );
}

interface Classification {
  sourceRows: number;
  sourceValue: number;
  unresolved: Array<{ id: string; hash: string; value: number }>;
  unresolvedValue: number;
  resolvedGeoRows: number;
  resolvedGeoValue: number;
  zeroGeoRows: number;
  zeroGeoValue: number;
}

/**
 * Re-derives the resolved/unresolved split with the same functions the importer
 * uses, so the backfill cannot adopt a population the service would classify
 * differently.
 */
async function classifyBatch(): Promise<Classification> {
  const rows = await db
    .select()
    .from(inventoryImportRows)
    // @ts-ignore
    .where(eq(inventoryImportRows.batchId, SCOPE.batchId))
    .orderBy(inventoryImportRows.rowIndex);

  const out: Classification = {
    sourceRows: rows.length,
    sourceValue: 0,
    unresolved: [],
    unresolvedValue: 0,
    resolvedGeoRows: 0,
    resolvedGeoValue: 0,
    zeroGeoRows: 0,
    zeroGeoValue: 0,
  };

  for (const row of rows) {
    // Fails loudly on missing/malformed evidence rather than coercing to zero.
    const value = authoritativeSourceValue(row);
    out.sourceValue += value;

    if (!row.resolvedInventoryItemId) {
      out.unresolved.push({ id: row.id, hash: sourceEvidenceHash(row), value });
      out.unresolvedValue += value;
      continue;
    }
    if (hasUsableCountGeometry(row)) {
      out.resolvedGeoRows++;
      out.resolvedGeoValue += value;
    } else {
      out.zeroGeoRows++;
      out.zeroGeoValue += value;
    }
  }

  out.sourceValue = round2(out.sourceValue);
  out.unresolvedValue = round2(out.unresolvedValue);
  out.resolvedGeoValue = round2(out.resolvedGeoValue);
  out.zeroGeoValue = round2(out.zeroGeoValue);
  return out;
}

/** Resolved valuation as persisted on the session's own count lines. */
async function persistedResolvedTotal(): Promise<{ lines: number; value: number }> {
  const lines = await db
    .select({ qty: inventoryCountLines.qty, unitCost: inventoryCountLines.unitCost })
    .from(inventoryCountLines)
    // @ts-ignore
    .where(eq(inventoryCountLines.inventoryCountId, SCOPE.sessionId));
  const value = lines.reduce(
    (sum: number, l: { qty: number | null; unitCost: number | null }) =>
      sum + round2((l.qty ?? 0) * (l.unitCost ?? 0)),
    0,
  );
  return { lines: lines.length, value: round2(value) };
}

/** A stable fingerprint of every count line, used to prove nothing was rewritten. */
async function countLineChecksum(): Promise<string> {
  const rows = resultRows<{ checksum: string }>(await db.execute(sql`
    SELECT COALESCE(md5(string_agg(id || ':' || qty || ':' || unit_cost, ',' ORDER BY id)), 'empty') AS checksum
    FROM inventory_count_lines
    WHERE inventory_count_id = ${SCOPE.sessionId}
  `));
  must(rows.length === 1, 'Checksum query returned no rows');
  return rows[0].checksum;
}

async function loadSession() {
  const [session] = await db
    .select()
    .from(inventoryCounts)
    // @ts-ignore
    .where(eq(inventoryCounts.id, SCOPE.sessionId));
  must(!!session, `Session ${SCOPE.sessionId} not found`);
  must(session.companyId === SCOPE.companyId, 'Session belongs to a different company');
  must(session.storeId === SCOPE.storeId, 'Session belongs to a different store');
  must(session.sourceBatchId === SCOPE.batchId, 'Session is not sourced from the approved May batch');
  must(session.applied === 0, 'Session is already applied to live on-hand — refusing to adopt it');
  return session;
}

async function loadBatch() {
  const [batch] = await db
    .select()
    .from(inventoryImportBatches)
    // @ts-ignore
    .where(eq(inventoryImportBatches.id, SCOPE.batchId));
  must(!!batch, `Batch ${SCOPE.batchId} not found`);
  must(batch.companyId === SCOPE.companyId, 'Batch belongs to a different company');
  must(batch.sourcePropertyId === SCOPE.sourcePropertyId, 'Batch is not the approved source property');
  must(
    batch.inventoryDate === SCOPE.inventoryDate,
    `Batch inventory date changed (expected ${SCOPE.inventoryDate}, found ${batch.inventoryDate})`,
  );
  must(
    batch.originalFilename === SCOPE.sourceFilename,
    `Batch is not the approved May workbook (${batch.originalFilename})`,
  );
  await assertPeriodEvidence();
  return batch;
}

/**
 * Proves this batch is the May period rather than trusting its stored date,
 * which is the period-end count date (June 1) and would otherwise read as a June
 * import.
 *
 * The test is "nothing postdates the period", not "everything is dated in May":
 * Purchase Date is when stock was BOUGHT, so a May count legitimately contains
 * inventory purchased in April, March, or earlier. A row dated after May 31
 * would mean June activity leaked in, which is the condition that must block.
 */
async function assertPeriodEvidence(): Promise<void> {
  const rows = resultRows<{
    dated: string | number;
    after_period: string | number;
    max_purchase_date: string | null;
  }>(await db.execute(sql`
    SELECT
      count(*) FILTER (
        WHERE COALESCE(trim(raw_data->>'Purchase Date'), '') <> ''
      ) AS dated,
      count(*) FILTER (
        WHERE COALESCE(trim(raw_data->>'Purchase Date'), '') <> ''
          AND to_date(raw_data->>'Purchase Date', 'Month DD, YYYY') > ${SCOPE.periodEnd}::date
      ) AS after_period,
      max(to_date(raw_data->>'Purchase Date', 'Month DD, YYYY')) FILTER (
        WHERE COALESCE(trim(raw_data->>'Purchase Date'), '') <> ''
      ) AS max_purchase_date
    FROM inventory_import_rows
    WHERE batch_id = ${SCOPE.batchId}
  `));

  const dated = Number(rows[0]?.dated ?? 0);
  const afterPeriod = Number(rows[0]?.after_period ?? 0);
  const maxDate = rows[0]?.max_purchase_date ?? 'none';
  must(dated > 0, 'Batch carries no dated source rows — cannot prove which period it covers');
  must(
    afterPeriod === 0,
    `Batch contains ${afterPeriod} source rows dated after ${SCOPE.periodEnd} — refusing to adopt a period beyond May`,
  );
  console.log(`  period evidence        ${dated} dated rows, none after ${SCOPE.periodEnd} (latest ${String(maxDate).slice(0, 10)})`);
}

async function existingLinks(): Promise<Array<{ importRowId: string; hash: string }>> {
  const links = await db
    .select({
      importRowId: historicalSessionUnresolvedRows.importRowId,
      hash: historicalSessionUnresolvedRows.sourceEvidenceHash,
    })
    .from(historicalSessionUnresolvedRows)
    // @ts-ignore
    .where(eq(historicalSessionUnresolvedRows.sessionId, SCOPE.sessionId));
  return links;
}

interface VerifyResult {
  classification: Classification;
  persisted: { lines: number; value: number };
  checksum: string;
  linkCount: number;
  isHistoricalImport: number;
  reconciliation: ReturnType<typeof reconcileHistoricalSnapshot>;
}

async function verify(label: string): Promise<VerifyResult> {
  const [session, batch] = await Promise.all([loadSession(), loadBatch()]);
  const classification = await classifyBatch();
  const persisted = await persistedResolvedTotal();
  const checksum = await countLineChecksum();
  const links = await existingLinks();

  // The population must match the approved figures exactly.
  must(
    classification.sourceRows === EXPECTED.sourceRows,
    `Source rows: expected ${EXPECTED.sourceRows}, observed ${classification.sourceRows}`,
  );
  mustEqual(classification.sourceValue, EXPECTED.sourceValue, 'Source valuation');
  must(
    classification.unresolved.length === EXPECTED.unresolvedRows,
    `Unresolved rows: expected ${EXPECTED.unresolvedRows}, observed ${classification.unresolved.length}`,
  );
  mustEqual(classification.unresolvedValue, EXPECTED.unresolvedValue, 'Unresolved valuation');
  mustEqual(classification.resolvedGeoValue, EXPECTED.resolvedValue, 'Resolved (source-side) valuation');

  // The session's own lines must still hold the resolved valuation, untouched.
  must(
    persisted.lines === EXPECTED.countLines,
    `Count lines: expected ${EXPECTED.countLines}, observed ${persisted.lines}`,
  );
  mustEqual(persisted.value, EXPECTED.resolvedValue, 'Persisted resolved valuation');

  // Reconciliation is computed from persisted lines + linked evidence, which is
  // the same definition the service uses on the read path.
  const linkedValue = links.length
    ? round2(classification.unresolved
        .filter(u => links.some(l => l.importRowId === u.id))
        .reduce((s, u) => s + u.value, 0))
    : 0;
  const reconciliation = reconcileHistoricalSnapshot({
    sourceTotal: batch.snapshotTotal ?? classification.sourceValue,
    resolvedTotal: persisted.value,
    unresolvedTotal: linkedValue,
    tolerance: CENT,
  });

  console.log(`\n── ${label} ──`);
  console.log(`  driver                 ${dbDriverMode}`);
  console.log(`  session                ${SCOPE.sessionId}`);
  console.log(`  applied                ${session.applied}  (0 = live on-hand untouched)`);
  console.log(`  is_historical_import   ${session.isHistoricalImport}`);
  console.log(`  count lines            ${persisted.lines}`);
  console.log(`  count-line checksum    ${checksum}`);
  console.log(`  evidence links         ${links.length}`);
  console.log(`  source rows            ${classification.sourceRows}`);
  console.log(`  source valuation       $${classification.sourceValue.toFixed(2)}`);
  console.log(`  resolved (lines)       $${persisted.value.toFixed(2)}`);
  console.log(`  unresolved (linked)    $${linkedValue.toFixed(2)}  (${links.length} rows)`);
  console.log(`  unresolved (available) $${classification.unresolvedValue.toFixed(2)}  (${classification.unresolved.length} rows)`);
  console.log(`  zero-geometry resolved ${classification.zeroGeoRows} rows / $${classification.zeroGeoValue.toFixed(2)}`);
  console.log(`  historical total       $${reconciliation.historicalSnapshotTotal.toFixed(2)}`);
  console.log(`  reconciliation delta   $${(reconciliation.delta ?? NaN).toFixed(2)}`);

  return {
    classification,
    persisted,
    checksum,
    linkCount: links.length,
    isHistoricalImport: session.isHistoricalImport,
    reconciliation,
  };
}

async function apply(): Promise<void> {
  const before = await verify('BEFORE');

  if (before.isHistoricalImport === 1 && before.linkCount === EXPECTED.unresolvedRows) {
    console.log('\nSession is already adopted with complete evidence. Nothing to do.');
    return;
  }

  const classification = before.classification;
  const already = new Set((await existingLinks()).map(l => l.importRowId));
  const toLink = classification.unresolved.filter(u => !already.has(u.id));
  console.log(`\nLinking ${toLink.length} unresolved evidence rows (${already.size} already linked)…`);

  // Links first, flag last: a partially linked session must never be readable
  // as a protected, reconciled historical import.
  await db.transaction(async (tx: any) => {
    const CHUNK = 500;
    for (let i = 0; i < toLink.length; i += CHUNK) {
      const slice = toLink.slice(i, i + CHUNK);
      await tx.insert(historicalSessionUnresolvedRows).values(
        slice.map(u => ({
          sessionId: SCOPE.sessionId,
          importRowId: u.id,
          sourceEvidenceHash: u.hash,
        })),
      );
    }
  });

  // Re-verify against the database before granting the flag.
  const linked = await existingLinks();
  must(
    linked.length === EXPECTED.unresolvedRows,
    `Post-link evidence count: expected ${EXPECTED.unresolvedRows}, observed ${linked.length}`,
  );
  const expectedIds = new Set(classification.unresolved.map(u => u.id));
  must(
    linked.every(l => expectedIds.has(l.importRowId)),
    'A persisted evidence link points outside the approved May unresolved population',
  );

  // Every linked row must still belong to the approved batch.
  const linkedRows = await db
    .select({ id: inventoryImportRows.id, batchId: inventoryImportRows.batchId })
    .from(inventoryImportRows)
    // @ts-ignore
    .where(inArray(inventoryImportRows.id, linked.map((l: { importRowId: string }) => l.importRowId)));
  must(linkedRows.length === linked.length, 'A linked evidence row is missing from the import table');
  must(
    linkedRows.every((r: { batchId: string }) => r.batchId === SCOPE.batchId),
    'A linked evidence row belongs to a different batch',
  );

  const persistedAfterLink = await persistedResolvedTotal();
  const linkedValue = round2(
    classification.unresolved
      .filter(u => linked.some(l => l.importRowId === u.id))
      .reduce((s, u) => s + u.value, 0),
  );
  const reconciliation = reconcileHistoricalSnapshot({
    sourceTotal: EXPECTED.sourceValue,
    resolvedTotal: persistedAfterLink.value,
    unresolvedTotal: linkedValue,
    tolerance: CENT,
  });
  mustEqual(reconciliation.historicalSnapshotTotal, EXPECTED.historicalTotal, 'Historical total');
  mustEqual(reconciliation.delta ?? Number.NaN, EXPECTED.delta, 'Reconciliation delta');
  must(!reconciliation.exceedsTolerance, 'Reconciliation exceeds tolerance — refusing to set the flag');

  // Count lines must be byte-identical to before the run.
  const checksumAfter = await countLineChecksum();
  must(
    checksumAfter === before.checksum,
    `Count lines changed during backfill (${before.checksum} → ${checksumAfter})`,
  );

  console.log('Reconciled to $0.00 with complete evidence. Setting is_historical_import = 1…');
  await db
    .update(inventoryCounts)
    .set({ isHistoricalImport: 1 })
    // @ts-ignore
    .where(eq(inventoryCounts.id, SCOPE.sessionId));

  const after = await verify('AFTER');
  must(after.isHistoricalImport === 1, 'Flag was not persisted');
  must(after.linkCount === EXPECTED.unresolvedRows, 'Evidence links incomplete after apply');
  mustEqual(after.reconciliation.delta ?? Number.NaN, EXPECTED.delta, 'Final reconciliation delta');
  must(after.checksum === before.checksum, 'Count lines changed during backfill');
  must(after.persisted.lines === EXPECTED.countLines, 'Count line count changed during backfill');
  console.log('\nMay session adopted as a protected historical import.');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'verify';

  await ensureHistoricalSessionUnresolvedRowsSchema(db as any);

  if (mode === 'verify') {
    await verify('VERIFY (read-only)');
    console.log('\nRead-only verification complete. No rows were written.');
    return;
  }
  if (mode === 'apply') {
    if (!argv.includes('--confirm-backfill')) {
      throw new Error('Apply requires --confirm-backfill');
    }
    await apply();
    return;
  }
  throw new Error(`Unknown mode "${mode}". Use --mode verify or --mode apply.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`\nBackfill failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
