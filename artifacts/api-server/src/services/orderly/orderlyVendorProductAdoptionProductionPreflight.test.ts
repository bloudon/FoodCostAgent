import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { describeDatabaseTarget } from '../../db';
import type { OrderlyAdoptionEvidenceManifest } from './orderlyVendorProductAdoptionManifest';
import {
  OrderlyProductionPreflightError,
  assertCatalogFingerprintStable,
  assertOrderlyProductionPreflightEvidence,
  assertProductionPreflightOperatorInputs,
  assertRequiredSchema,
  runOrderlyProductionPreflight,
} from './orderlyVendorProductAdoptionProductionPreflight';

const manifestEnvelope = JSON.parse(readFileSync(
  resolve(process.cwd(), '../../reports/orderly-vendor-product-adoption-manifest-24472.json'),
  'utf8',
)) as OrderlyAdoptionEvidenceManifest & { generatedAt?: string; sourceAcquisition?: string };
const { generatedAt: _generatedAt, sourceAcquisition: _sourceAcquisition, ...manifest } = manifestEnvelope;
const sourceBytes = readFileSync(
  resolve(process.cwd(), '../../attached_assets/allSpecsForRestaurant_24472_raw_1787184647052.json'),
);
const rawSpecs = JSON.parse(sourceBytes.toString('utf8')) as unknown[];
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
const target = describeDatabaseTarget();

function validInput() {
  return {
    manifest,
    rawSpecs,
    rawSourceFileSha256: sourceHash,
    scope: {
      companyId: 'reviewed-company-id',
      storeId: 'reviewed-store-id',
      sourceSystem: 'ORDERLY' as const,
      sourcePropertyId: manifest.sourcePropertyId,
    },
    build: {
      gitSha: 'reviewed-sha',
      apiVersion: '1.15.0',
      buildId: 'api@1.15.0:reviewed-sha',
      workingTreeClean: true,
    },
    liveApiBuildId: 'api@1.15.0:reviewed-sha',
    liveApiPort: 8080,
    expectedBuild: {
      gitSha: 'reviewed-sha',
      apiVersion: '1.15.0',
      buildId: 'api@1.15.0:reviewed-sha',
    },
    expectedDatabase: {
      host: target.host,
      port: target.port,
      database: target.database,
    },
  };
}

