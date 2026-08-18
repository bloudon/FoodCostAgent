/**
 * OrderlyMatcher — pure (no DB) item / vendor / location matching logic.
 *
 * Four-strategy item match hierarchy (priority order):
 *   1. external_mapping — prior confirmed source-code → item link (handled in domain layer)
 *   2. item_code        — exact pluSku == sourceItemCode (only when itemCodeStatus is "valid")
 *   3. name_pack        — normalized description + caseQuantity match
 *   4. fuzzy            — word-overlap Jaccard ≥ 0.55, flagged ambiguous when multiple candidates
 *
 * All functions are pure and synchronous — no DB access.
 */

export type MatchStrategy = 'external_mapping' | 'item_code' | 'name_pack' | 'fuzzy' | 'location_history' | 'none';
export type MatchConfidence = 'high' | 'medium' | 'low' | 'ambiguous' | 'none';

export interface MatchResult {
  strategy: MatchStrategy;
  confidence: MatchConfidence;
  matchedId: string | null;
  /** Populated when confidence === 'ambiguous' — user must pick one. */
  candidateIds: string[];
  requiresReview: boolean;
  score?: number;
}

export interface MatchableItem {
  id: string;
  name: string;
  pluSku?: string | null;
  caseSize?: number | null;
}

export interface MatchableVendor {
  id: string;
  name: string;
}

// ─── String normalisation ────────────────────────────────────────────────────

/** Lower-case, collapse whitespace, strip non-alphanumeric except spaces. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokenise a normalised string into an array of words, filtering stop-words. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'at', 'to', 'for',
  'with', 'by', 'from', 'on', 'is', 'it', 'its',
]);

export function tokenize(s: string): Set<string> {
  return new Set(
    normalizeForMatch(s)
      .split(' ')
      .filter(t => t.length > 1 && !STOP_WORDS.has(t)),
  );
}

/** Jaccard similarity between two token sets. */
export function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  a.forEach(t => { if (b.has(t)) intersect++; });
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

// ─── Strategy 2: item code ───────────────────────────────────────────────────

/**
 * Exact match on pluSku == sourceItemCode.
 * Only run when itemCodeStatus === "valid" (non-blank, non-placeholder).
 * Returns 'none' if itemCodeStatus is blank/placeholder or no match found.
 */
export function matchByItemCode(
  sourceItemCode: string | null | undefined,
  itemCodeStatus: string | null | undefined,
  items: MatchableItem[],
): MatchResult {
  const noMatch: MatchResult = {
    strategy: 'none',
    confidence: 'none',
    matchedId: null,
    candidateIds: [],
    requiresReview: false,
  };

  if (!sourceItemCode || itemCodeStatus !== 'valid') return noMatch;

  const codeTrimmed = sourceItemCode.trim();
  if (!codeTrimmed) return noMatch;

  const matches = items.filter(
    it => it.pluSku && it.pluSku.trim() === codeTrimmed,
  );

  if (matches.length === 0) return noMatch;
  if (matches.length === 1) {
    return {
      strategy: 'item_code',
      confidence: 'high',
      matchedId: matches[0].id,
      candidateIds: [],
      requiresReview: false,
    };
  }
  // Multiple items with same pluSku — ambiguous
  return {
    strategy: 'item_code',
    confidence: 'ambiguous',
    matchedId: null,
    candidateIds: matches.map(it => it.id),
    requiresReview: true,
  };
}

// ─── Strategy 3: name + pack ─────────────────────────────────────────────────

/**
 * Normalised description match, optionally tightened by caseQuantity proximity (±10%).
 * Returns "high" when name normalizes exactly + caseSize within tolerance.
 * Returns "medium" when name normalizes exactly but pack is missing/mismatched.
 */
