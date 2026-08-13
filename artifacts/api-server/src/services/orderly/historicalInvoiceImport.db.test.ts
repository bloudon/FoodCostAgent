/**
 * DB-backed tests for the Bay Hill historical invoice retention contract.
 *
 * These call the REAL shared service against a live database. The historical
 * import must:
 *   - accept only the approved ORDERLY source property (24472) bound to a store
 *   - enforce the 12 complete calendar months before the cutover date
 *   - be idempotent for identical repeats, and surface material changes as
 *     conflicts without overwriting the stored source evidence
 *   - retain unresolved lines with their original source values
 *   - never create purchase orders, receipts, or AP/QuickBooks records
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  users,
  userStores,
  companies as companiesTable,
  companyStores,
  importSourcePropertyBindings,
  inventoryItems,
  purchaseOrders,
  receipts,
  qbReconciliations,
  units,
  vendors,
  vendorItems,
  vendorItemExternalMappings,
  historicalInvoiceImportBatches,
  historicalInvoiceImportConflicts,
  historicalInvoiceLines,
  historicalInvoices,
} from '@workspace/db';
import { db } from '../../db';
import {
  BAY_HILL_ORDERLY_PROPERTY_ID,
  HistoricalInvoiceImportError,
  getHistoricalInvoiceCompleteness,
  listHistoricalInvoices,
  stageHistoricalInvoiceImport,
} from './historicalInvoiceImport';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = Date.now().toString(36);

const ID = {
  companyA: `hii-coA-${RUN}`,
  companyB: `hii-coB-${RUN}`,
  storeBayHill: `hii-bayhill-${RUN}`,
  storeOther: `hii-other-${RUN}`,
  storeCompanyB: `hii-cob-store-${RUN}`,
  adminA: `hii-adminA-${RUN}`,
  adminB: `hii-adminB-${RUN}`,
  scopedUser: `hii-scoped-${RUN}`,
  inactiveUser: `hii-inactive-${RUN}`,
  bindingBayHill: `hii-bind-bh-${RUN}`,
  vendor: `hii-vendor-${RUN}`,
  invItem: `hii-item-${RUN}`,
  vendorItem: `hii-vi-${RUN}`,
  unit: `hii-unit-${RUN}`,
  mapping: `hii-map-${RUN}`,
  foreignVendor: `hii-vendor-b-${RUN}`,
  foreignInvItem: `hii-item-b-${RUN}`,
  foreignVendorItem: `hii-vi-b-${RUN}`,
};

const CUTOVER = '2026-08-13';
/** Window for an Aug 2026 cutover = 2025-08-01 .. 2026-07-31. */
const IN_WINDOW_DATE = '2026-03-04';
const KNOWN_PACK_SIZE_ID = `packsize-known-${RUN}`;
const UNKNOWN_PACK_SIZE_ID = `packsize-unknown-${RUN}`;

const AUTH_A = { actingUserId: ID.adminA, companyId: ID.companyA };

let invoiceSeq = 0;
function payload(overrides: Record<string, unknown> = {}) {
  const sourceInvoiceId = (overrides.sourceInvoiceId as string) ?? `INV-${RUN}-${invoiceSeq++}`;
  return {
    sourceSystem: 'ORDERLY',
    sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
    cutoverDate: CUTOVER,
    invoices: [
      {
        sourceInvoiceId,
        invoiceNumber: `#${sourceInvoiceId}`,
        invoiceDate: (overrides.invoiceDate as string) ?? IN_WINDOW_DATE,
        vendorName: `HII Vendor ${RUN}`,
        vendorExternalId: 'ORD-VEND-1',
        subtotal: 100,
        taxAmount: 7,
        chargeAmount: 3,
        creditAmount: 5,
        totalAmount: (overrides.totalAmount as number) ?? 105,
        source: { raw: 'orderly-fixture' },
        lines: [
          {
            sourceLineId: 'L1',
            packSizeId: KNOWN_PACK_SIZE_ID,
            productName: 'Heavy Cream 12/32 OZ',
            quantity: 2,
            unitPrice: 25,
            lineTotal: 50,
            creditAmount: 0,
            pack: { packSize: '12/32 OZ', caseQty: 12 },
            catchWeight: { isCatchWeight: false },
            gl: { glCode: '5010', glName: 'Dairy' },
            financial: { extendedPrice: 50 },
            source: { orderlyLineRef: 'l-1' },
          },
          {
            sourceLineId: 'L2',
            packSizeId: UNKNOWN_PACK_SIZE_ID,
            productName: 'Unmatched Mystery Item',
            quantity: 1,
            unitPrice: 50,
            lineTotal: 50,
            creditAmount: 0,
            pack: { packSize: '1 CS' },
            catchWeight: { isCatchWeight: true, weight: 18.4 },
            gl: {},
            financial: { extendedPrice: 50 },
            source: { orderlyLineRef: 'l-2' },
          },
        ],
      },
    ],
    ...('cutoverDate' in overrides ? { cutoverDate: overrides.cutoverDate as string } : {}),
  };
}

