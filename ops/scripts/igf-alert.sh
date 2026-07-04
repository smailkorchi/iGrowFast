#!/usr/bin/env bash
# igf-alert.sh SUBJECT [BODY]
# Ops-alert primitive. Sends one plaintext email via SMTPS using creds in
# /root/.config/igf-backup/smtp.env. BODY defaults to stdin. Used by every
# backup job's ERR trap and by the mutual watchdog. Independent of the Supabase
# stack (raw curl+SMTP), so it still fires when the DB/containers are down.
set -euo pipefail
CFG=${IGF_SMTP_CFG:-/root/.config/igf-backup/smtp.env}
# shellcheck disable=SC1090
. "$CFG"
SUBJECT="${1:?subject required}"
BODY="${2:-$(cat)}"
HOST=$(hostname)
RCPT="${IGF_ALERT_TO:?IGF_ALERT_TO not set}"
FROM="${SMTP_ADMIN_EMAIL:?}"
NAME="${SMTP_SENDER_NAME:-iGrowFast}"
DATE=$(date -uR)
MSG=$(printf 'From: %s <%s>\r\nTo: %s\r\nSubject: [iGrowFast %s] %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n' \
  "$NAME" "$FROM" "$RCPT" "$HOST" "$SUBJECT" "$DATE" "$BODY")
printf '%s' "$MSG" | curl -sS --url "smtps://${SMTP_HOST}:${SMTP_PORT}" \
  --ssl-reqd --user "${SMTP_USER}:${SMTP_PASS}" \
  --mail-from "$FROM" --mail-rcpt "$RCPT" --upload-file - --max-time 30
echo "alert sent: [$HOST] $SUBJECT"
