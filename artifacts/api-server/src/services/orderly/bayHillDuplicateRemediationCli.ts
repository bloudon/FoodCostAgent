/**
 * Bay Hill Orderly duplicate remediation CLI (Task #1121)
 *
 * Two explicitly separated modes. There is no code path that turns a report run
 * into an apply run: apply requires a manifest file that a human wrote after
 * reviewing a report, and the manifest must carry the report hash.
 *
 *   # read-only readiness and discovery — safe to run against production
 *   pnpm --filter @workspace/api-server run orderly:remediate -- --mode preflight
 *   pnpm --filter @workspace/api-server run orderly:remediate -- --mode diagnose --trace-name Tabasco
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
 *   # complete read-only blocker evidence for a manifest that cannot be applied
 *   pnpm --filter @workspace/api-server run orderly:remediate -- \
 *     --mode forensics --manifest manifest.json --out forensics.txt
 *
 *   # prove a suspended run mutated nothing, bounded to its manifest id
 *   pnpm --filter @workspace/api-server run orderly:remediate -- \
 *     --mode verify-suspended --manifest manifest.json
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

// MUST be first: the API entrypoint (src/index.ts) loads dotenv before it
// imports ./db, and ./db chooses its driver from STORAGE_MODE/AUTH_MODE at
// import time. A standalone entry point that skips this loads an EMPTY
// environment, silently selects the other driver, and then fails on its first
// query against a database the API talks to fine. Keep this import above the
// remediation imports — they pull in ./db transitively.
import 'dotenv/config';

import { readFileSync, writeFileSync } from 'node:fs';
import { db } from '../../db';
import {
  applyRemediationManifest,
  BAY_HILL_PERIOD_EXPECTATIONS,
  buildApplyManifest,
  buildRemediationReport,
  reconcilePeriods,
  resolveScope,
  RemediationScopeError,
  REMEDIATION_REPORT_VERSION,
  type ApplyManifest,
  type RemediationGroup,
  type RemediationReport,
} from './orderlyDuplicateRemediation';
import {
  describeDatabaseTargetLine,
  formatRemediationDbError,
  isDatabaseError,
} from './remediationDbErrors';
import {
  assertBayHillProductionScope,
  bayHillLegacyAdoptionAuthorization,
  BAY_HILL_PRODUCTION_SCOPE,
} from './bayHillDuplicateRemediationGuard';
import {
  preflightManifestScope,
  preflightRemediationDatabase,
  RemediationManifestBlockedError,
  RemediationPreconditionError,
  verifySuspendedRunMutationFree,
  type RemediationPreflightResult,
  type SuspendedRunVerification,
} from './orderlyDuplicateRemediationPreflight';
import {
  buildForensicReport,
  formatForensicReport,
} from './orderlyRemediationForensics';
import type { ManifestGroupItems } from './orderlyRemediationScopeValidator';
import {
  diagnoseDiscovery,
  type DiscoveryDiagnostics,
} from './orderlyDiscoveryDiagnostics';

type Mode =
  | 'preflight'
  | 'diagnose'
  | 'report'
  | 'manifest'
  | 'apply'
  | 'reconcile'
  | 'forensics'
  | 'policy-preflight'
  | 'verify-suspended';

const MODES: Mode[] = [
  'preflight',
  'diagnose',
  'report',
  'manifest',
  'apply',
  'reconcile',
  'forensics',
  'policy-preflight',
  'verify-suspended',
];

/** The item population a manifest names, for the shared scope validator. */
function manifestGroupItems(manifest: ApplyManifest): ManifestGroupItems[] {
  return manifest.groups.map(group => ({
    sourceExternalId: group.sourceExternalId,
    canonicalItemId: group.canonicalItemId,
    supersededItemIds: group.supersededItemIds,
  }));
}

/**
 * Loads and structurally validates a manifest WITHOUT touching it.
 *
 * The suspended Bay Hill Batch 1 manifest is historical evidence of the
 * preflight/APPLY boundary failure. Every mode that reads it must leave it byte
 * identical — no regeneration, no re-approval, no widening.
 */
function loadManifest(path: string): ApplyManifest {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as ApplyManifest;
  assertBayHillProductionScope(manifest.scope);
  if (manifest.groups.length === 0) {
    throw new Error('Manifest contains no approved groups.');
  }
  return manifest;
}

