-- ---------------------------------------------------------------------------
-- Admin unlock of delivered orders (owner request 2026-07-23).
--
-- The admin Orders page dropped its client-side lock on payment-terminal
-- orders (status.is_paid / is_unpaid — PAID and UNPAID): admins can again
-- edit, quick-status and bulk-act on delivered orders. The single-order edit
-- path is a direct table update (RLS + the admin-exempt attribution guard
-- already allow it); quick-status and bulk ride orders_bulk_guarded, which
-- changes here in three ways:
--
-- 1. ADMIN-AWARE LOCK: the 'locked' skip applies only to non-admins
--    (public.current_user_is_business_admin() = users.role in super
--    admin/admin). The RPC stays callable by any authenticated user, so the
--    seller-side lock still holds for direct PostgREST calls.
-- 2. HONEST kept_paid SKIP: zzz_orders_keep_paid silently reverts any status
--    change away from PAID while the order sits on a SETTLED company/courier
--    payment note (intentional ledger invariant, untouched). Pre-migration
--    that path was unreachable for locked rows; now the RPC detects the
--    revert (RETURNING order_status_id) and raises inside the per-row
--    subtransaction, rolling back the manual history row and reporting the
--    id as skipped 'kept_paid' instead of a false 'applied' + phantom
--    history entry.
-- 3. date_livraison PRESERVED: on a transition into a paid status the RPC
--    now stamps now() only when date_livraison IS NULL. Re-stamping an
--    already-delivered order (e.g. admin flips old UNPAID -> PAID) moved its
--    commission into the current open payout month while the frozen
--    historical month kept it (double-count). Matches the 2026-06-18
--    date_livraison attribution fix and the client-side edit-modal change
--    shipped with this migration.
--
-- Base definition verified against the box 2026-07-23 (no drift vs
-- 20260714220000_d1_orders_list.sql). CREATE OR REPLACE preserves grants.
--
-- Reversible: re-run the previous definition from 20260714220000.
-- ---------------------------------------------------------------------------

begin;

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
    v_is_admin boolean := public.current_user_is_business_admin();
    v_is_confirmed boolean := false;
    v_is_cancelled boolean := false;
    v_is_paid boolean := false;
    v_is_postponed boolean := false;
    v_applied jsonb := '[]'::jsonb;
    v_skipped jsonb := '[]'::jsonb;
    v_result_status uuid;
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
        -- Locked (payment-terminal) rows skip for non-admins only: business
        -- admins may edit delivered orders (owner ruling 2026-07-23).
        if r.locked and not v_is_admin then
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
                    -- Preserve the true delivery date: stamp only when missing
                    -- (re-stamping moves the commission month — see header §3).
                    date_livraison    = case when v_is_paid then coalesce(o.date_livraison, v_now) else o.date_livraison end,
                    reported_date     = case when v_is_postponed then coalesce(p_reported_date, v_now) else o.reported_date end
                where o.id = r.id
                returning o.order_status_id into v_result_status;
                -- zzz_orders_keep_paid (BEFORE UPDATE, fires last) reverts the
                -- status to PAID while the order is on a settled payment note.
                -- Detect it and roll this row back (history included) as an
                -- honest skip instead of a false 'applied' (see header §2).
                if found and v_result_status is distinct from p_status then
                    raise exception 'kept_paid';
                end if;
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

commit;
