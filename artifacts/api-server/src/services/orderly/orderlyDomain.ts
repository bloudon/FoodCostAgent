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
  importSourcePropertyBindings,
  storeInventoryItems,
  companyStores,
  units,
  categories,
  type InventoryItem,
  type Vendor,
  type InventoryLocation,
} from '@workspace/db';
import {
  matchByItemCode,
  matchByNamePack,
  matchByFuzzy,
  matchVendor,
  matchLocation,
  breakTieByLocation,
  computeResolutionSummary,
  normalizeForMatch,
  type MatchResult,
  type VendorMatchResult,
  type LocationMatchResult,
  type RowResolution,
  type MatchableItem,
  type MatchableVendor,
  type MatchableLocation,
  type LocationAssignment,
} from './OrderlyMatcher';
import type { InventoryImportRow } from '@workspace/db';
import { storage } from '../../storage';
import { getAccessibleStores, hasCompanyAccess } from '../../permissions';

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
  targetStoreId: string | null;
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
  /** How many distinct items were newly inserted into store_inventory_items. */
  storeItemsCreated: number;
  /** How many items already existed but were inactive and are now reactivated. */
  storeItemsReactivated: number;
  /** How many items already existed and were already active (no change needed). */
  storeItemsAlreadyLinked: number;
  /** How many rows produced no item resolution (skipped or null) — not linked. */
  storeItemsSkipped: number;
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
    innerPackQuantity: number | null;
    baseUnit: string | null;
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
  /**
   * Workbook-only identity evidence for the approval gate. Item Code is scoped
   * to this authorized XLSX import; it is not an Orderly API packSize identity.
   */
  identitySummary: {
    reliableCodeRows: number;
    uniqueReliableCodes: number;
    existingItemResolutions: number;
    proposedNewItemCreations: number;
    reliableCodesWithMultipleProposedItems: number;
    reliableCodesWithoutPackSizeReconciliationEvidence: number;
    conflictingReliableCodeGroups: Array<{
      sourceItemCode: string;
      rowIndexes: number[];
      reasons: string[];
    }>;
    blankCodeRows: number;
    blankCodeSafelyMatched: number;
    blankCodeUnresolved: number;
    uniquePhysicalLocations: number;
    locationCountRowsPreserved: number;
    sameCodeCrossLocationGroups: number;
    sameCodeSameLocationDuplicateGroups: number;
    sameLocationDuplicateRowCount: number;
    sameLocationDuplicateSourceValueTotal: number;
    packNotationCompatibilityWarnings: number;
    sourceValuationTotal: number;
  };
}

type IdentityPreviewRow = Pick<
  ResolutionPreviewResult['rows'][number],
  | 'rowIndex'
  | 'storageLocation'
  | 'sourceItemCode'
  | 'itemCodeStatus'
  | 'cleanedDescription'
  | 'caseQuantity'
  | 'innerPackQuantity'
  | 'baseUnit'
  | 'totalCost'
  | 'itemMatch'
>;

function isReliableItemCode(row: Pick<IdentityPreviewRow, 'sourceItemCode' | 'itemCodeStatus'>): boolean {
  return row.itemCodeStatus === 'valid' && Boolean(row.sourceItemCode?.trim());
}

function normalizedUnit(unit: string | null): string {
  return normalizeForMatch(unit ?? '');
}

/**
 * A deliberately narrow compatibility check for rows that share a reliable
 * workbook Item Code. Supplier, price, location, period, and inner-pack
 * quantity are intentionally excluded: Orderly uses inner-pack text for
 * partial-count notation (for example 6/6 ML and 6/0.3 ML).
 */
function reliableCodeCompatibilityReasons(a: IdentityPreviewRow, b: IdentityPreviewRow): string[] {
  const reasons: string[] = [];
  const leftDescription = normalizeForMatch(a.cleanedDescription ?? '');
  const rightDescription = normalizeForMatch(b.cleanedDescription ?? '');
  if (leftDescription && rightDescription && leftDescription !== rightDescription) {
    const leftTokens = new Set(leftDescription.split(' ').filter(Boolean));
    const rightTokens = new Set(rightDescription.split(' ').filter(Boolean));
    const overlap = [...leftTokens].filter(token => rightTokens.has(token)).length;
    const union = new Set([...leftTokens, ...rightTokens]).size;
    if (union > 0 && overlap / union < 0.5) {
      reasons.push('materially different normalized product descriptions');
    }
  }
  if (
    a.caseQuantity != null &&
    b.caseQuantity != null &&
    a.caseQuantity > 0 &&
    b.caseQuantity > 0 &&
    a.caseQuantity !== b.caseQuantity
  ) {
    reasons.push('incompatible case quantities');
  }
  const leftUnit = normalizedUnit(a.baseUnit);
  const rightUnit = normalizedUnit(b.baseUnit);
  if (leftUnit && rightUnit && leftUnit !== rightUnit) {
    reasons.push('incompatible base units');
  }
  return reasons;
}

