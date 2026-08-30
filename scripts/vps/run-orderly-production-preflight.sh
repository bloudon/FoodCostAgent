#!/usr/bin/env bash
#
# Run ONLY the read-only Orderly production readiness preflight after the
# reviewed VPS deployment script has verified the active serving build.
#
# Required environment:
#   APP_DIR, API_PORT, ORDERLY_MANIFEST_PATH, ORDERLY_SOURCE_PATH,
#   ORDERLY_PREFLIGHT_OUT, ORDERLY_EXPECTED_COMPANY_ID,
#   ORDERLY_EXPECTED_STORE_ID, ORDERLY_EXPECTED_DB_HOST,
#   ORDERLY_EXPECTED_DB_PORT, ORDERLY_EXPECTED_DB_NAME
#
set -Eeuo pipefail
umask 077

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REVIEWED_GIT_SHA="7c8f75f750602cc7227a807bf6dbc10fd141fa15"
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

for name in \
  APP_DIR API_PORT ORDERLY_MANIFEST_PATH ORDERLY_SOURCE_PATH ORDERLY_PREFLIGHT_OUT \
  ORDERLY_EXPECTED_COMPANY_ID ORDERLY_EXPECTED_STORE_ID \
  ORDERLY_EXPECTED_DB_HOST ORDERLY_EXPECTED_DB_PORT ORDERLY_EXPECTED_DB_NAME; do
  required_env "$name"
done

[[ "$APP_DIR" = /* ]] || die "APP_DIR must be an absolute path."
[[ "$API_PORT" =~ ^[1-9][0-9]{0,4}$ ]] && (( API_PORT <= 65535 )) \
  || die "API_PORT must be an integer from 1 through 65535."
[[ "$ORDERLY_MANIFEST_PATH" = /* && -f "$ORDERLY_MANIFEST_PATH" ]] \
  || die "ORDERLY_MANIFEST_PATH must be an existing absolute path."
[[ "$ORDERLY_SOURCE_PATH" = /* && -f "$ORDERLY_SOURCE_PATH" ]] \
  || die "ORDERLY_SOURCE_PATH must be an existing absolute path."
[[ "$ORDERLY_PREFLIGHT_OUT" = /* ]] \
  || die "ORDERLY_PREFLIGHT_OUT must be an absolute path."

for command in git pnpm node curl dirname mkdir; do
  command -v "$command" >/dev/null 2>&1 || die "Required command is unavailable: $command"
done

cd "$APP_DIR"
[[ "$(git rev-parse HEAD)" = "$REVIEWED_GIT_SHA" ]] \
  || die "Checkout is not the reviewed Git commit."
[[ -z "$(git status --porcelain)" ]] \
  || die "Checkout is dirty; preflight requires one exact reviewed build."

build_info="$(curl --fail --silent --show-error \
  "http://127.0.0.1:${API_PORT}/api/build-info")" \
  || die "Unable to reach the active local API build-info endpoint."
BUILD_INFO="$build_info" EXPECTED_BUILD_ID="$REVIEWED_BUILD_ID" node --input-type=module -e '
  const body = JSON.parse(process.env.BUILD_INFO);
  if (body?.service !== "fnb-cost-pro-api" || body?.buildId !== process.env.EXPECTED_BUILD_ID) process.exit(1);
' || die "Active API does not expose the reviewed build identity."

mkdir -p "$(dirname "$ORDERLY_PREFLIGHT_OUT")"

NODE_ENV=production pnpm --filter @workspace/api-server run orderly:adoption-production-preflight -- \
  --manifest "$ORDERLY_MANIFEST_PATH" \
  --source "$ORDERLY_SOURCE_PATH" \
  --out "$ORDERLY_PREFLIGHT_OUT" \
  --expected-company-id "$ORDERLY_EXPECTED_COMPANY_ID" \
  --expected-store-id "$ORDERLY_EXPECTED_STORE_ID" \
  --expected-db-host "$ORDERLY_EXPECTED_DB_HOST" \
  --expected-db-port "$ORDERLY_EXPECTED_DB_PORT" \
  --expected-db-name "$ORDERLY_EXPECTED_DB_NAME" \
  --expected-git-sha "$REVIEWED_GIT_SHA" \
  --expected-api-version "$REVIEWED_API_VERSION" \
  --expected-build-id "$REVIEWED_BUILD_ID" \
  --api-port "$API_PORT"

readonly SANITIZED_OUT="${ORDERLY_PREFLIGHT_OUT%.json}.sanitized.json"
node "$SCRIPT_DIR/summarize-orderly-production-preflight.mjs" \
  "$ORDERLY_PREFLIGHT_OUT" "$SANITIZED_OUT"

printf 'Sanitized preflight report: %s\n' "$SANITIZED_OUT"
printf '%s\n' 'STOP: production preview, APPLY, backups, writer quiescence, remediation, and July work are not authorized by this script.'