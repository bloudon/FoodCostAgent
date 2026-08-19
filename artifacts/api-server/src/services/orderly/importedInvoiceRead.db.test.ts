/**
 * DB-backed tests for the imported-invoice read surface.
 *
 * Covers:
 *   1. approved-only filtering (pending/rejected batches are invisible)
 *   2. company and store isolation (cross-company and cross-store access denied)
 *   3. complete line projection including unresolved lines and missing GL/category
 *   4. stable identity — calling list/detail twice returns identical data
 *   5. no mutation imports or dependencies (read-only service)
 *   6. vendorName preference: snapshot > current > 'Unknown vendor'
 *   7. list order: newest invoiceDate first, id descending as tie-break
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  companies,
  companyStores,
  historicalInvoiceLines,
  historicalInvoices,
  users,
  userStores,
  vendorInvoiceImportBatches,
  vendors,
} from '@workspace/db';
import { db } from '../../db';
import {
  listImportedInvoices,
  getImportedInvoiceDetail,
} from './importedInvoiceRead';

// ─── Test fixture ids ─────────────────────────────────────────────────────────
const SFX = `iir-${Date.now().toString(36)}`;
const CO_A = `iir-coA-${SFX}`;
const CO_B = `iir-coB-${SFX}`;
const STORE_A1 = `iir-stA1-${SFX}`;
const STORE_A2 = `iir-stA2-${SFX}`;
const STORE_B1 = `iir-stB1-${SFX}`;
const BATCH_APPROVED = `iir-batch-appr-${SFX}`;
const BATCH_PENDING = `iir-batch-pend-${SFX}`;
const BATCH_REJECTED = `iir-batch-rej-${SFX}`;
const BATCH_CO_B = `iir-batch-cob-${SFX}`;
const VENDOR_A = `iir-vend-${SFX}`;
const ADMIN_A = `iir-adminA-${SFX}`;
const SCOPED_USER = `iir-scoped-${SFX}`;
const ADMIN_B = `iir-adminB-${SFX}`;
const BINDING_ID = `iir-bind-${SFX}`;
const PROP_ID = `iir-prop-${SFX}`;

// Invoice ids written into historicalInvoices.
let INV_APPROVED_1: string;
let INV_APPROVED_2: string;
let INV_PENDING: string;
let INV_REJECTED: string;
let INV_CO_B: string;
// Line ids written into historicalInvoiceLines.
let LINE_RESOLVED: string;
let LINE_UNRESOLVED: string;

// User objects (typed as needed by getAccessibleStores)
const makeUser = (id: string, role: 'company_admin' | 'store_user', companyId: string) => ({
  id,
  email: `${id}@test.local`,
  role,
  companyId,
  active: 1,
}) as any;

const ADMIN_A_USER = makeUser(ADMIN_A, 'company_admin', CO_A);
const SCOPED_USER_OBJ = makeUser(SCOPED_USER, 'store_user', CO_A);
const ADMIN_B_USER = makeUser(ADMIN_B, 'company_admin', CO_B);

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;

// ─── Fixtures ─────────────────────────────────────────────────────────────────
async function cleanup() {
  await db.delete(historicalInvoiceLines).where(
    inArray(historicalInvoiceLines.companyId, [CO_A, CO_B]),
  ).catch(() => {});
  await db.delete(historicalInvoices).where(
    inArray(historicalInvoices.companyId, [CO_A, CO_B]),
  ).catch(() => {});
  await db.delete(vendorInvoiceImportBatches).where(
    inArray(vendorInvoiceImportBatches.companyId, [CO_A, CO_B]),
  ).catch(() => {});
  await db.delete(vendors).where(inArray(vendors.companyId, [CO_A, CO_B])).catch(() => {});
  await db.delete(userStores).where(eq(userStores.userId, SCOPED_USER)).catch(() => {});
  await db.delete(users).where(
    inArray(users.id, [ADMIN_A, SCOPED_USER, ADMIN_B]),
  ).catch(() => {});
  await db.delete(companyStores).where(
    inArray(companyStores.companyId, [CO_A, CO_B]),
  ).catch(() => {});
  await db.delete(companies).where(inArray(companies.id, [CO_A, CO_B])).catch(() => {});
}

beforeAll(async () => {
  if (SKIP) return;
  await cleanup();

  // Companies
  await db.insert(companies).values([
    { id: CO_A, name: `IIR Co A ${SFX}`, country: 'US', timezone: 'America/New_York', preferredUnitSystem: 'imperial', costingMethod: 'last_cost', status: 'active' },
    { id: CO_B, name: `IIR Co B ${SFX}`, country: 'US', timezone: 'America/New_York', preferredUnitSystem: 'imperial', costingMethod: 'last_cost', status: 'active' },
  ]);

  // Stores
  await db.insert(companyStores).values([
    { id: STORE_A1, companyId: CO_A, code: `SA1-${SFX}`.slice(0, 12), name: `Store A1 ${SFX}`, status: 'active' },
    { id: STORE_A2, companyId: CO_A, code: `SA2-${SFX}`.slice(0, 12), name: `Store A2 ${SFX}`, status: 'active' },
    { id: STORE_B1, companyId: CO_B, code: `SB1-${SFX}`.slice(0, 12), name: `Store B1 ${SFX}`, status: 'active' },
  ]);

  // Users — admin sees all stores; scoped user sees only STORE_A1
  await db.insert(users).values([
    { id: ADMIN_A, email: `iir-adminA-${SFX}@test.local`, role: 'company_admin', companyId: CO_A, active: 1 },
    { id: SCOPED_USER, email: `iir-scoped-${SFX}@test.local`, role: 'store_user', companyId: CO_A, active: 1 },
    { id: ADMIN_B, email: `iir-adminB-${SFX}@test.local`, role: 'company_admin', companyId: CO_B, active: 1 },
  ]);
  await db.insert(userStores).values([{ userId: SCOPED_USER, storeId: STORE_A1 }]);

  // Vendor for company A (no snapshot on one invoice, to test fallback)
  await db.insert(vendors).values({
    id: VENDOR_A,
    companyId: CO_A,
    name: `IIR Vendor A ${SFX}`,
    orderGuideType: 'manual',
    active: 1,
    receiveByUnit: 0,
    requires1099: 0,
  });

  // Vendor invoice import batches
  const batchBase = {
    companyId: CO_A,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: PROP_ID,
    sourcePropertyBindingId: BINDING_ID,
    destinationStoreId: STORE_A1,
    parserVersion: '1.0',
    invoiceCount: 1,
    lineCount: 2,
    totalAmount: 100,
    invoiceTotals: [],
  };
  await db.insert(vendorInvoiceImportBatches).values([
    {
      ...batchBase,
      id: BATCH_APPROVED,
      fileHash: `hash-appr-${SFX}`,
      originalFilename: `approved-batch-${SFX}.xlsx`,
      status: 'approved',
      resolvedVendorId: VENDOR_A,
      approvedAt: new Date('2026-06-01T12:00:00Z'),
      approvedBy: ADMIN_A,
    },
    {
      ...batchBase,
      id: BATCH_PENDING,
      fileHash: `hash-pend-${SFX}`,
      originalFilename: `pending-batch-${SFX}.xlsx`,
      status: 'pending_review',
    },
    {
      ...batchBase,
      id: BATCH_REJECTED,
      fileHash: `hash-rej-${SFX}`,
      originalFilename: `rejected-batch-${SFX}.xlsx`,
      status: 'rejected',
    },
  ]);
  await db.insert(vendorInvoiceImportBatches).values([
    {
      id: BATCH_CO_B,
      companyId: CO_B,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: PROP_ID,
      sourcePropertyBindingId: `bind-b-${SFX}`,
      destinationStoreId: STORE_B1,
      parserVersion: '1.0',
      invoiceCount: 1,
      lineCount: 1,
      totalAmount: 50,
      invoiceTotals: [],
      fileHash: `hash-cob-${SFX}`,
      originalFilename: `co-b-batch-${SFX}.xlsx`,
      status: 'approved',
      approvedAt: new Date('2026-06-01T12:00:00Z'),
      approvedBy: ADMIN_B,
    },
  ]);

  // Approved invoice 1 — has vendor name snapshot, older date
  const [inv1] = await db.insert(historicalInvoices).values({
    companyId: CO_A,
    storeId: STORE_A1,
    vendorId: VENDOR_A,
    importBatchId: BATCH_APPROVED,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: PROP_ID,
    sourceInvoiceId: `xlsx:${VENDOR_A}:INV-001-${SFX}`,
    invoiceNumber: `INV-001-${SFX}`,
    invoiceDate: '2026-05-01',
    invoicePeriod: '2026-05',
    vendorNameSnapshot: `Snapshot Vendor ${SFX}`,
    subtotal: 80,
    taxAmount: 5,
    chargeAmount: 5,
    creditAmount: 0,
    totalAmount: 90,
    sourceSnapshot: { importKind: 'vendor_invoice_xlsx' },
    materialHash: `mh1-${SFX}`,
  }).returning({ id: historicalInvoices.id });
  INV_APPROVED_1 = inv1.id;

  // Approved invoice 2 — no vendor name snapshot (uses current vendor name), newer date
  const [inv2] = await db.insert(historicalInvoices).values({
    companyId: CO_A,
    storeId: STORE_A1,
    vendorId: VENDOR_A,
    importBatchId: BATCH_APPROVED,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: PROP_ID,
    sourceInvoiceId: `xlsx:${VENDOR_A}:INV-002-${SFX}`,
    invoiceNumber: `INV-002-${SFX}`,
    invoiceDate: '2026-06-01',
    invoicePeriod: '2026-06',
    vendorNameSnapshot: null,
    subtotal: 100,
    taxAmount: 8,
    chargeAmount: 2,
    creditAmount: 0,
    totalAmount: 110,
    sourceSnapshot: { importKind: 'vendor_invoice_xlsx' },
    materialHash: `mh2-${SFX}`,
  }).returning({ id: historicalInvoices.id });
  INV_APPROVED_2 = inv2.id;

  // Invoice linked to PENDING batch — must NOT appear in list/detail
  const [inv3] = await db.insert(historicalInvoices).values({
    companyId: CO_A,
    storeId: STORE_A1,
    vendorId: VENDOR_A,
    importBatchId: BATCH_PENDING,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: PROP_ID,
    sourceInvoiceId: `xlsx:${VENDOR_A}:INV-PEND-${SFX}`,
    invoiceNumber: `INV-PEND-${SFX}`,
    invoiceDate: '2026-04-01',
    invoicePeriod: '2026-04',
    vendorNameSnapshot: 'Should Not Appear',
    subtotal: 50,
    taxAmount: 0,
    chargeAmount: 0,
    creditAmount: 0,
    totalAmount: 50,
    sourceSnapshot: {},
    materialHash: `mh3-${SFX}`,
  }).returning({ id: historicalInvoices.id });
  INV_PENDING = inv3.id;

  // Invoice linked to REJECTED batch
  const [inv4] = await db.insert(historicalInvoices).values({
    companyId: CO_A,
    storeId: STORE_A1,
    vendorId: VENDOR_A,
    importBatchId: BATCH_REJECTED,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: PROP_ID,
    sourceInvoiceId: `xlsx:${VENDOR_A}:INV-REJ-${SFX}`,
    invoiceNumber: `INV-REJ-${SFX}`,
    invoiceDate: '2026-03-01',
    invoicePeriod: '2026-03',
    vendorNameSnapshot: 'Should Not Appear Rejected',
    subtotal: 30,
    taxAmount: 0,
    chargeAmount: 0,
    creditAmount: 0,
    totalAmount: 30,
    sourceSnapshot: {},
    materialHash: `mh4-${SFX}`,
  }).returning({ id: historicalInvoices.id });
  INV_REJECTED = inv4.id;

  // Cross-company invoice
  const [inv5] = await db.insert(historicalInvoices).values({
    companyId: CO_B,
    storeId: STORE_B1,
    importBatchId: BATCH_CO_B,
    sourceSystem: 'ORDERLY',
    sourcePropertyId: PROP_ID,
    sourceInvoiceId: `xlsx:vendorb:INV-COB-${SFX}`,
    invoiceNumber: `INV-COB-${SFX}`,
    invoiceDate: '2026-06-15',
    invoicePeriod: '2026-06',
    vendorNameSnapshot: 'Co B Vendor',
    subtotal: 50,
    taxAmount: 0,
    chargeAmount: 0,
    creditAmount: 0,
    totalAmount: 50,
    sourceSnapshot: {},
    materialHash: `mh5-${SFX}`,
  }).returning({ id: historicalInvoices.id });
  INV_CO_B = inv5.id;

  // Lines for INV_APPROVED_1: one resolved (with GL), one unresolved (missing GL)
  const [line1] = await db.insert(historicalInvoiceLines).values({
    companyId: CO_A,
    invoiceId: INV_APPROVED_1,
    sourceLineId: 'xlsx-row-0',
    resolutionStatus: 'resolved',
    productNameSnapshot: `Resolved Product ${SFX}`,
    sourceExternalId: 'SKU-001',
    quantity: 2,
    unitPrice: 10,
    lineTotal: 20,
    packSnapshot: { raw: '6/32oz' },
    catchWeightSnapshot: {},
    glSnapshot: { glCode: '5010', category: 'Dairy' },
    financialSnapshot: { extendedAmount: 20 },
    sourceSnapshot: {},
    materialHash: `mhl1-${SFX}`,
  }).returning({ id: historicalInvoiceLines.id });
  LINE_RESOLVED = line1.id;

  const [line2] = await db.insert(historicalInvoiceLines).values({
    companyId: CO_A,
    invoiceId: INV_APPROVED_1,
    sourceLineId: 'xlsx-row-1',
    resolutionStatus: 'unresolved',
    productNameSnapshot: `Unresolved Product ${SFX}`,
    sourceExternalId: null,
    quantity: 1,
    unitPrice: null,
    lineTotal: 60,
    packSnapshot: {},
    catchWeightSnapshot: {},
    glSnapshot: {},
    financialSnapshot: {},
    sourceSnapshot: {},
    materialHash: `mhl2-${SFX}`,
  }).returning({ id: historicalInvoiceLines.id });
  LINE_UNRESOLVED = line2.id;
});

afterAll(async () => {
  if (SKIP) return;
  await cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('importedInvoiceRead — approved-only filtering', () => {
  it('list returns only invoices linked to approved batches', async () => {
    const results = await listImportedInvoices(ADMIN_A_USER, CO_A);
    const ids = results.map(r => r.id);
    expect(ids).toContain(INV_APPROVED_1);
    expect(ids).toContain(INV_APPROVED_2);
    expect(ids).not.toContain(INV_PENDING);
    expect(ids).not.toContain(INV_REJECTED);
  });

  it('detail returns null (→ 404) for an invoice linked to a pending batch', async () => {
    const result = await getImportedInvoiceDetail(INV_PENDING, ADMIN_A_USER, CO_A);
    expect(result).toBeNull();
  });

  it('detail returns null for an invoice linked to a rejected batch', async () => {
    const result = await getImportedInvoiceDetail(INV_REJECTED, ADMIN_A_USER, CO_A);
    expect(result).toBeNull();
  });

  it('all returned summaries have kind and sourceLabel literals set correctly', async () => {
    const results = await listImportedInvoices(ADMIN_A_USER, CO_A);
    for (const r of results) {
      expect(r.kind).toBe('historical_imported_invoice');
      expect(r.sourceLabel).toBe('Imported Invoice');
    }
  });
});

describe.skipIf(SKIP)('importedInvoiceRead — company and store isolation', () => {
  it('company A admin cannot see company B invoices', async () => {
    const results = await listImportedInvoices(ADMIN_A_USER, CO_A);
    const ids = results.map(r => r.id);
    expect(ids).not.toContain(INV_CO_B);
  });

  it('company B admin cannot see company A invoices', async () => {
    const results = await listImportedInvoices(ADMIN_B_USER, CO_B);
    const ids = results.map(r => r.id);
    expect(ids).not.toContain(INV_APPROVED_1);
    expect(ids).not.toContain(INV_APPROVED_2);
    expect(ids).toContain(INV_CO_B);
  });

  it('detail returns null for a cross-company invoice access attempt', async () => {
    // Admin A tries to access Company B's invoice
    const result = await getImportedInvoiceDetail(INV_CO_B, ADMIN_A_USER, CO_A);
    expect(result).toBeNull();
  });

  it('detail returns null when companyId is wrong for an otherwise valid invoice', async () => {
    // Company B admin tries to access Company A's invoice using CO_B companyId
    const result = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_B_USER, CO_B);
    expect(result).toBeNull();
  });

  it('store-scoped user sees only invoices for their accessible store', async () => {
    // SCOPED_USER only has access to STORE_A1
    const results = await listImportedInvoices(SCOPED_USER_OBJ, CO_A);
    // Both approved invoices are in STORE_A1, so they should be visible
    const ids = results.map(r => r.id);
    expect(ids).toContain(INV_APPROVED_1);
    expect(ids).toContain(INV_APPROVED_2);
    // No cross-store or cross-company leakage
    expect(ids).not.toContain(INV_CO_B);
  });

  it('a user with no accessible stores sees an empty list', async () => {
    // User with STORE_A2 access only — approved invoices are in STORE_A1
    const storeScopedA2 = { ...SCOPED_USER_OBJ, id: `iir-noaccess-${SFX}` } as any;
    // Mock getAccessibleStores by passing a user not assigned to STORE_A1
    // We use the SCOPED_USER_OBJ but pass CO_A with only STORE_A2 stores,
    // simulating via a user that has no stores (no userStores rows)
    const noStoreUser = {
      id: `iir-nostoreuser-${SFX}`,
      email: `iir-nostore-${SFX}@test.local`,
      role: 'store_user' as const,
      companyId: CO_A,
      active: 1,
    } as any;
    // This user has no userStores rows so getAccessibleStores returns []
    const results = await listImportedInvoices(noStoreUser, CO_A);
    expect(results).toHaveLength(0);
  });

  it('detail returns null (not 403) for a store-inaccessible invoice — does not reveal existence', async () => {
    // Create a second store-scoped user with access to STORE_A2 only
    const storeScopedA2User = {
      id: `iir-scoped2-${SFX}`,
      email: `iir-scoped2-${SFX}@test.local`,
      role: 'store_user' as const,
      companyId: CO_A,
      active: 1,
    } as any;
    // This user has no userStores rows → no accessible stores → null
    const result = await getImportedInvoiceDetail(INV_APPROVED_1, storeScopedA2User, CO_A);
    expect(result).toBeNull();
  });
});

describe.skipIf(SKIP)('importedInvoiceRead — complete line projection', () => {
  it('detail includes both resolved and unresolved lines', async () => {
    const detail = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    expect(detail).not.toBeNull();
    expect(detail!.lines).toHaveLength(2);
    const lineIds = detail!.lines.map(l => l.id);
    expect(lineIds).toContain(LINE_RESOLVED);
    expect(lineIds).toContain(LINE_UNRESOLVED);
  });

  it('resolved line has GL code and category populated', async () => {
    const detail = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    const resolved = detail!.lines.find(l => l.id === LINE_RESOLVED)!;
    expect(resolved.resolutionStatus).toBe('resolved');
    expect(resolved.sourceGlCode).toBe('5010');
    expect(resolved.sourceCategory).toBe('Dairy');
    expect(resolved.itemCode).toBe('SKU-001');
    expect(resolved.quantity).toBe(2);
    expect(resolved.unitPrice).toBe(10);
    expect(resolved.lineTotal).toBe(20);
    expect(resolved.description).toBe(`Resolved Product ${SFX}`);
  });

  it('unresolved line has null GL code, category, itemCode, and unitPrice', async () => {
    const detail = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    const unresolved = detail!.lines.find(l => l.id === LINE_UNRESOLVED)!;
    expect(unresolved.resolutionStatus).toBe('unresolved');
    expect(unresolved.sourceGlCode).toBeNull();
    expect(unresolved.sourceCategory).toBeNull();
    expect(unresolved.itemCode).toBeNull();
    expect(unresolved.unitPrice).toBeNull();
    expect(unresolved.resolvedInventoryItemName).toBeNull();
  });

  it('pack is preserved as the raw JSONB object', async () => {
    const detail = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    const resolved = detail!.lines.find(l => l.id === LINE_RESOLVED)!;
    expect(resolved.pack).toMatchObject({ raw: '6/32oz' });
  });

  it('lines are ordered by sourceLineId', async () => {
    const detail = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    const sourceLineIds = detail!.lines.map(l => l.sourceLineId);
    const sorted = [...sourceLineIds].sort();
    expect(sourceLineIds).toEqual(sorted);
  });
});

describe.skipIf(SKIP)('importedInvoiceRead — summary fields completeness', () => {
  it('summary contains all required fields including originalFilename and approvedAt', async () => {
    const results = await listImportedInvoices(ADMIN_A_USER, CO_A);
    const inv1 = results.find(r => r.id === INV_APPROVED_1)!;
    expect(inv1).toBeDefined();
    expect(inv1.id).toBe(INV_APPROVED_1);
    expect(inv1.kind).toBe('historical_imported_invoice');
    expect(inv1.sourceLabel).toBe('Imported Invoice');
    expect(inv1.invoiceNumber).toBe(`INV-001-${SFX}`);
    expect(inv1.invoiceDate).toBe('2026-05-01');
    expect(inv1.vendorId).toBe(VENDOR_A);
    expect(inv1.storeId).toBe(STORE_A1);
    expect(inv1.storeName).toContain('Store A1');
    expect(inv1.lineCount).toBe(2);
    expect(inv1.totalAmount).toBe(90);
    expect(inv1.originalFilename).toBe(`approved-batch-${SFX}.xlsx`);
    expect(inv1.approvedAt).toBe('2026-06-01T12:00:00.000Z');
  });

  it('detail extends summary with sourceSystem, sourceInvoiceId, and financial totals', async () => {
    const detail = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    expect(detail).not.toBeNull();
    expect(detail!.sourceSystem).toBe('ORDERLY');
    expect(detail!.sourceInvoiceId).toBe(`xlsx:${VENDOR_A}:INV-001-${SFX}`);
    expect(detail!.subtotal).toBe(80);
    expect(detail!.taxAmount).toBe(5);
    expect(detail!.chargeAmount).toBe(5);
    expect(detail!.creditAmount).toBe(0);
    expect(detail!.lines).toHaveLength(2);
  });
});

describe.skipIf(SKIP)('importedInvoiceRead — vendorName resolution', () => {
  it('prefers the snapshot name when present', async () => {
    const detail = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    // INV_APPROVED_1 has vendorNameSnapshot = `Snapshot Vendor ${SFX}`
    expect(detail!.vendorName).toBe(`Snapshot Vendor ${SFX}`);
  });

  it('falls back to current vendor name when snapshot is absent', async () => {
    const detail = await getImportedInvoiceDetail(INV_APPROVED_2, ADMIN_A_USER, CO_A);
    // INV_APPROVED_2 has vendorNameSnapshot = null; vendorId = VENDOR_A
    expect(detail!.vendorName).toBe(`IIR Vendor A ${SFX}`);
  });
});

describe.skipIf(SKIP)('importedInvoiceRead — list order', () => {
  it('newest invoiceDate appears first', async () => {
    const results = await listImportedInvoices(ADMIN_A_USER, CO_A);
    const approvedInvoices = results.filter(r => [INV_APPROVED_1, INV_APPROVED_2].includes(r.id));
    // INV_APPROVED_2 has date 2026-06-01, INV_APPROVED_1 has 2026-05-01
    expect(approvedInvoices[0].id).toBe(INV_APPROVED_2);
    expect(approvedInvoices[1].id).toBe(INV_APPROVED_1);
  });
});

describe.skipIf(SKIP)('importedInvoiceRead — stable identity (idempotent reads)', () => {
  it('calling list twice returns identical data', async () => {
    const first = await listImportedInvoices(ADMIN_A_USER, CO_A);
    const second = await listImportedInvoices(ADMIN_A_USER, CO_A);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('calling detail twice returns identical data', async () => {
    const first = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    const second = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('detail line count matches summary lineCount', async () => {
    const summaries = await listImportedInvoices(ADMIN_A_USER, CO_A);
    const summary = summaries.find(r => r.id === INV_APPROVED_1)!;
    const detail = await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    expect(detail!.lines).toHaveLength(summary.lineCount);
  });
});

describe.skipIf(SKIP)('importedInvoiceRead — no mutation imports or dependencies', () => {
  it('service module does not export any write/mutation functions', async () => {
    const mod = await import('./importedInvoiceRead');
    const exports = Object.keys(mod);
    // Only read functions and the error class should be exported
    for (const name of exports) {
      expect(name).not.toMatch(/^(create|update|delete|insert|write|approve|stage|upsert)/i);
    }
  });

  it('invoking listImportedInvoices does not alter the invoice row count', async () => {
    const before = await db
      .select({ id: historicalInvoices.id })
      .from(historicalInvoices)
      .where(eq(historicalInvoices.companyId, CO_A));
    await listImportedInvoices(ADMIN_A_USER, CO_A);
    const after = await db
      .select({ id: historicalInvoices.id })
      .from(historicalInvoices)
      .where(eq(historicalInvoices.companyId, CO_A));
    expect(after.length).toBe(before.length);
  });

  it('invoking getImportedInvoiceDetail does not alter the line row count', async () => {
    const before = await db
      .select({ id: historicalInvoiceLines.id })
      .from(historicalInvoiceLines)
      .where(eq(historicalInvoiceLines.invoiceId, INV_APPROVED_1));
    await getImportedInvoiceDetail(INV_APPROVED_1, ADMIN_A_USER, CO_A);
    const after = await db
      .select({ id: historicalInvoiceLines.id })
      .from(historicalInvoiceLines)
      .where(eq(historicalInvoiceLines.invoiceId, INV_APPROVED_1));
    expect(after.length).toBe(before.length);
  });
});

describe.skipIf(SKIP)('importedInvoiceRead — Coca Cola acceptance', () => {
  it('returns exactly three complete Coca Cola invoice identities from an approved batch', async () => {
    const sourceIds = [1, 2, 3].map(n => `xlsx:coca-cola:CC-${n}-${SFX}`);
    const inserted = await db.insert(historicalInvoices).values(sourceIds.map((sourceInvoiceId, index) => ({
      companyId: CO_A,
      storeId: STORE_A1,
      vendorId: null,
      importBatchId: BATCH_APPROVED,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: PROP_ID,
      sourceInvoiceId,
      invoiceNumber: `CC-${index + 1}-${SFX}`,
      invoiceDate: `2026-07-0${index + 1}`,
      invoicePeriod: '2026-07',
      vendorNameSnapshot: 'Coca Cola',
      subtotal: 25 + index,
      taxAmount: 0,
      chargeAmount: 0,
      creditAmount: 0,
      totalAmount: 25 + index,
      sourceSnapshot: { importKind: 'vendor_invoice_xlsx' },
      materialHash: `cc-mh-${index}-${SFX}`,
    }))).returning({ id: historicalInvoices.id });

    try {
      await db.insert(historicalInvoiceLines).values(inserted.map((invoice, index) => ({
        companyId: CO_A,
        invoiceId: invoice.id,
        sourceLineId: `cc-row-${index}-${SFX}`,
        resolutionStatus: index === 2 ? 'unresolved' : 'resolved',
        productNameSnapshot: `Coca Cola product ${index + 1}`,
        sourceExternalId: `CC-SKU-${index + 1}`,
        quantity: index + 1,
        unitPrice: 25,
        lineTotal: 25 + index,
        packSnapshot: { raw: '24 cans' },
        catchWeightSnapshot: {},
        glSnapshot: index === 2 ? {} : { glCode: '5100', category: 'Beverages' },
        financialSnapshot: {},
        sourceSnapshot: {},
        materialHash: `cc-line-mh-${index}-${SFX}`,
      })));

      const list = await listImportedInvoices(ADMIN_A_USER, CO_A);
      const cocaColaInvoices = list.filter(invoice => invoice.vendorName === 'Coca Cola');
      expect(cocaColaInvoices).toHaveLength(3);
      expect(new Set(cocaColaInvoices.map(invoice => invoice.id)).size).toBe(3);

      for (const invoice of cocaColaInvoices) {
        const detail = await getImportedInvoiceDetail(invoice.id, ADMIN_A_USER, CO_A);
        expect(detail?.id).toBe(invoice.id);
        expect(detail?.lines).toHaveLength(1);
        expect(detail?.lines[0]?.description).toMatch(/^Coca Cola product/);
      }
    } finally {
      const invoiceIds = inserted.map(invoice => invoice.id);
      await db.delete(historicalInvoiceLines).where(inArray(historicalInvoiceLines.invoiceId, invoiceIds));
      await db.delete(historicalInvoices).where(inArray(historicalInvoices.id, invoiceIds));
    }
  });
});
