/**
 * inventoryItemMerge.ts
 *
 * Domain logic for finding duplicate inventory items and merging them.
 *
 * Normalization matches the import-matcher logic:
 *   lowercase → strip non-alphanumeric (except spaces) → collapse whitespace
 */

import { db } from "../db";
import {
  inventoryItems,
  vendorItems,
  storeInventoryItems,
  inventoryCountLines,
  recipeComponents,
  inventoryItemLocationAssignments,
  categories,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DuplicateItem {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unitId: string;
  pricePerUnit: number;
  avgCostPerUnit: number;
  active: number;
  updatedAt: Date;
}

export interface DuplicateGroup {
  normalizedName: string;
  itemCount: number;
  items: DuplicateItem[];
}

// ---------------------------------------------------------------------------
// Find duplicate groups
// ---------------------------------------------------------------------------

export async function findDuplicateGroups(
  companyId: string
): Promise<DuplicateGroup[]> {
  // Fetch all active inventory items for this company
  const allItems = await db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      categoryId: inventoryItems.categoryId,
      unitId: inventoryItems.unitId,
      pricePerUnit: inventoryItems.pricePerUnit,
      avgCostPerUnit: inventoryItems.avgCostPerUnit,
      active: inventoryItems.active,
      updatedAt: inventoryItems.updatedAt,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.companyId, companyId), eq(inventoryItems.active, 1)));

  // Fetch category names in one query
  const categoryIds = Array.from(new Set(allItems.map((item: { categoryId: string | null }) => item.categoryId).filter(Boolean) as string[]));

  const categoryMap = new Map<string, string>();
  if (categoryIds.length > 0) {
    const cats = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(inArray(categories.id, categoryIds));
    for (const c of cats) {
      categoryMap.set(c.id, c.name);
    }
  }

  // Group by normalized name
  const grouped = new Map<string, DuplicateItem[]>();
  for (const item of allItems) {
    const norm = normalizeItemName(item.name);
    if (!grouped.has(norm)) grouped.set(norm, []);
    grouped.get(norm)!.push({
      ...item,
      categoryName: item.categoryId ? (categoryMap.get(item.categoryId) ?? null) : null,
    });
  }

  // Keep only groups with 2+ items, sorted by count desc then name asc
  const duplicates: DuplicateGroup[] = [];
  for (const [normalizedName, items] of Array.from(grouped.entries())) {
    if (items.length < 2) continue;
    // Most recently updated first (likely the "real" primary)
    items.sort((a: DuplicateItem, b: DuplicateItem) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    duplicates.push({ normalizedName, itemCount: items.length, items });
  }

  duplicates.sort((a, b) =>
    b.itemCount !== a.itemCount
      ? b.itemCount - a.itemCount
      : a.normalizedName.localeCompare(b.normalizedName)
  );

  return duplicates;
}

// ---------------------------------------------------------------------------
// Merge duplicates into a primary item
// ---------------------------------------------------------------------------

export interface MergeRequest {
  primaryItemId: string;
  duplicateItemIds: string[]; // items to merge into primary, then delete
  companyId: string;
}

export interface MergeResult {
  primaryItemId: string;
  mergedCount: number;
  vendorItemsReassigned: number;
  storeAssignmentsMerged: number;
  countLinesMerged: number;
  recipeComponentsReassigned: number;
  locationAssignmentsMerged: number;
}

