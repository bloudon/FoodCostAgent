import { describe, expect, it, vi } from 'vitest';
import {
  filterItemsByEffectiveLocation,
  getInventoryItemsByEffectiveLocation,
  mergeEffectiveInventoryItemLocations,
} from './effectiveItemLocations';

describe('mergeEffectiveInventoryItemLocations', () => {
  const legacyLocation = {
    id: 'legacy-cellar',
    companyId: 'company-a',
    name: 'Legacy Cellar',
    sortOrder: 1,
    allowCaseCounting: 1,
  } as any;

  it('returns canonical locations for canonical-only items', () => {
    const result = mergeEffectiveInventoryItemLocations(
      ['canonical-item'],
      [{
        inventoryItemId: 'canonical-item',
        id: 'wine-cellar',
        name: 'Wine Cellar',
        isPrimary: 1,
      }],
      new Map(),
      [],
    );

    expect(result.get('canonical-item')).toEqual([{
      id: 'wine-cellar',
      name: 'Wine Cellar',
      isPrimary: true,
    }]);
  });

  it('keeps legacy locations when an item has no canonical assignment', () => {
    const result = mergeEffectiveInventoryItemLocations(
      ['legacy-item'],
      [],
      new Map([['legacy-item', [{
        inventoryItemId: 'legacy-item',
        storageLocationId: legacyLocation.id,
        isPrimary: 1,
      } as any]]]),
      [legacyLocation],
    );

    expect(result.get('legacy-item')).toEqual([{
      id: legacyLocation.id,
      name: legacyLocation.name,
      isPrimary: true,
    }]);
  });

  it('uses canonical assignments instead of duplicating mixed-model items', () => {
    const result = mergeEffectiveInventoryItemLocations(
      ['mixed-item'],
      [{
        inventoryItemId: 'mixed-item',
        id: 'canonical-cellar',
        name: 'Canonical Cellar',
        isPrimary: 0,
      }],
      new Map([['mixed-item', [{
        inventoryItemId: 'mixed-item',
        storageLocationId: legacyLocation.id,
        isPrimary: 1,
      } as any]]]),
      [legacyLocation],
    );

    expect(result.get('mixed-item')).toEqual([{
      id: 'canonical-cellar',
      name: 'Canonical Cellar',
      isPrimary: false,
    }]);
  });

  it('filters the API response by effective canonical or legacy location IDs', () => {
    const items = [
      { id: 'canonical', locations: [{ id: 'canonical-cellar' }] },
      { id: 'legacy', locations: [{ id: 'legacy-cellar' }] },
    ];

    expect(
      filterItemsByEffectiveLocation(items, 'canonical-cellar'),
    ).toEqual([items[0]]);
    expect(
      filterItemsByEffectiveLocation(items, 'legacy-cellar'),
    ).toEqual([items[1]]);
  });
});

describe('getInventoryItemsByEffectiveLocation', () => {
  const canonicalItem = { id: 'canonical-item' } as any;
  const legacyItem = { id: 'legacy-item' } as any;
  const otherCompanyItem = { id: 'other-company-item' } as any;

  function createStorage() {
    return {
      getInventoryItems: vi.fn().mockResolvedValue([canonicalItem, legacyItem]),
      getInventoryItemLocationsBatch: vi.fn().mockResolvedValue(new Map()),
      getStorageLocations: vi.fn().mockResolvedValue([]),
    };
  }

  it('returns canonical-only items without using the deprecated storage filter', async () => {
    const storage = createStorage();
    const resolve = vi.fn().mockResolvedValue(new Map([
      [canonicalItem.id, [{ id: 'canonical-cellar' }]],
      [legacyItem.id, [{ id: 'legacy-cellar' }]],
      [otherCompanyItem.id, [{ id: 'canonical-cellar' }]],
    ]));

    const result = await getInventoryItemsByEffectiveLocation(
      storage,
      'company-a',
      'canonical-cellar',
      undefined,
      resolve,
    );

    expect(result).toEqual([canonicalItem]);
    expect(storage.getInventoryItems).toHaveBeenCalledWith(
      undefined,
      undefined,
      'company-a',
    );
    expect(resolve).toHaveBeenCalledWith(
      'company-a',
      [canonicalItem.id, legacyItem.id],
      expect.any(Map),
      [],
    );
  });

  it('returns legacy-only items through the same company-scoped contract', async () => {
    const storage = createStorage();
    const resolve = vi.fn().mockResolvedValue(new Map([
      [canonicalItem.id, [{ id: 'canonical-cellar' }]],
      [legacyItem.id, [{ id: 'legacy-cellar' }]],
    ]));

    const result = await getInventoryItemsByEffectiveLocation(
      storage,
      'company-a',
      'legacy-cellar',
      undefined,
      resolve,
    );

    expect(result).toEqual([legacyItem]);
  });
});