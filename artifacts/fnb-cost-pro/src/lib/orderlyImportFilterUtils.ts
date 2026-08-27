/**
 * Pure filter-logic utilities for the Orderly resolution preview.
 *
 * Extracted here so they can be unit-tested without rendering the full
 * ResolutionPreviewStep component.
 */

export interface RowPreviewLike {
  rowIndex?: number;
  sourceCategory: string | null;
  sourceItemCode?: string | null;
  sourceCodeReliability?: "stable" | "pseudo_code" | "unavailable";
  supplierRaw?: string | null;
  packSizeRaw?: string | null;
  cleanedDescription?: string | null;
  caseQuantity?: number | null;
  innerPackQuantity?: number | null;
  baseUnitQuantity?: number | null;
  baseUnit?: string | null;
  identityGroupKey?: string | null;
  /** Server-derived from the same fail-closed rule used by approval. */
  heldForReview?: boolean;
  itemMatch: {
    strategy: string;
    confidence: string;
    possibleRecode?: boolean;
    packCompatibility?: "compatible" | "incompatible" | "unknown" | null;
    recodeEvidenceClass?:
      | "compatible_alternate"
      | "new_pack_size"
      | "source_data_conflict"
      | "pack_evidence_missing"
      | "unreliable_code";
    possibleRecodeMatchedId?: string | null;
    possibleRecodeItem?: { id: string; name: string; pluSku?: string | null; caseSize?: number | null; knownLocations?: string[] } | null;
    sourcePackEvidence?: PackEvidenceLike | null;
    candidatePackEvidence?: PackEvidenceLike | null;
    crossVendorPackEligible?: boolean;
    existingVendorNames?: string[];
    recommendedAction?: "link_existing" | "link_vendor_pack" | "create_variant";
  };
}

interface PackEvidenceLike {
  caseQuantity?: number | null;
  innerPackQuantity?: number | null;
  baseUnitQuantity?: number | null;
  baseUnit?: string | null;
  normalizedUnit?: string | null;
  totalBaseUnits?: number | null;
}

/**
 * Returns the canonical confidence key used by both the filter chips and the
 * filteredRows predicate.  Mirrors the `confidenceBadge` display logic.
 *
 * "held" and "recode" take priority — their rows are shown exclusively under
 * the corresponding action filter instead of also appearing as "New" or a
 * confidence level.
 */
export function rowConfidenceKey(row: RowPreviewLike): string {
  const evidenceClass = row.itemMatch.recodeEvidenceClass;
  if (evidenceClass === "source_data_conflict") return "source-conflict";
  if (evidenceClass === "new_pack_size") return "new-pack-size";
  if (evidenceClass === "compatible_alternate") return "alternate-code";
  if (evidenceClass === "unreliable_code") return "unreliable-code";
  if (evidenceClass === "pack_evidence_missing") return "pack-check";
  if (row.heldForReview) return "held";
  if (row.itemMatch.possibleRecode) return "recode";
  if (row.itemMatch.strategy === "none") return "new";
  return row.itemMatch.confidence; // "high" | "medium" | "low" | "ambiguous"
}

/**
 * Derives the sorted, de-duplicated list of category labels from a set of
 * preview rows.  Rows with null / empty sourceCategory are excluded.
 */
export function uniqueCategories(rows: RowPreviewLike[]): string[] {
  return Array.from(
    new Set(rows.map(r => r.sourceCategory ?? "").filter(Boolean))
  ).sort();
}

/**
 * Filters preview rows by the currently-selected category and confidence Sets.
 * An empty Set means "no filter active" (all rows pass that dimension).
 */
export function applyFilters<T extends RowPreviewLike>(
  rows: T[],
  selectedCategories: ReadonlySet<string>,
  selectedConfidences: ReadonlySet<string>
): T[] {
  return rows.filter(r => {
    const catOk =
      selectedCategories.size === 0 ||
      selectedCategories.has(r.sourceCategory ?? "");
    const confOk =
      selectedConfidences.size === 0 ||
      selectedConfidences.has(rowConfidenceKey(r));
    return catOk && confOk;
  });
}

/**
 * Immutably toggles a value inside a Set, returning a new Set.
 * Used by both the category and confidence toggle handlers.
 */
