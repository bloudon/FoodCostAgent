import { describe, expect, it } from 'vitest';
import { type RemediationScope } from './orderlyDuplicateRemediation';
import {
  assertBayHillProductionScope,
  BAY_HILL_PRODUCTION_SCOPE,
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