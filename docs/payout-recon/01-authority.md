# GROUND TRUTH — pay_seller authority + the rolling ledger (live box, 2026-07-15)

All SQL below is `pg_get_functiondef` / catalog output from the live box via `~/.igrowfast/db.sh` (read-only). Graphify query run first per project law. Advisor tool returned "temporarily disabled" — proceeded without it.

**Headline:** the review's blocker is **CONFIRMED and under-stated**. `pay_seller` has no cap AND no idempotency key AND `seller_payment_txns` has no unique constraint beyond its `gen_random_uuid()` PK. A retry after a lost response inserts N duplicate txns, `paid_amount` doubles, and `close_seller_month` converts the overpayment into a **negative `carried_out` → negative next-month `carried_in`** — the exact shape of the documented −280 incident. Separately, the parked draft's deviation (A) (one shared `p_paid_at`) is **PROVEN INERT**, and its deadlock mitigation is **PROVEN INCOMPLETE** (does not cover cron job 8).

---

## (1) pay_seller — PROVEN

`public.pay_seller(p_seller_id uuid, p_business_id uuid, p_amount numeric, p_paid_at timestamptz DEFAULT now(), p_note text DEFAULT NULL) RETURNS uuid`
`LANGUAGE plpgsql · SECURITY DEFINER · SET search_path TO 'public' · OWNER postgres`

```sql
DECLARE
    v_month date := date_trunc('month', now())::date;
    v_month_txt text := to_char(v_month, 'YYYY-MM-01');
    v_ticket uuid; v_txn uuid; v_carry numeric;
BEGIN
    IF NOT (public.check_user_role(auth.uid(), ARRAY['super admin','admin'])
            AND public.current_user_digicom_business_id() IS NOT NULL
            AND public.current_user_digicom_business_id() = p_business_id) THEN
        RAISE EXCEPTION 'forbidden: admin only';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount must be > 0';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text || p_business_id::text, 0));
    SELECT id INTO v_ticket FROM public.seller_payments
     WHERE seller_id=p_seller_id AND "DigiCom Business"=p_business_id
       AND payout_month=v_month_txt AND period_state='open';
    IF v_ticket IS NULL THEN
        v_carry := COALESCE((SELECT carried_out FROM public.seller_payments
            WHERE seller_id=p_seller_id AND "DigiCom Business"=p_business_id AND period_state='closed'
            ORDER BY payout_month DESC LIMIT 1),0);
        INSERT INTO public.seller_payments
            (seller_id,"DigiCom Business",payout_month,carried_in,month_earned,delivered_orders,total_amount,period_state,earned_frozen)
        VALUES (p_seller_id,p_business_id,v_month_txt,v_carry,0,0,v_carry,'open',false)
        RETURNING id INTO v_ticket;
    END IF;
    PERFORM public.refresh_open_seller_ticket(p_seller_id, p_business_id, v_month);
    INSERT INTO public.seller_payment_txns (seller_payment_id, amount, paid_at, note, created_by, "DigiCom Business")
    VALUES (v_ticket, p_amount, p_paid_at, p_note, auth.uid(), p_business_id)
    RETURNING id INTO v_txn;
    RETURN v_txn;
END;
```

**Grants (proven):** `postgres=X/postgres | service_role=X/postgres | authenticated=X/postgres`. `anon`/`PUBLIC` **not** granted (matches `supabase/migrations/20260629170000_secure_pay_seller_pay_mediabuyer.sql:94`).

**Error paths — both are bare `RAISE EXCEPTION` with no `USING errcode`, therefore SQLSTATE `P0001` (raise_exception):**
| Condition | Message | SQLSTATE |
|---|---|---|
| caller not super admin/admin, or `current_user_digicom_business_id()` NULL or ≠ `p_business_id` | `forbidden: admin only` | `P0001` |
| `p_amount IS NULL OR p_amount <= 0` | `amount must be > 0` | `P0001` |
| (propagated) `refresh_open_seller_ticket` gate | `forbidden: admin only` | `P0001` |
| (propagated) FK violation on `seller_payment_id` / not-null on `amount`,`paid_at` | — | `23503` / `23502` |
| (propagated) lock waits | — | `40P01` deadlock_detected possible |

**WHAT IT GUARDS:** role + business scope; amount > 0; serialization per (seller, business) via `pg_advisory_xact_lock(hashtextextended(seller||business, 0))` **held to COMMIT**.

