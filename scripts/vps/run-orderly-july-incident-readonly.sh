#!/usr/bin/env bash
#
# Read-only evidence capture for the approved July Orderly batch.
# This script never calls an application approval/count-session endpoint and
# starts a PostgreSQL READ ONLY transaction before querying production state.
#
# Usage:
#   scripts/vps/run-orderly-july-incident-readonly.sh \
#     <batch-uuid> <company-id> </absolute/output.json>
#
set -Eeuo pipefail
umask 077

die() {
  printf 'REFUSED: %s\n' "$*" >&2
  exit 1
}

[[ $# -eq 3 ]] || die "expected batch UUID, company ID, and absolute output path"
readonly BATCH_ID="$1"
readonly COMPANY_ID="$2"
readonly OUT="$3"
readonly BATCH_UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
readonly COMPANY_ID_RE='^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'

[[ "$BATCH_ID" =~ $BATCH_UUID_RE ]] || die "batch ID must be a UUID"
[[ "$COMPANY_ID" =~ $COMPANY_ID_RE ]] || die "company ID must be a non-empty safe identifier"
[[ "$OUT" = /* ]] || die "output path must be absolute"

for command in pm2 psql node git mkdir dirname; do
  command -v "$command" >/dev/null 2>&1 || die "required command unavailable: $command"
done

readonly APP_DIR='/home/administrator/apps/CostPro/fnbcostpro'
cd "$APP_DIR"
[[ -z "$(git status --porcelain)" ]] || die "checkout is dirty"

readonly PID="$(pm2 pid fnbcostpro | head -n 1 | tr -d '[:space:]')"
[[ "$PID" =~ ^[1-9][0-9]*$ ]] || die "fnbcostpro PM2 process is not running"
if [[ -r "/proc/$PID/environ" ]]; then
  DB_URL="$(tr '\0' '\n' < "/proc/$PID/environ" 2>/dev/null | sed -n 's/^DATABASE_URL=//p')" || DB_URL=""
fi
if [[ -z "${DB_URL:-}" ]]; then
  [[ -r "$APP_DIR/.env" ]] || die "cannot read PM2 environment or the app .env file"
  DB_URL="$(
    node --input-type=module - "$APP_DIR/.env" <<'NODE'
import { readFileSync } from 'node:fs';
const envPath = process.argv[2];
const line = readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .map(value => value.trim())
  .find(value => value.startsWith('DATABASE_URL='));
if (!line) process.exit(1);
let value = line.slice('DATABASE_URL='.length).trim();
if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
process.stdout.write(value);
NODE
  )" || die "DATABASE_URL missing from PM2 environment and app .env file"
fi
[[ -n "${DB_URL:-}" ]] || die "DATABASE_URL missing from PM2 environment and app .env file"

mkdir -p "$(dirname "$OUT")"
readonly TMP="${OUT}.tmp.$$"
trap 'rm -f "$TMP"; unset DB_URL' EXIT

env PGOPTIONS='-c statement_timeout=120s -c lock_timeout=1s' \
  psql -X "$DB_URL" -v ON_ERROR_STOP=1 -At \
    -v batch_id="$BATCH_ID" -v company_id="$COMPANY_ID" > "$TMP" <<'SQL'
BEGIN READ ONLY;

WITH
batch AS (
  SELECT *
  FROM inventory_import_batches
  WHERE id = :'batch_id'
    AND company_id = :'company_id'
    AND source_system = 'ORDERLY'
    AND inventory_date = '2026-07-31'
    AND status = 'approved'
),
approval_job AS (
  SELECT j.*
  FROM orderly_import_approval_jobs j
  JOIN batch b ON b.id = j.batch_id AND b.company_id = j.company_id
  WHERE j.status = 'completed'
),
source_rows AS (
  SELECT
    r.*,
    CASE
      WHEN trim(r.raw_data->>'Total Cost') ~ '^\(.*\)$'
        THEN -(regexp_replace(trim(r.raw_data->>'Total Cost'), '[$,[:space:]()]', '', 'g')::numeric)
      ELSE regexp_replace(trim(r.raw_data->>'Total Cost'), '[$,[:space:]]', '', 'g')::numeric
    END AS source_value
  FROM inventory_import_rows r
  JOIN batch b ON b.id = r.batch_id
  WHERE r.raw_data ? 'Total Cost'
    AND trim(r.raw_data->>'Total Cost') <> ''
),
row_totals AS (
  SELECT
    count(*)::int AS source_rows,
    round(sum(source_value), 2) AS source_value,
    count(*) FILTER (WHERE resolved_inventory_item_id IS NOT NULL)::int AS resolved_rows,
    round(sum(source_value) FILTER (WHERE resolved_inventory_item_id IS NOT NULL), 2) AS resolved_value,
    count(*) FILTER (WHERE resolved_inventory_item_id IS NULL)::int AS unresolved_rows,
    round(sum(source_value) FILTER (WHERE resolved_inventory_item_id IS NULL), 2) AS unresolved_value
  FROM source_rows
),
unresolved AS (
  SELECT jsonb_agg(
    jsonb_build_object(
      'rowIndex', r.row_index,
      'sourceValue', round(r.source_value, 2),
      'itemCodeStatus', r.item_code_status,
      'rowStatus', r.row_status,
      'sourcePackEvidence', jsonb_build_object(
        'caseQuantity', r.case_quantity,
        'innerPackQuantity', r.inner_pack_quantity,
        'baseUnitQuantity', r.base_unit_quantity,
        'baseUnit', r.base_unit,
        'packParseStatus', r.pack_parse_status
      ),
      'savedDecision', CASE
        WHEN d.id IS NULL THEN jsonb_build_object(
          'state', 'none_saved',
          'effectiveApprovalOutcome', 'leave_unlinked'
        )
        WHEN d.decision->>'skip' = 'true' THEN jsonb_build_object(
          'state', 'saved',
          'action', 'leave_unlinked',
          'effectiveApprovalOutcome', 'leave_unlinked',
          'revision', d.revision
        )
        ELSE jsonb_build_object(
          'state', 'saved',
          'action', coalesce(d.decision->>'action',
            CASE WHEN d.decision ? 'inventoryItemId' THEN 'link_item' ELSE 'unknown' END),
          'effectiveApprovalOutcome', 'leave_unlinked',
          'revision', d.revision,
          'hasTarget', coalesce(
            d.decision->>'inventoryItemId',
            d.decision->>'comparableInventoryItemId'
          ) IS NOT NULL
        )
      END,
      'holdReason', CASE
        WHEN d.decision->>'skip' = 'true' THEN 'explicit_leave_unlinked'
        WHEN d.id IS NULL AND r.item_code_status = 'blank' THEN 'blank_item_code_left_unlinked'
        WHEN d.id IS NULL THEN 'unresolved_identity_left_unlinked'
        ELSE 'saved_decision_did_not_produce_identity'
      END,
      'candidateEvidence', jsonb_build_object(
        'samePropertyCodeMappings',
          CASE WHEN nullif(trim(r.source_item_code), '') IS NULL THEN 0 ELSE (
            SELECT count(*)::int
            FROM inventory_item_external_mappings m
            JOIN batch b2 ON b2.company_id = m.company_id
            WHERE m.source_system = 'ORDERLY'
              AND m.source_property_id = b2.source_property_id
              AND m.source_external_id = r.source_item_code
          ) END,
        'priorResolvedRowsForCode',
          CASE WHEN nullif(trim(r.source_item_code), '') IS NULL THEN 0 ELSE (
            SELECT count(*)::int
            FROM inventory_import_rows pr
            JOIN inventory_import_batches pb ON pb.id = pr.batch_id
            JOIN batch b2 ON b2.company_id = pb.company_id
              AND b2.source_property_id = pb.source_property_id
            WHERE pb.source_system = 'ORDERLY'
              AND pb.status = 'approved'
              AND pb.inventory_date < b2.inventory_date
              AND pr.source_item_code = r.source_item_code
              AND pr.resolved_inventory_item_id IS NOT NULL
          ) END
      ),
      'historicalEvidence', jsonb_build_object(
        'rawSourcePreserved', r.raw_data IS NOT NULL,
        'linkedHistoricalSessions', (
          SELECT count(*)::int
          FROM historical_session_unresolved_rows h
          WHERE h.import_row_id = r.id
        ),
        'linkedEvidenceHashPresent', EXISTS (
          SELECT 1
          FROM historical_session_unresolved_rows h
          WHERE h.import_row_id = r.id
            AND nullif(h.source_evidence_hash, '') IS NOT NULL
        ),
        'hashIntegrityVerified', false
      )
    )
    ORDER BY r.row_index
  ) AS rows
  FROM source_rows r
  LEFT JOIN orderly_import_review_decisions d
    ON d.batch_id = r.batch_id
   AND d.company_id = :'company_id'
   AND d.row_index = r.row_index
  WHERE r.resolved_inventory_item_id IS NULL
),
decision_counts AS (
  SELECT
    count(*) FILTER (WHERE d.decision->>'action' = 'create_variant')::int AS create_variant_rows,
    count(DISTINCT nullif(trim(r.source_item_code), ''))
      FILTER (WHERE d.decision->>'action' = 'create_variant'
        AND r.item_code_status = 'valid')::int AS reliable_code_groups,
    count(DISTINCT r.resolved_inventory_item_id)
      FILTER (WHERE d.decision->>'action' = 'create_variant')::int AS variant_resolved_items
  FROM orderly_import_review_decisions d
  JOIN source_rows r ON r.row_index = d.row_index AND r.batch_id = d.batch_id
  WHERE d.batch_id = :'batch_id' AND d.company_id = :'company_id'
),
create_variant_codes AS (
  SELECT DISTINCT nullif(trim(r.source_item_code), '') AS source_item_code
  FROM orderly_import_review_decisions d
  JOIN source_rows r ON r.row_index = d.row_index AND r.batch_id = d.batch_id
  WHERE d.batch_id = :'batch_id'
    AND d.company_id = :'company_id'
    AND d.decision->>'action' = 'create_variant'
    AND nullif(trim(r.source_item_code), '') IS NOT NULL
),
mapping_counts AS (
  SELECT
    count(*)::int AS mappings_for_batch_codes,
    count(DISTINCT m.inventory_item_id)::int AS mapped_inventory_items,
    count(*) FILTER (
      WHERE j.started_at IS NOT NULL
        AND m.created_at BETWEEN j.started_at AND j.completed_at
    )::int AS mappings_created_during_approval
  FROM inventory_item_external_mappings m
  JOIN batch b ON b.company_id = m.company_id
    AND b.source_property_id = m.source_property_id
  LEFT JOIN approval_job j ON true
  WHERE m.source_system = 'ORDERLY'
    AND EXISTS (
      SELECT 1 FROM source_rows r
      WHERE r.source_item_code = m.source_external_id
        AND r.item_code_status = 'valid'
    )
),
relationship_pairs AS (
  SELECT
    least(rel.inventory_item_id, rel.related_inventory_item_id) AS item_a,
    greatest(rel.inventory_item_id, rel.related_inventory_item_id) AS item_b,
    rel.source_external_id,
    count(*)::int AS edge_count,
    count(DISTINCT (rel.inventory_item_id, rel.related_inventory_item_id))::int AS direction_count
  FROM inventory_item_relationships rel
  JOIN batch b ON b.company_id = rel.company_id
    AND b.source_property_id = rel.source_property_id
  JOIN approval_job j ON rel.confirmed_at BETWEEN j.started_at AND j.completed_at
  WHERE rel.relationship_type = 'pack_variant'
    AND rel.source_system = 'ORDERLY'
    AND EXISTS (
      SELECT 1 FROM create_variant_codes c
      WHERE c.source_item_code = rel.source_external_id
    )
  GROUP BY 1, 2, 3
),
relationship_counts AS (
  SELECT
    count(*)::int AS symmetric_pack_variant_pairs,
    count(DISTINCT source_external_id)::int AS relationship_source_codes,
    coalesce(bool_and(edge_count = 2 AND direction_count = 2), true) AS all_pairs_symmetric
  FROM relationship_pairs
),
vendor_item_counts AS (
  SELECT
    count(DISTINCT vi.id)::int AS vendor_items_for_resolved_items,
    count(DISTINCT vi.id) FILTER (WHERE vi.price_source_reference_id = :'batch_id')::int
      AS vendor_items_touched_by_batch
  FROM vendor_items vi
  WHERE EXISTS (
    SELECT 1 FROM source_rows r
    WHERE r.resolved_inventory_item_id = vi.inventory_item_id
  )
),
location_counts AS (
  SELECT
    count(DISTINCT a.location_id)::int AS assigned_locations,
    count(DISTINCT a.id)::int AS item_location_assignments
  FROM inventory_item_location_assignments a
  WHERE a.company_id = :'company_id'
    AND EXISTS (
      SELECT 1 FROM source_rows r
      WHERE r.resolved_inventory_item_id = a.inventory_item_id
    )
),
sessions AS (
  SELECT
    count(*)::int AS session_count,
    count(*) FILTER (WHERE is_historical_import = 1)::int AS historical_session_count,
    count(*) FILTER (WHERE applied = 1)::int AS applied_session_count,
    coalesce(sum(imported_snapshot_total), 0)::numeric AS imported_snapshot_total
  FROM inventory_counts
  WHERE company_id = :'company_id'
    AND source_system = 'ORDERLY'
    AND source_batch_id = :'batch_id'
),
on_hand AS (
  SELECT
    count(*) FILTER (WHERE sii.on_hand_qty <> 0)::int AS resolved_store_items_with_nonzero_on_hand,
    round(coalesce(sum(sii.on_hand_qty), 0)::numeric, 6) AS current_on_hand_qty
  FROM store_inventory_items sii
  JOIN batch b ON b.company_id = sii.company_id AND b.target_store_id = sii.store_id
  WHERE EXISTS (
    SELECT 1 FROM source_rows r
    WHERE r.resolved_inventory_item_id = sii.inventory_item_id
  )
)
SELECT jsonb_build_object(
  'reportVersion', 'orderly-july-approval-incident-readonly-v1',
  'generatedAt', now(),
  'mode', 'production-readonly-incident-evidence',
  'writesExecuted', 0,
  'databaseWritesExecuted', 0,
  'scope', jsonb_build_object(
    'batchIdHash', 'md5:' || md5(b.id),
    'companyIdHash', 'md5:' || md5(b.company_id),
    'sourcePropertyIdPresent', nullif(b.source_property_id, '') IS NOT NULL,
    'inventoryDate', b.inventory_date,
    'status', b.status,
    'approvedAt', b.approved_at,
    'approvalJobStatus', j.status
  ),
  'reconciliation', jsonb_build_object(
    'declaredSourceRowCount', b.source_row_count,
    'persistedSourceRows', t.source_rows,
    'declaredSnapshotTotal', round(b.snapshot_total::numeric, 2),
    'authoritativeSourceValue', t.source_value,
    'resolvedRows', t.resolved_rows,
    'resolvedValue', t.resolved_value,
    'unresolvedRows', t.unresolved_rows,
    'unresolvedValue', t.unresolved_value,
    'resolvedPlusUnresolvedRows', t.resolved_rows + t.unresolved_rows,
    'resolvedPlusUnresolvedValue', round(t.resolved_value + t.unresolved_value, 2),
    'sourceMinusParts', round(t.source_value - t.resolved_value - t.unresolved_value, 2)
  ),
  'unresolvedRows', coalesce(u.rows, '[]'::jsonb),
  'forkReconciliation', jsonb_build_object(
    'approvalResultCounters', jsonb_build_object(
      'itemsCreated', (j.result->>'itemsCreated')::int,
      'itemsLinked', (j.result->>'itemsLinked')::int,
      'vendorItemsCreated', (j.result->>'vendorItemsCreated')::int,
      'locationsCreated', (j.result->>'locationsCreated')::int,
      'locationsLinked', (j.result->>'locationsLinked')::int,
      'rowsSkipped', (j.result->>'rowsSkipped')::int,
      'rowsHeldForReview', (j.result->>'rowsHeldForReview')::int,
      'rowsProcessed', (j.result->>'rowsProcessed')::int,
      'storeItemsCreated', (j.result->>'storeItemsCreated')::int,
      'storeItemsReactivated', (j.result->>'storeItemsReactivated')::int,
      'storeItemsAlreadyLinked', (j.result->>'storeItemsAlreadyLinked')::int,
      'storeItemsSkipped', (j.result->>'storeItemsSkipped')::int
    ),
    'createVariantDecisionRows', d.create_variant_rows,
    'distinctReliableSourceCodeGroups', d.reliable_code_groups,
    'distinctResolvedItemsForCreateVariantRows', d.variant_resolved_items,
    'batchCodeMappings', m.mappings_for_batch_codes,
    'distinctMappedInventoryItems', m.mapped_inventory_items,
    'mappingsCreatedDuringApproval', m.mappings_created_during_approval,
    'symmetricPackVariantPairsConfirmedWithinApprovalWindow', rel.symmetric_pack_variant_pairs,
    'packVariantRelationshipSourceCodes', rel.relationship_source_codes,
    'allPackVariantPairsHaveTwoReverseEdges', rel.all_pairs_symmetric,
    'inventoryItemsCreatedProvenance', 'No inventory_items.created_at or source_batch_id exists; use approval result itemsCreated as the authoritative creation counter and do not infer exact item creation from current catalog membership.'
  ),
  'downstreamState', jsonb_build_object(
    'resolvedCatalogItems', (SELECT count(DISTINCT resolved_inventory_item_id)::int FROM source_rows WHERE resolved_inventory_item_id IS NOT NULL),
    'vendorItemsForResolvedItems', vi.vendor_items_for_resolved_items,
    'vendorItemsTouchedByBatch', vi.vendor_items_touched_by_batch,
    'externalMappings', m.mappings_for_batch_codes,
    'assignedLocations', l.assigned_locations,
    'itemLocationAssignments', l.item_location_assignments,
    'countSessions', s.session_count,
    'historicalCountSessions', s.historical_session_count,
    'appliedCountSessions', s.applied_session_count,
    'importedSnapshotTotal', round(s.imported_snapshot_total, 2),
    'resolvedStoreItemsWithCurrentNonzeroOnHand', oh.resolved_store_items_with_nonzero_on_hand,
    'currentResolvedOnHandQty', oh.current_on_hand_qty,
    'liveEffectInterpretation', CASE
      WHEN s.applied_session_count > 0 THEN 'A source-linked count session was applied. Current July-attributable on-hand effect cannot be isolated after later inventory activity.'
      WHEN s.session_count > 0 THEN 'Source-linked session exists but is not applied; historical state exists without an applied count-session effect.'
      ELSE 'No source-linked count session exists; approval created/linked catalog state only.'
    END
  ),
  'verificationGates', jsonb_build_object(
    'exactBatch', b.id IS NOT NULL,
    'completedApprovalJob', j.status = 'completed',
    'approvalResultCountersPresent', j.result IS NOT NULL
      AND jsonb_typeof(j.result->'itemsCreated') = 'number'
      AND jsonb_typeof(j.result->'rowsProcessed') = 'number'
      AND jsonb_typeof(j.result->'rowsHeldForReview') = 'number',
    'sourceRowsReconcile', b.source_row_count = t.source_rows
      AND t.source_rows = t.resolved_rows + t.unresolved_rows,
    'declaredAndAuthoritativeSourceValueMatch', abs(b.snapshot_total::numeric - t.source_value) < 0.005,
    'sourceValueReconciles', abs(t.source_value - t.resolved_value - t.unresolved_value) < 0.005,
    'reportedJulyShape', t.source_rows = 5518
      AND t.resolved_rows = 5496
      AND t.unresolved_rows = 22
      AND abs(t.source_value - 254299.75) < 0.005
      AND abs(t.resolved_value - 251946.45) < 0.005
      AND abs(t.unresolved_value - 2353.30) < 0.005,
    'packVariantPairsSymmetric', rel.all_pairs_symmetric,
    'unresolvedEvidencePreserved', jsonb_array_length(coalesce(u.rows, '[]'::jsonb)) = t.unresolved_rows
      AND NOT EXISTS (
        SELECT 1 FROM source_rows r
        WHERE r.resolved_inventory_item_id IS NULL AND r.raw_data IS NULL
      )
  ),
  'hardStop', 'READ ONLY evidence only. Do not delete, re-upload, approve, create/apply a count session, reset decisions, or remediate from this report.'
)
FROM batch b
JOIN approval_job j ON true
CROSS JOIN row_totals t
CROSS JOIN unresolved u
CROSS JOIN decision_counts d
CROSS JOIN mapping_counts m
CROSS JOIN relationship_counts rel
CROSS JOIN vendor_item_counts vi
CROSS JOIN location_counts l
CROSS JOIN sessions s
CROSS JOIN on_hand oh;

ROLLBACK;
SQL

node --input-type=module - "$TMP" "$OUT" <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
const [inputPath, outputPath] = process.argv.slice(2);
const raw = (await readFile(inputPath, 'utf8')).trim().split('\n')
  .filter(line => line.trim() && line.trim() !== 'BEGIN' && line.trim() !== 'ROLLBACK')
  .join('\n');
const report = JSON.parse(raw);
if (report.mode !== 'production-readonly-incident-evidence'
  || report.writesExecuted !== 0
  || report.databaseWritesExecuted !== 0) {
  throw new Error('Refusing output that does not prove the zero-write mode.');
}
const serialized = JSON.stringify(report, null, 2);
if (/postgres(?:ql)?:\/\/|password=|database_url/i.test(serialized)) {
  throw new Error('Refusing output that appears to contain credentials.');
}
await writeFile(outputPath, `${serialized}\n`, { mode: 0o600 });
const gates = report.verificationGates ?? {};
const failed = Object.entries(gates).filter(([, passed]) => passed !== true);
if (failed.length > 0) {
  console.error(`REFUSED: verification gates failed: ${failed.map(([name]) => name).join(', ')}`);
  process.exitCode = 2;
}
NODE

printf 'Sanitized read-only incident report: %s\n' "$OUT"
printf '%s\n' 'STOP: no July mutation or recovery action is authorized.'