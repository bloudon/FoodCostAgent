/**
 * Orderly Onboarding Reconciliation Report
 *
 * Aggregates data from all approved Orderly import batches for a company to produce:
 *   1. Per-batch import summary
 *   2. Per-batch snapshot reconciliation (imported total vs Orderly source total)
 *   3. Period-over-period item comparison (May → June snapshot variance — NOT usage)
 *   4. Data quality flags
 *
 * Language note: Period-over-period diffs are "snapshot variance" / "value change".
 * "Actual usage" is NEVER used here — that requires BI + Purchases − EI − Waste.
 */

import { db } from '../../db';
import { sql, eq, and, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItems,
  type InventoryImportBatch,
} from '@shared/schema';

// ─── Public types ────────────────────────────────────────────────────────────

export interface BatchImportSummary {
  batchId: string;
  filename: string;
  inventoryDate: string | null;
  approvedAt: string | null;
  sourceRowCount: number;
  // Rows
  importedRowCount: number;   // resolvedInventoryItemId IS NOT NULL
  excludedRowCount: number;   // resolvedInventoryItemId IS NULL
  // Snapshot totals
  snapshotTotal: number | null;         // from batch record (Orderly export sum)
  importedTotal: number;                // sum(totalCost) for imported rows
  reconciliationDelta: number | null;   // importedTotal - snapshotTotal
  reconciliationDeltaPct: number | null;
  // Pack geometry
  packParseOk: number;
  packParsePartial: number;
  packParseUnparseable: number;
  // Item code quality
  itemCodeValid: number;
  itemCodePlaceholder: number;
  itemCodeBlank: number;
  itemCodeNonUnique: number;
  // Vendor quality
  vendorValid: number;
  vendorInvalid: number; // blank + placeholder + ambiguous
  // Location assignments
  uniqueLocations: number;
}

export interface PeriodItem {
  inventoryItemId: string;
  description: string;                  // from inventoryItems
  earlierBatchFilename: string;
  laterBatchFilename: string;
  earlierDate: string | null;
  laterDate: string | null;
  // Snapshot values
  earlierTotalCost: number | null;
  laterTotalCost: number | null;
  // Unit counts
  earlierTotalUnits: number | null;
  laterTotalUnits: number | null;
  // Unit costs (packagePrice or derived)
  earlierUnitCost: number | null;
  laterUnitCost: number | null;
  // Locations
  earlierLocation: string | null;
  laterLocation: string | null;
  // Derived
  costDelta: number | null;             // later - earlier (snapshot variance, NOT usage)
  costDeltaPct: number | null;
  changeFlags: ChangeFlag[];
}

export type ChangeFlag =
  | 'added'          // present only in later snapshot
  | 'removed'        // present only in earlier snapshot
  | 'price_changed'  // unit cost differs > 1%
  | 'count_changed'  // totalUnits differs > 0
  | 'location_changed'
  | 'no_change';

export interface DataQualityFlag {
  category: string;
  label: string;
  count: number;
  affectedBatches: string[];
  note: string;
}

export interface ReconciliationReport {
  generatedAt: string;
  companyId: string;
  batches: BatchImportSummary[];
  /** null when fewer than 2 approved batches exist */
  periodComparison: {
    earlierBatch: { batchId: string; filename: string; inventoryDate: string | null };
    laterBatch: { batchId: string; filename: string; inventoryDate: string | null };
    addedCount: number;
    removedCount: number;
    priceChangedCount: number;
    countChangedCount: number;
    locationChangedCount: number;
    noChangeCount: number;
    snapshotValueChangeTotal: number | null;
    items: PeriodItem[];
  } | null;
  dataQualityFlags: DataQualityFlag[];
}

// ─── Pure aggregation helpers (exported for unit testing) ────────────────────

/**
 * One aggregated record per resolved inventory item within a single batch.
 * Multiple source rows can map to the same item (e.g. across storage locations).
 */
