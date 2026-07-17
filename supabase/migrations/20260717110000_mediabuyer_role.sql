-- #45 (owner-decided 2026-07-17): dedicated `mediabuyer` Postgres role.
-- Media buyers stop sharing the `authenticated` DB role: a GoTrue custom
-- access token hook stamps role='mediabuyer' into their JWTs, and PostgREST/
-- storage switch to this role. DENY-BY-DEFAULT: the role is NOT a member of
-- `authenticated`; every grant/policy below is the complete MB surface
-- (enumerated from the task #35/#28 request maps).
-- Owner ruling: orders visibility = ATTRIBUTED ONLY (own entry-day×source
-- pairs + own ad periods). Closes: business-revenue console reads, peer spend,
-- seller earnings, products.cost_price, order_items.unit_price.
-- Config flip (GoTrue env) is a separate deploy step — this migration is inert
-- for live users until the hook is enabled.

-- ── 1. Role ────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'mediabuyer') then
    create role mediabuyer nologin;
  end if;
end $$;
alter role mediabuyer set statement_timeout = '8s';
alter role mediabuyer set idle_in_transaction_session_timeout = '60s';
grant mediabuyer to authenticator;
grant usage on schema public to mediabuyer;
grant usage on schema storage to mediabuyer;
grant usage on schema auth to mediabuyer;
grant usage on schema extensions to mediabuyer;

-- ── 2. Helper functions ────────────────────────────────────────────────────
-- Platform label → orders.source_name (the exact CASE map used by
-- mb_dashboard_stats / ads_history_metrics — keep the three in sync).
create or replace function public.mb_platform_source(p_platform text)
returns text language sql immutable set search_path to ''
as $$
  select case lower(coalesce(p_platform, ''))
    when 'whatsapp ads'  then 'whatsapp'
    when 'messenger ads' then 'messenger'
    when 'instagram ads' then 'instagram'
    when 'facebook ads'  then 'facebook'
    when 'google ads'    then 'google'
    when 'tiktok ads'    then 'tiktok'
    when 'native ads'    then 'native'
    when 'snapchat ads'  then 'snapchat'
    when 'twitter ads'   then 'twitter'
    when 'bing ads'      then 'bing'
    when 'pinterest ads' then 'pinterest'
    when 'reddit ads'    then 'reddit'
    else ''
  end;
$$;

-- Is this order attributed to the CALLING media buyer? SECURITY DEFINER so the
-- entries/ads lookups bypass RLS (no nested-policy evaluation). SUPERSET of
-- both live attribution semantics: the client keys on the UTC day slice, the
-- RPCs bucket on the Casablanca day — both admitted, so neither surface loses
-- rows. Day-granular either way: business-wide revenue stays unreadable.
create or replace function public.mb_order_attributed(p_business uuid, p_source text, p_ts timestamptz)
returns boolean language sql stable security definer set search_path to ''
as $$
  select
    exists (
      select 1 from public.campaign_daily_entries e
      where e."DigiCom Business" = p_business
        and e.created_by = (select auth.uid())
        and public.mb_platform_source(e.platform) = lower(coalesce(p_source, ''))
        and e.entry_date in ((p_ts at time zone 'UTC')::date,
                             (p_ts at time zone 'Africa/Casablanca')::date)
    )
    or exists (
      select 1 from public.ads_history ah
      where ah."DigiCom Business" = p_business
        and ah.created_by = (select auth.uid())
        and public.mb_platform_source(ah.method) = lower(coalesce(p_source, ''))
        and (
          (p_ts at time zone 'UTC')::date
            between ah.start_date and coalesce(ah.end_date, (p_ts at time zone 'UTC')::date)
          or (p_ts at time zone 'Africa/Casablanca')::date
            between ah.start_date and coalesce(ah.end_date, (p_ts at time zone 'Africa/Casablanca')::date)
        )
    );
$$;

-- Held-source labels for CampaignForm: (source, holder, holder name) for the
-- caller's business. Replaces the direct campaign_source_locks+users embed —
-- under the mediabuyer role peer users rows are unreadable, so the name comes
-- through this gated DEFINER instead. Admins use it too (one code path).
create or replace function public.mb_held_sources(p_business uuid)
returns table(source text, mediabuyer_id uuid, owner_name text)
language sql stable security definer set search_path to ''
as $$
  select l.source, l.mediabuyer_id, u.name
  from public.campaign_source_locks l
  left join public.users u on u.id = l.mediabuyer_id
  where l."DigiCom Business" = p_business
    and p_business = public.current_user_digicom_business_id();
