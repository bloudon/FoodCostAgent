#!/usr/bin/env bash
#
# Standard FnB Cost Pro VPS release lane.
#
# Run from the repository root on the CostPro VPS:
#   scripts/vps/update-fnbcostpro-from-main.sh
#
# This is intentionally separate from deploy-reviewed-orderly-preflight.sh.
# It deploys the current GitHub main branch only; it does not run database
# migration commands, Orderly preflight/preview/APPLY commands, or touch the
# separate kaye-api process on port 8080.

set -Eeuo pipefail
umask 077

die() {
  printf 'REFUSED: %s\n' "$*" >&2
  exit 1
}

readonly EXPECTED_APP_DIR="/home/administrator/apps/CostPro/fnbcostpro"
readonly EXPECTED_BRANCH="main"
readonly EXPECTED_PM2_NAME="fnbcostpro"
readonly EXPECTED_API_PORT="3004"
readonly EXPECTED_VPS_ENV_FILE="${EXPECTED_APP_DIR}/.env"

# This helper is deliberately non-generic: allowing caller-provided target
# values could restart kaye-api or a different checkout by mistake.
[[ -z "${APP_DIR:-}" || "$APP_DIR" = "$EXPECTED_APP_DIR" ]] \
  || die "APP_DIR must remain $EXPECTED_APP_DIR."
[[ -z "${BRANCH:-}" || "$BRANCH" = "$EXPECTED_BRANCH" ]] \
  || die "BRANCH must remain $EXPECTED_BRANCH."
[[ -z "${PM2_NAME:-}" || "$PM2_NAME" = "$EXPECTED_PM2_NAME" ]] \
  || die "PM2_NAME must remain $EXPECTED_PM2_NAME."
[[ -z "${API_PORT:-}" || "$API_PORT" = "$EXPECTED_API_PORT" ]] \
  || die "API_PORT must remain $EXPECTED_API_PORT."
[[ -z "${VPS_ENV_FILE:-}" || "$VPS_ENV_FILE" = "$EXPECTED_VPS_ENV_FILE" ]] \
  || die "VPS_ENV_FILE must remain $EXPECTED_VPS_ENV_FILE."

readonly APP_DIR="$EXPECTED_APP_DIR"
readonly BRANCH="$EXPECTED_BRANCH"
readonly PM2_NAME="$EXPECTED_PM2_NAME"
readonly API_PORT="$EXPECTED_API_PORT"
readonly VPS_ENV_FILE="$EXPECTED_VPS_ENV_FILE"

[[ -d "$APP_DIR/.git" ]] || die "APP_DIR is not a Git checkout."
[[ -f "$APP_DIR/pnpm-lock.yaml" ]] || die "APP_DIR is not the expected pnpm workspace."
[[ -f "$VPS_ENV_FILE" ]] || die "VPS_ENV_FILE does not exist."

for command in git pnpm pm2 node curl awk mktemp sha256sum; do
  command -v "$command" >/dev/null 2>&1 || die "Required command is unavailable: $command"
done

cd "$APP_DIR"

# Never hide drift with a stash or overwrite. Resolve it before a release.
[[ -z "$(git status --porcelain)" ]] || die "VPS checkout is dirty; review and clear drift before release."
case "$(git remote get-url origin)" in
  "https://github.com/bloudon/FoodCostAgent.git" \
  | "git@github.com:bloudon/FoodCostAgent.git" \
  | "ssh://git@github.com/bloudon/FoodCostAgent.git") ;;
  *) die "origin is not the approved FoodCostAgent GitHub repository." ;;
esac

git fetch --prune origin
git switch "$BRANCH"
git pull --ff-only origin "$BRANCH"
[[ -z "$(git status --porcelain)" ]] || die "Checkout became dirty after the fast-forward update."

verify_pm2_target() {
  # Require the already-managed process to point to this API artifact and own
  # the only permitted API port. This avoids restarting a similarly named
  # service from another checkout or validating another listener on port 3004.
  pm2 jlist | env APP_DIR="$APP_DIR" PM2_NAME="$PM2_NAME" API_PORT="$API_PORT" node -e '
  const fs = require("node:fs");
  const path = require("node:path");
  const apps = JSON.parse(fs.readFileSync(0, "utf8"));
  const app = apps.find((candidate) => candidate.name === process.env.PM2_NAME);
  if (!app || app.pm2_env?.status !== "online") process.exit(2);
  if (path.resolve(app.pm2_env?.pm_cwd ?? "") !== process.env.APP_DIR) process.exit(3);
  const expectedEntry = path.join(process.env.APP_DIR, "artifacts/api-server/dist/index.mjs");
  if (path.resolve(app.pm2_env?.pm_exec_path ?? "") !== expectedEntry) process.exit(4);
  if (String(app.pm2_env?.env?.PORT ?? "") !== process.env.API_PORT) process.exit(5);
'
}

verify_pm2_target \
  || die "PM2 process $PM2_NAME is not online from this checkout's API artifact on port $API_PORT."

# Both production artifacts use build tools from devDependencies, so retain
# them on the VPS. Nginx serves the web build directly from
# artifacts/fnb-cost-pro/dist/public while PM2 runs the API bundle.
pnpm install --frozen-lockfile --prod=false
pnpm --filter @workspace/fnb-cost-pro run build
pnpm --filter @workspace/api-server run build

