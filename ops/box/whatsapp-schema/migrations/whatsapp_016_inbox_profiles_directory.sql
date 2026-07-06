-- whatsapp_016_inbox_profiles_directory.sql
-- Backend closure for UI page 2 (inbox). Two objects the recon proved missing:
--
--   1. whatsapp.profiles — the WA Mancer agent-directory contract as a
--      business-scoped view over public.users (identity adaptation layer).
--      Consumed by usersApi.listProfiles → useProfiles → assignment picker,
--      InfoPane assignees, CreatorBadge, unassign-scheduled safety modal.
--   2. whatsapp.admin_apply_auto_assign_backlog — the one assignment RPC the
--      schema port missed. 1:1 port of WA Mancer's function, adapted to IGF
--      identity exactly like whatsapp._auto_assign_on_inbound (public.users,
--      role='commercial', business match, agent_assign_cursor round-robin).
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

-- ---------------------------------------------------------------------------
-- 1) Directory view.
--    WA Mancer contract: profiles(id, email, full_name, role, is_active,
--    avatar_config, created_at) with RLS asymmetry — admins resolve every
--    profile, agents resolve only themselves (CreatorBadge admin-gating
--    depends on it: agents seeing only self ⇒ badges hidden).
--    IGF adaptation (blueprint DECISION #2 + owner-confinement):
--      • scoped to the caller's business ("DigiCom Business");
--      • agents = sellers ('commercial') only; MB/couriers invisible;
--      • role emitted in WA's exact value space: 'admin' | 'user'
--        ({'super admin','admin'} → 'admin' — parity with
--        public.current_user_is_business_admin());
--      • owner has NULL business ⇒ resolves nothing (confinement preserved).
--    DEFINER-style view (owner bypasses public.users RLS; the WHERE clause IS
--    the policy — same pattern as the *_decrypted views).
-- ---------------------------------------------------------------------------
create or replace view whatsapp.profiles
with (security_barrier) as
select u.id,
       u.email,
       u.name as full_name,
       case when u.role in ('super admin','admin') then 'admin' else 'user' end as role,
       coalesce(u.active, true) as is_active,
       u.avatar_config,
       u.created_at
from public.users u
where u."DigiCom Business" = public.current_user_digicom_business_id()
  and u.role in ('super admin','admin','commercial')
  and (public.current_user_is_business_admin() or u.id = auth.uid());

revoke all on whatsapp.profiles from public, anon;
grant select on whatsapp.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Backlog auto-assign RPC (Assignment page "apply to backlog" button; the
--    module ships with the inbox bundle). WA source: public.admin_apply_auto_
--    assign_backlog @ xlhlezgpgrypdijynmqr. Adaptations, mirroring
--    _auto_assign_on_inbound: is_admin() → is_wa_admin(instance); profiles
--    pool-pick → public.users (active, 'commercial', same business, real auth
--    user); last_auto_assigned_at → whatsapp.agent_assign_cursor upsert.
-- ---------------------------------------------------------------------------
create or replace function whatsapp.admin_apply_auto_assign_backlog(p_instance_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_inst     whatsapp.whatsapp_instances;
  v_user_id  uuid;
  v_count    integer := 0;
  v_conv_id  uuid;
begin
  if not whatsapp.is_wa_admin(p_instance_id) then
    raise exception 'forbidden: admin required' using errcode = '42501';
  end if;

  select * into v_inst from whatsapp.whatsapp_instances where id = p_instance_id;
  if not found then
    raise exception 'instance_not_found' using errcode = 'P0002';
  end if;
  if not v_inst.auto_assign_enabled
     or array_length(v_inst.auto_assign_user_pool, 1) is null then
    return 0;
  end if;

  for v_conv_id in
    select c.id
      from whatsapp.conversations c
      left join whatsapp.contacts ct                 on ct.id = c.contact_id
      left join whatsapp.conversation_assignments ca on ca.conversation_id = c.id
     where c.instance_id = p_instance_id
       and c.is_group    = false
       and c.is_archived = false
       and c.status in ('open','pending')
       and ca.conversation_id is null
       and c.remote_jid not like '%@broadcast'
       and c.remote_jid not like '%@newsletter'
       and (
         c.remote_jid like '%@s.whatsapp.net'
         or ct.book_name is not null
       )
     order by c.last_message_at asc nulls last
  loop
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

    exit when v_user_id is null;

    insert into whatsapp.conversation_assignments (conversation_id, user_id, assigned_by, is_group)
    values (v_conv_id, v_user_id, v_user_id, false)
    on conflict do nothing;

    insert into whatsapp.agent_assign_cursor (user_id, last_auto_assigned_at)
    values (v_user_id, now())
    on conflict (user_id) do update set last_auto_assigned_at = now();

    v_count := v_count + 1;
  end loop;

  perform whatsapp.audit(
    'auto_assign_backlog_applied', 'whatsapp_instance', p_instance_id::text,
    jsonb_build_object('count', v_count)
  );

  return v_count;
end;
$function$;

revoke all on function whatsapp.admin_apply_auto_assign_backlog(uuid) from public, anon;
grant execute on function whatsapp.admin_apply_auto_assign_backlog(uuid) to authenticated;

commit;

-- Verify:
--   select count(*) from whatsapp.profiles;                       -- as an admin JWT: business directory
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='whatsapp' and proname='admin_apply_auto_assign_backlog';
