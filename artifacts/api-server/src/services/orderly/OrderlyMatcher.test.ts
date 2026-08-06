/**
 * Unit tests for OrderlyMatcher pure functions.
 * Covers the breakTieByLocation tiebreaker introduced to auto-resolve
 * ambiguous matches when one candidate has a known location assignment.
 */

import { describe, it, expect } from 'vitest';
import {
  breakTieByLocation,
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
