-- TKT-5: providers must be attributed (company_zones) to the hub/zone covering
-- the order's city. UI filters were leaking uncovered providers; this guard makes
-- the rule hold on every write path (modals, batch parcels, exchanges, stale clients).
-- Enforces only when company_id/master_city_id actually change, so pre-existing
-- rows (one known legacy violation) stay editable through full-payload updates.

create or replace function public.enforce_order_provider_coverage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone uuid;
  v_provider_biz uuid;
begin
  -- full-payload updates that don't actually change any guarded column pass through
  if tg_op = 'UPDATE'
     and new.company_id is not distinct from old.company_id
     and new.master_city_id is not distinct from old.master_city_id
     and new."DigiCom Business" is not distinct from old."DigiCom Business" then
    return new;
  end if;

  if new.company_id is null or new.master_city_id is null then
    return new;
  end if;

  -- provider must belong to the order's business (cross-tenant guard)
  if new."DigiCom Business" is not null then
    select "DigiCom Business" into v_provider_biz
    from public.providers where id = new.company_id;
    if v_provider_biz is distinct from new."DigiCom Business" then
      raise exception 'provider belongs to a different business'
        using errcode = '23514';
    end if;
  end if;

  select zone_id into v_zone from public.master_cities where id = new.master_city_id;

  -- city not attached to any hub: no attribution is possible, nothing to enforce
  if v_zone is null then
    return new;
  end if;

  if not exists (
    select 1 from public.company_zones cz
    where cz.company_id = new.company_id
      and cz.zone_id = v_zone
  ) then
    raise exception 'provider not attributed to the hub covering this city'
      using errcode = '23514',
            hint = 'Attach the provider to the city''s hub in company_zones, or pick a covered provider.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_provider_coverage on public.orders;
create trigger trg_order_provider_coverage
  before insert or update of company_id, master_city_id, "DigiCom Business" on public.orders
  for each row
  execute function public.enforce_order_provider_coverage();
