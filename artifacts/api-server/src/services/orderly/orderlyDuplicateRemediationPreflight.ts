/**
 * Read-only database readiness checks shared by remediation operator entry
 * points, plus the manifest-aware scope gate added by Task #1141.
 *
 * There are two layers here and they answer different questions:
 *
 *   - `preflightRemediationDatabase` — is this DATABASE ready? Schema objects,
 *     audit table, and an active source-property binding. It deliberately has no
 *     customer or manifest assumptions.
 *
 *   - `preflightManifestScope` — is this MANIFEST applicable? It runs THE
 *     authoritative scope validator over every approved group and refuses the
 *     manifest as a whole if any group anywhere would be blocked.
 *
 * The second exists because a production APPLY once discovered cross-property
 * external mappings only after mutation had begun. It stopped correctly and
 * changed nothing, but the blockers were visible to a read-only query all along
 * — they were simply never asked for until the mutation path asked, one group at
 * a time. The rule that follows from that incident:
 *
 *   APPLY must never discover a scope blocker that manifest-aware read-only
 *   preflight could have discovered first.
 *
 * That is only guaranteed because both paths call the same
 * `evaluateGroupScope` in `orderlyRemediationScopeValidator`, not two
 * implementations intended to agree.
 *
 * Every statement in this module is SELECT-only. It must never call the schema
 * migrator, open a write transaction, or mutate remediation state.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  inventoryItemRemediationAudit,
  inventoryItems,
} from '@workspace/db';
import {
  evaluateManifestScope,
  type ManifestGroupItems,
  type ManifestScopeEvaluation,
  type LegacyAdoptionAuthorization,
  type RemediationScope,
} from './orderlyRemediationScopeValidator';

export class RemediationPreconditionError extends Error {
  readonly code = 'PRECONDITION_FAILED';

  constructor(message: string) {
    super(`[PRECONDITION_FAILED] ${message}`);
    this.name = 'RemediationPreconditionError';
  }
}

/**
 * Raised when the database is ready but the MANIFEST cannot be applied: one or
 * more approved groups would be stopped by the scope validator.
 *
 * Distinct from `RemediationPreconditionError` because the remedy is different.
 * A precondition failure is fixed by deploying a migration; this one is a
 * product/authorization decision about specific groups, and carries the full
 * blocker set so that decision can be made once instead of per failed run.
 */
export class RemediationManifestBlockedError extends Error {
  readonly code = 'MANIFEST_BLOCKED';
  readonly evaluation: ManifestScopeEvaluation;

