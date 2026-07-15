-- ─────────────────────────────────────────────────────────────────────────────
-- O-4 — make the open-payout-ticket refresh SET-BASED so it can run at a live
--       cadence instead of hourly.
--
-- THE PROBLEM (measured, not assumed)
-- cron job 9 (`20 * * * *`) runs:
--     SELECT public.refresh_open_seller_ticket(seller_id, "DigiCom Business")
--       FROM public.seller_payments WHERE period_state='open';
-- That is ONE plpgsql invocation per open ticket, and each invocation
-- re-evaluates the seller_daily_earnings VIEW to SUM a single seller's month.
-- Measured on the box: 28.9 ms for 4 open tickets (~7 ms each). At 1000 sellers
-- that is ~7 s per run, and it degrades superlinearly because the view itself
-- grows with the seller count. That cost is precisely WHY the cadence is hourly.
--
-- And the hourly cadence is the ONLY reason the money surfaces disagree:
--   * LIVE (instant):  admin_dashboard_stats / seller_dashboard_stats /
--                      admin_analytics_stats read seller_daily_earnings direct.
--   * TICKET (hourly): seller_ledger -> the Salaries table + the pay-dialog
--                      prefill (PayoutPaymentDialogs.tsx:163).
-- Observed live this session: ticket 2930 vs view 2940 -> a real 10 MAD on-screen
-- disagreement, which resolved to 2960 == 2960 after the :20 cron ran.
-- Money was never wrong at payment time (pay_seller refreshes BEFORE recording,
-- and the overpay guard measures the refreshed figure) — this is display lag.
--
-- THE FIX
-- Evaluate the view ONCE, aggregate every (seller, business) for the current
-- month in a single pass, apply ONE set-based UPDATE. Only rows that actually
-- changed then get the existing, trusted refresh_seller_payment_balance() —
-- status/paid_at logic is NOT reimplemented here, it is reused.
--
-- EXACT DROP-IN SEMANTICS (deliberately NOT "improved")
--  * CURRENT MONTH ONLY. The cron calls refresh_open_seller_ticket(seller, biz)
--    with no p_month, so p_month defaults to date_trunc('month', now()) and the
--    inner UPDATE filters `payout_month = v_month_txt`. A stale open ticket from
--    an older month — e.g. oualidyopi's 2026-06 zero ticket, which
--    close_seller_month deliberately skips via its all-zero CONTINUE — is
--    therefore NEVER touched by the cron today. This reproduces that exactly.
--    Refreshing stale-month tickets would move money on a path nobody asked for.
--  * LEFT JOIN, not inner. An open ticket with zero earnings rows this month
--    must be driven to 0, matching the per-row COALESCE(SUM(...),0). An inner
--    join would silently skip it and leave a stale month_earned behind — the
--    exact class of hidden bug this migration exists to avoid.
--  * SAME change-guard (`IS DISTINCT FROM`), so a no-op run writes zero rows.
--  * SAME gate as the per-row function. Cron runs as `postgres` with
--    auth.uid() = NULL, which short-circuits the gate.
--  * SAME grants as refresh_open_seller_ticket: owner + service_role only.
--
-- NOT CHANGED HERE: the media-buyer side (cron 14). mb_month_earned() is a
-- per-MB function with its own orders join and salary/commission branching; it
-- cannot be trivially set-aggregated, and media buyers are few (1 open ticket
-- today) so the per-row cost stays bounded. Revisit if MB count grows.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.refresh_all_open_seller_tickets()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_month     date    := date_trunc('month', now())::date;
  v_month_txt text    := to_char(v_month, 'YYYY-MM-01');
  v_id        uuid;
  v_n         integer := 0;
begin
  -- Identical gate to refresh_open_seller_ticket. auth.uid() is NULL under cron.
  if auth.uid() is not null
     and not public.is_owner()
     and not public.check_user_role(auth.uid(), array['super admin','admin']) then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  for v_id in
    with earned as (
      -- ONE pass over the view for every seller in every business.
      select sde.seller_id,
             sde."DigiCom Business"                     as biz,
             coalesce(sum(sde.commission_earned), 0)    as earned,
             coalesce(sum(sde.delivered_count), 0)::int as units
        from public.seller_daily_earnings sde
       where date_trunc('month', sde.date)::date = v_month
       group by 1, 2
    ),
    tgt as (
      -- LEFT JOIN: an open ticket with no earnings rows this month resolves to
      -- 0, exactly as the per-row COALESCE(SUM(...),0) does.
      select sp.id,
             coalesce(e.earned, 0)     as new_earned,
             coalesce(e.units, 0)::int as new_units
        from public.seller_payments sp
        left join earned e
          on e.seller_id = sp.seller_id
         and e.biz       = sp."DigiCom Business"
       where sp.period_state = 'open'
         and sp.payout_month = v_month_txt
    ),
    upd as (
      update public.seller_payments sp
         set month_earned     = t.new_earned,
             delivered_orders = t.new_units,
             total_amount     = sp.carried_in + t.new_earned
        from tgt t
       where sp.id = t.id
         and (sp.month_earned     is distinct from t.new_earned
           or sp.delivered_orders is distinct from t.new_units)
      returning sp.id
    )
    select id from upd
  loop
    -- Reuse the trusted balance/status function for the FEW changed rows.
    -- total_amount just moved, so status ('paid'/'partial'/'pending') and
    -- paid_at must be re-derived. paid_amount itself is already kept in lockstep
    -- by trg_seller_payment_txns_aiud.
    perform public.refresh_seller_payment_balance(v_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$function$;

alter function public.refresh_all_open_seller_tickets() owner to postgres;
revoke all on function public.refresh_all_open_seller_tickets() from public;
grant execute on function public.refresh_all_open_seller_tickets() to service_role;
