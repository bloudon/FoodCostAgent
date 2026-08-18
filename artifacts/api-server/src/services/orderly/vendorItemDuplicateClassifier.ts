/**
 * Vendor-item duplicate classifier — Gate 1 of task "Classify then merge
 * duplicate vendor catalog rows (PM-gated)".
 *
 * READ-ONLY. This module never mutates the database. It classifies proposed
 * duplicate vendor_items groups into the PM-approved classes:
 *
 *   A — exact duplicate purchasing identity (auto-merge candidates)
 *   B — same SKU, materially different pack geometry / purchase unit (HOLD)
 *   C — NULL/blank SKU groups, classified separately (HOLD unless another
 *       authoritative identity proves sameness)
 *   D — conflicting external/source mappings (HOLD)
 *   E — disagreement in protected operational/config fields (HOLD)
 *
 * PM amendments honored here:
 *  - Pack-equivalence contract is explicit (see PACK_EQUIVALENCE_CONTRACT):
 *    raw pack-string (pack_uom) differences alone never create a conflict when
 *    normalized geometry agrees; material differences in any normalized field
 *    prevent Class A.
 *  - Price fields are DIAGNOSTIC ONLY — they never move a group out of Class A
 *    by themselves. Groups with differing price snapshots are counted.
 *  - NULL SKU is never coalesced with blank string; both are Class C but are
 *    grouped under distinct keys.
 */

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface ClassifierVendorItemRow {
  id: string;
  vendorId: string;
  inventoryItemId: string;
  vendorSku: string | null;
  brandName: string | null;
  purchaseUnitId: string;
  caseSize: number;
  innerPackSize: number | null;
  packUom: string | null;
  lastPrice: number;
  lastCasePrice: number;
  active: number;
  priceSource: string | null;
  canonicalQtyPerPurchaseUnit: number | null;
  pricingBasis: string | null;
  isVariableWeight: number | null;
  packGeometryStatus: string | null;
}

export interface ExternalMappingRow {
  vendorItemId: string;
  sourceSystem: string;
  sourcePropertyId: string;
  sourceExternalId: string;
}

/** Per-vendor-item downstream reference counts, keyed by table name. */
export type ReferenceCounts = Map<string, Map<string, number>>; // vendorItemId -> table -> count

// ── Pack-equivalence contract (PM amendment #1) ──────────────────────────────

export const PACK_EQUIVALENCE_CONTRACT = `
Two vendor_items rows have EQUIVALENT pack geometry iff ALL normalized fields agree:
  1. purchase_unit_id            — exact match (same unit row).
  2. total units per case        — case_size * coalesce(inner_pack_size, 1),
                                   compared with relative tolerance 1e-9.
  3. canonical_qty_per_purchase_unit
                                 — both NULL, or both non-NULL and equal within
                                   relative tolerance 1e-6. NULL-vs-value is
                                   treated as a CONFLICT but flagged as
                                   normalization-sensitive (the group's class
                                   could change if geometry were derived).
  4. pricing_basis               — normalized (NULL -> 'purchase_unit'), exact.
  5. is_variable_weight          — normalized (NULL -> 0), exact.
  6. pack_uom                    — normalized lower(trim()); raw differences with
                                   equal normalized value are COSMETIC and ignored
                                   (counted in the report).
Raw pack-string differences alone never create a conflict (rule 6).
Price fields (last_price, last_case_price, price_source, priced_at,
normalized_price_per_canonical_unit) are DIAGNOSTIC ONLY and never part of
pack equivalence or identity.
Protected operational fields for Class E: active, brand_name (normalized
lower/trim; differing non-null values conflict; NULL never conflicts).
`.trim();

const REL_TOL_UNITS = 1e-9;
const REL_TOL_CANONICAL = 1e-6;

function relEqual(a: number, b: number, tol: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= tol * scale;
}

function normPackUom(v: string | null): string {
  return (v ?? "").trim().toLowerCase();
}

function normBrand(v: string | null): string | null {
  const t = (v ?? "").trim().toLowerCase();
  return t === "" ? null : t;
}

export function totalUnitsPerCase(r: ClassifierVendorItemRow): number {
  return (r.caseSize ?? 1) * (r.innerPackSize ?? 1);
}

export interface PackComparison {
  equivalent: boolean;
  conflicts: string[];               // which contract rules failed
  cosmeticPackUomDiff: boolean;      // raw pack_uom differs, normalized equal
  normalizationSensitive: boolean;   // NULL-vs-value canonical qty (class could flip)
}

