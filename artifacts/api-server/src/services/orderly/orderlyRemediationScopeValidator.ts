/**
 * THE authoritative scope validator for Orderly duplicate remediation (Task #1141).
 *
 * Why this module exists
 * ─────────────────────────────────────────────────────────────────────────────
 * A production APPLY of the Bay Hill Batch 1 manifest discovered cross-property
 * external mappings only AFTER mutation had started. It stopped correctly and
 * mutated nothing, but the blocker was discoverable by a read-only query the
 * whole time. The gap was not the check — the check was right — it was that the
 * check only ever ran inside the mutation path, one group at a time.
 *
 * The invariant this module exists to enforce:
 *
 *   APPLY must never discover a scope blocker that manifest-aware read-only
 *   preflight could have discovered first.
 *
 * The only way to guarantee that is for both paths to run the SAME code over
 * the same evidence, not two implementations that are meant to agree. So:
 *
 *   - `evaluateGroupScope` is the single decision function. It returns the
 *     violations, and the exact stop reason string APPLY raises.
 *   - `assertGroupExclusiveToScope` (the APPLY path) is a thin throwing wrapper
 *     over it.
 *   - `evaluateManifestScope` (the preflight path) runs the same function over
 *     every group in a manifest and collects every blocker.
 *
 * A future change to the scope rules therefore lands in both paths by
 * construction; there is no second copy that can drift.
 *
 * Fail-closed posture
 * ─────────────────────────────────────────────────────────────────────────────
 * Absence of scope metadata is never read as permission. A NULL or empty
 * `source_property_id` is neither automatically foreign nor automatically safe:
 * it is a blocker that carries a DIAGNOSTIC classification (see
 * `MappingScopeClass`) for a human to rule on. Nothing in this module can
 * authorize such a mapping, unless a caller supplies a narrowly bounded,
 * positively-evidenced legacy-adoption authorization (defined below).
 */

