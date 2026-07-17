-- #44 (owner-decided 2026-07-17): split business-logos — cachet + signature
-- move to a PRIVATE bucket. business-logos stays public for plain logos.
-- Paths keep the existing 'profile/<businessId>/<kind>-<ts>.<ext>' layout.
-- Read = any authenticated member of that business (couriers render payout
-- PDFs; sellers/MBs are in-tenant) or the platform owner. Write = business
-- admins or the owner. RLS-perf rule: volatile helpers wrapped in (select …).

insert into storage.buckets (id, name, public, file_size_limit)
values ('business-stamps', 'business-stamps', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "stamps_select_business_members" on storage.objects;
create policy "stamps_select_business_members" on storage.objects
for select to authenticated
using (
  bucket_id = 'business-stamps'
  and name ~ '^profile/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  and (
    (select public.is_owner())
    or split_part(name, '/', 2)::uuid = (select public.current_user_digicom_business_id())
  )
);

drop policy if exists "stamps_write_business_admins" on storage.objects;
create policy "stamps_write_business_admins" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'business-stamps'
  and name ~ '^profile/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  and (
    (select public.is_owner())
    or (
      split_part(name, '/', 2)::uuid = (select public.current_user_digicom_business_id())
      and public.check_user_role((select auth.uid()), array['super admin', 'admin'])
    )
  )
);

drop policy if exists "stamps_update_business_admins" on storage.objects;
create policy "stamps_update_business_admins" on storage.objects
for update to authenticated
using (
  bucket_id = 'business-stamps'
  and name ~ '^profile/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  and (
    (select public.is_owner())
    or (
      split_part(name, '/', 2)::uuid = (select public.current_user_digicom_business_id())
      and public.check_user_role((select auth.uid()), array['super admin', 'admin'])
    )
  )
);

drop policy if exists "stamps_delete_business_admins" on storage.objects;
create policy "stamps_delete_business_admins" on storage.objects
for delete to authenticated
using (
  bucket_id = 'business-stamps'
  and name ~ '^profile/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
  and (
    (select public.is_owner())
    or (
      split_part(name, '/', 2)::uuid = (select public.current_user_digicom_business_id())
      and public.check_user_role((select auth.uid()), array['super admin', 'admin'])
    )
  )
);
