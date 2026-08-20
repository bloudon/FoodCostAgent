import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeVendorItemDuplicateClassifier,
  runVendorItemDuplicateClassifier,
} from "./vendorItemDuplicateClassifierCli";
import { VENDOR_ITEM_REFERENCE_SOURCES, referenceKey } from "./vendorItemDuplicateReferenceCompatibility";

const requiredReferenceColumns = VENDOR_ITEM_REFERENCE_SOURCES
  .filter((source) => !source.legacyOptional)
  .map(referenceKey);
const optionalReferenceColumn = "vendor_invoice_import_lines.resolved_vendor_item_id";

function successfulRuntime(includeOptional: boolean, optionalReferenceCount = 0) {
  const liveColumns = includeOptional
    ? [...requiredReferenceColumns, optionalReferenceColumn]
    : requiredReferenceColumns;
  const presentSourceKeys = VENDOR_ITEM_REFERENCE_SOURCES
    .filter((source) => includeOptional || !source.legacyOptional)
    .map(referenceKey);
  const presentSourceCount = presentSourceKeys.length;
  const vendorRowsCall = 4 + presentSourceCount + 1;
  const skuConstraintCall = vendorRowsCall + 1;
  let call = 0;
  let report: any;

  return {
    runtime: {
      execute: async () => {
        call += 1;
        if (call === 1) return [{ db: "test-db", addr: "127.0.0.1" }];
        if (call === 2) {
          return liveColumns.map((key) => {
            const [table_name, column_name] = key.split(".");
            return { table_name, column_name };
          });
        }
        if (call >= 5 && call < vendorRowsCall) {
          const sourceKey = presentSourceKeys[call - 5];
          return sourceKey === optionalReferenceColumn && optionalReferenceCount > 0
            ? [{ id: "optional-ref-item", n: optionalReferenceCount }]
            : [];
        }
        if (call === vendorRowsCall) return [];
        if (call === skuConstraintCall) return [{ n: 0 }];
        return [];
      },
      emitReport: (nextReport: any) => {
        report = nextReport;
        return { jsonPath: "/tmp/report.json", mdPath: "/tmp/report.md" };
      },
      log: vi.fn(),
    },
    getReport: () => report,
  };
}

describe("vendor-item duplicate classifier CLI guard order", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("stops before classification or report emission when an unexpected reference consumer appears", async () => {
    let queryCount = 0;
    const classify = vi.fn();
    const emitReport = vi.fn();
    const execute = vi.fn(async () => {
      queryCount += 1;
      if (queryCount === 1) return [{ db: "test-db", addr: "127.0.0.1" }];
      if (queryCount === 2) {
        return requiredReferenceColumns
          .concat("unexpected_table.vendor_item_id")
          .map((key) => {
            const [table_name, column_name] = key.split(".");
            return { table_name, column_name };
          });
      }
      throw new Error("classification queries must not execute after guard failure");
    });

    await expect(runVendorItemDuplicateClassifier({ execute, classify, emitReport, log: vi.fn() }))
      .rejects.toThrow(/Reference column set drifted/);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(classify).not.toHaveBeenCalled();
    expect(emitReport).not.toHaveBeenCalled();
  });

  it("returns a non-zero process result, emits no report, and skips classification when a required consumer is missing", async () => {
    let queryCount = 0;
    const classify = vi.fn();
    const emitReport = vi.fn();
    const error = vi.fn();
    const execute = vi.fn(async () => {
      queryCount += 1;
      if (queryCount === 1) return [{ db: "test-db", addr: "127.0.0.1" }];
      if (queryCount === 2) {
        return requiredReferenceColumns.slice(1).map((key) => {
          const [table_name, column_name] = key.split(".");
          return { table_name, column_name };
        });
      }
      throw new Error("classification queries must not execute after guard failure");
    });

    await expect(executeVendorItemDuplicateClassifier({ execute, classify, emitReport, error, log: vi.fn() }))
      .resolves.toBe(1);

    expect(process.exitCode).toBe(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(classify).not.toHaveBeenCalled();
    expect(emitReport).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Reference column set drifted/));
  });

  it("emits an explicit legacy-optional absence in a successful legacy-schema report", async () => {
    const fixture = successfulRuntime(false);

    await expect(runVendorItemDuplicateClassifier(fixture.runtime)).resolves.toBeDefined();

    expect(fixture.getReport().references.sourceCompatibility[optionalReferenceColumn]).toEqual({
      present: false,
      applicableReferences: 0,
      compatibilityState: "legacy_optional_absent",
    });
  });

  it("counts the optional invoice-import references when the newer schema contains the column", async () => {
    const fixture = successfulRuntime(true, 3);

    await expect(runVendorItemDuplicateClassifier(fixture.runtime)).resolves.toBeDefined();

    expect(fixture.getReport().references.sourceCompatibility[optionalReferenceColumn]).toEqual({
      present: true,
      applicableReferences: 3,
      compatibilityState: "current_present",
    });
    expect(fixture.getReport().references.totalsByColumn[optionalReferenceColumn]).toBe(3);
  });
});