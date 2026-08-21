#!/usr/bin/env bash
#
# Gate 2 production apply — Class A vendor-item duplicate cleanup.
#
# ═══════════════════════════════════════════════════════════════════════════════
# OPERATOR PREREQUISITES — complete BEFORE running this script:
#
#   1. RECOVERY POINT
#      Take a pg_dump of the production database.
#      Example:
#        pg_dump "$DATABASE_URL" \
#          > /secure/backups/fnb-pre-gate2-"$(date +%Y%m%d%H%M%S)".sql
#
#   2. WRITER QUIESCENCE
#      Briefly stop or rate-limit write traffic so no in-flight write races
#      the transactional apply (each group runs SERIALIZABLE; a racing write
#      stops only that group and is reported, but quiescence avoids retries).
#      Example:  pm2 stop fnb-api
#      Resume after the STOP notice at the end:  pm2 start fnb-api
#
#   3. Set VENDOR_ITEM_BACKUP_CONFIRMED=yes in the calling environment.
#
# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1 (always, read-only dry-run):
#   - Validates the Gate 2 package: packageId integrity, bound evidence file
#     byte hashes, database identity, reference column schema.
#   - Classifies live vendor items; verifies live Class A count ≤ 2,429.
#   - Scans edi_messages for loser IDs (CLOSED per reviewed readiness evidence).
#   - Writes vendor-item-gate2-dry-run-report.json to
#     VENDOR_ITEM_GATE2_APPLY_REPORT_DIR.
#
# PHASE 2 (requires VENDOR_ITEM_GATE2_APPLY=yes — set only after reviewing
#           the Phase 1 report):
#   - Applies exactly the 2,429 reviewed Class A groups from the package.
#   - Repoints all 8 audited relational reference columns per group,
#     transactionally under SERIALIZABLE isolation.
#   - Deletes exactly the reviewed Class A loser rows.
#   - Verifies zero merge-caused orphans and Class A cleared post-apply.
#   - Writes vendor-item-gate2-apply-report.json to
#     VENDOR_ITEM_GATE2_APPLY_REPORT_DIR.
#
# ═══════════════════════════════════════════════════════════════════════════════
# WHAT THIS SCRIPT DOES NOT DO (require separate PM authorizations):
#   - Does NOT create the uniqueness index.
#   - Does NOT touch Sysco SKU 7664436 (Class B held group — excluded by scope).
#   - Does NOT change prices, price history, pack geometry, or invoice history.
#   - Does NOT run Orderly preview or Orderly APPLY.
#   - Does NOT restart PM2 or make any service configuration change.
#
# ═══════════════════════════════════════════════════════════════════════════════
# REQUIRED ENV VARS:
#   APP_DIR                              Absolute, clean Git checkout of the app.
#   VPS_ENV_FILE                         Existing VPS application dotenv file.
#   VENDOR_ITEM_GATE2_PACKAGE_PATH       Absolute path to the Gate 2 package JSON
#                                        (produced by build-vendor-item-gate2-package.sh).
#   VENDOR_ITEM_GATE2_APPLY_REPORT_DIR   Absolute secure output directory (outside APP_DIR).
#   VENDOR_ITEM_GATE2_EXPECT_DB          Exact production database name (operator-stated
#                                        — verified against the package binding).
#   VENDOR_ITEM_BACKUP_CONFIRMED         Must be exactly "yes" (backup gate).
#
# OPTIONAL (enables Phase 2 mutation after reviewing the Phase 1 report):
#   VENDOR_ITEM_GATE2_APPLY              Must be exactly "yes".

set -Eeuo pipefail
umask 077

die() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }
required_env() { local n="$1"; [[ -n "${!n:-}" ]] || die "$n must be set."; }

for name in APP_DIR VPS_ENV_FILE VENDOR_ITEM_GATE2_PACKAGE_PATH \
            VENDOR_ITEM_GATE2_APPLY_REPORT_DIR VENDOR_ITEM_GATE2_EXPECT_DB \
            VENDOR_ITEM_BACKUP_CONFIRMED; do
  required_env "$name"
done

# ── Backup acknowledgment gate ────────────────────────────────────────────────
[[ "$VENDOR_ITEM_BACKUP_CONFIRMED" == "yes" ]] \
  || die "VENDOR_ITEM_BACKUP_CONFIRMED must be 'yes'. Take a pg_dump recovery point first."

