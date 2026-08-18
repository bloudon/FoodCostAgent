/**
 * Vendor-scoped invoice dedupe + concurrent approval idempotency.
 *
 * 1. Invoice numbers are only unique per vendor: an invoice number already
 *    persisted for vendor A must NOT mark vendor B's identically-numbered
 *    invoice as already imported.
 * 2. Two simultaneous approvals of the same batch must both succeed — one
 *    persists, the other returns alreadyApproved — never a 409.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  companies,
  companyStores,
  inventoryItems,
  units,
  vendorItems,
  historicalInvoices,
  importSourcePropertyBindings,
  vendorInvoiceImportBatches,
  vendorInvoiceImportLines,
  vendors,
} from "@workspace/db";
import {
  runVendorInvoiceResolutionPreview,
  approveVendorInvoiceBatch,
} from "./vendorInvoiceImport";

const SFX = `dedupe-${Date.now().toString(36)}`;
const COMPANY_ID = `inttest-vid-co-${SFX}`;
const STORE_ID = `inttest-vid-store-${SFX}`;
const BINDING_ID = `inttest-vid-bind-${SFX}`;
const PROPERTY_ID = `inttest-prop-${SFX}`;
const VENDOR_A = `inttest-vid-vendorA-${SFX}`;
const VENDOR_B = `inttest-vid-vendorB-${SFX}`;
const BATCH_B = `inttest-vid-batchB-${SFX}`;
const BATCH_EMPTY = `inttest-vid-batchE-${SFX}`;
const SHARED_INVOICE_NUMBER = `90210-${SFX}`;
const INV_ITEM = `inttest-vid-item-${SFX}`;
const VENDOR_ITEM = `inttest-vid-vitem-${SFX}`;

async function cleanup() {
  await db.delete(vendorInvoiceImportLines)
    .where(inArray(vendorInvoiceImportLines.batchId, [BATCH_B, BATCH_EMPTY]));
  await db.delete(vendorInvoiceImportBatches)
    .where(eq(vendorInvoiceImportBatches.companyId, COMPANY_ID));
  await db.delete(historicalInvoices)
    .where(eq(historicalInvoices.companyId, COMPANY_ID));
  await db.delete(importSourcePropertyBindings)
    .where(eq(importSourcePropertyBindings.id, BINDING_ID));
  await db.delete(vendorItems).where(eq(vendorItems.id, VENDOR_ITEM));
  await db.delete(inventoryItems).where(eq(inventoryItems.id, INV_ITEM));
  await db.delete(vendors).where(eq(vendors.companyId, COMPANY_ID));
  await db.delete(companyStores).where(eq(companyStores.companyId, COMPANY_ID));
  await db.delete(companies).where(eq(companies.id, COMPANY_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(companies).values({
    id: COMPANY_ID,
    name: "Dedupe Test Co",
    country: "US",
    timezone: "America/New_York",
    preferredUnitSystem: "imperial",
    costingMethod: "last_cost",
    status: "active",
  });
  await db.insert(companyStores).values({
    id: STORE_ID,
    companyId: COMPANY_ID,
    code: `VID-${SFX}`,
    name: "Dedupe Store",
    status: "active",
  });
  await db.insert(importSourcePropertyBindings).values({
    id: BINDING_ID,
    companyId: COMPANY_ID,
    sourceSystem: "ORDERLY",
    sourcePropertyId: PROPERTY_ID,
    sourcePropertyLabel: "Dedupe Prop",
    destinationStoreId: STORE_ID,
    active: 1,
  });
  await db.insert(vendors).values([
    { id: VENDOR_A, companyId: COMPANY_ID, name: `Vendor Alpha ${SFX}`, orderGuideType: "manual", active: 1, receiveByUnit: 0, requires1099: 0 },
    { id: VENDOR_B, companyId: COMPANY_ID, name: `Vendor Beta ${SFX}`, orderGuideType: "manual", active: 1, receiveByUnit: 0, requires1099: 0 },
  ]);
  const [anyUnit] = await db.select({ id: units.id }).from(units).limit(1);
  await db.insert(inventoryItems).values({
    id: INV_ITEM,
    companyId: COMPANY_ID,
    name: `Beta Gadget ${SFX}`,
    unitId: anyUnit.id,
  });
  await db.insert(vendorItems).values({
    id: VENDOR_ITEM,
    vendorId: VENDOR_B,
    inventoryItemId: INV_ITEM,
    vendorSku: "XYZ-2",
    purchaseUnitId: anyUnit.id,
    caseSize: 1,
    active: 1,
  });
  // Vendor A already has this invoice number persisted.
  await db.insert(historicalInvoices).values({
    companyId: COMPANY_ID,
    storeId: STORE_ID,
    vendorId: VENDOR_A,
    importBatchId: BATCH_B,
    sourceSystem: "ORDERLY",
    sourcePropertyId: PROPERTY_ID,
    sourceInvoiceId: `xlsx:${VENDOR_A}:${SHARED_INVOICE_NUMBER}`,
    invoiceNumber: SHARED_INVOICE_NUMBER,
    invoiceDate: "2026-06-01",
    invoicePeriod: "2026-06",
    vendorNameSnapshot: "Vendor Alpha",
    subtotal: 10,
    totalAmount: 10,
    sourceSnapshot: {},
    materialHash: `mh-${SFX}`,
  });
  // Vendor B batch stages a line with the SAME invoice number.
  await db.insert(vendorInvoiceImportBatches).values([
    {
      id: BATCH_B,
      companyId: COMPANY_ID,
      sourceSystem: "ORDERLY",
      sourcePropertyId: PROPERTY_ID,
      sourcePropertyBindingId: BINDING_ID,
      destinationStoreId: STORE_ID,
      fileHash: `hash-B-${SFX}`,
      originalFilename: "vendor-b.xlsx",
      parserVersion: "1.0",
      vendorNameDetected: `Vendor Beta ${SFX}`,
      resolvedVendorId: VENDOR_B,
      invoiceCount: 1,
      lineCount: 1,
      totalAmount: 25,
      invoiceTotals: [{ invoiceNumber: SHARED_INVOICE_NUMBER, invoiceDate: "2026-07-01", amount: 25 }],
      status: "pending_review",
    },
    {
      // Empty batch for the concurrency test (no lines → approval only flips status).
      id: BATCH_EMPTY,
      companyId: COMPANY_ID,
      sourceSystem: "ORDERLY",
      sourcePropertyId: PROPERTY_ID,
      sourcePropertyBindingId: BINDING_ID,
      destinationStoreId: STORE_ID,
      fileHash: `hash-E-${SFX}`,
      originalFilename: "vendor-b-empty.xlsx",
      parserVersion: "1.0",
      vendorNameDetected: `Vendor Beta ${SFX}`,
      resolvedVendorId: VENDOR_B,
      invoiceCount: 0,
      lineCount: 0,
      totalAmount: 0,
      invoiceTotals: [],
      status: "pending_review",
    },
  ]);
  await db.insert(vendorInvoiceImportLines).values([
    {
      batchId: BATCH_B,
      rowIndex: 0,
      invoiceNumber: SHARED_INVOICE_NUMBER,
      invoiceDate: "2026-07-01",
      itemCode: "XYZ-1",
      description: "Beta widget",
      qty: 1,
      extendedAmount: 10,
      category: "Coffee",
      glCode: "5000",
      rawData: {},
    },
    {
      batchId: BATCH_B,
      rowIndex: 1,
      invoiceNumber: SHARED_INVOICE_NUMBER,
      invoiceDate: "2026-07-01",
      itemCode: "XYZ-2",
      description: "Beta gadget",
      qty: 1,
      extendedAmount: 15,
      category: "Coffee",
      glCode: "5000",
      rawData: {},
    },
  ]);
});

afterAll(cleanup);

describe("vendor-scoped invoice dedupe", () => {
  it("does not mark vendor B's invoice as already imported when vendor A used the same number", async () => {
    const preview = await runVendorInvoiceResolutionPreview(BATCH_B, COMPANY_ID);
    expect(preview.vendorId).toBe(VENDOR_B);
    expect(preview.alreadyImportedInvoices).toEqual([]);
    const line = preview.lines[0];
    expect(line.holdReason).not.toBe("already_imported");
  });

  it("marks the invoice as already imported for the SAME vendor", async () => {
    // Repoint the persisted invoice at vendor B — now it is a true duplicate.
    await db.delete(historicalInvoices).where(eq(historicalInvoices.companyId, COMPANY_ID));
    await db.insert(historicalInvoices).values({
      companyId: COMPANY_ID,
      storeId: STORE_ID,
      vendorId: VENDOR_B,
      importBatchId: BATCH_EMPTY, // a different batch — own-batch rows are excluded

      sourceSystem: "ORDERLY",
      sourcePropertyId: PROPERTY_ID,
      sourceInvoiceId: `xlsx:${VENDOR_B}:${SHARED_INVOICE_NUMBER}`,
      invoiceNumber: SHARED_INVOICE_NUMBER,
      invoiceDate: "2026-07-01",
      invoicePeriod: "2026-07",
      vendorNameSnapshot: "Vendor Beta",
      subtotal: 25,
      totalAmount: 25,
      sourceSnapshot: {},
      materialHash: `mh2-${SFX}`,
    });
    const preview = await runVendorInvoiceResolutionPreview(BATCH_B, COMPANY_ID);
    expect(preview.alreadyImportedInvoices).toEqual([SHARED_INVOICE_NUMBER]);
  });
});

describe("post-approval review state", () => {
  it("approving persists resolved + held lines and preview reports the true outcome (not already_imported)", async () => {
    // Remove the vendor-B duplicate created by the previous test so approval persists.
    await db.delete(historicalInvoices).where(eq(historicalInvoices.companyId, COMPANY_ID));

    const result = await approveVendorInvoiceBatch({ batchId: BATCH_B, companyId: COMPANY_ID, userId: null });
    expect(result.status).toBe("approved");
    expect(result.invoicesPersisted).toBe(1);
    expect(result.linesResolved).toBe(1);   // XYZ-2 has a vendor item
    expect(result.linesHeld).toBe(1);       // XYZ-1 does not

    // GL/category evidence must be retained on persisted lines.
    const [inv] = await db.select().from(historicalInvoices)
      .where(eq(historicalInvoices.companyId, COMPANY_ID));
    const persistedLines: any = await db.execute(
      (await import("drizzle-orm")).sql`SELECT gl_snapshot FROM historical_invoice_lines WHERE invoice_id = ${inv.id}`,
    );
    const rows: any[] = Array.isArray(persistedLines) ? persistedLines : (persistedLines?.rows ?? []);
    expect(rows.length).toBe(2);
    for (const r of rows) {
      const gl = typeof r.gl_snapshot === "string" ? JSON.parse(r.gl_snapshot) : r.gl_snapshot;
      expect(gl.glCode).toBe("5000");
      expect(gl.category).toBe("Coffee");
    }

    // Post-approval preview must reflect the persisted outcome, not flag the
    // batch's own invoices as already imported.
    const preview = await runVendorInvoiceResolutionPreview(BATCH_B, COMPANY_ID);
    expect(preview.status).toBe("approved");
    expect(preview.alreadyImportedInvoices).toEqual([]);
    const byCode = new Map(preview.lines.map((l: any) => [l.itemCode, l]));
    expect(byCode.get("XYZ-2")?.status).toBe("resolved");
    expect(byCode.get("XYZ-1")?.status).toBe("held");
    expect(byCode.get("XYZ-1")?.holdReason).toBe("no_vendor_item");
  });
});

describe("concurrent approval idempotency", () => {
  it("two simultaneous approvals both succeed; exactly one persists", async () => {
    const [r1, r2] = await Promise.all([
      approveVendorInvoiceBatch({ batchId: BATCH_EMPTY, companyId: COMPANY_ID, userId: null }),
      approveVendorInvoiceBatch({ batchId: BATCH_EMPTY, companyId: COMPANY_ID, userId: null }),
    ]);
    expect(r1.status).toBe("approved");
    expect(r2.status).toBe("approved");
    expect([r1.alreadyApproved, r2.alreadyApproved].filter(Boolean)).toHaveLength(1);
  });
});
