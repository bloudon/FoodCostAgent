#!/usr/bin/env bash
#
# Deploy the exact PM-reviewed Orderly preflight build to the existing CostPro
# VPS process. This is an operator script, not a general deploy script.
#
# Required environment:
#   APP_DIR       Absolute VPS checkout path
#   API_PORT      Existing local API listener port
#
# Optional environment:
#   PM2_NAME      Existing PM2 process name (default: fnbcostpro)
#   VPS_ENV_FILE  Existing dotenv file (default: $APP_DIR/.env)
#
# This script intentionally does NOT call drizzle-kit/db:push, any Orderly
# preview/APPLY command, a backup operation, or writer-quiescence controls.
#
set -Eeuo pipefail
umask 077

readonly REVIEWED_GIT_SHA="b6bc86aeea7e6ab38b8e02cbb4d436c945cda945"
readonly REVIEWED_API_VERSION="1.15.0"
readonly REVIEWED_BUILD_ID="api@${REVIEWED_API_VERSION}:${REVIEWED_GIT_SHA}"

die() {
  printf 'REFUSED: %s\n' "$*" >&2
  exit 1
}

required_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "$name must be set."
}

required_env APP_DIR
required_env API_PORT

readonly PM2_NAME="${PM2_NAME:-fnbcostpro}"
readonly VPS_ENV_FILE="${VPS_ENV_FILE:-${APP_DIR}/.env}"

[[ "$APP_DIR" = /* ]] || die "APP_DIR must be an absolute path."
[[ "$API_PORT" =~ ^[1-9][0-9]{0,4}$ ]] && (( API_PORT <= 65535 )) \
  || die "API_PORT must be an integer from 1 through 65535."
[[ -d "$APP_DIR/.git" ]] || die "APP_DIR is not a Git checkout."
[[ -f "$APP_DIR/pnpm-lock.yaml" ]] || die "APP_DIR is not the expected pnpm workspace."
[[ -f "$VPS_ENV_FILE" ]] || die "VPS_ENV_FILE does not exist."
grep -qE '^DATABASE_URL=.+$' "$VPS_ENV_FILE" \
  || die "VPS_ENV_FILE has no DATABASE_URL entry."
grep -qE '^PORT=.+$' "$VPS_ENV_FILE" \
  || die "VPS_ENV_FILE has no PORT entry."

for command in git pnpm pm2 node curl awk mktemp; do
  command -v "$command" >/dev/null 2>&1 || die "Required command is unavailable: $command"
done

cd "$APP_DIR"

# Do not hide a locally modified server checkout behind a stash. An operator
# must first review and clear any drift before moving the process to this build.
[[ -z "$(git status --porcelain)" ]] || die "VPS checkout is dirty; review its drift before deployment."

# Do not replace or create a PM2 process. The current process must already be
# bound to this checkout; a changed PM2 process definition is a separate ops
# change and must be reviewed independently.
pm2 jlist | env APP_DIR="$APP_DIR" PM2_NAME="$PM2_NAME" node --input-type=module -e '
  import fs from "node:fs";
  import path from "node:path";
  const apps = JSON.parse(fs.readFileSync(0, "utf8"));
  const app = apps.find((candidate) => candidate.name === process.env.PM2_NAME);
  if (!app) process.exit(2);
  if (app.pm2_env?.pm_cwd !== process.env.APP_DIR) process.exit(3);
  const expectedEntry = path.join(process.env.APP_DIR, "artifacts/api-server/dist/index.mjs");
  if (path.resolve(app.pm2_env?.pm_exec_path ?? "") !== expectedEntry) process.exit(4);
' || die "PM2 process $PM2_NAME is missing or is not bound to APP_DIR."

git fetch --prune origin
git cat-file -e "${REVIEWED_GIT_SHA}^{commit}" \
  || die "Reviewed Git commit is unavailable from the configured remote."
git merge-base --is-ancestor "$REVIEWED_GIT_SHA" origin/main \
  || die "Reviewed Git commit is not contained in origin/main history."
git switch --detach "$REVIEWED_GIT_SHA"
[[ "$(git rev-parse HEAD)" = "$REVIEWED_GIT_SHA" ]] \
  || die "Checkout does not match the reviewed Git commit."
[[ -z "$(git status --porcelain)" ]] || die "Checkout became dirty after switching revisions."

# VPS shells commonly export NODE_ENV=production, but the API bundle needs
# esbuild and other development tools. Install them explicitly; runtime pruning
# is intentionally omitted so a later reviewed build remains reproducible
# without changing the dependency set behind PM2's back. The existing PM2
# process runs only artifacts/api-server/dist/index.mjs, so build that workspace
# alone. Do not invoke the root recursive build: it also builds the web and Expo
# workspaces, neither of which is a VPS runtime artifact.
pnpm install --frozen-lockfile --prod=false
pnpm --filter @workspace/api-server run build

# dotenv does not override a value already held by PM2. Persist the reviewed
# identity in the dotenv file and refresh the existing process environment in
# the same operation, without printing any environment value.
temp_env="$(mktemp "${VPS_ENV_FILE}.tmp.XXXXXX")"
cleanup_temp_env() {
  rm -f "$temp_env"
}
trap cleanup_temp_env EXIT
awk -v value="$REVIEWED_BUILD_ID" '
  BEGIN { replaced = 0 }
  /^APP_BUILD_ID=/ {
    if (!replaced) print "APP_BUILD_ID=" value
    replaced = 1
    next
  }
  { print }
  END {
    if (!replaced) print "APP_BUILD_ID=" value
  }
' "$VPS_ENV_FILE" > "$temp_env"
chmod --reference="$VPS_ENV_FILE" "$temp_env" 2>/dev/null || chmod 600 "$temp_env"
mv "$temp_env" "$VPS_ENV_FILE"
trap - EXIT

APP_BUILD_ID="$REVIEWED_BUILD_ID" NODE_ENV=production \
  pm2 restart "$PM2_NAME" --update-env

build_info=""
for _attempt in $(seq 1 30); do
  if build_info="$(curl --fail --silent --show-error \
    "http://127.0.0.1:${API_PORT}/api/build-info" 2>/dev/null)"; then
    if BUILD_INFO="$build_info" EXPECTED_BUILD_ID="$REVIEWED_BUILD_ID" node --input-type=module -e '
      const body = JSON.parse(process.env.BUILD_INFO);
      if (body?.service !== "fnb-cost-pro-api" || body?.buildId !== process.env.EXPECTED_BUILD_ID) process.exit(1);
    '; then
      break
    fi
  fi
  build_info=""
  sleep 1
done
[[ -n "$build_info" ]] || die "Serving API did not expose the reviewed build identity after restart."

printf '%s\n' \
  '{' \
  '  "operation": "reviewed-vps-deployment",' \
  "  \"gitSha\": \"${REVIEWED_GIT_SHA}\"," \
  "  \"apiVersion\": \"${REVIEWED_API_VERSION}\"," \
  "  \"buildId\": \"${REVIEWED_BUILD_ID}\"," \
  '  "pm2ProcessVerified": true,' \
  '  "startupMigrationPath": "application-startup-idempotent-schema-checks",' \
  '  "dbPushExecuted": false,' \
  '  "productionPreviewExecuted": false,' \
  '  "catalogApplyExecuted": false,' \
  '  "servingBuildVerified": true' \
  '}'