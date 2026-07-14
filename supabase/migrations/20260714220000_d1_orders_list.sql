-- D1 — orders list server-side teardown (contract: docs/d1-recon/04-design.md).
--
-- Kills the 'orders-aggregate' full-table download on admin/Orders.tsx and
-- seller/Orders.tsx: the pages fetched EVERY order of the business (fetchAllRows,
-- 1000-row loops), then filtered/searched/paged client-side. This migration adds
-- the keyset indexes plus three RPCs:
--
--   * public.orders_list_page   — one keyset page (created_at DESC, id DESC) of
--                                 SLIM rows (recon 01 §6 rendered set only) with
--                                 every page filter pushed down (recon 01 §1
--                                 predicates, byte-parity; seller pool per recon 02
--                                 via p_seller_scope).
--   * public.orders_kpis        — the KPI-strip aggregate over the SAME filter
--                                 surface (shared WHERE block below — provably
--                                 identical, a divergence = wrong counter).
--   * public.orders_bulk_guarded— bulk status/attribution with the locked /
--                                 soft-deleted / foreign-business guards moved
--                                 server-side (selection persists across pages).
--
-- All D4 conventions: SECURITY INVOKER (RLS is the row gate; explicit p_business
-- = defense in depth + index driver), STABLE reads, set search_path to '',
-- jsonb returns (never SETOF for unbounded sets), grants footer, Casablanca
-- date boundaries, flag-column status semantics.
--
-- SELLER SCOPING IS NOT RLS (recon 03 §5.1): orders SELECT policy is
-- business-wide. p_seller_scope is the seller-page security boundary and is
-- validated against auth.uid() / business-admin before use.
--
-- Documented deviations from the old client behavior (accepted by the contract):
--   * top search axes trimmed: raw-uuid columns, raw_price/shipping_cost numeric
--     matching, joined labels (status/package labels, city/courier/assignee/
--     company/parcel-provider names), accessory name/code and item.note are NO
--     LONGER searched. Kept axes: folded customer name (trgm), normalized phone,
--     tracking (parcels trgm + 6 old_tracking + address/note/delivery_note ILIKE),
--     product name/code. Length guards per the notes-search family (fold>=2,
--     digits>=3, raw>=2) — shorter terms match nothing server-side.
--   * date presets move from browser-local to Africa/Casablanca calendar days
--     (inclusive from/to, exclusive to+1 — D4 convention).
--   * keyset NULL form (contract line 17 delegates the choice): the indexes stay
--     byte-exact per the contract (created_at DESC = NULLS FIRST) and the query
--     orders `created_at desc, id desc` to match them. NULL created_at rows
--     (0 today; column has default now()) therefore sort FIRST and always surface
--     on page 1 instead of becoming cursor-unreachable. The old client sorted
--     nulls last via epoch-coalesce — unobservable with 0 NULL rows.
--   * orders_bulk_guarded carries p_reported_date (NOT in the contract signature):
--     the real bulk flow (admin/Orders.tsx bulkStatusMutation + Reported modal)
--     passes a user-picked reported date for postponed statuses; dropping it would
--     silently stamp now(). Default null keeps the contract call shape valid.
--   * orders_bulk_guarded does NOT insert order_status_history rows: the client
--     keeps its pre-insert (custom comment + trigger dedup window) exactly as
--     today; without it the trg_auto_log_order_status_history trigger logs the
--     automatic row.
--
-- Reversible: drop the three functions and the two indexes.

begin;

-- ---------------------------------------------------------------------------
-- Keyset indexes (no support existed: only single-col biz + a GLOBAL created_at
-- index — recon 03 §2.2). Partial on live rows, matching the search-index family.
-- Date-field RANGE filters ride these + filter: the 8 switchable date columns are
-- deliberately NOT individually indexed (documented tradeoff, contract §Indexes).
-- ---------------------------------------------------------------------------
create index if not exists idx_orders_biz_created_keyset
  on public.orders ("DigiCom Business", created_at desc, id desc)
  where date_deleted is null;
create index if not exists idx_orders_biz_seller_created
  on public.orders ("DigiCom Business", seller_id, created_at desc, id desc)
  where date_deleted is null;

