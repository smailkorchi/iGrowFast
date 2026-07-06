-- whatsapp_014c_activation.sql  (Wave 14c) — ACTIVATION: 16 cron jobs + realtime publication
-- TARGET: LIVE box .102 ONLY. Owner GO given 2026-07-06. This step STARTS live recurring jobs and adds
-- the whatsapp tables to the live realtime stream. Reversal: cron.unschedule(jobname) per job;
-- ALTER PUBLICATION supabase_realtime DROP TABLE ... per table.
-- Job names 1:1 with WA Mancer EXCEPT the two generic cache names, prefixed wa- ('cache-warm'/'cache-janitor'
-- -> 'wa-cache-warm'/'wa-cache-janitor') because cron.job is shared with 17 iGrowFast jobs. No collisions.

-- ============================================================ realtime
-- Mirror WA Mancer replica identity: whatsapp_instances = FULL (all others default).
alter table whatsapp.whatsapp_instances replica identity full;
alter publication supabase_realtime add table
  whatsapp.audit_log,
  whatsapp.conversation_assignments,
  whatsapp.conversation_notes,
  whatsapp.conversation_tags,
  whatsapp.conversations,
  whatsapp.dispatcher_snapshot,
  whatsapp.message_templates,
  whatsapp.messages,
  whatsapp.quick_replies,
  whatsapp.scheduled_messages,
  whatsapp.system_logs,
  whatsapp.tags,
  whatsapp.whatsapp_instances,
  whatsapp.worker_health;

-- ============================================================ 16 cron jobs (schedules 1:1)
select cron.schedule('outbound_queue_cleanup_daily',              '30 3 * * *',  'SELECT whatsapp._cron_outbound_queue_cleanup();');
select cron.schedule('worker_health_stale_alert_minute',          '* * * * *',   'SELECT whatsapp._cron_worker_health_alert();');
select cron.schedule('outbound_queue_reclaim_dispatching_minute', '* * * * *',   'SELECT whatsapp._cron_reclaim_stale_dispatching();');
select cron.schedule('lifecycle_auto_promote_daily',              '0 4 * * *',   'SELECT whatsapp._cron_lifecycle_auto_promote();');
select cron.schedule('scheduled_messages_drain_minute',           '* * * * *',   'SELECT whatsapp._cron_scheduled_messages_drain();');
select cron.schedule('unpin_expired_messages_minute',             '* * * * *',   'SELECT whatsapp._cron_unpin_expired_messages();');
select cron.schedule('prune_system_logs_daily',                   '15 3 * * *',  'select whatsapp._cron_prune_system_logs()');
select cron.schedule('snapshot_worker_health_minute',             '* * * * *',   'select whatsapp._cron_snapshot_worker_health()');
select cron.schedule('wa-cache-warm',                             '30 seconds',  'select whatsapp.cache_warm();');
select cron.schedule('wa-cache-janitor',                          '*/5 * * * *', 'select whatsapp.cache_janitor();');
select cron.schedule('cron_ingest_runs_minute',                   '* * * * *',   'select whatsapp._cron_ingest_cron_runs()');
select cron.schedule('prune_host_metrics_hourly',                 '17 * * * *',  'select whatsapp._cron_prune_host_metrics()');
select cron.schedule('snapshot_db_metrics_minute',                '* * * * *',   'select whatsapp._cron_snapshot_db_metrics()');
select cron.schedule('monitor_r2_prune_daily',                    '17 3 * * *',  'select whatsapp._cron_prune_r2_metrics()');
select cron.schedule('consolidate_split_conversations',           '* * * * *',   'SELECT whatsapp._cron_consolidate_split_conversations()');
select cron.schedule('purge-metric-samples',                      '17 3 * * *',  'select whatsapp._cron_purge_metric_samples()');
