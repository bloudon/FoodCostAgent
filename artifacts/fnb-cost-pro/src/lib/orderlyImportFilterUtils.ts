/**
 * Pure filter-logic utilities for the Orderly resolution preview.
 *
 * Extracted here so they can be unit-tested without rendering the full
 * ResolutionPreviewStep component.
 */

export interface RowPreviewLike {
  sourceCategory: string | null;
  itemCodeStatus?: string | null;
  itemMatch: {
    strategy: string;
    confidence: string;
    matchedId?: string | null;
    requiresReview?: boolean;
    possibleRecode?: boolean;
    possibleRecodeMatchedId?: string | null;
    possibleRecodeItem?: { id: string; name: string; pluSku?: string | null; caseSize?: number | null; knownLocations?: string[] } | null;
  };
}

/**
 * A held row is unresolved and has no source Item Code to use as a safe
 * identity. Blank-code rows that already have a safe match are not held.
 */
export function isHeldForReview(row: RowPreviewLike): boolean {
  const unresolved = row.itemMatch.matchedId == null || row.itemMatch.requiresReview === true;
  return row.itemCodeStatus === "blank" && unresolved;
}

/**
 * Returns the canonical confidence key used by both the filter chips and the
 * filteredRows predicate.  Mirrors the `confidenceBadge` display logic.
 *
 * "recode" takes priority — a row flagged as a possible re-code is shown
 * exclusively under the "Re-code" filter chip, not under "Likely" or "New".
 */
export function rowConfidenceKey(row: RowPreviewLike): string {
  if (isHeldForReview(row)) return "held";
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
