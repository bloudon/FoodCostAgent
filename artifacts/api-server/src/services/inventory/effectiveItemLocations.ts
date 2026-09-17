import { and, eq, inArray } from 'drizzle-orm';
import {
  type InventoryItem,
  inventoryItemLocationAssignments,
  inventoryLocations,
  type InventoryItemLocation,
  type StorageLocation,
} from '@workspace/db';
import { db } from '../../db';

interface EffectiveLocationInventoryStorage {
  getInventoryItems(
    locationId?: string,
    storeId?: string,
    companyId?: string,
  ): Promise<InventoryItem[]>;
  getInventoryItemLocationsBatch(
    itemIds: string[],
  ): Promise<Map<string, InventoryItemLocation[]>>;
  getStorageLocations(companyId: string): Promise<StorageLocation[]>;
}

type EffectiveLocationResolver = typeof getEffectiveInventoryItemLocationsBatch;

export interface EffectiveInventoryItemLocation {
  id: string;
  name: string;
  isPrimary: boolean;
}

export function filterItemsByEffectiveLocation<
  T extends { locations: Array<{ id: string }> },
>(items: T[], locationId?: string): T[] {
  if (!locationId) return items;
  return items.filter((item) =>
    item.locations.some((location) => location.id === locationId),
  );
}

interface CanonicalLocationRow {
  inventoryItemId: string;
  id: string;
  name: string;
  isPrimary: number;
}

export function mergeEffectiveInventoryItemLocations(
  inventoryItemIds: string[],
  canonicalRows: CanonicalLocationRow[],
  legacyLocationsByItem: Map<string, InventoryItemLocation[]>,
  legacyLocations: StorageLocation[],
): Map<string, EffectiveInventoryItemLocation[]> {
  const canonicalByItem = new Map<string, EffectiveInventoryItemLocation[]>();
  for (const row of canonicalRows) {
    const locations = canonicalByItem.get(row.inventoryItemId) || [];
    locations.push({
      id: row.id,
      name: row.name,
      isPrimary: row.isPrimary === 1,
    });
    canonicalByItem.set(row.inventoryItemId, locations);
  }

  const legacyById = new Map(legacyLocations.map((location) => [location.id, location]));
  const effective = new Map<string, EffectiveInventoryItemLocation[]>();

  for (const inventoryItemId of inventoryItemIds) {
    const canonical = canonicalByItem.get(inventoryItemId);
    const locations = canonical?.length
      ? canonical
      : (legacyLocationsByItem.get(inventoryItemId) || []).flatMap((assignment) => {
          const location = legacyById.get(assignment.storageLocationId);
          return location
            ? [{
                id: location.id,
                name: location.name,
                isPrimary: assignment.isPrimary === 1,
              }]
            : [];
        });

    effective.set(
      inventoryItemId,
      locations.sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.name.localeCompare(b.name);
      }),
    );
  }

  return effective;
}

export async function getEffectiveInventoryItemLocationsBatch(
  companyId: string,
  inventoryItemIds: string[],
  legacyLocationsByItem: Map<string, InventoryItemLocation[]>,
  legacyLocations: StorageLocation[],
): Promise<Map<string, EffectiveInventoryItemLocation[]>> {
  if (inventoryItemIds.length === 0) return new Map();

  const canonicalRows = await db
    .select({
      inventoryItemId: inventoryItemLocationAssignments.inventoryItemId,
      id: inventoryLocations.id,
      name: inventoryLocations.name,
      isPrimary: inventoryItemLocationAssignments.isPrimary,
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
      inArray(inventoryItemLocationAssignments.inventoryItemId, inventoryItemIds),
    ));

  return mergeEffectiveInventoryItemLocations(
    inventoryItemIds,
    canonicalRows,
    legacyLocationsByItem,
    legacyLocations,
  );
}

export async function getInventoryItemsByEffectiveLocation(
  storage: EffectiveLocationInventoryStorage,
  companyId: string,
  locationId?: string,
  storeId?: string,
  resolveEffectiveLocations: EffectiveLocationResolver = getEffectiveInventoryItemLocationsBatch,
): Promise<InventoryItem[]> {
  const items = await storage.getInventoryItems(undefined, storeId, companyId);
  if (!locationId || items.length === 0) return items;

  const itemIds = items.map((item) => item.id);
  const [legacyLocationsByItem, legacyLocations] = await Promise.all([
    storage.getInventoryItemLocationsBatch(itemIds),
    storage.getStorageLocations(companyId),
  ]);
  const effectiveLocations = await resolveEffectiveLocations(
    companyId,
    itemIds,
    legacyLocationsByItem,
    legacyLocations,
  );

  return items.filter((item) =>
    (effectiveLocations.get(item.id) || []).some(
      (location) => location.id === locationId,
    ),
  );
}