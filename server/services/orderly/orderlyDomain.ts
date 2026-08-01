/**
 * Orderly Domain Service
 *
 * DB-aware "resolveOrCreate" functions that turn staged inventory_import_rows
 * into first-class domain entities:
 *
 *   - inventory_items (matched or newly created)
 *   - vendors (matched or newly created)
 *   - vendor_items (linked or newly created)
 *   - inventory_locations (matched or newly created — the new hierarchy table)
 *   - inventory_item_location_assignments
 *   - inventory_item_external_mappings (confirmed source code → item links)
 *
 * The main entry point is `applyBatchApproval`, which runs everything inside
 * a single db.transaction(). Callers pass a `rowDecisions` array to override
 * ambiguous matches — rows without an override are auto-resolved.
 */

import { db } from '../../db';
import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  inventoryItems,
  vendors,
  vendorItems,
  inventoryLocations,
  inventoryItemLocationAssignments,
  inventoryItemExternalMappings,
  inventoryImportBatches,
  inventoryImportRows,
  units,
  categories,
  type InventoryItem,
  type Vendor,
  type InventoryLocation,
} from '@shared/schema';
import {
  matchByItemCode,
  matchByNamePack,
  matchByFuzzy,
  matchVendor,
  matchLocation,
  computeResolutionSummary,
  normalizeForMatch,
  type MatchResult,
  type VendorMatchResult,
  type LocationMatchResult,
  type RowResolution,
  type MatchableItem,
  type MatchableVendor,
  type MatchableLocation,
} from './OrderlyMatcher';
import type { InventoryImportRow } from '@shared/schema';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-row user override. rowIndex is the key. */
export interface RowDecision {
  rowIndex: number;
  /** Force a specific inventoryItemId (overrides matching). null = skip this row. */
  inventoryItemId?: string | null;
  /** Force a specific vendorId. null = skip vendor creation. */
  vendorId?: string | null;
  /** Skip this row entirely — don't create or link anything. */
  skip?: boolean;
}

export interface ApprovalResult {
  batchId: string;
  approvedAt: string;
  itemsCreated: number;
  itemsLinked: number;
  categoriesCreated: number;
  vendorsCreated: number;
  vendorsLinked: number;
  locationsCreated: number;
  locationsLinked: number;
  vendorItemsCreated: number;
  rowsSkipped: number;
  rowsProcessed: number;
}

export interface ResolutionPreviewResult {
  batchId: string;
  inventoryDate: string | null;
  totalRows: number;
  summary: ReturnType<typeof computeResolutionSummary>;
  rows: Array<{
    rowId: string;
    rowIndex: number;
    storageLocation: string | null;
    sourceItemCode: string | null;
    itemCodeStatus: string | null;
    cleanedDescription: string | null;
    supplierRaw: string | null;
    sourceCategory: string | null;
    caseQuantity: number | null;
    packagePrice: number | null;
    totalCost: number | null;
    itemMatch: MatchResult;
    vendorMatch: VendorMatchResult;
    locationMatch: LocationMatchResult;
  }>;
  /** Unique locations that will be created on approval */
  newLocations: string[];
  /** Unique vendors that will be created on approval */
  newVendors: string[];
}

// ─── Category find-or-create ──────────────────────────────────────────────────

/**
 * Find an existing active category (case-insensitive) or create a new one.
 * Returns null when name is blank/whitespace — no blank categories are created.
 * Restores a soft-deleted (isActive=0) category instead of creating a duplicate.
 * Must be called inside an open DB transaction (`tx`).
 */
