-- T24: monthly digest — data layer + schedules.
--
-- Two read-only jsonb RPCs feed supabase/functions/monthly-digest (the dispatcher that renders
-- the monthly_performance / monthly_performance_mediabuyer emails), plus the two pg_cron
-- schedules that trigger it. Nothing here writes application data.
--
-- ── WHY THE JWT-IMPERSONATION PATTERN (read this before changing either function) ──
-- The email must never disagree with the dashboard. The only way to guarantee that is to read
-- the SAME aggregates the pages read, rather than re-deriving revenue / profit / delivery rate
-- in a second place that will silently drift. Those aggregates live in
-- public.admin_dashboard_stats and public.admin_analytics_stats, which are SECURITY INVOKER and
-- gated by public.current_user_is_business_admin() — a gate that reads auth.uid(). A cron/edge
-- caller has no auth.uid(), so a service-role call is REJECTED with 42501.
--
-- So the wrapper is SECURITY DEFINER and, for the duration of the call only, sets
-- request.jwt.claims to a real admin of THAT business — auth.uid() is defined as
-- current_setting('request.jwt.claims')::jsonb ->> 'sub' (verified live), so the gate then
-- passes as that admin. set_config(..., is_local => true) makes it transaction-local; the prior
-- value is captured and restored on both the normal and the exception path so the impersonation
-- cannot leak into the rest of the caller's transaction.
--
-- WHAT BOUNDS IT (the reason this is safe rather than a privilege hole):
--   * EXECUTE is revoked from PUBLIC/anon/authenticated and granted only to service_role, so no
--     browser session can reach it — see the REVOKE/GRANT block at the bottom.
--   * The business is an explicit argument, and the impersonated identity is derived FROM that
--     business. There is no path where a caller picks the identity, and no path where the
--     identity can widen the scope beyond the business already passed in.
--   * Everything reached is read-only: both stats RPCs are STABLE pure aggregates, and this
--     wrapper only reads. No branch writes.
--   * The impersonated claims carry role 'authenticated' only; they are never used to bypass
--     anything beyond the admin gate itself.
-- Note these functions are owned by postgres (BYPASSRLS), like every other RPC on this box, so
-- RLS is not the tenant boundary here — the explicit p_business argument is.
--
-- ── WHY TWO STATS RPCs ──
-- admin_dashboard_stats structurally does not carry net profit, ad spend or new customers; those
-- three live in admin_analytics_stats' 'profitability' and 'customers' sections (the Analytics
-- page). Both are admin-gated the same way, so one impersonation covers both. Splitting the
-- figures across the two RPCs is what keeps every number identical to the page the recipient can
-- open from the email — the alternative (hand-rolling profit/ad-spend SQL here) is exactly the
-- drift this design exists to prevent.
--
-- Rollback: drop the two functions; select cron.unschedule('monthly-digest-business');
--           select cron.unschedule('monthly-digest-mediabuyer');

BEGIN;

-- ─────────────────────────── business digest ───────────────────────────
-- Returns this month's and the previous month's figures for one business:
--   { business_id, month, prev_month, impersonated_admin,
--     current:  { month, revenue_total, net_profit, ad_spend, delivered_orders,
--                 delivery_rate, new_customers, top_product },
--     previous: { … same shape … } }
-- Raw numbers only — all formatting, delta and state logic belongs to the edge function.
-- Returns a jsonb null when the business has no eligible admin to impersonate (rather than
-- raising, so one unusable business cannot abort a whole monthly run).
CREATE OR REPLACE FUNCTION public.business_monthly_digest(p_business uuid, p_month date)
RETURNS jsonb
LANGUAGE plpgsql
-- Deliberately VOLATILE (the default): the body calls set_config(), so labelling it STABLE
-- would be a lie to the planner. Everything it READS is STABLE; nothing it does is cacheable.
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_prev  date := (date_trunc('month', p_month) - interval '1 month')::date;
  v_admin uuid;
  v_saved text;
  v_m     date;
  v_end   date;
  v_dash  jsonb;
  v_ana   jsonb;
  v_out   jsonb := '{}'::jsonb;
