#!/usr/bin/env bash
#
# FNB Cost Pro — Backup Client Setup
#
# This project now uses rclone + IDrive e2 for backups.
# The IDrive Perl client is no longer used.
#
# To set up backups on a fresh VPS, run these steps instead:
#
#   1. Install rclone:
#      curl https://rclone.org/install.sh | sudo bash
#
#   2. Configure rclone with your IDrive e2 credentials:
#      rclone config
#      (choose: n → name "idrive-e2" → s3 → IDrive → enter keys/endpoint)
#
#   3. Test the connection:
#      rclone ls idrive-e2:fnbcostpro-backups
#
#   4. Run a manual backup:
#      APP_DIR=/home/administrator/apps/CostPro/fnbcostpro ./scripts/backup/run-backup.sh
#
#   5. Set up the daily cron job:
#      ./scripts/backup/setup-cron.sh
#

echo ""
echo "═══════════════════════════════════════════════"
echo "  FNB Cost Pro — Backup Setup"
echo "═══════════════════════════════════════════════"
echo ""
echo "  Backups now use rclone + IDrive e2."
echo "  The IDrive Perl client is no longer needed."
echo ""
echo "  If rclone is not yet installed:"
echo "    curl https://rclone.org/install.sh | sudo bash"
echo ""
echo "  If rclone is installed but not configured:"
echo "    rclone config"
echo ""
echo "  To run a backup now:"
echo "    APP_DIR=/home/administrator/apps/CostPro/fnbcostpro \\"
echo "    ./scripts/backup/run-backup.sh"
echo ""
echo "═══════════════════════════════════════════════"
