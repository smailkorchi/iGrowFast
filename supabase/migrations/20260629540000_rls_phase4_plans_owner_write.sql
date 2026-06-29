-- SECURITY RLS SWEEP — PHASE 4: plans — restrict writes to owner.
--
-- plans (global pricing/subscription table, no tenant column) had a single
-- `Allow all for authenticated` ALL policy → ANY authenticated user (seller/courier/
-- mediabuyer) could INSERT/UPDATE/DELETE pricing plans, not just the platform owner.
--
-- FIX (mirror platform_settings): keep read open to authenticated (plans are global,
-- non-sensitive; all businesses share them; anon was already blocked by the role check so
-- read behavior is unchanged), restrict every write to is_owner(). The only write path in
-- the app is owner/Plans.tsx (owner-only page); all readers are owner pages today.
--
-- Rollback: drop the 4 policies, recreate `Allow all for authenticated` FOR ALL.

drop policy if exists "Allow all for authenticated" on public.plans;

create policy plans_authenticated_read on public.plans
  for select to authenticated
  using (true);

create policy plans_owner_insert on public.plans
  for insert to authenticated
  with check ((select public.is_owner()));

create policy plans_owner_update on public.plans
  for update to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

create policy plans_owner_delete on public.plans
  for delete to authenticated
  using ((select public.is_owner()));
