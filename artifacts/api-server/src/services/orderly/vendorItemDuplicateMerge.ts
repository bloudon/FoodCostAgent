/**
 * Gate 2 — vendor-item duplicate merge (Task: "Gate 2 apply: merge the proven
 * duplicate vendor catalog rows (PM GO)").
 *
 * PM-approved scope: cleanup ONLY. No uniqueness constraint, no insert-path
 * refactor here.
 *
 * Flow:
 *   Preflight 1 (read-only)  — prove each held Class B group promotes to A:
 *     the group's ONLY pack conflict is canonical_qty null-vs-value, and the
 *     non-null canonical qty is deterministically re-derivable from the NULL
 *     row's own pack evidence via the production computePackGeometry()
 *     function. No geometry is ever copied to force a pass.
 *   Preflight 2 (read-only)  — scan edi_messages.payload_json for proposed
 *     loser ids (YES/NO, message count, dereference disposition).
 *   Apply (per group, transactional) — lock rows, reclassify under lock
 *     (including re-proving any B→A promotion under lock), elect survivor,
 *     repoint references that appeared since dry-run, verify conservation,
 *     delete losers, write an audit row (the idempotency anchor).
 *
 * PM clarification honored: expected counts are verification expectations,
 * not authorization. Every group is authorized solely by its own under-lock
 * evidence; drift stops only the affected group and is reported.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  classifyGroups,
  comparePackGeometry,
  electSurvivor,
  type ClassifiedGroup,
  type ClassifierVendorItemRow,
  type ExternalMappingRow,
  type ReferenceCounts,
} from "./vendorItemDuplicateClassifier";
import { computePackGeometry } from "../vendorPackGeometry";

export function rowsOf(r: any): any[] {
  return Array.isArray(r) ? r : r.rows;
}

// Any transaction/db handle that supports .execute — apply reads and verifies
// through the SAME tx handle it mutates with (see memory: verify through the
// tx handle before sealing).
type Executor = { execute: (q: any) => Promise<any> };

const REL_TOL_CANONICAL = 1e-6;

/**
 * Membership fragment for arbitrarily large id lists. Drizzle expands a JS
 * array bound into `ANY(...)` as a ROW expression, which Postgres caps at
 * 1664 entries; passing the ids as one jsonb parameter avoids the cap.
 */
