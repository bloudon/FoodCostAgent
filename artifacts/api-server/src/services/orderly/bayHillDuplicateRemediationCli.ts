/**
 * Bay Hill Orderly duplicate remediation CLI (Task #1121)
 *
 * Two explicitly separated modes. There is no code path that turns a report run
 * into an apply run: apply requires a manifest file that a human wrote after
 * reviewing a report, and the manifest must carry the report hash.
 *
 *   # read-only readiness and discovery — safe to run against production
 *   pnpm --filter @workspace/api-server run orderly:remediate -- --mode preflight
 *   pnpm --filter @workspace/api-server run orderly:remediate -- --mode report
 *   pnpm --filter @workspace/api-server run orderly:remediate -- --mode report --json > report.json
 *
 *   # write a manifest from an approved report (still no mutation)
 *   pnpm --filter @workspace/api-server run orderly:remediate -- \
 *     --mode manifest --report report.json --approve 1234567,7654321 \
 *     --manifest-id pm-approval-2026-08-14 --out manifest.json
 *
 *   # mutate ONLY the approved groups
 *   pnpm --filter @workspace/api-server run orderly:remediate -- \
 *     --mode apply --manifest manifest.json --operator <userId> --confirm-production-apply
 *
 *   # post-apply verification
 *   pnpm --filter @workspace/api-server run orderly:remediate -- --mode reconcile
 *
 * The scope is hard-locked to Bay Hill CC — company, store, source system AND
 * the approved source property, since the property is what decides which data a
 * run touches. `--company` / `--store` / `--source-property` are accepted only
 * so an operator can prove which scope they meant; a value that does not match
 * the approved production scope is refused.
 *
 * Preflight, report, and reconcile are read-only. Apply is deliberately a
 * separate command and requires a reviewed manifest, current preflight pass,
 * named operator, and explicit confirmation. Before an eventual APPLY, the
 * operator must confirm a current production PostgreSQL recovery point.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import {
  applyRemediationManifest,
  BAY_HILL_PERIOD_EXPECTATIONS,
  buildApplyManifest,
  buildRemediationReport,
  reconcilePeriods,
  resolveScope,
  REMEDIATION_REPORT_VERSION,
  type ApplyManifest,
  type RemediationGroup,
  type RemediationReport,
} from './orderlyDuplicateRemediation';
import {
  assertBayHillProductionScope,
  BAY_HILL_PRODUCTION_SCOPE,
} from './bayHillDuplicateRemediationGuard';
import { preflightRemediationDatabase, type RemediationPreflightResult } from './orderlyDuplicateRemediationPreflight';

type Mode = 'preflight' | 'report' | 'manifest' | 'apply' | 'reconcile';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function printGroup(group: RemediationGroup): void {
  console.log(`Source Item Code: ${group.sourceExternalId}`);
  console.log('Candidate FnB items:');
  for (const candidate of group.candidates) {
    const flags = [
      candidate.hasAuthoritativeMapping ? 'authoritative mapping' : null,
      candidate.active === 0 ? 'inactive' : null,
      candidate.supersededByItemId ? `superseded by ${candidate.supersededByItemId}` : null,
    ].filter(Boolean);
    console.log(
      `  ${candidate.itemId}  ${candidate.name}` +
        `  refs=${candidate.totalReferences}` +
        `  countRows=${candidate.referenceCounts.inventoryCountLines}` +
        `  locations=${candidate.countLocationCount}` +
        `  value=${money(candidate.valuationContribution)}` +
        (flags.length ? `  [${flags.join(', ')}]` : ''),
    );
  }
  console.log('Evidence:');
  console.log(`  source periods: ${group.evidence.importInventoryDates.join(', ') || 'n/a'}`);
  console.log(`  source batches: ${group.evidence.importBatchIds.length}`);
  console.log(`  descriptions: ${group.evidence.sourceDescriptions.join(' | ') || 'n/a'}`);
  console.log(`  case quantities: ${group.evidence.sourceCaseQuantities.join(', ') || 'n/a'}`);
  console.log(`  base units: ${group.evidence.sourceBaseUnits.join(', ') || 'n/a'}`);
  console.log(`  source locations: ${group.evidence.sourceStorageLocations.length}`);
  console.log(`  authoritative mappings: ${group.evidence.mappedItemIds.join(', ') || 'none'}`);
  if (group.evidence.conflictReasons.length > 0) {
    console.log(`  conflicts: ${group.evidence.conflictReasons.join('; ')}`);
  }
  if (group.evidence.ambiguityReasons.length > 0) {
    console.log(`  ambiguity: ${group.evidence.ambiguityReasons.join('; ')}`);
  }
  console.log(`Proposed canonical:\n  ${group.proposedCanonicalItemId ?? '(none)'}`);
  if (group.canonicalSelectionReason) {
    console.log(`  reason: ${group.canonicalSelectionReason}`);
  }
  if (group.alternativeCandidateIds.length > 0) {
    console.log(`  alternatives: ${group.alternativeCandidateIds.join(', ')}`);
  }
  console.log('References to repoint:');
  for (const [table, count] of Object.entries(group.referencesToRepoint)) {
    if (count > 0) console.log(`  ${table}: ${count}`);
  }
  console.log(`Group valuation contribution: ${money(group.valuationContribution)}`);
  console.log(`Status:\n  ${group.classification}\n`);
}

function printReport(report: RemediationReport): void {
  console.log('─'.repeat(78));
  console.log(`Orderly duplicate remediation REPORT (read-only, no writes performed)`);
  console.log(`report version ${report.reportVersion}   hash ${report.reportHash}`);
  console.log(
    `scope company=${report.scope.companyId} store=${report.scope.storeId} ` +
      `source=${report.scope.sourceSystem} property=${report.scope.sourcePropertyId || '(legacy)'}`,
  );
  console.log('─'.repeat(78));
  for (const group of report.groups) printGroup(group);
  console.log('Totals:');
  for (const [key, value] of Object.entries(report.totals)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(
    '\nNo changes were made. To repair groups, review this output, then generate a manifest ' +
      'with --mode manifest and apply it with --mode apply --confirm-production-apply.',
  );
}

function printPreflight(result: RemediationPreflightResult): void {
  console.log('Remediation preflight PASS (read-only, no writes performed)');
  console.log(
    `scope company=${result.scope.companyId} store=${result.scope.storeId} ` +
      `source=${result.scope.sourceSystem} property=${result.scope.sourcePropertyId}`,
  );
  console.log(
    `verified tables=${result.verifiedTables.length} columns=${result.verifiedColumns.length} ` +
      `indexes/constraints=${result.verifiedIndexes.length} binding=active`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = (args.mode as Mode) ?? 'report';

  if (!['preflight', 'report', 'manifest', 'apply', 'reconcile'].includes(mode)) {
    throw new Error(`Unknown --mode ${String(args.mode)}. Use preflight | report | manifest | apply | reconcile.`);
  }

  // ── Manifest generation needs no DB scope resolution ─────────────────────
  if (mode === 'manifest') {
    const reportPath = args.report;
    const approve = args.approve;
    const manifestId = args['manifest-id'];
    const outPath = args.out;
    if (typeof reportPath !== 'string' || typeof approve !== 'string' || typeof manifestId !== 'string') {
      throw new Error(
        '--mode manifest requires --report <report.json> --approve <code,code> --manifest-id <id> [--out <file>]',
      );
    }
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as RemediationReport;
    assertBayHillProductionScope(report.scope);
    const codes = approve
      .split(',')
      .map(code => code.trim())
      .filter(Boolean);
    const manifest = buildApplyManifest(report, codes, manifestId);
    const serialized = JSON.stringify(manifest, null, 2);
    if (typeof outPath === 'string') {
      writeFileSync(outPath, serialized);
      console.log(`Wrote manifest for ${manifest.groups.length} approved group(s) to ${outPath}.`);
    } else {
      console.log(serialized);
    }
    console.log('No database changes were made.');
    return;
  }

  const requestedScope = {
    companyId: typeof args.company === 'string' ? args.company : BAY_HILL_PRODUCTION_SCOPE.companyId,
    storeId: typeof args.store === 'string' ? args.store : BAY_HILL_PRODUCTION_SCOPE.storeId,
    sourceSystem: typeof args['source-system'] === 'string'
      ? args['source-system']
      : BAY_HILL_PRODUCTION_SCOPE.sourceSystem,
    sourcePropertyId: typeof args['source-property'] === 'string'
      ? args['source-property']
      : BAY_HILL_PRODUCTION_SCOPE.sourcePropertyId,
  };

  if (mode === 'apply') {
    const manifestPath = args.manifest;
    const operator = args.operator;
    if (typeof manifestPath !== 'string' || typeof operator !== 'string') {
      throw new Error('--mode apply requires --manifest <manifest.json> --operator <userId>');
    }
    if (args['confirm-production-apply'] !== true) {
      throw new Error(
        'Refusing to mutate without --confirm-production-apply. Apply mode is a separate, ' +
          'explicitly confirmed step that requires prior Product Owner approval of the exact manifest.',
      );
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ApplyManifest;
    assertBayHillProductionScope(manifest.scope);
    if (manifest.reportVersion !== REMEDIATION_REPORT_VERSION) {
      throw new Error(
        `Manifest report version ${manifest.reportVersion} does not match this build ` +
          `(${REMEDIATION_REPORT_VERSION}). Regenerate and re-review the report.`,
      );
    }
    if (manifest.groups.length === 0) {
      throw new Error('Manifest contains no approved groups.');
    }
    if (!manifest.reportHash || !manifest.unapprovedReportHash) {
      throw new Error(
        'Manifest is missing its report binding hashes. Regenerate it with --mode manifest from a ' +
          'freshly reviewed report; a hand-edited manifest cannot be applied.',
      );
    }
    const unhashedGroup = manifest.groups.find(group => !group.groupHash);
    if (unhashedGroup) {
      throw new Error(
        `Approved group ${unhashedGroup.sourceExternalId} is missing its group hash. Regenerate ` +
          'the manifest with --mode manifest; a hand-edited manifest cannot be applied.',
      );
    }
    await preflightRemediationDatabase(manifest.scope);

    console.log(
      `Applying manifest ${manifest.manifestId} (${manifest.groups.length} group(s)) against ` +
        `report hash ${manifest.reportHash}.`,
    );
    const result = await applyRemediationManifest(manifest, operator);
    console.log('─'.repeat(78));
    for (const group of result.groups) {
      if (group.result === 'applied') {
        console.log(
          `${group.sourceExternalId}: APPLIED canonical=${group.canonicalItemId} ` +
            `superseded=[${group.supersededItemIds.join(', ')}] ` +
            `before=${money(group.valuationBefore)} after=${money(group.valuationAfter)} ` +
            `delta=${money(group.valuationDelta)}`,
        );
        for (const [table, count] of Object.entries(group.referencesMoved)) {
          if (count > 0) console.log(`    moved ${table}: ${count}`);
        }
        for (const [table, count] of Object.entries(group.referencesUnchanged)) {
          if (count > 0) console.log(`    unchanged ${table}: ${count}`);
        }
      } else if (group.result === 'already_remediated') {
        console.log(`${group.sourceExternalId}: ALREADY REMEDIATED (no-op)`);
      } else {
        console.log(`${group.sourceExternalId}: STOPPED ${group.failureCode} — ${group.failureReason}`);
      }
    }
    console.log('─'.repeat(78));
    console.log(
      `applied=${result.applied} alreadyRemediated=${result.alreadyRemediated} stopped=${result.stopped}`,
    );
    console.log('Run --mode reconcile next to verify the May/June applied valuation baselines.');
    return;
  }

  assertBayHillProductionScope(requestedScope);
  const scope = await resolveScope(requestedScope);
  const preflight = await preflightRemediationDatabase(scope);

  if (mode === 'preflight') {
    printPreflight(preflight);
    return;
  }

  if (mode === 'reconcile') {
    const periods = await reconcilePeriods(scope, BAY_HILL_PERIOD_EXPECTATIONS);
    console.log('Period-level reconciliation (read-only):');
    for (const period of periods) {
      console.log(
        `  ${period.label}: expected ${money(period.expectedTotal)} actual ${money(period.actualTotal)} ` +
          `delta ${money(period.delta)} → ${period.matches ? 'MATCH' : 'MISMATCH'} ` +
          `(${period.countSessionIds.length} session(s))`,
      );
    }
    const post = await buildRemediationReport(scope);
    console.log('\nPost-remediation duplicate report:');
    console.log(`  remaining SAFE_CANDIDATE groups: ${post.totals.safeCandidates}`);
    console.log(`  remaining AMBIGUOUS groups: ${post.totals.ambiguous}`);
    console.log(`  remaining CONFLICT groups: ${post.totals.conflicts}`);
    if (periods.some(period => !period.matches)) {
      process.exitCode = 1;
      console.log('\nReconciliation MISMATCH — investigate before loading further historical months.');
    }
    return;
  }

  const report = await buildRemediationReport(scope);
  if (args.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(error => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exit(1);
  });