export function comparePackGeometry(a: ClassifierVendorItemRow, b: ClassifierVendorItemRow): PackComparison {
  const conflicts: string[] = [];
  let cosmeticPackUomDiff = false;
  let normalizationSensitive = false;

  if (a.purchaseUnitId !== b.purchaseUnitId) conflicts.push("purchase_unit_id");
  if (!relEqual(totalUnitsPerCase(a), totalUnitsPerCase(b), REL_TOL_UNITS)) conflicts.push("total_units_per_case");

  const ca = a.canonicalQtyPerPurchaseUnit;
  const cb = b.canonicalQtyPerPurchaseUnit;
  if (ca == null && cb == null) {
    // both missing — no conflict from this rule
  } else if (ca == null || cb == null) {
    conflicts.push("canonical_qty_per_purchase_unit (null-vs-value)");
    normalizationSensitive = true;
  } else if (!relEqual(ca, cb, REL_TOL_CANONICAL)) {
    conflicts.push("canonical_qty_per_purchase_unit");
  }

  if ((a.pricingBasis ?? "purchase_unit") !== (b.pricingBasis ?? "purchase_unit")) conflicts.push("pricing_basis");
  if ((a.isVariableWeight ?? 0) !== (b.isVariableWeight ?? 0)) conflicts.push("is_variable_weight");

  if (normPackUom(a.packUom) !== normPackUom(b.packUom)) {
    conflicts.push("pack_uom (normalized)");
  } else if ((a.packUom ?? "") !== (b.packUom ?? "")) {
    cosmeticPackUomDiff = true;
  }

  return { equivalent: conflicts.length === 0, conflicts, cosmeticPackUomDiff, normalizationSensitive };
}

// ── Group classification ─────────────────────────────────────────────────────

export type DuplicateClass = "A" | "B" | "C" | "D" | "E";

export interface ClassifiedGroup {
  key: { vendorId: string; inventoryItemId: string; vendorSku: string | null };
  skuKind: "sku" | "null" | "blank";
  rowIds: string[];
  size: number;
  class: DuplicateClass;
  reasons: string[];
  /** For class C: would-be class if SKU-less-ness were ignored. */
  shadowClass?: Exclude<DuplicateClass, "C">;
  /** Class C only: all rows share one authoritative external identity. */
  cAuthoritativelySame?: boolean;
  packConflictFields: string[];
  cosmeticPackUomDiff: boolean;
  normalizationSensitive: boolean;
  priceSnapshotsDiffer: boolean;
  externalIdentities: string[];      // distinct "system|property|externalId" among members
  proposedSurvivorId: string | null; // Class A (and authoritative C) only
  proposedDeletions: number;         // group size - 1 when mergeable, else 0
  referenceCountsByTable: Record<string, number>; // refs held by would-be losers
}

export interface ClassifierInput {
  rows: ClassifierVendorItemRow[];
  mappings: ExternalMappingRow[];
  referenceCounts: ReferenceCounts;
}

function skuKindOf(sku: string | null): "sku" | "null" | "blank" {
  if (sku === null) return "null";
  if (sku.trim() === "") return "blank";
  return "sku";
}

/** Distinct external identities among a set of vendor item ids. */
function externalIdentitiesFor(ids: string[], byVendorItem: Map<string, ExternalMappingRow[]>): string[] {
  const set = new Set<string>();
  for (const id of ids) {
    for (const m of byVendorItem.get(id) ?? []) {
      set.add(`${m.sourceSystem}|${m.sourcePropertyId}|${m.sourceExternalId}`);
    }
  }
  return [...set].sort();
}

function refTotal(id: string, refs: ReferenceCounts): number {
  let n = 0;
  for (const c of (refs.get(id) ?? new Map()).values()) n += c;
  return n;
}

/**
 * Survivor rule (PM): 1) authoritative external mapping target, 2) most
 * downstream references, 3) deterministic tiebreak. vendor_items has no
 * created_at column, so the stable tiebreaker is the lexicographically
 * smallest id (documented in the PM report).
 */
export function electSurvivor(
  ids: string[],
  byVendorItem: Map<string, ExternalMappingRow[]>,
  refs: ReferenceCounts,
): string {
  const mapped = ids.filter((id) => (byVendorItem.get(id) ?? []).length > 0);
  const pool = mapped.length > 0 ? mapped : ids;
  return [...pool].sort((x, y) => {
    const rx = refTotal(x, refs);
    const ry = refTotal(y, refs);
    if (rx !== ry) return ry - rx;
    return x < y ? -1 : 1;
  })[0];
}

