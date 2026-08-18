/**
 * Unit tests for the Gate 1 vendor-item duplicate classifier (pure logic).
 * Verifies the PM-approved classification contract:
 *  - pack-equivalence contract fields and cosmetic pack_uom tolerance
 *  - price differences are diagnostic only (never demote Class A)
 *  - NULL vs blank SKU never coalesced; both Class C
 *  - Class D external-identity conflicts; Class E protected fields
 *  - survivor election: mapped target > most references > smallest id
 */
import { describe, it, expect } from "vitest";
import {
  classifyGroups,
  comparePackGeometry,
  electSurvivor,
  type ClassifierVendorItemRow,
  type ExternalMappingRow,
  type ReferenceCounts,
} from "./vendorItemDuplicateClassifier";

let seq = 0;
function row(overrides: Partial<ClassifierVendorItemRow> = {}): ClassifierVendorItemRow {
  return {
    id: `vi-${String(++seq).padStart(3, "0")}`,
    vendorId: "v1",
    inventoryItemId: "inv1",
    vendorSku: "SKU1",
    brandName: null,
    purchaseUnitId: "u1",
    caseSize: 10,
    innerPackSize: null,
    packUom: "oz",
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

function classify(rows: ClassifierVendorItemRow[], mappings: ExternalMappingRow[] = [], refs: ReferenceCounts = new Map()) {
  return classifyGroups({ rows, mappings, referenceCounts: refs });
}

describe("pack-equivalence contract", () => {
  it("treats raw pack_uom differences as cosmetic when normalized equal", () => {
    const cmp = comparePackGeometry(row({ packUom: " OZ " }), row({ packUom: "oz" }));
    expect(cmp.equivalent).toBe(true);
    expect(cmp.cosmeticPackUomDiff).toBe(true);
  });

  it("conflicts on differing normalized pack_uom, purchase unit, and total units", () => {
    expect(comparePackGeometry(row(), row({ packUom: "lb" })).conflicts).toContain("pack_uom (normalized)");
    expect(comparePackGeometry(row(), row({ purchaseUnitId: "u2" })).conflicts).toContain("purchase_unit_id");
    expect(comparePackGeometry(row(), row({ caseSize: 12 })).conflicts).toContain("total_units_per_case");
  });

  it("equates caseSize*innerPackSize combinations (10x1 == 5x2)", () => {
    const cmp = comparePackGeometry(row({ caseSize: 10, innerPackSize: null }), row({ caseSize: 5, innerPackSize: 2 }));
    expect(cmp.equivalent).toBe(true);
  });

  it("flags null-vs-value canonical qty as conflict AND normalization-sensitive", () => {
    const cmp = comparePackGeometry(row({ canonicalQtyPerPurchaseUnit: 20 }), row({ canonicalQtyPerPurchaseUnit: null }));
    expect(cmp.equivalent).toBe(false);
    expect(cmp.normalizationSensitive).toBe(true);
  });

  it("conflicts on pricing_basis and is_variable_weight, with NULL normalization", () => {
    expect(comparePackGeometry(row({ pricingBasis: null }), row({ pricingBasis: "purchase_unit" })).equivalent).toBe(true);
    expect(comparePackGeometry(row(), row({ pricingBasis: "canonical_unit" })).equivalent).toBe(false);
    expect(comparePackGeometry(row({ isVariableWeight: null }), row({ isVariableWeight: 0 })).equivalent).toBe(true);
    expect(comparePackGeometry(row(), row({ isVariableWeight: 1 })).equivalent).toBe(false);
  });
});

describe("classification", () => {
  it("classifies identical rows as A and proposes size-1 deletions", () => {
    const groups = classify([row(), row(), row()]);
    expect(groups).toHaveLength(1);
    expect(groups[0].class).toBe("A");
    expect(groups[0].proposedDeletions).toBe(2);
    expect(groups[0].proposedSurvivorId).not.toBeNull();
  });

  it("price snapshot differences never demote Class A (diagnostic only)", () => {
    const groups = classify([row({ lastPrice: 5, lastCasePrice: 50 }), row({ lastPrice: 7, lastCasePrice: 70 })]);
    expect(groups[0].class).toBe("A");
    expect(groups[0].priceSnapshotsDiffer).toBe(true);
  });

  it("classifies pack geometry conflicts as B with zero proposed deletions", () => {
    const groups = classify([row({ caseSize: 10 }), row({ caseSize: 24 })]);
    expect(groups[0].class).toBe("B");
    expect(groups[0].proposedDeletions).toBe(0);
    expect(groups[0].proposedSurvivorId).toBeNull();
  });

  it("never coalesces NULL and blank SKU — separate Class C groups", () => {
    const groups = classify([row({ vendorSku: null }), row({ vendorSku: null }), row({ vendorSku: "" }), row({ vendorSku: "" })]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.class === "C")).toBe(true);
    expect(new Set(groups.map((g) => g.skuKind))).toEqual(new Set(["null", "blank"]));
    expect(groups.every((g) => g.proposedDeletions === 0)).toBe(true); // no authoritative identity
  });

  it("Class C merges only under proven authoritative identity", () => {
    const a = row({ vendorSku: null });
    const b = row({ vendorSku: null });
    const sameIdentity: ExternalMappingRow[] = [
      { vendorItemId: a.id, sourceSystem: "orderly", sourcePropertyId: "p1", sourceExternalId: "X9" },
      { vendorItemId: b.id, sourceSystem: "orderly", sourcePropertyId: "p1", sourceExternalId: "X9" },
    ];
    const groups = classify([a, b], sameIdentity);
    expect(groups[0].class).toBe("C");
    expect(groups[0].cAuthoritativelySame).toBe(true);
    expect(groups[0].proposedDeletions).toBe(1);
  });

  it("classifies conflicting external identities as D, and D wins over B", () => {
    const a = row({ caseSize: 10 });
    const b = row({ caseSize: 24 });
    const mappings: ExternalMappingRow[] = [
      { vendorItemId: a.id, sourceSystem: "orderly", sourcePropertyId: "p1", sourceExternalId: "X1" },
      { vendorItemId: b.id, sourceSystem: "orderly", sourcePropertyId: "p1", sourceExternalId: "X2" },
    ];
    const groups = classify([a, b], mappings);
    expect(groups[0].class).toBe("D");
  });

  it("one mapped + one unmapped row is NOT a Class D conflict", () => {
    const a = row();
    const b = row();
    const mappings: ExternalMappingRow[] = [
      { vendorItemId: a.id, sourceSystem: "orderly", sourcePropertyId: "p1", sourceExternalId: "X1" },
    ];
    const groups = classify([a, b], mappings);
    expect(groups[0].class).toBe("A");
  });

  it("classifies protected-field disagreements (active, brand) as E", () => {
    expect(classify([row({ active: 1 }), row({ active: 0 })])[0].class).toBe("E");
    expect(classify([row({ brandName: "Acme" }), row({ brandName: "Bolt" })])[0].class).toBe("E");
    // NULL brand never conflicts; case/space differences are cosmetic
    expect(classify([row({ brandName: "Acme" }), row({ brandName: null })])[0].class).toBe("A");
    expect(classify([row({ brandName: " ACME " }), row({ brandName: "acme" })])[0].class).toBe("A");
  });

  it("does not group across vendors, items, or differing SKUs", () => {
    const groups = classify([
      row({ vendorId: "v1" }), row({ vendorId: "v2" }),
      row({ inventoryItemId: "inv2" }), row({ vendorSku: "SKU2" }),
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe("survivor election", () => {
  it("prefers externally mapped rows, then most references, then smallest id", () => {
    const refs: ReferenceCounts = new Map([
      ["vi-b", new Map([["po_lines.vendor_item_id", 5]])],
      ["vi-c", new Map([["po_lines.vendor_item_id", 9]])],
    ]);
    const mappings = new Map([["vi-c", [{ vendorItemId: "vi-c", sourceSystem: "s", sourcePropertyId: "p", sourceExternalId: "e" }]]]);
    // mapped row wins even with fewer refs than... (vi-c is mapped AND most refs)
    expect(electSurvivor(["vi-a", "vi-b", "vi-c"], mappings, refs)).toBe("vi-c");
    // no mappings: most refs wins
    expect(electSurvivor(["vi-a", "vi-b", "vi-c"], new Map(), refs)).toBe("vi-c");
    // no mappings, tied refs: smallest id
    expect(electSurvivor(["vi-a", "vi-x"], new Map(), new Map())).toBe("vi-a");
  });

  it("mapped row wins even with fewer downstream references", () => {
    const refs: ReferenceCounts = new Map([["vi-b", new Map([["po_lines.vendor_item_id", 50]])]]);
    const mappings = new Map([["vi-a", [{ vendorItemId: "vi-a", sourceSystem: "s", sourcePropertyId: "p", sourceExternalId: "e" }]]]);
    expect(electSurvivor(["vi-a", "vi-b"], mappings, refs)).toBe("vi-a");
  });
});
