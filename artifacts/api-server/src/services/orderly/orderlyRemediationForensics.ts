/**
 * Deterministic read-only forensic reporting for an approved remediation
 * manifest (Task #1141).
 *
 * This answers the question the suspended Bay Hill Batch 1 APPLY could not:
 * "for the WHOLE manifest, exactly which groups are blocked, by what evidence,
 * and what does that evidence suggest about ownership?"
 *
 * Three properties matter and are enforced by construction:
 *
 *   1. Complete. Every group is scanned. There is no early exit on first
 *      failure — a partial blocker list is what turns one blocked manifest into
 *      a sequence of failed production runs.
 *   2. Shared. The scope decision comes from `evaluateGroupScope`, the same
 *      function APPLY calls. This module formats and classifies; it never
 *      re-derives whether something is in scope.
 *   3. Diagnostic. The A/B/C classification is a proposal for a human. Nothing
 *      here authorizes, repairs, or relaxes anything, and class A is not
 *      "approved" — it is "looks like this property's own legacy data, decide".
 *
 * Read-only: SELECTs only, no transaction, no mutation.
 */

import { db } from '../../db';
import {
  type GroupScopeEvaluation,
  type ManifestGroupItems,
  type ManifestScopeEvaluation,
  type MappingScopeClass,
  type RemediationScope,
  type ScopeViolationKind,
} from './orderlyRemediationScopeValidator';
import { preflightManifestScope } from './orderlyDuplicateRemediationPreflight';

export interface ForensicMappingRow {
  mappingId: string;
  ownerInventoryItemId: string;
  companyId: string;
  sourceSystem: string;
  /** Raw stored value. `null` and `''` are reported distinctly and never merged. */
  sourcePropertyId: string | null;
  sourceExternalId: string;
  inScope: boolean;
  classification: MappingScopeClass | null;
  classificationReason: string | null;
}

export interface ForensicGroupReport {
  sourceExternalId: string;
  proposedCanonicalItemId: string;
  siblingItemIds: string[];
  inScope: boolean;
  /** The exact reason APPLY would stop this group, or null. */
  blockerReason: string | null;
  violations: Array<{ kind: ScopeViolationKind; label: string; count: number; sampleIds: string[] }>;
  mappings: ForensicMappingRow[];
  provenance: GroupScopeEvaluation['provenance'];
  /**
   * All diagnostic classes present in this group, sorted. A group with several
   * problem types keeps every one — collapsing to a single label would hide a
   * secondary blocker behind the first.
   */
  classesPresent: MappingScopeClass[];
}

export interface ForensicReport {
  manifestId: string;
  scope: RemediationScope;
  generatedFrom: {
    reportHash: string;
    unapprovedReportHash: string;
    reportVersion: string;
  };
  totals: {
    totalGroups: number;
    cleanGroups: number;
    blockedGroups: number;
    groupsWithClassA: number;
    groupsWithClassB: number;
    groupsWithClassC: number;
    totalMappingsInspected: number;
    problematicMappings: number;
  };
  /** Count of problematic mappings per diagnostic class. */
  mappingClassDistribution: Record<MappingScopeClass, number>;
  /** Blocker kind → number of groups exhibiting it. */
  blockerKindDistribution: Record<string, number>;
  /** Source codes of blocked groups, sorted. */
  affectedSourceExternalIds: string[];
  /** Every group in manifest order, clean ones included. */
  groups: ForensicGroupReport[];
  scopedBatchCount: number;
  legacyAdoptionPermitted: boolean;
}

const ALL_CLASSES: MappingScopeClass[] = [
  'A_LEGACY_MISSING_SCOPE',
  'B_DEMONSTRABLY_FOREIGN',
  'C_AMBIGUOUS',
];

