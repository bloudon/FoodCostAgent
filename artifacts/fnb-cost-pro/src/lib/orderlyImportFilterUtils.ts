/**
 * Pure filter-logic utilities for the Orderly resolution preview.
 *
 * Extracted here so they can be unit-tested without rendering the full
 * ResolutionPreviewStep component.
 */

export interface RowPreviewLike {
  sourceCategory: string | null;
  /** Server-derived from the same fail-closed rule used by approval. */
  heldForReview?: boolean;
  itemMatch: {
    strategy: string;
    confidence: string;
    possibleRecode?: boolean;
    recodeEvidenceClass?:
      | "compatible_alternate"
      | "new_pack_size"
      | "source_data_conflict"
      | "pack_evidence_missing"
      | "unreliable_code";
    possibleRecodeMatchedId?: string | null;
    possibleRecodeItem?: { id: string; name: string; pluSku?: string | null; caseSize?: number | null; knownLocations?: string[] } | null;
  };
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