export function matchByNamePack(
  cleanedDescription: string | null | undefined,
  caseQuantity: number | null | undefined,
  items: MatchableItem[],
): MatchResult {
  const noMatch: MatchResult = {
    strategy: 'none',
    confidence: 'none',
    matchedId: null,
    candidateIds: [],
    requiresReview: false,
  };

  if (!cleanedDescription) return noMatch;

  const normalized = normalizeForMatch(cleanedDescription);
  if (!normalized) return noMatch;

  // Exact normalised name match
  const nameMatches = items.filter(
    it => normalizeForMatch(it.name) === normalized,
  );

  if (nameMatches.length === 0) return noMatch;

  if (nameMatches.length === 1) {
    const item = nameMatches[0];
    // Check pack size agreement
    if (caseQuantity != null && item.caseSize != null && item.caseSize > 0) {
      const ratio = caseQuantity / item.caseSize;
      const packOk = ratio >= 0.9 && ratio <= 1.1;
      return {
        strategy: 'name_pack',
        confidence: packOk ? 'high' : 'medium',
        matchedId: item.id,
        candidateIds: [],
        requiresReview: !packOk,
      };
    }
    // No pack info — medium confidence
    return {
      strategy: 'name_pack',
      confidence: 'medium',
      matchedId: item.id,
      candidateIds: [],
      requiresReview: false,
    };
  }

  // Multiple items with the same name — ambiguous
  return {
    strategy: 'name_pack',
    confidence: 'ambiguous',
    matchedId: null,
    candidateIds: nameMatches.map(it => it.id),
    requiresReview: true,
  };
}

// ─── Strategy 4: fuzzy ───────────────────────────────────────────────────────

const HIGH_FUZZY_THRESHOLD = 0.70;
const MED_FUZZY_THRESHOLD = 0.55;

/**
 * Word-overlap (Jaccard) fuzzy match.
 * Always sets requiresReview = true — used only when strategies 2 & 3 fail.
 */
export function matchByFuzzy(
  cleanedDescription: string | null | undefined,
  items: MatchableItem[],
): MatchResult {
  const noMatch: MatchResult = {
    strategy: 'none',
    confidence: 'none',
    matchedId: null,
    candidateIds: [],
    requiresReview: false,
  };

  if (!cleanedDescription) return noMatch;

  const tokens = tokenize(cleanedDescription);
  if (tokens.size === 0) return noMatch;

  type Scored = { id: string; score: number };
  const scored: Scored[] = items
    .map(it => ({ id: it.id, score: jaccardScore(tokens, tokenize(it.name)) }))
    .filter(it => it.score >= MED_FUZZY_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return noMatch;

  const top = scored[0];
  const topTier = scored.filter(s => s.score >= top.score - 0.05); // within 5% of top

  if (topTier.length > 1) {
    return {
      strategy: 'fuzzy',
      confidence: 'ambiguous',
      matchedId: null,
      candidateIds: topTier.slice(0, 5).map(s => s.id),
      requiresReview: true,
      score: top.score,
    };
  }

  return {
    strategy: 'fuzzy',
    confidence: top.score >= HIGH_FUZZY_THRESHOLD ? 'medium' : 'low',
    matchedId: top.id,
    candidateIds: [],
    requiresReview: true, // fuzzy always requires review
    score: top.score,
  };
}

// ─── Vendor matching ─────────────────────────────────────────────────────────

export interface VendorMatchResult {
  vendorId: string | null;
  isNew: boolean;
  confidence: MatchConfidence;
  requiresReview: boolean;
  /** Normalized supplier name — set for new vendors so summaries can count distinct vendors. */
  normalizedName?: string;
}

/**
 * Match a raw supplier name to an existing vendor.
 * Exact normalised name → high confidence.
 * Word-overlap ≥ 0.7 → medium confidence.
 */
export function matchVendor(
  supplierRaw: string | null | undefined,
  supplierStatus: string | null | undefined,
  vendors: MatchableVendor[],
): VendorMatchResult {
  if (!supplierRaw || supplierStatus === 'blank' || supplierStatus === 'placeholder') {
    return { vendorId: null, isNew: false, confidence: 'none', requiresReview: false };
  }

  const normalizedRaw = normalizeForMatch(supplierRaw);

  // Exact
  const exact = vendors.find(v => normalizeForMatch(v.name) === normalizedRaw);
  if (exact) {
    return { vendorId: exact.id, isNew: false, confidence: 'high', requiresReview: false };
  }

  // Fuzzy
  const tokensRaw = tokenize(supplierRaw);
  const scored = vendors
    .map(v => ({ id: v.id, score: jaccardScore(tokensRaw, tokenize(v.name)) }))
    .filter(v => v.score >= 0.7)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return {
      vendorId: scored[0].id,
      isNew: false,
      confidence: 'medium',
      requiresReview: true,
    };
  }

  // New vendor
  return { vendorId: null, isNew: true, confidence: 'none', requiresReview: false, normalizedName: normalizedRaw };
}

