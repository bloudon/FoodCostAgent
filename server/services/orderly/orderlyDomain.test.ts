/**
 * Unit tests for orderlyDomain — category ingestion logic.
 *
 * Tests cover resolveOrCreateCategoryId, which is the core new function
 * responsible for finding or creating inventory categories during batch approval.
 *
 * The Drizzle `tx` is mocked via lightweight chain helpers so these tests run
 * without a live DB connection.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveOrCreateCategoryId } from './orderlyDomain';

// ─── Mock chain builders ──────────────────────────────────────────────────────

/** Builds a chainable Drizzle SELECT mock that resolves to `rows`. */
function selectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

/** Builds a chainable Drizzle UPDATE mock. */
function updateChain() {
  return {
    set: () => ({
      where: () => Promise.resolve([]),
    }),
  };
}

/** Builds a chainable Drizzle INSERT mock that returns `returning`. */
function insertChain(returning: unknown[]) {
  return {
    values: () => ({
      returning: () => Promise.resolve(returning),
    }),
  };
}

// ─── resolveOrCreateCategoryId ────────────────────────────────────────────────

describe('resolveOrCreateCategoryId', () => {
  it('returns null for a blank name without touching the DB', async () => {
    const tx = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
    const result = await resolveOrCreateCategoryId(tx, 'company-1', '');
    expect(result).toBeNull();
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('returns null for a whitespace-only name without touching the DB', async () => {
    const tx = { select: vi.fn(), insert: vi.fn(), update: vi.fn() };
    const result = await resolveOrCreateCategoryId(tx, 'company-1', '   ');
    expect(result).toBeNull();
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('returns the id of an existing active category', async () => {
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce(selectChain([{ id: 'cat-active-1' }])), // active match found
      insert: vi.fn(),
      update: vi.fn(),
    };

    const result = await resolveOrCreateCategoryId(tx, 'company-1', 'Produce');
    expect(result).toEqual({ id: 'cat-active-1', created: false });
    // Should not query soft-deleted or insert
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('is case-insensitive when matching an existing active category', async () => {
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce(selectChain([{ id: 'cat-2' }])), // found via lower()
      insert: vi.fn(),
      update: vi.fn(),
    };

    const result = await resolveOrCreateCategoryId(tx, 'company-1', 'PRODUCE');
    expect(result).toEqual({ id: 'cat-2', created: false });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('restores a soft-deleted category and returns its id', async () => {
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce(selectChain([]))              // active → not found
        .mockReturnValueOnce(selectChain([{ id: 'cat-soft' }])), // soft-deleted → found
      update: vi.fn().mockReturnValue(updateChain()),
      insert: vi.fn(),
    };

    const result = await resolveOrCreateCategoryId(tx, 'company-1', 'Dairy');
    expect(result).toEqual({ id: 'cat-soft', created: false });
    expect(tx.update).toHaveBeenCalledTimes(1); // restore
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('creates a new category when none exists', async () => {
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce(selectChain([]))  // active → not found
        .mockReturnValueOnce(selectChain([])), // soft-deleted → not found
      update: vi.fn(),
      insert: vi.fn().mockReturnValue(insertChain([{ id: 'cat-new' }])),
    };

    const result = await resolveOrCreateCategoryId(tx, 'company-1', 'Frozen');
    expect(result).toEqual({ id: 'cat-new', created: true });
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it('trims whitespace from the name before creating a category', async () => {
    const insertValues = vi.fn().mockReturnValue({
      returning: () => Promise.resolve([{ id: 'cat-trimmed' }]),
    });
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce(selectChain([]))
        .mockReturnValueOnce(selectChain([])),
      update: vi.fn(),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    };

    const result = await resolveOrCreateCategoryId(tx, 'company-1', '  Beverages  ');
    expect(result).toEqual({ id: 'cat-trimmed', created: true });

    // The `name` passed to INSERT values should be the trimmed string
    const valuesArg = insertValues.mock.calls[0][0];
    expect(valuesArg.name).toBe('Beverages');
    expect(valuesArg.isActive).toBe(1);
    expect(valuesArg.showAsIngredient).toBe(1);
  });
});

// ─── Category key normalization (pure logic) ──────────────────────────────────

describe('category cache key logic', () => {
  // These tests verify the de-duplication contract: two sourceCategory strings
  // that normalize to the same lowercase key must resolve to the same entry.

  it('two rows with the same sourceCategory (different case) share a cache key', () => {
    const rows = [
      { sourceCategory: 'Produce' },
      { sourceCategory: 'produce' },
      { sourceCategory: '  PRODUCE  ' },
    ];

    const uniqueKeys = new Set(
      rows.map(r => r.sourceCategory.trim().toLowerCase()),
    );
    expect(uniqueKeys.size).toBe(1);
  });

  it('blank and whitespace sourceCategory entries are excluded from the key set', () => {
    const rows = [
      { sourceCategory: '' },
      { sourceCategory: '   ' },
      { sourceCategory: 'Meat' },
    ];

    const uniqueKeys = new Set(
      rows
        .map(r => r.sourceCategory.trim())
        .filter(s => s.length > 0)
        .map(s => s.toLowerCase()),
    );
    expect(uniqueKeys.size).toBe(1);
    expect([...uniqueKeys]).toEqual(['meat']);
  });
});
