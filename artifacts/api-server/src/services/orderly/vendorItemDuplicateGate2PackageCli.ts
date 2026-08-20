/**
 * Builds a production Gate 2 package for PM review only.
 * It contains no mutation implementation and never imports the merge/apply CLI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  buildNonExecutableGate2Package,
  sha256,
  type NonExecutableGate2Package,
} from "./vendorItemDuplicateGate2Package";
import { validateReferenceColumnCompatibility } from "./vendorItemDuplicateReferenceCompatibility";

function rowsOf(result: any): any[] {
  return Array.isArray(result) ? result : result.rows;
}

function externalAbsoluteFile(name: string): { path: string; bytes: Buffer; json: unknown } {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  const resolved = path.resolve(value);
  const appRoot = path.resolve(process.cwd());
  if (resolved === appRoot || resolved.startsWith(`${appRoot}${path.sep}`)) {
    throw new Error(`${name} must point outside the application checkout.`);
  }
  const bytes = fs.readFileSync(resolved);
  try {
    return { path: resolved, bytes, json: JSON.parse(bytes.toString("utf8")) };
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

function writePackage(pkg: NonExecutableGate2Package): { jsonPath: string; markdownPath: string } {
  const output = process.env.VENDOR_ITEM_GATE2_PACKAGE_DIR;
  if (!output || !path.isAbsolute(output)) throw new Error("VENDOR_ITEM_GATE2_PACKAGE_DIR must be an absolute path.");
  const outputDir = path.resolve(output);
  const appRoot = path.resolve(process.cwd());
  if (outputDir === appRoot || outputDir.startsWith(`${appRoot}${path.sep}`)) {
    throw new Error("VENDOR_ITEM_GATE2_PACKAGE_DIR must be outside the application checkout.");
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "vendor-item-production-gate2-package.json");
  const markdownPath = path.join(outputDir, "vendor-item-production-gate2-package.md");
  fs.writeFileSync(jsonPath, JSON.stringify(pkg, null, 2));
  fs.writeFileSync(markdownPath, `# Production Gate 2 Package — NON-EXECUTABLE

Package ID: \`${pkg.packageId}\`

## Bound evidence
- Classifier report: \`${pkg.sourceClassifierReport.absolutePath}\`
- Classifier report SHA-256: \`${pkg.sourceClassifierReport.fileSha256}\`
- Class A loser-set SHA-256: \`${pkg.sourceClassifierReport.loserSetSha256}\`
- Class A group-membership SHA-256: \`${pkg.sourceClassifierReport.classAGroupMembershipSha256}\`
- Readiness report: \`${pkg.readinessEvidence.absolutePath}\`
- Readiness report SHA-256: \`${pkg.readinessEvidence.fileSha256}\`
- Database: \`${pkg.sourceClassifierReport.database}\`

## Reviewed scope
- Class A groups: ${pkg.expectedBeforeAfter.duplicateGroupsToMerge}
- Class A loser rows: ${pkg.expectedBeforeAfter.loserRowsToDelete}
- Held Sysco SKU 7664436 group: **EXCLUDED**

## Execution status
**This file cannot perform any mutation.** It is a PM-review package only. A future, separately approved maintenance-window runner must match this package ID, both evidence file hashes, the loser-set and group-membership fingerprints, connected database identity, reference schema contract, and live under-lock group evidence before it may do anything.
`);
  return { jsonPath, markdownPath };
}

export async function runVendorItemDuplicateGate2Package(input: {
  execute?: (query: any) => Promise<any>;
  readFile?: (name: string) => { path: string; bytes: Buffer; json: unknown };
  writePackage?: (pkg: NonExecutableGate2Package) => { jsonPath: string; markdownPath: string };
} = {}): Promise<NonExecutableGate2Package> {
  if (!input.execute) {
    return db.transaction(async (tx: any) =>
      runVendorItemDuplicateGate2Package({ ...input, execute: (query: any) => tx.execute(query) }),
    );
  }
  const execute = input.execute;
  await execute("SET TRANSACTION READ ONLY");
  const dbName = rowsOf(await execute(sql`SELECT current_database() AS db`))[0]?.db;
  if (!dbName) throw new Error("Unable to determine connected database identity.");
  const liveColumns = rowsOf(await execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name LIKE '%vendor_item%'
      AND table_name <> 'vendor_items'
    ORDER BY table_name, column_name
  `)).map((row: any) => `${row.table_name}.${row.column_name}`);
  const reference = validateReferenceColumnCompatibility(liveColumns);
  const readFile = input.readFile ?? externalAbsoluteFile;
  const classifier = readFile("VENDOR_ITEM_DUPLICATE_REPORT_PATH");
  const readiness = readFile("VENDOR_ITEM_GATE2_READINESS_REPORT_PATH");
  const pkg = buildNonExecutableGate2Package({
    classifierReport: classifier.json,
    classifierReportPath: classifier.path,
    classifierReportFileSha256: sha256(classifier.bytes),
    readinessEvidence: readiness.json,
    readinessEvidencePath: readiness.path,
    readinessEvidenceFileSha256: sha256(readiness.bytes),
    connectedDatabase: dbName,
    referenceCompatibility: reference.sourceCompatibility,
  });
  const paths = (input.writePackage ?? writePackage)(pkg);
  console.log(`[Gate2 package] NON-EXECUTABLE packageId=${pkg.packageId}`);
  console.log(`[Gate2 package] JSON: ${paths.jsonPath}\n[Gate2 package] Markdown: ${paths.markdownPath}`);
  return pkg;
}

export async function executeVendorItemDuplicateGate2Package(): Promise<number> {
  try {
    await runVendorItemDuplicateGate2Package();
    return 0;
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void executeVendorItemDuplicateGate2Package();
}