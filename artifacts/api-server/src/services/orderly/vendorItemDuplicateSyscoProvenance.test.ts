import { describe, expect, it } from "vitest";
import {
  chronological,
  concludeSyscoProvenance,
  type SyscoProvenanceEvent,
} from "./vendorItemDuplicateSyscoProvenance";

function event(overrides: Partial<SyscoProvenanceEvent>): SyscoProvenanceEvent {
  return {
    occurredAt: "2026-01-01T00:00:00.000Z",
    isCurrent: false,
    source: "source",
    directVendorItemId: null,
    bridge: "vendor-and-sku",
    packEvidence: { caseSize: 1, innerPackSize: 1, packUom: "EA", rawDescription: null, confidence: "supporting" },
    priceContext: { casePrice: 120, unitPrice: 10 },
    details: {},
    ...overrides,
  };
}

describe("Sysco provenance conclusion boundary", () => {
  it("never elects a winner from price arithmetic or indirect product evidence", () => {
    const conclusion = concludeSyscoProvenance([
      event({ packEvidence: { caseSize: 12, innerPackSize: 1, packUom: "EA", rawDescription: "12 EA", confidence: "supporting" } }),
      event({ packEvidence: { caseSize: 1, innerPackSize: 1, packUom: "EA", rawDescription: "1 EA", confidence: "supporting" }, priceContext: { casePrice: 10, unitPrice: 10 } }),
    ]);
    expect(conclusion.conclusion).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("sorts chronology and recognizes historical pack changes without claiming currentness", () => {
    const events = [
      event({ occurredAt: "2026-02-01T00:00:00.000Z", source: "later", directVendorItemId: "row-a", bridge: "direct", packEvidence: { caseSize: 12, innerPackSize: 1, packUom: "EA", rawDescription: "12 EA", confidence: "authoritative" } }),
      event({ occurredAt: "2026-01-01T00:00:00.000Z", source: "earlier", directVendorItemId: "row-a", bridge: "direct", packEvidence: { caseSize: 1, innerPackSize: 1, packUom: "EA", rawDescription: "1 EA", confidence: "authoritative" } }),
    ];
    expect(chronological(events).map((value) => value.source)).toEqual(["earlier", "later"]);
    expect(concludeSyscoProvenance(events).conclusion).toBe("PACK_CONFIGURATION_CHANGED_OVER_TIME");
  });

  it("requires an explicit current assertion and recognizes independently current products", () => {
    const first = event({
      directVendorItemId: "row-a",
      bridge: "direct",
      isCurrent: true,
      packEvidence: { caseSize: 12, innerPackSize: 1, packUom: "EA", rawDescription: "12 EA", confidence: "authoritative" },
    });
    const second = event({
      directVendorItemId: "row-b",
      bridge: "direct",
      isCurrent: true,
      packEvidence: { caseSize: 1, innerPackSize: 1, packUom: "EA", rawDescription: "1 EA", confidence: "authoritative" },
    });
    expect(concludeSyscoProvenance([first, second]).conclusion).toBe("DISTINCT_LEGITIMATE_CURRENT_PRODUCTS");
    expect(concludeSyscoProvenance([{ ...first, isCurrent: false }]).conclusion).toBe("INSUFFICIENT_EVIDENCE");
  });
});