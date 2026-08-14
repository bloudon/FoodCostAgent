/**
 * Orderly Count Session Service
 *
 * Converts an approved Orderly import batch into a historical inventory count
 * session, enabling period-over-period snapshot variance analysis.
 *
 * Language note: these are SNAPSHOTS, not "usage". Two snapshots provide
 * beginning/ending inventory value (snapshot variance / value change).
 * "Actual usage" requires BI + Purchases − EI − Waste − Transfers.
 *
 * Steps:
 *  1. previewCountSession   — compute included items, valuation, reconciliation
 *  2. createCountSession    — build inventory_counts + inventory_count_lines rows
 *
 * The service resolves inventory item IDs by:
 *   (a) inventory_import_rows.resolved_inventory_item_id   (set during approval)
 *   (b) Fallback: inventory_item_external_mappings lookup by sourceItemCode
 */

import { db } from '../../db';
import { eq, and, inArray, or, sql } from 'drizzle-orm';
import {
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItemExternalMappings,
  inventoryItemLocationAssignments,
  inventoryLocations,
  inventoryCounts,
  inventoryCountLines,
  storageLocations,
  inventoryItems,
  units,
  type InventoryImportRow,
  type InventoryLocation,
} from '@workspace/db';

// ─── Constants ────────────────────────────────────────────────────────────────

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
        // @ts-ignore
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
        // @ts-ignore
        eq(inventoryImportBatches.id, batchId),
        // @ts-ignore
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
    // @ts-ignore
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
        // @ts-ignore
        eq(inventoryCounts.companyId, companyId),
        // @ts-ignore
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
          // @ts-ignore
          eq(inventoryCounts.companyId, companyId),
          // @ts-ignore
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
          // @ts-ignore
          eq(inventoryImportBatches.companyId, companyId),
          // @ts-ignore
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
        // @ts-ignore
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
        // @ts-ignore
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

export const DEFAULT_RECONCILIATION_TOLERANCE = 0.005; // 0.5%

export interface CreateCountSessionResult {
  countId: string;
  inventoryDate: string | null;
  name: string;
  linesCreated: number;
  importableTotal: number;
  reconciliationDelta: number | null;
  reconciliationDeltaPct: number | null;
  locationsCreated: number;
}

const DUPLICATE_GUARD_DAYS = 3;

export interface CrossReferenceDiscrepancy {
  rowIndex: number;
  sourceItemCode: string;
  description: string | null;
  juneEmbeddedPreviousCost: number;
  mayActualCost: number;
  delta: number;
  deltaPercent: number;
}

export interface CountSessionPreview {
  batchId: string;
  inventoryDate: string | null;
  originalFilename: string;
  sourceRowCount: number;
  snapshotTotal: number | null;
  /** Rows that can be imported */
  includedRows: CountSessionPreviewRow[];
  /** Rows excluded and why */
  excludedRows: ExcludedRow[];
  /** Sum of totalCost for included rows */
  importableTotal: number;
  /** Absolute delta between importableTotal and snapshotTotal */
  reconciliationDelta: number | null;
  /** Delta as a fraction (0–1) of snapshotTotal */
  reconciliationDeltaPct: number | null;
  /** Whether the delta exceeds the tolerance (default 0.5%) */
  reconciliationExceedsTolerance: boolean;
  reconciliationTolerance: number;
  /** Unique storage locations that will be used */
  locations: string[];
  /** Existing count sessions that may be duplicates */
  duplicateWarnings: Array<{ countId: string; countDate: string; name: string | null }>;
  /** Cross-reference discrepancies (June vs May) */
  crossReferenceDiscrepancies: CrossReferenceDiscrepancy[];
}

function normalizeLocationName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

export interface CreateCountSessionParams {
  batchId: string;
  companyId: string;
  userId: string | null;
  storeId: string;
  /** If true, proceed even if reconciliation tolerance is exceeded */
  acknowledgedVariance?: boolean;
  /** Override reconciliation tolerance (0–1 fraction), default 0.005 */
  reconciliationTolerance?: number;
}

export interface CountSessionPreviewRow {
  rowIndex: number;
  inventoryItemId: string;
  inventoryItemName: string;
  storageLocation: string | null;
  /** Count tiers from the Orderly file */
  count1: number | null;
  countUnit1: string | null;
  count2: number | null;
  countUnit2: string | null;
  count3: number | null;
  countUnit3: string | null;
  totalUnits: number | null;
  /** Valuation from the Orderly file */
  totalCost: number | null;
  packagePrice: number | null;
}