**WHAT IT DOES *NOT* GUARD — the money-critical list:**
1. **No cap against live remaining. CONFIRMED — the review is right.** `p_amount` is inserted verbatim. Nothing compares it to `seller_ledger.remaining` (= `total_amount − paid_amount`). Any amount > 0 is accepted, including one that exceeds what is owed. The `remaining <= 0.005` skip lives **only client-side** (`src/pages/admin/Salaries.tsx:200`, `:1134`).
2. **No idempotency key.** No `client_request_id`/dedupe column exists.
3. **No duplicate detection.** Two identical calls → two txns → `paid_amount` doubles.
4. **No upper bound / sanity limit** on `p_amount`.
5. **No check that `p_paid_at` is sane** (not in the future, not in another month).

**Month selection is `now()`-derived, NOT `p_paid_at`-derived** (`v_month := date_trunc('month', now())::date`). `p_paid_at` is *stored only*; it never selects the ticket. Two consequences:
- The parked draft's shared batch `p_paid_at` **cannot** misroute a txn to the wrong month's ticket. (Supports deviation (A) being inert.)
- **The bulk RPC silently FIXES a latent old-loop bug:** `now()` = transaction start timestamp, constant across the whole transaction. In today's client loop each `pay_seller` is its own transaction, so a batch running across midnight on the 1st of a month **splits across two months' tickets**. One transaction cannot. Unflagged improvement.

---

## (2) Triggers on seller_payments / seller_payment_txns — PROVEN

**`seller_payments`: ZERO user triggers.** Catalog returns only 6 internal `RI_ConstraintTrigger_*` (FK enforcement). No rules (`pg_rules` empty). No generated columns (`is_generated=NEVER` on all 16). **Every derived field on the ticket is written by `refresh_seller_payment_balance` alone** — nothing recomputes on direct UPDATE.

**`seller_payment_txns`: exactly one.**
```sql
CREATE TRIGGER trg_seller_payment_txns_aiud AFTER INSERT OR DELETE OR UPDATE
ON public.seller_payment_txns FOR EACH ROW EXECUTE FUNCTION trg_seller_payment_txns_refresh()
```
```sql
-- trg_seller_payment_txns_refresh() · SECURITY DEFINER · search_path 'public','pg_catalog'
IF TG_OP='DELETE' THEN PERFORM refresh_seller_payment_balance(OLD.seller_payment_id); RETURN OLD;
ELSIF TG_OP='UPDATE' AND OLD.seller_payment_id <> NEW.seller_payment_id THEN
    PERFORM refresh_seller_payment_balance(OLD.seller_payment_id);
    PERFORM refresh_seller_payment_balance(NEW.seller_payment_id); RETURN NEW;
ELSE PERFORM refresh_seller_payment_balance(NEW.seller_payment_id); RETURN NEW; END IF;
```
```sql
-- refresh_seller_payment_balance(p_payment_id uuid) · SECURITY DEFINER · search_path 'public'
SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.seller_payment_txns WHERE seller_payment_id=p_payment_id;
SELECT total_amount INTO v_total FROM public.seller_payments WHERE id=p_payment_id;
IF v_paid <= 0 THEN v_new_status:='pending'; v_paid_at:=NULL;
ELSIF v_paid >= COALESCE(v_total,0) THEN v_new_status:='paid';
    SELECT MAX(paid_at) INTO v_paid_at FROM public.seller_payment_txns WHERE seller_payment_id=p_payment_id;
ELSE v_new_status:='partial'; v_paid_at:=NULL; END IF;
UPDATE public.seller_payments SET paid_amount=v_paid, status=v_new_status, paid_at=v_paid_at WHERE id=p_payment_id;
```

### ORDER-DEPENDENT? **NO — proven.**
`refresh_seller_payment_balance` is a **full recompute** (`SUM(amount)` over the whole ticket), not a delta. It is idempotent and commutative. N inserts inside one transaction fire the AFTER-ROW trigger N times; each recomputes from scratch. **Final state is identical regardless of loop order.** → The parked draft's `order by 1` is load-bearing **only for deadlock avoidance**, never for ledger correctness. (Perf note: N inserts = N × (SUM + UPDATE); at the draft's 500-target cap that is 500 sequential scans of `idx_seller_payment_txns_payment` + 500 row updates — each on a *different* ticket, so no write amplification, but it is N round-trips of trigger work inside one transaction holding N advisory locks.)