-- ---------------------------------------------------------------------------
-- RPC 1 — orders_list_page: one keyset page of slim rows.
-- Returns {rows: [...], next_cursor: {created_at, id} | null, page_count: int}.
--
-- Filter parity source: recon 01 §1 (admin table #1-#17) / recon 02 §2 (seller).
-- The WHERE block between the >>> <<< sentinels is BYTE-IDENTICAL to the one in
-- public.orders_kpis below — edit BOTH or the counters lie.
--
-- Row shape (SLIM — rendered set only, recon 01 §6; jsonb_agg / LATERAL LIMIT 1
-- everywhere a join could multiply rows, recon 03 §5.6):
--   scalars: id name phone created_at price replace exchange_of_order_id
--            source_name reported_date stock_changed order_status_id
--            package_status_id city_name
--   objects: channel{name,type} status{id,label,color,icon,is_paid,is_unpaid}
--            package_status{label,color,icon} courier_pkg_fallback{label,color}
--            courier/assignee{id,name,avatar_url,avatar_config}
--            company{id,name,provider_type,logo_url}
--   items:   [{product_id,accessory_id,quantity,accessory_quantity,name,code,image_url}]
--   misc:    latest_tracking_code, can_track{parcel_id,tracking_code,external_id,
--            provider_id}|null (company parcel first, courier parcel fallback with
--            null external/provider — truthiness parity with the client),
--            is_duplicate_phone (normalized [\s-]-stripped phone count > 1 over the
--            FULL live business pool, unfiltered — recon 01 §3).
-- ---------------------------------------------------------------------------
-- LIKE/ILIKE metacharacter escape (D1 review fix): user filter/search terms must
-- match LITERALLY (parity with the old client String.includes) — %, _ and \
-- in input are data, not wildcards. Postgres' default LIKE escape char is \.
create or replace function public.like_escape(p text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
    select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_');
$$;
revoke all on function public.like_escape(text) from public, anon;
grant execute on function public.like_escape(text) to authenticated;
alter function public.like_escape(text) owner to postgres;

create or replace function public.orders_list_page(
    p_business uuid,
    p_seller_scope uuid default null,
    p_search text default null,
    p_status uuid default null,
    p_status_ids uuid[] default null,
    p_package uuid default null,
    p_package_ids uuid[] default null,
    p_city uuid default null,
    p_source text default null,
    p_provider uuid default null,
    p_date_field text default 'date',
    p_date_from date default null,
    p_date_to date default null,
    p_customer_name text default null,
    p_phone text default null,
    p_tracking text default null,
    p_product uuid default null,
    p_confirmed_by uuid default null,
    p_assigned_to uuid default null,
    p_exchange text default null,
    p_cursor_created timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
    v_date_field text;
    v_source text;
    v_customer_name text;
    v_phone text;
    v_tracking text;
    v_exchange text;
    v_search text;
    v_fq text;
    v_pq text;
    v_limit integer;
    v_result jsonb;
begin
    if p_business is null then
        raise exception 'd1_orders: p_business is required' using errcode = '22023';
    end if;
    -- seller-page security boundary (RLS does NOT scope sellers — recon 03 §5.1)
    if p_seller_scope is not null
       and p_seller_scope is distinct from (select auth.uid())
       and not coalesce(public.current_user_is_business_admin(), false) then
        raise exception 'd1_orders: p_seller_scope not permitted' using errcode = '42501';
    end if;
    v_date_field := coalesce(p_date_field, 'date');
    if v_date_field not in ('date', 'created_at', 'updated_at', 'assignment_date',
                            'confirmation_date', 'annulation_date', 'date_livraison', 'reported_date') then
        raise exception 'd1_orders: invalid p_date_field %', p_date_field using errcode = '22023';
    end if;
    if coalesce(array_length(p_status_ids, 1), 0) > 1000
       or coalesce(array_length(p_package_ids, 1), 0) > 1000 then
        raise exception 'd1_orders: too_many_ids (max 1000)' using errcode = '22023';
    end if;
    if (p_cursor_created is null) <> (p_cursor_id is null) then
        raise exception 'd1_orders: cursor requires both p_cursor_created and p_cursor_id' using errcode = '22023';
    end if;
    v_limit         := least(greatest(coalesce(p_limit, 100), 1), 1000);
    v_search        := nullif(btrim(coalesce(p_search, '')), '');
    v_fq            := public.like_escape(public.fold_text(v_search));
    v_pq            := regexp_replace(regexp_replace(coalesce(v_search, ''), '\D', '', 'g'), '^0+', '');
    -- escape LAST (after fold/digit derivation): metachars in input match literally
    v_search        := public.like_escape(v_search);
    v_source        := nullif(p_source, '');
    v_customer_name := public.like_escape(nullif(p_customer_name, ''));
    v_phone         := public.like_escape(nullif(p_phone, ''));
    v_tracking      := public.like_escape(nullif(regexp_replace(lower(coalesce(p_tracking, '')), '\s+', '', 'g'), ''));
    v_exchange      := case when p_exchange in ('yes', 'no') then p_exchange end;

    with page_raw as (
        select o.*
        from public.orders o
        where
          -- >>> D1 SHARED ORDERS FILTER (byte-identical in orders_list_page + orders_kpis — edit BOTH) <<<
          o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          -- seller pool scoping (recon 02 §1: seller_id = uid is the WHOLE seller predicate)
          and (p_seller_scope is null or o.seller_id = p_seller_scope)
          -- #2/#3 status: single id wins; category array applies only when single is null
          and (p_status is null or o.order_status_id = p_status)
          and (p_status is not null or p_status_ids is null
               or o.order_status_id = any (p_status_ids))
          -- #4/#5 package (orders.package_status_id ONLY — parity, recon 01 gotcha 3)
          and (p_package is null or o.package_status_id = p_package)
          and (p_package is not null or p_package_ids is null
               or o.package_status_id = any (p_package_ids))
          -- #6 city
          and (p_city is null or o.master_city_id = p_city)
          -- #7 source (exact case-sensitive — parity)
          and (v_source is null or o.source_name = v_source)
          -- #8 delivery provider: either FK
          and (p_provider is null or (o.courier_id = p_provider or o.company_id = p_provider))
          -- #9/#10 date range on the whitelisted column, Casablanca-local inclusive days;
          -- NULL column value never matches while a bound is active (parity)
          and (p_date_from is null or (case v_date_field
                   when 'date'              then o.date
                   when 'created_at'        then o.created_at
                   when 'updated_at'        then o.updated_at
                   when 'assignment_date'   then o.assignment_date
                   when 'confirmation_date' then o.confirmation_date
                   when 'annulation_date'   then o.annulation_date
                   when 'date_livraison'    then o.date_livraison
                   when 'reported_date'     then o.reported_date
               end) >= (p_date_from::timestamp at time zone 'Africa/Casablanca'))
          and (p_date_to is null or (case v_date_field
                   when 'date'              then o.date
                   when 'created_at'        then o.created_at
                   when 'updated_at'        then o.updated_at
                   when 'assignment_date'   then o.assignment_date
                   when 'confirmation_date' then o.confirmation_date
                   when 'annulation_date'   then o.annulation_date
                   when 'date_livraison'    then o.date_livraison
                   when 'reported_date'     then o.reported_date
               end) < ((p_date_to + 1)::timestamp at time zone 'Africa/Casablanca'))
          -- #11 customer name: plain case-insensitive substring (fold_text NOT used — parity)
          and (v_customer_name is null or o.name ilike '%' || v_customer_name || '%')
          -- #12 phone: RAW case-sensitive substring, NO normalization (parity)
          and (v_phone is null or o.phone like '%' || v_phone || '%')
          -- #13 tracking: whitespace-stripped lowercase substring over the 6 old-tracking
          -- columns + delivery-note-attached parcels ONLY (parity — filter is note-gated,
          -- display/search are not)
          and (v_tracking is null
               or regexp_replace(lower(coalesce(o.coliaty_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.ameex_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.quicklivraison_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.forcelog_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.sendit_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.delvoexpress_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or o.id in (select cp.order_id
                           from public.company_parcels cp
                           where cp."DigiCom Business" = p_business
                             and cp.company_delivery_note_id is not null
                             and regexp_replace(lower(coalesce(cp.tracking_code, '')), '\s+', '', 'g') like '%' || v_tracking || '%')
               or o.id in (select crp.order_id
                           from public.courier_parcels crp
                           where crp."DigiCom Business" = p_business
                             and crp.courier_delivery_note_id is not null
                             and regexp_replace(lower(coalesce(crp.tracking_code, '')), '\s+', '', 'g') like '%' || v_tracking || '%'))
          -- #14 product: EXISTS on order_items.product_id (accessory_id NOT matched — parity)
          and (p_product is null or exists (select 1 from public.order_items oi
                                            where oi.order_id = o.id and oi.product_id = p_product))
          -- #15/#16 confirmed-by / assigned-to
          and (p_confirmed_by is null or o.confirmed_by_id = p_confirmed_by)
          and (p_assigned_to is null or o.seller_id = p_assigned_to)
          -- #17 exchange tri-state ('no' matches NULL replace — parity)
          and (v_exchange is null
               or (v_exchange = 'yes' and o.replace is true)
               or (v_exchange = 'no'  and o.replace is distinct from true))
          -- #1 top search (server axes per the design contract; guards per notes family)
          and (v_search is null
               or (length(v_fq) >= 2 and public.fold_text(o.name) like '%' || v_fq || '%')
               or (length(v_pq) >= 3 and public.normalize_phone_for_customer(o.phone) like '%' || v_pq || '%')
               or (length(v_search) >= 2 and (
                       o.coliaty_old_tracking ilike '%' || v_search || '%'
                    or o.ameex_old_tracking ilike '%' || v_search || '%'
                    or o.quicklivraison_old_tracking ilike '%' || v_search || '%'
                    or o.forcelog_old_tracking ilike '%' || v_search || '%'
                    or o.sendit_old_tracking ilike '%' || v_search || '%'
                    or o.delvoexpress_old_tracking ilike '%' || v_search || '%'
                    or o.address ilike '%' || v_search || '%'
                    or o.note ilike '%' || v_search || '%'
                    or o.delivery_note ilike '%' || v_search || '%'))
               or (length(v_search) >= 2 and o.id in (
                       select cp2.order_id
                       from public.company_parcels cp2
                       where cp2."DigiCom Business" = p_business
                         and cp2.tracking_code ilike '%' || v_search || '%'))
               or (length(v_search) >= 2 and o.id in (
                       select crp2.order_id
                       from public.courier_parcels crp2
                       where crp2."DigiCom Business" = p_business
                         and crp2.tracking_code ilike '%' || v_search || '%'))
               or (length(v_fq) >= 2 and exists (
                       select 1
                       from public.order_items oi2
                       join public.products pr2 on pr2.id = oi2.product_id
                       where oi2.order_id = o.id
                         and (public.fold_text(pr2.name) like '%' || v_fq || '%'
                              or public.fold_text(pr2.code) like '%' || v_fq || '%'))))
          -- <<< END D1 SHARED ORDERS FILTER >>>
          and (p_cursor_created is null or (o.created_at, o.id) < (p_cursor_created, p_cursor_id))
        order by o.created_at desc, o.id desc
        limit v_limit + 1
    ),
    page as (
        select pr.*, row_number() over (order by pr.created_at desc, pr.id desc) as rn
        from page_raw pr
    ),
    kept as (
        select * from page where rn <= v_limit
    ),
    -- business-wide duplicate-phone map (recon 01 §3: normalized over the FULL
    -- live pool, NOT the filtered set; row check by the row's own phone)
    phone_counts as (
        select regexp_replace(o2.phone, '[\s-]', '', 'g') as pnorm, count(*) as cnt
        from public.orders o2
        where o2."DigiCom Business" = p_business
          and o2.date_deleted is null
          and o2.source_review_status <> 'pending'
          and o2.phone is not null
        group by 1
    ),
    enriched as (
        select
            k.rn,
            jsonb_build_object(
                'id', k.id,
                'name', k.name,
                'phone', k.phone,
                'created_at', k.created_at,
                'price', k.price,
                'replace', k.replace,
                'exchange_of_order_id', k.exchange_of_order_id,
                'source_name', k.source_name,
                'reported_date', k.reported_date,
                'stock_changed', k.stock_changed,
                'order_status_id', k.order_status_id,
                'package_status_id', k.package_status_id,
                'city_name', mc.name,
                'channel', case when sc.id is not null
                    then jsonb_build_object('name', sc.name, 'type', sc.type) end,
                'status', case when os.id is not null
                    then jsonb_build_object('id', os.id, 'label', os.label, 'color', os.color,
                                            'icon', os.icon, 'is_paid', os.is_paid, 'is_unpaid', os.is_unpaid) end,
                'package_status', case when ps.id is not null
                    then jsonb_build_object('label', ps.label, 'color', ps.color, 'icon', ps.icon) end,
                'courier_pkg_fallback', case when cpf.label is not null
                    then jsonb_build_object('label', cpf.label, 'color', cpf.color) end,
                'courier', case when cu.id is not null
                    then jsonb_build_object('id', cu.id, 'name', cu.name,
                                            'avatar_url', cu.avatar_url, 'avatar_config', cu.avatar_config) end,
                'assignee', case when au.id is not null
                    then jsonb_build_object('id', au.id, 'name', au.name,
                                            'avatar_url', au.avatar_url, 'avatar_config', au.avatar_config) end,
                'company', case when pv.id is not null
                    then jsonb_build_object('id', pv.id, 'name', pv.name,
                                            'provider_type', pv.provider_type, 'logo_url', pv.logo_url) end,
                'items', coalesce(it.items, '[]'::jsonb),
                'latest_tracking_code', lt.tracking_code,
                'can_track', case
                    when ctc.parcel_id is not null then jsonb_build_object(
                        'parcel_id', ctc.parcel_id, 'tracking_code', ctc.tracking_code,
                        'external_id', ctc.external_id, 'provider_id', ctc.provider_id)
                    when ctk.parcel_id is not null then jsonb_build_object(
                        'parcel_id', ctk.parcel_id, 'tracking_code', ctk.tracking_code,
                        'external_id', null, 'provider_id', null)
                    end,
                'is_duplicate_phone', coalesce(pc.cnt, 0) > 1
            ) as row_json
        from kept k
        left join public.order_statuses os on os.id = k.order_status_id
        left join public.package_statuses ps on ps.id = k.package_status_id
        left join public.master_cities mc on mc.id = k.master_city_id
        left join public.sales_channels sc on sc.id = k.source_id
        left join public.users cu on cu.id = k.courier_id
        left join public.users au on au.id = k.seller_id
        left join public.providers pv on pv.id = k.company_id
        left join phone_counts pc on pc.pnorm = regexp_replace(k.phone, '[\s-]', '', 'g')
        left join lateral (
            select jsonb_agg(jsonb_build_object(
                       'product_id', oi.product_id,
                       'accessory_id', oi.accessory_id,
                       'quantity', oi.quantity,
                       'accessory_quantity', oi.accessory_quantity,
                       -- accessory-only lines keep their label (both FE halves flagged
                       -- the product-only form losing accessory names in previews)
                       'name', coalesce(pr.name, ac.name),
                       'code', coalesce(pr.code, ac.code),
                       'image_url', coalesce(pr.image_url, ac.image_url)
                   ) order by oi.created_at, oi.id) as items
            from public.order_items oi
            left join public.products pr on pr.id = oi.product_id
            left join public.accessories ac on ac.id = oi.accessory_id
            where oi.order_id = k.id
        ) it on true
        -- getCourierPackageStatus fallback: latest courier parcel's embedded status
        left join lateral (
            select ps2.label, ps2.color
            from public.courier_parcels crp
            left join public.package_statuses ps2 on ps2.id = crp.status_id
            where crp.order_id = k.id
            order by crp.created_at desc nulls last
            limit 1
        ) cpf on true
        -- latest tracking code for DISPLAY: max created_at over both parcel kinds,
        -- non-empty codes, NOT note-gated (parity with the list cell)
        left join lateral (
            select t.tracking_code
            from (
                select cpa.tracking_code, cpa.created_at
                from public.company_parcels cpa
                where cpa.order_id = k.id and nullif(cpa.tracking_code, '') is not null
                union all
                select cra.tracking_code, cra.created_at
                from public.courier_parcels cra
                where cra.order_id = k.id and nullif(cra.tracking_code, '') is not null
            ) t
            order by t.created_at desc nulls last
            limit 1
        ) lt on true
        -- getLatestTrackableCompanyParcel: latest company parcel with a code
        left join lateral (
            select cpb.id as parcel_id, cpb.tracking_code, cpb.external_id, cpb.provider_id
            from public.company_parcels cpb
            where cpb.order_id = k.id and nullif(cpb.tracking_code, '') is not null
            order by cpb.created_at desc nulls last
            limit 1
        ) ctc on true
        -- courier-parcel fallback for can_track (any courier parcel with a code)
        left join lateral (
            select crb.id as parcel_id, crb.tracking_code
            from public.courier_parcels crb
            where crb.order_id = k.id and nullif(crb.tracking_code, '') is not null
            order by crb.created_at desc nulls last
            limit 1
        ) ctk on true
    )
    select jsonb_build_object(
        'rows', coalesce((select jsonb_agg(e.row_json order by e.rn) from enriched e), '[]'::jsonb),
        'page_count', (select count(*)::int from kept),
        'next_cursor', case
            when (select count(*) from page) > v_limit then
                (select jsonb_build_object('created_at', k2.created_at, 'id', k2.id)
                 from kept k2 where k2.rn = v_limit)
            end
    )
    into v_result;

    return v_result;
end;
$$;

revoke all on function public.orders_list_page(uuid, uuid, text, uuid, uuid[], uuid, uuid[], uuid, text, uuid, text, date, date, text, text, text, uuid, uuid, uuid, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.orders_list_page(uuid, uuid, text, uuid, uuid[], uuid, uuid[], uuid, text, uuid, text, date, date, text, text, text, uuid, uuid, uuid, text, timestamptz, uuid, integer) to authenticated;
alter function public.orders_list_page(uuid, uuid, text, uuid, uuid[], uuid, uuid[], uuid, text, uuid, text, date, date, text, text, text, uuid, uuid, uuid, text, timestamptz, uuid, integer) owner to postgres;

-- ---------------------------------------------------------------------------
-- RPC 2 — orders_kpis: KPI strip + counter pill over the SAME filter surface
-- (no cursor/limit). Parity math (recon 01 §3):
--   active_count   = filtered count (INCLUDES exchange legs)
--   total_sales    = SUM(coalesce(price,0)) over replace IS DISTINCT FROM true
--   exchange_count = filtered count where replace IS TRUE
--   avg_order      = round(total_sales / sales_count) over the money subset, 0 if empty
--   total_count    = filtered count (counter pill + totalPages)
-- The WHERE block between the >>> <<< sentinels is BYTE-IDENTICAL to
-- public.orders_list_page above — edit BOTH or the counters lie.
-- ---------------------------------------------------------------------------
create or replace function public.orders_kpis(
    p_business uuid,
    p_seller_scope uuid default null,
    p_search text default null,
    p_status uuid default null,
    p_status_ids uuid[] default null,
    p_package uuid default null,
    p_package_ids uuid[] default null,
    p_city uuid default null,
    p_source text default null,
    p_provider uuid default null,
    p_date_field text default 'date',
    p_date_from date default null,
    p_date_to date default null,
    p_customer_name text default null,
    p_phone text default null,
    p_tracking text default null,
    p_product uuid default null,
    p_confirmed_by uuid default null,
    p_assigned_to uuid default null,
    p_exchange text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
    v_date_field text;
    v_source text;
    v_customer_name text;
    v_phone text;
    v_tracking text;
    v_exchange text;
    v_search text;
    v_fq text;
    v_pq text;
    v_result jsonb;
begin
    if p_business is null then
        raise exception 'd1_orders: p_business is required' using errcode = '22023';
    end if;
    -- seller-page security boundary (RLS does NOT scope sellers — recon 03 §5.1)
    if p_seller_scope is not null
       and p_seller_scope is distinct from (select auth.uid())
       and not coalesce(public.current_user_is_business_admin(), false) then
        raise exception 'd1_orders: p_seller_scope not permitted' using errcode = '42501';
    end if;
    v_date_field := coalesce(p_date_field, 'date');
    if v_date_field not in ('date', 'created_at', 'updated_at', 'assignment_date',
                            'confirmation_date', 'annulation_date', 'date_livraison', 'reported_date') then
        raise exception 'd1_orders: invalid p_date_field %', p_date_field using errcode = '22023';
    end if;
    if coalesce(array_length(p_status_ids, 1), 0) > 1000
       or coalesce(array_length(p_package_ids, 1), 0) > 1000 then
        raise exception 'd1_orders: too_many_ids (max 1000)' using errcode = '22023';
    end if;
    v_search        := nullif(btrim(coalesce(p_search, '')), '');
    v_fq            := public.like_escape(public.fold_text(v_search));
    v_pq            := regexp_replace(regexp_replace(coalesce(v_search, ''), '\D', '', 'g'), '^0+', '');
    -- escape LAST (after fold/digit derivation): metachars in input match literally
    v_search        := public.like_escape(v_search);
    v_source        := nullif(p_source, '');
    v_customer_name := public.like_escape(nullif(p_customer_name, ''));
    v_phone         := public.like_escape(nullif(p_phone, ''));
    v_tracking      := public.like_escape(nullif(regexp_replace(lower(coalesce(p_tracking, '')), '\s+', '', 'g'), ''));
    v_exchange      := case when p_exchange in ('yes', 'no') then p_exchange end;

    select jsonb_build_object(
        'active_count',   count(*),
        'total_sales',    coalesce(sum(coalesce(o.price, 0)) filter (where o.replace is distinct from true), 0),
        'exchange_count', count(*) filter (where o.replace is true),
        'avg_order',      case
                              when count(*) filter (where o.replace is distinct from true) > 0
                              then round(coalesce(sum(coalesce(o.price, 0)) filter (where o.replace is distinct from true), 0)
                                         / (count(*) filter (where o.replace is distinct from true)))
                              else 0
                          end,
        'total_count',    count(*)
    )
    into v_result
    from public.orders o
    where
          -- >>> D1 SHARED ORDERS FILTER (byte-identical in orders_list_page + orders_kpis — edit BOTH) <<<
          o."DigiCom Business" = p_business
          and o.date_deleted is null
          and o.source_review_status <> 'pending'
          -- seller pool scoping (recon 02 §1: seller_id = uid is the WHOLE seller predicate)
          and (p_seller_scope is null or o.seller_id = p_seller_scope)
          -- #2/#3 status: single id wins; category array applies only when single is null
          and (p_status is null or o.order_status_id = p_status)
          and (p_status is not null or p_status_ids is null
               or o.order_status_id = any (p_status_ids))
          -- #4/#5 package (orders.package_status_id ONLY — parity, recon 01 gotcha 3)
          and (p_package is null or o.package_status_id = p_package)
          and (p_package is not null or p_package_ids is null
               or o.package_status_id = any (p_package_ids))
          -- #6 city
          and (p_city is null or o.master_city_id = p_city)
          -- #7 source (exact case-sensitive — parity)
          and (v_source is null or o.source_name = v_source)
          -- #8 delivery provider: either FK
          and (p_provider is null or (o.courier_id = p_provider or o.company_id = p_provider))
          -- #9/#10 date range on the whitelisted column, Casablanca-local inclusive days;
          -- NULL column value never matches while a bound is active (parity)
          and (p_date_from is null or (case v_date_field
                   when 'date'              then o.date
                   when 'created_at'        then o.created_at
                   when 'updated_at'        then o.updated_at
                   when 'assignment_date'   then o.assignment_date
                   when 'confirmation_date' then o.confirmation_date
                   when 'annulation_date'   then o.annulation_date
                   when 'date_livraison'    then o.date_livraison
                   when 'reported_date'     then o.reported_date
               end) >= (p_date_from::timestamp at time zone 'Africa/Casablanca'))
          and (p_date_to is null or (case v_date_field
                   when 'date'              then o.date
                   when 'created_at'        then o.created_at
                   when 'updated_at'        then o.updated_at
                   when 'assignment_date'   then o.assignment_date
                   when 'confirmation_date' then o.confirmation_date
                   when 'annulation_date'   then o.annulation_date
                   when 'date_livraison'    then o.date_livraison
                   when 'reported_date'     then o.reported_date
               end) < ((p_date_to + 1)::timestamp at time zone 'Africa/Casablanca'))
          -- #11 customer name: plain case-insensitive substring (fold_text NOT used — parity)
          and (v_customer_name is null or o.name ilike '%' || v_customer_name || '%')
          -- #12 phone: RAW case-sensitive substring, NO normalization (parity)
          and (v_phone is null or o.phone like '%' || v_phone || '%')
          -- #13 tracking: whitespace-stripped lowercase substring over the 6 old-tracking
          -- columns + delivery-note-attached parcels ONLY (parity — filter is note-gated,
          -- display/search are not)
          and (v_tracking is null
               or regexp_replace(lower(coalesce(o.coliaty_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.ameex_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.quicklivraison_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.forcelog_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.sendit_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or regexp_replace(lower(coalesce(o.delvoexpress_old_tracking, '')), '\s+', '', 'g') like '%' || v_tracking || '%'
               or o.id in (select cp.order_id
                           from public.company_parcels cp
                           where cp."DigiCom Business" = p_business
                             and cp.company_delivery_note_id is not null
                             and regexp_replace(lower(coalesce(cp.tracking_code, '')), '\s+', '', 'g') like '%' || v_tracking || '%')
               or o.id in (select crp.order_id
                           from public.courier_parcels crp
                           where crp."DigiCom Business" = p_business
                             and crp.courier_delivery_note_id is not null
                             and regexp_replace(lower(coalesce(crp.tracking_code, '')), '\s+', '', 'g') like '%' || v_tracking || '%'))
          -- #14 product: EXISTS on order_items.product_id (accessory_id NOT matched — parity)
          and (p_product is null or exists (select 1 from public.order_items oi
                                            where oi.order_id = o.id and oi.product_id = p_product))
          -- #15/#16 confirmed-by / assigned-to
          and (p_confirmed_by is null or o.confirmed_by_id = p_confirmed_by)
          and (p_assigned_to is null or o.seller_id = p_assigned_to)
          -- #17 exchange tri-state ('no' matches NULL replace — parity)
          and (v_exchange is null
               or (v_exchange = 'yes' and o.replace is true)
               or (v_exchange = 'no'  and o.replace is distinct from true))
          -- #1 top search (server axes per the design contract; guards per notes family)
          and (v_search is null
               or (length(v_fq) >= 2 and public.fold_text(o.name) like '%' || v_fq || '%')
               or (length(v_pq) >= 3 and public.normalize_phone_for_customer(o.phone) like '%' || v_pq || '%')
               or (length(v_search) >= 2 and (
                       o.coliaty_old_tracking ilike '%' || v_search || '%'
                    or o.ameex_old_tracking ilike '%' || v_search || '%'
                    or o.quicklivraison_old_tracking ilike '%' || v_search || '%'
                    or o.forcelog_old_tracking ilike '%' || v_search || '%'
                    or o.sendit_old_tracking ilike '%' || v_search || '%'
                    or o.delvoexpress_old_tracking ilike '%' || v_search || '%'
                    or o.address ilike '%' || v_search || '%'
                    or o.note ilike '%' || v_search || '%'
                    or o.delivery_note ilike '%' || v_search || '%'))
               or (length(v_search) >= 2 and o.id in (
                       select cp2.order_id
                       from public.company_parcels cp2
                       where cp2."DigiCom Business" = p_business
                         and cp2.tracking_code ilike '%' || v_search || '%'))
               or (length(v_search) >= 2 and o.id in (
                       select crp2.order_id
                       from public.courier_parcels crp2
                       where crp2."DigiCom Business" = p_business
                         and crp2.tracking_code ilike '%' || v_search || '%'))
               or (length(v_fq) >= 2 and exists (
                       select 1
                       from public.order_items oi2
                       join public.products pr2 on pr2.id = oi2.product_id
                       where oi2.order_id = o.id
                         and (public.fold_text(pr2.name) like '%' || v_fq || '%'
                              or public.fold_text(pr2.code) like '%' || v_fq || '%'))))
          -- <<< END D1 SHARED ORDERS FILTER >>>
    ;

    return v_result;
end;
$$;

revoke all on function public.orders_kpis(uuid, uuid, text, uuid, uuid[], uuid, uuid[], uuid, text, uuid, text, date, date, text, text, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.orders_kpis(uuid, uuid, text, uuid, uuid[], uuid, uuid[], uuid, text, uuid, text, date, date, text, text, text, uuid, uuid, uuid, text) to authenticated;
alter function public.orders_kpis(uuid, uuid, text, uuid, uuid[], uuid, uuid[], uuid, text, uuid, text, date, date, text, text, text, uuid, uuid, uuid, text) owner to postgres;

-- ---------------------------------------------------------------------------
-- RPC 3 — orders_bulk_guarded: bulk status / attribution with the client-side
-- guards moved server-side (recon 01 §5: selectedOrders persists across pages,
-- so the visible-page locked filter cannot protect the write).
--
-- Guards: ids capped at 1000 (WA 024 precedent), per-id skip when the row is
-- invisible to the caller (nonexistent OR foreign-business — RLS folds both
-- into 'not_found'), soft-deleted, or locked (status.is_paid / is_unpaid).
-- SECURITY INVOKER: the orders UPDATE RLS policy applies per row (an RLS-refused
-- update skips as 'not_updatable' instead of silently counting as applied).
--
-- p_action = 'status': mirrors bulkStatusMutation's payload via the status flag
--   columns (the useStatusCategories facade, verified in
--   src/hooks/useStatusCategories.ts):
--     confirmed  (deducts_stock)                          -> confirmed_by_id + confirmation_date
--     cancelled  (is_cancelled & !fake & !double & !blk)  -> canceled_by_id + annulation_date
--     paid       (is_paid)                                -> date_livraison
--     postponed  (is_postponed)                           -> reported_date (p_reported_date, else now())
--   Each row updates inside its own subtransaction so a trigger rejection (e.g.
--   stock shortage from handle_order_status_stock_update on a confirmed status)
--   skips that order only — same isolation the client's per-order loop had.
--   History: NOT inserted here — the client keeps its pre-insert with the custom
--   comment (trigger dedup window), else trg_auto_log_order_status_history logs
--   the automatic row.
-- p_action = 'attribute': seller_id = p_seller (NULL = unassign, like the
--   client), assignment_date stamped when assigning / cleared when unassigning.
--
-- Returns {applied: [id, ...], skipped: [{id, reason}, ...]}.
-- ---------------------------------------------------------------------------
create or replace function public.orders_bulk_guarded(
    p_ids uuid[],
    p_action text,
    p_status uuid default null,
    p_seller uuid default null,
    p_reported_date timestamptz default null,
    p_comment text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path to ''
as $$
declare
    v_uid uuid := (select auth.uid());
    v_now timestamptz := now();
    v_is_confirmed boolean := false;
    v_is_cancelled boolean := false;
    v_is_paid boolean := false;
    v_is_postponed boolean := false;
    v_applied jsonb := '[]'::jsonb;
    v_skipped jsonb := '[]'::jsonb;
    r record;
begin
    if p_action is null or p_action not in ('status', 'attribute') then
        raise exception 'orders_bulk_guarded: invalid p_action %', p_action using errcode = '22023';
    end if;
    if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
        return jsonb_build_object('applied', '[]'::jsonb, 'skipped', '[]'::jsonb);
    end if;
    if array_length(p_ids, 1) > 1000 then
        raise exception 'orders_bulk_guarded: too_many_ids (max 1000)' using errcode = '22023';
    end if;
    if p_action = 'status' then
        if p_status is null then
            raise exception 'orders_bulk_guarded: p_status is required for the status action' using errcode = '22023';
        end if;
        select s.deducts_stock,
               (s.is_cancelled and not s.is_fake and not s.is_double and not s.is_blacklisted),
               s.is_paid,
               s.is_postponed
        into v_is_confirmed, v_is_cancelled, v_is_paid, v_is_postponed
        from public.order_statuses s
        where s.id = p_status;
        if not found then
            raise exception 'orders_bulk_guarded: unknown p_status %', p_status using errcode = '22023';
        end if;
    end if;

    for r in
        select d.id,
               o.id as found_id,
               o.date_deleted,
               o."DigiCom Business" as biz,
               (coalesce(os.is_paid, false) or coalesce(os.is_unpaid, false)) as locked
        from (select distinct u.id from unnest(p_ids) as u(id)) d
        left join public.orders o on o.id = d.id   -- INVOKER: RLS hides foreign-business rows
        left join public.order_statuses os on os.id = o.order_status_id
    loop
        if r.found_id is null then
            v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'not_found');
            continue;
        end if;
        if r.date_deleted is not null then
            v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'deleted');
            continue;
        end if;
        if r.locked then
            v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'locked');
            continue;
        end if;
        begin
            if p_action = 'status' then
                -- Manual history row INSIDE the per-row subtransaction, BEFORE the
                -- update (the auto-log trigger's 5s dedup then skips its own row —
                -- same ordering as the old client pre-insert). Written ONLY for rows
                -- that reach the update; a trigger rejection rolls BOTH back
                -- (phantom-history fix, D1 review).
                insert into public.order_status_history
                    (order_id, status_id, comment, changed_by, "DigiCom Business")
                values (r.id, p_status, coalesce(p_comment, 'Bulk status update'), v_uid, r.biz);
                update public.orders o set
                    order_status_id   = p_status,
                    updated_at        = v_now,
                    confirmed_by_id   = case when v_is_confirmed then v_uid else o.confirmed_by_id end,
                    confirmation_date = case when v_is_confirmed then v_now else o.confirmation_date end,
                    canceled_by_id    = case when v_is_cancelled then v_uid else o.canceled_by_id end,
                    annulation_date   = case when v_is_cancelled then v_now else o.annulation_date end,
                    date_livraison    = case when v_is_paid then v_now else o.date_livraison end,
                    reported_date     = case when v_is_postponed then coalesce(p_reported_date, v_now) else o.reported_date end
                where o.id = r.id;
            else
                update public.orders o set
                    seller_id       = p_seller,
                    updated_at      = v_now,
                    assignment_date = case when p_seller is not null then v_now else null end
                where o.id = r.id;
            end if;
            if not found then
                v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'not_updatable');
            else
                v_applied := v_applied || to_jsonb(r.id);
            end if;
        exception when others then
            -- per-row isolation: trigger rejections skip this order only
            v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', sqlerrm);
        end;
    end loop;

    return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end;
$$;

revoke all on function public.orders_bulk_guarded(uuid[], text, uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.orders_bulk_guarded(uuid[], text, uuid, uuid, timestamptz, text) to authenticated;
alter function public.orders_bulk_guarded(uuid[], text, uuid, uuid, timestamptz, text) owner to postgres;

commit;