// ─── Location matching ───────────────────────────────────────────────────────

export interface LocationMatchResult {
  locationId: string | null;
  isNew: boolean;
  normalizedName: string;
}

export interface MatchableLocation {
  id: string;
  normalizedName: string;
}

/** Exact normalised name match only. New = will be created at approval time. */
export function matchLocation(
  storageLocationRaw: string | null | undefined,
  locations: MatchableLocation[],
): LocationMatchResult {
  if (!storageLocationRaw || !storageLocationRaw.trim()) {
    return { locationId: null, isNew: false, normalizedName: '' };
  }

  const normalized = normalizeForMatch(storageLocationRaw);
  const found = locations.find(l => l.normalizedName === normalized);

  if (found) {
    return { locationId: found.id, isNew: false, normalizedName: normalized };
  }

  return { locationId: null, isNew: true, normalizedName: normalized };
}

// ─── Location-history tiebreaker ─────────────────────────────────────────────

export interface LocationAssignment {
  inventoryItemId: string;
  locationId: string;
}

/**
 * When a match is ambiguous, check whether exactly one candidate has an
 * existing `inventory_item_location_assignments` row for the given locationId.
 *
 * - Exactly one candidate matches → return a new MatchResult with
 *   strategy='location_history', confidence='high', requiresReview=false.
 * - Zero or 2+ candidates match → return null (keep the ambiguous result).
 * - locationId is null/undefined or result is not ambiguous → return null.
 */
export function breakTieByLocation(
  ambiguousResult: MatchResult,
  locationId: string | null | undefined,
  assignments: LocationAssignment[],
): MatchResult | null {
  if (!locationId || ambiguousResult.confidence !== 'ambiguous') return null;

  const candidateSet = new Set(ambiguousResult.candidateIds);
  const matching = assignments.filter(
    a => a.locationId === locationId && candidateSet.has(a.inventoryItemId),
  );

  if (matching.length !== 1) return null;

  return {
    strategy: 'location_history',
    confidence: 'high',
    matchedId: matching[0].inventoryItemId,
    candidateIds: [],
    requiresReview: false,
  };
}

// ─── Combined row resolution ─────────────────────────────────────────────────

/** Full per-row resolution decision (item + vendor + location). */
export interface RowResolution {
  rowIndex: number;
  itemMatch: MatchResult;
  vendorMatch: VendorMatchResult;
  locationMatch: LocationMatchResult;
  /**
   * Staged row's item_code_status ("valid" | "blank" | ...). Approval never
   * creates items for blank-code rows — they are held unresolved — so the
   * summary needs this to report an honest "will be created" count.
   */
  itemCodeStatus?: string | null;
  /**
   * Staged row's source item code. Approval resolves all rows sharing a
   * reliable (valid) code as ONE identity — a single safe match links the
   * whole group, and a wholly-unresolved group creates exactly one item.
   */
  sourceItemCode?: string | null;
}

export interface ResolutionSummary {
  totalRows: number;
  itemsMatchedHigh: number;
  itemsMatchedMedium: number;
  itemsAmbiguous: number;
  itemsNew: number;
  itemsFuzzy: number;
  vendorsMatched: number;
  vendorsNew: number;
  locationsMatched: number;
  locationsNew: number;
  rowsRequiringReview: number;
  itemsResolvedByLocationHistory: number;
  /**
   * Unresolved rows with a usable item code — approval will actually insert
   * a new inventory item for these (absent a user override).
   */
  itemsWillCreate: number;
  /**
   * Unresolved blank-code rows — approval skips these; they are held for
   * later review and never create items.
   */
  itemsHeldForReview: number;
}

