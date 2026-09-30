/** Only the two reviewed Bay Hill item/location pairs can be removed. */
export const BAY_HILL_LOCATION_CORRECTIONS = [
  { code: "9503", name: "LEMON OLIVE OIL CAKE", supportedLocation: "Front Reach-in Freezer" },
  { code: "0726127", name: "POTATO INSTANT REAL MASH DEHT", supportedLocation: "Dry Storeroom" },
] as const;

export function assessBayHillLine(input: {
  code: string | undefined;
  name: string;
  locationName: string | null;
  qty: number | null;
  caseQty: number | null;
  containerQty: number | null;
  looseUnits: number | null;
  entryCount: number;
  supportedAssignments: number;
  unsupportedAssignments: number;
  supportedLines: number;
  evidenceBlockers: number;
}): { supportedLocationName: string | null; eligible: boolean; reason: string } {
  const spec = BAY_HILL_LOCATION_CORRECTIONS.find(
    (candidate) => candidate.code === input.code && candidate.name === input.name &&
      input.locationName?.trim().toLowerCase() === "main freezer",
  );
  if (!spec) return {
    supportedLocationName: null,
    eligible: false,
    reason: "Prior item history has no safe match for this current location. Review the item and location; no correction is approved for this line.",
  };
  const base = { supportedLocationName: spec.supportedLocation };
  if (input.evidenceBlockers || input.supportedAssignments !== 1 ||
      input.unsupportedAssignments !== 1 || input.supportedLines !== 1) {
    return { ...base, eligible: false, reason: "The approved location evidence or assignments have changed; removal is blocked." };
  }
  if (input.entryCount !== 0 ||
      [input.qty, input.caseQty, input.containerQty, input.looseUnits]
        .some((value) => value !== null && (!Number.isFinite(Number(value)) || Number(value) !== 0))) {
    return { ...base, eligible: false, reason: "This line has a count entry or a nonzero quantity; removal is blocked." };
  }
  return { ...base, eligible: true, reason: "Unsupported Main freezer assignment with an untouched zero August line." };
}