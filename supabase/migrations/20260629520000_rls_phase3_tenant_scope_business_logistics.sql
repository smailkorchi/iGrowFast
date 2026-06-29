-- SECURITY RLS SWEEP — PHASE 3: tenant-scope Tier-B business/logistics tables.
--
-- 17 tables gated only on `auth.role()='authenticated'` (or 'Enable all'/'manage') = any
-- logged-in user of ANY business could read/write/delete every business's rows (cross-tenant;
-- anon already blocked by the role check). All have a populated "DigiCom Business" column
-- (0 NULLs across all 17, incl. order_items 4828 / order_status_history 7868 — verified prod).
-- Owner is confined out of these per the owner-confinement model (mirrors `orders`).
--
-- FIX: single FOR ALL policy TO authenticated scoped to
--   "DigiCom Business" = current_user_digicom_business_id().
-- App-safe: every consumer already filters by its own business; every INSERT path populates
-- "DigiCom Business" (proven by the 0-NULL invariant + explicit payloads); the
-- order_status_history auto-log trigger is SECURITY DEFINER (bypasses RLS). Couriers read
-- courier_* tables filtered by their own business already (courier/Payments.tsx), so a
-- same-business tenant scope is a superset of what they display. Edge/cron use service_role.
--
-- Rollback: recreate the original generic 'authenticated' policies.

-- customers
drop policy if exists "Allow authenticated users to delete customers" on public.customers;
drop policy if exists "Allow authenticated users to insert customers" on public.customers;
drop policy if exists "Allow authenticated users to read customers"   on public.customers;
drop policy if exists "Allow authenticated users to update customers" on public.customers;
create policy customers_tenant_all on public.customers
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- products
drop policy if exists "Authenticated users can delete products" on public.products;
drop policy if exists "Authenticated users can insert products" on public.products;
drop policy if exists "Authenticated users can view products"   on public.products;
drop policy if exists "Authenticated users can update products" on public.products;
create policy products_tenant_all on public.products
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- expenses
drop policy if exists "Authenticated users can delete expenses" on public.expenses;
drop policy if exists "Authenticated users can insert expenses" on public.expenses;
drop policy if exists "Authenticated users can view expenses"   on public.expenses;
drop policy if exists "Authenticated users can update expenses" on public.expenses;
create policy expenses_tenant_all on public.expenses
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- expense_types
drop policy if exists "Authenticated users can delete expense_types" on public.expense_types;
drop policy if exists "Authenticated users can insert expense_types" on public.expense_types;
drop policy if exists "Authenticated users can view expense_types"   on public.expense_types;
drop policy if exists "Authenticated users can update expense_types" on public.expense_types;
create policy expense_types_tenant_all on public.expense_types
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- recurring_charges
drop policy if exists "Authenticated users can delete recurring_charges" on public.recurring_charges;
drop policy if exists "Authenticated users can insert recurring_charges" on public.recurring_charges;
drop policy if exists "Authenticated users can view recurring_charges"   on public.recurring_charges;
drop policy if exists "Authenticated users can update recurring_charges" on public.recurring_charges;
create policy recurring_charges_tenant_all on public.recurring_charges
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- sales_channels
drop policy if exists "Authenticated users can delete sales_channels" on public.sales_channels;
drop policy if exists "Authenticated users can insert sales_channels" on public.sales_channels;
drop policy if exists "Authenticated users can view sales_channels"   on public.sales_channels;
drop policy if exists "Authenticated users can update sales_channels" on public.sales_channels;
create policy sales_channels_tenant_all on public.sales_channels
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- ads_history
drop policy if exists "Enable all access for authenticated users" on public.ads_history;
create policy ads_history_tenant_all on public.ads_history
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- seller_presences
drop policy if exists "Authenticated users can delete seller_presences" on public.seller_presences;
drop policy if exists "Authenticated users can insert seller_presences" on public.seller_presences;
drop policy if exists "Authenticated users can select seller_presences" on public.seller_presences;
drop policy if exists "Authenticated users can update seller_presences" on public.seller_presences;
create policy seller_presences_tenant_all on public.seller_presences
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- company_fees
drop policy if exists "Enable all for authenticated users" on public.company_fees;
create policy company_fees_tenant_all on public.company_fees
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- company_zones
drop policy if exists "Enable all for authenticated users" on public.company_zones;
create policy company_zones_tenant_all on public.company_zones
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- courier_fees
drop policy if exists "Enable all for authenticated users" on public.courier_fees;
create policy courier_fees_tenant_all on public.courier_fees
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- courier_zones
drop policy if exists "Enable all for authenticated users" on public.courier_zones;
create policy courier_zones_tenant_all on public.courier_zones
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- courier_delivery_notes
drop policy if exists "Authenticated users can manage courier delivery notes" on public.courier_delivery_notes;
create policy courier_delivery_notes_tenant_all on public.courier_delivery_notes
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- courier_return_notes
drop policy if exists "Authenticated users can manage courier return notes" on public.courier_return_notes;
create policy courier_return_notes_tenant_all on public.courier_return_notes
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- courier_return_note_orders
drop policy if exists "Authenticated users can manage courier return note orders" on public.courier_return_note_orders;
create policy courier_return_note_orders_tenant_all on public.courier_return_note_orders
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- order_items
drop policy if exists "Allow authenticated users to delete order_items" on public.order_items;
drop policy if exists "Allow authenticated users to insert order_items" on public.order_items;
drop policy if exists "Allow authenticated users to read order_items"   on public.order_items;
drop policy if exists "Allow authenticated users to update order_items" on public.order_items;
create policy order_items_tenant_all on public.order_items
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- order_status_history
drop policy if exists "Allow authenticated users to delete order_status_history" on public.order_status_history;
drop policy if exists "Allow authenticated users to insert order_status_history" on public.order_status_history;
drop policy if exists "Allow authenticated users to read order_status_history"   on public.order_status_history;
drop policy if exists "Allow authenticated users to update order_status_history" on public.order_status_history;
create policy order_status_history_tenant_all on public.order_status_history
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));
