import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool, describeDatabaseTarget } from "../../db";
import { WHOLE_CASE_LABEL, wholeCaseExclusionReasons, type WholeCaseEvidence } from "./wholeCasePolicy";

/**
 * Development-only, reviewed cohort. Never interpret 1/1 Case in the generic
 * parser: the permission to count whole cases comes from Bay Hill's operational
 * confirmation, not from the opaque Orderly purchase notation.
 */
const companyName = "Bay Hill CC";
const propertyId = "24472";
const csvPath = resolve(process.cwd(), "../../reports/bay-hill-count-setup-review-2026-09-23.csv");
const args = process.argv.slice(2);
const applying = args.includes("--apply");
const flag = (prefix: string) => args.find(a => a.startsWith(prefix))?.slice(prefix.length);
const expected = {
  company: flag("--company-id="),
  host: flag("--db-host="),
  database: flag("--db-name="),
  fingerprint: flag("--fingerprint="),
  eligible: flag("--eligible="),
  held: flag("--held="),
};
const target = describeDatabaseTarget();
// This workspace's development PostgreSQL proxy. The serving production app
// uses a separate VPS database/driver. Do not accept arbitrary credentials
// simply because the operator supplied the same coordinates as a dry run.
const approvedDevTarget = { driver: "neon-serverless", host: "helium", database: "heliumdb", port: "5432" };
type Row = WholeCaseEvidence & {
  id: string; name: string; companyId: string;
  containerSize: number | null; casePkgCount: number | null;
  containerLabel: string | null; containerUnitId: string | null;
};

function reviewedIds(): string[] {
  const ids = readFileSync(csvPath, "utf8").split(/\r?\n/)
    .filter(l => /,ea,1,1\/1 Case,Pack contents unspecified$/.test(l))
    .map(l => l.slice(0, 36));
  if (ids.length !== 118 || new Set(ids).size !== 118 ||
      ids.some(id => !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))) {
    throw new Error("The reviewed 118-item source snapshot changed; stop and re-review");
  }
  return ids.sort();
}

const snapshotSql = `
  SELECT i.id, i.name, i.company_id AS "companyId", i.unit_id AS "unitId",
    u.abbreviation AS unit, i.case_size AS "caseSize",
    i.container_size AS "containerSize", i.case_pkg_count AS "casePkgCount",
    i.container_label AS "containerLabel", i.container_unit_id AS "containerUnitId",
    i.is_variable_weight AS "isVariableWeight",
    c.is_catch_weight_category AS "isCatchWeightCategory",
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sourceSystem', m.source_system, 'sourcePropertyId', m.source_property_id,
        'packSizeRaw', m.pack_size_raw, 'caseQuantity', m.case_quantity,
        'innerPackQuantity', m.inner_pack_quantity,
        'baseUnitQuantity', m.base_unit_quantity, 'baseUnit', m.base_unit) ORDER BY m.id)
      FROM inventory_item_external_mappings m
      WHERE m.company_id=i.company_id AND m.inventory_item_id=i.id
    ), '[]'::jsonb) AS mappings,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'canonicalQtyPerPurchaseUnit', v.canonical_qty_per_purchase_unit,
        'packGeometryStatus', v.pack_geometry_status, 'packUom', v.pack_uom,
        'caseSize', v.case_size, 'innerPackSize', v.inner_pack_size,
        'isVariableWeight', v.is_variable_weight) ORDER BY v.id)
      FROM vendor_items v JOIN vendors z
        ON z.id=v.vendor_id AND z.company_id=i.company_id
      WHERE v.inventory_item_id=i.id
    ), '[]'::jsonb) AS products,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'unitId', l.unit_id, 'qty', l.qty, 'caseQty', l.case_qty,
        'containerQty', l.container_qty, 'looseUnits', l.loose_units) ORDER BY l.id)
      FROM inventory_count_lines l JOIN inventory_counts s
        ON s.id=l.inventory_count_id AND s.company_id=i.company_id
      WHERE l.inventory_item_id=i.id
        AND (l.case_qty IS NOT NULL OR l.container_qty IS NOT NULL OR l.loose_units IS NOT NULL)
    ), '[]'::jsonb) AS "savedParts"
  FROM inventory_items i
  JOIN units u ON u.id=i.unit_id
  LEFT JOIN categories c ON c.id=i.category_id
  WHERE i.company_id=$1 AND i.id=ANY($2::varchar[])
  ORDER BY i.id
`;