/**
 * Compute the effective quantity in base units from three-tier Orderly counts.
 *
 * Orderly uses three tiers: Case × count1, Pack × count2, UOM × count3.
 * If all three tiers are zero/null, fall back to totalUnits.
 *
 * We cannot safely convert across unit types (e.g. cases → lbs) without
 * inventory unit context here, so we use `totalUnits` as the canonical qty
 * when provided (Orderly computes it), with the tier counts stored for
 * reference on the count line.
 */
function computeEffectiveQty(row: InventoryImportRow): number {
  if (row.totalUnits != null && row.totalUnits > 0) return row.totalUnits;
  // Fall back: sum individual tier counts
  const t1 = row.count1 ?? 0;
  const t2 = row.count2 ?? 0;
  const t3 = row.count3 ?? 0;
  return t1 + t2 + t3;
}

async function resolveItemIdsForBatch(
  rows: InventoryImportRow[],
  companyId: string,
  sourcePropertyId: string,
): Promise<Map<number, string>> {
  const rowToItemId = new Map<number, string>();

  // Step 1: use resolvedInventoryItemId when available (set during approval)
  const rowsWithDirect = rows.filter(r => r.resolvedInventoryItemId);
  for (const r of rowsWithDirect) {
    rowToItemId.set(r.rowIndex, r.resolvedInventoryItemId!);
  }

  // Step 2: fallback via external mappings (for pre-existing approved batches)
  const rowsNeedingLookup = rows.filter(
    r => !r.resolvedInventoryItemId && r.sourceItemCode && r.itemCodeStatus === 'valid',
  );
  if (rowsNeedingLookup.length > 0) {
    const codes = Array.from(new Set(rowsNeedingLookup.map(r => r.sourceItemCode!)));
    const mappings = await db
      .select({
        sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
        inventoryItemId: inventoryItemExternalMappings.inventoryItemId,
      })
      .from(inventoryItemExternalMappings)
      .where(
        and(
          // @ts-ignore
          eq(inventoryItemExternalMappings.companyId, companyId),
          // @ts-ignore
          eq(inventoryItemExternalMappings.sourceSystem, 'ORDERLY'),
          // Identity is scoped to the batch's source property — another club's
          // mapping for the same Item Code must never resolve these rows.
          // @ts-ignore
          eq(inventoryItemExternalMappings.sourcePropertyId, sourcePropertyId),
          // @ts-ignore
          inArray(inventoryItemExternalMappings.sourceExternalId, codes),
        ),
      );
    const codeToItemId = new Map<string, string>(
      mappings.map((m: { sourceExternalId: string; inventoryItemId: string }) => [m.sourceExternalId, m.inventoryItemId]),
    );
    for (const r of rowsNeedingLookup) {
      const itemId = codeToItemId.get(r.sourceItemCode!);
      if (itemId) rowToItemId.set(r.rowIndex, itemId);
    }
  }

  return rowToItemId;
}

export interface ExcludedRow {
  rowIndex: number;
  rawDescription: string | null;
  reason: 'no_item_resolved' | 'zero_cost' | 'missing_count_geometry';
}

