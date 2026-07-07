-- whatsapp_017_profiles_avatar_url.sql
-- Directory view emits the IGF photo avatar (public.users.avatar_url).
--
-- WA Mancer users have no photo avatars — its profiles carry only a
-- react-nice-avatar jsonb (avatar_config) picked at onboarding, so every
-- directory surface (assign modal, creator badges, agent-typing strip)
-- rendered a cartoon. IGF users have real uploaded photos with the canonical
-- precedence photo → config → initials (src/components/users/UserAvatar.tsx).
-- Identity-adaptation seam: the view must expose avatar_url so the inbox can
-- honor that precedence. Appended LAST — create or replace view only allows
-- adding columns at the end.
--
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

create or replace view whatsapp.profiles
with (security_barrier) as
select u.id,
       u.email,
       u.name as full_name,
       case when u.role in ('super admin','admin') then 'admin' else 'user' end as role,
       coalesce(u.active, true) as is_active,
       u.avatar_config,
       u.created_at,
       u.avatar_url
from public.users u
where u."DigiCom Business" = public.current_user_digicom_business_id()
  and u.role in ('super admin','admin','commercial')
  and (public.current_user_is_business_admin() or u.id = auth.uid());

-- Grants survive create-or-replace (016 already set them); restated for
-- idempotence if this file ever runs on a fresh schema.
revoke all on whatsapp.profiles from public, anon;
grant select on whatsapp.profiles to authenticated;

commit;

-- Verify:
--   select id, full_name, avatar_url from whatsapp.profiles limit 5;
