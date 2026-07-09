-- whatsapp_058_assignment_console_scale.sql
--
-- Make the /admin/assignment console server-authoritative and O(page), not
-- O(all-conversations-in-the-browser).
--
-- BUG THIS FIXES
-- --------------
-- The Assignment page loaded ONE page (PAGE_SIZE=50) of conversations via
-- useFlattenedConversations and derived EVERY number client-side over those
-- 50 rows: the chip counts (Non assignées / Assignées à un / … / Toutes) and
-- each agent's "N ouvertes" load count. Consequences on a live instance with
-- 1,221 visible conversations (macaron voiture):
--   * chips read 50/50/0/0/50/0 instead of 1221/145/1076/0/1221/0
--   * an agent owning 1,076 conversations showed "0 ouvertes" because the
--     per-agent count intersected assignments with the loaded 50 rows, and all
--     1,076 of hers sit on OLDER conversations that were never fetched.
-- Bumping PAGE_SIZE or draining every page to the client is not a fix — it just
-- moves the ceiling. Counts and pagination must live in the database.
--
-- VISIBILITY CONTRACT
-- -------------------
-- These RPCs reproduce EXACTLY the set the inbox shows, which is the
-- whatsapp.conversations_decrypted view (merged_into IS NULL AND remote_jid
-- NOT LIKE '%@lid') further narrowed to the operational tabs
-- (not archived, status IN (open,pending)) plus the inbox's defensive
-- broadcast/newsletter exclusion. @lid-only contacts stay hidden here for
-- parity with the inbox — surfacing them is a separate, app-wide decision.
--
-- Backed by existing indexes:
--   conversations_status_active_idx  (instance_id, last_message_at DESC) WHERE status IN (open,pending)
--   conversations_list_pinned_idx    (instance_id, is_pinned, last_message_at) WHERE open/pending & !archived & !merged
--   conversation_assignments_conversation_idx (conversation_id)
--   conversations_peer_name_trgm_idx / conversations_remote_jid_trgm_idx (search)
--
-- All four functions are SECURITY DEFINER, search_path='' and gate on
-- whatsapp.is_wa_admin(p_instance_id); the two writers additionally match the
-- existing bulk RPCs (audit-suppress GUC + one summary audit line).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SUMMARY — every chip count + every agent's open-load in ONE round trip.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function whatsapp.admin_assignment_summary(p_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_all int; v_un int; v_one int; v_many int; v_dms int; v_groups int;
  v_un_dms int;
  v_agents jsonb;
