import { and, count, eq } from 'drizzle-orm';
import {
  historicalInvoiceLines,
  historicalInvoices,
  companyStores,
  importSourcePropertyBindings,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItemPriceHistory,
  inventoryItems,
  vendorInvoiceImportBatches,
  vendorItemExternalMappings,
  vendorItems,
  vendors,
} from '@workspace/db';
import { db } from '../../db';
import {
  classifyOrderlyVendorProductAdoption,
  normalizeOrderlyRestaurantSpecs,
  type AdoptionClassifierSnapshot,
  type AdoptionClassifierSummary,
  type NormalizedPackSizeEntry,
  type SnapshotApprovedSourceItemEvidence,
  type SnapshotVendorItemRow,
  type SnapshotVendorRow,
} from './orderlyVendorProductAdoptionClassifier';
import { crossCheckPackSize, parsePackSize } from './vendorInvoiceXlsx';

export const BAY_HILL_ORDERLY_SOURCE_SYSTEM = 'ORDERLY';
export const BAY_HILL_ORDERLY_PROPERTY_ID = '24472';

type Runner = typeof db | any;

export class OrderlyVendorProductAdoptionPreviewError extends Error {
  constructor(
    public readonly code:
      | 'BINDING_NOT_FOUND'
      | 'BINDING_AMBIGUOUS'
      | 'SOURCE_VENDOR_CONFLICT'
      | 'BINDING_STORE_INVALID'
      | 'CATALOG_MUTATED'
      | 'PM_APPLY_HELD',
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'OrderlyVendorProductAdoptionPreviewError';
  }
}

export interface CatalogFingerprint {
  inventoryItemCount: number;
  vendorItemCount: number;
  vendorItemMappingCount: number;
  priceHistoryCount: number;
}

interface ApprovedImportEvidence {
  inventoryItemId: string;
  sourceItemCode: string | null;
  supplierRaw: string | null;
  caseQuantity: number | null;
  innerPackQuantity: number | null;
  baseUnit: string | null;
}

export interface HarvillHistoricalLine {
  lineId: string;
  sourceExternalId: string | null;
  lineTotal: number | null;
  resolutionStatus: string;
  inventoryItemId: string | null;
  vendorItemId: string | null;
  packSnapshot: unknown;
}

export interface HarvillResidualClass {
  reason: string;
  sourceCodeCount: number;
  lineCount: number;
  dollars: number;
  sourceCodes: string[];
}

export interface HarvillAdoptionMetrics {
  vendorId: string | null;
  totalHistoricalLines: number;
  totalHistoricalDollars: number;
  unresolvedLinesBefore: number;
  unresolvedDistinctCodesBefore: number;
  unresolvedDollarsBefore: number;
  catalogResolvableLinesBefore: number;
  catalogResolvableDollarsBefore: number;
  catalogResolvableLinesAfter: number;
  catalogResolvableDollarsAfter: number;
  overallLineMatchRateBefore: number;
  overallLineMatchRateAfter: number;
  newlyResolvableDistinctCodes: number;
  newlyResolvableLines: number;
  newlyResolvableDollars: number;
  residualDistinctCodes: number;
  residuals: HarvillResidualClass[];
}

