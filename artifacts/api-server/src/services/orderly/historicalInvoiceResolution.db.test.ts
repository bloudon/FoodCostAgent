import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  companies,
  companyStores,
  historicalInvoiceLines,
  historicalInvoices,
  inventoryItemExternalMappings,
  inventoryItems,
  units,
  users,
  vendorInvoiceImportBatches,
  vendorInvoiceImportLines,
  vendorItemExternalMappings,
  vendorItems,
  vendors,
} from '@workspace/db';
import { db } from '../../db';
import {
  confirmHistoricalInvoiceLineResolution,
  HistoricalInvoiceResolutionError,
  previewHistoricalInvoiceLineResolution,
  searchHistoricalInvoiceResolutionCandidates,
} from './historicalInvoiceResolution';
import { getImportedInvoiceDetail } from './importedInvoiceRead';
import { runVendorInvoiceResolutionPreview } from './vendorInvoiceImport';

const SFX = `hir-${Date.now().toString(36)}`;
const COMPANY = `hir-company-${SFX}`;
const OTHER_COMPANY = `hir-other-company-${SFX}`;
const STORE = `hir-store-${SFX}`;
const OTHER_STORE = `hir-other-store-${SFX}`;
const USER = `hir-user-${SFX}`;
const SCOPED_USER = `hir-scoped-user-${SFX}`;
const VENDOR = `hir-vendor-${SFX}`;
const OTHER_VENDOR = `hir-other-vendor-${SFX}`;
const UNIT = `hir-unit-${SFX}`;
const ITEM_A = `hir-item-a-${SFX}`;
const ITEM_B = `hir-item-b-${SFX}`;
const OTHER_ITEM = `hir-other-item-${SFX}`;
const VENDOR_ITEM_A = `hir-vi-a-${SFX}`;
const VENDOR_ITEM_B = `hir-vi-b-${SFX}`;
const OTHER_VENDOR_ITEM = `hir-other-vi-${SFX}`;
const BATCH = `hir-batch-${SFX}`;
const FUTURE_BATCH = `hir-future-batch-${SFX}`;
const PROPERTY = `hir-property-${SFX}`;
const CODE = `HIR-CODE-${SFX}`;
const CONFLICT_CODE = `HIR-CONFLICT-${SFX}`;
const PACK_CONFLICT_CODE = `HIR-PACK-${SFX}`;
let invoiceA = '';
let invoiceB = '';
let lineA = '';
let lineB = '';
let conflictLine = '';
let packConflictLine = '';

const ADMIN = {
  id: USER,
  email: `${USER}@test.local`,
  role: 'company_admin',
  companyId: COMPANY,
  active: 1,
} as any;
const USER_WITHOUT_STORE_ACCESS = {
  id: SCOPED_USER,
  email: `${SCOPED_USER}@test.local`,
  role: 'store_user',
  companyId: COMPANY,
  active: 1,
} as any;

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;

async function cleanup() {
  await db.delete(vendorItemExternalMappings).where(inArray(vendorItemExternalMappings.companyId, [COMPANY, OTHER_COMPANY])).catch(() => {});
  await db.delete(inventoryItemExternalMappings).where(inArray(inventoryItemExternalMappings.companyId, [COMPANY, OTHER_COMPANY])).catch(() => {});
  await db.delete(historicalInvoiceLines).where(inArray(historicalInvoiceLines.companyId, [COMPANY, OTHER_COMPANY])).catch(() => {});
  await db.delete(historicalInvoices).where(inArray(historicalInvoices.companyId, [COMPANY, OTHER_COMPANY])).catch(() => {});
  await db.delete(vendorInvoiceImportLines).where(inArray(vendorInvoiceImportLines.batchId, [BATCH, FUTURE_BATCH])).catch(() => {});
  await db.delete(vendorInvoiceImportBatches).where(inArray(vendorInvoiceImportBatches.companyId, [COMPANY, OTHER_COMPANY])).catch(() => {});
  await db.delete(vendorItems).where(inArray(vendorItems.id, [VENDOR_ITEM_A, VENDOR_ITEM_B, OTHER_VENDOR_ITEM])).catch(() => {});
  await db.delete(inventoryItems).where(inArray(inventoryItems.companyId, [COMPANY, OTHER_COMPANY])).catch(() => {});
  await db.delete(vendors).where(inArray(vendors.companyId, [COMPANY, OTHER_COMPANY])).catch(() => {});
  await db.delete(users).where(inArray(users.id, [USER, SCOPED_USER])).catch(() => {});
  await db.delete(companyStores).where(inArray(companyStores.companyId, [COMPANY, OTHER_COMPANY])).catch(() => {});
  await db.delete(companies).where(inArray(companies.id, [COMPANY, OTHER_COMPANY])).catch(() => {});
  await db.delete(units).where(eq(units.id, UNIT)).catch(() => {});
}

