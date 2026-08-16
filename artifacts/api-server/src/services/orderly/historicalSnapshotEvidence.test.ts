/**
 * Unit regressions for the historical-snapshot evidence primitives.
 *
 * These cover the pure decisions that decide whether a snapshot reconciles:
 * how source valuation is read, how evidence drift is detected, and how the two
 * valuation halves combine. The DB-backed test covers the persistence path.
 */
import { describe, expect, it } from 'vitest';
import {
  authoritativeSourceValue,
  hasUsableCountGeometry,
  reconcileHistoricalSnapshot,
  sourceEvidenceHash,
} from './orderlyCountSession';
import {
  HISTORICAL_SESSION_APPLY_ERROR,
  historicalSessionBlock,
  isHistoricalImportSession,
} from '../inventory/historicalSessionGuard';

function row(rawData: unknown, id = 'row-1', batchId = 'batch-1') {
  return { id, batchId, rawData } as any;
}

describe('authoritativeSourceValue', () => {
  it('reads the raw source cell rather than the parsed convenience column', () => {
    expect(authoritativeSourceValue(row({ 'Total Cost': '$1,234.56', totalCost: 0 }))).toBe(1234.56);
  });

  it('accepts numeric cells', () => {
    expect(authoritativeSourceValue(row({ 'Total Cost': 42.5 }))).toBe(42.5);
  });

  it('reads parenthesised negatives as negative', () => {
    expect(authoritativeSourceValue(row({ 'Total Cost': '($25.00)' }))).toBe(-25);
  });

  it('keeps a genuine zero as zero', () => {
    expect(authoritativeSourceValue(row({ 'Total Cost': '$0.00' }))).toBe(0);
  });

  it('fails instead of coercing a missing value to zero', () => {
    expect(() => authoritativeSourceValue(row({}))).toThrow(/missing authoritative Total Cost/);
    expect(() => authoritativeSourceValue(row({ 'Total Cost': '   ' }))).toThrow(/missing authoritative Total Cost/);
    expect(() => authoritativeSourceValue(row({ 'Total Cost': null }))).toThrow(/missing authoritative Total Cost/);
  });

  it('fails instead of coercing a malformed value to zero', () => {
    expect(() => authoritativeSourceValue(row({ 'Total Cost': 'n/a' }))).toThrow(/malformed authoritative Total Cost/);
  });
});

describe('sourceEvidenceHash', () => {
  it('is stable for identical evidence', () => {
    const a = sourceEvidenceHash(row({ 'Total Cost': '$10.00', code: 'X' }));
    const b = sourceEvidenceHash(row({ 'Total Cost': '$10.00', code: 'X' }));
    expect(a).toBe(b);
  });

  it('changes when the source evidence changes', () => {
    const before = sourceEvidenceHash(row({ 'Total Cost': '$10.00' }));
    const after = sourceEvidenceHash(row({ 'Total Cost': '$11.00' }));
    expect(after).not.toBe(before);
  });

  it('distinguishes the same payload on a different row or batch', () => {
    const base = sourceEvidenceHash(row({ 'Total Cost': '$10.00' }));
    expect(sourceEvidenceHash(row({ 'Total Cost': '$10.00' }, 'row-2'))).not.toBe(base);
    expect(sourceEvidenceHash(row({ 'Total Cost': '$10.00' }, 'row-1', 'batch-2'))).not.toBe(base);
  });
});

describe('hasUsableCountGeometry', () => {
  it('accepts any positive tier or total', () => {
    expect(hasUsableCountGeometry({ totalUnits: 3, count1: null, count2: null, count3: null } as any)).toBe(true);
    expect(hasUsableCountGeometry({ totalUnits: 0, count1: 0, count2: 2, count3: 0 } as any)).toBe(true);
  });

  it('rejects rows with no counted quantity anywhere', () => {
    expect(hasUsableCountGeometry({ totalUnits: 0, count1: 0, count2: 0, count3: null } as any)).toBe(false);
  });
});

describe('reconcileHistoricalSnapshot', () => {
  it('reconciles the May population to zero delta', () => {
    const result = reconcileHistoricalSnapshot({
      sourceTotal: 254286.67,
      resolvedTotal: 189649.9,
      unresolvedTotal: 64636.77,
      tolerance: 0.005,
    });
    expect(result.resolvedTotal).toBe(189649.9);
    expect(result.unresolvedTotal).toBe(64636.77);
    expect(result.historicalSnapshotTotal).toBe(254286.67);
    expect(result.delta).toBe(0);
    expect(result.deltaPct).toBe(0);
    expect(result.exceedsTolerance).toBe(false);
  });

  it('reports the shortfall when unresolved value is dropped', () => {
    // The old behaviour: comparing only the resolved half against the source.
    const result = reconcileHistoricalSnapshot({
      sourceTotal: 254286.67,
      resolvedTotal: 189649.9,
      unresolvedTotal: 0,
      tolerance: 0.005,
    });
    expect(result.delta).toBe(64636.77);
    expect(result.exceedsTolerance).toBe(true);
  });

  it('has no opinion when the source total is unknown', () => {
    const result = reconcileHistoricalSnapshot({
      sourceTotal: null,
      resolvedTotal: 10,
      unresolvedTotal: 5,
      tolerance: 0.005,
    });
    expect(result.historicalSnapshotTotal).toBe(15);
    expect(result.delta).toBeNull();
    expect(result.exceedsTolerance).toBe(false);
  });
});

describe('historicalSessionGuard', () => {
  it('recognises the historical flag in both stored forms', () => {
    expect(isHistoricalImportSession({ isHistoricalImport: 1 })).toBe(true);
    expect(isHistoricalImportSession({ isHistoricalImport: true })).toBe(true);
    expect(isHistoricalImportSession({ isHistoricalImport: 0 })).toBe(false);
    expect(isHistoricalImportSession({})).toBe(false);
    expect(isHistoricalImportSession(null)).toBe(false);
  });

  it('blocks apply, edit and delete on a historical session', () => {
    const session = { isHistoricalImport: 1 };
    expect(historicalSessionBlock(session, 'apply')).toEqual({
      error: HISTORICAL_SESSION_APPLY_ERROR,
      code: 'HISTORICAL_IMPORT_SESSION',
    });
    expect(historicalSessionBlock(session, 'edit')?.code).toBe('HISTORICAL_IMPORT_SESSION');
    expect(historicalSessionBlock(session, 'delete')?.code).toBe('HISTORICAL_IMPORT_SESSION');
  });

  it('leaves ordinary sessions alone', () => {
    expect(historicalSessionBlock({ isHistoricalImport: 0 }, 'apply')).toBeNull();
    expect(historicalSessionBlock({}, 'edit')).toBeNull();
  });
});
