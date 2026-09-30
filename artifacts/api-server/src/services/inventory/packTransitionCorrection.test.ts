import { describe, expect, it } from "vitest";
import { correctionVersionMatches, latestConfirmedPackDecision, latestCorrectionId, mayCorrectPackTransition, projectPackDecisions } from "./packTransitionCorrection";

describe("supplier replacement correction guards", () => {
  it("allows only administrators to append a decision", () => {
    expect(mayCorrectPackTransition("company_admin")).toBe(true);
    expect(mayCorrectPackTransition("global_admin")).toBe(true);
    for (const role of ["manager", "store_user", "employee", undefined]) {
      expect(mayCorrectPackTransition(role)).toBe(false);
    }
  });

  it("requires the exact observed head and rejects a concurrent stale correction", () => {
    const original = "approval-a";
    expect(latestCorrectionId(original, [])).toBeNull();
    const first = { id: "decision-1", originalTransitionId: original, supersedesCorrectionId: null };
    const otherItem = { id: "other", originalTransitionId: "approval-b", supersedesCorrectionId: null };
    expect(correctionVersionMatches(null, latestCorrectionId(original, [first, otherItem]))).toBe(false);
    const second = { id: "decision-2", originalTransitionId: original, supersedesCorrectionId: first.id };
    expect(correctionVersionMatches(first.id, latestCorrectionId(original, [second, otherItem, first]))).toBe(false);
    expect(correctionVersionMatches(second.id, latestCorrectionId(original, [second, first]))).toBe(true);
  });

  it("fails closed on a fork or broken chain", () => {
    expect(() => latestCorrectionId("a", [
      { id: "one", originalTransitionId: "a", supersedesCorrectionId: null },
      { id: "two", originalTransitionId: "a", supersedesCorrectionId: null },
    ])).toThrow();
    expect(() => latestCorrectionId("a", [
      { id: "orphan", originalTransitionId: "a", supersedesCorrectionId: "missing" },
    ])).toThrow();
  });

  it("retains an earlier confirmation after an ordinary unconfirmed approval", () => {
    const first = { id: "confirmed", effectiveDate: "2026-01-01", countingStandardConfirmed: 1, operationalPackSnapshot: { caseSize: 10 } };
    const second = { id: "unconfirmed", effectiveDate: "2026-02-01", countingStandardConfirmed: 0, operationalPackSnapshot: null };
    const projected = projectPackDecisions([first, second], []);
    expect(latestConfirmedPackDecision(projected, "2026-03-01")).toBe(first);
    expect(latestConfirmedPackDecision(projected, "2025-12-31")).toBeNull();
  });

  it("never attributes a superseded or voided approval's confirmation to its correction", () => {
    const earlier = { id: "earlier", effectiveDate: "2026-01-01", countingStandardConfirmed: 1, operationalPackSnapshot: { caseSize: 10 } };
    const original = { id: "original", effectiveDate: "2026-02-01", countingStandardConfirmed: 1, operationalPackSnapshot: { caseSize: 20 } };
    const correction = {
      id: "correction", originalTransitionId: original.id, supersedesCorrectionId: null,
      decision: "correct", effectiveDate: "2026-02-02",
    };
    const corrected = projectPackDecisions([earlier, original], [correction]);
    expect(latestConfirmedPackDecision(corrected, "2026-03-01")).toEqual(earlier);
    expect(corrected.find(row => row.id === correction.id)?.operationalPackSnapshot).toBeNull();
    const voided = projectPackDecisions([earlier, original], [{ ...correction, decision: "void" }]);
    expect(latestConfirmedPackDecision(voided, "2026-03-01")).toEqual(earlier);
    expect(voided).not.toContainEqual(original);
    expect(latestConfirmedPackDecision(projectPackDecisions([original], [correction]), "2026-03-01")).toBeNull();
  });
});