function review(rows: Row[], ids: string[]) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const held = ids.flatMap(id => {
    const row = byId.get(id);
    const reasons = row ? wholeCaseExclusionReasons(row) : ["missing item in bound company"];
    return reasons.length ? [{ itemId: id, reasons }] : [];
  });
  const eligible = rows.filter(row => !wholeCaseExclusionReasons(row).length);
  const changes = eligible.filter(row =>
    row.containerSize !== 1 || row.casePkgCount !== 1 ||
    row.containerLabel !== WHOLE_CASE_LABEL || row.containerUnitId !== row.unitId,
  );
  const fingerprint = createHash("sha256").update(JSON.stringify({
    company: rows[0]?.companyId, propertyId, ids, rows, held, changes: changes.map(x => x.id),
  })).digest("hex");
  return { eligible, held, changes, fingerprint };
}

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT) {
    throw new Error("Whole-case setup is development-only; production rollout requires separate authorization");
  }
  if (applying && (target.driver !== approvedDevTarget.driver ||
      target.host !== approvedDevTarget.host || target.database !== approvedDevTarget.database ||
      target.port !== approvedDevTarget.port)) {
    throw new Error("Apply refused: target is not the approved development database");
  }
  const ids = reviewedIds();
  const client = await pool.connect();
  try {
    const companies = await client.query("SELECT id FROM companies WHERE name=$1", [companyName]);
    if (companies.rows.length !== 1) throw new Error("Company identity is not unique");
    const companyId: string = companies.rows[0].id;
    if (applying && (expected.company !== companyId || expected.host !== target.host ||
        expected.database !== target.database || !expected.fingerprint)) {
      throw new Error("Apply requires matching company, database host/name and fresh dry-run fingerprint");
    }
    await client.query(applying
      ? "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE"
      : "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      if (applying) {
        // Pause development count/source/vendor evidence writes until commit.
        // Acquire locks BEFORE the first snapshot read so in-flight writes
        // finish before classification. Readers are unaffected.
        await client.query(`
          LOCK TABLE inventory_count_lines, inventory_counts,
            inventory_item_external_mappings, vendor_items IN SHARE MODE
        `);
        await client.query("SELECT id FROM inventory_items WHERE company_id=$1 AND id=ANY($2::varchar[]) ORDER BY id FOR UPDATE", [companyId, ids]);
      }
      const result = await client.query(snapshotSql, [companyId, ids]);
      const rows = result.rows as Row[];
      const reviewed = review(rows, ids);
      const output = {
        decisionBasis: "Bay Hill confirmed one whole case is one inventory EA; contents unspecified",
        database: { host: target.host, name: target.database, driver: target.driver },
        companyId, propertyId, snapshotCandidates: ids.length,
        present: rows.length, eligible: reviewed.eligible.length,
        pendingUpdates: reviewed.changes.length, held: reviewed.held,
        proposed: reviewed.changes.map(row => ({
          itemId: row.id, name: row.name,
          from: {
            containerSize: row.containerSize, casePkgCount: row.casePkgCount,
            containerLabel: row.containerLabel, containerUnitId: row.containerUnitId,
          },
          to: {
            containerSize: 1, casePkgCount: 1,
            containerLabel: WHOLE_CASE_LABEL, containerUnitId: row.unitId,
          },
        })),
        fingerprint: reviewed.fingerprint,
      };
      console.info(JSON.stringify(output, null, 2));
      if (applying) {
        if (expected.fingerprint !== reviewed.fingerprint ||
            expected.eligible !== String(reviewed.eligible.length) ||
            expected.held !== String(reviewed.held.length)) {
          throw new Error("The reviewed cohort drifted; nothing was changed");
        }
        for (const row of reviewed.changes) {
          const result = await client.query(`
            UPDATE inventory_items
            SET container_size=1, case_pkg_count=1, container_label=$1,
                container_unit_id=unit_id, updated_at=now()
            WHERE id=$2 AND company_id=$3 AND case_size=1 AND unit_id=$4
              AND container_size IS NOT DISTINCT FROM $5::real
              AND case_pkg_count IS NOT DISTINCT FROM $6::real
              AND container_label IS NOT DISTINCT FROM $7::text
              AND container_unit_id IS NOT DISTINCT FROM $8::varchar
          `, [WHOLE_CASE_LABEL, row.id, companyId, row.unitId, row.containerSize,
            row.casePkgCount, row.containerLabel, row.containerUnitId]);
          if (result.rowCount !== 1) throw new Error("Concurrent item edit; rolled back");
        }
        await client.query("COMMIT");
        console.info(`Committed ${reviewed.changes.length} bounded whole-case count setups in development; no source, price, or historical rows updated.`);
      } else {
        await client.query("ROLLBACK");
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});