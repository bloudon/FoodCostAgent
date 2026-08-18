/**
 * Gate 2 CLI — vendor-item duplicate merge.
 *
 * Default mode is DRY-RUN (read-only): runs Preflight 1 (B-group promotion
 * proofs), Preflight 2 (EDI payload scan), and prints the apply plan.
 *
 * APPLY mode requires BOTH:  --apply --expect-db <current database name>
 * (fail-closed DB-identity guard for a mutating bench tool).
 *
 * Usage:
 *   npx tsx src/services/orderly/vendorItemDuplicateMergeCli.ts               # dry run
 *   npx tsx src/services/orderly/vendorItemDuplicateMergeCli.ts --apply --expect-db heliumdb
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { classifyGroups, type ClassifiedGroup } from "./vendorItemDuplicateClassifier";
import {
  applyGroup,
  assertReferenceColumnsUnchanged,
  countReferences,
  ediPreflight,
  ensureAuditTable,
  loadAllVendorItems,
  loadMappings,
  makeUnitInfoResolver,
  provePromotion,
  rowsOf,
  REFERENCE_SOURCES,
  type GroupApplyResult,
} from "./vendorItemDuplicateMerge";

const APPLY = process.argv.includes("--apply");
const expectDbIdx = process.argv.indexOf("--expect-db");
const EXPECT_DB = expectDbIdx >= 0 ? process.argv[expectDbIdx + 1] : null;

async function harvillCount(): Promise<{ vendorId: string | null; count: number }> {
  const v = rowsOf(await db.execute(sql`SELECT id FROM vendors WHERE name ILIKE '%harvill%' LIMIT 1`));
  if (v.length === 0) return { vendorId: null, count: 0 };
  const c = rowsOf(await db.execute(sql`SELECT count(*)::int AS n FROM vendor_items WHERE vendor_id = ${v[0].id}`))[0].n;
  return { vendorId: v[0].id, count: c };
}

async function main() {
  const dbName = rowsOf(await db.execute(sql`SELECT current_database() AS db`))[0].db;
  console.log(`[Gate2] mode=${APPLY ? "APPLY" : "DRY-RUN"} database='${dbName}'`);
  if (APPLY) {
    if (!EXPECT_DB || EXPECT_DB !== dbName) {
      console.error(`[Gate2] FAIL CLOSED — APPLY requires --expect-db matching the connected database ('${dbName}').`);
      process.exit(2);
    }
  }

  // Fail-closed schema drift check (shared by dry-run and apply).
  await assertReferenceColumnsUnchanged(db as any);

  // ── Current-state classification (evidence snapshot, not authorization) ────
  const items = await loadAllVendorItems(db as any);
  const ids = items.map((i) => i.id);
  const mappings = await loadMappings(db as any, ids);
  const refs = await countReferences(db as any, ids);
  const groups = classifyGroups({ rows: items, mappings, referenceCounts: refs });

  const classA = groups.filter((g) => g.class === "A");
  const classB = groups.filter((g) => g.class === "B");
  const otherHeld = groups.filter((g) => g.class !== "A" && g.class !== "B");

  // ── Preflight 1 — B-group promotion proofs ─────────────────────────────────
  const units = await makeUnitInfoResolver(db as any);
  const memberById = new Map(items.map((i) => [i.id, i]));
  const promoted: ClassifiedGroup[] = [];
  const heldB: Array<{ group: ClassifiedGroup; reason: string }> = [];
  for (const g of classB) {
    const members = g.rowIds.map((id) => memberById.get(id)!);
    const proof = provePromotion(g, members, units);
    if (proof.promoted) promoted.push(g);
    else heldB.push({ group: g, reason: proof.reason });
  }
  console.log(`\n[Preflight 1] Class B groups: ${classB.length} — promoted B→A: ${promoted.length}, remaining held B: ${heldB.length}`);
  for (const h of heldB) {
    console.log(`  HELD: sku=${JSON.stringify(h.group.key.vendorSku)} — ${h.reason}`);
  }

  // ── Preflight 2 — EDI payload scan ─────────────────────────────────────────
  const mergePlan = [...classA, ...promoted];
  // Promoted B groups carry no survivor from the classifier (they were not
  // mergeable at classification time) — elect one for the plan/EDI scan. The
  // authoritative election still happens under lock in applyGroup.
  const mappingsByItem = new Map<string, typeof mappings>();
  for (const m of mappings) {
    const arr = mappingsByItem.get(m.vendorItemId) ?? [];
    arr.push(m);
    mappingsByItem.set(m.vendorItemId, arr);
  }
  const { electSurvivor } = await import("./vendorItemDuplicateClassifier");
  const proposedLoserIds = new Set<string>();
  for (const g of mergePlan) {
    const survivor = g.proposedSurvivorId ?? electSurvivor(g.rowIds, mappingsByItem, refs);
    for (const id of g.rowIds) if (id !== survivor) proposedLoserIds.add(id);
  }
  const edi = await ediPreflight(db as any, proposedLoserIds);
  console.log(`\n[Preflight 2] EDI messages: ${edi.totalMessageCount} total — proposed loser ids present: ${edi.loserIdsPresent ? "YES" : "NO"} (affected: ${edi.affectedMessageCount})`);
  console.log(`  Disposition: ${edi.disposition}`);

  const preApply = {
    generatedAt: new Date().toISOString(),
    database: dbName,
    mode: APPLY ? "apply" : "dry-run",
    currentState: {
      totalVendorItems: items.length,
      duplicateGroups: groups.length,
      classA: classA.length,
      classB: classB.length,
      otherHeld: otherHeld.length,
    },
    preflight1: {
      promotedBtoA: promoted.length,
      remainingHeldB: heldB.map((h) => ({ key: h.group.key, size: h.group.size, reason: h.reason })),
      finalPreApplyMergeableGroups: mergePlan.length,
    },
    preflight2: edi,
  };

  if (!APPLY) {
    console.log(`\n[Gate2] DRY-RUN plan: ${mergePlan.length} groups, ${[...proposedLoserIds].length} proposed deletions. No writes performed.`);
    writeReport({ ...preApply, apply: null });
    process.exit(0);
  }

  // ── APPLY ──────────────────────────────────────────────────────────────────
  if (edi.loserIdsPresent) {
    // Documented disposition (historical evidence only, never dereferenced) —
    // per PM: document and proceed without rewriting payloads. A future change
    // that dereferences payload ids must re-run this preflight.
    console.log("[Gate2] EDI loser ids exist as historical payload evidence only — proceeding per PM instruction.");
  }

  await ensureAuditTable(db as any);
  const harvillBefore = await harvillCount();

  const promotedKeys = new Set(promoted.map((g) => JSON.stringify(g.key)));
  const results: GroupApplyResult[] = [];
  let applied = 0, already = 0, stopped = 0, rowsDeleted = 0;
  const repointedByTable: Record<string, number> = {};

  for (const g of mergePlan) {
    let res: GroupApplyResult;
    try {
      res = await applyGroup(g.key, promotedKeys.has(JSON.stringify(g.key)));
    } catch (e: any) {
      res = { key: g.key, result: "stopped", code: "TX_ROLLED_BACK", reason: String(e?.message ?? e) };
    }
    results.push(res);
    if (res.result === "applied") {
      applied++;
      rowsDeleted += res.loserIds.length;
      for (const [t, n] of Object.entries(res.refsRepointed)) repointedByTable[t] = (repointedByTable[t] ?? 0) + n;
    } else if (res.result === "already_remediated") already++;
    else {
      stopped++;
      console.log(`  STOPPED [${res.code}] ${JSON.stringify(res.key)}: ${res.reason}`);
    }
  }

  // ── Post-merge verification ────────────────────────────────────────────────
  const harvillAfter = await harvillCount();

  // Zero-orphan verification. Dangling ids that appear in a merge-audit
  // loser list would be MERGE-CAUSED orphans (hard failure). Dangling ids
  // never touched by this tool are legacy debt — reported, not failed on.
  const mergeCausedOrphans: Record<string, number> = {};
  const legacyOrphans: Record<string, number> = {};
  for (const { table, column } of REFERENCE_SOURCES) {
    const rows = rowsOf(await db.execute(sql.raw(
      `SELECT r.${column} AS id, count(*)::int AS n,
              EXISTS (
                SELECT 1 FROM vendor_item_merge_audit a
                WHERE a.loser_ids @> to_jsonb(r.${column}::text)
              ) AS "isMergeLoser"
       FROM ${table} r
       WHERE r.${column} IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM vendor_items vi WHERE vi.id = r.${column})
       GROUP BY r.${column}`,
    )));
    for (const r of rows) {
      const bucket = r.isMergeLoser ? mergeCausedOrphans : legacyOrphans;
      const k = `${table}.${column}`;
      bucket[k] = (bucket[k] ?? 0) + r.n;
    }
  }
  const orphans = mergeCausedOrphans;

  // Remaining duplicates by class (full re-classification).
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

  const report = {
    ...preApply,
    apply: {
      groupsApplied: applied,
      groupsAlreadyRemediated: already,
      groupsStopped: stopped,
      rowsDeleted,
      referencesRepointedByTable: repointedByTable,
      zeroOrphanVerification:
        Object.keys(orphans).length === 0 ? "PASS (no merge-caused orphans)" : { FAIL_MERGE_CAUSED: orphans },
      legacyDanglingReferences: legacyOrphans,
      harvills: { before: harvillBefore.count, after: harvillAfter.count },
      remainingDuplicateGroupsByClass: remainingByClass,
      remainingHeldB: preApply.preflight1.remainingHeldB,
      stoppedGroups: results.filter((r) => r.result === "stopped"),
      constraintRecommendation: constraintRecommendation(groupsAfter),
    },
  };

  console.log(`\n[Gate2] POST-MERGE INVARIANT REPORT`);
  console.log(`  groups applied:            ${applied}`);
  console.log(`  groups already remediated: ${already}`);
  console.log(`  groups stopped:            ${stopped}`);
  console.log(`  rows deleted:              ${rowsDeleted}`);
  console.log(`  references repointed:      ${JSON.stringify(repointedByTable)}`);
  console.log(`  zero-orphan verification:  ${JSON.stringify(report.apply.zeroOrphanVerification)}`);
  console.log(`  legacy dangling refs:      ${JSON.stringify(legacyOrphans)} (pre-existing, not merge-caused)`);
  console.log(`  Harvill's vendor items:    ${harvillBefore.count} -> ${harvillAfter.count}`);
  console.log(`  remaining dup groups:      ${JSON.stringify(remainingByClass)}`);
  console.log(`\n[Gate2] Constraint recommendation (text only — NOT applied):\n  ${report.apply.constraintRecommendation}`);

  writeReport(report);
  process.exit(Object.keys(orphans).length === 0 ? 0 : 1);
}

function constraintRecommendation(groupsAfter: ClassifiedGroup[]): string {
  const nonA = groupsAfter.filter((g) => g.class !== "A");
  const realSkuDups = groupsAfter.filter((g) => g.skuKind === "sku");
  if (realSkuDups.length === 0) {
    return [
      "All duplicate groups with real SKUs are resolved. Proposed for separate PM approval (do NOT add in this apply):",
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS vendor_items_vendor_item_sku_uniq',
      "  ON vendor_items (vendor_id, inventory_item_id, vendor_sku)",
      "  WHERE vendor_sku IS NOT NULL AND btrim(vendor_sku) <> '';",
      "NULL/blank-SKU rows deliberately remain unconstrained (PM: NULL-SKU behavior must not be broadened).",
    ].join("\n  ");
  }
  return `HOLD: ${realSkuDups.length} duplicate groups with real SKUs remain (${nonA.length} non-A). Disposition them before proposing the uniqueness constraint.`;
}

function writeReport(report: unknown): void {
  const outDir = path.resolve(import.meta.dirname, "../../../reports");
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, "vendor-item-duplicate-merge-report.json");
  fs.writeFileSync(p, JSON.stringify(report, null, 2));
  console.log(`\n[Gate2] Report written: ${p}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
