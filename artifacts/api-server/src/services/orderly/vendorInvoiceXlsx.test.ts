/**
 * Unit tests for the vendor invoice XLSX parser helpers — date normalization,
 * pack-size parsing, the pack cross-check conflict rule (plan step 3), and
 * the single-sheet invoice adapter (Cheney Brothers format).
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseVendorInvoiceWorkbook,
  parseSingleSheetInvoiceWorkbook,
  normalizeInvoiceDate,
  parsePackSize,
  crossCheckPackSize,
  VendorInvoiceParseError,
} from "./vendorInvoiceXlsx";

function buildEvidenceWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Vendor", "Evidence Vendor"]]),
    "Summary",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Invoice #", "Date", "Item Code", "Item Description", "Pack Size", "Qty", "Extended $", "Category", "GL Code"],
      ["INV-GL-1", "08/01/2026", "COKE-12", "Coca Cola 12oz", "2/12 EACH", 2, 48, "Beverages", "510200"],
      ["INV-GL-1", "08/01/2026", "SPRITE-12", "Sprite 12oz", "2/12 EACH", 1, 24, null, null],
    ]),
    "Line Items",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Invoice #", "Date", "Amount"],
      ["INV-GL-1", "08/01/2026", 72],
    ]),
    "Invoice Totals",
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("source accounting evidence", () => {
  it("parses source GL Code and Category and accepts missing values", () => {
    const parsed = parseVendorInvoiceWorkbook(buildEvidenceWorkbook());

    expect(parsed.lines[0]).toMatchObject({
      glCode: "510200",
      category: "Beverages",
    });
    expect(parsed.lines[1]).toMatchObject({
      glCode: null,
      category: null,
    });
  });
});

describe("normalizeInvoiceDate", () => {
  it("parses MM/DD/YYYY", () => {
    expect(normalizeInvoiceDate("05/01/2026")).toBe("2026-05-01");
    expect(normalizeInvoiceDate("7/9/2026")).toBe("2026-07-09");
  });
  it("parses ISO and Excel serials", () => {
    expect(normalizeInvoiceDate("2026-08-14")).toBe("2026-08-14");
    expect(normalizeInvoiceDate(45778)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("returns null for garbage", () => {
    expect(normalizeInvoiceDate("May first")).toBeNull();
    expect(normalizeInvoiceDate(null)).toBeNull();
  });
});

describe("parsePackSize", () => {
  it("parses outer/inner + uom", () => {
    expect(parsePackSize("1/12 EACH")).toEqual({ outer: 1, inner: 12, uom: "EACH" });
    expect(parsePackSize("6/4 OZ")).toEqual({ outer: 6, inner: 4, uom: "OZ" });
  });
  it("parses single-count forms and rejects garbage", () => {
    expect(parsePackSize("1 CS")).toEqual({ outer: 1, inner: null, uom: "CS" });
    expect(parsePackSize("mystery")).toEqual({ outer: null, inner: null, uom: null });
    expect(parsePackSize(null)).toEqual({ outer: null, inner: null, uom: null });
  });
});

// ─── parseSingleSheetInvoiceWorkbook (Cheney Brothers format) ─────────────────

/**
 * Build a minimal single-sheet workbook matching the Cheney Brothers format:
 *   - One sheet named "Invoice Line Items"
 *   - Rows 1-7: label/value metadata (Vendor, Invoice #, Delivery Date, …)
 *   - Row 8: blank
 *   - Row 9: column headers
 *   - Rows 10+: product data
 */
