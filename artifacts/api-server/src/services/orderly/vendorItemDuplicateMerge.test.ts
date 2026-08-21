/**
 * Unit tests for the Gate 2 promotion prover (Preflight 1, pure logic).
 * The four PM conditions and the no-copying rule.
 */
import { describe, it, expect } from "vitest";
import { classifyGroups, type ClassifierVendorItemRow } from "./vendorItemDuplicateClassifier";
import {
  countReferences,
  provePromotion,
  REFERENCE_SOURCES,
  type UnitInfoResolver,
} from "./vendorItemDuplicateMerge";

let seq = 0;
function row(overrides: Partial<ClassifierVendorItemRow> = {}): ClassifierVendorItemRow {
  return {
    id: `vi-${String(++seq).padStart(3, "0")}`,
    vendorId: "v1",
    inventoryItemId: "inv1",
    vendorSku: "SKU1",
    brandName: null,
    purchaseUnitId: "u1",
    caseSize: 4,
    innerPackSize: 5,
    packUom: "lb",
    lastPrice: 5,
    lastCasePrice: 50,
    active: 1,
    priceSource: "order_guide_import",
    canonicalQtyPerPurchaseUnit: null,
    pricingBasis: "purchase_unit",
    isVariableWeight: 0,
    packGeometryStatus: null,
    ...overrides,
  };
}

const lbUnits: UnitInfoResolver = { canonicalUnitNameFor: () => "lb" };

function groupOf(members: ClassifierVendorItemRow[]) {
  const groups = classifyGroups({ rows: members, mappings: [], referenceCounts: new Map() });
  expect(groups).toHaveLength(1);
  return groups[0];
}

describe("provePromotion (PM Preflight 1)", () => {
  it("promotes a null-vs-derived group when derivation from the NULL row matches", () => {
    // 4 x 5 lb, canonical unit lb -> canonicalQty 20
    const members = [row({ canonicalQtyPerPurchaseUnit: 20 }), row({ canonicalQtyPerPurchaseUnit: null })];
    const proof = provePromotion(groupOf(members), members, lbUnits);
    expect(proof.promoted).toBe(true);
    expect(proof.derivedCanonicalQty).toBe(20);
  });

  it("holds when the derived value disagrees with the recorded value", () => {
    const members = [row({ canonicalQtyPerPurchaseUnit: 99 }), row({ canonicalQtyPerPurchaseUnit: null })];
    const proof = provePromotion(groupOf(members), members, lbUnits);
    expect(proof.promoted).toBe(false);
    expect(proof.reason).toContain("!= recorded");
  });

  it("holds when derivation is not deterministic (missing case size)", () => {
    const members = [
      row({ canonicalQtyPerPurchaseUnit: 20 }),
      row({ canonicalQtyPerPurchaseUnit: null, caseSize: 0 }),
    ];
    // caseSize 0 vs 4 also conflicts on total units — group has extra conflicts
    const proof = provePromotion(groupOf(members), members, lbUnits);
    expect(proof.promoted).toBe(false);
  });

  it("holds when the canonical unit cannot be resolved", () => {
    const members = [row({ canonicalQtyPerPurchaseUnit: 20 }), row({ canonicalQtyPerPurchaseUnit: null })];
    const noUnits: UnitInfoResolver = { canonicalUnitNameFor: () => null };
    const proof = provePromotion(groupOf(members), members, noUnits);
    expect(proof.promoted).toBe(false);
    expect(proof.reason).toContain("unit not resolvable");
  });

  it("holds groups with pack conflicts beyond null-vs-value", () => {
    const members = [
      row({ canonicalQtyPerPurchaseUnit: 20, packUom: "lb" }),
      row({ canonicalQtyPerPurchaseUnit: null, packUom: "oz" }),
    ];
    const proof = provePromotion(groupOf(members), members, lbUnits);
    expect(proof.promoted).toBe(false);
    expect(proof.reason).toContain("beyond null-vs-value");
  });

  it("holds when non-null canonical values disagree among themselves", () => {
    const members = [
      row({ canonicalQtyPerPurchaseUnit: 20 }),
      row({ canonicalQtyPerPurchaseUnit: 21 }),
      row({ canonicalQtyPerPurchaseUnit: null }),
    ];
    const groups = classifyGroups({ rows: members, mappings: [], referenceCounts: new Map() });
    const proof = provePromotion(groups[0], members, lbUnits);
    expect(proof.promoted).toBe(false);
  });

  it("never promotes variable-weight rows (derivation yields variable_weight)", () => {
    const members = [
      row({ canonicalQtyPerPurchaseUnit: 20, isVariableWeight: 1 }),
      row({ canonicalQtyPerPurchaseUnit: null, isVariableWeight: 1 }),
    ];
    const proof = provePromotion(groupOf(members), members, lbUnits);
    expect(proof.promoted).toBe(false);
    expect(proof.reason).toContain("not deterministic");
  });

  it("refuses non-B groups", () => {
    const members = [row(), row()]; // both null canonical -> Class A
    const proof = provePromotion(groupOf(members), members, lbUnits);
    expect(proof.promoted).toBe(false);
    expect(proof.reason).toContain("not a Class B group");
  });
});

