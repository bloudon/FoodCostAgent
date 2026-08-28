import { describe, it, expect } from "vitest";
import {
  rowConfidenceKey,
  uniqueCategories,
  applyFilters,
  toggleSetValue,
  buildBulkCompatiblePackDecisions,
  buildBulkNewPackSizeDecisions,
  getBulkCompatiblePackReview,
  getBulkNewPackSizeReview,
  getPendingRecodeCodes,
  type RowPreviewLike,
} from "./orderlyImportFilterUtils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(
  sourceCategory: string | null,
  strategy: string,
  confidence: string
): RowPreviewLike {
  return {
    sourceCategory,
    itemMatch: { strategy, confidence },
  };
}

/** 200+ row fixture covering many categories, including null sourceCategory rows */
function makeLargeFixture(): RowPreviewLike[] {
  const categories = [
    "Dairy", "Meat", "Produce", "Seafood", "Beverages",
    "Dry Goods", "Frozen", "Paper & Disposables", "Cleaning Supplies", "Bakery",
  ];
  const strategies = ["item_code", "name_pack", "fuzzy", "none"];
  const confidences = ["high", "medium", "low", "ambiguous", "high"];

  const rows: RowPreviewLike[] = [];
  for (let i = 0; i < 220; i++) {
    const cat = i % 15 === 0 ? null : categories[i % categories.length]; // ~14 null rows
    const strategy = strategies[i % strategies.length];
    const confidence = strategy === "none" ? "none" : confidences[i % confidences.length];
    rows.push(makeRow(cat, strategy, confidence));
  }
  return rows;
}

// ─── rowConfidenceKey ─────────────────────────────────────────────────────────

describe("rowConfidenceKey", () => {
  it('returns "held" before any match confidence for a server-held row', () => {
    const row = makeRow("Wine", "fuzzy", "low");
    row.heldForReview = true;
    expect(rowConfidenceKey(row)).toBe("held");
  });

  it('gives a new physical pack size its own review filter', () => {
    const row = makeRow("Spirits", "name_pack", "high");
    row.itemMatch.possibleRecode = true;
    row.itemMatch.recodeEvidenceClass = "new_pack_size";
    expect(rowConfidenceKey(row)).toBe("new-pack-size");
    expect(applyFilters([row], new Set(), new Set(["new-pack-size"]))).toEqual([row]);
  });

  it('prioritizes blocked source evidence over generic held/re-code states', () => {
    const row = makeRow("Dairy", "name_pack", "high");
    row.heldForReview = true;
    row.itemMatch.possibleRecode = true;
    row.itemMatch.recodeEvidenceClass = "source_data_conflict";
    expect(rowConfidenceKey(row)).toBe("source-conflict");
  });

  it('returns "new" when strategy is "none"', () => {
    expect(rowConfidenceKey(makeRow(null, "none", "none"))).toBe("new");
  });

  it('returns "new" even when confidence is set if strategy is "none"', () => {
    // strategy drives the key, not confidence
    expect(rowConfidenceKey(makeRow("Dairy", "none", "high"))).toBe("new");
  });

  it("returns the confidence value for a matched row (high)", () => {
    expect(rowConfidenceKey(makeRow("Meat", "item_code", "high"))).toBe("high");
  });

  it("returns the confidence value for a likely row (medium)", () => {
    expect(rowConfidenceKey(makeRow("Produce", "name_pack", "medium"))).toBe("medium");
  });

  it("returns the confidence value for a fuzzy row (low)", () => {
    expect(rowConfidenceKey(makeRow("Seafood", "fuzzy", "low"))).toBe("low");
  });

  it("returns the confidence value for an ambiguous row", () => {
    expect(rowConfidenceKey(makeRow("Dairy", "name_pack", "ambiguous"))).toBe("ambiguous");
  });
});

