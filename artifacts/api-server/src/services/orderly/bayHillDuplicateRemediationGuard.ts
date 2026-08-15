/**
 * Customer-specific authorization for the first production remediation run.
 * Keep this at the Bay Hill operator boundary: the duplicate-remediation
 * service remains reusable and has no permanent customer/property assumptions.
 */
import {
  RemediationScopeError,
  type RemediationScope,
} from './orderlyDuplicateRemediation';

export const BAY_HILL_PRODUCTION_SCOPE = {
  companyId: '43abaf82-44ce-4231-9570-7a01e7c85ced',
  storeId: 'ee9e1530-50db-45f4-ae61-2c45e86827f0',
  sourceSystem: 'ORDERLY',
  sourcePropertyId: '24472',
} as const;

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