export function classifyGroups(input: ClassifierInput): ClassifiedGroup[] {
  const { rows, mappings, referenceCounts } = input;

  const byVendorItem = new Map<string, ExternalMappingRow[]>();
  for (const m of mappings) {
    const arr = byVendorItem.get(m.vendorItemId) ?? [];
    arr.push(m);
    byVendorItem.set(m.vendorItemId, arr);
  }

  // Group by exact raw (vendorId, inventoryItemId, vendorSku). NULL and blank
  // SKUs are distinct keys and never coalesced.
  const groups = new Map<string, ClassifierVendorItemRow[]>();
  for (const r of rows) {
    const key = JSON.stringify([r.vendorId, r.inventoryItemId, r.vendorSku]);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  const out: ClassifiedGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const first = members[0];
    const skuKind = skuKindOf(first.vendorSku);
    const ids = members.map((m) => m.id);

    // Pairwise pack comparison against the first row is insufficient for
    // transitivity edge cases; compare all pairs.
    const packConflictFields = new Set<string>();
    let cosmeticPackUomDiff = false;
    let normalizationSensitive = false;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const cmp = comparePackGeometry(members[i], members[j]);
        cmp.conflicts.forEach((c) => packConflictFields.add(c));
        cosmeticPackUomDiff ||= cmp.cosmeticPackUomDiff;
        normalizationSensitive ||= cmp.normalizationSensitive;
      }
    }

    // External identity conflict: rows carrying DIFFERENT authoritative ids.
    // (One row mapped + others unmapped is not a conflict — the mapped row is
    // simply the authoritative survivor candidate.)
    const perRowIdentities = members.map((m) => externalIdentitiesFor([m.id], byVendorItem));
    const nonEmpty = perRowIdentities.filter((x) => x.length > 0);
    const distinctIdentitySets = new Set(nonEmpty.map((x) => x.join(",")));
    const externalConflict = distinctIdentitySets.size > 1;

    // Protected operational/config fields (Class E)
    const reasons: string[] = [];
    const activeVals = new Set(members.map((m) => m.active));
    const brandVals = new Set(members.map((m) => normBrand(m.brandName)).filter((b): b is string => b !== null));
    const protectedConflict: string[] = [];
    if (activeVals.size > 1) protectedConflict.push("active");
    if (brandVals.size > 1) protectedConflict.push("brand_name");

    // Diagnostic only (PM amendment #2)
    const priceSnapshotsDiffer =
      new Set(members.map((m) => `${m.lastPrice}|${m.lastCasePrice}`)).size > 1;

    // Class precedence: D > B > E > A (C overrides for NULL/blank SKU).
    let cls: DuplicateClass;
    if (externalConflict) {
      cls = "D";
      reasons.push(`conflicting external identities: ${[...distinctIdentitySets].join(" vs ")}`);
    } else if (packConflictFields.size > 0) {
      cls = "B";
      reasons.push(`pack geometry conflict: ${[...packConflictFields].join(", ")}`);
    } else if (protectedConflict.length > 0) {
      cls = "E";
      reasons.push(`protected field conflict: ${protectedConflict.join(", ")}`);
    } else {
      cls = "A";
      reasons.push("identical purchasing identity under the pack-equivalence contract");
    }

    let shadowClass: Exclude<DuplicateClass, "C"> | undefined;
    let cAuthoritativelySame: boolean | undefined;
    if (skuKind !== "sku") {
      shadowClass = cls as Exclude<DuplicateClass, "C">;
      // Authoritative sameness: every member carries at least one mapping and
      // all mapped identity sets are identical (and not conflicting).
      cAuthoritativelySame =
        !externalConflict &&
        nonEmpty.length === members.length &&
        distinctIdentitySets.size === 1 &&
        shadowClass === "A";
      cls = "C";
      reasons.unshift(`${skuKind === "null" ? "NULL" : "blank"} SKU group — classified separately`);
    }

    const mergeable = cls === "A" || (cls === "C" && cAuthoritativelySame === true);
    const survivor = mergeable ? electSurvivor(ids, byVendorItem, referenceCounts) : null;

    // Reference counts held by would-be losers (what a merge must repoint).
    const loserRefs: Record<string, number> = {};
    for (const id of ids) {
      if (survivor !== null && id === survivor) continue;
      for (const [table, n] of (referenceCounts.get(id) ?? new Map()).entries()) {
        loserRefs[table] = (loserRefs[table] ?? 0) + n;
      }
    }

    out.push({
      key: { vendorId: first.vendorId, inventoryItemId: first.inventoryItemId, vendorSku: first.vendorSku },
      skuKind,
      rowIds: ids.sort(),
      size: members.length,
      class: cls,
      reasons,
      shadowClass,
      cAuthoritativelySame,
      packConflictFields: [...packConflictFields],
      cosmeticPackUomDiff,
      normalizationSensitive,
      priceSnapshotsDiffer,
      externalIdentities: externalIdentitiesFor(ids, byVendorItem),
      proposedSurvivorId: survivor,
      proposedDeletions: mergeable ? members.length - 1 : 0,
      referenceCountsByTable: loserRefs,
    });
  }

  return out.sort((a, b) => b.size - a.size);
}