export async function previewCountSession(
  batchId: string,
  companyId: string,
  options: { tolerance?: number } = {},
): Promise<CountSessionPreview> {
  const tolerance = options.tolerance ?? DEFAULT_RECONCILIATION_TOLERANCE;

  // Load batch + rows
  const [batchRows, batchMeta] = await Promise.all([
    db
      .select()
      .from(inventoryImportRows)
      // @ts-ignore
      .where(eq(inventoryImportRows.batchId, batchId))
      .orderBy(inventoryImportRows.rowIndex),
    db
      .select()
      .from(inventoryImportBatches)
      .where(
        and(
          // @ts-ignore
          eq(inventoryImportBatches.id, batchId),
          // @ts-ignore
          eq(inventoryImportBatches.companyId, companyId),
        ),
      )
      .limit(1),
  ]);

  const batch = batchMeta[0];
  if (!batch) throw new Error('Batch not found or not accessible');
  if (batch.status !== 'approved') {
    throw new Error('Batch must be approved before creating a count session');
  }

  // Resolve item IDs
  const rowToItemId = await resolveItemIdsForBatch(
    batchRows,
    companyId,
    batch.sourcePropertyId ?? '',
  );

  // Load item names
  const allItemIds = Array.from(rowToItemId.values());
  let itemNameMap = new Map<string, string>();
  if (allItemIds.length > 0) {
    const items = await db
      .select({ id: inventoryItems.id, name: inventoryItems.name })
      .from(inventoryItems)
      // @ts-ignore
      .where(inArray(inventoryItems.id, allItemIds));
    itemNameMap = new Map(items.map((i: { id: string; name: string }) => [i.id, i.name]));
  }

  // Build included / excluded lists
  const includedRows: CountSessionPreviewRow[] = [];
  const excludedRows: ExcludedRow[] = [];
  const locationNames = new Set<string>();

  for (const row of batchRows) {
    const itemId = rowToItemId.get(row.rowIndex);
    if (!itemId) {
      excludedRows.push({
        rowIndex: row.rowIndex,
        rawDescription: row.rawDescription ?? row.cleanedDescription,
        reason: 'no_item_resolved',
      });
      continue;
    }
    // Only include rows with meaningful count data
    const hasCount =
      (row.totalUnits != null && row.totalUnits > 0) ||
      (row.count1 != null && row.count1 > 0) ||
      (row.count2 != null && row.count2 > 0) ||
      (row.count3 != null && row.count3 > 0);
    if (!hasCount) {
      excludedRows.push({
        rowIndex: row.rowIndex,
        rawDescription: row.rawDescription ?? row.cleanedDescription,
        reason: 'missing_count_geometry',
      });
      continue;
    }
    if (row.storageLocation) locationNames.add(row.storageLocation.trim());

    includedRows.push({
      rowIndex: row.rowIndex,
      inventoryItemId: itemId,
      inventoryItemName: itemNameMap.get(itemId) ?? `Item ${itemId.slice(0, 8)}`,
      storageLocation: row.storageLocation ?? null,
      count1: row.count1 ?? null,
      countUnit1: row.countUnit1 ?? null,
      count2: row.count2 ?? null,
      countUnit2: row.countUnit2 ?? null,
      count3: row.count3 ?? null,
      countUnit3: row.countUnit3 ?? null,
      totalUnits: row.totalUnits ?? null,
      totalCost: row.totalCost ?? null,
      packagePrice: row.packagePrice ?? null,
    });
  }

  // Reconciliation
  const importableTotal = includedRows.reduce((s, r) => s + (r.totalCost ?? 0), 0);
  const snapshotTotal = batch.snapshotTotal ?? null;
  let reconciliationDelta: number | null = null;
  let reconciliationDeltaPct: number | null = null;
  let reconciliationExceedsTolerance = false;

  if (snapshotTotal != null && snapshotTotal > 0) {
    reconciliationDelta = Math.abs(importableTotal - snapshotTotal);
    reconciliationDeltaPct = reconciliationDelta / snapshotTotal;
    reconciliationExceedsTolerance = reconciliationDeltaPct > tolerance;
  }

  // Duplicate guard — look for existing count sessions from same source
  const inventoryDateStr = batch.inventoryDate;
  let duplicateWarnings: Array<{ countId: string; countDate: string; name: string | null }> = [];
  if (inventoryDateStr) {
    const targetDate = new Date(inventoryDateStr);
    const minDate = new Date(targetDate);
    minDate.setDate(minDate.getDate() - DUPLICATE_GUARD_DAYS);
    const maxDate = new Date(targetDate);
    maxDate.setDate(maxDate.getDate() + DUPLICATE_GUARD_DAYS);

    const existingSessions = await db
      .select({
        id: inventoryCounts.id,
        countDate: inventoryCounts.countDate,
        name: inventoryCounts.name,
        sourceSystem: inventoryCounts.sourceSystem,
      })
      .from(inventoryCounts)
      .where(
        and(
          // @ts-ignore
          eq(inventoryCounts.companyId, companyId),
          sql`${inventoryCounts.countDate} >= ${minDate}`,
          sql`${inventoryCounts.countDate} <= ${maxDate}`,
          // @ts-ignore
          eq(inventoryCounts.sourceSystem, 'ORDERLY'),
        ),
      );

    duplicateWarnings = existingSessions.map((s: { id: string; countDate: Date; name: string | null }) => ({
      countId: s.id,
      countDate: s.countDate.toISOString().split('T')[0],
      name: s.name,
    }));
  }

  // May/June cross-reference — if this is a June batch, find an approved May batch
  const crossReferenceDiscrepancies: CrossReferenceDiscrepancy[] = [];
  if (inventoryDateStr) {
    const inventoryDate = new Date(inventoryDateStr);
    // June = month 5 (0-indexed)
    if (inventoryDate.getMonth() === 5) {
      // Look for a May batch (within 45 days before)
      const mayBatches = await db
        .select({ id: inventoryImportBatches.id, inventoryDate: inventoryImportBatches.inventoryDate })
        .from(inventoryImportBatches)
        .where(
          and(
            // @ts-ignore
            eq(inventoryImportBatches.companyId, companyId),
            // @ts-ignore
            eq(inventoryImportBatches.sourceSystem, 'ORDERLY'),
            // @ts-ignore
            eq(inventoryImportBatches.status, 'approved'),
          ),
        );

      // Filter to batches with May dates
      const mayBatch = mayBatches.find((b: { id: string; inventoryDate: string | null }) => {
        if (!b.inventoryDate) return false;
        const d = new Date(b.inventoryDate);
        return d.getMonth() === 4 && d.getFullYear() === inventoryDate.getFullYear();
      });

      if (mayBatch) {
        // Load May rows keyed by sourceItemCode
        const mayRows = await db
          .select({
            sourceItemCode: inventoryImportRows.sourceItemCode,
            totalCost: inventoryImportRows.totalCost,
          })
          .from(inventoryImportRows)
          // @ts-ignore
          .where(eq(inventoryImportRows.batchId, mayBatch.id));

        const mayByCodes = new Map<string, number>(
          mayRows
            .filter((r: { sourceItemCode: string | null; totalCost: number | null }) => r.sourceItemCode)
            .map((r: { sourceItemCode: string | null; totalCost: number | null }) => [r.sourceItemCode!, r.totalCost ?? 0]),
        );

        // Compare June's embedded Previous columns against May actuals
        for (const row of batchRows) {
          if (
            !row.sourceItemCode ||
            row.previousCost == null ||
            row.previousCost === 0
          )
            continue;
          const mayCost = mayByCodes.get(row.sourceItemCode);
          if (mayCost == null) continue;
          const delta = Math.abs(row.previousCost - mayCost);
          const deltaPercent = mayCost > 0 ? delta / mayCost : delta > 0 ? 1 : 0;
          if (deltaPercent > 0.001) {
            // Flag discrepancies > 0.1%
            crossReferenceDiscrepancies.push({
              rowIndex: row.rowIndex,
              sourceItemCode: row.sourceItemCode,
              description: row.cleanedDescription ?? row.rawDescription ?? null,
              juneEmbeddedPreviousCost: row.previousCost,
              mayActualCost: mayCost,
              delta,
              deltaPercent,
            });
          }
        }
      }
    }
  }

  return {
    batchId,
    inventoryDate: batch.inventoryDate ?? null,
    originalFilename: batch.originalFilename,
    sourceRowCount: batch.sourceRowCount,
    snapshotTotal,
    includedRows,
    excludedRows,
    importableTotal,
    reconciliationDelta,
    reconciliationDeltaPct,
    reconciliationExceedsTolerance,
    reconciliationTolerance: tolerance,
    locations: Array.from(locationNames).sort(),
    duplicateWarnings,
    crossReferenceDiscrepancies,
  };
}

