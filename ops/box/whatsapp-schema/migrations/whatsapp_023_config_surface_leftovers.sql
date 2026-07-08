-- whatsapp_023_config_surface_leftovers.sql — consequences of the 2026-07-08
-- config-surface ruling (commit f7dff33 removed the cockpit UI).
--
-- 1. auto_reconnect default TRUE: the watchdog toggle left the admin surface,
--    so self-healing is now infrastructure policy — a new number must be born
--    supervised or a dropped session would stay down with no UI to fix it.
--    (Both existing rows are already true; worker still honors the column and
--    the banned-lifecycle guard.)
-- 2. Zero-reader teardown, verified before drop (prosrc scan + repo grep):
--    - instance_stats family + cache_get_or_compute + app_cache: last reader
--      was the NumberDetail stats card. og_cache STAYS (inbox link previews);
--      cache_janitor STAYS (prunes og_cache + cron.job_run_details; its
--      app_cache branch is to_regclass-guarded — inert after the drop).
--    - dispatcher_snapshot: writer (worker 3s UPSERT) removed in the same
--      deploy, sole reader was the live-gauges UI.
--    - worker_health_status VIEW: sole reader was the Numbers KPI strip.
--      worker_health TABLE stays (heartbeat RPC + box stale-alert cron).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

alter table whatsapp.whatsapp_instances alter column auto_reconnect set default true;

drop function whatsapp.instance_stats(uuid);
drop function whatsapp.instance_stats_impl(uuid);
drop function whatsapp._compute_instance_stats(jsonb);
drop function whatsapp.cache_get_or_compute(text, interval, interval, regprocedure, jsonb);

drop table whatsapp.app_cache;
drop table whatsapp.dispatcher_snapshot;   -- leaves supabase_realtime automatically
drop view whatsapp.worker_health_status;

commit;

-- Verify:
--   select column_default from information_schema.columns
--    where table_schema='whatsapp' and table_name='whatsapp_instances'
--      and column_name='auto_reconnect';                      -- true
--   select whatsapp.cache_janitor();                          -- runs clean (guards)
