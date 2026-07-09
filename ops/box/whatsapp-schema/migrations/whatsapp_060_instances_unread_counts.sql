-- whatsapp_060_instances_unread_counts.sql
--
-- BUG: the instance-switcher badge and the "Non lues" filter pill both showed a
-- SUM of unread_count (i.e. the number of unread MESSAGES) instead of the number
-- of CONVERSATIONS that still have unread messages. One thread with 10 unread
-- messages correctly shows a 10 badge on its list row, but the switcher/pill must
-- show 1 (one unread conversation), not 10.
--
-- The old client did:  select instance_id, unread_count from conversations_decrypted
--                      where unread_count > 0  →  sum per instance (client-side).
-- Two problems: (a) it summed messages, and (b) the client read was PostgREST-
-- capped at 1000 rows, so a busy instance would undercount at scale.
--
-- FIX: a server-side aggregate that COUNTS unread conversations per instance,
-- mirroring the operational-list visibility exactly so the pill badge equals the
-- number of rows the "Non lues" filter yields:
--   view conversations_decrypted (already excludes merged tombstones + @lid)
--   AND unread_count > 0
--   AND is_archived = false
--   AND status IN ('open','pending')
--   AND remote_jid NOT LIKE '%@broadcast' / '%@newsletter'   (defensive, matches list)
--
-- SECURITY INVOKER (default): conversations_decrypted is security_invoker=true, so
-- RLS on the underlying conversations table applies as the CALLER — admins count
-- every conversation on the instance, agents count only conversations assigned to
-- them. Identical scoping to the direct view read it replaces. Index-backed by
-- conversations_unread_idx (instance_id) WHERE unread_count>0 AND merged_into IS NULL.

begin;

create or replace function whatsapp.instances_unread_counts(p_instance_ids uuid[])
  returns table(instance_id uuid, unread_conversations integer)
  language sql
  stable
  set search_path to ''
as $function$
  select cd.instance_id, count(*)::int as unread_conversations
  from whatsapp.conversations_decrypted cd
  where cd.instance_id = any(p_instance_ids)
    and cd.unread_count > 0
    and cd.is_archived = false
    and cd.status in ('open'::whatsapp.conversation_status, 'pending'::whatsapp.conversation_status)
    and cd.remote_jid not like '%@broadcast'
    and cd.remote_jid not like '%@newsletter'
  group by cd.instance_id;
$function$;

comment on function whatsapp.instances_unread_counts(uuid[]) is
  'Per-instance COUNT of visible conversations with unread messages (not the sum of '
  'unread messages). Mirrors the operational "Non lues" list visibility. SECURITY '
  'INVOKER → RLS scopes per caller (admin=all, agent=assigned). Feeds the inbox '
  'switcher badge (instances-unread) and the Non lues filter pill.';

grant execute on function whatsapp.instances_unread_counts(uuid[]) to authenticated, service_role;

commit;
