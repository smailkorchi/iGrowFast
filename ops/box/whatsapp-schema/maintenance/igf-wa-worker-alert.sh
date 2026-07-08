#!/usr/bin/env bash
# igf-wa-worker-alert.sh — box-level WhatsApp-worker liveness alerting.
# Replaces pg_cron job 38 (_cron_worker_health_alert), which wrote one
# UNDELETABLE audit_log hash-chain row per stale minute that no page showed
# (dropped in whatsapp_022). One outage = one STALE email + one RECOVERED
# email via igf-alert.sh; per-worker state files in /run (tmpfs — reboot with
# a dead worker re-alerts, which is correct).
# Installed: /usr/local/bin/igf-wa-worker-alert.sh on the .102 box,
# driven by /etc/cron.d/igf-wa-worker-alert every minute.
set -euo pipefail

STALE_AFTER_S=120   # heartbeat is 5s; 120s rides out container rebuilds/redeploys
STATE_DIR=/run/igf-wa-worker-alert
mkdir -p "$STATE_DIR"

rows=$(docker exec supabase-db psql -U postgres -d postgres -At -c \
  "select worker_id || '|' || extract(epoch from (now() - last_heartbeat_at))::int
     from whatsapp.worker_health
    where last_heartbeat_at > now() - interval '30 days'") || exit 0

while IFS='|' read -r worker age; do
  [[ -z "${worker:-}" ]] && continue
  state="$STATE_DIR/${worker//[^a-zA-Z0-9_-]/_}"
  if (( age > STALE_AFTER_S )); then
    if [[ ! -f "$state" ]]; then
      touch "$state"
      /usr/local/bin/igf-alert.sh "WhatsApp worker STALE: ${worker}" \
        "Heartbeat is ${age}s old (threshold ${STALE_AFTER_S}s). Dispatcher + webhook ingest presumed down on the WhatsApp node (.67).
Check: ssh igf-wa 'docker ps; docker logs igf-wa-worker --tail 100'" || true
    fi
  else
    if [[ -f "$state" ]]; then
      rm -f "$state"
      /usr/local/bin/igf-alert.sh "WhatsApp worker RECOVERED: ${worker}" \
        "Heartbeat is ${age}s old — worker is reporting again." || true
    fi
  fi
done <<< "$rows"
