import { describe, expect, it } from 'vitest';
import {
  conflictsWithOrdinaryCountDate,
  isOrdinaryManualCount,
  ordinaryCountDateLockKey,
  ordinaryCountStoreLockKey,
} from './ordinaryCountGuard';

const request = {
  companyId: 'company-1',
  storeId: 'store-1',
  countDate: '2026-08-31',
};

describe('ordinary count duplicate guard', () => {
  it('conflicts only with an ordinary full-store session for the same company, store, and UTC date', () => {
    const existing = {
      id: 'existing-count',
      companyId: 'company-1',
      storeId: 'store-1',
      countDate: '2026-08-31T00:00:00.000Z',
      isPowerSession: 0,
      isHistoricalImport: 0,
      sourceSystem: null,
      sourceBatchId: null,
    };
    expect(conflictsWithOrdinaryCountDate(existing, request)).toBe(true);
    expect(conflictsWithOrdinaryCountDate({ ...existing, storeId: 'store-2' }, request)).toBe(false);
    expect(conflictsWithOrdinaryCountDate({ ...existing, countDate: '2026-09-30' }, request)).toBe(false);
    expect(conflictsWithOrdinaryCountDate({ ...existing, isPowerSession: 1 }, request)).toBe(false);
    expect(conflictsWithOrdinaryCountDate({ ...existing, sourceSystem: 'ORDERLY' }, request)).toBe(false);
    expect(conflictsWithOrdinaryCountDate({ ...existing, sourceBatchId: 'batch' }, request)).toBe(false);
    expect(isOrdinaryManualCount(existing)).toBe(true);
    expect(isOrdinaryManualCount({ ...existing, isHistoricalImport: 1 })).toBe(false);
    expect(isOrdinaryManualCount({ ...existing, isPowerSession: 1 })).toBe(false);
  });

  it('uses one deterministic lock identity per company, store, and UTC day', () => {
    const key = ordinaryCountDateLockKey(request);
    expect(key).toBe(ordinaryCountDateLockKey({ ...request, countDate: '2026-08-31T19:30:00.000Z' }));
    expect(ordinaryCountDateLockKey({ ...request, storeId: 'store-2' })).not.toBe(key);
    expect(ordinaryCountDateLockKey({ ...request, companyId: 'company-2' })).not.toBe(key);
    expect(ordinaryCountDateLockKey({ ...request, countDate: '2026-09-01' })).not.toBe(key);
  });

  it('uses a store-scoped lock shared across all ordinary count dates', () => {
    const key = ordinaryCountStoreLockKey(request);
    expect(key).toBe(ordinaryCountStoreLockKey({ ...request, countDate: '2026-09-30' }));
    expect(ordinaryCountStoreLockKey({ ...request, storeId: 'store-2' })).not.toBe(key);
    expect(ordinaryCountStoreLockKey({ ...request, companyId: 'company-2' })).not.toBe(key);
  });

  it('treats an ordinary August draft as baseline-blocking even when today is a different date', () => {
    const augustDraft = {
      id: 'august-draft',
      companyId: 'company-1',
      storeId: 'store-1',
      countDate: '2026-08-31T00:00:00.000Z',
      isPowerSession: 0,
      isHistoricalImport: 0,
      sourceSystem: null,
      sourceBatchId: null,
    };
    expect(isOrdinaryManualCount(augustDraft)).toBe(true);
  });
});