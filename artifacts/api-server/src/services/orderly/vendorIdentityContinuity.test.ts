import { describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import {
  applyVendorIdentityMerge,
  buildVendorIdentityReport,
  compareVendorIdentityPair,
  invoiceFormat,
  VENDOR_IDENTITY_REFERENCE_SOURCES,
  type VendorIdentityEvidence,
  type VendorIdentityVendor,
} from "./vendorIdentityContinuity";

const COMPANY = "bay-hill";
const gf: VendorIdentityVendor = { id: "gfs", companyId: COMPANY, name: "GFs Store", active: 1 };
const gordon: VendorIdentityVendor = { id: "gordon", companyId: COMPANY, name: "Gordon Food Service", active: 1 };
const albert: VendorIdentityVendor = { id: "albert", companyId: COMPANY, name: "Albert Uster Fine Foods", active: 1 };
const aui: VendorIdentityVendor = { id: "aui", companyId: COMPANY, name: "AUI Fine Foods", active: 1 };
const pinkney: VendorIdentityVendor = { id: "pinkney", companyId: COMPANY, name: "Pinkney Transportation LLC", active: 1 };
const rlb: VendorIdentityVendor = { id: "rlb", companyId: COMPANY, name: "RLB Transport", active: 1 };

function evidence(
  vendor: VendorIdentityVendor,
  invoiceNumber: string,
  invoiceDate: string,
  vendorExternalId: string | null = null,
): VendorIdentityEvidence {
  return {
    vendorId: vendor.id,
    companyId: COMPANY,
    vendorName: vendor.name,
    invoiceNumber,
    invoiceDate,
    sourceSystem: "ORDERLY",
    sourcePropertyId: "bay-hill",
    sourceInvoiceId: `${vendor.id}-${invoiceNumber}`,
    vendorExternalId,
  };
}

describe("vendor identity invoice continuity", () => {
  it("recognizes invoice formats without using name similarity", () => {
    expect(invoiceFormat("963139987").kind).toBe("numeric");
    expect(invoiceFormat("IVC1562089").prefix).toBe("IVC");
    expect(invoiceFormat("P5335").prefix).toBe("P");
    expect(invoiceFormat("2024/08/30").kind).toBe("mixed");
  });

  it("proves the GFs/Gordon pattern only when persisted evidence reconciles", () => {
    const rows = [
      evidence(gf, "963136539", "2026-01-01", "25636"),
      evidence(gf, "963139987", "2026-01-03", "25636"),
      evidence(gf, "963142737", "2026-01-05", "25636"),
      evidence(gordon, "963138000", "2026-01-02", "487"),
      evidence(gordon, "963139987", "2026-01-03", "487"),
      evidence(gordon, "963145000", "2026-01-06", "487"),
    ];
    const result = compareVendorIdentityPair(gf, gordon, rows);
    expect(result.classification).toBe("proven_same_vendor");
    expect(result.evidenceStatus).toBe("reconciled");
    expect(result.metrics.sharedInvoiceNumbers).toEqual(["963139987"]);
    expect(result.metrics.interleavedSequence).toBe(true);
  });

  it("does not treat the same invoice number in another source property as shared evidence", () => {
    const left = evidence(gf, "963139987", "2026-01-03", "25636");
    const right = { ...evidence(gordon, "963139987", "2026-01-03", "487"), sourcePropertyId: "another-property" };
    const result = compareVendorIdentityPair(gf, gordon, [left, right]);
    expect(result.classification).toBe("insufficient_evidence");
    expect(result.evidenceStatus).toBe("not_reconciled");
    expect(result.metrics.sharedInvoiceNumbers).toEqual([]);
  });

  it("does not reconcile GFs/Gordon when supplier IDs are attached to the wrong vendor", () => {
    const rows = [
      evidence(gf, "963139987", "2026-01-03", "487"),
      evidence(gordon, "963139987", "2026-01-03", "25636"),
    ];
    const result = compareVendorIdentityPair(gf, gordon, rows);
    expect(result.classification).toBe("likely_same_vendor_review");
    expect(result.evidenceStatus).toBe("not_reconciled");
  });

  it("does not combine claim facts from different source properties", () => {
    const rows = [
      // Property A has the duplicate but not the expected supplier IDs.
      evidence(gf, "963139987", "2026-01-03", "wrong-gfs"),
      evidence(gordon, "963139987", "2026-01-03", "wrong-gordon"),
      // Property B proves only the GFs half of the source claim.
      evidence(gf, "963139987", "2026-02-03", "25636"),
      evidence(gordon, "963140000", "2026-02-03", "487"),
      // Property C proves only the Gordon half of the source claim.
      { ...evidence(gf, "963141000", "2026-03-03", "25636"), sourcePropertyId: "property-c" },
      { ...evidence(gordon, "963139987", "2026-03-03", "487"), sourcePropertyId: "property-c" },
    ];
    rows[0] = { ...rows[0], sourcePropertyId: "property-a" };
    rows[1] = { ...rows[1], sourcePropertyId: "property-a" };
    rows[2] = { ...rows[2], sourcePropertyId: "property-b" };
    rows[3] = { ...rows[3], sourcePropertyId: "property-b" };
    const result = compareVendorIdentityPair(gf, gordon, rows);
    expect(result.classification).toBe("likely_same_vendor_review");
    expect(result.evidenceStatus).toBe("not_reconciled");
  });

  it("recognizes the one-entry Albert/AUI embedded-sequence pattern", () => {
    const rows = [
      evidence(albert, "IVC1562089", "2024-08-15"),
      // The date containment is decisive here; the numeric suffixes need not
      // literally bracket the isolated full-name invoice.
      evidence(aui, "IVC0001000", "2024-07-01"),
      evidence(aui, "IVC0002000", "2024-09-01"),
    ];
    const result = compareVendorIdentityPair(albert, aui, rows);
    expect(result.classification).toBe("proven_same_vendor");
    expect(result.evidenceStatus).toBe("reconciled");
    expect(result.metrics.embeddedSingleEntry).toBe("left_in_right");
  });

  it("keeps Pinkney/RLB as a legitimate handoff", () => {
    const rows = [
      evidence(pinkney, "P5335", "2024-08-30"),
      evidence(pinkney, "P5372", "2024-08-20"),
      evidence(rlb, "1023", "2024-09-02"),
      evidence(rlb, "1057", "2024-09-10"),
    ];
    const result = compareVendorIdentityPair(pinkney, rlb, rows);
    expect(result.classification).toBe("distinct_vendor_or_legitimate_handoff");
    expect(result.metrics.cleanCutover.detected).toBe(true);
    expect(result.metrics.cleanCutover.gapDays).toBe(3);
  });

  it("does not turn names alone into a merge", () => {
    const result = compareVendorIdentityPair(gf, gordon, []);
    expect(result.classification).toBe("insufficient_evidence");
    expect(result.evidenceStatus).toBe("not_reconciled");
  });

  it("stops a request without a report hash before opening a mutation transaction", async () => {
    const transaction = vi.spyOn(db as any, "transaction");
    const result = await applyVendorIdentityMerge({
      companyId: COMPANY,
      survivorVendorId: gordon.id,
      loserVendorId: gf.id,
      evidenceReportHash: "",
      decisionScope: { reason: "test only" },
    });
    try {
      expect(result).toEqual({
        result: "stopped",
        code: "MISSING_REPORT_HASH",
        reason: "A bound report hash is required.",
      });
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });

  it("is idempotent from its prior audit anchor and does not repoint again", async () => {
    const execute = vi.fn()
      // ensureVendorIdentityAuditTable
      .mockResolvedValueOnce({})
      // assertVendorReferenceColumnsUnchanged
      .mockResolvedValueOnce({
        rows: VENDOR_IDENTITY_REFERENCE_SOURCES.map((source) => ({
          table_name: source.table,
          column_name: source.column,
        })),
      })
      // existing audit lookup — no later SELECT/UPDATE calls are allowed
      .mockResolvedValueOnce({ rows: [{ id: "existing-merge-audit" }] });
    const transaction = vi.spyOn(db as any, "transaction").mockImplementation(
      async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }),
    );
    try {
      const result = await applyVendorIdentityMerge({
        companyId: COMPANY,
        survivorVendorId: gordon.id,
        loserVendorId: gf.id,
        evidenceReportHash: "reviewed-report-hash",
        decisionScope: { approvalReference: "test" },
      });
      expect(result).toEqual({
        result: "already_remediated",
        auditId: "existing-merge-audit",
        survivorVendorId: gordon.id,
        loserVendorId: gf.id,
      });
      expect(execute).toHaveBeenCalledTimes(3);
    } finally {
      transaction.mockRestore();
    }
  });

  it("revalidates persisted evidence inside the transaction before any vendor reference update", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({}) // ensure audit table
      .mockResolvedValueOnce({
        rows: VENDOR_IDENTITY_REFERENCE_SOURCES.map((source) => ({
          table_name: source.table,
          column_name: source.column,
        })),
      })
      .mockResolvedValueOnce({ rows: [] }) // no prior audit
      .mockResolvedValueOnce({ rows: [gordon, gf] }) // locked vendors
      .mockResolvedValueOnce({ rows: [] }); // fresh persisted evidence is absent
    const transaction = vi.spyOn(db as any, "transaction").mockImplementation(
      async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }),
    );
    try {
      const result = await applyVendorIdentityMerge({
        companyId: COMPANY,
        survivorVendorId: gordon.id,
        loserVendorId: gf.id,
        evidenceReportHash: "forged-or-stale-report-hash",
        decisionScope: { approvalReference: "test" },
      });
      expect(result).toEqual({
        result: "stopped",
        code: "EVIDENCE_DRIFT",
        reason: "Persisted evidence no longer authorizes this pair: classification=insufficient_evidence, evidenceStatus=not_reconciled.",
      });
      expect(execute).toHaveBeenCalledTimes(5);
    } finally {
      transaction.mockRestore();
    }
  });

  it("reports the full population as pairwise, including evidence-free pairs", () => {
    const report = buildVendorIdentityReport({
      companyId: COMPANY,
      vendors: [gf, gordon, pinkney, rlb],
      evidence: [],
      generatedAt: "2026-08-23T00:00:00.000Z",
    });
    expect(report.vendorCount).toBe(4);
    expect(report.pairCount).toBe(6);
    expect(report.classificationCounts.insufficient_evidence).toBe(6);
  });
});