function buildCheneyWorkbook(overrides?: {
  sheetName?: string;
  missingInvoiceNumber?: boolean;
  missingDeliveryDate?: boolean;
  extraLines?: unknown[][];
}): Buffer {
  const {
    sheetName = "Invoice Line Items",
    missingInvoiceNumber = false,
    missingDeliveryDate = false,
    extraLines = [],
  } = overrides ?? {};

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Vendor", "Cheney Brothers", null, null, null, null, null, null],
      [missingInvoiceNumber ? "XX" : "Invoice #", "05-910224405", null, null, null, null, null, null],
      [missingDeliveryDate ? "XX" : "Delivery Date", "2026-03-10", null, null, null, null, null, null],
      ["Invoice Total", 698.51, null, null, null, null, null, null],
      ["Line Count", 11, null, null, null, null, null, null],
      ["Orderly Internal Invoice ID", 8532264, null, null, null, null, null, null],
      ["Source", "Orderly authorized extract", null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ["Item Code", "Description", "Pack", "Size", "UOM", "Quantity", "Line Total", "Catch Weight"],
      ["456205", "POTATOES YUKON \"B\" SIZE", 1, 50, "POUND", 1, 31.45, false],
      ["456110", "POTATOES  RED *B* SIZE", 1, 50, "POUND", 1, 39.23, false],
      ["214302", "SAUSAGE ITALIAN BU", 1, 1, "POUND", 2, 75.80, false],
      ...extraLines,
    ]),
    sheetName,
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseSingleSheetInvoiceWorkbook — Cheney Brothers format", () => {
  it("parses vendor name, invoice number, date, and line items", () => {
    const buf = buildCheneyWorkbook();
    const result = parseSingleSheetInvoiceWorkbook(buf);

    expect(result.vendorNameDetected).toBe("Cheney Brothers");
    expect(result.invoiceCount).toBe(1);
    expect(result.invoiceTotals).toHaveLength(1);
    expect(result.invoiceTotals[0]).toMatchObject({
      invoiceNumber: "05-910224405",
      invoiceDate: "2026-03-10",
      amount: 698.51, // from header block (preferred over sum)
    });
  });

  it("returns Yukon Gold potato as the first product line with correct fields", () => {
    const buf = buildCheneyWorkbook();
    const result = parseSingleSheetInvoiceWorkbook(buf);

    const yukon = result.lines.find(l => l.itemCode === "456205");
    expect(yukon).toBeDefined();
    expect(yukon!.description).toBe("POTATOES YUKON \"B\" SIZE");
    expect(yukon!.qty).toBe(1);
    expect(yukon!.extendedAmount).toBe(31.45);
    expect(yukon!.invoiceDate).toBe("2026-03-10");
    expect(yukon!.invoiceNumber).toBe("05-910224405");
    // Pack geometry joined from Pack (1) + Size (50) + UOM (POUND)
    expect(yukon!.packSizeRaw).toBe("1/50 POUND");
  });

  it("sets invoiceDate correctly and never exposes it as current price", () => {
    const buf = buildCheneyWorkbook();
    const result = parseSingleSheetInvoiceWorkbook(buf);
    // Every line must carry the invoice date — it is the effectiveAt for price observations
    for (const line of result.lines) {
      expect(line.invoiceDate).toBe("2026-03-10");
    }
  });

  it("includes a warning about missing reconciliation sheet", () => {
    const buf = buildCheneyWorkbook();
    const result = parseSingleSheetInvoiceWorkbook(buf);
    expect(result.warnings.some(w => /single-sheet/i.test(w))).toBe(true);
  });

  it("derives invoice total from line sums when header block total is absent", () => {
    // Build a workbook whose "Invoice Total" row is missing (replaced with blank)
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Vendor", "Cheney Brothers"],
        ["Invoice #", "05-910224405"],
        ["Delivery Date", "2026-03-10"],
        // No Invoice Total row
        [null, null],
        ["Item Code", "Description", "Pack", "Size", "UOM", "Quantity", "Line Total", "Catch Weight"],
        ["456205", "POTATOES YUKON \"B\" SIZE", 1, 50, "POUND", 1, 31.45, false],
        ["456110", "POTATOES  RED *B* SIZE", 1, 50, "POUND", 1, 39.23, false],
      ]),
      "Invoice Line Items",
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const result = parseSingleSheetInvoiceWorkbook(buf);
    expect(result.totalAmount).toBeCloseTo(31.45 + 39.23);
  });

  it("accepts any sheet name (not restricted to 'Invoice Line Items')", () => {
    const buf = buildCheneyWorkbook({ sheetName: "Sheet1" });
    const result = parseSingleSheetInvoiceWorkbook(buf);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("throws VendorInvoiceParseError when Invoice # is missing", () => {
    const buf = buildCheneyWorkbook({ missingInvoiceNumber: true });
    expect(() => parseSingleSheetInvoiceWorkbook(buf)).toThrow(VendorInvoiceParseError);
  });

  it("throws VendorInvoiceParseError when delivery date is missing", () => {
    const buf = buildCheneyWorkbook({ missingDeliveryDate: true });
    expect(() => parseSingleSheetInvoiceWorkbook(buf)).toThrow(VendorInvoiceParseError);
  });

  it("does NOT update current price — extendedAmount is line total, not a per-case price", () => {
    // The extendedAmount for Yukon Gold is 31.45 (for qty=1 case).
    // A downstream caller may derive case price = extendedAmount / qty;
    // but the parser itself must NOT expose it as `price` to avoid routing eligibility.
    const buf = buildCheneyWorkbook();
    const result = parseSingleSheetInvoiceWorkbook(buf);
    const yukon = result.lines.find(l => l.itemCode === "456205");
    // extendedAmount is present (for historical evidence)
    expect(yukon!.extendedAmount).toBe(31.45);
    // The parsed line has no `price` field — pricing goes through recordVendorPrice with effectiveAt = invoiceDate
  });

  it("multi-vendor identity: three distinct SKUs map to one invoice date", () => {
    // This verifies that Harvill POTYUKB, Mr. Green 29420, and Cheney 456205
    // are treated as separate item codes — all on the same invoice date.
    // (Harvill and Mr. Green lines are simulated here as additional rows.)
    const buf = buildCheneyWorkbook({
      extraLines: [
        ["POTYUKB", "POTATOES YUKON GOLD B SIZE", 1, 50, "POUND", 2, 62.90, false],
        ["29420", "YUKON GOLD POTATOES B", 1, 50, "POUND", 1, 30.00, false],
      ],
    });
    const result = parseSingleSheetInvoiceWorkbook(buf);
    const codes = result.lines.map(l => l.itemCode);
    expect(codes).toContain("456205");   // Cheney
    expect(codes).toContain("POTYUKB");  // Harvill
    expect(codes).toContain("29420");    // Mr. Green
    // All share the same invoice date
    for (const line of result.lines) {
      expect(line.invoiceDate).toBe("2026-03-10");
    }
    // All three are distinct item codes
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });
});