beforeAll(async () => {
  if (SKIP) return;

  await db.insert(companiesTable).values([
    { id: ID.companyA, name: `HII Co A ${RUN}` },
    { id: ID.companyB, name: `HII Co B ${RUN}` },
  ]);
  await db.insert(companyStores).values([
    { id: ID.storeBayHill, companyId: ID.companyA, code: `BH${RUN}`.slice(0, 10), name: 'Bay Hill', status: 'active' },
    { id: ID.storeOther, companyId: ID.companyA, code: `OT${RUN}`.slice(0, 10), name: 'Other', status: 'active' },
    { id: ID.storeCompanyB, companyId: ID.companyB, code: `CB${RUN}`.slice(0, 10), name: 'Co B', status: 'active' },
  ]);
  await db.insert(users).values([
    { id: ID.adminA, email: `hii-admina-${RUN}@test.local`, role: 'company_admin', companyId: ID.companyA, active: 1 },
    { id: ID.adminB, email: `hii-adminb-${RUN}@test.local`, role: 'company_admin', companyId: ID.companyB, active: 1 },
    { id: ID.scopedUser, email: `hii-scoped-${RUN}@test.local`, role: 'store_user', companyId: ID.companyA, active: 1 },
    { id: ID.inactiveUser, email: `hii-inactive-${RUN}@test.local`, role: 'company_admin', companyId: ID.companyA, active: 0 },
  ]);
  await db.insert(userStores).values([{ userId: ID.scopedUser, storeId: ID.storeOther }]);
  await db.insert(importSourcePropertyBindings).values([
    {
      id: ID.bindingBayHill,
      companyId: ID.companyA,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
      sourcePropertyLabel: 'Bay Hill',
      destinationStoreId: ID.storeBayHill,
      active: 1,
    },
  ]);

  // Vendor item reachable through the generic source-key mapping.
  await db.insert(vendors).values({ id: ID.vendor, companyId: ID.companyA, name: `HII Vendor ${RUN}`, active: 1 });
  await db.insert(units).values({
    id: ID.unit, name: `hii-case-${RUN}`, abbreviation: 'CS', kind: 'count', toBaseRatio: 1, system: 'both',
  });
  await db.insert(inventoryItems).values({
    id: ID.invItem, companyId: ID.companyA, name: `HII Cream ${RUN}`, unitId: ID.unit, active: 1,
  });
  await db.insert(vendorItems).values({
    id: ID.vendorItem, vendorId: ID.vendor, inventoryItemId: ID.invItem, purchaseUnitId: ID.unit,
    lastPrice: 1.5, lastCasePrice: 18, priceSource: 'manual', active: 1,
  });
  // Company B vendor item — the cross-tenant guard target.
  await db.insert(vendors).values({ id: ID.foreignVendor, companyId: ID.companyB, name: `HII Vendor B ${RUN}`, active: 1 });
  await db.insert(inventoryItems).values({
    id: ID.foreignInvItem, companyId: ID.companyB, name: `HII Foreign ${RUN}`, unitId: ID.unit, active: 1,
  });
  await db.insert(vendorItems).values({
    id: ID.foreignVendorItem, vendorId: ID.foreignVendor, inventoryItemId: ID.foreignInvItem,
    purchaseUnitId: ID.unit, lastPrice: 2, lastCasePrice: 24, active: 1,
  });
  await db.insert(vendorItemExternalMappings).values({
    id: ID.mapping,
    companyId: ID.companyA,
    vendorItemId: ID.vendorItem,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
    sourceExternalId: KNOWN_PACK_SIZE_ID,
    sourceDescription: 'Heavy Cream 12/32 OZ',
    matchStrategy: 'source_key',
  });
});

