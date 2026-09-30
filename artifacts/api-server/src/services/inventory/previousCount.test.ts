import { describe, expect, it } from "vitest";
import {
  derivePriorZeroEvidence,
  reconcilePreviousCountLines,
  selectPreviousEligibleCount,
} from "./previousCount";

const current = {
  id: "current",
  companyId: "company-a",
  storeId: "store-a",
  countDate: "2026-09-21T00:00:00.000Z",
  countedAt: "2026-09-21T12:00:00.000Z",
  applied: 0,
};

describe("selectPreviousAppliedCount", () => {
  it("selects the latest earlier applied session and skips drafts", () => {
    const result = selectPreviousEligibleCount(current, [
      current,
      {
        id: "earlier-draft",
        companyId: "company-a",
        storeId: "store-a",
        countDate: "2026-09-20T00:00:00.000Z",
        countedAt: "2026-09-20T18:00:00.000Z",
        applied: 0,
      },
      {
        id: "earlier-applied",
        companyId: "company-a",
        storeId: "store-a",
        countDate: "2026-09-19T00:00:00.000Z",
        countedAt: "2026-09-19T18:00:00.000Z",
        applied: 1,
      },
    ]);

    expect(result?.id).toBe("earlier-applied");
  });

  it("orders same-day applied sessions by creation time", () => {
    const result = selectPreviousEligibleCount(current, [
      current,
      {
        id: "same-day-earlier",
        companyId: "company-a",
        storeId: "store-a",
        countDate: current.countDate,
        countedAt: "2026-09-21T11:00:00.000Z",
        applied: 1,
      },
      {
        id: "same-day-latest",
        companyId: "company-a",
        storeId: "store-a",
        countDate: current.countDate,
        countedAt: "2026-09-21T11:30:00.000Z",
        applied: 1,
      },
    ]);

    expect(result?.id).toBe("same-day-latest");
  });

  it("does not select future or current sessions", () => {
    const result = selectPreviousEligibleCount(current, [
      current,
      {
        id: "future",
        companyId: "company-a",
        storeId: "store-a",
        countDate: "2026-09-22T00:00:00.000Z",
        countedAt: "2026-09-22T12:00:00.000Z",
        applied: 1,
      },
    ]);

    expect(result).toBeNull();
  });

  it("rejects otherwise newer sessions from another company or store", () => {
    const result = selectPreviousEligibleCount(current, [
      current,
      {
        id: "other-company",
        companyId: "company-b",
        storeId: "store-a",
        countDate: "2026-09-20T00:00:00.000Z",
        countedAt: "2026-09-20T20:00:00.000Z",
        applied: 1,
      },
      {
        id: "other-store",
        companyId: "company-a",
        storeId: "store-b",
        countDate: "2026-09-20T00:00:00.000Z",
        countedAt: "2026-09-20T19:00:00.000Z",
        applied: 1,
      },
      {
        id: "same-scope",
        companyId: "company-a",
        storeId: "store-a",
        countDate: "2026-09-19T00:00:00.000Z",
        countedAt: "2026-09-19T18:00:00.000Z",
        applied: 1,
      },
    ]);

    expect(result?.id).toBe("same-scope");
  });

  it("uses a verified historical snapshot without treating ordinary drafts as baselines", () => {
    const result = selectPreviousEligibleCount(current, [
      current,
      {
        id: "newer-draft",
        companyId: "company-a",
        storeId: "store-a",
        countDate: "2026-09-20T00:00:00.000Z",
        countedAt: "2026-09-20T20:00:00.000Z",
        applied: 0,
        isHistoricalImport: 0,
      },
      {
        id: "historical",
        companyId: "company-a",
        storeId: "store-a",
        countDate: "2026-07-31T00:00:00.000Z",
        countedAt: "2026-09-20T18:00:00.000Z",
        applied: 0,
        isHistoricalImport: 1,
      },
    ]);

    expect(result?.id).toBe("historical");
  });
});

