/**
 * Orderly Count Session Service
 *
 * Converts an approved Orderly import batch into a historical inventory count
 * session that appears in FnB Cost Pro's count history.
 *
 * Key design decisions:
 * - Uses `inventory_import_rows.resolved_inventory_item_id` (set during approval)
 *   to know which inventory item each row maps to — no guessing from names.
 * - Bridges `inventory_locations` (Orderly hierarchy) to `storage_locations`
 *   (the FK target of count lines) via find-or-create by name.
 * - Raises 409 if the batch has already been converted.
 * - Raises 422 if the reconciliation variance exceeds the tolerance threshold
 *   unless the caller passes `acknowledgeVariance: true`.
 */

import { db } from '../../db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import {
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItems,
  storageLocations,
  inventoryCounts,
  inventoryCountLines,
  type InventoryImportRow,
} from '@shared/schema';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Warn (and require acknowledgement) when importable total differs from
 *  Orderly's reported snapshot total by more than this percentage. */
const VARIANCE_TOLERANCE_PCT = 0.5;

/** Count sessions within this many calendar days of the target date are
 *  flagged as potential duplicates. */
const DUPLICATE_WINDOW_DAYS = 3;

// ── Public types ───────────────────────────────────────────────────────────────

export interface ConversionPreview {
  batchId: string;
  inventoryDate: string | null;
  originalFilename: string;
  /** Orderly's reported snapshot total (sum of all row totalCost in the source). */
  snapshotTotal: number | null;
  /** Sum of totalCost for rows that have a resolved inventory item. */
  importableTotal: number;
  /** importableTotal − snapshotTotal (positive = over, negative = under). */
  reconciliationDelta: number;
  /** Absolute percentage deviation from snapshotTotal. */
  reconciliationDeltaPct: number;
  /** True when reconciliationDeltaPct > VARIANCE_TOLERANCE_PCT. */
  exceedsVarianceTolerance: boolean;
  includedRowCount: number;
  excludedRowCount: number;
  /** Unique location names that appear on included rows. */
  locationNames: string[];
  /** Set if this batch has already been converted; holds the count session id. */
  existingCountSessionId: string | null;
  /** Human-readable warning when an ORDERLY count session already exists
   *  within ±DUPLICATE_WINDOW_DAYS of this batch's inventory date. */
  existingSessionWarning: string | null;
  /** Row-level cross-reference discrepancies vs the previous period's session. */
  crossReferenceWarnings: string[];
  /** Rows that will NOT produce a count line (no resolved item). */
  excludedRows: Array<{
    rowIndex: number;
    description: string | null;
    reason: string;
  }>;
}

export interface ConversionResult {
  countSessionId: string;
  linesCreated: number;
  linesSkipped: number;
  totalValue: number;
  storageLocationsCreated: number;
  warnings: string[];
}

// ── Private helpers ────────────────────────────────────────────────────────────

type RowLike = {
  count1: number | null;
  count2: number | null;
  count3: number | null;
  caseQuantity: number | null;
  innerPackQuantity: number | null;
  packParseStatus: string | null;
  totalUnits: number | null;
  packagePrice: number | null;
};

/**
 * Convert three-tier count columns (Case / Pack / UOM) into a total
 * base-unit quantity.  Falls back to `totalUnits` when pack geometry is
 * unparseable so that Orderly's pre-computed total is always honoured.
 */
function computeQty(row: RowLike): number {
  const c1 = row.count1 ?? 0;
  const c2 = row.count2 ?? 0;
  const c3 = row.count3 ?? 0;

  if (
    row.packParseStatus === 'ok' &&
    row.caseQuantity != null && row.caseQuantity > 0 &&
    row.innerPackQuantity != null && row.innerPackQuantity > 0
  ) {
    return (
      c1 * row.caseQuantity * row.innerPackQuantity +
      c2 * row.innerPackQuantity +
      c3
    );
  }

  // Fall back to the pre-computed Orderly total
  return row.totalUnits ?? (c1 + c2 + c3);
}

/**
 * Derive cost per base unit from package price and pack geometry.
 * Falls back to price-per-case / max(caseQuantity, 1) when geometry is
 * unparseable — safer than returning 0 or the full case price.
 */