$$;

-- GoTrue custom access token hook: stamp role='mediabuyer' for MB users,
-- leave every other user's claims untouched.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare
  v_role text;
begin
  select u.role into v_role
  from public.users u
  where u.id = (event->>'user_id')::uuid;
  if v_role = 'mediabuyer' then
    event := jsonb_set(event, '{claims,role}', to_jsonb('mediabuyer'::text));
  end if;
  return event;
end;
$$;

revoke execute on function public.mb_platform_source(text) from public, anon;
revoke execute on function public.mb_order_attributed(uuid, text, timestamptz) from public, anon;
revoke execute on function public.mb_held_sources(uuid) from public, anon;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.mb_platform_source(text) to mediabuyer, authenticated;
grant execute on function public.mb_order_attributed(uuid, text, timestamptz) to mediabuyer;
grant execute on function public.mb_held_sources(uuid) to mediabuyer, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select (id, role) on public.users to supabase_auth_admin;

-- RPCs + policy helpers the MB surface calls.
grant execute on function public.mb_dashboard_stats(uuid, uuid, date, date) to mediabuyer;
grant execute on function public.mb_entry_days(uuid, uuid) to mediabuyer;
grant execute on function public.ads_history_metrics(uuid, uuid, date, date) to mediabuyer;
grant execute on function public.current_user_digicom_business_id() to mediabuyer;
grant execute on function public.current_user_is_business_admin() to mediabuyer;
grant execute on function public.check_user_role(uuid, text[]) to mediabuyer;
grant execute on function public.is_owner() to mediabuyer;
grant execute on function public.mb_ga_allowed(uuid) to mediabuyer;
grant execute on function public.mb_meta_allowed(uuid) to mediabuyer;

-- Attribution-helper indexes (policy runs per orders row).
create index if not exists idx_cde_created_by_entry_date
  on public.campaign_daily_entries (created_by, entry_date);
create index if not exists idx_ads_history_created_by
  on public.ads_history (created_by);

-- ── 3. Table grants (deny-by-default; column-level where money is adjacent) ─
-- Own row only (rows via policy) — full columns of one's own row are one's own data.
grant select on public.users to mediabuyer;
grant update (name, phone, avatar_url, avatar_config, bank_name, bank_account_holder, bank_rib, cin_number)
  on public.users to mediabuyer;
grant select (id, name, status, logo) on public.businesses to mediabuyer;
grant select, insert, update, delete on public.campaigns to mediabuyer;
grant select, insert, update, delete on public.campaign_daily_entries to mediabuyer;
grant select, insert, update, delete on public.ads_history to mediabuyer;
grant select on public.campaign_source_locks to mediabuyer;
-- orders: display columns only — no cost/fee columns, rows via attribution policy.
grant select (id, name, phone, address, price, date, created_at, source_name, delivery_note, note,
              order_status_id, package_status_id, replace, master_city_id, "DigiCom Business",
              date_deleted, source_review_status)
  on public.orders to mediabuyer;
-- order_items: NO unit_price (line revenue stays closed).
grant select (id, order_id, product_id, accessory_id, quantity, created_at) on public.order_items to mediabuyer;
-- products: everything EXCEPT cost_price.
grant select (id, name, code, label, description, selling_price, image_url, created_at, updated_at, active, stock, "DigiCom Business")
  on public.products to mediabuyer;
grant select on public.master_cities to mediabuyer;
grant select on public.order_statuses to mediabuyer;
grant select on public.package_statuses to mediabuyer;
grant select (id, name, provider_type, logo_url, active, "DigiCom Business") on public.providers to mediabuyer;
grant select (id, order_id, tracking_code, external_id, provider_id, status_id, created_at, company_delivery_note_id, "DigiCom Business")
  on public.company_parcels to mediabuyer;
grant update (status_id) on public.company_parcels to mediabuyer;
grant select (id, order_id, tracking_code, status_id, created_at, courier_id, courier_delivery_note_id, "DigiCom Business")
  on public.courier_parcels to mediabuyer;
grant select on public.order_status_history to mediabuyer;
grant select on public.mediabuyer_payments to mediabuyer;
grant select on public.mediabuyer_payment_txns to mediabuyer;
grant select, insert on public.mediabuyer_demands to mediabuyer;
grant select on public.google_analytics_connections to mediabuyer;
grant select on public.meta_ads_connections to mediabuyer;
-- storage
grant select, insert, update, delete on storage.objects to mediabuyer;
grant select on storage.buckets to mediabuyer;

