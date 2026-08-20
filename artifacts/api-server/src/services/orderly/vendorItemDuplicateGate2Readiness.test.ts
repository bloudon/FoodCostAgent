import { describe, expect, it } from "vitest";
import {
  EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT,
  extractProductionClassALoserIds,
  summarizeEdiPayloads,
} from "./vendorItemDuplicateGate2Readiness";

function productionReport() {
  const firstGroupLosers = EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT - 2428;
  const rowIds = Array.from({ length: firstGroupLosers + 1 }, (_, index) => `vi-${index}`);
  return {
    database: "fnbcostpro",
    readOnly: true,
    totals: { duplicateGroups: 2430, excessRows: 6039 },
    classes: { A: { groups: 2429, excessRows: EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT } },
    groups: [
      {
        class: "A",
        rowIds,
        proposedSurvivorId: rowIds[0],
        proposedDeletions: firstGroupLosers,
      },
      ...Array.from({ length: 2428 }, (_, index) => {
        const survivor = `survivor-${index}`;
        return {
          class: "A",
          rowIds: [survivor, `loser-${index}`],
          proposedSurvivorId: survivor,
          proposedDeletions: 1,
        };
      }),
    ],
  };
}

describe("production Gate 2 readiness evidence", () => {
  it("derives the exact approved production Class A loser set and rejects a different baseline", () => {
    const derived = extractProductionClassALoserIds(productionReport());
    expect(derived.loserIds.size).toBe(EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT);
    expect(derived.loserIds).not.toContain("vi-0");

    const drifted = productionReport();
    drifted.totals.excessRows = 6207;
    expect(() => extractProductionClassALoserIds(drifted)).toThrow(/approved production Gate 1 baseline/);
  });

  it("reports structural paths without leaking payloads and stops on an exact proposed loser identity", () => {
    const evidence = summarizeEdiPayloads(
      2,
      [
        { id: "edi-1", payloadJson: { order: { lines: [{ vendorItemId: "vi-7" }] } } },
        { id: "edi-2", payloadJson: { order: { lines: [{ sku: "7664436" }] } } },
      ],
      new Set(["vi-7", "vi-9"]),
    );

    expect(evidence).toMatchObject({
      totalMessagesInspected: 2,
      messagesContainingAnyVendorItemIdentity: 1,
      messagesContainingProposedLoserIds: 1,
      distinctProposedLoserIdsReferenced: 1,
      softReferenceRisk: "STOP",
    });
    expect(evidence.representativeStructuralPaths).toContain("$.order.lines[0].vendorItemId");
    expect(JSON.stringify(evidence)).not.toContain("edi-1");
    expect(evidence.requiredReferenceContract).toMatch(/Before any remediation/);
  });

  it("closes the soft-reference risk only when no proposed loser identity is persisted", () => {
    const evidence = summarizeEdiPayloads(
      1,
      [{ id: "edi-1", payloadJson: { purchaseOrder: { vendorItemId: "survivor-id" } } }],
      new Set(["loser-id"]),
    );

    expect(evidence.softReferenceRisk).toBe("CLOSED");
    expect(evidence.messagesContainingAnyVendorItemIdentity).toBe(1);
    expect(evidence.messagesContainingProposedLoserIds).toBe(0);
    expect(evidence.distinctProposedLoserIdsReferenced).toBe(0);
    expect(evidence.requiredReferenceContract).toBeNull();
  });
});