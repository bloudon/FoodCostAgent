export type ComparableInventoryCount = {
  id: string;
  companyId: string;
  storeId: string;
  countDate: Date | string;
  countedAt: Date | string;
  applied: number | boolean | null;
  isHistoricalImport?: number | boolean | null;
};

export type ComparableCountLine = {
  id?: string;
  inventoryItemId: string;
  storageLocationId: string;
  qty: number;
  [key: string]: unknown;
};

export type InventoryLocationIdentity = {
  id: string;
  name: string;
};

export type PriorZeroEvidence = {
  inventoryItemId: string;
  storageLocationName: string;
};

export type PriorSourceRow = {
  inventoryItemId: string | null;
  storageLocationName: string | null;
  totalUnits: number | null;
};

export type PreviousCountReconciliationDiagnostics = {
  currentLineCount: number;
  currentDistinctItemCount: number;
  previousLineCount: number;
  matchedPositiveLines: number;
  matchedZeroLines: number;
  matchedSourceZeroLines: number;
  absentPreviousItemLines: number;
  locationUnmatchedLines: number;
  ambiguousLocationLines: number;
};

function timestamp(value: Date | string): number {
  return new Date(value).getTime();
}

/**
 * Returns the immediately preceding applied count from an already company/store
 * scoped population. Same-day sessions are ordered by creation time, then ID.
 */
export function selectPreviousEligibleCount<T extends ComparableInventoryCount>(
  currentCount: T,
  counts: T[],
): T | null {
  const currentDate = timestamp(currentCount.countDate);
  const currentCreated = timestamp(currentCount.countedAt);

  return counts
    .filter((candidate) => {
      const isEligibleBaseline =
        Number(candidate.applied) === 1 ||
        Number(candidate.isHistoricalImport) === 1;
      if (candidate.id === currentCount.id || !isEligibleBaseline) {
        return false;
      }
      if (
        candidate.companyId !== currentCount.companyId ||
        candidate.storeId !== currentCount.storeId
      ) {
        return false;
      }
      const candidateDate = timestamp(candidate.countDate);
      if (candidateDate < currentDate) return true;
      return (
        candidateDate === currentDate &&
        timestamp(candidate.countedAt) < currentCreated
      );
    })
    .sort((a, b) => {
      const dateDifference = timestamp(b.countDate) - timestamp(a.countDate);
      if (dateDifference !== 0) return dateDifference;
      const createdDifference = timestamp(b.countedAt) - timestamp(a.countedAt);
      if (createdDifference !== 0) return createdDifference;
      return b.id.localeCompare(a.id);
    })[0] ?? null;
}

// Retained for callers outside this module while the broader count API migrates
// to the more accurate "eligible baseline" terminology.
export const selectPreviousAppliedCount = selectPreviousEligibleCount;

export function normalizeCountLocationName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

export function derivePriorZeroEvidence(
  sourceRows: PriorSourceRow[],
): PriorZeroEvidence[] {
  const sourcePairs = new Map<
    string,
    PriorZeroEvidence & { hasNonZeroQuantity: boolean }
  >();

  for (const row of sourceRows) {
    if (!row.inventoryItemId || !row.storageLocationName?.trim()) continue;
    const storageLocationName = normalizeCountLocationName(row.storageLocationName);
    const key = `${row.inventoryItemId}\u0000${storageLocationName}`;
    const totalUnits = Number(row.totalUnits);
    const hasNonZeroQuantity =
      row.totalUnits == null || !Number.isFinite(totalUnits) || totalUnits !== 0;
    const existing = sourcePairs.get(key);
    if (existing) {
      existing.hasNonZeroQuantity ||= hasNonZeroQuantity;
    } else {
      sourcePairs.set(key, {
        inventoryItemId: row.inventoryItemId,
        storageLocationName,
        hasNonZeroQuantity,
      });
    }
  }

  return Array.from(sourcePairs.values())
    .filter((row) => !row.hasNonZeroQuantity)
    .map(({ inventoryItemId, storageLocationName }) => ({
      inventoryItemId,
      storageLocationName,
    }));
}

