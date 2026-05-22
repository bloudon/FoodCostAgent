#!/usr/bin/env bash
#
# FNB Cost Pro — Backup Cron Job Setup
#
# Installs a daily cron job that runs run-backup.sh at 2:30 AM server time.
# Safe to run multiple times — it checks for an existing entry first.
#
# Usage (on VPS):
#   chmod +x scripts/backup/setup-cron.sh
#   ./scripts/backup/setup-cron.sh
#
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/run-backup.sh"
LOG_DIR="${LOG_DIR:-/var/log/fnbcostpro-backup}"

echo "═══════════════════════════════════════════════"
echo "  FNB Cost Pro — Cron Job Setup"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════"

step "Checking backup script"
[[ -f "$BACKUP_SCRIPT" ]] || { echo "run-backup.sh not found at $BACKUP_SCRIPT"; exit 1; }
chmod +x "$BACKUP_SCRIPT"
echo "  $BACKUP_SCRIPT ✓"

mkdir -p "$LOG_DIR"
echo "  Log directory: $LOG_DIR ✓"

step "Installing cron job"

# The cron line: run at 02:30 every day, log stdout+stderr to a dated file
CRON_LINE="30 2 * * * $BACKUP_SCRIPT >> $LOG_DIR/cron-\$(date +\\%Y-\\%m-\\%d).log 2>&1"

# Check if it's already installed
if crontab -l 2>/dev/null | grep -qF "$BACKUP_SCRIPT"; then
  warn "Cron job for run-backup.sh is already installed. No changes made."
  echo ""
  echo "  Current crontab entry:"
  crontab -l 2>/dev/null | grep "$BACKUP_SCRIPT"
else
  # Append to existing crontab
  (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  echo -e "  ${GREEN}Cron job installed.${NC}"
  echo ""
  echo "  Schedule: daily at 2:30 AM server time"
  echo "  Command : $BACKUP_SCRIPT"
  echo "  Logs    : $LOG_DIR/cron-YYYY-MM-DD.log"
fi

step "Verifying crontab"
echo ""
crontab -l 2>/dev/null | grep -E "(fnbcostpro|BACKUP)" || true

echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}✔  Cron job setup complete.${NC}"
echo ""
echo "  To run the backup manually right now:"
echo "    $BACKUP_SCRIPT"
echo ""
echo "  To check backup logs:"
echo "    tail -f $LOG_DIR/backup.log"
echo "═══════════════════════════════════════════════"
