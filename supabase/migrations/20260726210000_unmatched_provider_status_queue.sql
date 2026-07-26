-- TKT-6: capture provider webhook statuses that match nothing in the status book,
-- surface them for owner mapping, and apply mappings retroactively.
-- provider-webhook no-match branch: stamps company_parcels.raw_provider_status and
-- upserts the queue via log_unmatched_provider_status (service_role). Owner maps via
-- resolve_unmatched_provider_status: extends the master's delivery_service_statuses
-- list, backfills parcels sitting on that raw status (sync triggers cascade to
-- orders), and marks the queue row resolved.

-- 1. raw marker on provider parcels (planned in the 2026-06 status sweep, never landed)
alter table public.company_parcels
  add column if not exists raw_provider_status text;

create index if not exists idx_company_parcels_raw_status
  on public.company_parcels (lower(raw_provider_status))
  where raw_provider_status is not null;

-- 2. the queue
create table if not exists public.unmatched_provider_statuses (
  id uuid primary key default gen_random_uuid(),
  provider_type text not null,
  raw_status text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  hit_count integer not null default 1,
  resolved_at timestamptz,
  resolved_status_id uuid references public.package_statuses(id),
  resolved_by uuid
);

create unique index if not exists unmatched_provider_statuses_key
  on public.unmatched_provider_statuses (provider_type, lower(raw_status));

alter table public.unmatched_provider_statuses enable row level security;

create policy "Owner all unmatched_provider_statuses"
  on public.unmatched_provider_statuses
  for all to authenticated
  using ((select is_owner()))
  with check ((select is_owner()));

grant select, insert, update, delete on public.unmatched_provider_statuses to authenticated;
revoke all on public.unmatched_provider_statuses from anon;

-- 3. webhook-side upsert (service_role only; atomic on the expression unique index)
create or replace function public.log_unmatched_provider_status(p_provider_type text, p_raw_status text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.unmatched_provider_statuses (provider_type, raw_status)
  select p_provider_type, p_raw_status
  where coalesce(btrim(p_provider_type), '') <> ''
    and coalesce(btrim(p_raw_status), '') <> ''
  on conflict (provider_type, lower(raw_status)) do update
    set last_seen = now(),
        hit_count = unmatched_provider_statuses.hit_count + 1,
        resolved_at = null,
        resolved_status_id = null,
        resolved_by = null;
$$;

revoke all on function public.log_unmatched_provider_status(text, text) from public;
revoke all on function public.log_unmatched_provider_status(text, text) from anon, authenticated;
grant execute on function public.log_unmatched_provider_status(text, text) to service_role;

-- 4. owner-side resolve: map + retro-apply + close, atomically
create or replace function public.resolve_unmatched_provider_status(p_unmatched_id uuid, p_status_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.unmatched_provider_statuses%rowtype;
  v_master public.package_statuses%rowtype;
  v_conflict_label text;
  v_already_mapped boolean;
  v_parcels integer := 0;
  v_added boolean := false;
begin
  if not (select public.is_owner()) then
    raise exception 'resolve_unmatched_provider_status: owner only';
  end if;

  select * into v_row from public.unmatched_provider_statuses
   where id = p_unmatched_id for update;
  if not found then
    raise exception 'unmatched status not found';
  end if;
  if v_row.resolved_at is not null then
    raise exception 'unmatched status already resolved';
  end if;

  select * into v_master from public.package_statuses where id = p_status_id;
  if not found then
    raise exception 'target package status not found';
  end if;

  -- the raw string must not already belong to a DIFFERENT master: two claimants
  -- would let match_package_status pick by semantic priority, not owner intent
  select ps.label into v_conflict_label
  from public.package_statuses ps
  where ps.id <> p_status_id
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(ps.delivery_service_statuses, '[]'::jsonb)) as v(val)
      where lower(extensions.unaccent(v.val)) = lower(extensions.unaccent(v_row.raw_status))
    )
  limit 1;
  if v_conflict_label is not null then
    raise exception 'raw status "%" is already mapped to status "%" — attach it there, or remove that mapping first', v_row.raw_status, v_conflict_label;
  end if;

  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_master.delivery_service_statuses, '[]'::jsonb)) as v(val)
    where lower(extensions.unaccent(v.val)) = lower(extensions.unaccent(v_row.raw_status))
  ) into v_already_mapped;

  if not v_already_mapped then
    update public.package_statuses
       set delivery_service_statuses = coalesce(delivery_service_statuses, '[]'::jsonb) || to_jsonb(v_row.raw_status)
     where id = p_status_id;
    v_added := true;
  end if;

  -- retro-apply: parcels still sitting on this raw status take the mapped master;
  -- the parcel->order sync triggers cascade the rest (date_livraison, unpaid, stock)
  update public.company_parcels cp
     set status_id = p_status_id,
         raw_provider_status = null,
         updated_at = now()
   where cp.raw_provider_status is not null
     and lower(extensions.unaccent(cp.raw_provider_status)) = lower(extensions.unaccent(v_row.raw_status))
     and cp.status_id is distinct from p_status_id;
  get diagnostics v_parcels = row_count;

  update public.unmatched_provider_statuses
     set resolved_at = now(),
         resolved_status_id = p_status_id,
         resolved_by = auth.uid()
   where id = p_unmatched_id;

  return jsonb_build_object('parcels_updated', v_parcels, 'mapping_added', v_added);
end;
$$;

revoke all on function public.resolve_unmatched_provider_status(uuid, uuid) from public;
revoke all on function public.resolve_unmatched_provider_status(uuid, uuid) from anon;
grant execute on function public.resolve_unmatched_provider_status(uuid, uuid) to authenticated;