describe("reconcilePreviousCountLines", () => {
  const currentLines = [
    {
      id: "current-apple-walkin",
      inventoryItemId: "apple",
      storageLocationId: "canonical-walkin",
      qty: 0,
    },
    {
      id: "current-apple-freezer",
      inventoryItemId: "apple",
      storageLocationId: "canonical-freezer",
      qty: 0,
    },
    {
      id: "current-beef-walkin",
      inventoryItemId: "beef",
      storageLocationId: "canonical-walkin",
      qty: 0,
    },
  ];

  it("classifies a prior item at an unsupported location as unmatched, but excludes a new item", () => {
    const result = reconcilePreviousCountLines(
      [{ inventoryItemId: "apple", storageLocationId: "legacy-walkin", qty: 4 }],
      [
        { inventoryItemId: "apple", storageLocationId: "canonical-freezer", qty: 0 },
        { inventoryItemId: "new", storageLocationId: "canonical-freezer", qty: 0 },
      ],
      [
        { id: "legacy-walkin", name: "Walk In" },
        { id: "canonical-freezer", name: "Freezer" },
      ],
    );
    expect(result.diagnostics.locationUnmatchedLines).toBe(1);
    expect(result.diagnostics.absentPreviousItemLines).toBe(1);
    expect(result.lines).toHaveLength(0);
  });

  it("maps a historical legacy location to one equivalent current location", () => {
    const result = reconcilePreviousCountLines(
      [
        {
          id: "previous-apple",
          inventoryItemId: "apple",
          storageLocationId: "legacy-walkin",
          qty: 4,
        },
      ],
      currentLines,
      [
        { id: "legacy-walkin", name: "Walk In" },
        { id: "canonical-walkin", name: " walk   in " },
        { id: "canonical-freezer", name: "Freezer" },
      ],
    );

    expect(result.lines).toEqual([
      expect.objectContaining({
        id: "previous-apple",
        storageLocationId: "canonical-walkin",
        sourceStorageLocationId: "legacy-walkin",
      }),
    ]);
    expect(result.diagnostics).toMatchObject({
      currentLineCount: 3,
      currentDistinctItemCount: 2,
      matchedPositiveLines: 1,
      locationUnmatchedLines: 1,
      absentPreviousItemLines: 1,
    });
  });

  it("does not guess when one location name points to multiple current IDs", () => {
    const result = reconcilePreviousCountLines(
      [
        {
          id: "previous-apple",
          inventoryItemId: "apple",
          storageLocationId: "legacy-walkin",
          qty: 4,
        },
      ],
      [
        ...currentLines,
        {
          id: "current-apple-walkin-2",
          inventoryItemId: "apple",
          storageLocationId: "canonical-walkin-2",
          qty: 0,
        },
      ],
      [
        { id: "legacy-walkin", name: "Walk In" },
        { id: "canonical-walkin", name: "Walk In" },
        { id: "canonical-walkin-2", name: "Walk In" },
        { id: "canonical-freezer", name: "Freezer" },
      ],
    );

    expect(result.lines).toEqual([]);
    expect(result.diagnostics.ambiguousLocationLines).toBe(3);
  });

  it("preserves an exact item-location zero distinctly from no prior line", () => {
    const result = reconcilePreviousCountLines(
      [
        {
          id: "previous-apple",
          inventoryItemId: "apple",
          storageLocationId: "canonical-walkin",
          qty: 0,
        },
      ],
      currentLines,
      [],
    );

    expect(result.lines).toHaveLength(1);
    expect(result.diagnostics.matchedZeroLines).toBe(1);
    expect(result.diagnostics.absentPreviousItemLines).toBe(1);
  });

  it("uses approved omitted-zero evidence without synthesizing historical lines", () => {
    const result = reconcilePreviousCountLines(
      [
        {
          id: "previous-apple",
          inventoryItemId: "apple",
          storageLocationId: "canonical-walkin",
          qty: 4,
        },
      ],
      currentLines,
      [
        { id: "canonical-walkin", name: "Walk In" },
        { id: "canonical-freezer", name: "Freezer" },
      ],
      [
        {
          inventoryItemId: "apple",
          storageLocationName: " freezer ",
        },
      ],
    );

    expect(result.lines).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      matchedPositiveLines: 1,
      matchedZeroLines: 1,
      matchedSourceZeroLines: 1,
      locationUnmatchedLines: 0,
      absentPreviousItemLines: 1,
    });
  });

  it("does not use omitted-zero evidence when the target location name is ambiguous", () => {
    const result = reconcilePreviousCountLines(
      [],
      [
        {
          id: "current-apple-walkin",
          inventoryItemId: "apple",
          storageLocationId: "canonical-walkin",
          qty: 0,
        },
        {
          id: "current-apple-walkin-2",
          inventoryItemId: "apple",
          storageLocationId: "canonical-walkin-2",
          qty: 0,
        },
      ],
      [
        { id: "canonical-walkin", name: "Walk In" },
        { id: "canonical-walkin-2", name: " walk   in " },
      ],
      [
        {
          inventoryItemId: "apple",
          storageLocationName: "Walk In",
        },
      ],
    );

    expect(result.diagnostics).toMatchObject({
      matchedSourceZeroLines: 0,
      locationUnmatchedLines: 2,
    });
  });
});