begin
  if not whatsapp.is_wa_admin(p_instance_id) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  with vis as (
    select c.id, c.is_group
    from whatsapp.conversations c
    where c.instance_id  = p_instance_id
      and c.merged_into  is null
      and c.remote_jid   not like '%@lid'
      and c.remote_jid   not like '%@broadcast'
      and c.remote_jid   not like '%@newsletter'
      and c.is_archived  = false
      and c.status       in ('open', 'pending')
  ),
  counted as (
    select v.id, v.is_group, count(a.conversation_id) as n
    from vis v
    left join whatsapp.conversation_assignments a on a.conversation_id = v.id
    group by v.id, v.is_group
  )
  select
    count(*),
    count(*) filter (where n = 0),
    count(*) filter (where n = 1),
    count(*) filter (where n >= 2),
    count(*) filter (where not is_group),
    count(*) filter (where is_group),
    count(*) filter (where n = 0 and not is_group)
  into v_all, v_un, v_one, v_many, v_dms, v_groups, v_un_dms
  from counted;

  -- per-agent open-load: assignments landing on a VISIBLE conversation only,
  -- so a stray assignment on a merged/archived/@lid row can't inflate a badge.
  select coalesce(jsonb_object_agg(t.user_id, t.c), '{}'::jsonb)
  into v_agents
  from (
    select a.user_id, count(*)::int as c
    from whatsapp.conversation_assignments a
    join whatsapp.conversations c on c.id = a.conversation_id
    where c.instance_id  = p_instance_id
      and c.merged_into  is null
      and c.remote_jid   not like '%@lid'
      and c.remote_jid   not like '%@broadcast'
      and c.remote_jid   not like '%@newsletter'
      and c.is_archived  = false
      and c.status       in ('open', 'pending')
    group by a.user_id
  ) t;

  return jsonb_build_object(
    'all', v_all, 'unassigned', v_un, 'one', v_one, 'many', v_many,
    'dms', v_dms, 'groups', v_groups, 'unassigned_dms', v_un_dms, 'agents', v_agents
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PAGE — keyset-paginated conversation page for one chip + search.
--    Cursor = (last_message_at, id); NULL cursor = first page. Seek method,
--    not OFFSET, so page N is as cheap as page 1. Assignee arrays + the
--    decrypted preview are computed only for the ≤p_limit returned rows.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function whatsapp.admin_assignment_page(
  p_instance_id uuid,
  p_mode        text,                       -- all | unassigned | one | many | dms | groups
  p_search      text        default null,
  p_limit       int         default 50,
  p_before_ts   timestamptz default null,   -- keyset cursor: last row's last_message_at
  p_before_id   uuid        default null    -- keyset cursor: last row's id (tiebreak)
)
returns table(
  id                     uuid,
  instance_id            uuid,
  remote_jid             text,
  is_group               boolean,
  peer_display_name      text,
  peer_profile_pic       text,
  contact_id             uuid,
  contact_book_name      text,
  last_message_at        timestamptz,
  last_message_preview   text,
  last_message_kind      whatsapp.message_kind,
  last_message_direction whatsapp.message_direction,
  unread_count           int,
  status                 whatsapp.conversation_status,
  assigned_user_ids      uuid[]
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not whatsapp.is_wa_admin(p_instance_id) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  return query
  with page_ids as (
    select c.id, c.last_message_at
    from whatsapp.conversations c
    left join whatsapp.contacts ct on ct.id = c.contact_id
    where c.instance_id  = p_instance_id
      and c.merged_into  is null
      and c.remote_jid   not like '%@lid'
      and c.remote_jid   not like '%@broadcast'
      and c.remote_jid   not like '%@newsletter'
      and c.is_archived  = false
      and c.status       in ('open', 'pending')
      -- chip filter
      and (
            p_mode = 'all'
        or (p_mode = 'dms'    and c.is_group = false)
        or (p_mode = 'groups' and c.is_group = true)
        or (p_mode = 'unassigned' and not exists (
              select 1 from whatsapp.conversation_assignments a where a.conversation_id = c.id))
        or (p_mode = 'one'  and (
              select count(*) from whatsapp.conversation_assignments a where a.conversation_id = c.id) = 1)
        or (p_mode = 'many' and (
              select count(*) from whatsapp.conversation_assignments a where a.conversation_id = c.id) >= 2)
      )
      -- search (trgm-indexed on peer_display_name / remote_jid)
      and (
            p_search is null or p_search = ''
        or c.peer_display_name ilike '%' || p_search || '%'
        or c.remote_jid        ilike '%' || p_search || '%'
        or ct.book_name        ilike '%' || p_search || '%'
      )
      -- keyset seek (DESC): everything strictly "older" than the cursor.
      -- coalesce so NULL last_message_at sorts last and stays total-ordered.
      and (
            p_before_ts is null
        or (coalesce(c.last_message_at, '-infinity'::timestamptz), c.id)
           < (coalesce(p_before_ts,     '-infinity'::timestamptz), coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
      )
    order by coalesce(c.last_message_at, '-infinity'::timestamptz) desc, c.id desc
    limit greatest(p_limit, 1)
  )
  select
    c.id, c.instance_id, c.remote_jid, c.is_group,
    c.peer_display_name, c.peer_profile_pic, c.contact_id,
    ct.book_name,
    c.last_message_at,
    whatsapp._decrypt_conv_preview(c.id),
    c.last_message_kind, c.last_message_direction, c.unread_count, c.status,
    coalesce(
      (select array_agg(a.user_id) from whatsapp.conversation_assignments a where a.conversation_id = c.id),
      '{}'::uuid[]
    )
  from page_ids p
  join whatsapp.conversations c on c.id = p.id
  left join whatsapp.contacts ct on ct.id = c.contact_id
  order by coalesce(c.last_message_at, '-infinity'::timestamptz) desc, c.id desc;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ASSIGN BY FILTER — assign every conversation matching (mode, search) to
--    one agent, entirely server-side, so "select all N → assign" ships zero
--    ids over the wire. DM singleton + already-owned rows are skipped by
--    ON CONFLICT DO NOTHING (same semantics as admin_assign_conversations).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function whatsapp.admin_assign_by_filter(
  p_instance_id uuid,
  p_mode        text,
  p_search      text,
  p_user_id     uuid
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_count integer;
begin
  if not whatsapp.is_wa_admin(p_instance_id) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  perform set_config('whatsapp.audit_assign_suppress', '1', true);

  with ins as (
    insert into whatsapp.conversation_assignments (conversation_id, user_id, assigned_by)
    select c.id, p_user_id, auth.uid()
    from whatsapp.conversations c
    left join whatsapp.contacts ct on ct.id = c.contact_id
    where c.instance_id  = p_instance_id
      and c.merged_into  is null
      and c.remote_jid   not like '%@lid'
      and c.remote_jid   not like '%@broadcast'
      and c.remote_jid   not like '%@newsletter'
      and c.is_archived  = false
      and c.status       in ('open', 'pending')
      and (
            p_mode = 'all'
        or (p_mode = 'dms'    and c.is_group = false)
        or (p_mode = 'groups' and c.is_group = true)
        or (p_mode = 'unassigned' and not exists (
              select 1 from whatsapp.conversation_assignments a where a.conversation_id = c.id))
        or (p_mode = 'one'  and (
              select count(*) from whatsapp.conversation_assignments a where a.conversation_id = c.id) = 1)
        or (p_mode = 'many' and (
              select count(*) from whatsapp.conversation_assignments a where a.conversation_id = c.id) >= 2)
      )
      and (
            p_search is null or p_search = ''
        or c.peer_display_name ilike '%' || p_search || '%'
        or c.remote_jid        ilike '%' || p_search || '%'
        or ct.book_name        ilike '%' || p_search || '%'
      )
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  if v_count > 0 then
    perform whatsapp.audit('conversations_assigned_by_filter', 'user', p_user_id::text,
      jsonb_build_object('count', v_count, 'instance_id', p_instance_id, 'mode', p_mode));
  end if;
  return v_count;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. UNASSIGN BY FILTER — clear assignees from every conversation matching
--    (mode, search). p_user_id NULL = strip ALL assignees; non-NULL = only
--    that agent. Server-side twin of the id-list bulk unassign.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function whatsapp.admin_unassign_by_filter(
  p_instance_id uuid,
  p_mode        text,
  p_search      text,
  p_user_id     uuid default null
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_count integer;
begin
  if not whatsapp.is_wa_admin(p_instance_id) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  perform set_config('whatsapp.audit_assign_suppress', '1', true);

  with del as (
    delete from whatsapp.conversation_assignments a
    using whatsapp.conversations c
    left join whatsapp.contacts ct on ct.id = c.contact_id
    where a.conversation_id = c.id
      and c.instance_id  = p_instance_id
      and c.merged_into  is null
      and c.remote_jid   not like '%@lid'
      and c.remote_jid   not like '%@broadcast'
      and c.remote_jid   not like '%@newsletter'
      and c.is_archived  = false
      and c.status       in ('open', 'pending')
      and (p_user_id is null or a.user_id = p_user_id)
      and (
            p_mode = 'all'
        or (p_mode = 'dms'    and c.is_group = false)
        or (p_mode = 'groups' and c.is_group = true)
        or (p_mode = 'unassigned' and false)   -- unassigned rows have nothing to remove
        or (p_mode = 'one'  and (
              select count(*) from whatsapp.conversation_assignments a2 where a2.conversation_id = c.id) = 1)
        or (p_mode = 'many' and (
              select count(*) from whatsapp.conversation_assignments a2 where a2.conversation_id = c.id) >= 2)
      )
      and (
            p_search is null or p_search = ''
        or c.peer_display_name ilike '%' || p_search || '%'
        or c.remote_jid        ilike '%' || p_search || '%'
        or ct.book_name        ilike '%' || p_search || '%'
      )
    returning 1
  )
  select count(*) into v_count from del;

  if v_count > 0 then
    perform whatsapp.audit('conversations_unassigned_by_filter', 'user', coalesce(p_user_id::text, 'all'),
      jsonb_build_object('count', v_count, 'instance_id', p_instance_id, 'mode', p_mode));
  end if;
  return v_count;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- grants — match the existing roster RPCs.
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function whatsapp.admin_assignment_summary(uuid)                              to authenticated, service_role;
grant execute on function whatsapp.admin_assignment_page(uuid, text, text, int, timestamptz, uuid) to authenticated, service_role;
grant execute on function whatsapp.admin_assign_by_filter(uuid, text, text, uuid)              to authenticated, service_role;
grant execute on function whatsapp.admin_unassign_by_filter(uuid, text, text, uuid)            to authenticated, service_role;

commit;
