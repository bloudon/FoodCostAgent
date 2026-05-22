#!/usr/bin/env bash
#
# FNB Cost Pro — Backup Failure Notifier
#
# Sends an email alert via SMTP2GO when the nightly backup fails.
# Called automatically by run-backup.sh on non-zero exit — do not call directly
# in the cron line.
#
# Required environment variables (sourced from .env on the VPS):
#   SMTP2GO_USERNAME    — SMTP2GO login username
#   SMTP2GO_PASSWORD    — SMTP2GO login password
#   SMTP_FROM_EMAIL     — Sender address (e.g. no-reply@fnbcostpro.com)
#   BACKUP_ALERT_EMAIL  — Recipient address for failure alerts
#
# Optional:
#   SMTP2GO_HOST        — defaults to mail.smtp2go.com
#   SMTP2GO_PORT        — defaults to 587
#
# Usage:
#   notify-failure.sh <log_file> <exit_code>
#

set -uo pipefail

LOG_FILE="${1:-}"
EXIT_CODE="${2:-1}"

# ─── Load .env if running from cron (no inherited environment) ─────────────────

APP_DIR="${APP_DIR:-/var/www/fnbcostpro}"
ENV_FILE="$APP_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  # Export only the vars we need — avoid eval on untrusted content
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^(SMTP2GO_USERNAME|SMTP2GO_PASSWORD|SMTP_FROM_EMAIL|SMTP_FROM_NAME|SMTP2GO_HOST|SMTP2GO_PORT|BACKUP_ALERT_EMAIL)$ ]] || continue
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    # Strip surrounding quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    export "$key=$value"
  done < "$ENV_FILE"
fi

# ─── Validate required vars ────────────────────────────────────────────────────

SMTP_HOST="${SMTP2GO_HOST:-mail.smtp2go.com}"
SMTP_PORT="${SMTP2GO_PORT:-587}"
SMTP_USER="${SMTP2GO_USERNAME:-}"
SMTP_PASS="${SMTP2GO_PASSWORD:-}"
FROM_EMAIL="${SMTP_FROM_EMAIL:-no-reply@fnbcostpro.com}"
FROM_NAME="${SMTP_FROM_NAME:-FNB Cost Pro}"
TO_EMAIL="${BACKUP_ALERT_EMAIL:-}"

if [[ -z "$SMTP_USER" || -z "$SMTP_PASS" ]]; then
  echo "[notify-failure] SMTP2GO credentials not set — cannot send alert." >&2
  exit 1
fi

if [[ -z "$TO_EMAIL" ]]; then
  echo "[notify-failure] BACKUP_ALERT_EMAIL not set — no recipient configured." >&2
  exit 1
fi

# ─── Build the alert body ──────────────────────────────────────────────────────

HOSTNAME_VAL="$(hostname -f 2>/dev/null || hostname)"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"
SUBJECT="[ALERT] FNB Cost Pro backup FAILED on $HOSTNAME_VAL — $TIMESTAMP"

TAIL_LINES=""
if [[ -n "$LOG_FILE" && -f "$LOG_FILE" ]]; then
  TAIL_LINES="$(tail -n 20 "$LOG_FILE")"
else
  TAIL_LINES="(log file not available)"
fi

BODY="FNB Cost Pro nightly backup failed.

Date/Time : $TIMESTAMP
Host      : $HOSTNAME_VAL
Exit Code : $EXIT_CODE

─── Last 20 lines of backup log ───────────────────────────────────
$TAIL_LINES
────────────────────────────────────────────────────────────────────

Action required: SSH into $HOSTNAME_VAL and inspect:
  tail -100 $LOG_FILE

This alert was sent automatically by run-backup.sh.
"

# ─── RFC 2822 email message ────────────────────────────────────────────────────

# curl --upload-file reads an email message from stdin/file. We build a
# minimal but valid RFC 2822 message.
EMAIL_MSG="From: $FROM_NAME <$FROM_EMAIL>
To: $TO_EMAIL
Subject: $SUBJECT
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

$BODY"

# ─── Send via SMTP2GO using curl's built-in SMTP support ─────────────────────

echo "[notify-failure] Sending failure alert to $TO_EMAIL ..."

curl --silent --show-error \
  --url "smtp://$SMTP_HOST:$SMTP_PORT" \
  --ssl-reqd \
  --user "$SMTP_USER:$SMTP_PASS" \
  --mail-from "$FROM_EMAIL" \
  --mail-rcpt "$TO_EMAIL" \
  --upload-file - \
  <<< "$EMAIL_MSG"

CURL_EXIT=$?

if [[ $CURL_EXIT -eq 0 ]]; then
  echo "[notify-failure] Alert sent successfully."
else
  echo "[notify-failure] curl exited with code $CURL_EXIT — alert may not have been delivered." >&2
fi

exit $CURL_EXIT
