-- ─────────────────────────────────────────────────────────────────────────────
-- O-1 (D5-BUG-1 + D5-BUG-2) — mb prior_paid: fix the dead month predicate and
-- sum paid_amount instead of total_amount. BOTH RPCs move together.
--
-- THE BUG (two stacked):
--  1. The month predicate compared the client's raw 'YYYY-MM' against
--     payout_month, which stores 'YYYY-MM-01' (TEXT). Matched 0 rows ALWAYS
--     => prior_paid_amount = 0, existing_payout = null,
--        remaining_amount = total_amount.
--  2. Even had it matched, it summed total_amount (invoiced), not paid_amount
--     (disbursed).
--
-- WHY IT WAS REPLICATED, AND WHY THAT NO LONGER APPLIES:
-- The d5 header (20260715030000, section 4) locked "replicate bug-for-bug" and
-- named the real hazard as Salaries.tsx L1151-1159 generating a payout with
-- total_amount = remaining_amount = the FULL month, ignoring prior payments =>
-- DOUBLE-PAY. That code was BulkGenerateDialog — never rendered, never invoked,
-- and DELETED in P-3 (bd470a4). useMediaBuyerEarnings is no longer imported by
-- Salaries.tsx at all. The double-pay path is gone, so the reason to replicate
-- the bug is gone with it.
--
-- WHAT REMAINED WAS A LIE TO A REAL PERSON: mediabuyer/Dashboard.tsx:431 and
-- mediabuyer/Payments.tsx:212 render `remaining_amount`, so a media buyer read
-- the FULL month as still owed even after being paid; the "déjà versés" banner
-- (Payments.tsx:249, gated on prior_paid_amount > 0) could never render. Also
-- MediaBuyers "Unpaid" KPI = full payroll, progress bar always 0%, paymentTier
-- always "Pays due", sortBy='unpaid' identical to sortBy='payroll'.
--
-- The d5 header REQUIRES mb_dashboard_stats.prior_paid to move in the SAME
-- commit or the MB dashboard and the leaderboard diverge. It does, below.
--
-- NO-OP ON CURRENT DATA (verified on the box): the only open MB ticket is
-- 2026-07-01 with paid_amount = 0, so prior_paid is 0 under BOTH the old and the
-- new predicate. Correct from the next partial payment onward.
--
-- NO PAY PATH READS THESE FIGURES: the admin pays via PayoutPaymentDialogs ->
-- pay_mediabuyer, which refreshes and computes its own remaining, backstopped by
-- the overpay guard (errcode 23514). These are display-only surfaces.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mb_roster_earnings(p_business uuid, p_month text, p_mb uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
    v_out         jsonb;
    v_month_start date;
begin
    -- SELF-OR-ADMIN GATE (recon 02 §5.1 ④; mirrors seller_dashboard_stats).
    if not coalesce(public.current_user_is_business_admin(), false)
       and (p_mb is null or p_mb is distinct from (select auth.uid())) then
        raise exception 'mb_roster_earnings: p_mb not permitted' using errcode = '42501';
    end if;

    -- Accrual month anchor. The client passes 'YYYY-MM' (MediaBuyers.tsx L155
    -- `format(new Date(),'yyyy-MM')`); 'YYYY-MM-DD' is accepted too. NOTE this
    -- normalization now drives the accrual math AND `prior_paid` /
    -- `existing_payout` (D5-BUG-1/2 fixed 2026-07-15; they used p_month RAW).
    v_month_start := date_trunc('month',
        (case when p_month ~ '^\d{4}-\d{2}$' then p_month || '-01' else p_month end)::date)::date;

    with roster as (
        select u.id,
               u.created_at,
               u.payment_type,
               coalesce(u.commission_price, 0)::numeric as commission_price,
               coalesce(u.salary_amount, 0)::numeric as salary_amount
        from public.users u
        where u."DigiCom Business" = p_business
          and u.role = 'mediabuyer'
          and (p_mb is null or u.id = p_mb)
    ),
    entries_m as (
        -- mb_month_earned's entries predicate + its inline 12-entry platform
        -- CASE, verbatim. Byte-identical to the client's getPlatformSource
        -- (src/lib/campaignConstants.tsx PLATFORM_SOURCE_MAP) — verified
        -- entry-by-entry. Deliberately NOT normalize_ad_source (D5-DEV-M6).
        select e.campaign_id,
               e.created_by,
               e.entry_date,
               e.platform,
               coalesce(e.spend, 0)::numeric as spend,
               case lower(e.platform)
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
                    else '' end as src
        from public.campaign_daily_entries e
        join roster r on r.id = e.created_by
        where e."DigiCom Business" = p_business
          and date_trunc('month', e.entry_date)::date = v_month_start
    ),
    spend_agg as (
        -- Computed for salaried MBs TOO (the authority computes v_spend/v_camps
        -- BEFORE its salary branch; the client also computes them
        -- unconditionally). D5-DEV-M8: campaigns_count is overridden on the
        -- roster card by owned_campaign_count anyway.
        select em.created_by as mb_id,
               coalesce(sum(em.spend), 0)::numeric as total_spend,
               count(distinct coalesce(em.campaign_id::text, '__orphan__' || em.platform))::int as campaigns_count
        from entries_m em
        group by 1
    ),
    pairs as (
        -- src = '' ⇒ DROPPED (client: `if (s) daySourceSet.add(...)`; D2's
        -- mb_dashboard_stats month_pairs takes the same stance). The authority's
        -- `else ''` would instead fall through to lower(source_name) = '' —
        -- live-verified 0 such orders. See the header.
        select distinct em.created_by as mb_id, em.entry_date as d, em.src
        from entries_m em
        where em.src <> ''
    ),
    del as (
        select pr.mb_id,
               count(distinct o.id)::int as delivered
        from pairs pr
        join public.orders o
          on (o.date at time zone 'Africa/Casablanca')::date = pr.d
         and lower(o.source_name) = pr.src
        join public.package_statuses ps on ps.id = o.package_status_id
        where o."DigiCom Business" = p_business
          and ps.is_delivered
          and o.date_deleted is null
          and o.source_review_status is distinct from 'pending'
          and coalesce(o.swap_only, false) = false
        group by 1
    ),
    earn as (
        select r.id as mb_id,
               coalesce(d.delivered, 0) as delivered_orders,
               case when r.payment_type = 'salary' then r.salary_amount else 0 end::numeric as salary_earned,
               case when r.payment_type = 'salary' then 0
                    else coalesce(d.delivered, 0) * r.commission_price end::numeric as commission_earned
        from roster r
        left join del d on d.mb_id = r.id
    ),
    priors as (
        -- D5-BUG-1 + D5-BUG-2 FIXED 2026-07-15. Was: `mp.payout_month = p_month`
        -- with p_month RAW ('YYYY-MM') against a column storing 'YYYY-MM-01'
        -- => 0 rows ALWAYS => prior_paid_amount = 0; and it summed total_amount
        -- (invoiced) instead of paid_amount (disbursed). The header's documented
        -- double-pay hazard was Salaries.tsx BulkGenerateDialog, which was DEAD
        -- CODE and has since been deleted (P-3, bd470a4) — so the only remaining
        -- effect was a media buyer reading `remaining_amount` = the FULL month on
        -- their own dashboard even after being paid. Now normalized + paid_amount.
        select mp.mediabuyer_id as mb_id,
               coalesce(sum(coalesce(mp.paid_amount, 0)), 0)::numeric as prior_paid_amount
        from public.mediabuyer_payments mp
        join roster r on r.id = mp.mediabuyer_id
        where mp."DigiCom Business" = p_business
          and mp.payout_month = to_char(v_month_start, 'YYYY-MM-01')
        group by 1
    ),
    existing as (
        -- Predicate normalized in lockstep with `priors` above (was the same
        -- dead 'YYYY-MM' match => null). D5-BUG-8: the client's mbPayments[0]
        -- is arbitrary; made deterministic here.
        select distinct on (mp.mediabuyer_id)
               mp.mediabuyer_id as mb_id,
               jsonb_build_object(
                   'id', mp.id,
                   'status', mp.status,
                   'total_amount', coalesce(mp.total_amount, 0),
                   'paid_amount', coalesce(mp.paid_amount, 0),
                   'paid_at', mp.paid_at
               ) as payout
        from public.mediabuyer_payments mp
        join roster r on r.id = mp.mediabuyer_id
        where mp."DigiCom Business" = p_business
          and mp.payout_month = to_char(v_month_start, 'YYYY-MM-01')
        order by mp.mediabuyer_id, mp.created_at, mp.id
    ),
    owned as (
        -- ownedCampaignCount (MediaBuyers.tsx L226-236): LIFETIME campaigns the
        -- buyer OWNS (created_by) — deliberately NOT the month-scoped
        -- campaigns_count, which is 0 in a month with no spend rows and
        -- contradicts the campaigns actually listed under the buyer.
        select c.created_by as mb_id,
               count(*)::int as owned_campaign_count
        from public.campaigns c
        join roster r on r.id = c.created_by
        where c."DigiCom Business" = p_business
        group by 1
    )
    select jsonb_build_object(
        'mediabuyers', coalesce((
            select jsonb_agg(jsonb_build_object(
                'mediabuyer_id', r.id,
                -- D5-DEV-M1: RAW count (client parity — drives podium/rank/sort).
                'delivered_orders', e.delivered_orders,
                'total_spend', coalesce(s.total_spend, 0),
                'campaigns_count', coalesce(s.campaigns_count, 0),
                'salary_earned', e.salary_earned,
                'commission_earned', e.commission_earned,
                'total_amount', e.salary_earned + e.commission_earned,
                'prior_paid_amount', coalesce(pp.prior_paid_amount, 0),
                'remaining_amount', greatest(0, (e.salary_earned + e.commission_earned)
                                                - coalesce(pp.prior_paid_amount, 0)),
                'owned_campaign_count', coalesce(oc.owned_campaign_count, 0),
                'existing_payout', ex.payout
            ) order by r.created_at, r.id)
            from roster r
            join earn e          on e.mb_id = r.id
            left join spend_agg s on s.mb_id = r.id
            left join priors pp   on pp.mb_id = r.id
            left join existing ex on ex.mb_id = r.id
            left join owned oc    on oc.mb_id = r.id
        ), '[]'::jsonb),
        -- LIFETIME payouts, biz-wide (folds MediaBuyers.tsx query #1). The page
        -- filters per MB client-side. Narrowed to p_mb on the self path.
        'payouts', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', mp.id,
                'mediabuyer_id', mp.mediabuyer_id,
                'payout_month', mp.payout_month,
                'total_amount', coalesce(mp.total_amount, 0),
                'paid_amount', coalesce(mp.paid_amount, 0),
                'delivered_orders', coalesce(mp.delivered_orders, 0),
                'status', mp.status,
                'paid_at', mp.paid_at,
                'created_at', mp.created_at
            ) order by mp.payout_month desc, mp.id)
            from public.mediabuyer_payments mp
            where mp."DigiCom Business" = p_business
              and (p_mb is null or mp.mediabuyer_id = p_mb)
        ), '[]'::jsonb)
    )
    into v_out;

    return v_out;
