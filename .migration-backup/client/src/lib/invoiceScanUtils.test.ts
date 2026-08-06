import { describe, it, expect } from "vitest";
import {
  resolveScannedItemPrice,
  resolveEffectiveUnitPrice,
  defaultScanAction,
} from "./invoiceScanUtils";

// ---------------------------------------------------------------------------
// resolveScannedItemPrice — mirrors POST /api/onboarding/invoice-scan logic
// ---------------------------------------------------------------------------

describe("resolveScannedItemPrice", () => {
  describe("unitPrice is always a number in the resolved output", () => {
    it("returns a number when the AI provides both unitPrice and casePrice", () => {
      const { resolvedUnitPrice } = resolveScannedItemPrice(1.25, 14.99);
      expect(typeof resolvedUnitPrice).toBe("number");
      expect(resolvedUnitPrice).toBe(1.25);
    });

    it("returns a number when the AI provides only unitPrice (no casePrice)", () => {
      const { resolvedUnitPrice } = resolveScannedItemPrice(2.5, null);
      expect(typeof resolvedUnitPrice).toBe("number");
      expect(resolvedUnitPrice).toBe(2.5);
    });

    it("falls back to casePrice when unitPrice is null (distributor case-only invoice)", () => {
      const { resolvedUnitPrice } = resolveScannedItemPrice(null, 34.5);
      expect(typeof resolvedUnitPrice).toBe("number");
      expect(resolvedUnitPrice).toBe(34.5);
    });

    it("returns 0 (not null/undefined) when both prices are null", () => {
      const { resolvedUnitPrice } = resolveScannedItemPrice(null, null);
      expect(typeof resolvedUnitPrice).toBe("number");
      expect(resolvedUnitPrice).toBe(0);
    });

    it("preserves a zero unitPrice as-is (not confused with null)", () => {
      const { resolvedUnitPrice } = resolveScannedItemPrice(0, 14.99);
      expect(resolvedUnitPrice).toBe(0);
    });
  });

  describe("priceSource reflects the correct origin", () => {
    it("reports priceSource = 'unit' when unitPrice is provided", () => {
      const { priceSource } = resolveScannedItemPrice(1.25, 14.99);
      expect(priceSource).toBe("unit");
    });

    it("reports priceSource = 'unit' when only unitPrice is provided", () => {
      const { priceSource } = resolveScannedItemPrice(2.5, null);
      expect(priceSource).toBe("unit");
    });

    it("reports priceSource = 'case' when unitPrice is null but casePrice is set", () => {
      const { priceSource } = resolveScannedItemPrice(null, 34.5);
      expect(priceSource).toBe("case");
    });

    it("reports priceSource = 'zero' when both prices are null", () => {
      const { priceSource } = resolveScannedItemPrice(null, null);
      expect(priceSource).toBe("zero");
    });

    it("reports priceSource = 'unit' even when unitPrice is 0", () => {
      const { priceSource } = resolveScannedItemPrice(0, 14.99);
      expect(priceSource).toBe("unit");
    });
  });

  describe("regression — null unitPrice + valid casePrice returns numeric resolved price", () => {
    it("common distributor invoice: only casePrice extracted → resolvedUnitPrice equals casePrice", () => {
      const result = resolveScannedItemPrice(null, 48.75);
      expect(result.resolvedUnitPrice).toBe(48.75);
      expect(result.priceSource).toBe("case");
    });

    it("multiple case-only items all resolve to a number, never null", () => {
      const inputs = [
        { unitPrice: null, casePrice: 10.0 },
        { unitPrice: null, casePrice: 22.5 },
        { unitPrice: null, casePrice: 0.99 },
      ];
      for (const { unitPrice, casePrice } of inputs) {
        const { resolvedUnitPrice } = resolveScannedItemPrice(unitPrice, casePrice);
        expect(typeof resolvedUnitPrice).toBe("number");
        expect(isNaN(resolvedUnitPrice)).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveUnitPrice — mirrors apply endpoint's effectiveUnitPrice logic
// ---------------------------------------------------------------------------

describe("resolveEffectiveUnitPrice (POST /api/onboarding/invoice-scan/apply)", () => {
  it("uses unitPrice when it is a non-null number", () => {
    expect(resolveEffectiveUnitPrice(3.5, 40.0)).toBe(3.5);
  });

  it("falls back to casePrice when unitPrice is null (case-only item)", () => {
    expect(resolveEffectiveUnitPrice(null, 40.0)).toBe(40.0);
  });

  it("falls back to casePrice when unitPrice is undefined", () => {
    expect(resolveEffectiveUnitPrice(undefined, 40.0)).toBe(40.0);
  });

  it("returns 0 when both unitPrice and casePrice are null", () => {
    expect(resolveEffectiveUnitPrice(null, null)).toBe(0);
  });

  it("returns 0 when both are undefined", () => {
    expect(resolveEffectiveUnitPrice(undefined, undefined)).toBe(0);
  });

  it("returns 0 when unitPrice is null and casePrice is null (item should have been skipped)", () => {
    expect(resolveEffectiveUnitPrice(null, null)).toBe(0);
  });

  it("regression — null unitPrice with valid casePrice creates effectiveUnitPrice = casePrice", () => {
    const effectiveUnitPrice = resolveEffectiveUnitPrice(null, 28.99);
    expect(effectiveUnitPrice).toBe(28.99);
  });

  it("result is always a number, never null or undefined", () => {
    const scenarios: Array<[number | null | undefined, number | null | undefined]> = [
      [null, null],
      [null, undefined],
      [undefined, null],
      [undefined, undefined],
      [null, 5.0],
      [5.0, null],
    ];
    for (const [u, c] of scenarios) {
      const result = resolveEffectiveUnitPrice(u, c);
      expect(typeof result).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// defaultScanAction — mirrors UI logic in InvoiceScanStep
// ---------------------------------------------------------------------------

describe("defaultScanAction", () => {
  it("returns 'skip' for zero-price items regardless of match confidence", () => {
    expect(defaultScanAction("zero", "high")).toBe("skip");
    expect(defaultScanAction("zero", "medium")).toBe("skip");
    expect(defaultScanAction("zero", "none")).toBe("skip");
  });

  it("returns 'update' for high-confidence matches with a real price", () => {
    expect(defaultScanAction("unit", "high")).toBe("update");
    expect(defaultScanAction("case", "high")).toBe("update");
  });

  it("returns 'update' for medium-confidence matches with a real price", () => {
    expect(defaultScanAction("unit", "medium")).toBe("update");
    expect(defaultScanAction("case", "medium")).toBe("update");
  });

  it("returns 'create' when there is no match (confidence = none)", () => {
    expect(defaultScanAction("unit", "none")).toBe("create");
    expect(defaultScanAction("case", "none")).toBe("create");
  });

  it("case-price fallback items with no match default to 'create'", () => {
    expect(defaultScanAction("case", "none")).toBe("create");
  });
});
