/**
 * Unit tests for the vendor invoice XLSX parser helpers — date normalization,
 * pack-size parsing, and the pack cross-check conflict rule (plan step 3).
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseVendorInvoiceWorkbook,
  normalizeInvoiceDate,
  parsePackSize,
  crossCheckPackSize,
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
