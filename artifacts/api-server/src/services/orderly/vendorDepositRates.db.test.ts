/**
 * Deposit-rate lifecycle + concurrency (live dev DB).
 *
 * 1. Full effective-dating lifecycle: create an open-ended rate → a second
 *    open-ended rate is rejected as overlap → close the first (PATCH
 *    semantics) → a successor rate can then be created, and classification
 *    respects the boundary.
 * 2. Concurrent creates for the same vendor never produce overlapping
 *    windows (advisory-lock serialization).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  companies,
  companyStores,
  historicalInvoices,
  importSourcePropertyBindings,
  vendorDepositRates,
  vendorInvoiceImportBatches,
  vendorInvoiceImportLines,
  vendors,
} from "@workspace/db";
import {
  approveVendorInvoiceBatch,
  classifyDepositGap,
  createVendorDepositRate,
  runVendorInvoiceResolutionPreview,
  updateVendorDepositRateWindow,
  VendorInvoiceImportError,
  type DepositRateWindow,
} from "./vendorInvoiceImport";

const SFX = `deprate-${Date.now().toString(36)}`;
const COMPANY_ID = `inttest-dr-co-${SFX}`;
const STORE_ID = `inttest-dr-store-${SFX}`;
const BINDING_ID = `inttest-dr-bind-${SFX}`;
const PROPERTY_ID = `inttest-dr-prop-${SFX}`;
const VENDOR_ID = `inttest-dr-vendor-${SFX}`;
const VENDOR_C = `inttest-dr-vendorC-${SFX}`;
const BATCH_C = `inttest-dr-batchC-${SFX}`;

async function cleanup() {
  await db.delete(vendorInvoiceImportLines)
    .where(eq(vendorInvoiceImportLines.batchId, BATCH_C));
  await db.delete(vendorInvoiceImportBatches)
    .where(eq(vendorInvoiceImportBatches.companyId, COMPANY_ID));
  await db.delete(historicalInvoices)
    .where(eq(historicalInvoices.companyId, COMPANY_ID));
  await db.delete(vendorDepositRates)
    .where(eq(vendorDepositRates.companyId, COMPANY_ID));
  await db.delete(importSourcePropertyBindings)
    .where(eq(importSourcePropertyBindings.id, BINDING_ID));
  await db.delete(vendors).where(eq(vendors.companyId, COMPANY_ID));
  await db.delete(companyStores).where(eq(companyStores.companyId, COMPANY_ID));
  await db.delete(companies).where(eq(companies.id, COMPANY_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(companies).values({
    id: COMPANY_ID,
    name: "Deposit Rate Test Co",
    country: "US",
    timezone: "America/New_York",
    preferredUnitSystem: "imperial",
    costingMethod: "last_cost",
    status: "active",
  });
  await db.insert(companyStores).values({
    id: STORE_ID, companyId: COMPANY_ID, code: `DR-${SFX}`, name: "Deposit Store", status: "active",
  });
  await db.insert(importSourcePropertyBindings).values({
    id: BINDING_ID,
    companyId: COMPANY_ID,
    sourceSystem: "ORDERLY",
    sourcePropertyId: PROPERTY_ID,
    sourcePropertyLabel: "Deposit Prop",
    destinationStoreId: STORE_ID,
    active: 1,
  });
  await db.insert(vendors).values([
    { id: VENDOR_ID, companyId: COMPANY_ID, name: `Vendor Keg ${SFX}`, orderGuideType: "manual", active: 1, receiveByUnit: 0, requires1099: 0 },
    { id: VENDOR_C, companyId: COMPANY_ID, name: `Vendor Stale ${SFX}`, orderGuideType: "manual", active: 1, receiveByUnit: 0, requires1099: 0 },
  ]);
  // Batch with one invoice whose header−lines gap is exactly $50 (one keg out).
  await db.insert(vendorInvoiceImportBatches).values({
    id: BATCH_C,
    companyId: COMPANY_ID,
    sourceSystem: "ORDERLY",
    sourcePropertyId: PROPERTY_ID,
    sourcePropertyBindingId: BINDING_ID,
    destinationStoreId: STORE_ID,
    fileHash: `hash-C-${SFX}`,
    originalFilename: "vendor-c.xlsx",
    parserVersion: "1.0",
    vendorNameDetected: `Vendor Stale ${SFX}`,
    resolvedVendorId: VENDOR_C,
    invoiceCount: 1,
    lineCount: 1,
    totalAmount: 150,
    invoiceTotals: [{ invoiceNumber: `K-1-${SFX}`, invoiceDate: "2026-07-01", amount: 150 }],
    status: "pending_review",
  });
  await db.insert(vendorInvoiceImportLines).values({
    batchId: BATCH_C,
    rowIndex: 0,
    invoiceNumber: `K-1-${SFX}`,
    invoiceDate: "2026-07-01",
    itemCode: "KEG-1",
    description: "Keg beer",
    qty: 1,
    extendedAmount: 100,
    category: "Beer",
    glCode: "5100",
    rawData: {},
  });
});
afterAll(cleanup);

async function loadRates(): Promise<DepositRateWindow[]> {
  return (await db.select({
    ratePerKeg: vendorDepositRates.ratePerKeg,
    effectiveFrom: vendorDepositRates.effectiveFrom,
    effectiveTo: vendorDepositRates.effectiveTo,
  }).from(vendorDepositRates)
    .where(and(
      eq(vendorDepositRates.companyId, COMPANY_ID),
      eq(vendorDepositRates.vendorId, VENDOR_ID),
    ))) as DepositRateWindow[];
}

describe("vendor deposit rate lifecycle", () => {
  it("close-then-succeed: open-ended rate blocks a successor until closed", async () => {
    const first = await createVendorDepositRate({
      companyId: COMPANY_ID, vendorId: VENDOR_ID,
      ratePerKeg: 50, effectiveFrom: "2025-01-01", effectiveTo: null, createdBy: null,
    });
    expect(first).not.toBeNull();

    // Overlapping successor is rejected while the first rate is open-ended.
    const blocked = await createVendorDepositRate({
      companyId: COMPANY_ID, vendorId: VENDOR_ID,
      ratePerKeg: 60, effectiveFrom: "2026-01-01", effectiveTo: null, createdBy: null,
    });
    expect(blocked).toBeNull();

    // Close the first window, then the successor is accepted.
    const closed = await updateVendorDepositRateWindow({
      companyId: COMPANY_ID, vendorId: VENDOR_ID,
      rateId: (first as any).id, effectiveTo: "2025-12-31",
    });
    expect((closed as any).effectiveTo).toBe("2025-12-31");

    const second = await createVendorDepositRate({
      companyId: COMPANY_ID, vendorId: VENDOR_ID,
      ratePerKeg: 60, effectiveFrom: "2026-01-01", effectiveTo: null, createdBy: null,
    });
    expect(second).not.toBeNull();

    // Classification respects the boundary: $50-multiples explain in 2025,
    // $60-multiples in 2026, and cross-rate amounts fail closed.
    const rates = await loadRates();
    expect(classifyDepositGap(100, "2025-06-01", rates)).toMatchObject({ ratePerKeg: 50, kegCount: 2 });
    expect(classifyDepositGap(120, "2026-02-01", rates)).toMatchObject({ ratePerKeg: 60, kegCount: 2 });
    expect(classifyDepositGap(100, "2026-02-01", rates)).toBeNull();
  });

  it("rejects reopening a window when it would overlap the successor", async () => {
    const rows = await db.select().from(vendorDepositRates)
      .where(and(
        eq(vendorDepositRates.companyId, COMPANY_ID),
        eq(vendorDepositRates.vendorId, VENDOR_ID),
      ));
    const first = rows.find((r: any) => r.ratePerKeg === 50)!;
    await expect(updateVendorDepositRateWindow({
      companyId: COMPANY_ID, vendorId: VENDOR_ID,
      rateId: first.id, effectiveTo: null, // would overlap the 2026 rate
    })).rejects.toThrow(VendorInvoiceImportError);
  });

  it("rejects an update for an unknown rate id", async () => {
    await expect(updateVendorDepositRateWindow({
      companyId: COMPANY_ID, vendorId: VENDOR_ID,
      rateId: "does-not-exist", effectiveTo: "2026-06-30",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("approval reclassifies under lock: a rate change between preview and approval never persists stale evidence", async () => {
    // Configure a $50 rate; preview classifies the $50 gap as explained.
    const rate = await createVendorDepositRate({
      companyId: COMPANY_ID, vendorId: VENDOR_C,
      ratePerKeg: 50, effectiveFrom: "2026-01-01", effectiveTo: null, createdBy: null,
    });
    expect(rate).not.toBeNull();
    const preview = await runVendorInvoiceResolutionPreview(BATCH_C, COMPANY_ID);
    const previewRecon = preview.reconciliation[0];
    expect(previewRecon.reconciliationStatus).toBe("explained_deposit_flow");
    expect(previewRecon.depositFlow).toMatchObject({ ratePerKeg: 50, kegCount: 1, signedAmount: 50 });

    // Interleave: close the rate BEFORE the invoice date, after preview but
    // before approval. The invoice date now has no effective rate.
    await updateVendorDepositRateWindow({
      companyId: COMPANY_ID, vendorId: VENDOR_C,
      rateId: (rate as any).id, effectiveTo: "2026-06-30",
    });

    const result = await approveVendorInvoiceBatch({ batchId: BATCH_C, companyId: COMPANY_ID, userId: null });
    expect(result.invoicesPersisted).toBe(1);

    // Persisted evidence must reflect the rate state AT APPROVAL: no
    // explained deposit flow, because the rate was closed. The preview's
    // stale classification must not leak.
    const [batchRow] = await db.select({ depositFlows: vendorInvoiceImportBatches.depositFlows })
      .from(vendorInvoiceImportBatches).where(eq(vendorInvoiceImportBatches.id, BATCH_C));
    expect(batchRow.depositFlows).toEqual([]);
    const [inv] = await db.select({ sourceSnapshot: historicalInvoices.sourceSnapshot })
      .from(historicalInvoices)
      .where(and(eq(historicalInvoices.companyId, COMPANY_ID), eq(historicalInvoices.vendorId, VENDOR_C)));
    expect((inv.sourceSnapshot as any).depositFlow).toBeUndefined();
  });

  it("concurrent creates never produce overlapping windows", async () => {
    const vendorB = `${VENDOR_ID}-b`;
    const attempts = await Promise.all(
      [50, 55, 60, 65].map(rate => createVendorDepositRate({
        companyId: COMPANY_ID, vendorId: vendorB,
        ratePerKeg: rate, effectiveFrom: "2025-01-01", effectiveTo: null, createdBy: null,
      })),
    );
    const winners = attempts.filter(a => a != null);
    expect(winners).toHaveLength(1);
    const persisted = await db.select().from(vendorDepositRates)
      .where(and(
        eq(vendorDepositRates.companyId, COMPANY_ID),
        eq(vendorDepositRates.vendorId, vendorB),
      ));
    expect(persisted).toHaveLength(1);
  });
});
