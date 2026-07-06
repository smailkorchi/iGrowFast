-- whatsapp_014a_cron_support.sql  (Wave 14a) — cache-warm/janitor support for cron jobs 9/10
-- TARGET: box .102 whatsapp ONLY. Discovery of WA Mancer's live cron.job list surfaced two jobs calling
-- private.cache_warm / private.cache_janitor, which pull in private.cache_quantize + the 6 _compute_* shims
-- not referenced by any 13b wrapper. Port all of it 1:1 (private.* -> whatsapp.*). INERT until scheduled.
-- Grants: sources are owner-only (postgres=X) except cache_quantize (had authenticated+service_role) — cron
-- runs as postgres, so owner-only is preserved; cache_quantize keeps its wider grant.

create or replace function whatsapp.cache_quantize(p_ts timestamp with time zone, p_bucket text)
returns timestamp with time zone language sql immutable set search_path to '' as $function$
  select (date_trunc(case when p_bucket in ('hour','day','week') then p_bucket else 'day' end,
            p_ts at time zone 'Africa/Casablanca') at time zone 'Africa/Casablanca');
$function$;
revoke all on function whatsapp.cache_quantize(timestamptz, text) from public;
grant  execute on function whatsapp.cache_quantize(timestamptz, text) to authenticated, service_role;