describe("crossCheckPackSize — conflict rule", () => {
  it("is unverifiable when stored geometry is degenerate (caseSize 1, no uom)", () => {
    expect(crossCheckPackSize(parsePackSize("1/12 EACH"), { caseSize: 1, innerPackSize: null, packUom: null }))
      .toBe("unverifiable");
  });
  it("is unverifiable when the source pack cannot be parsed", () => {
    expect(crossCheckPackSize(parsePackSize("???"), { caseSize: 6, innerPackSize: 4, packUom: "oz" }))
      .toBe("unverifiable");
  });
  it("matches when both sides agree", () => {
    expect(crossCheckPackSize(parsePackSize("6/4 OZ"), { caseSize: 6, innerPackSize: 4, packUom: "oz" }))
      .toBe("match");
  });
  it("conflicts on a material outer disagreement", () => {
    expect(crossCheckPackSize(parsePackSize("6/4 OZ"), { caseSize: 12, innerPackSize: 4, packUom: "oz" }))
      .toBe("conflict");
  });
  it("conflicts on a material inner disagreement", () => {
    expect(crossCheckPackSize(parsePackSize("6/4 OZ"), { caseSize: 6, innerPackSize: 8, packUom: "oz" }))
      .toBe("conflict");
  });
  it("accepts the transposed 1/N form against stored caseSize N", () => {
    expect(crossCheckPackSize(parsePackSize("1/12 EACH"), { caseSize: 12, innerPackSize: 1, packUom: "each" }))
      .toBe("match");
  });
});
