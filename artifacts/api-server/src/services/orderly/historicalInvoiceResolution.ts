import { and, eq, ilike, or, sql } from 'drizzle-orm';
import type { User } from '@workspace/db';
import {
  historicalInvoiceLines,
  historicalInvoices,
  inventoryItemExternalMappings,
  inventoryItems,
  vendorInvoiceImportBatches,
  vendorItemExternalMappings,
  vendorItems,
  vendors,
} from '@workspace/db';
import { db } from '../../db';
import { getAccessibleStores } from '../../permissions';
import { classifyOrderlyVendorProductIdentity } from './orderlyVendorProductIdentity';

type Runner = typeof db | any;

export class HistoricalInvoiceResolutionError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_REQUEST' | 'CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'HistoricalInvoiceResolutionError';
  }
}

interface AuthorizedLineContext {
  lineId: string;
  invoiceId: string;
  companyId: string;
  storeId: string;
  vendorId: string | null;
  sourceSystem: string;
  sourcePropertyId: string;
  sourceExternalId: string | null;
  productNameSnapshot: string | null;
  packSnapshot: unknown;
  glSnapshot: unknown;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  resolutionStatus: string;
  inventoryItemId: string | null;
  vendorItemId: string | null;
  invoiceDate: string;
  invoiceNumber: string | null;
  vendorNameSnapshot: string | null;
}

interface ResolutionOccurrence {
  lineId: string;
  storeId: string;
  invoiceDate: string;
  productNameSnapshot: string | null;
  packSnapshot: unknown;
  lineTotal: number | null;
  resolutionStatus: string;
  inventoryItemId: string | null;
  vendorItemId: string | null;
}

function jsonbObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(value: unknown, key: string): string | null {
  const field = jsonbObject(value)[key];
  return typeof field === 'string' && field.trim() ? field.trim() : null;
}

function packRaw(value: unknown): string | null {
  return stringField(value, 'raw');
}

async function readLineContext(
  runner: Runner,
  invoiceId: string,
  lineId: string,
  companyId: string,
): Promise<AuthorizedLineContext | null> {
  const [row] = await runner
    .select({
      lineId: historicalInvoiceLines.id,
      invoiceId: historicalInvoices.id,
      companyId: historicalInvoices.companyId,
      storeId: historicalInvoices.storeId,
      vendorId: historicalInvoices.vendorId,
      sourceSystem: historicalInvoices.sourceSystem,
      sourcePropertyId: historicalInvoices.sourcePropertyId,
      sourceExternalId: historicalInvoiceLines.sourceExternalId,
      productNameSnapshot: historicalInvoiceLines.productNameSnapshot,
      packSnapshot: historicalInvoiceLines.packSnapshot,
      glSnapshot: historicalInvoiceLines.glSnapshot,
      quantity: historicalInvoiceLines.quantity,
      unitPrice: historicalInvoiceLines.unitPrice,
      lineTotal: historicalInvoiceLines.lineTotal,
      resolutionStatus: historicalInvoiceLines.resolutionStatus,
      inventoryItemId: historicalInvoiceLines.inventoryItemId,
      vendorItemId: historicalInvoiceLines.vendorItemId,
      invoiceDate: historicalInvoices.invoiceDate,
      invoiceNumber: historicalInvoices.invoiceNumber,
      vendorNameSnapshot: historicalInvoices.vendorNameSnapshot,
    })
    .from(historicalInvoiceLines)
    .innerJoin(
      historicalInvoices,
      and(
        eq(historicalInvoices.id, historicalInvoiceLines.invoiceId),
        eq(historicalInvoices.companyId, historicalInvoiceLines.companyId),
      ),
    )
    .innerJoin(
      vendorInvoiceImportBatches,
      and(
        eq(vendorInvoiceImportBatches.id, historicalInvoices.importBatchId),
        eq(vendorInvoiceImportBatches.companyId, historicalInvoices.companyId),
        eq(vendorInvoiceImportBatches.status, 'approved'),
      ),
    )
    .where(and(
      eq(historicalInvoices.id, invoiceId),
      eq(historicalInvoiceLines.id, lineId),
      eq(historicalInvoices.companyId, companyId),
    ))
    .limit(1);
  return row ?? null;
}

