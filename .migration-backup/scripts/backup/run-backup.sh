#!/usr/bin/env bash
#
# FNB Cost Pro — Backup Runner (rclone + IDrive e2)
#
# This is the main backup script. It:
#   1. Runs pre-backup.sh (pg_dump + config snapshot)
#   2. Uses rclone to sync the staging dir and nginx configs to IDrive e2
#   3. Logs the result
#
# Called directly by the cron job. Can also be run manually for ad-hoc backups.
#
# Usage (on VPS):
#   chmod +x scripts/backup/run-backup.sh
#   APP_DIR=/home/administrator/apps/CostPro/fnbcostpro ./scripts/backup/run-backup.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

# Root directory where the app lives on the VPS
APP_DIR="${APP_DIR:-/home/administrator/apps/CostPro/fnbcostpro}"

# Staging directory written by pre-backup.sh (db dumps + config snapshots)
STAGING_DIR="${STAGING_DIR:-/var/backups/fnbcostpro}"

# rclone remote name and bucket (configured via `rclone config`)
RCLONE_REMOTE="${RCLONE_REMOTE:-idrive-e2}"
RCLONE_BUCKET="${RCLONE_BUCKET:-fnbcostpro-backups}"

# Nginx config directory
NGINX_CONF_DIR="${NGINX_CONF_DIR:-/etc/nginx/sites-available}"

# Log file
LOG_DIR="${LOG_DIR:-/var/log/fnbcostpro-backup}"
LOG_FILE="$LOG_DIR/backup.log"

# ──────────────────────────────────────────────────────────────────────────────

_notify_on_failure() {
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo "[run-backup] Backup failed (exit $code) — sending alert..." >&2
    bash "$SCRIPT_DIR/notify-failure.sh" "$LOG_FILE" "$code" || true
  fi
}
trap _notify_on_failure EXIT

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
echo "  FNB Cost Pro — rclone Backup"
echo "  $TIMESTAMP"
echo "═══════════════════════════════════════════════"

# ─── Step 1: Pre-backup (pg_dump + config snapshot) ───────────────────────────

step "Running pre-backup (pg_dump + config snapshot)"
APP_DIR="$APP_DIR" STAGING_DIR="$STAGING_DIR" \
  bash "$SCRIPT_DIR/pre-backup.sh"

# ─── Step 2: Verify rclone ────────────────────────────────────────────────────

step "Verifying rclone"
command -v rclone >/dev/null 2>&1 \
  || fail "rclone not found. Install with: curl https://rclone.org/install.sh | sudo bash"

rclone lsd "$RCLONE_REMOTE:$RCLONE_BUCKET" >/dev/null 2>&1 \
  || fail "Cannot access $RCLONE_REMOTE:$RCLONE_BUCKET — check rclone config with: rclone config show"

echo "  rclone remote: $RCLONE_REMOTE"
echo "  bucket:        $RCLONE_BUCKET"

# ─── Step 3: Upload staging dir (db dumps + config snapshots) ─────────────────

step "Uploading staging dir to $RCLONE_REMOTE:$RCLONE_BUCKET/staging"
rclone sync "$STAGING_DIR" "$RCLONE_REMOTE:$RCLONE_BUCKET/staging" \
  --transfers=4 \
  --checksum \
  --stats=30s

echo -e "  ${GREEN}✔  Staging dir uploaded.${NC}"

# ─── Step 4: Upload nginx configs ─────────────────────────────────────────────

if [[ -d "$NGINX_CONF_DIR" ]]; then
  step "Uploading nginx configs to $RCLONE_REMOTE:$RCLONE_BUCKET/nginx"
  rclone sync "$NGINX_CONF_DIR" "$RCLONE_REMOTE:$RCLONE_BUCKET/nginx" \
    --transfers=4 \
    --checksum \
    --stats=30s
  echo -e "  ${GREEN}✔  Nginx configs uploaded.${NC}"
else
  warn "Nginx config dir not found at $NGINX_CONF_DIR — skipping."
fi

echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}✔  Backup complete — $(date '+%Y-%m-%d %H:%M:%S %Z')${NC}"
echo "═══════════════════════════════════════════════"

} 2>&1 | tee -a "$LOG_FILE"