function printSuspendedVerification(result: SuspendedRunVerification): void {
  console.log('─'.repeat(78));
  console.log('Suspended-run mutation verification (read-only, no writes performed)');
  console.log(`manifest ${result.manifestId}`);
  console.log(
    `scope company=${result.scope.companyId} store=${result.scope.storeId} ` +
      `source=${result.scope.sourceSystem} property=${result.scope.sourcePropertyId}`,
  );
  console.log('─'.repeat(78));
  console.log('Audit outcomes recorded for THIS manifest:');
  console.log(`  applied:            ${result.auditCounts.applied}`);
  console.log(`  already remediated: ${result.auditCounts.alreadyRemediated}`);
  console.log(`  stopped:            ${result.auditCounts.stopped}`);
  console.log(
    `\nStopped Source Item Codes (${result.stoppedSourceExternalIds.length}): ` +
      `${result.stoppedSourceExternalIds.join(', ') || '(none)'}`,
  );
  console.log('\nDistinct failure reasons:');
  if (result.failureReasons.length === 0) console.log('  (none)');
  for (const reason of result.failureReasons) console.log(`  ${reason}`);
  console.log(
    `\nItems superseded by an APPLIED row of this manifest: ` +
      `${result.supersededItemIds.length === 0 ? 'none' : result.supersededItemIds.join(', ')}`,
  );
  console.log(
    `Items named by this manifest that are superseded in the database: ` +
      `${
        result.unexpectedlySupersededItemIds.length === 0
          ? 'none'
          : result.unexpectedlySupersededItemIds.join(', ')
      }`,
  );
  console.log('\nVerdict:');
  if (result.mutationFree) {
    console.log('  MUTATION-FREE — this manifest recorded no applied repair and superseded no item.');
  } else {
    console.log('  NOT MUTATION-FREE:');
    for (const finding of result.findings) console.log(`    - ${finding}`);
  }
  console.log('\nNo changes were made.');
}

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