### TIMESTAMP-DEPENDENT? **Only one place, and it is scoped and inert.**
`v_paid_at := MAX(paid_at)` — **only in the `'paid'` branch**, only over **one ticket's** txns. In a bulk batch each seller has their **own** ticket and receives **exactly one** txn (the draft raises `22023` on duplicate `seller_id`). So `MAX` is over a single new row (plus that ticket's pre-existing rows). A shared batch `p_paid_at` sets each fully-settled ticket's `paid_at` to the batch timestamp. **No cross-seller interference is possible — different tickets, different `p_payment_id`.**

---

## (3) The rolling ledger model — PROVEN

**`seller_ledger`** is a plain view over `seller_payments`, `reloptions = security_invoker=on`:
```sql
SELECT id, seller_id, payout_month, total_amount, delivered_orders, status, paid_at, created_at,
       "DigiCom Business", paid_amount, period_state, carried_in, month_earned, carried_out,
       closed_at, earned_frozen,
       COALESCE(total_amount,0) - COALESCE(paid_amount,0) AS remaining
FROM seller_payments sp;
```
`remaining` is **derived, not stored** — the number `pay_seller` refuses to check `p_amount` against.

**`refresh_open_seller_ticket(p_seller_id, p_business_id, p_month DEFAULT date_trunc('month',now())::date)`** · SECDEF · returns void:
- Gate: `IF auth.uid() IS NOT NULL AND NOT is_owner() AND NOT check_user_role(auth.uid(),ARRAY['super admin','admin']) THEN RAISE 'forbidden: admin only'`. **Note the `auth.uid() IS NOT NULL` — when `auth.uid()` is NULL (cron) the gate passes.** That is the deliberate cron path.
- Sums `seller_daily_earnings` (a **view**) for the month → `UPDATE seller_payments SET month_earned=v_earned, delivered_orders=v_units, total_amount = sp.carried_in + v_earned WHERE … period_state='open' AND (month_earned IS DISTINCT FROM v_earned OR delivered_orders IS DISTINCT FROM v_units) RETURNING id` → if changed, `refresh_seller_payment_balance(v_id)`.
- **`total_amount` = `carried_in + month_earned`, live-recomputed on every open ticket.**

**`close_seller_month(p_close_month date DEFAULT (date_trunc('month',now()) - '1 mon')::date)`** · SECDEF · same gate. Per `DISTINCT (seller_id, biz)` drawn from `seller_daily_earnings ∪ open seller_payments` for the closing month:
1. `pg_advisory_xact_lock(hashtextextended(r.seller_id::text || r.biz::text, 0))` — **byte-for-byte the same lock key as `pay_seller`.**
2. recompute `v_earned`, `v_units` from `seller_daily_earnings`.
3. **no ticket** → `v_carry_in` := latest `closed` ticket's `carried_out` (`ORDER BY payout_month DESC LIMIT 1`); `CONTINUE` if earned=0 and carry_in=0; else INSERT a `closed` ticket with `carried_out = v_carry_in + v_earned`.
4. **ticket `open`** → `v_total := carry_in + earned`; **`v_carry_out := v_total − v_paid`**; UPDATE → `period_state='closed'`, `earned_frozen=true`, `closed_at=now()`, `carried_out=v_carry_out`.
5. **ticket already `closed`** → read its `carried_out`.
6. INSERT next month's **open** ticket with `carried_in = v_carry_out`, `ON CONFLICT (seller_id,payout_month,"DigiCom Business") DO UPDATE SET carried_in=EXCLUDED.carried_in, … WHERE period_state='open'`.
7. `refresh_seller_payment_balance` for both months.

**THE CARRY MECHANIC AND THE −280 LINK (step 4 is the whole story):**
`carried_out = total_amount − paid_amount`. **It is not clamped at zero.** Overpay a ticket → `paid_amount > total_amount` → `carried_out < 0` → next month's `carried_in` is **negative** → next month's `total_amount = carried_in + month_earned` is **silently reduced**. An overpayment therefore does not surface as an error; it quietly claws itself back out of the seller's next month. That is precisely the documented −280 overpayment shape, and it is the mechanism by which **a duplicate bulk retry becomes a silent, delayed, multi-seller ledger corruption rather than a visible failure.**

**Cron (live `cron.job`):**
| jobid | schedule | command |
|---|---|---|
| 8 | `5 0 1 * *` | `SELECT public.close_seller_month();` |
| 9 | `20 * * * *` | `SELECT public.refresh_open_seller_ticket(seller_id, "DigiCom Business") FROM public.seller_payments WHERE period_state='open';` |

