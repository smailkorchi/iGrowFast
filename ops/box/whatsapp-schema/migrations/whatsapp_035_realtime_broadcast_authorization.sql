-- whatsapp_035_realtime_broadcast_authorization.sql
-- FOUNDATION for the Stage-2 broadcast redesign (enterprise audit choke-point fix).
--
-- Today: realtime.messages has RLS ENABLED but ZERO policies, so PRIVATE channels
-- are deny-all for `authenticated` (nothing uses them yet — all current WhatsApp
-- realtime is postgres_changes on PUBLIC channels, plus typing/presence broadcast
-- on PUBLIC channels). This migration is therefore PURELY ADDITIVE: it grants
-- `authenticated` the ability to JOIN (read) a private per-conversation broadcast
-- topic ONLY when they can already access that conversation's rows — the exact
-- same predicate as whatsapp.conversations' SELECT policy. Channel access ==
-- row access, so there is no new disclosure surface.
--
-- Topic scheme (this migration covers the conversation topic only):
--   wa:conv:<conversation_id>   -- thread stream (decrypted message events)
-- A future migration adds wa:inst:<instance_id> for list/bump signals (that one
-- is admin-scoped or minimal-payload; NOT covered here on purpose).
--
-- Clients are RECEIVE-ONLY on these topics: no INSERT policy is created, so an
-- `authenticated` client cannot spoof a broadcast to another client. The worker
-- publishes via the Realtime HTTP Broadcast API with the service_role key
-- (service_role has BYPASSRLS), so it needs no policy either.
--
-- Reversible: `drop policy wa_conv_broadcast_read on realtime.messages;`
--             `drop function whatsapp.can_access_conv_topic(text);`
--             `drop function whatsapp.can_access_conversation(uuid);`
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -X' < this-file

begin;

-- 1) Single-conversation access check. EXACT mirror of whatsapp.conversations'
--    SELECT policy: business-admin of the owning instance OR assigned agent.
--    SECURITY DEFINER + search_path='' so it computes ground-truth access
--    (reads the base tables directly) instead of recursing through their RLS.
create or replace function whatsapp.can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from whatsapp.conversations c
    where c.id = p_conversation_id
      and (
        c.instance_id in (select whatsapp.admin_instance_ids())
        or exists (
          select 1 from whatsapp.conversation_assignments ca
          where ca.conversation_id = c.id
            and ca.user_id = auth.uid()
        )
      )
  );
$function$;

comment on function whatsapp.can_access_conversation(uuid) is
  'True if the current auth.uid() may access the conversation (business-admin of the owning instance OR assigned agent). Mirrors whatsapp.conversations SELECT RLS exactly. Used by Realtime broadcast authorization and reusable elsewhere.';

-- 2) Topic-string guard for realtime.messages RLS. Never throws on a malformed
--    topic (returns false), so a crafted channel name cannot error the policy.
create or replace function whatsapp.can_access_conv_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when p_topic ~ '^wa:conv:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then whatsapp.can_access_conversation(substring(p_topic from 9)::uuid)
    else false
  end;
$function$;

comment on function whatsapp.can_access_conv_topic(text) is
  'Realtime broadcast read gate: true iff p_topic is wa:conv:<uuid> and the caller can access that conversation. Malformed topics return false (never raises).';

grant execute on function whatsapp.can_access_conversation(uuid) to authenticated, service_role;
grant execute on function whatsapp.can_access_conv_topic(text)   to authenticated, service_role;

-- 3) SELECT-only policy on realtime.messages: authenticated may READ (join &
--    receive) a private topic only if it is a wa:conv:<uuid> they can access.
--    No INSERT/UPDATE/DELETE policy => clients cannot publish on these topics.
drop policy if exists wa_conv_broadcast_read on realtime.messages;
create policy wa_conv_broadcast_read
  on realtime.messages
  for select
  to authenticated
  using ( whatsapp.can_access_conv_topic(realtime.topic()) );

commit;
