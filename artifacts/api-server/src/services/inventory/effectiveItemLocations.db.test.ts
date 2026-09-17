import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  inventoryItemLocationAssignments,
  inventoryLocations,
} from '@workspace/db';
import { db } from '../../db';
import { getEffectiveInventoryItemLocationsBatch } from './effectiveItemLocations';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = vi.hoisted(() => Date.now().toString(36).toUpperCase());
const ID = {
  company: `effective-loc-company-${RUN}`,
  otherCompany: `effective-loc-other-${RUN}`,
  item: `effective-loc-item-${RUN}`,
  otherItem: `effective-loc-other-item-${RUN}`,
  location: `effective-loc-location-${RUN}`,
  otherLocation: `effective-loc-other-location-${RUN}`,
};

beforeAll(async () => {
  if (SKIP) return;
  await db.insert(inventoryLocations).values([
    {
      id: ID.location,
      companyId: ID.company,
      name: 'Company Cellar',
      normalizedName: 'company cellar',
    },
    {
      id: ID.otherLocation,
      companyId: ID.otherCompany,
      name: 'Other Company Cellar',
      normalizedName: 'other company cellar',
    },
  ]);
  await db.insert(inventoryItemLocationAssignments).values([
    {
      companyId: ID.company,
      inventoryItemId: ID.item,
      locationId: ID.location,
    },
    {
      companyId: ID.otherCompany,
      inventoryItemId: ID.otherItem,
      locationId: ID.otherLocation,
    },
  ]);
});

afterAll(async () => {
  if (SKIP) return;
  await db.delete(inventoryItemLocationAssignments).where(
    inArray(
      inventoryItemLocationAssignments.locationId,
      [ID.location, ID.otherLocation],
    ),
  );
  await db.delete(inventoryLocations).where(
    inArray(inventoryLocations.id, [ID.location, ID.otherLocation]),
  );
});

describe.skipIf(SKIP)('effective inventory item location company isolation', () => {
  it('does not return another company canonical assignment', async () => {
    const result = await getEffectiveInventoryItemLocationsBatch(
      ID.company,
      [ID.item, ID.otherItem],
      new Map(),
      [],
    );

    expect(result.get(ID.item)).toEqual([{
      id: ID.location,
      name: 'Company Cellar',
      isPrimary: false,
    }]);
    expect(result.get(ID.otherItem)).toEqual([]);
  });
});