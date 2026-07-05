-- whatsapp_010a_decrypt_views  (Wave 10a) — decrypt fns + 3 security_invoker views
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Ports the decrypt wrappers + decrypted views with three deliberate changes:
--   * SECURITY FIX: WA Mancer's decrypt gate bypasses on current_user IN ('postgres','service_role',...),
--     but inside a SECDEF-owned-by-postgres fn current_user is ALWAYS postgres -> the JWT gate is dead and
--     a direct call by any authenticated user decrypts ANY message. Re-gate on auth.uid(): NULL = trusted
--     server-side (worker/cron/service_role via pooler, no JWT) -> decrypt; non-NULL = JWT caller -> must be
--     is_wa_admin(instance) OR assigned agent, else NULL. Closes the direct-call hole; the security_invoker
--     views still RLS-gate which rows are visible.
--   * key_id seam (plan §6.4): decrypt reads each row's key_id and passes it to decrypt_text.
--   * W2: the source views grant full DML to anon/authenticated/service_role -> tighten to SELECT for
--     authenticated+service_role only (anon has no schema usage regardless).

create or replace function whatsapp._decrypt_message_body(p_message_id uuid)
returns text language plpgsql stable security definer set search_path to '' as $function$
declare v_ct bytea; v_conv uuid; v_key_id smallint; v_instance uuid;
begin
  select body_ciphertext, conversation_id, key_id, instance_id
    into v_ct, v_conv, v_key_id, v_instance
    from whatsapp.messages where id = p_message_id;
  if v_ct is null then return null; end if;
  if auth.uid() is null then                                   -- trusted server-side (no JWT)
    return whatsapp.decrypt_text(v_ct, v_key_id);
  end if;
  if not (whatsapp.is_wa_admin(v_instance) or exists (         -- JWT caller: admin-of-instance or assigned
    select 1 from whatsapp.conversation_assignments ca
     where ca.conversation_id = v_conv and ca.user_id = auth.uid())) then
    return null;
  end if;
  return whatsapp.decrypt_text(v_ct, v_key_id);
end
$function$;

create or replace function whatsapp._decrypt_conv_preview(p_conversation_id uuid)
returns text language plpgsql stable security definer set search_path to '' as $function$
declare v_ct bytea; v_key_id smallint; v_instance uuid;
begin
  select last_message_preview_ct, key_id, instance_id
    into v_ct, v_key_id, v_instance
    from whatsapp.conversations where id = p_conversation_id;
  if v_ct is null then return null; end if;
  if auth.uid() is null then
    return whatsapp.decrypt_text(v_ct, v_key_id);
  end if;
  if not (whatsapp.is_wa_admin(v_instance) or exists (
    select 1 from whatsapp.conversation_assignments ca
     where ca.conversation_id = p_conversation_id and ca.user_id = auth.uid())) then
    return null;
  end if;
  return whatsapp.decrypt_text(v_ct, v_key_id);
end
$function$;

revoke all on function whatsapp._decrypt_message_body(uuid) from public;
grant  execute on function whatsapp._decrypt_message_body(uuid) to authenticated, service_role;
revoke all on function whatsapp._decrypt_conv_preview(uuid) from public;
grant  execute on function whatsapp._decrypt_conv_preview(uuid) to authenticated, service_role;

-- ============================================================ 3 security_invoker views
create view whatsapp.messages_decrypted with (security_invoker=true) as
 select id, conversation_id, instance_id, evolution_message_id, direction, kind,
   whatsapp._decrypt_message_body(id) as body,
   media_meta, reply_to_message_id, sender_jid, whatsapp_timestamp, delivery_status, created_at,
   reactions, forwarded, forwarding_score, is_starred, sent_by_agent_id,
   media_storage_bucket, media_storage_key, media_pending, media_size_bytes, media_mime,
   media_uploaded_at, media_failed_at, edited_at, revoked_at, revoked_by,
   is_pinned, pinned_at, pinned_by, pin_expires_at
 from whatsapp.messages m
 where not coalesce((select auth.uid()) = any (hidden_for_user_ids), false);

create view whatsapp.conversations_decrypted with (security_invoker=true) as
 select c.id, c.instance_id, c.remote_jid, c.is_group, c.peer_display_name, c.peer_profile_pic,
   c.last_message_at, whatsapp._decrypt_conv_preview(c.id) as last_message_preview,
   c.last_message_kind, c.last_message_direction, c.last_message_sender_name, c.last_message_media_meta,
   c.unread_count, c.is_archived, c.is_pinned, c.status, c.snoozed_until, c.resolved_at, c.resolved_by,
   c.created_at, c.updated_at, c.last_inbound_at, c.last_outbound_at, c.contact_id,
   ct.book_name as contact_book_name, c.last_outbound_status, c.left_at
 from whatsapp.conversations c
 left join whatsapp.contacts ct on ct.id = c.contact_id
 where c.merged_into is null and c.remote_jid !~~ '%@lid';

create view whatsapp.worker_health_status with (security_invoker=true) as
 select worker_id, hostname, version, started_at, last_heartbeat_at, active_numbers, queue_depth,
   dispatching_count, drain_rate_1m, last_dispatch_at, notes,
   extract(epoch from now() - last_heartbeat_at)::integer as seconds_since_heartbeat,
   case when last_heartbeat_at > (now() - interval '00:00:15') then 'healthy'
        when last_heartbeat_at > (now() - interval '00:01:00') then 'stale'
        else 'dead' end as health
 from whatsapp.worker_health w;

grant select on whatsapp.messages_decrypted      to authenticated, service_role;
grant select on whatsapp.conversations_decrypted to authenticated, service_role;
grant select on whatsapp.worker_health_status    to authenticated, service_role;
