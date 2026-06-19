-- =====================================================================
-- Recurring charges: daily / monthly / yearly recurring expenses,
-- materialised into public.expenses on an OCCURRENCE basis (a real row
-- per due date). Analytics + Expenses list + audit work unchanged
-- because everything still reads public.expenses by date.
-- =====================================================================

-- 1. Definition table -------------------------------------------------
create table if not exists public.recurring_charges (
  id uuid primary key default gen_random_uuid(),
  "DigiCom Business" uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  type_id uuid references public.expense_types(id) on delete set null,
  amount numeric not null default 0 check (amount > 0),
  frequency text not null check (frequency in ('daily','monthly','yearly')),
  start_date date not null,
  end_date date,
  active boolean not null default true,
  description text,
  last_generated_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_charges_date_range check (end_date is null or end_date >= start_date)
);

create index if not exists idx_recurring_charges_business on public.recurring_charges ("DigiCom Business");
create index if not exists idx_recurring_charges_active on public.recurring_charges (active) where active;

-- 2. Link materialised occurrences back to their definition -----------
alter table public.expenses
  add column if not exists recurring_id uuid references public.recurring_charges(id) on delete set null,
  add column if not exists occurrence_date date;

-- Idempotency: at most one expense per (recurring charge, occurrence day).
-- Manual rows keep both columns NULL; NULLs are DISTINCT in Postgres so
-- unlimited manual rows are allowed and never conflict.
create unique index if not exists ux_expenses_recurring_occurrence
  on public.expenses (recurring_id, occurrence_date);
create index if not exists idx_expenses_recurring_id
  on public.expenses (recurring_id) where recurring_id is not null;

-- 3. RLS (mirror expense_types: any authenticated user; business scoping
--    is enforced client-side via the "DigiCom Business" filter, same as
--    every other table in this app).
alter table public.recurring_charges enable row level security;

create policy "Authenticated users can view recurring_charges"
  on public.recurring_charges for select
  using ((select auth.role()) = 'authenticated');
create policy "Authenticated users can insert recurring_charges"
  on public.recurring_charges for insert
  with check ((select auth.role()) = 'authenticated');
create policy "Authenticated users can update recurring_charges"
  on public.recurring_charges for update
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');
create policy "Authenticated users can delete recurring_charges"
  on public.recurring_charges for delete
  using ((select auth.role()) = 'authenticated');

-- 4. updated_at maintenance ------------------------------------------
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_recurring_charges_touch on public.recurring_charges;
create trigger trg_recurring_charges_touch
  before update on public.recurring_charges
  for each row execute function public.tg_touch_updated_at();

-- 5. Generator --------------------------------------------------------
-- Materialise every due occurrence from start_date up to p_through
-- (default = today), bounded by end_date. Idempotent: re-running only
-- inserts occurrences that are missing. p_id null => all charges.
create or replace function public.generate_recurring_charges(
  p_through date default current_date,
  p_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_total integer := 0;
  v_rows integer;
  v_end date;
begin
  for r in
    select * from public.recurring_charges
    where active = true
      and start_date <= p_through
      and (p_id is null or id = p_id)
  loop
    v_end := least(p_through, coalesce(r.end_date, p_through));
    if v_end < r.start_date then
      continue;
    end if;

    if r.frequency = 'daily' then
      insert into public.expenses
        (name, amount, type_id, date, description, "DigiCom Business", recurring_id, occurrence_date)
      select r.name, r.amount, r.type_id,
             (x.d::text || ' 12:00:00+00')::timestamptz,
             r.description, r."DigiCom Business", r.id, x.d
      from (
        select dd::date as d
        from generate_series(r.start_date, v_end, interval '1 day') g(dd)
      ) x
      on conflict (recurring_id, occurrence_date) do nothing;

    elsif r.frequency = 'monthly' then
      insert into public.expenses
        (name, amount, type_id, date, description, "DigiCom Business", recurring_id, occurrence_date)
      select r.name, r.amount, r.type_id,
             (s.occ::text || ' 12:00:00+00')::timestamptz,
             r.description, r."DigiCom Business", r.id, s.occ
      from (
        select gm.fom::date
               + (least(
                    extract(day from r.start_date)::int,
                    extract(day from (gm.fom + interval '1 month - 1 day'))::int
                  ) - 1) as occ
        from generate_series(date_trunc('month', r.start_date::timestamp),
                             date_trunc('month', v_end::timestamp),
                             interval '1 month') gm(fom)
      ) s
      where s.occ between r.start_date and v_end
      on conflict (recurring_id, occurrence_date) do nothing;

    elsif r.frequency = 'yearly' then
      insert into public.expenses
        (name, amount, type_id, date, description, "DigiCom Business", recurring_id, occurrence_date)
      select r.name, r.amount, r.type_id,
             (s.occ::text || ' 12:00:00+00')::timestamptz,
             r.description, r."DigiCom Business", r.id, s.occ
      from (
        select make_date(
                 extract(year from gy.foy)::int,
                 extract(month from r.start_date)::int,
                 least(
                   extract(day from r.start_date)::int,
                   extract(day from (
                     make_date(extract(year from gy.foy)::int,
                               extract(month from r.start_date)::int, 1)
                     + interval '1 month - 1 day'))::int
                 )
               ) as occ
        from generate_series(date_trunc('year', r.start_date::timestamp),
                             date_trunc('year', v_end::timestamp),
                             interval '1 year') gy(foy)
      ) s
      where s.occ between r.start_date and v_end
      on conflict (recurring_id, occurrence_date) do nothing;
    end if;

    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    update public.recurring_charges set last_generated_date = v_end where id = r.id;
  end loop;

  return v_total;
end;
$$;

-- 6. Sync trigger -----------------------------------------------------
-- The definition is the single source of truth. On INSERT, backfill.
-- On UPDATE, wipe + rebuild so the ledger exactly matches the current
-- amount / schedule / date range (only regenerate while active).
-- Deactivating (active=false) removes the charge from the books
-- reversibly; to STOP a charge but keep history, set end_date instead.
-- Hard-deleting the definition keeps the already-posted rows (FK SET
-- NULL) so real spend is never silently erased from past P&L.
create or replace function public.tg_recurring_charges_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.active then
      perform public.generate_recurring_charges(current_date, new.id);
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    delete from public.expenses where recurring_id = new.id;
    if new.active then
      perform public.generate_recurring_charges(current_date, new.id);
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_recurring_charges_sync on public.recurring_charges;
create trigger trg_recurring_charges_sync
  after insert or update on public.recurring_charges
  for each row execute function public.tg_recurring_charges_sync();

-- 7. Daily cron: catch up any newly-due occurrences (00:05 UTC) -------
select cron.schedule(
  'generate-recurring-charges',
  '5 0 * * *',
  $cron$select public.generate_recurring_charges(current_date);$cron$
);
