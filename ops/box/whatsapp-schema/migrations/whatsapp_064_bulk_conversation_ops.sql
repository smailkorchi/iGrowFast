-- whatsapp_064_bulk_conversation_ops.sql
--
-- BUG: the inbox only has per-conversation primitives (mark_conversation_read,
-- the conversation-cleanup edge fn for clear/delete). Instance-wide actions
-- ("tout marquer comme lu / non lu", "tout effacer", "tout supprimer") had no
-- server counterpart, so any client implementation would have to iterate the
-- rows it happens to have loaded: PostgREST-capped at 1000 rows, one round trip
-- per conversation, and silently PARTIAL on a busy instance. Bulk writes, like
-- counts, must live in the database (same ruling as whatsapp_058/060).
--
-- FIX: four set-based bulk RPCs — one instance, one call, one transaction:
--
--   conversations_mark_all_read(instance)   → unread_count = 0 on every unread
--     conversation the CALLER may act on. Gate: can_use_instance (the single
--     agent↔instance access primitive from whatsapp_059); scope: admin = every
--     conversation of the instance, agent = assigned-only (the
--     mark_conversation_read predicate, set-based). No visibility narrowing —
--     archived / resolved / tombstone unreads are stale badge sources and this
--     op exists to zero them.
--
--   conversations_mark_all_unread(instance) → unread_count = 1 on every read
--     conversation, restricted to what the operational list actually shows:
--     not archived, status open/pending, no merged tombstones / @lid / @broadcast
--     / @newsletter — the EXACT whatsapp_060 badge predicate, so right after the
--     call the "Non lues" pill equals the number of rows just marked (marking an
--     invisible row unread would plant phantom state instead). Same caller
--     scoping as mark_all_read.
--
--   conversations_clear_all(instance)       → set-based twin of
--     admin_conversation_clear: deletes the instance's outbound_queue rows and
--     messages (media_fetch_jobs CASCADE, reply_to is instance-local so the
--     single-statement delete stays consistent), then resets the denormalized
--     last_message_* / last_inbound / last_outbound / unread summary on each
--     conversation. Conversation rows, assignments, tags and notes survive.
--     Admin-gated (is_wa_admin) because its per-conversation twin is
--     (is_wa_admin_conv).
--
--   conversations_delete_all(instance)      → set-based twin of the
--     conversation-cleanup 'delete' mode (admin RLS DELETE): drops every
--     conversation row of the instance; FK CASCADE wipes messages, assignments,
--     notes, tags, outbound_queue and scheduled_messages. Admin-gated.
--
-- Live-sync: the conversations_broadcast_bump / _delete row triggers fire per
-- changed row, so every open client (admin wa:biz feed + assigned sellers'
-- wa:user feeds) converges with no client refetch; the bump trigger skips
-- unchanged and invisible rows, so broadcast fan-out is bounded by the rows
-- actually flipped — and every UPDATE here already only touches rows that
-- change (unread_count > 0 / = 0 / summary non-empty predicates).
--
-- OUT OF SCOPE — stays in the edge layer, exactly like the per-conversation
-- conversation-cleanup pipeline: the R2 media wipe and the worker purge_peer
-- broadcast. A bulk caller MUST run the R2 preflight + DeleteObjects BEFORE
-- conversations_clear_all / conversations_delete_all, or the deleted messages'
-- media objects orphan in the bucket.
--
-- NOTE: authenticated runs under statement_timeout = 8s. Ample for current
-- volumes (largest instance ≈ 1.4k conversations / 2.6k messages, all deletes
-- index-backed); a future huge-instance wipe belongs behind a service_role
-- edge fn, not a longer timeout here.
--
-- audit() is a retained no-op (owner ruling 2026-07-09); each bulk op still
-- emits ONE summary line — never one per row — matching the whatsapp_058
-- bulk-RPC convention.

begin;

-- ── 1. Tout marquer comme lu — admin: whole instance, agent: assigned-only ───
create or replace function whatsapp.conversations_mark_all_read(p_instance_id uuid)
  returns integer
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
  v_count integer;
