/**
 * Shared merge-content decision policy for Orderly duplicate remediation.
 *
 * The production Bay Hill Batch 1 APPLY stopped its first ten groups on
 * store-settings collisions where the ONLY difference was `primaryLocationId`
 * — an inherent property of the duplicate population, because Orderly created
 * per-location item variants. The PM-approved remedy (Option A) is a narrow
 * merge rule: when canonical and duplicate store rows differ ONLY on the
 * primary location, retain the canonical's primary, discard the duplicate's,
 * and prove the discarded location survives in the merged location-assignment
 * union. Any other protected-field difference remains a hard stop.
 *
 * These functions are PURE and are the single source of truth for merge-content
 * decisions. Both the mutation path (`repointGroup`) and the read-only
 * manifest-wide merge preflight call them, so the two paths cannot drift into
 * "implementations intended to agree" — the same lesson the scope validator
 * already encodes.
 */

/**
 * Compares two nullable numeric configuration values for merge-safety.
 *
 * `real` columns round-trip with float noise, so an exact !== would stop groups
 * over values that are the same number to any meaningful precision. A tiny
 * relative epsilon treats those as equal while still catching a genuinely
 * different conversion factor or par target. NULL is only equal to NULL —
 * "unset" and "set to something" are a real disagreement.
 */
export function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Renders a nullable number for a stop message. */
export function fmt(value: number | null): string {
  return value === null ? 'unset' : String(value);
}

// ─── Store inventory settings ────────────────────────────────────────────────

export interface StoreSettingsValues {
  primaryLocationId: string | null;
  parLevel: number | null;
  reorderLevel: number | null;
  active: number;
}

export type StoreSettingsMergeDecision =
  /** Every protected setting matches; the duplicate row is redundant. */
  | { kind: 'identical' }
  /**
   * The ONLY protected-field difference is `primaryLocationId`. Eligible for
   * the approved narrow merge rule: retain the canonical's primary, discard the
   * duplicate's, subject to the location-preservation invariant proven by the
   * caller. Never compute or choose a new primary here.
   */
  | {
      kind: 'primary_location_only';
      retainedPrimaryLocationId: string | null;
      discardedPrimaryLocationId: string | null;
    }
  /** Any other protected-field difference. Always a hard stop. */
  | { kind: 'conflict'; differences: string[] };

/**
 * Decides whether a duplicate's store-settings row can merge into the
 * canonical's row for the same store.
 *
 * `onHandQty` is deliberately NOT compared: it is derived from the applied
 * count, which the same transaction repoints onto the canonical item.
 */
export function decideStoreSettingsMerge(
  canonical: StoreSettingsValues,
  duplicate: StoreSettingsValues,
): StoreSettingsMergeDecision {
  const otherDifferences: string[] = [];
  if (!sameNumber(canonical.parLevel, duplicate.parLevel)) {
    otherDifferences.push(`par level ${fmt(canonical.parLevel)} vs ${fmt(duplicate.parLevel)}`);
  }
  if (!sameNumber(canonical.reorderLevel, duplicate.reorderLevel)) {
    otherDifferences.push(
      `reorder level ${fmt(canonical.reorderLevel)} vs ${fmt(duplicate.reorderLevel)}`,
    );
  }
  if (canonical.active !== duplicate.active) {
    otherDifferences.push(`active flag ${canonical.active} vs ${duplicate.active}`);
  }

  const primaryDiffers = canonical.primaryLocationId !== duplicate.primaryLocationId;

  if (otherDifferences.length > 0) {
    // A primary-location difference COMBINED with any other difference is a
    // conflict; the narrow rule applies only when the location is the sole
    // disagreement. Include it in the evidence so the stop message is complete.
    const differences = primaryDiffers
      ? [
          `primary location ${canonical.primaryLocationId ?? 'unset'} vs ` +
            `${duplicate.primaryLocationId ?? 'unset'}`,
          ...otherDifferences,
        ]
      : otherDifferences;
    return { kind: 'conflict', differences };
  }

  if (primaryDiffers) {
    return {
      kind: 'primary_location_only',
      retainedPrimaryLocationId: canonical.primaryLocationId,
      discardedPrimaryLocationId: duplicate.primaryLocationId,
    };
  }

  return { kind: 'identical' };
}

// ─── Location assignments ────────────────────────────────────────────────────

export interface LocationAssignmentValues {
  parTarget: number | null;
  isPrimary: number;
  active: number;
}

/**
 * Returns the protected-field differences between a canonical and duplicate
 * location-assignment row sharing (item, locationId). Empty means redundant —
 * safe to drop the duplicate's row; non-empty is always a hard stop.
 */
export function assignmentDifferences(
  canonical: LocationAssignmentValues,
  duplicate: LocationAssignmentValues,
): string[] {
  const differences: string[] = [];
  if (!sameNumber(canonical.parTarget, duplicate.parTarget)) {
    differences.push(`par target ${fmt(canonical.parTarget)} vs ${fmt(duplicate.parTarget)}`);
  }
  if (canonical.isPrimary !== duplicate.isPrimary) {
    differences.push(`primary flag ${canonical.isPrimary} vs ${duplicate.isPrimary}`);
  }
  if (canonical.active !== duplicate.active) {
    differences.push(`active flag ${canonical.active} vs ${duplicate.active}`);
  }
  return differences;
}