export interface OrderlyVendorProductAdoptionPreviewReport {
  mode: 'read-only';
  sourceSystem: 'ORDERLY';
  sourcePropertyId: string;
  companyId: string;
  destinationStoreId: string;
  bindingId: string;
  approvedBatchCount: number;
  approvedCanonicalItemCount: number;
  geometryEvidenceConflictCount: number;
  classifier: AdoptionClassifierSummary;
  harvill: HarvillAdoptionMetrics;
  mutationCheck: {
    before: CatalogFingerprint;
    after: CatalogFingerprint;
    unchanged: boolean;
  };
  applyGate: {
    status: 'PM_HELD';
    writesExecuted: 0;
  };
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeSku(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeGeometryUom(value: string | null | undefined): string {
  const normalized = normalizeName(value);
  const aliases: Record<string, string> = {
    pound: 'lb',
    pounds: 'lb',
    lbs: 'lb',
    ounce: 'oz',
    ounces: 'oz',
    each: 'ea',
    piece: 'ea',
    pieces: 'ea',
    gallon: 'gal',
    gallons: 'gal',
    quart: 'qt',
    quarts: 'qt',
    pint: 'pt',
    pints: 'pt',
  };
  return aliases[normalized] ?? normalized;
}

function finitePositive(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function geometrySignature(row: ApprovedImportEvidence): string | null {
  const outer = finitePositive(row.caseQuantity);
  const inner = finitePositive(row.innerPackQuantity);
  const uom = normalizeGeometryUom(row.baseUnit);
  if (outer == null || inner == null || !uom) return null;
  return `${outer}|${inner}|${uom}`;
}

function sourceSupplierNames(entries: readonly NormalizedPackSizeEntry[]): Map<string, string> {
  const namesById = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.supplierId || !entry.supplierName) continue;
    const names = namesById.get(entry.supplierId) ?? new Set<string>();
    names.add(normalizeName(entry.supplierName));
    namesById.set(entry.supplierId, names);
  }
  const result = new Map<string, string>();
  for (const [supplierId, names] of namesById) {
    if (names.size !== 1) {
      throw new OrderlyVendorProductAdoptionPreviewError(
        'SOURCE_VENDOR_CONFLICT',
        `Orderly supplier "${supplierId}" carries ${names.size} normalized names.`,
      );
    }
    result.set(supplierId, [...names][0]);
  }
  return result;
}

async function readCatalogFingerprint(
  runner: Runner,
  companyId: string,
): Promise<CatalogFingerprint> {
  const [inventoryCount, vendorItemCount, mappingCount, priceCount] = await Promise.all([
    runner
      .select({ value: count() })
      .from(inventoryItems)
      .where(eq(inventoryItems.companyId, companyId)),
    runner
      .select({ value: count() })
      .from(vendorItems)
      .innerJoin(vendors, and(
        eq(vendors.id, vendorItems.vendorId),
        eq(vendors.companyId, companyId),
      )),
    runner
      .select({ value: count() })
      .from(vendorItemExternalMappings)
      .where(eq(vendorItemExternalMappings.companyId, companyId)),
    runner
      .select({ value: count() })
      .from(inventoryItemPriceHistory)
      .innerJoin(inventoryItems, and(
        eq(inventoryItems.id, inventoryItemPriceHistory.inventoryItemId),
        eq(inventoryItems.companyId, companyId),
      )),
  ]);
  return {
    inventoryItemCount: Number(inventoryCount[0]?.value ?? 0),
    vendorItemCount: Number(vendorItemCount[0]?.value ?? 0),
    vendorItemMappingCount: Number(mappingCount[0]?.value ?? 0),
    priceHistoryCount: Number(priceCount[0]?.value ?? 0),
  };
}

function fingerprintsEqual(a: CatalogFingerprint, b: CatalogFingerprint): boolean {
  return a.inventoryItemCount === b.inventoryItemCount
    && a.vendorItemCount === b.vendorItemCount
    && a.vendorItemMappingCount === b.vendorItemMappingCount
    && a.priceHistoryCount === b.priceHistoryCount;
}

function packRaw(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const raw = (snapshot as Record<string, unknown>).raw;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function rate(matched: number, total: number): number {
  return total === 0 ? 0 : Math.round((matched / total) * 10000) / 100;
}

function candidateMatchesPack(
  line: HarvillHistoricalLine,
  candidate: { caseSize: number | null; innerPackSize: number | null; packUom: string | null },
): boolean {
  const raw = packRaw(line.packSnapshot);
  if (!raw) return true;
  return crossCheckPackSize(parsePackSize(raw), candidate) !== 'conflict';
}

export function projectHarvillAdoptionMetrics(input: {
  lines: readonly HarvillHistoricalLine[];
  harvillVendorId: string | null;
  snapshot: AdoptionClassifierSnapshot;
  classifier: AdoptionClassifierSummary;
}): HarvillAdoptionMetrics {
  const lines = [...input.lines];
  const unresolved = lines.filter(line =>
    line.resolutionStatus === 'unresolved'
    && line.inventoryItemId == null
    && line.vendorItemId == null,
  );
  const existingBySku = new Map<string, SnapshotVendorItemRow[]>();
  if (input.harvillVendorId) {
    for (const item of input.snapshot.vendorItems) {
      if (item.vendorId !== input.harvillVendorId || item.active === 0) continue;
      const key = normalizeSku(item.vendorSku);
      const rows = existingBySku.get(key) ?? [];
      rows.push(item);
      existingBySku.set(key, rows);
    }
  }

  const projectedBySku = new Map<string, AdoptionClassifierSummary['relationships']>();
  for (const relationship of input.classifier.relationships) {
    if (relationship.resolvedVendorId !== input.harvillVendorId) continue;
    const key = normalizeSku(relationship.entry.resolvedSku);
    const rows = projectedBySku.get(key) ?? [];
    rows.push(relationship);
    projectedBySku.set(key, rows);
  }

  function beforeMatch(line: HarvillHistoricalLine): boolean {
    const code = normalizeSku(line.sourceExternalId);
    if (!code) return false;
    const candidates = (existingBySku.get(code) ?? [])
      .filter(candidate => candidateMatchesPack(line, candidate));
    const inventoryIds = new Set(candidates.map(candidate => candidate.inventoryItemId));
    return candidates.length > 0 && inventoryIds.size === 1;
  }

  function afterDecision(line: HarvillHistoricalLine): { matched: boolean; reason: string } {
    if (beforeMatch(line)) return { matched: true, reason: 'already_catalog_resolvable' };
    const code = normalizeSku(line.sourceExternalId);
    if (!code) return { matched: false, reason: 'missing_source_code' };
    const relationships = projectedBySku.get(code) ?? [];
    if (relationships.length === 0) return { matched: false, reason: 'no_authoritative_orderly_relationship' };
    const safe = relationships.filter(relationship =>
      relationship.classification === 'safe_new_vendor_product'
      || relationship.classification === 'safe_same_vendor_alternate_product'
      || relationship.classification === 'mapping_only_gap'
      || relationship.classification === 'already_present',
    );
    if (safe.length === 0) {
      const classes = [...new Set(relationships.map(row => row.classification))].sort();
      return { matched: false, reason: `adoption_held:${classes.join('+')}` };
    }
    const canonicalIds = new Set(safe.map(row => row.inferredCanonicalItemId).filter(Boolean));
    if (canonicalIds.size !== 1) return { matched: false, reason: 'ambiguous_canonical_inventory_identity' };
    const packMatches = safe.filter(row => candidateMatchesPack(line, {
      caseSize: row.entry.normalizedPackGeometry.outerCount,
      innerPackSize: row.entry.normalizedPackGeometry.innerSize,
      packUom: row.entry.normalizedPackGeometry.normalizedUom,
    }));
    if (packMatches.length === 0) return { matched: false, reason: 'invoice_pack_conflict' };
    return { matched: true, reason: 'projected_catalog_resolvable' };
  }

  const beforeMatched = unresolved.filter(beforeMatch);
  const afterDecisions = unresolved.map(line => ({ line, ...afterDecision(line) }));
  const afterMatched = afterDecisions.filter(row => row.matched).map(row => row.line);
  const newlyMatched = afterMatched.filter(line => !beforeMatch(line));
  const resolvedHistorical = lines.filter(line => line.resolutionStatus === 'resolved');
  const historicalResolvedDollars = resolvedHistorical.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);

  const residualMap = new Map<string, HarvillHistoricalLine[]>();
  for (const decision of afterDecisions) {
    if (decision.matched) continue;
    const rows = residualMap.get(decision.reason) ?? [];
    rows.push(decision.line);
    residualMap.set(decision.reason, rows);
  }
  const residuals = [...residualMap.entries()]
    .map(([reason, rows]) => ({
      reason,
      sourceCodeCount: new Set(rows.map(row => row.sourceExternalId).filter(Boolean)).size,
      lineCount: rows.length,
      dollars: roundMoney(rows.reduce((sum, row) => sum + (row.lineTotal ?? 0), 0)),
      sourceCodes: [...new Set(rows.map(row => row.sourceExternalId).filter((v): v is string => Boolean(v)))].sort(),
    }))
    .sort((a, b) => b.lineCount - a.lineCount || a.reason.localeCompare(b.reason));

  const beforeOverallMatched = resolvedHistorical.length + beforeMatched.length;
  const afterOverallMatched = resolvedHistorical.length + afterMatched.length;
  return {
    vendorId: input.harvillVendorId,
    totalHistoricalLines: lines.length,
    totalHistoricalDollars: roundMoney(lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)),
    unresolvedLinesBefore: unresolved.length,
    unresolvedDistinctCodesBefore: new Set(unresolved.map(line => line.sourceExternalId).filter(Boolean)).size,
    unresolvedDollarsBefore: roundMoney(unresolved.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)),
    catalogResolvableLinesBefore: beforeOverallMatched,
    catalogResolvableDollarsBefore: roundMoney(
      historicalResolvedDollars + beforeMatched.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0),
    ),
    catalogResolvableLinesAfter: afterOverallMatched,
    catalogResolvableDollarsAfter: roundMoney(
      historicalResolvedDollars + afterMatched.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0),
    ),
    overallLineMatchRateBefore: rate(beforeOverallMatched, lines.length),
    overallLineMatchRateAfter: rate(afterOverallMatched, lines.length),
    newlyResolvableDistinctCodes: new Set(newlyMatched.map(line => line.sourceExternalId).filter(Boolean)).size,
    newlyResolvableLines: newlyMatched.length,
    newlyResolvableDollars: roundMoney(newlyMatched.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)),
    residualDistinctCodes: new Set(
      afterDecisions.filter(row => !row.matched).map(row => row.line.sourceExternalId).filter(Boolean),
    ).size,
    residuals,
  };
}

