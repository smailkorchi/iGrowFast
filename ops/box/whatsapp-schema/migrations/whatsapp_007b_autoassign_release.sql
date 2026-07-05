-- whatsapp_007b_autoassign_release  (Wave 7b-1) — auto-assign + DM release automation
-- TARGET: LIVE box .102 self-host Postgres ONLY (ssh igf -> docker exec supabase-db psql -U postgres).
-- Completes the two decided L1 rewrites deferred from wave 7:
--   1. Auto-assign round-robin over the per-number seller pool. Source ordered by
--      profiles.last_auto_assigned_at (dropped) -> new whatsapp.agent_assign_cursor (owner-chosen:
--      faithful time-based RR). Pre-filters to SAME-business + role='commercial' + active + login-capable
--      so the same-business guard never rejects an auto-assignment.
--   2. _release_dms_on_profile_deactivation re-hung on public.users (core table) AFTER UPDATE OF active.

-- ============================================================ agent_assign_cursor (deny-all)
create table whatsapp.agent_assign_cursor (
  user_id               uuid not null,
  last_auto_assigned_at timestamptz not null default now(),
  constraint agent_assign_cursor_pkey primary key (user_id),
  constraint agent_assign_cursor_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
alter table whatsapp.agent_assign_cursor enable row level security;
revoke all on table whatsapp.agent_assign_cursor from public;
-- deny-all: RLS on, zero policies, no client grants (only the SECDEF auto-assign trigger touches it).

-- ============================================================ _auto_assign_on_inbound (L1 rewrite)
create or replace function whatsapp._auto_assign_on_inbound()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_conv    whatsapp.conversations;
  v_inst    whatsapp.whatsapp_instances;
  v_user_id uuid;
  v_book    text;
begin
  if NEW.whatsapp_timestamp < now() - interval '2 minutes' then return NEW; end if;

  select * into v_conv from whatsapp.conversations where id = NEW.conversation_id;
  if not found or v_conv.is_group then return NEW; end if;

  -- Resolution gate: unresolved @lid stays untouched
  if v_conv.remote_jid like '%@lid' then
    select book_name into v_book from whatsapp.contacts where id = v_conv.contact_id;
    if v_book is null then return NEW; end if;
  end if;

  select * into v_inst from whatsapp.whatsapp_instances where id = NEW.instance_id;
  if not found or not v_inst.auto_assign_enabled then return NEW; end if;
  if array_length(v_inst.auto_assign_user_pool, 1) is null then return NEW; end if;

  if exists (select 1 from whatsapp.conversation_assignments where conversation_id = NEW.conversation_id) then
    return NEW;
  end if;

  -- least-recently auto-assigned SELLER (commercial) of the SAME business, active + login-capable
  select u.id into v_user_id
  from public.users u
  left join whatsapp.agent_assign_cursor ac on ac.user_id = u.id
  where u.id = any (v_inst.auto_assign_user_pool)
    and coalesce(u.active, true) = true
    and u.role = 'commercial'
    and u."DigiCom Business" = v_inst.business_id
    and exists (select 1 from auth.users a where a.id = u.id)
  order by coalesce(ac.last_auto_assigned_at, 'epoch'::timestamptz) asc, u.id asc
  limit 1;

  if v_user_id is null then return NEW; end if;

  insert into whatsapp.conversation_assignments (conversation_id, user_id, assigned_by, is_group)
  values (NEW.conversation_id, v_user_id, v_user_id, false)
  on conflict do nothing;

  insert into whatsapp.agent_assign_cursor (user_id, last_auto_assigned_at)
  values (v_user_id, now())
  on conflict (user_id) do update set last_auto_assigned_at = now();

  return NEW;
end;
$function$;
revoke all on function whatsapp._auto_assign_on_inbound() from public;
grant  execute on function whatsapp._auto_assign_on_inbound() to service_role;

create trigger messages_auto_assign_on_inbound after insert on whatsapp.messages
  for each row when (new.direction = 'inbound'::whatsapp.message_direction)
  execute function whatsapp._auto_assign_on_inbound();

-- ============================================================ _release_dms_on_profile_deactivation (L1)
create or replace function whatsapp._release_dms_on_profile_deactivation()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  -- iGrowFast uses public.users.active (nullable); fire on active -> false
  if NEW.active = false and OLD.active is distinct from false then
    delete from whatsapp.conversation_assignments
     where user_id = NEW.id and is_group = false;
  end if;
  return NEW;
end;
$function$;
revoke all on function whatsapp._release_dms_on_profile_deactivation() from public;
grant  execute on function whatsapp._release_dms_on_profile_deactivation() to service_role;

-- core-table trigger (owner-approved): release a seller's DM assignments on deactivation.
create trigger whatsapp_release_dms_on_deactivation after update of active on public.users
  for each row execute function whatsapp._release_dms_on_profile_deactivation();