describe('Orderly adoption production preflight safety gates', () => {
  it('refuses a missing or wrong reviewed scope before it can query the database', () => {
    const missingCompany = validInput();
    missingCompany.scope.companyId = '';
    expect(() => assertProductionPreflightOperatorInputs(missingCompany))
      .toThrow(/company ID/);

    const wrongProperty = validInput();
    wrongProperty.scope.sourcePropertyId = 'other-property';
    expect(() => assertProductionPreflightOperatorInputs(wrongProperty))
      .toThrow(/exact ORDERLY source property/);

    const wrongManifestProperty = validInput();
    wrongManifestProperty.manifest = {
      ...manifest,
      sourcePropertyId: 'unapproved-property',
    };
    wrongManifestProperty.scope.sourcePropertyId = 'unapproved-property';
    expect(() => assertProductionPreflightOperatorInputs(wrongManifestProperty))
      .toThrow(/exact ORDERLY source property/);
  });

  it('refuses stale or mismatched frozen source evidence', () => {
    expect(() => assertOrderlyProductionPreflightEvidence(
      manifest,
      rawSpecs,
      '0'.repeat(64),
    )).toThrow(/SHA-256 does not match/);
  });

  it('refuses an incorrect database identity and missing build prerequisites', () => {
    const wrongDatabase = validInput();
    wrongDatabase.expectedDatabase.host = 'not-the-reviewed-host';
    expect(() => assertProductionPreflightOperatorInputs(wrongDatabase))
      .toThrow(/database target/);

    const wrongBuild = validInput();
    wrongBuild.expectedBuild.buildId = '';
    expect(() => assertProductionPreflightOperatorInputs(wrongBuild))
      .toThrow(/build ID/);

    const wrongLiveApi = validInput();
    wrongLiveApi.liveApiBuildId = 'api@1.15.0:other-sha';
    expect(() => assertProductionPreflightOperatorInputs(wrongLiveApi))
      .toThrow(/Actively serving API build identity/);

    const badLiveApiPort = validInput();
    badLiveApiPort.liveApiPort = 0;
    expect(() => assertProductionPreflightOperatorInputs(badLiveApiPort))
      .toThrow(/listener port/);
  });

  it('refuses missing required schema tables or constraints', async () => {
    const runner = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    await expect(assertRequiredSchema(runner as never))
      .rejects.toThrow(/Missing required production schema table/);
  });

  it('refuses same-named indexes with a partial, wrong-table, or altered definition', async () => {
    const tables = [
      'company_stores', 'import_source_property_bindings', 'inventory_import_batches',
      'inventory_import_rows', 'inventory_items', 'price_history', 'vendors',
      'vendor_items', 'vendor_item_external_mappings',
    ].map(table_name => ({ table_name }));
    const columns = [
      ['company_stores', 'id'], ['company_stores', 'company_id'],
      ['import_source_property_bindings', 'company_id'],
      ['import_source_property_bindings', 'source_system'],
      ['import_source_property_bindings', 'source_property_id'],
      ['import_source_property_bindings', 'destination_store_id'],
      ['import_source_property_bindings', 'active'],
      ['inventory_import_batches', 'source_property_binding_id'],
      ['inventory_import_batches', 'source_property_id'],
      ['inventory_import_rows', 'resolved_inventory_item_id'],
      ['vendors', 'company_id'], ['vendor_items', 'vendor_id'],
      ['vendor_items', 'inventory_item_id'], ['vendor_items', 'vendor_sku'],
      ['vendor_items', 'case_size'], ['vendor_items', 'inner_pack_size'],
      ['vendor_items', 'pack_uom'], ['vendor_item_external_mappings', 'vendor_item_id'],
      ['vendor_item_external_mappings', 'source_property_id'],
      ['vendor_item_external_mappings', 'source_external_id'],
    ].map(([table_name, column_name]) => ({ table_name, column_name }));
    const runner = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: tables })
        .mockResolvedValueOnce({ rows: columns })
        .mockResolvedValueOnce({ rows: [
          {
            indexname: 'import_source_property_unique',
            indisunique: true,
            table_name: 'import_source_property_bindings',
            key_columns: ['source_system', 'source_property_id'],
            predicate: '(active = 1)',
          },
          {
            indexname: 'vendor_item_ext_mappings_source_idx',
            indisunique: false,
            table_name: 'inventory_item_external_mappings',
            key_columns: ['company_id', 'source_system', 'source_property_id', 'source_external_id'],
            predicate: null,
          },
          {
            indexname: 'vendor_items_vendor_item_sku_uniq',
            indisunique: true,
            table_name: 'vendor_items',
            key_columns: ['vendor_id', 'inventory_item_id', 'vendor_sku'],
            // Semantically close, but not the approved pg_get_expr canonical
            // form. Exact predicate identity is deliberate.
            predicate: "(vendor_sku IS NOT NULL AND btrim(vendor_sku) <> ''::text)",
          },
        ] }),
    };
    await expect(assertRequiredSchema(runner as never))
      .rejects.toThrow(/definition mismatch/);
  });

  it('refuses a catalog fingerprint change during preflight', () => {
    expect(() => assertCatalogFingerprintStable(
      { inventoryItemCount: 2, vendorItemCount: 3 },
      { inventoryItemCount: 2, vendorItemCount: 4 },
    )).toThrow(/writer-quiescence window/);
  });

  it('uses one read-only transaction and reports zero database writes', async () => {
    const tables = [
      'company_stores', 'import_source_property_bindings', 'inventory_import_batches',
      'inventory_import_rows', 'inventory_items', 'price_history', 'vendors',
      'vendor_items', 'vendor_item_external_mappings',
    ].map(table_name => ({ table_name }));
    const columns = [
      ['company_stores', 'id'], ['company_stores', 'company_id'],
      ['import_source_property_bindings', 'company_id'],
      ['import_source_property_bindings', 'source_system'],
      ['import_source_property_bindings', 'source_property_id'],
      ['import_source_property_bindings', 'destination_store_id'],
      ['import_source_property_bindings', 'active'],
      ['inventory_import_batches', 'source_property_binding_id'],
      ['inventory_import_batches', 'source_property_id'],
      ['inventory_import_rows', 'resolved_inventory_item_id'],
      ['vendors', 'company_id'], ['vendor_items', 'vendor_id'],
      ['vendor_items', 'inventory_item_id'], ['vendor_items', 'vendor_sku'],
      ['vendor_items', 'case_size'], ['vendor_items', 'inner_pack_size'],
      ['vendor_items', 'pack_uom'], ['vendor_item_external_mappings', 'vendor_item_id'],
      ['vendor_item_external_mappings', 'source_property_id'],
      ['vendor_item_external_mappings', 'source_external_id'],
    ].map(([table_name, column_name]) => ({ table_name, column_name }));
    const responses = [
      { rows: [] }, // SET TRANSACTION READ ONLY
      { rows: tables },
      { rows: columns },
      { rows: [
        {
          indexname: 'import_source_property_unique',
          indisunique: true,
            table_name: 'import_source_property_bindings',
            key_columns: ['source_system', 'source_property_id'],
            predicate: null,
        },
        {
          indexname: 'vendor_item_ext_mappings_source_idx',
          indisunique: false,
            table_name: 'vendor_item_external_mappings',
            key_columns: ['company_id', 'source_system', 'source_property_id', 'source_external_id'],
            predicate: null,
        },
        {
          indexname: 'vendor_items_vendor_item_sku_uniq',
          indisunique: true,
            table_name: 'vendor_items',
            key_columns: ['vendor_id', 'inventory_item_id', 'vendor_sku'],
            predicate: "((vendor_sku IS NOT NULL) AND (btrim(vendor_sku) <> ''::text))",
        },
      ] },
      { rows: [{ id: 'reviewed-binding' }] },
      ...Array.from({ length: 4 }, () => ({ rows: [{ value: 1 }] })),
      ...Array.from({ length: 3 }, () => ({ rows: [{ value: 0 }] })),
      { rows: [] },
      ...Array.from({ length: 4 }, () => ({ rows: [{ value: 1 }] })),
    ];
    const execute = vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error('Unexpected query in read-only preflight');
      return response;
    });
    const runner: { execute: typeof execute; transaction: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown> } = {
      execute,
      transaction: async callback => callback(runner),
    };

    const report = await runOrderlyProductionPreflight(validInput(), runner as never);
    expect(execute.mock.calls).toHaveLength(17);
    expect(report.writesExecuted).toBe(0);
    expect(report.databaseWritesExecuted).toBe(0);
    expect(report.catalog.unchanged).toBe(true);
    expect(report.isProductionPreview).toBe(false);
    expect(report.build.liveApiBuild).toEqual({
      buildId: 'api@1.15.0:reviewed-sha',
      buildInfoUrl: 'http://127.0.0.1:8080/api/build-info',
      checkedAt: expect.any(String),
    });
  });
});