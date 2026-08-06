import { describe, it, expect } from "vitest";
import {
  computeMatchCounts,
  getPageBreakInsertionIndex,
  getPageBreakLabel,
  buildReviewUrl,
  parseOrderGuideScanParams,
  buildOrderGuideScanUrl,
  buildAppendedLines,
  mergeAppendedLines,
  type ScannedLine,
} from "./orderGuideScanUtils";

function makeLine(
  id: string,
  matchStatus: 'matched' | 'ambiguous' | 'new',
  overrides: Partial<ScannedLine> = {}
): ScannedLine {
  return {
    id,
    vendorSku: `SKU-${id}`,
    productName: `Product ${id}`,
    packSize: null,
    uom: null,
    price: null,
    matchStatus,
    matchConfidence: null,
    ...overrides,
  };
}

describe("computeMatchCounts", () => {
  it("returns zeros for an empty lines array", () => {
    const counts = computeMatchCounts([]);
    expect(counts.matched).toBe(0);
    expect(counts.ambiguous).toBe(0);
    expect(counts.newItems).toBe(0);
    expect(counts.total).toBe(0);
  });

  it("counts all matched lines", () => {
    const lines = [
      makeLine("1", "matched"),
      makeLine("2", "matched"),
      makeLine("3", "matched"),
    ];
    const counts = computeMatchCounts(lines);
    expect(counts.matched).toBe(3);
    expect(counts.ambiguous).toBe(0);
    expect(counts.newItems).toBe(0);
    expect(counts.total).toBe(3);
  });

  it("counts all ambiguous lines", () => {
    const lines = [
      makeLine("1", "ambiguous"),
      makeLine("2", "ambiguous"),
    ];
    const counts = computeMatchCounts(lines);
    expect(counts.matched).toBe(0);
    expect(counts.ambiguous).toBe(2);
    expect(counts.newItems).toBe(0);
    expect(counts.total).toBe(2);
  });

  it("counts all new lines", () => {
    const lines = [makeLine("1", "new"), makeLine("2", "new")];
    const counts = computeMatchCounts(lines);
    expect(counts.matched).toBe(0);
    expect(counts.ambiguous).toBe(0);
    expect(counts.newItems).toBe(2);
    expect(counts.total).toBe(2);
  });

  it("counts mixed match statuses correctly", () => {
    const lines = [
      makeLine("1", "matched"),
      makeLine("2", "matched"),
      makeLine("3", "ambiguous"),
      makeLine("4", "new"),
      makeLine("5", "new"),
      makeLine("6", "new"),
    ];
    const counts = computeMatchCounts(lines);
    expect(counts.matched).toBe(2);
    expect(counts.ambiguous).toBe(1);
    expect(counts.newItems).toBe(3);
    expect(counts.total).toBe(6);
  });

  it("total equals matched + ambiguous + new", () => {
    const lines = [
      makeLine("1", "matched"),
      makeLine("2", "ambiguous"),
      makeLine("3", "new"),
      makeLine("4", "new"),
    ];
    const counts = computeMatchCounts(lines);
    expect(counts.total).toBe(counts.matched + counts.ambiguous + counts.newItems);
  });
});

describe("getPageBreakInsertionIndex", () => {
  it("returns 0 for an empty existing lines array", () => {
    expect(getPageBreakInsertionIndex([])).toBe(0);
  });

  it("returns the count of existing lines (page break goes after them)", () => {
    const lines = [makeLine("1", "matched"), makeLine("2", "new")];
    expect(getPageBreakInsertionIndex(lines)).toBe(2);
  });

  it("returns correct index for a single existing line", () => {
    const lines = [makeLine("1", "matched")];
    expect(getPageBreakInsertionIndex(lines)).toBe(1);
  });
});

