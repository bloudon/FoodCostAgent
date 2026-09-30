import 'dotenv/config';
import { createHash } from 'node:crypto';
import { pool, describeDatabaseTarget } from '../../db';
import { getOperationalContainerLabel } from './countQuantity';
import { derivePhysicalCountPack } from './orderlyCountPack';

type ItemRow = {
  id: string;
  name: string;
  unit_id: string;
  unit: string;
  category: string | null;
  case_size: number;
  container_size: number | null;
  case_pkg_count: number | null;
  container_label: string | null;
  container_unit_id: string | null;
  is_variable_weight: number;
  is_catch_weight_category: number | null;
  raw_packs: Array<string | null>;
};

const companyName = 'Bay Hill CC';
const sourceProperty = '24472';
const args = process.argv.slice(2);
const applying = args.includes('--apply');
const expectedCompany = args.find(value => value.startsWith('--company-id='))?.slice(13);
const expectedHost = args.find(value => value.startsWith('--db-host='))?.slice(10);
const expectedFingerprint = args.find(value => value.startsWith('--fingerprint='))?.slice(14);
const expectedEligible = args.find(value => value.startsWith('--eligible='))?.slice(11);
const expectedHeld = args.find(value => value.startsWith('--held='))?.slice(7);
const target = describeDatabaseTarget();
const sameReal = (left: number | null, right: number) =>
  left != null && Math.abs(left - right) <= Math.max(0.00001, right * 0.000001);

