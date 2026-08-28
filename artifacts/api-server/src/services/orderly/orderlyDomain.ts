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
import { eq, and, inArray, ne, sql } from 'drizzle-orm';
import {
  inventoryItems,
  vendors,
  vendorItems,
  vendorItemExternalMappings,
  inventoryLocations,
  inventoryItemLocationAssignments,
  inventoryItemExternalMappings,
  inventoryItemRelationships,
  inventoryImportBatches,
  orderlyImportApprovalJobs,
  inventoryImportRows,
  orderlyImportReviewDecisions,
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
  getHoldReason,
  normalizeForMatch,
  classifySourceItemCode,
  isStableSourceItemCode,
  type MatchResult,
  type VendorMatchResult,
  type LocationMatchResult,
  type RowResolution,
  type MatchableItem,
  type MatchableVendor,
  type MatchableLocation,
  type LocationAssignment,
  type PackEvidence,
  type SourceCodeReliability,
  type RecodeEvidenceClass,
} from './OrderlyMatcher';
import {
  comparePackGeometry,
  normalizePackGeometry,
  toCatalogPackGeometry,
  type SourcePackGeometry,
} from './packGeometry';
import {
  buildOrderlyIdentityGroup,
  deriveOrderlyAlternateSourceId,
  deriveOrderlyStableCodePackSourceId,
} from './orderlyIdentity';
import { parseOrderlyPackSize } from './OrderlyParser';
import {
  createOrderlyDecisionManifest,
  fingerprintOrderlyPreview,
  parseAndVerifyOrderlyDecisionManifest,
  OrderlyDecisionManifestError,
  type OrderlyDecisionManifest,
  type OrderlyDecisionManifestBatch,
} from './orderlyDecisionManifest';
import type { InventoryImportRow } from '@workspace/db';
import { storage } from '../../storage';
import { canApproveOrderlyImport, getAccessibleStores, hasCompanyAccess } from '../../permissions';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-row user override. rowIndex is the key. */
export interface RowDecision {
  rowIndex: number;
  /**
   * Explicit handling for an exact-name Orderly re-code candidate. A compatible
   * link reuses one inventory identity; a separate variant creates a new item
   * and records a comparable pack relationship instead.
   */
  action?: 'link_existing' | 'link_vendor_pack' | 'create_variant';
  /** Existing field retained for legacy/manual match overrides and link_existing. */
  inventoryItemId?: string | null;
  /** The existing comparable item for create_variant. Never becomes this code's mapping. */
  comparableInventoryItemId?: string | null;
  /** Force a specific vendorId. null = skip vendor creation. */
  vendorId?: string | null;
  /** Skip this row entirely — don't create or link anything. */
  skip?: boolean;
}

export type ReviewDecisionPayload = Omit<RowDecision, 'rowIndex'>;

export interface SavedReviewDecision {
  rowIndex: number;
  decision: ReviewDecisionPayload;
  revision: number;
  decidedBy: string | null;
  updatedAt: Date | null;
}

export interface ReviewDecisionChange {
  rowIndex: number;
  /** null means the caller saw no existing draft decision for this row. */
  expectedRevision: number | null;
  /** Omit to undo a previously saved decision. */
  decision?: ReviewDecisionPayload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeReviewDecision(
  rowIndex: number,
  value: unknown,
): ReviewDecisionPayload {
  if (!isPlainObject(value)) {
    throw new ImportApprovalError('INVALID_REQUEST', `Review decision for row ${rowIndex} is invalid.`);
  }
  const allowedKeys = new Set(['action', 'inventoryItemId', 'comparableInventoryItemId']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new ImportApprovalError('INVALID_REQUEST', `Review decision for row ${rowIndex} contains an unsupported field.`);
    }
  }

  const hasInventoryItemId = Object.prototype.hasOwnProperty.call(value, 'inventoryItemId');
  const action = value.action;
  const inventoryItemId = value.inventoryItemId;
  const comparableInventoryItemId = value.comparableInventoryItemId;

  if (
    action !== undefined &&
    action !== 'link_existing' &&
    action !== 'link_vendor_pack' &&
    action !== 'create_variant'
  ) {
    throw new ImportApprovalError('INVALID_REQUEST', `Review decision for row ${rowIndex} has an unsupported action.`);
  }
  if (
    inventoryItemId !== undefined &&
    inventoryItemId !== null &&
    (typeof inventoryItemId !== 'string' || inventoryItemId.trim().length === 0)
  ) {
    throw new ImportApprovalError('INVALID_REQUEST', `Review decision for row ${rowIndex} has an invalid inventory item.`);
  }
  if (
    comparableInventoryItemId !== undefined &&
    (typeof comparableInventoryItemId !== 'string' || comparableInventoryItemId.trim().length === 0)
  ) {
    throw new ImportApprovalError('INVALID_REQUEST', `Review decision for row ${rowIndex} has an invalid comparable item.`);
  }
  if (!action && !hasInventoryItemId) {
    throw new ImportApprovalError('INVALID_REQUEST', `Review decision for row ${rowIndex} does not select an outcome.`);
  }
  if (action === 'link_existing' || action === 'link_vendor_pack') {
    if (typeof inventoryItemId !== 'string' || !inventoryItemId.trim() || comparableInventoryItemId !== undefined) {
      throw new ImportApprovalError('INVALID_REQUEST', `Review ${action} decision for row ${rowIndex} needs one existing item.`);
    }
    return { action, inventoryItemId: inventoryItemId.trim() };
  }
  if (action === 'create_variant') {
    if (typeof comparableInventoryItemId !== 'string' || !comparableInventoryItemId.trim() || inventoryItemId !== undefined) {
      throw new ImportApprovalError('INVALID_REQUEST', `Review variant decision for row ${rowIndex} needs one comparable item.`);
    }
    return { action, comparableInventoryItemId: comparableInventoryItemId.trim() };
  }

  return { inventoryItemId: inventoryItemId == null ? null : inventoryItemId.trim() };
}

function assertReviewDecisionMatchesPreview(
  row: ResolutionPreviewResult['rows'][number],
  decision: ReviewDecisionPayload,
): void {
  if (row.itemMatch.sourceDataConflict) {
    throw new ImportApprovalError(
      'CONFLICT',
      `Row ${row.rowIndex} has contradictory source pack evidence and cannot receive a review decision.`,
    );
  }
  if (
    row.itemMatch.recodeEvidenceClass === 'unreliable_code' &&
    row.itemMatch.crossVendorPackEligible !== true
  ) {
    throw new ImportApprovalError(
      'CONFLICT',
      `Row ${row.rowIndex} has an unreliable Orderly Item Code and cannot receive a review decision.`,
    );
  }

  if (decision.action === 'link_existing') {
    if (
      !row.itemMatch.possibleRecode ||
      decision.inventoryItemId !== row.itemMatch.possibleRecodeMatchedId ||
      row.itemMatch.packCompatibility !== 'compatible'
    ) {
      throw new ImportApprovalError(
        'CONFLICT',
        `The saved link for row ${row.rowIndex} no longer matches its compatible review candidate.`,
      );
    }
    return;
  }
  if (decision.action === 'link_vendor_pack') {
    if (
      !row.itemMatch.possibleRecode ||
      decision.inventoryItemId !== row.itemMatch.possibleRecodeMatchedId ||
      row.itemMatch.packCompatibility !== 'incompatible' ||
      row.itemMatch.crossVendorPackEligible !== true
    ) {
      throw new ImportApprovalError(
        'CONFLICT',
        `The saved vendor-pack link for row ${row.rowIndex} no longer matches a verified different-vendor pack candidate.`,
      );
    }
    return;
  }
  if (decision.action === 'create_variant') {
    const isVerifiedIncompatibleVariant =
      row.itemMatch.recodeEvidenceClass === 'new_pack_size' &&
      row.itemMatch.packCompatibility === 'incompatible';
    const isUnknownPackVariant =
      row.itemMatch.recodeEvidenceClass === 'pack_evidence_missing' &&
      row.itemMatch.packCompatibility === 'unknown';
    if (
      !row.itemMatch.possibleRecode ||
      decision.comparableInventoryItemId !== row.itemMatch.possibleRecodeMatchedId ||
      (!isVerifiedIncompatibleVariant && !isUnknownPackVariant)
    ) {
      throw new ImportApprovalError(
        'CONFLICT',
        `The saved variant for row ${row.rowIndex} no longer matches an incompatible or incomplete-pack review candidate.`,
      );
    }
    return;
  }

  if (row.itemMatch.possibleRecode) {
    throw new ImportApprovalError(
      'CONFLICT',
      `Row ${row.rowIndex} needs an explicit compatible-link or separate-variant decision.`,
    );
  }
  if (decision.inventoryItemId === null) {
    if (!row.heldForReview && row.itemMatch.confidence === 'high') {
      throw new ImportApprovalError(
        'CONFLICT',
        `Row ${row.rowIndex} is already safely matched and cannot be changed to a new item.`,
      );
    }
    return;
  }

  const allowedItemIds = new Set([
    row.itemMatch.matchedId,
    row.itemMatch.possibleRecodeMatchedId,
    ...(row.itemMatch.candidateIds ?? []),
  ].filter((id): id is string => typeof id === 'string'));
  const selectedItemId = decision.inventoryItemId;
  if (!selectedItemId || !allowedItemIds.has(selectedItemId)) {
    throw new ImportApprovalError(
      'CONFLICT',
      `The saved item for row ${row.rowIndex} is no longer one of its review candidates.`,
    );
  }
}

function previewRowConflictLabel(row: ResolutionPreviewResult['rows'][number]): string {
  const description = row.cleanedDescription?.trim() || 'Description unavailable';
  const code = row.sourceItemCode?.trim() || 'Item Code unavailable';
  const incomingPack = row.packSizeRaw?.trim() || 'incoming pack unavailable';
  const candidate = row.itemMatch.candidatePackEvidence;
  const existingPack = candidate
    ? [candidate.caseQuantity, candidate.innerPackQuantity, candidate.baseUnitQuantity, candidate.baseUnit]
        .filter(value => value != null && value !== '')
        .join(' × ')
    : 'existing pack unavailable';
  return `${description} (Item Code ${code}; incoming ${incomingPack}; existing ${existingPack})`;
}

function reviewDecisionActionSignature(decision: ReviewDecisionPayload): string {
  return JSON.stringify({
    action: decision.action,
    inventoryItemId: decision.inventoryItemId,
    comparableInventoryItemId: decision.comparableInventoryItemId,
  });
}

/**
 * Re-code decisions are source-code decisions, not location-row decisions.
 * A draft may contain the same action on rows saved in earlier requests, but
 * the effective action for every row sharing that reliable code must agree.
 *
 * This is intentionally checked under the batch lock, using the saved rows
 * from that same transaction. The browser can select a group for convenience,
 * but it cannot define the group boundary or authorize a partial write.
 */
export function assertReviewDecisionCodeGroupConsistency(
  preview: ResolutionPreviewResult,
  changes: ReviewDecisionChange[],
  savedDecisions: SavedReviewDecision[] = [],
): void {
  const rowsByIndex = new Map(preview.rows.map(row => [row.rowIndex, row]));
  const savedByRow = new Map(savedDecisions.map(decision => [decision.rowIndex, decision.decision]));
  const changesByRow = new Map(changes.map(change => [change.rowIndex, change]));
  const impactedCodes = new Set<string>();

  for (const change of changes) {
    const row = rowsByIndex.get(change.rowIndex);
    if (!row || !isReliableItemCode(row)) continue;
    const saved = savedByRow.get(change.rowIndex);
    if (change.decision?.action !== undefined || saved?.action !== undefined || change.decision === undefined) {
      impactedCodes.add(row.sourceItemCode!.trim());
    }
  }

  for (const sourceCode of impactedCodes) {
    const groupRows = preview.rows.filter(row =>
      isReliableItemCode(row) && row.sourceItemCode!.trim() === sourceCode,
    );
    const effective = groupRows.map(row => {
      const change = changesByRow.get(row.rowIndex);
      if (change) return change.decision;
      return savedByRow.get(row.rowIndex);
    });
    const actionDecisions = effective.filter(
      (decision): decision is ReviewDecisionPayload => decision?.action !== undefined,
    );
    if (actionDecisions.length === 0) continue;
    const hasUnknownPackVariant = groupRows.some((row, index) =>
      actionDecisions[index]?.action === 'create_variant' &&
      row.itemMatch.recodeEvidenceClass === 'pack_evidence_missing' &&
      row.itemMatch.packCompatibility === 'unknown'
    );
    if (hasUnknownPackVariant && groupRows.length !== 1) {
      throw new ImportApprovalError(
        'CONFLICT',
        `Reliable Orderly Item Code ${sourceCode} has incomplete pack evidence across multiple rows and cannot create a shared variant.`,
      );
    }

    const conflictingSummaryGroup = preview.identitySummary.conflictingReliableCodeGroups
      .find(group => group.sourceItemCode.trim() === sourceCode);
    const identityGroupKeys = new Set(groupRows.map(row => row.identityGroupKey).filter(Boolean));
    const isSingleUnknownPackVariant =
      groupRows.length === 1 &&
      actionDecisions.length === 1 &&
      actionDecisions[0].action === 'create_variant' &&
      groupRows[0].itemMatch.recodeEvidenceClass === 'pack_evidence_missing' &&
      groupRows[0].itemMatch.packCompatibility === 'unknown';
    if (
      conflictingSummaryGroup ||
      (!isSingleUnknownPackVariant && (
        identityGroupKeys.size !== 1 ||
        groupRows.some(row => !row.identityGroupKey)
      ))
    ) {
      throw new ImportApprovalError(
        'CONFLICT',
        `Reliable Orderly Item Code ${sourceCode} spans conflicting description or pack identities and cannot receive a shared review decision.`,
      );
    }

    if (actionDecisions.length !== groupRows.length) {
      throw new ImportApprovalError(
        'CONFLICT',
        `All rows for reliable Orderly Item Code ${sourceCode} must use the same re-code decision. Save the complete group before continuing.`,
      );
    }

    const signature = reviewDecisionActionSignature(actionDecisions[0]);
    if (actionDecisions.some(decision => reviewDecisionActionSignature(decision) !== signature)) {
      throw new ImportApprovalError(
        'CONFLICT',
        `All rows for reliable Orderly Item Code ${sourceCode} must use the same re-code decision.`,
      );
    }

    for (const row of groupRows) {
      assertReviewDecisionMatchesPreview(row, actionDecisions[0]);
    }
  }
}