import { and, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import {
  importSourcePropertyBindings,
  inventoryCountLines,
  inventoryCounts,
  inventoryImportBatches,
  inventoryImportRows,
  inventoryItemExternalMappings,
  inventoryItems,
  storeInventoryItems,
  transferLogs,
  wasteLogs,
} from '@workspace/db';

// ─── Scope ────────────────────────────────────────────────────────────────────

export interface RemediationScope {
  companyId: string;
  /** Destination store bound to the source property. */
  storeId: string;
  sourceSystem: string;
  /** Approved source property. Legacy pre-binding rows use ''. */
  sourcePropertyId: string;
}

/**
 * A deliberately narrow policy approved for one historical remediation. This
 * is data supplied by trusted operator code, not something read from a
 * manifest: a hand-edited manifest must never be able to grant itself a scope
 * exception.
 */
export interface LegacyAdoptionPolicy {
  policyId: string;
  scope: RemediationScope;
  manifestId: string;
  reportHash: string;
  unapprovedReportHash: string;
  expectedGroupCount: number;
  expectedScopedLegacyBatchCount: number;
}

/**
 * Binds a trusted legacy-adoption policy to the exact manifest presently being
 * preflighted or applied. The validator checks every field again; merely
 * providing this object is not permission.
 */
export interface LegacyAdoptionAuthorization {
  policy: LegacyAdoptionPolicy;
  manifestId: string;
  reportHash: string;
  unapprovedReportHash: string;
  groupCount: number;
}

// ─── Batch scope resolution ───────────────────────────────────────────────────

export interface ScopedBatch {
  id: string;
  inventoryDate: string | null;
  approvedAt: Date | null;
  uploadedAt: Date;
  /**
   * How this batch entered scope. `bound` batches carry the scope columns
   * themselves; `adopted` batches are legacy pre-binding batches attributed by
   * count-session evidence.
   */
  attribution: 'bound' | 'adopted';
}

/**
 * `NOT IN (...)` over a resolved batch-id set, for the fail-closed provenance
 * checks. An empty set means nothing is in scope, so everything is a violation
 * — expressed as `true` rather than an empty `NOT IN`, which SQL would
 * evaluate the wrong way round.
 */
export function batchNotInScope(column: SQL | AnyColumn, scopedBatchIds: string[]): SQL {
  if (scopedBatchIds.length === 0) return sql`true`;
  return sql`${column} not in (${sql.join(
    scopedBatchIds.map(id => sql`${id}`),
    sql`, `,
  )})`;
}

export interface ScopedBatchResolution {
  batches: ScopedBatch[];
  /**
   * True when legacy unset-scope batches may be attributed to this scope at
   * all: this scope's property is the ONLY active source property bound to this
   * store, so a batch proven to belong to this store has no other possible
   * property owner.
   */
  legacyAdoptionPermitted: boolean;
  /** Batches skipped despite matching company/system/approved, with a reason. */
  rejected: Array<{ id: string; reason: string }>;
}

/**
 * Resolves which approved import batches belong to a remediation scope.
 *
 * The original implementation required `target_store_id` and
 * `source_property_id` to equal the scope exactly. Both columns were added with
 * the source-property binding contract, so batches imported BEFORE that contract
 * carry NULL in one or both. Requiring an exact match silently excluded every
 * legacy batch — the rows, and therefore every duplicate identity that only
 * legacy provenance can prove, were invisible to discovery before a single row
 * was examined.
 *
 * Widening the predicate to "NULL matches anything" would be wrong: two Orderly
 * properties can feed the same store, and two stores can exist in one company,
 * so an unset batch is genuinely ambiguous in the general case. Instead, a
 * legacy batch is adopted only when BOTH hold:
 *
 *   1. This property is the ONLY active source property bound to this store.
 *      If a second property also feeds this store, an unset batch proven to
 *      belong to the store is still ambiguous between them, and none is
 *      adopted. Bindings pointing at OTHER stores are irrelevant here —
 *      condition 2 already rules those out per batch.
 *   2. The individual batch is positively attributable — every count session
 *      sourced from it belongs to this company and store, and at least one such
 *      session exists. Absence of evidence is not evidence: a batch with no
 *      sessions is left out rather than assumed.
 *
 * Together these mean an adopted batch is provably this store's, and this store
 * has exactly one property it could have come from.
 *
 * A batch whose columns are SET to a different store or property is never
 * adopted; only unset columns are resolved this way.
 */
export async function resolveScopedBatches(
  scope: RemediationScope,
  runner: typeof db = db,
): Promise<ScopedBatchResolution> {
  const candidates = (await runner
    .select({
      id: inventoryImportBatches.id,
      inventoryDate: inventoryImportBatches.inventoryDate,
      approvedAt: inventoryImportBatches.approvedAt,
      uploadedAt: inventoryImportBatches.uploadedAt,
      targetStoreId: inventoryImportBatches.targetStoreId,
      sourcePropertyId: inventoryImportBatches.sourcePropertyId,
    })
    .from(inventoryImportBatches)
    .where(
      and(
        eq(inventoryImportBatches.companyId, scope.companyId),
        eq(inventoryImportBatches.sourceSystem, scope.sourceSystem),
        eq(inventoryImportBatches.status, 'approved'),
      ),
    )) as Array<{
    id: string;
    inventoryDate: string | null;
    approvedAt: Date | null;
    uploadedAt: Date;
    targetStoreId: string | null;
    sourcePropertyId: string | null;
  }>;

  // Condition 1: is this property the only one that feeds THIS store? Bindings
  // for other stores are deliberately not considered — a batch is only adopted
  // once condition 2 has proven it belongs to this store, at which point the
  // only remaining ambiguity is between properties feeding that same store.
  const storeBindings = (await runner
    .select({ sourcePropertyId: importSourcePropertyBindings.sourcePropertyId })
    .from(importSourcePropertyBindings)
    .where(
      and(
        eq(importSourcePropertyBindings.companyId, scope.companyId),
        eq(importSourcePropertyBindings.sourceSystem, scope.sourceSystem),
        eq(importSourcePropertyBindings.destinationStoreId, scope.storeId),
        eq(importSourcePropertyBindings.active, 1),
      ),
    )) as Array<{ sourcePropertyId: string }>;

  const legacyAdoptionPermitted =
    storeBindings.length === 1 && storeBindings[0].sourcePropertyId === scope.sourcePropertyId;

  const batches: ScopedBatch[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  const needsEvidence: typeof candidates = [];

  for (const batch of candidates) {
    const storeSet = batch.targetStoreId != null && batch.targetStoreId !== '';
    const propertySet = batch.sourcePropertyId != null && batch.sourcePropertyId !== '';

    if (storeSet && batch.targetStoreId !== scope.storeId) {
      rejected.push({ id: batch.id, reason: 'batch is bound to a different destination store' });
      continue;
    }
    if (propertySet && batch.sourcePropertyId !== scope.sourcePropertyId) {
      rejected.push({ id: batch.id, reason: 'batch is bound to a different source property' });
      continue;
    }
    if (storeSet && propertySet) {
      batches.push({ ...batch, attribution: 'bound' });
      continue;
    }
    // At least one scope column is unset — legacy pre-binding batch.
    if (!legacyAdoptionPermitted) {
      rejected.push({
        id: batch.id,
        reason:
          'legacy batch has unset scope columns and this company/source system has more than one ' +
          'active binding, so its owner is ambiguous',
      });
      continue;
    }
    needsEvidence.push(batch);
  }

  // Condition 2: positive count-session attribution, per batch.
  if (needsEvidence.length > 0) {
    const evidence = (await runner
      .select({
        batchId: inventoryCounts.sourceBatchId,
        total: sql<number>`count(*)`,
        inScope: sql<number>`count(*) filter (
          where ${inventoryCounts.companyId} = ${scope.companyId}
            and ${inventoryCounts.storeId} = ${scope.storeId}
        )`,
      })
      .from(inventoryCounts)
      .where(
        inArray(
          inventoryCounts.sourceBatchId,
          needsEvidence.map(batch => batch.id),
        ),
      )
      .groupBy(inventoryCounts.sourceBatchId)) as Array<{
      batchId: string | null;
      total: number | string;
      inScope: number | string;
    }>;

    const byBatch = new Map(
      evidence.map(row => [row.batchId ?? '', { total: Number(row.total), inScope: Number(row.inScope) }]),
    );

    for (const batch of needsEvidence) {
      const seen = byBatch.get(batch.id);
      if (!seen || seen.total === 0) {
        rejected.push({
          id: batch.id,
          reason: 'legacy batch has no count sessions, so it cannot be attributed to this store',
        });
        continue;
      }
      if (seen.inScope !== seen.total) {
        rejected.push({
          id: batch.id,
          reason: 'legacy batch has count sessions at another store or company',
        });
        continue;
      }
      batches.push({ ...batch, attribution: 'adopted' });
    }
  }

  return { batches, legacyAdoptionPermitted, rejected };
}

// ─── Scope violations ─────────────────────────────────────────────────────────

/**
 * Every condition capable of stopping APPLY with OUT_OF_SCOPE_REFERENCE.
 *
 * The `label` is part of the operator-visible stop reason and is recorded on
 * audit rows, so it is a contract: preflight and APPLY must produce byte
 * identical text for the same evidence. That is why the labels live here, next
 * to the predicates, rather than being re-written by each caller.
 */
export type ScopeViolationKind =
  | 'STORE_INVENTORY_OTHER_STORE'
  | 'EXTERNAL_MAPPING_OTHER_SOURCE_OR_PROPERTY'
  | 'EXTERNAL_MAPPING_OTHER_COMPANY'
  | 'COUNT_LINES_OUTSIDE_SCOPE'
  | 'IMPORT_ROWS_OUTSIDE_SCOPE'
  | 'WASTE_LOGS_OTHER_STORE'
  | 'TRANSFERS_OTHER_STORE';

export interface ScopeViolation {
  kind: ScopeViolationKind;
  /** Human-readable fragment used verbatim in the stop reason. */
  label: string;
  count: number;
  /** Bounded sample of offending row ids, populated only when evidence was requested. */
  sampleIds: string[];
}

/**
 * Diagnostic classification for a mapping that failed the scope predicate.
 *
 * These are DIAGNOSTIC ONLY. Nothing in this module, and nothing downstream of
 * it, may treat class A as authorized, repair it, or let it participate in a
 * remediation. Turning any A-class mapping into an allowed one requires an
 * explicit Product Owner policy decision and a code change that states it.
 */
export type MappingScopeClass =
  /** Evidence points at this property's own legacy history, but scope metadata is missing. */
  | 'A_LEGACY_MISSING_SCOPE'
  /** Evidence establishes a different company, source system, or property. */
  | 'B_DEMONSTRABLY_FOREIGN'
  /** Evidence cannot safely establish either A or B. */
  | 'C_AMBIGUOUS';

export interface ExternalMappingEvidence {
  mappingId: string;
  /** The inventory item this mapping binds an external identity to. */
  ownerInventoryItemId: string;
  companyId: string;
  sourceSystem: string;
  /** Raw stored value: `null` and `''` are preserved distinctly, never coalesced away. */
  sourcePropertyId: string | null;
  sourceExternalId: string;
  inScope: boolean;
  /** Present for a classified missing/foreign mapping, even if a narrow policy authorizes A. */
  classification: MappingScopeClass | null;
  /** Deterministic, human-readable justification for `classification`. */
  classificationReason: string | null;
  /** True only for a positively-proven Class A mapping under an exact policy binding. */
  authorizedByLegacyAdoptionPolicy: boolean;
}

export interface ItemProvenance {
  itemId: string;
  /** Import rows resolved to this item from a batch inside the approved scope. */
  scopedImportRows: number;
  /** Import rows resolved to this item from any other batch (or no batch). */
  unscopedImportRows: number;
  /** Count lines for this item in a session provably inside the approved scope. */
  scopedCountLines: number;
  /** Count lines whose session cannot be attributed to the approved scope. */
  unscopedCountLines: number;
  /** Store-inventory rows held at a store other than the approved one. */
  otherStoreInventoryRows: number;
  /** Whether the item row itself is owned by the approved company. */
  ownedByScopeCompany: boolean;
}

export interface GroupScopeEvaluation {
  sourceExternalId: string;
  canonicalItemId: string;
  supersededItemIds: string[];
  /** Canonical + siblings, the exact id set APPLY would repoint. */
  itemIds: string[];
  /** True when APPLY would NOT raise OUT_OF_SCOPE_REFERENCE for this group. */
  inScope: boolean;
  violations: ScopeViolation[];
  /** The exact message APPLY throws, or null when the group is in scope. */
  stopReason: string | null;
  /** Every external mapping on these items, in-scope ones included. */
  mappings: ExternalMappingEvidence[];
  /** Per-item provenance actually used by the classifier. */
  provenance: ItemProvenance[];
  /** Batch ids the scope resolved to, i.e. the provenance the checks trust. */
  scopedBatchIds: string[];
  legacyAdoptionPermitted: boolean;
}

const SAMPLE_LIMIT = 20;

function num(row: { n: number | string } | undefined): number {
  return Number(row?.n ?? 0);
}

/**
 * Builds the OUT_OF_SCOPE_REFERENCE message.
 *
 * Kept as one function so the APPLY throw and the preflight report cannot
 * describe the same evidence differently.
 */
export function describeScopeViolations(
  scope: RemediationScope,
  violations: ScopeViolation[],
): string {
  const rendered = violations.map(violation => `${violation.label} (${violation.count})`);
  return (
    `OUT_OF_SCOPE_REFERENCE: this group's items are referenced outside the approved scope ` +
    `(store ${scope.storeId}, ${scope.sourceSystem} property ` +
    `${scope.sourcePropertyId || 'legacy'}): ${rendered.join('; ')}. Approval covers one ` +
    'property’s data, so merging would rewrite records it does not authorize — stopping ' +
    'this group without mutation.'
  );
}

/**
 * Classifies a mapping that failed the scope predicate.
 *
 * Deterministic and evidence-ordered: company, then source system, then a SET
 * foreign property are all positive proof of foreignness (B). Only a genuinely
 * missing property value reaches the legacy question, and it becomes A only
 * when the item's own provenance is entirely inside this scope AND this store
 * has exactly one active property binding — i.e. there is no other property the
 * mapping could belong to. Anything short of that is C.
 */
function classifyMapping(
  scope: RemediationScope,
  mapping: {
    companyId: string;
    sourceSystem: string;
    sourcePropertyId: string | null;
    ownerInventoryItemId: string;
  },
  provenance: Map<string, ItemProvenance>,
  legacyAdoptionPermitted: boolean,
): { classification: MappingScopeClass; reason: string } {
  if (mapping.companyId !== scope.companyId) {
    return {
      classification: 'B_DEMONSTRABLY_FOREIGN',
      reason: `mapping is owned by company ${mapping.companyId}, not the approved company`,
    };
  }
  if (mapping.sourceSystem !== scope.sourceSystem) {
    return {
      classification: 'B_DEMONSTRABLY_FOREIGN',
      reason: `mapping belongs to source system ${mapping.sourceSystem}, not ${scope.sourceSystem}`,
    };
  }

  const property = mapping.sourcePropertyId;
  const propertyMissing = property === null || property === '';
  if (!propertyMissing) {
    return {
      classification: 'B_DEMONSTRABLY_FOREIGN',
      reason: `mapping is bound to source property ${property}, not the approved property ${scope.sourcePropertyId}`,
    };
  }

  // Property is genuinely unset. NULL is not foreign merely for being NULL, and
  // it is certainly not safe — it is a question about ownership.
  if (!legacyAdoptionPermitted) {
    return {
      classification: 'C_AMBIGUOUS',
      reason:
        'mapping has no source property recorded and this store has more than one active source ' +
        'property binding, so its owner cannot be established',
    };
  }

  const owner = provenance.get(mapping.ownerInventoryItemId);
  if (!owner) {
    return {
      classification: 'C_AMBIGUOUS',
      reason: 'mapping has no source property recorded and its item provenance could not be read',
    };
  }
  if (!owner.ownedByScopeCompany) {
    return {
      classification: 'B_DEMONSTRABLY_FOREIGN',
      reason: 'mapping points at an inventory item owned by another company',
    };
  }

  const disqualifiers: string[] = [];
  if (owner.scopedImportRows === 0) {
    disqualifiers.push('the item has no import provenance inside the approved scope');
  }
  if (owner.unscopedImportRows > 0) {
    disqualifiers.push(`the item has ${owner.unscopedImportRows} import row(s) outside the approved scope`);
  }
  if (owner.unscopedCountLines > 0) {
    disqualifiers.push(`the item has ${owner.unscopedCountLines} count line(s) outside the approved scope`);
  }
  if (owner.otherStoreInventoryRows > 0) {
    disqualifiers.push(`the item holds stock at ${owner.otherStoreInventoryRows} other store row(s)`);
  }

  if (disqualifiers.length > 0) {
    return {
      classification: 'C_AMBIGUOUS',
      reason:
        'mapping has no source property recorded, and its item cannot be attributed to this ' +
        `property either: ${disqualifiers.join('; ')}`,
    };
  }

  return {
    classification: 'A_LEGACY_MISSING_SCOPE',
    reason:
      'mapping has no source property recorded, but this store has exactly one active source ' +
      'property binding and every import row and count line on its item resolves inside the ' +
      'approved scope. DIAGNOSTIC ONLY — not authorized for remediation.',
  };
}

/**
 * Reads the per-item provenance the classifier depends on.
 *
 * Separate from the violation queries on purpose: violations are group-level
 * ("does anything here leave the scope"), classification is item-level ("which
 * item is the offender and what does its own history say").
 */
async function collectItemProvenance(
  runner: typeof db,
  scope: RemediationScope,
  itemIds: string[],
  scopedBatchIds: string[],
): Promise<Map<string, ItemProvenance>> {
  if (itemIds.length === 0) return new Map();

  const [importRows, countRows, storeRows, ownedRows] = await Promise.all([
    runner
      .select({
        itemId: inventoryImportRows.resolvedInventoryItemId,
        scoped: sql<number>`count(*) filter (where not ${batchNotInScope(
          sql`coalesce(${inventoryImportRows.batchId}, '')`,
          scopedBatchIds,
        )})`,
        unscoped: sql<number>`count(*) filter (where ${batchNotInScope(
          sql`coalesce(${inventoryImportRows.batchId}, '')`,
          scopedBatchIds,
        )})`,
      })
      .from(inventoryImportRows)
      .where(inArray(inventoryImportRows.resolvedInventoryItemId, itemIds))
      .groupBy(inventoryImportRows.resolvedInventoryItemId) as any,
    runner
      .select({
        itemId: inventoryCountLines.inventoryItemId,
        scoped: sql<number>`count(*) filter (
          where ${inventoryCounts.storeId} = ${scope.storeId}
            and ${inventoryCounts.companyId} = ${scope.companyId}
            and not ${batchNotInScope(
              sql`coalesce(${inventoryCounts.sourceBatchId}, '')`,
              scopedBatchIds,
            )}
        )`,
        unscoped: sql<number>`count(*) filter (
          where ${inventoryCounts.storeId} <> ${scope.storeId}
            or ${inventoryCounts.companyId} <> ${scope.companyId}
            or ${batchNotInScope(
              sql`coalesce(${inventoryCounts.sourceBatchId}, '')`,
              scopedBatchIds,
            )}
        )`,
      })
      .from(inventoryCountLines)
      .innerJoin(inventoryCounts, eq(inventoryCounts.id, inventoryCountLines.inventoryCountId))
      .where(inArray(inventoryCountLines.inventoryItemId, itemIds))
      .groupBy(inventoryCountLines.inventoryItemId) as any,
    runner
      .select({
        itemId: storeInventoryItems.inventoryItemId,
        otherStore: sql<number>`count(*) filter (where ${storeInventoryItems.storeId} <> ${scope.storeId})`,
      })
      .from(storeInventoryItems)
      .where(inArray(storeInventoryItems.inventoryItemId, itemIds))
      .groupBy(storeInventoryItems.inventoryItemId) as any,
    runner
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(
        and(inArray(inventoryItems.id, itemIds), eq(inventoryItems.companyId, scope.companyId)),
      ) as any,
  ]);

  const importByItem = new Map(
    (importRows as Array<{ itemId: string | null; scoped: number | string; unscoped: number | string }>)
      .filter(row => row.itemId != null)
      .map(row => [row.itemId as string, { scoped: Number(row.scoped), unscoped: Number(row.unscoped) }]),
  );
  const countByItem = new Map(
    (countRows as Array<{ itemId: string; scoped: number | string; unscoped: number | string }>).map(row => [
      row.itemId,
      { scoped: Number(row.scoped), unscoped: Number(row.unscoped) },
    ]),
  );
  const storeByItem = new Map(
    (storeRows as Array<{ itemId: string; otherStore: number | string }>).map(row => [
      row.itemId,
      Number(row.otherStore),
    ]),
  );
  const owned = new Set((ownedRows as Array<{ id: string }>).map(row => row.id));

  return new Map(
    itemIds.map(itemId => [
      itemId,
      {
        itemId,
        scopedImportRows: importByItem.get(itemId)?.scoped ?? 0,
        unscopedImportRows: importByItem.get(itemId)?.unscoped ?? 0,
        scopedCountLines: countByItem.get(itemId)?.scoped ?? 0,
        unscopedCountLines: countByItem.get(itemId)?.unscoped ?? 0,
        otherStoreInventoryRows: storeByItem.get(itemId) ?? 0,
        ownedByScopeCompany: owned.has(itemId),
      },
    ]),
  );
}

export interface EvaluateGroupScopeOptions {
  /**
   * Pre-resolved batch scope. APPLY resolves this INSIDE its transaction so the
   * boundary holds under lock; preflight resolves it once for the whole
   * manifest. The resolution itself is identical either way, so passing it in
   * changes cost, never the decision.
   */
  resolution?: ScopedBatchResolution;
  /**
   * Collect bounded row-id samples for violating checks. Evidence never affects
   * the decision — the violation counts come from the same queries regardless.
   */
  collectSamples?: boolean;
  /**
   * Trusted, manifest-bound authorization for an explicitly approved legacy
   * adoption policy. Omit it for the default fail-closed behavior.
   */
  legacyAdoptionAuthorization?: LegacyAdoptionAuthorization;
}

function scopesMatch(left: RemediationScope, right: RemediationScope): boolean {
  return (
    left.companyId === right.companyId &&
    left.storeId === right.storeId &&
    left.sourceSystem === right.sourceSystem &&
    left.sourcePropertyId === right.sourcePropertyId
  );
}

function legacyAdoptionAuthorized(
  authorization: LegacyAdoptionAuthorization | undefined,
  scope: RemediationScope,
  resolution: ScopedBatchResolution,
): boolean {
  if (!authorization) return false;
  const { policy } = authorization;
  return (
    scopesMatch(policy.scope, scope) &&
    authorization.manifestId === policy.manifestId &&
    authorization.reportHash === policy.reportHash &&
    authorization.unapprovedReportHash === policy.unapprovedReportHash &&
    authorization.groupCount === policy.expectedGroupCount &&
    resolution.legacyAdoptionPermitted &&
    resolution.batches.length === policy.expectedScopedLegacyBatchCount &&
    resolution.batches.every(batch => batch.attribution === 'adopted')
  );
}

/**
 * THE scope decision. Every caller — preflight, APPLY, forensics — goes through
 * this function.
 *
 * Returns rather than throws, because preflight needs to keep scanning after
 * the first blocker. `assertGroupExclusiveToScope` adapts it to the throwing
 * contract APPLY relies on.
 */
export async function evaluateGroupScope(
  runner: typeof db,
  scope: RemediationScope,
  group: { sourceExternalId: string; canonicalItemId: string; supersededItemIds: string[] },
  options: EvaluateGroupScopeOptions = {},
): Promise<GroupScopeEvaluation> {
  const itemIds = [group.canonicalItemId, ...group.supersededItemIds];
  const resolution = options.resolution ?? (await resolveScopedBatches(scope, runner));
  const scopedBatchIds = resolution.batches.map(batch => batch.id);
  const wantSamples = options.collectSamples === true;
  const mayAdoptLegacyMappings = legacyAdoptionAuthorized(
    options.legacyAdoptionAuthorization,
    scope,
    resolution,
  );

  // Every mapping on these items, not just the offending ones: the forensic
  // report has to show what the in-scope identity looks like to make sense of
  // what the out-of-scope one is.
  const mappingRows = (await runner
    .select({
      id: inventoryItemExternalMappings.id,
      inventoryItemId: inventoryItemExternalMappings.inventoryItemId,
      companyId: inventoryItemExternalMappings.companyId,
      sourceSystem: inventoryItemExternalMappings.sourceSystem,
      sourcePropertyId: inventoryItemExternalMappings.sourcePropertyId,
      sourceExternalId: inventoryItemExternalMappings.sourceExternalId,
    })
    .from(inventoryItemExternalMappings)
    .where(inArray(inventoryItemExternalMappings.inventoryItemId, itemIds))
    .orderBy(inventoryItemExternalMappings.id)) as Array<{
    id: string;
    inventoryItemId: string;
    companyId: string;
    sourceSystem: string;
    sourcePropertyId: string | null;
    sourceExternalId: string;
  }>;

  // The mapping predicate, expressed once in TypeScript over rows the same
  // query returned. Previously this was a `count(*)` with the predicate in SQL;
  // deriving it from the rows keeps the count and the evidence provably
  // consistent — they cannot disagree about which rows were counted.
  const provenance = await collectItemProvenance(runner, scope, itemIds, scopedBatchIds);

  const mappings: ExternalMappingEvidence[] = mappingRows.map(row => {
    const failsSourceOrProperty =
      row.sourceSystem !== scope.sourceSystem ||
      (row.sourcePropertyId ?? '') !== scope.sourcePropertyId;
    const failsCompany = row.companyId !== scope.companyId;
    const isProblem = failsSourceOrProperty || failsCompany;
    if (!isProblem) {
      return {
        mappingId: row.id,
        ownerInventoryItemId: row.inventoryItemId,
        companyId: row.companyId,
        sourceSystem: row.sourceSystem,
        sourcePropertyId: row.sourcePropertyId,
        sourceExternalId: row.sourceExternalId,
        inScope: true,
        classification: null,
        classificationReason: null,
        authorizedByLegacyAdoptionPolicy: false,
      };
    }
    const verdict = classifyMapping(
      scope,
      {
        companyId: row.companyId,
        sourceSystem: row.sourceSystem,
        sourcePropertyId: row.sourcePropertyId,
        ownerInventoryItemId: row.inventoryItemId,
      },
      provenance,
      resolution.legacyAdoptionPermitted,
    );
    const authorizedByLegacyAdoptionPolicy =
      mayAdoptLegacyMappings && verdict.classification === 'A_LEGACY_MISSING_SCOPE';
    return {
      mappingId: row.id,
      ownerInventoryItemId: row.inventoryItemId,
      companyId: row.companyId,
      sourceSystem: row.sourceSystem,
      sourcePropertyId: row.sourcePropertyId,
      sourceExternalId: row.sourceExternalId,
      inScope: authorizedByLegacyAdoptionPolicy,
      classification: verdict.classification,
      classificationReason: verdict.reason,
      authorizedByLegacyAdoptionPolicy,
    };
  });
  const mappingOutOfSourceOrProperty = mappings.filter(
    mapping =>
      !mapping.inScope &&
      (mapping.sourceSystem !== scope.sourceSystem ||
        (mapping.sourcePropertyId ?? '') !== scope.sourcePropertyId),
  );
  const mappingOtherCompany = mappings.filter(
    mapping => !mapping.inScope && mapping.companyId !== scope.companyId,
  );

  // The remaining checks stay as counts in SQL. Their order here is FIXED and
  // is the order they appear in the stop reason; the previous implementation
  // pushed them as a `Promise.all` resolved, which made the message text
  // nondeterministic for the same evidence.
  const [storeOther, countOutside, importOutside, wasteOther, transferOther] = (await Promise.all([
    runner
      .select({ n: sql<number>`count(*)` })
      .from(storeInventoryItems)
      .where(
        and(
          inArray(storeInventoryItems.inventoryItemId, itemIds),
          sql`${storeInventoryItems.storeId} <> ${scope.storeId}`,
        ),
      ) as any,
    // Count history is the most sensitive thing this tool moves, so it is
    // checked through the SAME provenance chain as import rows, not just by
    // store. Two Orderly properties can legitimately feed the SAME store, so
    // a store-only check would let one property's approval repoint another
    // property's count lines — the repoint moves them by item id, and the item
    // is company-level, so nothing downstream would catch it.
    //
    // Fail closed: a session qualifies only if its source batch is one of the
    // batches RESOLVED into this scope. A session with no batch provenance
    // (manual count), a dangling batch id, or a batch belonging to another
    // property cannot be attributed to the approved property, so it blocks the
    // group for a human to review rather than being assumed safe. The coalesce
    // is what keeps a NULL source batch failing rather than evaluating to NULL
    // and quietly passing the NOT IN test.
    runner
      .select({ n: sql<number>`count(*)` })
      .from(inventoryCountLines)
      .innerJoin(inventoryCounts, eq(inventoryCounts.id, inventoryCountLines.inventoryCountId))
      .where(
        and(
          inArray(inventoryCountLines.inventoryItemId, itemIds),
          sql`(${inventoryCounts.storeId} <> ${scope.storeId}
               or ${inventoryCounts.companyId} <> ${scope.companyId}
               or ${batchNotInScope(
                 sql`coalesce(${inventoryCounts.sourceBatchId}, '')`,
                 scopedBatchIds,
               )})`,
        ),
      ) as any,
    // Mirrors discovery exactly: a row is in scope only if its batch is one
    // discovery resolved. Rows attached to a pending, rejected, or differently
    // bound batch were never reviewed under this approval, so consolidating
    // their provenance onto the canonical is out of scope.
    runner
      .select({ n: sql<number>`count(*)` })
      .from(inventoryImportRows)
      .where(
        and(
          inArray(inventoryImportRows.resolvedInventoryItemId, itemIds),
          batchNotInScope(sql`coalesce(${inventoryImportRows.batchId}, '')`, scopedBatchIds),
        ),
      ) as any,
    runner
      .select({ n: sql<number>`count(*)` })
      .from(wasteLogs)
      .where(
        and(
          inArray(wasteLogs.inventoryItemId, itemIds),
          sql`${wasteLogs.storeId} <> ${scope.storeId}`,
        ),
      ) as any,
    runner
      .select({ n: sql<number>`count(*)` })
      .from(transferLogs)
      .where(
        and(
          inArray(transferLogs.inventoryItemId, itemIds),
          sql`(${transferLogs.fromStoreId} <> ${scope.storeId}
               or ${transferLogs.toStoreId} <> ${scope.storeId})`,
        ),
      ) as any,
  ])) as Array<Array<{ n: number | string }>>;

  const samples = wantSamples
    ? await collectViolationSamples(runner, scope, itemIds, scopedBatchIds)
    : null;

  const violations: ScopeViolation[] = [];
  const push = (
    kind: ScopeViolationKind,
    label: string,
    count: number,
    sampleIds: string[],
  ): void => {
    if (count > 0) violations.push({ kind, label, count, sampleIds });
  };

  push(
    'STORE_INVENTORY_OTHER_STORE',
    'store inventory rows for another store',
    num(storeOther[0]),
    samples?.storeInventory ?? [],
  );
  push(
    'EXTERNAL_MAPPING_OTHER_SOURCE_OR_PROPERTY',
    'external mappings for another source system or property',
    mappingOutOfSourceOrProperty.length,
    mappingOutOfSourceOrProperty.slice(0, SAMPLE_LIMIT).map(row => row.mappingId),
  );
  push(
    'EXTERNAL_MAPPING_OTHER_COMPANY',
    'external mappings owned by another company',
    mappingOtherCompany.length,
    mappingOtherCompany.slice(0, SAMPLE_LIMIT).map(row => row.mappingId),
  );
  push(
    'COUNT_LINES_OUTSIDE_SCOPE',
    'count lines in a session outside the approved store or source property',
    num(countOutside[0]),
    samples?.countLines ?? [],
  );
  push(
    'IMPORT_ROWS_OUTSIDE_SCOPE',
    'import rows from a batch outside the approved scope',
    num(importOutside[0]),
    samples?.importRows ?? [],
  );
  push(
    'WASTE_LOGS_OTHER_STORE',
    'waste logs at another store',
    num(wasteOther[0]),
    samples?.wasteLogs ?? [],
  );
  push(
    'TRANSFERS_OTHER_STORE',
    'transfers involving another store',
    num(transferOther[0]),
    samples?.transfers ?? [],
  );

  return {
    sourceExternalId: group.sourceExternalId,
    canonicalItemId: group.canonicalItemId,
    supersededItemIds: group.supersededItemIds,
    itemIds,
    inScope: violations.length === 0,
    violations,
    stopReason: violations.length === 0 ? null : describeScopeViolations(scope, violations),
    mappings,
    provenance: itemIds.map(
      itemId =>
        provenance.get(itemId) ?? {
          itemId,
          scopedImportRows: 0,
          unscopedImportRows: 0,
          scopedCountLines: 0,
          unscopedCountLines: 0,
          otherStoreInventoryRows: 0,
          ownedByScopeCompany: false,
        },
    ),
    scopedBatchIds,
    legacyAdoptionPermitted: resolution.legacyAdoptionPermitted,
  };
}

async function collectViolationSamples(
  runner: typeof db,
  scope: RemediationScope,
  itemIds: string[],
  scopedBatchIds: string[],
): Promise<{
  storeInventory: string[];
  countLines: string[];
  importRows: string[];
  wasteLogs: string[];
  transfers: string[];
}> {
  const [storeInventory, countLines, importRows, waste, transfers] = (await Promise.all([
    runner
      .select({ id: storeInventoryItems.id })
      .from(storeInventoryItems)
      .where(
        and(
          inArray(storeInventoryItems.inventoryItemId, itemIds),
          sql`${storeInventoryItems.storeId} <> ${scope.storeId}`,
        ),
      )
      .orderBy(storeInventoryItems.id)
      .limit(SAMPLE_LIMIT) as any,
    runner
      .select({ id: inventoryCountLines.id })
      .from(inventoryCountLines)
      .innerJoin(inventoryCounts, eq(inventoryCounts.id, inventoryCountLines.inventoryCountId))
      .where(
        and(
          inArray(inventoryCountLines.inventoryItemId, itemIds),
          sql`(${inventoryCounts.storeId} <> ${scope.storeId}
               or ${inventoryCounts.companyId} <> ${scope.companyId}
               or ${batchNotInScope(
                 sql`coalesce(${inventoryCounts.sourceBatchId}, '')`,
                 scopedBatchIds,
               )})`,
        ),
      )
      .orderBy(inventoryCountLines.id)
      .limit(SAMPLE_LIMIT) as any,
    runner
      .select({ id: inventoryImportRows.id })
      .from(inventoryImportRows)
      .where(
        and(
          inArray(inventoryImportRows.resolvedInventoryItemId, itemIds),
          batchNotInScope(sql`coalesce(${inventoryImportRows.batchId}, '')`, scopedBatchIds),
        ),
      )
      .orderBy(inventoryImportRows.id)
      .limit(SAMPLE_LIMIT) as any,
    runner
      .select({ id: wasteLogs.id })
      .from(wasteLogs)
      .where(
        and(
          inArray(wasteLogs.inventoryItemId, itemIds),
          sql`${wasteLogs.storeId} <> ${scope.storeId}`,
        ),
      )
      .orderBy(wasteLogs.id)
      .limit(SAMPLE_LIMIT) as any,
    runner
      .select({ id: transferLogs.id })
      .from(transferLogs)
      .where(
        and(
          inArray(transferLogs.inventoryItemId, itemIds),
          sql`(${transferLogs.fromStoreId} <> ${scope.storeId}
               or ${transferLogs.toStoreId} <> ${scope.storeId})`,
        ),
      )
      .orderBy(transferLogs.id)
      .limit(SAMPLE_LIMIT) as any,
  ])) as Array<Array<{ id: string }>>;

  return {
    storeInventory: storeInventory.map(row => row.id),
    countLines: countLines.map(row => row.id),
    importRows: importRows.map(row => row.id),
    wasteLogs: waste.map(row => row.id),
    transfers: transfers.map(row => row.id),
  };
}

/**
 * The APPLY-path adapter. Throws the OUT_OF_SCOPE_REFERENCE error the apply loop
 * classifies and audits, using the shared decision above.
 *
 * APPLY keeps calling this from inside its serializable transaction even though
 * preflight has already cleared the manifest. Preflight proves the manifest was
 * clean when it ran; this proves it is still clean under lock at the instant of
 * mutation. Defence in depth, not redundancy.
 */
export async function assertGroupExclusiveToScope(
  tx: typeof db,
  scope: RemediationScope,
  itemIds: string[],
  sourceExternalId = '',
  legacyAdoptionAuthorization?: LegacyAdoptionAuthorization,
): Promise<void> {
  const [canonicalItemId, ...supersededItemIds] = itemIds;
  const evaluation = await evaluateGroupScope(tx, scope, {
    sourceExternalId,
    canonicalItemId,
    supersededItemIds,
  }, { legacyAdoptionAuthorization });
  if (!evaluation.inScope) {
    throw new Error(evaluation.stopReason!);
  }
}

// ─── Manifest-level gate ──────────────────────────────────────────────────────

export interface ManifestGroupItems {
  sourceExternalId: string;
  canonicalItemId: string;
  supersededItemIds: string[];
}

export interface ManifestScopeEvaluation {
  scope: RemediationScope;
  totalGroups: number;
  cleanGroups: number;
  blockedGroups: number;
  /** Every group, in manifest order, clean ones included. */
  groups: GroupScopeEvaluation[];
  /** Blocked groups only, for the operator-facing failure. */
  blockers: GroupScopeEvaluation[];
  scopedBatchIds: string[];
  legacyAdoptionPermitted: boolean;
}

/** Bounded fan-out so an 800+ group manifest does not open a connection per group. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface EvaluateManifestScopeOptions {
  collectSamples?: boolean;
  concurrency?: number;
  /** Invoked after each group so a long production scan can report progress. */
  onProgress?: (completed: number, total: number) => void;
  legacyAdoptionAuthorization?: LegacyAdoptionAuthorization;
}

/**
 * Runs the shared scope decision over EVERY group in a manifest.
 *
 * This is the all-manifest gate. It never stops at the first failure, because
 * the operator needs the complete blocker set to make one decision about the
 * manifest rather than discovering blockers one production run at a time.
 *
 * Read-only: it issues SELECTs exclusively and opens no transaction.
 */
export async function evaluateManifestScope(
  runner: typeof db,
  scope: RemediationScope,
  groups: ManifestGroupItems[],
  options: EvaluateManifestScopeOptions = {},
): Promise<ManifestScopeEvaluation> {
  // Resolved ONCE for the manifest. The per-group path would resolve the same
  // thing 848 times over; the resolution depends only on the scope.
  const resolution = await resolveScopedBatches(scope, runner);

  let completed = 0;
  const evaluations = await mapWithConcurrency(groups, options.concurrency ?? 6, async group => {
    const evaluation = await evaluateGroupScope(runner, scope, group, {
      resolution,
      collectSamples: options.collectSamples,
      legacyAdoptionAuthorization: options.legacyAdoptionAuthorization,
    });
    completed++;
    options.onProgress?.(completed, groups.length);
    return evaluation;
  });

  const blockers = evaluations.filter(evaluation => !evaluation.inScope);
  return {
    scope,
    totalGroups: evaluations.length,
    cleanGroups: evaluations.length - blockers.length,
    blockedGroups: blockers.length,
    groups: evaluations,
    blockers,
    scopedBatchIds: resolution.batches.map(batch => batch.id),
    legacyAdoptionPermitted: resolution.legacyAdoptionPermitted,
  };
}