function idSet(ids: string[]) {
  return sql`(SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;
}

function relEqual(a: number, b: number, tol = REL_TOL_CANONICAL): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= tol * scale;
}

// ─── Shared row loading (same SELECT for preflight and under-lock recheck) ───

const VENDOR_ITEM_COLUMNS = `
  id, vendor_id AS "vendorId", inventory_item_id AS "inventoryItemId",
  vendor_sku AS "vendorSku", brand_name AS "brandName",
  purchase_unit_id AS "purchaseUnitId", case_size AS "caseSize",
  inner_pack_size AS "innerPackSize", pack_uom AS "packUom",
  last_price AS "lastPrice", last_case_price AS "lastCasePrice",
  active, price_source AS "priceSource",
  canonical_qty_per_purchase_unit AS "canonicalQtyPerPurchaseUnit",
  pricing_basis AS "pricingBasis", is_variable_weight AS "isVariableWeight",
  pack_geometry_status AS "packGeometryStatus"`;

export async function loadAllVendorItems(ex: Executor): Promise<ClassifierVendorItemRow[]> {
  return rowsOf(await ex.execute(sql.raw(`SELECT ${VENDOR_ITEM_COLUMNS} FROM vendor_items`)));
}

export async function loadGroupRowsForUpdate(
  ex: Executor,
  key: GroupKey,
): Promise<ClassifierVendorItemRow[]> {
  const skuPredicate =
    key.vendorSku === null ? sql`vendor_sku IS NULL` : sql`vendor_sku = ${key.vendorSku}`;
  return rowsOf(
    await ex.execute(sql`
      SELECT ${sql.raw(VENDOR_ITEM_COLUMNS)}
      FROM vendor_items
      WHERE vendor_id = ${key.vendorId}
        AND inventory_item_id = ${key.inventoryItemId}
        AND ${skuPredicate}
      FOR UPDATE`),
  );
}

export async function loadMappings(ex: Executor, vendorItemIds: string[]): Promise<ExternalMappingRow[]> {
  if (vendorItemIds.length === 0) return [];
  return rowsOf(
    await ex.execute(sql`
      SELECT vendor_item_id AS "vendorItemId", source_system AS "sourceSystem",
             source_property_id AS "sourcePropertyId", source_external_id AS "sourceExternalId"
      FROM vendor_item_external_mappings
      WHERE vendor_item_id IN ${idSet(vendorItemIds)}`),
  );
}

/** The 8 audited DB columns holding vendor_items ids. */
export const REFERENCE_SOURCES: Array<{ table: string; column: string }> = [
  { table: "historical_invoice_lines", column: "vendor_item_id" },
  { table: "inventory_item_price_history", column: "vendor_item_id" },
  { table: "po_lines", column: "vendor_item_id" },
  { table: "po_routing_audit", column: "vendor_item_id" },
  { table: "po_routing_audit", column: "source_vendor_item_id" },
  { table: "receipt_lines", column: "vendor_item_id" },
  { table: "vendor_invoice_import_lines", column: "resolved_vendor_item_id" },
  { table: "vendor_item_external_mappings", column: "vendor_item_id" },
];

/** Fail closed if the live schema grows a new vendor_item reference column. */
export async function assertReferenceColumnsUnchanged(ex: Executor): Promise<void> {
  const live = rowsOf(
    await ex.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name LIKE '%vendor_item%'
        AND table_name NOT IN ('vendor_items', 'vendor_item_merge_audit')
      ORDER BY table_name, column_name`),
  ).map((x: any) => `${x.table_name}.${x.column_name}`);
  const expected = REFERENCE_SOURCES.map((s) => `${s.table}.${s.column}`).sort();
  if (JSON.stringify(live) !== JSON.stringify(expected)) {
    throw new Error(
      `Reference column set drifted since the audited enumeration. live=${JSON.stringify(live)} expected=${JSON.stringify(expected)}. STOP — re-audit before applying.`,
    );
  }
}

export async function countReferences(
  ex: Executor,
  vendorItemIds: string[],
  sources: ReadonlyArray<{ table: string; column: string }> = REFERENCE_SOURCES,
): Promise<ReferenceCounts> {
  const out: ReferenceCounts = new Map();
  if (vendorItemIds.length === 0) return out;
  for (const { table, column } of sources) {
    const rows = rowsOf(
      await ex.execute(sql`
        SELECT ${sql.raw(column)} AS id, count(*)::int AS n
        FROM ${sql.raw(table)}
        WHERE ${sql.raw(column)} IN ${idSet(vendorItemIds)}
        GROUP BY ${sql.raw(column)}`),
    );
    for (const r of rows) {
      const m = out.get(r.id) ?? new Map<string, number>();
      m.set(`${table}.${column}`, (m.get(`${table}.${column}`) ?? 0) + r.n);
      out.set(r.id, m);
    }
  }
  return out;
}

// ─── Preflight 1: B-group promotion prover ───────────────────────────────────

export interface UnitInfoResolver {
  /** canonical unit name for an inventory item (its tracked unit). */
  canonicalUnitNameFor(inventoryItemId: string): string | null;
}

export async function makeUnitInfoResolver(ex: Executor): Promise<UnitInfoResolver> {
  const rows = rowsOf(
    await ex.execute(sql`
      SELECT ii.id AS "inventoryItemId", u.name AS "unitName"
      FROM inventory_items ii
      JOIN units u ON u.id = ii.unit_id`),
  );
  const map = new Map<string, string>(rows.map((r: any) => [r.inventoryItemId, r.unitName]));
  return { canonicalUnitNameFor: (id) => map.get(id) ?? null };
}

export interface PromotionProof {
  promoted: boolean;
  reason: string;
  /** the value every member must carry after… nothing — never written; evidence only */
  derivedCanonicalQty: number | null;
}

/**
 * PM Preflight 1 — prove a held Class B group is really an incomplete
 * normalization, not a distinct purchasing identity. All four PM conditions:
 *  1. non-null canonical qty deterministically derivable from the NULL row's
 *     own pack evidence (production computePackGeometry, no copying);
 *  2. purchase unit / UOM basis otherwise agrees;
 *  3. no source-identity conflicts;
 *  4. no protected-config differences.
 * Conditions 2-4 are exactly "the classifier found no conflict other than
 * canonical_qty null-vs-value and did not classify D/E".
 */