export async function createCountSession(
  params: CreateCountSessionParams,
): Promise<CreateCountSessionResult> {
  const {
    batchId,
    companyId,
    userId,
    storeId,
    acknowledgedVariance = false,
    reconciliationTolerance = DEFAULT_RECONCILIATION_TOLERANCE,
  } = params;

  // Run preview to validate state
  const preview = await previewCountSession(batchId, companyId, {
    tolerance: reconciliationTolerance,
  });

  if (preview.reconciliationExceedsTolerance && !acknowledgedVariance) {
    const pct = ((preview.reconciliationDeltaPct ?? 0) * 100).toFixed(2);
    throw new Error(
      `Reconciliation variance (${pct}%) exceeds tolerance (${(reconciliationTolerance * 100).toFixed(1)}%). ` +
      `Set acknowledgedVariance: true to proceed anyway.`,
    );
  }

  if (preview.includedRows.length === 0) {
    throw new Error('No rows with resolved items are available to import into a count session.');
  }

  // Idempotency: block if this batch already has a count session (same sourceBatchId)
  const [existingSession] = await db
    .select({ id: inventoryCounts.id, name: inventoryCounts.name })
    .from(inventoryCounts)
    // @ts-ignore
    .where(eq(inventoryCounts.sourceBatchId, batchId))
    .limit(1);
  if (existingSession) {
    throw Object.assign(
      new Error(
        `A count session for this batch already exists (id: ${existingSession.id}). ` +
        `Session name: "${existingSession.name}". Remove the existing session before creating a new one.`,
      ),
      { code: 'ALREADY_CONVERTED', countSessionId: existingSession.id },
    );
  }

  // Load batch metadata (already validated by preview)
  const [batch] = await db
    .select()
    .from(inventoryImportBatches)
    // @ts-ignore
    .where(eq(inventoryImportBatches.id, batchId))
    .limit(1);

  const inventoryDateStr = batch.inventoryDate ?? new Date().toISOString().split('T')[0];
  const [y, m, d] = inventoryDateStr.split('-').map(Number);
  const countDate = new Date(Date.UTC(y, m - 1, d));

  // Fetch all inventory items to get unit costs
  const allItemIds = Array.from(new Set(preview.includedRows.map(r => r.inventoryItemId)));
  type ItemRow = { id: string; unitId: string; pricePerUnit: number };
  const itemsData: ItemRow[] = allItemIds.length > 0
    ? await db
        .select({
          id: inventoryItems.id,
          unitId: inventoryItems.unitId,
          pricePerUnit: inventoryItems.pricePerUnit,
        })
        .from(inventoryItems)
        // @ts-ignore
        .where(inArray(inventoryItems.id, allItemIds))
    : [];
  const itemsById = new Map<string, ItemRow>(itemsData.map((i: ItemRow) => [i.id, i]));

  // Get default unit IDs for items (for count lines)
  const allUnitIds = Array.from(new Set(itemsData.map((i: ItemRow) => i.unitId)));
  const unitsData = allUnitIds.length > 0
    // @ts-ignore
    ? await db.select({ id: units.id }).from(units).where(inArray(units.id, allUnitIds))
    : [];
  const validUnitIds = new Set(unitsData.map((u: { id: string }) => u.id));

  // Ensure we have a fallback unit (any "count" kind)
  let fallbackUnitId = allUnitIds[0] ?? '';

  // Resolve/create storage locations (company-scoped storageLocations table)
  const existingStorageLocs = await db
    .select({ id: storageLocations.id, name: storageLocations.name })
    .from(storageLocations)
    // @ts-ignore
    .where(eq(storageLocations.companyId, companyId));

  const storageLocMap = new Map<string, string>(
    existingStorageLocs.map((l: { id: string; name: string }) => [normalizeLocationName(l.name), l.id]),
  );

  // Everything in one transaction
  let locationsCreated = 0;
  let linesCreated = 0;
  let finalCountId = '';

  const sessionName = `Imported from Orderly — ${batch.originalFilename} — ${inventoryDateStr}`;

  await db.transaction(async (tx: any) => {
    // Create storageLocations entries for any new locations
    for (const locName of preview.locations) {
      const norm = normalizeLocationName(locName);
      if (!storageLocMap.has(norm)) {
        const [newLoc] = await tx
          .insert(storageLocations)
          .values({ companyId, name: locName, sortOrder: 0 })
          .returning({ id: storageLocations.id });
        storageLocMap.set(norm, newLoc.id);
        locationsCreated++;
      }
    }

    // Create the inventory_counts row
    const [countRow] = await tx
      .insert(inventoryCounts)
      .values({
        companyId,
        storeId,
        countDate,
        userId: userId ?? 'system',
        name: sessionName,
        note: `Historical snapshot imported from Orderly. Source rows: ${batch.sourceRowCount}. Reconciliation delta: ${preview.reconciliationDelta != null ? '$' + preview.reconciliationDelta.toFixed(2) : 'N/A'}.`,
        applied: 0,
        isPowerSession: 0,
        sourceSystem: 'ORDERLY',
        sourceBatchId: batchId,
        sourceFilename: batch.originalFilename,
        sourceInventoryDate: inventoryDateStr,
        importedSnapshotTotal: preview.snapshotTotal,
      })
      .returning({ id: inventoryCounts.id });
    finalCountId = countRow.id;

    // Aggregate rows by (inventoryItemId, storageLocation) — deduplicate.
    // Track totalCostAccum and qtyAccum separately so merged lines get a
    // correct weighted-average unit cost rather than keeping the first row's cost.
    const lineMap = new Map<string, {
      inventoryItemId: string;
      storageLocationId: string;
      qty: number;
      totalCostAccum: number; // running total of extended cost for weighted avg
      caseQty: number | null;      // tier 1: full cases (count1)
      containerQty: number | null; // tier 2: inner packs / containers (count2)
      looseUnits: number | null;   // tier 3: loose base units (count3)
      unitId: string;
    }>();

    for (const row of preview.includedRows) {
      const item = itemsById.get(row.inventoryItemId);
      const unitId = item?.unitId && validUnitIds.has(item.unitId) ? item.unitId : fallbackUnitId;
      const qty = row.totalUnits ?? (row.count1 ?? 0) + (row.count2 ?? 0) + (row.count3 ?? 0);
      // Derive extended cost from snapshot economics — use row.totalCost directly
      // (Orderly already computed this), then fall back to packagePrice or current price.
      let extendedCost: number;
      if (row.totalCost != null && row.totalCost > 0) {
        extendedCost = row.totalCost;
      } else if (row.packagePrice != null && row.packagePrice > 0 && qty > 0) {
        extendedCost = row.packagePrice * qty;
      } else {
        extendedCost = (item?.pricePerUnit ?? 0) * qty;
      }

      const locName = row.storageLocation ?? 'General Storage';
      const norm = normalizeLocationName(locName);
      let storageLocId = storageLocMap.get(norm);
      if (!storageLocId) {
        // Create on-the-fly for unlisted locations
        const [newLoc] = await tx
          .insert(storageLocations)
          .values({ companyId, name: locName, sortOrder: 0 })
          .returning({ id: storageLocations.id });
        storageLocId = newLoc.id as string;
        storageLocMap.set(norm, storageLocId);
        locationsCreated++;
      }

      const key = `${row.inventoryItemId}::${storageLocId}`;
      if (lineMap.has(key)) {
        // Merge duplicate: accumulate qty and cost for weighted-average unit cost
        const existing = lineMap.get(key)!;
        existing.qty += qty;
        existing.totalCostAccum += extendedCost;
        if (row.count1 != null) existing.caseQty = (existing.caseQty ?? 0) + row.count1;
        if (row.count2 != null) existing.containerQty = (existing.containerQty ?? 0) + row.count2;
        if (row.count3 != null) existing.looseUnits = (existing.looseUnits ?? 0) + row.count3;
      } else {
        lineMap.set(key, {
          inventoryItemId: row.inventoryItemId,
          storageLocationId: storageLocId!,
          qty,
          totalCostAccum: extendedCost,
          caseQty: row.count1 ?? null,
          containerQty: row.count2 ?? null,
          looseUnits: row.count3 ?? null,
          unitId,
        });
      }
    }

    // Insert count lines — compute weighted unit cost from accumulated totals
    const lineValues = Array.from(lineMap.values()).map(l => {
      const unitCost = l.qty > 0 ? l.totalCostAccum / l.qty : 0;
      return {
        inventoryCountId: finalCountId,
        inventoryItemId: l.inventoryItemId,
        storageLocationId: l.storageLocationId,
        qty: l.qty,
        caseQty: l.caseQty,
        containerQty: l.containerQty,
        looseUnits: l.looseUnits,
        unitId: l.unitId,
        unitCost,
      };
    });

    // Insert in chunks
    const CHUNK = 500;
    for (let i = 0; i < lineValues.length; i += CHUNK) {
      await tx.insert(inventoryCountLines).values(lineValues.slice(i, i + CHUNK));
    }
    linesCreated = lineValues.length;
  });

  return {
    countId: finalCountId,
    inventoryDate: inventoryDateStr,
    name: sessionName,
    linesCreated,
    importableTotal: preview.importableTotal,
    reconciliationDelta: preview.reconciliationDelta,
    reconciliationDeltaPct: preview.reconciliationDeltaPct,
    locationsCreated,
  };
}
