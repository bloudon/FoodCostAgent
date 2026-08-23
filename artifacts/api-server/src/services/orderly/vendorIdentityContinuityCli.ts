/**
 * Read-only vendor identity report.
 *
 * Required:
 *   VENDOR_IDENTITY_COMPANY_ID
 * Optional:
 *   VENDOR_IDENTITY_REPORT_PATH
 *
 * This command never calls the consolidation apply function.
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadVendorIdentityReport } from "./vendorIdentityContinuity";

const companyId = process.env.VENDOR_IDENTITY_COMPANY_ID?.trim();
if (!companyId) throw new Error("VENDOR_IDENTITY_COMPANY_ID is required.");
const report = await loadVendorIdentityReport(companyId);
const outputPath = resolve(
  process.env.VENDOR_IDENTITY_REPORT_PATH?.trim()
    || `../../reports/vendor-identity-${companyId}.json`,
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  reportPath: outputPath,
  companyId: report.companyId,
  vendorCount: report.vendorCount,
  evidenceCount: report.evidenceCount,
  pairCount: report.pairCount,
  classificationCounts: report.classificationCounts,
  reconciledPairs: report.pairs.filter((x) => x.evidenceStatus === "reconciled").map((x) => ({
    left: x.left.name,
    right: x.right.name,
    classification: x.classification,
  })),
}, null, 2));