readonly FRONTEND_INDEX="${APP_DIR}/artifacts/fnb-cost-pro/dist/public/index.html"
[[ -f "$FRONTEND_INDEX" ]] || die "Frontend build did not produce index.html."
readonly FRONTEND_BUNDLE="$(node -e '
  const fs = require("node:fs");
  const html = fs.readFileSync(process.argv[1], "utf8");
  const matches = [...html.matchAll(/src="(\/assets\/index-[^"]+\.js)"/g)];
  if (matches.length !== 1) process.exit(1);
  process.stdout.write(matches[0][1]);
' "$FRONTEND_INDEX")"
[[ -n "$FRONTEND_BUNDLE" ]] || die "Could not identify the generated frontend bundle."
[[ -f "${APP_DIR}/artifacts/fnb-cost-pro/dist/public${FRONTEND_BUNDLE}" ]] \
  || die "Generated frontend bundle is missing from dist/public."
readonly FRONTEND_BUNDLE_SHA256="$(sha256sum \
  "${APP_DIR}/artifacts/fnb-cost-pro/dist/public${FRONTEND_BUNDLE}" \
  | awk '{print $1}')"
[[ "$FRONTEND_BUNDLE_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || die "Could not hash the generated frontend bundle."

readonly GIT_SHA="$(git rev-parse HEAD)"
readonly API_VERSION="$(node -p "require('./artifacts/api-server/package.json').version")"
readonly BUILD_ID="api@${API_VERSION}:${GIT_SHA}"

# Keep the build identity in the existing dotenv file and refresh PM2's inherited
# environment together. No dotenv values are printed.
temp_env="$(mktemp "${VPS_ENV_FILE}.tmp.XXXXXX")"
cleanup_temp_env() {
  rm -f "$temp_env"
}
trap cleanup_temp_env EXIT

awk -v value="$BUILD_ID" '
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

PORT="$API_PORT" APP_BUILD_ID="$BUILD_ID" NODE_ENV=production \
  pm2 restart "$PM2_NAME" --update-env

health=""
build_info=""
served_frontend_bundle=""
served_frontend_bundle_sha256=""
for _attempt in $(seq 1 30); do
  if ! verify_pm2_target; then
    sleep 1
    continue
  fi
  health="$(curl --fail --silent --show-error "http://127.0.0.1:${API_PORT}/api/healthz" 2>/dev/null || true)"
  build_info="$(curl --fail --silent --show-error "http://127.0.0.1:${API_PORT}/api/build-info" 2>/dev/null || true)"
  served_frontend_bundle="$(curl --fail --silent --show-error \
    --header 'Cache-Control: no-cache' \
    "https://fnbcostpro.com/?release=${GIT_SHA}" 2>/dev/null \
    | node -e '
      let html = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { html += chunk; });
      process.stdin.on("end", () => {
        const matches = [...html.matchAll(/src="(\/assets\/index-[^"]+\.js)"/g)];
        if (matches.length !== 1) process.exit(1);
        process.stdout.write(matches[0][1]);
      });
    ' || true)"
  served_frontend_bundle_sha256="$(curl --fail --silent --show-error \
    --proto '=https' \
    --location \
    --max-redirs 0 \
    --header 'Cache-Control: no-cache' \
    "https://fnbcostpro.com${FRONTEND_BUNDLE}?release=${GIT_SHA}" 2>/dev/null \
    | sha256sum \
    | awk '{print $1}' \
    || true)"
  if HEALTH="$health" BUILD_INFO="$build_info" EXPECTED_BUILD_ID="$BUILD_ID" node -e '
    const healthText = process.env.HEALTH?.trim();
    const buildInfoText = process.env.BUILD_INFO?.trim();
    if (!healthText || !buildInfoText) process.exit(1);

    let health;
    let build;
    try {
      health = JSON.parse(healthText);
      build = JSON.parse(buildInfoText);
    } catch {
      process.exit(1);
    }

    if (health?.status !== "ok") process.exit(1);
    if (build?.service !== "fnb-cost-pro-api") process.exit(1);
    if (build?.buildId !== process.env.EXPECTED_BUILD_ID) process.exit(1);
  ' && [[ "$served_frontend_bundle" = "$FRONTEND_BUNDLE" ]] \
    && [[ "$served_frontend_bundle_sha256" = "$FRONTEND_BUNDLE_SHA256" ]]; then
    printf '%s\n' \
      '{' \
      '  "operation": "mainline-vps-release",' \
      "  \"gitSha\": \"${GIT_SHA}\"," \
      "  \"buildId\": \"${BUILD_ID}\"," \
      "  \"frontendBundle\": \"${FRONTEND_BUNDLE}\"," \
      "  \"frontendBundleSha256\": \"${FRONTEND_BUNDLE_SHA256}\"," \
      "  \"pm2Process\": \"${PM2_NAME}\"," \
      "  \"apiPort\": ${API_PORT}," \
      '  "healthVerified": true,' \
      '  "buildIdentityVerified": true,' \
      '  "frontendBundleVerified": true,' \
      '  "databaseMigrationCommandExecuted": false,' \
      '  "orderlyPreviewOrApplyExecuted": false' \
      '}'
    exit 0
  fi
  sleep 1
done

die "The expected API build identity and generated frontend bundle were not both being served after restart."