/**
 * Explicit second-phase vendor consolidation command.
 *
 * This command is intentionally unusable until a read-only report has
 * reconciled the claimed invoice evidence to the current database. It never
 * reads live Orderly data, and does not touch product/pack identities.
 *
 * Required:
 *   VENDOR_IDENTITY_APPLY=yes
 *   VENDOR_IDENTITY_REPORT_PATH=/absolute/path/to/reviewed-report.json
 *   VENDOR_IDENTITY_REPORT_SHA256=<sha256 of exact reviewed report bytes>
 *   VENDOR_IDENTITY_COMPANY_ID=<company id>
 *   VENDOR_IDENTITY_SURVIVOR_VENDOR_ID=<exact vendor id>
 *   VENDOR_IDENTITY_LOSER_VENDOR_ID=<exact vendor id>
 *   VENDOR_IDENTITY_APPROVAL_REFERENCE=<human approval reference>
 *   VENDOR_IDENTITY_CONFIRM_PAIR=<survivor id>:<loser id>
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyVendorIdentityMerge,
  type VendorIdentityPairResult,
  type VendorIdentityReport,
} from "./vendorIdentityContinuity";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

if (process.env.VENDOR_IDENTITY_APPLY !== "yes") {
  throw new Error('Refusing mutation. Set VENDOR_IDENTITY_APPLY exactly to "yes" after review.');
}

const reportPath = resolve(required("VENDOR_IDENTITY_REPORT_PATH"));
const bytes = await readFile(reportPath);
const actualHash = createHash("sha256").update(bytes).digest("hex");
const expectedHash = required("VENDOR_IDENTITY_REPORT_SHA256");
if (actualHash !== expectedHash) {
  throw new Error(`Reviewed report hash mismatch. expected=${expectedHash} actual=${actualHash}`);
}
let report: VendorIdentityReport;
try {
  report = JSON.parse(bytes.toString("utf8")) as VendorIdentityReport;
} catch {
  throw new Error("VENDOR_IDENTITY_REPORT_PATH is not valid JSON.");
}
if (report.format !== "vendor-identity-invoice-continuity-report-v1") {
  throw new Error(`Unsupported report format: ${String((report as any).format)}`);
}

const companyId = required("VENDOR_IDENTITY_COMPANY_ID");
const survivorVendorId = required("VENDOR_IDENTITY_SURVIVOR_VENDOR_ID");
const loserVendorId = required("VENDOR_IDENTITY_LOSER_VENDOR_ID");
const approvalReference = required("VENDOR_IDENTITY_APPROVAL_REFERENCE");
if (report.companyId !== companyId) {
  throw new Error("Reviewed report company ID does not match VENDOR_IDENTITY_COMPANY_ID.");
}
if (required("VENDOR_IDENTITY_CONFIRM_PAIR") !== `${survivorVendorId}:${loserVendorId}`) {
  throw new Error("VENDOR_IDENTITY_CONFIRM_PAIR must exactly match survivor:loser.");
}

const pair = report.pairs.find((candidate) => {
  const ids = new Set([candidate.left.id, candidate.right.id]);
  return ids.has(survivorVendorId) && ids.has(loserVendorId) && ids.size === 2;
});
if (!pair) throw new Error("The requested exact vendor IDs are not a pair in the reviewed report.");
assertEligiblePair(pair);

const result = await applyVendorIdentityMerge({
  companyId,
  survivorVendorId,
  loserVendorId,
  evidenceReportHash: actualHash,
  decisionScope: {
    approvalReference,
    reportGeneratedAt: report.generatedAt,
    pair: {
      left: { id: pair.left.id, name: pair.left.name },
      right: { id: pair.right.id, name: pair.right.name },
      classification: pair.classification,
      evidenceStatus: pair.evidenceStatus,
      reasons: pair.reasons,
      metrics: pair.metrics,
      suppliedReviewClaim: pair.suppliedReviewClaim?.key ?? null,
    },
  },
});
console.log(JSON.stringify({ reportPath, reportSha256: actualHash, approvalReference, result }, null, 2));

function assertEligiblePair(pair: VendorIdentityPairResult): asserts pair is VendorIdentityPairResult {
  if (pair.classification !== "proven_same_vendor" || pair.evidenceStatus !== "reconciled") {
    throw new Error(
      `Pair is not eligible for consolidation: classification=${pair.classification}, evidenceStatus=${pair.evidenceStatus}`,
    );
  }
}