#!/usr/bin/env bash
#
# FNB Cost Pro — VPS Deploy Script
#
# Usage:   ./scripts/deploy-vps.sh
#
# WARNING: NEVER run `npm run db:push` on the VPS — it will try to drop
#          the `migrations` table and can destroy data. This script uses
#          the idempotent SQL migration file instead.
#
# What this script does (in order):
#   1. Preflight checks  (DATABASE_URL, psql, pm2, npm)
#   2. git pull           (fetches latest code from origin/main)
#   3. npm install        (installs any new/changed packages)
#   4. DB migration       (runs scripts/vps-migrate.sql via psql)
#   5. Build              (removes old dist, runs npm run build)
#   6. PM2 restart        (restarts the fnbcostpro process)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }
fail() { echo -e "${RED}✖  $1${NC}"; exit 1; }

cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════════"
echo "  FNB Cost Pro — VPS Deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════"

step "Preflight checks"

[[ -z "${DATABASE_URL:-}" ]] && fail "DATABASE_URL is not set. Aborting."
command -v psql  >/dev/null 2>&1 || fail "psql not found. Install PostgreSQL client."
command -v pm2   >/dev/null 2>&1 || fail "pm2 not found. Install pm2 globally."
command -v npm   >/dev/null 2>&1 || fail "npm not found."
echo "  DATABASE_URL ✓  psql ✓  pm2 ✓  npm ✓"

if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  warn "Uncommitted changes detected on the VPS. Proceeding anyway."
fi

step "Pulling latest code (git pull)"
git pull origin main

step "Installing dependencies (npm install)"
npm install

step "Running database migrations (vps-migrate.sql)"
if [[ -f "$SCRIPT_DIR/vps-migrate.sql" ]]; then
  psql "$DATABASE_URL" -f "$SCRIPT_DIR/vps-migrate.sql"
  echo "  Migration script applied."
else
  warn "scripts/vps-migrate.sql not found — skipping DB migration."
fi

step "Building application (npm run build)"
rm -rf dist
npm run build

step "Restarting PM2 process (fnbcostpro)"
pm2 restart fnbcostpro

echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}✔  Deploy complete!${NC}"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════"
