-- whatsapp_008_agent_policies  (Wave 8) — agent-select RLS branches (policy-only)
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Now that conversation_assignments + conversations exist, add the deferred agent-select branches so an
-- assigned seller sees ONLY their assigned conversations/messages + the instances/contacts behind them.
--
-- PREREQ FIX (recursion): wave-7's ca_* policies inline-read whatsapp.conversations (from the is_admin ->
-- is_wa_admin(conversation's instance) rewrite). Once conversations_select gains an EXISTS(conversation_
-- assignments) agent branch below, conversations<->conversation_assignments RLS recurse infinitely. Break it
-- by moving the conversation->instance lookup into a SECDEF helper (runs as postgres, which has bypassrls),
-- so evaluating a ca_* policy never re-enters conversations RLS.

create or replace function whatsapp.is_wa_admin_conv(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path to '' as $function$
  select whatsapp.is_wa_admin((select c.instance_id from whatsapp.conversations c where c.id = p_conversation_id));
$function$;
revoke all on function whatsapp.is_wa_admin_conv(uuid) from public;
grant  execute on function whatsapp.is_wa_admin_conv(uuid) to authenticated, service_role;

alter policy ca_admin_delete on whatsapp.conversation_assignments
  using (whatsapp.is_wa_admin_conv(conversation_id));
alter policy ca_admin_insert on whatsapp.conversation_assignments
  with check (whatsapp.is_wa_admin_conv(conversation_id) and assigned_by = (select auth.uid()));
alter policy ca_select on whatsapp.conversation_assignments
  using (whatsapp.is_wa_admin_conv(conversation_id) or user_id = (select auth.uid()));

-- combined admin-or-agent SELECT policies (ALTER existing). is_wa_admin(instance_id) reads a column, not
-- conversations, so no recursion; the EXISTS reads conversation_assignments -> ca_select (SECDEF helper) -> ends.
alter policy wi_select on whatsapp.whatsapp_instances using (
  whatsapp.is_wa_admin(id) or exists (
    select 1 from whatsapp.conversation_assignments ca
    join whatsapp.conversations c on c.id = ca.conversation_id
    where c.instance_id = whatsapp_instances.id and ca.user_id = (select auth.uid())));

alter policy conversations_select on whatsapp.conversations using (
  whatsapp.is_wa_admin(instance_id) or exists (
    select 1 from whatsapp.conversation_assignments ca
    where ca.conversation_id = conversations.id and ca.user_id = (select auth.uid())));

alter policy messages_select on whatsapp.messages using (
  whatsapp.is_wa_admin(instance_id) or exists (
    select 1 from whatsapp.conversation_assignments ca
    where ca.conversation_id = messages.conversation_id and ca.user_id = (select auth.uid())));

alter policy contact_profiles_select on whatsapp.contact_profiles using (
  whatsapp.is_wa_admin(instance_id) or exists (
    select 1 from whatsapp.conversation_assignments ca
    join whatsapp.conversations c on c.id = ca.conversation_id
    where c.instance_id = contact_profiles.instance_id and ca.user_id = (select auth.uid())));

alter policy group_participants_select on whatsapp.group_participants using (
  whatsapp.is_wa_admin(instance_id) or exists (
    select 1 from whatsapp.conversation_assignments ca
    join whatsapp.conversations c on c.id = ca.conversation_id
    where c.instance_id = group_participants.instance_id
      and c.remote_jid = group_participants.group_jid
      and ca.user_id = (select auth.uid())));

-- contact-bible SEPARATE agent-select policies (CREATE new; admins covered by *_admin_all).
create policy contacts_agent_select on whatsapp.contacts for select to authenticated using (
  exists (
    select 1 from whatsapp.conversation_assignments ca
    join whatsapp.conversations c on c.id = ca.conversation_id
    where ca.user_id = (select auth.uid()) and c.contact_id = contacts.id));

create policy contact_identifiers_agent_select on whatsapp.contact_identifiers for select to authenticated using (
  exists (
    select 1 from whatsapp.conversation_assignments ca
    join whatsapp.conversations c on c.id = ca.conversation_id
    where c.instance_id = contact_identifiers.instance_id and ca.user_id = (select auth.uid())));

create policy jid_mapping_agent_select on whatsapp.jid_mapping for select to authenticated using (
  exists (
    select 1 from whatsapp.conversation_assignments ca
    join whatsapp.conversations c on c.id = ca.conversation_id
    where c.instance_id = jid_mapping.instance_id and ca.user_id = (select auth.uid())));

create policy merge_decisions_agent_select on whatsapp.merge_decisions for select to authenticated using (
  exists (
    select 1 from whatsapp.conversation_assignments ca
    join whatsapp.conversations c on c.id = ca.conversation_id
    where c.instance_id = merge_decisions.instance_id and ca.user_id = (select auth.uid())));

create policy merge_review_agent_select on whatsapp.merge_review for select to authenticated using (
  exists (
    select 1 from whatsapp.conversation_assignments ca
    join whatsapp.conversations c on c.id = ca.conversation_id
    where c.instance_id = merge_review.instance_id and ca.user_id = (select auth.uid())));
