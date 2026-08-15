/**
 * Read-only discovery diagnostics for the Orderly duplicate remediation scope.
 *
 * Purpose: answer "why did REPORT MODE examine zero groups?" from actual data,
 * before anything about discovery is changed. Every statement here is a SELECT.
 * There is no write path, no transaction, and no dependency on the remediation
 * service's own scope resolution — that is precisely what is under suspicion,
 * so this module re-derives everything from raw columns.
 *
 * The central question is which of discovery's batch predicates eliminates the
 * batches. Discovery requires ALL of:
 *   company + source system + status='approved' + target_store_id = scope store
 *   + coalesce(source_property_id, '') = scope property
 * so this reports each predicate's surviving count independently, which is what
 * distinguishes "no data" from "data excluded by one predicate".
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  importSourcePropertyBindings,
  inventoryCountLines,
  inventoryCounts,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItemExternalMappings,
  inventoryItems,
} from '@workspace/db';
import type { RemediationScope } from './orderlyDuplicateRemediation';

/** The diagnostic accepts a scope shape without depending on scope resolution. */
export type RemediationScopeLike = RemediationScope;

export interface BatchScopeRow {
  batchId: string;
  status: string;
  targetStoreId: string | null;
  sourcePropertyId: string | null;
  sourcePropertyBindingId: string | null;
  inventoryDate: string | null;
  rowCount: number;
}

export interface PredicateFunnel {
  companyAndSystem: number;
  plusApproved: number;
  plusTargetStore: number;
  plusSourceProperty: number;
  /** What discovery actually selects (all predicates together). */
  discoverySelected: number;
}

export interface TracedImportRow {
  batchId: string;
  rowIndex: number;
  sourceItemCode: string | null;
  itemCodeStatus: string | null;
  cleanedDescription: string | null;
  storageLocation: string | null;
  resolvedInventoryItemId: string | null;
  batchStatus: string;
  batchTargetStoreId: string | null;
  batchSourcePropertyId: string | null;
  batchInventoryDate: string | null;
}

export interface TracedItem {
  itemId: string;
  companyId: string;
  name: string;
  active: number;
  supersededByItemId: string | null;
  pluSku: string | null;
  barcode: string | null;
  /** inventory_items has no created_at; updated_at is the only item timestamp. */
  updatedAt: string | null;
  mappings: Array<{ sourcePropertyId: string | null; sourceExternalId: string }>;
  countLines: number;
  countSessions: number;
  importRows: number;
}

export interface DiscoveryDiagnostics {
  scope: RemediationScopeLike;
  bindings: Array<{
    sourcePropertyId: string;
    destinationStoreId: string;
    active: number;
    label: string | null;
  }>;
  batches: BatchScopeRow[];
  funnel: PredicateFunnel;
  /** Distinct stored source-property values on this company's batches. */
  distinctBatchProperties: Array<{ value: string | null; batches: number }>;
  /** Distinct stored source-property values on this company's mappings. */
  distinctMappingProperties: Array<{ value: string | null; mappings: number }>;
  tracedCode: string | null;
  tracedRows: TracedImportRow[];
  tracedItems: TracedItem[];
  /** Item ids sharing the traced name, whether or not they carry provenance. */
  tracedByName: string[];
  exclusionVerdict: string;
}

function asNumber(value: unknown): number {
  return Number((value as { n?: number | string })?.n ?? 0);
}

/**
 * Runs the full read-only diagnosis. `itemNameLike` (e.g. "Tabasco") is used to
 * locate the known production case when its source code is not known up front.
 */
