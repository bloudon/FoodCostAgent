/**
 * Production-readiness checks for the frozen Orderly vendor-product adoption.
 *
 * This is deliberately NOT the production preview. It verifies operator, build,
 * evidence, scope, schema, and catalog readiness in one read-only transaction;
 * it never invokes the adoption classifier and never proposes CREATE actions.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, describeDatabaseTarget } from '../../db';
import {
  canonicalOrderlySourceFingerprint,
  verifyOrderlyAdoptionEvidenceManifest,
  type OrderlyAdoptionEvidenceManifest,
  type OrderlyAdoptionFrozenCandidate,
} from './orderlyVendorProductAdoptionManifest';
import { normalizeOrderlyRestaurantSpecs } from './orderlyVendorProductAdoptionClassifier';

type Runner = typeof db;

export const ORDERLY_PRODUCTION_PREFLIGHT_SCHEMA_VERSION =
  'orderly-adoption-production-preflight-v1';
export const APPROVED_ORDERLY_ADOPTION_SOURCE_PROPERTY_ID = '24472';

export class OrderlyProductionPreflightError extends Error {
  readonly code = 'ORDERLY_PRODUCTION_PREFLIGHT_REFUSED';

  constructor(message: string) {
    super(`[ORDERLY_PRODUCTION_PREFLIGHT_REFUSED] ${message}`);
    this.name = 'OrderlyProductionPreflightError';
  }
}

export interface ProductionPreflightScope {
  companyId: string;
  storeId: string;
  sourceSystem: 'ORDERLY';
  sourcePropertyId: string;
}

export interface ProductionBuildIdentity {
  gitSha: string;
  apiVersion: string;
  buildId: string;
  workingTreeClean: boolean;
}

export interface ProductionDatabaseIdentity {
  host: string;
  port: string;
  database: string;
}

export interface ProductionPreflightInput {
  manifest: OrderlyAdoptionEvidenceManifest;
  rawSpecs: unknown[];
  rawSourceFileSha256: string;
  scope: ProductionPreflightScope;
  build: ProductionBuildIdentity;
  liveApiBuildId: string | null;
  liveApiPort: number;
  expectedBuild: Pick<ProductionBuildIdentity, 'gitSha' | 'apiVersion' | 'buildId'>;
  expectedDatabase: ProductionDatabaseIdentity;
}

interface MappingRow {
  source_external_id: string;
  vendor_item_id: string;
  vendor_id: string | null;
  inventory_item_id: string | null;
  vendor_sku: string | null;
  case_size: number | null;
  inner_pack_size: number | null;
  pack_uom: string | null;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

function numberOf(result: unknown): number {
  const row = rowsOf<{ value: string | number | null }>(result)[0];
  return Number(row?.value ?? 0);
}

function normalizedNullableNumber(value: number | null): number | null {
  return value == null ? null : Number(value);
}

export function frozenTargetMatchesMapping(
  mapping: MappingRow | undefined,
  candidate: OrderlyAdoptionFrozenCandidate,
): boolean {
  if (!mapping) return false;
  if (candidate.vendorItemTarget.kind === 'existing') {
    return mapping.vendor_item_id === candidate.vendorItemTarget.vendorItemId;
  }
  const expected = candidate.vendorItemTarget.logicalIdentity;
  return mapping.vendor_id === expected.vendorId
    && mapping.inventory_item_id === expected.inventoryItemId
    && mapping.vendor_sku === expected.vendorSku
    && normalizedNullableNumber(mapping.case_size) === normalizedNullableNumber(expected.caseSize)
    && normalizedNullableNumber(mapping.inner_pack_size) === normalizedNullableNumber(expected.innerPackSize)
    && mapping.pack_uom === expected.packUom;
}

/**
 * Pure evidence gate, intentionally usable before opening a database
 * connection. It proves this preflight is bound to the exact reviewed source
 * file and logical source population, but does not classify catalog outcomes.
 */
