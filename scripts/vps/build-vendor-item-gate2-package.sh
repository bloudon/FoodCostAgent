#!/usr/bin/env bash
# Build a NON-EXECUTABLE Gate 2 package. This command cannot run cleanup.
set -Eeuo pipefail
umask 077

die() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }
for name in APP_DIR VPS_ENV_FILE VENDOR_ITEM_DUPLICATE_REPORT_PATH VENDOR_ITEM_GATE2_READINESS_REPORT_PATH VENDOR_ITEM_GATE2_PACKAGE_DIR; do
  [[ -n "${!name:-}" ]] || die "$name must be set."
done
[[ "$APP_DIR" = /* && -d "$APP_DIR/.git" ]] || die "APP_DIR must be an absolute Git checkout."
[[ "$VPS_ENV_FILE" = /* && -f "$VPS_ENV_FILE" ]] || die "VPS_ENV_FILE must be an existing absolute path."
for file in "$VENDOR_ITEM_DUPLICATE_REPORT_PATH" "$VENDOR_ITEM_GATE2_READINESS_REPORT_PATH"; do
  [[ "$file" = /* && -f "$file" ]] || die "evidence reports must be existing absolute files."
  case "$file" in "$APP_DIR/"*) die "evidence reports must be outside APP_DIR." ;; esac
done
[[ "$VENDOR_ITEM_GATE2_PACKAGE_DIR" = /* ]] || die "VENDOR_ITEM_GATE2_PACKAGE_DIR must be absolute."
case "$VENDOR_ITEM_GATE2_PACKAGE_DIR/" in "$APP_DIR/"*) die "VENDOR_ITEM_GATE2_PACKAGE_DIR must be outside APP_DIR." ;; esac

cd "$APP_DIR"
[[ -z "$(git status --porcelain)" ]] || die "Checkout is dirty."
readonly PACKAGE_GIT_SHA="$(git rev-parse --verify HEAD)"
mkdir -p "$VENDOR_ITEM_GATE2_PACKAGE_DIR"

VENDOR_ITEM_DUPLICATE_REPORT_PATH="$VENDOR_ITEM_DUPLICATE_REPORT_PATH" \
VENDOR_ITEM_GATE2_READINESS_REPORT_PATH="$VENDOR_ITEM_GATE2_READINESS_REPORT_PATH" \
VENDOR_ITEM_GATE2_PACKAGE_DIR="$VENDOR_ITEM_GATE2_PACKAGE_DIR" \
DOTENV_CONFIG_PATH="$VPS_ENV_FILE" \
pnpm --filter @workspace/api-server exec tsx --require dotenv/config \
  src/services/orderly/vendorItemDuplicateGate2PackageCli.ts

[[ -z "$(git status --porcelain)" ]] || die "Package builder changed the checkout."
printf 'Package Git SHA: %s\n' "$PACKAGE_GIT_SHA"
printf 'Package JSON: %s\n' "$VENDOR_ITEM_GATE2_PACKAGE_DIR/vendor-item-production-gate2-package.json"
printf '%s\n' 'STOP: this is a non-executable review package; it does not delete, repoint, index, migrate, restart PM2, preview, or APPLY.'