function computeUnitCost(row: RowLike): number {
  const price = row.packagePrice ?? 0;
  if (
    row.packParseStatus === 'ok' &&
    row.caseQuantity != null && row.caseQuantity > 0 &&
    row.innerPackQuantity != null && row.innerPackQuantity > 0
  ) {
    return price / (row.caseQuantity * row.innerPackQuantity);
  }
  return price / Math.max(row.caseQuantity ?? 1, 1);
}

/**
 * Find an existing `storage_locations` row for `name` (company-scoped,
 * case-insensitive) or create one.
 * Returns the storage location id.
 */
async function findOrCreateStorageLocation(
  companyId: string,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const normName = name.toLowerCase().trim();
  const [existing] = await db
    .select({ id: storageLocations.id })
    .from(storageLocations)
    .where(
      and(
        eq(storageLocations.companyId, companyId),
        sql`lower(${storageLocations.name}) = ${normName}`,
      ),
    )
    .limit(1);

  if (existing) return { id: existing.id, created: false };

  const [newLoc] = await db
    .insert(storageLocations)
    .values({ companyId, name: name.trim(), sortOrder: 0, allowCaseCounting: 1 })
    .returning({ id: storageLocations.id });
  return { id: newLoc.id, created: true };
}

// ── Exported functions ─────────────────────────────────────────────────────────

/**
 * Read-only analysis of what a batch-to-count-session conversion would produce.
 * No writes.
 */