export async function mergeInventoryItems(req: MergeRequest): Promise<MergeResult> {
  const { primaryItemId, duplicateItemIds: rawDupeIds, companyId } = req;

  // ── Input sanitisation ─────────────────────────────────────────────────────
  if (!primaryItemId) {
    throw new Error("primaryItemId is required");
  }

  // Deduplicate and remove any occurrence of the primary item from the list
  const uniqueDupeIds = Array.from(new Set(rawDupeIds)).filter((id) => id !== primaryItemId);

  if (uniqueDupeIds.length === 0) {
    throw new Error(
      "No valid duplicate item IDs provided (empty list, or all IDs were the same as the primary)"
    );
  }

  // ── Ownership validation (outside transaction — read-only) ─────────────────
  const [primaryItem] = await db
    .select({ id: inventoryItems.id, companyId: inventoryItems.companyId })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, primaryItemId), eq(inventoryItems.companyId, companyId)));

  if (!primaryItem) {
    throw new Error("Primary item not found or does not belong to your company");
  }

  const dupeItems = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(inArray(inventoryItems.id, uniqueDupeIds), eq(inventoryItems.companyId, companyId))
    );

  if (dupeItems.length !== uniqueDupeIds.length) {
    throw new Error(
      "One or more duplicate items not found or do not belong to your company"
    );
  }

  // ── Atomic merge ───────────────────────────────────────────────────────────
  // All mutations run inside a single transaction so a mid-operation failure
  // rolls back the entire merge rather than leaving partial state.
  const result = await db.transaction(async (tx: typeof db) => {
    let vendorItemsReassigned = 0;
    let storeAssignmentsMerged = 0;
    let countLinesMerged = 0;
    let recipeComponentsReassigned = 0;
    let locationAssignmentsMerged = 0;

    // ── 1. Vendor items ────────────────────────────────────────────────────
    const viResult = await tx
      .update(vendorItems)
      .set({ inventoryItemId: primaryItemId })
      .where(inArray(vendorItems.inventoryItemId, uniqueDupeIds));
    vendorItemsReassigned = (viResult as any).rowCount ?? 0;

    // ── 2. Store inventory items ───────────────────────────────────────────
    // unique(storeId, inventoryItemId) — accumulate on-hand qty on conflict
    const dupeStoreItems = await tx
      .select()
      .from(storeInventoryItems)
      .where(inArray(storeInventoryItems.inventoryItemId, uniqueDupeIds));

    for (const dupe of dupeStoreItems) {
      const [existing] = await tx
        .select({ id: storeInventoryItems.id, onHandQty: storeInventoryItems.onHandQty })
        .from(storeInventoryItems)
        .where(
          and(
            eq(storeInventoryItems.storeId, dupe.storeId),
            eq(storeInventoryItems.inventoryItemId, primaryItemId)
          )
        );

      if (existing) {
        await tx
          .update(storeInventoryItems)
          .set({ onHandQty: existing.onHandQty + dupe.onHandQty })
          .where(eq(storeInventoryItems.id, existing.id));
        await tx.delete(storeInventoryItems).where(eq(storeInventoryItems.id, dupe.id));
      } else {
        await tx
          .update(storeInventoryItems)
          .set({ inventoryItemId: primaryItemId })
          .where(eq(storeInventoryItems.id, dupe.id));
      }
      storeAssignmentsMerged++;
    }

    // ── 3. Inventory count lines ───────────────────────────────────────────
    // unique(inventoryCountId, inventoryItemId, storageLocationId) — accumulate qty on conflict
    const dupeCountLines = await tx
      .select()
      .from(inventoryCountLines)
      .where(inArray(inventoryCountLines.inventoryItemId, uniqueDupeIds));

    for (const dupe of dupeCountLines) {
      const [existing] = await tx
        .select({ id: inventoryCountLines.id, qty: inventoryCountLines.qty })
        .from(inventoryCountLines)
        .where(
          and(
            eq(inventoryCountLines.inventoryCountId, dupe.inventoryCountId),
            eq(inventoryCountLines.inventoryItemId, primaryItemId),
            eq(inventoryCountLines.storageLocationId, dupe.storageLocationId)
          )
        );

      if (existing) {
        await tx
          .update(inventoryCountLines)
          .set({ qty: existing.qty + dupe.qty })
          .where(eq(inventoryCountLines.id, existing.id));
        await tx.delete(inventoryCountLines).where(eq(inventoryCountLines.id, dupe.id));
      } else {
        await tx
          .update(inventoryCountLines)
          .set({ inventoryItemId: primaryItemId })
          .where(eq(inventoryCountLines.id, dupe.id));
      }
      countLinesMerged++;
    }

    // ── 4. Recipe components ───────────────────────────────────────────────
    const rcResult = await tx
      .update(recipeComponents)
      .set({ componentId: primaryItemId })
      .where(
        and(
          inArray(recipeComponents.componentId, uniqueDupeIds),
          eq(recipeComponents.componentType, "inventory_item")
        )
      );
    recipeComponentsReassigned = (rcResult as any).rowCount ?? 0;

    // ── 5. Inventory item location assignments ─────────────────────────────
    // unique(inventoryItemId, locationId) — skip duplicate location if primary already has it
    const dupeLocAssignments = await tx
      .select()
      .from(inventoryItemLocationAssignments)
      .where(inArray(inventoryItemLocationAssignments.inventoryItemId, uniqueDupeIds));

    for (const dupe of dupeLocAssignments) {
      const [existing] = await tx
        .select({ id: inventoryItemLocationAssignments.id })
        .from(inventoryItemLocationAssignments)
        .where(
          and(
            eq(inventoryItemLocationAssignments.inventoryItemId, primaryItemId),
            eq(inventoryItemLocationAssignments.locationId, dupe.locationId)
          )
        );

      if (existing) {
        await tx
          .delete(inventoryItemLocationAssignments)
          .where(eq(inventoryItemLocationAssignments.id, dupe.id));
      } else {
        await tx
          .update(inventoryItemLocationAssignments)
          .set({ inventoryItemId: primaryItemId })
          .where(eq(inventoryItemLocationAssignments.id, dupe.id));
      }
      locationAssignmentsMerged++;
    }

    // ── 6. Delete duplicate items ──────────────────────────────────────────
    await tx
      .delete(inventoryItems)
      .where(
        and(
          inArray(inventoryItems.id, uniqueDupeIds),
          eq(inventoryItems.companyId, companyId)
        )
      );

    return {
      primaryItemId,
      mergedCount: uniqueDupeIds.length,
      vendorItemsReassigned,
      storeAssignmentsMerged,
      countLinesMerged,
      recipeComponentsReassigned,
      locationAssignmentsMerged,
    };
  });

  return result;
}
