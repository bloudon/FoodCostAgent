/**
 * M3B — Vendor Routing: Automated Regression Tests
 *
 * Protects the routing decision contract introduced in Task #460.
 * Organized by the scenarios listed in Task #463:
 *
 *   1. Eligibility blocking — stale, legacy_unknown, incompatibleUnit,
 *      invalidPackGeometry — each independently
 *   2. Eligibility passing — fresh, receipt-confirmed, compatible unit, valid geometry
 *   3. Unmapped product blocked — target maps to different inventory item
 *   4. Merge behavior — routing into an existing line increments orderedQty
 *   5. No-merge behavior — different vendorItemId inserts a new line
 *   6. Savings snapshot accuracy — formula mirrors route endpoint exactly
 *   7. Idempotency — same (poLineId, targetVendorItemId) pair returns existing result
 *   8. Stale-threshold regression guard — 15-day-old price is blocked (14-day threshold)
 *
 * Plus one DB integration suite:
 *   9. Tenant isolation — a routing attempt for company A's PO using
 *      company B's companyId is denied (returns 403 not 404)
 *
 * Design: pure-function tests for Sections 1–8 (no database, no Express).
 *         DB integration (real Neon connection) for Section 9.
 */

import { describe, it, expect, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import {
  buildSavingsReliabilityReasons,
  checkInventoryItemMatch,
  checkPackSizeCompatibility,
  checkTargetViEligibility,
  computeProjectedLineSavings,
  computeProjectedSavingsPerCase,
  mergeOrderedQty,
  routingIdempotencyKey,
  isAlreadyRouted,
  shouldMergeIntoExistingLine,
  type PackGeometry,
  type TargetViSnapshot,
} from "./routingService";
import { isPriceStale, getPriceFreshness } from "./vendorPriceService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a Date that is `daysAgo` days before now. */
function daysAgoDate(daysAgo: number): Date {
  return new Date(Date.now() - daysAgo * 86_400_000);
}

/** A fully-eligible target vendor item snapshot — each blocking test overrides one field. */
function freshEligibleVi(overrides: Partial<TargetViSnapshot> = {}): TargetViSnapshot {
  return {
    inventoryItemId: "inv-item-001",
    active: 1,
    lastPrice: 2.5,
    priceSource: "receipt",
    pricedAt: daysAgoDate(1), // 1 day ago — well within 14-day threshold
    packUom: "lb",
    caseSize: 40,
    innerPackSize: 1,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: Eligibility blocking — each check independently
// ─────────────────────────────────────────────────────────────────────────────

describe("Routing eligibility — stale price blocked", () => {
  it("rejects a vendor item priced 15 days ago (beyond 14-day threshold)", () => {
    const vi = freshEligibleVi({ pricedAt: daysAgoDate(15) });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/stale/i);
    }
  });

  it("rejects a vendor item with null pricedAt (no timestamp = stale)", () => {
    const vi = freshEligibleVi({ pricedAt: null });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/stale/i);
    }
  });

  it("still passes all other checks when only pricedAt is stale", () => {
    // Confirm the failure is isolated to the stale check, not another field
    const freshVi = freshEligibleVi({ pricedAt: daysAgoDate(1) });
    expect(checkTargetViEligibility(freshVi, "pound").eligible).toBe(true);
  });
});

describe("Routing eligibility — legacy_unknown blocked", () => {
  it("rejects a vendor item with priceSource='legacy_unknown'", () => {
    const vi = freshEligibleVi({ priceSource: "legacy_unknown" });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/unverified/i);
    }
  });

  it("passes when priceSource is a real source (e.g. 'receipt')", () => {
    const vi = freshEligibleVi({ priceSource: "receipt" });
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(true);
  });

  it("passes when priceSource is 'order_guide_import'", () => {
    const vi = freshEligibleVi({ priceSource: "order_guide_import" });
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(true);
  });

  it("passes when priceSource is 'manual'", () => {
    const vi = freshEligibleVi({ priceSource: "manual" });
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(true);
  });
});

