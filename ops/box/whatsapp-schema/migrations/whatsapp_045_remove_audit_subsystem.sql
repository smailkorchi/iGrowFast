-- whatsapp_045_remove_audit_subsystem.sql
-- Enterprise-scale plan PHASE 1b (W4-A), owner ruling 2026-07-09: the whatsapp
-- audit_log tamper-evidence subsystem is NOT wanted. Removing it entirely — rather
-- than de-serializing its hash chain — deletes THREE scale problems at once with
-- ZERO trade-off (no feature to preserve):
--   • the fleet-global pg_advisory_xact_lock('audit_log_chain') held across every
--     audit-carrying RPC (incl. queue_mark_sent on EVERY send) — the dominant
--     send-completion serializer at scale;
--   • the per-conversation-update write amplification into audit_log;
--   • the unbounded, unpartitioned, append-forever table growth.
--
-- Blast radius (verified live): the ONLY functional reader was
-- _cron_lifecycle_auto_promote (reads 'message.dead' events to gate 30-day warmup
-- promotion) — owner parked warmup to build properly later, so the cron is removed
-- too. No frontend consumer (no .rpc('admin_audit_chain_status') anywhere in src/;
-- only a stale unused entry in generated database.types.ts, harmless, drops on next
-- type regen). 35 RPCs WRITE via whatsapp.audit() and discard the result → audit()
-- is kept as a NO-OP stub so all 35 call sites keep working untouched (deleting the
-- calls would be 35-live-RPC surgery for zero gain; the no-op already removes the
-- lock + all cost).
--
-- Reversible only from migration history (this DROPs data). The audit_log rows are
-- an internal ops log the owner does not need; not backed up separately here.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- 1. audit() → no-op FIRST, so nothing inserts into audit_log once we drop it.
--    Same signature (35 callers PERFORM it and discard the bigint). Cheap SQL stub.
create or replace function whatsapp.audit(
  p_event_type text,
  p_target_type text default null,
  p_target_id text default null,
  p_payload jsonb default '{}'::jsonb
) returns bigint language sql as $function$
  select null::bigint;  -- audit trail removed 2026-07-09 (owner ruling); no-op retained for callers
$function$;

-- 2. Remove the warmup lifecycle auto-promote cron + its function (its ONLY data
--    source was audit_log 'message.dead'; warmup is parked to build properly).
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'lifecycle_auto_promote_daily';
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;
drop function if exists whatsapp._cron_lifecycle_auto_promote();

-- 3. Drop the chain-validation surface (no callers besides each other).
drop function if exists whatsapp.admin_audit_chain_status(integer);
drop function if exists whatsapp.validate_audit_chain(integer);

-- 4. Drop the hash trigger + its function, then the table (cascades the owned
--    sequence, 5 indexes, and the RLS policy audit_log_admin_select).
drop trigger if exists audit_log_hash_t on whatsapp.audit_log;
drop function if exists whatsapp._audit_log_hash();
drop table if exists whatsapp.audit_log;

commit;