afterAll(async () => {
  if (SKIP) return;
  const companyIds = [ID.companyA, ID.companyB];
  await db.delete(historicalInvoiceLines).where(inArray(historicalInvoiceLines.companyId, companyIds)).catch(() => {});
  await db.delete(historicalInvoiceImportConflicts).where(inArray(historicalInvoiceImportConflicts.companyId, companyIds)).catch(() => {});
  await db.delete(historicalInvoices).where(inArray(historicalInvoices.companyId, companyIds)).catch(() => {});
  await db.delete(historicalInvoiceImportBatches).where(inArray(historicalInvoiceImportBatches.companyId, companyIds)).catch(() => {});
  await db.delete(vendorItemExternalMappings).where(inArray(vendorItemExternalMappings.companyId, companyIds)).catch(() => {});
  await db.delete(vendorItems).where(inArray(vendorItems.id, [ID.vendorItem, ID.foreignVendorItem])).catch(() => {});
  await db.delete(inventoryItems).where(inArray(inventoryItems.companyId, companyIds)).catch(() => {});
  await db.delete(units).where(eq(units.id, ID.unit)).catch(() => {});
  await db.delete(vendors).where(inArray(vendors.companyId, companyIds)).catch(() => {});
  await db.delete(importSourcePropertyBindings).where(inArray(importSourcePropertyBindings.companyId, companyIds)).catch(() => {});
  await db.delete(userStores).where(eq(userStores.userId, ID.scopedUser)).catch(() => {});
  await db.delete(users).where(inArray(users.id, [ID.adminA, ID.adminB, ID.scopedUser, ID.inactiveUser])).catch(() => {});
  await db.delete(companyStores).where(inArray(companyStores.companyId, companyIds)).catch(() => {});
  await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds)).catch(() => {});
});

async function linesFor(sourceInvoiceId: string) {
  const [invoice] = await db.select().from(historicalInvoices).where(and(
    eq(historicalInvoices.companyId, ID.companyA),
    eq(historicalInvoices.sourceInvoiceId, sourceInvoiceId),
  ));
  const lines = invoice
    ? await db.select().from(historicalInvoiceLines).where(eq(historicalInvoiceLines.invoiceId, invoice.id))
    : [];
  return { invoice, lines: lines as Array<Record<string, any>> };
}