describe("getPageBreakLabel", () => {
  it("returns null when index is not a page break", () => {
    expect(getPageBreakLabel([5, 10], 0)).toBeNull();
    expect(getPageBreakLabel([5, 10], 3)).toBeNull();
    expect(getPageBreakLabel([5, 10], 7)).toBeNull();
  });

  it("returns '— Page 2 —' for the first page break", () => {
    expect(getPageBreakLabel([5], 5)).toBe("— Page 2 —");
  });

  it("returns '— Page 3 —' for the second page break", () => {
    expect(getPageBreakLabel([5, 10], 10)).toBe("— Page 3 —");
  });

  it("returns '— Page 4 —' for the third page break", () => {
    expect(getPageBreakLabel([5, 10, 15], 15)).toBe("— Page 4 —");
  });

  it("returns null when pageBreaks array is empty", () => {
    expect(getPageBreakLabel([], 0)).toBeNull();
    expect(getPageBreakLabel([], 5)).toBeNull();
  });
});

describe("buildReviewUrl", () => {
  it("builds the correct review URL for a given order guide ID", () => {
    expect(buildReviewUrl("abc-123")).toBe("/order-guides/abc-123/review");
  });

  it("builds the correct review URL for a UUID-style ID", () => {
    const id = "3d91e5f0-71c6-457a-88cb-17353ae49e00";
    expect(buildReviewUrl(id)).toBe(`/order-guides/${id}/review`);
  });
});

describe("parseOrderGuideScanParams", () => {
  it("returns empty strings when no params are present", () => {
    const result = parseOrderGuideScanParams("");
    expect(result.vendorId).toBe("");
    expect(result.storeId).toBe("");
    expect(result.orderGuideId).toBe("");
  });

  it("parses vendorId from query string", () => {
    const result = parseOrderGuideScanParams("vendorId=vendor-abc");
    expect(result.vendorId).toBe("vendor-abc");
    expect(result.storeId).toBe("");
    expect(result.orderGuideId).toBe("");
  });

  it("parses storeId from query string", () => {
    const result = parseOrderGuideScanParams("storeId=store-xyz");
    expect(result.vendorId).toBe("");
    expect(result.storeId).toBe("store-xyz");
    expect(result.orderGuideId).toBe("");
  });

  it("parses ogId from query string as orderGuideId", () => {
    const id = "3d91e5f0-71c6-457a-88cb-17353ae49e00";
    const result = parseOrderGuideScanParams(`ogId=${id}`);
    expect(result.orderGuideId).toBe(id);
    expect(result.vendorId).toBe("");
    expect(result.storeId).toBe("");
  });

  it("parses all three params simultaneously", () => {
    const result = parseOrderGuideScanParams(
      "vendorId=v1&storeId=s1&ogId=og1"
    );
    expect(result.vendorId).toBe("v1");
    expect(result.storeId).toBe("s1");
    expect(result.orderGuideId).toBe("og1");
  });

  it("ignores unrecognized params", () => {
    const result = parseOrderGuideScanParams("unknown=foo&vendorId=bar");
    expect(result.vendorId).toBe("bar");
    expect(result.storeId).toBe("");
    expect(result.orderGuideId).toBe("");
  });
});

describe("buildOrderGuideScanUrl", () => {
  it("returns base path when no params are provided", () => {
    expect(buildOrderGuideScanUrl({})).toBe("/order-guide-scan");
  });

  it("includes vendorId when provided", () => {
    expect(buildOrderGuideScanUrl({ vendorId: "v1" })).toBe(
      "/order-guide-scan?vendorId=v1"
    );
  });

  it("includes storeId when provided", () => {
    expect(buildOrderGuideScanUrl({ storeId: "s1" })).toBe(
      "/order-guide-scan?storeId=s1"
    );
  });

  it("includes ogId when provided", () => {
    expect(buildOrderGuideScanUrl({ ogId: "og1" })).toBe(
      "/order-guide-scan?ogId=og1"
    );
  });

  it("includes all params when all are provided", () => {
    const url = buildOrderGuideScanUrl({ vendorId: "v1", storeId: "s1", ogId: "og1" });
    expect(url).toContain("vendorId=v1");
    expect(url).toContain("storeId=s1");
    expect(url).toContain("ogId=og1");
    expect(url.startsWith("/order-guide-scan?")).toBe(true);
  });

  it("omits undefined params", () => {
    const url = buildOrderGuideScanUrl({ vendorId: "v1", storeId: undefined });
    expect(url).toContain("vendorId=v1");
    expect(url).not.toContain("storeId");
  });
});