describe("getBulkNewPackSizeReview", () => {
  function newPackRow(overrides: Partial<RowPreviewLike> = {}): RowPreviewLike {
    return {
      rowIndex: 1,
      sourceCategory: "Spirits",
      sourceItemCode: "PACK-5X50",
      sourceCodeReliability: "stable",
      supplierRaw: "Acme Liquor",
      packSizeRaw: "5/50 ML",
      cleanedDescription: "House Tequila",
      caseQuantity: 5,
      innerPackQuantity: 1,
      baseUnitQuantity: 50,
      baseUnit: "ML",
      itemMatch: {
        strategy: "name_pack",
        confidence: "high",
        possibleRecode: true,
        recodeEvidenceClass: "new_pack_size",
        packCompatibility: "incompatible",
        possibleRecodeMatchedId: "existing-tequila",
      },
      ...overrides,
    };
  }

  it("only queues complete, verified new-pack source-code groups and groups their source samples", () => {
    const review = getBulkNewPackSizeReview([
      newPackRow({ rowIndex: 4 }),
      newPackRow({ rowIndex: 9 }),
      newPackRow({
        rowIndex: 10,
        sourceItemCode: "PACK-6X1L",
        packSizeRaw: "6/1 LT",
        cleanedDescription: "House Tequila",
      }),
    ]);

    expect(review.candidates).toEqual([
      expect.objectContaining({
        sourceItemCode: "PACK-5X50",
        comparableInventoryItemId: "existing-tequila",
        rowIndexes: [4, 9],
        sourceRowCount: 2,
        vendorName: "Acme Liquor",
        packDescriptor: "5/50 ML",
      }),
      expect.objectContaining({
        sourceItemCode: "PACK-6X1L",
        rowIndexes: [10],
        packDescriptor: "6/1 LT",
      }),
    ]);
    expect(review.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        vendorName: "Acme Liquor",
        packDescriptor: "5/50 ML",
        variantCount: 1,
        sourceRowCount: 2,
        samples: [{ sourceItemCode: "PACK-5X50", sampleDescription: "House Tequila" }],
      }),
    ]));

    expect(buildBulkNewPackSizeDecisions(review.candidates)).toEqual([
      { rowIndex: 4, action: "create_variant", comparableInventoryItemId: "existing-tequila" },
      { rowIndex: 9, action: "create_variant", comparableInventoryItemId: "existing-tequila" },
      { rowIndex: 10, action: "create_variant", comparableInventoryItemId: "existing-tequila" },
    ]);
  });

  it("warns when a bulk variant would duplicate a different vendor's existing item", () => {
    const review = getBulkNewPackSizeReview([
      newPackRow({
        rowIndex: 41,
        sourceItemCode: "CROSS-VENDOR-12",
        supplierRaw: "Vendor Beta",
        itemMatch: {
          strategy: "name_pack",
          confidence: "high",
          possibleRecode: true,
          recodeEvidenceClass: "new_pack_size",
          packCompatibility: "incompatible",
          possibleRecodeMatchedId: "existing-tomatoes",
          crossVendorPackEligible: true,
          existingVendorNames: ["Vendor Alpha"],
        },
      }),
    ]);

    expect(review.candidates[0]?.duplicateSupplierWarning).toBe(
      "An item with this name is already supplied by Vendor Alpha.",
    );
  });

  it("never includes another class or a partial source-code group in a bulk variant action", () => {
    const review = getBulkNewPackSizeReview([
      newPackRow({ rowIndex: 1 }),
      newPackRow({
        rowIndex: 2,
        sourceItemCode: "PACK-5X50",
        itemMatch: {
          strategy: "name_pack",
          confidence: "high",
          possibleRecode: true,
          recodeEvidenceClass: "source_data_conflict",
          packCompatibility: "incompatible",
          possibleRecodeMatchedId: "existing-tequila",
        },
      }),
      newPackRow({
        rowIndex: 3,
        sourceItemCode: "PACK-UNKNOWN",
        itemMatch: {
          strategy: "name_pack",
          confidence: "high",
          possibleRecode: true,
          recodeEvidenceClass: "pack_evidence_missing",
          packCompatibility: "unknown",
          possibleRecodeMatchedId: "existing-tequila",
        },
      }),
      newPackRow({
        rowIndex: 4,
        sourceItemCode: "PACK-PSEUDO",
        sourceCodeReliability: "pseudo_code",
      }),
      newPackRow({
        rowIndex: 5,
        sourceItemCode: "PACK-HELD",
        heldForReview: true,
      }),
    ]);

    expect(review.candidates).toEqual([]);
    expect(buildBulkNewPackSizeDecisions(review.candidates)).toEqual([]);
  });

  it("excludes a code when its vendor or source pack facts disagree across locations", () => {
    const review = getBulkNewPackSizeReview([
      newPackRow({ rowIndex: 1 }),
      newPackRow({ rowIndex: 2, supplierRaw: "Other Liquor" }),
      newPackRow({
        rowIndex: 3,
        sourceItemCode: "PACK-6X1L",
        packSizeRaw: "6/1 LT",
      }),
      newPackRow({
        rowIndex: 4,
        sourceItemCode: "PACK-6X1L",
        packSizeRaw: "6 × 1 L",
      }),
    ]);

    expect(review.candidates).toEqual([]);
  });

  it("derives bulk variants only from unresolved groups and preserves 13 saved vendor-pack choices", () => {
    const rows = Array.from({ length: 30 }, (_, index) => newPackRow({
      rowIndex: index + 1,
      sourceItemCode: `PACK-${String(index + 1).padStart(2, "0")}`,
    }));
    const savedRows = new Set(rows.slice(0, 13).map(row => row.rowIndex));

    const review = getBulkNewPackSizeReview(
      rows,
      row => row.rowIndex != null && savedRows.has(row.rowIndex),
    );

    expect(review.candidates).toHaveLength(17);
    expect(review.candidates.every(candidate => candidate.rowIndexes.every(rowIndex => !savedRows.has(rowIndex)))).toBe(true);
  });
});