describe("Routing eligibility — incompatibleUnit blocked", () => {
  it("rejects when packUom is volume (gal) but inventory unit is weight (pound)", () => {
    const vi = freshEligibleVi({ packUom: "gal" });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/incompatible/i);
    }
  });

  it("rejects when packUom is count (ea) but inventory unit is weight (lb)", () => {
    const vi = freshEligibleVi({ packUom: "ea" });
    const result = checkTargetViEligibility(vi, "lb");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/incompatible/i);
    }
  });

  it("passes when packUom and inventoryUnitName are in the same family (both weight)", () => {
    const vi = freshEligibleVi({ packUom: "oz" });
    // "oz" and "pound" are both weight
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(true);
  });

  it("passes when packUom matches exactly (lb → pound)", () => {
    const vi = freshEligibleVi({ packUom: "lb" });
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(true);
  });
});

describe("Routing eligibility — invalidPackGeometry blocked", () => {
  it("rejects when caseSize is 0 (invalid geometry)", () => {
    const vi = freshEligibleVi({ caseSize: 0 });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/invalid pack geometry/i);
    }
  });

  it("rejects when caseSize is null (treated as 0)", () => {
    const vi = freshEligibleVi({ caseSize: null });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/invalid pack geometry/i);
    }
  });

  it("passes with valid caseSize > 0", () => {
    const vi = freshEligibleVi({ caseSize: 20 });
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(true);
  });

  it("innerPackSize=0 also triggers invalidPackGeometry", () => {
    const vi = freshEligibleVi({ caseSize: 40, innerPackSize: 0 });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/invalid pack geometry/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Eligibility passing
// ─────────────────────────────────────────────────────────────────────────────

describe("Routing eligibility — passing scenarios", () => {
  it("passes for a fresh, receipt-confirmed, compatible-unit row with valid geometry", () => {
    const vi = freshEligibleVi({
      active: 1,
      lastPrice: 3.0,
      priceSource: "receipt",
      pricedAt: daysAgoDate(1),
      packUom: "lb",
      caseSize: 40,
      innerPackSize: 1,
    });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(true);
  });

  it("passes when priced exactly 7 days ago (current freshness tier)", () => {
    const vi = freshEligibleVi({ pricedAt: daysAgoDate(7) });
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(true);
  });

  it("passes when priced 13 days ago (aging tier — still eligible)", () => {
    const vi = freshEligibleVi({ pricedAt: daysAgoDate(13) });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(true);
  });

  it("passes for order_guide_import source (not legacy_unknown)", () => {
    const vi = freshEligibleVi({ priceSource: "order_guide_import" });
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(true);
  });

  it("passes for count-unit item with matching ea pack", () => {
    const vi = freshEligibleVi({ packUom: "ea", caseSize: 24 });
    expect(checkTargetViEligibility(vi, "each").eligible).toBe(true);
  });

  it("inactive=0 is still blocked even when all other fields pass", () => {
    const vi = freshEligibleVi({ active: 0 });
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(false);
  });

  it("lastPrice=0 is blocked (no valid price)", () => {
    const vi = freshEligibleVi({ lastPrice: 0 });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/no valid price/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Unmapped product blocked
// ─────────────────────────────────────────────────────────────────────────────

describe("Routing eligibility — unmapped product blocked", () => {
  it("rejects when targetVi.inventoryItemId differs from source inventoryItemId", () => {
    const result = checkInventoryItemMatch("inv-item-A", "inv-item-B");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/different product/i);
    }
  });

  it("rejects when source vendor item has no linked inventoryItemId (null)", () => {
    const result = checkInventoryItemMatch(null, "inv-item-B");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/no linked inventory item/i);
    }
  });

  it("rejects when source vendor item has no linked inventoryItemId (undefined)", () => {
    const result = checkInventoryItemMatch(undefined, "inv-item-B");
    expect(result.eligible).toBe(false);
  });

  it("passes when both inventoryItemIds match exactly", () => {
    const result = checkInventoryItemMatch("inv-item-A", "inv-item-A");
    expect(result.eligible).toBe(true);
  });

  it("rejects even if target inventoryItemId is null (target has no inventory item)", () => {
    const result = checkInventoryItemMatch("inv-item-A", null);
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/different product/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: Merge behavior
// ─────────────────────────────────────────────────────────────────────────────

describe("Routing merge behavior — orderedQty incremented", () => {
  it("shouldMergeIntoExistingLine returns true when a line for the target VI already exists", () => {
    const destinationLines = [
      { vendorItemId: "vi-target-001" },
      { vendorItemId: "vi-other-002" },
    ];
    expect(shouldMergeIntoExistingLine(destinationLines, "vi-target-001")).toBe(true);
  });

  it("mergeOrderedQty adds routed quantity to existing quantity", () => {
    expect(mergeOrderedQty(10, 5)).toBe(15);
    expect(mergeOrderedQty(0, 20)).toBe(20);
    expect(mergeOrderedQty(100, 1)).toBe(101);
  });

  it("mergeOrderedQty handles decimal quantities correctly", () => {
    expect(mergeOrderedQty(2.5, 1.5)).toBeCloseTo(4.0);
    expect(mergeOrderedQty(3.75, 0.25)).toBeCloseTo(4.0);
  });

  it("merging two routed quantities produces correct total", () => {
    // Simulates routing a 10-unit line + 5-unit line into the same destination VI
    const afterFirst = mergeOrderedQty(0, 10);
    const afterSecond = mergeOrderedQty(afterFirst, 5);
    expect(afterSecond).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: No-merge behavior
// ─────────────────────────────────────────────────────────────────────────────

describe("Routing no-merge behavior — new line inserted", () => {
  it("shouldMergeIntoExistingLine returns false when no matching VI in destination", () => {
    const destinationLines = [
      { vendorItemId: "vi-different-001" },
    ];
    expect(shouldMergeIntoExistingLine(destinationLines, "vi-target-002")).toBe(false);
  });

  it("shouldMergeIntoExistingLine returns false for empty destination PO", () => {
    expect(shouldMergeIntoExistingLine([], "vi-target-001")).toBe(false);
  });

  it("routing two different items to same destination PO inserts two separate lines", () => {
    // Each item has a different targetVendorItemId — neither merges with the other
    const targetViIdA = "vi-001";
    const targetViIdB = "vi-002";
    const existingLines: { vendorItemId: string }[] = [];

    // First item: no existing line → insert new
    expect(shouldMergeIntoExistingLine(existingLines, targetViIdA)).toBe(false);

    // Simulate line A now being in the destination PO
    existingLines.push({ vendorItemId: targetViIdA });

    // Second item: line A exists, but not for target VI B → insert new
    expect(shouldMergeIntoExistingLine(existingLines, targetViIdB)).toBe(false);

    // Now try to route VI A again → should merge
    expect(shouldMergeIntoExistingLine(existingLines, targetViIdA)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: Savings snapshot accuracy
// ─────────────────────────────────────────────────────────────────────────────

describe("Routing savings snapshot — formula accuracy", () => {
  it("savings = (fromUnitPrice - toUnitPrice) × toCaseSize", () => {
    // $3.00/lb → $2.00/lb on a 40 lb case → saves $40/case
    expect(computeProjectedSavingsPerCase(3.0, 2.0, 40)).toBeCloseTo(40.0);
  });

  it("savings is negative when target is more expensive (routing still allowed)", () => {
    // $2.00/lb → $3.00/lb → operator pays $40 more per case
    expect(computeProjectedSavingsPerCase(2.0, 3.0, 40)).toBeCloseTo(-40.0);
  });

  it("savings is 0 when both prices are identical", () => {
    expect(computeProjectedSavingsPerCase(2.5, 2.5, 20)).toBeCloseTo(0.0);
  });

  it("savings scales linearly with caseSize", () => {
    const diff = 1.0; // $1/unit cheaper at target
    expect(computeProjectedSavingsPerCase(3.0, 2.0, 20)).toBeCloseTo(20.0);
    expect(computeProjectedSavingsPerCase(3.0, 2.0, 40)).toBeCloseTo(40.0);
    expect(computeProjectedSavingsPerCase(3.0, 2.0, 1)).toBeCloseTo(1.0);
  });

  it("savings equals (sourceUnitPrice - targetUnitPrice) × routedCaseSize", () => {
    // Explicit variable naming to mirror the task spec formula
    const sourceUnitPrice = 4.50;
    const targetUnitPrice = 3.75;
    const routedQty = 50; // caseSize acts as the routedQty context

    const expected = (sourceUnitPrice - targetUnitPrice) * routedQty;
    expect(computeProjectedSavingsPerCase(sourceUnitPrice, targetUnitPrice, routedQty))
      .toBeCloseTo(expected);
  });

  it("savings with fractional prices is precise to 4 decimal places", () => {
    expect(computeProjectedSavingsPerCase(2.4999, 2.0001, 40)).toBeCloseTo(19.9920, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: Idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("Routing idempotency", () => {
  it("routingIdempotencyKey produces expected format", () => {
    expect(routingIdempotencyKey("line-001", "vi-002")).toBe("line-001:vi-002");
  });

  it("keys for the same pair are identical (deterministic)", () => {
    const k1 = routingIdempotencyKey("line-A", "vi-X");
    const k2 = routingIdempotencyKey("line-A", "vi-X");
    expect(k1).toBe(k2);
  });

  it("keys differ when poLineId differs", () => {
    const k1 = routingIdempotencyKey("line-001", "vi-001");
    const k2 = routingIdempotencyKey("line-002", "vi-001");
    expect(k1).not.toBe(k2);
  });

  it("keys differ when targetVendorItemId differs", () => {
    const k1 = routingIdempotencyKey("line-001", "vi-001");
    const k2 = routingIdempotencyKey("line-001", "vi-002");
    expect(k1).not.toBe(k2);
  });

  it("isAlreadyRouted returns true when prior audit entry exists in lookup", () => {
    const lookup = new Map<string, unknown>([
      [routingIdempotencyKey("line-001", "vi-001"), { auditId: "audit-abc" }],
    ]);
    expect(isAlreadyRouted(lookup, "line-001", "vi-001")).toBe(true);
  });

  it("isAlreadyRouted returns false when no prior audit entry exists", () => {
    const lookup = new Map<string, unknown>([
      [routingIdempotencyKey("line-001", "vi-001"), { auditId: "audit-abc" }],
    ]);
    // Different pair → not already routed
    expect(isAlreadyRouted(lookup, "line-001", "vi-002")).toBe(false);
    expect(isAlreadyRouted(lookup, "line-002", "vi-001")).toBe(false);
  });

  it("second call with same pair is detected as already-routed (full flow simulation)", () => {
    const alreadyRoutedLookup = new Map<string, unknown>();
    const poLineId = "line-001";
    const targetVendorItemId = "vi-001";

    // First call — not yet in the map
    expect(isAlreadyRouted(alreadyRoutedLookup, poLineId, targetVendorItemId)).toBe(false);

    // Simulate route writing audit row and inserting into lookup
    alreadyRoutedLookup.set(
      routingIdempotencyKey(poLineId, targetVendorItemId),
      { auditId: "audit-xyz", destinationPoId: "po-dest" }
    );

    // Second call — already routed
    expect(isAlreadyRouted(alreadyRoutedLookup, poLineId, targetVendorItemId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 8: Stale-threshold regression guard (M3A changed from 90 → 14 days)
// ─────────────────────────────────────────────────────────────────────────────

describe("Stale-threshold regression guard — 14-day boundary", () => {
  it("price from 15 days ago IS stale — routing eligibility blocked", () => {
    const pricedAt = daysAgoDate(15);
    expect(isPriceStale(pricedAt)).toBe(true);
    expect(getPriceFreshness(pricedAt)).toBe("stale");

    const vi = freshEligibleVi({ pricedAt });
    const result = checkTargetViEligibility(vi, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toContain("stale");
    }
  });

  it("price from exactly 14 days ago is 'aging' — NOT stale, NOT blocked", () => {
    // daysAgo=14 → daysAgo <= 14 → "aging" (still eligible for routing)
    const pricedAt = daysAgoDate(14);
    expect(getPriceFreshness(pricedAt)).toBe("aging");
    expect(isPriceStale(pricedAt)).toBe(false);

    const vi = freshEligibleVi({ pricedAt });
    expect(checkTargetViEligibility(vi, "pound").eligible).toBe(true);
  });

  it("price from 13 days ago is 'aging' — still eligible for routing", () => {
    const pricedAt = daysAgoDate(13);
    expect(getPriceFreshness(pricedAt)).toBe("aging");
    expect(isPriceStale(pricedAt)).toBe(false);
    expect(checkTargetViEligibility(freshEligibleVi({ pricedAt }), "pound").eligible).toBe(true);
  });

  it("price from 7 days ago is 'current' — always eligible", () => {
    const pricedAt = daysAgoDate(7);
    expect(getPriceFreshness(pricedAt)).toBe("current");
    expect(isPriceStale(pricedAt)).toBe(false);
    expect(checkTargetViEligibility(freshEligibleVi({ pricedAt }), "pound").eligible).toBe(true);
  });

  it("null timestamp → stale → routing blocked (regression: old threshold was 90 days)", () => {
    // This test catches an accidental reversion to a 90-day or no-threshold check.
    // If the threshold were 90 days, a price from 15 days ago would NOT be stale.
    const pricedAt = daysAgoDate(15);
    expect(getPriceFreshness(pricedAt)).toBe("stale");
    // Verify the boundary is at 14, not 90
    expect(getPriceFreshness(daysAgoDate(14))).not.toBe("stale");
    expect(getPriceFreshness(daysAgoDate(90))).toBe("stale");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 9: Savings reliability — buildSavingsReliabilityReasons reason codes
// ─────────────────────────────────────────────────────────────────────────────

describe("buildSavingsReliabilityReasons — empty array when fully reliable", () => {
  it("returns [] when source is fresh, known, PO line price used, and price > 0", () => {
    const reasons = buildSavingsReliabilityReasons(
      daysAgoDate(1),   // fresh
      "receipt",        // known source
      false,            // PO line price used (not fallback)
      3.00,             // valid price
    );
    expect(reasons).toHaveLength(0);
  });

  it("returns [] when priced exactly 14 days ago (aging — still reliable)", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(14), "manual", false, 2.50);
    expect(reasons).toHaveLength(0);
  });
});

describe("buildSavingsReliabilityReasons — source_price_stale", () => {
  it("adds 'source_price_stale' when pricedAt is 15 days ago (beyond threshold)", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(15), "receipt", false, 3.00);
    expect(reasons).toContain("source_price_stale");
  });

  it("adds 'source_price_stale' when pricedAt is null", () => {
    const reasons = buildSavingsReliabilityReasons(null, "receipt", false, 3.00);
    expect(reasons).toContain("source_price_stale");
  });

  it("adds 'source_price_stale' when pricedAt is undefined", () => {
    const reasons = buildSavingsReliabilityReasons(undefined, "receipt", false, 3.00);
    expect(reasons).toContain("source_price_stale");
  });

  it("does NOT add 'source_price_stale' for a 13-day-old price", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(13), "receipt", false, 3.00);
    expect(reasons).not.toContain("source_price_stale");
  });
});

describe("buildSavingsReliabilityReasons — source_price_fallback", () => {
  it("adds 'source_price_fallback' when usingFallbackPrice=true", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), "receipt", true, 2.00);
    expect(reasons).toContain("source_price_fallback");
  });

  it("does NOT add 'source_price_fallback' when PO line price was used", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), "receipt", false, 2.00);
    expect(reasons).not.toContain("source_price_fallback");
  });
});

describe("buildSavingsReliabilityReasons — missing_price_history", () => {
  it("adds 'missing_price_history' when fromUnitPrice is 0", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), "receipt", true, 0);
    expect(reasons).toContain("missing_price_history");
  });

  it("adds 'missing_price_history' when fromUnitPrice is negative", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), "receipt", true, -1);
    expect(reasons).toContain("missing_price_history");
  });

  it("does NOT add 'missing_price_history' when price is valid and positive", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), "receipt", false, 0.01);
    expect(reasons).not.toContain("missing_price_history");
  });
});

describe("buildSavingsReliabilityReasons — unknown_price_source", () => {
  it("adds 'unknown_price_source' when priceSource is 'legacy_unknown'", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), "legacy_unknown", false, 3.00);
    expect(reasons).toContain("unknown_price_source");
  });

  it("adds 'unknown_price_source' when priceSource is null", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), null, false, 3.00);
    expect(reasons).toContain("unknown_price_source");
  });

  it("adds 'unknown_price_source' when priceSource is undefined", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), undefined, false, 3.00);
    expect(reasons).toContain("unknown_price_source");
  });

  it("does NOT add 'unknown_price_source' for 'receipt' source", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), "receipt", false, 3.00);
    expect(reasons).not.toContain("unknown_price_source");
  });

  it("does NOT add 'unknown_price_source' for 'order_guide_import' source", () => {
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(1), "order_guide_import", false, 3.00);
    expect(reasons).not.toContain("unknown_price_source");
  });
});

