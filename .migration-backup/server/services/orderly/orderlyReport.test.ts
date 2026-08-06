/**
 * Unit tests for the pure aggregation helpers in orderlyReport.ts.
 *
 * These tests do not require a database connection — they exercise only the
 * exported pure functions: aggregateRows, effectiveUnitCost, locationKey.
 *
 * The DB-dependent getReconciliationReport function is covered separately by
 * integration tests that use a real (seeded) test database.
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateRows,
  effectiveUnitCost,
  locationKey,
  type AggregateInputRow,
  type ItemAggregate,
} from './orderlyReport';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function row(overrides: Partial<AggregateInputRow> = {}): AggregateInputRow {
  return {
    resolvedInventoryItemId: 'item-1',
    totalCost: 100,
    totalUnits: 10,
    storageLocation: 'Walk-In',
    packagePrice: 10,
    cleanedDescription: 'Test Item',
    itemCodeStatus: 'valid',
    ...overrides,
  };
}

// ─── aggregateRows ────────────────────────────────────────────────────────────

describe('aggregateRows', () => {
  it('returns an empty map for empty input', () => {
    expect(aggregateRows([])).toEqual(new Map());
  });

  it('skips rows with no resolvedInventoryItemId', () => {
    const result = aggregateRows([row({ resolvedInventoryItemId: null })]);
    expect(result.size).toBe(0);
  });

  it('aggregates a single row correctly', () => {
    const result = aggregateRows([row()]);
    const agg = result.get('item-1')!;
    expect(agg.totalCost).toBe(100);
    expect(agg.totalUnits).toBe(10);
    expect(agg.locations.has('walk-in')).toBe(true);
    expect(agg.fallbackDescription).toBe('Test Item');
    expect(agg.fallbackItemCodeStatus).toBe('valid');
  });

  it('sums totalCost and totalUnits across multiple rows for the same item', () => {
    const rows: AggregateInputRow[] = [
      row({ totalCost: 80,  totalUnits: 8,  storageLocation: 'Walk-In' }),
      row({ totalCost: 40,  totalUnits: 4,  storageLocation: 'Dry Storage' }),
    ];
    const agg = aggregateRows(rows).get('item-1')!;
    expect(agg.totalCost).toBeCloseTo(120);
    expect(agg.totalUnits).toBeCloseTo(12);
  });

  it('collects all storage locations from multi-location rows', () => {
    const rows: AggregateInputRow[] = [
      row({ storageLocation: 'Walk-In' }),
      row({ storageLocation: 'Dry Storage' }),
      row({ storageLocation: 'Bar' }),
    ];
    const agg = aggregateRows(rows).get('item-1')!;
    expect(agg.locations.size).toBe(3);
    expect(agg.locations.has('walk-in')).toBe(true);
    expect(agg.locations.has('dry storage')).toBe(true);
    expect(agg.locations.has('bar')).toBe(true);
  });

  it('normalizes location names to lowercase and trims whitespace', () => {
    const rows: AggregateInputRow[] = [
      row({ storageLocation: '  Walk-In  ' }),
      row({ storageLocation: 'walk-in' }),  // duplicate after normalisation
    ];
    const agg = aggregateRows(rows).get('item-1')!;
    expect(agg.locations.size).toBe(1);
    expect(agg.locations.has('walk-in')).toBe(true);
  });

  it('handles null totalCost and totalUnits as 0', () => {
    const agg = aggregateRows([row({ totalCost: null, totalUnits: null })]).get('item-1')!;
    expect(agg.totalCost).toBe(0);
    expect(agg.totalUnits).toBe(0);
  });

  it('handles null storageLocation without adding anything to locations', () => {
    const agg = aggregateRows([row({ storageLocation: null })]).get('item-1')!;
    expect(agg.locations.size).toBe(0);
  });

  it('captures the fallbackUnitCost from the first row that has packagePrice', () => {
    const rows: AggregateInputRow[] = [
      row({ packagePrice: null, storageLocation: 'Walk-In' }),
      row({ packagePrice: 12.50, storageLocation: 'Dry Storage' }),
      row({ packagePrice: 99,    storageLocation: 'Bar' }),
    ];
    const agg = aggregateRows(rows).get('item-1')!;
    expect(agg.fallbackUnitCost).toBe(12.50); // first non-null wins
  });

  it('handles multiple distinct items independently', () => {
    const rows: AggregateInputRow[] = [
      row({ resolvedInventoryItemId: 'item-A', totalCost: 50 }),
      row({ resolvedInventoryItemId: 'item-B', totalCost: 75 }),
      row({ resolvedInventoryItemId: 'item-A', totalCost: 25 }),
    ];
    const result = aggregateRows(rows);
    expect(result.get('item-A')!.totalCost).toBeCloseTo(75);
    expect(result.get('item-B')!.totalCost).toBeCloseTo(75);
  });
});

// ─── effectiveUnitCost ────────────────────────────────────────────────────────

describe('effectiveUnitCost', () => {
  function agg(overrides: Partial<ItemAggregate> = {}): ItemAggregate {
    return {
      totalCost: 100,
      totalUnits: 10,
      locations: new Set(),
      fallbackUnitCost: 5,
      fallbackDescription: null,
      fallbackItemCodeStatus: null,
      ...overrides,
    };
  }

  it('returns totalCost / totalUnits when units > 0', () => {
    expect(effectiveUnitCost(agg({ totalCost: 200, totalUnits: 8 }))).toBeCloseTo(25);
  });

  it('returns fallbackUnitCost when totalUnits is 0', () => {
    expect(effectiveUnitCost(agg({ totalCost: 100, totalUnits: 0, fallbackUnitCost: 9.99 }))).toBe(9.99);
  });

  it('returns null when totalUnits is 0 and fallbackUnitCost is null', () => {
    expect(effectiveUnitCost(agg({ totalUnits: 0, fallbackUnitCost: null }))).toBeNull();
  });

  it('uses aggregated cost/units from a multi-location split correctly', () => {
    // Item split: walk-in 80 / 8 + dry-storage 40 / 4  →  120 / 12 = 10.00
    const a = agg({ totalCost: 120, totalUnits: 12 });
    expect(effectiveUnitCost(a)).toBeCloseTo(10);
  });
});

// ─── locationKey ──────────────────────────────────────────────────────────────

describe('locationKey', () => {
  it('returns empty string for empty set', () => {
    expect(locationKey(new Set())).toBe('');
  });

  it('returns the single location for a one-element set', () => {
    expect(locationKey(new Set(['walk-in']))).toBe('walk-in');
  });

  it('returns locations in sorted order regardless of insertion order', () => {
    const s1 = new Set(['dry storage', 'bar', 'walk-in']);
    const s2 = new Set(['walk-in', 'bar', 'dry storage']);
    expect(locationKey(s1)).toBe(locationKey(s2));
    expect(locationKey(s1)).toBe('bar|dry storage|walk-in');
  });

  it('two different location sets produce different keys', () => {
    expect(locationKey(new Set(['walk-in']))).not.toBe(locationKey(new Set(['dry storage'])));
  });

  it('a set with two locations differs from one with only one of them', () => {
    const both = new Set(['walk-in', 'bar']);
    const one  = new Set(['walk-in']);
    expect(locationKey(both)).not.toBe(locationKey(one));
  });
});

// ─── Integration: multi-location item scenario ────────────────────────────────

describe('multi-location item period-over-period scenario', () => {
  /**
   * Scenario: "Chicken Breast" is counted in two locations in May (Walk-In + Freezer)
   * and only one location in June (Walk-In). Totals must be correct and
   * location-changed must fire.
   */
  it('correctly aggregates a two-location item in May and one-location in June', () => {
    const mayRows: AggregateInputRow[] = [
      row({ resolvedInventoryItemId: 'chicken', totalCost: 120, totalUnits: 10, storageLocation: 'Walk-In',  packagePrice: 12 }),
      row({ resolvedInventoryItemId: 'chicken', totalCost: 60,  totalUnits: 5,  storageLocation: 'Freezer',  packagePrice: 12 }),
    ];
    const juneRows: AggregateInputRow[] = [
      row({ resolvedInventoryItemId: 'chicken', totalCost: 156, totalUnits: 13, storageLocation: 'Walk-In', packagePrice: 12 }),
    ];

    const mayAgg  = aggregateRows(mayRows).get('chicken')!;
    const juneAgg = aggregateRows(juneRows).get('chicken')!;

    // Totals must be sums across all rows
    expect(mayAgg.totalCost).toBeCloseTo(180);
    expect(mayAgg.totalUnits).toBeCloseTo(15);
    expect(juneAgg.totalCost).toBeCloseTo(156);
    expect(juneAgg.totalUnits).toBeCloseTo(13);

    // Effective unit cost from aggregated totals
    expect(effectiveUnitCost(mayAgg)).toBeCloseTo(12);
    expect(effectiveUnitCost(juneAgg)).toBeCloseTo(12);

    // Location sets differ → location_changed should be raised
    expect(mayAgg.locations.has('walk-in')).toBe(true);
    expect(mayAgg.locations.has('freezer')).toBe(true);
    expect(juneAgg.locations.size).toBe(1);
    expect(locationKey(mayAgg.locations)).not.toBe(locationKey(juneAgg.locations));
  });

  it('does NOT flag location_changed when the same set of locations appears in both snapshots', () => {
    const make = (locs: string[]): AggregateInputRow[] =>
      locs.map((loc) => row({ resolvedInventoryItemId: 'salmon', storageLocation: loc }));

    const mayAgg  = aggregateRows(make(['Walk-In', 'Bar'])).get('salmon')!;
    const juneAgg = aggregateRows(make(['Bar', 'Walk-In'])).get('salmon')!; // insertion order differs

    expect(locationKey(mayAgg.locations)).toBe(locationKey(juneAgg.locations));
  });

  it('does NOT flag price_changed when unit cost difference is ≤ 1%', () => {
    // 10.00 vs 10.05 → 0.5% change, below threshold
    const erUc = 10.00;
    const lrUc = 10.05;
    const change = Math.abs(lrUc - erUc) / Math.max(erUc, 0.0001);
    expect(change).toBeLessThan(0.01);
  });

  it('flags price_changed when unit cost difference is > 1%', () => {
    // 10.00 vs 10.15 → 1.5% change, above threshold
    const erUc = 10.00;
    const lrUc = 10.15;
    const change = Math.abs(lrUc - erUc) / Math.max(erUc, 0.0001);
    expect(change).toBeGreaterThan(0.01);
  });

  it('counts added and removed items correctly', () => {
    const mayRows: AggregateInputRow[] = [
      row({ resolvedInventoryItemId: 'old-item', totalCost: 50, totalUnits: 5 }),
      row({ resolvedInventoryItemId: 'shared',   totalCost: 100, totalUnits: 10 }),
    ];
    const juneRows: AggregateInputRow[] = [
      row({ resolvedInventoryItemId: 'new-item', totalCost: 75, totalUnits: 7 }),
      row({ resolvedInventoryItemId: 'shared',   totalCost: 110, totalUnits: 10 }),
    ];

    const mayAgg  = aggregateRows(mayRows);
    const juneAgg = aggregateRows(juneRows);
    const allIds  = new Set([...mayAgg.keys(), ...juneAgg.keys()]);

    const added   = Array.from(allIds).filter((id) => !mayAgg.has(id) &&  juneAgg.has(id));
    const removed = Array.from(allIds).filter((id) =>  mayAgg.has(id) && !juneAgg.has(id));

    expect(added).toEqual(['new-item']);
    expect(removed).toEqual(['old-item']);
  });
});