export async function resolveOrCreateCategoryId(
  tx: any,
  companyId: string,
  name: string,
): Promise<{ id: string; created: boolean } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const normName = trimmed.toLowerCase();

  // 1. Existing active category (case-insensitive exact match)
  const [existing] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.companyId, companyId),
        sql`lower(${categories.name}) = ${normName}`,
        eq(categories.isActive, 1),
      ),
    )
    .limit(1);
  if (existing) return { id: existing.id, created: false };

  // 2. Soft-deleted category — restore rather than duplicate
  const [softDeleted] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.companyId, companyId),
        sql`lower(${categories.name}) = ${normName}`,
        eq(categories.isActive, 0),
      ),
    )
    .limit(1);
  if (softDeleted) {
    await tx
      .update(categories)
      .set({ isActive: 1 })
      .where(eq(categories.id, softDeleted.id));
    return { id: softDeleted.id, created: false };
  }

  // 3. Create new category
  const [newCat] = await tx
    .insert(categories)
    .values({
      companyId,
      name: trimmed,
      sortOrder: 0,
      showAsIngredient: 1,
      isCatchWeightCategory: 0,
      isActive: 1,
    })
    .returning({ id: categories.id });

  return { id: newCat.id, created: true };
}

// ─── Unit lookup cache ────────────────────────────────────────────────────────

let _eachUnitId: string | null = null;

async function getEachUnitId(): Promise<string> {
  if (_eachUnitId) return _eachUnitId;
  const rows = await db
    .select({ id: units.id })
    .from(units)
    .where(eq(units.abbreviation, 'ea'))
    .limit(1);
  if (rows[0]) {
    _eachUnitId = rows[0].id;
    return _eachUnitId!;
  }
  // Fallback: any count unit
  const countRows = await db
    .select({ id: units.id })
    .from(units)
    .where(eq(units.kind, 'count'))
    .limit(1);
  _eachUnitId = countRows[0]?.id ?? 'each';
  return _eachUnitId!;
}

// ─── Resolution preview (read-only) ──────────────────────────────────────────

/**
 * Load all rows for a batch and run the matching algorithms against the
 * company's existing items / vendors / locations.  No DB writes.
 */