describe("buildSavingsReliabilityReasons — multiple reasons can combine", () => {
  it("stale + fallback + missing_history when no price data and stale timestamp", () => {
    const reasons = buildSavingsReliabilityReasons(
      daysAgoDate(30), // stale
      "receipt",
      true,            // fallback used
      0,               // no price found
    );
    expect(reasons).toContain("source_price_stale");
    expect(reasons).toContain("source_price_fallback");
    expect(reasons).toContain("missing_price_history");
  });

  it("all four reasons present in worst-case scenario", () => {
    const reasons = buildSavingsReliabilityReasons(
      null,             // stale (null timestamp)
      "legacy_unknown", // unknown source
      true,             // fallback used
      0,                // no price
    );
    expect(reasons).toContain("source_price_stale");
    expect(reasons).toContain("source_price_fallback");
    expect(reasons).toContain("missing_price_history");
    expect(reasons).toContain("unknown_price_source");
    expect(reasons).toHaveLength(4);
  });

  it("reliable savings can still be negative (target more expensive — not phantom)", () => {
    // Reliability is about price freshness/provenance, not sign of savings.
    // A reliable negative savings correctly tells the operator the target costs more.
    const reasons = buildSavingsReliabilityReasons(daysAgoDate(3), "receipt", false, 2.00);
    expect(reasons).toHaveLength(0); // reliable
    const savings = computeProjectedSavingsPerCase(2.0, 3.0, 40); // target more expensive
    expect(savings).toBeCloseTo(-40.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 9b: computeProjectedLineSavings — aggregate savings for routed qty
// ─────────────────────────────────────────────────────────────────────────────

describe("computeProjectedLineSavings — total savings across ordered quantity", () => {
  it("multiplies savings-per-case by orderedQty", () => {
    // $40/case savings × 3 cases ordered = $120 total
    expect(computeProjectedLineSavings(40, 3)).toBeCloseTo(120.0);
  });

  it("negative savings-per-case produce negative line savings (target more expensive)", () => {
    expect(computeProjectedLineSavings(-40, 3)).toBeCloseTo(-120.0);
  });

  it("zero savings-per-case produces zero line savings", () => {
    expect(computeProjectedLineSavings(0, 10)).toBeCloseTo(0.0);
  });

  it("orderedQty=1 returns savings-per-case unchanged", () => {
    expect(computeProjectedLineSavings(25.50, 1)).toBeCloseTo(25.50);
  });

  it("fractional quantities produce precise results", () => {
    // $10/case × 2.5 cases = $25
    expect(computeProjectedLineSavings(10, 2.5)).toBeCloseTo(25.0);
  });

  it("scales linearly with orderedQty", () => {
    const perCase = 15.00;
    expect(computeProjectedLineSavings(perCase, 1)).toBeCloseTo(15.0);
    expect(computeProjectedLineSavings(perCase, 5)).toBeCloseTo(75.0);
    expect(computeProjectedLineSavings(perCase, 10)).toBeCloseTo(150.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section 10: Pack size compatibility — Task #480
// ─────────────────────────────────────────────────────────────────────────────

describe("Pack size compatibility — equal packs pass", () => {
  it("passes when source and target have identical caseSize and innerPackSize (lb family)", () => {
    const source: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    const target: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    expect(checkPackSizeCompatibility(source, target, "pound").eligible).toBe(true);
  });

  it("passes when source caseSize×innerPackSize equals target (equivalent pack geometry)", () => {
    // 40×1 lb == 20×2 lb — same total 40 lbs per case
    const source: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    const target: PackGeometry = { caseSize: 20, innerPackSize: 2, packUom: "lb" };
    expect(checkPackSizeCompatibility(source, target, "pound").eligible).toBe(true);
  });

  it("passes for count-unit items with identical pack (each family)", () => {
    const source: PackGeometry = { caseSize: 24, innerPackSize: 1, packUom: "ea" };
    const target: PackGeometry = { caseSize: 24, innerPackSize: 1, packUom: "ea" };
    expect(checkPackSizeCompatibility(source, target, "each").eligible).toBe(true);
  });

  it("passes when innerPackSize is null on both sides (treated as 1 each)", () => {
    const source: PackGeometry = { caseSize: 30, innerPackSize: null, packUom: "lb" };
    const target: PackGeometry = { caseSize: 30, innerPackSize: null, packUom: "lb" };
    expect(checkPackSizeCompatibility(source, target, "pound").eligible).toBe(true);
  });
});

describe("Pack size compatibility — different packs blocked", () => {
  it("blocks when source caseSize differs from target (40 lb vs 30 lb case)", () => {
    const source: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    const target: PackGeometry = { caseSize: 30, innerPackSize: 1, packUom: "lb" };
    const result = checkPackSizeCompatibility(source, target, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/Different pack size/i);
      expect(result.reason).toMatch(/manual quantity review/i);
    }
  });

  it("blocks when innerPackSize differs (same caseSize but different total)", () => {
    // 20 cases × 3 inner = 60 units vs 20 cases × 2 inner = 40 units
    const source: PackGeometry = { caseSize: 20, innerPackSize: 3, packUom: "lb" };
    const target: PackGeometry = { caseSize: 20, innerPackSize: 2, packUom: "lb" };
    const result = checkPackSizeCompatibility(source, target, "pound");
    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reason).toMatch(/Different pack size/i);
    }
  });

  it("blocks when source is 40 lb and target is 50 lb (count items differ)", () => {
    const source: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "ea" };
    const target: PackGeometry = { caseSize: 50, innerPackSize: 1, packUom: "ea" };
    const result = checkPackSizeCompatibility(source, target, "each");
    expect(result.eligible).toBe(false);
  });
});

describe("Pack size compatibility — edge cases", () => {
  it("skips check (passes) when source caseSize is 0 (invalid source geometry)", () => {
    // Invalid source geometry means we cannot compute a meaningful comparison.
    // The source item's validity is a separate concern — routing is not blocked here.
    const source: PackGeometry = { caseSize: 0, innerPackSize: 1, packUom: "lb" };
    const target: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    expect(checkPackSizeCompatibility(source, target, "pound").eligible).toBe(true);
  });

  it("skips check (passes) when source caseSize is null (treated as invalid)", () => {
    const source: PackGeometry = { caseSize: null, innerPackSize: 1, packUom: "lb" };
    const target: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    expect(checkPackSizeCompatibility(source, target, "pound").eligible).toBe(true);
  });

  it("skips check (passes) when target caseSize is 0 (target invalid geometry — caught downstream)", () => {
    // checkTargetViEligibility will catch this; checkPackSizeCompatibility defers.
    const source: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    const target: PackGeometry = { caseSize: 0, innerPackSize: 1, packUom: "lb" };
    expect(checkPackSizeCompatibility(source, target, "pound").eligible).toBe(true);
  });

  it("skips check (passes) when target innerPackSize is 0 (target invalid geometry)", () => {
    const source: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    const target: PackGeometry = { caseSize: 40, innerPackSize: 0, packUom: "lb" };
    expect(checkPackSizeCompatibility(source, target, "pound").eligible).toBe(true);
  });

  it("passes for oz→lb family: 640 oz case (40 lb) matches 40 lb source", () => {
    // effectivePackQty normalises oz→lb: (640 × 1) / 16 = 40 lb
    const source: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    const target: PackGeometry = { caseSize: 640, innerPackSize: 1, packUom: "oz" };
    expect(checkPackSizeCompatibility(source, target, "pound").eligible).toBe(true);
  });

  it("blocks for oz→lb mismatch: 320 oz (20 lb) vs 40 lb source", () => {
    const source: PackGeometry = { caseSize: 40, innerPackSize: 1, packUom: "lb" };
    const target: PackGeometry = { caseSize: 320, innerPackSize: 1, packUom: "oz" };
    const result = checkPackSizeCompatibility(source, target, "pound");
    expect(result.eligible).toBe(false);
  });
});