async function authorizeLine(
  invoiceId: string,
  lineId: string,
  user: User,
  companyId: string,
): Promise<{ context: AuthorizedLineContext; accessibleStoreIds: string[] }> {
  const context = await readLineContext(db, invoiceId, lineId, companyId);
  const accessibleStoreIds = await getAccessibleStores(user, companyId);
  if (!context || !accessibleStoreIds.includes(context.storeId)) {
    throw new HistoricalInvoiceResolutionError('NOT_FOUND', 'Invoice line not found.');
  }
  return { context, accessibleStoreIds };
}

async function readOccurrences(
  runner: Runner,
  context: AuthorizedLineContext,
): Promise<ResolutionOccurrence[]> {
  if (!context.vendorId || !context.sourceExternalId) return [];
  return runner
    .select({
      lineId: historicalInvoiceLines.id,
      storeId: historicalInvoices.storeId,
      invoiceDate: historicalInvoices.invoiceDate,
      productNameSnapshot: historicalInvoiceLines.productNameSnapshot,
      packSnapshot: historicalInvoiceLines.packSnapshot,
      lineTotal: historicalInvoiceLines.lineTotal,
      resolutionStatus: historicalInvoiceLines.resolutionStatus,
      inventoryItemId: historicalInvoiceLines.inventoryItemId,
      vendorItemId: historicalInvoiceLines.vendorItemId,
    })
    .from(historicalInvoiceLines)
    .innerJoin(
      historicalInvoices,
      and(
        eq(historicalInvoices.id, historicalInvoiceLines.invoiceId),
        eq(historicalInvoices.companyId, historicalInvoiceLines.companyId),
      ),
    )
    .innerJoin(
      vendorInvoiceImportBatches,
      and(
        eq(vendorInvoiceImportBatches.id, historicalInvoices.importBatchId),
        eq(vendorInvoiceImportBatches.companyId, historicalInvoices.companyId),
        eq(vendorInvoiceImportBatches.status, 'approved'),
      ),
    )
    .where(and(
      eq(historicalInvoiceLines.companyId, context.companyId),
      eq(historicalInvoices.vendorId, context.vendorId),
      eq(historicalInvoices.sourceSystem, context.sourceSystem),
      eq(historicalInvoices.sourcePropertyId, context.sourcePropertyId),
      eq(historicalInvoiceLines.sourceExternalId, context.sourceExternalId),
    ));
}