beforeAll(async () => {
  if (SKIP) return;
  await cleanup();
  await db.insert(companies).values([
    { id: COMPANY, name: `Resolution Company ${SFX}`, country: 'US', timezone: 'America/New_York', preferredUnitSystem: 'imperial', costingMethod: 'last_cost', status: 'active' },
    { id: OTHER_COMPANY, name: `Other Company ${SFX}`, country: 'US', timezone: 'America/New_York', preferredUnitSystem: 'imperial', costingMethod: 'last_cost', status: 'active' },
  ]);
  await db.insert(companyStores).values([
    { id: STORE, companyId: COMPANY, code: `HRA-${SFX}`.slice(0, 12), name: 'Resolution Store', status: 'active' },
    { id: OTHER_STORE, companyId: OTHER_COMPANY, code: `HRB-${SFX}`.slice(0, 12), name: 'Other Store', status: 'active' },
  ]);
  await db.insert(users).values([
    {
      id: USER,
      email: `${USER}@test.local`,
      role: 'company_admin',
      companyId: COMPANY,
      active: 1,
    },
    {
      id: SCOPED_USER,
      email: `${SCOPED_USER}@test.local`,
      role: 'store_user',
      companyId: COMPANY,
      active: 1,
    },
  ]);
  await db.insert(units).values({
    id: UNIT,
    name: `Each ${SFX}`,
    abbreviation: `ea-${SFX}`,
    kind: 'count',
    toBaseRatio: 1,
    system: 'both',
  });
  await db.insert(vendors).values([
    { id: VENDOR, companyId: COMPANY, name: `Resolution Vendor ${SFX}`, orderGuideType: 'manual', active: 1, receiveByUnit: 0, requires1099: 0 },
    { id: OTHER_VENDOR, companyId: OTHER_COMPANY, name: `Other Vendor ${SFX}`, orderGuideType: 'manual', active: 1, receiveByUnit: 0, requires1099: 0 },
  ]);
  await db.insert(inventoryItems).values([
    { id: ITEM_A, companyId: COMPANY, name: 'Chicken Breast', unitId: UNIT, caseSize: 24 },
    { id: ITEM_B, companyId: COMPANY, name: 'Chicken Thigh', unitId: UNIT, caseSize: 24 },
    { id: OTHER_ITEM, companyId: OTHER_COMPANY, name: 'Other Tenant Chicken', unitId: UNIT, caseSize: 24 },
  ]);
  await db.insert(vendorItems).values([
    {
      id: VENDOR_ITEM_A,
      vendorId: VENDOR,
      inventoryItemId: ITEM_A,
      vendorSku: 'CATALOG-SKU',
      purchaseUnitId: UNIT,
      caseSize: 6,
      innerPackSize: 4,
      packUom: 'oz',
      canonicalQtyPerPurchaseUnit: 24,
      packGeometryStatus: 'verified',
    },
    {
      id: VENDOR_ITEM_B,
      vendorId: VENDOR,
      inventoryItemId: ITEM_B,
      vendorSku: 'ALT-SKU',
      purchaseUnitId: UNIT,
      caseSize: 6,
      innerPackSize: 4,
      packUom: 'oz',
      canonicalQtyPerPurchaseUnit: 24,
      packGeometryStatus: 'verified',
    },
    {
      id: OTHER_VENDOR_ITEM,
      vendorId: OTHER_VENDOR,
      inventoryItemId: OTHER_ITEM,
      vendorSku: CODE,
      purchaseUnitId: UNIT,
      caseSize: 6,
      innerPackSize: 4,
      packUom: 'oz',
      canonicalQtyPerPurchaseUnit: 24,
      packGeometryStatus: 'verified',
    },
  ]);
  await db.insert(vendorInvoiceImportBatches).values({
    id: BATCH,
    companyId: COMPANY,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: PROPERTY,
    sourcePropertyBindingId: `binding-${SFX}`,
    destinationStoreId: STORE,
    fileHash: `hash-${SFX}`,
    originalFilename: `resolution-${SFX}.xlsx`,
    parserVersion: '1.0',
    resolvedVendorId: VENDOR,
    invoiceCount: 2,
    lineCount: 4,
    totalAmount: 100,
    invoiceTotals: [],
    status: 'approved',
    approvedAt: new Date(),
    approvedBy: USER,
  });
  const invoices = await db.insert(historicalInvoices).values([
    {
      companyId: COMPANY,
      storeId: STORE,
      vendorId: VENDOR,
      importBatchId: BATCH,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: PROPERTY,
      sourceInvoiceId: `source-a-${SFX}`,
      invoiceNumber: 'INV-A',
      invoiceDate: '2026-05-01',
      invoicePeriod: '2026-05',
      vendorNameSnapshot: 'Resolution Vendor',
      totalAmount: 40,
      sourceSnapshot: { immutable: 'invoice-a' },
      materialHash: `invoice-hash-a-${SFX}`,
    },
    {
      companyId: COMPANY,
      storeId: STORE,
      vendorId: VENDOR,
      importBatchId: BATCH,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: PROPERTY,
      sourceInvoiceId: `source-b-${SFX}`,
      invoiceNumber: 'INV-B',
      invoiceDate: '2026-06-01',
      invoicePeriod: '2026-06',
      vendorNameSnapshot: 'Resolution Vendor',
      totalAmount: 60,
      sourceSnapshot: { immutable: 'invoice-b' },
      materialHash: `invoice-hash-b-${SFX}`,
    },
  ]).returning({ id: historicalInvoices.id });
  [invoiceA, invoiceB] = invoices.map(row => row.id);

  const lines = await db.insert(historicalInvoiceLines).values([
    {
      companyId: COMPANY,
      invoiceId: invoiceA,
      sourceLineId: 'line-a',
      resolutionStatus: 'unresolved',
      productNameSnapshot: 'Chicken Breast',
      sourceExternalId: CODE,
      quantity: 2,
      unitPrice: 10,
      lineTotal: 20,
      packSnapshot: { raw: '6/4 OZ' },
      catchWeightSnapshot: {},
      glSnapshot: { glCode: '5010', category: 'Meat' },
      financialSnapshot: { source: 'immutable-a' },
      sourceSnapshot: { source: 'immutable-a' },
      materialHash: `line-hash-a-${SFX}`,
    },
    {
      companyId: COMPANY,
      invoiceId: invoiceB,
      sourceLineId: 'line-b',
      resolutionStatus: 'unresolved',
      productNameSnapshot: 'Chicken Breast',
      sourceExternalId: CODE,
      quantity: 1,
      unitPrice: 20,
      lineTotal: 20,
      packSnapshot: { raw: '6/4 OZ' },
      catchWeightSnapshot: {},
      glSnapshot: { glCode: '5010', category: 'Meat' },
      financialSnapshot: { source: 'immutable-b' },
      sourceSnapshot: { source: 'immutable-b' },
      materialHash: `line-hash-b-${SFX}`,
    },
    {
      companyId: COMPANY,
      invoiceId: invoiceA,
      sourceLineId: 'line-conflict',
      resolutionStatus: 'unresolved',
      productNameSnapshot: 'Chicken Breast',
      sourceExternalId: CONFLICT_CODE,
      quantity: 1,
      unitPrice: 15,
      lineTotal: 15,
      packSnapshot: { raw: '6/4 OZ' },
      catchWeightSnapshot: {},
      glSnapshot: {},
      financialSnapshot: {},
      sourceSnapshot: { source: 'conflict' },
      materialHash: `line-hash-conflict-${SFX}`,
    },
    {
      companyId: COMPANY,
      invoiceId: invoiceA,
      sourceLineId: 'line-pack-conflict',
      resolutionStatus: 'unresolved',
      productNameSnapshot: 'Chicken Breast',
      sourceExternalId: PACK_CONFLICT_CODE,
      quantity: 1,
      unitPrice: 25,
      lineTotal: 25,
      packSnapshot: { raw: '12/4 OZ' },
      catchWeightSnapshot: {},
      glSnapshot: {},
      financialSnapshot: {},
      sourceSnapshot: { source: 'pack-conflict' },
      materialHash: `line-hash-pack-${SFX}`,
    },
  ]).returning({ id: historicalInvoiceLines.id });
  [lineA, lineB, conflictLine, packConflictLine] = lines.map(row => row.id);
  await db.insert(inventoryItemExternalMappings).values({
    companyId: COMPANY,
    inventoryItemId: ITEM_B,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: PROPERTY,
    sourceExternalId: CONFLICT_CODE,
    matchStrategy: 'manual',
  });
});

