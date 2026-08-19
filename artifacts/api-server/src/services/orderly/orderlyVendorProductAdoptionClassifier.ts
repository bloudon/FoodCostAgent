/**
 * Orderly Vendor-Product Adoption Classifier — Task #1210
 *
 * READ-ONLY, PURE. No DB imports. No side-effects. No input mutation.
 *
 * Classifications:
 *   already_present                    — vendor_item + mapping verified against source
 *   safe_new_vendor_product            — new vendor+SKU → proven canonical item
 *   safe_same_vendor_alternate_product — same vendor, distinct SKU/pack → same canonical item
 *   mapping_only_gap                   — vendor_item matches geometry, mapping absent
 *   conflicting_source_identity        — existing mapping points to wrong vendor/item
 *   pack_geometry_conflict             — candidate vi found but geometry proof fails
 *   missing_canonical_inventory_identity — no approved canonical item determinable
 *   otherwise_held                     — any other hold (unknown vendor, ambiguous supplier, etc.)
 */

// ─── Source-entry types ───────────────────────────────────────────────────────

export interface NormalizedPackGeometry {
  outerCount: number | null;
  innerSize: number | null;
  normalizedUom: string | null;
  rawPackString: string | null;
}

export interface FallbackIdentity {
  kind: 'fallback';
  sourcePropertyId: string;
  supplierId: string | null;
  normalizedSku: string | null;
  normalizedRawPack: string | null;
  key: string; // "fallback|<propertyId>|<supplierId>|<sku>|<rawPack>"
}

export interface NormalizedPackSizeEntry {
  specId: string;
  packSizeId: string | null;
  hasPackSizeId: boolean;
  supplierId: string | null;
  supplierName: string | null;
  resolvedSku: string | null;
  normalizedSku: string | null;
  productDescription: string | null;
  packDescription: string | null;
  active: boolean | null;
  packSizeDesc: string | null;
  pack: unknown | null;
  size: unknown | null;
  uom: string | null;
  normalizedPackGeometry: NormalizedPackGeometry;
  hasCatalogPrice: boolean;
  fallbackIdentity: FallbackIdentity | null;
}

// ─── Snapshot types (no DB imports) ──────────────────────────────────────────

export interface SnapshotVendorRow {
  vendorId: string;
  companyId: string;
  supplierExternalId: string | null;
  vendorName: string | null;
}

export interface SnapshotApprovedCanonicalItem {
  inventoryItemId: string;
  companyId: string;
}

export interface SnapshotVendorItemRow {
  vendorItemId: string;
  vendorId: string;
  companyId: string;
  inventoryItemId: string;
  vendorSku: string | null;
  normalizedSku: string | null;
  caseSize: number | null;
  innerPackSize: number | null;
  packUom: string | null;
  active: number | null;
}

export interface SnapshotVendorItemExternalMapping {
  vendorItemId: string;
  sourceSystem: string;
  sourcePropertyId: string;
  sourceExternalId: string;
  identityKind: 'packSizeId' | 'fallback';
}

/**
 * purchaseUnitEvidence is included for geometry-proof completeness but is
 * intentionally not used in pack comparison today: the Orderly source provides
 * only outer/inner/uom, and purchaseUnitId matching requires a unit-table join
 * that is outside the pure-snapshot scope.  The field is retained so callers
 * can pass it through without a schema change when the proof is extended.
 */
export interface SnapshotPurchaseUnitEvidence {
  vendorItemId: string;
  purchaseUnitId: string | null;
  canonicalQtyPerPurchaseUnit: number | null;
  pricingBasis: string | null;
  isVariableWeight: number | null;
}

export interface AdoptionClassifierSnapshot {
  companyId: string;
  sourceSystem: string;
  sourcePropertyId: string;
  vendors: readonly SnapshotVendorRow[];
  approvedCanonicalItemIds: readonly SnapshotApprovedCanonicalItem[];
  vendorItems: readonly SnapshotVendorItemRow[];
  vendorItemExternalMappings: readonly SnapshotVendorItemExternalMapping[];
  /** Retained for future geometry-proof extensions; not consumed today. */
  purchaseUnitEvidence: readonly SnapshotPurchaseUnitEvidence[];
}

// ─── Classification types ─────────────────────────────────────────────────────

