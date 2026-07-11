-- whatsapp_066_filter_counts.sql
--
-- Server-side conversation counts for the chat-list filter dropdown (Groupes +
-- per-tag), so the dropdown shows a badge like "Non lues 34" / "Archivées N"
-- WITHOUT deriving from the loaded page window (which undercounts until the user
-- scrolls the matching conversation into view — the exact bug fixed for the tag
-- FILTER; the tag COUNT must not reintroduce it).
--
-- Predicates match the operational list EXACTLY (see instances_unread_counts and
-- the useConversations 'groups' / 'tag:' filters): conversations_decrypted (the
-- view already excludes merged + @lid), is_archived = false, status in
-- (open, pending), no @broadcast / @newsletter. So a badge count equals what the
-- user sees after clicking that filter.
--
-- Plain SQL, SECURITY INVOKER (no DEFINER): conversations_decrypted is
-- security_invoker and conversation_tags has RLS, so a seller counts only their
-- assigned conversations/tags — same scoping as the list they'd see.
--
-- Favoris is a client-side localStorage set (complete, not page-derived) → the
-- client shows its size directly; Non lues / Archivées already have their own
-- aggregates. This RPC covers only what the client can't count on its own.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

create or replace function whatsapp.conversation_filter_counts(p_instance_id uuid)
  returns jsonb
  language sql
  stable
  set search_path to ''
as $function$
  with base as (
    select cd.id, cd.is_group
    from whatsapp.conversations_decrypted cd
    where cd.instance_id = p_instance_id
      and cd.is_archived = false
      and cd.status in ('open'::whatsapp.conversation_status, 'pending'::whatsapp.conversation_status)
      and cd.remote_jid not like '%@broadcast'
      and cd.remote_jid not like '%@newsletter'
  )
  select jsonb_build_object(
    'groups', (select count(*)::int from base where is_group),
    'tags', coalesce(
      (select jsonb_object_agg(tc.tag_id::text, tc.cnt)
         from (
           select ct.tag_id, count(*)::int as cnt
           from whatsapp.conversation_tags ct
           join base b on b.id = ct.conversation_id
           group by ct.tag_id
         ) tc),
      '{}'::jsonb)
  );
$function$;

revoke all on function whatsapp.conversation_filter_counts(uuid) from public, anon;
grant  execute on function whatsapp.conversation_filter_counts(uuid) to authenticated, service_role;
alter  function whatsapp.conversation_filter_counts(uuid) owner to postgres;

commit;