function printDiagnostics(d: DiscoveryDiagnostics): void {
  console.log('─'.repeat(78));
  console.log('Orderly discovery DIAGNOSE (read-only, no writes performed)');
  console.log(
    `scope company=${d.scope.companyId} store=${d.scope.storeId} ` +
      `source=${d.scope.sourceSystem} property=${d.scope.sourcePropertyId}`,
  );
  console.log('─'.repeat(78));

  console.log('Source-property bindings for this company/system:');
  if (d.bindings.length === 0) console.log('  (none)');
  for (const binding of d.bindings) {
    console.log(
      `  property=${binding.sourcePropertyId} → store=${binding.destinationStoreId} ` +
        `active=${binding.active} label=${binding.label ?? 'n/a'}`,
    );
  }

  console.log('\nDiscovery batch predicate funnel (each stage adds one condition):');
  console.log(`  company + source system:        ${d.funnel.companyAndSystem}`);
  console.log(`  + status = approved:            ${d.funnel.plusApproved}`);
  console.log(`  + target_store_id = scope:      ${d.funnel.plusTargetStore}`);
  console.log(`  + source_property_id = scope:   ${d.funnel.plusSourceProperty}`);
  console.log(`  = batches discovery selects:    ${d.funnel.discoverySelected}`);

  console.log('\nStored source_property_id values on batches:');
  for (const row of d.distinctBatchProperties) {
    const shown = row.value === null ? 'NULL' : row.value === '' ? '(empty string)' : row.value;
    console.log(`  ${shown}: ${row.batches} batch(es)`);
  }
  console.log('Stored source_property_id values on external mappings:');
  if (d.distinctMappingProperties.length === 0) console.log('  (none)');
  for (const row of d.distinctMappingProperties) {
    const shown = row.value === null ? 'NULL' : row.value === '' ? '(empty string)' : row.value;
    console.log(`  ${shown}: ${row.mappings} mapping(s)`);
  }

  console.log('\nApproved batches and their scope columns:');
  for (const batch of d.batches.filter(b => b.status === 'approved')) {
    console.log(
      `  ${batch.batchId} date=${batch.inventoryDate ?? 'n/a'} rows=${batch.rowCount} ` +
        `store=${batch.targetStoreId ?? 'NULL'} property=${batch.sourcePropertyId ?? 'NULL'} ` +
        `binding=${batch.sourcePropertyBindingId ?? 'NULL'}`,
    );
  }

  console.log(`\nTraced item code: ${d.tracedCode ?? '(none found)'}`);
  console.log(`Items matching the traced name: ${d.tracedByName.length}`);
  if (d.tracedRows.length > 0) {
    console.log('Import rows carrying that code:');
    for (const row of d.tracedRows) {
      console.log(
        `  batch=${row.batchId} row=${row.rowIndex} codeStatus=${row.itemCodeStatus ?? 'n/a'} ` +
          `resolved=${row.resolvedInventoryItemId ?? 'UNRESOLVED'} ` +
          `batchStatus=${row.batchStatus} batchStore=${row.batchTargetStoreId ?? 'NULL'} ` +
          `batchProperty=${row.batchSourcePropertyId ?? 'NULL'} date=${row.batchInventoryDate ?? 'n/a'}`,
      );
      console.log(
        `      desc=${row.cleanedDescription ?? 'n/a'} location=${row.storageLocation ?? 'n/a'}`,
      );
    }
  }
  if (d.tracedItems.length > 0) {
    console.log('Distinct inventory identities involved:');
    for (const item of d.tracedItems) {
      const mapped = item.mappings
        .map(m => `${m.sourceExternalId}@${m.sourcePropertyId === '' ? '(legacy)' : m.sourcePropertyId}`)
        .join(', ');
      console.log(
        `  ${item.itemId} "${item.name}" active=${item.active} ` +
          `superseded=${item.supersededByItemId ?? 'none'} countLines=${item.countLines} ` +
          `sessions=${item.countSessions} importRows=${item.importRows}`,
      );
      console.log(`      mappings: ${mapped || 'NONE'}`);
    }
  }

  console.log('\nVerdict:');
  console.log(`  ${d.exclusionVerdict}`);
  console.log('\nNo changes were made.');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = (args.mode as Mode) ?? 'report';

  if (!MODES.includes(mode)) {
    throw new Error(`Unknown --mode ${String(args.mode)}. Use ${MODES.join(' | ')}.`);
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
    const manifest = loadManifest(manifestPath);
    const legacyAdoptionAuthorization = bayHillLegacyAdoptionAuthorization({
      manifestId: manifest.manifestId,
      reportHash: manifest.reportHash,
      unapprovedReportHash: manifest.unapprovedReportHash,
      groupCount: manifest.groups.length,
    });
    if (manifest.reportVersion !== REMEDIATION_REPORT_VERSION) {
      throw new Error(
        `Manifest report version ${manifest.reportVersion} does not match this build ` +
          `(${REMEDIATION_REPORT_VERSION}). Regenerate and re-review the report.`,
      );
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

    // ── Manifest-aware scope gate — MUST precede any mutation ────────────────
    //
    // The previous production run reached this point with only schema/binding
    // preflight behind it, started mutating, and discovered cross-property
    // external mappings group by group. It stopped correctly and changed
    // nothing, but the blockers were answerable by a read-only query before the
    // first transaction opened.
    //
    // This gate runs THE SAME validator APPLY runs, over EVERY group, and
    // refuses the whole manifest if any group anywhere is blocked. Partial
    // application is not offered: applying the clean subset of a manifest that
    // was approved as a unit would silently substitute a scope nobody reviewed.
    console.log(
      `Validating all ${manifest.groups.length} approved group(s) against the scope validator ` +
        'before any mutation…',
    );
    const gate = await preflightManifestScope(
      manifest.scope,
      manifestGroupItems(manifest),
      db,
      {
        legacyAdoptionAuthorization,
        onProgress: (completed, total) => {
          if (completed % 100 === 0 || completed === total) {
            console.log(`  validated ${completed}/${total} group(s)`);
          }
        },
      },
    );
    console.log(
      `Scope gate passed: ${gate.cleanGroups}/${gate.totalGroups} group(s) clean, ` +
        `${gate.scopedBatchIds.length} in-scope batch(es).`,
    );

    console.log(
      `Applying manifest ${manifest.manifestId} (${manifest.groups.length} group(s)) against ` +
        `report hash ${manifest.reportHash}.`,
    );
    const result = await applyRemediationManifest(manifest, operator, db, {
      legacyAdoptionAuthorization,
    });
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

  // ── Read-only manifest forensics ─────────────────────────────────────────
  //
  // Same evaluation the APPLY gate performs, but it reports instead of
  // refusing. This is how an operator sees the COMPLETE blocker set and the
  // per-mapping A/B/C evidence for a manifest that cannot currently be applied.
  // It never writes, and it never modifies the manifest it reads.
  if (mode === 'forensics') {
    const manifestPath = args.manifest;
    if (typeof manifestPath !== 'string') {
      throw new Error('--mode forensics requires --manifest <manifest.json> [--json] [--out <file>]');
    }
    const manifest = loadManifest(manifestPath);
    await preflightRemediationDatabase(manifest.scope);

    const report = await buildForensicReport(
      {
        manifestId: manifest.manifestId,
        scope: manifest.scope,
        reportHash: manifest.reportHash,
        unapprovedReportHash: manifest.unapprovedReportHash,
        reportVersion: manifest.reportVersion,
        groups: manifestGroupItems(manifest),
      },
      db,
      {
        onProgress: (completed, total) => {
          if (completed % 100 === 0 || completed === total) {
            console.error(`  evaluated ${completed}/${total} group(s)`);
          }
        },
      },
    );

    const rendered = args.json === true
      ? JSON.stringify(report, null, 2)
      : formatForensicReport(report);
    if (typeof args.out === 'string') {
      writeFileSync(args.out, rendered);
      console.log(`Wrote forensic report for ${report.totals.totalGroups} group(s) to ${args.out}.`);
      console.log(
        `blocked=${report.totals.blockedGroups} clean=${report.totals.cleanGroups} ` +
          `problematicMappings=${report.totals.problematicMappings}`,
      );
    } else {
      console.log(rendered);
    }
    return;
  }

  // ── Read-only policy preflight ───────────────────────────────────────────
  //
  // The production stop point for the legacy-adoption policy. It runs the SAME
  // shared validator the APPLY gate runs, with the SAME trusted authorization,
  // over the UNCHANGED manifest — and then stops. There is deliberately no
  // path from this mode into mutation: proving the manifest now authorizes is a
  // separate decision from acting on it, and the Product Owner has to make that
  // decision after seeing this evidence.
  if (mode === 'policy-preflight') {
    const manifestPath = args.manifest;
    if (typeof manifestPath !== 'string') {
      throw new Error('--mode policy-preflight requires --manifest <manifest.json> [--json]');
    }
    const manifest = loadManifest(manifestPath);
    await preflightRemediationDatabase(manifest.scope);

    const authorization = bayHillLegacyAdoptionAuthorization({
      manifestId: manifest.manifestId,
      reportHash: manifest.reportHash,
      unapprovedReportHash: manifest.unapprovedReportHash,
      groupCount: manifest.groups.length,
    });

    const evaluation = await preflightManifestScope(
      manifest.scope,
      manifestGroupItems(manifest),
      db,
      {
        legacyAdoptionAuthorization: authorization,
        // Report the full picture rather than throwing: a blocked group is
        // evidence to return, not an error to hide.
        doNotThrow: true,
        onProgress: (completed, total) => {
          if (completed % 100 === 0 || completed === total) {
            console.error(`  evaluated ${completed}/${total} group(s)`);
          }
        },
      },
    );

    const mappings = evaluation.groups.flatMap(group => group.mappings);
    const classCounts = {
      A_LEGACY_MISSING_SCOPE: mappings.filter(m => m.classification === 'A_LEGACY_MISSING_SCOPE').length,
      B_DEMONSTRABLY_FOREIGN: mappings.filter(m => m.classification === 'B_DEMONSTRABLY_FOREIGN').length,
      C_AMBIGUOUS: mappings.filter(m => m.classification === 'C_AMBIGUOUS').length,
    };
    const authorizedByPolicy = mappings.filter(m => m.authorizedByLegacyAdoptionPolicy).length;

    const summary = {
      mode: 'policy-preflight',
      readOnly: true,
      remediationWrites: 0,
      policyId: authorization.policy.policyId,
      manifestId: manifest.manifestId,
      reportHash: manifest.reportHash,
      unapprovedReportHash: manifest.unapprovedReportHash,
      scope: manifest.scope,
      totalGroups: evaluation.totalGroups,
      authorizedGroups: evaluation.cleanGroups,
      blockedGroups: evaluation.blockedGroups,
      scopedBatchCount: evaluation.scopedBatchIds.length,
      legacyAdoptionPermitted: evaluation.legacyAdoptionPermitted,
      mappingClassDistribution: classCounts,
      mappingsAuthorizedByLegacyPolicy: authorizedByPolicy,
      blockedSourceExternalIds: evaluation.blockers.map(blocker => blocker.sourceExternalId),
    };

    if (args.json === true) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log('─'.repeat(78));
      console.log('Legacy-adoption POLICY PREFLIGHT (read-only, no writes performed)');
      console.log(`policy ${summary.policyId}`);
      console.log(`manifest ${summary.manifestId} (unchanged)`);
      console.log(`report hash ${summary.reportHash}`);
      console.log('─'.repeat(78));
      console.log(`groups evaluated:        ${summary.totalGroups}`);
      console.log(`groups authorized:       ${summary.authorizedGroups}`);
      console.log(`groups blocked:          ${summary.blockedGroups}`);
      console.log(`scoped batches:          ${summary.scopedBatchCount}`);
      console.log(`legacyAdoptionPermitted: ${summary.legacyAdoptionPermitted}`);
      console.log(
        `mapping classes:         A=${classCounts.A_LEGACY_MISSING_SCOPE} ` +
          `B=${classCounts.B_DEMONSTRABLY_FOREIGN} C=${classCounts.C_AMBIGUOUS}`,
      );
      console.log(`mappings authorized:     ${authorizedByPolicy}`);
      if (evaluation.blockedGroups > 0) {
        console.log(
          `blocked codes: ${summary.blockedSourceExternalIds.slice(0, 20).join(', ')}` +
            (summary.blockedSourceExternalIds.length > 20
              ? `, +${summary.blockedSourceExternalIds.length - 20} more`
              : ''),
        );
      }
      console.log(
        '\nSTOP POINT. No remediation writes were performed and no APPLY was attempted. ' +
          'Return this evidence for a fresh Product Owner APPLY authorization.',
      );
    }
    if (evaluation.blockedGroups > 0) process.exitCode = 1;
    return;
  }

  // ── Bounded verification of a suspended run ──────────────────────────────
  //
  // Scoped to ONE manifest id on purpose. A global "does production look
  // clean?" sweep cannot distinguish this run's effects from an unrelated
  // earlier repair, and passes silently when it scanned the wrong population.
  if (mode === 'verify-suspended') {
    const manifestPath = args.manifest;
    if (typeof manifestPath !== 'string') {
      throw new Error('--mode verify-suspended requires --manifest <manifest.json> [--json]');
    }
    const manifest = loadManifest(manifestPath);
    await preflightRemediationDatabase(manifest.scope);

    const verification = await verifySuspendedRunMutationFree(
      manifest.scope,
      manifest.manifestId,
      manifestGroupItems(manifest),
      db,
    );
    if (args.json === true) {
      console.log(JSON.stringify(verification, null, 2));
    } else {
      printSuspendedVerification(verification);
    }
    if (!verification.mutationFree) process.exitCode = 1;
    return;
  }

  assertBayHillProductionScope(requestedScope);

  // Diagnose deliberately runs BEFORE resolveScope and before preflight. Both
  // of those passed while discovery still returned zero groups, so neither can
  // be trusted to explain the exclusion; this mode reads raw columns instead.
  if (mode === 'diagnose') {
    const traceName = typeof args['trace-name'] === 'string' ? args['trace-name'] : 'Tabasco';
    const diagnostics = await diagnoseDiscovery(requestedScope, traceName);
    if (args.json === true) {
      console.log(JSON.stringify(diagnostics, null, 2));
    } else {
      printDiagnostics(diagnostics);
    }
    return;
  }

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
    // Scope/precondition refusals are already operator-readable and carry no
    // database detail; anything else may be a connection or driver failure, so
    // report the sanitized PostgreSQL cause and connection target.
    if (
      error instanceof RemediationScopeError ||
      error instanceof RemediationPreconditionError ||
      error instanceof RemediationManifestBlockedError ||
      (error instanceof Error && !isDatabaseError(error))
    ) {
      console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
      // A "row not found" refusal and a wrong-environment connection look
      // identical to an operator, which is how a driver mismatch once got
      // read as a bad scope. Always show which database answered.
      console.error(describeDatabaseTargetLine());
    } else {
      console.error(formatRemediationDbError('Remediation database operation', error));
    }
    process.exit(1);
  });
