-- Hygiene for tracking_sync_runs (db #64): weekly retention cron + one-time backlog prune.
--
-- Paired with the sync-tracking-statuses edge fn change (commit pending) that STOPS logging idle
-- cron/startup runs (only logs total>0 / error / manual). This caps the historical backlog and any
-- residual growth. The table only feeds the "last sync" UI widget, so 30 days of history is ample.
--
-- Weekly cron: Sundays 03:00 UTC, delete runs older than 30 days. Replay-safe (unschedule-if-exists
-- then reschedule). Plus an immediate one-time prune of the existing >30-day backlog (~5072 rows).
--
-- Rollback: select cron.unschedule('tracking-sync-runs-retention-weekly');

do $$
begin
  perform cron.unschedule('tracking-sync-runs-retention-weekly');
exception when others then null; -- not scheduled yet
end $$;

select cron.schedule(
  'tracking-sync-runs-retention-weekly',
  '0 3 * * 0',
  $cron$delete from public.tracking_sync_runs where started_at < now() - interval '30 days'$cron$
);

-- one-time prune of the existing backlog so the table shrinks immediately
delete from public.tracking_sync_runs where started_at < now() - interval '30 days';