describe("getBulkCompatiblePackReview", () => {
  function compatibleRow(overrides: Partial<RowPreviewLike> = {}): RowPreviewLike {
    return {
      rowIndex: 1,
      sourceCategory: "Spirits",
      sourceItemCode: "TEQ-750",
      sourceCodeReliability: "stable",
      supplierRaw: "Acme Liquor",
      packSizeRaw: "1/750 ML",
      cleanedDescription: "House Tequila",
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: "ML",
      identityGroupKey: "house tequila|750ml",
      itemMatch: {
        strategy: "name_pack",
        confidence: "high",
        possibleRecode: true,
        recodeEvidenceClass: "compatible_alternate",
        packCompatibility: "compatible",
        possibleRecodeMatchedId: "existing-tequila",
        possibleRecodeItem: { id: "existing-tequila", name: "House Tequila" },
        sourcePackEvidence: {
          caseQuantity: 1,
          innerPackQuantity: 1,
          baseUnitQuantity: 750,
          baseUnit: "ML",
          normalizedUnit: "ml",
          totalBaseUnits: 750,
        },
        candidatePackEvidence: {
          caseQuantity: 1,
          innerPackQuantity: 1,
          baseUnitQuantity: 0.75,
          baseUnit: "L",
          normalizedUnit: "ml",
          totalBaseUnits: 750,
        },
      },
      ...overrides,
    };
  }

  it("includes only complete verified compatible code groups and expands every source row", () => {
    const review = getBulkCompatiblePackReview([
      compatibleRow({ rowIndex: 4 }),
      compatibleRow({ rowIndex: 9 }),
    ]);

    expect(review.candidates).toEqual([expect.objectContaining({
      sourceItemCode: "TEQ-750",
      targetInventoryItemId: "existing-tequila",
      targetItemName: "House Tequila",
      rowIndexes: [4, 9],
      sourceRowCount: 2,
      sourceNormalizedTotal: "750 ml",
      catalogNormalizedTotal: "750 ml",
    })]);
    expect(review.excludedGroups).toEqual([]);
    expect(buildBulkCompatiblePackDecisions(review.candidates)).toEqual([
      { rowIndex: 4, action: "link_existing", inventoryItemId: "existing-tequila" },
      { rowIndex: 9, action: "link_existing", inventoryItemId: "existing-tequila" },
    ]);
  });

  it("excludes unknown, conflicting, missing, incompatible, and divergent groups", () => {
    const unknown = compatibleRow({
      rowIndex: 10,
      sourceItemCode: "UNKNOWN",
      itemMatch: {
        ...compatibleRow().itemMatch,
        recodeEvidenceClass: "pack_evidence_missing",
        packCompatibility: "unknown",
      },
    });
    const conflicting = compatibleRow({
      rowIndex: 11,
      sourceItemCode: "CONFLICT",
      itemMatch: {
        ...compatibleRow().itemMatch,
        recodeEvidenceClass: "source_data_conflict",
      },
    });
    const incompatible = compatibleRow({
      rowIndex: 12,
      sourceItemCode: "INCOMPATIBLE",
      itemMatch: {
        ...compatibleRow().itemMatch,
        recodeEvidenceClass: "new_pack_size",
        packCompatibility: "incompatible",
      },
    });
    const divergentA = compatibleRow({ rowIndex: 13, sourceItemCode: "DIVERGENT" });
    const divergentB = compatibleRow({
      rowIndex: 14,
      sourceItemCode: "DIVERGENT",
      identityGroupKey: "house tequila|1l",
      baseUnitQuantity: 1,
      baseUnit: "L",
      itemMatch: {
        ...compatibleRow().itemMatch,
        sourcePackEvidence: {
          caseQuantity: 1,
          innerPackQuantity: 1,
          baseUnitQuantity: 1,
          baseUnit: "L",
          normalizedUnit: "ml",
          totalBaseUnits: 1000,
        },
      },
    });

    const review = getBulkCompatiblePackReview([unknown, conflicting, incompatible, divergentA, divergentB]);
    expect(review.candidates).toEqual([]);
    expect(new Map(review.excludedGroups.map(group => [group.sourceItemCode, group.reason]))).toEqual(new Map([
      ["CONFLICT", "conflicting_pack"],
      ["DIVERGENT", "divergent_group"],
      ["INCOMPATIBLE", "incompatible_pack"],
      ["UNKNOWN", "missing_pack_evidence"],
    ]));
  });
});

