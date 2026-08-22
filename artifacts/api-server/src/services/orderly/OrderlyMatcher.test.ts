/**
 * Unit tests for OrderlyMatcher pure functions.
 * Covers the breakTieByLocation tiebreaker introduced to auto-resolve
 * ambiguous matches when one candidate has a known location assignment.
 */

import { describe, it, expect } from 'vitest';
import {
  breakTieByLocation,
  computeResolutionSummary,
  getHoldReason,
  type LocationAssignment,
  type MatchResult,
} from './OrderlyMatcher';

// ─── breakTieByLocation ───────────────────────────────────────────────────────

const ambiguousResult: MatchResult = {
  strategy: 'name_pack',
  confidence: 'ambiguous',
  matchedId: null,
  candidateIds: ['item-a', 'item-b', 'item-c'],
  requiresReview: true,
};

describe('breakTieByLocation', () => {
  it('returns null when locationId is null — cannot break tie without a location', () => {
    const assignments: LocationAssignment[] = [
      { inventoryItemId: 'item-a', locationId: 'loc-1' },
    ];
    expect(breakTieByLocation(ambiguousResult, null, assignments)).toBeNull();
  });

  it('returns null when locationId is undefined', () => {
    const assignments: LocationAssignment[] = [
      { inventoryItemId: 'item-a', locationId: 'loc-1' },
    ];
    expect(breakTieByLocation(ambiguousResult, undefined, assignments)).toBeNull();
  });

  it('is a no-op when the input result is not ambiguous', () => {
    const highResult: MatchResult = {
      strategy: 'name_pack',
      confidence: 'high',
      matchedId: 'item-a',
      candidateIds: [],
      requiresReview: false,
    };
    const assignments: LocationAssignment[] = [
      { inventoryItemId: 'item-a', locationId: 'loc-1' },
    ];
    expect(breakTieByLocation(highResult, 'loc-1', assignments)).toBeNull();
  });

  it('returns null when no candidates have an assignment for the given location', () => {
    const assignments: LocationAssignment[] = [
      { inventoryItemId: 'item-x', locationId: 'loc-1' }, // not a candidate
    ];
    expect(breakTieByLocation(ambiguousResult, 'loc-1', assignments)).toBeNull();
  });

  it('returns null when assignments exist for a different location', () => {
    const assignments: LocationAssignment[] = [
      { inventoryItemId: 'item-a', locationId: 'loc-99' }, // wrong location
    ];
    expect(breakTieByLocation(ambiguousResult, 'loc-1', assignments)).toBeNull();
  });

  it('promotes the unique matching candidate to high confidence', () => {
    const assignments: LocationAssignment[] = [
      { inventoryItemId: 'item-b', locationId: 'loc-1' },
      { inventoryItemId: 'item-x', locationId: 'loc-1' }, // not a candidate — ignored
    ];
    const result = breakTieByLocation(ambiguousResult, 'loc-1', assignments);
    expect(result).not.toBeNull();
    expect(result!.matchedId).toBe('item-b');
    expect(result!.confidence).toBe('high');
    expect(result!.strategy).toBe('location_history');
    expect(result!.requiresReview).toBe(false);
    expect(result!.candidateIds).toHaveLength(0);
  });

  it('returns null when two candidates both have the given location — stays ambiguous', () => {
    const assignments: LocationAssignment[] = [
      { inventoryItemId: 'item-a', locationId: 'loc-1' },
      { inventoryItemId: 'item-b', locationId: 'loc-1' },
    ];
    expect(breakTieByLocation(ambiguousResult, 'loc-1', assignments)).toBeNull();
  });

  it('correctly ignores non-candidate items when counting matches', () => {
    // item-a is a candidate; item-z is not — only item-a should count
    const assignments: LocationAssignment[] = [
      { inventoryItemId: 'item-z', locationId: 'loc-1' },
      { inventoryItemId: 'item-a', locationId: 'loc-1' },
    ];
    const result = breakTieByLocation(ambiguousResult, 'loc-1', assignments);
    expect(result).not.toBeNull();
    expect(result!.matchedId).toBe('item-a');
  });

  it('works with an empty assignments array — returns null', () => {
    expect(breakTieByLocation(ambiguousResult, 'loc-1', [])).toBeNull();
  });
});

