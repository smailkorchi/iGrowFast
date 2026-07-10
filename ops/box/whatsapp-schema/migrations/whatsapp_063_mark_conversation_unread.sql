-- whatsapp_063_mark_conversation_unread.sql
--
-- BUG: the inbox exposes "mark as read" (whatsapp.mark_conversation_read) but has
-- no inverse. WhatsApp itself offers "Marquer comme non lu" on every chat — the
-- standard "come back to this later" flag — so agents and admins expect it, and
-- the ctx-menu cannot ship it without a server-side write path (conversations is
-- only ever mutated through RPCs, never by direct client UPDATEs).
--
-- FIX: whatsapp.mark_conversation_unread(p_conversation_id) — the exact mirror of
-- toggle_archive's shape:
--   * SECURITY DEFINER, gated by _assert_conversation_access (admin of the
--     instance OR agent assigned to the conversation) — same audience as
--     mark_conversation_read, so anyone who can clear the badge can set it.
--   * unread_count := greatest(unread_count, 1) — flags a fully-read thread with
--     a single-unread badge but never clobbers a real backlog (a thread already
--     at 7 unread stays at 7).
--   * updated_at := now() — the conversations_broadcast_bump trigger then
--     live-syncs every open client: the list row badge, and the "Non lues"
--     pill / instance-switcher badge via instances_unread_counts (mig 060).

begin;

create or replace function whatsapp.mark_conversation_unread(p_conversation_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_new integer;
begin
  perform whatsapp._assert_conversation_access(p_conversation_id);
  update whatsapp.conversations
     set unread_count = greatest(unread_count, 1),
         updated_at   = now()
   where id = p_conversation_id
  returning unread_count into v_new;
  perform whatsapp.audit('conversation.marked_unread', 'conversation', p_conversation_id::text,
    jsonb_build_object('unread_count', v_new));
  return jsonb_build_object('unread_count', v_new);
end;
$function$;

comment on function whatsapp.mark_conversation_unread(uuid) is
  'Inverse of mark_conversation_read: flags a conversation as unread (unread_count '
  'bumped to at least 1, real backlogs untouched). Gate = _assert_conversation_access '
  '(admin OR assigned agent). Touches updated_at so the bump broadcast live-syncs the '
  'list badge and the Non lues pill (instances_unread_counts).';

grant execute on function whatsapp.mark_conversation_unread(uuid) to authenticated, service_role;

commit;