function assertSavedReviewDecisionsRemainValid(
  preview: ResolutionPreviewResult,
  decisions: RowDecision[],
): void {
  const rowsByIndex = new Map(preview.rows.map(row => [row.rowIndex, row]));
  const conflicts = preview.rows.filter(row => row.itemMatch.sourceDataConflict);
  if (conflicts.length > 0) {
    throw new ImportApprovalError(
      'CONFLICT',
      `Orderly source data changed to contradictory pack evidence before approval: ${conflicts.map(row => `row ${row.rowIndex}`).join(', ')}.`,
    );
  }
  const recodeDecisionByCode = new Map<string, RowDecision>();
  const staleDecisionDetails: string[] = [];
  for (const decision of decisions) {
    const row = rowsByIndex.get(decision.rowIndex);
    if (!row) {
      staleDecisionDetails.push(`row ${decision.rowIndex} is no longer part of this batch`);
      continue;
    }
    try {
      assertReviewDecisionMatchesPreview(row, decision);
    } catch (err: any) {
      staleDecisionDetails.push(`${previewRowConflictLabel(row)}: ${err?.message ?? 'saved decision is no longer valid'}`);
      continue;
    }
    if (decision.action === undefined) continue;
    if (isPseudoCodeVendorPackReview(row)) continue;
    if (!isReliableItemCode(row) || !row.itemMatch.possibleRecode) {
      staleDecisionDetails.push(`${previewRowConflictLabel(row)}: saved re-code decision is no longer eligible`);
      continue;
    }
    const sourceCode = row.sourceItemCode!.trim();
    const prior = recodeDecisionByCode.get(sourceCode);
    if (
      prior &&
      (
        prior.action !== decision.action ||
        prior.inventoryItemId !== decision.inventoryItemId ||
        prior.comparableInventoryItemId !== decision.comparableInventoryItemId
      )
    ) {
      staleDecisionDetails.push(`Item Code ${sourceCode}: saved decisions no longer agree`);
      continue;
    }
    recodeDecisionByCode.set(sourceCode, decision);
  }
  const checkedCodes = new Set<string>();
  for (const row of preview.rows.filter(row => row.itemMatch.possibleRecode && isReliableItemCode(row))) {
    const sourceCode = row.sourceItemCode!.trim();
    if (checkedCodes.has(sourceCode)) continue;
    checkedCodes.add(sourceCode);
    const codeRows = preview.rows.filter(candidate =>
      isReliableItemCode(candidate) &&
      candidate.itemMatch.possibleRecode &&
      candidate.sourceItemCode!.trim() === sourceCode
    );
    const decision = recodeDecisionByCode.get(sourceCode);
    if (!decision) {
      staleDecisionDetails.push(`${previewRowConflictLabel(row)}: now requires an explicit review decision`);
      continue;
    }
    for (const codeRow of codeRows) {
      try {
        // One reviewed code may appear on multiple staged rows. Validate the
        // same saved action against every current candidate and pack evidence.
        assertReviewDecisionMatchesPreview(codeRow, decision);
      } catch (err: any) {
        staleDecisionDetails.push(
          `${previewRowConflictLabel(codeRow)}: ${err?.message ?? 'saved decision is no longer valid'}`,
        );
      }
    }
  }
  const decisionsByRowIndex = new Map(decisions.map(decision => [decision.rowIndex, decision]));
  for (const row of preview.rows.filter(isPseudoCodeVendorPackReview)) {
    const decision = decisionsByRowIndex.get(row.rowIndex);
    if (!decision?.action) {
      staleDecisionDetails.push(
        `${previewRowConflictLabel(row)}: now requires an explicit vendor-pack link decision`,
      );
      continue;
    }
    try {
      assertReviewDecisionMatchesPreview(row, decision);
    } catch (err: any) {
      staleDecisionDetails.push(
        `${previewRowConflictLabel(row)}: ${err?.message ?? 'saved decision is no longer valid'}`,
      );
    }
  }

  if (preview.identitySummary.conflictingReliableCodeGroups.length > 0) {
    staleDecisionDetails.push(
      ...preview.identitySummary.conflictingReliableCodeGroups.map(group =>
        `Item Code ${group.sourceItemCode}: ${group.reasons.join('; ')}`
      ),
    );
  }
  if (staleDecisionDetails.length > 0) {
    throw new ImportApprovalError(
      'CONFLICT',
      `Approval preflight found ${staleDecisionDetails.length} review conflict${staleDecisionDetails.length === 1 ? '' : 's'}. Review all listed items before retrying: ${staleDecisionDetails.join(' | ')}`,
    );
  }
}

function deriveApprovalIdentityCaches(preview: ResolutionPreviewResult): {
  reliableCodeExistingItemIds: Map<string, string>;
  identityGroupExistingItemIds: Map<string, string>;
  blankGroupMayFollowCodedSibling: Map<string, boolean>;
  blankGroupMayCreateInternalItem: Map<string, boolean>;
} {
  if (preview.identitySummary.conflictingReliableCodeGroups.length > 0) {
    const details = preview.identitySummary.conflictingReliableCodeGroups
      .map(group => `${group.sourceItemCode} (rows ${group.rowIndexes.join(', ')}: ${group.reasons.join('; ')})`)
      .join(' | ');
    throw new ImportApprovalError(
      'CONFLICT',
      `Reliable Orderly Item Code groups contain incompatible or divergent identity evidence and require review: ${details}`,
    );
  }

  const reliableCodeExistingItemIds = new Map<string, string>();
  const identityGroupExistingItemIds = new Map<string, string>();
  const identityGroups = new Map<string, ResolutionPreviewResult['rows']>();
  for (const row of preview.rows) {
    if (
      isReliableItemCode(row) &&
      !row.itemMatch.requiresReview &&
      row.itemMatch.matchedId != null &&
      !row.itemMatch.possibleRecode
    ) {
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
    if (row.identityGroupKey) {
      const group = identityGroups.get(row.identityGroupKey) ?? [];
      group.push(row);
      identityGroups.set(row.identityGroupKey, group);
    }
  }

  const blankGroupMayFollowCodedSibling = new Map<string, boolean>();
  const blankGroupMayCreateInternalItem = new Map<string, boolean>();
  for (const [groupKey, group] of identityGroups) {
    const safeItemIds = new Set(group
      .filter(row =>
        !row.itemMatch.requiresReview &&
        row.itemMatch.matchedId != null &&
        !row.itemMatch.possibleRecode
      )
      .map(row => row.itemMatch.matchedId!));
    // An unqualified name+pack group is reusable only when it identifies one
    // item. Multiple stable codes may safely occupy the group, but the group
    // itself must not become an approval-time mutation target.
    if (safeItemIds.size === 1) {
      identityGroupExistingItemIds.set(groupKey, [...safeItemIds][0]);
    }
    const blankRow = group.find(row => row.itemCodeStatus === 'blank');
    if (!blankRow) continue;
    blankGroupMayFollowCodedSibling.set(groupKey, hasSafeCodedSibling(blankRow, group));
    blankGroupMayCreateInternalItem.set(groupKey, canCreateInternalItemForBlankGroup(blankRow, group));
  }
  return {
    reliableCodeExistingItemIds,
    identityGroupExistingItemIds,
    blankGroupMayFollowCodedSibling,
    blankGroupMayCreateInternalItem,
  };
}

async function assertReviewDecisionItemsBelongToCompany(
  companyId: string,
  decisions: Array<{ rowIndex: number; decision: ReviewDecisionPayload }>,
  runner: any = db,
): Promise<void> {
  const itemIds = Array.from(new Set(
    decisions.flatMap(({ decision }) => [
      decision.inventoryItemId,
      decision.comparableInventoryItemId,
    ]).filter((id): id is string => typeof id === 'string'),
  ));
  if (itemIds.length === 0) return;
  const found = await runner
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(and(
      // @ts-ignore
      eq(inventoryItems.companyId, companyId),
      // @ts-ignore
      inArray(inventoryItems.id, itemIds),
    ));
  const foundIds = new Set(found.map((item: { id: string }) => item.id));
  const invalidId = itemIds.find(id => !foundIds.has(id));
  if (invalidId) {
    throw new ImportApprovalError(
      'FORBIDDEN',
      `Review decision references an inventory item outside this company.`,
    );
  }
}

async function loadStoredReviewDecisionRecords(
  batchId: string,
  companyId: string,
  runner: any = db,
): Promise<SavedReviewDecision[]> {
  const rows = await runner
    .select({
      rowIndex: orderlyImportReviewDecisions.rowIndex,
      decision: orderlyImportReviewDecisions.decision,
      revision: orderlyImportReviewDecisions.revision,
      decidedBy: orderlyImportReviewDecisions.updatedBy,
      updatedAt: orderlyImportReviewDecisions.updatedAt,
    })
    .from(orderlyImportReviewDecisions)
    .where(and(
      // @ts-ignore
      eq(orderlyImportReviewDecisions.batchId, batchId),
      // @ts-ignore
      eq(orderlyImportReviewDecisions.companyId, companyId),
    ))
    .orderBy(orderlyImportReviewDecisions.rowIndex);
  return rows.map((row: any) => ({
    rowIndex: row.rowIndex,
    decision: normalizeReviewDecision(row.rowIndex, row.decision),
    revision: row.revision,
    decidedBy: row.decidedBy ?? null,
    updatedAt: row.updatedAt ?? null,
  }));
}

function reviewDecisionSignature(decisions: SavedReviewDecision[]): string {
  return JSON.stringify(decisions.map(decision => ({
    rowIndex: decision.rowIndex,
    decision: decision.decision,
    revision: decision.revision,
  })));
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
  /** Rows that remained unlinked because their blank Item Code could not safely establish identity. */
  rowsHeldForReview: number;
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
    sourceCodeReliability: SourceCodeReliability;
    packSizeRaw: string | null;
    cleanedDescription: string | null;
    supplierRaw: string | null;
    sourceCategory: string | null;
    caseQuantity: number | null;
    innerPackQuantity: number | null;
    baseUnitQuantity: number | null;
    baseUnit: string | null;
    packParseStatus: string | null;
    packagePrice: number | null;
    totalCost: number | null;
    itemMatch: MatchResult;
    vendorMatch: VendorMatchResult;
    locationMatch: LocationMatchResult;
    heldForReview: boolean;
    holdReason: string | null;
    identityGroupKey: string | null;
    identityGroupRows: number[];
    identityGroupStatus: 'existing_item' | 'new_candidate' | 'review_required' | 'unavailable';
  }>;
  /** Unique locations that will be created on approval */
  newLocations: string[];
  /** Unique vendors that will be created on approval */
  newVendors: string[];
  /** Distinct review decisions by their evidence class, not raw location rows. */
  recodeSummary: {
    compatibleAlternates: number;
    newPackSizes: number;
    sourceDataConflicts: number;
    unreliableCodes: number;
    packEvidenceMissing: number;
  };
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
    uniqueIdentityGroups: number;
    identityGroupsResolvedToExisting: number;
    identityGroupsNewCandidates: number;
    identityGroupsRequiringReview: number;
    blankCodeGroupsWithCodedSibling: number;
    blankCodeGroupsAutoResolved: number;
    alternateIdentityMatches: number;
    blankCodeClassification: {
      confirmed: { rows: number; valueTotal: number };
      reviewable: { rows: number; valueTotal: number };
      conflicted: { rows: number; valueTotal: number };
      held: { rows: number; valueTotal: number };
    };
  };
}

type IdentityPreviewRow = Pick<
  ResolutionPreviewResult['rows'][number],
  | 'rowIndex'
  | 'storageLocation'
  | 'sourceItemCode'
  | 'itemCodeStatus'
  | 'sourceCodeReliability'
  | 'cleanedDescription'
  | 'caseQuantity'
  | 'innerPackQuantity'
  | 'baseUnitQuantity'
  | 'baseUnit'
  | 'totalCost'
  | 'itemMatch'
  | 'identityGroupKey'
  | 'identityGroupStatus'
>;

function sourcePackGeometry(row: Pick<
  ResolutionPreviewResult['rows'][number],
  'caseQuantity' | 'innerPackQuantity' | 'baseUnitQuantity' | 'baseUnit'
>): SourcePackGeometry {
  return {
    caseQuantity: row.caseQuantity,
    innerPackQuantity: row.innerPackQuantity,
    baseUnitQuantity: row.baseUnitQuantity,
    baseUnit: row.baseUnit,
  };
}

/**
 * A pack variant needs a deterministic catalog label without requiring the
 * reviewer to retype source facts. Use the same parsed geometry that drove the
 * incompatible-pack classification.
 */
function sourcePackVariantName(row: Pick<
  ResolutionPreviewResult['rows'][number],
  'rowIndex' | 'cleanedDescription' | 'caseQuantity' | 'innerPackQuantity' | 'baseUnitQuantity' | 'baseUnit'
>): string {
  const baseName = row.cleanedDescription?.trim() || `Orderly Item ${row.rowIndex}`;
  const geometry = sourcePackGeometry(row);
  const caseQuantity = geometry.caseQuantity && geometry.caseQuantity > 0 ? geometry.caseQuantity : null;
  const innerPackQuantity = geometry.innerPackQuantity && geometry.innerPackQuantity > 0 ? geometry.innerPackQuantity : null;
  const baseUnitQuantity = geometry.baseUnitQuantity && geometry.baseUnitQuantity > 0 ? geometry.baseUnitQuantity : null;
  const baseUnit = geometry.baseUnit?.trim() || null;
  if (baseUnitQuantity == null || !baseUnit) return baseName;

  const parts = caseQuantity != null ? [String(caseQuantity)] : [];
  if (innerPackQuantity != null && innerPackQuantity !== 1) parts.push(String(innerPackQuantity));
  parts.push(`${baseUnitQuantity} ${baseUnit}`);
  return `${baseName} — ${parts.join(' × ')}`;
}

function toPreviewPackEvidence(geometry: SourcePackGeometry): PackEvidence {
  const normalized = normalizePackGeometry(geometry);
  return {
    caseQuantity: geometry.caseQuantity ?? null,
    innerPackQuantity: geometry.innerPackQuantity ?? null,
    baseUnitQuantity: geometry.baseUnitQuantity ?? null,
    baseUnit: geometry.baseUnit ?? null,
    normalizedUnit: normalized.normalizedUnit,
    totalBaseUnits: normalized.totalBaseUnits,
  };
}

function assessCandidatePackCompatibility(
  source: SourcePackGeometry,
  evidences: SourcePackGeometry[],
  preferIncompatible = false,
): {
  status: 'compatible' | 'incompatible' | 'unknown';
  reason: string;
  candidatePackEvidence: PackEvidence | null;
} {
  if (evidences.length === 0) {
    return {
      status: 'unknown',
      reason: 'the candidate has no confirmed source-pack evidence',
      candidatePackEvidence: null,
    };
  }
  const results = evidences.map(evidence => ({ evidence, comparison: comparePackGeometry(source, evidence) }));
  const incompatible = results.find(result => result.comparison.status === 'incompatible');
  if (preferIncompatible && incompatible) {
    return {
      status: incompatible.comparison.status,
      reason: incompatible.comparison.reason,
      candidatePackEvidence: toPreviewPackEvidence(incompatible.evidence),
    };
  }
  const compatible = results.find(result => result.comparison.status === 'compatible');
  if (compatible) {
    return {
      status: compatible.comparison.status,
      reason: compatible.comparison.reason,
      candidatePackEvidence: toPreviewPackEvidence(compatible.evidence),
    };
  }
  if (incompatible) {
    return {
      status: incompatible.comparison.status,
      reason: incompatible.comparison.reason,
      candidatePackEvidence: toPreviewPackEvidence(incompatible.evidence),
    };
  }
  return {
    status: 'unknown',
    reason: results[0]?.comparison.reason ?? 'pack evidence is unavailable',
    candidatePackEvidence: results[0] ? toPreviewPackEvidence(results[0].evidence) : null,
  };
}

function recodeEvidenceClassForPack(
  packCompatibility: 'compatible' | 'incompatible' | 'unknown',
): RecodeEvidenceClass {
  if (packCompatibility === 'compatible') return 'compatible_alternate';
  if (packCompatibility === 'incompatible') return 'new_pack_size';
  return 'pack_evidence_missing';
}

function sourceVendorEvidenceKey(
  row: Pick<InventoryImportRow, 'supplierRaw'>,
  resolution: Pick<RowResolution, 'vendorMatch'>,
): string | null {
  if (resolution.vendorMatch.vendorId) return `vendor:${resolution.vendorMatch.vendorId}`;
  const normalizedSupplier = normalizeForMatch(row.supplierRaw ?? '');
  return normalizedSupplier ? `source:${normalizedSupplier}` : null;
}

/**
 * Persisted Orderly adoption evidence is intentionally keyed by packSize.id,
 * while XLSX inventory review is keyed by the vendor-facing Item Code. The
 * bridge is a vendor product: its vendorSku is the Item Code and its immutable
 * provenance mapping is the pack-size identity.
 */
interface CatalogPackSizeEvidence extends SourcePackGeometry {
  vendorId: string;
  inventoryItemId: string;
  sourceItemCode: string;
  packSizeId: string;
}

interface ExistingVendorSupply {
  vendorId: string;
  vendorName: string;
  inventoryItemId: string;
}

function normalizedStableSourceCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function catalogPackEvidenceKey(
  vendorId: string,
  inventoryItemId: string,
  sourceItemCode: string,
): string {
  return `${vendorId}\u0000${inventoryItemId}\u0000${sourceItemCode}`;
}

/**
 * Detect a catalog contradiction that an XLSX alone cannot represent. This is
 * deliberately narrower than "an item has several vendor packs": only a
 * reviewed exact-name candidate with the same matched item, vendor, and Item
 * Code is blocked, and only when distinct authoritative Orderly packSize IDs
 * have materially incompatible geometry.
 */