describe.skipIf(SKIP)('historical invoice retention — persistence contract', () => {
  it('stores immutable headers and lines scoped to the bound Bay Hill store', async () => {
    const body = payload();
    const sourceInvoiceId = body.invoices[0].sourceInvoiceId;

    const result = await stageHistoricalInvoiceImport(body, AUTH_A);
    expect(result.status).toBe('completed');
    expect(result.window).toEqual({ start: '2025-08-01', end: '2026-07-31' });

    const { invoice, lines } = await linesFor(sourceInvoiceId);
    expect(invoice?.storeId).toBe(ID.storeBayHill);
    expect(invoice?.sourcePropertyId).toBe(BAY_HILL_ORDERLY_PROPERTY_ID);
    expect(invoice?.invoicePeriod).toBe('2026-03');
    expect(invoice?.vendorId).toBe(ID.vendor);
    expect(invoice?.taxAmount).toBe(7);
    expect(invoice?.creditAmount).toBe(5);
    expect(lines).toHaveLength(2);

    const known = lines.find(l => l.sourceLineId === 'L1')!;
    expect(known.resolutionStatus).toBe('resolved');
    expect(known.vendorItemId).toBe(ID.vendorItem);
    expect(known.inventoryItemId).toBe(ID.invItem);
    expect(known.glSnapshot).toMatchObject({ glCode: '5010' });
    expect(known.packSnapshot).toMatchObject({ caseQty: 12 });

    // Unresolved lines keep their source values instead of being discarded.
    const unknown = lines.find(l => l.sourceLineId === 'L2')!;
    expect(unknown.resolutionStatus).toBe('unresolved');
    expect(unknown.vendorItemId).toBeNull();
    expect(unknown.productNameSnapshot).toBe('Unmatched Mystery Item');
    expect(unknown.sourceExternalId).toBe(UNKNOWN_PACK_SIZE_ID);
    expect(unknown.catchWeightSnapshot).toMatchObject({ isCatchWeight: true, weight: 18.4 });
  });

  it('rejects UPDATEs to stored headers and lines at the database level', async () => {
    const body = payload();
    const sourceInvoiceId = body.invoices[0].sourceInvoiceId;
    await stageHistoricalInvoiceImport(body, AUTH_A);
    const { invoice, lines } = await linesFor(sourceInvoiceId);

    // Drizzle wraps the driver error, so assert on the underlying cause.
    const causeOf = async (op: Promise<unknown>) => {
      try {
        await op;
        return null;
      } catch (err: any) {
        return String(err?.cause?.message ?? err?.message ?? err);
      }
    };
    expect(await causeOf(
      db.update(historicalInvoices).set({ totalAmount: 1 }).where(eq(historicalInvoices.id, invoice!.id)),
    )).toMatch(/immutable/i);
    expect(await causeOf(
      db.update(historicalInvoiceLines).set({ unitPrice: 1 }).where(eq(historicalInvoiceLines.id, lines[0].id)),
    )).toMatch(/immutable/i);

    const after = await linesFor(sourceInvoiceId);
    expect(after.invoice?.totalAmount).toBe(invoice?.totalAmount);
  });

  it('does not update current vendor price provenance', async () => {
    const [vi] = await db.select().from(vendorItems).where(eq(vendorItems.id, ID.vendorItem));
    expect(vi?.lastCasePrice).toBe(18);
    expect(vi?.priceSource).toBe('manual');
  });

  it('creates no purchase orders, receipts, or QuickBooks reconciliations', async () => {
    const [pos, recs, qb] = await Promise.all([
      db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.companyId, ID.companyA)),
      db.select({ id: receipts.id }).from(receipts).where(eq(receipts.companyId, ID.companyA)),
      db.select({ id: qbReconciliations.id }).from(qbReconciliations).where(eq(qbReconciliations.companyId, ID.companyA)),
    ]);
    expect(pos).toHaveLength(0);
    expect(recs).toHaveLength(0);
    expect(qb).toHaveLength(0);
  });
});

