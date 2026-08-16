/**
 * Customer-specific authorization for the first production remediation run.
 * Keep this at the Bay Hill operator boundary: the duplicate-remediation
 * service remains reusable and has no permanent customer/property assumptions.
 */
import {
  RemediationScopeError,
} from './orderlyDuplicateRemediation';
import type {
  LegacyAdoptionAuthorization,
  LegacyAdoptionPolicy,
  RemediationScope,
} from './orderlyRemediationScopeValidator';
import type {
  PrimaryLocationMergeAuthorization,
  PrimaryLocationMergePolicy,
} from './orderlyMergeContentPolicy';

export const BAY_HILL_PRODUCTION_SCOPE = {
  companyId: '43abaf82-44ce-4231-9570-7a01e7c85ced',
  storeId: 'ee9e1530-50db-45f4-ae61-2c45e86827f0',
  sourceSystem: 'ORDERLY',
  sourcePropertyId: '24472',
} as const;

/**
 * Product Owner-approved exception for the unchanged Batch 1 population. It is
 * intentionally code-owned rather than manifest-owned: a JSON edit must never
 * broaden a legacy scope exception.
 */
export const BAY_HILL_LEGACY_ADOPTION_POLICY: LegacyAdoptionPolicy = {
  policyId: 'bay-hill-batch1-legacy-scope-adoption',
  scope: BAY_HILL_PRODUCTION_SCOPE,
  manifestId: 'bay-hill-batch1-2026-08-15',
  reportHash: '4eec609ca3d1bc34c8ac2aa4e0d292920f95df62b502a9af77978e4114dd501e',
  unapprovedReportHash: 'a20be1dc5c099bfc42f49b3924bb797bdb3d149ef4fa4f02a9619739ecee792a',
  expectedGroupCount: 848,
  expectedScopedLegacyBatchCount: 2,
};

export function bayHillLegacyAdoptionAuthorization(input: {
  manifestId: string;
  reportHash: string;
  unapprovedReportHash: string;
  groupCount: number;
}): LegacyAdoptionAuthorization {
  return { policy: BAY_HILL_LEGACY_ADOPTION_POLICY, ...input };
}

/**
 * PM-approved Option A authorization for the Bay Hill Batch 1 population ONLY.
 * The policy instance itself lives in the code-owned approved-policy registry
 * (orderlyMergeContentPolicy.ts) — authorization requires that exact frozen
 * instance by reference identity, so neither a JSON edit nor a fabricated
 * structural twin can broaden the primary-location merge exception.
 */
import { BAY_HILL_PRIMARY_LOCATION_MERGE_POLICY } from './orderlyMergeContentPolicy';
export { BAY_HILL_PRIMARY_LOCATION_MERGE_POLICY };

export function bayHillPrimaryLocationMergeAuthorization(input: {
  manifestId: string;
  reportHash: string;
  groupCount: number;
}): PrimaryLocationMergeAuthorization {
  return { policy: BAY_HILL_PRIMARY_LOCATION_MERGE_POLICY, ...input };
}

export function assertBayHillProductionScope(scope: RemediationScope): void {
  if (
    scope.companyId !== BAY_HILL_PRODUCTION_SCOPE.companyId ||
    scope.storeId !== BAY_HILL_PRODUCTION_SCOPE.storeId ||
    scope.sourceSystem !== BAY_HILL_PRODUCTION_SCOPE.sourceSystem ||
    scope.sourcePropertyId !== BAY_HILL_PRODUCTION_SCOPE.sourcePropertyId
  ) {
    throw new RemediationScopeError(
      'The first production remediation run is locked to Bay Hill CC ' +
        `(company ${BAY_HILL_PRODUCTION_SCOPE.companyId}, store ${BAY_HILL_PRODUCTION_SCOPE.storeId}, ` +
        `source ${BAY_HILL_PRODUCTION_SCOPE.sourceSystem}, property ${BAY_HILL_PRODUCTION_SCOPE.sourcePropertyId}). ` +
        `Refusing scope company=${scope.companyId || '(none)'} store=${scope.storeId || '(none)'} ` +
        `source=${scope.sourceSystem || '(none)'} property=${scope.sourcePropertyId || '(none)'}.`,
    );
  }
}