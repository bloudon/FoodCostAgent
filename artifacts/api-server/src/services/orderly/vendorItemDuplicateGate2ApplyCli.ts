/**
 * Gate 2 package-bound production apply CLI.
 *
 * Reads the reviewed non-executable Gate 2 package, re-validates every bound
 * evidence claim (packageId integrity, evidence file byte hashes, database
 * identity, reference schema), then applies exactly the 2,429 reviewed Class A
 * groups it describes.
 *
 * What this CLI does NOT do:
 *   - Does NOT run B-group promotion logic.
 *   - Does NOT touch Sysco SKU 7664436 — both held vendor-item IDs are
 *     explicitly rejected if they appear anywhere in the package scope.
 *   - Does NOT create a uniqueness index.
 *   - Does NOT change prices, price history, pack geometry, or invoice history.
 *   - Does NOT run Orderly preview or Orderly APPLY.
 *
 * Required env vars:
 *   VENDOR_ITEM_GATE2_PACKAGE_PATH       Absolute path to the Gate 2 package JSON.
 *   VENDOR_ITEM_GATE2_APPLY_REPORT_DIR   Absolute external output directory.
 *
 * Apply-only env var (enables Phase 2 mutation):
 *   VENDOR_ITEM_GATE2_APPLY              Must be exactly "yes".
 *
 * Optional defence-in-depth for apply mode:
 *   VENDOR_ITEM_GATE2_EXPECT_DB          If set, must match the connected database.
 *
 * Exit codes:  0 = success,  1 = refused / failure.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { classifyGroups } from "./vendorItemDuplicateClassifier";
import {
  applyGroup,
  assertReferenceColumnsUnchanged,
  countReferences,
  ediPreflight,
  ensureAuditTable,
  loadAllVendorItems,
  loadMappings,
  REFERENCE_SOURCES,
  rowsOf,
  type GroupKey,
} from "./vendorItemDuplicateMerge";
import { canonicalJson, sha256 } from "./vendorItemDuplicateGate2Package";
import { EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT } from "./vendorItemDuplicateGate2Readiness";

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPECTED_CLASS_A_GROUPS = 2429;

/** Both vendor-item IDs in the Sysco SKU 7664436 Class B held group. */
export const SYSCO_HELD_VENDOR_ITEM_IDS: ReadonlySet<string> = new Set([
  "04f822ba-fb2d-479e-9f9b-6aefc4b0af90",
  "ca185955-ce85-4c92-be7e-875974c0100d",
]);

// ── Package shape ─────────────────────────────────────────────────────────────

export type ReviewedPackageGroup = {
  groupKey: unknown;
  survivorId: string;
  loserIds: string[];
};

export type Gate2PackageShape = {
  format: string;
  executionProhibited: boolean;
  packageId: string;
  sourceClassifierReport: { absolutePath: string; fileSha256: string; database: string };
  readinessEvidence: { absolutePath: string; fileSha256: string; ediSoftReferenceRisk: string };
  reviewedGroups: ReviewedPackageGroup[];
  expectedBeforeAfter: { loserRowsToDelete: number; duplicateGroupsToMerge: number };
};

// ── Package validation (exported for tests) ───────────────────────────────────

export type ValidationResult = {
  pkg: Gate2PackageShape;
  loserSet: Set<string>;
  groups: Array<{ key: GroupKey; survivorId: string; loserIds: string[] }>;
};

/**
 * Load and validate the Gate 2 package. The same `readFile` function is used
 * for the package itself and for its bound evidence files so tests can inject
 * a mock reader without touching the real file system.
 *
 * Checks performed:
 *   - Package JSON is parseable and carries the expected format / flag.
 *   - packageId integrity: re-hashes the core (everything except packageId).
 *   - Evidence file bytes re-hash to the stored hashes.
 *   - EDI soft-reference risk is CLOSED.
 *   - reviewedGroups count is exactly 2,429.
 *   - Derived loser set size is exactly 6,038.
 *   - Neither Sysco held vendor-item ID appears as a survivor or loser.
 */