-- ── 4. Policies TO mediabuyer ──────────────────────────────────────────────
-- users: OWN ROW ONLY (peer names/emails/money unreadable; embeds degrade to null).
drop policy if exists mb_users_select on public.users;
create policy mb_users_select on public.users for select to mediabuyer
using (id = (select auth.uid()));
drop policy if exists mb_users_update on public.users;
create policy mb_users_update on public.users for update to mediabuyer
using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists mb_businesses_select on public.businesses;
create policy mb_businesses_select on public.businesses for select to mediabuyer
using (id = (select public.current_user_digicom_business_id()));

-- campaigns / entries / ads: OWN rows (authenticated keeps tenant-wide; the
-- tightening is the point — peer spend becomes unreadable).
drop policy if exists mb_campaigns_own_all on public.campaigns;
create policy mb_campaigns_own_all on public.campaigns for all to mediabuyer
using ("DigiCom Business" = (select public.current_user_digicom_business_id())
       and created_by = (select auth.uid()))
with check ("DigiCom Business" = (select public.current_user_digicom_business_id())
       and created_by = (select auth.uid()));

drop policy if exists mb_entries_own_all on public.campaign_daily_entries;
create policy mb_entries_own_all on public.campaign_daily_entries for all to mediabuyer
using ("DigiCom Business" = (select public.current_user_digicom_business_id())
       and created_by = (select auth.uid()))
with check ("DigiCom Business" = (select public.current_user_digicom_business_id())
       and created_by = (select auth.uid()));

drop policy if exists mb_ads_history_own_all on public.ads_history;
create policy mb_ads_history_own_all on public.ads_history for all to mediabuyer
using ("DigiCom Business" = (select public.current_user_digicom_business_id())
       and created_by = (select auth.uid()))
with check ("DigiCom Business" = (select public.current_user_digicom_business_id())
       and created_by = (select auth.uid()));

drop policy if exists mb_locks_select on public.campaign_source_locks;
create policy mb_locks_select on public.campaign_source_locks for select to mediabuyer
using ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- orders: ATTRIBUTED ONLY (owner ruling).
drop policy if exists mb_orders_select on public.orders;
create policy mb_orders_select on public.orders for select to mediabuyer
using (
  "DigiCom Business" = (select public.current_user_digicom_business_id())
  and date_deleted is null
  and public.mb_order_attributed("DigiCom Business", source_name, date)
);

drop policy if exists mb_order_items_select on public.order_items;
create policy mb_order_items_select on public.order_items for select to mediabuyer
using (exists (select 1 from public.orders o where o.id = order_items.order_id));

drop policy if exists mb_osh_select on public.order_status_history;
create policy mb_osh_select on public.order_status_history for select to mediabuyer
using (exists (select 1 from public.orders o where o.id = order_status_history.order_id));

drop policy if exists mb_company_parcels_select on public.company_parcels;
create policy mb_company_parcels_select on public.company_parcels for select to mediabuyer
using (exists (select 1 from public.orders o where o.id = company_parcels.order_id));
drop policy if exists mb_company_parcels_update on public.company_parcels;
create policy mb_company_parcels_update on public.company_parcels for update to mediabuyer
using (exists (select 1 from public.orders o where o.id = company_parcels.order_id))
with check (exists (select 1 from public.orders o where o.id = company_parcels.order_id));

drop policy if exists mb_courier_parcels_select on public.courier_parcels;
create policy mb_courier_parcels_select on public.courier_parcels for select to mediabuyer
using (exists (select 1 from public.orders o where o.id = courier_parcels.order_id));

drop policy if exists mb_products_select on public.products;
create policy mb_products_select on public.products for select to mediabuyer
using ("DigiCom Business" = (select public.current_user_digicom_business_id()));

drop policy if exists mb_providers_select on public.providers;
create policy mb_providers_select on public.providers for select to mediabuyer
using ("DigiCom Business" = (select public.current_user_digicom_business_id()));

-- global reference masters
drop policy if exists mb_master_cities_select on public.master_cities;
create policy mb_master_cities_select on public.master_cities for select to mediabuyer using (true);
drop policy if exists mb_order_statuses_select on public.order_statuses;
create policy mb_order_statuses_select on public.order_statuses for select to mediabuyer using (true);
drop policy if exists mb_package_statuses_select on public.package_statuses;
create policy mb_package_statuses_select on public.package_statuses for select to mediabuyer using (true);

