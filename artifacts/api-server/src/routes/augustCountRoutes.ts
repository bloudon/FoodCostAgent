import type { Express } from 'express';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  companyStores,
  categories,
  inventoryCountLines,
  inventoryCountEntries,
  inventoryCounts,
  inventoryItemExternalMappings,
  inventoryItemLocations,
  inventoryItems,
  inventoryLocations,
  storageLocations,
  storeInventoryItems,
  units,
} from '@workspace/db';
import augustWorkbook from '../data/august-2026-orderly-reference.json';
import { requireAuth } from '../auth';
import { canAccessStore } from '../permissions';
import { db } from '../db';
import { directMeasurementCountBlock, getCountInputMode } from '../services/inventory/countQuantity';
import { getEffectiveInventoryItemLocationsBatch } from '../services/inventory/effectiveItemLocations';
import {
  type AugustEvidenceRow,
  assessAugustSourceQuantity,
  hasConfirmedAugustEntry,
  normalizeAugustLocation,
  sourceToCanonicalFactor,
} from '../services/inventory/augustReference';

const AUGUST_DATE = '2026-08-31';
const AUGUST_REFERENCE_COMPANY = '61971215-e3ed-49f3-8afc-6dbe1eef1fcc';
const AUGUST_REFERENCE_STORE = '7126a705-64a6-4362-8b62-f08349640442';
const AUGUST_ORDERLY_PROPERTY = '24472';

type PackagedAugustSourceRow = AugustEvidenceRow & {
  sheetName: string;
  sourceRowIndex: number;
  workbookRow: number;
  sourceItemCode: string;
  itemCodeStatus: string;
  rawDescription: string;
  storageLocation: string;
  packSizeRaw: string | null;
  packParseStatus: string;
  rawData: Record<string, unknown>;
  count1: number | null;
  count2: number | null;
  count3: number | null;
  countUnit1: string;
  countUnit2: string;
  countUnit3: string;
  totalUnits: number | null;
};

function dateOnly(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 10);
}

function retainedSourceEvidence(row: PackagedAugustSourceRow) {
  return {
    sheetName: row.sheetName,
    sourceRowIndex: row.sourceRowIndex,
    workbookRow: row.workbookRow,
    sourceItemCode: row.sourceItemCode,
    itemCodeStatus: row.itemCodeStatus,
    rawDescription: row.rawDescription,
    sourceLocation: row.storageLocation,
    packSizeRaw: row.packSizeRaw,
    packParseStatus: row.packParseStatus,
    datedBaseUnit: row.baseUnit,
    rawCountingUnits: {
      case: row.rawData['Counting Unit 1'] ?? null,
      pack: row.rawData['Counting Unit 2'] ?? null,
      base: row.rawData['Counting Unit 3'] ?? null,
    },
    tiers: {
      case: { label: row.countUnit1, quantity: row.count1 },
      pack: { label: row.countUnit2, quantity: row.count2 },
      base: { label: row.countUnit3, quantity: row.count3 },
    },
    totalUnits: row.totalUnits,
  };
}