describe("derivePriorZeroEvidence", () => {
  it("keeps only item-location pairs whose every source row is exactly zero", () => {
    expect(
      derivePriorZeroEvidence([
        {
          inventoryItemId: "apple",
          storageLocationName: " Walk   In ",
          totalUnits: 0,
        },
        {
          inventoryItemId: "apple",
          storageLocationName: "walk in",
          totalUnits: 0,
        },
        {
          inventoryItemId: "beef",
          storageLocationName: "Freezer",
          totalUnits: 2,
        },
        {
          inventoryItemId: "beef",
          storageLocationName: "Freezer",
          totalUnits: -2,
        },
      ]),
    ).toEqual([
      {
        inventoryItemId: "apple",
        storageLocationName: "walk in",
      },
    ]);
  });

  it("treats null and non-finite quantities as unknown rather than zero", () => {
    expect(
      derivePriorZeroEvidence([
        {
          inventoryItemId: "apple",
          storageLocationName: "Walk In",
          totalUnits: 0,
        },
        {
          inventoryItemId: "apple",
          storageLocationName: "Walk In",
          totalUnits: null,
        },
        {
          inventoryItemId: "beef",
          storageLocationName: "Freezer",
          totalUnits: Number.NaN,
        },
      ]),
    ).toEqual([]);
  });

  it("clears 1,050 exact source-zero pairs while retaining two unsupported locations", () => {
    const current = Array.from({ length: 1052 }, (_, index) => ({
      id: `current-${index}`,
      inventoryItemId: `item-${index}`,
      storageLocationId: "canonical-target",
      qty: 0,
    }));
    const previous = current.map((line, index) => ({
      id: `previous-${index}`,
      inventoryItemId: line.inventoryItemId,
      storageLocationId: "legacy-other",
      qty: 1,
    }));
    const zeroEvidence = current.slice(0, 1050).map((line) => ({
      inventoryItemId: line.inventoryItemId,
      storageLocationName: "Target",
    }));

    const result = reconcilePreviousCountLines(
      previous,
      current,
      [
        { id: "canonical-target", name: "Target" },
        { id: "legacy-other", name: "Other" },
      ],
      zeroEvidence,
    );

    expect(result.diagnostics).toMatchObject({
      matchedSourceZeroLines: 1050,
      matchedZeroLines: 1050,
      locationUnmatchedLines: 2,
      ambiguousLocationLines: 0,
    });
  });
});