# ── Path validation ───────────────────────────────────────────────────────────
[[ "$APP_DIR" = /* && -d "$APP_DIR/.git" ]] \
  || die "APP_DIR must be an absolute Git checkout."
[[ "$VPS_ENV_FILE" = /* && -f "$VPS_ENV_FILE" ]] \
  || die "VPS_ENV_FILE must be an existing absolute path."
[[ "$VENDOR_ITEM_GATE2_PACKAGE_PATH" = /* && -f "$VENDOR_ITEM_GATE2_PACKAGE_PATH" ]] \
  || die "VENDOR_ITEM_GATE2_PACKAGE_PATH must be an existing absolute file."
[[ "$VENDOR_ITEM_GATE2_APPLY_REPORT_DIR" = /* ]] \
  || die "VENDOR_ITEM_GATE2_APPLY_REPORT_DIR must be an absolute path."

# External-path guards (evidence and reports must stay outside the checkout).
case "$VENDOR_ITEM_GATE2_PACKAGE_PATH" in
  "$APP_DIR/"*) die "VENDOR_ITEM_GATE2_PACKAGE_PATH must be outside APP_DIR." ;;
esac
case "$VENDOR_ITEM_GATE2_APPLY_REPORT_DIR/" in
  "$APP_DIR/"*) die "VENDOR_ITEM_GATE2_APPLY_REPORT_DIR must be outside APP_DIR." ;;
esac

# ── Tool availability ─────────────────────────────────────────────────────────
for cmd in git pnpm node mkdir; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command is unavailable: $cmd"
done

# ── Clean checkout ────────────────────────────────────────────────────────────
cd "$APP_DIR"
[[ -z "$(git status --porcelain)" ]] \
  || die "Checkout is dirty; apply only from one exact reviewed source state."
readonly APPLY_GIT_SHA="$(git rev-parse --verify HEAD)"

# ── Package database cross-check ─────────────────────────────────────────────
# Verify the operator-stated VENDOR_ITEM_GATE2_EXPECT_DB matches the
# database identity bound into the Gate 2 package before any CLI call.
readonly PKG_DATABASE="$(node -e "process.stdout.write(
  JSON.parse(require('fs').readFileSync('$VENDOR_ITEM_GATE2_PACKAGE_PATH','utf8'))
    .sourceClassifierReport.database
)")"
[[ "$PKG_DATABASE" == "$VENDOR_ITEM_GATE2_EXPECT_DB" ]] \
  || die "VENDOR_ITEM_GATE2_EXPECT_DB='$VENDOR_ITEM_GATE2_EXPECT_DB' does not match package database '$PKG_DATABASE'. STOP."

printf '[Gate2-Apply] package database verified: %s\n' "$PKG_DATABASE"

mkdir -p "$VENDOR_ITEM_GATE2_APPLY_REPORT_DIR"

readonly DRY_RUN_REPORT="$VENDOR_ITEM_GATE2_APPLY_REPORT_DIR/vendor-item-gate2-dry-run-report.json"
readonly APPLY_REPORT="$VENDOR_ITEM_GATE2_APPLY_REPORT_DIR/vendor-item-gate2-apply-report.json"

# ── PHASE 1: DRY-RUN PREFLIGHT ───────────────────────────────────────────────
printf '\n[Gate2-Apply] Phase 1: dry-run preflight against %s\n' "$VENDOR_ITEM_GATE2_EXPECT_DB"

set +e
VENDOR_ITEM_GATE2_PACKAGE_PATH="$VENDOR_ITEM_GATE2_PACKAGE_PATH" \
VENDOR_ITEM_GATE2_APPLY_REPORT_DIR="$VENDOR_ITEM_GATE2_APPLY_REPORT_DIR" \
VENDOR_ITEM_GATE2_EXPECT_DB="$VENDOR_ITEM_GATE2_EXPECT_DB" \
DOTENV_CONFIG_PATH="$VPS_ENV_FILE" \
pnpm --filter @workspace/api-server exec tsx --require dotenv/config \
  src/services/orderly/vendorItemDuplicateGate2ApplyCli.ts
DRY_STATUS="$?"
set -e

[[ "$DRY_STATUS" -eq 0 ]] \
  || die "Dry-run preflight failed (exit $DRY_STATUS). Inspect output before proceeding."

[[ -f "$DRY_RUN_REPORT" ]] \
  || die "Dry-run report was not written to expected path: $DRY_RUN_REPORT"

# ── Parse and verify dry-run counts ──────────────────────────────────────────
_jq() { node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$DRY_RUN_REPORT','utf8'))$1))"; }

readonly DRY_LIVE_CLASS_A="$(_jq '.currentState.classA')"
readonly DRY_PKG_GROUPS="$(_jq '.packageScope.reviewedGroups')"
readonly DRY_PKG_LOSERS="$(_jq '.packageScope.loserRows')"
readonly DRY_PKG_ID="$(_jq '.packageId')"

printf '[Gate2-Apply] Package ID:  %s\n' "$DRY_PKG_ID"
printf '[Gate2-Apply] Package scope: %s groups, %s loser rows\n' "$DRY_PKG_GROUPS" "$DRY_PKG_LOSERS"
printf '[Gate2-Apply] Live Class A: %s\n' "$DRY_LIVE_CLASS_A"

[[ "$DRY_PKG_GROUPS" -eq 2429 ]] \
  || die "Package group count mismatch: expected 2429, got $DRY_PKG_GROUPS. STOP."
[[ "$DRY_PKG_LOSERS" -eq 6038 ]] \
  || die "Package loser row count mismatch: expected 6038, got $DRY_PKG_LOSERS. STOP."
[[ "$DRY_LIVE_CLASS_A" -le 2429 ]] \
  || die "Live Class A count ($DRY_LIVE_CLASS_A) exceeds approved baseline (2429). STOP."

printf '[Gate2-Apply] Phase 1 PASS — %s live Class A groups, %s package losers verified.\n' \
  "$DRY_LIVE_CLASS_A" "$DRY_PKG_LOSERS"

# ── APPLY GATE ────────────────────────────────────────────────────────────────
if [[ "${VENDOR_ITEM_GATE2_APPLY:-}" != "yes" ]]; then
  printf '\n[Gate2-Apply] STOP — Phase 1 dry-run complete.\n'
  printf '[Gate2-Apply] Review the report, then re-run with VENDOR_ITEM_GATE2_APPLY=yes to apply.\n'
  printf '[Gate2-Apply] Git SHA:       %s\n' "$APPLY_GIT_SHA"
  printf '[Gate2-Apply] Dry-run report: %s\n' "$DRY_RUN_REPORT"
  exit 0
fi

# ── PHASE 2: APPLY ────────────────────────────────────────────────────────────
printf '\n[Gate2-Apply] Phase 2: APPLY — %s groups, %s loser rows.\n' \
  "$DRY_PKG_GROUPS" "$DRY_PKG_LOSERS"

set +e
VENDOR_ITEM_GATE2_APPLY=yes \
VENDOR_ITEM_GATE2_PACKAGE_PATH="$VENDOR_ITEM_GATE2_PACKAGE_PATH" \
VENDOR_ITEM_GATE2_APPLY_REPORT_DIR="$VENDOR_ITEM_GATE2_APPLY_REPORT_DIR" \
VENDOR_ITEM_GATE2_EXPECT_DB="$VENDOR_ITEM_GATE2_EXPECT_DB" \
DOTENV_CONFIG_PATH="$VPS_ENV_FILE" \
pnpm --filter @workspace/api-server exec tsx --require dotenv/config \
  src/services/orderly/vendorItemDuplicateGate2ApplyCli.ts
APPLY_STATUS="$?"
set -e

[[ "$APPLY_STATUS" -eq 0 ]] \
  || die "Apply CLI failed (exit $APPLY_STATUS). Inspect apply report and audit table before any further action. STOP."

[[ -f "$APPLY_REPORT" ]] \
  || die "Apply report was not written to expected path: $APPLY_REPORT"

# ── Parse and verify apply results ───────────────────────────────────────────
_aq() { node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$APPLY_REPORT','utf8'))$1))"; }

readonly APPLY_APPLIED="$(_aq '.apply.groupsApplied')"
readonly APPLY_ALREADY="$(_aq '.apply.groupsAlreadyRemediated')"
readonly APPLY_STOPPED="$(_aq '.apply.groupsStopped')"
readonly APPLY_DELETED="$(_aq '.apply.rowsDeleted')"
readonly APPLY_ORPHAN="$(node -e "
  const r=JSON.parse(require('fs').readFileSync('$APPLY_REPORT','utf8'));
  const v=r.apply.zeroOrphanVerification;
  process.stdout.write(typeof v==='string'?v:JSON.stringify(v));
")"
readonly APPLY_CLEARED="$(_aq '.apply.classAGroupsCleared')"

printf '[Gate2-Apply] Results: applied=%s alreadyRemediated=%s stopped=%s rowsDeleted=%s\n' \
  "$APPLY_APPLIED" "$APPLY_ALREADY" "$APPLY_STOPPED" "$APPLY_DELETED"
printf '[Gate2-Apply] Zero-orphan:   %s\n' "$APPLY_ORPHAN"
printf '[Gate2-Apply] Class A cleared: %s\n' "$APPLY_CLEARED"

[[ "$APPLY_STOPPED" -eq 0 ]] \
  || die "Apply stopped on $APPLY_STOPPED groups. Inspect apply report; do not proceed until stopped groups are resolved."

# ── Post-apply clean-checkout guard ──────────────────────────────────────────
[[ -z "$(git status --porcelain)" ]] \
  || die "Checkout changed during apply. STOP and review before any further action."

# ── STOP ─────────────────────────────────────────────────────────────────────
printf '\n[Gate2-Apply] COMPLETE\n'
printf '[Gate2-Apply] Git SHA:      %s\n' "$APPLY_GIT_SHA"
printf '[Gate2-Apply] Apply report: %s\n' "$APPLY_REPORT"
printf '\n%s\n' \
  'STOP — resume writers (pm2 start or equivalent).' \
  'This script creates no uniqueness index, runs no Orderly action, and makes no PM2 or schema changes.' \
  'Sysco SKU 7664436 Class B pair remains untouched and requires separate PM disposition.'