export function toggleSetValue<T>(prev: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(prev);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

/** Returns source-code decisions that are not saved on every actionable row. */
export function getPendingRecodeCodes<T extends RowPreviewLike>(
  rows: T[],
  hasSavedAction: (row: T) => boolean,
): string[] {
  const rowsByCode = new Map<string, T[]>();
  for (const row of rows) {
    const code = row.sourceItemCode?.trim();
    if (
      !code ||
      row.sourceCodeReliability !== "stable" ||
      !row.itemMatch.possibleRecode ||
      row.itemMatch.recodeEvidenceClass === "source_data_conflict"
    ) {
      continue;
    }
    const group = rowsByCode.get(code) ?? [];
    group.push(row);
    rowsByCode.set(code, group);
  }
  return Array.from(rowsByCode.entries())
    .filter(([, group]) => !group.every(hasSavedAction))
    .map(([code]) => code)
    .sort();
}

export interface BulkNewPackSizeCandidate {
  /** One reliable source code creates one new inventory variant. */
  sourceItemCode: string;
  comparableInventoryItemId: string;
  rowIndexes: number[];
  sourceRowCount: number;
  vendorName: string;
  packDescriptor: string;
  sampleDescription: string;
  duplicateSupplierWarning: string | null;
}

export interface BulkNewPackSizeGroup {
  vendorName: string;
  packDescriptor: string;
  variantCount: number;
  sourceRowCount: number;
  samples: Array<Pick<BulkNewPackSizeCandidate, "sourceItemCode" | "sampleDescription">>;
}

export interface BulkNewPackSizeReview {
  candidates: BulkNewPackSizeCandidate[];
  groups: BulkNewPackSizeGroup[];
}

function sourcePackDescriptor(row: RowPreviewLike): string {
  const raw = row.packSizeRaw?.trim();
  if (raw) return raw;

  const caseQuantity = row.caseQuantity && row.caseQuantity > 0 ? row.caseQuantity : null;
  const innerPackQuantity = row.innerPackQuantity && row.innerPackQuantity > 0 ? row.innerPackQuantity : null;
  const baseUnitQuantity = row.baseUnitQuantity && row.baseUnitQuantity > 0 ? row.baseUnitQuantity : null;
  const baseUnit = row.baseUnit?.trim() || null;
  if (baseUnitQuantity != null && baseUnit) {
    const parts = caseQuantity != null ? [String(caseQuantity)] : [];
    if (innerPackQuantity != null && innerPackQuantity !== 1) parts.push(String(innerPackQuantity));
    parts.push(`${baseUnitQuantity} ${baseUnit}`);
    return parts.join(" × ");
  }
  if (caseQuantity != null) return `${caseQuantity} count`;
  return "Pack descriptor unavailable";
}

function isBulkNewPackSizeRow(row: RowPreviewLike): boolean {
  return Boolean(
    row.rowIndex != null &&
    row.sourceItemCode?.trim() &&
    row.sourceCodeReliability === "stable" &&
    !row.heldForReview &&
    row.itemMatch.possibleRecode &&
    row.itemMatch.recodeEvidenceClass === "new_pack_size" &&
    row.itemMatch.packCompatibility === "incompatible" &&
    row.itemMatch.possibleRecodeMatchedId,
  );
}

/**
 * Produces the only source-code groups that a bulk pack-size decision may
 * touch. A code is excluded unless every one of its staged rows has the same
 * verified incompatible-pack candidate. This deliberately leaves conflicts,
 * missing evidence, unstable codes, and exceptions in the individual review.
 */
export function getBulkNewPackSizeReview(rows: RowPreviewLike[]): BulkNewPackSizeReview {
  const rowsByCode = new Map<string, RowPreviewLike[]>();
  for (const row of rows) {
    const code = row.sourceItemCode?.trim();
    if (!code) continue;
    const group = rowsByCode.get(code) ?? [];
    group.push(row);
    rowsByCode.set(code, group);
  }

  const candidates: BulkNewPackSizeCandidate[] = [];
  for (const [sourceItemCode, codeRows] of rowsByCode) {
    if (!codeRows.every(isBulkNewPackSizeRow)) continue;

    const comparableIds = new Set(
      codeRows.map(row => row.itemMatch.possibleRecodeMatchedId).filter((id): id is string => Boolean(id)),
    );
    const vendorNames = new Set(codeRows.map(row => row.supplierRaw?.trim() || "Vendor not provided"));
    const packDescriptors = new Set(codeRows.map(sourcePackDescriptor));
    if (comparableIds.size !== 1 || vendorNames.size !== 1 || packDescriptors.size !== 1) continue;

    const firstRow = codeRows[0];
    candidates.push({
      sourceItemCode,
      comparableInventoryItemId: Array.from(comparableIds)[0],
      rowIndexes: codeRows.map(row => row.rowIndex!).sort((a, b) => a - b),
      sourceRowCount: codeRows.length,
      vendorName: firstRow.supplierRaw?.trim() || "Vendor not provided",
      packDescriptor: sourcePackDescriptor(firstRow),
      sampleDescription: firstRow.cleanedDescription?.trim() || sourceItemCode,
      duplicateSupplierWarning:
        firstRow.itemMatch.crossVendorPackEligible &&
        firstRow.itemMatch.existingVendorNames &&
        firstRow.itemMatch.existingVendorNames.length > 0
          ? `An item with this name is already supplied by ${firstRow.itemMatch.existingVendorNames.join(", ")}.`
          : null,
    });
  }

  candidates.sort((left, right) => left.sourceItemCode.localeCompare(right.sourceItemCode));
  const groupsByVendorAndPack = new Map<string, BulkNewPackSizeGroup>();
  for (const candidate of candidates) {
    const key = `${candidate.vendorName}\u0000${candidate.packDescriptor}`;
    const group = groupsByVendorAndPack.get(key) ?? {
      vendorName: candidate.vendorName,
      packDescriptor: candidate.packDescriptor,
      variantCount: 0,
      sourceRowCount: 0,
      samples: [],
    };
    group.variantCount += 1;
    group.sourceRowCount += candidate.sourceRowCount;
    if (group.samples.length < 3) {
      group.samples.push({
        sourceItemCode: candidate.sourceItemCode,
        sampleDescription: candidate.sampleDescription,
      });
    }
    groupsByVendorAndPack.set(key, group);
  }

  return {
    candidates,
    groups: Array.from(groupsByVendorAndPack.values()).sort((left, right) =>
      `${left.vendorName}\u0000${left.packDescriptor}`.localeCompare(`${right.vendorName}\u0000${right.packDescriptor}`),
    ),
  };
}

/** Builds the existing per-row approval payload for a reviewer-confirmed bulk selection. */
export function buildBulkNewPackSizeDecisions(
  candidates: BulkNewPackSizeCandidate[],
): Array<{ rowIndex: number; action: "create_variant"; comparableInventoryItemId: string }> {
  return candidates.flatMap(candidate =>
    candidate.rowIndexes.map(rowIndex => ({
      rowIndex,
      action: "create_variant" as const,
      comparableInventoryItemId: candidate.comparableInventoryItemId,
    })),
  );
}

export interface BulkCompatiblePackCandidate {
  /** One reliable source code creates one durable alternate-code link. */
  sourceItemCode: string;
  targetInventoryItemId: string;
  targetItemName: string;
  rowIndexes: number[];
  sourceRowCount: number;
  vendorName: string;
  sampleDescription: string;
  sourceNormalizedTotal: string;
  catalogNormalizedTotal: string;
}

export interface BulkCompatiblePackExclusion {
  sourceItemCode: string;
  rowIndexes: number[];
  reason:
    | "unknown_pack"
    | "conflicting_pack"
    | "missing_pack_evidence"
    | "incompatible_pack"
    | "divergent_group"
    | "not_verified_compatible";
  reasonLabel: string;
}

export interface BulkCompatiblePackReview {
  candidates: BulkCompatiblePackCandidate[];
  excludedGroups: BulkCompatiblePackExclusion[];
}

function geometryValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Number(value.toFixed(6))) : "null";
}

