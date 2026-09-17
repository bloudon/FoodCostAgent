import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  companies,
  companyStores,
  inventoryCountLines,
  inventoryCounts,
  inventoryItemLocationAssignments,
  inventoryItemLocations,
  inventoryItems,
  inventoryLocations,
  storageLocations,
  storeInventoryItems,
  units,
} from '@workspace/db';
import { db } from '../../db';
import {
  ManualCountPopulationError,
  populateManualCountLines,
} from './manualCountPopulation';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = vi.hoisted(() => Date.now().toString(36).toUpperCase());
const ID = {
  company: `mcp-company-${RUN}`,
  otherCompany: `mcp-other-company-${RUN}`,
  store: `mcp-store-${RUN}`,
  canonicalItem: `mcp-canonical-item-${RUN}`,
  legacyItem: `mcp-legacy-item-${RUN}`,
  foreignItem: `mcp-foreign-item-${RUN}`,
  canonicalLocation: `mcp-canonical-location-${RUN}`,
  legacyLocation: `mcp-legacy-location-${RUN}`,
  foreignLocation: `mcp-foreign-location-${RUN}`,
  emptyCount: `mcp-empty-count-${RUN}`,
  historicalCount: `mcp-historical-count-${RUN}`,
  appliedCount: `mcp-applied-count-${RUN}`,
  user: `mcp-user-${RUN}`,
};

beforeAll(async () => {
  if (SKIP) return;
  const [unit] = await db.select({ id: units.id }).from(units).limit(1);
  if (!unit) throw new Error('Expected at least one seeded unit');

  await db.insert(companies).values([
    { id: ID.company, name: `Manual Count Population ${RUN}` },
    { id: ID.otherCompany, name: `Manual Count Other ${RUN}` },
  ]);
  await db.insert(companyStores).values({
    id: ID.store,
    companyId: ID.company,
    code: `MC${RUN}`.slice(0, 10),
    name: 'Count Store',
  });
  await db.insert(inventoryItems).values([
    {
      id: ID.canonicalItem,
      companyId: ID.company,
      name: 'Canonical Item',
      unitId: unit.id,
      pricePerUnit: 2,
    },
    {
      id: ID.legacyItem,
      companyId: ID.company,
      name: 'Legacy Item',
      unitId: unit.id,
      pricePerUnit: 3,
    },
    {
      id: ID.foreignItem,
      companyId: ID.company,
      name: 'Foreign Assignment Item',
      unitId: unit.id,
      pricePerUnit: 4,
    },
  ]);
  await db.insert(storeInventoryItems).values(
    [ID.canonicalItem, ID.legacyItem, ID.foreignItem].map((inventoryItemId) => ({
      companyId: ID.company,
      storeId: ID.store,
      inventoryItemId,
      active: 1,
    })),
  );
  await db.insert(inventoryLocations).values([
    {
      id: ID.canonicalLocation,
      companyId: ID.company,
      name: 'Orderly Cellar',
      normalizedName: 'orderly cellar',
      active: 1,
    },
    {
      id: ID.foreignLocation,
      companyId: ID.otherCompany,
      name: 'Other Company Storage',
      normalizedName: 'other company storage',
      active: 1,
    },
  ]);
  await db.insert(inventoryItemLocationAssignments).values([
    {
      companyId: ID.company,
      inventoryItemId: ID.canonicalItem,
      locationId: ID.canonicalLocation,
      active: 1,
    },
    {
      companyId: ID.otherCompany,
      inventoryItemId: ID.foreignItem,
      locationId: ID.foreignLocation,
      active: 1,
    },
  ]);
  await db.insert(storageLocations).values({
    id: ID.legacyLocation,
    companyId: ID.company,
    name: 'Legacy Walk-In',
  });
  await db.insert(inventoryItemLocations).values({
    inventoryItemId: ID.legacyItem,
    storageLocationId: ID.legacyLocation,
  });
  await db.insert(inventoryCounts).values([
    {
      id: ID.emptyCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date('2026-08-31T00:00:00Z'),
      userId: ID.user,
    },
    {
      id: ID.historicalCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date('2026-06-30T00:00:00Z'),
      userId: ID.user,
      isHistoricalImport: 1,
    },
    {
      id: ID.appliedCount,
      companyId: ID.company,
      storeId: ID.store,
      countDate: new Date('2026-07-31T00:00:00Z'),
      userId: ID.user,
      applied: 1,
    },
  ]);
});

