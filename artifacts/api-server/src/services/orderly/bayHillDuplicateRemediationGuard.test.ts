import { describe, expect, it } from 'vitest';
import { type RemediationScope } from './orderlyDuplicateRemediation';
import {
  assertBayHillProductionScope,
  BAY_HILL_LEGACY_ADOPTION_POLICY,
  BAY_HILL_PRODUCTION_SCOPE,
  bayHillLegacyAdoptionAuthorization,
} from './bayHillDuplicateRemediationGuard';
import {
  preflightRemediationDatabase,
  RemediationPreconditionError,
} from './orderlyDuplicateRemediationPreflight';

const approved = BAY_HILL_PRODUCTION_SCOPE as RemediationScope;

describe('Bay Hill production remediation guard', () => {
  it('accepts only the final approved Bay Hill scope', () => {
    expect(() => assertBayHillProductionScope(approved)).not.toThrow();
  });

  it.each([
    ['company', { ...approved, companyId: 'wrong-company' }],
    ['store', { ...approved, storeId: 'wrong-store' }],
    ['source system', { ...approved, sourceSystem: 'OTHER' }],
    ['source property', { ...approved, sourcePropertyId: '99999' }],
    ['missing company', { ...approved, companyId: '' }],
    ['missing store', { ...approved, storeId: '' }],
    ['missing property', { ...approved, sourcePropertyId: '' }],
  ])('refuses a wrong or missing %s', (_label, scope) => {
    expect(() => assertBayHillProductionScope(scope)).toThrow(/locked to Bay Hill CC/);
  });

  /**
   * The legacy-adoption policy is an exception to a fail-closed rule, so its
   * constants are part of the authorization contract, not incidental config.
   * If any of them drifts, the policy would silently start applying to a
   * population nobody approved — which is the exact failure the policy was
   * written to avoid.
   */
  it('pins the approved legacy-adoption policy to the reviewed Bay Hill population', () => {
    expect(BAY_HILL_LEGACY_ADOPTION_POLICY.scope).toEqual(BAY_HILL_PRODUCTION_SCOPE);
    expect(BAY_HILL_LEGACY_ADOPTION_POLICY.manifestId).toBe('bay-hill-batch1-2026-08-15');
    expect(BAY_HILL_LEGACY_ADOPTION_POLICY.reportHash).toBe(
      '4eec609ca3d1bc34c8ac2aa4e0d292920f95df62b502a9af77978e4114dd501e',
    );
    expect(BAY_HILL_LEGACY_ADOPTION_POLICY.unapprovedReportHash).toBe(
      'a20be1dc5c099bfc42f49b3924bb797bdb3d149ef4fa4f02a9619739ecee792a',
    );
    expect(BAY_HILL_LEGACY_ADOPTION_POLICY.expectedGroupCount).toBe(848);
    expect(BAY_HILL_LEGACY_ADOPTION_POLICY.expectedScopedLegacyBatchCount).toBe(2);
  });

  it('carries the caller-supplied manifest binding through unchanged for re-checking', () => {
    const authorization = bayHillLegacyAdoptionAuthorization({
      manifestId: 'some-other-manifest',
      reportHash: 'some-other-hash',
      unapprovedReportHash: 'some-other-remainder',
      groupCount: 12,
    });

    // The helper must NOT normalize a mismatched binding into the policy's
    // values — the validator compares the two and blocks when they disagree.
    expect(authorization.manifestId).toBe('some-other-manifest');
    expect(authorization.reportHash).toBe('some-other-hash');
    expect(authorization.groupCount).toBe(12);
    expect(authorization.policy).toBe(BAY_HILL_LEGACY_ADOPTION_POLICY);
  });

  it('fails closed with PRECONDITION_FAILED when required schema is absent', async () => {
    const missingSchemaRunner = {
      execute: async () => ({ rows: [] }),
    };

    await expect(
      preflightRemediationDatabase(approved, missingSchemaRunner as never),
    ).rejects.toMatchObject<Partial<RemediationPreconditionError>>({
      code: 'PRECONDITION_FAILED',
      name: 'RemediationPreconditionError',
    });
  });
});