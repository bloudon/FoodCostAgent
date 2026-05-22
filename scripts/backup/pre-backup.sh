#!/usr/bin/env bash
#
# FNB Cost Pro — Pre-Backup Script
#
# This script runs BEFORE each IDrive backup to:
#   1. Dump the PostgreSQL database to a local staging directory
#   2. Copy critical config files (.env, PM2 config, nginx config) into staging
#
# IDrive then picks up the entire staging directory as part of its backup set.
#
# Designed to be called by run-backup.sh — not normally run directly.
#
# EDIT THE VARIABLES BELOW to match your VPS paths.
#
set -euo pipefail

# ─── CONFIGURATION — adjust these paths for your VPS ──────────────────────────

# Root directory where the app lives on the VPS
APP_DIR="${APP_DIR:-/var/www/fnbcostpro}"

# Where to stage files before IDrive picks them up
STAGING_DIR="${STAGING_DIR:-/var/backups/fnbcostpro}"

# Nginx site config file (adjust if your filename differs)
NGINX_CONF="${NGINX_CONF:-/etc/nginx/sites-available/fnbcostpro}"

# PM2 ecosystem file (try both common names)
PM2_CONF=""
for candidate in \
    "$APP_DIR/ecosystem.config.cjs" \
    "$APP_DIR/ecosystem.config.js" \
    "$HOME/ecosystem.config.cjs" \
    "$HOME/ecosystem.config.js"; do
  if [[ -f "$candidate" ]]; then
    PM2_CONF="$candidate"
    break
  fi
done

# ──────────────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }
fail() { echo -e "${RED}✖  $1${NC}"; exit 1; }

TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')
DB_DUMP_DIR="$STAGING_DIR/db-dumps"
CONFIG_STAGE="$STAGING_DIR/config-snapshot"

echo "═══════════════════════════════════════════════"
echo "  FNB Cost Pro — Pre-Backup"
echo "  $TIMESTAMP"
echo "═══════════════════════════════════════════════"

step "Creating staging directories"
mkdir -p "$DB_DUMP_DIR" "$CONFIG_STAGE"
echo "  Staging: $STAGING_DIR"

# ─── 1. DATABASE DUMP ─────────────────────────────────────────────────────────

step "Dumping PostgreSQL database"

# Load DATABASE_URL from .env if not already in environment.
# We extract only the DATABASE_URL line and eval it directly — this safely handles
# values that contain &, ?, =, spaces, or other shell-significant characters that
# would break the common `export $(... | xargs)` pattern.
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f "$APP_DIR/.env" ]]; then
    DATABASE_URL_LINE=$(grep -m1 '^DATABASE_URL=' "$APP_DIR/.env" || true)
    if [[ -n "$DATABASE_URL_LINE" ]]; then
      # Strip the key= prefix and export the raw value, preserving all characters
      export DATABASE_URL="${DATABASE_URL_LINE#DATABASE_URL=}"
      echo "  Loaded DATABASE_URL from .env"
    fi
  fi
fi

[[ -z "${DATABASE_URL:-}" ]] && fail "DATABASE_URL is not set. Cannot dump database."

DUMP_FILE="$DB_DUMP_DIR/fnbcostpro_$TIMESTAMP.sql.gz"

# pg_dump with compression. --no-password relies on DATABASE_URL containing credentials.
pg_dump "$DATABASE_URL" \
  --format=plain \
  --no-owner \
  --no-acl \
  | gzip > "$DUMP_FILE"

DUMP_SIZE=$(du -sh "$DUMP_FILE" | cut -f1)
echo "  Database dump: $DUMP_FILE ($DUMP_SIZE)"

# Keep only the last 7 daily dumps in staging to avoid disk fill-up
# (IDrive retains the full history in the cloud)
ls -t "$DB_DUMP_DIR"/*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm --
echo "  Old local dumps pruned (keeping last 7)."

# ─── 2. CONFIG FILES ──────────────────────────────────────────────────────────

step "Snapshotting config files"

# .env
if [[ -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env" "$CONFIG_STAGE/.env.snapshot"
  echo "  .env ✓"
else
  warn ".env not found at $APP_DIR/.env — skipping."
fi

# PM2 ecosystem config
if [[ -n "$PM2_CONF" ]]; then
  cp "$PM2_CONF" "$CONFIG_STAGE/$(basename "$PM2_CONF")"
  echo "  PM2 config ($(basename "$PM2_CONF")) ✓"
else
  warn "PM2 ecosystem config not found — skipping. Set PM2_CONF= if it lives elsewhere."
fi

# Nginx site config
if [[ -f "$NGINX_CONF" ]]; then
  cp "$NGINX_CONF" "$CONFIG_STAGE/nginx-fnbcostpro.conf"
  echo "  Nginx config ✓"
else
  warn "Nginx config not found at $NGINX_CONF — skipping."
fi

# Write a snapshot manifest
cat > "$CONFIG_STAGE/manifest.txt" <<EOF
FNB Cost Pro Config Snapshot
Generated: $TIMESTAMP
App directory: $APP_DIR
Hostname: $(hostname)
EOF

echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}✔  Pre-backup complete.${NC}  Staging: $STAGING_DIR"
echo "═══════════════════════════════════════════════"
