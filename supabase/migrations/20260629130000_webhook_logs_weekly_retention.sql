-- Hygiene for webhook_logs (db #70): weekly retention cron + one-time backlog prune.
--
-- Inbound provider-webhook audit log (one row + jsonb payload per webhook), unbounded since 2026-04-10
-- (8388 rows, 3773 >30 days), never pruned. The UI only needs recent logs (useWebhookHealth = last 1h;
-- admin Webhooks = recent list). Same pattern as tracking_sync_runs #64 (no skip-logging needed here —
-- every webhook log is a real event, not idle cron noise).
--
-- Weekly cron: Sundays 04:00 UTC (staggered off the tracking-sync retention at 03:00), delete >30 days.
-- Replay-safe (unschedule-if-exists then reschedule). Plus an immediate one-time prune of the backlog.
--
-- Rollback: select cron.unschedule('webhook-logs-retention-weekly');

do $$
begin
  perform cron.unschedule('webhook-logs-retention-weekly');
exception when others then null; -- not scheduled yet
end $$;

select cron.schedule(
  'webhook-logs-retention-weekly',
  '0 4 * * 0',
  $cron$delete from public.webhook_logs where created_at < now() - interval '30 days'$cron$
);

delete from public.webhook_logs where created_at < now() - interval '30 days';