export function computeResolutionSummary(rows: RowResolution[]): ResolutionSummary {
  let itemsMatchedHigh = 0, itemsMatchedMedium = 0, itemsAmbiguous = 0, itemsNew = 0, itemsFuzzy = 0;
  // Vendors are counted as DISTINCT entities, not per-row occurrences — a
  // 5,000-row file typically involves only a few dozen vendors.
  const matchedVendorIds = new Set<string>();
  const newVendorNames = new Set<string>();
  const locationsSeen = new Map<string, boolean>(); // normalizedName → isNew
  let rowsRequiringReview = 0;
  let itemsResolvedByLocationHistory = 0;
  let itemsWillCreate = 0;
  let itemsHeldForReview = 0;

  // Approval treats all rows sharing a reliable (valid) item code as ONE
  // identity: any safe existing match links the whole group, and a wholly
  // unresolved group creates exactly one item. Mirror that here.
  const reliableGroupHasSafeMatch = new Map<string, boolean>();
  for (const row of rows) {
    if (row.itemCodeStatus !== 'valid') continue;
    const code = row.sourceItemCode?.trim();
    if (!code) continue;
    const safe = row.itemMatch.matchedId != null && !row.itemMatch.requiresReview;
    reliableGroupHasSafeMatch.set(code, (reliableGroupHasSafeMatch.get(code) ?? false) || safe);
  }
  const countedCreateCodes = new Set<string>();

  for (const row of rows) {
    const m = row.itemMatch;
    if (m.confidence === 'high') itemsMatchedHigh++;
    else if (m.confidence === 'medium') itemsMatchedMedium++;
    else if (m.confidence === 'ambiguous') itemsAmbiguous++;
    else if (m.strategy === 'fuzzy') itemsFuzzy++;
    else itemsNew++;

    if (m.strategy === 'location_history') itemsResolvedByLocationHistory++;

    if (m.requiresReview) rowsRequiringReview++;

    // Mirror approval behavior: a row without a confident, non-review match
    // creates a new item ONLY when it has a usable (non-blank) item code;
    // blank-code rows are held unresolved and never create items. Rows
    // sharing a reliable code resolve as one identity (see map above).
    const unresolved = m.matchedId == null || m.requiresReview;
    if (unresolved) {
      if (row.itemCodeStatus === 'blank') {
        itemsHeldForReview++;
      } else {
        const code = row.itemCodeStatus === 'valid' ? row.sourceItemCode?.trim() : null;
        if (code) {
          // Reliable-code group: create once per wholly-unresolved group;
          // create nothing when any sibling safely matched an existing item.
          if (!reliableGroupHasSafeMatch.get(code) && !countedCreateCodes.has(code)) {
            countedCreateCodes.add(code);
            itemsWillCreate++;
          }
        } else {
          itemsWillCreate++;
        }
      }
    }

    if (row.vendorMatch.isNew) newVendorNames.add(row.vendorMatch.normalizedName ?? '');
    else if (row.vendorMatch.vendorId) matchedVendorIds.add(row.vendorMatch.vendorId);

    if (row.locationMatch.normalizedName) {
      if (!locationsSeen.has(row.locationMatch.normalizedName)) {
        locationsSeen.set(row.locationMatch.normalizedName, row.locationMatch.isNew);
      }
    }
  }

  let locationsMatched = 0, locationsNew = 0;
  locationsSeen.forEach((isNew) => {
    if (isNew) locationsNew++;
    else locationsMatched++;
  });

  return {
    totalRows: rows.length,
    itemsMatchedHigh,
    itemsMatchedMedium,
    itemsAmbiguous,
    itemsNew,
    itemsFuzzy,
    vendorsMatched: matchedVendorIds.size,
    vendorsNew: newVendorNames.size,
    locationsMatched,
    locationsNew,
    rowsRequiringReview,
    itemsResolvedByLocationHistory,
    itemsWillCreate,
    itemsHeldForReview,
  };
}