export function assertOrderlyProductionPreflightEvidence(
  manifest: OrderlyAdoptionEvidenceManifest,
  rawSpecs: unknown[],
  rawSourceFileSha256: string,
): { canonicalSourceFingerprint: string; normalizedRelationshipCount: number } {
  if (!verifyOrderlyAdoptionEvidenceManifest(manifest)) {
    throw new OrderlyProductionPreflightError(
      'Frozen manifest checksum is invalid or the manifest was edited.',
    );
  }
  if (!manifest.rawSourceFileSha256) {
    throw new OrderlyProductionPreflightError(
      'Frozen manifest lacks the raw source-file SHA-256 required for production.',
    );
  }
  if (manifest.rawSourceFileSha256 !== rawSourceFileSha256) {
    throw new OrderlyProductionPreflightError(
      'Provided Orderly source-file SHA-256 does not match the frozen manifest.',
    );
  }
  const entries = normalizeOrderlyRestaurantSpecs(rawSpecs, manifest.sourcePropertyId);
  const canonicalSourceFingerprint = canonicalOrderlySourceFingerprint(
    entries,
    manifest.sourcePropertyId,
  );
  if (canonicalSourceFingerprint !== manifest.canonicalSourceFingerprint) {
    throw new OrderlyProductionPreflightError(
      'Provided Orderly source evidence has a different canonical relationship fingerprint.',
    );
  }
  return { canonicalSourceFingerprint, normalizedRelationshipCount: entries.length };
}

export function assertProductionPreflightOperatorInputs(
  input: Pick<ProductionPreflightInput, 'manifest' | 'scope' | 'build' | 'liveApiBuildId' | 'liveApiPort' | 'expectedBuild' | 'expectedDatabase'>,
): void {
  const required = [
    ['company ID', input.scope.companyId],
    ['store ID', input.scope.storeId],
    ['source property ID', input.scope.sourcePropertyId],
    ['expected database host', input.expectedDatabase.host],
    ['expected database name', input.expectedDatabase.database],
    ['expected git SHA', input.expectedBuild.gitSha],
    ['expected API version', input.expectedBuild.apiVersion],
    ['expected build ID', input.expectedBuild.buildId],
  ];
  const missing = required.filter(([, value]) => !value?.trim()).map(([label]) => label);
  if (missing.length) {
    throw new OrderlyProductionPreflightError(
      `Missing required operator prerequisite(s): ${missing.join(', ')}.`,
    );
  }
  if (input.scope.sourceSystem !== 'ORDERLY'
    || input.manifest.sourcePropertyId !== APPROVED_ORDERLY_ADOPTION_SOURCE_PROPERTY_ID
    || input.scope.sourcePropertyId !== APPROVED_ORDERLY_ADOPTION_SOURCE_PROPERTY_ID
    || input.scope.sourcePropertyId !== input.manifest.sourcePropertyId
    || input.manifest.sourceSystem !== 'ORDERLY') {
    throw new OrderlyProductionPreflightError(
      'Scope must be the exact ORDERLY source property bound by the frozen manifest.',
    );
  }
  if (!input.build.workingTreeClean) {
    throw new OrderlyProductionPreflightError(
      'Working tree is not clean; deploy and review one exact build before preflight.',
    );
  }
  const mismatches = [
    ['git SHA', input.build.gitSha, input.expectedBuild.gitSha],
    ['API version', input.build.apiVersion, input.expectedBuild.apiVersion],
    ['build ID', input.build.buildId, input.expectedBuild.buildId],
  ].filter(([, actual, expected]) => actual !== expected);
  if (mismatches.length) {
    throw new OrderlyProductionPreflightError(
      `Running build does not match the reviewed build: ${mismatches.map(([label]) => label).join(', ')}.`,
    );
  }
  if (!input.liveApiBuildId || input.liveApiBuildId !== input.expectedBuild.buildId) {
    throw new OrderlyProductionPreflightError(
      'Actively serving API build identity is absent or does not match the reviewed build.',
    );
  }
  try {
    localApiBuildInfoUrl(input.liveApiPort);
  } catch {
    throw new OrderlyProductionPreflightError(
      'Active API listener port must be an explicit valid local TCP port.',
    );
  }
  const current = describeDatabaseTarget();
  if (current.host === '(unparseable)' || current.database === '(unparseable)'
    || current.host !== input.expectedDatabase.host
    || current.port !== input.expectedDatabase.port
    || current.database !== input.expectedDatabase.database) {
    throw new OrderlyProductionPreflightError(
      'Current database target does not exactly match the operator-reviewed production database identity.',
    );
  }
}