**Grants:** `close_seller_month`, `refresh_open_seller_ticket`, `refresh_seller_payment_balance` → `postgres=X | service_role=X` **only**. Not `authenticated`. They are reachable from the client *solely* through `pay_seller`'s SECDEF (owner `postgres`) frame. Consistent with `20260629160000_revoke_cron_only_money_fn_grants.sql`.

---

## (4) FIFO attribution — PROVEN, and the finding is decisive

### There is NO server-side counterpart. PROVEN.
Catalog sweep of every `public` function whose `pg_get_functiondef` mentions `carried_in`/`fifo`, or whose name matches `%payout%`/`%statement%`, returns exactly six — `close_mediabuyer_month`, `close_seller_month`, `pay_mediabuyer`, `pay_seller`, `refresh_open_mediabuyer_ticket`, `refresh_open_seller_ticket`. **None performs order attribution.** Functions referencing `seller_payment_txns`: `delete_business`, `pay_seller`, `refresh_seller_payment_balance`, `seller_roster_stats`, `trg_seller_payment_txns_refresh`. **Attribution is 100% client-side, in `src/lib/payoutOrderAttribution.ts`.**

> **DOC DEFECT — flagging because it will mislead the implementer.** `src/lib/payoutOrderAttribution.ts:52-56` states `sortOrdersFifo` is *"RUNTIME-DEAD, RETAINED DELIBERATELY (D7, 2026-07-15) — zero external callers. This is the parity reference for the FIFO ordering the payout RPCs implement server-side."* **Both claims are false.** (a) It is called internally at `:84` (`attributePaymentOrders`) and `:118` (`classifyMonthOrders`), which have five live call sites — it is runtime-**live**. (b) No payout RPC implements FIFO server-side; the catalog proves it. `PayoutPaymentDialogs.tsx:232-234` repeats the same fiction (*"the open ticket holds all carried-forward debt → FIFO oldest-first by construction"*). Anyone designing `pay_sellers_bulk` off these comments will assume a server-side FIFO invariant that does not exist.

### What attribution keys on: **MONEY. Not `paid_at`. Not `created_at`. Not `id`. Not txn order.**
```ts
// payoutOrderAttribution.ts:71-101
attributePaymentOrders(orders, carriedIn, windowStart, windowEnd)
  reportPortion = max(0, min(we, ci) − max(ws, 0));   // window ∩ carry-in
  cursor = ci; for (o of sortOrdersFifo(orders)) { start=cursor; end=cursor+o.commission;
    portion = max(0, min(end, we) − max(start, ws)); … cursor = end; }
```
The window is `[paidBefore, paidBefore + amount)` — **a cumulative-money interval**. Order sequence inside it comes from `sortOrdersFifo` (`:57-64`), which sorts on **`delivered_at` asc (nulls → +∞), tie-broken by `order_id`** — properties of the **order**, never of the payment.

`paidBefore` is a **money scalar**:
- `sendPayoutStatement.ts:94` — `paidBefore: number; // Σ paid across rows BEFORE this disbursement`
- `PayoutPaymentDialogs.tsx:103` — `sellerPaidAcrossRows?: number; // Σ paid_amount across ALL the seller's rows`, sourced from `Salaries.tsx:540` (`activeSeller.paidAcrossRows`), i.e. aggregated from `seller_payments.paid_amount` — **not from a `paid_at`-ordered scan of txns.**

Live call sites (all five, all client-side):
`PayoutPaymentDialogs.tsx:223` · `sendPayoutStatement.ts:155,157,276` · `SellerLedgerDialogs.tsx:134,434` · `seller/Payments.tsx:553`.

### Does attribution depend on distinct per-payment timestamps or their ORDER? **NO. PROVEN.**
`paid_at` appears in the attribution-adjacent code in exactly two roles, both non-attributive:
1. **Display ordering** of the txn history list: `PayoutPaymentDialogs.tsx:195` and `:566` → `.order('paid_at', { ascending: false })`. A tie yields an arbitrary display order **within one seller's txn list**. A bulk batch contributes **exactly one** row to any given seller's list → **no tie is even producible by the batch.**
2. **Statement header** (`paid_at: paidAtIso`, `sendPayoutStatement.ts:164`, `:306`, `:380`) — cosmetic.

**→ Parked draft deviation (A) is INERT. Verdict: PROVEN, not "believed".** Three independent reasons: (i) attribution windows are money-keyed, never timestamp-keyed; (ii) `pay_seller` selects the ticket from `now()`, not `p_paid_at`, so a shared timestamp cannot misroute a batch; (iii) the only timestamp consumer, `MAX(paid_at)`, is scoped to a single ticket that receives a single batch txn. The draft's own hedge (*"believed inert"*) can be upgraded.