export async function runResolutionPreview(
  batchId: string,
  companyId: string,
): Promise<ResolutionPreviewResult> {
  // Parallel: fetch batch meta + import rows + company items + vendors + locations + external mappings
  const [batchRows, batchMeta, existingItems, existingVendors, existingLocations, externalMappings] =
    await Promise.all([
      db
        .select()
        .from(inventoryImportRows)
        .where(eq(inventoryImportRows.batchId, batchId))
        .orderBy(inventoryImportRows.rowIndex),
      db
        .select({ id: inventoryImportBatches.id, inventoryDate: inventoryImportBatches.inventoryDate })
        .from(inventoryImportBatches)
        .where(
          and(
            eq(inventoryImportBatches.id, batchId),
            eq(inventoryImportBatches.companyId, companyId),
          ),
        )
        .limit(1),
      db
        .select({ id: inventoryItems.id, name: inventoryItems.name, pluSku: inventoryItems.pluSku, caseSize: inventoryItems.caseSize })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.companyId, companyId), eq(inventoryItems.active, 1))),
      db
        .select({ id: vendors.id, name: vendors.name })
        .from(vendors)
        .where(and(eq(vendors.companyId, companyId), eq(vendors.active, 1))),
      db
        .select({ id: inventoryLocations.id, normalizedName: inventoryLocations.normalizedName })
        .from(inventoryLocations)
        .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.active, 1))),
      db
        .select({
          sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
          inventoryItemId: inventoryItemExternalMappings.inventoryItemId,
        })
        .from(inventoryItemExternalMappings)
        .where(
          and(
            eq(inventoryItemExternalMappings.companyId, companyId),
            eq(inventoryItemExternalMappings.sourceSystem, 'ORDERLY'),
          ),
        ),
    ]);

  if (!batchMeta[0]) throw new Error('Batch not found or not accessible');

  // Build external mapping lookup: sourceExternalId → inventoryItemId
  const extMappingLookup = new Map<string, string>(
    externalMappings.map((m: { sourceExternalId: string; inventoryItemId: string }): [string, string] => [m.sourceExternalId, m.inventoryItemId]),
  );

  const matchableItems: MatchableItem[] = existingItems;
  const matchableVendors: MatchableVendor[] = existingVendors;
  const matchableLocations: MatchableLocation[] = existingLocations;

  const resolutions: RowResolution[] = [];
  const newLocationNames = new Set<string>();
  const newVendorNames = new Set<string>();

  for (const row of batchRows) {
    // ── Item resolution ──
    let itemMatch: MatchResult;

    // Strategy 1: external mapping
    const extId = row.sourceItemCode
      ? extMappingLookup.get(row.sourceItemCode.trim())
      : undefined;
    if (extId) {
      itemMatch = {
        strategy: 'external_mapping',
        confidence: 'high',
        matchedId: extId,
        candidateIds: [],
        requiresReview: false,
      };
    } else {
      // Strategy 2: item code
      itemMatch = matchByItemCode(row.sourceItemCode, row.itemCodeStatus, matchableItems);

      // Strategy 3: name + pack
      if (itemMatch.strategy === 'none') {
        itemMatch = matchByNamePack(row.cleanedDescription, row.caseQuantity, matchableItems);
      }

      // Strategy 4: fuzzy
      if (itemMatch.strategy === 'none') {
        itemMatch = matchByFuzzy(row.cleanedDescription, matchableItems);
      }
    }

    // ── Vendor resolution ──
    const vendorMatch = matchVendor(row.supplierRaw, row.supplierStatus, matchableVendors);
    if (vendorMatch.isNew && row.supplierRaw) newVendorNames.add(row.supplierRaw.trim());

    // ── Location resolution ──
    const locationMatch = matchLocation(row.storageLocation, matchableLocations);
    if (locationMatch.isNew && locationMatch.normalizedName) {
      newLocationNames.add(row.storageLocation!.trim());
    }

    resolutions.push({ rowIndex: row.rowIndex, itemMatch, vendorMatch, locationMatch });
  }

  const summary = computeResolutionSummary(resolutions);

  const rows = batchRows.map((row: InventoryImportRow, i: number) => ({
    rowId: row.id,
    rowIndex: row.rowIndex,
    storageLocation: row.storageLocation,
    sourceItemCode: row.sourceItemCode,
    itemCodeStatus: row.itemCodeStatus,
    cleanedDescription: row.cleanedDescription,
    supplierRaw: row.supplierRaw,
    sourceCategory: (row as any).sourceCategory ?? null,
    caseQuantity: row.caseQuantity,
    packagePrice: row.packagePrice,
    totalCost: row.totalCost,
    itemMatch: resolutions[i].itemMatch,
    vendorMatch: resolutions[i].vendorMatch,
    locationMatch: resolutions[i].locationMatch,
  }));

  return {
    batchId,
    inventoryDate: batchMeta[0].inventoryDate,
    totalRows: batchRows.length,
    summary,
    rows,
    newLocations: Array.from(newLocationNames),
    newVendors: Array.from(newVendorNames),
  };
}

// ─── Batch approval (writes) ──────────────────────────────────────────────────

/**
 * Apply a batch approval — idempotent.
 * If the batch is already 'approved', returns a short-circuit result.
 *
 * Everything runs inside a single transaction.
 * Parse-phase (matching) happens OUTSIDE the transaction so a matching error
 * cannot leave a partially-committed state.
 */