const REQUIRED_TABLES = [
  'company_stores',
  'import_source_property_bindings',
  'inventory_import_batches',
  'inventory_import_rows',
  'inventory_items',
  'vendors',
  'vendor_items',
  'vendor_item_external_mappings',
] as const;

const REQUIRED_COLUMNS: Array<[string, string]> = [
  ['company_stores', 'id'],
  ['company_stores', 'company_id'],
  ['import_source_property_bindings', 'company_id'],
  ['import_source_property_bindings', 'source_system'],
  ['import_source_property_bindings', 'source_property_id'],
  ['import_source_property_bindings', 'destination_store_id'],
  ['import_source_property_bindings', 'active'],
  ['inventory_import_batches', 'source_property_binding_id'],
  ['inventory_import_batches', 'source_property_id'],
  ['inventory_import_rows', 'resolved_inventory_item_id'],
  // price_history does not exist — the actual table is inventory_item_price_history
  // and has no company_id column; it is not part of the Orderly adoption scope.
  ['vendors', 'company_id'],
  ['vendor_items', 'vendor_id'],
  ['vendor_items', 'inventory_item_id'],
  ['vendor_items', 'vendor_sku'],
  ['vendor_items', 'case_size'],
  ['vendor_items', 'inner_pack_size'],
  ['vendor_items', 'pack_uom'],
  ['vendor_item_external_mappings', 'vendor_item_id'],
  ['vendor_item_external_mappings', 'source_property_id'],
  ['vendor_item_external_mappings', 'source_external_id'],
];

const REQUIRED_INDEXES = [
  'import_source_property_unique',
  'vendor_item_ext_mappings_source_idx',
  'vendor_items_vendor_item_sku_uniq',
] as const;

