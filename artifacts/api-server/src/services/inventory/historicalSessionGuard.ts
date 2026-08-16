/**
 * Historical import sessions are reference-only evidence.
 *
 * A historical snapshot reconstructs what a period looked like in a prior
 * system. It is not a live count: some of its value is carried by unresolved
 * source rows that never received a canonical inventory identity, so applying
 * it would push a partial picture onto live on-hand and silently understate
 * stock. Editing it would break the evidence hashes that make the snapshot
 * reproducible.
 *
 * Every mutation path — web and mobile, apply, edit, delete and clear — routes
 * through this guard so the rule cannot be enforced in one surface and missed
 * in another.
 */

export interface HistoricalGuardTarget {
  isHistoricalImport?: number | boolean | null;
}

export function isHistoricalImportSession(count: HistoricalGuardTarget | null | undefined): boolean {
  if (!count) return false;
  const flag = count.isHistoricalImport;
  return flag === 1 || flag === true;
}

export const HISTORICAL_SESSION_APPLY_ERROR =
  'This is a historical import snapshot and cannot be applied. Applying it would overwrite live on-hand ' +
  'quantities with a partial reconstruction — some of its value is held by source rows that have no ' +
  'inventory item.';

export const HISTORICAL_SESSION_EDIT_ERROR =
  'This is a historical import snapshot and is reference-only. Its lines cannot be edited, cleared or deleted.';

export const HISTORICAL_SESSION_DELETE_ERROR =
  'This is a historical import snapshot and is retained as evidence. It cannot be deleted.';

/**
 * Returns an error payload when the session is historical, otherwise null.
 * Callers respond with 403 — this is a property of the record, not of the user's
 * role, so no role can override it.
 */
export function historicalSessionBlock(
  count: HistoricalGuardTarget | null | undefined,
  action: 'apply' | 'edit' | 'delete',
): { error: string; code: 'HISTORICAL_IMPORT_SESSION' } | null {
  if (!isHistoricalImportSession(count)) return null;
  const error =
    action === 'apply'
      ? HISTORICAL_SESSION_APPLY_ERROR
      : action === 'delete'
        ? HISTORICAL_SESSION_DELETE_ERROR
        : HISTORICAL_SESSION_EDIT_ERROR;
  return { error, code: 'HISTORICAL_IMPORT_SESSION' };
}
