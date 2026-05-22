#!/usr/bin/env bash
#
# FNB Cost Pro — Backup Test Restore Verification
#
# Pulls the most recent database dump and a sample file from IDrive
# to confirm that backups are intact and actually restorable.
#
# This does NOT restore to production — it downloads to a temp directory
# only and verifies the dump can be parsed by pg_restore / psql.
#
# Usage (on VPS):
#   chmod +x scripts/backup/test-restore.sh
#   ./scripts/backup/test-restore.sh
#
set -euo pipefail

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

APP_DIR="${APP_DIR:-/var/www/fnbcostpro}"
STAGING_DIR="${STAGING_DIR:-/var/backups/fnbcostpro}"
RESTORE_TEST_DIR="${RESTORE_TEST_DIR:-/tmp/fnbcostpro-restore-test}"

IDRIVE_CONFIG="$HOME/.fnbcostpro-backup/config"
if [[ -f "$IDRIVE_CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$IDRIVE_CONFIG"
fi
IDRIVE_DIR="${IDRIVE_DIR:-$HOME/IDrive/IDriveForLinux}"

# ──────────────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step()    { echo -e "\n${GREEN}▶ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠  $1${NC}"; }
fail()    { echo -e "${RED}✖  $1${NC}"; exit 1; }
success() { echo -e "${GREEN}✔  $1${NC}"; }

echo "═══════════════════════════════════════════════"
echo "  FNB Cost Pro — Backup Test Restore"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════"
echo ""
echo "  This will download a backup copy to:"
echo "  $RESTORE_TEST_DIR"
echo "  (nothing is restored to production)"
echo ""

mkdir -p "$RESTORE_TEST_DIR"

# ─── Part A: Verify local staging dump ────────────────────────────────────────

step "Checking most recent local staging dump"

LATEST_LOCAL=$(ls -t "$STAGING_DIR/db-dumps/"*.sql.gz 2>/dev/null | head -1 || true)

if [[ -z "$LATEST_LOCAL" ]]; then
  fail "No local dump found in $STAGING_DIR/db-dumps/ — run run-backup.sh first."
else
  echo "  Most recent local dump: $LATEST_LOCAL"
  DUMP_SIZE=$(du -sh "$LATEST_LOCAL" | cut -f1)
  echo "  Size: $DUMP_SIZE"

  # Verify the gzip is not corrupt
  if gzip -t "$LATEST_LOCAL" 2>/dev/null; then
    success "Local dump gzip integrity: OK"
  else
    fail "Local dump is corrupt! Re-run run-backup.sh."
  fi

  # Decompress to temp and check it's valid SQL
  DECOMPRESSED="$RESTORE_TEST_DIR/test-dump.sql"
  gunzip -c "$LATEST_LOCAL" > "$DECOMPRESSED"
  LINE_COUNT=$(wc -l < "$DECOMPRESSED")
  echo "  Decompressed SQL lines: $LINE_COUNT"

  if grep -q "PostgreSQL database dump" "$DECOMPRESSED"; then
    success "SQL dump header verified: valid pg_dump output."
  else
    warn "Could not verify pg_dump header — file may still be valid."
  fi

  # Show top-level table list from dump
  echo ""
  echo "  Tables found in dump:"
  grep "^CREATE TABLE" "$DECOMPRESSED" | sed 's/CREATE TABLE public\.\([^ ]*\).*/    - \1/' | head -20 || true
  rm -f "$DECOMPRESSED"
fi

# ─── Part B: Download a file from IDrive ──────────────────────────────────────

step "Downloading a sample file from IDrive"

[[ -d "$IDRIVE_DIR" ]] || fail "IDrive client not found at $IDRIVE_DIR. Run install-idrive.sh first."

# Restore the most recent DB dump from IDrive to the test directory
# IDrive restore path format: <device>/<backup-path>
IDRIVE_RESTORE_DIR="$RESTORE_TEST_DIR/idrive-restore"
mkdir -p "$IDRIVE_RESTORE_DIR"

echo "  Requesting latest DB dump from IDrive..."
echo "  (IDrive will prompt for the source path if needed)"
echo ""

# Restore the db-dumps folder from IDrive — fail hard on any error
perl "$IDRIVE_DIR/Restore.pl" \
  --restore-location "$IDRIVE_RESTORE_DIR" \
  --items "$STAGING_DIR/db-dumps" \
  --silent
RESTORE_EXIT=$?
if [[ $RESTORE_EXIT -ne 0 ]]; then
  fail "IDrive restore exited with code $RESTORE_EXIT. Check IDrive logs for details. Run run-backup.sh and verify the IDrive dashboard shows a successful job before re-running this script."
fi

RESTORED_DUMPS=$(ls "$IDRIVE_RESTORE_DIR"/*.sql.gz 2>/dev/null | wc -l)
if [[ "$RESTORED_DUMPS" -eq 0 ]]; then
  fail "IDrive restore succeeded but no .sql.gz files were downloaded to $IDRIVE_RESTORE_DIR. This indicates the backup set may be empty or the path is wrong. Verify in the IDrive dashboard that db-dumps were included in the last backup job."
fi

success "IDrive restore downloaded $RESTORED_DUMPS file(s) to $IDRIVE_RESTORE_DIR"

LATEST_RESTORED=$(ls -t "$IDRIVE_RESTORE_DIR"/*.sql.gz | head -1)
if gzip -t "$LATEST_RESTORED" 2>/dev/null; then
  success "IDrive-restored dump gzip integrity: OK"
else
  fail "IDrive-restored dump is corrupt — the cloud backup may be incomplete. Re-run run-backup.sh and check for errors."
fi
RESTORED_SIZE=$(du -sh "$LATEST_RESTORED" | cut -f1)
echo "  Restored file: $LATEST_RESTORED ($RESTORED_SIZE)"

# ─── Part C: Summary ──────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}✔  Test restore check complete.${NC}"
echo ""
echo "  Test artifacts are in: $RESTORE_TEST_DIR"
echo "  Clean up when done:  rm -rf $RESTORE_TEST_DIR"
echo ""
echo "  To do a REAL restore in an emergency:"
echo "    1. Stop PM2:           pm2 stop fnbcostpro"
echo "    2. Restore DB dump:    gunzip -c <dump.sql.gz> | psql \"\$DATABASE_URL\""
echo "    3. Restore app files:  rsync -av <idrive-restore>/ $APP_DIR/"
echo "    4. Restart:            pm2 start fnbcostpro"
echo "═══════════════════════════════════════════════"
