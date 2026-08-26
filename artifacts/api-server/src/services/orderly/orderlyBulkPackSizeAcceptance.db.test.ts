/**
 * Acceptance coverage for the safe bulk pack-size fixture. This stages an
 * actual parsed Orderly workbook in an isolated development-test company, then
 * uses the real preview service. It never calls approval or creates a variant.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  companies,
  companyStores,
  importSourcePropertyBindings,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItemExternalMappings,
  inventoryItems,
  units,
} from '@workspace/db';
import { ensureInventoryItemNumberSchema } from '../../migrations/inventoryItemNumbers';
import { parseOrderlyWorkbook } from './OrderlyParser';
import {
  buildBulkPackSizeFixtureWorkbook,
  BULK_PACK_SIZE_FIXTURE_FILENAME,
} from './orderlyBulkPackSize.fixture';
import { runResolutionPreview } from './orderlyDomain';

const SKIP = !process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL;
const RUN = vi.hoisted(() => Date.now().toString(36));
const ID = {
  company: `bulk-pack-company-${RUN}`,
  store: `bulk-pack-store-${RUN}`,
  binding: `bulk-pack-binding-${RUN}`,
  property: `bulk-pack-property-${RUN}`,
  item: `bulk-pack-item-${RUN}`,
  batch: `bulk-pack-batch-${RUN}`,
};

describe.skipIf(SKIP)('Orderly bulk pack-size acceptance fixture', () => {
  beforeAll(async () => {
    await ensureInventoryItemNumberSchema(db);
    const [eachUnit] = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.abbreviation, 'ea'))
      .limit(1);
    if (!eachUnit) throw new Error('Expected seeded "ea" unit for bulk pack-size fixture');

    await db.insert(companies).values({ id: ID.company, name: `Bulk Pack Fixture ${RUN}` });
    await db.insert(companyStores).values({
      id: ID.store,
      companyId: ID.company,
      code: `BP${RUN}`.slice(0, 10),
      name: 'Fixture Club',
      status: 'active',
    });
    await db.insert(importSourcePropertyBindings).values({
      id: ID.binding,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property,
      sourcePropertyLabel: 'Fixture Club',
      destinationStoreId: ID.store,
      active: 1,
    });
    await db.insert(inventoryItems).values({
      id: ID.item,
      companyId: ID.company,
      name: 'House Tequila',
      unitId: eachUnit.id,
      caseSize: 1,
    });
    await db.insert(inventoryItemExternalMappings).values({
      companyId: ID.company,
      inventoryItemId: ID.item,
      sourceSystem: 'ORDERLY',
      sourcePropertyId: ID.property,
      sourceExternalId: 'LEGACY-750ML',
      sourceDescription: 'House Tequila',
      caseQuantity: 1,
      innerPackQuantity: 1,
      baseUnitQuantity: 750,
      baseUnit: 'ML',
      matchStrategy: 'manual',
      confidenceScore: 1,
    });

    const parsed = parseOrderlyWorkbook(
      buildBulkPackSizeFixtureWorkbook(),
      BULK_PACK_SIZE_FIXTURE_FILENAME,
    );
    await db.insert(inventoryImportBatches).values({
      id: ID.batch,
      companyId: ID.company,
      sourceSystem: 'ORDERLY',
      fileHash: `fixture-${RUN}`,
      originalFilename: BULK_PACK_SIZE_FIXTURE_FILENAME,
      sheetName: parsed.sheetName,
      parserVersion: 'fixture',
      inventoryDate: parsed.inventoryDate.detectedDate,
      inventoryDateConfirmed: 1,
      status: 'pending_review',
      sourceRowCount: parsed.sourceRowCount,
      snapshotTotal: parsed.snapshotTotal,
      targetStoreId: ID.store,
      sourcePropertyBindingId: ID.binding,
      sourcePropertyId: ID.property,
    });
    await db.insert(inventoryImportRows).values(parsed.rows.map(row => ({
      ...row,
      batchId: ID.batch,
      sheetName: parsed.sheetName,
    })));
  });

  afterAll(async () => {
    const batches = await db
      .select({ id: inventoryImportBatches.id })
      .from(inventoryImportBatches)
      .where(eq(inventoryImportBatches.companyId, ID.company));
    const batchIds = batches.map(batch => batch.id);
    if (batchIds.length) {
      await db.delete(inventoryImportRows).where(inArray(inventoryImportRows.batchId, batchIds)).catch(() => {});
    }
    await db.delete(inventoryImportBatches).where(eq(inventoryImportBatches.companyId, ID.company)).catch(() => {});
    await db.delete(inventoryItemExternalMappings).where(eq(inventoryItemExternalMappings.companyId, ID.company)).catch(() => {});
    await db.delete(inventoryItems).where(eq(inventoryItems.companyId, ID.company)).catch(() => {});
    await db.delete(importSourcePropertyBindings).where(eq(importSourcePropertyBindings.companyId, ID.company)).catch(() => {});
    await db.delete(companyStores).where(eq(companyStores.companyId, ID.company)).catch(() => {});
    await db.delete(companies).where(eq(companies.id, ID.company)).catch(() => {});
  });

  it('returns one verified stable new-pack-size group and excludes missing pack evidence', async () => {
    const preview = await runResolutionPreview(ID.batch, ID.company);
    const eligible = preview.rows.find(row => row.sourceItemCode === 'TEQ-5050');
    const missingEvidence = preview.rows.find(row => row.sourceItemCode === 'TEQ-5051');

    expect(preview.recodeSummary).toMatchObject({
      newPackSizes: 1,
      packEvidenceMissing: 1,
    });
    expect(eligible?.itemMatch).toMatchObject({
      possibleRecode: true,
      possibleRecodeMatchedId: ID.item,
      recodeEvidenceClass: 'new_pack_size',
      packCompatibility: 'incompatible',
    });
    expect(missingEvidence?.itemMatch).toMatchObject({
      possibleRecode: true,
      possibleRecodeMatchedId: ID.item,
      recodeEvidenceClass: 'pack_evidence_missing',
      packCompatibility: 'unknown',
    });
  });
});