export async function getConversionPreview(
  batchId: string,
  companyId: string,
): Promise<ConversionPreview> {
  // ── Load batch ───────────────────────────────────────────────────────────
  const [batch] = await db
    .select()
    .from(inventoryImportBatches)
    .where(
      and(
        eq(inventoryImportBatches.id, batchId),
        eq(inventoryImportBatches.companyId, companyId),
      ),
    )
    .limit(1);

  if (!batch) throw new Error('Batch not found');
  if (batch.status !== 'approved') {
    throw new Error('Batch must be approved before it can be converted to a count session');
  }

  // ── Load rows ────────────────────────────────────────────────────────────
  const rows: InventoryImportRow[] = await db
    .select()
    .from(inventoryImportRows)
    .where(eq(inventoryImportRows.batchId, batchId));

  const includedRows = rows.filter((r: InventoryImportRow) => r.resolvedInventoryItemId != null);
  const excludedRows  = rows.filter((r: InventoryImportRow) => r.resolvedInventoryItemId == null);

  const importableTotal = includedRows.reduce((s: number, r: InventoryImportRow) => s + (r.totalCost ?? 0), 0);
  const snapshotTotal   = batch.snapshotTotal;
  const delta           = importableTotal - (snapshotTotal ?? importableTotal);
  const deltaPct        = snapshotTotal && snapshotTotal > 0
    ? (Math.abs(delta) / snapshotTotal) * 100
    : 0;

  const locationNames = Array.from(
    new Set(includedRows.map((r: InventoryImportRow) => r.storageLocation).filter((x): x is string => x != null)),
  );

  // ── Already converted? ───────────────────────────────────────────────────
  const [existingSession] = await db
    .select({ id: inventoryCounts.id })
    .from(inventoryCounts)
    .where(
      and(
        eq(inventoryCounts.companyId, companyId),
        eq(inventoryCounts.sourceBatchId, batchId),
      ),
    )
    .limit(1);

  // ── Duplicate date guard ─────────────────────────────────────────────────
  let existingSessionWarning: string | null = null;
  if (!existingSession && batch.inventoryDate) {
    const [y, m, d] = batch.inventoryDate.split('-').map(Number);
    const targetDate = new Date(Date.UTC(y, m - 1, d));
    const windowMs   = DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const minDate    = new Date(targetDate.getTime() - windowMs);
    const maxDate    = new Date(targetDate.getTime() + windowMs);

    const [nearbySession] = await db
      .select({ id: inventoryCounts.id })
      .from(inventoryCounts)
      .where(
        and(
          eq(inventoryCounts.companyId, companyId),
          eq(inventoryCounts.sourceSystem, 'ORDERLY'),
          sql`${inventoryCounts.countDate} >= ${minDate.toISOString()}::timestamptz`,
          sql`${inventoryCounts.countDate} <= ${maxDate.toISOString()}::timestamptz`,
        ),
      )
      .limit(1);

    if (nearbySession) {
      existingSessionWarning =
        `An Orderly count session already exists within ${DUPLICATE_WINDOW_DAYS} days of this inventory date. ` +
        `Creating a second session may cause duplicate values in snapshot-variance reports.`;
    }
  }

  // ── Cross-reference warnings (previous-period "Previous" columns) ────────
  const crossReferenceWarnings: string[] = [];
  const rowsWithPreviousData = includedRows.filter(
    (r: InventoryImportRow) => r.previousCase != null || r.previousPack != null || r.previousUom != null,
  );
  if (rowsWithPreviousData.length > 0) {
    // Look for a prior approved batch from the same company (previous month range)
    const [y, m, d] = (batch.inventoryDate ?? '2000-01-01').split('-').map(Number);
    const batchDate  = new Date(Date.UTC(y, m - 1, d));
    const priorMin   = new Date(batchDate.getTime() - 40 * 24 * 60 * 60 * 1000);
    const priorMax   = new Date(batchDate.getTime() - 15 * 24 * 60 * 60 * 1000);

    const [prevBatch] = await db
      .select({ id: inventoryImportBatches.id, inventoryDate: inventoryImportBatches.inventoryDate })
      .from(inventoryImportBatches)
      .where(
        and(
          eq(inventoryImportBatches.companyId, companyId),
          eq(inventoryImportBatches.status, 'approved'),
          sql`${inventoryImportBatches.inventoryDate}::date >= ${priorMin.toISOString().slice(0, 10)}::date`,
          sql`${inventoryImportBatches.inventoryDate}::date <= ${priorMax.toISOString().slice(0, 10)}::date`,
        ),
      )
      .limit(1);

    if (prevBatch) {
      crossReferenceWarnings.push(
        `This file contains "Previous" columns referencing ${prevBatch.inventoryDate ?? 'a prior period'}. ` +
        `The prior Orderly batch is already approved. If the embedded previous values differ from that batch, ` +
        `the discrepancy will appear in the snapshot-variance report.`,
      );
    }
  }

  return {
    batchId,
    inventoryDate: batch.inventoryDate,
    originalFilename: batch.originalFilename,
    snapshotTotal,
    importableTotal,
    reconciliationDelta: delta,
    reconciliationDeltaPct: deltaPct,
    exceedsVarianceTolerance: deltaPct > VARIANCE_TOLERANCE_PCT,
    includedRowCount: includedRows.length,
    excludedRowCount: excludedRows.length,
    locationNames,
    existingCountSessionId: existingSession?.id ?? null,
    existingSessionWarning,
    crossReferenceWarnings,
    excludedRows: excludedRows.map((r: InventoryImportRow) => ({
      rowIndex: r.rowIndex,
      description: r.cleanedDescription,
      reason: r.resolvedInventoryItemId == null
        ? 'Item was not resolved during approval'
        : 'Item missing',
    })),
  };
}

/**
 * Convert an approved batch into an inventory count session.
 *
 * @param acknowledgeVariance - must be true when reconciliation delta > tolerance.
 */
