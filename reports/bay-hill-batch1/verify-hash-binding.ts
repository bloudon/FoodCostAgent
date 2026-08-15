/**
 * Read-only verification of the report/manifest hash binding.
 * Performs no database access and no mutation.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  computeReportHash,
  computeUnapprovedRemainderHash,
} from '../../artifacts/api-server/src/services/orderly/orderlyDuplicateRemediation.js';

const acceptedPath = 'reports/bay-hill-batch1/bay-hill-report-accepted.json';
const manifestPath = 'reports/bay-hill-batch1/bay-hill-batch1-manifest.json';

const acceptedRaw = readFileSync(acceptedPath);
const report = JSON.parse(acceptedRaw.toString('utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const PM_ZERO_GROUP_HASH = '4672f3bd98629f82604b2f5cf1622888d644c3973ce777bf70256b1738cfb9ee';

const recomputed = computeReportHash(report.scope, report.groups);
const emptyScopeHash = computeReportHash(report.scope, []);

const approvals = manifest.groups.map((g: any) => ({ sourceExternalId: g.sourceExternalId }));
const recomputedRemainder = computeUnapprovedRemainderHash(report as any, approvals);

const classificationCounts: Record<string, number> = {};
for (const group of report.groups) {
  classificationCounts[group.classification] = (classificationCounts[group.classification] ?? 0) + 1;
}

console.log(JSON.stringify({
  acceptedFileSha256: createHash('sha256').update(acceptedRaw).digest('hex'),
  storedReportHash: report.reportHash,
  recomputedInternalReportHash: recomputed,
  internalHashMatches: recomputed === report.reportHash,
  emptyGroupHashUnderSameScope: emptyScopeHash,
  emptyGroupHashEqualsPmZeroGroupHash: emptyScopeHash === PM_ZERO_GROUP_HASH,
  manifestReportHash: manifest.reportHash,
  manifestBindsAcceptedReport: manifest.reportHash === report.reportHash,
  manifestUnapprovedReportHash: manifest.unapprovedReportHash,
  recomputedRemainderHash: recomputedRemainder,
  remainderMatches: recomputedRemainder === manifest.unapprovedReportHash,
  reportVersion: report.reportVersion,
  totals: report.totals,
  groupCount: report.groups.length,
  classificationCounts,
  scope: report.scope,
}, null, 2));