// ─── Legacy item-location rows ───────────────────────────────────────────────

/**
 * Returns the differences between two legacy inventory_item_locations rows
 * sharing (item, storageLocationId). isPrimary is the only value beyond the
 * key.
 */
export function legacyLocationDifferences(
  canonical: { isPrimary: number },
  duplicate: { isPrimary: number },
): string[] {
  return canonical.isPrimary !== duplicate.isPrimary
    ? [`primary flag ${canonical.isPrimary} vs ${duplicate.isPrimary}`]
    : [];
}

// ─── Item units ──────────────────────────────────────────────────────────────

/**
 * Returns the differences between two inventory_item_units rows sharing
 * (item, unitId, isIssueUnit). The conversion factor is the value recipe and
 * transfer costing divide by; a mismatch is always a hard stop.
 */
export function unitDifferences(
  canonical: { unitsPerCanonical: number },
  duplicate: { unitsPerCanonical: number },
): string[] {
  return sameNumber(canonical.unitsPerCanonical, duplicate.unitsPerCanonical)
    ? []
    : [
        `conversion factor ${fmt(canonical.unitsPerCanonical)} vs ` +
          `${fmt(duplicate.unitsPerCanonical)}`,
      ];
}

// ─── Option A authorization boundary ─────────────────────────────────────────

/** Structural twin of RemediationScope, kept local so this file stays pure. */
export interface PrimaryLocationMergeScope {
  companyId: string;
  storeId: string;
  sourceSystem: string;
  sourcePropertyId: string;
}

/**
 * Code-owned policy authorizing the primary-location-only merge rule for ONE
 * proven manifest population. The PM decision limits Option A to the Bay Hill
 * Batch 1 conditions and explicitly forbids broadening it into a general
 * canonical-wins behavior, so the rule must not be reachable by arbitrary
 * callers of the generic remediation service: without a valid authorization,
 * a primary-location difference is an ordinary fail-closed collision.
 */
export interface PrimaryLocationMergePolicy {
  policyId: string;
  scope: PrimaryLocationMergeScope;
  manifestId: string;
  reportHash: string;
  expectedGroupCount: number;
}

/**
 * Binds a trusted policy to the manifest presently being preflighted or
 * applied. Every field is re-checked; merely providing this object is not
 * permission — the same shape as LegacyAdoptionAuthorization.
 */
export interface PrimaryLocationMergeAuthorization {
  policy: PrimaryLocationMergePolicy;
  manifestId: string;
  reportHash: string;
  groupCount: number;
}

export class PrimaryLocationMergeAuthorizationError extends Error {
  constructor(message: string) {
    super(`[PRIMARY_LOCATION_MERGE_UNAUTHORIZED] ${message}`);
    this.name = 'PrimaryLocationMergeAuthorizationError';
  }
}

// ─── Code-owned approved-policy registry ─────────────────────────────────────
//
// The interfaces above are structural, so a policy OBJECT alone proves
// nothing: any caller could fabricate a self-consistent one for an arbitrary
// scope. Authorization therefore requires the presented policy to be, BY
// REFERENCE IDENTITY, an instance this module itself registered. Production
// policies are declared here, frozen, at module load; there is no exported
// mutation path outside of a test-environment-gated hook.

/**
 * PM-approved Option A policy for the Bay Hill Batch 1 population ONLY.
 * Declared inside the registry module so the approved instance and the
 * allowlist cannot diverge; the Bay Hill guard re-exports it.
 */
export const BAY_HILL_PRIMARY_LOCATION_MERGE_POLICY: PrimaryLocationMergePolicy = Object.freeze({
  policyId: 'bay-hill-batch1-primary-location-merge',
  // Same production scope as BAY_HILL_PRODUCTION_SCOPE in the guard file;
  // duplicated here (frozen) so the registry module has no imports and the
  // approved instance cannot be swapped from outside.
  scope: Object.freeze({
    companyId: '43abaf82-44ce-4231-9570-7a01e7c85ced',
    storeId: 'ee9e1530-50db-45f4-ae61-2c45e86827f0',
    sourceSystem: 'ORDERLY',
    sourcePropertyId: '24472',
  }),
  manifestId: 'bay-hill-batch1-2026-08-15',
  reportHash: '4eec609ca3d1bc34c8ac2aa4e0d292920f95df62b502a9af77978e4114dd501e',
  expectedGroupCount: 848,
});

const approvedPolicies = new Set<PrimaryLocationMergePolicy>([
  BAY_HILL_PRIMARY_LOCATION_MERGE_POLICY,
]);

