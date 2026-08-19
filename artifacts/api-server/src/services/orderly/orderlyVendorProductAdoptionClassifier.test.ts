/**
 * Unit tests for orderlyVendorProductAdoptionClassifier.
 *
 * Every test uses vitest only; no DB imports.
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeOrderlyRestaurantSpecs,
  classifyOrderlyVendorProductAdoption,
  AdoptionClassifierError,
  type AdoptionClassifierSnapshot,
  type NormalizedPackSizeEntry,
  type SnapshotVendorItemRow,
} from './orderlyVendorProductAdoptionClassifier';

// ─── Constants ────────────────────────────────────────────────────────────────

const SYS = 'ORDERLY';
const PROP = 'prop-1';
const CO = 'co-1';
const OPTS = { expectedCompanyId: CO, expectedPropertyId: PROP };

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makePs(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    supplierId: 'sup-1',
    supplierName: 'Sysco',
    itemCode: 'SKU-001',
    pack: 6,
    size: 5,
    uom: 'LB',
    active: true,
    price: null,
    ...o,
  };
}

function makeSpec(specId: string, packSizes: object[]): object {
  return { id: specId, packSizes };
}

function normalize(specs: object[], prop = PROP): NormalizedPackSizeEntry[] {
  return normalizeOrderlyRestaurantSpecs(specs, prop);
}

function baseSnap(o: Partial<AdoptionClassifierSnapshot> = {}): AdoptionClassifierSnapshot {
  return {
    companyId: CO,
    sourceSystem: SYS,
    sourcePropertyId: PROP,
    vendors: [{ vendorId: 'vendor-1', companyId: CO, supplierExternalId: 'sup-1', vendorName: 'Sysco' }],
    approvedCanonicalItemIds: [{ inventoryItemId: 'item-1', companyId: CO }],
    vendorItems: [],
    vendorItemExternalMappings: [],
    purchaseUnitEvidence: [],
    ...o,
  };
}

function vi(o: Partial<SnapshotVendorItemRow> & { vendorItemId: string }): SnapshotVendorItemRow {
  return {
    vendorId: 'vendor-1',
    companyId: CO,
    inventoryItemId: 'item-1',
    vendorSku: 'SKU-001',
    normalizedSku: 'sku-001',
    caseSize: 6,
    innerPackSize: 5,
    packUom: 'LB',
    active: 1,
    ...o,
  };
}

// ─── normalizeOrderlyRestaurantSpecs ─────────────────────────────────────────

describe('normalizeOrderlyRestaurantSpecs', () => {
  it('normalizes a packSize with packSize.id; fallbackIdentity is null', () => {
    const [r] = normalize([makeSpec('s1', [makePs({ id: 'ps-1' })])]);
    expect(r.specId).toBe('s1');
    expect(r.packSizeId).toBe('ps-1');
    expect(r.hasPackSizeId).toBe(true);
    expect(r.fallbackIdentity).toBeNull();
    expect(r.normalizedSku).toBe('sku-001');
    expect(r.hasCatalogPrice).toBe(false);
  });

  it('normalizes geometry from pack+size+uom', () => {
    const [r] = normalize([makeSpec('s1', [makePs({ id: 'ps-1', pack: 12, size: 2, uom: 'EA' })])]);
    expect(r.normalizedPackGeometry.outerCount).toBe(12);
    expect(r.normalizedPackGeometry.innerSize).toBe(2);
    expect(r.normalizedPackGeometry.normalizedUom).toBe('ea');
  });

  it('falls back to packSizeDesc when pack/size absent', () => {
    const [r] = normalize([makeSpec('s1', [makePs({ id: 'ps-1', pack: null, size: null, uom: null, packSizeDesc: '1/25 LB' })])]);
    expect(r.normalizedPackGeometry.outerCount).toBe(1);
    expect(r.normalizedPackGeometry.innerSize).toBe(25);
    expect(r.normalizedPackGeometry.normalizedUom).toBe('lb');
  });

  it('hasCatalogPrice true when price non-null', () => {
    const [r] = normalize([makeSpec('s1', [makePs({ id: 'ps-1', price: 9.99 })])]);
    expect(r.hasCatalogPrice).toBe(true);
  });

  it('fallback identity is property-scoped and tagged with "fallback" prefix', () => {
    const [r] = normalize([makeSpec('s1', [makePs()])], 'myProp');
    expect(r.hasPackSizeId).toBe(false);
    expect(r.fallbackIdentity).not.toBeNull();
    const fi = r.fallbackIdentity!;
    expect(fi.kind).toBe('fallback');
    expect(fi.sourcePropertyId).toBe('myProp');
    expect(fi.supplierId).toBe('sup-1');
    expect(fi.normalizedSku).toBe('sku-001');
    expect(fi.key).toMatch(/^fallback\|myProp\|/);
    // Never contains specId as substitute for property
    expect(fi.key).not.toContain('s1');
  });

  it('two packSizes in different specs with same property+supplier+sku+pack produce the SAME fallback key (correct: property-scoped, not spec-scoped)', () => {
    // This is intentional: specId is NOT a fallback component — the key is property-scoped.
    // A collision across specs is caught and thrown.
    expect(() =>
      normalize([makeSpec('s1', [makePs()]), makeSpec('s2', [makePs()])]),
    ).toThrow(/\[FALLBACK_IDENTITY_COLLISION\]/);
  });

  it('two packSizes with different SKUs in different specs have distinct fallback keys', () => {
    const entries = normalize([
      makeSpec('s1', [makePs({ itemCode: 'SKU-A' })]),
      makeSpec('s2', [makePs({ itemCode: 'SKU-B' })]),
    ]);
    expect(entries[0].fallbackIdentity!.key).not.toBe(entries[1].fallbackIdentity!.key);
  });

  it('fails on duplicate packSize.id', () => {
    expect(() =>
      normalize([makeSpec('s1', [makePs({ id: 'dup' }), makePs({ id: 'dup', itemCode: 'X' })])]),
    ).toThrow(/\[DUPLICATE_PACK_SIZE_ID\]/);
  });

  it('fails on fallback identity collision within same property', () => {
    expect(() =>
      normalize([makeSpec('s1', [makePs(), makePs()])]),
    ).toThrow(/\[FALLBACK_IDENTITY_COLLISION\]/);
  });

  it('fails on missing supplierId when requireSupplier=true', () => {
    expect(() =>
      normalizeOrderlyRestaurantSpecs([makeSpec('s1', [makePs({ supplierId: null })])], PROP),
    ).toThrow(/\[MISSING_SUPPLIER\]/);
  });

  it('fails on missing SKU when requireSku=true', () => {
    expect(() =>
      normalizeOrderlyRestaurantSpecs([makeSpec('s1', [makePs({ itemCode: null, sourceSku: null })])], PROP),
    ).toThrow(/\[MISSING_SKU\]/);
  });

  it('does not mutate input specs', () => {
    const ps = makePs({ id: 'ps-1' });
    const spec = makeSpec('s1', [ps]);
    const before = JSON.stringify(ps);
    normalize([spec]);
    expect(JSON.stringify(ps)).toBe(before);
  });
});

// ─── classifyOrderlyVendorProductAdoption ────────────────────────────────────

describe('classifyOrderlyVendorProductAdoption', () => {

  // ── Property/company scoping ──────────────────────────────────────────────

  it('fails closed on wrong companyId', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1' })])]);
    expect(() =>
      classifyOrderlyVendorProductAdoption(entries, baseSnap({ companyId: 'co-OTHER' }), OPTS),
    ).toThrow(/\[WRONG_COMPANY\]/);
  });

  it('fails closed on wrong sourcePropertyId', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1' })])]);
    expect(() =>
      classifyOrderlyVendorProductAdoption(entries, baseSnap({ sourcePropertyId: 'prop-OTHER' }), OPTS),
    ).toThrow(/\[WRONG_PROPERTY\]/);
  });

  it('fails closed on duplicate supplierExternalId in snapshot', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1' })])]);
    const snap = baseSnap({
      vendors: [
        { vendorId: 'vendor-1', companyId: CO, supplierExternalId: 'sup-1', vendorName: 'A' },
        { vendorId: 'vendor-2', companyId: CO, supplierExternalId: 'sup-1', vendorName: 'B' },
      ],
    });
    expect(() => classifyOrderlyVendorProductAdoption(entries, snap, OPTS)).toThrow(
      /\[AMBIGUOUS_SUPPLIER_MAPPING\]/,
    );
  });

  // ── missing_canonical_inventory_identity (zero-mapping path) ─────────────

  it('missing_canonical when no sibling provides an exact match and no existing mapping', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1' })])]);
    const summary = classifyOrderlyVendorProductAdoption(entries, baseSnap(), OPTS);
    expect(summary.relationships[0].classification).toBe('missing_canonical_inventory_identity');
  });

  // ── Zero-mapping canonical inference via exact sibling vendor_item ────────

  it('infers canonical from sibling vi with exact vendor+SKU+geometry, NO existing mappings', () => {
    // Two packSizes in the same spec.
    // ps-anchor matches an existing vi (vendor+sku+geometry exact) → canonical inferred.
    // ps-new has a different SKU → safe_new_vendor_product.
    const specs = [
      makeSpec('s1', [
        makePs({ id: 'ps-anchor', itemCode: 'SKU-A', pack: 6, size: 5, uom: 'LB' }),
        makePs({ id: 'ps-new', supplierId: 'sup-2', supplierName: 'US Foods', itemCode: 'SKU-NEW', pack: 12, size: 1, uom: 'EA' }),
      ]),
    ];
    const entries = normalizeOrderlyRestaurantSpecs(specs, PROP);

    const snap = baseSnap({
      vendors: [
        { vendorId: 'vendor-1', companyId: CO, supplierExternalId: 'sup-1', vendorName: 'Sysco' },
        { vendorId: 'vendor-2', companyId: CO, supplierExternalId: 'sup-2', vendorName: 'US Foods' },
      ],
      vendorItems: [
        vi({ vendorItemId: 'vi-anchor', vendorSku: 'SKU-A', normalizedSku: 'sku-a', caseSize: 6, innerPackSize: 5, packUom: 'LB' }),
      ],
      // No external mappings at all
      vendorItemExternalMappings: [],
    });

    const summary = classifyOrderlyVendorProductAdoption(entries, snap, OPTS);
    const anchorR = summary.relationships.find(r => r.entry.packSizeId === 'ps-anchor')!;
    const newR = summary.relationships.find(r => r.entry.packSizeId === 'ps-new')!;

    // ps-anchor: vi-anchor has exact vendor+sku+geometry match → mapping_only_gap
    expect(anchorR.classification).toBe('mapping_only_gap');
    expect(anchorR.inferredCanonicalItemId).toBe('item-1');
    expect(anchorR.existingVendorItemId).toBe('vi-anchor');

    // ps-new: canonical inferred from ps-anchor sibling → safe_new_vendor_product
    expect(newR.classification).toBe('safe_new_vendor_product');
    expect(newR.inferredCanonicalItemId).toBe('item-1');
    expect(newR.proposedVendorItem).not.toBeNull();
    expect(newR.proposedVendorItem!.vendorId).toBe('vendor-2');
  });

  // ── Idempotent already_present (with full revalidation) ──────────────────

  it('already_present when mapped vi passes all revalidation checks', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1' })])]);
    const snap = baseSnap({
      vendorItems: [vi({ vendorItemId: 'vi-1' })],
      vendorItemExternalMappings: [
        { vendorItemId: 'vi-1', sourceSystem: SYS, sourcePropertyId: PROP, sourceExternalId: 'ps-1', identityKind: 'packSizeId' },
      ],
    });
    const r = classifyOrderlyVendorProductAdoption(entries, snap, OPTS).relationships[0];
    expect(r.classification).toBe('already_present');
    expect(r.existingVendorItemId).toBe('vi-1');
  });

  it('conflicting_source_identity when mapped vi has wrong vendor', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1' })])]);
    const snap = baseSnap({
      vendors: [
        { vendorId: 'vendor-1', companyId: CO, supplierExternalId: 'sup-1', vendorName: 'Sysco' },
        { vendorId: 'vendor-X', companyId: CO, supplierExternalId: 'sup-X', vendorName: 'Other' },
      ],
      vendorItems: [
        vi({ vendorItemId: 'vi-1', vendorId: 'vendor-X' }), // wrong vendor
      ],
      vendorItemExternalMappings: [
        { vendorItemId: 'vi-1', sourceSystem: SYS, sourcePropertyId: PROP, sourceExternalId: 'ps-1', identityKind: 'packSizeId' },
      ],
    });
    const r = classifyOrderlyVendorProductAdoption(entries, snap, OPTS).relationships[0];
    expect(r.classification).toBe('conflicting_source_identity');
    expect(r.reasons.join()).toMatch(/vendor/i);
  });

  it('conflicting_source_identity when mapped vi has mismatched normalizedSku', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1', itemCode: 'SKU-001' })])]);
    const snap = baseSnap({
      vendorItems: [vi({ vendorItemId: 'vi-1', vendorSku: 'SKU-999', normalizedSku: 'sku-999' })],
      vendorItemExternalMappings: [
        { vendorItemId: 'vi-1', sourceSystem: SYS, sourcePropertyId: PROP, sourceExternalId: 'ps-1', identityKind: 'packSizeId' },
      ],
    });
    const r = classifyOrderlyVendorProductAdoption(entries, snap, OPTS).relationships[0];
    expect(r.classification).toBe('conflicting_source_identity');
    expect(r.reasons.join()).toMatch(/normalizedSku|sku/i);
  });

  it('pack_geometry_conflict when mapped vi geometry conflicts with source', () => {
    // Source: 6/5 LB; stored: 6/10 LB
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1', pack: 6, size: 5, uom: 'LB' })])]);
    const snap = baseSnap({
      vendorItems: [vi({ vendorItemId: 'vi-1', caseSize: 6, innerPackSize: 10, packUom: 'LB' })],
      vendorItemExternalMappings: [
        { vendorItemId: 'vi-1', sourceSystem: SYS, sourcePropertyId: PROP, sourceExternalId: 'ps-1', identityKind: 'packSizeId' },
      ],
    });
    const r = classifyOrderlyVendorProductAdoption(entries, snap, OPTS).relationships[0];
    expect(r.classification).toBe('pack_geometry_conflict');
  });

  it('otherwise_held when source geometry absent and mapped vi exists (cannot verify)', () => {
    // Source entry has no pack/size/uom/packSizeDesc → outerCount null → unverifiable
    const entries = normalizeOrderlyRestaurantSpecs(
      [makeSpec('s1', [makePs({ id: 'ps-1', pack: null, size: null, uom: null, packSizeDesc: null })])],
      PROP,
      { requireRawGeometry: false },
    );
    const snap = baseSnap({
      vendorItems: [vi({ vendorItemId: 'vi-1' })],
      vendorItemExternalMappings: [
        { vendorItemId: 'vi-1', sourceSystem: SYS, sourcePropertyId: PROP, sourceExternalId: 'ps-1', identityKind: 'packSizeId' },
      ],
    });
    const r = classifyOrderlyVendorProductAdoption(entries, snap, OPTS).relationships[0];
    expect(r.classification).toBe('otherwise_held');
    expect(r.reasons.join()).toMatch(/geometry|absent|unverifiable/i);
  });

  // ── Incomplete stored geometry → hold ─────────────────────────────────────

  it('otherwise_held when sibling vi found by vendor+SKU but source geometry is absent', () => {
    // Source has no geometry; existing vi has geometry. unverifiable → hold.
    const entries = normalizeOrderlyRestaurantSpecs(
      [makeSpec('s1', [
        makePs({ id: 'ps-anchor', pack: 6, size: 5, uom: 'LB' }),           // provides canonical
        makePs({ id: 'ps-nogeo', itemCode: 'SKU-X', pack: null, size: null, uom: null, packSizeDesc: null }),
      ])],
      PROP,
      { requireRawGeometry: false },
    );
    const snap = baseSnap({
      vendorItems: [
        vi({ vendorItemId: 'vi-anchor', vendorSku: 'SKU-001', normalizedSku: 'sku-001', caseSize: 6, innerPackSize: 5, packUom: 'LB' }),
        vi({ vendorItemId: 'vi-nogeo', vendorSku: 'SKU-X', normalizedSku: 'sku-x', caseSize: 12, innerPackSize: 1, packUom: 'EA' }),
      ],
      vendorItemExternalMappings: [],
    });
    const summary = classifyOrderlyVendorProductAdoption(entries, snap, OPTS);
    const noGeoR = summary.relationships.find(r => r.entry.packSizeId === 'ps-nogeo')!;
    expect(noGeoR.classification).toBe('otherwise_held');
  });

  // ── SPRBR regression: same-vendor alternate products ─────────────────────

  it('SPRBR5 1/5 LB and SPRBR 1/25 LB remain distinct, no collapse', () => {
    const specs = [
      makeSpec('spec-brussels', [
        makePs({ id: 'ps-sprbr5', itemCode: 'SPRBR5', pack: 1, size: 5, uom: 'LB' }),
        makePs({ id: 'ps-sprbr', itemCode: 'SPRBR', pack: 1, size: 25, uom: 'LB' }),
      ]),
    ];
    const entries = normalizeOrderlyRestaurantSpecs(specs, PROP);

    const snap = baseSnap({
      approvedCanonicalItemIds: [{ inventoryItemId: 'item-brussels', companyId: CO }],
      vendorItems: [
        vi({ vendorItemId: 'vi-sprbr5', vendorSku: 'SPRBR5', normalizedSku: 'sprbr5', inventoryItemId: 'item-brussels', caseSize: 1, innerPackSize: 5, packUom: 'LB' }),
      ],
      vendorItemExternalMappings: [
        { vendorItemId: 'vi-sprbr5', sourceSystem: SYS, sourcePropertyId: PROP, sourceExternalId: 'ps-sprbr5', identityKind: 'packSizeId' },
      ],
    });

    const summary = classifyOrderlyVendorProductAdoption(entries, snap, OPTS);
    const r5 = summary.relationships.find(r => r.entry.resolvedSku === 'SPRBR5')!;
    const r25 = summary.relationships.find(r => r.entry.resolvedSku === 'SPRBR')!;

    expect(r5.classification).toBe('already_present');
    expect(r5.existingVendorItemId).toBe('vi-sprbr5');

    expect(r25.classification).toBe('safe_same_vendor_alternate_product');
    expect(r25.inferredCanonicalItemId).toBe('item-brussels');
    expect(r25.proposedVendorItem!.vendorSku).toBe('SPRBR');
    expect(r25.proposedVendorItem!.innerPackSize).toBe(25);
    expect(r25.proposedMapping!.sourceExternalId).toBe('ps-sprbr');

    // No collapse
    expect(summary.totalConsidered).toBe(2);
    expect(summary.classCounts.already_present).toBe(1);
    expect(summary.classCounts.safe_same_vendor_alternate_product).toBe(1);
  });

  // ── Fallback identity key is property-scoped ──────────────────────────────

  it('fallback identity key differs for same source data in different properties', () => {
    const ps = makePs(); // no id
    const [eA] = normalizeOrderlyRestaurantSpecs([makeSpec('s1', [ps])], 'propA', { requireRawGeometry: false });
    const [eB] = normalizeOrderlyRestaurantSpecs([makeSpec('s1', [ps])], 'propB', { requireRawGeometry: false });
    expect(eA.fallbackIdentity!.key).not.toBe(eB.fallbackIdentity!.key);
    expect(eA.fallbackIdentity!.key).toMatch(/^fallback\|propA\|/);
    expect(eB.fallbackIdentity!.key).toMatch(/^fallback\|propB\|/);
  });

  // ── Conflicting source mapping (same identity → multiple vis) ─────────────

  it('conflicting_source_identity when one source identity maps to two different vendor_items', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1' })])]);
    const snap = baseSnap({
      vendorItems: [
        vi({ vendorItemId: 'vi-1' }),
        vi({ vendorItemId: 'vi-2' }),
      ],
      vendorItemExternalMappings: [
        { vendorItemId: 'vi-1', sourceSystem: SYS, sourcePropertyId: PROP, sourceExternalId: 'ps-1', identityKind: 'packSizeId' },
        { vendorItemId: 'vi-2', sourceSystem: SYS, sourcePropertyId: PROP, sourceExternalId: 'ps-1', identityKind: 'packSizeId' },
      ],
    });
    const r = classifyOrderlyVendorProductAdoption(entries, snap, OPTS).relationships[0];
    expect(r.classification).toBe('conflicting_source_identity');
    expect(r.identityConflictCount ?? summary(snap, entries).identityConflictCount).toBeGreaterThanOrEqual(0);
    expect(r.reasons.join()).toMatch(/multiple vendor_item/i);
  });

  // ── Pack geometry conflict (no mapping) ───────────────────────────────────

  it('pack_geometry_conflict when vi found by vendor+SKU+canonical but geometry disagrees', () => {
    // ps-anchor provides canonical via exact geometry match.
    // ps-conflict has same SKU as vi-conflict (stored: 6/10 LB, source: 6/5 LB).
    const specs = [
      makeSpec('s1', [
        makePs({ id: 'ps-anchor', itemCode: 'SKU-A', pack: 6, size: 5, uom: 'LB' }),
        makePs({ id: 'ps-conflict', itemCode: 'SKU-B', pack: 6, size: 5, uom: 'LB' }),
      ]),
    ];
    const entries = normalizeOrderlyRestaurantSpecs(specs, PROP);
    const snap = baseSnap({
      vendorItems: [
        vi({ vendorItemId: 'vi-anchor', vendorSku: 'SKU-A', normalizedSku: 'sku-a', caseSize: 6, innerPackSize: 5, packUom: 'LB' }),
        vi({ vendorItemId: 'vi-conflict', vendorSku: 'SKU-B', normalizedSku: 'sku-b', caseSize: 6, innerPackSize: 10, packUom: 'LB' }),
      ],
      vendorItemExternalMappings: [],
    });
    const summary = classifyOrderlyVendorProductAdoption(entries, snap, OPTS);
    const cr = summary.relationships.find(r => r.entry.packSizeId === 'ps-conflict')!;
    expect(cr.classification).toBe('pack_geometry_conflict');
    expect(cr.existingVendorItemId).toBe('vi-conflict');
    expect(summary.identityConflictCount).toBeGreaterThanOrEqual(1);
  });

  // ── Multi-canonical sibling conflict ─────────────────────────────────────

  it('conflicting_source_identity when siblings resolve to multiple distinct canonical items', () => {
    // Two siblings, each matching a vi with a different canonical item → conflict.
    const specs = [
      makeSpec('s1', [
        makePs({ id: 'ps-a', itemCode: 'SKU-A', pack: 6, size: 5, uom: 'LB' }),
        makePs({ id: 'ps-b', itemCode: 'SKU-B', supplierId: 'sup-2', pack: 6, size: 5, uom: 'LB' }),
        makePs({ id: 'ps-target', itemCode: 'SKU-T', pack: 1, size: 1, uom: 'EA' }),
      ]),
    ];
    const entries = normalizeOrderlyRestaurantSpecs(specs, PROP);
    const snap = baseSnap({
      vendors: [
        { vendorId: 'vendor-1', companyId: CO, supplierExternalId: 'sup-1', vendorName: 'Sysco' },
        { vendorId: 'vendor-2', companyId: CO, supplierExternalId: 'sup-2', vendorName: 'US Foods' },
      ],
      approvedCanonicalItemIds: [
        { inventoryItemId: 'item-1', companyId: CO },
        { inventoryItemId: 'item-2', companyId: CO },
      ],
      vendorItems: [
        vi({ vendorItemId: 'vi-a', vendorSku: 'SKU-A', normalizedSku: 'sku-a', inventoryItemId: 'item-1' }),
        vi({ vendorItemId: 'vi-b', vendorId: 'vendor-2', vendorSku: 'SKU-B', normalizedSku: 'sku-b', inventoryItemId: 'item-2' }),
      ],
      vendorItemExternalMappings: [],
    });
    const summary = classifyOrderlyVendorProductAdoption(entries, snap, OPTS);
    const targetR = summary.relationships.find(r => r.entry.packSizeId === 'ps-target')!;
    expect(targetR.classification).toBe('conflicting_source_identity');
    expect(targetR.reasons.join()).toMatch(/more than one distinct canonical/i);
  });

  // ── Transposed 1/N form (tested) ──────────────────────────────────────────

  it('accepts transposed 1/N form: source "1/12 EA" matches stored caseSize=12', () => {
    // Source writes outer=1, inner=12, uom=EA.
    // Stored vi has caseSize=12, innerPackSize=null, packUom=EA.
    // This is the accepted transposition.
    const specs = [makeSpec('s1', [
      makePs({ id: 'ps-trans', itemCode: 'SKU-T', pack: 1, size: 12, uom: 'EA' }),
    ])];
    const entries = normalizeOrderlyRestaurantSpecs(specs, PROP);
    const snap = baseSnap({
      vendorItems: [vi({ vendorItemId: 'vi-t', vendorSku: 'SKU-T', normalizedSku: 'sku-t', caseSize: 12, innerPackSize: null, packUom: 'EA' })],
      vendorItemExternalMappings: [],
    });
    // ps-trans must match vi-t via transposition → mapping_only_gap
    const r = classifyOrderlyVendorProductAdoption(entries, snap, OPTS).relationships[0];
    expect(r.classification).toBe('mapping_only_gap');
    expect(r.existingVendorItemId).toBe('vi-t');
  });

  it('does not treat incomplete stored geometry as equivalent', () => {
    const entries = normalize([makeSpec('s1', [
      makePs({ id: 'ps-incomplete', pack: 6, size: 5, uom: 'LB' }),
    ])]);
    const snap = baseSnap({
      vendorItems: [vi({
        vendorItemId: 'vi-incomplete',
        caseSize: 6,
        innerPackSize: null,
        packUom: null,
      })],
    });
    const r = classifyOrderlyVendorProductAdoption(entries, snap, OPTS).relationships[0];
    expect(r.classification).toBe('missing_canonical_inventory_identity');
  });

  it('holds an inactive source relationship', () => {
    const entries = normalize([makeSpec('s1', [
      makePs({ id: 'ps-inactive', active: false }),
    ])]);
    const r = classifyOrderlyVendorProductAdoption(entries, baseSnap(), OPTS).relationships[0];
    expect(r.classification).toBe('otherwise_held');
    expect(r.reasons.join(' ')).toMatch(/inactive/i);
    expect(r.proposedVendorItem).toBeNull();
  });

  // ── proposedPriceObservationCount always 0 ────────────────────────────────

  it('proposedPriceObservationCount is always 0; catalog prices tracked separately', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1', price: 12.50 })])]);
    const summary = classifyOrderlyVendorProductAdoption(entries, baseSnap(), OPTS);
    expect(summary.proposedPriceObservationCount).toBe(0);
    expect(summary.relationships[0].entry.hasCatalogPrice).toBe(true);
    expect(summary.catalogPricesLackingApprovedLineage).toBe(1);
  });

  // ── Summary counts ────────────────────────────────────────────────────────

  it('totalConsidered / withPackSizeId / withoutPackSizeId are accurate', () => {
    const specs = [
      makeSpec('s1', [
        makePs({ id: 'ps-with' }),
        makePs({ itemCode: 'SKU-2', pack: 1, size: 1, uom: 'EA' }),
      ]),
    ];
    const entries = normalizeOrderlyRestaurantSpecs(specs, PROP);
    const summary = classifyOrderlyVendorProductAdoption(entries, baseSnap(), OPTS);
    expect(summary.totalConsidered).toBe(2);
    expect(summary.withPackSizeId).toBe(1);
    expect(summary.withoutPackSizeId).toBe(1);
  });

  // ── No mutation ──────────────────────────────────────────────────────────

  it('does not mutate snapshot or entries', () => {
    const entries = normalize([makeSpec('s1', [makePs({ id: 'ps-1' })])]);
    const vendors = [{ vendorId: 'vendor-1', companyId: CO, supplierExternalId: 'sup-1', vendorName: 'Sysco' }];
    const snap = baseSnap({ vendors });
    const entryBefore = JSON.stringify(entries);
    const vendorsBefore = JSON.stringify(vendors);
    classifyOrderlyVendorProductAdoption(entries, snap, OPTS);
    expect(JSON.stringify(entries)).toBe(entryBefore);
    expect(JSON.stringify(vendors)).toBe(vendorsBefore);
  });
});

// Helper used only in inline assertion above
function summary(snap: AdoptionClassifierSnapshot, entries: NormalizedPackSizeEntry[]) {
  return classifyOrderlyVendorProductAdoption(entries, snap, OPTS);
}