describe.skipIf(SKIP)('historical invoice retention — idempotency and conflicts', () => {
  it('treats an identical re-import as a no-op', async () => {
    const body = payload();
    const sourceInvoiceId = body.invoices[0].sourceInvoiceId;

    await stageHistoricalInvoiceImport(body, AUTH_A);
    const first = await linesFor(sourceInvoiceId);

    const repeat = await stageHistoricalInvoiceImport(body, AUTH_A);
    expect(repeat.skipped).toBe(1);
    expect(repeat.conflicts).toBe(0);

    const second = await linesFor(sourceInvoiceId);
    expect(second.invoice?.id).toBe(first.invoice?.id);
    expect(second.lines).toHaveLength(first.lines.length);

    const all = await db.select({ id: historicalInvoices.id }).from(historicalInvoices).where(and(
      eq(historicalInvoices.companyId, ID.companyA),
      eq(historicalInvoices.sourceInvoiceId, sourceInvoiceId),
    ));
    expect(all).toHaveLength(1);
  });

  it('records a line_changed conflict when only a line differs', async () => {
    const body = payload();
    const sourceInvoiceId = body.invoices[0].sourceInvoiceId;
    await stageHistoricalInvoiceImport(body, AUTH_A);
    const before = await linesFor(sourceInvoiceId);

    // Same header totals, different line price — must not be silently skipped.
    const changed = payload({ sourceInvoiceId });
    changed.invoices[0].lines[0].unitPrice = 99;
    const result = await stageHistoricalInvoiceImport(changed, AUTH_A);
    expect(result.conflicts).toBe(1);
    expect(result.skipped).toBe(0);

    const conflicts = await db.select().from(historicalInvoiceImportConflicts).where(and(
      eq(historicalInvoiceImportConflicts.companyId, ID.companyA),
      eq(historicalInvoiceImportConflicts.sourceInvoiceId, sourceInvoiceId),
    ));
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0] as any).conflictType).toBe('line_changed');

    // Stored line evidence is untouched.
    const after = await linesFor(sourceInvoiceId);
    const storedLine = after.lines.find(l => l.sourceLineId === 'L1')!;
    expect(storedLine.unitPrice).toBe(before.lines.find(l => l.sourceLineId === 'L1')!.unitPrice);
  });

  it('records a line_missing conflict when a re-import drops a stored line', async () => {
    const body = payload();
    const sourceInvoiceId = body.invoices[0].sourceInvoiceId;
    await stageHistoricalInvoiceImport(body, AUTH_A);

    const shrunk = payload({ sourceInvoiceId });
    shrunk.invoices[0].lines = [shrunk.invoices[0].lines[0]];
    const result = await stageHistoricalInvoiceImport(shrunk, AUTH_A);
    expect(result.conflicts).toBe(1);
    expect(result.skipped).toBe(0);

    const conflicts = await db.select().from(historicalInvoiceImportConflicts).where(and(
      eq(historicalInvoiceImportConflicts.companyId, ID.companyA),
      eq(historicalInvoiceImportConflicts.sourceInvoiceId, sourceInvoiceId),
    ));
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0] as any).conflictType).toBe('line_missing');

    // The dropped line is still retained as evidence.
    const { lines } = await linesFor(sourceInvoiceId);
    expect(lines).toHaveLength(2);
  });

  it('records a line_changed conflict when a re-import adds a new line', async () => {
    const body = payload();
    const sourceInvoiceId = body.invoices[0].sourceInvoiceId;
    await stageHistoricalInvoiceImport(body, AUTH_A);

    const grown = payload({ sourceInvoiceId });
    grown.invoices[0].lines.push({ ...grown.invoices[0].lines[0], sourceLineId: 'L3' });
    const result = await stageHistoricalInvoiceImport(grown, AUTH_A);
    expect(result.conflicts).toBe(1);

    const conflicts = await db.select().from(historicalInvoiceImportConflicts).where(and(
      eq(historicalInvoiceImportConflicts.companyId, ID.companyA),
      eq(historicalInvoiceImportConflicts.sourceInvoiceId, sourceInvoiceId),
    ));
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0] as any).conflictType).toBe('line_changed');
    expect((conflicts[0] as any).incomingSnapshot).toMatchObject({ sourceLineId: 'L3' });
  });

  it('surfaces materially changed source data as a conflict without overwriting evidence', async () => {
    const body = payload();
    const sourceInvoiceId = body.invoices[0].sourceInvoiceId;
    await stageHistoricalInvoiceImport(body, AUTH_A);
    const before = await linesFor(sourceInvoiceId);

    const changed = payload({ sourceInvoiceId, totalAmount: 999 });
    const result = await stageHistoricalInvoiceImport(changed, AUTH_A);
    expect(result.conflicts).toBe(1);
    expect(result.status).toBe('completed_with_conflicts');

    const after = await linesFor(sourceInvoiceId);
    expect(after.invoice?.totalAmount).toBe(before.invoice?.totalAmount);
    expect(after.invoice?.materialHash).toBe(before.invoice?.materialHash);

    const conflicts = await db.select().from(historicalInvoiceImportConflicts).where(and(
      eq(historicalInvoiceImportConflicts.companyId, ID.companyA),
      eq(historicalInvoiceImportConflicts.sourceInvoiceId, sourceInvoiceId),
    ));
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0] as any).conflictType).toBe('invoice_changed');
  });
});