afterAll(async () => {
  if (SKIP) return;
  await cleanup();
});

describe.skipIf(SKIP)('historical invoice resolution', () => {
  it('previews source evidence, impact, and only same-vendor company candidates', async () => {
    const preview = await previewHistoricalInvoiceLineResolution(
      invoiceA,
      lineA,
      VENDOR_ITEM_A,
      ADMIN,
      COMPANY,
    );
    expect(preview.classification?.status).toBe('SAFE_CANDIDATE');
    expect(preview.classification?.canConfirm).toBe(true);
    expect(preview.impact).toMatchObject({
      occurrenceCount: 2,
      affectedOccurrenceCount: 2,
      spend: 40,
      dateRangeStart: '2026-05-01',
      dateRangeEnd: '2026-06-01',
    });
    expect(preview.line).toMatchObject({
      description: 'Chicken Breast',
      itemCode: CODE,
      sourceGlCode: '5010',
      sourceCategory: 'Meat',
    });

    const candidates = await searchHistoricalInvoiceResolutionCandidates(
      invoiceA,
      lineA,
      'Chicken',
      ADMIN,
      COMPANY,
    );
    expect(candidates.map(row => row.vendorItemId)).toEqual(
      expect.arrayContaining([VENDOR_ITEM_A, VENDOR_ITEM_B]),
    );
    expect(candidates.map(row => row.vendorItemId)).not.toContain(OTHER_VENDOR_ITEM);
  });

  it('creates both durable mappings, synchronously propagates, and is idempotent without changing source evidence', async () => {
    const before = await db
      .select({
        id: historicalInvoiceLines.id,
        sourceSnapshot: historicalInvoiceLines.sourceSnapshot,
        packSnapshot: historicalInvoiceLines.packSnapshot,
        glSnapshot: historicalInvoiceLines.glSnapshot,
        quantity: historicalInvoiceLines.quantity,
        unitPrice: historicalInvoiceLines.unitPrice,
        lineTotal: historicalInvoiceLines.lineTotal,
        materialHash: historicalInvoiceLines.materialHash,
      })
      .from(historicalInvoiceLines)
      .where(inArray(historicalInvoiceLines.id, [lineA, lineB]))
      .orderBy(historicalInvoiceLines.id);

    const result = await confirmHistoricalInvoiceLineResolution(
      invoiceA,
      lineA,
      { vendorItemId: VENDOR_ITEM_A, confirm: true },
      ADMIN,
      COMPANY,
    );
    expect(result).toMatchObject({
      status: 'resolved',
      inventoryItemId: ITEM_A,
      vendorItemId: VENDOR_ITEM_A,
      affectedOccurrenceCount: 2,
      occurrenceCount: 2,
    });

    const retainedRows = await db
      .select()
      .from(historicalInvoiceLines)
      .where(inArray(historicalInvoiceLines.id, [lineA, lineB]));
    expect(retainedRows).toHaveLength(2);
    expect(retainedRows.every(row =>
      row.resolutionStatus === 'unresolved' &&
      row.inventoryItemId == null &&
      row.vendorItemId == null
    )).toBe(true);

    const after = await db
      .select({
        id: historicalInvoiceLines.id,
        sourceSnapshot: historicalInvoiceLines.sourceSnapshot,
        packSnapshot: historicalInvoiceLines.packSnapshot,
        glSnapshot: historicalInvoiceLines.glSnapshot,
        quantity: historicalInvoiceLines.quantity,
        unitPrice: historicalInvoiceLines.unitPrice,
        lineTotal: historicalInvoiceLines.lineTotal,
        materialHash: historicalInvoiceLines.materialHash,
      })
      .from(historicalInvoiceLines)
      .where(inArray(historicalInvoiceLines.id, [lineA, lineB]))
      .orderBy(historicalInvoiceLines.id);
    expect(after).toEqual(before);

    const inventoryMappings = await db.select().from(inventoryItemExternalMappings).where(and(
      eq(inventoryItemExternalMappings.companyId, COMPANY),
      eq(inventoryItemExternalMappings.sourcePropertyId, PROPERTY),
      eq(inventoryItemExternalMappings.sourceExternalId, CODE),
    ));
    const vendorMappings = await db.select().from(vendorItemExternalMappings).where(and(
      eq(vendorItemExternalMappings.companyId, COMPANY),
      eq(vendorItemExternalMappings.sourcePropertyId, PROPERTY),
      eq(vendorItemExternalMappings.sourceExternalId, CODE),
    ));
    expect(inventoryMappings).toHaveLength(1);
    expect(inventoryMappings[0].inventoryItemId).toBe(ITEM_A);
    expect(vendorMappings).toHaveLength(1);
    expect(vendorMappings[0].vendorItemId).toBe(VENDOR_ITEM_A);

    const projectedDetail = await getImportedInvoiceDetail(invoiceA, ADMIN, COMPANY);
    const projectedLine = projectedDetail?.lines.find(line => line.id === lineA);
    expect(projectedLine).toMatchObject({
      resolutionStatus: 'resolved',
      resolvedInventoryItemId: ITEM_A,
      resolvedInventoryItemName: 'Chicken Breast',
    });

    await db.insert(vendorInvoiceImportBatches).values({
      id: FUTURE_BATCH,
      companyId: COMPANY,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: PROPERTY,
      sourcePropertyBindingId: `binding-${SFX}`,
      destinationStoreId: STORE,
      fileHash: `future-hash-${SFX}`,
      originalFilename: `future-resolution-${SFX}.xlsx`,
      parserVersion: '1.0',
      vendorNameDetected: `Resolution Vendor ${SFX}`,
      resolvedVendorId: VENDOR,
      invoiceCount: 1,
      lineCount: 1,
      totalAmount: 30,
      invoiceTotals: [{
        invoiceNumber: `FUTURE-${SFX}`,
        invoiceDate: '2026-07-01',
        amount: 30,
      }],
      status: 'pending_review',
      uploadedBy: USER,
    });
    await db.insert(vendorInvoiceImportLines).values({
      batchId: FUTURE_BATCH,
      rowIndex: 1,
      invoiceNumber: `FUTURE-${SFX}`,
      invoiceDate: '2026-07-01',
      itemCode: CODE,
      description: 'Chicken Breast',
      packSizeRaw: '6/4 OZ',
      qty: 1,
      extendedAmount: 30,
      category: 'Meat',
      glCode: '5010',
      rawData: { source: 'future-invoice' },
    });
    const futurePreview = await runVendorInvoiceResolutionPreview(FUTURE_BATCH, COMPANY);
    expect(futurePreview.lines).toHaveLength(1);
    expect(futurePreview.lines[0]).toMatchObject({
      status: 'resolved',
      holdReason: null,
      matchStrategy: 'external_mapping',
      vendorItemId: VENDOR_ITEM_A,
      inventoryItemId: ITEM_A,
    });

    const rerun = await confirmHistoricalInvoiceLineResolution(
      invoiceA,
      lineA,
      { vendorItemId: VENDOR_ITEM_A, confirm: true },
      ADMIN,
      COMPANY,
    );
    expect(rerun.affectedOccurrenceCount).toBe(0);
    expect(rerun.occurrenceCount).toBe(2);
  });

  it('fails closed on a competing mapping without changing it', async () => {
    await expect(confirmHistoricalInvoiceLineResolution(
      invoiceA,
      conflictLine,
      { vendorItemId: VENDOR_ITEM_A, confirm: true },
      ADMIN,
      COMPANY,
    )).rejects.toMatchObject<Partial<HistoricalInvoiceResolutionError>>({
      code: 'CONFLICT',
    });
    const [mapping] = await db.select().from(inventoryItemExternalMappings).where(and(
      eq(inventoryItemExternalMappings.companyId, COMPANY),
      eq(inventoryItemExternalMappings.sourcePropertyId, PROPERTY),
      eq(inventoryItemExternalMappings.sourceExternalId, CONFLICT_CODE),
    ));
    expect(mapping.inventoryItemId).toBe(ITEM_B);
  });

  it('fails closed on source pack conflict and cross-company candidate ids', async () => {
    await expect(confirmHistoricalInvoiceLineResolution(
      invoiceA,
      packConflictLine,
      { vendorItemId: VENDOR_ITEM_A, confirm: true },
      ADMIN,
      COMPANY,
    )).rejects.toMatchObject<Partial<HistoricalInvoiceResolutionError>>({
      code: 'CONFLICT',
    });
    await expect(confirmHistoricalInvoiceLineResolution(
      invoiceA,
      packConflictLine,
      { vendorItemId: OTHER_VENDOR_ITEM, confirm: true },
      ADMIN,
      COMPANY,
    )).rejects.toMatchObject<Partial<HistoricalInvoiceResolutionError>>({
      code: 'CONFLICT',
    });
  });

  it('returns the same not-found error when the caller lacks store access', async () => {
    await expect(previewHistoricalInvoiceLineResolution(
      invoiceA,
      lineA,
      VENDOR_ITEM_A,
      USER_WITHOUT_STORE_ACCESS,
      COMPANY,
    )).rejects.toMatchObject<Partial<HistoricalInvoiceResolutionError>>({
      code: 'NOT_FOUND',
      message: 'Invoice line not found.',
    });
  });
});