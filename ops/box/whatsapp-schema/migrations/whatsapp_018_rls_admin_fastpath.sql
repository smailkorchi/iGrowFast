-- whatsapp_018_rls_admin_fastpath.sql
-- RLS hot-path fix (donor-latent perf bug, surfaced by the first big-history
-- number: 1k+ conversations made every inbox list query evaluate
-- whatsapp.is_wa_admin(instance_id) PER ROW — 531ms mean / 86% box CPU under
-- refetch storms; 9.8ms without RLS).
--
-- Mechanism: is_wa_admin / is_wa_admin_conv are function calls in policy
-- quals — evaluated per row, and Postgres refuses to inline them (SECURITY
-- DEFINER blocks inlining; and a body containing a sub-SELECT blocks scalar
-- inlining even as INVOKER — verified live). Fix = rewrite the policy quals
-- themselves to the uncorrelated form
--   <col> IN (select whatsapp.admin_*_ids())
-- which the planner executes ONCE per query as a hashed SubPlan. The rewrite
-- is generated mechanically from pg_policy (regex on the deparsed qual), so
-- all affected policies get the same transform with zero hand-typing.
-- The is_wa_admin(_conv) functions stay (RPC guards call them once per call —
-- fine); they are re-pointed at the definer set-functions for consistency.
--
-- Same law as the 2026-06-29 public-schema RLS perf sweep.
-- Run: ssh igf 'docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1' < this-file

begin;

-- ── definer set-functions: evaluated once per statement ─────────────────────
create or replace function whatsapp.admin_instance_ids()
returns setof uuid
language sql
stable security definer
set search_path to ''
as $$
  select i.id
  from whatsapp.whatsapp_instances i
  where public.current_user_is_business_admin()
    and i.business_id = public.current_user_digicom_business_id();
$$;

create or replace function whatsapp.admin_conversation_ids()
returns setof uuid
language sql
stable security definer
set search_path to ''
as $$
  select c.id
  from whatsapp.conversations c
  where c.instance_id in (select whatsapp.admin_instance_ids());
$$;

revoke all on function whatsapp.admin_instance_ids() from public, anon;
revoke all on function whatsapp.admin_conversation_ids() from public, anon;
grant execute on function whatsapp.admin_instance_ids() to authenticated, service_role;
grant execute on function whatsapp.admin_conversation_ids() to authenticated, service_role;

-- ── inlinable invoker wrappers (same signatures, same semantics) ─────────────
-- NO "set search_path" (blocks inlining) → body fully schema-qualified.
create or replace function whatsapp.is_wa_admin(p_instance_id uuid)
returns boolean
language sql
stable
as $$
  select p_instance_id in (select whatsapp.admin_instance_ids());
$$;

create or replace function whatsapp.is_wa_admin_conv(p_conversation_id uuid)
returns boolean
language sql
stable
as $$
  select p_conversation_id in (select whatsapp.admin_conversation_ids());
$$;

-- ── rewrite every policy USING-qual that calls the per-row functions ─────────
-- whatsapp.is_wa_admin(<col>)      → (<col> IN (select whatsapp.admin_instance_ids()))
-- whatsapp.is_wa_admin_conv(<col>) → (<col> IN (select whatsapp.admin_conversation_ids()))
do $mig$
declare
  r record;
  newqual text;
begin
  for r in
    select p.oid, p.polname, p.polrelid::regclass as tbl,
           pg_get_expr(p.polqual, p.polrelid) as qual
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'whatsapp'
      and pg_get_expr(p.polqual, p.polrelid) ~ 'is_wa_admin'
  loop
    newqual := regexp_replace(
                 r.qual,
                 'whatsapp\.is_wa_admin_conv\(([a-z_\.]+)\)',
                 '(\1 IN (SELECT whatsapp.admin_conversation_ids()))',
                 'g');
    newqual := regexp_replace(
                 newqual,
                 'whatsapp\.is_wa_admin\(([a-z_\.]+)\)',
                 '(\1 IN (SELECT whatsapp.admin_instance_ids()))',
                 'g');
    execute format('alter policy %I on %s using (%s)', r.polname, r.tbl, newqual);
    raise notice 'rewrote % on %', r.polname, r.tbl;
  end loop;
end
$mig$;

commit;

-- Verify (impersonated admin):
--   explain analyze select * from whatsapp.conversations_decrypted
--   where instance_id = '<id>' order by last_message_at desc limit 50;
-- Expect hashed SubPlans over admin_*_ids(), no per-row is_wa_admin calls.
