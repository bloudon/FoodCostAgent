#!/usr/bin/env bash
#
# Run the Gate 1 vendor-item duplicate classifier against the database selected
# by the existing VPS dotenv file. This is a READ-ONLY diagnostic only.
#
# Required environment:
#   APP_DIR                           Absolute application checkout path
#   VPS_ENV_FILE                      Existing application dotenv file
#   VENDOR_ITEM_DUPLICATE_REPORT_DIR  Absolute secure output directory outside APP_DIR
#
# The classifier runs SELECT queries only. It does not start PM2, create an
# index, mutate catalog/reference rows, or invoke an Orderly preview/APPLY.

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

for name in APP_DIR VPS_ENV_FILE VENDOR_ITEM_DUPLICATE_REPORT_DIR; do
  required_env "$name"
done

[[ "$APP_DIR" = /* && -d "$APP_DIR/.git" ]] \
  || die "APP_DIR must be an absolute Git checkout."
[[ "$VPS_ENV_FILE" = /* && -f "$VPS_ENV_FILE" ]] \
  || die "VPS_ENV_FILE must be an existing absolute path."
[[ "$VENDOR_ITEM_DUPLICATE_REPORT_DIR" = /* ]] \
  || die "VENDOR_ITEM_DUPLICATE_REPORT_DIR must be an absolute path."

case "$VENDOR_ITEM_DUPLICATE_REPORT_DIR/" in
  "$APP_DIR/"*) die "VENDOR_ITEM_DUPLICATE_REPORT_DIR must be outside APP_DIR." ;;
esac

for command in git pnpm node mkdir dirname; do
  command -v "$command" >/dev/null 2>&1 || die "Required command is unavailable: $command"
done

cd "$APP_DIR"
[[ -z "$(git status --porcelain)" ]] \
  || die "Checkout is dirty; classify one exact source state only."
readonly CLASSIFIER_GIT_SHA="$(git rev-parse --verify HEAD)" \
  || die "APP_DIR has no committed HEAD; classify one exact reviewed source state only."

mkdir -p "$VENDOR_ITEM_DUPLICATE_REPORT_DIR"

VENDOR_ITEM_DUPLICATE_REPORT_DIR="$VENDOR_ITEM_DUPLICATE_REPORT_DIR" \
DOTENV_CONFIG_PATH="$VPS_ENV_FILE" \
pnpm exec tsx --require dotenv/config \
  artifacts/api-server/src/services/orderly/vendorItemDuplicateClassifierCli.ts

[[ -z "$(git status --porcelain)" ]] \
  || die "Classifier changed the checkout; STOP and review before any other action."

printf 'Classifier Git SHA: %s\n' "$CLASSIFIER_GIT_SHA"
printf 'Full JSON report: %s\n' "$VENDOR_ITEM_DUPLICATE_REPORT_DIR/vendor-item-duplicate-classification.json"
printf 'Markdown report: %s\n' "$VENDOR_ITEM_DUPLICATE_REPORT_DIR/vendor-item-duplicate-classification.md"
printf '%s\n' 'STOP: no duplicate deletion, reference repointing, uniqueness-index creation, production preview, or APPLY is authorized by this script.'