export function loadAndValidatePackage(
  pkgPath: string,
  appRoot: string,
  readFile: (p: string) => Buffer = (p) => fs.readFileSync(p),
): ValidationResult {
  // 1. Read and parse.
  let raw: string;
  try {
    raw = readFile(pkgPath).toString("utf8");
  } catch (e: any) {
    throw new Error(`Cannot read Gate 2 package at ${pkgPath}: ${String(e?.message ?? e)}`);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gate 2 package is not valid JSON.");
  }

  // 2. Format and execution-prohibited flags.
  if (parsed.format !== "vendor-item-production-gate2-package-v1") {
    throw new Error(`Package format not recognized: ${String(parsed.format)}`);
  }
  if (parsed.executionProhibited !== true) {
    throw new Error("Package must carry executionProhibited:true — refusing.");
  }

  // 3. Package ID integrity: recompute SHA-256 over the core (sans packageId).
  const { packageId, ...core } = parsed;
  if (typeof packageId !== "string") throw new Error("Package has no packageId string.");
  const derivedId = sha256(canonicalJson(core));
  if (derivedId !== packageId) {
    throw new Error(
      `Package ID integrity check failed.\n  stored:  ${packageId}\n  derived: ${derivedId}`,
    );
  }

  const pkg = parsed as unknown as Gate2PackageShape;

  // 4. Re-hash bound evidence files.
  for (const { absPath, storedHash, label } of [
    {
      absPath: pkg.sourceClassifierReport.absolutePath,
      storedHash: pkg.sourceClassifierReport.fileSha256,
      label: "classifier report",
    },
    {
      absPath: pkg.readinessEvidence.absolutePath,
      storedHash: pkg.readinessEvidence.fileSha256,
      label: "readiness evidence",
    },
  ]) {
    if (!path.isAbsolute(absPath)) {
      throw new Error(`Package bound ${label} path is not absolute: ${absPath}`);
    }
    if (absPath === appRoot || absPath.startsWith(`${appRoot}${path.sep}`)) {
      throw new Error(
        `Package bound ${label} path must be outside the application checkout: ${absPath}`,
      );
    }
    let bytes: Buffer;
    try {
      bytes = readFile(absPath);
    } catch (e: any) {
      throw new Error(`Cannot read bound ${label} at ${absPath}: ${String(e?.message ?? e)}`);
    }
    const actual = sha256(bytes);
    if (actual !== storedHash) {
      throw new Error(
        `${label} file hash mismatch.\n  package: ${storedHash}\n  actual:  ${actual}\n  path:    ${absPath}`,
      );
    }
  }

  // 5. EDI CLOSED assertion.
  if (pkg.readinessEvidence.ediSoftReferenceRisk !== "CLOSED") {
    throw new Error(
      `Package EDI soft-reference risk is not CLOSED: ${pkg.readinessEvidence.ediSoftReferenceRisk}`,
    );
  }

  // 6. Scope size validation.
  if (!Array.isArray(pkg.reviewedGroups)) {
    throw new Error("Package has no reviewedGroups array.");
  }
  if (pkg.reviewedGroups.length !== EXPECTED_CLASS_A_GROUPS) {
    throw new Error(
      `Package has ${pkg.reviewedGroups.length} reviewed groups; expected ${EXPECTED_CLASS_A_GROUPS}.`,
    );
  }

  // 7. Build group list and loser set; enforce Sysco exclusion.
  const loserSet = new Set<string>();
  const groups: ValidationResult["groups"] = [];

  for (let i = 0; i < pkg.reviewedGroups.length; i++) {
    const g = pkg.reviewedGroups[i];
    const gKey = g.groupKey as Record<string, unknown>;
    if (
      !gKey ||
      typeof gKey.vendorId !== "string" ||
      typeof gKey.inventoryItemId !== "string"
    ) {
      throw new Error(`Group ${i} has invalid groupKey shape: ${JSON.stringify(g.groupKey)}`);
    }
    const key: GroupKey = {
      vendorId: gKey.vendorId,
      inventoryItemId: gKey.inventoryItemId,
      vendorSku:
        gKey.vendorSku !== undefined ? (gKey.vendorSku as string | null) : null,
    };

    if (SYSCO_HELD_VENDOR_ITEM_IDS.has(g.survivorId)) {
      throw new Error(
        `Refused: Sysco held vendor item ${g.survivorId} appears as survivor in group ${i}.`,
      );
    }
    for (const loserId of g.loserIds) {
      if (SYSCO_HELD_VENDOR_ITEM_IDS.has(loserId)) {
        throw new Error(
          `Refused: Sysco held vendor item ${loserId} appears in loser set of group ${i}.`,
        );
      }
      loserSet.add(loserId);
    }
    groups.push({ key, survivorId: g.survivorId, loserIds: [...g.loserIds] });
  }

  if (loserSet.size !== EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT) {
    throw new Error(
      `Derived loser set has ${loserSet.size} entries; expected ${EXPECTED_PRODUCTION_CLASS_A_LOSER_COUNT}.`,
    );
  }

  return { pkg, loserSet, groups };
}

