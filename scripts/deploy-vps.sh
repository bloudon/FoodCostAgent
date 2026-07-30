#!/usr/bin/env bash
#
# FNB Cost Pro — VPS Deploy Script
#
# Usage:   ./scripts/deploy-vps.sh
# Setup:   chmod +x scripts/deploy-vps.sh   (first time only)
#
# WARNING: NEVER run `npm run db:push` on the VPS — it will try to drop
#          the `migrations` table and can destroy data. This script uses
#          the idempotent SQL migration file instead.
#
# What this script does (in order):
#   1. Preflight checks  (DATABASE_URL, psql, pm2, npm)
#   2. git pull           (fetches latest code from origin/main)
#   3. npm install --include=dev  (installs all deps including build tools)
#   4. DB migration       (runs scripts/vps-migrate.sql via psql)
#   5. Build              (removes old dist, runs npm run build)
#   6. npm prune          (removes devDependencies after build)
#   7. PM2 restart        (restarts the fnbcostpro process)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Auto-load .env if DATABASE_URL is not already set in the environment.
# NOTE: We use `set -a; source; set +a` instead of `export $(… | xargs)` because
# xargs word-splits on shell metacharacters (!, @, #, spaces) that commonly appear
# in database passwords, which would mangle DATABASE_URL before psql ever sees it.
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    # Preflight: detect .env lines whose values contain unquoted spaces.
    #
    # `source` word-splits on unquoted spaces, so a line like:
    #   APP_NAME=FNB Cost Pro
    # silently sets APP_NAME=FNB and tries to run "Cost" as a command.
    # Values that contain spaces must be quoted, e.g.:
    #   APP_NAME="FNB Cost Pro"
    #
    # Valid patterns that are NOT flagged:
    #   KEY=singleword          — no spaces at all
    #   KEY=value  # comment    — trailing inline comment (bash ignores after #)
    #   KEY="multi word"        — properly quoted
    #
    # The pattern requires a second non-comment, non-space word after the first
    # word, which is the only form that causes silent mis-assignment via source.
    bad_lines=$(grep -En \
      "^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^\"'[:space:]][^[:space:]]*[[:space:]]+[^#[:space:]]" \
      "$PROJECT_DIR/.env" || true)
    if [[ -n "$bad_lines" ]]; then
      echo "ERROR: .env contains values with unquoted spaces." >&2
      echo "       source will silently truncate these at the first space:" >&2
      echo "$bad_lines" >&2
      echo '       Fix: wrap the value in double quotes, e.g. APP_NAME="FNB Cost Pro"' >&2
      exit 1
    fi

    set -a
    # shellcheck source=/dev/null
    source "$PROJECT_DIR/.env"
    set +a
    echo "  Loaded environment from .env"
  else
    echo "  Warning: no .env file found at $PROJECT_DIR/.env"
  fi
fi

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
  warn "Uncommitted changes detected on the VPS — stashing before pull."
  git stash push -m "deploy-script auto-stash $(date '+%Y%m%d-%H%M%S')"
fi

step "Pulling latest code (git pull)"
git pull origin main

step "Installing dependencies (npm install --include=dev)"
npm install --include=dev

step "Running database migrations (vps-migrate.sql)"
[[ -f "$SCRIPT_DIR/vps-migrate.sql" ]] || fail "scripts/vps-migrate.sql not found. Cannot deploy without migrations."
psql "$DATABASE_URL" -f "$SCRIPT_DIR/vps-migrate.sql"
echo "  Migration script applied."

step "Building application (npm run build)"
rm -rf dist
npm run build

step "Checking bundle for top-level await regressions"
node "$SCRIPT_DIR/check-bundle-tla.js" || fail "Bundle TLA check failed — deploy aborted before any server restart. Fix the top-level await regression listed above and redeploy."

step "Pruning dev dependencies"
npm prune --omit=dev

step "Restarting PM2 process (fnbcostpro)"
pm2 restart fnbcostpro

echo ""
echo "═══════════════════════════════════════════════"
echo -e "  ${GREEN}✔  Deploy complete!${NC}"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════"
