import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  companies,
  inventoryCountLines,
  inventoryCounts,
  inventoryItemLocationAssignments,
  inventoryItemLocations,
  inventoryItems,
  inventoryLocations,
  storageLocations,
  storeInventoryItems,
} from '@workspace/db';
import type { Company, InventoryItem } from '@workspace/db';
import { db } from '../../db';
import { getEffectiveUnitCost } from '../../lib/costing';
import { isHistoricalImportSession } from './historicalSessionGuard';

export type ManualCountPopulationErrorCode =
  | 'COUNT_NOT_FOUND'
  | 'HISTORICAL_SESSION'
  | 'APPLIED_SESSION'
  | 'NO_ELIGIBLE_COUNT_LINES';

export class ManualCountPopulationError extends Error {
  constructor(
    public readonly code: ManualCountPopulationErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ManualCountPopulationError';
  }
}

export interface PopulateManualCountLinesResult {
  countId: string;
  createdLines: number;
  totalLines: number;
  alreadyPopulated: boolean;
}

/**
 * Populates an empty manual count from the company's operational item/location
 * assignments. Canonical assignments take precedence per item. The legacy path
 * remains only as a compatibility fallback for companies not yet represented
 * in the canonical assignment model.
 *
 * The advisory lock plus the count-line uniqueness constraint make recovery
 * safe to retry without creating duplicates.
 */
export async function populateManualCountLines(
  countId: string,
  companyId: string,
  actorUserId: string,
): Promise<PopulateManualCountLinesResult> {
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${countId}))`);

    const [count] = await tx
      .select()
      .from(inventoryCounts)
      .where(and(eq(inventoryCounts.id, countId), eq(inventoryCounts.companyId, companyId)))
      .limit(1);

    if (!count) {
      throw new ManualCountPopulationError('COUNT_NOT_FOUND', 'Count session not found', 404);
    }
    if (isHistoricalImportSession(count)) {
      throw new ManualCountPopulationError(
        'HISTORICAL_SESSION',
        'Historical import sessions are reference-only and cannot be recovered as active counts.',
        403,
      );
    }
    if (count.applied === 1) {
      throw new ManualCountPopulationError(
        'APPLIED_SESSION',
        'Applied count sessions cannot be repopulated.',
        409,
      );
    }

    const existingLines = await tx
      .select({ id: inventoryCountLines.id })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryCountId, count.id));

    if (existingLines.length > 0) {
      return {
        countId: count.id,
        createdLines: 0,
        totalLines: existingLines.length,
        alreadyPopulated: true,
      };
    }

    const whereConditions = [
      eq(inventoryItems.companyId, companyId),
      eq(inventoryItems.active, 1),
      eq(storeInventoryItems.companyId, companyId),
      eq(storeInventoryItems.storeId, count.storeId),
      eq(storeInventoryItems.active, 1),
    ];
    if (count.isPowerSession === 1) {
      whereConditions.push(eq(inventoryItems.isPowerItem, 1));
    }

    const activeItemRows = await tx
      .select({ inventoryItem: inventoryItems })
      .from(inventoryItems)
      .innerJoin(
        storeInventoryItems,
        and(
          eq(storeInventoryItems.inventoryItemId, inventoryItems.id),
          eq(storeInventoryItems.storeId, count.storeId),
        ),
      )
      .where(and(...whereConditions));

    const activeItems: InventoryItem[] = activeItemRows.map(
      (row: { inventoryItem: InventoryItem }) => row.inventoryItem,
    );
    const itemIds = activeItems.map((item: InventoryItem) => item.id);
    if (itemIds.length === 0) {
      throw new ManualCountPopulationError(
        'NO_ELIGIBLE_COUNT_LINES',
        'No active inventory items are configured for this store.',
        422,
      );
    }

    const canonicalAssignments = await tx
      .select({
        inventoryItemId: inventoryItemLocationAssignments.inventoryItemId,
        locationId: inventoryItemLocationAssignments.locationId,
      })
      .from(inventoryItemLocationAssignments)
      .innerJoin(
        inventoryLocations,
        eq(inventoryItemLocationAssignments.locationId, inventoryLocations.id),
      )
      .where(and(
        eq(inventoryItemLocationAssignments.companyId, companyId),
        eq(inventoryItemLocationAssignments.active, 1),
        eq(inventoryLocations.companyId, companyId),
        eq(inventoryLocations.active, 1),
        inArray(inventoryItemLocationAssignments.inventoryItemId, itemIds),
      ));

    const canonicalItemIds = new Set<string>(
      canonicalAssignments.map((row: { inventoryItemId: string }) => row.inventoryItemId),
    );
    const legacyFallbackItemIds = itemIds.filter((id: string) => !canonicalItemIds.has(id));
    const legacyAssignments = legacyFallbackItemIds.length === 0
      ? []
      : await tx
        .select({
          inventoryItemId: inventoryItemLocations.inventoryItemId,
          locationId: inventoryItemLocations.storageLocationId,
        })
        .from(inventoryItemLocations)
        .innerJoin(storageLocations, eq(inventoryItemLocations.storageLocationId, storageLocations.id))
        .where(and(
          eq(storageLocations.companyId, companyId),
          inArray(inventoryItemLocations.inventoryItemId, legacyFallbackItemIds),
        ));

    const assignments = [...canonicalAssignments, ...legacyAssignments];
    if (assignments.length === 0) {
      throw new ManualCountPopulationError(
        'NO_ELIGIBLE_COUNT_LINES',
        'No active inventory items have a count location assigned. Assign items to storage locations before starting a count.',
        422,
      );
    }

    const itemById = new Map<string, InventoryItem>(
      activeItems.map((item: InventoryItem) => [item.id, item]),
    );
    const [company]: Company[] = await tx
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    const lineValues = assignments.flatMap((assignment) => {
      const item = itemById.get(assignment.inventoryItemId);
      if (!item) return [];
      return [{
        inventoryCountId: count.id,
        inventoryItemId: item.id,
        storageLocationId: assignment.locationId,
        qty: 0,
        unitId: item.unitId,
        unitCost: getEffectiveUnitCost(item, company),
        userId: actorUserId,
      }];
    });

    const inserted = await tx
      .insert(inventoryCountLines)
      .values(lineValues)
      .onConflictDoNothing()
      .returning({ id: inventoryCountLines.id });

    return {
      countId: count.id,
      createdLines: inserted.length,
      totalLines: lineValues.length,
      alreadyPopulated: false,
    };
  });
}