**→ Additional fact the draft does not state: the bulk paths emit NO statements.** `sendSellerPayoutEmail` is imported and called **only** from `PayoutPaymentDialogs.tsx:19,~277` (the single-pay modal). `Salaries.tsx` — both loops — never calls it. So the FIFO/statement surface is untouched by this change either way. The `paidBefore` window is captured client-side **before** the RPC and would be stale for a bulk batch, but no bulk statement is generated, so it is moot **unless the redesign adds statement emission to bulk** — in which case each seller's `paidBefore` must be read per-seller, post-commit.

---

## THE BLOCKER — CONFIRMED, mechanism proven, severity higher than reported

**Non-idempotency is structural, at the storage layer.** Live indexes on `seller_payment_txns`:
```
seller_payment_txns_pkey            UNIQUE (id)          -- id DEFAULT gen_random_uuid()
idx_seller_payment_txns_business    (DigiCom Business)
idx_seller_payment_txns_payment     (seller_payment_id)
```
Columns: `id, seller_payment_id, amount, paid_at, note, created_by, "DigiCom Business", created_at`. **There is no natural key, no unique constraint any two identical payments could collide on, and no idempotency/request-id column.** The PK defaults to a fresh random UUID, so every insert is unique by construction. Both bulk loops pass a **constant** `p_note` (`'Settled in full from Salaries bulk action'` `Salaries.tsx:210`; `'Paid from Salaries generate flow'` `:1144`) — `note` cannot serve as a dedupe key either.

**Failure chain (each link proven above):**
1. `pay_sellers_bulk` COMMITs. Response is lost (network drop, Kong timeout, tab close, CF Tunnel blip).
2. Toast asserts *"No seller was paid — the whole batch was rolled back, so it is safe to retry."* — **an assertion the client cannot make**; the server outcome is UNKNOWN.
3. Operator retries. Nothing rejects it: no idempotency key (§ above), no unique constraint (§ above), no cap vs `remaining` (§1 — `p_amount` inserted verbatim), no duplicate detection.
4. N second txns insert. Trigger recomputes `paid_amount = SUM(amount)` → **doubled** for every seller in the batch.
5. `refresh_seller_payment_balance` sets `status='paid'` (`v_paid >= v_total`) — **the ledger reports a clean, fully-paid ticket. Nothing looks wrong.**
6. Month end, cron job 8 → `close_seller_month` step 4: `carried_out = total_amount − paid_amount` → **negative**, unclamped → next month's `carried_in` negative → next month's earnings silently reduced. **The −280 class, multiplied by the batch size.**

**The advisory lock does not help.** `pg_advisory_xact_lock` serializes concurrent writers; it has no memory across transactions. The retry's lock acquisition succeeds immediately once the first transaction has committed.

**The toast is the smaller half of the defect.** Making the message honest ("outcome unknown — verify before retrying") removes the false assertion but leaves the operator with no safe action and the system with no defense. Closing this properly requires **one of**: (a) an idempotency key on `seller_payment_txns` — a **schema change**, since no column or index exists to hang one on today; or (b) a server-side cap in `pay_seller`/the wrapper comparing `p_amount` against live `seller_ledger.remaining`, which bounds the blast radius of *any* double-write (this is the same missing guard the −280 incident already exploited, and it is missing from the single-pay path today too); or (c) a client-supplied batch id the wrapper checks for prior existence before writing. **(b) is the only one that also fixes the pre-existing, non-bulk overpayment hole.**

---

## SECONDARY FINDINGS on the parked draft (`docs/parked/PARKED_pay_sellers_bulk.sql`) — for the designer