function packEvidenceSignature(
  evidence: PackEvidenceLike | null | undefined,
  fallback: Pick<RowPreviewLike, "caseQuantity" | "innerPackQuantity" | "baseUnitQuantity" | "baseUnit">,
): string {
  const source: PackEvidenceLike = evidence ?? fallback;
  return [
    geometryValue(source.caseQuantity),
    geometryValue(source.innerPackQuantity),
    geometryValue(source.baseUnitQuantity),
    source.baseUnit?.trim().toLowerCase() || "null",
    source.normalizedUnit?.trim().toLowerCase() || "null",
    geometryValue(source.totalBaseUnits),
  ].join("|");
}

function normalizedTotalLabel(evidence: PackEvidenceLike | null | undefined): string {
  if (!evidence || evidence.totalBaseUnits == null || !evidence.normalizedUnit) return "Not confirmed";
  const total = Number.isInteger(evidence.totalBaseUnits)
    ? evidence.totalBaseUnits
    : evidence.totalBaseUnits.toFixed(2);
  return `${total} ${evidence.normalizedUnit}`;
}

function compatiblePackExclusion(
  sourceItemCode: string,
  rows: RowPreviewLike[],
): BulkCompatiblePackExclusion {
  const rowIndexes = rows.map(row => row.rowIndex).filter((index): index is number => index != null).sort((a, b) => a - b);
  if (rows.some(row => row.itemMatch.recodeEvidenceClass === "source_data_conflict")) {
    return { sourceItemCode, rowIndexes, reason: "conflicting_pack", reasonLabel: "conflicting source pack evidence" };
  }
  if (rows.some(row => row.itemMatch.recodeEvidenceClass === "pack_evidence_missing")) {
    return { sourceItemCode, rowIndexes, reason: "missing_pack_evidence", reasonLabel: "missing pack evidence" };
  }
  if (rows.some(row => row.itemMatch.packCompatibility === "unknown")) {
    return { sourceItemCode, rowIndexes, reason: "unknown_pack", reasonLabel: "unknown pack geometry" };
  }
  if (rows.some(row => row.itemMatch.packCompatibility === "incompatible")) {
    return { sourceItemCode, rowIndexes, reason: "incompatible_pack", reasonLabel: "incompatible pack" };
  }
  if (new Set(rows.map(row => row.identityGroupKey ?? "")).size > 1 ||
      new Set(rows.map(row => packEvidenceSignature(row.itemMatch.sourcePackEvidence, row)).values()).size > 1 ||
      new Set(rows.map(row => packEvidenceSignature(row.itemMatch.candidatePackEvidence, row)).values()).size > 1) {
    return { sourceItemCode, rowIndexes, reason: "divergent_group", reasonLabel: "divergent description or pack group evidence" };
  }
  return { sourceItemCode, rowIndexes, reason: "not_verified_compatible", reasonLabel: "not classified as a verified compatible alternate code" };
}