/**
 * Whether this PROCESS was started as a test run, captured once at module
 * initialization. Deliberately not a live env read: a direct caller in a
 * production process could otherwise set `process.env.VITEST` at runtime and
 * reopen the registry. After this module loads, the decision is immutable —
 * a process that did not start under a test runner can never register a
 * policy, no matter what it mutates later.
 */
const TEST_ENV_AT_LOAD: boolean =
  process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined;

/**
 * Test-only registration hook. The gate is `TEST_ENV_AT_LOAD` (frozen at
 * module initialization), so in any process not started by a test runner the
 * registry is immutable from load onward: the only approved production
 * policies are the frozen constants declared in this module.
 */
export function registerPrimaryLocationMergePolicyForTests(
  policy: PrimaryLocationMergePolicy,
): PrimaryLocationMergePolicy {
  if (!TEST_ENV_AT_LOAD) {
    throw new PrimaryLocationMergeAuthorizationError(
      'registerPrimaryLocationMergePolicyForTests is only callable in a process that was ' +
        'STARTED as a test run (the check is captured at module load, not read live, so ' +
        'setting NODE_ENV/VITEST at runtime does not enable it); production policies must ' +
        'be declared as frozen constants in this module.',
    );
  }
  const frozen = Object.freeze({ ...policy, scope: Object.freeze({ ...policy.scope }) });
  approvedPolicies.add(frozen);
  return frozen;
}

/**
 * Validates an Option A authorization against the population it is being used
 * on. Fail closed: any mismatch between the code-owned policy, the presented
 * binding, and the actual scope/manifest refuses the authorization entirely.
 */
export function assertPrimaryLocationMergeAuthorization(
  authorization: PrimaryLocationMergeAuthorization,
  actual: {
    scope: PrimaryLocationMergeScope;
    manifestId?: string;
    reportHash?: string;
    groupCount: number;
  },
): void {
  const { policy } = authorization;
  // Reference-identity registry check FIRST: a structurally identical but
  // fabricated policy object is refused outright, regardless of how
  // self-consistent its fields are.
  if (!approvedPolicies.has(policy)) {
    throw new PrimaryLocationMergeAuthorizationError(
      `policy ${policy.policyId} is not an instance from the code-owned approved-policy ` +
        'registry. Option A cannot be enabled by constructing a policy object; only the ' +
        'frozen constants declared in orderlyMergeContentPolicy.ts (or a test-environment ' +
        'registration) are trusted.',
    );
  }
  const problems: string[] = [];
  if (
    policy.scope.companyId !== actual.scope.companyId ||
    policy.scope.storeId !== actual.scope.storeId ||
    policy.scope.sourceSystem !== actual.scope.sourceSystem ||
    policy.scope.sourcePropertyId !== actual.scope.sourcePropertyId
  ) {
    problems.push('policy scope does not match the scope being remediated');
  }
  if (authorization.manifestId !== policy.manifestId) {
    problems.push(
      `presented manifestId ${authorization.manifestId} does not match policy ` +
        `manifestId ${policy.manifestId}`,
    );
  }
  if (authorization.reportHash !== policy.reportHash) {
    problems.push('presented reportHash does not match policy reportHash');
  }
  if (authorization.groupCount !== policy.expectedGroupCount) {
    problems.push(
      `presented groupCount ${authorization.groupCount} does not match policy ` +
        `expectedGroupCount ${policy.expectedGroupCount}`,
    );
  }
  if (actual.manifestId !== undefined && actual.manifestId !== policy.manifestId) {
    problems.push(
      `manifest ${actual.manifestId} is not the manifest this policy authorizes ` +
        `(${policy.manifestId})`,
    );
  }
  if (actual.reportHash !== undefined && actual.reportHash !== policy.reportHash) {
    problems.push('manifest report hash is not the hash this policy authorizes');
  }
  if (actual.groupCount !== policy.expectedGroupCount) {
    problems.push(
      `manifest has ${actual.groupCount} group(s) but the policy authorizes exactly ` +
        `${policy.expectedGroupCount}`,
    );
  }
  if (problems.length > 0) {
    throw new PrimaryLocationMergeAuthorizationError(
      `Option A primary-location merge authorization (policy ${policy.policyId}) is not valid ` +
        `for this run: ${problems.join('; ')}. Without a valid authorization every ` +
        'primary-location difference remains a fail-closed collision.',
    );
  }
}

// ─── Audit evidence for the approved narrow merge rule ───────────────────────

/**
 * Recorded per store-settings row merged under the primary-location-only rule.
 * Written into the audit row's `referencesMoved` jsonb so the discarded value
 * is durable evidence, without altering historical source evidence.
 */
export interface PrimaryLocationMergeRecord {
  storeId: string;
  canonicalItemId: string;
  supersededItemId: string;
  retainedPrimaryLocationId: string | null;
  discardedPrimaryLocationId: string | null;
  /** All protected settings other than the primary location matched exactly. */
  otherProtectedSettingsMatched: true;
  /**
   * The discarded primary location remains represented in the merged
   * location-assignment union on the canonical identity (verified against the
   * modern assignment table and the legacy item-location table).
   */
  locationUnionPreserved: true;
}