-- ---- the 6 _compute_* shims not ported in 13b (cache_warm references all 10) ----
create or replace function whatsapp._compute_stats_fleet(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$ select whatsapp.stats_fleet_impl() $function$;
create or replace function whatsapp._compute_stats_overview(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$
  select whatsapp.stats_overview_impl((p_args->>'from')::timestamptz,(p_args->>'to')::timestamptz,
    nullif(p_args->>'instance','')::uuid)
$function$;
create or replace function whatsapp._compute_stats_breakdowns(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$
  select whatsapp.stats_breakdowns_impl((p_args->>'from')::timestamptz,(p_args->>'to')::timestamptz,
    nullif(p_args->>'instance','')::uuid)
$function$;
create or replace function whatsapp._compute_stats_heatmap(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('dow',t.dow,'hour',t.hour,'inbound',t.inbound,'outbound',t.outbound) order by t.dow,t.hour),'[]'::jsonb)
  from whatsapp.stats_heatmap_impl((p_args->>'from')::timestamptz,(p_args->>'to')::timestamptz,
         nullif(p_args->>'instance','')::uuid) t;
$function$;
create or replace function whatsapp._compute_stats_by_agent(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('agent_uid',t.agent_uid,'label',t.label,'avatar',t.avatar,
           'sent',t.sent,'delivered',t.delivered,'read_cnt',t.read_cnt,'convos',t.convos,'reply_p50_sec',t.reply_p50_sec)
           order by t.sent desc, t.agent_uid),'[]'::jsonb)
  from whatsapp.stats_by_agent_impl((p_args->>'from')::timestamptz,(p_args->>'to')::timestamptz,
         nullif(p_args->>'instance','')::uuid) t;
$function$;
create or replace function whatsapp._compute_stats_message_series(p_args jsonb)
returns jsonb language sql security definer set search_path to '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('bucket',t.bucket,'inbound',t.inbound,'outbound',t.outbound) order by t.bucket),'[]'::jsonb)
  from whatsapp.stats_message_series_impl((p_args->>'from')::timestamptz,(p_args->>'to')::timestamptz,
         coalesce(p_args->>'bucket','day'), nullif(p_args->>'instance','')::uuid) t;
$function$;
revoke all on function whatsapp._compute_stats_fleet(jsonb) from public;
revoke all on function whatsapp._compute_stats_overview(jsonb) from public;
revoke all on function whatsapp._compute_stats_breakdowns(jsonb) from public;
revoke all on function whatsapp._compute_stats_heatmap(jsonb) from public;
revoke all on function whatsapp._compute_stats_by_agent(jsonb) from public;
revoke all on function whatsapp._compute_stats_message_series(jsonb) from public;

-- ---- cache_warm (cron job 9, every 30s) ----
create or replace function whatsapp.cache_warm()
returns void language plpgsql security definer set search_path to '' as $function$
declare
  rng record; v_b text; v_from timestamptz; v_to timestamptz; v_ef bigint; v_et bigint;
begin
  if to_regclass('whatsapp.app_cache') is null then return; end if;
  perform whatsapp.cache_get_or_compute('stats_fleet:v1', interval '20 seconds', interval '90 seconds',
    'whatsapp._compute_stats_fleet(jsonb)'::regprocedure, '{}'::jsonb);
  perform whatsapp.cache_get_or_compute('dashboard_overview:activity', interval '15 seconds', interval '45 seconds',
    'whatsapp._compute_dashboard_activity(jsonb)'::regprocedure, '{}'::jsonb);
  for rng in select * from (values
      (interval '24 hours','hour'), (interval '7 days','day'),
      (interval '30 days','day'),  (interval '90 days','week')) as t(span, bkt)
  loop
    v_b := rng.bkt;
    v_from := whatsapp.cache_quantize(now() - rng.span, v_b);
    v_to := whatsapp.cache_quantize(now(), v_b)
      + case v_b when 'hour' then interval '1 hour' when 'week' then interval '1 week' else interval '1 day' end;
    v_ef := extract(epoch from v_from)::bigint; v_et := extract(epoch from v_to)::bigint;
    -- scalar / no-bucket-in-key fns (key = from:to:instance)
    perform whatsapp.cache_get_or_compute(format('stats_overview:v1:%s:%s:*', v_ef, v_et),
      interval '30 seconds', interval '120 seconds', 'whatsapp._compute_stats_overview(jsonb)'::regprocedure,
      jsonb_build_object('from',v_from,'to',v_to,'instance',null));
    perform whatsapp.cache_get_or_compute(format('stats_breakdowns:v1:%s:%s:*', v_ef, v_et),
      interval '30 seconds', interval '120 seconds', 'whatsapp._compute_stats_breakdowns(jsonb)'::regprocedure,
      jsonb_build_object('from',v_from,'to',v_to,'instance',null));
    perform whatsapp.cache_get_or_compute(format('stats_heatmap:v1:%s:%s:*', v_ef, v_et),
      interval '60 seconds', interval '300 seconds', 'whatsapp._compute_stats_heatmap(jsonb)'::regprocedure,
      jsonb_build_object('from',v_from,'to',v_to,'instance',null));
    perform whatsapp.cache_get_or_compute(format('stats_by_agent:v1:%s:%s:*', v_ef, v_et),
      interval '60 seconds', interval '300 seconds', 'whatsapp._compute_stats_by_agent(jsonb)'::regprocedure,
      jsonb_build_object('from',v_from,'to',v_to,'instance',null));
    -- series fns (key includes bucket)
    perform whatsapp.cache_get_or_compute(format('stats_message_series:v1:%s:%s:%s:*', v_b, v_ef, v_et),
      interval '60 seconds', interval '300 seconds', 'whatsapp._compute_stats_message_series(jsonb)'::regprocedure,
      jsonb_build_object('from',v_from,'to',v_to,'bucket',v_b,'instance',null));
    perform whatsapp.cache_get_or_compute(format('stats_latency_series:v1:%s:%s:%s:*', v_b, v_ef, v_et),
      interval '60 seconds', interval '300 seconds', 'whatsapp._compute_stats_latency_series(jsonb)'::regprocedure,
      jsonb_build_object('from',v_from,'to',v_to,'bucket',v_b,'instance',null));
    perform whatsapp.cache_get_or_compute(format('stats_worker_series:v1:%s:%s:%s', v_b, v_ef, v_et),
      interval '60 seconds', interval '300 seconds', 'whatsapp._compute_stats_worker_series(jsonb)'::regprocedure,
      jsonb_build_object('from',v_from,'to',v_to,'bucket',v_b));
  end loop;
end $function$;
revoke all on function whatsapp.cache_warm() from public;

-- ---- cache_janitor (cron job 10, */5) ----
-- NOTE: prunes cron.job_run_details older than 7 days — that table is SHARED with iGrowFast's own crons.
-- iGrowFast has no other job_run_details pruner (verified before apply), so a single 7-day retention is fine.
create or replace function whatsapp.cache_janitor()
returns void language plpgsql security definer set search_path to '' as $function$
begin
  if to_regclass('whatsapp.app_cache') is not null then
    delete from whatsapp.app_cache where hard_until < now() - interval '1 hour';
  end if;
  if to_regclass('whatsapp.og_cache') is not null then
    delete from whatsapp.og_cache where fresh_until < now() - interval '7 days';
  end if;
  delete from cron.job_run_details where end_time < now() - interval '7 days';
end $function$;
revoke all on function whatsapp.cache_janitor() from public;