export function registerAugustCountRoutes(app: Express): void {
  /**
   * @swagger
   * /inventory-counts/{id}/august-reference:
   *   get:
   *     summary: Read-only comparison with the packaged August Orderly workbook for the designated Bay Hill store
   *     security:
   *       - cookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Per-line comparisons and source-only workbook rows, including SHA-256 provenance }
   *       404: { description: Count session not found }
   *       409: { description: Count session is not an ordinary manual August 31 session }
   */
  app.get('/api/inventory-counts/:id/august-reference', requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId as string | undefined;
      const user = (req as any).user;
      if (!companyId || !user?.id) return res.status(401).json({ error: 'Unauthorized' });

      const [count] = await db.select().from(inventoryCounts).where(and(
        eq(inventoryCounts.id, String(req.params.id)),
        eq(inventoryCounts.companyId, companyId),
      )).limit(1);
      if (!count) return res.status(404).json({ error: 'Count session not found' });
      if (!await canAccessStore(user, count.storeId)) return res.status(403).json({ error: 'Store access denied' });
      const [store] = await db.select({ id: companyStores.id }).from(companyStores).where(and(
        eq(companyStores.id, count.storeId),
        eq(companyStores.companyId, companyId),
      )).limit(1);
      if (!store) return res.status(403).json({ error: 'Count store does not belong to the active company' });
      if (dateOnly(count.countDate) !== AUGUST_DATE || count.isHistoricalImport === 1 ||
          count.isPowerSession === 1 || count.sourceSystem != null || count.sourceBatchId != null) {
        return res.status(409).json({ error: 'August reference comparison is available only for an ordinary manual count dated 2026-08-31.' });
      }
      if (companyId !== AUGUST_REFERENCE_COMPANY || count.storeId !== AUGUST_REFERENCE_STORE) {
        return res.json({
          batch: null,
          rows: [],
          unresolved: [{
            status: 'reference_scope_unavailable',
            reason: 'The packaged August workbook reference is authorized only for the designated Bay Hill company and store.',
          }],
        });
      }

      const sourceRows = augustWorkbook.rows as unknown as PackagedAugustSourceRow[];
      const sourceCodes = [...new Set(sourceRows
        .filter((row) => row.itemCodeStatus === 'valid' && row.sourceItemCode)
        .map((row) => row.sourceItemCode))];
      const queryRows: any[] = await Promise.all([
        db.select({
          lineId: inventoryCountLines.id,
          itemId: inventoryCountLines.inventoryItemId,
          locationId: inventoryCountLines.storageLocationId,
          quantity: inventoryCountLines.qty,
          caseQty: inventoryCountLines.caseQty,
          containerQty: inventoryCountLines.containerQty,
          looseUnits: inventoryCountLines.looseUnits,
          lineUnitId: inventoryCountLines.unitId,
          itemName: inventoryItems.name,
          itemUnitId: inventoryItems.unitId,
          itemUnitAbbreviation: units.abbreviation,
          itemUnitKind: units.kind,
          locationName: inventoryLocations.name,
        }).from(inventoryCountLines)
          .innerJoin(inventoryItems, eq(inventoryCountLines.inventoryItemId, inventoryItems.id))
          .innerJoin(units, eq(inventoryItems.unitId, units.id))
          .leftJoin(inventoryLocations, eq(inventoryCountLines.storageLocationId, inventoryLocations.id))
          .where(and(
            eq(inventoryCountLines.inventoryCountId, count.id),
            eq(inventoryItems.companyId, companyId),
          )),
        sourceCodes.length ? db.select({
          sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
          inventoryItemId: inventoryItemExternalMappings.inventoryItemId,
        })
          .from(inventoryItemExternalMappings)
          .innerJoin(inventoryItems, and(
            eq(inventoryItems.id, inventoryItemExternalMappings.inventoryItemId),
            eq(inventoryItems.companyId, companyId),
            eq(inventoryItems.active, 1),
          ))
          .innerJoin(storeInventoryItems, and(
            eq(storeInventoryItems.inventoryItemId, inventoryItems.id),
            eq(storeInventoryItems.companyId, companyId),
            eq(storeInventoryItems.storeId, count.storeId),
            eq(storeInventoryItems.active, 1),
          ))
          .where(and(
            eq(inventoryItemExternalMappings.companyId, companyId),
            eq(inventoryItemExternalMappings.sourceSystem, 'ORDERLY'),
            eq(inventoryItemExternalMappings.sourcePropertyId, AUGUST_ORDERLY_PROPERTY),
            isNotNull(inventoryItemExternalMappings.confirmedAt),
            isNotNull(inventoryItemExternalMappings.confirmedBy),
            inArray(inventoryItemExternalMappings.sourceExternalId, sourceCodes),
          ))
          : Promise.resolve([]),
        db.select().from(storageLocations).where(eq(storageLocations.companyId, companyId)),
        db.select().from(units),
      ]);
      const [lineRows, mappingRows, legacyLocationRows, allUnits] =
        queryRows as [any[], any[], any[], any[]];
      const mappedItemIdsByCode = new Map<string, Set<string>>();
      for (const mapping of mappingRows) {
        const ids = mappedItemIdsByCode.get(mapping.sourceExternalId) ?? new Set<string>();
        ids.add(mapping.inventoryItemId);
        mappedItemIdsByCode.set(mapping.sourceExternalId, ids);
      }
      const lineIds = lineRows.map((line) => line.lineId);
      const countEntryRows: any[] = lineIds.length
        ? await db.select({
            lineId: inventoryCountEntries.inventoryCountLineId,
            enteredAt: inventoryCountEntries.enteredAt,
          })
          .from(inventoryCountEntries)
          .where(inArray(inventoryCountEntries.inventoryCountLineId, lineIds))
        : [];
      const enteredLineIds = new Set(countEntryRows
        .filter((entry) => hasConfirmedAugustEntry(entry.enteredAt))
        .map((entry) => entry.lineId));
      const earlierLineIds = new Set(countEntryRows.map((entry) => entry.lineId));
      // Include legacy storage names where old count-line IDs still use the retired table.
      const locationNames = new Map<string, string>(legacyLocationRows.map((location) => [location.id, location.name]));
      for (const line of lineRows) if (line.locationName) locationNames.set(line.locationId, line.locationName);
      const candidateItemIds = [...new Set([...lineRows.map((line) => line.itemId), ...[...mappedItemIdsByCode.values()].flatMap((ids) => [...ids])])];
      const activeStoreItems: any[] = candidateItemIds.length
        ? await db.select({ id: inventoryItems.id })
          .from(inventoryItems)
          .innerJoin(storeInventoryItems, and(
            eq(storeInventoryItems.inventoryItemId, inventoryItems.id),
            eq(storeInventoryItems.companyId, companyId),
            eq(storeInventoryItems.storeId, count.storeId),
            eq(storeInventoryItems.active, 1),
          ))
          .where(and(
            eq(inventoryItems.companyId, companyId),
            eq(inventoryItems.active, 1),
            inArray(inventoryItems.id, candidateItemIds),
          ))
        : [];
      const activeStoreItemIds = new Set(activeStoreItems.map((item) => item.id));
      const itemIds = [...new Set([...lineRows.map((line) => line.itemId), ...[...mappedItemIdsByCode.values()]
        .flatMap((ids) => [...ids])
        .filter((id) => activeStoreItemIds.has(id))])];
      const [legacyAssignments, legacyLocations] = await Promise.all([
        itemIds.length ? db.select().from(inventoryItemLocations).where(inArray(inventoryItemLocations.inventoryItemId, itemIds)) : Promise.resolve([]),
        Promise.resolve(legacyLocationRows),
      ]);
      const legacyByItem = new Map<string, typeof legacyAssignments>();
      for (const assignment of legacyAssignments) {
        const list = legacyByItem.get(assignment.inventoryItemId) ?? [];
        list.push(assignment);
        legacyByItem.set(assignment.inventoryItemId, list);
      }
      const effectiveLocations = await getEffectiveInventoryItemLocationsBatch(
        companyId, itemIds, legacyByItem, legacyLocations,
      );
      const effectiveNameByItem = new Map<string, Map<string, string[]>>();
      for (const [itemId, locations] of effectiveLocations) {
        const byName = new Map<string, string[]>();
        for (const location of locations) {
          const key = normalizeAugustLocation(location.name);
          byName.set(key, [...(byName.get(key) ?? []), location.id]);
        }
        effectiveNameByItem.set(itemId, byName);
      }

      const sourceEvaluated = sourceRows.map((row) => {
        const quantityEvidence = assessAugustSourceQuantity(row);
        const codeMappings = row.itemCodeStatus === 'valid' ? [...(mappedItemIdsByCode.get(row.sourceItemCode) ?? [])] : [];
        const itemId = codeMappings.length === 1 && activeStoreItemIds.has(codeMappings[0]) ? codeMappings[0] : null;
        const key = normalizeAugustLocation(row.storageLocation);
        const locationIds = itemId ? effectiveNameByItem.get(itemId)?.get(key) ?? [] : [];
        const locationId = locationIds.length === 1 ? locationIds[0] : undefined;
        return { row, itemId, codeMappings, key, locationId, quantityEvidence };
      });
      const duplicateKeys = new Set<string>();
      const keyCounts = new Map<string, number>();
      for (const entry of sourceEvaluated) {
        if (!entry.itemId || !entry.key) continue;
        const key = `${entry.itemId}\u0000${entry.key}`;
        keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      }
      for (const [key, total] of keyCounts) if (total > 1) duplicateKeys.add(key);

      const sourceByItemLocation = new Map<string, typeof sourceEvaluated>();
      for (const entry of sourceEvaluated) {
        if (!entry.itemId || !entry.locationId) continue;
        const key = `${entry.itemId}\u0000${entry.locationId}`;
        const entries = sourceByItemLocation.get(key) ?? [];
        entries.push(entry);
        sourceByItemLocation.set(key, entries);
      }
      const matchedSourceIndexes = new Set<number>();
      const unitByNormalizedName = new Map<string, typeof allUnits[number]>();
      const unitById = new Map<string, typeof allUnits[number]>();
      for (const unit of allUnits) {
        unitByNormalizedName.set(unit.abbreviation.trim().toLowerCase(), unit);
        unitByNormalizedName.set(unit.name.trim().toLowerCase(), unit);
        unitById.set(unit.id, unit);
      }
      const comparisons = lineRows.map((line) => {
        const sourceKey = `${line.itemId}\u0000${line.locationId}`;
        const matches = sourceByItemLocation.get(sourceKey) ?? [];
        const isEntered = enteredLineIds.has(line.lineId);
        const unconfirmedEarlierEntry = !isEntered && earlierLineIds.has(line.lineId);
        const entryReason = unconfirmedEarlierEntry
          ? 'An older saved value is retained, but it has not been confirmed as an August 31 physical reading. Verify the actual reading and save it again to compare.'
          : 'No physical count entry evidence exists for this line; a seeded zero is not treated as a measurement.';
        const commonBase = {
          lineId: line.lineId,
          itemName: line.itemName,
          locationName: line.locationName ?? locationNames.get(line.locationId) ?? null,
          physicalQty: isEntered ? line.quantity : null,
          physicalUnit: unitById.get(line.lineUnitId)?.abbreviation ?? line.itemUnitAbbreviation,
        };
        if (!matches.length && !isEntered) return {
          ...commonBase,
          sourceQty: null,
          sourceUnit: null,
          comparisonUnit: null,
          factor: null,
          sourceComparableQty: null,
          difference: null,
          status: 'not_entered' as const,
          reason: entryReason,
          rowIndexes: [],
        };
        if (!matches.length) return {
          ...commonBase,
          sourceQty: null,
          sourceUnit: null,
          comparisonUnit: null,
          factor: null,
          sourceComparableQty: null,
          difference: null,
          status: 'unresolved' as const,
          reason: 'No resolved source row matches this item and storage location.',
          rowIndexes: [],
        };
        for (const match of matches) matchedSourceIndexes.add(match.row.sourceRowIndex);
        if (matches.length > 1 || duplicateKeys.has(`${line.itemId}\u0000${normalizeAugustLocation(line.locationName ?? locationNames.get(line.locationId))}`)) {
          return {
            ...commonBase,
            sourceQty: null,
            sourceUnit: null,
            comparisonUnit: null,
            factor: null,
            sourceComparableQty: null,
            difference: null,
            status: 'unresolved' as const,
            reason: 'Multiple Orderly rows resolve to this item and storage location; they are not aggregated.',
            rowIndexes: matches.map(({ row }) => row.workbookRow),
            sourceEvidence: matches.map(({ row }) => retainedSourceEvidence(row)),
          };
        }
        if (!isEntered) return {
          ...commonBase,
          sourceQty: matches[0].quantityEvidence.status === 'evidenced'
            ? matches[0].quantityEvidence.quantity
            : null,
          sourceUnit: matches[0].quantityEvidence.status === 'evidenced'
            ? matches[0].quantityEvidence.sourceUnit
            : null,
          comparisonUnit: null,
          factor: null,
          sourceComparableQty: null,
          difference: null,
          status: 'not_entered' as const,
          reason: unconfirmedEarlierEntry
            ? entryReason
            : 'This item and location have a source row, but no physical count entry evidence exists; a seeded zero is not treated as a measurement.',
          rowIndexes: [matches[0].row.workbookRow],
          sourceEvidence: retainedSourceEvidence(matches[0].row),
          sourceQuantityStatus: matches[0].quantityEvidence.status,
          sourceQuantityReason: matches[0].quantityEvidence.explanation ?? null,
        };
        const match = matches[0];
        const source = match.quantityEvidence;
        if (source.status !== 'evidenced') {
          return {
            ...commonBase,
            sourceQty: null,
            sourceUnit: null,
            comparisonUnit: null,
            factor: null,
            sourceComparableQty: null,
            difference: null,
            status: 'unresolved' as const,
            reason: source.explanation,
            rowIndexes: [match.row.workbookRow],
            sourceEvidence: retainedSourceEvidence(match.row),
          };
        }
        if (line.lineUnitId !== line.itemUnitId) {
          return {
            ...commonBase,
            sourceQty: source.quantity,
            sourceUnit: source.sourceUnit,
            comparisonUnit: null,
            factor: null,
            sourceComparableQty: null,
            difference: null,
            status: 'unresolved' as const,
            reason: 'Saved physical count line unit differs from the item canonical unit.',
            rowIndexes: [match.row.workbookRow],
            sourceEvidence: retainedSourceEvidence(match.row),
          };
        }
        const sourceUnitRecord = unitByNormalizedName.get(source.sourceUnit.trim().toLowerCase());
        const unitFactor = sourceToCanonicalFactor(
          source.sourceUnit,
          line.itemUnitAbbreviation,
          sourceUnitRecord?.kind,
          line.itemUnitKind,
        );
        const sourceOutput = {
          rowIndex: match.row.workbookRow,
          sourceUnit: match.row.countUnit3 ?? match.row.baseUnit,
          sourceQuantity: source.quantity,
          sourceTier: { case: match.row.count1, pack: match.row.count2, base: match.row.count3 },
        };
        if (unitFactor == null) {
          return {
            ...commonBase,
            sourceQty: sourceOutput.sourceQuantity,
            sourceUnit: sourceOutput.sourceUnit,
            comparisonUnit: null,
            factor: null,
            sourceComparableQty: null,
            difference: null,
            status: 'unresolved' as const,
            reason: 'Source UOM cannot be reconciled to the item canonical unit; only identical units or evidenced lb/oz weight conversion are supported.',
            rowIndexes: [match.row.workbookRow],
            sourceEvidence: retainedSourceEvidence(match.row),
          };
        }
        const comparisonQuantity = source.quantity * unitFactor;
        return {
          ...commonBase,
          sourceQty: source.quantity,
          sourceUnit: sourceOutput.sourceUnit,
          comparisonUnit: line.itemUnitAbbreviation,
          factor: unitFactor,
          sourceComparableQty: comparisonQuantity,
          difference: line.quantity - comparisonQuantity,
          status: 'comparable' as const,
          reason: null,
          rowIndexes: [match.row.workbookRow],
          sourceEvidence: retainedSourceEvidence(match.row),
        };
      });

      const lineItemLocationKeys = new Set(lineRows.map((line) => `${line.itemId}\u0000${line.locationId}`));
      const unmatchedSourceRows = sourceEvaluated.filter(({ row }) => !matchedSourceIndexes.has(row.sourceRowIndex)).map(({ row, itemId, codeMappings, key, locationId, quantityEvidence }) => {
        const duplicateKey = itemId && locationId ? `${itemId}\u0000${locationId}` : null;
        const status = row.itemCodeStatus !== 'valid' || !row.sourceItemCode ? 'unmatched_item'
          : codeMappings.length === 0 ? 'unmapped_source_code'
            : codeMappings.length > 1 ? 'ambiguous_source_code'
              : !itemId ? 'item_not_active_at_store'
          : !normalizeAugustLocation(row.storageLocation) || !locationId ? 'unresolved_location'
            : duplicateKey && duplicateKeys.has(`${itemId}\u0000${key}`) ? 'duplicate_source'
              : lineItemLocationKeys.has(`${itemId}\u0000${locationId}`) ? 'duplicate_source'
                : 'not_entered';
        return {
          rowIndex: row.workbookRow,
          sourceEvidence: retainedSourceEvidence(row),
          inventoryItemId: itemId,
          sourceLocation: row.storageLocation,
          sourceUnit: quantityEvidence.status === 'evidenced' ? quantityEvidence.sourceUnit : null,
          sourceQuantity: quantityEvidence.status === 'evidenced' ? quantityEvidence.quantity : null,
          quantityStatus: quantityEvidence.status,
          quantityExplanation: quantityEvidence.explanation ?? null,
          status,
          explanation: status === 'unmatched_item'
            ? 'Source item code is blank, placeholder, or non-unique in the workbook.'
            : status === 'unmapped_source_code'
              ? 'No human-confirmed Orderly source-code mapping exists for source property 24472.'
              : status === 'ambiguous_source_code'
                ? 'Confirmed source-code mappings resolve this code to more than one inventory item.'
                : status === 'item_not_active_at_store'
                  ? 'Resolved source item is not an active inventory assignment at this store.'
                  : status === 'unresolved_location'
                    ? 'Source location is blank or does not uniquely match an effective item location.'
                    : status === 'duplicate_source'
                      ? 'Multiple Orderly rows resolve to the same item and location; they are not aggregated.'
                      : status === 'not_entered'
                        ? 'Source row has a resolved item and location, but there is no physical count line for it.'
                        : quantityEvidence.explanation,
        };
      });

      const unresolvedLines = comparisons.filter((row) => row.status !== 'comparable').map((row) => ({
        lineId: row.lineId,
        itemName: row.itemName,
        locationName: row.locationName,
        status: row.status,
        reason: row.reason,
        rowIndexes: row.rowIndexes,
      }));
      return res.json({
        batch: {
          sourceType: 'packaged_workbook',
          sourcePropertyId: AUGUST_ORDERLY_PROPERTY,
          date: augustWorkbook.provenance.sourceInventoryDate,
          filename: augustWorkbook.provenance.sourceFile,
          sha256: augustWorkbook.provenance.sha256,
          sheetName: augustWorkbook.provenance.sheetName,
          sourceRowCount: augustWorkbook.provenance.sourceRowCount,
          dateBasis: augustWorkbook.provenance.inventoryDateBasis,
        },
        rows: comparisons,
        unresolved: [...unresolvedLines, ...unmatchedSourceRows],
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? 'Unable to compare August Orderly reference.' });
    }
  });

  app.get('/api/inventory-counts/readiness', requireAuth, async (req, res) => {
    try {
      const companyId = (req as any).companyId as string | undefined;
      const user = (req as any).user;
      const storeId = String(req.query.storeId ?? '');
      if (!companyId || !user?.id) return res.status(401).json({ error: 'Unauthorized' });
      if (!storeId) return res.status(400).json({ error: 'storeId query parameter is required' });
      if (!await canAccessStore(user, storeId)) return res.status(403).json({ error: 'Store access denied' });
      const [store] = await db.select({ id: companyStores.id }).from(companyStores).where(and(
        eq(companyStores.id, storeId), eq(companyStores.companyId, companyId),
      )).limit(1);
      if (!store) return res.status(404).json({ error: 'Store not found' });
      const activeRows: Array<{ item: any; unitAbbreviation: string | null; unitKind: string | null }> = await db.select({
        item: inventoryItems,
        storeAssignment: storeInventoryItems,
        unitAbbreviation: units.abbreviation,
        unitKind: units.kind,
      }).from(storeInventoryItems)
        .innerJoin(inventoryItems, eq(storeInventoryItems.inventoryItemId, inventoryItems.id))
        .leftJoin(units, eq(inventoryItems.unitId, units.id))
        .where(and(
          eq(storeInventoryItems.companyId, companyId),
          eq(storeInventoryItems.storeId, storeId),
          eq(storeInventoryItems.active, 1),
          eq(inventoryItems.companyId, companyId),
          eq(inventoryItems.active, 1),
        ));
      const categoryIds: string[] = [...new Set(activeRows.map(({ item }) => item.categoryId)
        .filter((id: unknown): id is string => typeof id === 'string' && !!id))];
      const catchWeightCategories: Array<{ id: string; isCatchWeightCategory: number }> = categoryIds.length
        ? await db.select({ id: categories.id, isCatchWeightCategory: categories.isCatchWeightCategory })
          .from(categories)
          .where(and(eq(categories.companyId, companyId), inArray(categories.id, categoryIds)))
        : [];
      const catchWeightCategoryIds = new Set(catchWeightCategories
        .filter((category) => category.isCatchWeightCategory === 1)
        .map((category) => category.id));
      const itemIds = activeRows.map(({ item }) => item.id);
      const [legacyAssignments, legacyLocations] = await Promise.all([
        itemIds.length ? db.select().from(inventoryItemLocations).where(inArray(inventoryItemLocations.inventoryItemId, itemIds)) : Promise.resolve([]),
        db.select().from(storageLocations).where(eq(storageLocations.companyId, companyId)),
      ]);
      const legacyByItem = new Map<string, typeof legacyAssignments>();
      for (const assignment of legacyAssignments) {
        const list = legacyByItem.get(assignment.inventoryItemId) ?? [];
        list.push(assignment);
        legacyByItem.set(assignment.inventoryItemId, list);
      }
      const effective = await getEffectiveInventoryItemLocationsBatch(companyId, itemIds, legacyByItem, legacyLocations);
      const items = activeRows.map(({ item, unitAbbreviation, unitKind }) => {
        const locations = effective.get(item.id) ?? [];
        const mode = getCountInputMode({
          unitId: item.unitId, caseSize: item.caseSize, containerSize: item.containerSize,
          casePkgCount: item.casePkgCount, containerUnitId: item.containerUnitId,
          containerLabel: item.containerLabel,
        }, !!item.categoryId && catchWeightCategoryIds.has(item.categoryId));
        const unitBlock = directMeasurementCountBlock(mode, unitKind);
        const blockers = [
          ...(locations.length ? [] : ['No effective storage location assignment.']),
          ...(mode === 'unconfigured' ? ['Package count setup is incomplete; do not infer a package from a vendor pack.'] : []),
          ...(unitBlock ? [unitBlock] : []),
        ];
        return {
          inventoryItemId: item.id,
          name: item.name,
          unit: { id: item.unitId, abbreviation: unitAbbreviation, kind: unitKind },
          countInputMode: mode,
          locations,
          status: blockers.length ? 'blocked' : 'ready',
          blockers,
        };
      });
      const locationGroups = new Map<string, { id: string; name: string; itemCount: number }>();
      let totalLines = 0;
      for (const item of items) {
        totalLines += item.locations.length;
        for (const location of item.locations) {
          const current = locationGroups.get(location.id);
          if (current) current.itemCount += 1;
          else locationGroups.set(location.id, { id: location.id, name: location.name, itemCount: 1 });
        }
      }
      return res.json({
        storeId,
        activeItems: items,
        totalLines,
        unassigned: items.filter((item) => item.locations.length === 0).map((item) => ({
          id: item.inventoryItemId,
          name: item.name,
          reason: 'No effective storage location is assigned.',
        })),
        blocked: items.filter((item) => item.blockers.length > 0).map((item) => ({
          id: item.inventoryItemId,
          name: item.name,
          reason: item.blockers.join(' '),
        })),
        locations: [...locationGroups.values()].sort((a, b) => a.name.localeCompare(b.name)),
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message ?? 'Unable to load count readiness.' });
    }
  });
}