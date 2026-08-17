/**
 * Read-only remainder analysis for a partially applied Bay Hill remediation
 * manifest (PM directive: preserve the applied groups, investigate the
 * stopped tail and the post-APPLY CONFLICT — with zero mutation).
 *
 * Everything here is SELECTs. There is deliberately no path from this module
 * into any mutation: it answers "what stopped, why, what is its state now,
 * and does the population reconcile" — acting on those answers is a separate
 * Product Owner decision.
 */

import { and, eq } from 'drizzle-orm';
import { inventoryItemRemediationAudit } from '@workspace/db';
import { db } from '../../db';
import {
  buildRemediationReport,
  type ApplyManifest,
  type GroupClassification,
  type RemediationGroup,
} from './orderlyDuplicateRemediation';
import {
  preflightManifestMergeContent,
  type GroupMergeContentFinding,
  type MergeContentPreflightOptions,
} from './orderlyDuplicateRemediationPreflight';

// ─── Output shape ─────────────────────────────────────────────────────────────

export interface StoppedGroupAnalysis {
  sourceExternalId: string;
  /** Identity the manifest approved (what APPLY tried to do). */
  manifest: { canonicalItemId: string; supersededItemIds: string[] };
  /** The stop evidence recorded by APPLY itself — durable historical cause. */
  audit: {
    auditId: string | null;
    failureCode: string | null;
    failureReason: string;
    recordedAt: string | null;
    /** Classification the group had AT STOP TIME, from the audit row. */
    classificationAtStop: string;
    /**
     * The evidence snapshot the audit row froze at stop time. This — not the
     * current-state fields below — is the historical cause evidence; current
     * findings may reflect later drift or consequences of the applied merges.
     */
    evidenceAtStop: unknown;
  };
  /** What discovery sees for this code NOW. */
  current: {
    present: boolean;
    classification: GroupClassification | 'NO_ACTIVE_GROUP';
    proposedCanonicalItemId: string | null;
    candidateItemIds: string[];
    /** Candidates other than the current canonical proposal. */
    remainingSiblingIds: string[];
  };
  /**
   * POSSIBLE shared-item overlap only: item ids from this group's manifest
   * identity that also appear in an applied group's canonical/superseded set.
   * This is an ID intersection, NOT proof that a shared identity or reference
   * changed — causality requires comparing the audit evidence snapshots.
   */
  appliedOverlap: Array<{
    itemId: string;
    role: 'canonical' | 'superseded';
    viaAppliedCode: string;
  }>;
  /** Merge-content findings for this group (same pure policy as APPLY). */
  mergeContent: {
    conflicts: string[];
    primaryLocationMergeCount: number;
  };
  /** SAFE_CANDIDATE now AND zero merge-content conflicts. */
  eligibleUnderPrimaryLocationOnly: boolean;
}

export interface ConflictGroupAnalysis {
  sourceExternalId: string;
  inManifestApprovedSet: boolean;
  stoppedInThisRun: boolean;
  stopReason: string | null;
  /** Classification at stop time from the audit row, if the group stopped. */
  classificationAtStop: string | null;
  /** Frozen evidence snapshot from the stop audit row, if any. */
  evidenceAtStop: unknown;
  /**
   * Factual framing only — states what the recorded baseline was, whether the
   * group overlaps applied identities, and that the convergence-vs-defect
   * causality conclusion requires human review of the two evidence snapshots.
   */
  assessment: string;
  proposedCanonicalItemId: string | null;
  candidateItemIds: string[];
  canonicalSelectionReason: string | null;
  /** Overlap with identities the 807 applied merges touched. */
  appliedOverlap: StoppedGroupAnalysis['appliedOverlap'];
  /** Merge-content blockers reported by the shared policy, if approved. */
  mergeConflicts: string[];
  evidence: RemediationGroup['evidence'];
}