export async function assertRequiredSchema(runner: Runner): Promise<{
  tables: string[];
  columns: string[];
  indexes: string[];
}> {
  const tables = rowsOf<{ table_name: string }>(await runner.execute(sql.raw(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${REQUIRED_TABLES.map(table => `'${table}'`).join(', ')})
  `))).map(row => row.table_name);
  const missingTables = REQUIRED_TABLES.filter(table => !tables.includes(table));
  if (missingTables.length) {
    throw new OrderlyProductionPreflightError(
      `Missing required production schema table(s): ${missingTables.join(', ')}.`,
    );
  }

  const columns = rowsOf<{ table_name: string; column_name: string }>(await runner.execute(sql.raw(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND (table_name, column_name) IN (${
      REQUIRED_COLUMNS.map(([table, column]) => `('${table}', '${column}')`).join(', ')
    })
  `)));
  const seenColumns = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
  const requiredColumnNames = REQUIRED_COLUMNS.map(([table, column]) => `${table}.${column}`);
  const missingColumns = requiredColumnNames.filter(name => !seenColumns.has(name));
  if (missingColumns.length) {
    throw new OrderlyProductionPreflightError(
      `Missing required production schema column(s): ${missingColumns.join(', ')}.`,
    );
  }

  const indexes = rowsOf<{
    indexname: string;
    indisunique: boolean;
    table_name: string;
    key_columns: string[] | string;
    predicate: string | null;
  }>(await runner.execute(sql.raw(`
    SELECT c.relname AS indexname, i.indisunique, t.relname AS table_name,
           COALESCE(
             json_agg(a.attname ORDER BY key_ordinality.ordinality)
               FILTER (WHERE a.attname IS NOT NULL),
             '[]'::json
           ) AS key_columns,
           pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i
    INNER JOIN pg_class c ON c.oid = i.indexrelid
    INNER JOIN pg_class t ON t.oid = i.indrelid
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN LATERAL unnest(i.indkey) WITH ORDINALITY
      AS key_ordinality(attnum, ordinality) ON true
    LEFT JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = key_ordinality.attnum
    WHERE n.nspname = 'public'
      AND c.relname IN (${REQUIRED_INDEXES.map(index => `'${index}'`).join(', ')})
    GROUP BY c.relname, i.indisunique, t.relname, i.indpred, i.indrelid
  `)));
  const indexNames = indexes.map(row => row.indexname);
  const missingIndexes = REQUIRED_INDEXES.filter(index => !indexNames.includes(index));
  if (missingIndexes.length) {
    throw new OrderlyProductionPreflightError(
      `Missing required production constraint/index(es): ${missingIndexes.join(', ')}.`,
    );
  }
  const indexByName = new Map(indexes.map(index => [index.indexname, index]));
  const parseColumns = (value: string[] | string) => {
    if (Array.isArray(value)) return value;
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) && parsed.every(column => typeof column === 'string')
        ? parsed as string[]
        : [];
    } catch {
      return [];
    }
  };
  const isExactIndex = (
    index: typeof indexes[number] | undefined,
    expected: { table: string; columns: string[]; unique: boolean; predicate: string | null },
  ) => {
    if (!index || index.table_name !== expected.table || index.indisunique !== expected.unique) return false;
    const columns = parseColumns(index.key_columns);
    if (columns.length !== expected.columns.length
      || columns.some((column, position) => column !== expected.columns[position])) return false;
    // pg_get_expr is PostgreSQL's canonical predicate rendering. Compare it
    // byte-for-byte to the approved invariant: a formatter that erases casts,
    // parentheses, or quotes can accept a materially different partial index.
    return index.predicate === expected.predicate;
  };
  const binding = indexByName.get('import_source_property_unique');
  const mapping = indexByName.get('vendor_item_ext_mappings_source_idx');
  const vendorSku = indexByName.get('vendor_items_vendor_item_sku_uniq');
  const malformed = [
    !isExactIndex(binding, {
      table: 'import_source_property_bindings',
      columns: ['source_system', 'source_property_id'],
      unique: true,
      predicate: null,
    })
      ? 'import_source_property_unique must be unique on (source_system, source_property_id)'
      : null,
    !isExactIndex(mapping, {
      table: 'vendor_item_external_mappings',
      columns: ['company_id', 'source_system', 'source_property_id', 'source_external_id'],
      unique: false,
      predicate: null,
    })
      ? 'vendor_item_ext_mappings_source_idx must cover the exact company/property provenance identity'
      : null,
    !isExactIndex(vendorSku, {
      table: 'vendor_items',
      columns: ['vendor_id', 'inventory_item_id', 'vendor_sku'],
      unique: true,
      predicate: "((vendor_sku IS NOT NULL) AND (btrim(vendor_sku) <> ''::text))",
    })
      ? 'vendor_items_vendor_item_sku_uniq must be the approved partial unique vendor/SKU identity'
      : null,
  ].filter((value): value is string => Boolean(value));
  if (malformed.length) {
    throw new OrderlyProductionPreflightError(
      `Required production index/constraint definition mismatch: ${malformed.join('; ')}.`,
    );
  }
  return { tables: [...REQUIRED_TABLES], columns: requiredColumnNames, indexes: [...REQUIRED_INDEXES] };
}

async function assertScopeBinding(runner: Runner, scope: ProductionPreflightScope): Promise<string> {
  const bindings = rowsOf<{ id: string }>(await runner.execute(sql`
    SELECT b.id
    FROM import_source_property_bindings b
    INNER JOIN company_stores s ON s.id = b.destination_store_id
    WHERE b.company_id = ${scope.companyId}
      AND b.source_system = ${scope.sourceSystem}
      AND b.source_property_id = ${scope.sourcePropertyId}
      AND b.destination_store_id = ${scope.storeId}
      AND b.active = 1
      AND s.company_id = ${scope.companyId}
  `));
  if (bindings.length !== 1) {
    throw new OrderlyProductionPreflightError(
      'Expected exactly one active ORDERLY property binding owned by the reviewed company/store.',
    );
  }
  return bindings[0].id;
}