export async function applyBatchApproval(
  batchId: string,
  companyId: string,
  userId: string | null,
  rowDecisions: RowDecision[] = [],
): Promise<ApprovalResult> {
  // ── Guard: check batch exists and is not already approved ────────────────
  const [batch] = await db
    .select({ id: inventoryImportBatches.id, status: inventoryImportBatches.status })
    .from(inventoryImportBatches)
    .where(
      and(
        eq(inventoryImportBatches.id, batchId),
        eq(inventoryImportBatches.companyId, companyId),
      ),
    )
    .limit(1);

  if (!batch) throw new Error('Batch not found');
  if (batch.status === 'approved') {
    throw new Error('Batch has already been approved — use the history view to see results.');
  }

  // ── Build decision override map ──────────────────────────────────────────
  const decisionMap = new Map<number, RowDecision>(
    rowDecisions.map(d => [d.rowIndex, d]),
  );

  // ── Validate override IDs belong to this company ─────────────────────────
  // Security: a caller must not be able to cross-tenant link by supplying
  // foreign company item/vendor IDs in rowDecisions.
  const overrideItemIds = rowDecisions
    .map(d => d.inventoryItemId)
    .filter((id): id is string => typeof id === 'string');
  const overrideVendorIds = rowDecisions
    .map(d => d.vendorId)
    .filter((id): id is string => typeof id === 'string');

  if (overrideItemIds.length > 0) {
    const validItems = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(and(
        eq(inventoryItems.companyId, companyId),
        inArray(inventoryItems.id, overrideItemIds),
      ));
    const validSet = new Set(validItems.map((r: { id: string }) => r.id));
    const invalid = overrideItemIds.filter(id => !validSet.has(id));
    if (invalid.length > 0) {
      throw new Error(
        `Row decision contains inventory item IDs that do not belong to this company: ${invalid.join(', ')}`,
      );
    }
  }

  if (overrideVendorIds.length > 0) {
    const validVendors = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(
        eq(vendors.companyId, companyId),
        inArray(vendors.id, overrideVendorIds),
      ));
    const validSet = new Set(validVendors.map((r: { id: string }) => r.id));
    const invalid = overrideVendorIds.filter(id => !validSet.has(id));
    if (invalid.length > 0) {
      throw new Error(
        `Row decision contains vendor IDs that do not belong to this company: ${invalid.join(', ')}`,
      );
    }
  }

  // ── Run matching (outside transaction) ──────────────────────────────────
  const preview = await runResolutionPreview(batchId, companyId);

  // ── Fetch "each" unit for new item creation ──────────────────────────────
  const eachUnitId = await getEachUnitId();

  // ── Apply everything in one transaction ─────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction(async (tx: any) => {
    let itemsCreated = 0, itemsLinked = 0;
    let vendorsCreated = 0, vendorsLinked = 0;
    let locationsCreated = 0, locationsLinked = 0;
    let vendorItemsCreated = 0, rowsSkipped = 0, rowsProcessed = 0;

    // ── Location pass (deduplicated across all rows) ─────────────────────
    const locationCache = new Map<string, string>(); // normalizedName → id

    // Pre-load existing locations into cache
    const existingLocs = await tx
      .select({ id: inventoryLocations.id, normalizedName: inventoryLocations.normalizedName })
      .from(inventoryLocations)
      .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.active, 1)));
    for (const loc of existingLocs) {
      locationCache.set(loc.normalizedName, loc.id);
    }

    // ── Vendor pass (deduplicated across all rows) ───────────────────────
    const vendorCache = new Map<string, string>(); // normalizedName → vendorId
    const existingVendors = await tx
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(and(eq(vendors.companyId, companyId), eq(vendors.active, 1)));
    for (const v of existingVendors) vendorCache.set(normalizeForMatch(v.name), v.id);

    // ── Category pass (deduplicated across all rows) ─────────────────────
    // Collect all unique non-blank sourceCategory values, then find-or-create
    // each one once — avoiding one round-trip per row.
    const categoryCache = new Map<string, string>(); // lowerCased name → categoryId
    let categoriesCreated = 0;
    const uniqueCategoryNames = new Set<string>(
      preview.rows
        .map(r => r.sourceCategory?.trim() ?? '')
        .filter(s => s.length > 0),
    );
    for (const catName of uniqueCategoryNames) {
      const result = await resolveOrCreateCategoryId(tx, companyId, catName);
      if (result) {
        categoryCache.set(catName.toLowerCase(), result.id);
        if (result.created) categoriesCreated++;
      }
    }

    // ── Row-by-row pass ──────────────────────────────────────────────────
    for (const rowPreview of preview.rows) {
      rowsProcessed++;
      const dec = decisionMap.get(rowPreview.rowIndex);

      // Skip if user explicitly skipped
      if (dec?.skip) {
        rowsSkipped++;
        continue;
      }

      // ── Item resolution ──────────────────────────────────────────────
      // Resolve category for this row upfront — used in both the new-item
      // INSERT and the matched-item conditional UPDATE below.
      const rowCatKey = (rowPreview.sourceCategory?.trim() ?? '').toLowerCase();
      const resolvedCategoryId = rowCatKey ? (categoryCache.get(rowCatKey) ?? null) : null;

      let resolvedItemId: string | null = null;
      let isNewItem = false;

      if (dec?.inventoryItemId !== undefined) {
        // User override (validated to belong to this company above)
        resolvedItemId = dec.inventoryItemId ?? null;
        if (resolvedItemId) itemsLinked++;
      } else {
        const m = rowPreview.itemMatch;

        if (!m.requiresReview && m.matchedId !== null) {
          // Auto-link only when the matching algorithm is confident enough
          // NOT to require human review (strategies: external_mapping, item_code exact,
          // name_pack single-match). Fuzzy matches always have requiresReview:true
          // and must never be auto-linked.
          resolvedItemId = m.matchedId;
          itemsLinked++;
        } else {
          // No confident auto-link (no match, fuzzy, or ambiguous) → create a new item.
          // This is always safe: the user can merge duplicates later.
          // We do NOT silently skip rows — that would drop expected inventory entries.
          const name = rowPreview.cleanedDescription?.trim() || `Orderly Item ${rowPreview.rowIndex}`;
          const [newItem] = await tx
            .insert(inventoryItems)
            .values({
              companyId,
              name,
              unitId: eachUnitId,
              caseSize: rowPreview.caseQuantity ?? 1,
              pricePerUnit: rowPreview.packagePrice ?? 0,
              avgCostPerUnit: rowPreview.packagePrice ?? 0,
              active: 1,
              yieldPercent: 100,
              categoryId: resolvedCategoryId,
            })
            .returning({ id: inventoryItems.id });
          resolvedItemId = newItem.id;
          itemsCreated++;
          isNewItem = true;
        }
      }

      // ── Category assignment for matched items ────────────────────────
      // New items already have categoryId set in the INSERT above.
      // For matched (existing) items: set only when currently uncategorized
      // so a manager's manual category choice is never overwritten.
      if (!isNewItem && resolvedItemId && resolvedCategoryId) {
        await tx
          .update(inventoryItems)
          .set({ categoryId: resolvedCategoryId })
          .where(
            and(
              eq(inventoryItems.id, resolvedItemId),
              sql`${inventoryItems.categoryId} IS NULL`,
            ),
          );
      }

      // ── Persist resolved item ID back to the import row ──────────────
      // This is read by the count-session conversion step to know which
      // inventory item each row maps to without re-running matching.
      await tx
        .update(inventoryImportRows)
        .set({ resolvedInventoryItemId: resolvedItemId })
        .where(eq(inventoryImportRows.id, rowPreview.rowId));

      // ── External mapping creation ───────────────────────────────────
      if (resolvedItemId && rowPreview.sourceItemCode && rowPreview.itemCodeStatus === 'valid') {
        await tx
          .insert(inventoryItemExternalMappings)
          .values({
            companyId,
            inventoryItemId: resolvedItemId,
            sourceSystem: 'ORDERLY',
            sourceExternalId: rowPreview.sourceItemCode.trim(),
            sourceDescription: rowPreview.cleanedDescription,
            matchStrategy: rowPreview.itemMatch.strategy,
            confidenceScore: rowPreview.itemMatch.score ?? null,
            confirmedAt: new Date(),
            confirmedBy: userId,
          })
          .onConflictDoNothing();
      }

      // Store resolved item ID on the import row so count-session creation can
      // trace back count values to the resolved inventory item without re-matching.
      if (resolvedItemId) {
        await tx
          .update(inventoryImportRows)
          .set({ resolvedInventoryItemId: resolvedItemId })
          .where(
            and(
              eq(inventoryImportRows.batchId, batchId),
              eq(inventoryImportRows.rowIndex, rowPreview.rowIndex),
            ),
          );
      }

      // ── Vendor resolution ────────────────────────────────────────────
      let resolvedVendorId: string | null = null;

      if (dec?.vendorId !== undefined) {
        resolvedVendorId = dec.vendorId ?? null;
      } else {
        const vm = rowPreview.vendorMatch;
        if (vm.vendorId) {
          resolvedVendorId = vm.vendorId;
          vendorsLinked++;
        } else if (vm.isNew && rowPreview.supplierRaw) {
          const supplierName = rowPreview.supplierRaw.trim();
          const normName = normalizeForMatch(supplierName);
          if (vendorCache.has(normName)) {
            resolvedVendorId = vendorCache.get(normName)!;
            vendorsLinked++;
          } else {
            const [newVendor] = await tx
              .insert(vendors)
              .values({
                companyId,
                name: supplierName,
                orderGuideType: 'manual',
                active: 1,
              })
              .returning({ id: vendors.id });
            resolvedVendorId = newVendor.id;
            vendorCache.set(normName, newVendor.id);
            vendorsCreated++;
          }
        }
      }

      // ── Vendor-item link ─────────────────────────────────────────────
      if (resolvedItemId && resolvedVendorId) {
        await tx
          .insert(vendorItems)
          .values({
            vendorId: resolvedVendorId,
            inventoryItemId: resolvedItemId,
            vendorSku: rowPreview.sourceItemCode,
            purchaseUnitId: eachUnitId,
            caseSize: rowPreview.caseQuantity ?? 1,
            lastPrice: rowPreview.packagePrice ?? 0,
            lastCasePrice: rowPreview.packagePrice ?? 0,
            priceSource: 'order_guide_import',
            pricedAt: new Date(),
            active: 1,
          })
          .onConflictDoNothing();
        vendorItemsCreated++;
      }

      // ── Location resolution ──────────────────────────────────────────
      if (rowPreview.locationMatch.normalizedName) {
        const norm = rowPreview.locationMatch.normalizedName;
        if (locationCache.has(norm)) {
          locationsLinked++;
        } else {
          const rawName = rowPreview.storageLocation?.trim() ?? norm;
          const [newLoc] = await tx
            .insert(inventoryLocations)
            .values({
              companyId,
              name: rawName,
              normalizedName: norm,
              locationType: 'storage',
              sourceSystem: 'ORDERLY',
              active: 1,
            })
            .returning({ id: inventoryLocations.id });
          locationCache.set(norm, newLoc.id);
          locationsCreated++;
        }

        // ── Item-location assignment ───────────────────────────────────
        if (resolvedItemId && locationCache.has(norm)) {
          const locId = locationCache.get(norm)!;
          await tx
            .insert(inventoryItemLocationAssignments)
            .values({
              companyId,
              inventoryItemId: resolvedItemId,
              locationId: locId,
              parTarget: null, // par_target from Orderly is for counting not par ordering
              isPrimary: 0,
              active: 1,
            })
            .onConflictDoNothing();
        }
      }
    } // end row loop

    // ── Mark batch approved ──────────────────────────────────────────────
    await tx
      .update(inventoryImportBatches)
      .set({
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: userId,
      })
      .where(eq(inventoryImportBatches.id, batchId));

    return {
      batchId,
      approvedAt: new Date().toISOString(),
      itemsCreated,
      itemsLinked,
      categoriesCreated,
      vendorsCreated,
      vendorsLinked,
      locationsCreated,
      locationsLinked,
      vendorItemsCreated,
      rowsSkipped,
      rowsProcessed,
    };
  });

  return result;
}
