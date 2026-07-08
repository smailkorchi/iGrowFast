-- whatsapp_022_audit_noise_trim.sql — sweep wave 2 (owner go 2026-07-08)
--
-- audit_log is append-only forever (hash chain) — so what ENTERS it must earn
-- permanence. Two trims + one relocation:
--
-- 1. BULK assignment ops write ONE summary row instead of one row per
--    conversation (measured: conversation_assigned = 2,076 rows = 48% of the
--    chain in 2 days, from backlog auto-assign + Assignment-page bulk ops).
--    Mechanism: txn-local GUC whatsapp.audit_assign_suppress checked by the
--    assignment trigger; the three bulk RPCs set it and write their own
--    summary. Single assign/unassign (chat header) still audits per row.
--    _auto_assign_on_inbound (one row per NEW conversation) is untouched.
--
-- 2. worker_heartbeat_stale leaves the chain entirely: pg_cron job 38 dropped.
--    A dead worker wrote 1 undeletable chain row/min (weekend outage = 2,880
--    rows) that no page ever showed. Replaced by BOX-LEVEL alerting:
--    /etc/cron.d/igf-wa-worker-alert on the .102 box → igf-alert.sh email on
--    stale (>120s) + recovery, one alert per outage (state file, tmpfs).
--
-- 3. media_access removed at the source (media-sign edge fn, same deploy):
--    one chain row per attachment render. media_upload_url_issued stays.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

-- ── 1a. trigger: honor the suppress flag ────────────────────────────────────
create or replace function whatsapp._on_conversation_assignment_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Bulk ops (backlog auto-assign, Assignment-page bulk assign/unassign) set
  -- this txn-local flag and write one summary audit row themselves.
  if coalesce(current_setting('whatsapp.audit_assign_suppress', true), '') = '1' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;
  if TG_OP = 'INSERT' then
    perform whatsapp.audit('conversation_assigned','conversation',NEW.conversation_id::text, jsonb_build_object('user_id',NEW.user_id));
    return NEW;
  elsif TG_OP = 'DELETE' then
    perform whatsapp.audit('conversation_unassigned','conversation',OLD.conversation_id::text, jsonb_build_object('user_id',OLD.user_id));
    return OLD;
  end if;
  return NEW;
end;
$function$;

-- ── 1b. backlog auto-assign: suppress per-row (summary event already exists) ─
create or replace function whatsapp.admin_apply_auto_assign_backlog(p_instance_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_inst     whatsapp.whatsapp_instances;
  v_user_id  uuid;
  v_count    integer := 0;
  v_conv_id  uuid;
begin
  if not whatsapp.is_wa_admin(p_instance_id) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  select * into v_inst from whatsapp.whatsapp_instances where id = p_instance_id;
  if not found then
    raise exception 'instance_not_found' using errcode = 'P0002';
  end if;
  if not v_inst.auto_assign_enabled
     or array_length(v_inst.auto_assign_user_pool, 1) is null then
    return 0;
  end if;

  -- audit trim (022): one auto_assign_backlog_applied summary row below, not
  -- one conversation_assigned row per backlog conversation.
  perform set_config('whatsapp.audit_assign_suppress', '1', true);

  for v_conv_id in
    select c.id
      from whatsapp.conversations c
      left join whatsapp.contacts ct                 on ct.id = c.contact_id
      left join whatsapp.conversation_assignments ca on ca.conversation_id = c.id
     where c.instance_id = p_instance_id
       and c.is_group    = false
       and c.is_archived = false
       and c.status in ('open','pending')
       and ca.conversation_id is null
       and c.remote_jid not like '%@broadcast'
       and c.remote_jid not like '%@newsletter'
       and (
         c.remote_jid like '%@s.whatsapp.net'
         or ct.book_name is not null
       )
     order by c.last_message_at asc nulls last
  loop
    select u.id into v_user_id
    from public.users u
    left join whatsapp.agent_assign_cursor ac on ac.user_id = u.id
    where u.id = any (v_inst.auto_assign_user_pool)
      and coalesce(u.active, true) = true
      and u.role = 'commercial'
      and u."DigiCom Business" = v_inst.business_id
      and exists (select 1 from auth.users a where a.id = u.id)
    order by coalesce(ac.last_auto_assigned_at, 'epoch'::timestamptz) asc, u.id asc
    limit 1;

    exit when v_user_id is null;

    insert into whatsapp.conversation_assignments (conversation_id, user_id, assigned_by, is_group)
    values (v_conv_id, v_user_id, v_user_id, false)
    on conflict do nothing;

    insert into whatsapp.agent_assign_cursor (user_id, last_auto_assigned_at)
    values (v_user_id, now())
    on conflict (user_id) do update set last_auto_assigned_at = now();

    v_count := v_count + 1;
  end loop;

  perform whatsapp.audit(
    'auto_assign_backlog_applied', 'whatsapp_instance', p_instance_id::text,
    jsonb_build_object('count', v_count)
  );

  return v_count;
end;
$function$;

-- ── 1c. Assignment-page bulk assign: suppress per-row + one summary ─────────
create or replace function whatsapp.admin_assign_conversations(p_user_id uuid, p_conversation_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE v_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM whatsapp.conversations c
    WHERE c.id = ANY (p_conversation_ids)
      AND NOT whatsapp.is_wa_admin(c.instance_id)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;
  PERFORM set_config('whatsapp.audit_assign_suppress', '1', true);
  WITH ins AS (
    INSERT INTO whatsapp.conversation_assignments (conversation_id, user_id, assigned_by)
    SELECT unnest(p_conversation_ids), p_user_id, auth.uid()
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  IF v_count > 0 THEN
    PERFORM whatsapp.audit(
      'conversations_assigned_bulk', 'user', p_user_id::text,
      jsonb_build_object('count', v_count)
    );
  END IF;
  RETURN v_count;
END;
$function$;

-- ── 1d. Assignment-page bulk unassign: suppress per-row + one summary ───────
create or replace function whatsapp.admin_unassign_conversations(p_user_id uuid, p_conversation_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE v_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM whatsapp.conversations c
    WHERE c.id = ANY(p_conversation_ids)
      AND NOT whatsapp.is_wa_admin(c.instance_id)
  ) THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;
  PERFORM set_config('whatsapp.audit_assign_suppress', '1', true);
  WITH del AS (
    DELETE FROM whatsapp.conversation_assignments
    WHERE user_id = p_user_id AND conversation_id = ANY(p_conversation_ids)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;
  IF v_count > 0 THEN
    PERFORM whatsapp.audit(
      'conversations_unassigned_bulk', 'user', p_user_id::text,
      jsonb_build_object('count', v_count)
    );
  END IF;
  RETURN v_count;
END;
$function$;

-- ── 2. stale-heartbeat alerting leaves the chain (box cron replaces it) ─────
select cron.unschedule('worker_health_stale_alert_minute');
drop function whatsapp._cron_worker_health_alert();

commit;
