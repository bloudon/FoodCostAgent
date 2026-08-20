#!/usr/bin/env bash
#
# Produce READ-ONLY production Gate 2 readiness evidence from the exact
# production Gate 1 classifier report. This does not invoke the merge CLI.
#
# Required environment:
#   APP_DIR                                     Absolute clean application checkout
#   VPS_ENV_FILE                                Existing VPS application dotenv file
#   VENDOR_ITEM_DUPLICATE_REPORT_PATH           Absolute Gate 1 production JSON report
#   VENDOR_ITEM_GATE2_READINESS_REPORT_DIR      Absolute secure output directory outside APP_DIR

set -Eeuo pipefail
umask 077

die() {
  printf 'REFUSED: %s\n' "$*" >&2
  exit 1
}

required_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "$name must be set."
}

for name in APP_DIR VPS_ENV_FILE VENDOR_ITEM_DUPLICATE_REPORT_PATH VENDOR_ITEM_GATE2_READINESS_REPORT_DIR; do
  required_env "$name"
done

[[ "$APP_DIR" = /* && -d "$APP_DIR/.git" ]] \
  || die "APP_DIR must be an absolute Git checkout."
[[ "$VPS_ENV_FILE" = /* && -f "$VPS_ENV_FILE" ]] \
  || die "VPS_ENV_FILE must be an existing absolute path."
[[ "$VENDOR_ITEM_DUPLICATE_REPORT_PATH" = /* && -f "$VENDOR_ITEM_DUPLICATE_REPORT_PATH" ]] \
  || die "VENDOR_ITEM_DUPLICATE_REPORT_PATH must be an existing absolute file."
[[ "$VENDOR_ITEM_GATE2_READINESS_REPORT_DIR" = /* ]] \
  || die "VENDOR_ITEM_GATE2_READINESS_REPORT_DIR must be an absolute path."

case "$VENDOR_ITEM_GATE2_READINESS_REPORT_DIR/" in
  "$APP_DIR/"*) die "VENDOR_ITEM_GATE2_READINESS_REPORT_DIR must be outside APP_DIR." ;;
esac
case "$VENDOR_ITEM_DUPLICATE_REPORT_PATH" in
  "$APP_DIR/"*) die "VENDOR_ITEM_DUPLICATE_REPORT_PATH must be outside APP_DIR; do not reuse a checkout-local/Dev report." ;;
esac

for command in git pnpm node mkdir; do
  command -v "$command" >/dev/null 2>&1 || die "Required command is unavailable: $command"
done

cd "$APP_DIR"
[[ -z "$(git status --porcelain)" ]] \
  || die "Checkout is dirty; inspect one exact reviewed source state only."
readonly READINESS_GIT_SHA="$(git rev-parse --verify HEAD)" \
  || die "APP_DIR has no committed HEAD."

mkdir -p "$VENDOR_ITEM_GATE2_READINESS_REPORT_DIR"

set +e
VENDOR_ITEM_DUPLICATE_REPORT_PATH="$VENDOR_ITEM_DUPLICATE_REPORT_PATH" \
VENDOR_ITEM_GATE2_READINESS_REPORT_DIR="$VENDOR_ITEM_GATE2_READINESS_REPORT_DIR" \
DOTENV_CONFIG_PATH="$VPS_ENV_FILE" \
pnpm --filter @workspace/api-server exec tsx --require dotenv/config \
  src/services/orderly/vendorItemDuplicateGate2ReadinessCli.ts
readonly READINESS_STATUS="$?"
set -e

[[ "$READINESS_STATUS" -eq 0 || "$READINESS_STATUS" -eq 2 ]] \
  || die "Readiness CLI failed before producing approved evidence (status $READINESS_STATUS)."

[[ -z "$(git status --porcelain)" ]] \
  || die "Readiness tool changed the checkout; STOP and review before any other action."

printf 'Readiness Git SHA: %s\n' "$READINESS_GIT_SHA"
printf 'Full JSON report: %s\n' "$VENDOR_ITEM_GATE2_READINESS_REPORT_DIR/vendor-item-gate2-readiness.json"
printf 'Markdown report: %s\n' "$VENDOR_ITEM_GATE2_READINESS_REPORT_DIR/vendor-item-gate2-readiness.md"
printf '%s\n' 'STOP: this script authorizes no duplicate deletion, reference repointing, uniqueness index, schema migration, PM2 action, Orderly preview, or APPLY.'

if [[ "$READINESS_STATUS" -eq 2 ]]; then
  printf '%s\n' 'STOP: proposed loser identities were found in EDI payloads; return the structured report for PM reference-contract review.'
  exit 2
fi