// ── Report writing ────────────────────────────────────────────────────────────

function writeExternalReport(
  reportDir: string,
  appRoot: string,
  name: string,
  report: unknown,
): string {
  if (reportDir === appRoot || reportDir.startsWith(`${appRoot}${path.sep}`)) {
    throw new Error("VENDOR_ITEM_GATE2_APPLY_REPORT_DIR must be outside the application checkout.");
  }
  fs.mkdirSync(reportDir, { recursive: true });
  const p = path.join(reportDir, name);
  fs.writeFileSync(p, JSON.stringify(report, null, 2));
  return p;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const appRoot = path.resolve(process.cwd());
  const APPLY = process.env.VENDOR_ITEM_GATE2_APPLY === "yes";

  const pkgPath = process.env.VENDOR_ITEM_GATE2_PACKAGE_PATH;
  if (!pkgPath || !path.isAbsolute(pkgPath)) {
    throw new Error("VENDOR_ITEM_GATE2_PACKAGE_PATH must be set to an absolute path.");
  }
  const reportDir = process.env.VENDOR_ITEM_GATE2_APPLY_REPORT_DIR;
  if (!reportDir || !path.isAbsolute(reportDir)) {
    throw new Error("VENDOR_ITEM_GATE2_APPLY_REPORT_DIR must be set to an absolute path.");
  }

  console.log(`[Gate2-Apply] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  // Load and validate the package — fail closed on any evidence drift.
  const { pkg, loserSet, groups } = loadAndValidatePackage(pkgPath, appRoot);
  const boundDatabase = pkg.sourceClassifierReport.database;
  console.log(`[Gate2-Apply] packageId=${pkg.packageId.slice(0, 16)}...`);
  console.log(`[Gate2-Apply] scope: ${groups.length} groups, ${loserSet.size} loser rows`);
  console.log(`[Gate2-Apply] bound database: ${boundDatabase}`);

  // Database identity verification against the package.
  const dbRow = rowsOf(await db.execute(sql`SELECT current_database() AS db`))[0] as { db: string };
  const dbName = dbRow.db;
  console.log(`[Gate2-Apply] connected database: '${dbName}'`);
  if (dbName !== boundDatabase) {
    throw new Error(
      `Database identity mismatch. connected='${dbName}' bound='${boundDatabase}'. STOP.`,
    );
  }

  // Optional defence-in-depth EXPECT_DB guard for apply mode.
  if (APPLY) {
    const expectDb = process.env.VENDOR_ITEM_GATE2_EXPECT_DB;
    if (expectDb && expectDb !== dbName) {
      throw new Error(
        `VENDOR_ITEM_GATE2_EXPECT_DB='${expectDb}' does not match connected database '${dbName}'. STOP.`,
      );
    }
  }

  // Reference column schema drift check — fail closed.
  await assertReferenceColumnsUnchanged(db as any);
  console.log("[Gate2-Apply] Reference column schema: UNCHANGED (matches reviewed contract)");

  // Live classification for count verification and EDI preflight.
  const items = await loadAllVendorItems(db as any);
  const ids = items.map((i) => i.id);
  const mappings = await loadMappings(db as any, ids);
  const refs = await countReferences(db as any, ids);
  const liveGroups = classifyGroups({ rows: items, mappings, referenceCounts: refs });
  const liveClassA = liveGroups.filter((g) => g.class === "A");
  const liveClassB = liveGroups.filter((g) => g.class === "B");
  const liveOther = liveGroups.filter((g) => g.class !== "A" && g.class !== "B");

  console.log(
    `[Gate2-Apply] Live: totalVendorItems=${items.length} classA=${liveClassA.length} classB=${liveClassB.length} other=${liveOther.length}`,
  );

  // Class A count must not exceed the approved baseline.
  // A lower count means some groups already applied (idempotent rerun path).
  if (liveClassA.length > EXPECTED_CLASS_A_GROUPS) {
    throw new Error(
      `Live Class A count (${liveClassA.length}) exceeds approved baseline (${EXPECTED_CLASS_A_GROUPS}). ` +
        `Re-run the classifier to verify current state before proceeding.`,
    );
  }

  // EDI preflight with the package's loser set (CLOSED per readiness evidence).
  const edi = await ediPreflight(db as any, loserSet);
  const ediSummary = `${edi.totalMessageCount} messages, loserIdsPresent=${edi.loserIdsPresent} (${edi.affectedMessageCount} affected)`;
  console.log(`[Gate2-Apply] EDI: ${ediSummary}`);
  if (edi.loserIdsPresent) {
    console.log(
      "[Gate2-Apply] EDI loser ids: historical payload evidence only — disposition CLOSED per reviewed readiness evidence.",
    );
  }

  const preApply = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    database: dbName,
    packageId: pkg.packageId,
    packageScope: {
      reviewedGroups: groups.length,
      loserRows: loserSet.size,
      ediSoftReferenceRisk: pkg.readinessEvidence.ediSoftReferenceRisk,
    },
    currentState: {
      totalVendorItems: items.length,
      classA: liveClassA.length,
      classB: liveClassB.length,
      otherHeld: liveOther.length,
    },
    ediPreflight: edi,
    syscoHeldExcluded: {
      vendorItemIds: [...SYSCO_HELD_VENDOR_ITEM_IDS],
      rule: "excluded by package construction — Class B held group, not in Class A scope",
    },
  };

  if (!APPLY) {
    const p = writeExternalReport(
      reportDir,
      appRoot,
      "vendor-item-gate2-dry-run-report.json",
      { ...preApply, apply: null },
    );
    console.log(
      `[Gate2-Apply] DRY-RUN COMPLETE — ${liveClassA.length} live Class A groups, ${loserSet.size} package losers.`,
    );
    console.log(`[Gate2-Apply] Report: ${p}`);
    return 0;
  }

  // ── APPLY ──────────────────────────────────────────────────────────────────
  await ensureAuditTable(db as any);

  let applied = 0;
  let already = 0;
  let stopped = 0;
  let rowsDeleted = 0;
  const repointedByTable: Record<string, number> = {};
  const stoppedGroups: unknown[] = [];

  for (const group of groups) {
    let result;
    try {
      // expectPromotion=false: all reviewed groups are Class A, no B→A promotion.
      result = await applyGroup(group.key, false);
    } catch (e: any) {
      result = {
        key: group.key,
        result: "stopped" as const,
        code: "TX_ROLLED_BACK",
        reason: String(e?.message ?? e),
      };
    }
    if (result.result === "applied") {
      applied++;
      rowsDeleted += result.loserIds.length;
      for (const [t, n] of Object.entries(result.refsRepointed)) {
        repointedByTable[t] = (repointedByTable[t] ?? 0) + n;
      }
    } else if (result.result === "already_remediated") {
      already++;
    } else {
      stopped++;
      stoppedGroups.push({ key: group.key, code: result.code, reason: result.reason });
      console.log(`  STOPPED [${result.code}] ${JSON.stringify(group.key)}: ${result.reason}`);
    }
  }

  // ── Post-apply: zero-orphan verification ───────────────────────────────────
  const mergeCausedOrphans: Record<string, number> = {};
  const legacyOrphans: Record<string, number> = {};
  for (const { table, column } of REFERENCE_SOURCES) {
    const rows = rowsOf(
      await db.execute(
        sql.raw(
          `SELECT r.${column} AS id, count(*)::int AS n,
                  EXISTS (
                    SELECT 1 FROM vendor_item_merge_audit a
                    WHERE a.loser_ids @> to_jsonb(r.${column}::text)
                  ) AS "isMergeLoser"
           FROM ${table} r
           WHERE r.${column} IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM vendor_items vi WHERE vi.id = r.${column})
           GROUP BY r.${column}`,
        ),
      ),
    );
    for (const r of rows as Array<{ id: string; n: number; isMergeLoser: boolean }>) {
      const bucket = r.isMergeLoser ? mergeCausedOrphans : legacyOrphans;
      const k = `${table}.${column}`;
      bucket[k] = (bucket[k] ?? 0) + r.n;
    }
  }

  // ── Post-apply: re-classify to verify Class A cleared ──────────────────────
  const itemsAfter = await loadAllVendorItems(db as any);
  const idsAfter = itemsAfter.map((i) => i.id);
  const groupsAfter = classifyGroups({
    rows: itemsAfter,
    mappings: await loadMappings(db as any, idsAfter),
    referenceCounts: await countReferences(db as any, idsAfter),
  });
  const remainingByClass = groupsAfter.reduce<Record<string, number>>((acc, g) => {
    acc[g.class] = (acc[g.class] ?? 0) + 1;
    return acc;
  }, {});
  const remainingClassA = remainingByClass.A ?? 0;

  const zeroOrphanVerification =
    Object.keys(mergeCausedOrphans).length === 0
      ? "PASS (no merge-caused orphans)"
      : { FAIL_MERGE_CAUSED: mergeCausedOrphans };
  const classAGroupsCleared =
    remainingClassA === 0
      ? "PASS (no remaining Class A)"
      : `FAIL (${remainingClassA} Class A remaining)`;

  console.log(`\n[Gate2-Apply] POST-APPLY INVARIANT REPORT`);
  console.log(`  groups applied:            ${applied}`);
  console.log(`  groups already remediated: ${already}`);
  console.log(`  groups stopped:            ${stopped}`);
  console.log(`  rows deleted:              ${rowsDeleted}`);
  console.log(`  references repointed:      ${JSON.stringify(repointedByTable)}`);
  console.log(`  zero-orphan:               ${JSON.stringify(zeroOrphanVerification)}`);
  console.log(`  class A cleared:           ${classAGroupsCleared}`);
  console.log(`  remaining by class:        ${JSON.stringify(remainingByClass)}`);
  console.log(`  legacy dangling refs:      ${JSON.stringify(legacyOrphans)} (pre-existing, not merge-caused)`);

  const applyReport = {
    ...preApply,
    apply: {
      groupsApplied: applied,
      groupsAlreadyRemediated: already,
      groupsStopped: stopped,
      rowsDeleted,
      referencesRepointedByTable: repointedByTable,
      zeroOrphanVerification,
      classAGroupsCleared,
      remainingDuplicateGroupsByClass: remainingByClass,
      legacyDanglingReferences: legacyOrphans,
      stoppedGroups,
    },
  };

  const p = writeExternalReport(
    reportDir,
    appRoot,
    "vendor-item-gate2-apply-report.json",
    applyReport,
  );
  console.log(`\n[Gate2-Apply] Report: ${p}`);

  const hasOrphans = Object.keys(mergeCausedOrphans).length > 0;
  if (hasOrphans || stopped > 0 || remainingClassA > 0) {
    const reasons = [
      hasOrphans && "merge-caused orphans detected",
      stopped > 0 && `${stopped} groups stopped`,
      remainingClassA > 0 && `${remainingClassA} Class A groups remain`,
    ]
      .filter(Boolean)
      .join("; ");
    console.error(`[Gate2-Apply] FAIL: ${reasons}`);
    return 1;
  }

  console.log(
    `[Gate2-Apply] APPLY COMPLETE — ${applied} groups applied, ${rowsDeleted} rows deleted, ${already} idempotent.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error("[Gate2-Apply]", e);
      process.exit(1);
    });
}