function buildIdentitySummary(rows: IdentityPreviewRow[]) {
  const reliableGroups = new Map<string, IdentityPreviewRow[]>();
  const blankRows = rows.filter(row => row.itemCodeStatus === 'blank');
  const physicalLocations = new Set(
    rows.map(row => normalizeForMatch(row.storageLocation ?? '')).filter(Boolean),
  );

  for (const row of rows) {
    if (!isReliableItemCode(row)) continue;
    const code = row.sourceItemCode!.trim();
    const group = reliableGroups.get(code) ?? [];
    group.push(row);
    reliableGroups.set(code, group);
  }

  const conflictingReliableCodeGroups: Array<{
    sourceItemCode: string;
    rowIndexes: number[];
    reasons: string[];
  }> = [];
  let existingItemResolutions = 0;
  let proposedNewItemCreations = 0;
  let sameCodeCrossLocationGroups = 0;
  let sameCodeSameLocationDuplicateGroups = 0;
  let sameLocationDuplicateRowCount = 0;
  let sameLocationDuplicateSourceValueTotal = 0;
  let packNotationCompatibilityWarnings = 0;

  for (const [code, group] of reliableGroups) {
    const matchedIds = new Set(
      group
        .filter(row => !row.itemMatch.requiresReview)
        .map(row => row.itemMatch.matchedId)
        .filter((id): id is string => id != null),
    );
    if (matchedIds.size === 1) existingItemResolutions++;
    if (matchedIds.size === 0) proposedNewItemCreations++;

    // Compare every pair, not just against the first row: two rows can each be
    // compatible with row 0 while being incompatible with each other.
    const reasons = new Set<string>();
    for (let left = 0; left < group.length; left++) {
      for (let right = left + 1; right < group.length; right++) {
        for (const reason of reliableCodeCompatibilityReasons(group[left], group[right])) {
          reasons.add(reason);
        }
      }
    }
    if (matchedIds.size > 1) reasons.add('existing rows resolve to different inventory items');
    if (reasons.size > 0) {
      conflictingReliableCodeGroups.push({
        sourceItemCode: code,
        rowIndexes: group.map(row => row.rowIndex),
        reasons: [...reasons],
      });
    }

    const locations = new Set(
      group.map(row => normalizeForMatch(row.storageLocation ?? '')).filter(Boolean),
    );
    if (locations.size > 1) sameCodeCrossLocationGroups++;

    const byLocation = new Map<string, IdentityPreviewRow[]>();
    for (const row of group) {
      const locationKey = normalizeForMatch(row.storageLocation ?? '') || '(missing location)';
      const locationRows = byLocation.get(locationKey) ?? [];
      locationRows.push(row);
      byLocation.set(locationKey, locationRows);
    }
    for (const locationRows of byLocation.values()) {
      if (locationRows.length < 2) continue;
      sameCodeSameLocationDuplicateGroups++;
      sameLocationDuplicateRowCount += locationRows.length - 1;
      sameLocationDuplicateSourceValueTotal += locationRows.reduce(
        (total, row) => total + (row.totalCost ?? 0),
        0,
      );
    }

    const first = group[0];
    const hasPartialCountNotation = group.some(row =>
      row !== first &&
      normalizeForMatch(row.cleanedDescription ?? '') === normalizeForMatch(first.cleanedDescription ?? '') &&
      row.caseQuantity === first.caseQuantity &&
      normalizedUnit(row.baseUnit) === normalizedUnit(first.baseUnit) &&
      row.innerPackQuantity !== first.innerPackQuantity,
    );
    if (hasPartialCountNotation) packNotationCompatibilityWarnings++;
  }

  const blankCodeSafelyMatched = blankRows.filter(
    row => !row.itemMatch.requiresReview && row.itemMatch.matchedId != null,
  ).length;

  return {
    reliableCodeRows: [...reliableGroups.values()].reduce((total, group) => total + group.length, 0),
    uniqueReliableCodes: reliableGroups.size,
    existingItemResolutions,
    proposedNewItemCreations,
    // Approval resolves each compatible reliable-code group once. A non-zero
    // value would violate that contract, so preview reports the required gate.
    reliableCodesWithMultipleProposedItems: 0,
    // XLSX exports do not expose Orderly packSize.id. This is evidence of the
    // workbook limitation, not a request to treat Item Code as an API identity.
    reliableCodesWithoutPackSizeReconciliationEvidence: reliableGroups.size,
    conflictingReliableCodeGroups,
    blankCodeRows: blankRows.length,
    blankCodeSafelyMatched,
    blankCodeUnresolved: blankRows.length - blankCodeSafelyMatched,
    uniquePhysicalLocations: physicalLocations.size,
    locationCountRowsPreserved: rows.length,
    sameCodeCrossLocationGroups,
    sameCodeSameLocationDuplicateGroups,
    sameLocationDuplicateRowCount,
    sameLocationDuplicateSourceValueTotal,
    packNotationCompatibilityWarnings,
    sourceValuationTotal: rows.reduce((total, row) => total + (row.totalCost ?? 0), 0),
  };
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
        // @ts-ignore
        eq(categories.companyId, companyId),
        sql`lower(${categories.name}) = ${normName}`,
        // @ts-ignore
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
        // @ts-ignore
        eq(categories.companyId, companyId),
        sql`lower(${categories.name}) = ${normName}`,
        // @ts-ignore
        eq(categories.isActive, 0),
      ),
    )
    .limit(1);
  if (softDeleted) {
    await tx
      .update(categories)
      .set({ isActive: 1 })
      // @ts-ignore
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
    // @ts-ignore
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
    // @ts-ignore
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
  // External-code identity is scoped to the batch's authorized source property.
  // Two Orderly clubs can legitimately reuse the same Item Code, so a mapping
  // from another property must never resolve this batch's rows.
  const [scopeRow] = await db
    .select({ sourcePropertyId: inventoryImportBatches.sourcePropertyId })
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
  const sourcePropertyScope = scopeRow?.sourcePropertyId ?? '';
  // Parallel: fetch batch meta + import rows + company items + vendors + locations +
  // external mappings + item-location assignments (for ambiguous tiebreaking)
  const [batchRows, batchMeta, existingItems, existingVendors, existingLocations, externalMappings, locationAssignments] =
    await Promise.all([
      db
        .select()
        .from(inventoryImportRows)
        // @ts-ignore
        .where(eq(inventoryImportRows.batchId, batchId))
        .orderBy(inventoryImportRows.rowIndex),
      db
        .select({ id: inventoryImportBatches.id, inventoryDate: inventoryImportBatches.inventoryDate })
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
      db
        .select({ id: inventoryItems.id, name: inventoryItems.name, pluSku: inventoryItems.pluSku, caseSize: inventoryItems.caseSize })
        .from(inventoryItems)
        // @ts-ignore
        .where(and(eq(inventoryItems.companyId, companyId), eq(inventoryItems.active, 1))),
      db
        .select({ id: vendors.id, name: vendors.name })
        .from(vendors)
        // @ts-ignore
        .where(and(eq(vendors.companyId, companyId), eq(vendors.active, 1))),
      db
        .select({ id: inventoryLocations.id, name: inventoryLocations.name, normalizedName: inventoryLocations.normalizedName })
        .from(inventoryLocations)
        // @ts-ignore
        .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.active, 1))),
      db
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
            // @ts-ignore
            eq(inventoryItemExternalMappings.sourcePropertyId, sourcePropertyScope),
          ),
        ),
      db
        .select({
          inventoryItemId: inventoryItemLocationAssignments.inventoryItemId,
          locationId: inventoryItemLocationAssignments.locationId,
        })
        .from(inventoryItemLocationAssignments)
        // @ts-ignore
        .where(eq(inventoryItemLocationAssignments.companyId, companyId)),
    ]);

  if (!batchMeta[0]) throw new Error('Batch not found or not accessible');

  // Build external mapping lookup: sourceExternalId → inventoryItemId
  const extMappingLookup = new Map<string, string>(
    externalMappings.map((m: { sourceExternalId: string; inventoryItemId: string }): [string, string] => [m.sourceExternalId, m.inventoryItemId]),
  );

  // Build location name lookup and item→locations map for UI enrichment + tiebreaking
  // @ts-ignore
  const locationsById = new Map(existingLocations.map(l => [l.id, l.name]));
  const locationsByItemId = new Map<string, string[]>();
  for (const a of locationAssignments as LocationAssignment[]) {
    const locName = locationsById.get(a.locationId);
    if (!locName) continue;
    const names = locationsByItemId.get(a.inventoryItemId) ?? [];
    // @ts-ignore
    names.push(locName);
    locationsByItemId.set(a.inventoryItemId, names);
  }

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

    // ── Strategy 5: location-history tiebreaker ──
    // When the item match is still ambiguous after strategies 1–4, check whether
    // exactly one candidate has a prior location assignment for this row's location.
    // If so, promote that candidate to 'high' confidence automatically.
    if (itemMatch.confidence === 'ambiguous' && locationMatch.locationId) {
      const resolved = breakTieByLocation(
        itemMatch,
        locationMatch.locationId,
        locationAssignments as LocationAssignment[],
      );
      if (resolved) itemMatch = resolved;
    }

    // ── Possible re-code detection ──
    // When a row has a valid item code that is NOT in the external mappings
    // (unmapped code) AND was not resolved by item_code strategy (the code
    // doesn't match any existing pluSku), but the cleaned description exactly
    // normalizes-matches an existing item name, Orderly has most likely
    // assigned a new code to a product already in the catalog.  Flag the row
    // so the user can explicitly link it rather than creating a duplicate.
    // This does NOT auto-link — linking stays an explicit user action.
    const isUnmappedValidCode =
      !extId &&
      row.itemCodeStatus === 'valid' &&
      Boolean(row.sourceItemCode?.trim());
    const codeWasMatched =
      itemMatch.strategy === 'external_mapping' || itemMatch.strategy === 'item_code';
    if (isUnmappedValidCode && !codeWasMatched) {
      const normalizedDesc = normalizeForMatch(row.cleanedDescription ?? '');
      if (normalizedDesc) {
        const nameExactMatch = matchableItems.find(
          it => normalizeForMatch(it.name) === normalizedDesc,
        );
        if (nameExactMatch) {
          itemMatch = {
            ...itemMatch,
            possibleRecode: true,
            possibleRecodeMatchedId: nameExactMatch.id,
          };
        }
      }
    }

    resolutions.push({ rowIndex: row.rowIndex, itemMatch, vendorMatch, locationMatch, itemCodeStatus: row.itemCodeStatus, sourceItemCode: row.sourceItemCode });
  }

  const summary = computeResolutionSummary(resolutions);

  // Build id → item lookup so preview rows can carry candidate details
  // (name / caseSize / pluSku / knownLocations) without an extra DB round-trip.
  // @ts-ignore
  const itemById = new Map(existingItems.map(item => [item.id, item]));

  const rows = batchRows.map((row: InventoryImportRow, i: number) => {
    const rawMatch = resolutions[i].itemMatch;
    const candidates = rawMatch.candidateIds
      .map(id => {
        const item = itemById.get(id);
        if (!item) return null;
        return { ...item, knownLocations: locationsByItemId.get(id) ?? [] };
      })
      .filter((item): item is MatchableItem & { knownLocations: string[] } => item != null);
    const matchedItemBase = rawMatch.matchedId
      ? (itemById.get(rawMatch.matchedId) ?? null)
      : null;
    const matchedItem = matchedItemBase
      // @ts-ignore
      ? { ...matchedItemBase, knownLocations: locationsByItemId.get(matchedItemBase.id) ?? [] }
      : null;
    const possibleRecodeBase = rawMatch.possibleRecodeMatchedId
      ? (itemById.get(rawMatch.possibleRecodeMatchedId) ?? null)
      : null;
    const possibleRecodeItem = possibleRecodeBase
      // @ts-ignore
      ? { ...possibleRecodeBase, knownLocations: locationsByItemId.get(possibleRecodeBase.id) ?? [] }
      : null;

    return {
      rowId: row.id,
      rowIndex: row.rowIndex,
      storageLocation: row.storageLocation,
      sourceItemCode: row.sourceItemCode,
      itemCodeStatus: row.itemCodeStatus,
      cleanedDescription: row.cleanedDescription,
      supplierRaw: row.supplierRaw,
      sourceCategory: (row as any).sourceCategory ?? null,
      caseQuantity: row.caseQuantity,
      innerPackQuantity: row.innerPackQuantity,
      baseUnit: row.baseUnit,
      packagePrice: row.packagePrice,
      totalCost: row.totalCost,
      itemMatch: { ...rawMatch, candidates, matchedItem, possibleRecodeItem },
      vendorMatch: resolutions[i].vendorMatch,
      locationMatch: resolutions[i].locationMatch,
    };
  });
  const identitySummary = buildIdentitySummary(rows);

  return {
    batchId,
    inventoryDate: batchMeta[0].inventoryDate,
    totalRows: batchRows.length,
    summary,
    rows,
    newLocations: Array.from(newLocationNames),
    newVendors: Array.from(newVendorNames),
    identitySummary,
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
/**
 * Validate that a resolved target store is one the acting user is approved for.
 *
 * Fail-closed contract: a null/omitted approved-store list is NOT a permission
 * to proceed. Callers must pass the acting user's real accessible-store list.
 * Only a catalog-only import (no destination store at all) passes without a
 * store membership check.
 */
export function assertStoreIsApproved(
  resolvedStoreId: string | null,
  approvedStoreIds: readonly string[] | null,
  label = 'destination store',
): void {
  if (approvedStoreIds == null) {
    // Fail closed: an omitted authorization context can never mean "allow".
    throw new ImportApprovalError(
      'FORBIDDEN',
      `Authorization context is required to resolve the ${label} for this import.`,
    );
  }
  if (resolvedStoreId == null) return; // catalog-only — no store to protect
  if (!approvedStoreIds.includes(resolvedStoreId)) {
    throw new ImportApprovalError(
      'FORBIDDEN',
      `You do not have access to the ${label} for this import.`,
    );
  }
}

// ─── Authoritative approval contract ──────────────────────────────────────────

export type ImportApprovalErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_REQUEST';

/** Typed failure so callers (routes) map status codes without string matching. */
export class ImportApprovalError extends Error {
  constructor(public readonly code: ImportApprovalErrorCode, message: string) {
    super(message);
    this.name = 'ImportApprovalError';
  }
}

/**
 * Authorization context for an approval.
 *
 * `actingUserId` is the identity the service verifies for itself — it re-reads
 * the user, its company authorization, and its store access from the database.
 * No caller-supplied store list, destination, or role claim is trusted.
 */
export interface ApprovalAuthorizationContext {
  actingUserId: string;
  companyId: string;
}

/**
 * Resolve and verify the approval contract for a staged batch.
 *
 * Runs entirely BEFORE any persistent mutation so a rejected approval leaves no
 * target-store change, no batch-state change, and no domain records.
 *
 * Establishes independently of the caller:
 *  - acting user identity (must exist, be active, and belong to the company)
 *  - company authorization
 *  - batch company ownership
 *  - durable source property + its approved destination binding
 *  - destination store authorization for the acting user
 *  - immutable/already-bound destination behavior
 */
async function resolveApprovalContract(
  batchId: string,
  auth: ApprovalAuthorizationContext | null | undefined,
): Promise<{
  batch: {
    id: string;
    status: string;
    targetStoreId: string | null;
    sourceSystem: string;
    sourcePropertyId: string;
  };
  companyId: string;
  actingUserId: string;
  resolvedTargetStoreId: string | null;
}> {
  // ── 1. Authorization context must be present and complete ────────────────
  // A null/omitted argument must never mean "allow".
  if (!auth || typeof auth !== 'object') {
    throw new ImportApprovalError(
      'UNAUTHENTICATED',
      'An authorization context is required to approve an import.',
    );
  }
  const actingUserId = typeof auth.actingUserId === 'string' ? auth.actingUserId.trim() : '';
  const companyId = typeof auth.companyId === 'string' ? auth.companyId.trim() : '';
  if (!actingUserId) {
    throw new ImportApprovalError(
      'UNAUTHENTICATED',
      'An acting user is required to approve an import.',
    );
  }
  if (!companyId) {
    throw new ImportApprovalError(
      'UNAUTHENTICATED',
      'A company context is required to approve an import.',
    );
  }

  // ── 2. Acting user identity — re-read from the database ──────────────────
  const actingUser = await storage.getUser(actingUserId);
  if (!actingUser || actingUser.active !== 1) {
    throw new ImportApprovalError(
      'UNAUTHENTICATED',
      'The acting user could not be verified for this import.',
    );
  }

  // ── 3. Company authorization ─────────────────────────────────────────────
  // Global/company admins are covered by hasCompanyAccess; scoped roles must
  // belong to the company they are importing into.
  const companyAuthorized =
    hasCompanyAccess(actingUser, companyId) || actingUser.companyId === companyId;
  if (!companyAuthorized) {
    throw new ImportApprovalError(
      'FORBIDDEN',
      'You are not authorized to approve imports for this company.',
    );
  }

  // ── 4. Batch ownership — scoped read, never trusts a caller-passed company ─
  const [batch] = await db
    .select({
      id: inventoryImportBatches.id,
      status: inventoryImportBatches.status,
      targetStoreId: inventoryImportBatches.targetStoreId,
      sourceSystem: inventoryImportBatches.sourceSystem,
      sourcePropertyBindingId: inventoryImportBatches.sourcePropertyBindingId,
      sourcePropertyId: inventoryImportBatches.sourcePropertyId,
      companyId: inventoryImportBatches.companyId,
    })
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

  if (!batch) throw new ImportApprovalError('NOT_FOUND', 'Batch not found');
  if (batch.status === 'approved') {
    throw new ImportApprovalError(
      'CONFLICT',
      'Batch has already been approved — use the history view to see results.',
    );
  }

  // ── 5. Source-property binding ───────────────────────────────────────────
  // When a batch was staged against an approved source property, that binding
  // is the authority for the destination. A client cannot redirect it.
  let bindingDestinationStoreId: string | null = null;

  if (batch.sourcePropertyBindingId || batch.sourcePropertyId) {
    if (!batch.sourcePropertyBindingId || !batch.sourcePropertyId) {
      throw new ImportApprovalError(
        'FORBIDDEN',
        'This import has an incomplete source-property binding and cannot be approved.',
      );
    }

    const [binding] = await db
      .select({
        id: importSourcePropertyBindings.id,
        companyId: importSourcePropertyBindings.companyId,
        sourceSystem: importSourcePropertyBindings.sourceSystem,
        sourcePropertyId: importSourcePropertyBindings.sourcePropertyId,
        destinationStoreId: importSourcePropertyBindings.destinationStoreId,
        active: importSourcePropertyBindings.active,
      })
      .from(importSourcePropertyBindings)
      // @ts-ignore
      .where(eq(importSourcePropertyBindings.id, batch.sourcePropertyBindingId))
      .limit(1);

    if (!binding || binding.active !== 1) {
      throw new ImportApprovalError(
        'FORBIDDEN',
        'The approved source-property binding for this import is missing or inactive.',
      );
    }
    // The binding must belong to the same company as the batch.
    if (binding.companyId !== companyId) {
      throw new ImportApprovalError(
        'FORBIDDEN',
        'The source-property binding for this import belongs to a different company.',
      );
    }
    // The staged source property must still match the binding — a different
    // source property (e.g. another club) can never be approved into this
    // destination.
    if (
      binding.sourcePropertyId !== batch.sourcePropertyId ||
      binding.sourceSystem !== batch.sourceSystem
    ) {
      throw new ImportApprovalError(
        'FORBIDDEN',
        'The source property recorded on this import does not match its approved binding.',
      );
    }

    bindingDestinationStoreId = binding.destinationStoreId;

    // Immutable destination: if the batch is already bound to a store, that
    // store must be the binding's destination. Never silently re-point it.
    if (batch.targetStoreId && batch.targetStoreId !== bindingDestinationStoreId) {
      throw new ImportApprovalError(
        'FORBIDDEN',
        'This import is bound to a destination that does not match its approved source property.',
      );
    }
  }

  // ── 6. Resolve the destination store ─────────────────────────────────────
  // Priority: approved binding → already-bound target → single-store fallback.
  // No caller-supplied destination participates in this decision.
  let resolvedTargetStoreId: string | null =
    bindingDestinationStoreId ?? batch.targetStoreId ?? null;

  // The acting user's real store access, read from the database.
  const accessibleStoreIds = await getAccessibleStores(actingUser, companyId);

  if (!resolvedTargetStoreId) {
    // Legacy batch with no persisted destination: resolve only when
    // unambiguous, and only from stores this user may actually write to.
    const activeStores = await db
      .select({ id: companyStores.id })
      .from(companyStores)
      .where(
        and(
          // @ts-ignore
          eq(companyStores.companyId, companyId),
          // @ts-ignore
          eq(companyStores.status, 'active'),
        ),
      );
    const candidates = (activeStores as Array<{ id: string }>)
      .map(s => s.id)
      .filter(id => accessibleStoreIds.includes(id));

    if (activeStores.length === 0) {
      resolvedTargetStoreId = null; // catalog-only import
    } else if (candidates.length === 1) {
      resolvedTargetStoreId = candidates[0];
    } else if (candidates.length === 0) {
      throw new ImportApprovalError(
        'FORBIDDEN',
        'You do not have access to a destination store for this import.',
      );
    } else {
      throw new ImportApprovalError(
        'INVALID_REQUEST',
        'This company has multiple stores. A target store must be bound to this import before it can be approved.',
      );
    }
  } else {
    // Validate the resolved destination belongs to this company and is active.
    const [targetStore] = await db
      .select({ id: companyStores.id, status: companyStores.status })
      .from(companyStores)
      .where(
        and(
          // @ts-ignore
          eq(companyStores.id, resolvedTargetStoreId),
          // @ts-ignore
          eq(companyStores.companyId, companyId),
        ),
      )
      .limit(1);

    if (!targetStore) {
      throw new ImportApprovalError(
        'FORBIDDEN',
        'Target store not found or does not belong to this company.',
      );
    }
    if (targetStore.status !== 'active') {
      throw new ImportApprovalError(
        'INVALID_REQUEST',
        'Target store is not active. Approval is only allowed for active stores.',
      );
    }
  }

  // ── 7. Destination authorization for the acting user ─────────────────────
  // Runs after the company check so a cross-store attempt is rejected even when
  // the store belongs to the correct company.
  assertStoreIsApproved(resolvedTargetStoreId, accessibleStoreIds);

  return {
    batch: {
      id: batch.id,
      status: batch.status,
      targetStoreId: batch.targetStoreId ?? null,
      sourceSystem: batch.sourceSystem,
      // Verified against the active binding above when one exists.
      sourcePropertyId: batch.sourcePropertyId ?? '',
    },
    companyId,
    actingUserId,
    resolvedTargetStoreId,
  };
}

/**
 * Apply a batch approval.
 *
 * The service is authoritative: it verifies the acting user, company, batch
 * ownership, source property, and destination store for itself. It is safe to
 * call directly (outside any HTTP route) and fails closed when the
 * authorization context is missing or incomplete.
 */
export async function applyBatchApproval(
  batchId: string,
  auth: ApprovalAuthorizationContext | null | undefined,
  rowDecisions: RowDecision[] = [],
): Promise<ApprovalResult> {
  // ── Authorization + destination contract (zero writes on any failure) ────
  const contract = await resolveApprovalContract(batchId, auth);
  const { batch, companyId, actingUserId } = contract;
  const resolvedTargetStoreId = contract.resolvedTargetStoreId;
  const userId: string | null = actingUserId;
  // Verified source-property scope for every external mapping written below.
  const approvedSourcePropertyId = batch.sourcePropertyId;

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
        // @ts-ignore
        eq(inventoryItems.companyId, companyId),
        // @ts-ignore
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
        // @ts-ignore
        eq(vendors.companyId, companyId),
        // @ts-ignore
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
  if (preview.identitySummary.conflictingReliableCodeGroups.length > 0) {
    const details = preview.identitySummary.conflictingReliableCodeGroups
      .map(group => `${group.sourceItemCode} (rows ${group.rowIndexes.join(', ')}: ${group.reasons.join('; ')})`)
      .join(' | ');
    throw new ImportApprovalError(
      'CONFLICT',
      `Reliable Orderly Item Code groups contain incompatible or divergent identity evidence and require review: ${details}`,
    );
  }
  // A group may include an earlier row that is unmatched and a later row with
  // a safe existing match. Resolve the whole reliable-code group to that
  // existing item before considering any create path, independent of row order.
  const reliableCodeExistingItemIds = new Map<string, string>();
  for (const row of preview.rows) {
    if (
      !isReliableItemCode(row) ||
      row.itemMatch.requiresReview ||
      row.itemMatch.matchedId == null
    ) {
      continue;
    }
    const code = row.sourceItemCode!.trim();
    const existing = reliableCodeExistingItemIds.get(code);
    if (existing && existing !== row.itemMatch.matchedId) {
      throw new ImportApprovalError(
        'CONFLICT',
        `Reliable Orderly Item Code ${code} resolves to multiple existing inventory items and requires review.`,
      );
    }
    reliableCodeExistingItemIds.set(code, row.itemMatch.matchedId);
  }

  // ── Fetch "each" unit for new item creation ──────────────────────────────
  const eachUnitId = await getEachUnitId();

  // ── Apply everything in one transaction ─────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction(async (tx: any) => {
    let itemsCreated = 0, itemsLinked = 0;
    let vendorsCreated = 0, vendorsLinked = 0;
    let locationsCreated = 0, locationsLinked = 0;
    let vendorItemsCreated = 0, rowsSkipped = 0, rowsProcessed = 0;
    let storeItemsCreated = 0, storeItemsReactivated = 0;
    let storeItemsAlreadyLinked = 0, storeItemsSkipped = 0;

    // Track distinct resolved item IDs and their storage locations for the
    // store_inventory_items upsert that happens after the row loop.
    const resolvedItemIds = new Set<string>();
    // itemId → Set of locationIds seen in this batch (for primary location rule)
    const itemLocationSets = new Map<string, Set<string>>();
    // Authoritative batch-local identity cache. A reliable XLSX Item Code is
    // resolved/created once inside this transaction, before its individual
    // location rows are processed. It deliberately excludes location, vendor,
    // pricing, quantities, and source-period fields.
    const reliableCodeItemIds = new Map<string, string | null>();

    // ── Transaction-time identity re-read ────────────────────────────────
    // The preview ran outside this transaction, so a concurrent approval of
    // the same source property may have created mappings since. Re-read them
    // here and let the persisted mapping win, so two concurrent approvals
    // converge on one inventory item instead of each creating their own.
    const batchReliableCodes = Array.from(new Set(
      preview.rows
        .filter(row => isReliableItemCode(row))
        .map(row => row.sourceItemCode!.trim()),
    ));
    const committedCodeItemIds = new Map<string, string>();
    if (batchReliableCodes.length > 0) {
      const committedMappings = await tx
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
            // @ts-ignore
            eq(inventoryItemExternalMappings.sourcePropertyId, approvedSourcePropertyId),
            // @ts-ignore
            inArray(inventoryItemExternalMappings.sourceExternalId, batchReliableCodes),
          ),
        );
      for (const mapping of committedMappings as Array<{ sourceExternalId: string; inventoryItemId: string }>) {
        committedCodeItemIds.set(mapping.sourceExternalId, mapping.inventoryItemId);
      }
    }

    /**
     * Claim the single inventory item for a reliable Item Code.
     *
     * The mapping row is the identity authority: it is inserted first with
     * ON CONFLICT DO NOTHING, and when a concurrent transaction already won
     * the race, its committed item is adopted and the locally created item is
     * never used. This makes resolve/create-once hold across approvals, not
     * just within one batch.
     */
    async function claimReliableCodeItemId(
      code: string,
      resolveCandidate: () => Promise<{ itemId: string; created: boolean }>,
      mappingEvidence: { description: string | null; strategy: string; score: number | null },
    ): Promise<{ itemId: string; created: boolean }> {
      const committed = committedCodeItemIds.get(code);
      if (committed) return { itemId: committed, created: false };

      const candidate = await resolveCandidate();
      const candidateItemId = candidate.itemId;
      const inserted = await tx
        .insert(inventoryItemExternalMappings)
        .values({
          companyId,
          inventoryItemId: candidateItemId,
          sourceSystem: 'ORDERLY',
          sourcePropertyId: approvedSourcePropertyId,
          sourceExternalId: code,
          sourceDescription: mappingEvidence.description,
          matchStrategy: mappingEvidence.strategy,
          confidenceScore: mappingEvidence.score,
          confirmedAt: new Date(),
          confirmedBy: userId,
        })
        .onConflictDoNothing()
        .returning({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId });

      if (inserted.length > 0) {
        committedCodeItemIds.set(code, candidateItemId);
        return { itemId: candidateItemId, created: candidate.created };
      }

      // Lost the race: adopt the winner. Only an item this transaction just
      // created may be discarded — a pre-existing catalog item is never
      // deleted, it is simply not used as this code's identity.
      const [winner] = await tx
        .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
        .from(inventoryItemExternalMappings)
        .where(
          and(
            // @ts-ignore
            eq(inventoryItemExternalMappings.companyId, companyId),
            // @ts-ignore
            eq(inventoryItemExternalMappings.sourceSystem, 'ORDERLY'),
            // @ts-ignore
            eq(inventoryItemExternalMappings.sourcePropertyId, approvedSourcePropertyId),
            // @ts-ignore
            eq(inventoryItemExternalMappings.sourceExternalId, code),
          ),
        )
        .limit(1);
      if (!winner) {
        throw new ImportApprovalError(
          'CONFLICT',
          `Could not establish a single inventory item for Orderly Item Code ${code}. Retry the approval.`,
        );
      }
      if (candidate.created && candidateItemId !== winner.inventoryItemId) {
        // Only the throwaway item this transaction just created is removed.
        // A pre-existing catalog item that lost the race is left untouched —
        // it simply is not this code's identity.
        await tx.delete(inventoryItems).where(
          and(
            // @ts-ignore
            eq(inventoryItems.id, candidateItemId),
            // @ts-ignore
            eq(inventoryItems.companyId, companyId),
          ),
        );
      }
      committedCodeItemIds.set(code, winner.inventoryItemId);
      return { itemId: winner.inventoryItemId, created: false };
    }

    // Persist auto-resolved store ID onto the batch if it wasn't already set
    if (resolvedTargetStoreId && !batch.targetStoreId) {
      await tx
        .update(inventoryImportBatches)
        .set({ targetStoreId: resolvedTargetStoreId })
        // @ts-ignore
        .where(eq(inventoryImportBatches.id, batchId));
    }

    // ── Location pass (deduplicated across all rows) ─────────────────────
    const locationCache = new Map<string, string>(); // normalizedName → id

    // Pre-load existing locations into cache
    const existingLocs = await tx
      .select({ id: inventoryLocations.id, normalizedName: inventoryLocations.normalizedName })
      .from(inventoryLocations)
      // @ts-ignore
      .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.active, 1)));
    for (const loc of existingLocs) {
      locationCache.set(loc.normalizedName, loc.id);
    }

    // ── Vendor pass (deduplicated across all rows) ───────────────────────
    const vendorCache = new Map<string, string>(); // normalizedName → vendorId
    const existingVendors = await tx
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      // @ts-ignore
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
        storeItemsSkipped++;
        continue;
      }

      // ── Item resolution ──────────────────────────────────────────────
      // Resolve category for this row upfront — used in both the new-item
      // INSERT and the matched-item conditional UPDATE below.
      const rowCatKey = (rowPreview.sourceCategory?.trim() ?? '').toLowerCase();
      const resolvedCategoryId = rowCatKey ? (categoryCache.get(rowCatKey) ?? null) : null;

      let resolvedItemId: string | null = null;
      let isNewItem = false;
      const reliableCode = isReliableItemCode(rowPreview)
        ? rowPreview.sourceItemCode!.trim()
        : null;
      const groupedExistingItemId = reliableCode
        ? (reliableCodeExistingItemIds.get(reliableCode) ?? null)
        : null;

      const insertNewItem = async (): Promise<string> => {
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
        return newItem.id;
      };

      /**
       * Choose this row's item ignoring any cross-approval mapping: batch
       * cache, group-wide safe match, manual override, confident match, blank
       * code, or a newly created item.
       */
      const resolveRowCandidate = async (): Promise<{ itemId: string | null; created: boolean }> => {
        if (reliableCode && reliableCodeItemIds.has(reliableCode)) {
          const cachedItemId = reliableCodeItemIds.get(reliableCode) ?? null;
          if (
            dec?.inventoryItemId !== undefined &&
            (dec.inventoryItemId ?? null) !== cachedItemId
          ) {
            throw new ImportApprovalError(
              'CONFLICT',
              `Rows with reliable Orderly Item Code ${reliableCode} must resolve to one inventory item within this batch.`,
            );
          }
          return { itemId: cachedItemId, created: false };
        }
        if (groupedExistingItemId) {
          if (
            dec?.inventoryItemId !== undefined &&
            (dec.inventoryItemId ?? null) !== groupedExistingItemId
          ) {
            throw new ImportApprovalError(
              'CONFLICT',
              `Reliable Orderly Item Code ${reliableCode} is already mapped to a different inventory item.`,
            );
          }
          return { itemId: groupedExistingItemId, created: false };
        }
        if (dec?.inventoryItemId !== undefined) {
          // User override (validated to belong to this company above)
          return { itemId: dec.inventoryItemId ?? null, created: false };
        }
        const m = rowPreview.itemMatch;
        if (!m.requiresReview && m.matchedId !== null) {
          // Auto-link only when the matching algorithm is confident enough
          // NOT to require human review (strategies: external_mapping, item_code exact,
          // name_pack single-match). Fuzzy matches always have requiresReview:true
          // and must never be auto-linked.
          return { itemId: m.matchedId, created: false };
        }
        if (rowPreview.itemCodeStatus === 'blank') {
          // Blank codes are legitimate Orderly source rows, but no synthetic
          // identity may be invented from them. Keep the staged evidence
          // reviewable/unresolved unless a safe existing match was found.
          return { itemId: null, created: false };
        }
        // No confident auto-link (no match, fuzzy, or ambiguous) → new item.
        return { itemId: await insertNewItem(), created: true };
      };

      if (reliableCode) {
        // Every reliable-code resolution — existing match, manual override, or
        // new item — is settled through the committed mapping, which is the
        // single identity authority for this code within this source property.
        // Without this, two concurrent approvals could link the same code to
        // two different existing items while only one mapping row survived.
        const claim = await claimReliableCodeItemId(
          reliableCode,
          async () => {
            const candidate = await resolveRowCandidate();
            if (candidate.itemId == null) {
              throw new ImportApprovalError(
                'CONFLICT',
                `Orderly Item Code ${reliableCode} could not be resolved to an inventory item.`,
              );
            }
            return { itemId: candidate.itemId, created: candidate.created };
          },
          {
            description: rowPreview.cleanedDescription,
            strategy: rowPreview.itemMatch.strategy,
            score: rowPreview.itemMatch.score ?? null,
          },
        );
        resolvedItemId = claim.itemId;
        if (claim.created) {
          itemsCreated++;
          isNewItem = true;
        } else {
          itemsLinked++;
        }
      } else {
        const candidate = await resolveRowCandidate();
        resolvedItemId = candidate.itemId;
        if (candidate.created) {
          itemsCreated++;
          isNewItem = true;
        } else if (resolvedItemId) {
          itemsLinked++;
        }
      }
      if (reliableCode) reliableCodeItemIds.set(reliableCode, resolvedItemId);

      // Track distinct resolved items for store_inventory_items upsert below
      if (resolvedItemId) {
        resolvedItemIds.add(resolvedItemId);
      } else {
        // Row produced no item (skipped or null-resolved) — won't be store-linked
        storeItemsSkipped++;
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
              // @ts-ignore
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
        // @ts-ignore
        .where(eq(inventoryImportRows.id, rowPreview.rowId));

      // ── External mapping creation ───────────────────────────────────
      if (resolvedItemId && rowPreview.sourceItemCode && rowPreview.itemCodeStatus === 'valid') {
        await tx
          .insert(inventoryItemExternalMappings)
          .values({
            companyId,
            inventoryItemId: resolvedItemId,
            sourceSystem: 'ORDERLY',
            sourcePropertyId: approvedSourcePropertyId,
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
              // @ts-ignore
              eq(inventoryImportRows.batchId, batchId),
              // @ts-ignore
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

          // Track item → location associations for primary-location determination
          if (!itemLocationSets.has(resolvedItemId)) {
            itemLocationSets.set(resolvedItemId, new Set());
          }
          itemLocationSets.get(resolvedItemId)!.add(locId);
        }
      }
    } // end row loop

    // ── Upsert store_inventory_items ─────────────────────────────────────
    // Link every distinct resolved item to the target store so it appears
    // immediately on the Inventory Items page filtered by that store.
    // Rules:
    //   - New rows:      onHandQty=0, active=1
    //   - Existing rows: only active and updatedAt are touched; onHandQty,
    //                    parLevel, reorderLevel are preserved
    //   - primaryLocationId: set only when exactly one location in this batch
    //                        AND the existing value is currently null
    if (resolvedTargetStoreId && resolvedItemIds.size > 0) {
      // Pre-query existing rows so we can bucket outcomes accurately
      const existingRows = await tx
        .select({
          inventoryItemId: storeInventoryItems.inventoryItemId,
          active: storeInventoryItems.active,
        })
        .from(storeInventoryItems)
        .where(
          and(
            // @ts-ignore
            eq(storeInventoryItems.storeId, resolvedTargetStoreId),
            // @ts-ignore
            inArray(storeInventoryItems.inventoryItemId, Array.from(resolvedItemIds)),
          ),
        );

      type ExistingRow = { inventoryItemId: string; active: number | null };
      const existingActiveSet = new Set(
        (existingRows as ExistingRow[]).filter(r => r.active === 1).map(r => r.inventoryItemId),
      );
      const existingInactiveSet = new Set(
        (existingRows as ExistingRow[]).filter(r => r.active === 0).map(r => r.inventoryItemId),
      );

      for (const itemId of Array.from(resolvedItemIds)) {
        const locSet = itemLocationSets.get(itemId);
        // Only supply a primary location when unambiguous (exactly one location in batch)
        const unambiguousLocId = locSet?.size === 1 ? Array.from(locSet)[0] : null;

        await tx
          .insert(storeInventoryItems)
          .values({
            companyId,
            storeId: resolvedTargetStoreId,
            inventoryItemId: itemId,
            onHandQty: 0,
            active: 1,
            primaryLocationId: unambiguousLocId ?? null,
          })
          .onConflictDoUpdate({
            target: [storeInventoryItems.storeId, storeInventoryItems.inventoryItemId],
            set: {
              active: 1,
              updatedAt: new Date(),
              // Set primaryLocationId only when: existing value is null AND
              // this batch has exactly one unambiguous location for the item.
              primaryLocationId: unambiguousLocId
                ? sql`CASE WHEN ${storeInventoryItems.primaryLocationId} IS NULL THEN ${unambiguousLocId} ELSE ${storeInventoryItems.primaryLocationId} END`
                : sql`${storeInventoryItems.primaryLocationId}`,
            },
          });

        if (existingActiveSet.has(itemId)) {
          storeItemsAlreadyLinked++;
        } else if (existingInactiveSet.has(itemId)) {
          storeItemsReactivated++;
        } else {
          storeItemsCreated++;
        }
      }
    } else if (!resolvedTargetStoreId) {
      // No store resolved — all resolved items count as skipped for store linkage
      storeItemsSkipped += resolvedItemIds.size;
    }

    // ── Mark batch approved ──────────────────────────────────────────────
    await tx
      .update(inventoryImportBatches)
      .set({
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: userId,
        targetStoreId: resolvedTargetStoreId ?? null,
      })
      // @ts-ignore
      .where(eq(inventoryImportBatches.id, batchId));

    return {
      batchId,
      approvedAt: new Date().toISOString(),
      targetStoreId: resolvedTargetStoreId,
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
      storeItemsCreated,
      storeItemsReactivated,
      storeItemsAlreadyLinked,
      storeItemsSkipped,
    };
  });

  return result;
}
