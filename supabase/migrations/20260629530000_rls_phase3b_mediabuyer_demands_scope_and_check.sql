-- SECURITY RLS SWEEP — PHASE 3b: mediabuyer_demands — tenant/role scope + fix broken CHECK.
--
-- Two defects on one table:
-- (1) RLS was a single wide-open `auth.role()='authenticated'` ALL policy = any logged-in user
--     of any business could read/write every business's media-buyer demands (cross-tenant).
-- (2) DATA BUG (Tier-3): status CHECK was ('open','in_progress','resolved','closed') but the
--     frontend INSERTs 'pending' (mediabuyer/Demands.tsx) and admin sets 'dismissed'
--     (admin/Demands.tsx) → every insert + dismiss 400s → the feature is fully broken (0 rows).
--     The working twin seller_demands uses ('pending','in_progress','resolved','dismissed').
--
-- FIX: mirror the seller_demands policy set exactly (mediabuyer_id replaces seller_id) and
-- re-point the CHECK to the canonical vocab. Table is empty (0 rows) → CHECK swap is pure DDL.
--
-- Rollback: restore the old CHECK + the single 'Enable all access for authenticated users' ALL policy.

-- (2) fix the broken status vocab + realign the column default (was 'open', which the new
-- CHECK rejects → any insert omitting status would fail; frontend sets 'pending' explicitly).
alter table public.mediabuyer_demands drop constraint if exists mediabuyer_demands_status_check;
alter table public.mediabuyer_demands alter column status set default 'pending'::text;
alter table public.mediabuyer_demands add constraint mediabuyer_demands_status_check
  check (status = any (array['pending'::text,'in_progress'::text,'resolved'::text,'dismissed'::text]));

-- (1) replace wide-open RLS with the seller_demands-mirrored scoped set
drop policy if exists "Enable all access for authenticated users" on public.mediabuyer_demands;

create policy mediabuyer_demands_select_scoped on public.mediabuyer_demands
  for select to authenticated
  using (
    (mediabuyer_id = (select auth.uid()))
    or ((select public.check_user_role((select auth.uid()), array['admin'::text,'super admin'::text,'owner'::text]))
        and "DigiCom Business" = (select public.current_user_digicom_business_id()))
  );

create policy mediabuyer_demands_insert_self on public.mediabuyer_demands
  for insert to authenticated
  with check (mediabuyer_id = (select auth.uid()));

create policy mediabuyer_demands_update_admin_same_business on public.mediabuyer_demands
  for update to authenticated
  using ((select public.check_user_role((select auth.uid()), array['admin'::text,'super admin'::text,'owner'::text]))
         and "DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ((select public.check_user_role((select auth.uid()), array['admin'::text,'super admin'::text,'owner'::text]))
              and "DigiCom Business" = (select public.current_user_digicom_business_id()));

create policy mediabuyer_demands_delete_admin_same_business on public.mediabuyer_demands
  for delete to authenticated
  using ((select public.check_user_role((select auth.uid()), array['admin'::text,'super admin'::text,'owner'::text]))
         and "DigiCom Business" = (select public.current_user_digicom_business_id()));