async function loadPreviewInputs(
  runner: Runner,
  entries: readonly NormalizedPackSizeEntry[],
): Promise<{
  binding: {
    id: string;
    companyId: string;
    destinationStoreId: string;
  };
  approvedBatchCount: number;
  geometryEvidenceConflictCount: number;
  snapshot: AdoptionClassifierSnapshot;
  harvillLines: HarvillHistoricalLine[];
  harvillVendorId: string | null;
}> {
  const bindings = await runner
    .select({
      id: importSourcePropertyBindings.id,
      companyId: importSourcePropertyBindings.companyId,
      destinationStoreId: importSourcePropertyBindings.destinationStoreId,
    })
    .from(importSourcePropertyBindings)
    .where(and(
      eq(importSourcePropertyBindings.sourceSystem, BAY_HILL_ORDERLY_SOURCE_SYSTEM),
      eq(importSourcePropertyBindings.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
      eq(importSourcePropertyBindings.active, 1),
    ));
  if (bindings.length === 0) {
    throw new OrderlyVendorProductAdoptionPreviewError(
      'BINDING_NOT_FOUND',
      'The active Bay Hill Orderly source-property binding was not found.',
    );
  }
  if (bindings.length !== 1) {
    throw new OrderlyVendorProductAdoptionPreviewError(
      'BINDING_AMBIGUOUS',
      `Expected one active Bay Hill binding, found ${bindings.length}.`,
    );
  }
  const binding = bindings[0];
  const boundStores = await runner
    .select({ id: companyStores.id })
    .from(companyStores)
    .where(and(
      eq(companyStores.id, binding.destinationStoreId),
      eq(companyStores.companyId, binding.companyId),
      eq(companyStores.status, 'active'),
    ));
  if (boundStores.length !== 1) {
    throw new OrderlyVendorProductAdoptionPreviewError(
      'BINDING_STORE_INVALID',
      'The active Bay Hill binding destination store is not an active store in the bound company.',
    );
  }

  const [approvedBatches, localVendors, existingVendorItems, mappings, approvedEvidence] = await Promise.all([
    runner
      .select({ id: inventoryImportBatches.id })
      .from(inventoryImportBatches)
      .where(and(
        eq(inventoryImportBatches.companyId, binding.companyId),
        eq(inventoryImportBatches.sourceSystem, BAY_HILL_ORDERLY_SOURCE_SYSTEM),
        eq(inventoryImportBatches.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
        eq(inventoryImportBatches.status, 'approved'),
        eq(inventoryImportBatches.sourcePropertyBindingId, binding.id),
      )),
    runner
      .select({
        id: vendors.id,
        companyId: vendors.companyId,
        name: vendors.name,
        active: vendors.active,
      })
      .from(vendors)
      .where(eq(vendors.companyId, binding.companyId)),
    runner
      .select({
        vendorItemId: vendorItems.id,
        vendorId: vendorItems.vendorId,
        companyId: vendors.companyId,
        inventoryItemId: vendorItems.inventoryItemId,
        vendorSku: vendorItems.vendorSku,
        caseSize: vendorItems.caseSize,
        innerPackSize: vendorItems.innerPackSize,
        packUom: vendorItems.packUom,
        active: vendorItems.active,
        purchaseUnitId: vendorItems.purchaseUnitId,
        canonicalQtyPerPurchaseUnit: vendorItems.canonicalQtyPerPurchaseUnit,
        pricingBasis: vendorItems.pricingBasis,
        isVariableWeight: vendorItems.isVariableWeight,
      })
      .from(vendorItems)
      .innerJoin(vendors, and(
        eq(vendors.id, vendorItems.vendorId),
        eq(vendors.companyId, binding.companyId),
      ))
      .innerJoin(inventoryItems, and(
        eq(inventoryItems.id, vendorItems.inventoryItemId),
        eq(inventoryItems.companyId, binding.companyId),
      )),
    runner
      .select({
        vendorItemId: vendorItemExternalMappings.vendorItemId,
        sourceSystem: vendorItemExternalMappings.sourceSystem,
        sourcePropertyId: vendorItemExternalMappings.sourcePropertyId,
        sourceExternalId: vendorItemExternalMappings.sourceExternalId,
      })
      .from(vendorItemExternalMappings)
      .where(and(
        eq(vendorItemExternalMappings.companyId, binding.companyId),
        eq(vendorItemExternalMappings.sourceSystem, BAY_HILL_ORDERLY_SOURCE_SYSTEM),
        eq(vendorItemExternalMappings.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
      )),
    runner
      .select({
        inventoryItemId: inventoryImportRows.resolvedInventoryItemId,
        sourceItemCode: inventoryImportRows.sourceItemCode,
        supplierRaw: inventoryImportRows.supplierRaw,
        caseQuantity: inventoryImportRows.caseQuantity,
        innerPackQuantity: inventoryImportRows.innerPackQuantity,
        baseUnit: inventoryImportRows.baseUnit,
      })
      .from(inventoryImportRows)
      .innerJoin(inventoryImportBatches, and(
        eq(inventoryImportBatches.id, inventoryImportRows.batchId),
        eq(inventoryImportBatches.companyId, binding.companyId),
        eq(inventoryImportBatches.sourceSystem, BAY_HILL_ORDERLY_SOURCE_SYSTEM),
        eq(inventoryImportBatches.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
        eq(inventoryImportBatches.status, 'approved'),
        eq(inventoryImportBatches.sourcePropertyBindingId, binding.id),
      )),
  ]);

  const supplierNames = sourceSupplierNames(entries);
  const localVendorsByName = new Map<string, typeof localVendors>();
  for (const vendor of localVendors) {
    const key = normalizeName(vendor.name);
    const rows = localVendorsByName.get(key) ?? [];
    rows.push(vendor);
    localVendorsByName.set(key, rows);
  }
  const snapshotVendors: SnapshotVendorRow[] = [];
  for (const [supplierId, sourceName] of supplierNames) {
    const candidates = (localVendorsByName.get(sourceName) ?? []).filter((row: any) => row.active === 1);
    if (candidates.length === 1) {
      snapshotVendors.push({
        vendorId: candidates[0].id,
        companyId: binding.companyId,
        supplierExternalId: supplierId,
        vendorName: candidates[0].name,
      });
    }
  }

  const localVendorIdByName = new Map<string, string | null>();
  for (const [name, rows] of localVendorsByName) {
    const activeRows = rows.filter((row: any) => row.active === 1);
    localVendorIdByName.set(name, activeRows.length === 1 ? activeRows[0].id : null);
  }

  const evidenceByIdentity = new Map<string, ApprovedImportEvidence[]>();
  const approvedCanonicalIds = new Set<string>();
  for (const row of approvedEvidence as ApprovedImportEvidence[]) {
    if (!row.inventoryItemId) continue;
    approvedCanonicalIds.add(row.inventoryItemId);
    const vendorId = row.supplierRaw
      ? localVendorIdByName.get(normalizeName(row.supplierRaw)) ?? null
      : null;
    const sku = normalizeSku(row.sourceItemCode);
    if (!vendorId || !sku) continue;
    const key = `${vendorId}|${row.inventoryItemId}|${sku}`;
    const rows = evidenceByIdentity.get(key) ?? [];
    rows.push(row);
    evidenceByIdentity.set(key, rows);
  }

  const approvedSourceItemEvidence: SnapshotApprovedSourceItemEvidence[] = [];
  const geometryConflictKeys = new Set<string>();
  for (const [key, evidence] of evidenceByIdentity) {
    const signatures = new Map<string, ApprovedImportEvidence>();
    for (const candidate of evidence) {
      const signature = geometrySignature(candidate);
      if (signature) signatures.set(signature, candidate);
    }
    if (signatures.size > 1) {
      geometryConflictKeys.add(key);
      continue;
    }
    if (signatures.size !== 1) continue;
    const [vendorId, inventoryItemId, normalizedSku] = key.split('|');
    const geometry = [...signatures.values()][0];
    approvedSourceItemEvidence.push({
      vendorId,
      companyId: binding.companyId,
      inventoryItemId,
      normalizedSku,
      caseSize: geometry.caseQuantity!,
      innerPackSize: geometry.innerPackQuantity!,
      packUom: geometry.baseUnit!,
    });
  }

  const geometryEvidenceConflictCount = geometryConflictKeys.size;
  const snapshotVendorItems: SnapshotVendorItemRow[] = existingVendorItems.map((row: any) => {
    const key = `${row.vendorId}|${row.inventoryItemId}|${normalizeSku(row.vendorSku)}`;
    const evidence = evidenceByIdentity.get(key) ?? [];
    const signatures = new Map<string, ApprovedImportEvidence>();
    for (const candidate of evidence) {
      const signature = geometrySignature(candidate);
      if (signature) signatures.set(signature, candidate);
    }
    const approvedGeometry = signatures.size === 1 ? [...signatures.values()][0] : null;
    return {
      vendorItemId: row.vendorItemId,
      vendorId: row.vendorId,
      companyId: row.companyId,
      inventoryItemId: row.inventoryItemId,
      vendorSku: row.vendorSku,
      normalizedSku: normalizeSku(row.vendorSku) || null,
      // Geometry is authoritative only when one approved source identity proves
      // it. Mutable vendor_items fields never fill a gap in the preview.
      caseSize: approvedGeometry?.caseQuantity ?? null,
      innerPackSize: approvedGeometry?.innerPackQuantity ?? null,
      packUom: approvedGeometry?.baseUnit ?? null,
      active: row.active,
    };
  });

  const snapshot: AdoptionClassifierSnapshot = {
    companyId: binding.companyId,
    sourceSystem: BAY_HILL_ORDERLY_SOURCE_SYSTEM,
    sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
    vendors: snapshotVendors,
    approvedCanonicalItemIds: [...approvedCanonicalIds].map(inventoryItemId => ({
      inventoryItemId,
      companyId: binding.companyId,
    })),
    vendorItems: snapshotVendorItems,
    approvedSourceItemEvidence,
    vendorItemExternalMappings: mappings.map((row: any) => ({
      ...row,
      identityKind: row.sourceExternalId.startsWith('fallback|') ? 'fallback' as const : 'packSizeId' as const,
    })),
    purchaseUnitEvidence: existingVendorItems.map((row: any) => ({
      vendorItemId: row.vendorItemId,
      purchaseUnitId: row.purchaseUnitId,
      canonicalQtyPerPurchaseUnit: row.canonicalQtyPerPurchaseUnit,
      pricingBasis: row.pricingBasis,
      isVariableWeight: row.isVariableWeight,
    })),
  };

  const harvillVendor = localVendors.find((row: any) =>
    row.active === 1 && normalizeName(row.name).includes('harvill'),
  ) ?? null;
  const harvillLines = harvillVendor
    ? await runner
        .select({
          lineId: historicalInvoiceLines.id,
          sourceExternalId: historicalInvoiceLines.sourceExternalId,
          lineTotal: historicalInvoiceLines.lineTotal,
          resolutionStatus: historicalInvoiceLines.resolutionStatus,
          inventoryItemId: historicalInvoiceLines.inventoryItemId,
          vendorItemId: historicalInvoiceLines.vendorItemId,
          packSnapshot: historicalInvoiceLines.packSnapshot,
        })
        .from(historicalInvoiceLines)
        .innerJoin(historicalInvoices, and(
          eq(historicalInvoices.id, historicalInvoiceLines.invoiceId),
          eq(historicalInvoices.companyId, historicalInvoiceLines.companyId),
          eq(historicalInvoices.companyId, binding.companyId),
          eq(historicalInvoices.storeId, binding.destinationStoreId),
          eq(historicalInvoices.sourceSystem, BAY_HILL_ORDERLY_SOURCE_SYSTEM),
          eq(historicalInvoices.sourcePropertyId, BAY_HILL_ORDERLY_PROPERTY_ID),
          eq(historicalInvoices.vendorId, harvillVendor.id),
        ))
        .innerJoin(vendorInvoiceImportBatches, and(
          eq(vendorInvoiceImportBatches.id, historicalInvoices.importBatchId),
          eq(vendorInvoiceImportBatches.companyId, historicalInvoices.companyId),
          eq(vendorInvoiceImportBatches.status, 'approved'),
        ))
    : [];

  return {
    binding,
    approvedBatchCount: approvedBatches.length,
    geometryEvidenceConflictCount,
    snapshot,
    harvillLines,
    harvillVendorId: harvillVendor?.id ?? null,
  };
}

export async function previewOrderlyVendorProductAdoption(
  rawSpecs: readonly unknown[],
  runner: Runner = db,
): Promise<OrderlyVendorProductAdoptionPreviewReport> {
  const entries = normalizeOrderlyRestaurantSpecs(
    rawSpecs,
    BAY_HILL_ORDERLY_PROPERTY_ID,
    { requireSupplier: true, requireSku: true, requireRawGeometry: true },
  );
  const inputs = await loadPreviewInputs(runner, entries);
  const before = await readCatalogFingerprint(runner, inputs.binding.companyId);
  const classifier = classifyOrderlyVendorProductAdoption(entries, inputs.snapshot, {
    expectedCompanyId: inputs.binding.companyId,
    expectedPropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
  });
  const harvill = projectHarvillAdoptionMetrics({
    lines: inputs.harvillLines,
    harvillVendorId: inputs.harvillVendorId,
    snapshot: inputs.snapshot,
    classifier,
  });
  const after = await readCatalogFingerprint(runner, inputs.binding.companyId);
  const unchanged = fingerprintsEqual(before, after);
  if (!unchanged) {
    throw new OrderlyVendorProductAdoptionPreviewError(
      'CATALOG_MUTATED',
      'Catalog table counts changed while producing the read-only preview.',
    );
  }
  return {
    mode: 'read-only',
    sourceSystem: BAY_HILL_ORDERLY_SOURCE_SYSTEM,
    sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
    companyId: inputs.binding.companyId,
    destinationStoreId: inputs.binding.destinationStoreId,
    bindingId: inputs.binding.id,
    approvedBatchCount: inputs.approvedBatchCount,
    approvedCanonicalItemCount: inputs.snapshot.approvedCanonicalItemIds.length,
    geometryEvidenceConflictCount: inputs.geometryEvidenceConflictCount,
    classifier,
    harvill,
    mutationCheck: { before, after, unchanged },
    applyGate: { status: 'PM_HELD', writesExecuted: 0 },
  };
}

/**
 * The write path is deliberately hard-gated until PM reviews the bounded Dev
 * preview. Keeping this exported makes the gate explicit to every caller while
 * guaranteeing that no catalog mutation can occur in the current revision.
 */
export async function applyOrderlyVendorProductAdoption(): Promise<never> {
  throw new OrderlyVendorProductAdoptionPreviewError(
    'PM_APPLY_HELD',
    'Orderly vendor-product adoption APPLY is held pending PM review of the read-only preview.',
  );
}