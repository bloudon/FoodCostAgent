import { afterEach, describe, expect, it, vi } from "vitest";
import { executeVendorItemDuplicateGate2Readiness } from "./vendorItemDuplicateGate2ReadinessCli";
import { EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT } from "./vendorItemDuplicateGate2Readiness";
import { VENDOR_ITEM_REFERENCE_SOURCES, referenceKey } from "./vendorItemDuplicateReferenceCompatibility";

const requiredReferences = VENDOR_ITEM_REFERENCE_SOURCES
  .filter((source) => !source.legacyOptional)
  .map(referenceKey);

function approvedProductionReport() {
  const firstGroupLosers = EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT - 2428;
  const first = Array.from({ length: firstGroupLosers + 1 }, (_, index) => `vi-${index}`);
  return {
    database: "fnbcostpro",
    readOnly: true,
    totals: { duplicateGroups: 2430, excessRows: 6039 },
    classes: { A: { groups: 2429, excessRows: EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT } },
    groups: [
      { class: "A", rowIds: first, proposedSurvivorId: first[0], proposedDeletions: firstGroupLosers },
      ...Array.from({ length: 2428 }, (_, index) => ({
        class: "A",
        rowIds: [`survivor-${index}`, `loser-${index}`],
        proposedSurvivorId: `survivor-${index}`,
        proposedDeletions: 1,
      })),
    ],
  };
}

function successRuntime(ediPayload: unknown) {
  let call = 0;
  let report: any;
  const syscoRow = {
    vendorId: "vendor-sysco",
    inventoryItemId: "inventory-1",
    vendorSku: "7664436",
    brandName: "Sysco",
    purchaseUnitId: "unit-case",
    caseSize: 12,
    innerPackSize: 1,
    packUom: "EA",
    lastPrice: 1,
    lastCasePrice: 12,
    active: 1,
    priceSource: "legacy",
    canonicalQtyPerPurchaseUnit: 12,
    pricingBasis: "purchase_unit",
    isVariableWeight: 0,
    packGeometryStatus: "verified",
    unitName: "Each",
    unitAbbreviation: "ea",
    unitKind: "count",
  };
  const referenceCountCallsEnd = 4 + requiredReferences.length;

  return {
    runtime: {
      execute: async () => {
        call += 1;
        if (call === 1) return [{ db: "fnbcostpro" }];
        if (call === 2) {
          return requiredReferences.map((key) => {
            const [table_name, column_name] = key.split(".");
            return { table_name, column_name };
          });
        }
        if (call === 3) return [{ id: "sysco-1", ...syscoRow }, { id: "sysco-2", ...syscoRow, innerPackSize: 2 }];
        if (call === 4) return [];
        if (call <= referenceCountCallsEnd) return [];
        if (call === referenceCountCallsEnd + 1) return [{ n: 1 }];
        if (call === referenceCountCallsEnd + 2) return [{ id: "edi-1", payloadJson: ediPayload }];
        throw new Error("unexpected database query");
      },
      loadClassifierReport: approvedProductionReport,
      emitReport: (next: any) => {
        report = next;
        return { jsonPath: "/secure/report.json", markdownPath: "/secure/report.md" };
      },
      log: vi.fn(),
      error: vi.fn(),
    },
    report: () => report,
  };
}

describe("Gate 2 readiness CLI guard order", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("fails before report parsing, classification evidence, EDI reads, or report output on unexpected reference drift", async () => {
    let calls = 0;
    const loadClassifierReport = vi.fn();
    const emitReport = vi.fn();
    const execute = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return [{ db: "fnbcostpro" }];
      if (calls === 2) return [{ table_name: "unexpected", column_name: "vendor_item_id" }];
      throw new Error("data queries must not run after reference guard failure");
    });

    await expect(executeVendorItemDuplicateGate2Readiness({
      execute,
      loadClassifierReport,
      emitReport,
      log: vi.fn(),
      error: vi.fn(),
    })).resolves.toBe(1);

    expect(process.exitCode).toBe(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(loadClassifierReport).not.toHaveBeenCalled();
    expect(emitReport).not.toHaveBeenCalled();
  });

  it("fails closed when the externally supplied classifier report names a different database", async () => {
    const fixture = successRuntime({ po: { lines: [] } });
    const originalExecute = fixture.runtime.execute;
    const emitReport = vi.fn();
    let calls = 0;
    fixture.runtime.execute = async (query: unknown) => {
      calls += 1;
      const result = await originalExecute(query);
      return calls === 1 ? [{ db: "different-production-database" }] : result;
    };
    fixture.runtime.emitReport = emitReport;

    await expect(executeVendorItemDuplicateGate2Readiness(fixture.runtime)).resolves.toBe(1);

    expect(process.exitCode).toBe(1);
    expect(calls).toBe(2);
    expect(emitReport).not.toHaveBeenCalled();
  });

  it("supports the reviewed legacy schema and explicitly closes the EDI risk when no production loser is persisted", async () => {
    const fixture = successRuntime({ po: { lines: [{ vendorItemId: "survivor-id" }] } });

    await expect(executeVendorItemDuplicateGate2Readiness(fixture.runtime)).resolves.toBe(0);

    expect(fixture.report().referenceCompatibility["vendor_invoice_import_lines.resolved_vendor_item_id"]).toEqual({
      present: false,
      applicableReferences: 0,
      compatibilityState: "legacy_optional_absent",
    });
    expect(fixture.report().ediSoftReferenceEvidence.softReferenceRisk).toBe("CLOSED");
    expect(fixture.report().syscoClassB.rows).toHaveLength(2);
  });

  it("emits the sanitized readiness report and exits STOP when a proposed production loser is persisted in EDI", async () => {
    const fixture = successRuntime({ po: { lines: [{ vendorItemId: "vi-1" }] } });

    await expect(executeVendorItemDuplicateGate2Readiness(fixture.runtime)).resolves.toBe(2);

    expect(process.exitCode).toBe(2);
    expect(fixture.report().ediSoftReferenceEvidence).toMatchObject({
      softReferenceRisk: "STOP",
      messagesContainingProposedLoserIds: 1,
      distinctProposedLoserIdsReferenced: 1,
    });
    expect(JSON.stringify(fixture.report().ediSoftReferenceEvidence)).not.toContain("vi-1");
  });
});