async function readCatalogFingerprint(runner: Runner, companyId: string) {
  const [inventoryItemCount, vendorItemCount, mappingCount] = await Promise.all([
    numberOf(await runner.execute(sql`SELECT COUNT(*)::int AS value FROM inventory_items WHERE company_id = ${companyId}`)),
    numberOf(await runner.execute(sql`
      SELECT COUNT(*)::int AS value FROM vendor_items vi
      INNER JOIN vendors v ON v.id = vi.vendor_id
      WHERE v.company_id = ${companyId}
    `)),
    numberOf(await runner.execute(sql`
      SELECT COUNT(*)::int AS value FROM vendor_item_external_mappings
      WHERE company_id = ${companyId} AND source_system = 'ORDERLY'
    `)),
  ]);
  return { inventoryItemCount, vendorItemCount, vendorItemMappingCount: mappingCount };
}

export function assertCatalogFingerprintStable(
  before: Record<string, number>,
  after: Record<string, number>,
): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new OrderlyProductionPreflightError(
      'Catalog fingerprint changed during the read-only preflight; schedule a writer-quiescence window and rerun.',
    );
  }
}

async function readCatalogIntegrity(runner: Runner, scope: ProductionPreflightScope) {
  const [duplicateSkuIdentities, duplicateMappings, orphanMappings] = await Promise.all([
    numberOf(await runner.execute(sql`
      SELECT COALESCE(SUM(n - 1), 0)::int AS value FROM (
        SELECT COUNT(*)::int AS n
        FROM vendor_items vi INNER JOIN vendors v ON v.id = vi.vendor_id
        WHERE v.company_id = ${scope.companyId}
          AND vi.vendor_sku IS NOT NULL AND btrim(vi.vendor_sku) <> ''
        GROUP BY vi.vendor_id, vi.inventory_item_id, vi.vendor_sku HAVING COUNT(*) > 1
      ) duplicates
    `)),
    numberOf(await runner.execute(sql`
      SELECT COALESCE(SUM(n - 1), 0)::int AS value FROM (
        SELECT COUNT(*)::int AS n
        FROM vendor_item_external_mappings
        WHERE company_id = ${scope.companyId} AND source_system = ${scope.sourceSystem}
          AND source_property_id = ${scope.sourcePropertyId}
        GROUP BY source_external_id HAVING COUNT(*) > 1
      ) duplicates
    `)),
    numberOf(await runner.execute(sql`
      SELECT COUNT(*)::int AS value
      FROM vendor_item_external_mappings m
      LEFT JOIN vendor_items vi ON vi.id = m.vendor_item_id
      LEFT JOIN vendors v ON v.id = vi.vendor_id AND v.company_id = ${scope.companyId}
      WHERE m.company_id = ${scope.companyId} AND m.source_system = ${scope.sourceSystem}
        AND m.source_property_id = ${scope.sourcePropertyId} AND (vi.id IS NULL OR v.id IS NULL)
    `)),
  ]);
  if (duplicateSkuIdentities || duplicateMappings || orphanMappings) {
    throw new OrderlyProductionPreflightError(
      `Catalog integrity is not safe for a later preview: duplicate SKU identities=${duplicateSkuIdentities}, ` +
      `duplicate ORDERLY mappings=${duplicateMappings}, orphan/cross-company mappings=${orphanMappings}.`,
    );
  }
  return { duplicateSkuIdentities, duplicateMappings, orphanMappings };
}