async function readVendorProductRows(
  runner: Runner,
  context: AuthorizedLineContext,
  selectedVendorItemId?: string,
) {
  if (!context.vendorId || !context.sourceExternalId) return [];
  const skuRows = await runner
    .select({
      id: vendorItems.id,
      vendorId: vendorItems.vendorId,
      inventoryItemId: vendorItems.inventoryItemId,
      vendorSku: vendorItems.vendorSku,
      brandName: vendorItems.brandName,
      purchaseUnitId: vendorItems.purchaseUnitId,
      caseSize: vendorItems.caseSize,
      innerPackSize: vendorItems.innerPackSize,
      packUom: vendorItems.packUom,
      lastPrice: vendorItems.lastPrice,
      lastCasePrice: vendorItems.lastCasePrice,
      active: vendorItems.active,
      priceSource: vendorItems.priceSource,
      canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
      pricingBasis: vendorItems.pricingBasis,
      isVariableWeight: vendorItems.isVariableWeight,
      packGeometryStatus: vendorItems.packGeometryStatus,
      pricedAt: vendorItems.pricedAt,
      updatedAt: vendorItems.updatedAt,
    })
    .from(vendorItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, vendorItems.inventoryItemId))
    .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
    .where(and(
      eq(vendorItems.vendorId, context.vendorId),
      eq(vendorItems.vendorSku, context.sourceExternalId),
      eq(vendors.companyId, context.companyId),
      eq(inventoryItems.companyId, context.companyId),
    ));

  if (!selectedVendorItemId || skuRows.some((row: any) => row.id === selectedVendorItemId)) {
    return skuRows;
  }
  const [selected] = await runner
    .select({
      id: vendorItems.id,
      vendorId: vendorItems.vendorId,
      inventoryItemId: vendorItems.inventoryItemId,
      vendorSku: vendorItems.vendorSku,
      brandName: vendorItems.brandName,
      purchaseUnitId: vendorItems.purchaseUnitId,
      caseSize: vendorItems.caseSize,
      innerPackSize: vendorItems.innerPackSize,
      packUom: vendorItems.packUom,
      lastPrice: vendorItems.lastPrice,
      lastCasePrice: vendorItems.lastCasePrice,
      active: vendorItems.active,
      priceSource: vendorItems.priceSource,
      canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
      pricingBasis: vendorItems.pricingBasis,
      isVariableWeight: vendorItems.isVariableWeight,
      packGeometryStatus: vendorItems.packGeometryStatus,
      pricedAt: vendorItems.pricedAt,
      updatedAt: vendorItems.updatedAt,
    })
    .from(vendorItems)
    .innerJoin(inventoryItems, eq(inventoryItems.id, vendorItems.inventoryItemId))
    .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
    .where(and(
      eq(vendorItems.id, selectedVendorItemId),
      eq(vendorItems.vendorId, context.vendorId),
      eq(vendors.companyId, context.companyId),
      eq(inventoryItems.companyId, context.companyId),
    ))
    .limit(1);
  return selected ? [...skuRows, selected] : skuRows;
}