describe("getPendingRecodeCodes", () => {
  it("keeps a code outstanding until every source row has a saved action", () => {
    const rows: RowPreviewLike[] = [
      {
        sourceCategory: "Spirits",
        rowIndex: 1,
        sourceItemCode: "GROUP-A",
        sourceCodeReliability: "stable",
        itemMatch: { strategy: "name_pack", confidence: "high", possibleRecode: true, recodeEvidenceClass: "compatible_alternate" },
      },
      {
        sourceCategory: "Spirits",
        rowIndex: 2,
        sourceItemCode: "GROUP-A",
        sourceCodeReliability: "stable",
        itemMatch: { strategy: "name_pack", confidence: "high", possibleRecode: true, recodeEvidenceClass: "compatible_alternate" },
      },
    ];

    expect(getPendingRecodeCodes(rows, row => row.rowIndex === 1)).toEqual(["GROUP-A"]);
    expect(getPendingRecodeCodes(rows, () => true)).toEqual([]);
  });

  it("keeps eligible descriptive-code vendor-pack reviews row-scoped", () => {
    const rows = [
      {
        rowIndex: 41,
        sourceCategory: "Produce",
        sourceItemCode: "Avocado 54 Count",
        sourceCodeReliability: "pseudo_code" as const,
        itemMatch: {
          strategy: "name_pack",
          confidence: "medium",
          possibleRecode: true,
          recodeEvidenceClass: "new_pack_size" as const,
          crossVendorPackEligible: true,
        },
      },
      {
        rowIndex: 42,
        sourceCategory: "Produce",
        sourceItemCode: "Avocado 54 Count",
        sourceCodeReliability: "pseudo_code" as const,
        itemMatch: {
          strategy: "name_pack",
          confidence: "medium",
          possibleRecode: true,
          recodeEvidenceClass: "new_pack_size" as const,
          crossVendorPackEligible: true,
        },
      },
    ];

    expect(getPendingRecodeCodes(rows, row => row.rowIndex === 41)).toEqual(["row:42"]);
  });
});

// ─── uniqueCategories ─────────────────────────────────────────────────────────