begin
  if p_instance_id is null then raise exception 'invalid_input'; end if;
  if not coalesce(whatsapp.can_use_instance(p_instance_id), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_admin := coalesce(whatsapp.is_wa_admin(p_instance_id), false);

  update whatsapp.conversations c
     set unread_count = 0,
         updated_at   = now()
   where c.instance_id = p_instance_id
     and c.unread_count > 0
     and (v_admin or exists (
       select 1 from whatsapp.conversation_assignments ca
       where ca.conversation_id = c.id and ca.user_id = v_uid
     ));
  get diagnostics v_count = row_count;

  perform whatsapp.audit('conversation.bulk_mark_read', 'instance', p_instance_id::text,
    jsonb_build_object('conversations_updated', v_count));
  return v_count;
end;
$function$;

comment on function whatsapp.conversations_mark_all_read(uuid) is
  'Bulk "tout marquer comme lu": unread_count=0 on every unread conversation of the '
  'instance the caller may act on (admin=all, agent=assigned-only). Gate: '
  'can_use_instance. The bump trigger live-syncs every client per flipped row.';

-- ── 2. Tout marquer comme non lu — only rows the operational list shows ──────
create or replace function whatsapp.conversations_mark_all_unread(p_instance_id uuid)
  returns integer
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
  v_count integer;
begin
  if p_instance_id is null then raise exception 'invalid_input'; end if;
  if not coalesce(whatsapp.can_use_instance(p_instance_id), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_admin := coalesce(whatsapp.is_wa_admin(p_instance_id), false);

  -- Visibility predicate = whatsapp_060 badge/list contract: after this call the
  -- "Non lues" pill count equals exactly the number of rows marked here.
  update whatsapp.conversations c
     set unread_count = 1,
         updated_at   = now()
   where c.instance_id = p_instance_id
     and c.unread_count = 0
     and c.is_archived = false
     and c.status in ('open'::whatsapp.conversation_status, 'pending'::whatsapp.conversation_status)
     and c.merged_into is null
     and c.remote_jid not like '%@lid'
     and c.remote_jid not like '%@broadcast'
     and c.remote_jid not like '%@newsletter'
     and (v_admin or exists (
       select 1 from whatsapp.conversation_assignments ca
       where ca.conversation_id = c.id and ca.user_id = v_uid
     ));
  get diagnostics v_count = row_count;

  perform whatsapp.audit('conversation.bulk_mark_unread', 'instance', p_instance_id::text,
    jsonb_build_object('conversations_updated', v_count));
  return v_count;
end;
$function$;

comment on function whatsapp.conversations_mark_all_unread(uuid) is
  'Bulk "tout marquer comme non lu": unread_count=1 on every read conversation the '
  'operational list shows (not archived, open/pending, no tombstones/@lid/@broadcast/'
  '@newsletter — the whatsapp_060 badge predicate), scoped per caller (admin=all, '
  'agent=assigned-only). Gate: can_use_instance.';

-- ── 3. Tout effacer — set-based twin of admin_conversation_clear ─────────────
create or replace function whatsapp.conversations_clear_all(p_instance_id uuid)
  returns integer
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_queue_deleted integer;
  v_msg_deleted   integer;
  v_convs_reset   integer;
begin
  if p_instance_id is null then raise exception 'invalid_input'; end if;
  if not coalesce(whatsapp.is_wa_admin(p_instance_id), false) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  with d as (
    delete from whatsapp.outbound_queue oq
     using whatsapp.conversations c
     where c.id = oq.conversation_id
       and c.instance_id = p_instance_id
    returning 1
  )
  select count(*) into v_queue_deleted from d;

  -- messages.instance_id is denormalized per conversation, so this equals the
  -- conversation-set delete but rides messages_instance_ts_idx directly.
  with d as (
    delete from whatsapp.messages
     where instance_id = p_instance_id
    returning 1
  )
  select count(*) into v_msg_deleted from d;

  -- Same summary reset as admin_conversation_clear, restricted to rows that
  -- actually have something to reset (no dead-row churn, no no-op trigger work).
  update whatsapp.conversations
     set last_message_at          = null,
         last_message_preview_ct  = null,
         last_message_kind        = null,
         last_message_direction   = null,
         last_message_sender_name = null,
         last_message_media_meta  = null,
         last_inbound_at          = null,
         last_outbound_at         = null,
         unread_count             = 0,
         updated_at               = now()
   where instance_id = p_instance_id
     and (last_message_at is not null
       or last_message_preview_ct is not null
       or last_message_kind is not null
       or last_message_direction is not null
       or last_message_sender_name is not null
       or last_message_media_meta is not null
       or last_inbound_at is not null
       or last_outbound_at is not null
       or unread_count <> 0);
  get diagnostics v_convs_reset = row_count;

  perform whatsapp.audit('conversation.bulk_clear', 'instance', p_instance_id::text,
    jsonb_build_object(
      'conversations_reset',    v_convs_reset,
      'messages_deleted',       v_msg_deleted,
      'outbound_queue_deleted', v_queue_deleted
    ));
  return v_convs_reset;
end;
$function$;

comment on function whatsapp.conversations_clear_all(uuid) is
  'Bulk "tout effacer": set-based twin of admin_conversation_clear — deletes every '
  'message + outbound_queue row of the instance and resets each conversation''s '
  'denormalized summary. Rows/assignments/tags/notes survive. Admin-gated. R2 media '
  'wipe stays in the edge layer (run the purge preflight BEFORE calling this).';

-- ── 4. Tout supprimer — set-based twin of the cleanup ''delete'' mode ────────
create or replace function whatsapp.conversations_delete_all(p_instance_id uuid)
  returns integer
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_deleted integer;
begin
  if p_instance_id is null then raise exception 'invalid_input'; end if;
  if not coalesce(whatsapp.is_wa_admin(p_instance_id), false) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  with d as (
    delete from whatsapp.conversations
     where instance_id = p_instance_id
    returning 1
  )
  select count(*) into v_deleted from d;

  perform whatsapp.audit('conversation.bulk_delete', 'instance', p_instance_id::text,
    jsonb_build_object('conversations_deleted', v_deleted));
  return v_deleted;
end;
$function$;

comment on function whatsapp.conversations_delete_all(uuid) is
  'Bulk "tout supprimer": drops every conversation of the instance; FK CASCADE wipes '
  'messages/assignments/notes/tags/outbound_queue/scheduled_messages. Admin-gated, '
  'mirroring the conversation-cleanup delete mode. R2 media wipe + worker purge_peer '
  'signal stay in the edge layer (run them BEFORE calling this).';

-- ── 5. Bulk purge preflight — instance-wide twin of admin_conversation_purge_preflight
-- The conversation-cleanup edge fn's bulk modes call this FIRST, wipe the
-- returned r2_keys via batch DeleteObjects, THEN run conversations_clear_all /
-- conversations_delete_all — the same preflight→R2→DB order as the
-- per-conversation pipeline, so bulk destructive ops never orphan R2 media.
-- remote_jids feeds the worker purge_peer broadcast on delete_all.
create or replace function whatsapp.admin_conversations_bulk_purge_preflight(p_instance_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_convs   integer;
  v_msgs    integer;
  v_keys    text[];
  v_jids    text[];
begin
  if p_instance_id is null then raise exception 'invalid_input'; end if;
  if not coalesce(whatsapp.is_wa_admin(p_instance_id), false) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  select count(*) into v_convs from whatsapp.conversations where instance_id = p_instance_id;
  select count(*), array_agg(distinct media_storage_key) filter (where media_storage_key is not null)
    into v_msgs, v_keys
    from whatsapp.messages where instance_id = p_instance_id;
  -- DM peers only — groups have no peer-presence subscription to purge.
  select array_agg(remote_jid) into v_jids
    from whatsapp.conversations
   where instance_id = p_instance_id and is_group = false;

  return jsonb_build_object(
    'instance_id', p_instance_id,
    'counts', jsonb_build_object(
      'conversations', coalesce(v_convs, 0),
      'messages',      coalesce(v_msgs, 0),
      'r2_objects',    coalesce(array_length(v_keys, 1), 0)
    ),
    'r2_keys',     to_jsonb(coalesce(v_keys, array[]::text[])),
    'remote_jids', to_jsonb(coalesce(v_jids, array[]::text[]))
  );
end;
$function$;

comment on function whatsapp.admin_conversations_bulk_purge_preflight(uuid) is
  'Instance-wide purge preflight for the conversation-cleanup edge fn bulk modes: '
  'counts + every message R2 storage key + DM remote_jids (worker purge_peer). '
  'Admin-gated; read-only. MUST run (and R2 DeleteObjects with it) BEFORE '
  'conversations_clear_all / conversations_delete_all.';

-- SECURITY DEFINER writers: no default PUBLIC execute (matches the hardened
-- admin_conversation_clear ACL), explicit grants only.
revoke all on function whatsapp.conversations_mark_all_read(uuid)   from public, anon;
revoke all on function whatsapp.conversations_mark_all_unread(uuid) from public, anon;
revoke all on function whatsapp.conversations_clear_all(uuid)       from public, anon;
revoke all on function whatsapp.conversations_delete_all(uuid)      from public, anon;
revoke all on function whatsapp.admin_conversations_bulk_purge_preflight(uuid) from public, anon;

grant execute on function whatsapp.conversations_mark_all_read(uuid)   to authenticated, service_role;
grant execute on function whatsapp.conversations_mark_all_unread(uuid) to authenticated, service_role;
grant execute on function whatsapp.conversations_clear_all(uuid)       to authenticated, service_role;
grant execute on function whatsapp.conversations_delete_all(uuid)      to authenticated, service_role;
grant execute on function whatsapp.admin_conversations_bulk_purge_preflight(uuid) to authenticated, service_role;

commit;