export async function convertBatchToCountSession(
  batchId: string,
  companyId: string,
  userId: string,
  storeId: string,
  acknowledgeVariance = false,
): Promise<ConversionResult> {
  const preview = await getConversionPreview(batchId, companyId);

  if (preview.existingCountSessionId) {
    throw Object.assign(
      new Error('This batch has already been converted to a count session.'),
      { code: 'ALREADY_CONVERTED', countSessionId: preview.existingCountSessionId },
    );
  }

  if (preview.exceedsVarianceTolerance && !acknowledgeVariance) {
    throw Object.assign(
      new Error(
        `Reconciliation variance is ${preview.reconciliationDeltaPct.toFixed(2)}%, which exceeds the ` +
        `${VARIANCE_TOLERANCE_PCT}% tolerance. Pass acknowledgeVariance=true to proceed.`,
      ),
      { code: 'VARIANCE_EXCEEDED', deltaPct: preview.reconciliationDeltaPct },
    );
  }

  // ── Load included rows (those with a resolved item) ──────────────────────
  const rows = await db
    .select()
    .from(inventoryImportRows)
    .where(
      and(
        eq(inventoryImportRows.batchId, batchId),
        sql`${inventoryImportRows.resolvedInventoryItemId} IS NOT NULL`,
      ),
    );

  if (rows.length === 0) {
    throw new Error('No resolved rows to convert — approve the batch first.');
  }

  // ── Load item unit IDs ───────────────────────────────────────────────────
  const itemIds = Array.from(new Set(rows.map((r: InventoryImportRow) => r.resolvedInventoryItemId!))) as string[];
  const itemRows = itemIds.length > 0
    ? await db
        .select({ id: inventoryItems.id, unitId: inventoryItems.unitId })
        .from(inventoryItems)
        .where(inArray(inventoryItems.id, itemIds))
    : [];
  const itemUnitId = new Map(itemRows.map((i: { id: string; unitId: string }) => [i.id, i.unitId]));

  // ── Find / create storage_locations for each Orderly location name ───────
  const nonNullLocs: string[] = rows
    .map((r: InventoryImportRow) => r.storageLocation)
    .filter((x: string | null): x is string => x != null);
  const locationNames: string[] = Array.from(new Set(nonNullLocs));
  const locationIdByName = new Map<string, string>();
  let storageLocationsCreated = 0;

  for (const name of locationNames) {
    const { id, created } = await findOrCreateStorageLocation(companyId, name);
    locationIdByName.set(name, id);
    if (created) storageLocationsCreated++;
  }

  // Fallback location for rows that have no storageLocation text
  let defaultLocationId: string | null = null;
  if (rows.some((r: InventoryImportRow) => !r.storageLocation)) {
    const { id, created } = await findOrCreateStorageLocation(companyId, 'General');
    defaultLocationId = id;
    if (created) storageLocationsCreated++;
  }

  // ── Transaction: create session + lines ──────────────────────────────────
  const result = await db.transaction(async (tx: any) => {
    const inventoryDate = preview.inventoryDate!;
    const [yr, mo, dy] = inventoryDate.split('-').map(Number);
    const countDate = new Date(Date.UTC(yr, mo - 1, dy));

    // Create the count session
    const [session] = await tx
      .insert(inventoryCounts)
      .values({
        companyId,
        storeId,
        countDate,
        userId,
        name: `Orderly — ${preview.originalFilename} — ${inventoryDate}`,
        note: 'Imported from Orderly inventory snapshot. Counts reflect on-hand quantities at the inventory date.',
        applied: 0,
        isPowerSession: 0,
        sourceSystem: 'ORDERLY',
        sourceBatchId: batchId,
        sourceFilename: preview.originalFilename,
        sourceInventoryDate: inventoryDate,
        isHistoricalImport: 1,
      })
      .returning({ id: inventoryCounts.id });

    let linesCreated         = 0;
    let linesSkipped         = 0;
    let totalValue           = 0;
    const warnings: string[] = [];

    for (const row of rows) {
      const inventoryItemId = row.resolvedInventoryItemId!;
      const unitId = itemUnitId.get(inventoryItemId);

      if (!unitId) {
        linesSkipped++;
        warnings.push(`Row ${row.rowIndex}: inventory item unit not found — skipped`);
        continue;
      }

      const storageLocationId = row.storageLocation
        ? (locationIdByName.get(row.storageLocation) ?? defaultLocationId)
        : defaultLocationId;

      if (!storageLocationId) {
        linesSkipped++;
        warnings.push(`Row ${row.rowIndex}: no storage location — skipped`);
        continue;
      }

      const qty      = computeQty(row);
      const unitCost = computeUnitCost(row);

      await tx
        .insert(inventoryCountLines)
        .values({
          inventoryCountId: session.id,
          inventoryItemId,
          storageLocationId,
          qty,
          caseQty:      row.count1 ?? null, // number of full cases
          containerQty: row.count2 ?? null, // number of inner packs
          looseUnits:   row.count3 ?? null, // number of loose base units
          unitId,
          unitCost,
          userId,
        })
        .onConflictDoNothing();

      linesCreated++;
      totalValue += qty * unitCost;
    }

    return {
      countSessionId: session.id,
      linesCreated,
      linesSkipped,
      totalValue,
      storageLocationsCreated,
      warnings,
    };
  });

  return result;
}