describe("uniqueCategories", () => {
  it("returns an empty array for an empty row list", () => {
    expect(uniqueCategories([])).toEqual([]);
  });

  it("excludes rows with null sourceCategory", () => {
    const rows = [
      makeRow(null, "item_code", "high"),
      makeRow("Dairy", "item_code", "high"),
      makeRow(null, "none", "none"),
    ];
    expect(uniqueCategories(rows)).toEqual(["Dairy"]);
  });

  it("excludes rows with empty-string sourceCategory (null-coalesced to '')", () => {
    const rows = [
      makeRow("", "item_code", "high"),   // treated same as null after ?? ""
      makeRow("Meat", "item_code", "high"),
    ];
    // The empty-string row maps to "" which is filtered by .filter(Boolean)
    expect(uniqueCategories(rows)).toEqual(["Meat"]);
  });

  it("de-duplicates categories that appear on multiple rows", () => {
    const rows = [
      makeRow("Dairy", "item_code", "high"),
      makeRow("Dairy", "name_pack", "medium"),
      makeRow("Meat",  "item_code", "high"),
      makeRow("Dairy", "none",      "none"),
    ];
    expect(uniqueCategories(rows)).toEqual(["Dairy", "Meat"]);
  });

  it("returns categories sorted alphabetically", () => {
    const rows = [
      makeRow("Produce",   "item_code", "high"),
      makeRow("Bakery",    "item_code", "high"),
      makeRow("Dairy",     "item_code", "high"),
      makeRow("Beverages", "item_code", "high"),
    ];
    expect(uniqueCategories(rows)).toEqual(["Bakery", "Beverages", "Dairy", "Produce"]);
  });

  it("handles a large fixture (200+ rows) with many categories and null values", () => {
    const rows = makeLargeFixture();
    const cats = uniqueCategories(rows);
    // No nulls / empty strings in the result
    expect(cats.every(c => c.length > 0)).toBe(true);
    // Sorted
    const sorted = [...cats].sort();
    expect(cats).toEqual(sorted);
    // All 10 named categories should be present
    expect(cats).toContain("Dairy");
    expect(cats).toContain("Meat");
    expect(cats).toContain("Produce");
    expect(cats).toContain("Cleaning Supplies");
    expect(cats.length).toBe(10);
  });
});

// ─── applyFilters ─────────────────────────────────────────────────────────────