export function provePromotion(group: ClassifiedGroup, members: ClassifierVendorItemRow[], units: UnitInfoResolver): PromotionProof {
  if (group.class !== "B") {
    return { promoted: false, reason: `not a Class B group (class=${group.class})`, derivedCanonicalQty: null };
  }
  const onlyNullVsValue =
    group.packConflictFields.length === 1 &&
    group.packConflictFields[0] === "canonical_qty_per_purchase_unit (null-vs-value)";
  if (!onlyNullVsValue) {
    return {
      promoted: false,
      reason: `pack conflicts beyond null-vs-value: ${group.packConflictFields.join(", ")}`,
      derivedCanonicalQty: null,
    };
  }

  const nonNullValues = [...new Set(members.map((m) => m.canonicalQtyPerPurchaseUnit).filter((v): v is number => v != null))];
  if (nonNullValues.length === 0) {
    return { promoted: false, reason: "no non-null canonical qty to prove against", derivedCanonicalQty: null };
  }
  const target = nonNullValues[0];
  if (!nonNullValues.every((v) => relEqual(v, target))) {
    return { promoted: false, reason: `non-null canonical values disagree: ${nonNullValues.join(", ")}`, derivedCanonicalQty: null };
  }

  const canonicalUnitName = units.canonicalUnitNameFor(members[0].inventoryItemId);
  if (canonicalUnitName === null) {
    return { promoted: false, reason: "inventory item canonical unit not resolvable", derivedCanonicalQty: null };
  }

  // Derive from EVERY null row's own evidence; all derivations must succeed
  // deterministically ("parsed" from numeric pack fields — not inferred, not
  // provided) and match the non-null value.
  const nullRows = members.filter((m) => m.canonicalQtyPerPurchaseUnit == null);
  for (const row of nullRows) {
    const result = computePackGeometry({
      caseSize: row.caseSize,
      innerPackSize: row.innerPackSize,
      packUom: row.packUom,
      lastPrice: row.lastCasePrice,
      pricingBasis: "purchase_unit",
      isVariableWeight: row.isVariableWeight,
      canonicalUnitName,
    });
    if (result.status !== "parsed" || result.canonicalQty == null) {
      return {
        promoted: false,
        reason: `derivation from row ${row.id} not deterministic (status=${result.status})`,
        derivedCanonicalQty: null,
      };
    }
    if (!relEqual(result.canonicalQty, target)) {
      return {
        promoted: false,
        reason: `derived ${result.canonicalQty} from row ${row.id} != recorded ${target}`,
        derivedCanonicalQty: result.canonicalQty,
      };
    }
  }

  return {
    promoted: true,
    reason: `canonical qty ${target} re-derived deterministically from ${nullRows.length} NULL row(s); incomplete normalization, not a distinct purchasing identity`,
    derivedCanonicalQty: target,
  };
}

// ─── Preflight 2: EDI serialized-reference check ─────────────────────────────

export interface EdiPreflightResult {
  loserIdsPresent: boolean;
  affectedMessageCount: number;
  totalMessageCount: number;
  disposition: string;
}

export async function ediPreflight(ex: Executor, proposedLoserIds: Set<string>): Promise<EdiPreflightResult> {
  const total = rowsOf(await ex.execute(sql`SELECT count(*)::int AS n FROM edi_messages`))[0].n;
  let affected = 0;
  if (total > 0 && proposedLoserIds.size > 0) {
    const messages = rowsOf(
      await ex.execute(sql`SELECT id, payload_json AS "payloadJson" FROM edi_messages WHERE payload_json IS NOT NULL`),
    );
    for (const m of messages) {
      const text = typeof m.payloadJson === "string" ? m.payloadJson : JSON.stringify(m.payloadJson);
      for (const id of proposedLoserIds) {
        if (text.includes(id)) {
          affected++;
          break;
        }
      }
    }
  }
  return {
    loserIdsPresent: affected > 0,
    affectedMessageCount: affected,
    totalMessageCount: total,
    disposition:
      affected === 0
        ? "No proposed loser ids appear in any edi_messages payload — proceed."
        : "Loser ids present in stored EDI payloads. Code audit: edi_messages payloads are only listed/fetched whole (storage.getEdiMessages/getEdiMessage) and are never parsed to dereference vendor-item ids as live identities — historical serialized evidence only. Per PM instruction, documented and NOT rewritten.",
  };
}