describe("buildAppendedLines — first append (single existing page)", () => {
  it("combines existing and new lines in order", () => {
    const existing = [makeLine("1", "matched"), makeLine("2", "new")];
    const newLines = [makeLine("3", "new"), makeLine("4", "ambiguous")];
    const { lines } = buildAppendedLines(existing, newLines);
    expect(lines).toHaveLength(4);
    expect(lines[0].id).toBe("1");
    expect(lines[1].id).toBe("2");
    expect(lines[2].id).toBe("3");
    expect(lines[3].id).toBe("4");
  });

  it("inserts a page break at the existing line count position", () => {
    const existing = [makeLine("1", "matched"), makeLine("2", "new")];
    const newLines = [makeLine("3", "new")];
    const { pageBreaks } = buildAppendedLines(existing, newLines);
    expect(pageBreaks).toEqual([2]);
  });

  it("adds no page break when new lines array is empty", () => {
    const existing = [makeLine("1", "matched")];
    const { lines, pageBreaks } = buildAppendedLines(existing, []);
    expect(lines).toHaveLength(1);
    expect(pageBreaks).toHaveLength(0);
  });

  it("handles empty existing lines (first-ever append returns break at 0)", () => {
    const newLines = [makeLine("1", "new"), makeLine("2", "matched")];
    const { lines, pageBreaks } = buildAppendedLines([], newLines);
    expect(lines).toHaveLength(2);
    expect(pageBreaks).toEqual([0]);
  });
});

describe("mergeAppendedLines — multi-page append accumulation", () => {
  it("accumulates page breaks across multiple appends", () => {
    const page1 = [makeLine("1", "matched"), makeLine("2", "new")];
    const page2 = [makeLine("3", "ambiguous")];
    const page3 = [makeLine("4", "new"), makeLine("5", "matched")];

    const after2 = mergeAppendedLines(page1, [], page2);
    expect(after2.pageBreaks).toEqual([2]);
    expect(after2.lines).toHaveLength(3);

    const after3 = mergeAppendedLines(after2.lines, after2.pageBreaks, page3);
    expect(after3.pageBreaks).toEqual([2, 3]);
    expect(after3.lines).toHaveLength(5);
  });

  it("page break label at index 2 reads '— Page 2 —' in a two-page scan", () => {
    const page1 = [makeLine("1", "matched"), makeLine("2", "new")];
    const page2 = [makeLine("3", "new")];
    const { pageBreaks } = mergeAppendedLines(page1, [], page2);
    expect(getPageBreakLabel(pageBreaks, 2)).toBe("— Page 2 —");
  });

  it("page break labels read '— Page 2 —' and '— Page 3 —' for a three-page scan", () => {
    const page1 = [makeLine("1", "matched"), makeLine("2", "new")];
    const page2 = [makeLine("3", "ambiguous")];
    const page3 = [makeLine("4", "new")];

    const after2 = mergeAppendedLines(page1, [], page2);
    const after3 = mergeAppendedLines(after2.lines, after2.pageBreaks, page3);

    expect(getPageBreakLabel(after3.pageBreaks, 2)).toBe("— Page 2 —");
    expect(getPageBreakLabel(after3.pageBreaks, 3)).toBe("— Page 3 —");
    expect(getPageBreakLabel(after3.pageBreaks, 0)).toBeNull();
    expect(getPageBreakLabel(after3.pageBreaks, 1)).toBeNull();
    expect(getPageBreakLabel(after3.pageBreaks, 4)).toBeNull();
  });

  it("preserves existing lines when new lines array is empty", () => {
    const existing = [makeLine("1", "matched")];
    const existingBreaks = [5];
    const { lines, pageBreaks } = mergeAppendedLines(existing, existingBreaks, []);
    expect(lines).toHaveLength(1);
    expect(pageBreaks).toEqual([5]);
  });
});