export type AdoptionClass =
  | 'already_present'
  | 'safe_new_vendor_product'
  | 'safe_same_vendor_alternate_product'
  | 'mapping_only_gap'
  | 'conflicting_source_identity'
  | 'pack_geometry_conflict'
  | 'missing_canonical_inventory_identity'
  | 'otherwise_held';

export interface ProposedVendorItem {
  vendorId: string;
  inventoryItemId: string;
  vendorSku: string | null;
  caseSize: number | null;
  innerPackSize: number | null;
  packUom: string | null;
  active: boolean;
}

export interface ProposedExternalMapping {
  sourceSystem: string;
  sourcePropertyId: string;
  sourceExternalId: string;
  identityKind: 'packSizeId' | 'fallback';
}

export interface AdoptionClassificationResult {
  entry: NormalizedPackSizeEntry;
  classification: AdoptionClass;
  reasons: string[];
  inferredCanonicalItemId: string | null;
  resolvedVendorId: string | null;
  existingVendorItemId: string | null;
  existingMappingFound: boolean;
  proposedVendorItem: ProposedVendorItem | null;
  proposedMapping: ProposedExternalMapping | null;
}

export interface AdoptionClassifierSummary {
  totalConsidered: number;
  withPackSizeId: number;
  withoutPackSizeId: number;
  classCounts: Record<AdoptionClass, number>;
  proposedNewVendorItemCount: number;
  proposedMappingCount: number;
  proposedPriceObservationCount: 0;
  catalogPricesLackingApprovedLineage: number;
  identityConflictCount: number;
  relationships: AdoptionClassificationResult[];
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class AdoptionClassifierError extends Error {
  constructor(
    public readonly code:
      | 'WRONG_PROPERTY'
      | 'WRONG_COMPANY'
      | 'MISSING_SUPPLIER'
      | 'MISSING_SKU'
      | 'MISSING_RAW_GEOMETRY'
      | 'DUPLICATE_PACK_SIZE_ID'
      | 'FALLBACK_IDENTITY_COLLISION'
      | 'AMBIGUOUS_SUPPLIER_MAPPING'
      | 'INVALID_SOURCE',
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'AdoptionClassifierError';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function normStr(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

function normLower(v: unknown): string | null {
  const s = normStr(v);
  return s == null ? null : s.toLowerCase();
}

function derivePackGeometry(
  pack: unknown,
  size: unknown,
  uom: unknown,
  packSizeDesc: unknown,
): NormalizedPackGeometry {
  let outerCount: number | null = null;
  let innerSize: number | null = null;
  let normalizedUom: string | null = normLower(uom);
  let rawPackString: string | null = null;

  const packNum = pack != null ? Number(pack) : NaN;
  const sizeNum = size != null ? Number(size) : NaN;

  if (Number.isFinite(packNum) && Number.isFinite(sizeNum)) {
    outerCount = packNum;
    innerSize = sizeNum;
    rawPackString = `${packNum}/${sizeNum}${normalizedUom ? ' ' + normalizedUom.toUpperCase() : ''}`;
  } else if (Number.isFinite(packNum)) {
    outerCount = packNum;
    rawPackString = `${packNum}${normalizedUom ? ' ' + normalizedUom.toUpperCase() : ''}`;
  } else {
    const desc = normStr(packSizeDesc);
    if (desc) {
      rawPackString = desc;
      const m1 = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*([A-Za-z ]*)$/.exec(desc);
      if (m1) {
        outerCount = Number(m1[1]);
        innerSize = Number(m1[2]);
        normalizedUom = normLower(m1[3]) ?? normalizedUom;
      } else {
        const m2 = /^(\d+(?:\.\d+)?)\s*([A-Za-z ]+)$/.exec(desc);
        if (m2) {
          outerCount = Number(m2[1]);
          normalizedUom = normLower(m2[2]) ?? normalizedUom;
        }
      }
    }
  }

  return { outerCount, innerSize, normalizedUom, rawPackString };
}

function rawPackKey(geo: NormalizedPackGeometry): string | null {
  if (geo.rawPackString == null) return null;
  return geo.rawPackString.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildFallbackKey(
  sourcePropertyId: string,
  supplierId: string | null,
  normalizedSku: string | null,
  normalizedRawPack: string | null,
): string {
  return ['fallback', sourcePropertyId, supplierId ?? '', normalizedSku ?? '', normalizedRawPack ?? ''].join('|');
}

const REL_TOL = 1e-6;

function relClose(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= REL_TOL * scale;
}

/**
 * Geometry proof result.
 *
 * 'equivalent'   — every present dimension matches within tolerance.
 * 'conflict'     — at least one dimension is present on both sides and disagrees.
 * 'unverifiable' — source geometry is absent; cannot prove equivalence — hold.
 *
 * Transposed form: Orderly sometimes writes "1/N UOM" where stored caseSize=N.
 * We accept that only when source outerCount=1 AND stored caseSize matches
 * source innerSize. This is the only transposition accepted; it is tested.
 */
function probePackGeometry(
  src: NormalizedPackGeometry,
  vi: SnapshotVendorItemRow,
): 'equivalent' | 'conflict' | 'unverifiable' {
  if (src.outerCount == null) return 'unverifiable';

  const viOuter = vi.caseSize;
  const viInner = vi.innerPackSize;
  const viUom = normLower(vi.packUom);

  if (viOuter == null || viOuter <= 0) return 'unverifiable';

  const transposed =
    src.outerCount === 1 &&
    src.innerSize != null &&
    relClose(src.innerSize, viOuter);

  if (!relClose(src.outerCount, viOuter) && !transposed) {
    return 'conflict';
  }

  if (src.innerSize != null && !transposed) {
    if (viInner == null || viInner <= 0) return 'unverifiable';
    if (!relClose(src.innerSize, viInner)) return 'conflict';
  }

  if (src.normalizedUom != null) {
    if (viUom == null) return 'unverifiable';
    if (src.normalizedUom !== viUom) return 'conflict';
  }

  return 'equivalent';
}

// ─── Source normalization ─────────────────────────────────────────────────────

/**
 * Normalize every packSizes entry from a root array of Orderly restaurant specs.
 *
 * sourcePropertyId is required because fallback identity is property-scoped:
 *   "fallback|<propertyId>|<supplierId>|<sku>|<rawPack>"
 *
 * Fails closed on:
 *   - duplicate packSize.id
 *   - fallback identity collision within this call
 *   - missing supplierId / SKU / raw geometry (when required)
 */
export function normalizeOrderlyRestaurantSpecs(
  specs: readonly unknown[],
  sourcePropertyId: string,
  options: {
    requireSupplier?: boolean;
    requireSku?: boolean;
    requireRawGeometry?: boolean;
  } = {},
): NormalizedPackSizeEntry[] {
  const requireSupplier = options.requireSupplier !== false;
  const requireSku = options.requireSku !== false;
  const requireRawGeometry = options.requireRawGeometry !== false;

  const seenPackSizeIds = new Set<string>();
  const seenFallbackKeys = new Set<string>();
  const results: NormalizedPackSizeEntry[] = [];

  for (const rawSpec of specs) {
    if (rawSpec == null || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) {
      throw new AdoptionClassifierError('INVALID_SOURCE', 'Each restaurant spec must be a non-null object.');
    }
    const spec = rawSpec as Record<string, unknown>;
    const specId = normStr(spec.id);
    if (!specId) {
      throw new AdoptionClassifierError('INVALID_SOURCE', 'Each restaurant spec must have a non-empty id.');
    }
    if (!Array.isArray(spec.packSizes)) {
      throw new AdoptionClassifierError('INVALID_SOURCE', `Spec "${specId}" must have a packSizes array.`);
    }

    for (const rawPs of spec.packSizes as unknown[]) {
      if (rawPs == null || typeof rawPs !== 'object' || Array.isArray(rawPs)) {
        throw new AdoptionClassifierError('INVALID_SOURCE', `Spec "${specId}" has a non-object packSize entry.`);
      }
      const ps = rawPs as Record<string, unknown>;

      const packSizeId = normStr(ps.id);
      if (packSizeId) {
        if (seenPackSizeIds.has(packSizeId)) {
          throw new AdoptionClassifierError(
            'DUPLICATE_PACK_SIZE_ID',
            `Duplicate packSize.id "${packSizeId}" found in source specs.`,
          );
        }
        seenPackSizeIds.add(packSizeId);
      }

      const supplierId = normStr(ps.supplierId);
      const supplierName = normStr(ps.supplierName);
      const resolvedSku = normStr(ps.sourceSku) ?? normStr(ps.itemCode);
      const normalizedSku = normLower(resolvedSku);
      const productDescription = normStr(ps.productDescription) ?? normStr(ps.itemDesc);
      const packDescription = normStr(ps.packDescription);
      const active =
        typeof ps.active === 'boolean' ? ps.active : ps.active == null ? null : Boolean(ps.active);
      const packSizeDescRaw = normStr(ps.packSizeDesc);
      const packRaw = ps.pack ?? null;
      const sizeRaw = ps.size ?? null;
      const uomRaw = normStr(ps.uom);
      const hasCatalogPrice = ps.price != null;

      if (requireSupplier && !supplierId) {
        throw new AdoptionClassifierError(
          'MISSING_SUPPLIER',
          `Spec "${specId}" packSize entry is missing required supplierId.`,
        );
      }
      if (requireSku && !resolvedSku) {
        throw new AdoptionClassifierError(
          'MISSING_SKU',
          `Spec "${specId}" packSize entry (supplier: ${supplierId ?? 'unknown'}) is missing required SKU/itemCode.`,
        );
      }

      const geo = derivePackGeometry(packRaw, sizeRaw, uomRaw, packSizeDescRaw);

      if (requireRawGeometry && geo.rawPackString == null) {
        throw new AdoptionClassifierError(
          'MISSING_RAW_GEOMETRY',
          `Spec "${specId}" packSize entry (supplier: ${supplierId ?? 'unknown'}, sku: ${resolvedSku ?? 'unknown'}) is missing required raw pack geometry.`,
        );
      }

      let fallbackIdentity: FallbackIdentity | null = null;
      if (!packSizeId) {
        const rawPack = rawPackKey(geo);
        const key = buildFallbackKey(sourcePropertyId, supplierId, normalizedSku, rawPack);
        if (seenFallbackKeys.has(key)) {
          throw new AdoptionClassifierError(
            'FALLBACK_IDENTITY_COLLISION',
            `Fallback identity collision: property="${sourcePropertyId}" supplier="${supplierId ?? ''}" sku="${normalizedSku ?? ''}" rawPack="${rawPack ?? ''}".`,
          );
        }
        seenFallbackKeys.add(key);
        fallbackIdentity = {
          kind: 'fallback',
          sourcePropertyId,
          supplierId,
          normalizedSku,
          normalizedRawPack: rawPack,
          key,
        };
      }

      results.push({
        specId,
        packSizeId,
        hasPackSizeId: packSizeId != null,
        supplierId,
        supplierName,
        resolvedSku,
        normalizedSku,
        productDescription,
        packDescription,
        active,
        packSizeDesc: packSizeDescRaw,
        pack: packRaw,
        size: sizeRaw,
        uom: uomRaw,
        normalizedPackGeometry: geo,
        hasCatalogPrice,
        fallbackIdentity,
      });
    }
  }

  return results;
}

// ─── Classifier ───────────────────────────────────────────────────────────────

export function classifyOrderlyVendorProductAdoption(
  normalizedEntries: readonly NormalizedPackSizeEntry[],
  snapshot: AdoptionClassifierSnapshot,
  options: {
    expectedCompanyId: string;
    expectedPropertyId: string;
  },
): AdoptionClassifierSummary {
  if (snapshot.companyId !== options.expectedCompanyId) {
    throw new AdoptionClassifierError(
      'WRONG_COMPANY',
      `Snapshot companyId "${snapshot.companyId}" does not match expected "${options.expectedCompanyId}".`,
    );
  }
  if (snapshot.sourcePropertyId !== options.expectedPropertyId) {
    throw new AdoptionClassifierError(
      'WRONG_PROPERTY',
      `Snapshot sourcePropertyId "${snapshot.sourcePropertyId}" does not match expected "${options.expectedPropertyId}".`,
    );
  }

  // Index: supplierExternalId → vendor rows (detect ambiguity)
  const vendorsBySupplierExtId = new Map<string, SnapshotVendorRow[]>();
  for (const v of snapshot.vendors) {
    if (!v.supplierExternalId) continue;
    const arr = vendorsBySupplierExtId.get(v.supplierExternalId) ?? [];
    arr.push(v);
    vendorsBySupplierExtId.set(v.supplierExternalId, arr);
  }
  // Fail closed on duplicate supplierExternalId (ambiguous mapping)
  for (const [extId, rows] of vendorsBySupplierExtId) {
    if (rows.length > 1) {
      throw new AdoptionClassifierError(
        'AMBIGUOUS_SUPPLIER_MAPPING',
        `Snapshot contains ${rows.length} vendor rows with supplierExternalId "${extId}" — ambiguous mapping.`,
      );
    }
  }

  const approvedCanonicalIds = new Set(
    snapshot.approvedCanonicalItemIds.map(a => a.inventoryItemId),
  );

  const vendorItemById = new Map<string, SnapshotVendorItemRow>();
  for (const vi of snapshot.vendorItems) vendorItemById.set(vi.vendorItemId, vi);

  // Index: "vendorId|normalizedSku" → vendor item rows
  const vendorItemsByVendorSku = new Map<string, SnapshotVendorItemRow[]>();
  for (const vi of snapshot.vendorItems) {
    const key = `${vi.vendorId}|${vi.normalizedSku ?? normLower(vi.vendorSku) ?? ''}`;
    const arr = vendorItemsByVendorSku.get(key) ?? [];
    arr.push(vi);
    vendorItemsByVendorSku.set(key, arr);
  }

  // External mappings scoped to this property/system
  const mappingBySourceExtId = new Map<string, SnapshotVendorItemExternalMapping[]>();
  const mappingByVendorItemId = new Map<string, SnapshotVendorItemExternalMapping[]>();
  for (const m of snapshot.vendorItemExternalMappings) {
    if (m.sourceSystem !== snapshot.sourceSystem || m.sourcePropertyId !== snapshot.sourcePropertyId) continue;
    const byId = mappingBySourceExtId.get(m.sourceExternalId) ?? [];
    byId.push(m);
    mappingBySourceExtId.set(m.sourceExternalId, byId);
    const byVi = mappingByVendorItemId.get(m.vendorItemId) ?? [];
    byVi.push(m);
    mappingByVendorItemId.set(m.vendorItemId, byVi);
  }

  // Group entries by specId for canonical inference
  const entriesBySpecId = new Map<string, NormalizedPackSizeEntry[]>();
  for (const e of normalizedEntries) {
    const arr = entriesBySpecId.get(e.specId) ?? [];
    arr.push(e);
    entriesBySpecId.set(e.specId, arr);
  }

  /**
   * Infer canonical item for a spec from its siblings.
   *
   * A sibling contributes when ALL of:
   *   1. Sibling's supplierId resolves unambiguously to a company-scoped vendor.
   *   2. Vendor has a vendor_item with matching normalized SKU.
   *   3. Source pack geometry proves EQUIVALENT (not unverifiable) against that vi.
   *   4. That vi's inventoryItemId is in approved canonical scope.
   *
   * Additionally, any existing external mapping for a sibling that satisfies
   * (4) is counted as additional authority.
   *
   * Result:
   *   { inventoryItemId: string } → exactly one canonical item found
   *   { inventoryItemId: null, conflict: false } → zero candidates
   *   { inventoryItemId: null, conflict: true }  → >1 distinct canonical items
   */
  function inferCanonicalForSpec(
    specId: string,
  ): { inventoryItemId: string | null; conflict: boolean } {
    const candidates = new Set<string>();
    const siblings = entriesBySpecId.get(specId) ?? [];

    for (const sib of siblings) {
       // Exact local match — vendor + normalized SKU + proven pack geometry.
       // Existing source mappings are checked while classifying each relationship,
       // but a mapping that has not itself been revalidated must never authorize a
       // different sibling's canonical item.
      if (!sib.supplierId) continue;
      const vendorRows = vendorsBySupplierExtId.get(sib.supplierId);
      if (!vendorRows || vendorRows.length !== 1) continue; // ambiguous or missing
      const sibVendorId = vendorRows[0].vendorId;

      const vskuKey = `${sibVendorId}|${sib.normalizedSku ?? ''}`;
      for (const vi of vendorItemsByVendorSku.get(vskuKey) ?? []) {
        if (!approvedCanonicalIds.has(vi.inventoryItemId)) continue;
        const proof = probePackGeometry(sib.normalizedPackGeometry, vi);
        if (proof === 'equivalent') {
          candidates.add(vi.inventoryItemId);
        }
        // 'unverifiable' or 'conflict' → do not count this vi
      }
    }

    if (candidates.size === 0) return { inventoryItemId: null, conflict: false };
    if (candidates.size === 1) return { inventoryItemId: [...candidates][0], conflict: false };
    return { inventoryItemId: null, conflict: true };
  }

  // ── Classify each entry ───────────────────────────────────────────────────

  function classifyEntry(entry: NormalizedPackSizeEntry): AdoptionClassificationResult {
    if (entry.active === false) {
      return hold(entry, null, 'The authoritative Orderly relationship is inactive.');
    }

    // Resolve vendor — fail to otherwise_held on unknown, ambiguous handled above at snapshot level
    if (!entry.supplierId) {
      return hold(entry, null, 'Entry has no supplierId; cannot resolve vendor.');
    }
    const vendorRows = vendorsBySupplierExtId.get(entry.supplierId);
    if (!vendorRows || vendorRows.length === 0) {
      return hold(entry, null, `Supplier "${entry.supplierId}" not found in company snapshot.`);
    }
    // Already validated no duplicates above, so vendorRows.length === 1
    const resolvedVendorId = vendorRows[0].vendorId;

    const sourceExtId = entry.packSizeId ?? entry.fallbackIdentity?.key ?? null;
    const identityKind: 'packSizeId' | 'fallback' = entry.hasPackSizeId ? 'packSizeId' : 'fallback';

    // Check existing mapping(s) for this source identity
    const existingMappings = sourceExtId ? (mappingBySourceExtId.get(sourceExtId) ?? []) : [];

    if (existingMappings.length > 0) {
      const distinctViIds = new Set(existingMappings.map(m => m.vendorItemId));
      if (distinctViIds.size > 1) {
        return {
          entry,
          classification: 'conflicting_source_identity',
          reasons: [`Source identity "${sourceExtId}" maps to multiple vendor_item ids: ${[...distinctViIds].join(', ')}.`],
          inferredCanonicalItemId: null,
          resolvedVendorId,
          existingVendorItemId: null,
          existingMappingFound: true,
          proposedVendorItem: null,
          proposedMapping: null,
        };
      }

      // Exactly one mapped vi — revalidate fully
      const mappedViId = [...distinctViIds][0];
      const mappedVi = vendorItemById.get(mappedViId) ?? null;

      if (!mappedVi) {
        return conflict(entry, resolvedVendorId, mappedViId, true,
          `Mapped vendor_item "${mappedViId}" is not in snapshot.`);
      }
      if (mappedVi.vendorId !== resolvedVendorId) {
        return conflict(entry, resolvedVendorId, mappedViId, true,
          `Mapped vendor_item "${mappedViId}" belongs to vendor "${mappedVi.vendorId}", expected "${resolvedVendorId}".`);
      }
      if ((mappedVi.normalizedSku ?? normLower(mappedVi.vendorSku)) !== entry.normalizedSku) {
        return conflict(entry, resolvedVendorId, mappedViId, true,
          `Mapped vendor_item "${mappedViId}" normalizedSku "${mappedVi.normalizedSku ?? normLower(mappedVi.vendorSku)}" differs from source "${entry.normalizedSku}".`);
      }
      if (!approvedCanonicalIds.has(mappedVi.inventoryItemId)) {
        return conflict(entry, resolvedVendorId, mappedViId, true,
          `Mapped vendor_item "${mappedViId}" inventoryItemId "${mappedVi.inventoryItemId}" is not in approved canonical scope.`);
      }
      if ((mappedVi.active ?? 1) === 0) {
        return conflict(entry, resolvedVendorId, mappedViId, true,
          `Mapped vendor_item "${mappedViId}" is inactive.`);
      }
      const geoProof = probePackGeometry(entry.normalizedPackGeometry, mappedVi);
      if (geoProof === 'conflict') {
        return {
          entry,
          classification: 'pack_geometry_conflict',
          reasons: [`Mapped vendor_item "${mappedViId}" pack geometry conflicts with source.`],
          inferredCanonicalItemId: mappedVi.inventoryItemId,
          resolvedVendorId,
          existingVendorItemId: mappedViId,
          existingMappingFound: true,
          proposedVendorItem: null,
          proposedMapping: null,
        };
      }
      if (geoProof === 'unverifiable') {
        return hold(entry, resolvedVendorId,
          `Mapped vendor_item "${mappedViId}" geometry cannot be verified against source (source geometry absent) — hold.`,
          mappedViId, true);
      }

      // All checks pass → already_present
      return {
        entry,
        classification: 'already_present',
        reasons: ['Existing vendor_item and source mapping verified against source.'],
        inferredCanonicalItemId: mappedVi.inventoryItemId,
        resolvedVendorId,
        existingVendorItemId: mappedViId,
        existingMappingFound: true,
        proposedVendorItem: null,
        proposedMapping: null,
      };
    }

    // No existing mapping — infer canonical from spec siblings
    const inferred = inferCanonicalForSpec(entry.specId);

    if (inferred.conflict) {
      return {
        entry,
        classification: 'conflicting_source_identity',
        reasons: ['Spec siblings resolve to more than one distinct canonical inventory item.'],
        inferredCanonicalItemId: null,
        resolvedVendorId,
        existingVendorItemId: null,
        existingMappingFound: false,
        proposedVendorItem: null,
        proposedMapping: null,
      };
    }

    if (!inferred.inventoryItemId) {
      return {
        entry,
        classification: 'missing_canonical_inventory_identity',
        reasons: ['No approved canonical inventory item can be inferred from spec sibling exact matches.'],
        inferredCanonicalItemId: null,
        resolvedVendorId,
        existingVendorItemId: null,
        existingMappingFound: false,
        proposedVendorItem: null,
        proposedMapping: null,
      };
    }

    const inferredCanonicalItemId = inferred.inventoryItemId;

    // Look for vendor_items matching this vendor + normalized SKU + canonical item
    const vskuKey = `${resolvedVendorId}|${entry.normalizedSku ?? ''}`;
    const skuMatches = (vendorItemsByVendorSku.get(vskuKey) ?? []).filter(
      vi => vi.inventoryItemId === inferredCanonicalItemId,
    );

    if (skuMatches.length > 0) {
      // Check geometry against each candidate
      const geoEquiv = skuMatches.filter(vi => probePackGeometry(entry.normalizedPackGeometry, vi) === 'equivalent');
      const geoConflict = skuMatches.filter(vi => probePackGeometry(entry.normalizedPackGeometry, vi) === 'conflict');
      const geoUnverifiable = skuMatches.filter(vi => probePackGeometry(entry.normalizedPackGeometry, vi) === 'unverifiable');

      if (geoEquiv.length === 0) {
        if (geoConflict.length > 0) {
          return {
            entry,
            classification: 'pack_geometry_conflict',
            reasons: [`Vendor_item "${geoConflict[0].vendorItemId}" has same vendor+SKU+canonical but conflicting pack geometry.`],
            inferredCanonicalItemId,
            resolvedVendorId,
            existingVendorItemId: geoConflict[0].vendorItemId,
            existingMappingFound: false,
            proposedVendorItem: null,
            proposedMapping: null,
          };
        }
        // Only unverifiable — source geometry absent, cannot prove equivalence → hold
        return hold(entry, resolvedVendorId,
          `Vendor_item "${geoUnverifiable[0].vendorItemId}" found with same vendor+SKU+canonical but source geometry is absent — cannot prove equivalence, hold.`,
          geoUnverifiable[0].vendorItemId, false);
      }

      // geometry-equivalent vi exists — check for conflicting mapping on it
      const targetVi = geoEquiv[0];
      const existingMapsForVi = mappingByVendorItemId.get(targetVi.vendorItemId) ?? [];
      const conflictingMap = existingMapsForVi.find(m => m.sourceExternalId !== sourceExtId);
      if (conflictingMap) {
        return conflict(entry, resolvedVendorId, targetVi.vendorItemId, true,
          `Vendor_item "${targetVi.vendorItemId}" already has mapping to identity "${conflictingMap.sourceExternalId}", differs from "${sourceExtId ?? '(none)'}".`);
      }

      return {
        entry,
        classification: 'mapping_only_gap',
        reasons: [`Vendor_item "${targetVi.vendorItemId}" matches vendor+SKU+geometry but has no source mapping.`],
        inferredCanonicalItemId,
        resolvedVendorId,
        existingVendorItemId: targetVi.vendorItemId,
        existingMappingFound: false,
        proposedVendorItem: null,
        proposedMapping: sourceExtId
          ? { sourceSystem: snapshot.sourceSystem, sourcePropertyId: snapshot.sourcePropertyId, sourceExternalId: sourceExtId, identityKind }
          : null,
      };
    }

    // No vendor_item with this vendor+SKU+canonical — propose new
    const proposedVi: ProposedVendorItem = {
      vendorId: resolvedVendorId,
      inventoryItemId: inferredCanonicalItemId,
      vendorSku: entry.resolvedSku,
      caseSize: entry.normalizedPackGeometry.outerCount,
      innerPackSize: entry.normalizedPackGeometry.innerSize,
      packUom: entry.normalizedPackGeometry.normalizedUom,
      active: true,
    };
    const proposedMapping: ProposedExternalMapping | null = sourceExtId
      ? { sourceSystem: snapshot.sourceSystem, sourcePropertyId: snapshot.sourcePropertyId, sourceExternalId: sourceExtId, identityKind }
      : null;

    // Determine if any vi exists for same vendor+canonical (different SKU/pack)
    const vendorCanonicalExists = snapshot.vendorItems.some(
      vi => vi.vendorId === resolvedVendorId && vi.inventoryItemId === inferredCanonicalItemId,
    );

    if (vendorCanonicalExists) {
      return {
        entry,
        classification: 'safe_same_vendor_alternate_product',
        reasons: [`Same vendor+canonical item exist, but this SKU/pack is distinct (${entry.resolvedSku ?? '(no sku)'}).`],
        inferredCanonicalItemId,
        resolvedVendorId,
        existingVendorItemId: null,
        existingMappingFound: false,
        proposedVendorItem: proposedVi,
        proposedMapping,
      };
    }

    return {
      entry,
      classification: 'safe_new_vendor_product',
      reasons: [`No vendor_item exists for vendor "${resolvedVendorId}" + canonical "${inferredCanonicalItemId}". Safe to create.`],
      inferredCanonicalItemId,
      resolvedVendorId,
      existingVendorItemId: null,
      existingMappingFound: false,
      proposedVendorItem: proposedVi,
      proposedMapping,
    };
  }

  // ── Result helpers ────────────────────────────────────────────────────────

  function hold(
    entry: NormalizedPackSizeEntry,
    resolvedVendorId: string | null,
    reason: string,
    existingVendorItemId: string | null = null,
    existingMappingFound = false,
  ): AdoptionClassificationResult {
    return {
      entry,
      classification: 'otherwise_held',
      reasons: [reason],
      inferredCanonicalItemId: null,
      resolvedVendorId,
      existingVendorItemId,
      existingMappingFound,
      proposedVendorItem: null,
      proposedMapping: null,
    };
  }

  function conflict(
    entry: NormalizedPackSizeEntry,
    resolvedVendorId: string | null,
    existingVendorItemId: string | null,
    existingMappingFound: boolean,
    reason: string,
  ): AdoptionClassificationResult {
    return {
      entry,
      classification: 'conflicting_source_identity',
      reasons: [reason],
      inferredCanonicalItemId: null,
      resolvedVendorId,
      existingVendorItemId,
      existingMappingFound,
      proposedVendorItem: null,
      proposedMapping: null,
    };
  }

  // ── Run classification ────────────────────────────────────────────────────

  const relationships: AdoptionClassificationResult[] = [];
  let identityConflictCount = 0;
  let catalogPricesLackingApprovedLineage = 0;

  for (const entry of normalizedEntries) {
    const r = classifyEntry(entry);
    relationships.push(r);
    if (r.classification === 'conflicting_source_identity' || r.classification === 'pack_geometry_conflict') {
      identityConflictCount++;
    }
    if (entry.hasCatalogPrice && r.classification !== 'already_present') {
      catalogPricesLackingApprovedLineage++;
    }
  }

  const classCounts: Record<AdoptionClass, number> = {
    already_present: 0,
    safe_new_vendor_product: 0,
    safe_same_vendor_alternate_product: 0,
    mapping_only_gap: 0,
    conflicting_source_identity: 0,
    pack_geometry_conflict: 0,
    missing_canonical_inventory_identity: 0,
    otherwise_held: 0,
  };
  let proposedNewVendorItemCount = 0;
  let proposedMappingCount = 0;
  for (const r of relationships) {
    classCounts[r.classification]++;
    if (r.proposedVendorItem) proposedNewVendorItemCount++;
    if (r.proposedMapping) proposedMappingCount++;
  }

  return {
    totalConsidered: normalizedEntries.length,
    withPackSizeId: normalizedEntries.filter(e => e.hasPackSizeId).length,
    withoutPackSizeId: normalizedEntries.filter(e => !e.hasPackSizeId).length,
    classCounts,
    proposedNewVendorItemCount,
    proposedMappingCount,
    proposedPriceObservationCount: 0,
    catalogPricesLackingApprovedLineage,
    identityConflictCount,
    relationships,
  };
}
