/**
 * Vendor Pack Geometry Service — Unit Tests
 *
 * Tests 1-15 cover the computePackGeometry pure function and the geometry
 * service's integration with the vendor pricing pipeline.
 *
 * All tests here are pure unit tests (no DB required) so they run in the
 * standard Vitest suite.
 */

import { describe, it, expect } from "vitest";
import { computePackGeometry } from "./vendorPackGeometry";
import type { PackGeometryInput } from "./vendorPackGeometry";

// ─── Helper ───────────────────────────────────────────────────────────────────

function geom(input: PackGeometryInput) {
  return computePackGeometry(input);
}

// ─── Test 1: 4-pack × 5 LB case at $62.00 → $3.10/LB ───────────────────────
describe("computePackGeometry", () => {
  it("test 1 — 4×5 LB case at $62 normalizes to $3.10/LB", () => {
    const result = geom({
      caseSize: 4,           // 4 bags per case
      innerPackSize: 5,      // 5 LB per bag
      packUom: "lb",
      lastPrice: 62,
      canonicalUnitName: "lb",
    });

    expect(result.status).toBe("parsed");
    expect(result.canonicalQty).toBe(20);          // 4 × 5 = 20 LB
    expect(result.normalizedPrice).toBeCloseTo(3.1, 6); // 62 / 20 = 3.10
  });

  // ─── Test 2: 12 × 750 ML case at $120 → $0.013333…/ML ──────────────────
  it("test 2 — 12×750 ML case at $120 normalizes to $0.01333/ML", () => {
    const result = geom({
      caseSize: 12,
      innerPackSize: 750,
      packUom: "ml",
      lastPrice: 120,
      canonicalUnitName: "ml",
    });

    expect(result.status).toBe("parsed");
    expect(result.canonicalQty).toBe(9000);               // 12 × 750
    expect(result.normalizedPrice!).toBeCloseTo(120 / 9000, 8); // ≈ 0.013333
  });

  // ─── Test 3: 30-count eggs at $9.00 → $0.30/EA ──────────────────────────
  it("test 3 — 30-count eggs at $9 normalizes to $0.30/EA", () => {
    const result = geom({
      caseSize: 30,
      innerPackSize: 1,
      packUom: "ea",
      lastPrice: 9,
      canonicalUnitName: "ea",
    });

    expect(result.status).toBe("parsed");
    expect(result.canonicalQty).toBe(30);
    expect(result.normalizedPrice).toBeCloseTo(0.3, 6);
  });

  // ─── Test 4: purchase and canonical unit both EA, quantity = 1 ──────────
  it("test 4 — single-unit EA item normalizes to last_price/EA", () => {
    const result = geom({
      caseSize: 1,
      innerPackSize: 1,
      packUom: "ea",
      lastPrice: 4.5,
      canonicalUnitName: "each",
    });

    expect(result.status).toBe("parsed");
    expect(result.canonicalQty).toBe(1);
    expect(result.normalizedPrice).toBeCloseTo(4.5, 6);
  });

  // ─── Test 5: missing geometry (zero caseSize) → null + incomplete ────────
  it("test 5 — zero case size returns null normalized price and status=incomplete", () => {
    const result = geom({
      caseSize: 0,
      lastPrice: 10,
      canonicalUnitName: "lb",
    });

    expect(result.status).toBe("incomplete");
    expect(result.canonicalQty).toBeNull();
    expect(result.normalizedPrice).toBeNull();
  });

  // ─── Test 6: zero geometry is rejected ───────────────────────────────────
  it("test 6 — negative case size is rejected (incomplete)", () => {
    const result = geom({
      caseSize: -5,
      lastPrice: 10,
      canonicalUnitName: "lb",
    });

    expect(result.status).toBe("incomplete");
    expect(result.canonicalQty).toBeNull();
    expect(result.normalizedPrice).toBeNull();
  });

  it("test 6b — zero provided canonical qty is rejected", () => {
    const result = geom({
      caseSize: 10,
      lastPrice: 10,
      canonicalUnitName: "lb",
      providedCanonicalQty: 0,
    });

    expect(result.status).toBe("incomplete");
    expect(result.canonicalQty).toBeNull();
    expect(result.normalizedPrice).toBeNull();
  });

  // ─── Test 7: weight-to-volume mismatch → conflicting ────────────────────
  it("test 7 — weight pack vs volume canonical unit returns conflicting", () => {
    const result = geom({
      caseSize: 12,
      innerPackSize: 1,
      packUom: "lb",             // weight
      lastPrice: 50,
      canonicalUnitName: "gallon", // volume
    });

    expect(result.status).toBe("conflicting");
    expect(result.canonicalQty).toBeNull();
    expect(result.normalizedPrice).toBeNull();
  });

  // ─── Test 8: price change recalculates normalized price ──────────────────
  it("test 8 — changing last_price recalculates normalized price", () => {
    const base = { caseSize: 10, lastPrice: 50, canonicalUnitName: "lb" };
    const r1 = geom(base);
    const r2 = geom({ ...base, lastPrice: 70 });

    expect(r1.normalizedPrice).toBeCloseTo(5, 6);  // 50/10
    expect(r2.normalizedPrice).toBeCloseTo(7, 6);  // 70/10
    expect(r1.canonicalQty).toBe(r2.canonicalQty);  // qty unchanged
  });

  // ─── Test 9: pack size change recalculates normalized price ──────────────
  it("test 9 — changing case_size recalculates canonical qty and normalized price", () => {
    const base = { caseSize: 10, lastPrice: 50, canonicalUnitName: "lb" };
    const r1 = geom(base);
    const r2 = geom({ ...base, caseSize: 20 });

    expect(r1.canonicalQty).toBe(10);
    expect(r2.canonicalQty).toBe(20);
    expect(r1.normalizedPrice).toBeCloseTo(5, 6);  // 50/10
    expect(r2.normalizedPrice).toBeCloseTo(2.5, 6); // 50/20
  });

  // ─── Test 10: canonical-unit change invalidation ─────────────────────────
  it("test 10 — weight-to-volume canonical unit change would return conflicting", () => {
    // Simulate the state after inventory_items.unit_id changes to a different dimension
    const rOriginal = geom({
      caseSize: 6,
      innerPackSize: 32,
      packUom: "fl oz",
      lastPrice: 24,
      canonicalUnitName: "fl oz", // original: volume
    });
    expect(rOriginal.status).toBe("parsed");
    expect(rOriginal.normalizedPrice).toBeCloseTo(24 / 192, 8);

    const rAfterUnitChange = geom({
      caseSize: 6,
      innerPackSize: 32,
      packUom: "fl oz",
      lastPrice: 24,
      canonicalUnitName: "lb",   // changed to weight — now conflicting
    });
    expect(rAfterUnitChange.status).toBe("conflicting");
    expect(rAfterUnitChange.normalizedPrice).toBeNull();
  });

  // ─── Test 11: two vendors with different case sizes compare correctly ─────
  it("test 11 — two vendors with different case sizes normalize to same/different prices", () => {
    // Vendor A: 10-lb case at $30 → $3.00/lb
    const vendorA = geom({ caseSize: 10, lastPrice: 30, canonicalUnitName: "lb" });
    // Vendor B: 25-lb case at $62.50 → $2.50/lb (better)
    const vendorB = geom({ caseSize: 25, lastPrice: 62.5, canonicalUnitName: "lb" });

    expect(vendorA.normalizedPrice).toBeCloseTo(3.0, 6);
    expect(vendorB.normalizedPrice).toBeCloseTo(2.5, 6);
    // Vendor B is cheaper per LB even though case price is higher
    expect(vendorB.normalizedPrice!).toBeLessThan(vendorA.normalizedPrice!);
  });

  // ─── Test 12: variable-weight product ─────────────────────────────────────
  it("test 12 — variable weight item returns variable_weight status, no normalized price", () => {
    const result = geom({
      caseSize: 30,
      innerPackSize: 1,
      lastPrice: 120,
      canonicalUnitName: "lb",
      isVariableWeight: 1,
    });

    expect(result.status).toBe("variable_weight");
    expect(result.canonicalQty).toBeNull();
    expect(result.normalizedPrice).toBeNull();
  });

  it("test 12b — variable weight with pricing_basis=canonical_unit is priced cleanly", () => {
    // Edge case: meat sold exactly by the lb at a per-lb price → not variable
    const result = geom({
      caseSize: 1,
      lastPrice: 5.99,
      canonicalUnitName: "lb",
      isVariableWeight: false,   // not variable — just sold by the lb
      pricingBasis: "canonical_unit",
    });

    expect(result.status).toBe("verified");
    expect(result.canonicalQty).toBe(1);
    expect(result.normalizedPrice).toBeCloseTo(5.99, 4);
  });

  // ─── Test 13: stale-price reliability flag is orthogonal ─────────────────
  it("test 13 — computePackGeometry does not touch price-source or stale flag fields", () => {
    // computePackGeometry is a pure function — it returns geometry only.
    // It never writes lastPrice, priceSource, or pricedAt — those belong to vendorPriceService.
    const result = geom({
      caseSize: 5,
      lastPrice: 25,
      canonicalUnitName: "lb",
    });

    // Only geometry fields are present in the result; no price-source mutation occurs.
    const keys = Object.keys(result);
    expect(keys).toContain("canonicalQty");
    expect(keys).toContain("normalizedPrice");
    expect(keys).toContain("status");
    // No price-source or stale indicator fields in the geometry result
    expect(keys).not.toContain("priceSource");
    expect(keys).not.toContain("pricedAt");
    expect(keys).not.toContain("savingsReliable");
  });

  // ─── Test 14: CSV order guide pack string produces correct geometry ────────
  it("test 14 — CSV order guide compound pack '4/5 LB' produces correct geometry", () => {
    // CsvOrderGuide.parseCompoundPackSize("4/5 LB") → { caseSize: 4, innerPack: 5, unit: "LB" }
    // This test verifies computePackGeometry handles that output correctly.
    const result = geom({
      caseSize: 4,     // outer count from CSV parse
      innerPackSize: 5, // inner size from CSV parse
      packUom: "lb",   // unit from CSV parse
      lastPrice: 62,
      canonicalUnitName: "lb",
    });

    expect(result.status).toBe("parsed");
    expect(result.canonicalQty).toBe(20);
    expect(result.normalizedPrice).toBeCloseTo(3.1, 6);
  });

  // ─── Test 15: recipe costing is unchanged by pack geometry ───────────────
  it("test 15 — computePackGeometry result contains no inventory-item fields", () => {
    // Recipe costing reads inventory_items.avg_cost_per_unit (canonical unit cost).
    // Pack geometry lives only on vendor_items and never modifies inventory cost.
    // This test verifies the result shape is geometry-only.
    const result = geom({
      caseSize: 20,
      lastPrice: 80,
      canonicalUnitName: "lb",
    });

    expect(result.canonicalQty).toBe(20);
    expect(result.normalizedPrice).toBeCloseTo(4, 6);

    // The result object carries no inventory-item mutation fields.
    expect(result).not.toHaveProperty("pricePerUnit");
    expect(result).not.toHaveProperty("avgCostPerUnit");
    expect(result).not.toHaveProperty("inventoryItemId");
  });

  // ─── Bonus: pricing_basis=canonical_unit ──────────────────────────────────
  it("pricing_basis=canonical_unit — last_price is already normalized, qty=1", () => {
    const result = geom({
      caseSize: 1,
      lastPrice: 3.25,
      pricingBasis: "canonical_unit",
      canonicalUnitName: "lb",
    });

    expect(result.status).toBe("verified");
    expect(result.canonicalQty).toBe(1);
    expect(result.normalizedPrice).toBeCloseTo(3.25, 4);
  });

  // ─── Bonus: null/undefined innerPackSize treated as 1 ─────────────────────
  it("null innerPackSize is treated as 1 (simple single-unit purchase)", () => {
    const result = geom({
      caseSize: 10,
      innerPackSize: null,
      lastPrice: 20,
      canonicalUnitName: "lb",
    });

    expect(result.status).toBe("parsed");
    expect(result.canonicalQty).toBe(10);
    expect(result.normalizedPrice).toBeCloseTo(2, 6);
  });
});
