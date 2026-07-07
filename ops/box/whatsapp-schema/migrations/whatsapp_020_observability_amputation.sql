-- whatsapp_020_observability_amputation.sql
--
-- OWNER RULING 2026-07-08 (supersedes the 2026-07-05 "keep the logs/telemetry
-- stack verbatim" ruling): the metrics/logs stack is DROPPED. The product surface
-- is the 4 admin pages (Numbers, Inbox, Assignment, Contacts) + seller inbox;
-- Dashboard/Statistics/Log/Monitor pages are CUT, so their entire data layer goes.
--
-- KEPT on purpose (page-visible or load-bearing):
--   audit_log + audit() + chain          — NumberDetail timeline + realtime sub +
--                                          reconnects_7d + lifecycle_auto_promote
--                                          reads message.dead 7d + 25 RPC writers
--   app_cache + cache_get_or_compute     — instance_stats (NumberDetail)
--   og_cache + cache_janitor             — inbox link previews (og-fetch edge fn)
--   worker_health(+_status view)         — Numbers page tiles + stale-alert cron
--   dispatcher_snapshot                  — Numbers/NumberDetail live gauges
--   validate_audit_chain / admin_audit_chain_status — zero runtime cost, only way
--                                          to verify the kept chain
--
-- ingest_system_logs is NOT dropped but STUBBED to a no-op: three live callers
-- (worker logSink 4s flush, edge _shared/logError, client-log edge fn) keep
-- calling it fire-and-forget; wave 1 removes the callers, then the stub can go.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

-- ── 1. unschedule the observability crons ────────────────────────────────────
select cron.unschedule(jobname)
from cron.job
where jobname in (
  'prune_system_logs_daily',        -- 43
  'snapshot_worker_health_minute',  -- 44
  'cron_ingest_runs_minute',        -- 47
  'prune_host_metrics_hourly',      -- 48
  'snapshot_db_metrics_minute',     -- 49
  'monitor_r2_prune_daily',         -- 50
  'purge-metric-samples'            -- 52
);

-- ── 2. drop the consumer-less function families ──────────────────────────────
do $mig$
declare v_name text; r record; v_n int := 0;
begin
  foreach v_name in array array[
    -- monitor family
    'monitor_app','monitor_host_current','monitor_host_series','monitor_overview',
    'monitor_prom_latest','monitor_prom_series','monitor_r2',
    'db_metrics_live','db_metrics_series',
    -- log page family
    'admin_query_logs','admin_log_facets',
    -- dashboard family
    'dashboard_overview','dashboard_activity_impl','_compute_dashboard_activity',
    'agent_performance',
    -- stats family (instance_stats + its shim are KEPT)
    'stats_overview','stats_overview_impl','stats_breakdowns','stats_breakdowns_impl',
    'stats_by_agent','stats_by_agent_impl','stats_heatmap','stats_heatmap_impl',
    'stats_message_series','stats_message_series_impl',
    'stats_latency_series','stats_latency_series_impl',
    'stats_worker_series','stats_worker_series_impl',
    'stats_fleet','stats_fleet_impl','stats_service',
    '_compute_stats_breakdowns','_compute_stats_by_agent','_compute_stats_fleet',
    '_compute_stats_heatmap','_compute_stats_latency_series',
    '_compute_stats_message_series','_compute_stats_overview','_compute_stats_worker_series',
    -- warmer leftovers
    'cache_warm','cache_quantize',
    -- dead/orphaned ingest feeds (collectors never deployed / tables dropped below)
    'ingest_host_metrics','ingest_prom_metrics','ingest_platform_logs','ingest_r2_metrics',
    -- their crons
    '_cron_prune_system_logs','_cron_snapshot_db_metrics','_cron_snapshot_worker_health',
    '_cron_ingest_cron_runs','_cron_prune_host_metrics','_cron_prune_r2_metrics',
    '_cron_purge_metric_samples'
  ]
  loop
    for r in
      select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'whatsapp' and p.proname = v_name
    loop
      execute format('drop function %s', r.sig);
      v_n := v_n + 1;
    end loop;
  end loop;
  raise notice 'dropped % functions', v_n;
end
$mig$;

-- ── 3. stub the live-caller sink (same signature, same ACL, does nothing) ────
create or replace function whatsapp.ingest_system_logs(p_entries jsonb)
returns integer
language sql
as $$ select 0 $$;

-- ── 4. drop the observability tables ─────────────────────────────────────────
drop table whatsapp.system_logs;            -- leaves supabase_realtime automatically
drop table whatsapp.db_metrics_history;
drop table whatsapp.worker_health_history;
drop table whatsapp.host_metrics;
drop table whatsapp.r2_metrics;
drop table whatsapp.metric_samples;
drop table whatsapp._cron_ingest_state;

-- ── 5. drop the now-orphaned enums ───────────────────────────────────────────
drop type whatsapp.log_source;
drop type whatsapp.log_level;

commit;

-- Verify:
--   select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='whatsapp' and relkind='r' order by 1;             -- 29 tables
--   select jobid, jobname from cron.job order by jobid;                -- 7 wa jobs left
--   select whatsapp.ingest_system_logs('[]'::jsonb);                   -- returns 0
--   docker logs igf-wa-worker --since 5m  | grep -ci error             -- no new errors