function findCatalogPackSizeConflict(
  row: Pick<InventoryImportRow, 'rowIndex' | 'sourceItemCode'>,
  itemMatch: MatchResult,
  vendorMatch: VendorMatchResult,
  evidenceByIdentity: Map<string, CatalogPackSizeEvidence[]>,
): {
  evidenceClass: 'source_data_conflict' | 'pack_evidence_missing';
  rowIndexes: number[];
  reason: string;
} | null {
  const sourceItemCode = normalizedStableSourceCode(row.sourceItemCode);
  const candidateId = itemMatch.possibleRecodeMatchedId;
  if (
    !sourceItemCode ||
    !vendorMatch.vendorId ||
    !candidateId ||
    itemMatch.matchedId !== candidateId
  ) {
    return null;
  }

  const evidence = evidenceByIdentity.get(
    catalogPackEvidenceKey(vendorMatch.vendorId, candidateId, sourceItemCode),
  ) ?? [];
  const evidenceByPackSizeId = new Map(
    evidence.map(entry => [entry.packSizeId, entry] as const),
  );
  const distinctEvidence = [...evidenceByPackSizeId.values()];
  if (distinctEvidence.length < 2) return null;

  const incompatibleReasons = new Set<string>();
  let hasUnverifiableComparison = false;
  for (let left = 0; left < distinctEvidence.length; left++) {
    for (let right = left + 1; right < distinctEvidence.length; right++) {
      const comparison = comparePackGeometry(distinctEvidence[left], distinctEvidence[right]);
      if (comparison.status === 'incompatible') incompatibleReasons.add(comparison.reason);
      if (comparison.status === 'unknown') hasUnverifiableComparison = true;
    }
  }
  if (incompatibleReasons.size === 0 && !hasUnverifiableComparison) return null;

  const packSizeIds = distinctEvidence
    .map(entry => entry.packSizeId)
    .sort((left, right) => left.localeCompare(right));
  const geometryReason = incompatibleReasons.size > 0
    ? `have incompatible normalized pack geometry: ${[...incompatibleReasons].join('; ')}`
    : 'lack enough immutable pack geometry to prove that they are equivalent';
  return {
    evidenceClass: incompatibleReasons.size > 0
      ? 'source_data_conflict'
      : 'pack_evidence_missing',
    rowIndexes: [row.rowIndex],
    reason:
      `Orderly catalog pack identities ${packSizeIds.join(', ')} for this vendor and Item Code ` +
      geometryReason,
  };
}

/**
 * A source data conflict is different from an incoming pack variant: the same
 * stable code from the same vendor is represented by contradictory physical
 * pack evidence in this workbook. It must remain blocked instead of creating
 * or linking either interpretation.
 */
function findSourcePackConflicts(
  batchRows: InventoryImportRow[],
  resolutions: RowResolution[],
): Map<number, { rowIndexes: number[]; reason: string }> {
  const rowByIndex = new Map(batchRows.map(row => [row.rowIndex, row]));
  const groups = new Map<string, RowResolution[]>();
  for (const resolution of resolutions) {
    if (!isReliableItemCode(resolution)) continue;
    const row = rowByIndex.get(resolution.rowIndex);
    if (!row) continue;
    const vendorKey = sourceVendorEvidenceKey(row, resolution);
    if (!vendorKey) continue;
    const groupKey = `${resolution.sourceItemCode!.trim()}\u0000${vendorKey}`;
    const group = groups.get(groupKey) ?? [];
    group.push(resolution);
    groups.set(groupKey, group);
  }

  const conflicts = new Map<number, { rowIndexes: number[]; reason: string }>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const reasons = new Set<string>();
    for (let left = 0; left < group.length; left++) {
      for (let right = left + 1; right < group.length; right++) {
        const leftRow = rowByIndex.get(group[left].rowIndex);
        const rightRow = rowByIndex.get(group[right].rowIndex);
        if (!leftRow || !rightRow) continue;
        const comparison = comparePackGeometry(
          sourcePackGeometry(leftRow as any),
          sourcePackGeometry(rightRow as any),
        );
        if (comparison.status === 'incompatible') reasons.add(comparison.reason);
      }
    }
    if (reasons.size === 0) continue;
    const rowIndexes = group.map(row => row.rowIndex).sort((a, b) => a - b);
    const reason = [...reasons].join('; ');
    for (const rowIndex of rowIndexes) conflicts.set(rowIndex, { rowIndexes, reason });
  }
  return conflicts;
}

function isReliableItemCode(row: {
  sourceItemCode?: string | null;
  itemCodeStatus?: string | null;
  sourceCodeReliability?: SourceCodeReliability;
}): boolean {
  return row.sourceCodeReliability
    ? row.sourceCodeReliability === 'stable'
    : isStableSourceItemCode(row.sourceItemCode, row.itemCodeStatus);
}

function isPseudoCodeVendorPackReview(row: {
  sourceCodeReliability?: SourceCodeReliability;
  itemMatch: Pick<MatchResult, 'possibleRecode' | 'crossVendorPackEligible'>;
}): boolean {
  return (
    row.sourceCodeReliability === 'pseudo_code' &&
    row.itemMatch.possibleRecode === true &&
    row.itemMatch.crossVendorPackEligible === true
  );
}

/**
 * A blank physical-location row can only follow a coded sibling when that
 * sibling has a single, non-review identity path. The sibling may resolve to an
 * existing item or be the reliable row that creates this group's one new item
 * during approval; in either case the blank row is not independently held.
 */
function hasSafeCodedSibling(
  row: Pick<IdentityPreviewRow, 'rowIndex'>,
  group: IdentityPreviewRow[],
): boolean {
  // A descriptive/pseudo code in the same name+pack group is independent
  // review evidence. Do not let a blank row silently follow the stable sibling
  // while that other row may be resolved to a different inventory item.
  if (group.some(sibling =>
    sibling.rowIndex !== row.rowIndex &&
    sibling.itemCodeStatus !== 'blank' &&
    !isReliableItemCode(sibling)
  )) {
    return false;
  }
  const safeCodes = new Set(
    group
      .filter(sibling => (
        sibling.rowIndex !== row.rowIndex &&
        isReliableItemCode(sibling) &&
        !sibling.itemMatch.requiresReview &&
        !sibling.itemMatch.possibleRecode
      ))
      .map(sibling => sibling.sourceItemCode!.trim()),
  );
  return safeCodes.size === 1;
}

/**
 * An Orderly code is optional input. A blank-code product group that has a
 * usable derived identity and no competing catalog candidate receives one new
 * FnB-owned internal item number on approval. Every physical location row in
 * that group shares the resulting canonical item.
 */