export function reconcilePreviousCountLines<T extends ComparableCountLine>(
  previousLines: T[],
  currentLines: ComparableCountLine[],
  locations: InventoryLocationIdentity[],
  priorZeroEvidence: PriorZeroEvidence[] = [],
): {
  lines: T[];
  diagnostics: PreviousCountReconciliationDiagnostics;
  unmatchedLineIds: string[];
} {
  const namesById = new Map<string, Set<string>>();
  for (const location of locations) {
    const names = namesById.get(location.id) ?? new Set<string>();
    names.add(normalizeCountLocationName(location.name));
    namesById.set(location.id, names);
  }

  const currentLocationIds = new Set(currentLines.map((line) => line.storageLocationId));
  const currentIdsByName = new Map<string, Set<string>>();
  for (const id of currentLocationIds) {
    const names = namesById.get(id);
    if (!names || names.size !== 1) continue;
    const [name] = names;
    const ids = currentIdsByName.get(name) ?? new Set<string>();
    ids.add(id);
    currentIdsByName.set(name, ids);
  }

  const currentKeys = new Set(
    currentLines.map((line) => `${line.inventoryItemId}\u0000${line.storageLocationId}`),
  );
  const previousItems = new Set([
    ...previousLines.map((line) => line.inventoryItemId),
    ...priorZeroEvidence.map((line) => line.inventoryItemId),
  ]);
  const candidateByTarget = new Map<string, T[]>();
  const ambiguousItems = new Set<string>();

  for (const line of previousLines) {
    let targetLocationId: string | null = null;
    const directKey = `${line.inventoryItemId}\u0000${line.storageLocationId}`;
    if (currentKeys.has(directKey)) {
      targetLocationId = line.storageLocationId;
    } else {
      const sourceNames = namesById.get(line.storageLocationId);
      if (!sourceNames || sourceNames.size !== 1) {
        ambiguousItems.add(line.inventoryItemId);
        continue;
      }
      const [sourceName] = sourceNames;
      const targetIds = currentIdsByName.get(sourceName);
      if (!targetIds || targetIds.size !== 1) {
        if (targetIds && targetIds.size > 1) ambiguousItems.add(line.inventoryItemId);
        continue;
      }
      const [candidateLocationId] = targetIds;
      const candidateKey = `${line.inventoryItemId}\u0000${candidateLocationId}`;
      if (!currentKeys.has(candidateKey)) continue;
      targetLocationId = candidateLocationId;
    }

    const targetKey = `${line.inventoryItemId}\u0000${targetLocationId}`;
    const candidates = candidateByTarget.get(targetKey) ?? [];
    candidates.push(line);
    candidateByTarget.set(targetKey, candidates);
  }

  const reconciledByTarget = new Map<string, T>();
  for (const [targetKey, candidates] of candidateByTarget) {
    if (candidates.length !== 1) {
      ambiguousItems.add(candidates[0].inventoryItemId);
      continue;
    }
    const targetLocationId = targetKey.split("\u0000")[1];
    reconciledByTarget.set(targetKey, {
      ...candidates[0],
      sourceStorageLocationId: candidates[0].storageLocationId,
      storageLocationId: targetLocationId,
    });
  }

  // Approved historical snapshots intentionally materialize only positive
  // item/location rows. Their immutable import batch still carries exact zero
  // rows. Use that evidence for diagnostics only: do not synthesize or rewrite
  // historical count lines, and never override an actual/ambiguous prior line.
  const sourceZeroTargets = new Set<string>();
  const seenSourceEvidence = new Set<string>();
  for (const evidence of priorZeroEvidence) {
    const sourceName = normalizeCountLocationName(evidence.storageLocationName);
    const sourceKey = `${evidence.inventoryItemId}\u0000${sourceName}`;
    if (seenSourceEvidence.has(sourceKey)) continue;
    seenSourceEvidence.add(sourceKey);

    const targetIds = currentIdsByName.get(sourceName);
    if (!targetIds || targetIds.size !== 1) continue;
    const [targetLocationId] = targetIds;
    const targetKey = `${evidence.inventoryItemId}\u0000${targetLocationId}`;
    if (!currentKeys.has(targetKey)) continue;
    if (candidateByTarget.has(targetKey)) continue;
    sourceZeroTargets.add(targetKey);
  }

  let matchedPositiveLines = 0;
  let matchedZeroLines = 0;
  let matchedSourceZeroLines = 0;
  let absentPreviousItemLines = 0;
  let locationUnmatchedLines = 0;
  let ambiguousLocationLines = 0;
  const unmatchedLineIds: string[] = [];

  for (const line of currentLines) {
    const key = `${line.inventoryItemId}\u0000${line.storageLocationId}`;
    const previous = reconciledByTarget.get(key);
    if (previous) {
      if (Number(previous.qty) > 0) matchedPositiveLines++;
      else matchedZeroLines++;
    } else if (sourceZeroTargets.has(key)) {
      matchedZeroLines++;
      matchedSourceZeroLines++;
    } else if (!previousItems.has(line.inventoryItemId)) {
      absentPreviousItemLines++;
    } else {
      locationUnmatchedLines++;
      if (line.id) unmatchedLineIds.push(line.id);
      if (ambiguousItems.has(line.inventoryItemId)) ambiguousLocationLines++;
    }
  }

  return {
    lines: Array.from(reconciledByTarget.values()),
    unmatchedLineIds,
    diagnostics: {
      currentLineCount: currentLines.length,
      currentDistinctItemCount: new Set(
        currentLines.map((line) => line.inventoryItemId),
      ).size,
      previousLineCount: previousLines.length,
      matchedPositiveLines,
      matchedZeroLines,
      matchedSourceZeroLines,
      absentPreviousItemLines,
      locationUnmatchedLines,
      ambiguousLocationLines,
    },
  };
}