async function main() {
  if (process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === 'production') {
    throw new Error('This development-only repair cannot run in a deployment.');
  }
  const client = await pool.connect();
  try {
    const companies = await client.query(
      'SELECT id FROM companies WHERE name = $1',
      [companyName],
    );
    if (companies.rows.length !== 1) throw new Error('Bay Hill company identity is not unique.');
    const companyId: string = companies.rows[0].id;
    if (applying && (expectedCompany !== companyId || expectedHost !== target.host)) {
      throw new Error('Apply requires the exact --company-id and --db-host printed by the dry run.');
    }
    const snapshotSql = `
      SELECT i.id, i.name, i.unit_id, u.abbreviation AS unit, c.name AS category,
        i.is_variable_weight, c.is_catch_weight_category,
        i.case_size, i.container_size, i.case_pkg_count, i.container_label,
        i.container_unit_id,
        array_agg(m.pack_size_raw ORDER BY m.id) AS raw_packs
      FROM inventory_items i
      JOIN units u ON u.id = i.unit_id
      LEFT JOIN categories c ON c.id = i.category_id
      JOIN inventory_item_external_mappings m
        ON m.company_id = i.company_id AND m.inventory_item_id = i.id
        AND m.source_system = 'ORDERLY' AND m.source_property_id = $2
      WHERE i.company_id = $1
      GROUP BY i.id, u.abbreviation, c.id
      ORDER BY i.id
    `;
    const result = await client.query(snapshotSql, [companyId, sourceProperty]);
    const rows = result.rows as ItemRow[];
    const changes: Array<{
      item: ItemRow;
      raw: string;
      size: number;
      count: number;
      label: string;
    }> = [];
    const blockers: ItemRow[] = [];
    const heldCount = new Map<string, number>();
    const held = new Map<string, Array<{ name: string; raw: string }>>();
    const hold = (reason: string, item: ItemRow, raw: string) => {
      heldCount.set(reason, (heldCount.get(reason) ?? 0) + 1);
      const examples = held.get(reason) ?? [];
      if (examples.length < 8) examples.push({ name: item.name, raw });
      held.set(reason, examples);
      // No single trustworthy package conversion exists. A prior imported
      // numeric geometry is not physical evidence; require setup instead of
      // offering misleading "containers" (or falling back to canonical units).
      if (item.is_variable_weight !== 1 && item.is_catch_weight_category !== 1 &&
          (item.container_size !== null || item.case_pkg_count !== null ||
            item.container_unit_id !== null || item.container_label !== 'package')) {
        blockers.push(item);
      }
    };
    for (const item of rows) {
      if (item.is_variable_weight === 1 || item.is_catch_weight_category === 1) {
        hold('catch weight uses its own counting policy', item, '');
        continue;
      }
      const rawValues = Array.from(new Set(item.raw_packs.map(v => v?.trim().toUpperCase() ?? '')));
      const raw = rawValues.join(' | ');
      if (rawValues.length !== 1 || !rawValues[0]) {
        hold('missing or conflicting source packs', item, raw);
        continue;
      }
      const pack = derivePhysicalCountPack(raw);
      if (!pack) {
        hold('opaque or unsupported source pack', item, raw);
        continue;
      }
      if (pack.canonicalUnit !== item.unit.toUpperCase()) {
        hold('source/canonical unit mismatch', item, raw);
        continue;
      }
      if (Math.abs(pack.caseSize - item.case_size) > Math.max(0.01, pack.caseSize * 0.0001)) {
        hold('source total differs from item case size', item, raw);
        continue;
      }
      const inferred = getOperationalContainerLabel(
        { name: item.name, containerLabel: item.container_label },
        item.category,
      );
      const configured = item.container_label?.trim();
      const label = (configured && configured !== 'package' ? configured : null) ||
        pack.explicitLabel ||
        (inferred !== 'container' && inferred !== 'package' ? inferred :
          pack.canonicalUnit === 'EA' ? 'each' :
            pack.sourceSizeLabel ? `${pack.sourceSizeLabel} package` : 'package');
      if (sameReal(item.container_size, pack.containerSize) &&
          sameReal(item.case_pkg_count, pack.casePkgCount) &&
          item.container_label === label &&
          item.container_unit_id === item.unit_id) continue;
      changes.push({ item, raw, size: pack.containerSize, count: pack.casePkgCount, label });
    }
    const heldTotal = Array.from(heldCount.values()).reduce((a, b) => a + b, 0);
    // Bind the approval to the entire scoped item+source population, not
    // merely the examples printed to the terminal. Any changed row, mapping
    // or classification requires another dry-run before an apply.
    const fingerprint = createHash('sha256').update(JSON.stringify({
      companyId, sourceProperty, rows, changes: changes.map(x => x.item.id),
      blockers: blockers.map(x => x.id), heldTotal,
    })).digest('hex');
    console.info(JSON.stringify({
      target: { host: target.host, database: target.database, driver: target.driver },
      company: { id: companyId, name: companyName },
      sourceProperty, items: rows.length,
      fingerprint,
      eligible: changes.length,
      blockedForReview: heldTotal,
      pendingBlockUpdates: blockers.length,
      held: Array.from(held, ([reason, examples]) => ({ reason, count: heldCount.get(reason), examples })),
      examples: changes.filter(x => x.item.container_size !== x.size || x.item.case_pkg_count !== x.count)
        .slice(0, 18).map(x => ({
          name: x.item.name, raw: x.raw,
          from: [x.item.container_size, x.item.case_pkg_count, x.item.container_label],
          to: [x.size, x.count, x.label],
        })),
    }, null, 2));
    if (!applying) return;
    if (expectedFingerprint !== fingerprint ||
        expectedEligible !== String(changes.length) ||
        expectedHeld !== String(heldTotal)) {
      throw new Error('Dry-run fingerprint or population counts changed; review again before applying.');
    }
    await client.query('BEGIN');
    try {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await client.query(`
        SELECT id FROM inventory_item_external_mappings
        WHERE company_id = $1 AND source_system = 'ORDERLY'
          AND source_property_id = $2 FOR SHARE
      `, [companyId, sourceProperty]);
      const current = await client.query(snapshotSql, [companyId, sourceProperty]);
      if (JSON.stringify(current.rows) !== JSON.stringify(rows)) {
        throw new Error('Source or item changed during apply; rolled back.');
      }
      // The compare-and-swap protects every item from edits between the dry
      // run and this operation. Do not rewrite canonical costs, counts or
      // source mappings: saved lines reconcile (or show historical review)
      // against the new operational geometry.
      for (const { item, size, count, label } of changes) {
        const updated = await client.query(`
          UPDATE inventory_items SET
            container_size = $1, case_pkg_count = $2, container_label = $3,
            container_unit_id = unit_id, updated_at = now()
          WHERE id = $4 AND company_id = $5
            AND container_size IS NOT DISTINCT FROM $6::real
            AND case_pkg_count IS NOT DISTINCT FROM $7::real
            AND container_label IS NOT DISTINCT FROM $8::text
            AND container_unit_id IS NOT DISTINCT FROM $9::varchar
            AND case_size IS NOT DISTINCT FROM $10::real
        `, [size, count, label, item.id, companyId,
          item.container_size, item.case_pkg_count, item.container_label,
          item.container_unit_id, item.case_size]);
        if (updated.rowCount !== 1) throw new Error(`Concurrent item edit; rolled back: ${item.id}`);
      }
      for (const item of blockers) {
        const updated = await client.query(`
          UPDATE inventory_items SET
            container_size = NULL, case_pkg_count = NULL, container_unit_id = NULL,
            container_label = 'package', updated_at = now()
          WHERE id = $1 AND company_id = $2
            AND container_size IS NOT DISTINCT FROM $3::real
            AND case_pkg_count IS NOT DISTINCT FROM $4::real
            AND container_label IS NOT DISTINCT FROM $5::text
            AND container_unit_id IS NOT DISTINCT FROM $6::varchar
            AND case_size IS NOT DISTINCT FROM $7::real
        `, [item.id, companyId, item.container_size, item.case_pkg_count,
          item.container_label, item.container_unit_id, item.case_size]);
        if (updated.rowCount !== 1) throw new Error(`Concurrent item edit; rolled back: ${item.id}`);
      }
      await client.query('COMMIT');
      console.info(`Applied ${changes.length} item-level counting geometries; ${heldTotal} ambiguous items remain held for review. Saved counts and costs untouched.`);
    } catch (error) {
      await client.query('ROLLBACK');
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