describe('computeResolutionSummary — will-create vs held split', () => {
  const noVendor = { vendorId: null, isNew: false, confidence: 'none' as const, requiresReview: false };
  const noLocation = { locationId: null, isNew: false, normalizedName: '' };
  const match = (over: Partial<import('./OrderlyMatcher').MatchResult>) => ({
    strategy: 'none' as const, confidence: 'none' as const, matchedId: null,
    candidateIds: [], requiresReview: false, ...over,
  });
  const row = (itemMatch: any, itemCodeStatus: string) => ({
    rowIndex: 0, itemMatch, vendorMatch: noVendor, locationMatch: noLocation, itemCodeStatus,
  });

  it('coded unresolved rows count as will-create; blank-code unresolved rows are held', () => {
    const s = computeResolutionSummary([
      row(match({}), 'valid'),                                             // no match, coded → create
      row(match({ strategy: 'fuzzy', confidence: 'low', matchedId: 'i1', requiresReview: true }), 'valid'), // fuzzy → create
      row(match({ confidence: 'ambiguous', requiresReview: true }), 'valid'), // ambiguous → create
      row(match({}), 'blank'),                                              // blank, unresolved → held
      row(match({ strategy: 'item_code', confidence: 'high', matchedId: 'i2' }), 'valid'), // matched → neither
      row(match({ strategy: 'name_pack', confidence: 'medium', matchedId: 'i3' }), 'blank'), // blank but safely matched → neither
    ]);
    expect(s.itemsWillCreate).toBe(3);
    expect(s.itemsHeldForReview).toBe(1);
  });
});

describe('getHoldReason', () => {
  const unresolved = {
    strategy: 'none' as const,
    confidence: 'none' as const,
    matchedId: null,
    candidateIds: [],
    requiresReview: false,
  };

  it('holds only blank-code rows that cannot be safely resolved', () => {
    expect(getHoldReason('blank', unresolved)).toBe('blank_item_code');
    expect(getHoldReason('valid', unresolved)).toBeNull();
    expect(getHoldReason('blank', {
      ...unresolved,
      strategy: 'item_code',
      confidence: 'high',
      matchedId: 'item-1',
    })).toBeNull();
  });

  it('keeps a blank-code review match held instead of treating it as a create candidate', () => {
    expect(getHoldReason('blank', {
      ...unresolved,
      strategy: 'fuzzy',
      confidence: 'low',
      matchedId: 'item-1',
      requiresReview: true,
    })).toBe('blank_item_code');
  });
});

describe('computeResolutionSummary — reliable-code group semantics', () => {
  const noVendor = { vendorId: null, isNew: false, confidence: 'none' as const, requiresReview: false };
  const noLocation = { locationId: null, isNew: false, normalizedName: '' };
  const match = (over: Partial<MatchResult>) => ({
    strategy: 'none' as const, confidence: 'none' as const, matchedId: null,
    candidateIds: [], requiresReview: false, ...over,
  });
  const row = (itemMatch: any, itemCodeStatus: string, sourceItemCode: string | null = null) => ({
    rowIndex: 0, itemMatch, vendorMatch: noVendor, locationMatch: noLocation, itemCodeStatus, sourceItemCode,
  });

  it('a safe sibling match suppresses creation for the whole code group', () => {
    const s = computeResolutionSummary([
      row(match({}), 'valid', 'C1'), // unresolved but sibling safely matched
      row(match({ strategy: 'item_code', confidence: 'high', matchedId: 'i1' }), 'valid', 'C1'),
    ]);
    expect(s.itemsWillCreate).toBe(0);
    expect(s.itemsHeldForReview).toBe(0);
  });

  it('a wholly-unresolved code group counts one creation, not one per row', () => {
    const s = computeResolutionSummary([
      row(match({}), 'valid', 'C2'),
      row(match({ strategy: 'fuzzy', confidence: 'low', matchedId: 'i9', requiresReview: true }), 'valid', 'C2'),
      row(match({}), 'valid', 'C3'),
    ]);
    expect(s.itemsWillCreate).toBe(2); // C2 once + C3 once
  });
});