BEGIN
  -- Deterministic impersonation target: the OLDEST active, non-archived admin of this business,
  -- preferring the most privileged role first ('super admin' → 'business owner' → 'admin'). Two
  -- runs over unchanged data therefore always pick the same identity, which keeps the figures
  -- reproducible and makes the choice auditable (it is returned as impersonated_admin).
  -- The role set is exactly the one current_user_is_business_admin() accepts.
  SELECT u.id INTO v_admin
  FROM public.users u
  WHERE u."DigiCom Business" = p_business
    AND u.role IN ('super admin', 'business owner', 'admin')
    AND u.active IS TRUE
    AND u.archived_at IS NULL
  ORDER BY CASE u.role WHEN 'super admin' THEN 0 WHEN 'business owner' THEN 1 ELSE 2 END,
           u.created_at NULLS LAST, u.id
  LIMIT 1;

  IF v_admin IS NULL THEN
    RETURN 'null'::jsonb;
  END IF;

  v_saved := current_setting('request.jwt.claims', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  BEGIN
    FOREACH v_m IN ARRAY ARRAY[v_month, v_prev] LOOP
      -- Both stats RPCs take an inclusive [p_from, p_to] day range and convert it to a
      -- half-open Africa/Casablanca instant window internally, so passing the month's first and
      -- last day gives exactly this app's month boundaries.
      v_end := (v_m + interval '1 month' - interval '1 day')::date;

      v_dash := public.admin_dashboard_stats(p_business, v_m, v_end,
                  ARRAY['kpi_cards', 'products_performance']);
      v_ana  := public.admin_analytics_stats(p_business, v_m, v_end,
                  ARRAY['profitability', 'customers']);

      v_out := v_out || jsonb_build_object(
        CASE WHEN v_m = v_month THEN 'current' ELSE 'previous' END,
        jsonb_build_object(
          'month',            to_char(v_m, 'YYYY-MM-DD'),
          'revenue_total',    coalesce((v_ana #>> '{profitability,total_revenue}')::numeric, 0),
          'net_profit',       coalesce((v_ana #>> '{profitability,net_profit}')::numeric, 0),
          -- The Analytics page's ad spend is the sum of both streams: product-level ads_history
          -- pro-rated over the window, plus campaign_daily_entries spend.
          'ad_spend',         coalesce((v_ana #>> '{profitability,spend_product_ads}')::numeric, 0)
                            + coalesce((v_ana #>> '{profitability,spend_global_ads}')::numeric, 0),
          'delivered_orders', coalesce((v_dash #>> '{kpi_cards,delivered}')::int, 0),
          'delivery_rate',    coalesce((v_dash #>> '{kpi_cards,delivery_rate}')::numeric, 0),
          'new_customers',    coalesce((v_ana #>> '{customers,new_customers}')::int, 0),
          -- products_performance is already ordered (delivered_units desc, revenue desc, name,
          -- id) by the RPC itself, so element 0 IS the dashboard's own "top product". NULL when
          -- the month has none; the edge function degrades it to the em-dash.
          'top_product',      v_dash #>> '{products_performance,products,0,name}'
        ));
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Restore before re-raising: an aborted call must not leave someone else's identity in
    -- request.jwt.claims for the remainder of the transaction.
    PERFORM set_config('request.jwt.claims', coalesce(v_saved, ''), true);
    RAISE;
  END;

  PERFORM set_config('request.jwt.claims', coalesce(v_saved, ''), true);

  RETURN jsonb_build_object(
    'business_id', p_business,
    'month', to_char(v_month, 'YYYY-MM-DD'),
    'prev_month', to_char(v_prev, 'YYYY-MM-DD'),
    'impersonated_admin', v_admin
  ) || v_out;
END;
$$;

COMMENT ON FUNCTION public.business_monthly_digest(uuid, date) IS
  'T24 monthly digest source. SECURITY DEFINER wrapper that impersonates a deterministic admin '
  'of p_business (transaction-local request.jwt.claims, restored on every exit) so it can reuse '
  'admin_dashboard_stats + admin_analytics_stats — the same aggregates the Dashboard and '
  'Analytics pages read — instead of re-deriving the numbers and drifting from them. '
  'Read-only. service_role only. Returns jsonb null when the business has no eligible admin.';

-- ────────────────────────── media-buyer digest ─────────────────────────
-- Returns this month's and the previous month's figures for one media buyer in one business:
--   { mediabuyer_id, business_id, month, prev_month, payment_type,
--     current:  { month, delivered_orders, total_spend, campaigns_count, commission_earned,
--                 salary_earned, attributed_revenue, attributed_orders, source },
--     previous: { … same shape … } }
--
-- PAYOUT FIGURES: taken from the frozen public.mediabuyer_payments row for that payout_month
-- (source='payout') — that row is what cron job 13 close_mediabuyer_month writes and what the
-- media buyer sees on their Payments page, so it is what the email must repeat. Live
-- recomputation is only the fallback when no row exists (source='live'); that case is real,
-- because a media buyer with no spend and no carry-over gets no row at all, and the contract
-- still requires them to receive a mail (zeros).
-- Verified live 2026-08-03 that the two can diverge once months of edits land after a close
-- (Golden Design Pub / 2026-04: frozen 122 delivered / 5120.69 spend vs live 114 / 5024.29) —
-- which is exactly why the frozen row wins, and why attributed_orders is returned below.
--
-- ATTRIBUTED REVENUE: the order SET comes from public.mediabuyer_month_orders, so it is the
-- payout system's attribution by construction rather than a re-statement of it (a delivered,
-- non-swap, non-deleted, non-pending order counts for a media buyer when that buyer has a
-- campaign_daily_entries row on the SAME Casablanca day whose platform maps to the order's
-- source). That function is gated on auth.uid() = p_mb, hence the same impersonation pattern,
-- here with the media buyer's own identity — it grants no visibility they do not already have.
-- Only the per-order revenue expression is replicated (no function on this box returns it): it
-- is copied verbatim from admin_analytics_stats' profitability section (fin_orders.revenue),
-- the app's canonical pure-revenue chain.
-- attributed_orders is returned alongside so the CALLER can refuse to publish a ROAS whose
-- numerator (live) and denominator (frozen) come from different eras — the contract's
-- "emit — rather than invent one" rule. roas itself is computed by the caller.
CREATE OR REPLACE FUNCTION public.mediabuyer_monthly_digest(p_mb uuid, p_business uuid, p_month date)
RETURNS jsonb
LANGUAGE plpgsql
-- VOLATILE for the same reason as business_monthly_digest above (set_config in the body).
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_month   date := date_trunc('month', p_month)::date;
  v_prev    date := (date_trunc('month', p_month) - interval '1 month')::date;
  v_pt      text;
  v_saved   text;
  v_m       date;
  v_del     int;
  v_spend   numeric;
  v_camps   int;
  v_comm    numeric;
  v_sal     numeric;
  v_src     text;
  v_earned  numeric;
  v_att_ord int;
  v_att_rev numeric;
  v_out     jsonb := '{}'::jsonb;
BEGIN
  SELECT u.payment_type INTO v_pt FROM public.users u WHERE u.id = p_mb;
  IF NOT FOUND THEN
    RETURN 'null'::jsonb;
  END IF;
  v_pt := coalesce(v_pt, 'commission');

  v_saved := current_setting('request.jwt.claims', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_mb::text, 'role', 'authenticated')::text, true);

  BEGIN
    FOREACH v_m IN ARRAY ARRAY[v_month, v_prev] LOOP
      -- payout_month is text and is written as to_char(month, 'YYYY-MM-01') by
      -- close_mediabuyer_month — matched literally so the key can never drift.
      SELECT mp.delivered_orders, mp.total_spend, mp.campaigns_count,
             mp.commission_earned, mp.salary_earned, 'payout'
        INTO v_del, v_spend, v_camps, v_comm, v_sal, v_src
      FROM public.mediabuyer_payments mp
      WHERE mp.mediabuyer_id = p_mb
        AND mp."DigiCom Business" = p_business
        AND mp.payout_month = to_char(v_m, 'YYYY-MM-01');

      IF NOT FOUND THEN
        SELECT e.delivered, e.spend, e.campaigns, e.earned
          INTO v_del, v_spend, v_camps, v_earned
        FROM public.mb_month_earned(p_mb, p_business, v_m) e;
        -- Same commission/salary split close_mediabuyer_month applies when it writes the row.
        v_comm := CASE WHEN v_pt = 'salary' THEN 0 ELSE coalesce(v_earned, 0) END;
        v_sal  := CASE WHEN v_pt = 'salary' THEN coalesce(v_earned, 0) ELSE 0 END;
        v_src  := 'live';
      END IF;

      SELECT count(*)::int,
             coalesce(sum(
               (CASE WHEN coalesce(li.line_sum, 0) > 0 THEN li.line_sum
                     WHEN coalesce(o.raw_price, 0) > 0 THEN o.raw_price
                     ELSE CASE WHEN o.include_delivery_in_total IS FALSE
                               THEN coalesce(o.price, 0)
                               ELSE greatest(0, coalesce(o.price, 0) - coalesce(o.shipping_cost, 0)) END END)
             + (CASE WHEN o.include_delivery_in_total IS TRUE THEN coalesce(o.shipping_cost, 0) ELSE 0 END)
             ), 0)::numeric
        INTO v_att_ord, v_att_rev
      FROM public.mediabuyer_month_orders(p_mb, p_business, v_m) mo
      JOIN public.orders o ON o.id = mo.order_id
      LEFT JOIN LATERAL (
        SELECT sum(CASE WHEN coalesce(oi.total_price, 0) > 0 THEN oi.total_price
                        ELSE coalesce(oi.unit_price, 0) * oi.quantity END)
                 FILTER (WHERE oi.product_id IS NOT NULL AND coalesce(oi.quantity, 0) > 0) AS line_sum
        FROM public.order_items oi
        WHERE oi.order_id = o.id
      ) li ON true;

      v_out := v_out || jsonb_build_object(
        CASE WHEN v_m = v_month THEN 'current' ELSE 'previous' END,
        jsonb_build_object(
          'month',              to_char(v_m, 'YYYY-MM-DD'),
          'delivered_orders',   coalesce(v_del, 0),
          'total_spend',        coalesce(v_spend, 0),
          'campaigns_count',    coalesce(v_camps, 0),
          'commission_earned',  coalesce(v_comm, 0),
          'salary_earned',      coalesce(v_sal, 0),
          'attributed_revenue', coalesce(v_att_rev, 0),
          'attributed_orders',  coalesce(v_att_ord, 0),
          'source',             v_src
        ));
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims', coalesce(v_saved, ''), true);
    RAISE;
  END;

  PERFORM set_config('request.jwt.claims', coalesce(v_saved, ''), true);

  RETURN jsonb_build_object(
    'mediabuyer_id', p_mb,
    'business_id', p_business,
    'month', to_char(v_month, 'YYYY-MM-DD'),
    'prev_month', to_char(v_prev, 'YYYY-MM-DD'),
    'payment_type', v_pt
  ) || v_out;
END;
$$;

COMMENT ON FUNCTION public.mediabuyer_monthly_digest(uuid, uuid, date) IS
  'T24 monthly digest source for media buyers. Payout figures come from the frozen '
  'mediabuyer_payments row (falling back to mb_month_earned when none exists); attributed '
  'revenue is summed over mediabuyer_month_orders so the attribution is the payout system''s by '
  'construction. Impersonates the media buyer (transaction-local request.jwt.claims, restored on '
  'every exit) purely to satisfy that function''s auth.uid() gate. Read-only. service_role only.';

-- ─────────────────────────────── lockdown ──────────────────────────────
-- Standing repo trap: a new function is EXECUTE-able by PUBLIC by default, and on this box
-- anon/authenticated inherit that — which would expose whole-business money to any logged-in
-- session and, worse, hand it the impersonation above. Revoke first, then grant the single role
-- that may call these (the edge function's service-role bearer). Same ACL shape as
-- mb_month_earned: {postgres=X/postgres,service_role=X/postgres}.
REVOKE EXECUTE ON FUNCTION public.business_monthly_digest(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mediabuyer_monthly_digest(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.business_monthly_digest(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.mediabuyer_monthly_digest(uuid, uuid, date) TO service_role;

-- ──────────────────────────────── schedules ────────────────────────────
-- cron.timezone is GMT on this box (verified), so these cron strings are UTC.
--
-- Both digests must run AFTER cron job 13 close_mediabuyer_month ('5 0 1 * *'), because the
-- media-buyer mail repeats the frozen payout row that job writes, and the business mail's ad
-- spend includes the same month's campaign entries. 06:30 / 06:45 UTC on the 1st gives a ~6h
-- margin over that close (and over close_seller_month at the same minute), which is generous
-- enough that a slow close or a transient failure has already resolved; it is also 07:30 / 07:45
-- Africa/Casablanca, i.e. the recipient's morning rather than the middle of their night. The two
-- are 15 minutes apart so the two runs do not contend for the same SMTP account or edge worker.
--
-- Monthly, deliberately NOT hourly: a schedule that fired repeatedly would lean entirely on the
-- idempotency check for correctness. The real double-send guard is that check in the edge
-- function (email_log: same template_key + to_email inside the run month → skip); the schedule's
-- job is simply not to manufacture retries. app_invoke_edge is fire-and-forget (pg_net), so a
-- long run cannot block the cron worker.
--
-- audience is what separates the two schedules: the function defaults to 'all', and each job
-- pins its own half so neither job mails the other's recipients.
DO $$ BEGIN PERFORM cron.unschedule('monthly-digest-business'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'monthly-digest-business',
  '30 6 1 * *',
  $cron$select public.app_invoke_edge('monthly-digest', '{"audience":"business"}'::jsonb)$cron$
);

DO $$ BEGIN PERFORM cron.unschedule('monthly-digest-mediabuyer'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'monthly-digest-mediabuyer',
  '45 6 1 * *',
  $cron$select public.app_invoke_edge('monthly-digest', '{"audience":"mediabuyer"}'::jsonb)$cron$
);

COMMIT;