afterAll(async () => {
  if (SKIP) return;
  const countIds = [ID.emptyCount, ID.historicalCount, ID.appliedCount];
  await db.delete(inventoryCountLines).where(inArray(inventoryCountLines.inventoryCountId, countIds));
  await db.delete(inventoryCounts).where(inArray(inventoryCounts.id, countIds));
  await db.delete(inventoryItemLocationAssignments).where(
    inArray(inventoryItemLocationAssignments.locationId, [ID.canonicalLocation, ID.foreignLocation]),
  );
  await db.delete(inventoryItemLocations).where(eq(inventoryItemLocations.storageLocationId, ID.legacyLocation));
  await db.delete(storeInventoryItems).where(eq(storeInventoryItems.storeId, ID.store));
  await db.delete(inventoryItems).where(
    inArray(inventoryItems.id, [ID.canonicalItem, ID.legacyItem, ID.foreignItem]),
  );
  await db.delete(inventoryLocations).where(
    inArray(inventoryLocations.id, [ID.canonicalLocation, ID.foreignLocation]),
  );
  await db.delete(storageLocations).where(eq(storageLocations.id, ID.legacyLocation));
  await db.delete(companyStores).where(eq(companyStores.id, ID.store));
  await db.delete(companies).where(inArray(companies.id, [ID.company, ID.otherCompany]));
});

describe.skipIf(SKIP)('manual count population', () => {
  it('uses canonical assignments and preserves the legacy fallback without cross-company leakage', async () => {
    const result = await populateManualCountLines(ID.emptyCount, ID.company, ID.user);
    expect(result).toMatchObject({
      createdLines: 2,
      totalLines: 2,
      alreadyPopulated: false,
    });

    const lines = await db
      .select({
        inventoryItemId: inventoryCountLines.inventoryItemId,
        storageLocationId: inventoryCountLines.storageLocationId,
        unitCost: inventoryCountLines.unitCost,
      })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.inventoryCountId, ID.emptyCount));

    expect(lines).toEqual(expect.arrayContaining([
      {
        inventoryItemId: ID.canonicalItem,
        storageLocationId: ID.canonicalLocation,
        unitCost: 2,
      },
      {
        inventoryItemId: ID.legacyItem,
        storageLocationId: ID.legacyLocation,
        unitCost: 3,
      },
    ]));
    expect(lines.some((line) => line.inventoryItemId === ID.foreignItem)).toBe(false);
  });

  it('is idempotent when recovery is repeated', async () => {
    const result = await populateManualCountLines(ID.emptyCount, ID.company, ID.user);
    expect(result).toMatchObject({
      createdLines: 0,
      totalLines: 2,
      alreadyPopulated: true,
    });
  });

  it.each([
    [ID.historicalCount, 'HISTORICAL_SESSION'],
    [ID.appliedCount, 'APPLIED_SESSION'],
  ])('rejects protected session %s', async (countId, expectedCode) => {
    await expect(
      populateManualCountLines(countId, ID.company, ID.user),
    ).rejects.toMatchObject<Partial<ManualCountPopulationError>>({ code: expectedCode });
  });

  it('hides another company count behind the company boundary', async () => {
    await expect(
      populateManualCountLines(ID.emptyCount, ID.otherCompany, ID.user),
    ).rejects.toMatchObject<Partial<ManualCountPopulationError>>({ code: 'COUNT_NOT_FOUND' });
  });
});