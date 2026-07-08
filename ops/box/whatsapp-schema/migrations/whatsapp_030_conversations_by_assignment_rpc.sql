-- whatsapp_030_conversations_by_assignment_rpc.sql
-- Fix the admin inbox "assignées à moi" / "non assignées" filter chips, which
-- hit BOTH self-host caps at scale: the client fetched the assignment id set
-- (PGRST 1000-row cap → wrong filter beyond 1000 assignments) and .in()/.not-in()
-- it into the conversations query (every id in the request URL → nginx 8k limit
-- fails the query beyond ~200 assignments). This RPC does the join + filter +
-- pagination SERVER-SIDE, so no id list ever crosses the wire.
--
-- SECURITY INVOKER: the caller's RLS on conversations_decrypted applies, so a
-- seller only ever sees their own (their 'unassigned' is naturally empty). The
-- base filters mirror useConversations exactly (instance, not broadcast/
-- newsletter, not archived, status open|pending; 'unassigned' is DMs only).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

create or replace function whatsapp.admin_list_conversations_by_assignment(
  p_instance_id uuid,
  p_mode        text,          -- 'assigned_to_me' | 'unassigned'
  p_limit       integer,
  p_offset      integer
)
returns setof whatsapp.conversations_decrypted
language sql
stable
security invoker
set search_path to ''
as $$
  select c.*
  from whatsapp.conversations_decrypted c
  where c.instance_id = p_instance_id
    and c.remote_jid not like '%@broadcast'
    and c.remote_jid not like '%@newsletter'
    and c.is_archived = false
    and c.status = any (array['open','pending']::whatsapp.conversation_status[])
    and (
      (p_mode = 'assigned_to_me' and exists (
         select 1 from whatsapp.conversation_assignments a
         where a.conversation_id = c.id and a.user_id = auth.uid()))
      or
      (p_mode = 'unassigned' and c.is_group = false and not exists (
         select 1 from whatsapp.conversation_assignments a
         where a.conversation_id = c.id))
    )
  order by c.is_pinned desc, c.last_message_at desc nulls last
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

revoke all on function whatsapp.admin_list_conversations_by_assignment(uuid, text, integer, integer) from public, anon;
grant execute on function whatsapp.admin_list_conversations_by_assignment(uuid, text, integer, integer) to authenticated, service_role;

commit;
