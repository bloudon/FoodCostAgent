#!/usr/bin/env bash
#
# FNB Cost Pro — IDrive Backup Runner
#
# This is the main backup script. It:
#   1. Runs pre-backup.sh (pg_dump + config snapshot)
#   2. Kicks off the IDrive backup covering the staging dir and app directory
#   3. Logs the result
#
# Called directly by the cron job. Can also be run manually for ad-hoc backups.
#
# Usage (on VPS):
#   chmod +x scripts/backup/run-backup.sh
#   ./scripts/backup/run-backup.sh
#
# EDIT THE VARIABLES BELOW to match your VPS paths before first run.
#
set -euo pipefail

# ─── CONFIGURATION — adjust these paths for your VPS ──────────────────────────

# Root directory where the app lives on the VPS
APP_DIR="${APP_DIR:-/var/www/fnbcostpro}"

# Staging directory written by pre-backup.sh
STAGING_DIR="${STAGING_DIR:-/var/backups/fnbcostpro}"

# IDrive client directory (set by install-idrive.sh, or override here)
IDRIVE_CONFIG="$HOME/.fnbcostpro-backup/config"
if [[ -f "$IDRIVE_CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$IDRIVE_CONFIG"
fi
IDRIVE_DIR="${IDRIVE_DIR:-$HOME/IDrive/IDriveForLinux}"

# Log file for backup history
LOG_DIR="${LOG_DIR:-/var/log/fnbcostpro-backup}"
LOG_FILE="$LOG_DIR/backup.log"

# Nginx config directory (backed up for completeness)
NGINX_CONF_DIR="${NGINX_CONF_DIR:-/etc/nginx/sites-available}"

# ──────────────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step()  { echo -e "\n${GREEN}▶ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠  $1${NC}"; }
fail()  { echo -e "${RED}✖  $1${NC}"; exit 1; }

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

mkdir -p "$LOG_DIR"

{
echo "═══════════════════════════════════════════════"
echo "  FNB Cost Pro — IDrive Backup"
echo "  $TIMESTAMP"
echo "═══════════════════════════════════════════════"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Step 1: Pre-backup (pg_dump + config snapshot) ───────────────────────────

step "Running pre-backup (pg_dump + config snapshot)"
APP_DIR="$APP_DIR" STAGING_DIR="$STAGING_DIR" \
  bash "$SCRIPT_DIR/pre-backup.sh"

# ─── Step 2: IDrive backup ────────────────────────────────────────────────────

step "Verifying IDrive client"
[[ -d "$IDRIVE_DIR" ]] || fail "IDrive client not found at $IDRIVE_DIR. Run install-idrive.sh first."
[[ -f "$IDRIVE_DIR/Backup.pl" ]] || fail "Backup.pl not found in $IDRIVE_DIR. IDrive install may be incomplete."

step "Starting IDrive backup"

# Build the list of paths to back up:
#   - Staging dir (db dumps + config snapshots)
#   - App directory (source code, uploads, object storage)
#   - Nginx configs (read-only, so we copy path directly)
BACKUP_PATHS="$STAGING_DIR,$APP_DIR"
if [[ -d "$NGINX_CONF_DIR" ]]; then
  BACKUP_PATHS="$BACKUP_PATHS,$NGINX_CONF_DIR"
fi

echo "  Backup paths: $BACKUP_PATHS"
echo "  IDrive client: $IDRIVE_DIR"

perl "$IDRIVE_DIR/Backup.pl" \
  --backup-location "$BACKUP_PATHS" \
  --silent

BACKUP_EXIT=$?

if [[ $BACKUP_EXIT -eq 0 ]]; then
  echo -e "\n${GREEN}✔  IDrive backup completed successfully.${NC}"
else
  echo -e "\n${RED}✖  IDrive backup exited with code $BACKUP_EXIT. Check IDrive logs.${NC}"
  exit $BACKUP_EXIT
fi

echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}✔  Backup complete — $(date '+%Y-%m-%d %H:%M:%S %Z')${NC}"
echo "═══════════════════════════════════════════════"

} 2>&1 | tee -a "$LOG_FILE"
