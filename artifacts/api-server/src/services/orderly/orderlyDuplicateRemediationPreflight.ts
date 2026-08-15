/**
 * Read-only database readiness checks shared by remediation operator entry
 * points. This module deliberately has no customer, source-system, or property
 * assumptions; a production CLI owns that authorization boundary.
 */
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { type RemediationScope } from './orderlyDuplicateRemediation';

export class RemediationPreconditionError extends Error {
  readonly code = 'PRECONDITION_FAILED';

  constructor(message: string) {
    super(`[PRECONDITION_FAILED] ${message}`);
    this.name = 'RemediationPreconditionError';
  }
}

export interface RemediationPreflightResult {
  scope: RemediationScope;
  verifiedTables: string[];
  verifiedColumns: string[];
  verifiedIndexes: string[];
}

const REQUIRED_TABLES = [
  'company_stores',
  'import_source_property_bindings',
  'inventory_items',
  'inventory_item_remediation_audit',
  'inventory_import_batches',
  'inventory_import_rows',
  'inventory_item_external_mappings',
  'inventory_counts',
  'inventory_count_lines',
] as const;

const REQUIRED_COLUMNS: Array<[table: string, column: string]> = [
  ['inventory_items', 'superseded_by_item_id'],
  ['inventory_items', 'superseded_at'],
  ['inventory_items', 'superseded_reason'],
  ['inventory_item_remediation_audit', 'company_id'],
  ['inventory_item_remediation_audit', 'source_system'],
  ['inventory_item_remediation_audit', 'source_property_id'],
  ['inventory_item_remediation_audit', 'source_external_id'],
  ['inventory_item_remediation_audit', 'manifest_id'],
  ['inventory_item_remediation_audit', 'report_hash'],
  ['inventory_item_remediation_audit', 'operator_id'],
  ['import_source_property_bindings', 'company_id'],
  ['import_source_property_bindings', 'source_system'],
  ['import_source_property_bindings', 'source_property_id'],
  ['import_source_property_bindings', 'destination_store_id'],
  ['inventory_import_batches', 'source_property_id'],
  ['inventory_import_batches', 'source_property_binding_id'],
];

const REQUIRED_INDEXES = [
  'inventory_items_superseded_idx',
  'inv_item_remediation_audit_company_idx',
  'inv_item_remediation_audit_manifest_idx',
  'inv_item_remediation_audit_group_idx',
  'import_source_property_unique',
] as const;

type QueryRows<T> = { rows: T[] };

function rowsOf<T>(result: unknown): T[] {
  return (result as QueryRows<T>).rows ?? [];
}

/**
 * Confirms the database has the immutable remediation/audit support and that
 * this exact source property is actively bound to the requested destination.
 * Every statement is SELECT-only; this must never call the schema migrator.
 */
export async function preflightRemediationDatabase(
  scope: RemediationScope,
  runner: typeof db = db,
): Promise<RemediationPreflightResult> {
  const tables = rowsOf<{ table_name: string }>(
    await runner.execute(sql.raw(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${REQUIRED_TABLES.map(table => `'${table}'`).join(', ')})
    `)),
  ).map(row => row.table_name);
  const missingTables = REQUIRED_TABLES.filter(table => !tables.includes(table));
  if (missingTables.length) {
    throw new RemediationPreconditionError(
      `Missing required table(s): ${missingTables.join(', ')}. Deploy the normal application migration before remediation.`,
    );
  }

  const columns = rowsOf<{ table_name: string; column_name: string }>(
    await runner.execute(sql.raw(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (${REQUIRED_COLUMNS.map(
          ([table, column]) => `('${table}', '${column}')`,
        ).join(', ')})
    `)),
  );
  const actualColumns = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
  const missingColumns = REQUIRED_COLUMNS
    .map(([table, column]) => `${table}.${column}`)
    .filter(column => !actualColumns.has(column));
  if (missingColumns.length) {
    throw new RemediationPreconditionError(
      `Missing required column(s): ${missingColumns.join(', ')}. Deploy the normal application migration before remediation.`,
    );
  }

  const indexes = rowsOf<{ indexname: string }>(
    await runner.execute(sql.raw(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (${REQUIRED_INDEXES.map(index => `'${index}'`).join(', ')})
    `)),
  ).map(row => row.indexname);
  const missingIndexes = REQUIRED_INDEXES.filter(index => !indexes.includes(index));
  if (missingIndexes.length) {
    throw new RemediationPreconditionError(
      `Missing required index or constraint(s): ${missingIndexes.join(', ')}. Deploy the normal application migration before remediation.`,
    );
  }

  const bindings = rowsOf<{
    company_id: string;
    source_system: string;
    source_property_id: string;
    destination_store_id: string;
    active: number;
  }>(
    await runner.execute(sql`
      SELECT company_id, source_system, source_property_id, destination_store_id, active
      FROM import_source_property_bindings
      WHERE company_id = ${scope.companyId}
        AND source_system = ${scope.sourceSystem}
        AND source_property_id = ${scope.sourcePropertyId}
        AND destination_store_id = ${scope.storeId}
        AND active = 1
    `),
  );
  if (bindings.length !== 1) {
    throw new RemediationPreconditionError(
      `No active ${scope.sourceSystem} binding for property ${scope.sourcePropertyId} to store ${scope.storeId} in company ${scope.companyId}.`,
    );
  }

  return {
    scope,
    verifiedTables: [...REQUIRED_TABLES],
    verifiedColumns: REQUIRED_COLUMNS.map(([table, column]) => `${table}.${column}`),
    verifiedIndexes: [...REQUIRED_INDEXES],
  };
}