export interface RemainderAnalysis {
  mode: 'remainder-analysis';
  readOnly: true;
  remediationWrites: 0;
  manifestId: string;
  reportHash: string;
  scope: ApplyManifest['scope'];
  auditSummary: {
    applied: number;
    alreadyRemediated: number;
    stopped: number;
    distinctCodes: number;
  };
  stoppedGroups: StoppedGroupAnalysis[];
  conflictGroups: ConflictGroupAnalysis[];
  population: {
    approvedCount: number;
    appliedCodesNoLongerActiveSafe: boolean;
    appliedCodesStillActiveSafe: string[];
    /** approved − applied − stopped, and audit codes outside the manifest. */
    approvedUnaccountedFor: string[];
    auditCodesOutsideManifest: string[];
    /**
     * Audit-population completeness ONLY: every approved code has an audit
     * outcome and no audit code lies outside the manifest. Says nothing about
     * current classifications — see safeSetMatchesStoppedSet for that.
     */
    auditPopulationComplete: boolean;
    /** Bidirectional: current SAFE set === stopped set. */
    safeSetMatchesStoppedSet: boolean;
    /** Stopped codes NOT currently SAFE (e.g. now CONFLICT/AMBIGUOUS/gone). */
    stoppedCodesNotCurrentlySafe: Array<{
      code: string;
      classification: GroupClassification | 'NO_ACTIVE_GROUP';
    }>;
    currentSafeCodes: string[];
    safeFromStopped: string[];
    safeFromHeld: string[];
    unexpectedSafeCodes: string[];
    heldCodesTouchedByThisManifest: string[];
    heldCodesWithChangedClassification: Array<{
      code: string;
      classification: GroupClassification | 'NO_ACTIVE_GROUP';
    }>;
    stellaCode: string;
    stellaStatus: GroupClassification | 'NO_ACTIVE_GROUP';
    stellaTouched: boolean;
    currentAmbiguousCodes: string[];
    expectedAmbiguousCodes: string[];
    ambiguousMatchesExpected: boolean;
    currentConflictCodes: string[];
  };
}

export const BAY_HILL_EXPECTED_AMBIGUOUS = ['10149134', '7468556', '7023177', '9021845'];
export const BAY_HILL_STELLA_CODE = '99682';

function parseFailureCode(reason: string): string | null {
  const match = /^([A-Z_]+):/.exec(reason);
  return match ? match[1] : null;
}

