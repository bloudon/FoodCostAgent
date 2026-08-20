import { describe, expect, it } from "vitest";
import {
  buildNonExecutableGate2Package,
  fingerprintLoserSet,
  sha256,
} from "./vendorItemDuplicateGate2Package";
import { EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT } from "./vendorItemDuplicateGate2Readiness";

function report() {
  const firstLosers = EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT - 2428;
  const first = Array.from({ length: firstLosers + 1 }, (_, index) => `vi-${index}`);
  return {
    database: "production-db",
    readOnly: true,
    totals: { duplicateGroups: 2430, excessRows: 6039 },
    classes: { A: { groups: 2429, excessRows: EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT } },
    groups: [
      { class: "A", key: { vendorSku: "a" }, rowIds: first, proposedSurvivorId: first[0], proposedDeletions: firstLosers },
      ...Array.from({ length: 2428 }, (_, index) => ({
        class: "A",
        key: { vendorSku: `b-${index}` },
        rowIds: [`winner-${index}`, `loser-${index}`],
        proposedSurvivorId: `winner-${index}`,
        proposedDeletions: 1,
      })),
      { class: "B", key: { vendorSku: "7664436" }, rowIds: ["held-a", "held-b"], proposedSurvivorId: null, proposedDeletions: 0 },
    ],
  };
}

const compatibility = {
  "vendor_invoice_import_lines.resolved_vendor_item_id": {
    present: false,
    applicableReferences: 0,
    compatibilityState: "legacy_optional_absent" as const,
  },
};

describe("non-executable production Gate 2 package", () => {
  it("cryptographically binds report bytes, exact losers, membership, and EDI-closed readiness without including the held Sysco group", () => {
    const result = buildNonExecutableGate2Package({
      classifierReport: report(),
      classifierReportPath: "/secure/production/classifier.json",
      classifierReportFileSha256: sha256("classifier bytes"),
      readinessEvidence: {
        readOnly: true,
        database: "production-db",
        productionClassALoserCount: 6038,
        ediSoftReferenceEvidence: { softReferenceRisk: "CLOSED" },
      },
      readinessEvidencePath: "/secure/production/readiness.json",
      readinessEvidenceFileSha256: sha256("readiness bytes"),
      connectedDatabase: "production-db",
      referenceCompatibility: compatibility,
    });

    expect(result.executionProhibited).toBe(true);
    expect(result.reviewedGroups).toHaveLength(2429);
    expect(result.reviewedGroups.flatMap((group) => group.loserIds)).not.toContain("held-a");
    expect(result.sourceClassifierReport.loserSetSha256).toBe(
      fingerprintLoserSet(new Set(result.reviewedGroups.flatMap((group) => group.loserIds))),
    );
    expect(result.packageId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed on a database mismatch or non-closed EDI evidence", () => {
    const base = {
      classifierReport: report(),
      classifierReportPath: "/secure/production/classifier.json",
      classifierReportFileSha256: sha256("classifier"),
      readinessEvidencePath: "/secure/production/readiness.json",
      readinessEvidenceFileSha256: sha256("readiness"),
      referenceCompatibility: compatibility,
    };
    expect(() => buildNonExecutableGate2Package({
      ...base,
      readinessEvidence: { readOnly: true, database: "other", productionClassALoserCount: 6038, ediSoftReferenceEvidence: { softReferenceRisk: "CLOSED" } },
      connectedDatabase: "production-db",
    })).toThrow(/accepted read-only/);
    expect(() => buildNonExecutableGate2Package({
      ...base,
      readinessEvidence: { readOnly: true, database: "production-db", productionClassALoserCount: 6038, ediSoftReferenceEvidence: { softReferenceRisk: "STOP" } },
      connectedDatabase: "production-db",
    })).toThrow(/accepted read-only/);
  });

  it("is deterministic for the same accepted evidence and changes identity when bound report bytes change", () => {
    const input = {
      classifierReport: report(),
      classifierReportPath: "/secure/production/classifier.json",
      classifierReportFileSha256: sha256("classifier bytes"),
      readinessEvidence: {
        readOnly: true as const,
        database: "production-db",
        productionClassALoserCount: 6038,
        ediSoftReferenceEvidence: { softReferenceRisk: "CLOSED" as const },
      },
      readinessEvidencePath: "/secure/production/readiness.json",
      readinessEvidenceFileSha256: sha256("readiness bytes"),
      connectedDatabase: "production-db",
      referenceCompatibility: compatibility,
    };
    const first = buildNonExecutableGate2Package(input);
    const second = buildNonExecutableGate2Package(input);
    const byteChanged = buildNonExecutableGate2Package({ ...input, classifierReportFileSha256: sha256("changed bytes") });
    expect(second.packageId).toBe(first.packageId);
    expect(byteChanged.packageId).not.toBe(first.packageId);
  });
});