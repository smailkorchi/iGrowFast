-- R1b — logistics singles → broadcast (W7, MASTER_TODO §1).
--
-- Ports the last e-commerce postgres_changes consumers except campaign_source_locks (R1c):
--
--   'webhook'      — public.webhook_logs INSERT → ecom:biz:<business_id>, payload {op,id}.
--                    Consumer: useWebhookHealth live pulse (payload unused beyond arrival).
--                    INSERT-only (parity with the retired binding); UPDATE/DELETE churn
--                    (processed flips + prune job) emits nothing.
--
--   'notification' — public.courier_notifications INSERT → NEW private topic family
--                    ecom:user:<user_id> (mirrors wa:user), payload = the full row
--                    (title/body/target_url/type/payload — the courier toast + SW
--                    notification render from it, zero follow-up queries).
--                    READ policy: strictly auth.uid() = the topic's uuid — a courier
--                    can only join their own feed (the retired binding relied on a
--                    client-side filter + RLS).
--
--   tracking_sync_runs: NO broadcast. Its two postgres_changes bindings are DEAD
--   TODAY — the table's only SELECT policy is owner-only (tracking_sync_runs_owner_read),
--   so WALRUS delivers zero events to the admins/sellers who mount the pill, and
--   owners never visit those pages (owner confinement). The FE bindings are deleted
--   as dead code; making the pill live for admins is a PRODUCT decision logged in
--   MASTER_TODO (needs an ops topic or an RLS ruling), not smuggled into this port.
--
-- All emitters: SECURITY DEFINER, empty search_path, exception-swallowed (a
-- broadcast hiccup must NEVER roll back the business write), NULL-scope skipped.
--
-- Reversible: drop the triggers + functions + policy + authz fn.
--
-- Apply: ~/.igrowfast/db.sh < this file   (dry-run first with COMMIT→ROLLBACK)

begin;

-- ── ecom:user:<user_id> topic family (mirrors wa:user) ───────────────────────
create or replace function public.can_read_ecom_user_topic(p_topic text)
returns boolean
language sql
stable
security invoker
set search_path to ''
as $function$
  select case
    when p_topic ~ '^ecom:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(p_topic from 11)::uuid = (select auth.uid())
    else false
  end;
$function$;
revoke all on function public.can_read_ecom_user_topic(text) from public, anon;
grant execute on function public.can_read_ecom_user_topic(text) to authenticated;
alter function public.can_read_ecom_user_topic(text) owner to postgres;

drop policy if exists ecom_user_broadcast_read on realtime.messages;
create policy ecom_user_broadcast_read on realtime.messages
  for select to authenticated
  using (public.can_read_ecom_user_topic(realtime.topic()));

-- ── webhook_logs: INSERT pulse on ecom:biz ───────────────────────────────────
create or replace function public.broadcast_webhook_log()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    if new."DigiCom Business" is not null then
      perform realtime.send(
        jsonb_build_object('op', tg_op, 'id', new.id::text),
        'webhook',
        'ecom:biz:' || new."DigiCom Business"::text,
        true
      );
    end if;
  exception when others then
    null;  -- never roll back a webhook write
  end;
  return new;
end;
$function$;
alter function public.broadcast_webhook_log() owner to postgres;

drop trigger if exists trg_broadcast_webhook_log on public.webhook_logs;
create trigger trg_broadcast_webhook_log
  after insert on public.webhook_logs
  for each row execute function public.broadcast_webhook_log();

-- ── courier_notifications: INSERT → the courier's own ecom:user feed ─────────
create or replace function public.broadcast_courier_notification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    if new.courier_id is not null then
      perform realtime.send(
        to_jsonb(new),
        'notification',
        'ecom:user:' || new.courier_id::text,
        true
      );
    end if;
  exception when others then
    null;  -- never roll back a notification write
  end;
  return new;
end;
$function$;
alter function public.broadcast_courier_notification() owner to postgres;

drop trigger if exists trg_broadcast_courier_notification on public.courier_notifications;
create trigger trg_broadcast_courier_notification
  after insert on public.courier_notifications
  for each row execute function public.broadcast_courier_notification();

-- NOTE: the publication drop of the 3 tables is deliberately NOT here — it is
-- the separate tail migration 20260714180000, applied only AFTER this batch's
-- FE deploy at verified zero live realtime.subscription rows (the R1a
-- ordering discipline: additive DB → FE deploy → drop).

commit;
