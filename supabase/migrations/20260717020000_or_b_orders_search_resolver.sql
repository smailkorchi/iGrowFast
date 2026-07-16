-- OR-B Orders top-search: index-driven id-resolver (2026-07-17) — docs/AUDIT_FINDINGS.md task #4 OR-2
-- The #1 search block (11-axis OR) planned as a whole-business per-row Filter on every
-- 350ms-debounced keystroke ×2 RPCs (118ms list + 99ms kpis at 1,841 orders → seconds at
-- 100×, pool-saturating at 1000×). The D1 trgm indexes could never serve it under RLS:
-- LIKE/ILIKE operators are non-LEAKPROOF, so they may not enter an Index Cond below the
-- RLS barrier (verified empirically; even LEAKPROOF fold_text doesn't unlock it — the
-- OPERATOR is the barrier). Root fix: public.orders_search_ids — a tenant-gated
-- SECURITY DEFINER resolver (gate = the exact RLS predicate) that runs each axis
-- index-driven as the table owner and returns only own-business order ids; both RPCs
-- consume the id-set (uncorrelated IN → hashed once). Axis semantics byte-identical.
-- PROVEN pre-apply: parity 18/18 comparisons across both fns (terms incl. metachars,
-- whitespace, tracking codes, product names, no-match, combos); direct-call gate:
-- own-biz OK / foreign-biz 42501 / NULL 42501; search timing list 118→14.7ms,
-- kpis 99→12.7ms. Residual: the 9-column ilike axis stays scan-bound inside the
-- resolver (generated search-blob column would trade byte-parity for cross-column
-- false positives — deferred owner call, documented in the ledger).

BEGIN;

CREATE OR REPLACE FUNCTION public.orders_search_ids(p_business uuid, p_search text)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
-- OR-B (task #4): index-driven resolver for the orders top-search (#1 axis family).
-- WHY SECURITY DEFINER: under RLS the LIKE/ILIKE operators (non-LEAKPROOF) may never
-- enter an Index Cond, so EVERY trgm index on this path is dead for authenticated
-- callers (verified empirically — even LEAKPROOF fold_text doesn't help; the operator
-- itself is the barrier). This resolver runs the axis searches as the definer
-- (RLS-bypassed, indexes live) and is TENANT-GATED with the exact predicate the RLS
-- policy enforces: callers only ever receive order ids of their OWN business.
-- Axis semantics are BYTE-IDENTICAL to the D1 shared-filter #1 block (same
-- derivations, same length guards, same note-gating absence). Callers pass RAW
-- p_search; all derivations live here (single source of truth for both RPCs).
declare
  v_search text;
  v_fq text;
  v_pq text;
begin
  -- tenant gate = the RLS predicate (orders_tenant_select)
  if p_business is null
     or p_business is distinct from (select public.current_user_digicom_business_id()) then
    raise exception 'orders_search_ids: business not permitted' using errcode = '42501';
  end if;

  v_search := nullif(btrim(coalesce(p_search, '')), '');
  if v_search is null then
    return;
  end if;
  v_fq     := public.like_escape(public.fold_text(v_search));
  v_pq     := regexp_replace(regexp_replace(v_search, '\D', '', 'g'), '^0+', '');
  v_search := public.like_escape(v_search);

  return query
    -- name axis (idx_orders_biz_name_fold_trgm)
    select o.id from public.orders o
    where o."DigiCom Business" = p_business and o.date_deleted is null
      and length(v_fq) >= 2 and public.fold_text(o.name) like '%' || v_fq || '%'
    union
    -- phone axis (idx_orders_biz_phonenorm_trgm)
    select o.id from public.orders o
    where o."DigiCom Business" = p_business and o.date_deleted is null
      and length(v_pq) >= 3 and public.normalize_phone_for_customer(o.phone) like '%' || v_pq || '%'
    union
    -- 9-column ilike axis (old-tracking/address/notes — residual scan axis; the
    -- documented 100x lever is a generated search-blob column + trgm index, which
    -- trades byte-parity for cross-column false positives — owner call, not taken)
    select o.id from public.orders o
    where o."DigiCom Business" = p_business and o.date_deleted is null
      and length(v_search) >= 2 and (
            o.coliaty_old_tracking ilike '%' || v_search || '%'
         or o.ameex_old_tracking ilike '%' || v_search || '%'
         or o.quicklivraison_old_tracking ilike '%' || v_search || '%'
         or o.forcelog_old_tracking ilike '%' || v_search || '%'
         or o.sendit_old_tracking ilike '%' || v_search || '%'
         or o.delvoexpress_old_tracking ilike '%' || v_search || '%'
         or o.address ilike '%' || v_search || '%'
         or o.note ilike '%' || v_search || '%'
         or o.delivery_note ilike '%' || v_search || '%')
    union
    -- company-parcel tracking axis (idx_cparcels_biz_track_trgm)
    select cp2.order_id from public.company_parcels cp2
    where cp2."DigiCom Business" = p_business and cp2.order_id is not null
      and length(v_search) >= 2 and cp2.tracking_code ilike '%' || v_search || '%'
    union
    -- courier-parcel tracking axis (idx_courparcels_biz_track_trgm)
    select crp2.order_id from public.courier_parcels crp2
    where crp2."DigiCom Business" = p_business and crp2.order_id is not null
      and length(v_search) >= 2 and crp2.tracking_code ilike '%' || v_search || '%'
    union
    -- product name/code axis (per-order EXISTS in the old block = plain semi-join here)
    select oi2.order_id from public.order_items oi2
    join public.products pr2 on pr2.id = oi2.product_id
    where oi2."DigiCom Business" = p_business
      and length(v_fq) >= 2
      and (public.fold_text(pr2.name) like '%' || v_fq || '%'
           or public.fold_text(pr2.code) like '%' || v_fq || '%');
