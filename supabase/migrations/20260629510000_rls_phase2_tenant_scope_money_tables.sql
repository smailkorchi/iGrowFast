-- SECURITY RLS SWEEP — PHASE 2: tenant-scope Tier-B money tables.
--
-- These gated only on `auth.role() = 'authenticated'` → any logged-in user of ANY business
-- could read/write/delete every business's financial rows (cross-tenant; anon already blocked
-- by the role check). All have a populated tenant column (0 NULLs, verified prod).
--
-- transactions / trns_payment / trns_purchase / campaign_daily_entries / campaigns:
--   per-business operational/financial tables, owner is confined out (mirrors `orders`) →
--   single FOR ALL policy scoped to "DigiCom Business" = current_user_digicom_business_id().
-- business_payments:
--   platform-billing (owner reviews/approves ALL via owner/Payments.tsx; a business submits +
--   reads its OWN via SuspensionOverlay). Owner-domain table (is_owner kept, like businesses/
--   users/providers) → scope business_id = cudbi() OR is_owner().
--
-- Verified app-safe: every consumer already filters by its own business; every INSERT payload
-- sets the tenant column (transactions/trns_*/campaigns/campaign_daily_entries → activeBusinessId;
-- business_payments → own business_id). Edge fns/crons use service_role (bypass RLS).
--
-- Rollback: recreate the original `auth.role()='authenticated'` ALL policies.

-- transactions
drop policy if exists "Enable delete access for authenticated users" on public.transactions;
drop policy if exists "Enable insert access for authenticated users" on public.transactions;
drop policy if exists "Enable read access for authenticated users"   on public.transactions;
drop policy if exists "Enable update access for authenticated users" on public.transactions;
create policy transactions_tenant_all on public.transactions
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- trns_payment
drop policy if exists "Enable all for authenticated users on trns_payment" on public.trns_payment;
create policy trns_payment_tenant_all on public.trns_payment
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- trns_purchase
drop policy if exists "Enable all for authenticated users on trns_purchase" on public.trns_purchase;
create policy trns_purchase_tenant_all on public.trns_purchase
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- campaign_daily_entries
drop policy if exists "Enable all access for authenticated users" on public.campaign_daily_entries;
create policy campaign_daily_entries_tenant_all on public.campaign_daily_entries
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- campaigns
drop policy if exists "Enable all access for authenticated users" on public.campaigns;
create policy campaigns_tenant_all on public.campaigns
  for all to authenticated
  using ("DigiCom Business" = (select public.current_user_digicom_business_id()))
  with check ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- business_payments (owner-domain: owner approves all, business submits/reads own)
drop policy if exists "Allow all for authenticated" on public.business_payments;
create policy business_payments_tenant_all on public.business_payments
  for all to authenticated
  using (business_id = (select public.current_user_digicom_business_id()) or (select public.is_owner()))
  with check (business_id = (select public.current_user_digicom_business_id()) or (select public.is_owner()));