async function classify(
  runner: Runner,
  context: AuthorizedLineContext,
  accessibleStoreIds: string[],
  selectedVendorItemId?: string,
) {
  const blockers: string[] = [];
  if (context.sourceSystem !== 'ORDERLY') blockers.push('Only Orderly source identities can be resolved here.');
  if (!context.vendorId) blockers.push('The imported invoice does not have one verified vendor.');
  if (!context.sourceExternalId?.trim()) blockers.push('The source line does not have an item code.');
  if (blockers.length > 0) {
    return {
      classification: 'CONFLICT' as const,
      reasons: blockers,
      canonicalVendorItem: null,
      packCrossCheck: null,
      occurrences: [] as ResolutionOccurrence[],
      mappedInventoryItemIds: [] as string[],
      mappedVendorItemIds: [] as string[],
      preselectionBlockers: [...blockers],
    };
  }

  const occurrences = await readOccurrences(runner, context);
  if (occurrences.some(row => !accessibleStoreIds.includes(row.storeId))) {
    blockers.push('This source identity includes a store outside your authorized scope.');
  }
  const preselectionBlockers = [...blockers];

  const inventoryMappings = await runner
    .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
    .from(inventoryItemExternalMappings)
    .where(and(
      eq(inventoryItemExternalMappings.companyId, context.companyId),
      eq(inventoryItemExternalMappings.sourceSystem, context.sourceSystem),
      eq(inventoryItemExternalMappings.sourcePropertyId, context.sourcePropertyId),
      eq(inventoryItemExternalMappings.sourceExternalId, context.sourceExternalId!),
    ));
  const vendorMappings = await runner
    .select({
      vendorItemId: vendorItemExternalMappings.vendorItemId,
      inventoryItemId: vendorItems.inventoryItemId,
      vendorId: vendorItems.vendorId,
    })
    .from(vendorItemExternalMappings)
    .innerJoin(vendorItems, eq(vendorItems.id, vendorItemExternalMappings.vendorItemId))
    .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, vendorItems.inventoryItemId))
    .where(and(
      eq(vendorItemExternalMappings.companyId, context.companyId),
      eq(vendorItemExternalMappings.sourceSystem, context.sourceSystem),
      eq(vendorItemExternalMappings.sourcePropertyId, context.sourcePropertyId),
      eq(vendorItemExternalMappings.sourceExternalId, context.sourceExternalId!),
      eq(vendors.companyId, context.companyId),
      eq(inventoryItems.companyId, context.companyId),
    ));

  const candidates = await readVendorProductRows(runner, context, selectedVendorItemId);
  const mappedInventoryItemIds = [
    ...new Set([
      ...inventoryMappings.map((row: any) => row.inventoryItemId),
      ...vendorMappings.map((row: any) => row.inventoryItemId),
    ]),
  ];
  const decision = classifyOrderlyVendorProductIdentity({
    candidates,
    mappedInventoryItemIds,
    mappedVendorItemIds: vendorMappings.map((row: any) => row.vendorItemId),
    selectedVendorItemId,
    sourceDescriptions: occurrences.map(row => row.productNameSnapshot),
    sourcePackRawValues: occurrences.map(row => packRaw(row.packSnapshot)),
  });
  blockers.push(...decision.reasons);

  if (selectedVendorItemId && decision.canonicalVendorItem) {
    if (vendorMappings.some((row: any) =>
      row.vendorItemId !== decision.canonicalVendorItem!.id ||
      row.vendorId !== context.vendorId
    )) {
      blockers.push('A competing vendor-product mapping already owns this source identity.');
    }
    if (occurrences.some(row =>
      row.resolutionStatus === 'resolved' &&
      (row.inventoryItemId !== decision.canonicalVendorItem!.inventoryItemId ||
        row.vendorItemId !== decision.canonicalVendorItem!.id)
    )) {
      blockers.push('A historical sibling line is already resolved to a different product.');
    }
  }

  return {
    ...decision,
    classification: blockers.length > 0 && decision.classification === 'SAFE_CANDIDATE'
      ? 'CONFLICT' as const
      : decision.classification,
    reasons: [...new Set(blockers)],
    occurrences,
    mappedInventoryItemIds,
    mappedVendorItemIds: vendorMappings.map((row: any) => row.vendorItemId),
    preselectionBlockers,
  };
}

function impactOf(occurrences: ResolutionOccurrence[], alreadyMapped = false) {
  const eligible = occurrences.filter(row =>
    row.resolutionStatus === 'unresolved' &&
    row.inventoryItemId == null &&
    row.vendorItemId == null
  );
  const dates = occurrences.map(row => row.invoiceDate).sort();
  return {
    occurrenceCount: occurrences.length,
    affectedOccurrenceCount: alreadyMapped ? 0 : eligible.length,
    spend: occurrences.reduce((sum, row) => sum + (row.lineTotal ?? 0), 0),
    dateRangeStart: dates[0] ?? null,
    dateRangeEnd: dates.at(-1) ?? null,
  };
}

