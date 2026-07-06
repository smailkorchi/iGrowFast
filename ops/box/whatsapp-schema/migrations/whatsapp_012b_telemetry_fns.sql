-- whatsapp_012b_telemetry_fns.sql  (Wave 12b) — 9 telemetry ingest/snapshot/cache fns
-- 8 ported via workflow (wf_5189c085-d9b); ingest_r2_metrics hand-ported (its workflow agent hit a
-- connection error). check_function_bodies=off for order-independence.
set check_function_bodies = off;


CREATE OR REPLACE FUNCTION whatsapp.ingest_system_logs(p_entries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  insert into whatsapp.system_logs
    (occurred_at, source, level, event, worker_id, instance_id, conversation_id, actor_uid, target_type, target_id, payload)
  select
    coalesce((e->>'occurred_at')::timestamptz, now()),
    case when e->>'source' in ('worker','edge','cron','db','evolution','caddy','redis','client') then (e->>'source')::whatsapp.log_source else 'worker' end,
    case when e->>'level' in ('debug','info','warn','error') then (e->>'level')::whatsapp.log_level else 'info' end,
    coalesce(nullif(e->>'event', ''), 'unknown'),
    nullif(e->>'worker_id', ''),
    case when e->>'instance_id'     ~ '^[0-9a-fA-F-]{36}$' then (e->>'instance_id')::uuid else null end,
    case when e->>'conversation_id' ~ '^[0-9a-fA-F-]{36}$' then (e->>'conversation_id')::uuid else null end,
    case when e->>'actor_uid'       ~ '^[0-9a-fA-F-]{36}$' then (e->>'actor_uid')::uuid else null end,
    nullif(e->>'target_type', ''),
    nullif(e->>'target_id', ''),
    coalesce(e->'payload', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as e;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$;
revoke all on function whatsapp.ingest_system_logs(jsonb) from public;
grant execute on function whatsapp.ingest_system_logs(jsonb) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.ingest_platform_logs(p_entries jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer;
begin
  insert into whatsapp.system_logs
    (occurred_at, source, level, event, target_type, target_id, platform_id, payload)
  select
    coalesce((e->>'occurred_at')::timestamptz, now()),
    case when e->>'source' in ('platform_api','platform_postgres','platform_auth','platform_storage','platform_realtime','platform_edge')
         then (e->>'source')::whatsapp.log_source else 'platform_api'::whatsapp.log_source end,
    case when e->>'level' in ('debug','info','warn','error') then (e->>'level')::whatsapp.log_level else 'info' end,
    coalesce(nullif(e->>'event',''),'platform'),
    'platform',
    nullif(e->>'target_id',''),
    nullif(e->>'platform_id',''),
    coalesce(e->'payload','{}'::jsonb)
  from jsonb_array_elements(coalesce(p_entries,'[]'::jsonb)) as e
  where nullif(e->>'platform_id','') is not null
  on conflict (source, platform_id) where platform_id is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;
revoke all on function whatsapp.ingest_platform_logs(jsonb) from public;
grant execute on function whatsapp.ingest_platform_logs(jsonb) to service_role;

CREATE OR REPLACE FUNCTION whatsapp.ingest_prom_metrics(p jsonb)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with ins as (
    insert into whatsapp.metric_samples (captured_at, source, name, labels, value)
    select now(),
           coalesce(e->>'source','prom'),
           e->>'name',
           coalesce(e->'labels','{}'::jsonb),
           (e->>'value')::double precision
    from jsonb_array_elements(coalesce(p->'rows','[]'::jsonb)) e
    where e->>'name' is not null
      and e->>'value' is not null
      and (e->>'value') !~* 'nan|inf'   -- guard non-finite (JSON null already excluded)
    returning 1
  )
  select count(*)::int from ins;
$function$;
REVOKE ALL ON FUNCTION whatsapp.ingest_prom_metrics(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.ingest_prom_metrics(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.ingest_host_metrics(p jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into whatsapp.host_metrics
    (cpu_pct,load1,load5,load15,cpu_cores,mem_total_mb,mem_used_mb,mem_avail_mb,
     swap_total_mb,swap_used_mb,disk_total_gb,disk_used_gb,disk_pct,net_rx_kbps,net_tx_kbps,uptime_sec,containers)
  values (
    (p->>'cpu_pct')::double precision,(p->>'load1')::double precision,(p->>'load5')::double precision,(p->>'load15')::double precision,
    (p->>'cpu_cores')::int,(p->>'mem_total_mb')::int,(p->>'mem_used_mb')::int,(p->>'mem_avail_mb')::int,
    (p->>'swap_total_mb')::int,(p->>'swap_used_mb')::int,(p->>'disk_total_gb')::double precision,(p->>'disk_used_gb')::double precision,
    (p->>'disk_pct')::double precision,(p->>'net_rx_kbps')::double precision,(p->>'net_tx_kbps')::double precision,
    (p->>'uptime_sec')::bigint, coalesce(p->'containers','[]'::jsonb));
$function$;
REVOKE ALL ON FUNCTION whatsapp.ingest_host_metrics(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.ingest_host_metrics(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_snapshot_db_metrics()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_hit double precision;
begin
  select case when sum(blks_hit+blks_read)>0 then round((sum(blks_hit)::numeric/sum(blks_hit+blks_read))*100,2) else null end
    into v_hit from pg_stat_database where datname = current_database();
  insert into whatsapp.db_metrics_history
    (source, db_size_bytes, conn_total, conn_active, conn_idle, conn_idle_in_txn, max_connections,
     cache_hit_pct, xact_commit, xact_rollback, tup_inserted, tup_updated, tup_deleted)
  select 'supabase',
    pg_database_size(current_database()),
    (select count(*) from pg_stat_activity where datname=current_database()),
    (select count(*) from pg_stat_activity where datname=current_database() and state='active'),
    (select count(*) from pg_stat_activity where datname=current_database() and state='idle'),
    (select count(*) from pg_stat_activity where datname=current_database() and state='idle in transaction'),
    current_setting('max_connections')::int,
    v_hit,
    d.xact_commit, d.xact_rollback, d.tup_inserted, d.tup_updated, d.tup_deleted
  from pg_stat_database d where d.datname=current_database();
  delete from whatsapp.db_metrics_history where captured_at < now() - interval '30 days';
end $function$;
REVOKE ALL ON FUNCTION whatsapp._cron_snapshot_db_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_snapshot_db_metrics() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_snapshot_worker_health()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into whatsapp.worker_health_history (captured_at, worker_id, active_numbers, queue_depth, dispatching_count, drain_rate_1m)
  select now(), worker_id, active_numbers, queue_depth, dispatching_count, drain_rate_1m
  from whatsapp.worker_health;
  delete from whatsapp.worker_health_history where captured_at < now() - interval '30 days';
end $function$;
REVOKE ALL ON FUNCTION whatsapp._cron_snapshot_worker_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_snapshot_worker_health() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp._cron_ingest_cron_runs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_last bigint; v_cap bigint; v_running bigint; v_count integer := 0; v_self bigint;
begin
  select jobid into v_self from cron.job where command like '%_cron_ingest_cron_runs%' limit 1;
  select last_runid into v_last from whatsapp._cron_ingest_state where id;
  if v_last is null then v_last := 0; end if;
  with finished as (
    select d.runid, d.jobid, j.jobname, d.status, d.return_message, d.start_time, d.end_time,
           round(extract(epoch from (d.end_time - d.start_time))*1000)::int as dur_ms
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where d.runid > v_last and d.end_time is not null and (v_self is null or d.jobid <> v_self)
  ),
  anomalies as ( select * from finished where status <> 'succeeded' or dur_ms > 5000 ),
  ins as (
    insert into whatsapp.system_logs (occurred_at, source, level, event, target_type, target_id, payload)
    select end_time, 'cron'::whatsapp.log_source,
      case when status <> 'succeeded' then 'error'::whatsapp.log_level else 'warn'::whatsapp.log_level end,
      case when status <> 'succeeded' then 'cron.job_failed' else 'cron.job_slow' end,
      'cron_job', jobname,
      jsonb_build_object('jobname',jobname,'jobid',jobid,'runid',runid,'status',status,'duration_ms',dur_ms,
        'message', case when return_message is null then null else
          left(regexp_replace(regexp_replace(regexp_replace(return_message,
            '[0-9]{6,}@[a-z0-9._-]+','[jid]','gi'), '[0-9]{8,}','[redacted]','g'),
            '@(s\.whatsapp\.net|g\.us|lid)','@[redacted]','g'), 500) end)
    from anomalies returning 1
  )
  select count(*) into v_count from ins;
  select min(runid) into v_running from cron.job_run_details where end_time is null and (v_self is null or jobid <> v_self);
  if v_running is not null then v_cap := v_running - 1;
  else select max(runid) into v_cap from cron.job_run_details where end_time is not null and (v_self is null or jobid <> v_self); end if;
  if v_cap is not null and v_cap > v_last then update whatsapp._cron_ingest_state set last_runid = v_cap where id; end if;
  return v_count;
end $function$;
REVOKE ALL ON FUNCTION whatsapp._cron_ingest_cron_runs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp._cron_ingest_cron_runs() TO service_role;

CREATE OR REPLACE FUNCTION whatsapp.cache_get_or_compute(p_key text, p_fresh interval, p_stale interval, p_compute regprocedure, p_args jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  CACHE_CLASSID constant int := 1667327336; -- x'63616368' 'cach' (distinct from audit chain ns)
  XFETCH_BETA constant double precision := 1.0;
  v_fn text := (p_compute::oid::regproc)::text; -- bare schema-qualified name, no arg types
  r whatsapp.app_cache%rowtype; v_payload jsonb; v_t0 timestamptz; v_delta_ms integer;
  v_now timestamptz := clock_timestamp(); v_xfetch_due boolean := false;
begin
  set local statement_timeout = '8s';
  select * into r from whatsapp.app_cache where cache_key = p_key;
  if found and v_now < r.hard_until then
    if v_now < r.fresh_until then
      v_xfetch_due := (extract(epoch from (v_now - r.fresh_until)) * 1000.0
                        + r.delta_ms * XFETCH_BETA * (- ln(random()))) >= 0;
      if not v_xfetch_due then return r.payload; end if;
    end if;
    if pg_try_advisory_xact_lock(CACHE_CLASSID, hashtext(p_key)) then
      select * into r from whatsapp.app_cache where cache_key = p_key;
      if v_now < r.fresh_until and not v_xfetch_due then return r.payload; end if;
      begin
        v_t0 := clock_timestamp();
        execute format('select %s($1)', v_fn) into v_payload using p_args;
        v_delta_ms := (extract(epoch from clock_timestamp() - v_t0) * 1000)::int;
        insert into whatsapp.app_cache(cache_key,payload,computed_at,fresh_until,hard_until,delta_ms)
        values (p_key, v_payload, now(), now()+p_fresh, now()+p_stale, v_delta_ms)
        on conflict (cache_key) do update set payload=excluded.payload, computed_at=excluded.computed_at,
          fresh_until=excluded.fresh_until, hard_until=excluded.hard_until, delta_ms=excluded.delta_ms;
        return v_payload;
      exception when others then
        if r.payload is not null then return r.payload; end if; raise;
      end;
    else
      return r.payload; -- SWR loser serves stale
    end if;
  end if;
  perform pg_advisory_xact_lock(CACHE_CLASSID, hashtext(p_key)); -- cold/hard-expired: blocking
  select * into r from whatsapp.app_cache where cache_key = p_key;
  if found and clock_timestamp() < r.hard_until then return r.payload; end if;
  begin
    v_t0 := clock_timestamp();
    execute format('select %s($1)', v_fn) into v_payload using p_args;
    v_delta_ms := (extract(epoch from clock_timestamp() - v_t0) * 1000)::int;
    insert into whatsapp.app_cache(cache_key,payload,computed_at,fresh_until,hard_until,delta_ms)
    values (p_key, v_payload, now(), now()+p_fresh, now()+p_stale, v_delta_ms)
    on conflict (cache_key) do update set payload=excluded.payload, computed_at=excluded.computed_at,
      fresh_until=excluded.fresh_until, hard_until=excluded.hard_until, delta_ms=excluded.delta_ms;
    return v_payload;
  exception when others then
    if r.payload is not null then return r.payload; end if; raise;
  end;
end $function$;
REVOKE ALL ON FUNCTION whatsapp.cache_get_or_compute(text, interval, interval, regprocedure, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp.cache_get_or_compute(text, interval, interval, regprocedure, jsonb) TO postgres;

-- hand-ported (workflow agent hit a connection error): ingest_r2_metrics
create or replace function whatsapp.ingest_r2_metrics(p_entries jsonb)
returns integer language plpgsql security definer set search_path to '' as $function$
declare v_count integer;
begin
  insert into whatsapp.r2_metrics (sampled_at, bucket, storage_bytes, object_count, class_a_ops, class_b_ops, egress_bytes, sample_ok, err)
  select coalesce((e->>'sampled_at')::timestamptz, now()), coalesce(nullif(e->>'bucket',''),'unknown'),
    (e->>'storage_bytes')::bigint,(e->>'object_count')::bigint,(e->>'class_a_ops')::bigint,
    (e->>'class_b_ops')::bigint,(e->>'egress_bytes')::bigint,
    coalesce((e->>'sample_ok')::boolean,true), nullif(e->>'err','')
  from jsonb_array_elements(coalesce(p_entries,'[]'::jsonb)) e;
  get diagnostics v_count = row_count;
  return v_count;
end $function$;
revoke all on function whatsapp.ingest_r2_metrics(jsonb) from public;
grant  execute on function whatsapp.ingest_r2_metrics(jsonb) to service_role;
