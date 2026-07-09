-- whatsapp_044_biz_topic_authz.sql
-- Enterprise-scale plan PHASE 0 (broadcast foundation) — authorization ONLY, no
-- emitters, no behavior change. Adds the wa:biz:<business_id> private-broadcast
-- topic family so later phases can:
--   • collapse the admin inbox's N-per-instance wa:inst channels into ONE
--     wa:biz channel (W5 — fixes the ~93-instances/tab channel wall), and
--   • carry the business-scoped conversation bump (W4-B2) and quick_replies (W1).
--
-- Mirrors migration 035's wa:inst pattern EXACTLY: a SECURITY INVOKER regex-gated
-- predicate fn (search_path '', owner postgres, execute to authenticated+service_role)
-- + a SELECT policy on realtime.messages TO authenticated. A wa:biz topic is
-- readable ONLY by a business ADMIN of that same business (agents keep wa:user).
-- current_user_is_business_admin()/current_user_digicom_business_id() are the
-- existing public SECDEF helpers (role IN ('super admin','admin'); users."DigiCom
-- Business").
--
-- wa:node:<node_id> (the worker control-plane / wake topic built in a later phase)
-- needs NO policy here: service_role has rolbypassrls=true (worker reads by bypass)
-- and authenticated/anon are denied by default (no matching topic policy) — exactly
-- "service-role only". Documented, intentionally no DDL.
--
-- FROZEN bump-payload envelope (convention for W4/W5, enforced in later migs, no DDL
-- here): id, instance_id, last_message_at, last_message_preview_ct, last_message_kind,
-- last_message_direction, last_message_sender_name, last_message_media_meta,
-- unread_count, is_archived, is_pinned, status, snoozed_until, resolved_at, is_group,
-- last_outbound_status, contact_id, peer_display_name, peer_profile_pic.
--
-- Reversible: drop policy wa_biz_broadcast_read; drop function can_read_biz_topic.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- Business-scoped topic read predicate. SECURITY INVOKER (runs as the querying
-- authenticated role; resolves the caller via the public helpers' auth.uid()).
create or replace function whatsapp.can_read_biz_topic(p_topic text)
returns boolean language sql stable security invoker set search_path to '' as $function$
  select case
    when p_topic ~ '^wa:biz:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.current_user_is_business_admin()
       and substring(p_topic from 8)::uuid = public.current_user_digicom_business_id()
    else false
  end;
$function$;
revoke all on function whatsapp.can_read_biz_topic(text) from public;
grant  execute on function whatsapp.can_read_biz_topic(text) to authenticated, service_role;
alter function whatsapp.can_read_biz_topic(text) owner to postgres;

-- Read policy on the broadcast table (mirrors wa_inst_broadcast_read).
drop policy if exists wa_biz_broadcast_read on realtime.messages;
create policy wa_biz_broadcast_read on realtime.messages
  for select to authenticated
  using (whatsapp.can_read_biz_topic(realtime.topic()));

commit;
