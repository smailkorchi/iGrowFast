-- whatsapp_062_archived_counts.sql
--
-- BUG: the "Archivées" filter pill has no count — the only way to know how many
-- archived conversations an instance holds is to open the filter and let the
-- infinite list page them in. A client-side tally over loaded rows is banned
-- (PostgREST caps the read at 1000 rows → undercount at scale, and it drags
-- every archived row over the wire just to count it).
--
-- FIX: a server-side aggregate that COUNTS archived conversations per instance,
-- mirroring instances_unread_counts (mig 060) exactly except for the predicate,
-- which mirrors the "Archivées" list visibility (useConversations 'archived'):
--   view conversations_decrypted (already excludes merged tombstones + @lid)
--   AND is_archived = true      (NO status narrowing — the archived list shows
--                                resolved/snoozed threads too)
--   AND remote_jid NOT LIKE '%@broadcast' / '%@newsletter'   (defensive, matches list)
--
-- SECURITY INVOKER (default): conversations_decrypted is security_invoker=true, so
-- RLS on the underlying conversations table applies as the CALLER — admins count
-- every archived conversation on the instance, agents count only conversations
-- assigned to them. Identical scoping to the archived list read it summarizes.

begin;

create or replace function whatsapp.instances_archived_counts(p_instance_ids uuid[])
  returns table(instance_id uuid, archived_conversations integer)
  language sql
  stable
  set search_path to ''
as $function$
  select cd.instance_id, count(*)::int as archived_conversations
  from whatsapp.conversations_decrypted cd
  where cd.instance_id = any(p_instance_ids)
    and cd.is_archived = true
    and cd.remote_jid not like '%@broadcast'
    and cd.remote_jid not like '%@newsletter'
  group by cd.instance_id;
$function$;

comment on function whatsapp.instances_archived_counts(uuid[]) is
  'Per-instance COUNT of archived conversations visible to the caller. Mirrors the '
  '"Archivées" list visibility exactly (is_archived=true, NO status narrowing). '
  'SECURITY INVOKER → RLS scopes per caller (admin=all, agent=assigned). Feeds the '
  'Archivées filter pill badge.';

grant execute on function whatsapp.instances_archived_counts(uuid[]) to authenticated, service_role;

-- Index parity with the unread aggregate: mig 060's count rides
-- conversations_unread_idx, but the only archived-flag index on prod
-- (conversations_is_archived_idx) is partial WHERE is_archived = FALSE — the
-- WRONG polarity for this count and for the Archivées list. Without this,
-- every archived-count refetch scans the instance's conversations with a heap
-- filter (real cost at enterprise scale, negligible today).
create index if not exists conversations_archived_idx
  on whatsapp.conversations (instance_id)
  where is_archived and merged_into is null;

commit;