/**
 * Produces only stable source-code groups that are already classified by the
 * server as the same physical pack. Every row for a code must agree on its
 * target, vendor, identity group, and pack evidence. This is a selector for
 * the existing review-decision contract, not an authorization boundary.
 */
export function getBulkCompatiblePackReview(rows: RowPreviewLike[]): BulkCompatiblePackReview {
  const rowsByCode = new Map<string, RowPreviewLike[]>();
  for (const row of rows) {
    const code = row.sourceItemCode?.trim();
    if (!code) continue;
    const group = rowsByCode.get(code) ?? [];
    group.push(row);
    rowsByCode.set(code, group);
  }

  const candidates: BulkCompatiblePackCandidate[] = [];
  const excludedGroups: BulkCompatiblePackExclusion[] = [];
  for (const [sourceItemCode, codeRows] of rowsByCode) {
    const eligible =
      codeRows.every(row =>
        row.rowIndex != null &&
        row.sourceCodeReliability === "stable" &&
        !row.heldForReview &&
        row.itemMatch.possibleRecode === true &&
        row.itemMatch.recodeEvidenceClass === "compatible_alternate" &&
        row.itemMatch.packCompatibility === "compatible" &&
        Boolean(row.itemMatch.possibleRecodeMatchedId),
      );
    const targetIds = new Set(codeRows.map(row => row.itemMatch.possibleRecodeMatchedId).filter(Boolean));
    const vendors = new Set(codeRows.map(row => row.supplierRaw?.trim() || "Vendor not provided"));
    const identityGroups = new Set(codeRows.map(row => row.identityGroupKey ?? ""));
    const sourcePacks = new Set(codeRows.map(row => packEvidenceSignature(row.itemMatch.sourcePackEvidence, row)));
    const candidatePacks = new Set(codeRows.map(row => packEvidenceSignature(row.itemMatch.candidatePackEvidence, row)));

    if (!eligible || targetIds.size !== 1 || vendors.size !== 1 || identityGroups.size !== 1 || sourcePacks.size !== 1 || candidatePacks.size !== 1) {
      excludedGroups.push(compatiblePackExclusion(sourceItemCode, codeRows));
      continue;
    }

    const firstRow = codeRows[0];
    const target = firstRow.itemMatch.possibleRecodeItem;
    if (!target) {
      excludedGroups.push({ sourceItemCode, rowIndexes: codeRows.map(row => row.rowIndex!), reason: "not_verified_compatible", reasonLabel: "target item details are unavailable" });
      continue;
    }
    candidates.push({
      sourceItemCode,
      targetInventoryItemId: Array.from(targetIds)[0]!,
      targetItemName: target.name,
      rowIndexes: codeRows.map(row => row.rowIndex!).sort((a, b) => a - b),
      sourceRowCount: codeRows.length,
      vendorName: firstRow.supplierRaw?.trim() || "Vendor not provided",
      sampleDescription: firstRow.cleanedDescription?.trim() || sourceItemCode,
      sourceNormalizedTotal: normalizedTotalLabel(firstRow.itemMatch.sourcePackEvidence),
      catalogNormalizedTotal: normalizedTotalLabel(firstRow.itemMatch.candidatePackEvidence),
    });
  }

  candidates.sort((left, right) => left.sourceItemCode.localeCompare(right.sourceItemCode));
  excludedGroups.sort((left, right) => left.sourceItemCode.localeCompare(right.sourceItemCode));
  return { candidates, excludedGroups };
}

/** Builds link_existing decisions for every source row in each eligible code group. */
export function buildBulkCompatiblePackDecisions(
  candidates: BulkCompatiblePackCandidate[],
): Array<{ rowIndex: number; action: "link_existing"; inventoryItemId: string }> {
  return candidates.flatMap(candidate =>
    candidate.rowIndexes.map(rowIndex => ({
      rowIndex,
      action: "link_existing" as const,
      inventoryItemId: candidate.targetInventoryItemId,
    })),
  );
}
