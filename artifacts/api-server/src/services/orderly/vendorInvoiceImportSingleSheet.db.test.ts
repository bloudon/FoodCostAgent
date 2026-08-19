/**
 * Integration test: stageVendorInvoiceUpload auto-dispatches to the
 * single-sheet parser for Cheney Brothers format workbooks.
 *
 * Covers:
 *   1. A Cheney-format (single-sheet) workbook is accepted by
 *      stageVendorInvoiceUpload — not rejected as "no Line Items sheet".
 *   2. The batch is staged with the correct invoice date (2026-03-10),
 *      vendor name, invoice number, and line count.
 *   3. The staged import lines preserve the Cheney Yukon SKU (456205),
 *      extendedAmount ($31.45), and invoice date — historical evidence intact.
 *   4. The invoice date is stored as the historical effectiveAt reference —
 *      the line's invoiceDate is 2026-03-10, which is a past date that cannot
 *      regress a current price (enforced by recordVendorPrice's chronology
 *      gate; the staging step itself must not call recordVendorPrice).
 *   5. A multi-sheet workbook (with "Line Items" sheet) continues to be routed
 *      to the multi-sheet parser and is not mis-parsed by the single-sheet adapter.
 *   6. A workbook with neither format is rejected with a clear VendorInvoiceParseError.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../../db";
import {
  companies,
  companyStores,
  importSourcePropertyBindings,
  vendorInvoiceImportBatches,
  vendorInvoiceImportLines,
  vendors,
} from "@workspace/db";
import { stageVendorInvoiceUpload } from "./vendorInvoiceImport";
import { VendorInvoiceParseError } from "./vendorInvoiceXlsx";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SFX = `ss-${Date.now().toString(36)}`;
const COMPANY_ID = `inttest-ss-co-${SFX}`;
const STORE_ID = `inttest-ss-store-${SFX}`;
const BINDING_ID = `inttest-ss-bind-${SFX}`;
const PROPERTY_ID = `inttest-ss-prop-${SFX}`;

async function cleanup() {
  await db.delete(vendorInvoiceImportLines).where(
    inArray(
      vendorInvoiceImportLines.batchId,
      db
        .select({ id: vendorInvoiceImportBatches.id })
        .from(vendorInvoiceImportBatches)
        .where(eq(vendorInvoiceImportBatches.companyId, COMPANY_ID)),
    ),
  );
  await db
    .delete(vendorInvoiceImportBatches)
    .where(eq(vendorInvoiceImportBatches.companyId, COMPANY_ID));
  await db
    .delete(importSourcePropertyBindings)
    .where(eq(importSourcePropertyBindings.id, BINDING_ID));
  await db.delete(vendors).where(eq(vendors.companyId, COMPANY_ID));
  await db
    .delete(companyStores)
    .where(eq(companyStores.companyId, COMPANY_ID));
  await db.delete(companies).where(eq(companies.id, COMPANY_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(companies).values({
    id: COMPANY_ID,
    name: "Single Sheet Test Co",
    country: "US",
    timezone: "America/New_York",
    preferredUnitSystem: "imperial",
    costingMethod: "last_cost",
    status: "active",
  });
  await db.insert(companyStores).values({
    id: STORE_ID,
    companyId: COMPANY_ID,
    code: `SS-${SFX}`,
    name: "Single Sheet Store",
    status: "active",
  });
  await db.insert(importSourcePropertyBindings).values({
    id: BINDING_ID,
    companyId: COMPANY_ID,
    sourceSystem: "ORDERLY",
    sourcePropertyId: PROPERTY_ID,
    sourcePropertyLabel: "SS Test Prop",
    destinationStoreId: STORE_ID,
    active: 1,
  });
  // Register Cheney Brothers as a vendor so vendor-name detection resolves
  await db.insert(vendors).values({
    id: `inttest-ss-vendor-${SFX}`,
    companyId: COMPANY_ID,
    name: "Cheney Brothers",
    orderGuideType: "manual",
    active: 1,
    receiveByUnit: 0,
    requires1099: 0,
  });
});

afterAll(cleanup);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCheneyBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Vendor", "Cheney Brothers"],
      ["Invoice #", "05-910224405"],
      ["Delivery Date", "2026-03-10"],
      ["Invoice Total", 698.51],
      ["Line Count", 3],
      ["Orderly Internal Invoice ID", 8532264],
      ["Source", "Orderly authorized extract"],
      [null],
      [
        "Item Code",
        "Description",
        "Pack",
        "Size",
        "UOM",
        "Quantity",
        "Line Total",
        "Catch Weight",
      ],
      ["456205", 'POTATOES YUKON "B" SIZE', 1, 50, "POUND", 1, 31.45, false],
      ["456110", "POTATOES  RED *B* SIZE", 1, 50, "POUND", 1, 39.23, false],
      ["214302", "SAUSAGE ITALIAN BU", 1, 1, "POUND", 2, 75.8, false],
    ]),
    "Invoice Line Items",
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildMultiSheetBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Vendor", "Multi Sheet Vendor"]]),
    "Summary",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      [
        "Invoice #",
        "Date",
        "Item Code",
        "Item Description",
        "Pack Size",
        "Qty",
        "Extended $",
        "Category",
        "GL Code",
      ],
      ["INV-MS-1", "03/10/2026", "ITEM-A", "Widget A", "1/12 EACH", 2, 48, "Goods", "5000"],
    ]),
    "Line Items",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Invoice #", "Date", "Amount"],
      ["INV-MS-1", "03/10/2026", 48],
    ]),
    "Invoice Totals",
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildUnrecognizedBuffer(): Buffer {
  // A workbook with only a "Data" sheet and no recognizable structure
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Foo", "Bar"], ["baz", 1]]),
    "Data",
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("stageVendorInvoiceUpload — single-sheet format (Cheney Brothers)", () => {
  it("accepts the single-sheet workbook and stages the batch without error", async () => {
    const result = await stageVendorInvoiceUpload({
      buffer: buildCheneyBuffer(),
      originalFilename: "CheneyBrothers_Invoice_05-910224405.xlsx",
      companyId: COMPANY_ID,
      userId: null,
    });

    expect(result.duplicateWarning).toBe(false);
    expect(result.batchId).toBeTruthy();
    expect(result.parse.vendorNameDetected).toBe("Cheney Brothers");
    expect(result.parse.invoiceCount).toBe(1);
    expect(result.parse.lineCount).toBe(3);
    expect(result.parse.dateRangeStart).toBe("2026-03-10");
    expect(result.parse.dateRangeEnd).toBe("2026-03-10");
    // Invoice total from header block (preferred over sum)
    expect(result.parse.totalAmount).toBeCloseTo(698.51);
    // Single-sheet warning must be present
    expect(result.parse.warnings.some((w) => /single-sheet/i.test(w))).toBe(true);
  });

  it("persists staged lines with correct Yukon SKU, date, and extendedAmount", async () => {
    // Re-upload same file — should be a duplicate (idempotent)
    const first = await stageVendorInvoiceUpload({
      buffer: buildCheneyBuffer(),
      originalFilename: "CheneyBrothers_Invoice_05-910224405.xlsx",
      companyId: COMPANY_ID,
      userId: null,
    });
    expect(first.duplicateWarning).toBe(true); // second call for same hash

    // Pull staged lines from DB to verify historical evidence preservation
    const lines = await db
      .select()
      .from(vendorInvoiceImportLines)
      .where(eq(vendorInvoiceImportLines.batchId, first.batchId));

    const yukon = lines.find((l) => l.itemCode === "456205");
    expect(yukon).toBeDefined();
    expect(yukon!.description).toContain("YUKON");
    expect(Number(yukon!.extendedAmount)).toBeCloseTo(31.45);
    // Historical invoice date must be preserved exactly
    expect(yukon!.invoiceDate).toBe("2026-03-10");
    // Invoice number from header block
    expect(yukon!.invoiceNumber).toBe("05-910224405");
    // Pack geometry joined from Pack=1, Size=50, UOM=POUND
    expect(yukon!.packSizeRaw).toBe("1/50 POUND");
  });

  it("preserves the March 10 2026 invoice date — it is a historical effectiveAt, not a current price", async () => {
    // The staging step must NOT call recordVendorPrice (that happens at approval).
    // Here we verify the staged line date is 2026-03-10, which is months in the
    // past — the recordVendorPrice chronology gate would reject it for current use.
    const first = await stageVendorInvoiceUpload({
      buffer: buildCheneyBuffer(),
      originalFilename: "CheneyBrothers_Invoice_05-910224405.xlsx",
      companyId: COMPANY_ID,
      userId: null,
    });
    const lines = await db
      .select({ invoiceDate: vendorInvoiceImportLines.invoiceDate })
      .from(vendorInvoiceImportLines)
      .where(eq(vendorInvoiceImportLines.batchId, first.batchId));

    for (const line of lines) {
      expect(line.invoiceDate).toBe("2026-03-10");
    }
  });
});

describe("stageVendorInvoiceUpload — format dispatch", () => {
  it("routes a multi-sheet workbook to the multi-sheet parser (not the single-sheet adapter)", async () => {
    const result = await stageVendorInvoiceUpload({
      buffer: buildMultiSheetBuffer(),
      originalFilename: "multi-sheet.xlsx",
      companyId: COMPANY_ID,
      userId: null,
    });
    expect(result.parse.vendorNameDetected).toBe("Multi Sheet Vendor");
    expect(result.parse.invoiceCount).toBe(1);
    expect(result.parse.lineCount).toBe(1);
    expect(result.parse.dateRangeStart).toBe("2026-03-10");
    // Multi-sheet workbooks do NOT emit a single-sheet warning
    expect(result.parse.warnings.every((w) => !/single-sheet/i.test(w))).toBe(true);
  });

  it("rejects a workbook with neither Line Items nor recognizable single-sheet structure", async () => {
    await expect(
      stageVendorInvoiceUpload({
        buffer: buildUnrecognizedBuffer(),
        originalFilename: "unrecognized.xlsx",
        companyId: COMPANY_ID,
        userId: null,
      }),
    ).rejects.toThrow(VendorInvoiceParseError);
  });
});