// ─── Audit table (idempotency anchor) ────────────────────────────────────────

export async function ensureAuditTable(ex: Executor): Promise<void> {
  await ex.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS vendor_item_merge_audit (
      id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id     VARCHAR NOT NULL,
      inventory_item_id VARCHAR NOT NULL,
      vendor_sku    TEXT,
      survivor_id   VARCHAR NOT NULL,
      loser_ids     JSONB NOT NULL,
      class_at_apply TEXT NOT NULL,
      promoted_from_b INTEGER NOT NULL DEFAULT 0,
      promotion_reason TEXT,
      refs_repointed JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMP NOT NULL DEFAULT now()
    )`));
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export interface GroupKey {
  vendorId: string;
  inventoryItemId: string;
  vendorSku: string | null;
}

export type GroupApplyResult =
  | { key: GroupKey; result: "applied"; survivorId: string; loserIds: string[]; refsRepointed: Record<string, number>; promotedFromB: boolean }
  | { key: GroupKey; result: "already_remediated"; survivorId: string }
  | { key: GroupKey; result: "stopped"; code: string; reason: string };

/**
 * Apply one group in its own transaction. Authorization comes ONLY from the
 * under-lock evidence gathered inside this transaction, never from the
 * dry-run snapshot (PM clarification).
 */
export async function applyGroup(
  key: GroupKey,
  expectPromotion: boolean,
  referenceSources: ReadonlyArray<{ table: string; column: string }> = REFERENCE_SOURCES,
): Promise<GroupApplyResult> {
  // SERIALIZABLE: the audited reference columns carry no FK constraints, so a
  // concurrent writer inserting a reference to a loser between our conservation
  // check and the delete would otherwise commit an orphan silently. Under
  // serializable isolation that interleaving aborts one transaction instead;
  // the caller records the group as stopped and it can be retried.
  return db.transaction(
    async (tx: any) => {
    const members = await loadGroupRowsForUpdate(tx, key);

    if (members.length <= 1) {
      // Nothing to merge. Idempotent rerun if an audit row exists.
      const audit = rowsOf(
        await tx.execute(sql`
          SELECT survivor_id AS "survivorId" FROM vendor_item_merge_audit
          WHERE vendor_id = ${key.vendorId} AND inventory_item_id = ${key.inventoryItemId}
            AND vendor_sku IS NOT DISTINCT FROM ${key.vendorSku}
          ORDER BY created_at ASC LIMIT 1`),
      );
      if (audit.length > 0) {
        return { key, result: "already_remediated" as const, survivorId: audit[0].survivorId };
      }
      return {
        key,
        result: "stopped" as const,
        code: "GROUP_VANISHED",
        reason: `group now has ${members.length} row(s) and no merge audit — state drifted since dry-run`,
      };
    }

    const ids = members.map((m) => m.id);
    const mappings = await loadMappings(tx, ids);
    const refs = await countReferences(tx, ids, referenceSources);

    // Re-classify under lock — the sole authorization.
    const groups = classifyGroups({ rows: members, mappings, referenceCounts: refs });
    if (groups.length !== 1) {
      return { key, result: "stopped" as const, code: "RECLASSIFY_ANOMALY", reason: `expected 1 group under lock, got ${groups.length}` };
    }
    const group = groups[0];

    let promotedFromB = false;
    let promotionReason: string | null = null;
    if (group.class === "B" && expectPromotion) {
      // Re-prove the promotion under lock with fresh unit info.
      const units = await makeUnitInfoResolver(tx);
      const proof = provePromotion(group, members, units);
      if (!proof.promoted) {
        return { key, result: "stopped" as const, code: "PROMOTION_UNPROVEN_UNDER_LOCK", reason: proof.reason };
      }
      promotedFromB = true;
      promotionReason = proof.reason;
    } else if (group.class !== "A") {
      return {
        key,
        result: "stopped" as const,
        code: "NOT_CLASS_A_UNDER_LOCK",
        reason: `class=${group.class}: ${group.reasons.join("; ")}`,
      };
    }

    const survivorId = electSurvivor(ids, mappingsByVendorItem(mappings), refs);
    const loserIds = ids.filter((id) => id !== survivorId);

    // Reference conservation baseline: refs across the whole group, per column.
    const before = perColumnTotals(refs, ids);

    // Repoint anything that appeared since dry-run (expected zero, never assumed).
    const refsRepointed: Record<string, number> = {};
    for (const { table, column } of referenceSources) {
      const r = await tx.execute(sql`
        UPDATE ${sql.raw(table)} SET ${sql.raw(column)} = ${survivorId}
        WHERE ${sql.raw(column)} IN ${idSet(loserIds)}`);
      const n = (r as any)?.rowCount ?? (Array.isArray(r) ? r.length : 0);
      if (n > 0) refsRepointed[`${table}.${column}`] = n;
    }

    // Verify conservation THROUGH THE TX HANDLE before deleting.
    const afterRefs = await countReferences(tx, [survivorId, ...loserIds], referenceSources);
    const after = perColumnTotals(afterRefs, [survivorId, ...loserIds]);
    for (const col of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if ((before[col] ?? 0) !== (after[col] ?? 0)) {
        throw new Error(`Reference conservation violated for ${col}: before=${before[col] ?? 0} after=${after[col] ?? 0} — rolling back group`);
      }
    }
    const survivorOnly = perColumnTotals(afterRefs, [survivorId]);
    for (const col of Object.keys(after)) {
      if ((survivorOnly[col] ?? 0) !== (after[col] ?? 0)) {
        throw new Error(`Losers still referenced in ${col} after repoint — rolling back group`);
      }
    }

    // External-mapping uniqueness: repointing two identical mappings onto the
    // survivor would violate unique(company, system, property, external_id)
    // only if duplicates existed pre-merge — which classification (single
    // identity set) already rules out; a collision here still rolls back.

    await tx.execute(sql`DELETE FROM vendor_items WHERE id IN ${idSet(loserIds)}`);
    const remaining = rowsOf(
      await tx.execute(sql`SELECT count(*)::int AS n FROM vendor_items WHERE id IN ${idSet(loserIds)}`),
    )[0].n;
    if (remaining !== 0) throw new Error(`Loser deletion incomplete (${remaining} remain) — rolling back group`);

    // Belt-and-braces: after deletion, re-verify no reference to a loser is
    // visible through this tx handle before sealing with the audit row.
    const postDelete = await countReferences(tx, loserIds, referenceSources);
    if (postDelete.size > 0) {
      throw new Error(`References to deleted losers appeared post-delete (${[...postDelete.keys()].join(", ")}) — rolling back group`);
    }

    await tx.execute(sql`
      INSERT INTO vendor_item_merge_audit
        (vendor_id, inventory_item_id, vendor_sku, survivor_id, loser_ids, class_at_apply, promoted_from_b, promotion_reason, refs_repointed)
      VALUES
        (${key.vendorId}, ${key.inventoryItemId}, ${key.vendorSku}, ${survivorId},
         ${JSON.stringify(loserIds)}::jsonb, ${promotedFromB ? "A(promoted)" : "A"},
         ${promotedFromB ? 1 : 0}, ${promotionReason}, ${JSON.stringify(refsRepointed)}::jsonb)`);

    return { key, result: "applied" as const, survivorId, loserIds, refsRepointed, promotedFromB };
    },
    { isolationLevel: "serializable" },
  );
}

function mappingsByVendorItem(mappings: ExternalMappingRow[]): Map<string, ExternalMappingRow[]> {
  const m = new Map<string, ExternalMappingRow[]>();
  for (const x of mappings) {
    const arr = m.get(x.vendorItemId) ?? [];
    arr.push(x);
    m.set(x.vendorItemId, arr);
  }
  return m;
}

function perColumnTotals(refs: ReferenceCounts, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    for (const [col, n] of (refs.get(id) ?? new Map()).entries()) {
      out[col] = (out[col] ?? 0) + n;
    }
  }
  return out;
}