export async function previewHistoricalInvoiceLineResolution(
  invoiceId: string,
  lineId: string,
  selectedVendorItemId: string | undefined,
  user: User,
  companyId: string,
) {
  const { context, accessibleStoreIds } = await authorizeLine(invoiceId, lineId, user, companyId);
  const decision = await classify(db, context, accessibleStoreIds, selectedVendorItemId);
  const canonical = decision.canonicalVendorItem;
  let canonicalName: string | null = null;
  if (canonical) {
    const [item] = await db
      .select({ name: inventoryItems.name })
      .from(inventoryItems)
      .where(and(
        eq(inventoryItems.id, canonical.inventoryItemId),
        eq(inventoryItems.companyId, companyId),
      ))
      .limit(1);
    canonicalName = item?.name ?? null;
  }
  const alreadyMapped = !!canonical &&
    decision.mappedInventoryItemIds.length === 1 &&
    decision.mappedInventoryItemIds[0] === canonical.inventoryItemId &&
    decision.mappedVendorItemIds.length === 1 &&
    decision.mappedVendorItemIds[0] === canonical.id;
  return {
    line: {
      id: context.lineId,
      description: context.productNameSnapshot,
      itemCode: context.sourceExternalId,
      pack: jsonbObject(context.packSnapshot),
      sourceGlCode: stringField(context.glSnapshot, 'glCode'),
      sourceCategory: stringField(context.glSnapshot, 'category'),
      quantity: context.quantity,
      unitPrice: context.unitPrice,
      lineTotal: context.lineTotal,
      invoiceDate: context.invoiceDate,
      invoiceNumber: context.invoiceNumber,
      vendorName: context.vendorNameSnapshot,
    },
    impact: impactOf(decision.occurrences, alreadyMapped),
    classification: selectedVendorItemId ? {
      status: decision.classification,
      reasons: decision.reasons,
      packCrossCheck: decision.packCrossCheck,
      canConfirm: decision.classification === 'SAFE_CANDIDATE',
      target: canonical ? {
        vendorItemId: canonical.id,
        inventoryItemId: canonical.inventoryItemId,
        inventoryItemName: canonicalName,
      } : null,
    } : null,
    blockers: selectedVendorItemId ? [] : decision.preselectionBlockers,
  };
}

export async function searchHistoricalInvoiceResolutionCandidates(
  invoiceId: string,
  lineId: string,
  query: string,
  user: User,
  companyId: string,
) {
  const { context } = await authorizeLine(invoiceId, lineId, user, companyId);
  if (!context.vendorId) return [];
  const trimmed = query.trim();
  const filters = [
    eq(vendorItems.vendorId, context.vendorId),
    eq(vendors.companyId, companyId),
    eq(inventoryItems.companyId, companyId),
    eq(vendorItems.active, 1),
    eq(inventoryItems.active, 1),
  ];
  if (trimmed) {
    const pattern = `%${trimmed.replace(/[%_]/g, '\\$&')}%`;
    filters.push(or(
      ilike(inventoryItems.name, pattern),
      ilike(vendorItems.vendorSku, pattern),
      ilike(vendorItems.brandName, pattern),
    )!);
  }
  return db
    .select({
      vendorItemId: vendorItems.id,
      inventoryItemId: inventoryItems.id,
      inventoryItemName: inventoryItems.name,
      vendorSku: vendorItems.vendorSku,
      brandName: vendorItems.brandName,
      caseSize: vendorItems.caseSize,
      innerPackSize: vendorItems.innerPackSize,
      packUom: vendorItems.packUom,
    })
    .from(vendorItems)
    .innerJoin(vendors, eq(vendors.id, vendorItems.vendorId))
    .innerJoin(inventoryItems, eq(inventoryItems.id, vendorItems.inventoryItemId))
    .where(and(...filters))
    .orderBy(inventoryItems.name, vendorItems.vendorSku, vendorItems.id)
    .limit(50);
}

