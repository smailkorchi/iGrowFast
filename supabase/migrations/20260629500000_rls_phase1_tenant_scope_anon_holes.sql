-- SECURITY RLS SWEEP — PHASE 1: close 6 LIVE anon read/write/delete holes.
--
-- These 6 tables had RLS policies whose predicate was
--   ((select auth.uid()) IS NOT NULL) OR ((select auth.role()) = 'anon')
-- i.e. TRUE for anon AND for every authenticated user of ANY business. Combined with the
-- Supabase clone default that grants `anon` full DML on every table, the public anon key
-- (shipped in the frontend bundle) could GET/POST/PATCH/DELETE these across ALL businesses,
-- and any logged-in user could do the same cross-tenant.
--
-- FIX: replace each table's policy set with the proven `orders`/`company_parcels` tenant
-- pattern — a single FOR ALL policy TO authenticated scoped to the caller's own business via
-- the denormalized "DigiCom Business" column (verified populated on every row, 0 NULLs).
-- Behavior-preserving for the app: every consumer (admin finance pages, courier/Payments,
-- seller/Accessories) already filters by its own business; edge fns/crons use service_role
-- and bypass RLS. After this, role='anon' fails (TO authenticated) and cross-tenant fails.
--
-- Rollback: recreate the original `(uid IS NOT NULL OR role='anon')` policies (do not).

-- accessories
drop policy if exists "Users can delete accessories for their business" on public.accessories;
drop policy if exists "Users can insert accessories for their business" on public.accessories;
drop policy if exists "Users can view accessories for their business"   on public.accessories;
drop policy if exists "Users can update accessories for their business" on public.accessories;
create policy accessories_tenant_all on public.accessories
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- product_accessories
drop policy if exists "Users can delete product_accessories" on public.product_accessories;
drop policy if exists "Users can insert product_accessories" on public.product_accessories;
drop policy if exists "Users can view product_accessories"   on public.product_accessories;
drop policy if exists "Users can update product_accessories" on public.product_accessories;
create policy product_accessories_tenant_all on public.product_accessories
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- company_payment_notes
drop policy if exists "Users can delete company_payment_notes for their business" on public.company_payment_notes;
drop policy if exists "Users can insert company_payment_notes for their business" on public.company_payment_notes;
drop policy if exists "Users can view company_payment_notes for their business"   on public.company_payment_notes;
drop policy if exists "Users can update company_payment_notes for their business" on public.company_payment_notes;
create policy company_payment_notes_tenant_all on public.company_payment_notes
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- company_payment_note_orders
drop policy if exists "Users can delete company_payment_note_orders for their business" on public.company_payment_note_orders;
drop policy if exists "Users can insert company_payment_note_orders for their business" on public.company_payment_note_orders;
drop policy if exists "Users can view company_payment_note_orders for their business"   on public.company_payment_note_orders;
drop policy if exists "Users can update company_payment_note_orders for their business" on public.company_payment_note_orders;
create policy company_payment_note_orders_tenant_all on public.company_payment_note_orders
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- courier_payment_notes (INSERT was already scoped; unify under one tenant policy)
drop policy if exists "Users can delete courier_payment_notes for their business" on public.courier_payment_notes;
drop policy if exists "courier_payment_notes_ins" on public.courier_payment_notes;
drop policy if exists "Users can view courier_payment_notes for their business"   on public.courier_payment_notes;
drop policy if exists "Users can update courier_payment_notes for their business" on public.courier_payment_notes;
create policy courier_payment_notes_tenant_all on public.courier_payment_notes
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- courier_payment_note_orders (INSERT was already scoped; unify under one tenant policy)
drop policy if exists "Users can delete courier_payment_note_orders for their business" on public.courier_payment_note_orders;
drop policy if exists "courier_payment_note_orders_ins" on public.courier_payment_note_orders;
drop policy if exists "Users can view courier_payment_note_orders for their business"   on public.courier_payment_note_orders;
drop policy if exists "Users can update courier_payment_note_orders for their business" on public.courier_payment_note_orders;
create policy courier_payment_note_orders_tenant_all on public.courier_payment_note_orders
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));
