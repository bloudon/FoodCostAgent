import { describe, it, expect } from "vitest";
import {
  resolvePriceSource,
  resolveScannedItemUnitPrice,
  resolveApplyLineUnitPrice,
} from "./invoiceScanUtils";

/**
 * Unit tests for the server-side invoice-scan price resolution utilities.
 *
 * These functions are called directly by:
 *   POST /api/onboarding/invoice-scan       — resolveScannedItemUnitPrice, resolvePriceSource
 *   POST /api/onboarding/invoice-scan/apply — resolveApplyLineUnitPrice
 */

describe("resolvePriceSource — POST /api/onboarding/invoice-scan", () => {
  it('returns "unit" when unitPrice is a positive number', () => {
    expect(resolvePriceSource({ unitPrice: 4.5, casePrice: 22.5 })).toBe("unit");
  });

  it('returns "unit" when unitPrice is 0 (AI explicitly returned zero)', () => {
    expect(resolvePriceSource({ unitPrice: 0, casePrice: 22.5 })).toBe("unit");
  });

  it('returns "case" when unitPrice is null but casePrice is present', () => {
    expect(resolvePriceSource({ unitPrice: null, casePrice: 34.99 })).toBe("case");
  });

  it('returns "case" when unitPrice is undefined but casePrice is present', () => {
    expect(resolvePriceSource({ unitPrice: undefined, casePrice: 34.99 })).toBe("case");
  });

  it('returns "zero" when both prices are null', () => {
    expect(resolvePriceSource({ unitPrice: null, casePrice: null })).toBe("zero");
  });

  it('returns "zero" when both prices are undefined', () => {
    expect(resolvePriceSource({ unitPrice: undefined, casePrice: undefined })).toBe("zero");
  });
});

describe("resolveScannedItemUnitPrice — POST /api/onboarding/invoice-scan: unitPrice is always a number", () => {
  it("returns unitPrice when the AI provides a unit price", () => {
    expect(resolveScannedItemUnitPrice({ unitPrice: 4.5, casePrice: 22.5 })).toBe(4.5);
  });

  it("returns unitPrice 0 when AI explicitly says $0 (preserves zero over casePrice)", () => {
    // 0 != null so unitPrice=0 is kept, not replaced by casePrice
    expect(resolveScannedItemUnitPrice({ unitPrice: 0, casePrice: 22.5 })).toBe(0);
  });

  it("falls back to casePrice when unitPrice is null — Deliverable 1 regression", () => {
    // This is the core regression: AI returns null unitPrice + valid casePrice
    const result = resolveScannedItemUnitPrice({ unitPrice: null, casePrice: 34.99 });
    expect(typeof result).toBe("number");
    expect(result).toBe(34.99);
  });

  it("falls back to casePrice when unitPrice is undefined", () => {
    const result = resolveScannedItemUnitPrice({ unitPrice: undefined, casePrice: 34.99 });
    expect(typeof result).toBe("number");
    expect(result).toBe(34.99);
  });

  it("returns 0 (number) when both prices are null — never returns null or undefined", () => {
    const result = resolveScannedItemUnitPrice({ unitPrice: null, casePrice: null });
    expect(typeof result).toBe("number");
    expect(result).toBe(0);
  });

  it("returns 0 (number) when both prices are undefined — never returns null or undefined", () => {
    const result = resolveScannedItemUnitPrice({ unitPrice: undefined, casePrice: undefined });
    expect(typeof result).toBe("number");
    expect(result).toBe(0);
  });

  it("always returns a number regardless of input shape", () => {
    const cases: Array<{ unitPrice: null | undefined; casePrice: null | undefined | number }> = [
      { unitPrice: null, casePrice: null },
      { unitPrice: null, casePrice: undefined },
      { unitPrice: undefined, casePrice: null },
      { unitPrice: undefined, casePrice: undefined },
      { unitPrice: null, casePrice: 0 },
      { unitPrice: undefined, casePrice: 0 },
    ];
    for (const item of cases) {
      const result = resolveScannedItemUnitPrice(item);
      expect(typeof result, `Expected number for ${JSON.stringify(item)}`).toBe("number");
    }
  });
});

describe("resolveApplyLineUnitPrice — POST /api/onboarding/invoice-scan/apply: effectiveUnitPrice", () => {
  it("uses unitPrice when present", () => {
    expect(resolveApplyLineUnitPrice({ unitPrice: 4.5, casePrice: 22.5 })).toBe(4.5);
  });

  it("uses unitPrice 0 when explicitly set (preserves zero over casePrice)", () => {
    expect(resolveApplyLineUnitPrice({ unitPrice: 0, casePrice: 22.5 })).toBe(0);
  });

  it("falls back to casePrice when unitPrice is null — Deliverable 2 regression", () => {
    // Core regression: null unitPrice + valid casePrice should yield casePrice, not 0
    const result = resolveApplyLineUnitPrice({ unitPrice: null, casePrice: 29.99 });
    expect(typeof result).toBe("number");
    expect(result).toBe(29.99);
  });

  it("falls back to casePrice when unitPrice is undefined", () => {
    const result = resolveApplyLineUnitPrice({ unitPrice: undefined, casePrice: 29.99 });
    expect(typeof result).toBe("number");
    expect(result).toBe(29.99);
  });

  it("returns 0 when both prices are absent", () => {
    expect(resolveApplyLineUnitPrice({ unitPrice: null, casePrice: null })).toBe(0);
    expect(resolveApplyLineUnitPrice({ unitPrice: undefined, casePrice: undefined })).toBe(0);
    expect(resolveApplyLineUnitPrice({})).toBe(0);
  });

  it("always returns a number — never null or undefined", () => {
    const cases = [
      {},
      { unitPrice: null },
      { casePrice: null },
      { unitPrice: null, casePrice: null },
      { unitPrice: undefined, casePrice: undefined },
    ];
    for (const line of cases) {
      const result = resolveApplyLineUnitPrice(line);
      expect(typeof result, `Expected number for ${JSON.stringify(line)}`).toBe("number");
    }
  });

  it("handles large case prices (case = unit when no pack size breakdown)", () => {
    const result = resolveApplyLineUnitPrice({ unitPrice: null, casePrice: 189.5 });
    expect(result).toBe(189.5);
  });

  it("handles fractional prices precisely", () => {
    const result = resolveApplyLineUnitPrice({ unitPrice: null, casePrice: 4.9999 });
    expect(result).toBeCloseTo(4.9999, 4);
  });
});
