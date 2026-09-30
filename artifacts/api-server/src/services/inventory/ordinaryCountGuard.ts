export interface OrdinaryCountCandidate {
  id: string;
  companyId: string;
  storeId: string;
  countDate: Date | string;
  isPowerSession: number;
  isHistoricalImport: number;
  sourceSystem: string | null;
  sourceBatchId?: string | null;
}

export function ordinaryCountDateLockKey(requested: {
  companyId: string;
  storeId: string;
  countDate: Date | string;
}): string {
  const date = new Date(requested.countDate);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid count date for ordinary count lock');
  }
  return `ordinary-count-create:${JSON.stringify([
    requested.companyId,
    requested.storeId,
    date.toISOString().slice(0, 10),
  ])}`;
}

export function ordinaryCountStoreLockKey(requested: {
  companyId: string;
  storeId: string;
}): string {
  return `ordinary-count-store-create:${JSON.stringify([
    requested.companyId,
    requested.storeId,
  ])}`;
}

export function isOrdinaryManualCount(existing: OrdinaryCountCandidate): boolean {
  return existing.isPowerSession === 0 &&
    existing.isHistoricalImport === 0 &&
    existing.sourceSystem == null &&
    existing.sourceBatchId == null;
}

export function conflictsWithOrdinaryCountDate(
  existing: OrdinaryCountCandidate,
  requested: { companyId: string; storeId: string; countDate: Date | string; isPowerSession?: number },
): boolean {
  if (requested.isPowerSession === 1) return false;
  const existingDate = new Date(existing.countDate);
  const requestedDate = new Date(requested.countDate);
  return existing.companyId === requested.companyId &&
    existing.storeId === requested.storeId &&
    isOrdinaryManualCount(existing) &&
    Number.isFinite(existingDate.getTime()) &&
    Number.isFinite(requestedDate.getTime()) &&
    existingDate.toISOString().slice(0, 10) === requestedDate.toISOString().slice(0, 10);
}