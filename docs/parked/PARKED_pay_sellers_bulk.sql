-- ===========================================================================
-- D7b — pay_sellers_bulk: the atomic wrapper for the Salaries bulk payout loops
-- ===========================================================================
--
-- WHY THIS FILE EXISTS AT ALL (read before assuming it is misfiled):
-- Recon docs/d7-recon/02-pages.md §6b calls this "the highest value-per-effort
-- item in D7" and specifies the fix as a server-side RPC. The D7 SQL wave
-- (20260715040000_d7_customers_and_fixes.sql) shipped ① customers, ② the
-- webhook_logs index and ③ delivery_fees_bulk_apply — it does NOT contain
-- pay_sellers_bulk. Verified absent on the live box too:
--     select proname from pg_proc where proname='pay_sellers_bulk';  -- 0 rows
-- The FE fix is impossible without it: atomicity CANNOT be achieved from the
-- client — any client-side loop is non-atomic by construction. Authored as a
-- SEPARATE file so it cannot collide with the D7 migration. NOT APPLIED.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT (recon §6b — reclassified: this is a CORRECTNESS bug, not perf)
-- ---------------------------------------------------------------------------
-- admin/Salaries.tsx had TWO client loops over pay_seller, both with the same
-- shape:
--     settleMutation   :199-213   for (sid of sellerIds) { rpc pay_seller; if (error) throw }
--     generateMutation :1138-1147 for (t of targets)     { rpc pay_seller; if (error) throw }
-- Each pay_seller call is its own transaction. If target k fails, targets 0..k-1
-- are ALREADY COMMITTED and k..n never run. The mutation throws, the toast says
-- "Error", and the operator has NO indication that a partial payout landed.
-- Re-running the flow then DOUBLE-PAYS every seller that already succeeded.
-- Money-touching. Honours the "ALWAYS pay via pay_seller" ledger rule while
-- violating all-or-nothing.
--
-- Note the asymmetry the recon flags: the MB branch of the same mutation
-- (:1167-1174) is a single .upsert() — already atomic. Only the seller branch
-- looped.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
-- ---------------------------------------------------------------------------
-- A THIN WRAPPER. It contains NO payout logic of its own: it loops pay_seller
-- server-side inside ONE transaction, so the whole batch commits or rolls back.
-- The ledger rule ("ALWAYS pay via pay_seller, never write seller_payments
-- directly" — memory: payout-ledger-model) is preserved BY CONSTRUCTION: this
-- function's only write path is pay_seller itself. Amounts are still computed
-- client-side and relayed verbatim — this changes WHEN the writes abort, never
-- WHAT is written. Parity is exact on amounts, notes, and target selection.
--
-- ---------------------------------------------------------------------------
-- pay_seller, as it actually is on the box (inspected, not assumed)
-- ---------------------------------------------------------------------------
--   pay_seller(p_seller_id uuid, p_business_id uuid, p_amount numeric,
--              p_paid_at timestamptz default now(), p_note text default null)
--     returns uuid (the seller_payment_txns id)
--     SECURITY DEFINER, set search_path to 'public'
--   * It carries its OWN admin gate (check_user_role super admin/admin AND
--     current_user_digicom_business_id() = p_business_id) and raises
--     'forbidden: admin only'. This wrapper's gate is therefore defense in
--     depth, not the only gate — but the D3/D5 standing rule requires the gate
--     FIRST in the body of any RPC doing business-wide money writes, and a
--     clean '<fn>: admin only' + 42501 is what the rest of the D wave returns.
--     (pay_seller's own raise has no errcode → 'P0001'. Ours fires first.)
--   * It raises if p_amount is null or <= 0.
--   * >>> pg_advisory_xact_lock(hash(seller_id || business_id)) <<< — LOAD-BEARING
--     for this wrapper. See DEADLOCK below.
--
-- ---------------------------------------------------------------------------
-- DEADLOCK — the one real hazard introduced by moving the loop server-side
-- ---------------------------------------------------------------------------
-- pay_seller takes an advisory lock that is held to COMMIT (…_xact_lock). In the
-- old client loop each call was its own transaction, so each lock was taken and
-- released one at a time and two concurrent operators could never hold
-- overlapping sets. Here, ONE transaction accumulates N advisory locks and holds
-- them all to commit. Two admins bulk-settling overlapping seller sets in
-- opposite orders would deadlock.
-- MITIGATION: targets are processed in a DETERMINISTIC order (seller_id asc), so
-- any two concurrent bulk calls acquire the shared locks in the same order and
-- one simply waits. This is why the `order by 1` in the loop is not cosmetic.
--
-- ---------------------------------------------------------------------------
-- DEVIATIONS — flagged for owner ruling, NOT silently fixed (standing rule)
-- ---------------------------------------------------------------------------
--   (A) p_paid_at IS NOW ONE TIMESTAMP FOR THE BATCH. Today each iteration sends
--       a fresh `new Date().toISOString()`, so N txns get N timestamps that differ
--       by ~one RTT each (~190 ms apart, spanning ~90 s on a large batch). Every
--       txn in a batch now shares the caller's single p_paid_at. This is the same
--       class of deviation delivery_fees_bulk_apply flagged for updated_at.
--       Consequence: seller_payment_txns.paid_at is now identical across a batch.
--       Nothing reads paid_at for ordering within a batch (attribution is FIFO on
--       the ticket — memory: payout-order-attribution), so this is believed inert,
--       but it IS an observable change to stored money-adjacent data. OWNER RULING.
--   (B) DUPLICATE seller_id in p_targets RAISES (22023) instead of paying twice.
--       The old loop would have paid the same seller once per occurrence. Neither
--       client call site can produce a duplicate (both derive targets from a
--       de-duplicated roster keyed by seller), so this is defensive only. Raising
--       (rather than deduping) is the honest choice for money: dedupe would
--       silently DROP a disbursement that a caller asked for.
--   (C) NOT reproduced: the old settle loop's `inserted++` counter incremented only
--       for sellers it actually paid, after a client-side `remaining <= 0.005` skip.
--       That skip STAYS client-side (targets are pre-filtered before the call), so
--       the returned `paid` count equals the old `inserted` exactly.
--
-- Reversible: drop the one function. No schema change, no data change.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- pay_sellers_bulk — one transaction, N pay_seller calls, all-or-nothing.
--
-- p_targets: [{"seller_id": uuid, "amount": numeric}, ...]
-- Returns:   {"paid": int, "txn_ids": [uuid, ...], "paid_at": timestamptz}
--
-- On ANY failure NOTHING is written and the error names the offending seller
-- and its position in the batch — the honest analog of "per-seller failures"
-- when the batch is atomic: there are no partial failures to list, only the one
-- that aborted it.
-- ---------------------------------------------------------------------------
create or replace function public.pay_sellers_bulk(
    p_business uuid,
    p_targets jsonb,
    p_paid_at timestamptz default now(),
    p_note text default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path to ''
as $$
declare
    v_in_count integer;
    v_distinct integer;
    v_paid     integer := 0;
    v_txn      uuid;
    v_txn_ids  uuid[] := '{}';
    v_paid_at  timestamptz := coalesce(p_paid_at, now());
    r          record;
begin
    -- ADMIN GATE FIRST (business-wide money write — D3/D5 standing rule).
    -- pay_seller gates again per row; this is defense in depth + a clean errcode.
    if not (select public.current_user_is_business_admin()) then
        raise exception 'pay_sellers_bulk: admin only' using errcode = '42501';
    end if;

    if p_business is null then
        raise exception 'pay_sellers_bulk: p_business is required' using errcode = '22023';
    end if;
    if p_targets is null or jsonb_typeof(p_targets) <> 'array' then
        raise exception 'pay_sellers_bulk: p_targets must be a jsonb array' using errcode = '22023';
    end if;

    v_in_count := jsonb_array_length(p_targets);
    if v_in_count = 0 then
        raise exception 'pay_sellers_bulk: p_targets is empty' using errcode = '22023';
    end if;
    if v_in_count > 500 then
        raise exception 'pay_sellers_bulk: too_many_targets (max 500, got %)', v_in_count using errcode = '22023';
    end if;

    -- Malformed targets must abort the batch, never be skipped into a silent
    -- short payout.
    if exists (
        select 1 from jsonb_array_elements(p_targets) e
        where nullif(e->>'seller_id', '') is null
           or nullif(e->>'amount', '') is null
    ) then
        raise exception 'pay_sellers_bulk: every target needs a seller_id and an amount'
              using errcode = '22023';
    end if;

    -- Deviation (B): duplicates raise rather than pay twice.
    select count(distinct (e->>'seller_id')::uuid) into v_distinct
    from jsonb_array_elements(p_targets) e;
    if v_distinct <> v_in_count then
        raise exception 'pay_sellers_bulk: duplicate seller_id in p_targets (% targets, % distinct)',
              v_in_count, v_distinct using errcode = '22023';
    end if;

    -- `order by 1` is LOAD-BEARING, not cosmetic: pay_seller takes an advisory
    -- xact lock per seller and we hold every one of them to commit. A stable
    -- global order is what stops two concurrent bulk calls from deadlocking.
    for r in
        select (e->>'seller_id')::uuid as seller_id,
               (e->>'amount')::numeric as amount
        from jsonb_array_elements(p_targets) e
        order by 1
    loop
        begin
            v_txn := public.pay_seller(
                p_seller_id  => r.seller_id,
                p_business_id => p_business,
                p_amount     => r.amount,
                p_paid_at    => v_paid_at,
                p_note       => p_note
            );
        exception when others then
            -- Re-raise with the seller identified. The re-raise still aborts the
            -- whole transaction: NOTHING in this batch is written.
            raise exception 'pay_sellers_bulk: seller % (target % of %) failed: % — no payment in this batch was written',
                  r.seller_id, v_paid + 1, v_in_count, sqlerrm
                  using errcode = sqlstate;
        end;

        if v_txn is null then
            raise exception 'pay_sellers_bulk: pay_seller returned no txn for seller % — aborting',
                  r.seller_id using errcode = '23514';
        end if;
        v_txn_ids := v_txn_ids || v_txn;
        v_paid := v_paid + 1;
    end loop;

    if v_paid <> v_in_count then
        raise exception 'pay_sellers_bulk: paid % of % targets — aborting', v_paid, v_in_count
              using errcode = '23514';
    end if;

    return jsonb_build_object(
        'paid',    v_paid,
        'txn_ids', to_jsonb(v_txn_ids),
        'paid_at', v_paid_at
    );
end;
$$;

revoke all on function public.pay_sellers_bulk(uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.pay_sellers_bulk(uuid, jsonb, timestamptz, text) to authenticated;
alter function public.pay_sellers_bulk(uuid, jsonb, timestamptz, text) owner to postgres;

commit;