export interface ItemAggregate {
  totalCost: number;
  totalUnits: number;
  /** Normalized (lowercase trimmed) location names collected from all rows */
  locations: Set<string>;
  /** First packagePrice seen — used when totalUnits = 0 to avoid divide-by-zero */
  fallbackUnitCost: number | null;
  fallbackDescription: string | null;
  fallbackItemCodeStatus: string | null;
}

/** Minimal row shape accepted by aggregateRows (subset of InventoryImportRow) */
export interface AggregateInputRow {
  resolvedInventoryItemId: string | null;
  totalCost: number | null;
  totalUnits: number | null;
  storageLocation: string | null;
  packagePrice: number | null;
  cleanedDescription: string | null;
  itemCodeStatus: string | null;
}

/**
 * Aggregate all source rows for each resolved inventory item within one batch.
 *
 * An item can appear on multiple rows when it spans several storage locations
 * (e.g. walk-in + dry-storage). We sum totalCost and totalUnits across all of
 * those rows so the item totals are correct, and we collect the full set of
 * locations so location-change detection compares sets rather than single strings.
 *
 * Effective unit cost is derived from the aggregate (cost / units) so it is
 * consistent regardless of row order. If totalUnits is zero or absent we fall
 * back to the first non-null packagePrice found among the item's rows.
 */
export function aggregateRows(rows: AggregateInputRow[]): Map<string, ItemAggregate> {
  const map = new Map<string, ItemAggregate>();
  for (const r of rows) {
    if (!r.resolvedInventoryItemId) continue;
    const id = r.resolvedInventoryItemId;
    let agg = map.get(id);
    if (!agg) {
      agg = {
        totalCost: 0,
        totalUnits: 0,
        locations: new Set(),
        fallbackUnitCost: null,
        fallbackDescription: null,
        fallbackItemCodeStatus: null,
      };
      map.set(id, agg);
    }
    agg.totalCost  += r.totalCost  ?? 0;
    agg.totalUnits += r.totalUnits ?? 0;
    if (r.storageLocation) {
      agg.locations.add(r.storageLocation.toLowerCase().trim());
    }
    if (agg.fallbackUnitCost == null && r.packagePrice != null) {
      agg.fallbackUnitCost = r.packagePrice;
    }
    if (agg.fallbackDescription == null && r.cleanedDescription) {
      agg.fallbackDescription = r.cleanedDescription;
    }
    if (agg.fallbackItemCodeStatus == null && r.itemCodeStatus) {
      agg.fallbackItemCodeStatus = r.itemCodeStatus;
    }
  }
  return map;
}

/**
 * Derive effective unit cost from aggregate.
 * Uses totalCost / totalUnits when units > 0; falls back to packagePrice otherwise.
 */
export function effectiveUnitCost(agg: ItemAggregate): number | null {
  if (agg.totalUnits > 0) return agg.totalCost / agg.totalUnits;
  return agg.fallbackUnitCost;
}

/**
 * Serialize a location set for comparison — sorted, pipe-joined.
 * Two aggregates have the same location set iff their keys match.
 */
