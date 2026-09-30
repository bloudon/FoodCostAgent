import { describe, expect, it } from "vitest";
import { assessBayHillLine } from "./bayHillLocationGuard";

const line = {
  code: "9503",
  name: "LEMON OLIVE OIL CAKE",
  locationName: "Main freezer",
  qty: 0,
  caseQty: null,
  containerQty: null,
  looseUnits: null,
  entryCount: 0,
  supportedAssignments: 1,
  unsupportedAssignments: 1,
  supportedLines: 1,
  evidenceBlockers: 0,
};

describe("Bay Hill location correction guard", () => {
  it("accepts only the reviewed item at its unsupported zero location", () => {
    expect(assessBayHillLine(line)).toMatchObject({
      supportedLocationName: "Front Reach-in Freezer", eligible: true,
    });
    expect(assessBayHillLine({
      ...line, code: "0726127", name: "POTATO INSTANT REAL MASH DEHT",
    })).toMatchObject({ supportedLocationName: "Dry Storeroom", eligible: true });
  });

  it.each([
    { code: "9504" },
    { name: "Different cake" },
    { locationName: "Front Reach-in Freezer" },
    { locationName: null },
  ])("refuses identities or locations outside the approved pairs", (change) => {
    expect(assessBayHillLine({ ...line, ...change }).eligible).toBe(false);
  });

  it.each([
    { qty: 1 }, { caseQty: 1 }, { containerQty: 1 }, { looseUnits: 1 },
    { qty: Number.NaN }, { entryCount: 1 }, { evidenceBlockers: 1 },
    { supportedAssignments: 0 }, { supportedAssignments: 2 },
    { unsupportedAssignments: 0 }, { unsupportedAssignments: 2 },
    { supportedLines: 0 }, { supportedLines: 2 },
  ])("refuses nonzero, entered, ambiguous, or drifted evidence", (change) => {
    expect(assessBayHillLine({ ...line, ...change }).eligible).toBe(false);
  });
});