function toGroupReport(evaluation: GroupScopeEvaluation): ForensicGroupReport {
  const classes = [
    ...new Set(
      evaluation.mappings
        .filter(mapping => !mapping.inScope && mapping.classification != null)
        .map(mapping => mapping.classification as MappingScopeClass),
    ),
  ].sort();

  return {
    sourceExternalId: evaluation.sourceExternalId,
    proposedCanonicalItemId: evaluation.canonicalItemId,
    siblingItemIds: evaluation.supersededItemIds,
    inScope: evaluation.inScope,
    blockerReason: evaluation.stopReason,
    violations: evaluation.violations.map(violation => ({
      kind: violation.kind,
      label: violation.label,
      count: violation.count,
      sampleIds: violation.sampleIds,
    })),
    mappings: evaluation.mappings.map(mapping => ({ ...mapping })),
    provenance: evaluation.provenance,
    classesPresent: classes,
  };
}

/**
 * Builds the forensic report for a manifest.
 *
 * Uses `preflightManifestScope` with `doNotThrow`, so the scan is literally the
 * same evaluation the APPLY gate performs — the report cannot describe a
 * different set of blockers than the gate enforces.
 */
export async function buildForensicReport(
  input: {
    manifestId: string;
    scope: RemediationScope;
    reportHash: string;
    unapprovedReportHash: string;
    reportVersion: string;
    groups: ManifestGroupItems[];
  },
  runner: typeof db = db,
  options: { onProgress?: (completed: number, total: number) => void } = {},
): Promise<ForensicReport> {
  const evaluation: ManifestScopeEvaluation = await preflightManifestScope(
    input.scope,
    input.groups,
    runner,
    { collectSamples: true, doNotThrow: true, onProgress: options.onProgress },
  );

  const groups = evaluation.groups.map(toGroupReport);

  const mappingClassDistribution = Object.fromEntries(
    ALL_CLASSES.map(cls => [cls, 0]),
  ) as Record<MappingScopeClass, number>;
  const blockerKindDistribution: Record<string, number> = {};

  let totalMappingsInspected = 0;
  let problematicMappings = 0;

  for (const group of groups) {
    totalMappingsInspected += group.mappings.length;
    for (const mapping of group.mappings) {
      if (mapping.inScope) continue;
      problematicMappings++;
      if (mapping.classification) mappingClassDistribution[mapping.classification]++;
    }
    for (const violation of group.violations) {
      blockerKindDistribution[violation.kind] = (blockerKindDistribution[violation.kind] ?? 0) + 1;
    }
  }

  const hasClass = (group: ForensicGroupReport, cls: MappingScopeClass): boolean =>
    group.classesPresent.includes(cls);

  return {
    manifestId: input.manifestId,
    scope: input.scope,
    generatedFrom: {
      reportHash: input.reportHash,
      unapprovedReportHash: input.unapprovedReportHash,
      reportVersion: input.reportVersion,
    },
    totals: {
      totalGroups: evaluation.totalGroups,
      cleanGroups: evaluation.cleanGroups,
      blockedGroups: evaluation.blockedGroups,
      groupsWithClassA: groups.filter(group => hasClass(group, 'A_LEGACY_MISSING_SCOPE')).length,
      groupsWithClassB: groups.filter(group => hasClass(group, 'B_DEMONSTRABLY_FOREIGN')).length,
      groupsWithClassC: groups.filter(group => hasClass(group, 'C_AMBIGUOUS')).length,
      totalMappingsInspected,
      problematicMappings,
    },
    mappingClassDistribution,
    blockerKindDistribution,
    affectedSourceExternalIds: groups
      .filter(group => !group.inScope)
      .map(group => group.sourceExternalId)
      .sort(),
    groups,
    scopedBatchCount: evaluation.scopedBatchIds.length,
    legacyAdoptionPermitted: evaluation.legacyAdoptionPermitted,
  };
}