| # | Finding | Status |
|---|---|---|
| S1 | **Deadlock mitigation is incomplete.** The file argues `order by 1` prevents deadlock. It prevents **bulk-vs-bulk** only. `close_seller_month` (cron job 8, `5 0 1 * *`) takes the **identical** lock key `hashtextextended(seller||biz,0)` in a loop, holds all to commit, and its driving `SELECT DISTINCT … UNION …` is **unordered**. `pay_sellers_bulk` ordered by `seller_id` vs `close_seller_month` in arbitrary order over an overlapping seller set → **deadlock (`40P01`) is possible**, and it would abort whichever loses — plausibly the month close. Window is narrow (00:05 on the 1st) but real, and the draft's rationale does not cover it. | **PROVEN mechanism**, INFERRED likelihood |
| S2 | **Wrapper gate is weaker than `pay_seller`'s.** The draft gates on `current_user_is_business_admin()`, whose live body is `SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id=auth.uid() AND u.role IN ('super admin','admin'))` — a **role check with no business scoping**. It does not verify the caller belongs to `p_business`. `pay_seller` re-gates per row with `current_user_digicom_business_id() = p_business_id`, so this is **not a security hole** (defense-in-depth holds), but a cross-business admin would pass the wrapper and be caught one frame deeper, surfacing as `pay_sellers_bulk: seller X (target 1 of N) failed: forbidden: admin only` rather than a clean `42501`. | PROVEN |
| S3 | The draft's claim that `pay_seller`'s own raise *"has no errcode → 'P0001'"* is **correct** — verified against the live body (bare `RAISE EXCEPTION`, both paths). | PROVEN |
| S4 | `if v_paid <> v_in_count then raise …` after the loop is **unreachable**: the loop either completes all iterations or raises. Dead code. | PROVEN |
| S5 | Each iteration's `begin … exception when others … end` opens a **subtransaction (implicit savepoint)** — 500 of them at the cap. Atomicity is unaffected (the handler re-raises), but it is real overhead and it makes `sqlstate` re-raise the only path; worth knowing it is not free. | PROVEN |
| S6 | `security invoker` + `set search_path to ''` is **sound**: `pay_seller` is granted to `authenticated` and is itself SECDEF/owner `postgres`, so the privileged inner calls (`refresh_open_seller_ticket`, `refresh_seller_payment_balance` — neither granted to `authenticated`) run in `pay_seller`'s frame. All references in the draft are schema-qualified; the rest are `pg_catalog`. | PROVEN |
| S7 | **The ledger law is honoured.** The draft's only write path is `pay_seller`. No direct `seller_payments` / `seller_payment_txns` writes. Consistent with memory `payout-ledger-model`. | PROVEN |
| S8 | **Unclaimed win:** the bulk RPC eliminates the old loop's month-boundary split (§1 — `now()` is transaction-constant; the client loop's per-call `now()` is not). | PROVEN |
| S9 | Deviation (C) is accurate: the `remaining <= 0.005` skip is client-side (`Salaries.tsx:200`, `:1134`), targets are pre-filtered (`:1133` `.filter((t) => t.amt > 0.005)`), so returned `paid` == old `inserted`. | PROVEN |

## Call sites the change must touch
- `src/pages/admin/Salaries.tsx:196-218` — `settleMutation`, loops `pay_seller` over `sellerIds`, `p_amount: o.remaining` (client-computed live remaining), `p_paid_at: new Date().toISOString()` (**client clock**), constant note. `if (error) throw error` mid-loop → partial commit, no operator signal.
- `src/pages/admin/Salaries.tsx:1128-1148` — `generateMutation`, seller branch, same shape. **The MB branch (`:1150-1170`) is a single `.upsert()` — already atomic.** Asymmetry confirmed.
- `src/components/salaries/PayoutPaymentDialogs.tsx:236-241` — single-pay modal, unaffected by the bulk change, **but shares the missing-cap hole**.

## Files
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/docs/parked/PARKED_pay_sellers_bulk.sql`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/payoutOrderAttribution.ts`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/sendPayoutStatement.ts`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Salaries.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/salaries/PayoutPaymentDialogs.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/salaries/SellerLedgerDialogs.tsx`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/migrations/20260629170000_secure_pay_seller_pay_mediabuyer.sql`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/migrations/20260629210000_scope_pay_fns_to_business_admin.sql`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/migrations/20260629160000_revoke_cron_only_money_fn_grants.sql`

## INFERRED (explicitly not proven)
- S1 deadlock **likelihood** (mechanism is proven; no observed occurrence, and the 00:05-on-the-1st window makes overlap unlikely).
- That option (b) — a server-side cap vs live `remaining` — is the right fix. The *absence* of the cap is proven; the choice of remedy is a design call requiring owner ruling, particularly because a cap changes behaviour on the **existing single-pay path**, where deliberate overpayment may be a used affordance. **Do not add a cap without ruling on whether any legitimate flow overpays on purpose.**
- Whether deviation (A)'s shared `p_paid_at` is acceptable as an *observable data change* remains an owner ruling; I have proven only that **nothing in the current codebase reads it in a way the change would break**.