async function readFrozenMappingEvidence(
  runner: Runner,
  scope: ProductionPreflightScope,
  candidates: readonly OrderlyAdoptionFrozenCandidate[],
) {
  const mappings = rowsOf<MappingRow>(await runner.execute(sql`
    SELECT m.source_external_id, m.vendor_item_id, vi.vendor_id, vi.inventory_item_id,
           vi.vendor_sku, vi.case_size, vi.inner_pack_size, vi.pack_uom
    FROM vendor_item_external_mappings m
    LEFT JOIN vendor_items vi ON vi.id = m.vendor_item_id
    WHERE m.company_id = ${scope.companyId} AND m.source_system = ${scope.sourceSystem}
      AND m.source_property_id = ${scope.sourcePropertyId}
  `));
  const mappingByExternalId = new Map(mappings.map(row => [row.source_external_id, row]));
  let exactFrozenTarget = 0;
  let mappingMissing = 0;
  let mappingTargetMismatch = 0;
  for (const candidate of candidates) {
    const mapping = mappingByExternalId.get(candidate.proposedProvenanceMapping.sourceExternalId);
    if (!mapping) mappingMissing++;
    else if (frozenTargetMatchesMapping(mapping, candidate)) exactFrozenTarget++;
    else mappingTargetMismatch++;
  }
  return { exactFrozenTarget, mappingMissing, mappingTargetMismatch };
}

/**
 * Runs all data checks inside a PostgreSQL read-only transaction and proves the
 * catalog fingerprint did not change while the preflight observed it.
 */
export async function runOrderlyProductionPreflight(
  input: ProductionPreflightInput,
  runner: Runner = db,
) {
  assertProductionPreflightOperatorInputs(input);
  const evidence = assertOrderlyProductionPreflightEvidence(
    input.manifest,
    input.rawSpecs,
    input.rawSourceFileSha256,
  );

  return runner.transaction(async (tx: Runner) => {
    await tx.execute('SET TRANSACTION READ ONLY');
    const schema = await assertRequiredSchema(tx);
    const bindingId = await assertScopeBinding(tx, input.scope);
    const catalogBefore = await readCatalogFingerprint(tx, input.scope.companyId);
    const integrity = await readCatalogIntegrity(tx, input.scope);
    const frozenMappingEvidence = await readFrozenMappingEvidence(tx, input.scope, input.manifest.candidates);
    const catalogAfter = await readCatalogFingerprint(tx, input.scope.companyId);
    assertCatalogFingerprintStable(catalogBefore, catalogAfter);
    return {
      reportVersion: ORDERLY_PRODUCTION_PREFLIGHT_SCHEMA_VERSION,
      mode: 'production-readiness-preflight',
      isProductionPreview: false,
      writesExecuted: 0,
      databaseWritesExecuted: 0,
      generatedAt: new Date().toISOString(),
      evidence: {
        manifestId: input.manifest.manifestId,
        manifestSha256: input.manifest.manifestSha256,
        rawSourceFileSha256: input.rawSourceFileSha256,
        canonicalSourceFingerprint: evidence.canonicalSourceFingerprint,
        normalizedRelationshipCount: evidence.normalizedRelationshipCount,
        candidateCount: input.manifest.candidateCount,
      },
      scope: input.scope,
      bindingId,
      build: {
        ...input.build,
        liveApiBuild: {
          buildId: input.liveApiBuildId,
          buildInfoUrl: localApiBuildInfoUrl(input.liveApiPort),
          checkedAt: new Date().toISOString(),
        },
      },
      database: describeDatabaseTarget(),
      schema,
      catalog: { before: catalogBefore, after: catalogAfter, unchanged: true },
      integrity,
      frozenMappingEvidence,
      nextAllowedStep: 'Obtain PM authorization, then run the separately-authorized production preview during the writer-quiescence window.',
    };
  });
}

export function sha256File(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The live-build endpoint is intentionally loopback-only and path-pinned.
 * Preflight must run on the same production host as the serving API; accepting
 * an arbitrary URL here would let another service impersonate the API build.
 */
export function localApiBuildInfoUrl(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API port must be an integer from 1 through 65535.');
  }
  return `http://127.0.0.1:${port}/api/build-info`;
}