function canCreateInternalItemForBlankGroup(
  row: Pick<IdentityPreviewRow, 'itemCodeStatus' | 'identityGroupKey'>,
  group: IdentityPreviewRow[],
): boolean {
  return (
    row.itemCodeStatus === 'blank' &&
    Boolean(row.identityGroupKey) &&
    group.length > 0 &&
    group.every(sibling => (
      sibling.itemCodeStatus === 'blank' &&
      sibling.itemMatch.strategy === 'none' &&
      sibling.itemMatch.matchedId == null &&
      !sibling.itemMatch.requiresReview &&
      !sibling.itemMatch.possibleRecode
    ))
  );
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

  const identityGroups = new Map<string, IdentityPreviewRow[]>();
  for (const row of rows) {
    if (!row.identityGroupKey) continue;
    const group = identityGroups.get(row.identityGroupKey) ?? [];
    group.push(row);
    identityGroups.set(row.identityGroupKey, group);
  }
  const grouped = [...identityGroups.values()];
  const blankCodeClassification = {
    confirmed: { rows: 0, valueTotal: 0 },
    reviewable: { rows: 0, valueTotal: 0 },
    conflicted: { rows: 0, valueTotal: 0 },
    held: { rows: 0, valueTotal: 0 },
  };
  for (const row of blankRows) {
    const valueTotal = row.totalCost ?? 0;
    const group = row.identityGroupKey ? identityGroups.get(row.identityGroupKey) ?? [] : [];
    const followsOneSafeCodedSibling = hasSafeCodedSibling(row, group);

    if (
      (!row.itemMatch.requiresReview && row.itemMatch.matchedId != null) ||
      followsOneSafeCodedSibling ||
      canCreateInternalItemForBlankGroup(row, group)
    ) {
      // A blank group either follows one safe coded sibling or receives one
      // FnB-owned internal item number on approval. Multiple coded identities
      // and catalog candidates remain review cases below.
      blankCodeClassification.confirmed.rows++;
      blankCodeClassification.confirmed.valueTotal += valueTotal;
    } else if (row.itemMatch.confidence === 'ambiguous' && row.itemMatch.candidateIds.length > 1) {
      // Several otherwise plausible identities are evidence of a collision,
      // not a candidate that may be silently chosen by a later import.
      blankCodeClassification.conflicted.rows++;
      blankCodeClassification.conflicted.valueTotal += valueTotal;
    } else if (
      row.itemMatch.candidateIds.length > 0 ||
      row.itemMatch.confidence === 'medium' ||
      row.itemMatch.confidence === 'low'
    ) {
      blankCodeClassification.reviewable.rows++;
      blankCodeClassification.reviewable.valueTotal += valueTotal;
    } else {
      blankCodeClassification.held.rows++;
      blankCodeClassification.held.valueTotal += valueTotal;
    }
  }

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
    // Group confirmation is the approval-aligned definition of a safe blank
    // row. A direct catalog match, a single reliable coded sibling, or one
    // deterministic new internal catalog item are valid paths.
    blankCodeSafelyMatched: blankCodeClassification.confirmed.rows,
    blankCodeUnresolved: blankRows.length - blankCodeClassification.confirmed.rows,
    uniquePhysicalLocations: physicalLocations.size,
    locationCountRowsPreserved: rows.length,
    sameCodeCrossLocationGroups,
    sameCodeSameLocationDuplicateGroups,
    sameLocationDuplicateRowCount,
    sameLocationDuplicateSourceValueTotal,
    packNotationCompatibilityWarnings,
    sourceValuationTotal: rows.reduce((total, row) => total + (row.totalCost ?? 0), 0),
    uniqueIdentityGroups: identityGroups.size,
    identityGroupsResolvedToExisting: grouped.filter(group => group[0].identityGroupStatus === 'existing_item').length,
    identityGroupsNewCandidates: grouped.filter(group => group[0].identityGroupStatus === 'new_candidate').length,
    identityGroupsRequiringReview: grouped.filter(group => group[0].identityGroupStatus === 'review_required').length,
    blankCodeGroupsWithCodedSibling: grouped.filter(group =>
      group.some(row => row.itemCodeStatus === 'blank') &&
      group.some(row => row.itemCodeStatus === 'valid'),
    ).length,
    blankCodeGroupsAutoResolved: grouped.filter(group =>
      group.some(row => row.itemCodeStatus === 'blank') &&
      group.some(row => !row.itemMatch.requiresReview && row.itemMatch.matchedId != null),
    ).length,
    alternateIdentityMatches: rows.filter(row => row.itemMatch.strategy === 'alternate_identity').length,
    blankCodeClassification,
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

// ─── Resolution preview (read-only) ──────────────────────────────────────────

/**
 * Load all rows for a batch and run the matching algorithms against the
 * company's existing items / vendors / locations.  No DB writes.
 */
export async function runResolutionPreview(
  batchId: string,
  companyId: string,
  runner: typeof db = db,
): Promise<ResolutionPreviewResult> {
  // External-code identity is scoped to the batch's authorized source property.
  // Two Orderly clubs can legitimately reuse the same Item Code, so a mapping
  // from another property must never resolve this batch's rows.
  const [scopeRow] = await runner
    .select({ sourcePropertyId: inventoryImportBatches.sourcePropertyId })
    .from(inventoryImportBatches)
    .where(
      and(
        // @ts-ignore
        eq(inventoryImportBatches.id, batchId),
        // @ts-ignore
        eq(inventoryImportBatches.companyId, companyId),
        // @ts-ignore
        eq(inventoryImportBatches.sourceSystem, 'ORDERLY'),
      ),
    )
    .limit(1);
  if (!scopeRow) {
    throw new ImportApprovalError('NOT_FOUND', 'Orderly batch not found');
  }
  const sourcePropertyScope = scopeRow?.sourcePropertyId ?? '';
  // Parallel: fetch batch meta + import rows + company items + vendors + locations +
  // external mappings + item-location assignments (for ambiguous tiebreaking)
  const [batchRows, batchMeta, existingItems, existingVendors, existingLocations, externalMappings, locationAssignments, catalogPackSizeMappings, existingVendorSupplies] =
    await Promise.all([
      runner
        .select()
        .from(inventoryImportRows)
        // @ts-ignore
        .where(eq(inventoryImportRows.batchId, batchId))
        .orderBy(inventoryImportRows.rowIndex),
      runner
        .select({ id: inventoryImportBatches.id, inventoryDate: inventoryImportBatches.inventoryDate })
        .from(inventoryImportBatches)
        .where(
          and(
            // @ts-ignore
            eq(inventoryImportBatches.id, batchId),
            // @ts-ignore
            eq(inventoryImportBatches.companyId, companyId),
            // @ts-ignore
            eq(inventoryImportBatches.sourceSystem, 'ORDERLY'),
          ),
        )
        .limit(1),
      runner
        .select({
          id: inventoryItems.id,
          name: inventoryItems.name,
          internalItemNumber: inventoryItems.internalItemNumber,
          pluSku: inventoryItems.pluSku,
          caseSize: inventoryItems.caseSize,
        })
        .from(inventoryItems)
        // @ts-ignore
        .where(and(eq(inventoryItems.companyId, companyId), eq(inventoryItems.active, 1))),
      runner
        .select({ id: vendors.id, name: vendors.name })
        .from(vendors)
        // @ts-ignore
        .where(and(eq(vendors.companyId, companyId), eq(vendors.active, 1))),
      runner
        .select({ id: inventoryLocations.id, name: inventoryLocations.name, normalizedName: inventoryLocations.normalizedName })
        .from(inventoryLocations)
        // @ts-ignore
        .where(and(eq(inventoryLocations.companyId, companyId), eq(inventoryLocations.active, 1))),
      runner
        .select({
          sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
          inventoryItemId: inventoryItemExternalMappings.inventoryItemId,
          caseQuantity: inventoryItemExternalMappings.caseQuantity,
          innerPackQuantity: inventoryItemExternalMappings.innerPackQuantity,
          baseUnitQuantity: inventoryItemExternalMappings.baseUnitQuantity,
          baseUnit: inventoryItemExternalMappings.baseUnit,
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
      runner
        .select({
          inventoryItemId: inventoryItemLocationAssignments.inventoryItemId,
          locationId: inventoryItemLocationAssignments.locationId,
        })
        .from(inventoryItemLocationAssignments)
        // @ts-ignore
        .where(eq(inventoryItemLocationAssignments.companyId, companyId)),
      runner
        .select({
          vendorId: vendorItems.vendorId,
          inventoryItemId: vendorItems.inventoryItemId,
          sourceItemCode: vendorItemExternalMappings.sourceItemCode,
          vendorSku: vendorItems.vendorSku,
          packSizeId: vendorItemExternalMappings.sourceExternalId,
          caseQuantity: vendorItemExternalMappings.caseQuantity,
          innerPackQuantity: vendorItemExternalMappings.innerPackQuantity,
          baseUnitQuantity: vendorItemExternalMappings.baseUnitQuantity,
          baseUnit: vendorItemExternalMappings.baseUnit,
        })
        .from(vendorItemExternalMappings)
        .innerJoin(vendorItems, eq(vendorItems.id, vendorItemExternalMappings.vendorItemId))
        .innerJoin(vendors, and(
          eq(vendors.id, vendorItems.vendorId),
          eq(vendors.companyId, companyId),
        ))
        .innerJoin(inventoryItems, and(
          eq(inventoryItems.id, vendorItems.inventoryItemId),
          eq(inventoryItems.companyId, companyId),
        ))
        .where(and(
          eq(vendorItemExternalMappings.companyId, companyId),
          eq(vendorItemExternalMappings.sourceSystem, 'ORDERLY'),
          eq(vendorItemExternalMappings.sourcePropertyId, sourcePropertyScope),
        )),
      runner
        .select({
          vendorId: vendorItems.vendorId,
          vendorName: vendors.name,
          inventoryItemId: vendorItems.inventoryItemId,
        })
        .from(vendorItems)
        .innerJoin(vendors, and(
          eq(vendors.id, vendorItems.vendorId),
          eq(vendors.companyId, companyId),
        ))
        .where(eq(vendorItems.active, 1)),
    ]);

  // Earlier parser versions did not understand Orderly's complete three-tier
  // packs (for example, "1/1 750ML"). Rehydrate only previously unparseable
  // persisted rows from their immutable raw source value so existing staged
  // batches use the same safe geometry rules as newly uploaded workbooks.
  for (const row of batchRows) {
    if (row.packParseStatus !== 'unparseable') continue;
    const rawPack = (row.rawData as Record<string, unknown> | null)?.['Pack Size'];
    if (typeof rawPack !== 'string') continue;
    const parsedPack = parseOrderlyPackSize(rawPack);
    if (parsedPack.packParseStatus !== 'ok') continue;
    Object.assign(row, parsedPack);
  }

  if (!batchMeta[0]) throw new Error('Batch not found or not accessible');

  // Existing mappings carry both real Orderly Item Codes and persisted derived
  // ALT identities. Keep the namespaces separate so a source code is never
  // mistaken for a derived identity.
  const extMappingLookup = new Map<string, string>();
  const alternateMappingLookup = new Map<string, string>();
  for (const mapping of externalMappings as Array<{ sourceExternalId: string; inventoryItemId: string }>) {
    if (mapping.sourceExternalId.startsWith('ALT|')) {
      alternateMappingLookup.set(mapping.sourceExternalId, mapping.inventoryItemId);
    } else {
      extMappingLookup.set(mapping.sourceExternalId, mapping.inventoryItemId);
    }
  }
  const packEvidenceByItemId = new Map<string, SourcePackGeometry[]>();
  for (const mapping of externalMappings as Array<{
    inventoryItemId: string;
    caseQuantity: number | null;
    innerPackQuantity: number | null;
    baseUnitQuantity: number | null;
    baseUnit: string | null;
  }>) {
    const evidences = packEvidenceByItemId.get(mapping.inventoryItemId) ?? [];
    evidences.push(mapping);
    packEvidenceByItemId.set(mapping.inventoryItemId, evidences);
  }
  const catalogPackEvidenceByIdentity = new Map<string, CatalogPackSizeEvidence[]>();
  const catalogPackEvidenceByVendorItem = new Map<string, SourcePackGeometry[]>();
  for (const mapping of catalogPackSizeMappings as Array<{
    vendorId: string;
    inventoryItemId: string;
    sourceItemCode: string | null;
    vendorSku: string | null;
    packSizeId: string;
    caseQuantity: number | null;
    innerPackQuantity: number | null;
    baseUnitQuantity: number | null;
    baseUnit: string | null;
  }>) {
    const sourceItemCode = normalizedStableSourceCode(mapping.sourceItemCode ?? mapping.vendorSku);
    const vendorItemKey = `${mapping.vendorId}\u0000${mapping.inventoryItemId}`;
    const vendorItemEvidence = catalogPackEvidenceByVendorItem.get(vendorItemKey) ?? [];
    vendorItemEvidence.push(mapping);
    catalogPackEvidenceByVendorItem.set(vendorItemKey, vendorItemEvidence);
    // Fallback mappings deliberately lack a stable Orderly packSize.id and
    // cannot establish this source-identity conflict.
    if (!sourceItemCode || mapping.packSizeId.startsWith('fallback|')) continue;
    const catalogEvidence = { ...mapping, sourceItemCode };
    const key = catalogPackEvidenceKey(mapping.vendorId, mapping.inventoryItemId, sourceItemCode);
    const evidence = catalogPackEvidenceByIdentity.get(key) ?? [];
    evidence.push(catalogEvidence);
    catalogPackEvidenceByIdentity.set(key, evidence);
  }
  const vendorSuppliesByItemId = new Map<string, ExistingVendorSupply[]>();
  for (const supply of existingVendorSupplies as ExistingVendorSupply[]) {
    const supplies = vendorSuppliesByItemId.get(supply.inventoryItemId) ?? [];
    supplies.push(supply);
    vendorSuppliesByItemId.set(supply.inventoryItemId, supplies);
  }

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
    const sourceCodeReliability = classifySourceItemCode(row.sourceItemCode, row.itemCodeStatus);

    // Strategy 1: external mapping
    const extId = sourceCodeReliability === 'stable' && row.sourceItemCode
      ? extMappingLookup.get(row.sourceItemCode.trim())
      : undefined;
    const alternateSourceId = sourceCodeReliability === 'stable'
      ? deriveOrderlyStableCodePackSourceId(
          row.sourceItemCode,
          row.cleanedDescription,
          sourcePackGeometry(row as any),
        )
      : deriveOrderlyAlternateSourceId(
          row.cleanedDescription,
          sourcePackGeometry(row as any),
        );
    const alternateId = alternateSourceId
      ? alternateMappingLookup.get(alternateSourceId)
      : undefined;
    if (extId && alternateId && alternateId !== extId) {
      itemMatch = {
        strategy: 'alternate_identity',
        confidence: 'high',
        matchedId: alternateId,
        candidateIds: [],
        requiresReview: false,
      };
    } else if (extId) {
      itemMatch = {
        strategy: 'external_mapping',
        confidence: 'high',
        matchedId: extId,
        candidateIds: [],
        requiresReview: false,
      };
    } else if (alternateId) {
      itemMatch = {
        strategy: 'alternate_identity',
        confidence: 'high',
        matchedId: alternateId,
        candidateIds: [],
        requiresReview: false,
      };
    } else {
      // Strategy 2: item code
      itemMatch = matchByItemCode(
        sourceCodeReliability === 'stable' ? row.sourceItemCode : null,
        sourceCodeReliability === 'stable' ? row.itemCodeStatus : 'placeholder',
        matchableItems,
      );

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

    // A stable Item Code can outlive a physical pack change. The code mapping
    // remains historical identity evidence, but it must not make 1×750 mL look
    // compatible with the same vendor's mapped 6×750 mL item. Surface this as
    // the same explicit variant review used for an unmapped same-name re-code.
    if (extId && itemMatch.strategy === 'external_mapping') {
      const candidateSuppliers = vendorSuppliesByItemId.get(extId) ?? [];
      const sourceVendorKey = sourceVendorEvidenceKey(row, { vendorMatch });
      const candidateHasSameVendor = sourceVendorKey != null && candidateSuppliers.some(supply =>
        sourceVendorKey === `vendor:${supply.vendorId}` ||
        sourceVendorKey === `source:${normalizeForMatch(supply.vendorName)}`,
      );
      const sameVendorCatalogEvidence = candidateHasSameVendor && vendorMatch.vendorId
        ? catalogPackEvidenceByVendorItem.get(`${vendorMatch.vendorId}\u0000${extId}`) ?? []
        : [];
      const candidatePackEvidence = sameVendorCatalogEvidence.length > 0
        ? sameVendorCatalogEvidence
        : packEvidenceByItemId.get(extId) ?? [];
      const packAssessment = assessCandidatePackCompatibility(
        sourcePackGeometry(row as any),
        candidatePackEvidence,
        candidateHasSameVendor,
      );
      if (candidateHasSameVendor && packAssessment.status === 'incompatible') {
        itemMatch = {
          ...itemMatch,
          matchedId: null,
          possibleRecode: true,
          possibleRecodeMatchedId: extId,
          packCompatibility: 'incompatible',
          packCompatibilityReason: packAssessment.reason,
          sourcePackEvidence: toPreviewPackEvidence(sourcePackGeometry(row as any)),
          candidatePackEvidence: packAssessment.candidatePackEvidence,
          recodeEvidenceClass: 'new_pack_size',
          mappedCodePackDrift: true,
          crossVendorPackEligible: false,
          existingVendorNames: candidateSuppliers.map(supply => supply.vendorName),
          recommendedAction: 'create_variant',
        };
      }
    }

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
    const isUnmappedStableCode =
      !extId &&
      sourceCodeReliability === 'stable' &&
      Boolean(row.sourceItemCode?.trim());
    const codeWasMatched =
      itemMatch.strategy === 'external_mapping' || itemMatch.strategy === 'item_code';
    const isPseudoCodeCandidate = sourceCodeReliability === 'pseudo_code';
    if ((isUnmappedStableCode && !codeWasMatched) || isPseudoCodeCandidate) {
      const normalizedDesc = normalizeForMatch(row.cleanedDescription ?? '');
      if (normalizedDesc) {
        const exactNameMatches = matchableItems.filter(
          it => normalizeForMatch(it.name) === normalizedDesc,
        );
        const nameExactMatch = isPseudoCodeCandidate
          ? exactNameMatches.length === 1 ? exactNameMatches[0] : undefined
          : exactNameMatches[0];
        if (nameExactMatch) {
          const candidateSuppliers = vendorSuppliesByItemId.get(nameExactMatch.id) ?? [];
          const sourceVendorKey = sourceVendorEvidenceKey(row, { vendorMatch });
          const candidateHasSameVendor = sourceVendorKey != null && candidateSuppliers.some(supply =>
            sourceVendorKey === `vendor:${supply.vendorId}` ||
            sourceVendorKey === `source:${normalizeForMatch(supply.vendorName)}`,
          );
          const sameVendorCatalogEvidence = candidateHasSameVendor && vendorMatch.vendorId
            ? catalogPackEvidenceByVendorItem.get(`${vendorMatch.vendorId}\u0000${nameExactMatch.id}`) ?? []
            : [];
          const candidatePackEvidence = sameVendorCatalogEvidence.length > 0
            ? sameVendorCatalogEvidence
            : packEvidenceByItemId.get(nameExactMatch.id) ?? [];
          const packAssessment = assessCandidatePackCompatibility(
            sourcePackGeometry(row as any),
            candidatePackEvidence,
            candidateHasSameVendor,
          );
          const crossVendorPackEligible =
            packAssessment.status === 'incompatible' &&
            typeof row.packagePrice === 'number' &&
            Number.isFinite(row.packagePrice) &&
            row.packagePrice > 0 &&
            sourceVendorKey != null &&
            candidateSuppliers.length > 0 &&
            !candidateHasSameVendor;
          itemMatch = {
            ...itemMatch,
            possibleRecode: true,
            possibleRecodeMatchedId: nameExactMatch.id,
            packCompatibility: packAssessment.status,
            packCompatibilityReason: packAssessment.reason,
            sourcePackEvidence: toPreviewPackEvidence(sourcePackGeometry(row as any)),
            candidatePackEvidence: packAssessment.candidatePackEvidence,
            recodeEvidenceClass: isPseudoCodeCandidate && !crossVendorPackEligible
              ? 'unreliable_code'
              : recodeEvidenceClassForPack(packAssessment.status),
            // Descriptive text may surface one exact-name, verified
            // different-vendor pack for explicit review, but it never proves
            // durable code identity.
            requiresReview: isPseudoCodeCandidate || itemMatch.requiresReview,
            crossVendorPackEligible,
            existingVendorNames: candidateSuppliers.map(supply => supply.vendorName),
            recommendedAction: crossVendorPackEligible ? 'link_vendor_pack' : 'create_variant',
          };
          const catalogConflict = findCatalogPackSizeConflict(
            row,
            itemMatch,
            vendorMatch,
            catalogPackEvidenceByIdentity,
          );
          if (catalogConflict) {
            itemMatch = {
              ...itemMatch,
              requiresReview: true,
              recodeEvidenceClass: catalogConflict.evidenceClass,
              packCompatibility: catalogConflict.evidenceClass === 'pack_evidence_missing'
                ? 'unknown'
                : itemMatch.packCompatibility,
              packCompatibilityReason: catalogConflict.evidenceClass === 'pack_evidence_missing'
                ? catalogConflict.reason
                : itemMatch.packCompatibilityReason,
              sourceDataConflict: catalogConflict.evidenceClass === 'source_data_conflict'
                ? catalogConflict
                : undefined,
            };
          }
        }
      }
    }

    // A descriptive value in Orderly's Item Code column is not source identity
    // evidence. It may resolve only through the exact derived identity
    // (normalized name + canonical pack) or an exact name-and-pack catalog
    // match. Fuzzy and location-history candidates are not identity authority.
    if (
      sourceCodeReliability === 'pseudo_code' &&
      itemMatch.crossVendorPackEligible !== true
    ) {
      const derivedIdentityMatch = itemMatch.strategy === 'alternate_identity'
        ? itemMatch.matchedId
        : null;
      const normalizedDescription = normalizeForMatch(row.cleanedDescription ?? '');
      const compatibleNamePackCandidates = normalizedDescription
        ? matchableItems
            .filter(candidate => normalizeForMatch(candidate.name) === normalizedDescription)
            .map(candidate => ({
              candidate,
              assessment: assessCandidatePackCompatibility(
                sourcePackGeometry(row as any),
                packEvidenceByItemId.get(candidate.id) ?? [],
              ),
            }))
            .filter(result => result.assessment.status === 'compatible')
        : [];
      const compatibleNamePackMatch = compatibleNamePackCandidates.length === 1
        ? compatibleNamePackCandidates[0]
        : null;
      const identityMatch = derivedIdentityMatch ?? compatibleNamePackMatch;
      itemMatch = {
        ...itemMatch,
        strategy: derivedIdentityMatch
          ? 'alternate_identity'
          : compatibleNamePackMatch
            ? 'name_pack'
            : 'none',
        confidence: identityMatch ? 'high' : 'none',
        matchedId: derivedIdentityMatch ?? compatibleNamePackMatch?.candidate.id ?? null,
        candidateIds: [],
        requiresReview: false,
        possibleRecode: false,
        possibleRecodeMatchedId: null,
        packCompatibility: compatibleNamePackMatch ? 'compatible' : itemMatch.packCompatibility,
        packCompatibilityReason: compatibleNamePackMatch
          ? compatibleNamePackMatch.assessment.reason
          : itemMatch.packCompatibilityReason,
        candidatePackEvidence: compatibleNamePackMatch
          ? compatibleNamePackMatch.assessment.candidatePackEvidence
          : itemMatch.candidatePackEvidence,
        recodeEvidenceClass: 'unreliable_code',
      };
    }

    // Every review row receives the server-normalized incoming pack evidence.
    // The browser may format this fact, but never infer a total from partial
    // geometry. Candidate evidence is added separately when a catalog
    // comparison exists.
    itemMatch = {
      ...itemMatch,
      sourcePackEvidence: toPreviewPackEvidence(sourcePackGeometry(row as any)),
    };

    resolutions.push({
      rowIndex: row.rowIndex,
      itemMatch,
      vendorMatch,
      locationMatch,
      itemCodeStatus: row.itemCodeStatus,
      sourceItemCode: row.sourceItemCode,
      sourceCodeReliability,
      supplierRaw: row.supplierRaw,
    });
  }

  const sourcePackConflicts = findSourcePackConflicts(batchRows as InventoryImportRow[], resolutions);
  for (const resolution of resolutions) {
    const conflict = sourcePackConflicts.get(resolution.rowIndex);
    if (!conflict) continue;
    resolution.itemMatch = {
      ...resolution.itemMatch,
      requiresReview: true,
      recodeEvidenceClass: 'source_data_conflict',
      sourceDataConflict: conflict,
    };
  }

  // Reconcile physical location rows into a workbook-local product group after
  // all source mappings have been consulted. A uniquely resolved coded sibling
  // is valid evidence for blank rows; a blank row alone never creates a new
  // catalog item.
  const identityGroups = new Map<string, { rowIndexes: number[]; alternateSourceId: string | null }>();
  for (const row of batchRows) {
    const group = buildOrderlyIdentityGroup(row as any);
    if (!group) continue;
    const current = identityGroups.get(group.key) ?? {
      rowIndexes: [],
      alternateSourceId: group.alternateSourceId,
    };
    current.rowIndexes.push(row.rowIndex);
    identityGroups.set(group.key, current);
  }
  const resolutionByRowIndex = new Map(resolutions.map(resolution => [resolution.rowIndex, resolution]));
  const identityGroupStatus = new Map<string, 'existing_item' | 'new_candidate' | 'review_required' | 'unavailable'>();
  for (const [groupKey, group] of identityGroups) {
    const groupResolutions = group.rowIndexes
      .map(rowIndex => resolutionByRowIndex.get(rowIndex))
      .filter((resolution): resolution is RowResolution => resolution != null);
    const safeItemIds = new Set(
      groupResolutions
        .filter(resolution =>
          resolution.itemMatch.matchedId != null &&
          !resolution.itemMatch.requiresReview &&
          !resolution.itemMatch.possibleRecode,
        )
        .map(resolution => resolution.itemMatch.matchedId!),
    );
    const safeCodedSiblingCodes = new Set(
      groupResolutions
        .filter(resolution => (
          isReliableItemCode(resolution) &&
          !resolution.itemMatch.requiresReview &&
          !resolution.itemMatch.possibleRecode
        ))
        .map(resolution => resolution.sourceItemCode!.trim()),
    );
    // Same-workbook matching is evidence from exactly one reliable Item Code,
    // never from a blank row that happened to find a catalog candidate. This
    // keeps a blank-only group fail-closed unless it has its own confirmed
    // alternate mapping or an explicit reviewer decision.
    if (safeItemIds.size === 1 && safeCodedSiblingCodes.size === 1) {
      const [matchedId] = [...safeItemIds];
      for (const resolution of groupResolutions) {
        // An unqualified name+pack group can help blank/descriptive location
        // rows, but it must never replace a stable code's own match/review
        // outcome. Stable codes use their direct or code-qualified identity.
        if (isReliableItemCode(resolution)) continue;
        if (
          resolution.itemMatch.matchedId == null ||
          resolution.itemMatch.requiresReview
        ) {
          resolution.itemMatch = {
            strategy: 'same_workbook_identity',
            confidence: 'high',
            matchedId,
            candidateIds: [],
            requiresReview: false,
          };
        }
      }
      identityGroupStatus.set(groupKey, 'existing_item');
    } else if (safeItemIds.size > 1) {
      let requiresGroupReview = false;
      for (const resolution of groupResolutions) {
        const hasAuthoritativeStableCodeResolution =
          isReliableItemCode(resolution) &&
          resolution.itemMatch.matchedId != null &&
          !resolution.itemMatch.requiresReview &&
          !resolution.itemMatch.possibleRecode;
        if (hasAuthoritativeStableCodeResolution) {
          // Distinct stable Item Codes are allowed to share one normalized
          // name+pack key. Preserve each code's authoritative item instead of
          // replacing both with an artificial derived-identity ambiguity.
          continue;
        }
        requiresGroupReview = true;
        resolution.itemMatch = {
          strategy: 'name_pack',
          confidence: 'ambiguous',
          matchedId: null,
          candidateIds: [...safeItemIds],
          requiresReview: true,
        };
      }
      identityGroupStatus.set(groupKey, requiresGroupReview ? 'review_required' : 'existing_item');
    } else if (safeItemIds.size === 1) {
      // A blank-only direct match or several coded identities that happen to
      // point at one item is not the one-sibling evidence required to lift
      // another blank row out of review.
      identityGroupStatus.set(groupKey, 'review_required');
    } else if (groupResolutions.some(resolution => resolution.itemCodeStatus === 'valid')) {
      identityGroupStatus.set(groupKey, 'new_candidate');
    } else if (groupResolutions.every(resolution => (
      resolution.itemCodeStatus === 'blank' &&
      resolution.itemMatch.strategy === 'none' &&
      resolution.itemMatch.matchedId == null &&
      !resolution.itemMatch.requiresReview
    ))) {
      identityGroupStatus.set(groupKey, 'new_candidate');
    } else {
      identityGroupStatus.set(groupKey, 'review_required');
    }
  }

  // Build id → item lookup so preview rows can carry candidate details
  // (name / caseSize / pluSku / knownLocations) without an extra DB round-trip.
  // @ts-ignore
  const itemById = new Map(existingItems.map(item => [item.id, item]));

  const rows: ResolutionPreviewResult['rows'] = batchRows.map((row: InventoryImportRow, i: number) => {
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

    const identityGroup = buildOrderlyIdentityGroup(row as any);
    return {
      rowId: row.id,
      rowIndex: row.rowIndex,
      storageLocation: row.storageLocation,
      sourceItemCode: row.sourceItemCode,
      itemCodeStatus: row.itemCodeStatus,
      sourceCodeReliability: resolutions[i].sourceCodeReliability ?? 'unavailable',
      packSizeRaw: typeof (row.rawData as Record<string, unknown> | null)?.['Pack Size'] === 'string'
        && String((row.rawData as Record<string, unknown>)['Pack Size']).trim()
          ? String((row.rawData as Record<string, unknown>)['Pack Size'])
          : null,
      cleanedDescription: row.cleanedDescription,
      supplierRaw: row.supplierRaw,
      sourceCategory: (row as any).sourceCategory ?? null,
      caseQuantity: row.caseQuantity,
      innerPackQuantity: row.innerPackQuantity,
      baseUnitQuantity: row.baseUnitQuantity,
      baseUnit: row.baseUnit,
      packParseStatus: row.packParseStatus,
      packagePrice: row.packagePrice,
      totalCost: row.totalCost,
      itemMatch: { ...rawMatch, candidates, matchedItem, possibleRecodeItem },
      vendorMatch: resolutions[i].vendorMatch,
      locationMatch: resolutions[i].locationMatch,
      heldForReview: getHoldReason(row.itemCodeStatus, rawMatch) !== null,
      holdReason: getHoldReason(row.itemCodeStatus, rawMatch),
      identityGroupKey: identityGroup?.key ?? null,
      identityGroupRows: identityGroup
        ? (identityGroups.get(identityGroup.key)?.rowIndexes ?? [])
        : [],
      identityGroupStatus: identityGroup
        ? (identityGroupStatus.get(identityGroup.key) ?? 'unavailable')
        : 'unavailable',
    };
  });
  const identitySummary = buildIdentitySummary(rows);
  // `computeResolutionSummary` handles generic row matching. Identity groups add
  // one important approval guarantee: a blank location sibling can follow the
  // group's reliable coded row, including when that coded row creates the one
  // new canonical item. Reflect that resolved group evidence in the row state
  // before calculating the user-facing held total.
  const blankOnlyGroupsCreatingInternalItems = new Set<string>();
  for (const row of rows) {
    if (row.itemCodeStatus !== 'blank' || !row.identityGroupKey) continue;
    const group = rows.filter(candidate => candidate.identityGroupKey === row.identityGroupKey);
    if (
      hasSafeCodedSibling(row, group) ||
      canCreateInternalItemForBlankGroup(row, group)
    ) {
      row.heldForReview = false;
      row.holdReason = null;
    }
    if (canCreateInternalItemForBlankGroup(row, group)) {
      blankOnlyGroupsCreatingInternalItems.add(row.identityGroupKey);
    }
  }
  const summary = computeResolutionSummary(resolutions);
  // The preview must use the same row state as approval and the Held filter.
  // In particular, do not count a blank row that safely follows one coded
  // sibling as an independent unresolved review item.
  summary.itemsHeldForReview = rows.filter(row => row.heldForReview).length;
  // Generic matching sees blank rows as unresolved. Approval instead creates
  // one FnB item for each safe blank-only identity group, not once per
  // location row, so make the preview's creation card use that same rule.
  summary.itemsWillCreate += blankOnlyGroupsCreatingInternalItems.size;
  const recodeDecisionClassByKey = new Map<string, RecodeEvidenceClass>();
  for (const row of rows) {
    const evidenceClass = row.itemMatch.recodeEvidenceClass;
    if (!evidenceClass) continue;
    const key = isReliableItemCode(row)
      ? `code:${row.sourceItemCode!.trim()}`
      : `row:${row.rowIndex}`;
    const existing = recodeDecisionClassByKey.get(key);
    // A source conflict is the strictest interpretation and must not be
    // hidden by a compatible row in the same source-code group.
    if (!existing || evidenceClass === 'source_data_conflict') {
      recodeDecisionClassByKey.set(key, evidenceClass);
    }
  }
  const recodeSummary = {
    compatibleAlternates: 0,
    newPackSizes: 0,
    sourceDataConflicts: 0,
    unreliableCodes: 0,
    packEvidenceMissing: 0,
  };
  for (const evidenceClass of recodeDecisionClassByKey.values()) {
    if (evidenceClass === 'compatible_alternate') recodeSummary.compatibleAlternates++;
    else if (evidenceClass === 'new_pack_size') recodeSummary.newPackSizes++;
    else if (evidenceClass === 'source_data_conflict') recodeSummary.sourceDataConflicts++;
    else if (evidenceClass === 'unreliable_code') recodeSummary.unreliableCodes++;
    else if (evidenceClass === 'pack_evidence_missing') recodeSummary.packEvidenceMissing++;
  }

  return {
    batchId,
    inventoryDate: batchMeta[0].inventoryDate,
    totalRows: batchRows.length,
    summary,
    rows,
    newLocations: Array.from(newLocationNames),
    newVendors: Array.from(newVendorNames),
    recodeSummary,
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
  options: { requireApprovalRole?: boolean; allowApproved?: boolean } = {},
): Promise<{
  batch: {
    id: string;
    status: string;
    targetStoreId: string | null;
    sourceSystem: string;
    sourcePropertyId: string;
    fileHash: string;
    originalFilename: string;
    parserVersion: string;
    inventoryDate: string | null;
    sourceRowCount: number;
    snapshotTotal: number | null;
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

  // ── 3. Approval role authorization ─────────────────────────────────────────
  // Store users may review and save drafts, but approval is an irreversible
  // enterprise onboarding action reserved for admins and store managers.
  if (options.requireApprovalRole && !canApproveOrderlyImport(actingUser)) {
    throw new ImportApprovalError(
      'FORBIDDEN',
      'Only company admins and managers can approve Orderly imports.',
    );
  }

  // ── 4. Company authorization ─────────────────────────────────────────────
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

  // ── 5. Batch ownership — scoped read, never trusts a caller-passed company ─
  const [batch] = await db
    .select({
      id: inventoryImportBatches.id,
      status: inventoryImportBatches.status,
      targetStoreId: inventoryImportBatches.targetStoreId,
      sourceSystem: inventoryImportBatches.sourceSystem,
      sourcePropertyBindingId: inventoryImportBatches.sourcePropertyBindingId,
      sourcePropertyId: inventoryImportBatches.sourcePropertyId,
      companyId: inventoryImportBatches.companyId,
      fileHash: inventoryImportBatches.fileHash,
      originalFilename: inventoryImportBatches.originalFilename,
      parserVersion: inventoryImportBatches.parserVersion,
      inventoryDate: inventoryImportBatches.inventoryDate,
      sourceRowCount: inventoryImportBatches.sourceRowCount,
      snapshotTotal: inventoryImportBatches.snapshotTotal,
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
  if (batch.sourceSystem !== 'ORDERLY') {
    throw new ImportApprovalError('NOT_FOUND', 'Orderly batch not found');
  }
  if (batch.status === 'approved' && !options.allowApproved) {
    throw new ImportApprovalError(
      'CONFLICT',
      'Batch has already been approved — use the history view to see results.',
    );
  }
  if (batch.status !== 'pending_review' && !(options.allowApproved && batch.status === 'approved')) {
    throw new ImportApprovalError(
      'CONFLICT',
      'Only a pending-review Orderly batch can be approved or reviewed.',
    );
  }

  // ── 6. Source-property binding ───────────────────────────────────────────
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

  // ── 7. Resolve the destination store ─────────────────────────────────────
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

  // ── 8. Destination authorization for the acting user ─────────────────────
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
      fileHash: batch.fileHash,
      originalFilename: batch.originalFilename,
      parserVersion: batch.parserVersion,
      inventoryDate: batch.inventoryDate ?? null,
      sourceRowCount: batch.sourceRowCount,
      snapshotTotal: batch.snapshotTotal ?? null,
    },
    companyId,
    actingUserId,
    resolvedTargetStoreId,
  };
}

/** Authorizes access to approval job state without creating or changing a job. */
export async function authorizeOrderlyApprovalJobAccess(
  batchId: string,
  auth: ApprovalAuthorizationContext,
  options: { allowApproved?: boolean } = {},
): Promise<void> {
  await resolveApprovalContract(batchId, auth, {
    requireApprovalRole: true,
    allowApproved: options.allowApproved,
  });
}
export async function getOrderlyReviewDecisions(
  batchId: string,
  auth: ApprovalAuthorizationContext | null | undefined,
): Promise<{
  decisions: SavedReviewDecision[];
  stale: Array<{ rowIndex: number; reason: string; sourceItemCode: string | null; description: string | null }>;
}> {
  const contract = await resolveApprovalContract(batchId, auth);
  const [preview, decisions] = await Promise.all([
    runResolutionPreview(contract.batch.id, contract.companyId),
    loadStoredReviewDecisionRecords(contract.batch.id, contract.companyId),
  ]);
  const rowsByIndex = new Map(preview.rows.map(row => [row.rowIndex, row]));
  const valid: SavedReviewDecision[] = [];
  const stale: Array<{ rowIndex: number; reason: string; sourceItemCode: string | null; description: string | null }> = [];
  for (const saved of decisions) {
    const row = rowsByIndex.get(saved.rowIndex);
    if (!row) {
      stale.push({
        rowIndex: saved.rowIndex,
        reason: 'This row is no longer part of the staged import.',
        sourceItemCode: null,
        description: null,
      });
      continue;
    }
    try {
      assertReviewDecisionMatchesPreview(row, saved.decision);
      valid.push(saved);
    } catch (err: any) {
      stale.push({
        rowIndex: saved.rowIndex,
        reason: `${previewRowConflictLabel(row)}: ${err?.message ?? 'This saved decision no longer matches the current pack evidence.'}`,
        sourceItemCode: row.sourceItemCode,
        description: row.cleanedDescription,
      });
    }
  }
  return { decisions: valid, stale };
}

function manifestBatchForContract(
  contract: Awaited<ReturnType<typeof resolveApprovalContract>>,
): OrderlyDecisionManifestBatch {
  return {
    batchId: contract.batch.id,
    companyId: contract.companyId,
    sourceSystem: contract.batch.sourceSystem,
    sourcePropertyId: contract.batch.sourcePropertyId || null,
    targetStoreId: contract.batch.targetStoreId,
    fileHash: contract.batch.fileHash,
    originalFilename: contract.batch.originalFilename,
    parserVersion: contract.batch.parserVersion,
    inventoryDate: contract.batch.inventoryDate,
    sourceRowCount: contract.batch.sourceRowCount,
    snapshotTotal: contract.batch.snapshotTotal,
  };
}

function assertManifestMatchesContract(
  manifest: OrderlyDecisionManifest,
  contract: Awaited<ReturnType<typeof resolveApprovalContract>>,
): void {
  const expected = manifestBatchForContract(contract);
  const mismatches = (Object.keys(expected) as Array<keyof OrderlyDecisionManifestBatch>)
    .filter(key => manifest.batch[key] !== expected[key]);
  if (mismatches.length > 0) {
    throw new ImportApprovalError(
      'CONFLICT',
      `Decision manifest belongs to a different import scope (${mismatches.join(', ')}).`,
    );
  }
}

export async function exportOrderlyReviewDecisionManifest(
  batchId: string,
  auth: ApprovalAuthorizationContext | null | undefined,
): Promise<OrderlyDecisionManifest> {
  const contract = await resolveApprovalContract(batchId, auth);
  const [preview, decisions] = await Promise.all([
    runResolutionPreview(contract.batch.id, contract.companyId),
    loadStoredReviewDecisionRecords(contract.batch.id, contract.companyId),
  ]);
  try {
    return createOrderlyDecisionManifest({
      batch: manifestBatchForContract(contract),
      preview,
      decisions,
    });
  } catch (err) {
    if (err instanceof OrderlyDecisionManifestError) {
      throw new ImportApprovalError(err.code, err.message);
    }
    throw err;
  }
}

export interface OrderlyDecisionManifestImportResult {
  status: 'accepted' | 'rejected' | 'stale';
  accepted: Array<{ rowIndex: number }>;
  rejected: Array<{ rowIndex: number; reason: string }>;
  stale: Array<{ rowIndex: number; reason: string }>;
  decisions: SavedReviewDecision[];
}

export async function importOrderlyReviewDecisionManifest(
  batchId: string,
  auth: ApprovalAuthorizationContext | null | undefined,
  rawManifest: unknown,
): Promise<OrderlyDecisionManifestImportResult> {
  const contract = await resolveApprovalContract(batchId, auth);
  let manifest: OrderlyDecisionManifest;
  try {
    manifest = parseAndVerifyOrderlyDecisionManifest(rawManifest);
  } catch (err) {
    if (err instanceof OrderlyDecisionManifestError) {
      throw new ImportApprovalError(err.code, err.message);
    }
    throw err;
  }
  assertManifestMatchesContract(manifest, contract);

  const preview = await runResolutionPreview(contract.batch.id, contract.companyId);
  if (fingerprintOrderlyPreview(preview) !== manifest.previewFingerprint) {
    return {
      status: 'stale',
      accepted: [],
      rejected: [],
      stale: manifest.decisions.map(decision => ({
        rowIndex: decision.rowIndex,
        reason: 'The catalog or source evidence changed after this manifest was exported.',
      })),
      decisions: [],
    };
  }

  const rowsByIndex = new Map(preview.rows.map(row => [row.rowIndex, row]));
  const rejected: Array<{ rowIndex: number; reason: string }> = [];
  const changes: ReviewDecisionChange[] = [];
  for (const entry of manifest.decisions) {
    try {
      const decision = normalizeReviewDecision(entry.rowIndex, entry.decision);
      const row = rowsByIndex.get(entry.rowIndex);
      if (!row) {
        throw new ImportApprovalError('CONFLICT', `Row ${entry.rowIndex} is no longer part of this import batch.`);
      }
      assertReviewDecisionMatchesPreview(row, decision);
      changes.push({
        rowIndex: entry.rowIndex,
        expectedRevision: entry.revision,
        decision,
      });
    } catch (err: any) {
      rejected.push({
        rowIndex: entry.rowIndex,
        reason: err?.message ?? 'This decision is no longer valid for the current preview.',
      });
    }
  }
  if (rejected.length > 0) {
    return { status: 'rejected', accepted: [], rejected, stale: [], decisions: [] };
  }
  if (changes.length === 0) {
    return { status: 'accepted', accepted: [], rejected: [], stale: [], decisions: [] };
  }

  const current = await loadStoredReviewDecisionRecords(contract.batch.id, contract.companyId);
  const currentByRow = new Map(current.map(decision => [decision.rowIndex, decision]));
  const stale = manifest.decisions.flatMap(entry => {
    const currentDecision = currentByRow.get(entry.rowIndex);
    if (currentDecision && currentDecision.revision === entry.revision) return [];
    return [{
      rowIndex: entry.rowIndex,
      reason: currentDecision
        ? 'Another reviewer changed this decision after the manifest was exported.'
        : 'This saved decision was removed after the manifest was exported.',
    }];
  });
  if (stale.length > 0) {
    return { status: 'stale', accepted: [], rejected: [], stale, decisions: [] };
  }

  const saved = await saveOrderlyReviewDecisionChanges(
    contract.batch.id,
    auth,
    changes,
    { expectedPreviewFingerprint: manifest.previewFingerprint },
  );
  return {
    status: 'accepted',
    accepted: saved.decisions.map(decision => ({ rowIndex: decision.rowIndex })),
    rejected: [],
    stale: [],
    decisions: saved.decisions,
  };
}

function normalizeReviewDecisionChanges(input: unknown): ReviewDecisionChange[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ImportApprovalError('INVALID_REQUEST', 'At least one review decision change is required.');
  }
  const rowIndexes = new Set<number>();
  return input.map((rawChange) => {
    if (!isPlainObject(rawChange)) {
      throw new ImportApprovalError('INVALID_REQUEST', 'Review decision changes must be objects.');
    }
    const rowIndex = rawChange.rowIndex;
    const expectedRevision = rawChange.expectedRevision;
    if (!Number.isInteger(rowIndex) || (rowIndex as number) < 1) {
      throw new ImportApprovalError('INVALID_REQUEST', 'Review decision row indexes must be positive integers.');
    }
    if (rowIndexes.has(rowIndex as number)) {
      throw new ImportApprovalError('INVALID_REQUEST', `Row ${rowIndex} appears more than once in this review save.`);
    }
    rowIndexes.add(rowIndex as number);
    if (
      expectedRevision !== null &&
      (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 1)
    ) {
      throw new ImportApprovalError(
        'INVALID_REQUEST',
        `Review decision for row ${rowIndex} needs a revision number or null for a new decision.`,
      );
    }
    const hasDecision = Object.prototype.hasOwnProperty.call(rawChange, 'decision');
    return {
      rowIndex: rowIndex as number,
      expectedRevision: expectedRevision as number | null,
      ...(hasDecision ? { decision: normalizeReviewDecision(rowIndex as number, rawChange.decision) } : {}),
    };
  });
}

export async function saveOrderlyReviewDecisionChanges(
  batchId: string,
  auth: ApprovalAuthorizationContext | null | undefined,
  rawChanges: unknown,
  options: {
    expectedPreviewFingerprint?: string;
    /** Bulk helpers may add missing/identical actions but never overwrite a different saved choice. */
    preserveExistingActions?: boolean;
  } = {},
): Promise<{ decisions: SavedReviewDecision[]; clearedRowIndexes: number[] }> {
  const contract = await resolveApprovalContract(batchId, auth);
  if (contract.batch.status !== 'pending_review') {
    throw new ImportApprovalError('CONFLICT', 'Review decisions can only be changed while a batch is pending review.');
  }
  const changes = normalizeReviewDecisionChanges(rawChanges);
  const decisionChanges = changes.filter(
    (change): change is ReviewDecisionChange & { decision: ReviewDecisionPayload } => change.decision !== undefined,
  );

  if (decisionChanges.length > 0) {
    const preview = await runResolutionPreview(contract.batch.id, contract.companyId);
    const rowsByIndex = new Map(preview.rows.map(row => [row.rowIndex, row]));
    for (const change of decisionChanges) {
      const row = rowsByIndex.get(change.rowIndex);
      if (!row) {
        throw new ImportApprovalError('INVALID_REQUEST', `Row ${change.rowIndex} is not part of this import batch.`);
      }
      assertReviewDecisionMatchesPreview(row, change.decision);
    }
    await assertReviewDecisionItemsBelongToCompany(contract.companyId, decisionChanges);
  }

  return db.transaction(async (tx: any) => {
    // Draft writes and approval take the same lock. This makes an approval
    // either observe the complete saved decision set or force the reviewer to
    // refresh; it can never apply a half-written bulk choice.
    const [lockedBatch] = await tx
      .select({
        status: inventoryImportBatches.status,
        companyId: inventoryImportBatches.companyId,
      })
      .from(inventoryImportBatches)
      .where(and(
        // @ts-ignore
        eq(inventoryImportBatches.id, contract.batch.id),
        // @ts-ignore
        eq(inventoryImportBatches.companyId, contract.companyId),
        // @ts-ignore
        eq(inventoryImportBatches.sourceSystem, 'ORDERLY'),
      ))
      .for('update');
    if (!lockedBatch) throw new ImportApprovalError('NOT_FOUND', 'Batch not found');
    if (lockedBatch.status !== 'pending_review') {
      throw new ImportApprovalError('CONFLICT', 'This batch is no longer available for review.');
    }
    const underLockPreview = await runResolutionPreview(contract.batch.id, contract.companyId, tx);
    if (
      options.expectedPreviewFingerprint &&
      fingerprintOrderlyPreview(underLockPreview) !== options.expectedPreviewFingerprint
    ) {
      throw new ImportApprovalError(
        'CONFLICT',
        'The catalog or source evidence changed while this manifest was being imported.',
      );
    }
    if (decisionChanges.length > 0) {
      const rowsByIndex = new Map(underLockPreview.rows.map(row => [row.rowIndex, row]));
      for (const change of decisionChanges) {
        const row = rowsByIndex.get(change.rowIndex);
        if (!row) {
          throw new ImportApprovalError('INVALID_REQUEST', `Row ${change.rowIndex} is not part of this import batch.`);
        }
        assertReviewDecisionMatchesPreview(row, change.decision);
      }
    }

    const targetRows = changes.map(change => change.rowIndex);
    const existingRows = await tx
      .select({
        rowIndex: orderlyImportReviewDecisions.rowIndex,
        revision: orderlyImportReviewDecisions.revision,
        decision: orderlyImportReviewDecisions.decision,
      })
      .from(orderlyImportReviewDecisions)
      .where(and(
        // @ts-ignore
        eq(orderlyImportReviewDecisions.batchId, contract.batch.id),
        // @ts-ignore
        eq(orderlyImportReviewDecisions.companyId, contract.companyId),
        // @ts-ignore
        inArray(orderlyImportReviewDecisions.rowIndex, targetRows),
      ))
      .for('update');
    const existingByRow = new Map<number, { rowIndex: number; revision: number; decision: unknown }>(
      existingRows.map((row: { rowIndex: number; revision: number; decision: unknown }) => [row.rowIndex, row]),
    );

    for (const change of changes) {
      const existing = existingByRow.get(change.rowIndex);
      if (!existing && change.expectedRevision !== null) {
        throw new ImportApprovalError(
          'CONFLICT',
          `The saved review decision for row ${change.rowIndex} was removed by another reviewer. Refresh before saving.`,
        );
      }
      if (existing && change.expectedRevision !== existing.revision) {
        throw new ImportApprovalError(
          'CONFLICT',
          `The saved review decision for row ${change.rowIndex} changed in another session. Refresh before saving.`,
        );
      }
      if (options.preserveExistingActions && existing && change.decision?.action !== undefined) {
        const existingDecision = normalizeReviewDecision(change.rowIndex, existing.decision);
        if (
          reviewDecisionActionSignature(existingDecision) !== reviewDecisionActionSignature(change.decision)
        ) {
          throw new ImportApprovalError(
            'CONFLICT',
            `The saved review decision for row ${change.rowIndex} conflicts with this bulk action. Review the existing choice before retrying.`,
          );
        }
      }
    }

    if (changes.length > 0) {
      const saved = await loadStoredReviewDecisionRecords(contract.batch.id, contract.companyId, tx);
      assertReviewDecisionCodeGroupConsistency(
        underLockPreview,
        changes,
        saved,
      );
    }

    const now = new Date();
    for (const change of changes) {
      const existing = existingByRow.get(change.rowIndex);
      if (change.decision === undefined) {
        if (existing) {
          await tx
            .delete(orderlyImportReviewDecisions)
            .where(and(
              // @ts-ignore
              eq(orderlyImportReviewDecisions.batchId, contract.batch.id),
              // @ts-ignore
              eq(orderlyImportReviewDecisions.companyId, contract.companyId),
              // @ts-ignore
              eq(orderlyImportReviewDecisions.rowIndex, change.rowIndex),
              // @ts-ignore
              eq(orderlyImportReviewDecisions.revision, existing.revision),
            ));
        }
        continue;
      }

      if (existing) {
        if (options.preserveExistingActions && change.decision.action !== undefined) {
          const existingDecision = normalizeReviewDecision(change.rowIndex, existing.decision);
          if (reviewDecisionActionSignature(existingDecision) === reviewDecisionActionSignature(change.decision)) {
            continue;
          }
        }
        await tx
          .update(orderlyImportReviewDecisions)
          .set({
            decision: change.decision,
            revision: existing.revision + 1,
            updatedBy: contract.actingUserId,
            updatedAt: now,
          })
          .where(and(
            // @ts-ignore
            eq(orderlyImportReviewDecisions.batchId, contract.batch.id),
            // @ts-ignore
            eq(orderlyImportReviewDecisions.companyId, contract.companyId),
            // @ts-ignore
            eq(orderlyImportReviewDecisions.rowIndex, change.rowIndex),
            // @ts-ignore
            eq(orderlyImportReviewDecisions.revision, existing.revision),
          ));
      } else {
        await tx.insert(orderlyImportReviewDecisions).values({
          batchId: contract.batch.id,
          companyId: contract.companyId,
          rowIndex: change.rowIndex,
          decision: change.decision,
          revision: 1,
          createdBy: contract.actingUserId,
          updatedBy: contract.actingUserId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const saved = await loadStoredReviewDecisionRecords(contract.batch.id, contract.companyId, tx);
    const changedRowIndexes = new Set(changes.map(change => change.rowIndex));
    return {
      decisions: saved.filter(decision => changedRowIndexes.has(decision.rowIndex)),
      clearedRowIndexes: changes
        .filter(change => change.decision === undefined)
        .map(change => change.rowIndex),
    };
  });
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
  rowDecisions: RowDecision[] | null = [],
  execution?: {
    approvalJobId?: string;
    approvalAttemptCount?: number;
    forceDuplicateDate?: boolean;
  },
): Promise<ApprovalResult> {
  // ── Authorization + destination contract (zero writes on any failure) ────
  const contract = await resolveApprovalContract(batchId, auth, { requireApprovalRole: true });
  const { batch, companyId, actingUserId } = contract;
  const resolvedTargetStoreId = contract.resolvedTargetStoreId;
  const userId: string | null = actingUserId;
  // Verified source-property scope for every external mapping written below.
  const approvedSourcePropertyId = batch.sourcePropertyId;
  // HTTP approval deliberately supplies no client-side decisions. Read the
  // durable draft set instead, so a reload, hot reload, or forged request
  // cannot silently discard or replace the decisions reviewers actually saved.
  // Direct service callers retain the existing array contract. The HTTP route
  // passes null to request the durable decision set instead.
  let persistedDecisionSignature: string | null = null;
  let decisionsToApply: RowDecision[];
  if (rowDecisions === null) {
    const savedDecisions = await loadStoredReviewDecisionRecords(batchId, companyId);
    decisionsToApply = savedDecisions.map(saved => ({
      rowIndex: saved.rowIndex,
      ...saved.decision,
    }));
    persistedDecisionSignature = reviewDecisionSignature(savedDecisions);
  } else {
    decisionsToApply = rowDecisions;
  }

  // ── Build decision override map ──────────────────────────────────────────
  const decisionMap = new Map<number, RowDecision>(
    decisionsToApply.map(d => [d.rowIndex, d]),
  );
  for (const decision of decisionsToApply) {
    if (
      decision.action !== undefined &&
      decision.action !== 'link_existing' &&
      decision.action !== 'link_vendor_pack' &&
      decision.action !== 'create_variant'
    ) {
      throw new ImportApprovalError('INVALID_REQUEST', `Unsupported row decision action on row ${decision.rowIndex}.`);
    }
    if (decision.action === 'link_existing' && !decision.inventoryItemId) {
      throw new ImportApprovalError('INVALID_REQUEST', `A compatible link decision on row ${decision.rowIndex} needs an inventory item.`);
    }
    if (decision.action === 'link_vendor_pack' && !decision.inventoryItemId) {
      throw new ImportApprovalError('INVALID_REQUEST', `A vendor-pack link decision on row ${decision.rowIndex} needs an inventory item.`);
    }
    if (decision.action === 'create_variant' && !decision.comparableInventoryItemId) {
      throw new ImportApprovalError('INVALID_REQUEST', `A separate-variant decision on row ${decision.rowIndex} needs a comparable item.`);
    }
  }

  // ── Validate override IDs belong to this company ─────────────────────────
  // Security: a caller must not be able to cross-tenant link by supplying
  // foreign company item/vendor IDs in saved or explicit decisions.
  const overrideItemIds = decisionsToApply
    .flatMap(d => [d.inventoryItemId, d.comparableInventoryItemId])
    .filter((id): id is string => typeof id === 'string');
  const overrideVendorIds = decisionsToApply
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
  const previewRowsByIndex = new Map(preview.rows.map(row => [row.rowIndex, row]));
  const sourceConflictRows = preview.rows.filter(row => row.itemMatch.sourceDataConflict);
  if (sourceConflictRows.length > 0) {
    const details = sourceConflictRows
      .map(row => `row ${row.rowIndex}: ${row.itemMatch.sourceDataConflict!.reason}`)
      .join(' | ');
    throw new ImportApprovalError(
      'CONFLICT',
      `Orderly source data contains contradictory pack evidence for the same vendor and Item Code. Correct or verify the source before approval: ${details}`,
    );
  }
  const recodeDecisionByReliableCode = new Map<string, RowDecision>();
  for (const decision of decisionsToApply.filter(decision => decision.action !== undefined)) {
    const row = previewRowsByIndex.get(decision.rowIndex);
    if (
      !row ||
      !row.itemMatch.possibleRecode ||
      (!isReliableItemCode(row) && !isPseudoCodeVendorPackReview(row))
    ) {
      throw new ImportApprovalError(
        'INVALID_REQUEST',
        `A review action may only be recorded for an eligible staged identity candidate (row ${decision.rowIndex}).`,
      );
    }
    if (isPseudoCodeVendorPackReview(row)) continue;
    const code = row.sourceItemCode!.trim();
    const existing = recodeDecisionByReliableCode.get(code);
    if (
      existing &&
      (
        existing.action !== decision.action ||
        existing.inventoryItemId !== decision.inventoryItemId ||
        existing.comparableInventoryItemId !== decision.comparableInventoryItemId
      )
    ) {
      throw new ImportApprovalError(
        'CONFLICT',
        `All rows for reliable Orderly Item Code ${code} must use the same re-code decision.`,
      );
    }
    recodeDecisionByReliableCode.set(code, decision);
  }

  const recodeValidationConflicts: string[] = [];
  const validatedRecodeCodes = new Set<string>();
  for (const row of preview.rows.filter(row => row.itemMatch.possibleRecode && isReliableItemCode(row))) {
    const code = row.sourceItemCode!.trim();
    if (validatedRecodeCodes.has(code)) continue;
    validatedRecodeCodes.add(code);
    const decision = recodeDecisionByReliableCode.get(code);
    if (!decision) {
      recodeValidationConflicts.push(
        `${previewRowConflictLabel(row)}: requires an explicit link, vendor-pack link, or separate-variant decision`,
      );
      continue;
    }
    const codeRows = preview.rows.filter(candidate =>
      isReliableItemCode(candidate) &&
      candidate.itemMatch.possibleRecode &&
      candidate.sourceItemCode!.trim() === code
    );
    for (const codeRow of codeRows) {
      try {
        assertReviewDecisionMatchesPreview(codeRow, decision);
      } catch (err: any) {
        recodeValidationConflicts.push(
          `${previewRowConflictLabel(codeRow)}: ${err?.message ?? 'saved decision is no longer valid'}`,
        );
      }
    }
  }
  for (const row of preview.rows.filter(isPseudoCodeVendorPackReview)) {
    const decision = decisionMap.get(row.rowIndex);
    if (!decision?.action) {
      recodeValidationConflicts.push(
        `${previewRowConflictLabel(row)}: requires an explicit vendor-pack link decision`,
      );
      continue;
    }
    try {
      assertReviewDecisionMatchesPreview(row, decision);
    } catch (err: any) {
      recodeValidationConflicts.push(
        `${previewRowConflictLabel(row)}: ${err?.message ?? 'saved decision is no longer valid'}`,
      );
    }
  }
  if (recodeValidationConflicts.length > 0) {
    throw new ImportApprovalError(
      'CONFLICT',
      `Approval preflight found ${recodeValidationConflicts.length} review conflict${recodeValidationConflicts.length === 1 ? '' : 's'}. Review all listed items before retrying: ${recodeValidationConflicts.join(' | ')}`,
    );
  }

  // A group may include an earlier row that is unmatched and a later row with
  // a safe existing match. Resolve the whole reliable-code group to that
  // existing item before considering any create path, independent of row order.
  let {
    reliableCodeExistingItemIds,
    identityGroupExistingItemIds,
    blankGroupMayFollowCodedSibling,
    blankGroupMayCreateInternalItem,
  } = deriveApprovalIdentityCaches(preview);

  // ── Apply everything in one transaction ─────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await db.transaction(async (tx: any) => {
    // The preview and authorization checks intentionally run before the write
    // transaction, but approval itself must be single-writer. Locking the batch
    // row makes a second caller wait, then observe the committed approved
    // status instead of repeating vendor/location/item side effects.
    const [lockedBatch] = await tx
      .select({ status: inventoryImportBatches.status })
      .from(inventoryImportBatches)
      .where(
        and(
          // @ts-ignore
          eq(inventoryImportBatches.id, batchId),
          // @ts-ignore
          eq(inventoryImportBatches.companyId, companyId),
          // @ts-ignore
          eq(inventoryImportBatches.sourceSystem, 'ORDERLY'),
        ),
      )
      .for('update');
    if (!lockedBatch) {
      throw new ImportApprovalError('NOT_FOUND', 'Batch not found');
    }
    if (lockedBatch.status === 'approved') {
      throw new ImportApprovalError(
        'CONFLICT',
        'Batch has already been approved — use the history view to see results.',
      );
    }
    if (lockedBatch.status !== 'pending_review') {
      throw new ImportApprovalError(
        'CONFLICT',
        'This import is no longer pending review and cannot be approved.',
      );
    }
    if (execution?.approvalJobId) {
      const [leasedJob] = await tx
        .select({
          attemptCount: orderlyImportApprovalJobs.attemptCount,
          status: orderlyImportApprovalJobs.status,
        })
        .from(orderlyImportApprovalJobs)
        .where(and(
          eq(orderlyImportApprovalJobs.id, execution.approvalJobId),
          eq(orderlyImportApprovalJobs.batchId, batchId),
          eq(orderlyImportApprovalJobs.companyId, companyId),
        ))
        .for('update');
      if (
        !leasedJob ||
        leasedJob.status !== 'running' ||
        leasedJob.attemptCount !== execution.approvalAttemptCount
      ) {
        throw new ImportApprovalError(
          'CONFLICT',
          'This approval attempt was superseded by a safe retry.',
        );
      }
    }

    // Serialize the duplicate-date invariant across distinct batches. The
    // route-level check gives immediate UI feedback; this authoritative check
    // closes the race where two same-date jobs start together.
    if (execution?.approvalJobId && batch.inventoryDate && !execution.forceDuplicateDate) {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtext(${`orderly-approval-date:${companyId}:${batch.inventoryDate}`})
        )
      `);
      const [priorApproved] = await tx
        .select({ id: inventoryImportBatches.id })
        .from(inventoryImportBatches)
        .where(and(
          eq(inventoryImportBatches.companyId, companyId),
          eq(inventoryImportBatches.inventoryDate, batch.inventoryDate),
          eq(inventoryImportBatches.status, 'approved'),
          ne(inventoryImportBatches.id, batchId),
        ))
        .limit(1);
      if (priorApproved) {
        throw new ImportApprovalError(
          'CONFLICT',
          'Another Orderly import for this inventory date has already been approved.',
        );
      }
    }
    if (persistedDecisionSignature !== null) {
      const underLockSavedDecisions = await loadStoredReviewDecisionRecords(batchId, companyId, tx);
      if (reviewDecisionSignature(underLockSavedDecisions) !== persistedDecisionSignature) {
        throw new ImportApprovalError(
          'CONFLICT',
          'Review decisions changed while approval was starting. Refresh the preview and confirm the saved decisions before approving.',
        );
      }
    }
    // The UI preview is intentionally outside the transaction, but the
    // persisted catalog evidence may change after that read. Re-check it once
    // the batch is locked and before any mutation so a newly-arrived
    // contradictory packSize identity cannot race a variant into the catalog.
    const underLockPreview = await runResolutionPreview(batchId, companyId, tx);
    const underLockRowsByIndex = new Map(
      underLockPreview.rows.map(row => [row.rowIndex, row]),
    );
    const unknownVariantReviewChanges: ReviewDecisionChange[] = [];
    for (const decision of decisionsToApply) {
      const row = underLockRowsByIndex.get(decision.rowIndex);
      if (
        decision.action === 'create_variant' &&
        row?.itemMatch.recodeEvidenceClass === 'pack_evidence_missing' &&
        row.itemMatch.packCompatibility === 'unknown'
      ) {
        unknownVariantReviewChanges.push({
          rowIndex: decision.rowIndex,
          expectedRevision: null,
          decision: {
            action: 'create_variant',
            comparableInventoryItemId: decision.comparableInventoryItemId!,
          },
        });
      }
    }
    if (unknownVariantReviewChanges.length > 0) {
      assertReviewDecisionCodeGroupConsistency(underLockPreview, unknownVariantReviewChanges);
    }
    // Every caller, including direct service callers that pass an explicit
    // decision array, must revalidate against the under-lock catalog state.
    // Durable drafts additionally use the signature check above, but neither
    // path may apply a candidate, vendor, pack, or price decision from the
    // unlocked preview.
    assertSavedReviewDecisionsRemainValid(underLockPreview, decisionsToApply);
    ({
      reliableCodeExistingItemIds,
      identityGroupExistingItemIds,
      blankGroupMayFollowCodedSibling,
      blankGroupMayCreateInternalItem,
    } = deriveApprovalIdentityCaches(underLockPreview));
    const resolutionPreview = underLockPreview;

    let itemsCreated = 0, itemsLinked = 0;
    let vendorsCreated = 0, vendorsLinked = 0;
    let locationsCreated = 0, locationsLinked = 0;
    let vendorItemsCreated = 0, rowsSkipped = 0, rowsHeldForReview = 0, rowsProcessed = 0;
    let storeItemsCreated = 0, storeItemsReactivated = 0;
    let storeItemsAlreadyLinked = 0, storeItemsSkipped = 0;

    // New Orderly items must use the source's normalized canonical unit. Load
    // unit identity under the same lock/transaction as item creation so a
    // missing unit cannot be hidden by the historical "ea" fallback.
    const catalogUnitRows = await tx
      .select({
        id: units.id,
        name: units.name,
        abbreviation: units.abbreviation,
      })
      .from(units);
    const catalogUnitByKey = new Map<string, string>();
    for (const unit of catalogUnitRows as Array<{ id: string; name: string; abbreviation: string }>) {
      catalogUnitByKey.set(normalizeForMatch(unit.abbreviation), unit.id);
      catalogUnitByKey.set(normalizeForMatch(unit.name), unit.id);
    }

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
    const identityGroupItemIds = new Map<string, string | null>();
    const identityRowsByGroup = new Map<string, ResolutionPreviewResult['rows']>();
    for (const row of resolutionPreview.rows) {
      if (!row.identityGroupKey) continue;
      const group = identityRowsByGroup.get(row.identityGroupKey) ?? [];
      group.push(row);
      identityRowsByGroup.set(row.identityGroupKey, group);
    }
    const pseudoOnlyNewIdentityGroups = new Set(
      [...identityRowsByGroup.entries()]
        .filter(([, group]) => (
          group.length > 0 &&
          group.every(row =>
            row.sourceCodeReliability === 'pseudo_code' &&
            row.identityGroupStatus === 'new_candidate'
          )
        ))
        .map(([groupKey]) => groupKey),
    );

    // ── Transaction-time identity re-read ────────────────────────────────
    // The preview ran outside this transaction, so a concurrent approval of
    // the same source property may have created mappings since. Re-read them
    // here and let the persisted mapping win, so two concurrent approvals
    // converge on one inventory item instead of each creating their own.
    const batchReliableCodes = Array.from(new Set(
      resolutionPreview.rows
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
      mappingEvidence: {
        description: string | null;
        packSizeRaw: string | null;
        strategy: string;
        score: number | null;
        geometry: SourcePackGeometry;
      },
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
          packSizeRaw: mappingEvidence.packSizeRaw,
          caseQuantity: mappingEvidence.geometry.caseQuantity ?? null,
          innerPackQuantity: mappingEvidence.geometry.innerPackQuantity ?? null,
          baseUnitQuantity: mappingEvidence.geometry.baseUnitQuantity ?? null,
          baseUnit: mappingEvidence.geometry.baseUnit ?? null,
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
      resolutionPreview.rows
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
    // Resolve authority-bearing coded rows first. This means an otherwise
    // earlier blank sibling can safely consume the group's canonical item ID
    // later in this transaction, rather than inventing an identity itself.
    const rowsInIdentityOrder = [...resolutionPreview.rows].sort((left, right) => {
      const leftIsCode = left.itemCodeStatus === 'valid' ? 0 : 1;
      const rightIsCode = right.itemCodeStatus === 'valid' ? 0 : 1;
      return leftIsCode - rightIsCode || left.rowIndex - right.rowIndex;
    });
    for (const rowPreview of rowsInIdentityOrder) {
      rowsProcessed++;
      const dec = decisionMap.get(rowPreview.rowIndex);

      // Skip if user explicitly skipped
      if (dec?.skip) {
        rowsSkipped++;
        if (rowPreview.heldForReview) rowsHeldForReview++;
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
      const identityDecision = reliableCode
        ? (recodeDecisionByReliableCode.get(reliableCode) ?? dec)
        : dec;
      const groupedExistingItemId = reliableCode
        ? (reliableCodeExistingItemIds.get(reliableCode) ?? null)
        : null;
      const identityGroupKey = rowPreview.identityGroupKey;
      const identityGroupExistingItemId = identityGroupKey
        ? (identityGroupExistingItemIds.get(identityGroupKey) ?? null)
        : null;
      const blankRowMayUseGroupEvidence = rowPreview.itemCodeStatus !== 'blank' || (
        identityGroupKey != null &&
        (
          blankGroupMayFollowCodedSibling.get(identityGroupKey) === true ||
          blankGroupMayCreateInternalItem.get(identityGroupKey) === true
        )
      );
      const hasExplicitBlankDecision = rowPreview.itemCodeStatus === 'blank' &&
        identityDecision?.inventoryItemId !== undefined;
      const hasDirectBlankMatch = rowPreview.itemCodeStatus === 'blank' &&
        !rowPreview.itemMatch.requiresReview &&
        rowPreview.itemMatch.matchedId != null &&
        rowPreview.itemMatch.strategy !== 'same_workbook_identity';
      const insertNewItem = async (): Promise<string> => {
        const catalogGeometry = toCatalogPackGeometry(sourcePackGeometry(rowPreview));
        const canonicalUnitId = catalogGeometry
          ? catalogUnitByKey.get(normalizeForMatch(catalogGeometry.canonicalUnit))
          : catalogUnitByKey.get('ea') ?? catalogUnitByKey.get('each');
        if (!canonicalUnitId) {
          throw new ImportApprovalError(
            'CONFLICT',
            catalogGeometry
              ? `Orderly row ${rowPreview.rowIndex} uses pack unit ${catalogGeometry.canonicalUnit}, which is not configured in FnB.`
              : `Orderly row ${rowPreview.rowIndex} cannot use the opaque package-count basis because the Each unit is not configured in FnB.`,
          );
        }
        const name = identityDecision?.action === 'create_variant'
          ? sourcePackVariantName(rowPreview)
          : rowPreview.cleanedDescription?.trim() || `Orderly Item ${rowPreview.rowIndex}`;
        // Unknown source geometry is still a real inventory identity. Count it
        // as one opaque source package so the historical quantity/value is
        // retained, while leaving container geometry null and preserving the
        // raw source evidence on the mapping. This is not a normalized pack
        // claim: all compatibility/conversion paths continue to return unknown.
        const caseSize = catalogGeometry?.caseSize ?? 1;
        const canonicalUnitCost = rowPreview.packagePrice == null
          ? 0
          : rowPreview.packagePrice / caseSize;
        const [newItem] = await tx
          .insert(inventoryItems)
          .values({
            companyId,
            name,
            unitId: canonicalUnitId,
            caseSize,
            containerSize: catalogGeometry?.containerSize ?? null,
            containerUnitId: catalogGeometry ? canonicalUnitId : null,
            casePkgCount: catalogGeometry?.casePkgCount ?? null,
            pricePerUnit: canonicalUnitCost,
            avgCostPerUnit: canonicalUnitCost,
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
        // Keep the apply path aligned with the read-only preview: a blank row
        // with several coded siblings cannot silently borrow whichever group
        // item happened to be processed first.
        if (
          rowPreview.itemCodeStatus === 'blank' &&
          !blankRowMayUseGroupEvidence &&
          !hasExplicitBlankDecision &&
          !hasDirectBlankMatch
        ) {
          return { itemId: null, created: false };
        }
        if (
          !reliableCode &&
          identityGroupKey &&
          blankRowMayUseGroupEvidence &&
          identityGroupItemIds.has(identityGroupKey)
        ) {
          return { itemId: identityGroupItemIds.get(identityGroupKey) ?? null, created: false };
        }
        if (reliableCode && reliableCodeItemIds.has(reliableCode)) {
          const cachedItemId = reliableCodeItemIds.get(reliableCode) ?? null;
          const requestedExistingItemId =
            identityDecision?.action === 'link_existing' || identityDecision?.action === 'link_vendor_pack'
            ? identityDecision.inventoryItemId
            : identityDecision?.action === undefined
              ? identityDecision?.inventoryItemId
              : undefined;
          if (
            requestedExistingItemId !== undefined &&
            (requestedExistingItemId ?? null) !== cachedItemId
          ) {
            throw new ImportApprovalError(
              'CONFLICT',
              `Rows with reliable Orderly Item Code ${reliableCode} must resolve to one inventory item within this batch.`,
            );
          }
          return { itemId: cachedItemId, created: false };
        }
        if (!reliableCode && identityGroupExistingItemId && blankRowMayUseGroupEvidence) {
          return { itemId: identityGroupExistingItemId, created: false };
        }
        if (groupedExistingItemId) {
          const requestedExistingItemId =
            identityDecision?.action === 'link_existing' || identityDecision?.action === 'link_vendor_pack'
            ? identityDecision.inventoryItemId
            : identityDecision?.action === undefined
              ? identityDecision?.inventoryItemId
              : undefined;
          if (
            requestedExistingItemId !== undefined &&
            (requestedExistingItemId ?? null) !== groupedExistingItemId
          ) {
            throw new ImportApprovalError(
              'CONFLICT',
              `Reliable Orderly Item Code ${reliableCode} is already mapped to a different inventory item.`,
            );
          }
          return { itemId: groupedExistingItemId, created: false };
        }
        if (identityDecision?.action === 'create_variant') {
          return { itemId: await insertNewItem(), created: true };
        }
        if (identityDecision?.action === 'link_existing' || identityDecision?.action === 'link_vendor_pack') {
          return { itemId: identityDecision.inventoryItemId!, created: false };
        }
        if (identityDecision?.inventoryItemId !== undefined) {
          // User override (validated to belong to this company above)
          return { itemId: identityDecision.inventoryItemId ?? null, created: false };
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
          if (
            identityGroupKey != null &&
            blankGroupMayCreateInternalItem.get(identityGroupKey) === true
          ) {
            return { itemId: await insertNewItem(), created: true };
          }
          // Preserve review for true conflicts: multiple possible catalog
          // targets, incompatible product evidence, or missing identity data.
          return { itemId: null, created: false };
        }
        // No confident auto-link (no match, fuzzy, or ambiguous) → new item.
        // Unknown pack geometry uses an opaque one-package count basis; it is
        // not evidence for pack compatibility or unit conversion.
        return { itemId: await insertNewItem(), created: true };
      };

      if (
        reliableCode &&
        rowPreview.itemMatch.mappedCodePackDrift === true &&
        identityDecision?.action === 'create_variant'
      ) {
        const candidate = await resolveRowCandidate();
        if (!candidate.itemId) {
          throw new ImportApprovalError(
            'CONFLICT',
            `Orderly Item Code ${reliableCode} could not create its reviewed pack variant.`,
          );
        }
        resolvedItemId = candidate.itemId;
        if (candidate.created) {
          itemsCreated++;
          isNewItem = true;
        } else {
          itemsLinked++;
        }
      } else if (reliableCode) {
        // Every reliable-code resolution — existing match, manual override, or
        // new item — is settled through the committed mapping, which is the
        // single identity authority for this code within this source property.
        // Without this, two concurrent approvals could link the same code to
        // two different existing items while only one mapping row survived.
        const claimEvidence = {
          description: rowPreview.cleanedDescription,
          packSizeRaw: rowPreview.packSizeRaw,
          strategy: rowPreview.itemMatch.strategy,
          score: rowPreview.itemMatch.score ?? null,
          geometry: sourcePackGeometry(rowPreview),
        };
        const claimCandidate = async () => {
          const candidate = await resolveRowCandidate();
          if (candidate.itemId == null) {
            throw new ImportApprovalError(
              'CONFLICT',
              `Orderly Item Code ${reliableCode} could not be resolved to an inventory item.`,
            );
          }
          return { itemId: candidate.itemId, created: candidate.created };
        };

        const claim = await claimReliableCodeItemId(
          reliableCode,
          claimCandidate,
          claimEvidence,
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
      if (reliableCode && resolvedItemId) reliableCodeItemIds.set(reliableCode, resolvedItemId);
      const maySeedIdentityGroupCache = identityGroupKey != null && resolvedItemId != null && (
        (
          reliableCode != null &&
          blankGroupMayFollowCodedSibling.get(identityGroupKey) === true
        ) ||
        (
          rowPreview.itemCodeStatus === 'blank' &&
          blankGroupMayCreateInternalItem.get(identityGroupKey) === true
        ) ||
        (
          rowPreview.sourceCodeReliability === 'pseudo_code' &&
          pseudoOnlyNewIdentityGroups.has(identityGroupKey)
        )
      );
      if (maySeedIdentityGroupCache) {
        identityGroupItemIds.set(identityGroupKey, resolvedItemId);
      }
      if (rowPreview.heldForReview && !resolvedItemId) rowsHeldForReview++;

      // A separate pack variant is related for catalog review but never used as
      // this source code's identity. Store symmetric edges so either inventory
      // item can surface its comparable packs without a directional assumption.
      if (
        resolvedItemId &&
        identityDecision?.action === 'create_variant' &&
        identityDecision.comparableInventoryItemId &&
        resolvedItemId !== identityDecision.comparableInventoryItemId
      ) {
        const comparableItemId = identityDecision.comparableInventoryItemId;
        await tx
          .insert(inventoryItemRelationships)
          .values([
            {
              companyId,
              inventoryItemId: resolvedItemId,
              relatedInventoryItemId: comparableItemId,
              relationshipType: 'pack_variant',
              sourceSystem: 'ORDERLY',
              sourcePropertyId: approvedSourcePropertyId,
              sourceExternalId: rowPreview.sourceItemCode?.trim() ?? null,
              confidenceScore: null,
              confirmedAt: new Date(),
              confirmedBy: userId,
            },
            {
              companyId,
              inventoryItemId: comparableItemId,
              relatedInventoryItemId: resolvedItemId,
              relationshipType: 'pack_variant',
              sourceSystem: 'ORDERLY',
              sourcePropertyId: approvedSourcePropertyId,
              sourceExternalId: rowPreview.sourceItemCode?.trim() ?? null,
              confidenceScore: null,
              confirmedAt: new Date(),
              confirmedBy: userId,
            },
          ])
          .onConflictDoNothing();
      }

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

      // ── Persist approval-time resolution and parser rehydration ──────
      // Legacy staged rows may have been reparsed from immutable rawData by
      // runResolutionPreview. Store that recovered geometry in the same
      // approval transaction so count-session quantity and unit-cost math uses
      // the exact evidence that created the catalog item and mappings.
      await tx
        .update(inventoryImportRows)
        .set({
          resolvedInventoryItemId: resolvedItemId,
          caseQuantity: rowPreview.caseQuantity,
          innerPackQuantity: rowPreview.innerPackQuantity,
          baseUnitQuantity: rowPreview.baseUnitQuantity,
          baseUnit: rowPreview.baseUnit,
          packParseStatus: rowPreview.packParseStatus,
        })
        // @ts-ignore
        .where(eq(inventoryImportRows.id, rowPreview.rowId));

      // ── External mapping creation ───────────────────────────────────
      if (
        resolvedItemId &&
        rowPreview.sourceItemCode &&
        rowPreview.sourceCodeReliability === 'stable'
      ) {
        await tx
          .insert(inventoryItemExternalMappings)
          .values({
            companyId,
            inventoryItemId: resolvedItemId,
            sourceSystem: 'ORDERLY',
            sourcePropertyId: approvedSourcePropertyId,
            sourceExternalId: rowPreview.sourceItemCode.trim(),
            sourceDescription: rowPreview.cleanedDescription,
            packSizeRaw: rowPreview.packSizeRaw,
            caseQuantity: rowPreview.caseQuantity,
            innerPackQuantity: rowPreview.innerPackQuantity,
            baseUnitQuantity: rowPreview.baseUnitQuantity,
            baseUnit: rowPreview.baseUnit,
            matchStrategy: rowPreview.itemMatch.strategy,
            confidenceScore: rowPreview.itemMatch.score ?? null,
            confirmedAt: new Date(),
            confirmedBy: userId,
          })
          .onConflictDoNothing();
      }

      // Persist the derived identity alongside a real code when a group is
      // actually resolved. The existing mapping table remains the only source
      // identity authority; a collision with another canonical item fails
      // closed rather than silently changing a known source mapping.
      const alternateSourceId = rowPreview.sourceCodeReliability === 'stable'
        ? deriveOrderlyStableCodePackSourceId(
            rowPreview.sourceItemCode,
            rowPreview.cleanedDescription,
            sourcePackGeometry(rowPreview),
          )
        : deriveOrderlyAlternateSourceId(
            rowPreview.cleanedDescription,
            sourcePackGeometry(rowPreview),
          );
      if (resolvedItemId && alternateSourceId) {
        const inserted = await tx
          .insert(inventoryItemExternalMappings)
          .values({
            companyId,
            inventoryItemId: resolvedItemId,
            sourceSystem: 'ORDERLY',
            sourcePropertyId: approvedSourcePropertyId,
            sourceExternalId: alternateSourceId,
            sourceDescription: rowPreview.cleanedDescription,
            packSizeRaw: rowPreview.packSizeRaw,
            caseQuantity: rowPreview.caseQuantity,
            innerPackQuantity: rowPreview.innerPackQuantity,
            baseUnitQuantity: rowPreview.baseUnitQuantity,
            baseUnit: rowPreview.baseUnit,
            matchStrategy: rowPreview.sourceCodeReliability === 'pseudo_code'
              ? 'name_pack'
              : 'alternate_identity',
            confidenceScore: null,
            confirmedAt: new Date(),
            confirmedBy: userId,
          })
          .onConflictDoNothing()
          .returning({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId });
        if (inserted.length === 0) {
          const [existingAlternate] = await tx
            .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
            .from(inventoryItemExternalMappings)
            .where(and(
              // @ts-ignore
              eq(inventoryItemExternalMappings.companyId, companyId),
              // @ts-ignore
              eq(inventoryItemExternalMappings.sourceSystem, 'ORDERLY'),
              // @ts-ignore
              eq(inventoryItemExternalMappings.sourcePropertyId, approvedSourcePropertyId),
              // @ts-ignore
              eq(inventoryItemExternalMappings.sourceExternalId, alternateSourceId),
            ))
            .limit(1);
          if (existingAlternate && existingAlternate.inventoryItemId !== resolvedItemId) {
            throw new ImportApprovalError(
              'CONFLICT',
              `Orderly row ${rowPreview.rowIndex} (Item Code ${rowPreview.sourceItemCode?.trim() || 'unavailable'}; ${rowPreview.cleanedDescription?.trim() || 'description unavailable'}) has derived identity ${alternateSourceId} confirmed for inventory item ${existingAlternate.inventoryItemId}, not resolved item ${resolvedItemId}.`,
            );
          }
        }
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

      // ── Vendor-item pack/price record ─────────────────────────────────
      // Orderly Item Code remains property-scoped source identity and is never
      // copied into vendor_items.vendorSku. Populate vendor_items only when the
      // vendor, item, complete geometry, and positive package price are known.
      if (resolvedVendorId && resolvedItemId) {
        const normalizedGeometry = normalizePackGeometry(sourcePackGeometry(rowPreview));
        const catalogGeometry = toCatalogPackGeometry(sourcePackGeometry(rowPreview));
        const packagePrice = rowPreview.packagePrice;
        const mayPersistVendorPack =
          normalizedGeometry.status === 'compatible' &&
          normalizedGeometry.totalBaseUnits != null &&
          catalogGeometry != null &&
          typeof packagePrice === 'number' &&
          Number.isFinite(packagePrice) &&
          packagePrice > 0;
        if (mayPersistVendorPack) {
          const totalBaseUnits = normalizedGeometry.totalBaseUnits!;
          const canonicalUnitId = catalogUnitByKey.get(normalizeForMatch(catalogGeometry.canonicalUnit));
          if (!canonicalUnitId) {
            throw new ImportApprovalError(
              'CONFLICT',
              `Orderly row ${rowPreview.rowIndex} uses pack unit ${catalogGeometry.canonicalUnit}, which is not configured in FnB.`,
            );
          }
          const normalizedUnitPrice = packagePrice / totalBaseUnits;
          const [existingVendorPack] = await tx
            .select({
              id: vendorItems.id,
              canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
            })
            .from(vendorItems)
            .where(and(
              eq(vendorItems.vendorId, resolvedVendorId),
              eq(vendorItems.inventoryItemId, resolvedItemId),
            ))
            .limit(1);
          if (
            existingVendorPack?.canonicalQtyPerPurchaseUnit != null &&
            Math.abs(existingVendorPack.canonicalQtyPerPurchaseUnit - totalBaseUnits) > 0.000001
          ) {
            throw new ImportApprovalError(
              'CONFLICT',
              `Orderly row ${rowPreview.rowIndex} conflicts with the existing pack for this vendor and inventory item.`,
            );
          }
          const values = {
            vendorId: resolvedVendorId,
            inventoryItemId: resolvedItemId,
            vendorSku: null,
            purchaseUnitId: canonicalUnitId,
            caseSize: catalogGeometry.casePkgCount,
            innerPackSize: catalogGeometry.containerSize,
            packUom: catalogGeometry.canonicalUnit,
            lastPrice: normalizedUnitPrice,
            lastCasePrice: packagePrice,
            active: 1,
            priceSource: 'orderly_inventory_import',
            pricedAt: resolutionPreview.inventoryDate ? new Date(resolutionPreview.inventoryDate) : null,
            priceSourceReferenceId: batchId,
            canonicalQtyPerPurchaseUnit: totalBaseUnits,
            normalizedPricePerCanonicalUnit: normalizedUnitPrice,
            packGeometryStatus: 'verified',
            packGeometrySource: 'orderly_inventory_import',
            packGeometryUpdatedAt: new Date(),
            pricingBasis: 'canonical_unit',
            isVariableWeight: 0,
          };
          if (existingVendorPack) {
            await tx.update(vendorItems).set(values).where(eq(vendorItems.id, existingVendorPack.id));
          } else {
            await tx.insert(vendorItems).values(values);
            vendorItemsCreated++;
          }
        } else if (identityDecision?.action === 'link_vendor_pack') {
          throw new ImportApprovalError(
            'CONFLICT',
            `Orderly row ${rowPreview.rowIndex} cannot attach a vendor pack without complete geometry and a positive package price.`,
          );
        }
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

    const approvedAt = new Date();
    const approvalResult: ApprovalResult = {
      batchId,
      approvedAt: approvedAt.toISOString(),
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
      rowsHeldForReview,
      rowsProcessed,
      storeItemsCreated,
      storeItemsReactivated,
      storeItemsAlreadyLinked,
      storeItemsSkipped,
    };

    // ── Mark batch and its durable job completed atomically ──────────────
    await tx
      .update(inventoryImportBatches)
      .set({
        status: 'approved',
        approvedAt,
        approvedBy: userId,
        targetStoreId: resolvedTargetStoreId ?? null,
      })
      // @ts-ignore
      .where(eq(inventoryImportBatches.id, batchId));

    if (execution?.approvalJobId) {
      const completedJobs = await tx
        .update(orderlyImportApprovalJobs)
        .set({
          status: 'completed',
          phase: 'completed',
          progressPercent: 100,
          updatedAt: approvedAt,
          completedAt: approvedAt,
          result: approvalResult,
          errorCode: null,
          errorMessage: null,
        })
        .where(and(
          eq(orderlyImportApprovalJobs.id, execution.approvalJobId),
          eq(orderlyImportApprovalJobs.batchId, batchId),
          eq(orderlyImportApprovalJobs.companyId, companyId),
          eq(orderlyImportApprovalJobs.status, 'running'),
          eq(orderlyImportApprovalJobs.attemptCount, execution.approvalAttemptCount ?? -1),
        ))
        .returning({ id: orderlyImportApprovalJobs.id });
      if (completedJobs.length !== 1) {
        throw new ImportApprovalError(
          'CONFLICT',
          'This approval attempt lost its lease before completion.',
        );
      }
    }

    return approvalResult;
  });

  return result;
}
