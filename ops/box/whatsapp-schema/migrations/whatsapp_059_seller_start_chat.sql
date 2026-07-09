-- whatsapp_059_seller_start_chat.sql
--
-- BUG: a seller (commercial agent) who tries to start a chat from the phone
-- dialer / new-chat view gets "Action non autorisée". Two admin-only gates and
-- one visibility gap block the flow:
--   1. whatsapp.ensure_conversation() hard-gated on is_wa_admin() → forbidden.
--   2. check-whatsapp edge fn gated on requireAdmin (fixed in the edge layer).
--   3. even if a conversation were created, RLS (conversations_select = admin OR
--      assigned) hides an UNASSIGNED conversation from the agent — so a seller-
--      started chat must be assigned to that seller to be usable at all.
--
-- FIX (this migration):
--   * whatsapp.can_use_instance(uuid) — the single authorization primitive for
--     "may this caller act on this instance". It is the EXACT predicate the
--     wi_select RLS policy already uses (admin OR has ≥1 assignment on a
--     conversation of the instance), so a seller can start a chat on precisely
--     the numbers their inbox already shows them — never a cross-tenant one.
--   * ensure_conversation() — gate relaxed to can_use_instance(); when the caller
--     is a non-admin agent, the resolved/created conversation is self-assigned so
--     it lands in their inbox. DMs already owned by ANOTHER agent raise
--     conversation_taken (no silent hijack). Admin behavior is unchanged (admins
--     see everything and take no assignment).
--
-- The _guard_assignment_business BEFORE-INSERT trigger still enforces
-- commercial-role + same-business on every assignment row, so only a same-business
-- seller can ever be the self-assignee. Send is already agent-safe
-- (_assert_conversation_access = admin OR assigned); the conversation_assignments
-- broadcast trigger refreshes the seller's sidebar on self-assign.

begin;

-- ── single authorization primitive: admin OR agent-of-instance ───────────────
create or replace function whatsapp.can_use_instance(p_instance_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to ''
as $function$
  select whatsapp.is_wa_admin(p_instance_id)
      or exists (
        select 1
        from whatsapp.conversation_assignments ca
        join whatsapp.conversations c on c.id = ca.conversation_id
        where c.instance_id = p_instance_id
          and ca.user_id = auth.uid()
      );
$function$;

comment on function whatsapp.can_use_instance(uuid) is
  'True when auth.uid() is a business admin of the instance OR an agent with at least '
  'one conversation assigned on it. Mirrors the wi_select RLS predicate — the single '
  'source of truth for agent↔instance access (used by ensure_conversation and the '
  'check-whatsapp edge fn).';

grant execute on function whatsapp.can_use_instance(uuid) to authenticated, service_role;

-- ── ensure_conversation: admin OR seller; seller self-assigns ────────────────
create or replace function whatsapp.ensure_conversation(
  p_instance_id uuid,
  p_remote_jid text,
  p_peer_display_name text default null::text,
  p_peer_profile_pic text default null::text
)
  returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_id         uuid;
  v_norm_jid   text;
  v_contact_id uuid;
  v_is_admin   boolean;
  v_is_group   boolean;
begin
  -- Authorization: admin of the instance OR an agent (seller) already working it.
  if not whatsapp.can_use_instance(p_instance_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_is_admin := whatsapp.is_wa_admin(p_instance_id);

  if p_instance_id is null or p_remote_jid is null then raise exception 'invalid_input'; end if;
  v_norm_jid := trim(p_remote_jid);
  if v_norm_jid = '' then raise exception 'invalid_input'; end if;
  if v_norm_jid = 'status@broadcast' or v_norm_jid like '%@broadcast' or v_norm_jid like '%@newsletter' then
    raise exception 'pseudo_chat_jid';
  end if;
  v_norm_jid := whatsapp._canonical_remote_jid(p_instance_id, v_norm_jid);
  if not exists (select 1 from whatsapp.whatsapp_instances where id = p_instance_id) then
    raise exception 'instance_not_found';
  end if;

  select whatsapp.chase_merged_into(id) into v_contact_id from whatsapp.contacts
    where instance_id = p_instance_id and merged_into is null and (phone_jid = v_norm_jid or lid = v_norm_jid)
    order by (phone_jid = v_norm_jid) desc limit 1;

  select id into v_id from whatsapp.conversations
    where instance_id = p_instance_id and remote_jid = v_norm_jid limit 1;

  if v_id is not null then
    update whatsapp.conversations set peer_display_name = coalesce(peer_display_name, p_peer_display_name),
      peer_profile_pic = coalesce(peer_profile_pic, p_peer_profile_pic),
      contact_id = coalesce(contact_id, v_contact_id), updated_at = now() where id = v_id;
  else
    insert into whatsapp.conversations (instance_id, remote_jid, peer_display_name, peer_profile_pic,
      contact_id, status, unread_count, is_pinned, is_archived)
    values (p_instance_id, v_norm_jid, nullif(trim(coalesce(p_peer_display_name, '')), ''),
      nullif(trim(coalesce(p_peer_profile_pic, '')), ''), v_contact_id, 'open'::whatsapp.conversation_status, 0, false, false)
    returning id into v_id;
    perform whatsapp.audit('conversation.created_manual', 'conversation', v_id::text,
      jsonb_build_object('conversation_id', v_id, 'remote_jid', v_norm_jid));
  end if;

  -- Seller (non-admin agent) self-assign: RLS shows agents only conversations
  -- assigned to them, so a chat they start must land in their own inbox.
  if not v_is_admin then
    select is_group into v_is_group from whatsapp.conversations where id = v_id;
    if not coalesce(v_is_group, false) and exists (
      select 1 from whatsapp.conversation_assignments
       where conversation_id = v_id and user_id <> auth.uid()
    ) then
      -- DM already owned by another agent: opening it would hijack their chat.
      raise exception 'conversation_taken' using errcode = '42501';
    end if;
    insert into whatsapp.conversation_assignments (conversation_id, user_id, assigned_by, is_group)
    values (v_id, auth.uid(), auth.uid(), coalesce(v_is_group, false))
    on conflict (conversation_id, user_id) do nothing;
  end if;

  return v_id;
end;
$function$;

commit;