describe.skipIf(SKIP)('historical invoice retention — date window', () => {
  it('rejects an invoice older than the 12 complete calendar months', async () => {
    await expect(
      stageHistoricalInvoiceImport(payload({ invoiceDate: '2025-07-31' }), AUTH_A),
    ).rejects.toThrow(/outside the required 12-month window/i);
  });

  it('rejects an invoice on or after the cutover month', async () => {
    await expect(
      stageHistoricalInvoiceImport(payload({ invoiceDate: '2026-08-01' }), AUTH_A),
    ).rejects.toThrow(/outside the required 12-month window/i);
  });

  it('accepts both boundary dates of the window', async () => {
    await expect(stageHistoricalInvoiceImport(payload({ invoiceDate: '2025-08-01' }), AUTH_A)).resolves.toBeTruthy();
    await expect(stageHistoricalInvoiceImport(payload({ invoiceDate: '2026-07-31' }), AUTH_A)).resolves.toBeTruthy();
  });
});

describe.skipIf(SKIP)('historical invoice retention — authorization and scoping', () => {
  it('rejects a missing authorization context', async () => {
    await expect(stageHistoricalInvoiceImport(payload(), null)).rejects.toThrow(HistoricalInvoiceImportError);
    await expect(stageHistoricalInvoiceImport(payload(), { actingUserId: '', companyId: ID.companyA })).rejects.toThrow(/acting user/i);
  });

  it('rejects an inactive acting user', async () => {
    await expect(
      stageHistoricalInvoiceImport(payload(), { actingUserId: ID.inactiveUser, companyId: ID.companyA }),
    ).rejects.toThrow(/could not be verified/i);
  });

  it('rejects a user from another company', async () => {
    await expect(
      stageHistoricalInvoiceImport(payload(), { actingUserId: ID.adminB, companyId: ID.companyA }),
    ).rejects.toThrow(/not authorized for this company/i);
  });

  it('rejects a company with no active Bay Hill binding', async () => {
    await expect(
      stageHistoricalInvoiceImport(payload(), { actingUserId: ID.adminB, companyId: ID.companyB }),
    ).rejects.toThrow(/binding is required/i);
  });

  it('rejects a user without access to the bound destination store', async () => {
    await expect(
      stageHistoricalInvoiceImport(payload(), { actingUserId: ID.scopedUser, companyId: ID.companyA }),
    ).rejects.toThrow(/do not have access/i);
  });

  it('rejects an out-of-scope source property such as Latrobe 27417', async () => {
    const latrobe = { ...payload(), sourcePropertyId: '27417' };
    await expect(stageHistoricalInvoiceImport(latrobe, AUTH_A)).rejects.toThrow(HistoricalInvoiceImportError);
  });

  it('never links a line to a vendor item owned by another company', async () => {
    // A corrupted/stale mapping pointing at company B's vendor item must
    // degrade to "unresolved" rather than cross the tenant boundary.
    const foreignKey = `packsize-foreign-${RUN}`;
    const foreignMappingId = `hii-map-foreign-${RUN}`;
    await db.insert(vendorItemExternalMappings).values({
      id: foreignMappingId,
      companyId: ID.companyA,
      vendorItemId: ID.foreignVendorItem,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: BAY_HILL_ORDERLY_PROPERTY_ID,
      sourceExternalId: foreignKey,
      matchStrategy: 'source_key',
    });

    const body = payload();
    const sourceInvoiceId = body.invoices[0].sourceInvoiceId;
    body.invoices[0].lines[1].packSizeId = foreignKey;
    await stageHistoricalInvoiceImport(body, AUTH_A);

    const { lines } = await linesFor(sourceInvoiceId);
    const crossTenant = lines.find(l => l.sourceLineId === 'L2')!;
    expect(crossTenant.resolutionStatus).toBe('unresolved');
    expect(crossTenant.vendorItemId).toBeNull();
    expect(crossTenant.inventoryItemId).toBeNull();

    await db.delete(vendorItemExternalMappings).where(eq(vendorItemExternalMappings.id, foreignMappingId));
  });

  it('excludes other stores from the completeness report', async () => {
    await stageHistoricalInvoiceImport(payload(), AUTH_A);
    const scoped = await getHistoricalInvoiceCompleteness(AUTH_A);

    // Historical lines belonging to a different store in the same company must
    // not contaminate the Bay Hill report.
    const otherInvoiceId = `hii-other-store-inv-${RUN}`;
    await db.insert(historicalInvoices).values({
      id: otherInvoiceId, companyId: ID.companyA, storeId: ID.storeOther, importBatchId: `hii-other-batch-${RUN}`,
      sourceSystem: 'ORDERLY', sourcePropertyId: '27417', sourceInvoiceId: `OTHER-${RUN}`,
      invoiceDate: IN_WINDOW_DATE, invoicePeriod: '2026-03', totalAmount: 500,
      sourceSnapshot: {}, materialHash: 'other-store-hash',
    });
    await db.insert(historicalInvoiceLines).values({
      companyId: ID.companyA, invoiceId: otherInvoiceId, sourceLineId: 'OTHER-L1',
      resolutionStatus: 'resolved', packSnapshot: {}, catchWeightSnapshot: {}, glSnapshot: {},
      financialSnapshot: {}, sourceSnapshot: {}, materialHash: 'other-line-hash',
    });

    const after = await getHistoricalInvoiceCompleteness(AUTH_A);
    expect(after.lineCount).toBe(scoped.lineCount);
    expect(after.invoiceCount).toBe(scoped.invoiceCount);
    expect(after.totalAmount).toBeCloseTo(scoped.totalAmount, 5);

    await db.delete(historicalInvoiceLines).where(eq(historicalInvoiceLines.invoiceId, otherInvoiceId));
    await db.delete(historicalInvoices).where(eq(historicalInvoices.id, otherInvoiceId));
  });

  it('scopes reads to the caller company and bound store', async () => {
    await stageHistoricalInvoiceImport(payload(), AUTH_A);

    const rows = await listHistoricalInvoices(AUTH_A);
    expect(rows.length).toBeGreaterThan(0);
    expect((rows as Array<{ storeId: string; companyId: string }>).every(
      r => r.storeId === ID.storeBayHill && r.companyId === ID.companyA,
    )).toBe(true);

    await expect(listHistoricalInvoices({ actingUserId: ID.adminB, companyId: ID.companyB })).rejects.toThrow(
      HistoricalInvoiceImportError,
    );
  });

  it('excludes other source properties from the invoice read surface', async () => {
    await stageHistoricalInvoiceImport(payload(), AUTH_A);
    const before = await listHistoricalInvoices(AUTH_A);

    // A record from a different source property in the SAME bound store must
    // not leak through the Orderly read surface.
    const foreignId = `hii-foreign-source-inv-${RUN}`;
    await db.insert(historicalInvoices).values({
      id: foreignId, companyId: ID.companyA, storeId: ID.storeBayHill, importBatchId: `hii-foreign-batch-${RUN}`,
      sourceSystem: 'ORDERLY', sourcePropertyId: '27417', sourceInvoiceId: `LATROBE-${RUN}`,
      invoiceDate: IN_WINDOW_DATE, invoicePeriod: '2026-03', totalAmount: 42,
      sourceSnapshot: {}, materialHash: 'foreign-source-hash',
    });

    const after = await listHistoricalInvoices(AUTH_A);
    expect(after).toHaveLength(before.length);
    expect((after as Array<{ id: string }>).some(r => r.id === foreignId)).toBe(false);

    await db.delete(historicalInvoices).where(eq(historicalInvoices.id, foreignId));
  });
});

describe.skipIf(SKIP)('historical invoice retention — completeness evidence', () => {
  it('reports months, totals, resolution, vendor coverage, and missing GL mappings', async () => {
    await stageHistoricalInvoiceImport(payload(), AUTH_A);

    const report = await getHistoricalInvoiceCompleteness(AUTH_A);
    expect(report.invoiceCount).toBeGreaterThan(0);
    expect(report.months).toContain('2026-03');
    expect(report.lineCount).toBe(report.resolvedLines + report.unresolvedLines);
    expect(report.resolvedLines).toBeGreaterThan(0);
    expect(report.unresolvedLines).toBeGreaterThan(0);
    expect(report.sourceKeyCoverage.unresolved).toBe(report.unresolvedLines);
    expect(report.vendorCoverage.resolved).toBeGreaterThan(0);
    expect(report.missingGlMappings).toBeGreaterThan(0);
    expect(report.totalAmount).toBeGreaterThan(0);
  });
});