  constructor(message: string, evaluation: ManifestScopeEvaluation) {
    super(`[MANIFEST_BLOCKED] ${message}`);
    this.name = 'RemediationManifestBlockedError';
    this.evaluation = evaluation;
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

// ─── Manifest-aware scope gate ────────────────────────────────────────────────

export interface ManifestScopePreflightOptions {
  /** Collect bounded offending-row samples for the forensic report. */
  collectSamples?: boolean;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
  /**
   * Return the evaluation instead of throwing on blockers. Used by the forensic
   * report, which must show the full picture rather than fail. The APPLY gate
   * never sets this.
   */
  doNotThrow?: boolean;
  /** Trusted operator binding for a narrow legacy-adoption policy. */
  legacyAdoptionAuthorization?: LegacyAdoptionAuthorization;
}

/**
 * The all-manifest gate.
 *
 * Inspects EVERY group with the same validator APPLY uses, collects EVERY
 * blocker, and refuses the manifest as a whole if even one group is blocked.
 * This is deliberately not per-group lazy validation: a manifest with one bad
 * group in position 800 must fail before group 1 is mutated, so that a partial
 * application never encodes a decision nobody made.
 *
 * Performs zero mutation — no writes, no transaction, SELECTs only.
 */
export async function preflightManifestScope(
  scope: RemediationScope,
  groups: ManifestGroupItems[],
  runner: typeof db = db,
  options: ManifestScopePreflightOptions = {},
): Promise<ManifestScopeEvaluation> {
  if (groups.length === 0) {
    throw new RemediationPreconditionError(
      'Manifest contains no approved groups, so there is nothing to validate.',
    );
  }

  const evaluation = await evaluateManifestScope(runner, scope, groups, {
    collectSamples: options.collectSamples,
    concurrency: options.concurrency,
    onProgress: options.onProgress,
    legacyAdoptionAuthorization: options.legacyAdoptionAuthorization,
  });

  if (evaluation.blockedGroups > 0 && options.doNotThrow !== true) {
    const codes = evaluation.blockers.map(blocker => blocker.sourceExternalId);
    const shown = codes.slice(0, 10).join(', ');
    const overflow = codes.length > 10 ? `, +${codes.length - 10} more` : '';
    throw new RemediationManifestBlockedError(
      `${evaluation.blockedGroups} of ${evaluation.totalGroups} approved group(s) are blocked by ` +
        `the scope validator and would stop during APPLY: ${shown}${overflow}. No group may be ` +
        'remediated while any blocker exists in the manifest — the approval covers one property’s ' +
        'data and these groups reference records outside it. Run --mode forensics for the full ' +
        'per-group evidence and A/B/C classification.',
      evaluation,
    );
  }

  return evaluation;
}

// ─── Suspended-run mutation verification ──────────────────────────────────────

export interface SuspendedRunVerification {
  manifestId: string;
  scope: RemediationScope;
  /** Audit outcome counts for THIS manifest only. */
  auditCounts: { applied: number; alreadyRemediated: number; stopped: number };
  /** Distinct source codes with a stopped row, sorted. */
  stoppedSourceExternalIds: string[];
  /** Distinct failure reasons recorded for this manifest, sorted. */
  failureReasons: string[];
  /**
   * Items superseded by an APPLIED audit row of this manifest. Empty is the
   * expected result for a run that applied nothing.
   */
  supersededItemIds: string[];
  /**
   * Items named as canonical/superseded ANYWHERE in this manifest that are now
   * superseded in the database. This catches supersession attributable to the
   * manifest's item population even if no audit row claims it.
   */
  unexpectedlySupersededItemIds: string[];
  /** True only when every mutation-free condition holds. */
  mutationFree: boolean;
  /** Human-readable reasons `mutationFree` is false. */
  findings: string[];
}

/**
 * Verifies that a specific attempted manifest mutated nothing.
 *
 * Bounded to the manifest under investigation on purpose. Inferring safety from
 * aggregate production state ("no items look superseded") would prove nothing:
 * it cannot distinguish this run's effects from a legitimate earlier repair, and
 * it silently passes when the population it scanned was the wrong one. So every
 * question here is asked as "…caused by THIS manifest id", plus one broader
 * check over exactly the item ids this manifest named.
 *
 * Read-only.
 */
export async function verifySuspendedRunMutationFree(
  scope: RemediationScope,
  manifestId: string,
  manifestGroups: ManifestGroupItems[],
  runner: typeof db = db,
): Promise<SuspendedRunVerification> {
  const auditRows = (await runner
    .select({
      result: inventoryItemRemediationAudit.result,
      sourceExternalId: inventoryItemRemediationAudit.sourceExternalId,
      failureReason: inventoryItemRemediationAudit.failureReason,
      canonicalItemId: inventoryItemRemediationAudit.canonicalItemId,
      supersededItemIds: inventoryItemRemediationAudit.supersededItemIds,
    })
    .from(inventoryItemRemediationAudit)
    .where(
      and(
        eq(inventoryItemRemediationAudit.companyId, scope.companyId),
        eq(inventoryItemRemediationAudit.sourceSystem, scope.sourceSystem),
        eq(inventoryItemRemediationAudit.sourcePropertyId, scope.sourcePropertyId),
        eq(inventoryItemRemediationAudit.manifestId, manifestId),
      ),
    )) as Array<{
    result: string;
    sourceExternalId: string;
    failureReason: string | null;
    canonicalItemId: string;
    supersededItemIds: string[];
  }>;

  const auditCounts = {
    applied: auditRows.filter(row => row.result === 'applied').length,
    alreadyRemediated: auditRows.filter(row => row.result === 'already_remediated').length,
    stopped: auditRows.filter(row => row.result === 'stopped').length,
  };

  const appliedItemIds = [
    ...new Set(
      auditRows
        .filter(row => row.result === 'applied')
        .flatMap(row => row.supersededItemIds ?? []),
    ),
  ].sort();

  // Every item this manifest could possibly have touched, whether or not an
  // audit row mentions it. A repair that committed without its audit row is
  // exactly the failure mode an audit-only check cannot see.
  const manifestItemIds = [
    ...new Set(
      manifestGroups.flatMap(group => [group.canonicalItemId, ...group.supersededItemIds]),
    ),
  ];

  const supersededNow =
    manifestItemIds.length === 0
      ? []
      : ((await runner
          .select({ id: inventoryItems.id })
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.companyId, scope.companyId),
              inArray(inventoryItems.id, manifestItemIds),
              sql`${inventoryItems.supersededByItemId} is not null`,
            ),
          )
          .orderBy(inventoryItems.id)) as Array<{ id: string }>);

  const unexpectedlySupersededItemIds = supersededNow.map(row => row.id);

  const findings: string[] = [];
  if (auditCounts.applied > 0) {
    findings.push(`${auditCounts.applied} APPLIED audit row(s) exist for this manifest`);
  }
  if (auditCounts.alreadyRemediated > 0) {
    findings.push(
      `${auditCounts.alreadyRemediated} ALREADY_REMEDIATED audit row(s) exist for this manifest`,
    );
  }
  if (appliedItemIds.length > 0) {
    findings.push(`${appliedItemIds.length} item(s) were superseded by an APPLIED row`);
  }
  if (unexpectedlySupersededItemIds.length > 0) {
    findings.push(
      `${unexpectedlySupersededItemIds.length} item(s) named by this manifest are superseded in ` +
        'the database',
    );
  }

  return {
    manifestId,
    scope,
    auditCounts,
    stoppedSourceExternalIds: [
      ...new Set(auditRows.filter(row => row.result === 'stopped').map(row => row.sourceExternalId)),
    ].sort(),
    failureReasons: [
      ...new Set(auditRows.map(row => row.failureReason).filter((r): r is string => r != null)),
    ].sort(),
    supersededItemIds: appliedItemIds,
    unexpectedlySupersededItemIds,
    mutationFree: findings.length === 0,
    findings,
  };
}