export async function diagnoseDiscovery(
  scope: RemediationScopeLike,
  itemNameLike: string,
  runner: typeof db = db,
): Promise<DiscoveryDiagnostics> {
  const bindings = (await runner
    .select({
      sourcePropertyId: importSourcePropertyBindings.sourcePropertyId,
      destinationStoreId: importSourcePropertyBindings.destinationStoreId,
      active: importSourcePropertyBindings.active,
      label: importSourcePropertyBindings.sourcePropertyLabel,
    })
    .from(importSourcePropertyBindings)
    .where(
      and(
        eq(importSourcePropertyBindings.companyId, scope.companyId),
        eq(importSourcePropertyBindings.sourceSystem, scope.sourceSystem),
      ),
    )) as DiscoveryDiagnostics['bindings'];

  // Every batch for this company + system, with the columns discovery filters
  // on. Deliberately unfiltered beyond company/system so an excluded batch is
  // visible rather than silently absent.
  const batchRows = (await runner
    .select({
      batchId: inventoryImportBatches.id,
      status: inventoryImportBatches.status,
      targetStoreId: inventoryImportBatches.targetStoreId,
      sourcePropertyId: inventoryImportBatches.sourcePropertyId,
      sourcePropertyBindingId: inventoryImportBatches.sourcePropertyBindingId,
      inventoryDate: inventoryImportBatches.inventoryDate,
    })
    .from(inventoryImportBatches)
    .where(
      and(
        eq(inventoryImportBatches.companyId, scope.companyId),
        eq(inventoryImportBatches.sourceSystem, scope.sourceSystem),
      ),
    )) as Array<Omit<BatchScopeRow, 'rowCount'>>;

  const batchIds = batchRows.map(batch => batch.batchId);
  const rowCounts = new Map<string, number>();
  if (batchIds.length > 0) {
    const counted = (await runner
      .select({
        batchId: inventoryImportRows.batchId,
        n: sql<number>`count(*)`,
      })
      .from(inventoryImportRows)
      .where(inArray(inventoryImportRows.batchId, batchIds))
      .groupBy(inventoryImportRows.batchId)) as Array<{ batchId: string; n: number | string }>;
    for (const row of counted) rowCounts.set(row.batchId, Number(row.n));
  }

  const batches: BatchScopeRow[] = batchRows.map(batch => ({
    ...batch,
    rowCount: rowCounts.get(batch.batchId) ?? 0,
  }));

  // Predicate funnel — each stage adds exactly one of discovery's conditions.
  const approved = batches.filter(batch => batch.status === 'approved');
  const withStore = approved.filter(batch => batch.targetStoreId === scope.storeId);
  const withProperty = approved.filter(
    batch => (batch.sourcePropertyId ?? '') === scope.sourcePropertyId,
  );
  const discoverySelected = withStore.filter(
    batch => (batch.sourcePropertyId ?? '') === scope.sourcePropertyId,
  );
  const funnel: PredicateFunnel = {
    companyAndSystem: batches.length,
    plusApproved: approved.length,
    plusTargetStore: withStore.length,
    plusSourceProperty: withProperty.length,
    discoverySelected: discoverySelected.length,
  };

  const distinctBatchProperties = [
    ...batches.reduce((acc, batch) => {
      const key = batch.sourcePropertyId;
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string | null, number>()),
  ].map(([value, count]) => ({ value, batches: count }));

  const mappingProperties = (await runner
    .select({
      value: inventoryItemExternalMappings.sourcePropertyId,
      n: sql<number>`count(*)`,
    })
    .from(inventoryItemExternalMappings)
    .where(
      and(
        eq(inventoryItemExternalMappings.companyId, scope.companyId),
        eq(inventoryItemExternalMappings.sourceSystem, scope.sourceSystem),
      ),
    )
    .groupBy(inventoryItemExternalMappings.sourcePropertyId)) as Array<{
    value: string | null;
    n: number | string;
  }>;
  const distinctMappingProperties = mappingProperties.map(row => ({
    value: row.value,
    mappings: Number(row.n),
  }));

  // ── Locate the known case by name, then follow it back to a source code ──
  const namedItems = (await runner
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.companyId, scope.companyId),
        sql`${inventoryItems.name} ilike ${`%${itemNameLike}%`}`,
      ),
    )) as Array<{ id: string }>;
  const tracedByName = namedItems.map(item => item.id);

  let tracedCode: string | null = null;
  let tracedRows: TracedImportRow[] = [];
  if (tracedByName.length > 0 && batchIds.length > 0) {
    const codeRows = (await runner
      .select({ sourceItemCode: inventoryImportRows.sourceItemCode })
      .from(inventoryImportRows)
      .where(
        and(
          inArray(inventoryImportRows.batchId, batchIds),
          inArray(inventoryImportRows.resolvedInventoryItemId, tracedByName),
        ),
      )) as Array<{ sourceItemCode: string | null }>;
    tracedCode = codeRows.find(row => row.sourceItemCode?.trim())?.sourceItemCode?.trim() ?? null;

    if (tracedCode) {
      tracedRows = (await runner
        .select({
          batchId: inventoryImportRows.batchId,
          rowIndex: inventoryImportRows.rowIndex,
          sourceItemCode: inventoryImportRows.sourceItemCode,
          itemCodeStatus: inventoryImportRows.itemCodeStatus,
          cleanedDescription: inventoryImportRows.cleanedDescription,
          storageLocation: inventoryImportRows.storageLocation,
          resolvedInventoryItemId: inventoryImportRows.resolvedInventoryItemId,
          batchStatus: inventoryImportBatches.status,
          batchTargetStoreId: inventoryImportBatches.targetStoreId,
          batchSourcePropertyId: inventoryImportBatches.sourcePropertyId,
          batchInventoryDate: inventoryImportBatches.inventoryDate,
        })
        .from(inventoryImportRows)
        .innerJoin(
          inventoryImportBatches,
          eq(inventoryImportBatches.id, inventoryImportRows.batchId),
        )
        .where(
          and(
            eq(inventoryImportBatches.companyId, scope.companyId),
            eq(inventoryImportBatches.sourceSystem, scope.sourceSystem),
            eq(inventoryImportRows.sourceItemCode, tracedCode),
          ),
        )) as TracedImportRow[];
    }
  }

  // ── Per-item detail for every identity the traced code touches ───────────
  const tracedItemIds = [
    ...new Set([
      ...tracedByName,
      ...tracedRows
        .map(row => row.resolvedInventoryItemId)
        .filter((id): id is string => Boolean(id)),
    ]),
  ];

  const tracedItems: TracedItem[] = [];
  for (const itemId of tracedItemIds) {
    const [item] = (await runner
      .select({
        id: inventoryItems.id,
        companyId: inventoryItems.companyId,
        name: inventoryItems.name,
        active: inventoryItems.active,
        supersededByItemId: inventoryItems.supersededByItemId,
        pluSku: inventoryItems.pluSku,
        barcode: inventoryItems.barcode,
        updatedAt: sql<string>`to_char(${inventoryItems.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SSZ')`,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, itemId))) as Array<{
      id: string;
      companyId: string;
      name: string;
      active: number;
      supersededByItemId: string | null;
      pluSku: string | null;
      barcode: string | null;
      updatedAt: string | null;
    }>;
    if (!item) continue;

    const mappings = (await runner
      .select({
        sourcePropertyId: inventoryItemExternalMappings.sourcePropertyId,
        sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
      })
      .from(inventoryItemExternalMappings)
      .where(eq(inventoryItemExternalMappings.inventoryItemId, itemId))) as Array<{
      sourcePropertyId: string | null;
      sourceExternalId: string;
    }>;

    const [lines] = (await runner
      .select({ n: sql<number>`count(*)` })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryItemId, itemId))) as Array<{ n: number | string }>;
    const [sessions] = (await runner
      .select({ n: sql<number>`count(distinct ${inventoryCounts.id})` })
      .from(inventoryCountLines)
      .innerJoin(inventoryCounts, eq(inventoryCounts.id, inventoryCountLines.inventoryCountId))
      .where(eq(inventoryCountLines.inventoryItemId, itemId))) as Array<{ n: number | string }>;
    const [imports] = (await runner
      .select({ n: sql<number>`count(*)` })
      .from(inventoryImportRows)
      .where(eq(inventoryImportRows.resolvedInventoryItemId, itemId))) as Array<{
      n: number | string;
    }>;

    tracedItems.push({
      itemId: item.id,
      companyId: item.companyId,
      name: item.name,
      active: item.active,
      supersededByItemId: item.supersededByItemId,
      pluSku: item.pluSku,
      barcode: item.barcode,
      updatedAt: item.updatedAt,
      mappings,
      countLines: asNumber(lines),
      countSessions: asNumber(sessions),
      importRows: asNumber(imports),
    });
  }

  // ── Verdict: name the single predicate responsible ───────────────────────
  let exclusionVerdict: string;
  if (funnel.companyAndSystem === 0) {
    exclusionVerdict =
      'No import batches exist for this company and source system at all. Discovery has no provenance to read.';
  } else if (funnel.plusApproved === 0) {
    exclusionVerdict =
      'Batches exist but none are approved. Discovery deliberately ignores unreviewed batches.';
  } else if (funnel.discoverySelected > 0) {
    exclusionVerdict =
      `Discovery selects ${funnel.discoverySelected} batch(es); the zero-group result is NOT caused by ` +
      'batch scoping. Investigate item-code reliability and resolved-item linkage instead.';
  } else if (funnel.plusTargetStore === 0 && funnel.plusSourceProperty === 0) {
    exclusionVerdict =
      'Both the target-store and source-property predicates eliminate every approved batch. These are ' +
      'legacy pre-binding batches: their scope columns were never populated.';
  } else if (funnel.plusTargetStore === 0) {
    exclusionVerdict =
      'The target-store predicate eliminates every approved batch: target_store_id does not match the ' +
      'scoped store (most likely NULL on legacy pre-binding batches).';
  } else {
    exclusionVerdict =
      'The source-property predicate eliminates every approved batch: stored source_property_id does not ' +
      `equal "${scope.sourcePropertyId}" (most likely NULL/empty on legacy pre-binding batches, which ` +
      'coalesce to the empty string and can never match a bound property id).';
  }

  return {
    scope,
    bindings,
    batches,
    funnel,
    distinctBatchProperties,
    distinctMappingProperties,
    tracedCode,
    tracedRows,
    tracedItems,
    tracedByName,
    exclusionVerdict,
  };
}