// ── countReferences — source set propagation ──────────────────────────────────
// Regression for the Gate 2 legacy-column bug:
// applyGroup on the legacy production schema
// (vendor_invoice_import_lines.resolved_vendor_item_id absent) must not query
// the absent column. The fix adds an optional `sources` parameter to
// countReferences (and applyGroup) so the apply CLI can pass only the
// presentSources returned by validateReferenceColumnCompatibility.

const OPTIONAL_SOURCE_KEY = "vendor_invoice_import_lines.resolved_vendor_item_id";
// The 7 required sources — the legacy-optional column excluded.
const REQUIRED_SOURCES = REFERENCE_SOURCES.filter(
  (s) => `${s.table}.${s.column}` !== OPTIONAL_SOURCE_KEY,
);

describe("countReferences — source set propagation", () => {
  // PM verification 1: legacy schema (absent column) — applyGroup succeeds and
  // absent source is never queried.
  it("legacy schema: queries exactly the provided 7 required sources, absent optional never hit", async () => {
    let callCount = 0;
    const mockEx = { execute: async () => { callCount++; return { rows: [] }; } };

    await countReferences(mockEx, ["vi-1"], REQUIRED_SOURCES);

    expect(REQUIRED_SOURCES).toHaveLength(REFERENCE_SOURCES.length - 1); // confirms 7
    expect(callCount).toBe(REQUIRED_SOURCES.length); // exactly 7 — absent column skipped
  });

  // PM verification 2: newer schema (column present) — counted and repointed normally.
  it("newer schema: queries all 8 sources when fully provided (optional column present)", async () => {
    let callCount = 0;
    const mockEx = { execute: async () => { callCount++; return { rows: [] }; } };

    await countReferences(mockEx, ["vi-1"], REFERENCE_SOURCES);

    expect(callCount).toBe(REFERENCE_SOURCES.length); // 8
  });

  // Backward compat: default (no sources arg) still uses all REFERENCE_SOURCES.
  it("default call (no sources arg) is backward compatible and queries all REFERENCE_SOURCES", async () => {
    let callCount = 0;
    const mockEx = { execute: async () => { callCount++; return { rows: [] }; } };

    await countReferences(mockEx, ["vi-1"]);

    expect(callCount).toBe(REFERENCE_SOURCES.length);
  });

  // PM verification 3: any other missing required source fails closed at the
  // validateReferenceColumnCompatibility preflight layer (tested in
  // vendorItemDuplicateGate2ApplyCli.test.ts "fails closed when a required
  // reference column is absent"). countReferences itself trusts its caller.

  it("returns counted references correctly for the provided sources", async () => {
    const singleSource = [REQUIRED_SOURCES[0]];
    const mockEx = { execute: async () => ({ rows: [{ id: "vi-1", n: 5 }] }) };

    const result = await countReferences(mockEx, ["vi-1"], singleSource);

    const key = `${singleSource[0].table}.${singleSource[0].column}`;
    expect(result.get("vi-1")?.get(key)).toBe(5);
  });
});
