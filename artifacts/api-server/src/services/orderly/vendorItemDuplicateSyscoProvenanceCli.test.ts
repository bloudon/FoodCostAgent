import { describe, expect, it, vi } from "vitest";
import { runSyscoDuplicateProvenance } from "./vendorItemDuplicateSyscoProvenanceCli";
import { VENDOR_ITEM_REFERENCE_SOURCES, referenceKey } from "./vendorItemDuplicateReferenceCompatibility";

const requiredReferenceColumns = VENDOR_ITEM_REFERENCE_SOURCES
  .filter((source) => !source.legacyOptional)
  .map(referenceKey);

const schemaRows = [
  ["vendor_items", ["id", "vendor_id", "inventory_item_id", "vendor_sku", "purchase_unit_id", "case_size", "last_price", "last_case_price", "inner_pack_size", "pack_uom", "active"]],
  ["vendors", ["id", "name", "company_id"]],
  ["inventory_items", ["id", "company_id"]],
  ["units", ["id", "name"]],
  ["inventory_item_price_history", ["vendor_item_id", "inventory_item_id", "effective_at", "created_at", "case_price", "price_per_unit", "source", "note"]],
  ["vendor_item_external_mappings", ["vendor_item_id", "company_id", "created_at"]],
  ["order_guides", ["id", "vendor_id", "company_id", "fetched_at", "effective_date"]],
  ["order_guide_lines", ["order_guide_id", "vendor_sku", "case_size", "inner_pack", "uom", "case_size_raw", "pack_size", "price", "product_name"]],
  ["inventory_import_batches", ["id", "company_id", "uploaded_at", "inventory_date"]],
  ["inventory_import_rows", ["batch_id", "source_item_code", "resolved_inventory_item_id", "case_quantity", "inner_pack_quantity", "case_unit", "raw_description", "supplier_raw", "package_price", "pack_parse_status"]],
  ["historical_invoice_lines", ["vendor_item_id", "company_id", "invoice_id", "unit_price", "quantity", "source_external_id", "pack_snapshot", "imported_at"]],
  ["historical_invoices", ["id", "company_id", "invoice_date"]],
].flatMap(([table, columns]) => (columns as string[]).map((column_name) => ({ table_name: table, column_name })));

const syscoRows = [
  {
    id: "04f822ba-fb2d-479e-9f9b-6aefc4b0af90",
    vendorId: "vendor-1",
    inventoryItemId: "2030960c-3c95-49fd-8ccc-56eae6b5e615",
    vendorSku: "7664436",
    purchaseUnitId: "ea",
    caseSize: 12,
    lastPrice: 2,
    lastCasePrice: 24,
    vendorName: "Sysco",
    vendorCompanyId: "company-1",
    inventoryCompanyId: "company-1",
    unitName: "Each",
  },
  {
    id: "ca185955-ce85-4c92-be7e-875974c0100d",
    vendorId: "vendor-1",
    inventoryItemId: "2030960c-3c95-49fd-8ccc-56eae6b5e615",
    vendorSku: "7664436",
    purchaseUnitId: "ea",
    caseSize: 1,
    lastPrice: 2,
    lastCasePrice: 2,
    vendorName: "Sysco",
    vendorCompanyId: "company-1",
    inventoryCompanyId: "company-1",
    unitName: "Each",
  },
];

describe("Sysco provenance collector guards", () => {
  it("uses an explicit read-only transaction and emits a safe successful chronology for one company", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([]) // SET TRANSACTION READ ONLY
      .mockResolvedValueOnce([{ db: "production-db" }])
      .mockResolvedValueOnce(requiredReferenceColumns.map((key) => {
        const [table_name, column_name] = key.split(".");
        return { table_name, column_name };
      }))
      .mockResolvedValueOnce(schemaRows)
      .mockResolvedValueOnce(syscoRows)
      .mockResolvedValue([]); // every evidence stream is empty
    const emit = vi.fn(() => ({ jsonPath: "/secure/sysco.json", markdownPath: "/secure/sysco.md" }));

    const report = await runSyscoDuplicateProvenance({ execute, emit, expectedCompanyId: "company-1" });

    expect(execute).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(report.database).toBe("production-db");
    expect(report.conclusion.conclusion).toBe("INSUFFICIENT_EVIDENCE");
    expect(report.target.vendorItemIds).toHaveLength(2);
    expect(emit).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(10);
    const fixedRowQuery = execute.mock.calls[4][0] as { queryChunks?: Array<{ value?: string[] }> };
    const fixedRowText = fixedRowQuery.queryChunks
      ?.flatMap((chunk) => chunk.value ?? [])
      .join("") ?? "";
    expect(fixedRowText).toContain("v.company_id = 'company-1'");
    expect(fixedRowText).toContain("ii.company_id = 'company-1'");
  });

  it("refuses a cross-company fixed-row binding before reading any evidence stream", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ db: "production-db" }])
      .mockResolvedValueOnce(requiredReferenceColumns.map((key) => {
        const [table_name, column_name] = key.split(".");
        return { table_name, column_name };
      }))
      .mockResolvedValueOnce(schemaRows)
      .mockResolvedValueOnce([
        syscoRows[0],
        { ...syscoRows[1], inventoryCompanyId: "other-company" },
      ]);

    await expect(runSyscoDuplicateProvenance({ execute, emit: vi.fn(), expectedCompanyId: "company-1" })).rejects.toThrow(/binding drifted/);
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("refuses fixed rows that agree with each other but drift from the immutable reviewed company scope", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ db: "production-db" }])
      .mockResolvedValueOnce(requiredReferenceColumns.map((key) => {
        const [table_name, column_name] = key.split(".");
        return { table_name, column_name };
      }))
      .mockResolvedValueOnce(schemaRows)
      .mockResolvedValueOnce(syscoRows);

    await expect(runSyscoDuplicateProvenance({ execute, emit: vi.fn(), expectedCompanyId: "reviewed-company" }))
      .rejects.toThrow(/immutable reviewed company scope/);
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("fails before source evidence queries when reference-column drift is present", async () => {
    let calls = 0;
    const execute = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return [];
      if (calls === 2) return [{ db: "production-db" }];
      if (calls === 3) return [{ table_name: "unexpected", column_name: "vendor_item_id" }];
      throw new Error("source evidence query must not run");
    });

    await expect(runSyscoDuplicateProvenance({ execute, emit: vi.fn(), expectedCompanyId: "company-1" })).rejects.toThrow(/Reference column set drifted/);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
  });

  it("fails before vendor-item reads when source schema cannot establish the exact item bridge", async () => {
    let calls = 0;
    const execute = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return [];
      if (calls === 2) return [{ db: "production-db" }];
      if (calls === 3) {
        return requiredReferenceColumns.map((key) => {
          const [table_name, column_name] = key.split(".");
          return { table_name, column_name };
        });
      }
      if (calls === 4) return [];
      throw new Error("vendor-item source query must not run without minimum schema");
    });

    await expect(runSyscoDuplicateProvenance({ execute, emit: vi.fn(), expectedCompanyId: "company-1" })).rejects.toThrow(/minimum vendor, vendor-item, or unit schema/);
    expect(execute).toHaveBeenCalledTimes(4);
  });
});