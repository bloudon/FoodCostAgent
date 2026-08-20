#!/usr/bin/env bash
# Produce READ-ONLY provenance for the final held Sysco vendor-item pair.
set -Eeuo pipefail
umask 077

die() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }
for name in APP_DIR VPS_ENV_FILE SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR SYSCO_DUPLICATE_REVIEWED_COMPANY_ID; do
  [[ -n "${!name:-}" ]] || die "$name must be set."
done
[[ "$APP_DIR" = /* && -d "$APP_DIR/.git" ]] || die "APP_DIR must be an absolute Git checkout."
[[ "$VPS_ENV_FILE" = /* && -f "$VPS_ENV_FILE" ]] || die "VPS_ENV_FILE must be an existing absolute path."
[[ "$SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR" = /* ]] || die "SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR must be absolute."
case "$SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR/" in "$APP_DIR/"*) die "output must be outside APP_DIR." ;; esac

cd "$APP_DIR"
[[ -z "$(git status --porcelain)" ]] || die "Checkout is dirty."
readonly PROVENANCE_GIT_SHA="$(git rev-parse --verify HEAD)"
mkdir -p "$SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR"

SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR="$SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR" \
DOTENV_CONFIG_PATH="$VPS_ENV_FILE" \
pnpm --filter @workspace/api-server exec tsx --require dotenv/config \
  src/services/orderly/vendorItemDuplicateSyscoProvenanceCli.ts

[[ -z "$(git status --porcelain)" ]] || die "Provenance collector changed the checkout."
printf 'Provenance Git SHA: %s\n' "$PROVENANCE_GIT_SHA"
printf 'Provenance JSON: %s\n' "$SYSCO_DUPLICATE_PROVENANCE_REPORT_DIR/sysco-7664436-provenance.json"
printf '%s\n' 'STOP: no Sysco winner, deletion, repoint, index, migration, PM2 action, preview, or APPLY is authorized.'