-- own payout ledger (mirror of the authenticated own-arm)
drop policy if exists mb_payments_select_own on public.mediabuyer_payments;
create policy mb_payments_select_own on public.mediabuyer_payments for select to mediabuyer
using (mediabuyer_id = (select auth.uid()));
drop policy if exists mb_payment_txns_select_own on public.mediabuyer_payment_txns;
create policy mb_payment_txns_select_own on public.mediabuyer_payment_txns for select to mediabuyer
using (exists (select 1 from public.mediabuyer_payments mp
               where mp.id = mediabuyer_payment_txns.mediabuyer_payment_id
                 and mp.mediabuyer_id = (select auth.uid())));

drop policy if exists mb_demands_select_own on public.mediabuyer_demands;
create policy mb_demands_select_own on public.mediabuyer_demands for select to mediabuyer
using (mediabuyer_id = (select auth.uid()));
drop policy if exists mb_demands_insert_self on public.mediabuyer_demands;
create policy mb_demands_insert_self on public.mediabuyer_demands for insert to mediabuyer
with check (mediabuyer_id = (select auth.uid()));

-- GA/Meta connections: same allow-list gate as the authenticated policies.
drop policy if exists mb_ga_connections_select on public.google_analytics_connections;
create policy mb_ga_connections_select on public.google_analytics_connections for select to mediabuyer
using (public.mb_ga_allowed(id));
drop policy if exists mb_meta_connections_select on public.meta_ads_connections;
create policy mb_meta_connections_select on public.meta_ads_connections for select to mediabuyer
using (public.mb_meta_allowed(id));

-- storage: avatar upload/update (public read policy already covers everyone),
-- demand-media own-folder, campaign-media (role-claim check adjusted).
drop policy if exists mb_avatar_insert on storage.objects;
create policy mb_avatar_insert on storage.objects for insert to mediabuyer
with check (bucket_id = 'avatar');
drop policy if exists mb_avatar_update on storage.objects;
create policy mb_avatar_update on storage.objects for update to mediabuyer
using (bucket_id = 'avatar');
drop policy if exists mb_demand_media_select on storage.objects;
create policy mb_demand_media_select on storage.objects for select to mediabuyer
using (bucket_id = 'demand-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists mb_demand_media_insert on storage.objects;
create policy mb_demand_media_insert on storage.objects for insert to mediabuyer
with check (bucket_id = 'demand-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists mb_campaign_media_select on storage.objects;
create policy mb_campaign_media_select on storage.objects for select to mediabuyer
using (bucket_id = 'campaign-media');
drop policy if exists mb_campaign_media_insert on storage.objects;
create policy mb_campaign_media_insert on storage.objects for insert to mediabuyer
with check (bucket_id = 'campaign-media');
drop policy if exists mb_campaign_media_update on storage.objects;
create policy mb_campaign_media_update on storage.objects for update to mediabuyer
using (bucket_id = 'campaign-media');
drop policy if exists mb_campaign_media_delete on storage.objects;
create policy mb_campaign_media_delete on storage.objects for delete to mediabuyer
using (bucket_id = 'campaign-media');

-- ── 5. ads_history_metrics: DEFINER gate ───────────────────────────────────
-- The body reads products.cost_price (COGS profit) — running it as INVOKER
-- under mediabuyer would 42501 on the column grant, and as `authenticated` an
-- MB could pass p_created_by=NULL and read business-wide ads incl. PEER spend
-- (pre-existing console hole). Fix both: body becomes an internal impl; the
-- public name is a DEFINER gate — tenant-locked, and non-admins are FORCED to
-- p_created_by = auth.uid() (own ads only). Admin calls byte-identical
-- (impl's CTEs all filter p_business explicitly; RLS added nothing for them).
do $$ begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='ads_history_metrics_impl') then
    alter function public.ads_history_metrics(uuid, uuid, date, date) rename to ads_history_metrics_impl;
  end if;
end $$;
revoke execute on function public.ads_history_metrics_impl(uuid, uuid, date, date) from public, anon, authenticated, mediabuyer;

create or replace function public.ads_history_metrics(p_business uuid, p_created_by uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare
  v_created_by uuid := p_created_by;
begin
  if p_business is distinct from public.current_user_digicom_business_id() then
    raise exception 'ads_history_metrics: business not permitted' using errcode = '42501';
  end if;
  if not coalesce(public.current_user_is_business_admin(), false) then
    v_created_by := (select auth.uid());
  end if;
  return public.ads_history_metrics_impl(p_business, v_created_by, p_from, p_to);
end;
$$;
revoke execute on function public.ads_history_metrics(uuid, uuid, date, date) from public, anon;
grant execute on function public.ads_history_metrics(uuid, uuid, date, date) to authenticated, mediabuyer;