describe("applyFilters", () => {
  const rows: RowPreviewLike[] = [
    makeRow("Dairy",   "item_code", "high"),
    makeRow("Meat",    "name_pack", "medium"),
    makeRow("Produce", "fuzzy",     "low"),
    makeRow("Dairy",   "none",      "none"),   // Dairy + new
    makeRow(null,      "item_code", "high"),   // no category, high confidence
    makeRow("Seafood", "name_pack", "ambiguous"),
  ];

  it("returns all rows when both filter Sets are empty", () => {
    expect(applyFilters(rows, new Set(), new Set())).toHaveLength(rows.length);
  });

  it("filters to a single category", () => {
    const result = applyFilters(rows, new Set(["Dairy"]), new Set());
    expect(result).toHaveLength(2);
    expect(result.every(r => r.sourceCategory === "Dairy")).toBe(true);
  });

  it("filters to multiple selected categories", () => {
    const result = applyFilters(rows, new Set(["Dairy", "Meat"]), new Set());
    expect(result).toHaveLength(3);
    const cats = result.map(r => r.sourceCategory);
    expect(cats).toContain("Dairy");
    expect(cats).toContain("Meat");
    expect(cats).not.toContain("Produce");
  });

  it("row with null sourceCategory only passes when its '' is in the selected set", () => {
    // Selecting a real category should NOT include the null-sourceCategory row
    const result = applyFilters(rows, new Set(["Dairy"]), new Set());
    expect(result.every(r => r.sourceCategory !== null)).toBe(true);
  });

  it("filters to a single confidence level (high)", () => {
    const result = applyFilters(rows, new Set(), new Set(["high"]));
    expect(result.every(r => rowConfidenceKey(r) === "high")).toBe(true);
    expect(result).toHaveLength(2); // Dairy/high + null/high
  });

  it('filters to "new" confidence (strategy === "none")', () => {
    const result = applyFilters(rows, new Set(), new Set(["new"]));
    expect(result).toHaveLength(1);
    expect(result[0].itemMatch.strategy).toBe("none");
  });

  it('filters the exact server-held row population separately from create candidates', () => {
    const heldRow = makeRow("Wine", "none", "none");
    heldRow.heldForReview = true;
    const rowsWithHeld = [...rows, heldRow];

    expect(applyFilters(rowsWithHeld, new Set(), new Set(["held"]))).toEqual([heldRow]);
    expect(applyFilters(rowsWithHeld, new Set(), new Set(["new"]))).not.toContain(heldRow);
  });

  it("combines category and confidence filters with AND logic", () => {
    // Only Dairy rows that are also "new"
    const result = applyFilters(rows, new Set(["Dairy"]), new Set(["new"]));
    expect(result).toHaveLength(1);
    expect(result[0].sourceCategory).toBe("Dairy");
    expect(result[0].itemMatch.strategy).toBe("none");
  });

  it("returns empty array when no rows match the combined filter", () => {
    // Produce + new: there is no Produce row with strategy "none"
    const result = applyFilters(rows, new Set(["Produce"]), new Set(["new"]));
    expect(result).toHaveLength(0);
  });

  it("clears category filter — all rows pass when selectedCategories is reset to empty Set", () => {
    const withFilter = applyFilters(rows, new Set(["Dairy"]), new Set());
    expect(withFilter).toHaveLength(2);

    const cleared = applyFilters(rows, new Set(), new Set());
    expect(cleared).toHaveLength(rows.length);
  });

  it("clears confidence filter — all rows pass when selectedConfidences is reset to empty Set", () => {
    const withFilter = applyFilters(rows, new Set(), new Set(["high"]));
    expect(withFilter).toHaveLength(2);

    const cleared = applyFilters(rows, new Set(), new Set());
    expect(cleared).toHaveLength(rows.length);
  });

  it("handles a large fixture (200+ rows) without errors", () => {
    const largeRows = makeLargeFixture();
    const result = applyFilters(largeRows, new Set(["Dairy"]), new Set(["high"]));
    // All results must be Dairy rows with high confidence
    expect(result.every(r => r.sourceCategory === "Dairy")).toBe(true);
    expect(result.every(r => rowConfidenceKey(r) === "high")).toBe(true);
    // Sanity: result count is a subset of all rows
    expect(result.length).toBeLessThan(largeRows.length);
  });
});

// ─── toggleSetValue ───────────────────────────────────────────────────────────

describe("toggleSetValue", () => {
  it("adds a value that is not yet in the Set", () => {
    const result = toggleSetValue(new Set<string>(), "Dairy");
    expect(result.has("Dairy")).toBe(true);
    expect(result.size).toBe(1);
  });

  it("removes a value that is already in the Set", () => {
    const result = toggleSetValue(new Set(["Dairy"]), "Dairy");
    expect(result.has("Dairy")).toBe(false);
    expect(result.size).toBe(0);
  });

  it("does not mutate the original Set", () => {
    const original = new Set(["Dairy", "Meat"]);
    toggleSetValue(original, "Meat");
    expect(original.size).toBe(2); // unchanged
  });

  it("toggles one value without affecting others", () => {
    const set = new Set(["Dairy", "Meat", "Produce"]);
    const result = toggleSetValue(set, "Meat");
    expect(result.has("Dairy")).toBe(true);
    expect(result.has("Meat")).toBe(false);
    expect(result.has("Produce")).toBe(true);
  });

  it("works correctly for re-adding after removal (round-trip)", () => {
    const s0 = new Set<string>();
    const s1 = toggleSetValue(s0, "Dairy");  // add
    const s2 = toggleSetValue(s1, "Dairy");  // remove
    const s3 = toggleSetValue(s2, "Dairy");  // add again
    expect(s1.has("Dairy")).toBe(true);
    expect(s2.has("Dairy")).toBe(false);
    expect(s3.has("Dairy")).toBe(true);
  });
});