end
$function$

;

CREATE OR REPLACE FUNCTION public.mb_dashboard_stats(p_business uuid, p_mb uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
    v_today      date := (now() at time zone 'Africa/Casablanca')::date;
    v_month      text := to_char((now() at time zone 'Africa/Casablanca')::date, 'YYYY-MM');
    v_month_from date := date_trunc('month', (now() at time zone 'Africa/Casablanca')::date)::date;
    v_month_to   date := (date_trunc('month', (now() at time zone 'Africa/Casablanca')::date)
                          + interval '1 month' - interval '1 day')::date;
    v_payment_type text;
    v_comm_price numeric;
    v_salary     numeric;
    v_result     jsonb;
begin
    if p_mb is distinct from (select auth.uid())
       and not coalesce(public.current_user_is_business_admin(), false) then
        raise exception 'd2_dashboard: p_mb not permitted' using errcode = '42501';
    end if;

    select u.payment_type, coalesce(u.commission_price, 0), coalesce(u.salary_amount, 0)
    into v_payment_type, v_comm_price, v_salary
    from public.users u where u.id = p_mb;

    with entries_w as (
        select e.entry_date, e.platform, e.campaign_id,
               coalesce(e.spend, 0)::numeric as spend,
               coalesce(e.leads, 0)::int as leads,
               case lower(e.platform)
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
               end as src
        from public.campaign_daily_entries e
        where e."DigiCom Business" = p_business
          and e.created_by = p_mb
          and (p_from is null or e.entry_date >= p_from)
          and (p_to is null or e.entry_date <= p_to)
    ),
    entries_m as (
        select e.entry_date, e.platform, e.campaign_id,
               coalesce(e.spend, 0)::numeric as spend,
               case lower(e.platform)
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
               end as src
        from public.campaign_daily_entries e
        where e."DigiCom Business" = p_business
          and e.created_by = p_mb
          and e.entry_date >= v_month_from
          and e.entry_date <= v_month_to
    ),
    pending_flag as (
        select exists (select 1 from public.order_statuses where pending_confirmation) as ready
    ),
    pairs as (
        select distinct entry_date as d, src from entries_w where src <> ''
        union
        select distinct entry_date as d, src from entries_m where src <> ''
    ),
    buckets as (
        select pr.d, pr.src,
               (count(*) filter (where pf.ready and o.order_status_id is not null
                    and not coalesce(os.pending_confirmation, false)))::int as confirmed,
               (count(*) filter (where coalesce(ps.is_delivered, false)))::int as delivered
        from pairs pr
        cross join pending_flag pf
        join public.orders o
          on o."DigiCom Business" = p_business
         and o.date_deleted is null
         and o.source_review_status <> 'pending'
         and o.replace is distinct from true
         and o.source_name is not null
         and lower(o.source_name) = pr.src
         and (o.date at time zone 'Africa/Casablanca')::date = pr.d
        left join public.order_statuses os on os.id = o.order_status_id
        left join public.package_statuses ps on ps.id = o.package_status_id
        group by pr.d, pr.src, pf.ready
    ),
    d_rows as (
        select entry_date as d, sum(spend)::numeric as spend, sum(leads)::int as leads
        from entries_w group by entry_date
    ),
    d_srcs as (select distinct entry_date as d, src from entries_w),
    d_ord as (
        select ds.d,
               coalesce(sum(b.confirmed), 0)::int as confirmed,
               coalesce(sum(b.delivered), 0)::int as delivered
        from d_srcs ds
        left join buckets b on b.d = ds.d and b.src = ds.src
        group by ds.d
    ),
    daily as (
        select dr.d, dr.spend, dr.leads,
               coalesce(dq.confirmed, 0) as confirmed,
               coalesce(dq.delivered, 0) as delivered
        from d_rows dr left join d_ord dq on dq.d = dr.d
    ),
    p_rows as (
        select platform, max(src) as src,
               sum(spend)::numeric as spend, sum(leads)::int as leads
        from entries_w group by platform
    ),
    p_days as (select distinct platform, entry_date as d, src from entries_w),
    p_ord as (
        select pd.platform,
               coalesce(sum(b.confirmed), 0)::int as confirmed,
               coalesce(sum(b.delivered), 0)::int as delivered
        from p_days pd
        left join buckets b on b.d = pd.d and b.src = pd.src
        group by pd.platform
    ),
    c_rows as (
        select case when c.id is not null then c.id::text
                    else '__deleted__' || e.platform end as ckey,
               c.id as campaign_id,
               coalesce(c.name, '(Deleted) ' || e.platform) as name,
               coalesce(c.platform, e.platform) as platform,
               coalesce(c.status, 'deleted') as status,
               case when c.id is not null then c.currency else 'MAD' end as currency,
               e.entry_date, e.src, e.spend, e.leads
        from entries_w e
        left join public.campaigns c
          on c.id = e.campaign_id
         and c."DigiCom Business" = p_business
         and c.created_by = p_mb
    ),
    c_agg as (
        select ckey, max(campaign_id::text) as campaign_id,
               max(name) as name, max(platform) as platform,
               max(status) as status, max(currency) as currency,
               sum(spend)::numeric as spend, sum(leads)::int as leads
        from c_rows group by ckey
    ),
    c_days as (select distinct ckey, entry_date as d, src from c_rows),
    c_ord as (
        select cd.ckey,
               coalesce(sum(b.confirmed), 0)::int as confirmed,
               coalesce(sum(b.delivered), 0)::int as delivered
        from c_days cd
        left join buckets b on b.d = cd.d and b.src = cd.src
        group by cd.ckey
    ),
    month_pairs as (select distinct entry_date as d, src from entries_m where src <> ''),
    month_agg as (
        select
            (select coalesce(sum(spend), 0) from entries_m)::numeric as total_spend,
            (select count(distinct coalesce(campaign_id::text, '__orphan__' || platform))
             from entries_m)::int as campaigns_count,
            coalesce((select sum(b.delivered)
                      from month_pairs mp
                      join buckets b on b.d = mp.d and b.src = mp.src), 0)::int as delivered
    ),
    prior_paid as (
        -- D5-BUG-1/2 FIXED 2026-07-15, in lockstep with mb_roster_earnings (the
        -- d5 header requires both move together or the MB dashboard and the
        -- leaderboard diverge). Was: sum(total_amount) with `= v_month`
        -- ('YYYY-MM') against a column storing 'YYYY-MM-01' => 0 rows always.
        select coalesce(sum(coalesce(mp.paid_amount, 0)), 0)::numeric as amount
        from public.mediabuyer_payments mp
        where mp."DigiCom Business" = p_business
          and mp.mediabuyer_id = p_mb
          and mp.payout_month = to_char(v_month_from, 'YYYY-MM-01')
    )
    select jsonb_build_object(
        'totals', (
            select jsonb_build_object(
                'spend', coalesce(sum(spend), 0),
                'leads', coalesce(sum(leads), 0),
                'confirmed', coalesce(sum(confirmed), 0),
                'delivered', coalesce(sum(delivered), 0)
            ) from daily
        ),
        'daily', coalesce((
            select jsonb_agg(jsonb_build_object(
                'date', d, 'spend', spend, 'leads', leads,
                'confirmed', confirmed, 'delivered', delivered
            ) order by d)
            from daily), '[]'::jsonb),
        'per_platform', coalesce((
            select jsonb_agg(jsonb_build_object(
                'platform', pr.platform, 'spend', pr.spend, 'leads', pr.leads,
                'confirmed', coalesce(po.confirmed, 0),
                'delivered', coalesce(po.delivered, 0)
            ) order by pr.spend desc, pr.platform)
            from p_rows pr left join p_ord po on po.platform = pr.platform), '[]'::jsonb),
        'per_campaign', coalesce((
            select jsonb_agg(jsonb_build_object(
                'key', ca.ckey,
                'campaign_id', ca.campaign_id,
                'name', ca.name, 'platform', ca.platform,
                'status', ca.status, 'currency', ca.currency,
                'spend', ca.spend, 'leads', ca.leads,
                'confirmed', coalesce(co.confirmed, 0),
                'delivered', coalesce(co.delivered, 0)
            ) order by ca.ckey)
            from c_agg ca left join c_ord co on co.ckey = ca.ckey), '[]'::jsonb),
        'today_entry_campaign_ids', coalesce((
            select jsonb_agg(distinct e.campaign_id)
            from public.campaign_daily_entries e
            where e."DigiCom Business" = p_business
              and e.created_by = p_mb
              and e.entry_date = v_today
              and e.campaign_id is not null), '[]'::jsonb),
        'month_earnings', (
            select jsonb_build_object(
                'month', v_month,
                'delivered_orders', ma.delivered,
                'total_spend', ma.total_spend,
                'campaigns_count', ma.campaigns_count,
                'salary_earned', case when v_payment_type = 'salary' then v_salary else 0 end,
                'commission_earned', case when v_payment_type = 'commission'
                    then ma.delivered * v_comm_price else 0 end,
                'total_amount',
                    (case when v_payment_type = 'salary' then v_salary else 0 end)
                  + (case when v_payment_type = 'commission' then ma.delivered * v_comm_price else 0 end),
                'prior_paid_amount', pp.amount,
                'remaining_amount', greatest(0,
                    (case when v_payment_type = 'salary' then v_salary else 0 end)
                  + (case when v_payment_type = 'commission' then ma.delivered * v_comm_price else 0 end)
                  - pp.amount)
            )
            from month_agg ma, prior_paid pp
        )
    )
    into v_result;

    return v_result;
end;
$function$

;