export async function confirmHistoricalInvoiceLineResolution(
  invoiceId: string,
  lineId: string,
  input: { vendorItemId?: unknown; confirm?: unknown },
  user: User,
  companyId: string,
) {
  const vendorItemId = typeof input.vendorItemId === 'string' ? input.vendorItemId.trim() : '';
  if (!vendorItemId || input.confirm !== true) {
    throw new HistoricalInvoiceResolutionError(
      'INVALID_REQUEST',
      'Select a vendor product and explicitly confirm the resolution.',
    );
  }
  const authorization = await authorizeLine(invoiceId, lineId, user, companyId);
  return db.transaction(async (tx: any) => {
    const context = await readLineContext(tx, invoiceId, lineId, companyId);
    if (!context || !authorization.accessibleStoreIds.includes(context.storeId)) {
      throw new HistoricalInvoiceResolutionError('NOT_FOUND', 'Invoice line not found.');
    }
    const lockKey = [
      context.companyId,
      context.sourceSystem,
      context.sourcePropertyId,
      context.vendorId ?? '',
      context.sourceExternalId ?? '',
    ].join('|');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const decision = await classify(
      tx,
      context,
      authorization.accessibleStoreIds,
      vendorItemId,
    );
    if (
      decision.classification !== 'SAFE_CANDIDATE' ||
      !decision.canonicalVendorItem ||
      decision.canonicalVendorItem.id !== vendorItemId
    ) {
      throw new HistoricalInvoiceResolutionError(
        'CONFLICT',
        decision.reasons.join(' ') || 'This source identity is not safe to resolve.',
      );
    }
    const canonical = decision.canonicalVendorItem;
    const alreadyMapped =
      decision.mappedInventoryItemIds.length === 1 &&
      decision.mappedInventoryItemIds[0] === canonical.inventoryItemId &&
      decision.mappedVendorItemIds.length === 1 &&
      decision.mappedVendorItemIds[0] === canonical.id;
    const affectedOccurrenceCount = alreadyMapped
      ? 0
      : decision.occurrences.filter(row =>
          row.resolutionStatus === 'unresolved' &&
          row.inventoryItemId == null &&
          row.vendorItemId == null
        ).length;

    await tx.insert(inventoryItemExternalMappings).values({
      companyId,
      inventoryItemId: canonical.inventoryItemId,
      sourceSystem: context.sourceSystem,
      sourcePropertyId: context.sourcePropertyId,
      sourceExternalId: context.sourceExternalId!,
      sourceDescription: context.productNameSnapshot,
      matchStrategy: 'manual_historical_resolution',
      confidenceScore: 1,
      confirmedAt: new Date(),
      confirmedBy: user.id,
    }).onConflictDoNothing();
    await tx.insert(vendorItemExternalMappings).values({
      companyId,
      vendorItemId: canonical.id,
      sourceSystem: context.sourceSystem,
      sourcePropertyId: context.sourcePropertyId,
      sourceExternalId: context.sourceExternalId!,
      sourceDescription: context.productNameSnapshot,
      matchStrategy: 'manual_historical_resolution',
      confidenceScore: 1,
      confirmedAt: new Date(),
      confirmedBy: user.id,
    }).onConflictDoNothing();

    const [inventoryMapping] = await tx
      .select({ inventoryItemId: inventoryItemExternalMappings.inventoryItemId })
      .from(inventoryItemExternalMappings)
      .where(and(
        eq(inventoryItemExternalMappings.companyId, companyId),
        eq(inventoryItemExternalMappings.sourceSystem, context.sourceSystem),
        eq(inventoryItemExternalMappings.sourcePropertyId, context.sourcePropertyId),
        eq(inventoryItemExternalMappings.sourceExternalId, context.sourceExternalId!),
      ))
      .limit(1);
    const [vendorMapping] = await tx
      .select({ vendorItemId: vendorItemExternalMappings.vendorItemId })
      .from(vendorItemExternalMappings)
      .where(and(
        eq(vendorItemExternalMappings.companyId, companyId),
        eq(vendorItemExternalMappings.sourceSystem, context.sourceSystem),
        eq(vendorItemExternalMappings.sourcePropertyId, context.sourcePropertyId),
        eq(vendorItemExternalMappings.sourceExternalId, context.sourceExternalId!),
      ))
      .limit(1);
    if (
      inventoryMapping?.inventoryItemId !== canonical.inventoryItemId ||
      vendorMapping?.vendorItemId !== canonical.id
    ) {
      throw new HistoricalInvoiceResolutionError(
        'CONFLICT',
        'A competing mapping was created for this source identity. Reassignment requires a separate review.',
      );
    }

    return {
      status: 'resolved' as const,
      vendorItemId: canonical.id,
      inventoryItemId: canonical.inventoryItemId,
      // Historical rows are protected by a database immutability trigger. The
      // durable source mappings project this resolution at read time instead of
      // rewriting evidence or relationship columns on those rows.
      affectedOccurrenceCount,
      occurrenceCount: decision.occurrences.length,
    };
  });
}