/**
 * Sheet-name tolerance tests (Task #1183): accept the canonical
 * "Invoice Totals" sheet or a single unambiguous "Invoice Totals ..." variant;
 * fail closed when multiple candidate totals sheets exist.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseVendorInvoiceWorkbook, VendorInvoiceParseError } from "./vendorInvoiceXlsx";

function buildWorkbook(totalsSheetNames: string[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Vendor", "Test Vendor"]]),
    "Summary",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Invoice #", "Date", "Item Code", "Item Description", "Pack Size", "Qty", "Extended $", "Category", "GL Code"],
      ["INV-1", "09/10/2025", "100", "TEST KEG", "1/1 KEG5G", 2, 200, "Beer", "510200"],
    ]),
    "Line Items",
  );
  for (const name of totalsSheetNames) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Invoice #", "Date", "Amount"],
        ["INV-1", "09/10/2025", 250],
      ]),
      name,
    );
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("Invoice Totals sheet-name tolerance", () => {
  it("accepts the canonical sheet name", () => {
    const parsed = parseVendorInvoiceWorkbook(buildWorkbook(["Invoice Totals"]));
    expect(parsed.invoiceTotals).toEqual([{ invoiceNumber: "INV-1", invoiceDate: "2025-09-10", amount: 250 }]);
  });

  it("accepts a single unambiguous 'Invoice Totals ...' variant (extra columns ignored)", () => {
    const parsed = parseVendorInvoiceWorkbook(buildWorkbook(["Invoice Totals (Deposit Ledger)"]));
    expect(parsed.invoiceTotals).toEqual([{ invoiceNumber: "INV-1", invoiceDate: "2025-09-10", amount: 250 }]);
  });

  it("fails closed when no totals sheet exists", () => {
    expect(() => parseVendorInvoiceWorkbook(buildWorkbook([]))).toThrow(VendorInvoiceParseError);
  });

  it("fails closed when multiple candidate totals sheets exist", () => {
    expect(() =>
      parseVendorInvoiceWorkbook(buildWorkbook(["Invoice Totals", "Invoice Totals (Deposit Ledger)"])),
    ).toThrow(/multiple candidate totals sheets/i);
  });
});