/** Renders the forensic report for an operator terminal. */
export function formatForensicReport(report: ForensicReport): string {
  const lines: string[] = [];
  const rule = '─'.repeat(78);

  lines.push(rule);
  lines.push('Orderly remediation FORENSICS (read-only, no writes performed)');
  lines.push(`manifest ${report.manifestId}  report hash ${report.generatedFrom.reportHash}`);
  lines.push(
    `scope company=${report.scope.companyId} store=${report.scope.storeId} ` +
      `source=${report.scope.sourceSystem} property=${report.scope.sourcePropertyId || '(legacy)'}`,
  );
  lines.push(
    `resolved in-scope batches: ${report.scopedBatchCount}   ` +
      `legacy adoption permitted: ${report.legacyAdoptionPermitted ? 'yes' : 'no'}`,
  );
  lines.push(rule);

  for (const group of report.groups) {
    if (group.inScope) continue;
    lines.push(`Source Item Code: ${group.sourceExternalId}   [BLOCKED]`);
    lines.push(`  proposed canonical: ${group.proposedCanonicalItemId}`);
    lines.push(`  siblings: ${group.siblingItemIds.join(', ') || '(none)'}`);
    lines.push('  blockers:');
    for (const violation of group.violations) {
      lines.push(`    ${violation.kind}: ${violation.label} (${violation.count})`);
      if (violation.sampleIds.length > 0) {
        lines.push(`      sample rows: ${violation.sampleIds.join(', ')}`);
      }
    }
    lines.push('  external mappings:');
    for (const mapping of group.mappings) {
      const property =
        mapping.sourcePropertyId === null
          ? 'NULL'
          : mapping.sourcePropertyId === ''
            ? '(empty)'
            : mapping.sourcePropertyId;
      lines.push(
        `    ${mapping.mappingId} owner=${mapping.ownerInventoryItemId} ` +
          `company=${mapping.companyId} system=${mapping.sourceSystem} property=${property} ` +
          `code=${mapping.sourceExternalId} ${mapping.inScope ? 'IN SCOPE' : 'OUT OF SCOPE'}`,
      );
      if (!mapping.inScope) {
        lines.push(`      class ${mapping.classification}: ${mapping.classificationReason}`);
      }
    }
    lines.push('  provenance:');
    for (const item of group.provenance) {
      lines.push(
        `    ${item.itemId} importRows(in/out)=${item.scopedImportRows}/${item.unscopedImportRows} ` +
          `countLines(in/out)=${item.scopedCountLines}/${item.unscopedCountLines} ` +
          `otherStoreRows=${item.otherStoreInventoryRows} ` +
          `ownedByScopeCompany=${item.ownedByScopeCompany}`,
      );
    }
    lines.push('');
  }

  lines.push(rule);
  lines.push('Manifest summary:');
  lines.push(`  total groups:            ${report.totals.totalGroups}`);
  lines.push(`  clean groups:            ${report.totals.cleanGroups}`);
  lines.push(`  blocked groups:          ${report.totals.blockedGroups}`);
  lines.push(`  groups with A evidence:  ${report.totals.groupsWithClassA}`);
  lines.push(`  groups with B evidence:  ${report.totals.groupsWithClassB}`);
  lines.push(`  groups with C evidence:  ${report.totals.groupsWithClassC}`);
  lines.push(`  mappings inspected:      ${report.totals.totalMappingsInspected}`);
  lines.push(`  problematic mappings:    ${report.totals.problematicMappings}`);

  lines.push('\nProblematic mappings by class:');
  for (const cls of ALL_CLASSES) {
    lines.push(`  ${cls}: ${report.mappingClassDistribution[cls]}`);
  }

  lines.push('\nBlocker reason distribution (groups per kind):');
  const kinds = Object.keys(report.blockerKindDistribution).sort();
  if (kinds.length === 0) lines.push('  (none)');
  for (const kind of kinds) {
    lines.push(`  ${kind}: ${report.blockerKindDistribution[kind]}`);
  }

  lines.push('\nAffected Source Item Codes:');
  lines.push(
    report.affectedSourceExternalIds.length === 0
      ? '  (none)'
      : `  ${report.affectedSourceExternalIds.join(', ')}`,
  );

  lines.push(
    '\nA/B/C classifications are DIAGNOSTIC ONLY. No mapping is authorized, repaired, or ' +
      'reclassified by this report. Class A means "evidence resembles this property’s own legacy ' +
      'history"; it does not mean approved. Allowing any A-class mapping to participate in ' +
      'remediation requires an explicit Product Owner policy decision.',
  );
  lines.push('\nNo changes were made.');

  return lines.join('\n');
}