end;
$function$;
REVOKE ALL ON FUNCTION public.orders_search_ids(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orders_search_ids(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.orders_list_page(p_business uuid, p_seller_scope uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_status uuid DEFAULT NULL::uuid, p_status_ids uuid[] DEFAULT NULL::uuid[], p_package uuid DEFAULT NULL::uuid, p_package_ids uuid[] DEFAULT NULL::uuid[], p_city uuid DEFAULT NULL::uuid, p_source text DEFAULT NULL::text, p_provider uuid DEFAULT NULL::uuid, p_date_field text DEFAULT 'date'::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_customer_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_tracking text DEFAULT NULL::text, p_product uuid DEFAULT NULL::uuid, p_confirmed_by uuid DEFAULT NULL::uuid, p_assigned_to uuid DEFAULT NULL::uuid, p_exchange text DEFAULT NULL::text, p_cursor_created timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
    v_cur_created timestamptz;
    v_cur_id uuid;
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
    -- OR-3: keyset cursor as PLAIN parameters. The old '(p_cursor_created IS NULL OR
    -- (created_at,id) < (…))' shape demotes the row-compare from Index Cond to Filter
    -- under a generic plan (verified on box; the COALESCE-in-SQL idiom does NOT fix it).
    -- Sentinels make page 1 a bare row-compare too: every real row sorts below
    -- (+infinity, max-uuid), so semantics are identical and the Index Cond survives
    -- any plan mode.
    v_cur_created := coalesce(p_cursor_created, 'infinity'::timestamptz);
    v_cur_id      := coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid);

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
          -- #1 top search — resolved to an id-set by public.orders_search_ids
          -- (SECDEF, tenant-gated; axis semantics byte-identical — see OR-B). The
          -- IN-set is uncorrelated: planner hashes it once per call.
          and (v_search is null or o.id in (select public.orders_search_ids(p_business, p_search)))
          -- <<< END D1 SHARED ORDERS FILTER >>>
          and (o.created_at, o.id) < (v_cur_created, v_cur_id)
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
                -- OR-1: per-page EXISTS probe replaces the business-wide phone_counts
                -- CTE (an O(N_business) group-by per page fetch). Same pool predicates,
                -- same normalization; a kept row is itself in the pool, so cnt>1 is
                -- exactly 'another pool row shares my normalized phone'. phone_norm is a
                -- plpgsql LEAKPROOF helper: RLS bars leaky expressions from Index Conds,
                -- and SQL-body wrappers inline back to leaky regexp_replace — plpgsql is
                -- what keeps idx_orders_biz_phone_norm usable here. O(page) probes.
                'is_duplicate_phone', (k.phone is not null and exists (
                    select 1 from public.orders d
                    where d."DigiCom Business" = p_business
                      and d.date_deleted is null
                      and d.source_review_status <> 'pending'
                      and d.phone is not null
                      and d.id <> k.id
                      and public.phone_norm(d.phone) = public.phone_norm(k.phone)
                ))
            ) as row_json
        from kept k
        left join public.order_statuses os on os.id = k.order_status_id
        left join public.package_statuses ps on ps.id = k.package_status_id
        left join public.master_cities mc on mc.id = k.master_city_id
        left join public.sales_channels sc on sc.id = k.source_id
        left join public.users cu on cu.id = k.courier_id
        left join public.users au on au.id = k.seller_id
        left join public.providers pv on pv.id = k.company_id
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
$function$
;

CREATE OR REPLACE FUNCTION public.orders_kpis(p_business uuid, p_seller_scope uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_status uuid DEFAULT NULL::uuid, p_status_ids uuid[] DEFAULT NULL::uuid[], p_package uuid DEFAULT NULL::uuid, p_package_ids uuid[] DEFAULT NULL::uuid[], p_city uuid DEFAULT NULL::uuid, p_source text DEFAULT NULL::text, p_provider uuid DEFAULT NULL::uuid, p_date_field text DEFAULT 'date'::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_customer_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_tracking text DEFAULT NULL::text, p_product uuid DEFAULT NULL::uuid, p_confirmed_by uuid DEFAULT NULL::uuid, p_assigned_to uuid DEFAULT NULL::uuid, p_exchange text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
          -- #1 top search — resolved to an id-set by public.orders_search_ids
          -- (SECDEF, tenant-gated; axis semantics byte-identical — see OR-B). The
          -- IN-set is uncorrelated: planner hashes it once per call.
          and (v_search is null or o.id in (select public.orders_search_ids(p_business, p_search)))
          -- <<< END D1 SHARED ORDERS FILTER >>>
    ;

    return v_result;
end;
$function$
;

COMMIT;

-- applied post-COMMIT on box: supabase default-privileges auto-grant anon EXECUTE on new fns
REVOKE EXECUTE ON FUNCTION public.orders_search_ids(uuid, text) FROM anon;