export function locationKey(s: Set<string>): string {
  return Array.from(s).sort().join('|');
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getReconciliationReport(companyId: string): Promise<ReconciliationReport> {
  // 1. Load all approved batches, ordered by inventory date
  const approvedBatches: InventoryImportBatch[] = await db
    .select()
    .from(inventoryImportBatches)
    .where(
      and(
        eq(inventoryImportBatches.companyId, companyId),
        eq(inventoryImportBatches.sourceSystem, 'ORDERLY'),
        eq(inventoryImportBatches.status, 'approved'),
      ),
    )
    .orderBy(sql`${inventoryImportBatches.inventoryDate} ASC NULLS LAST`);

  if (approvedBatches.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      companyId,
      batches: [],
      periodComparison: null,
      dataQualityFlags: [],
    };
  }

  // 2. Load all rows for these batches in one query
  const batchIds = approvedBatches.map((b) => b.id);
  const allRows = await db
    .select()
    .from(inventoryImportRows)
    .where(inArray(inventoryImportRows.batchId, batchIds));

  // 3. Group rows by batchId
  const rowsByBatch = new Map<string, typeof allRows>();
  for (const b of approvedBatches) rowsByBatch.set(b.id, []);
  for (const r of allRows) {
    const arr = rowsByBatch.get(r.batchId);
    if (arr) arr.push(r);
  }

  // 4. Compute per-batch summaries
  const batches: BatchImportSummary[] = approvedBatches.map((batch) => {
    const rows = rowsByBatch.get(batch.id) ?? [];

    const imported  = rows.filter((r) => r.resolvedInventoryItemId != null);
    const excluded  = rows.filter((r) => r.resolvedInventoryItemId == null);
    const importedTotal = imported.reduce((s, r) => s + (r.totalCost ?? 0), 0);

    const snapshotTotal = batch.snapshotTotal ?? null;
    const reconciliationDelta = snapshotTotal != null ? importedTotal - snapshotTotal : null;
    const reconciliationDeltaPct =
      snapshotTotal != null && snapshotTotal > 0
        ? (Math.abs(reconciliationDelta!) / snapshotTotal) * 100
        : null;

    const uniqueLocations = new Set(
      rows.map((r) => r.storageLocation).filter((x): x is string => x != null),
    ).size;

    return {
      batchId: batch.id,
      filename: batch.originalFilename,
      inventoryDate: batch.inventoryDate,
      approvedAt: batch.approvedAt?.toISOString() ?? null,
      sourceRowCount: batch.sourceRowCount,
      importedRowCount: imported.length,
      excludedRowCount: excluded.length,
      snapshotTotal,
      importedTotal,
      reconciliationDelta,
      reconciliationDeltaPct,
      packParseOk:          rows.filter((r) => r.packParseStatus === 'ok').length,
      packParsePartial:     rows.filter((r) => r.packParseStatus === 'partial').length,
      packParseUnparseable: rows.filter((r) => r.packParseStatus === 'unparseable').length,
      itemCodeValid:      rows.filter((r) => r.itemCodeStatus === 'valid').length,
      itemCodePlaceholder: rows.filter((r) => r.itemCodeStatus === 'placeholder').length,
      itemCodeBlank:       rows.filter((r) => r.itemCodeStatus === 'blank').length,
      itemCodeNonUnique:   rows.filter((r) => r.itemCodeStatus === 'non_unique').length,
      vendorValid:   rows.filter((r) => r.supplierStatus === 'valid').length,
      vendorInvalid: rows.filter((r) => r.supplierStatus !== 'valid').length,
      uniqueLocations,
    };
  });

  // 5. Period-over-period comparison (uses the two most date-adjacent batches)
  let periodComparison: ReconciliationReport['periodComparison'] = null;

  if (approvedBatches.length >= 2) {
    const earlier = approvedBatches[approvedBatches.length - 2];
    const later   = approvedBatches[approvedBatches.length - 1];
    const earlierRows = rowsByBatch.get(earlier.id) ?? [];
    const laterRows   = rowsByBatch.get(later.id) ?? [];

    const earlierAgg = aggregateRows(earlierRows);
    const laterAgg   = aggregateRows(laterRows);

    // Union of all resolved item IDs across both batches
    const allItemIds = new Set([...earlierAgg.keys(), ...laterAgg.keys()]);

    // Load item names in one query
    const itemIdArr = Array.from(allItemIds);
    const itemNameRows = itemIdArr.length > 0
      ? await db
          .select({ id: inventoryItems.id, name: inventoryItems.name })
          .from(inventoryItems)
          .where(inArray(inventoryItems.id, itemIdArr))
      : [];
    const itemNameMap = new Map(itemNameRows.map((i) => [i.id, i.name]));

    const items: PeriodItem[] = [];

    for (const itemId of allItemIds) {
      const er = earlierAgg.get(itemId) ?? null;
      const lr = laterAgg.get(itemId)   ?? null;

      const changeFlags: ChangeFlag[] = [];
      if (!er) {
        changeFlags.push('added');
      } else if (!lr) {
        changeFlags.push('removed');
      } else {
        // Unit cost comparison — derived from aggregated totals
        const erUc = effectiveUnitCost(er);
        const lrUc = effectiveUnitCost(lr);
        if (erUc != null && lrUc != null && Math.abs(lrUc - erUc) / Math.max(erUc, 0.0001) > 0.01) {
          changeFlags.push('price_changed');
        }
        // Count change — compare aggregate totalUnits
        if (Math.abs(er.totalUnits - lr.totalUnits) > 0.0001) changeFlags.push('count_changed');
        // Location change — compare normalized sets, not single strings
        if (locationKey(er.locations) !== locationKey(lr.locations)) changeFlags.push('location_changed');
        if (changeFlags.length === 0) changeFlags.push('no_change');
      }

      const erCost = er ? er.totalCost : null;
      const lrCost = lr ? lr.totalCost : null;
      const costDelta =
        erCost != null && lrCost != null ? lrCost - erCost : null;
      const costDeltaPct =
        costDelta != null && erCost != null && erCost > 0
          ? (costDelta / erCost) * 100
          : null;

      // Location display: sorted, semicolon-separated (may be multi-location)
      const erLocStr = er && er.locations.size > 0
        ? Array.from(er.locations).sort().join('; ')
        : null;
      const lrLocStr = lr && lr.locations.size > 0
        ? Array.from(lr.locations).sort().join('; ')
        : null;

      const description =
        itemNameMap.get(itemId) ??
        er?.fallbackDescription ??
        lr?.fallbackDescription ??
        itemId;

      items.push({
        inventoryItemId: itemId,
        description,
        earlierBatchFilename: earlier.originalFilename,
        laterBatchFilename:   later.originalFilename,
        earlierDate: earlier.inventoryDate,
        laterDate:   later.inventoryDate,
        earlierTotalCost:  erCost,
        laterTotalCost:    lrCost,
        earlierTotalUnits: er ? er.totalUnits : null,
        laterTotalUnits:   lr ? lr.totalUnits : null,
        earlierUnitCost:   er ? effectiveUnitCost(er) : null,
        laterUnitCost:     lr ? effectiveUnitCost(lr) : null,
        earlierLocation:   erLocStr,
        laterLocation:     lrLocStr,
        costDelta,
        costDeltaPct,
        changeFlags,
      });
    }

    // Sort: added → removed → price_changed → count_changed → location_changed → no_change
    const flagOrder: Record<ChangeFlag, number> = {
      added: 0, removed: 1, price_changed: 2, count_changed: 3, location_changed: 4, no_change: 5,
    };
    items.sort((a, b) => {
      const af = flagOrder[a.changeFlags[0]] ?? 9;
      const bf = flagOrder[b.changeFlags[0]] ?? 9;
      return af !== bf ? af - bf : a.description.localeCompare(b.description);
    });

    const snapshotValueChangeTotal =
      items.reduce<number | null>((acc, it) => {
        if (it.costDelta == null) return acc;
        return (acc ?? 0) + it.costDelta;
      }, null);

    periodComparison = {
      earlierBatch: { batchId: earlier.id, filename: earlier.originalFilename, inventoryDate: earlier.inventoryDate },
      laterBatch:   { batchId: later.id,   filename: later.originalFilename,   inventoryDate: later.inventoryDate },
      addedCount:           items.filter((i) => i.changeFlags.includes('added')).length,
      removedCount:         items.filter((i) => i.changeFlags.includes('removed')).length,
      priceChangedCount:    items.filter((i) => i.changeFlags.includes('price_changed')).length,
      countChangedCount:    items.filter((i) => i.changeFlags.includes('count_changed')).length,
      locationChangedCount: items.filter((i) => i.changeFlags.includes('location_changed')).length,
      noChangeCount:        items.filter((i) => i.changeFlags.includes('no_change')).length,
      snapshotValueChangeTotal,
      items,
    };
  }

  // 6. Data quality flags
  const dataQualityFlags: DataQualityFlag[] = [];

  // Flag: items matched by name/pack only (not by source code) — re-import risk
  const nonCodeRows = allRows.filter(
    (r) => r.resolvedInventoryItemId != null && r.itemCodeStatus !== 'valid',
  );
  if (nonCodeRows.length > 0) {
    const batchFilenames = [...new Set(nonCodeRows.map((r) => {
      const b = approvedBatches.find((b) => b.id === r.batchId);
      return b?.originalFilename ?? r.batchId;
    }))];
    dataQualityFlags.push({
      category: 'match_quality',
      label: 'Items matched without a valid source code',
      count: nonCodeRows.length,
      affectedBatches: batchFilenames,
      note: 'These items were matched by name and pack geometry. Future re-imports will attempt to re-match them the same way. Confirm descriptions and pack sizes are consistent to avoid drift.',
    });
  }

  // Flag: rows excluded (no resolved item)
  const excludedRows = allRows.filter((r) => r.resolvedInventoryItemId == null);
  if (excludedRows.length > 0) {
    const batchFilenames = [...new Set(excludedRows.map((r) => {
      const b = approvedBatches.find((b) => b.id === r.batchId);
      return b?.originalFilename ?? r.batchId;
    }))];
    dataQualityFlags.push({
      category: 'excluded_rows',
      label: 'Rows excluded from import (no resolved item)',
      count: excludedRows.length,
      affectedBatches: batchFilenames,
      note: 'These rows did not match any existing inventory item and were not created during approval. Review whether they represent items that should be in the catalog.',
    });
  }

  // Flag: items with no vendor assigned
  const noVendorRows = allRows.filter(
    (r) => r.resolvedInventoryItemId != null && r.supplierStatus !== 'valid',
  );
  if (noVendorRows.length > 0) {
    const batchFilenames = [...new Set(noVendorRows.map((r) => {
      const b = approvedBatches.find((b) => b.id === r.batchId);
      return b?.originalFilename ?? r.batchId;
    }))];
    dataQualityFlags.push({
      category: 'vendor_coverage',
      label: 'Imported items with no valid vendor assigned',
      count: noVendorRows.length,
      affectedBatches: batchFilenames,
      note: 'Supplier field was blank, a placeholder code, or ambiguous. These items were imported without a vendor-item link. Vendor pricing, purchasing and vendor comparisons will not be available until a vendor is assigned.',
    });
  }

  // Flag: partial pack geometry
  const partialPackRows = allRows.filter(
    (r) => r.resolvedInventoryItemId != null && (r.packParseStatus === 'partial' || r.packParseStatus === 'unparseable'),
  );
  if (partialPackRows.length > 0) {
    const batchFilenames = [...new Set(partialPackRows.map((r) => {
      const b = approvedBatches.find((b) => b.id === r.batchId);
      return b?.originalFilename ?? r.batchId;
    }))];
    dataQualityFlags.push({
      category: 'pack_geometry',
      label: 'Items with partial or unparseable pack geometry',
      count: partialPackRows.length,
      affectedBatches: batchFilenames,
      note: 'Pack size, inner pack count or base unit could not be fully parsed. Unit cost calculations and order quantity estimates may be less accurate for these items.',
    });
  }

  // Flag: items with par target in Orderly (useful to know which have par data)
  const withParTarget = allRows.filter(
    (r) => r.resolvedInventoryItemId != null && r.sourceParTarget != null && r.sourceParTarget > 0,
  );
  if (withParTarget.length > 0) {
    dataQualityFlags.push({
      category: 'par_targets',
      label: 'Items with par targets from Orderly',
      count: withParTarget.length,
      affectedBatches: [...new Set(withParTarget.map((r) => {
        const b = approvedBatches.find((b) => b.id === r.batchId);
        return b?.originalFilename ?? r.batchId;
      }))],
      note: 'These items had par target values in the Orderly export. Par targets were staged but not automatically applied to inventory par levels. Review and confirm them in inventory settings.',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    companyId,
    batches,
    periodComparison,
    dataQualityFlags,
  };
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export function reportToCsvRows(report: ReconciliationReport): string {
  const lines: string[] = [];

  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  // Section 1: batch summaries
  lines.push('IMPORT SUMMARY');
  lines.push([
    'File', 'Inventory Date', 'Source Rows', 'Imported Rows', 'Excluded Rows',
    'Orderly Total', 'Imported Total', 'Delta $', 'Delta %',
    'Pack Parse OK', 'Pack Parse Partial', 'Pack Parse Unparseable',
    'Item Code Valid', 'Item Code Placeholder', 'Item Code Blank', 'Item Code Non-Unique',
    'Vendor Valid', 'Vendor Invalid', 'Unique Locations',
  ].map(esc).join(','));
  for (const b of report.batches) {
    lines.push([
      b.filename, b.inventoryDate, b.sourceRowCount, b.importedRowCount, b.excludedRowCount,
      b.snapshotTotal?.toFixed(2) ?? '', b.importedTotal.toFixed(2),
      b.reconciliationDelta?.toFixed(2) ?? '', b.reconciliationDeltaPct?.toFixed(3) ?? '',
      b.packParseOk, b.packParsePartial, b.packParseUnparseable,
      b.itemCodeValid, b.itemCodePlaceholder, b.itemCodeBlank, b.itemCodeNonUnique,
      b.vendorValid, b.vendorInvalid, b.uniqueLocations,
    ].map(esc).join(','));
  }

  lines.push('');

  // Section 2: period comparison (if available)
  if (report.periodComparison) {
    const pc = report.periodComparison;
    lines.push('PERIOD-OVER-PERIOD SNAPSHOT COMPARISON');
    lines.push([
      'Description',
      `${pc.earlierBatch.inventoryDate ?? 'Earlier'} Total Cost`,
      `${pc.laterBatch.inventoryDate ?? 'Later'} Total Cost`,
      'Cost Delta $', 'Cost Delta %',
      `${pc.earlierBatch.inventoryDate ?? 'Earlier'} Units`,
      `${pc.laterBatch.inventoryDate ?? 'Later'} Units`,
      `${pc.earlierBatch.inventoryDate ?? 'Earlier'} Unit Cost`,
      `${pc.laterBatch.inventoryDate ?? 'Later'} Unit Cost`,
      `${pc.earlierBatch.inventoryDate ?? 'Earlier'} Location`,
      `${pc.laterBatch.inventoryDate ?? 'Later'} Location`,
      'Change Type',
    ].map(esc).join(','));
    for (const item of pc.items) {
      lines.push([
        item.description,
        item.earlierTotalCost?.toFixed(2) ?? '',
        item.laterTotalCost?.toFixed(2) ?? '',
        item.costDelta?.toFixed(2) ?? '',
        item.costDeltaPct?.toFixed(2) ?? '',
        item.earlierTotalUnits ?? '',
        item.laterTotalUnits ?? '',
        item.earlierUnitCost?.toFixed(4) ?? '',
        item.laterUnitCost?.toFixed(4) ?? '',
        item.earlierLocation ?? '',
        item.laterLocation ?? '',
        item.changeFlags.join('+'),
      ].map(esc).join(','));
    }
    lines.push('');
  }

  // Section 3: data quality flags
  lines.push('DATA QUALITY FLAGS');
  lines.push(['Category', 'Label', 'Count', 'Affected Files', 'Note'].map(esc).join(','));
  for (const flag of report.dataQualityFlags) {
    lines.push([
      flag.category, flag.label, flag.count, flag.affectedBatches.join('; '), flag.note,
    ].map(esc).join(','));
  }

  return lines.join('\n');
}