export async function buildRemainderAnalysis(
  manifest: ApplyManifest,
  runner: typeof db = db,
  options: {
    heldCodes?: string[];
    mergeContent?: Pick<MergeContentPreflightOptions, 'primaryLocationMergeAuthorization'>;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<RemainderAnalysis> {
  const heldCodes = options.heldCodes ?? [];
  const scope = manifest.scope;

  // 1 ── APPLY's own durable evidence: audit rows for THIS manifest only.
  const auditRows = await runner
    .select()
    .from(inventoryItemRemediationAudit)
    .where(
      and(
        eq(inventoryItemRemediationAudit.manifestId, manifest.manifestId),
        eq(inventoryItemRemediationAudit.companyId, scope.companyId),
        eq(inventoryItemRemediationAudit.sourceSystem, scope.sourceSystem),
        eq(inventoryItemRemediationAudit.sourcePropertyId, scope.sourcePropertyId),
      ),
    );

  // Run anchoring: a code counts as APPLIED if ANY audit row for this manifest
  // recorded result='applied' — a later rerun's already_remediated row must
  // not displace the original merge from the applied-identity index (the "807"
  // population is the set of merges that actually mutated data, which is
  // immutable history, not the mutable latest outcome). The EARLIEST applied
  // row per code carries that original merge's identity.
  const rowsChronological = [...auditRows].sort(
    (a, b) => new Date(a.createdAt as any).getTime() - new Date(b.createdAt as any).getTime(),
  );
  const latestByCode = new Map<string, (typeof auditRows)[number]>();
  const firstAppliedByCode = new Map<string, (typeof auditRows)[number]>();
  for (const row of rowsChronological) {
    latestByCode.set(row.sourceExternalId, row);
    if (row.result === 'applied' && !firstAppliedByCode.has(row.sourceExternalId)) {
      firstAppliedByCode.set(row.sourceExternalId, row);
    }
  }

  const appliedRows = [...firstAppliedByCode.values()];
  // A code is STOPPED only if it never applied AND its latest outcome is a stop.
  const stoppedRows = [...latestByCode.values()].filter(
    row => row.result === 'stopped' && !firstAppliedByCode.has(row.sourceExternalId),
  );
  const appliedCodes = new Set(appliedRows.map(row => row.sourceExternalId));
  const stoppedCodes = new Set(stoppedRows.map(row => row.sourceExternalId));

  // Identity index of everything the successful merges touched.
  const appliedIdentityIndex = new Map<string, { role: 'canonical' | 'superseded'; code: string }[]>();
  for (const row of appliedRows) {
    const push = (itemId: string, role: 'canonical' | 'superseded') => {
      const list = appliedIdentityIndex.get(itemId) ?? [];
      list.push({ role, code: row.sourceExternalId });
      appliedIdentityIndex.set(itemId, list);
    };
    push(row.canonicalItemId, 'canonical');
    for (const id of row.supersededItemIds) push(id, 'superseded');
  }
  const overlapFor = (itemIds: string[]): StoppedGroupAnalysis['appliedOverlap'] => {
    const out: StoppedGroupAnalysis['appliedOverlap'] = [];
    for (const itemId of itemIds) {
      for (const hit of appliedIdentityIndex.get(itemId) ?? []) {
        out.push({ itemId, role: hit.role, viaAppliedCode: hit.code });
      }
    }
    return out;
  };

  // 2 ── Fresh full discovery report (read-only) — the "now" side.
  const report = await buildRemediationReport(scope, runner);
  const groupByCode = new Map(report.groups.map(group => [group.sourceExternalId, group]));

  // 3 ── Merge-content findings over the WHOLE manifest population, same pure
  // policy APPLY used, doNotThrow so blockers come back as evidence.
  const mergeEvaluation = await preflightManifestMergeContent(
    scope,
    manifest.groups.map(group => ({
      sourceExternalId: group.sourceExternalId,
      canonicalItemId: group.canonicalItemId,
      supersededItemIds: group.supersededItemIds,
    })),
    runner,
    {
      doNotThrow: true,
      onProgress: options.onProgress,
      ...(options.mergeContent ?? {}),
    },
  );
  const mergeFindingByCode = new Map<string, GroupMergeContentFinding>(
    mergeEvaluation.findings.map(finding => [finding.sourceExternalId, finding]),
  );

  // 4 ── Per-stopped-group analysis.
  const approvalByCode = new Map(manifest.groups.map(group => [group.sourceExternalId, group]));
  const stoppedGroups: StoppedGroupAnalysis[] = stoppedRows
    .sort((a, b) => a.sourceExternalId.localeCompare(b.sourceExternalId))
    .map(row => {
      const approval = approvalByCode.get(row.sourceExternalId);
      const current = groupByCode.get(row.sourceExternalId);
      const finding = mergeFindingByCode.get(row.sourceExternalId);
      const manifestIds = approval
        ? [approval.canonicalItemId, ...approval.supersededItemIds]
        : [row.canonicalItemId, ...row.supersededItemIds];
      const conflicts = finding?.conflicts ?? [];
      return {
        sourceExternalId: row.sourceExternalId,
        manifest: {
          canonicalItemId: approval?.canonicalItemId ?? row.canonicalItemId,
          supersededItemIds: approval?.supersededItemIds ?? row.supersededItemIds,
        },
        audit: {
          auditId: row.id,
          failureCode: row.failureReason ? parseFailureCode(row.failureReason) : null,
          failureReason: row.failureReason ?? '(no failure reason recorded)',
          recordedAt: row.createdAt ? new Date(row.createdAt as any).toISOString() : null,
          classificationAtStop: row.classification,
          evidenceAtStop: row.evidence,
        },
        current: {
          present: current !== undefined,
          classification: current?.classification ?? 'NO_ACTIVE_GROUP',
          proposedCanonicalItemId: current?.proposedCanonicalItemId ?? null,
          candidateItemIds: current?.candidateItemIds ?? [],
          remainingSiblingIds: (current?.candidateItemIds ?? []).filter(
            id => id !== current?.proposedCanonicalItemId,
          ),
        },
        appliedOverlap: overlapFor(manifestIds),
        mergeContent: {
          conflicts,
          primaryLocationMergeCount: finding?.primaryLocationMerges.length ?? 0,
        },
        eligibleUnderPrimaryLocationOnly:
          current?.classification === 'SAFE_CANDIDATE' && conflicts.length === 0,
      };
    });

  // 5 ── Every CONFLICT group in the current report, explicitly.
  const conflictGroups: ConflictGroupAnalysis[] = report.groups
    .filter(group => group.classification === 'CONFLICT')
    .map(group => {
      const stoppedRow = stoppedRows.find(row => row.sourceExternalId === group.sourceExternalId);
      const inManifest = approvalByCode.has(group.sourceExternalId);
      const overlap = overlapFor(group.candidateItemIds);
      const baseline = inManifest
        ? 'approved as SAFE_CANDIDATE in the reviewed manifest report'
        : 'not part of the approved manifest population';
      const overlapNote =
        overlap.length > 0
          ? `shares ${overlap.length} item id(s) with applied merge(s) [${[
              ...new Set(overlap.map(o => o.viaAppliedCode)),
            ].join(', ')}] — possible shared-canonical convergence`
          : 'no item-id overlap with any applied merge';
      return {
        sourceExternalId: group.sourceExternalId,
        inManifestApprovedSet: inManifest,
        stoppedInThisRun: stoppedRow !== undefined,
        stopReason: stoppedRow?.failureReason ?? null,
        classificationAtStop: stoppedRow?.classification ?? null,
        evidenceAtStop: stoppedRow?.evidence ?? null,
        assessment:
          `Baseline: ${baseline}. Now CONFLICT. ${overlapNote}. ` +
          'Convergence-vs-defect causality requires human comparison of the frozen ' +
          'audit evidence (evidenceAtStop / applied audit rows) against the current evidence below.',
        proposedCanonicalItemId: group.proposedCanonicalItemId,
        candidateItemIds: group.candidateItemIds,
        canonicalSelectionReason: group.canonicalSelectionReason,
        appliedOverlap: overlap,
        mergeConflicts: mergeFindingByCode.get(group.sourceExternalId)?.conflicts ?? [],
        evidence: group.evidence,
      };
    });

  // 6 ── Population reconciliation (set relationships, both directions).
  const approvedCodes = new Set(manifest.groups.map(group => group.sourceExternalId));
  const currentSafeCodes = report.groups
    .filter(group => group.classification === 'SAFE_CANDIDATE')
    .map(group => group.sourceExternalId)
    .sort();
  const heldSet = new Set(heldCodes);
  const appliedStillActiveSafe = currentSafeCodes.filter(code => appliedCodes.has(code));
  const approvedUnaccountedFor = [...approvedCodes].filter(
    code => !appliedCodes.has(code) && !stoppedCodes.has(code),
  );
  const auditCodesOutsideManifest = [...latestByCode.keys()].filter(
    code => !approvedCodes.has(code),
  );
  const heldTouched = heldCodes.filter(code => latestByCode.has(code));
  const stoppedCodesSorted = [...stoppedCodes].sort();
  const currentSafeSet = new Set(currentSafeCodes);
  const safeSetMatchesStoppedSet =
    stoppedCodesSorted.length === currentSafeCodes.length &&
    stoppedCodesSorted.every(code => currentSafeSet.has(code));
  const stoppedCodesNotCurrentlySafe = stoppedCodesSorted
    .filter(code => !currentSafeSet.has(code))
    .map(code => ({
      code,
      classification: groupByCode.get(code)?.classification ?? ('NO_ACTIVE_GROUP' as const),
    }));
  const heldChanged = heldCodes
    .map(code => ({
      code,
      classification:
        groupByCode.get(code)?.classification ?? ('NO_ACTIVE_GROUP' as const),
    }))
    .filter(entry => entry.classification !== 'SAFE_CANDIDATE');
  const currentAmbiguousCodes = report.groups
    .filter(group => group.classification === 'AMBIGUOUS')
    .map(group => group.sourceExternalId)
    .sort();

  return {
    mode: 'remainder-analysis',
    readOnly: true,
    remediationWrites: 0,
    manifestId: manifest.manifestId,
    reportHash: manifest.reportHash,
    scope,
    auditSummary: {
      applied: appliedRows.length,
      alreadyRemediated: [...latestByCode.values()].filter(
        row => row.result === 'already_remediated',
      ).length,
      stopped: stoppedRows.length,
      distinctCodes: latestByCode.size,
    },
    stoppedGroups,
    conflictGroups,
    population: {
      approvedCount: approvedCodes.size,
      appliedCodesNoLongerActiveSafe: appliedStillActiveSafe.length === 0,
      appliedCodesStillActiveSafe: appliedStillActiveSafe,
      approvedUnaccountedFor,
      auditCodesOutsideManifest,
      auditPopulationComplete:
        approvedUnaccountedFor.length === 0 && auditCodesOutsideManifest.length === 0,
      safeSetMatchesStoppedSet,
      stoppedCodesNotCurrentlySafe,
      currentSafeCodes,
      safeFromStopped: currentSafeCodes.filter(code => stoppedCodes.has(code)),
      safeFromHeld: currentSafeCodes.filter(code => heldSet.has(code)),
      unexpectedSafeCodes: currentSafeCodes.filter(
        code => !stoppedCodes.has(code) && !heldSet.has(code),
      ),
      heldCodesTouchedByThisManifest: heldTouched,
      heldCodesWithChangedClassification: heldChanged,
      stellaCode: BAY_HILL_STELLA_CODE,
      stellaStatus:
        groupByCode.get(BAY_HILL_STELLA_CODE)?.classification ?? 'NO_ACTIVE_GROUP',
      stellaTouched: latestByCode.has(BAY_HILL_STELLA_CODE),
      currentAmbiguousCodes,
      expectedAmbiguousCodes: BAY_HILL_EXPECTED_AMBIGUOUS,
      ambiguousMatchesExpected:
        JSON.stringify(currentAmbiguousCodes) ===
        JSON.stringify([...BAY_HILL_EXPECTED_AMBIGUOUS].sort()),
      currentConflictCodes: conflictGroups.map(group => group.sourceExternalId).sort(),
    },
  };
}
