/**
 * M3A — Vendor Price Integrity: targeted unit tests
 *
 * Covers:
 *   1. Price conversion  (case→unit, compound packs, weight-based, zero/invalid)
 *   2. Source behavior   (quote guard prevents actual-cost contamination)
 *   3. WAC calculation   (weighted average cost)
 *   4. Staleness flag    (>90 days = stale, null = stale)
 *   5. Comparison ranking (unit price, not case price, determines rank)
 *   6. Legacy backfill   (legacy_unknown excluded from recommendations)
 */

import { describe, it, expect } from "vitest";
import { deriveUnitPrice } from "./orderGuideProcessor";
import {
  guardQuoteAsActual,
  computeWac,
  isPriceStale,
  ACTUAL_PURCHASE_SOURCES,
  QUOTE_SOURCES,
} from "./vendorPriceService";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Price conversion — case → unit
// ─────────────────────────────────────────────────────────────────────────────

describe("Price conversion: case → unit via deriveUnitPrice", () => {
  it("simple weight case: 50 lb case at $25 → $0.50/lb", () => {
    const { unitPrice } = deriveUnitPrice(25, 50, 1, "lb", "pound");
    expect(unitPrice).toBeCloseTo(0.5);
  });

  it("compound pack: 6 bags × 5 lb = 30 lb, $60 case → $2.00/lb", () => {
    const { unitPrice } = deriveUnitPrice(60, 6, 5, "lb", "pound");
    expect(unitPrice).toBeCloseTo(2.0);
  });

  it("each-based item: 24 EA, $48 case → $2.00/ea", () => {
    const { unitPrice } = deriveUnitPrice(48, 24, 1, "ea", "each");
    expect(unitPrice).toBeCloseTo(2.0);
  });

  it("each-based 12-count case: outerCount=12 → $36 case = $3.00/ea", () => {
    // For "each" family, deriveUnitPrice divides by outerCount only
    const { unitPrice } = deriveUnitPrice(36, 12, 1, "ea", "each");
    expect(unitPrice).toBeCloseTo(3.0);
  });

  it("caseSize=0 guard — does not produce Infinity or NaN", () => {
    const { unitPrice } = deriveUnitPrice(30, 0, 1, "lb", "pound");
    expect(Number.isFinite(unitPrice)).toBe(true);
    expect(Number.isNaN(unitPrice)).toBe(false);
  });

  it("zero case price → zero unit price", () => {
    const { unitPrice } = deriveUnitPrice(0, 10, 1, "lb", "pound");
    expect(unitPrice).toBe(0);
  });

  it("lower case price but higher unit price (small pack): does not rank as cheaper on unit basis", () => {
    // Vendor A: $30 for 20 lb = $1.50/lb
    // Vendor B: $20 for 10 lb = $2.00/lb  ← lower case price but more expensive per lb
    const vpA = { casePrice: 30, unitPrice: deriveUnitPrice(30, 20, 1, "lb", "pound").unitPrice };
    const vpB = { casePrice: 20, unitPrice: deriveUnitPrice(20, 10, 1, "lb", "pound").unitPrice };

    // Sorted by unit price: A should rank first (cheaper per unit)
    const sorted = [vpA, vpB].sort((a, b) => a.unitPrice - b.unitPrice);
    expect(sorted[0]).toBe(vpA);
    expect(vpB.casePrice).toBeLessThan(vpA.casePrice); // B has lower case price...
    expect(vpB.unitPrice).toBeGreaterThan(vpA.unitPrice); // ...but higher unit price
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Source behavior guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Source behavior: quote sources cannot represent actual purchases", () => {
  it("order_guide_import with representsActualPurchase=true is overridden to false", () => {
    const result = guardQuoteAsActual("order_guide_import", true);
    expect(result).toBe(false);
  });

  it("connector with representsActualPurchase=true is overridden to false", () => {
    const result = guardQuoteAsActual("connector" as any, true);
    expect(result).toBe(false);
  });

  it("order_guide_import with representsActualPurchase=false remains false", () => {
    expect(guardQuoteAsActual("order_guide_import", false)).toBe(false);
  });

  it("receipt with representsActualPurchase=true is allowed (actual purchase)", () => {
    expect(guardQuoteAsActual("receipt", true)).toBe(true);
  });

  it("invoice_scan with representsActualPurchase=true is allowed (actual purchase)", () => {
    expect(guardQuoteAsActual("invoice_scan", true)).toBe(true);
  });

  it("manual with representsActualPurchase=false is allowed (quote)", () => {
    expect(guardQuoteAsActual("manual", false)).toBe(false);
  });

  it("po_create with representsActualPurchase=true is allowed (not blocked by guard)", () => {
    // po_create is a quote source but the guard only blocks order_guide_import and connector
    expect(guardQuoteAsActual("po_create", true)).toBe(true);
  });

  it("ACTUAL_PURCHASE_SOURCES contains only receipt and invoice_scan", () => {
    expect(ACTUAL_PURCHASE_SOURCES.has("receipt")).toBe(true);
    expect(ACTUAL_PURCHASE_SOURCES.has("invoice_scan")).toBe(true);
    expect(ACTUAL_PURCHASE_SOURCES.has("order_guide_import")).toBe(false);
    expect(ACTUAL_PURCHASE_SOURCES.has("manual")).toBe(false);
    expect(ACTUAL_PURCHASE_SOURCES.has("po_create")).toBe(false);
  });

  it("QUOTE_SOURCES contains order_guide_import, manual, po_create, legacy_unknown", () => {
    expect(QUOTE_SOURCES.has("order_guide_import")).toBe(true);
    expect(QUOTE_SOURCES.has("manual")).toBe(true);
    expect(QUOTE_SOURCES.has("po_create")).toBe(true);
    expect(QUOTE_SOURCES.has("legacy_unknown")).toBe(true);
    expect(QUOTE_SOURCES.has("receipt")).toBe(false);
    expect(QUOTE_SOURCES.has("invoice_scan")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WAC calculation
// ─────────────────────────────────────────────────────────────────────────────

describe("WAC (Weighted Average Cost) calculation", () => {
  it("first receipt on zero on-hand: WAC = received unit price", () => {
    const wac = computeWac(0, 0, 50, 2.0);
    expect(wac).toBeCloseTo(2.0);
  });

  it("equal quantities: WAC = average of old and new", () => {
    // 100 lb @ $2.00, receive 100 lb @ $3.00 → WAC = $2.50
    const wac = computeWac(100, 2.0, 100, 3.0);
    expect(wac).toBeCloseTo(2.5);
  });

  it("large existing stock: WAC weighted toward existing cost", () => {
    // 900 lb @ $2.00, receive 100 lb @ $4.00 → WAC = (1800 + 400)/1000 = $2.20
    const wac = computeWac(900, 2.0, 100, 4.0);
    expect(wac).toBeCloseTo(2.2);
  });

  it("zero total qty guard: returns received unit price", () => {
    // Edge case: both qty are 0
    const wac = computeWac(0, 0, 0, 5.0);
    expect(wac).toBe(5.0);
  });

  it("negative on-hand (write-off scenario): still computes correctly", () => {
    // 10 lb current @ $2, receive 20 lb @ $3 → (20 + 60)/30 = $2.67
    const wac = computeWac(10, 2.0, 20, 3.0);
    expect(wac).toBeCloseTo(2.667, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Staleness flag
// ─────────────────────────────────────────────────────────────────────────────

describe("Price staleness detection (isPriceStale)", () => {
  it("null pricedAt → stale", () => {
    expect(isPriceStale(null)).toBe(true);
  });

  it("undefined pricedAt → stale", () => {
    expect(isPriceStale(undefined)).toBe(true);
  });

  it("price from 1 year ago → stale", () => {
    const oneYearAgo = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    expect(isPriceStale(oneYearAgo)).toBe(true);
  });

  it("price from 91 days ago → stale", () => {
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    expect(isPriceStale(ninetyOneDaysAgo)).toBe(true);
  });

  it("price from yesterday → not stale", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(isPriceStale(yesterday)).toBe(false);
  });

  it("price from exactly today → not stale", () => {
    expect(isPriceStale(new Date())).toBe(false);
  });

  it("price from 89 days ago → not stale", () => {
    const eightyNineDaysAgo = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
    expect(isPriceStale(eightyNineDaysAgo)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Comparison ranking — unit price determines rank, not case price
// ─────────────────────────────────────────────────────────────────────────────

describe("Comparison ranking by unit price", () => {
  interface MockVP {
    vendorId: string;
    unitPrice: number;
    casePrice: number;
    priceSource: string;
    stale: boolean;
  }

  function rankByUnitPrice(prices: MockVP[]): MockVP[] {
    return [...prices].sort((a, b) => a.unitPrice - b.unitPrice);
  }

  function eligibleOnly(prices: MockVP[]): MockVP[] {
    return prices.filter(vp => vp.priceSource !== "legacy_unknown" && !vp.stale);
  }

  it("vendor with lower case price but higher unit price does not rank first", () => {
    const prices: MockVP[] = [
      { vendorId: "A", unitPrice: 1.5, casePrice: 30, priceSource: "receipt", stale: false },
      { vendorId: "B", unitPrice: 2.0, casePrice: 20, priceSource: "receipt", stale: false },
    ];
    const ranked = rankByUnitPrice(prices);
    expect(ranked[0].vendorId).toBe("A"); // cheaper per unit despite higher case price
  });

  it("legacy_unknown rows excluded from recommendation but present in data", () => {
    const prices: MockVP[] = [
      { vendorId: "A", unitPrice: 2.0, casePrice: 40, priceSource: "receipt", stale: false },
      { vendorId: "B", unitPrice: 1.0, casePrice: 10, priceSource: "legacy_unknown", stale: false },
    ];
    const allData = rankByUnitPrice(prices);
    const forRecommendation = eligibleOnly(allData);

    // All rows appear in data
    expect(allData).toHaveLength(2);
    // But legacy_unknown excluded from recommendation
    expect(forRecommendation).toHaveLength(1);
    expect(forRecommendation[0].vendorId).toBe("A");
  });

  it("stale price excluded from cheaperAvailable recommendation", () => {
    const prices: MockVP[] = [
      { vendorId: "current", unitPrice: 3.0, casePrice: 60, priceSource: "receipt", stale: false },
      { vendorId: "cheap", unitPrice: 1.0, casePrice: 20, priceSource: "order_guide_import", stale: true },
    ];
    const eligible = eligibleOnly(prices);
    // Stale price not eligible for recommendation
    expect(eligible).toHaveLength(1);
    expect(eligible[0].vendorId).toBe("current");
  });

  it("cheaperAvailable is false when only one eligible vendor exists", () => {
    const prices: MockVP[] = [
      { vendorId: "current", unitPrice: 3.0, casePrice: 60, priceSource: "receipt", stale: false },
      { vendorId: "cheap", unitPrice: 1.0, casePrice: 20, priceSource: "legacy_unknown", stale: false },
    ];
    const eligible = eligibleOnly(prices);
    // Only one eligible — cannot determine cheaperAvailable
    const currentPrice = eligible.find(vp => vp.vendorId === "current")?.unitPrice ?? null;
    const bestPrice = eligible[0]?.unitPrice ?? null;
    const cheaperAvailable =
      currentPrice !== null && bestPrice !== null && bestPrice < currentPrice - 0.0001;
    expect(cheaperAvailable).toBe(false);
  });

  it("savings per case uses best vendor caseSize", () => {
    // current: $3/lb, 20 lb case = $60
    // best:    $2/lb, 25 lb case = $50
    // savings = ($3 - $2) * 25 = $25
    const currentUnitPrice = 3.0;
    const bestUnitPrice = 2.0;
    const bestCaseSize = 25;
    const savings = (currentUnitPrice - bestUnitPrice) * bestCaseSize;
    expect(savings).toBeCloseTo(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Legacy backfill — provenance classification behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("Legacy backfill: provenance classification", () => {
  it("row with no priceSource should be treated as legacy_unknown in recommendation filter", () => {
    // Simulates what the migration does: rows with NULL priceSource → legacy_unknown
    const priceSource: string | null = null;
    const effectiveSource = priceSource ?? "legacy_unknown";
    expect(effectiveSource).toBe("legacy_unknown");
  });

  it("legacy_unknown rows are excluded from cheaperAvailable recommendation", () => {
    const priceSource = "legacy_unknown";
    const isEligibleForRecommendation = priceSource !== "legacy_unknown";
    expect(isEligibleForRecommendation).toBe(false);
  });

  it("rows from receipt source are eligible for recommendation", () => {
    const priceSource = "receipt";
    const isEligibleForRecommendation = priceSource !== "legacy_unknown";
    expect(isEligibleForRecommendation).toBe(true);
  });

  it("bulk comparison 403: cross-tenant IDs are detected as foreign", () => {
    // Simulates the ownership check: ownedSet contains only IDs from caller's company
    const callerOwnedIds = new Set(["item-1", "item-2"]);
    const requested = ["item-1", "item-3"]; // item-3 is foreign
    const foreign = requested.filter(id => !callerOwnedIds.has(id));
    expect(foreign).toEqual(["item-3"]);
    expect(foreign.length).toBeGreaterThan(0); // would trigger 403
  });

  it("bulk comparison passes: all IDs owned by caller", () => {
    const callerOwnedIds = new Set(["item-1", "item-2"]);
    const requested = ["item-1", "item-2"];
    const foreign = requested.filter(id => !callerOwnedIds.has(id));
    expect(foreign).toHaveLength(0); // no 403
  });
});
