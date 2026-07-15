# D7b recon — is all-or-nothing batch atomicity correct for seller payouts?

**VERDICT UP FRONT: NO. All-or-nothing is the wrong semantic. Per-seller independence is correct — but the batching axis is a distraction. The parked draft does not fix the actual money bug, and it introduces a new deadlock class. Do NOT apply `PARKED_pay_sellers_bulk.sql`.**

The decisive finding: **the failure class the whole design debate is built on is nearly empty.** `pay_seller` has almost no per-seller guards, so "seller #3 of 5 raises" is close to unreachable. Meanwhile the failure that *actually* happens (transport) is unknown-outcome, and BOTH designs are vulnerable to it. The real bug is elsewhere and neither design touches it.

---

## 1. PROVEN — live definitions (box, via `db.sh`)

### `pay_seller` (SECURITY DEFINER, `search_path=public`, returns uuid)
```sql
v_month date := date_trunc('month', now())::date;           -- CURRENT month
IF NOT (check_user_role(auth.uid(), ARRAY['super admin','admin'])
        AND current_user_digicom_business_id() = p_business_id) THEN
    RAISE EXCEPTION 'forbidden: admin only';                 -- no errcode -> P0001
END IF;
IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text || p_business_id::text, 0));
SELECT id INTO v_ticket FROM seller_payments
 WHERE seller_id=… AND payout_month=v_month_txt AND period_state='open';
IF v_ticket IS NULL THEN … INSERT … RETURNING id INTO v_ticket; END IF;
PERFORM refresh_open_seller_ticket(p_seller_id, p_business_id, v_month);
INSERT INTO seller_payment_txns (…) VALUES (v_ticket, p_amount, p_paid_at, …) RETURNING id INTO v_txn;
RETURN v_txn;
```

**`pay_seller` has exactly THREE raise paths: the admin gate, `amount <= 0`, and whatever the INSERTs hit.** That is the entire guard surface.

### The guard surface, in full (`pg_constraint`)
```
seller_payment_txns_amount_check        CHECK (amount > 0)
seller_payment_txns_seller_payment_id_fkey  FK -> seller_payments ON DELETE CASCADE
seller_payments_uq_seller_month_biz    UNIQUE (seller_id, payout_month, "DigiCom Business")
seller_payments_total_consistency_chk  CHECK (total_amount = carried_in + month_earned)
seller_payments_status_check           CHECK (status IN ('pending','partial','paid'))
seller_payments_period_state_chk       CHECK (period_state IN ('open','closed'))
```

### >>> THERE IS NO OVERPAY GUARD. ANYWHERE. <<<
`refresh_seller_payment_balance` is the only thing that reads the total:
```sql
SELECT COALESCE(SUM(amount),0) INTO v_paid FROM seller_payment_txns WHERE seller_payment_id = p_payment_id;
IF v_paid <= 0 THEN v_new_status := 'pending';
ELSIF v_paid >= COALESCE(v_total,0) THEN v_new_status := 'paid';   -- >= , not =
ELSE v_new_status := 'partial'; END IF;
UPDATE seller_payments SET paid_amount = v_paid, status = v_new_status …;
```
It **records** overpayment as `paid_amount > total_amount` and calls it `'paid'`. It never rejects it. `paid_amount` exceeding `total_amount` is representable, reachable, and silent. **This is the −280 overpayment incident class, and it is still live and unguarded.**

**Consequence that breaks the review's own premise:** the task brief lists "a 0-remaining seller" as a thing that makes `pay_seller` raise. **It does not raise.** It silently inserts a txn and overpays. Verified: no guard exists on any path.

### Concurrent writers (`cron.job`)
```
8  | 5 0 1 * *  | seller_month_close          | SELECT public.close_seller_month();
9  | 20 * * * * | seller_open_ticket_refresh  | SELECT refresh_open_seller_ticket(seller_id,"DigiCom Business")
                                                FROM seller_payments WHERE period_state='open';
```
`close_seller_month` defaults to `date_trunc('month', now()) - 1 mon` — it closes the **prior** month, never the current one. It takes `pg_advisory_xact_lock` on the **same key** as `pay_seller`, for every seller, **in one transaction**, iterating an **unordered `SELECT DISTINCT`** (no `ORDER BY` — verified in the body).

### Live ledger scale — the number that ends the perf argument
```
sellers_with_open_ticket_owing   2
businesses_with_open_owing       2
total_seller_payments_rows      12
total_txns                      21          <- lifetime, ~15 months
overpaid_tickets(paid>total)     0
```
Txn history: **21 txns, 4 distinct sellers, ~15 months.** Grouped by minute, only two minutes ever had >1 txn — `'restore: audit-verified recovery of reversed txns'` and `'Backfilled from legacy paid status'`. **A multi-seller bulk settle has never once occurred in production.** Realistic batch = 1–3 sellers.

### `pay_sellers_bulk` absent; draft dependencies present
`select count(*) from pg_proc where proname='pay_sellers_bulk'` → **0**. `current_user_is_business_admin`, `current_user_digicom_business_id`, `check_user_role`, `is_owner` all exist.

### Advisory locks vs savepoints — measured, not assumed
```sql
begin;
  select pg_advisory_xact_lock(987654321987);
  savepoint sp1;
  select pg_advisory_xact_lock(987654321988);
  rollback to savepoint sp1;
  select objid, classid from pg_locks where locktype='advisory';
  -- -> 4106811203 | 229   (ONE row = 987654321987 only; 229*2^32+4106811203 = 987654321987)
rollback;
```
**PROVEN: `rollback to savepoint` DOES release advisory xact locks acquired inside the subtransaction; locks acquired before it survive to COMMIT.** Load-bearing for option (d) below.

---

## 2. (a) Today's loop — what actually happens on seller #3 of 5

`src/pages/admin/Salaries.tsx` @ HEAD. Two loops, identical shape:

- **`settleMutation`** (:196-222) — `for (const sid of sellerIds) { … rpc('pay_seller', { p_amount: o.remaining, … }); if (error) throw error; inserted++; }`
- **`generateMutation`** (:1128-1189, seller branch) — `for (const t of targets) { … rpc('pay_seller', { p_amount: t.amt, … }); if (error) throw error; }`

**On seller #3 failing:** #1,#2 are committed (each RPC is its own txn). #4,#5 never run. The mutation throws.

**What the operator sees:**
```ts
onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
```
That is the *entire* error path — at :221 and :1188. Verified by grep over HEAD: `invalidateAll()` appears **only** in `onSuccess` (:217). **Neither `onError` invalidates the query cache.**

So: raw Postgres error text, no seller identified, no "2 of 5 landed", and — critically — **the UI still shows #1 and #2 as owing, because the cache was never invalidated.** In `generateMutation`, `onOpenChange(false)` is also success-only, so the wizard **stays open with the stale seeded `amounts` state**.

**>>> THIS is the real double-pay vector, and it is in TODAY'S code. <<<**

Note the near-miss that makes this so sharp: both loops are **remaining-based** — `settleMutation` sends `o.remaining`; `generateMutation` sends `amountFor()` which clamps `Math.min(v, oweFor(id))`. **If the cache were refreshed, a retry would be self-healing**: already-paid sellers show `remaining ≈ 0`, get skipped by the `<= 0.005` filter, and the retry is a natural no-op. The design is *one `invalidateQueries` call away from being idempotent*. Instead, `onError` leaves stale data, the operator hits Pay again, stale amounts replay against a ledger that already moved, and **`pay_seller` has no overpay guard to catch it.**

**Is the partial-commit behaviour a BUG or benign?**
**The partial commit itself is BENIGN — arguably correct.** Paying Ahmed is a completed, independent economic fact; it is not made wrong by Fatima's payment failing. The rolling ledger is *additive*: each txn is an independent disbursement against a rolling ticket, and the next run tops up whatever is left because amounts are remaining-based. There is **no cross-seller invariant** anywhere in the schema — no constraint, trigger, or ticket spans two sellers. Each seller has their own ticket row and their own advisory lock.

**What IS the bug** is the reporting and the cache:
1. `onError` doesn't invalidate → stale replay → double-pay. **P1, live today.**
2. `inserted` is computed but discarded on error → operator cannot know what landed. **P1.**
3. No server-side overpay guard → nothing catches (1). **P1, the −280 class.**

The recon's framing ("Money-touching… violates all-or-nothing") diagnosed the *symptom* (partial commit) and missed the *cause* (stale-cache retry into an unguarded RPC).

---

## 3. (b) Under all-or-nothing — better or worse?

**Does the rolling ledger tolerate the rollback?** Yes, trivially — no txns inserted, state unchanged, no compensation needed. Rollback is clean. But so is partial commit. **The ledger tolerates BOTH, which means atomicity buys nothing here.** Atomicity exists to protect invariants that span a set. **Payroll has no such invariant.** Rolling 5 sellers into one transaction *manufactures a coupling the business domain does not have* — you do not claw back Ahmed's salary because Fatima's ticket was closed.

**Starvation / head-of-line:** Real in principle, negligible here. The only *persistent* per-seller failure I can find is the closed-current-month `23505` (§4.4). With batches of 1–3 the operator just deselects and re-runs. So starvation is theoretical — **but so is the partial-commit it's paying for.** Both sides of this trade are theoretical; that's the point.

**The cost of all-or-nothing is NOT theoretical:**

**Blocker B2 (NEW — not in the review): deadlock vs `close_seller_month`.** The draft's own comment claims `order by 1` fixes the deadlock. **It only defends bulk-vs-bulk.** `close_seller_month` is a *single transaction* that takes `pg_advisory_xact_lock` on the **same key** for **every seller across every business**, iterating an **unordered `SELECT DISTINCT`**. `pay_sellers_bulk` holds N locks to COMMIT in seller_id order. Cycle: bulk holds lock(A) wants lock(B); close holds lock(B) wants lock(A) → **40P01**. Under today's loop this is *structurally impossible* — each `pay_seller` is its own txn, so each lock is taken and released one at a time and no client-side loop can ever hold two at once. **All-or-nothing introduces a deadlock class that per-seller independence makes unreachable.** Low probability (close fires 00:05 on the 1st), but it is a *new, real* risk traded for an *old, empty* one.

**Blocker B1 (the review's, confirmed): the false "safe to retry" claim.** Correct, and worse than stated. Under all-or-nothing the blast radius of a lost-response retry is **the entire batch double-paid**, versus at most the in-flight seller under the loop. Atomicity *concentrates* the damage of the only failure that actually happens.

**Blocker B3 (NEW): the draft's gate ignores `p_business`.**
```sql
if not (select public.current_user_is_business_admin()) then …
```
`current_user_is_business_admin()` takes **no argument** — it checks `role IN ('super admin','admin')` and nothing else. It never verifies `p_business = current_user_digicom_business_id()`. Not exploitable (`pay_seller`'s own gate catches it per row), but the draft's comment calling this "defense in depth" **overstates it — it is strictly weaker than the gate it claims to reinforce.**

**Blocker B4 (NEW): the draft does not fix the money bug.** It relays client amounts verbatim ("changes WHEN the writes abort, never WHAT is written" — its own words). With no overpay guard, `pay_sellers_bulk` is just as capable of overpaying as the loop. **It is a correctness fix that fixes no correctness.**

Draft deviations (A) single `paid_at` and (B) duplicates raise are both **fine** — (A) is arguably an improvement, (B) is the honest choice.

---

## 4. (c) Real failure modes, enumerated against the live guard surface

| # | Failure | Errcode | Per-seller or uniform? | Likelihood in a real run |
|---|---------|---------|------------------------|--------------------------|
| 1 | Admin gate (`forbidden: admin only`) — session expired, wrong business | P0001 | **Uniform** — fires at target **#1**, nothing committed | **MODERATE — the most likely business failure.** Identical outcome under both designs. |
| 2 | `amount must be > 0` | P0001 | per-seller | **~ZERO** — both call sites pre-filter `> 0.005` |
| 3 | `seller_payment_txns_amount_check` | 23514 | per-seller | ~ZERO — dominated by #2 |
| 4 | **Closed current-month ticket** → `SELECT … period_state='open'` misses → INSERT → `seller_payments_uq_seller_month_biz` | **23505** | **per-seller, PERSISTENT** | **VERY LOW** — requires `close_seller_month(current_month)` called manually; cron only closes the prior month. **The only genuine starvation candidate.** |
| 5 | FK violation (seller deleted mid-run) | 23503 | per-seller | ~ZERO — wouldn't be in the roster |
| 6 | `seller_payments_total_consistency_chk` | 23514 | per-seller | ~ZERO — `refresh_open_seller_ticket` sets `total = carried_in + earned`, consistent by construction |
| 7 | **Deadlock** vs `close_seller_month` / concurrent bulk | **40P01** | batch-wide | **VERY LOW — and only exists UNDER all-or-nothing** (§3, B2) |
| 8 | Advisory-lock wait / statement timeout (cron job 9 refreshes open tickets hourly at :20) | 57014 | batch-wide | LOW; window grows under bulk (N locks held to commit) |
| 9 | **Transport / lost response** | n/a | **UNKNOWN outcome** | **HIGH — this is the dominant real-world failure** |
| 10 | 0-remaining seller | **NONE** | — | **DOES NOT RAISE — silently overpays** (§1) |

**Read the table.** In a real payroll run the only things that happen are **#1 (uniform — fires at target #1, so nothing is committed under *either* design)** and **#9 (transport — unknown outcome under *both* designs)**. **The "seller #3 of 5 raises mid-batch" scenario that justifies the entire atomicity fix requires #4, whose probability is ~0.** And #10 — the one the brief assumed was a raise — is the *unguarded overpay path* that neither design closes.

**Historical failures visible in the data:** none. 21 txns, zero overpaid tickets, zero evidence of a partial batch. The `'restore: audit-verified recovery of reversed txns'` note (2 txns, 2026-06-17) is the only incident fingerprint — consistent with the −280 register, i.e. **an overpay/reversal event, not a partial-batch event.** The data says the money bug that *has actually bitten* is overpayment, not atomicity.

---

## 5. (d) The third option — and it's better than both

**Neither "all-or-nothing" nor "per-seller savepoints" addresses the failure that actually occurs (#9). Both are answers to the wrong question.** The right question is: *why is a retry unsafe at all?*

The answer: because the client sends a **stale absolute amount** into an RPC with **no overpay guard**. Fix that and retry-safety falls out for free, under any batching model.

### Recommended, in priority order

**1. `pay_seller` gains an overpay guard.** *(the real fix — independent of batching)*
```sql
-- after refresh_open_seller_ticket, before the txn INSERT:
IF p_amount > (SELECT total_amount - paid_amount FROM seller_payments WHERE id = v_ticket) + 0.005 THEN
    RAISE EXCEPTION 'pay_seller: amount % exceeds remaining % on ticket %', … USING ERRCODE='23514';
END IF;
```
Closes the −280 class *and* turns the stale replay into a clean, loud rejection instead of a silent double-pay.
**⚠ OWNER RULING REQUIRED: are advances / intentional overpayments ever legitimate?** If yes this must be an explicit `p_allow_advance boolean` opt-in, not a hard block. Do not guess — the register shows overpay has real history.

**2. Server-computed amounts for the "settle in full" path.** `settleMutation` means *"pay whatever is left"* — that number should never be computed on a client. A `settle_sellers_full(p_business uuid, p_seller_ids uuid[])` that derives `remaining` **server-side, inside the advisory lock, after `refresh_open_seller_ticket`** is **naturally, structurally idempotent**: a retry recomputes `remaining = 0` and no-ops. No key, no dedupe table, no atomicity needed. **This kills #9 for the settle path outright.**

**3. Idempotency key for `generateMutation`.** Operator-entered partial amounts can't be server-derived, so that path needs an explicit key: `p_idempotency_key uuid` + `CREATE UNIQUE INDEX … ON seller_payment_txns(idempotency_key) WHERE idempotency_key IS NOT NULL`. Client mints one key per (seller, batch), stable across retries → replay returns the existing txn id. **This is the only thing that makes "safe to retry" a true statement.**

**4. FE fixes (small, pure win, no SQL):** invalidate on `onError` **and** `onSuccess`; collect per-seller `{sellerId, ok, error}` instead of `throw`-on-first; truthful toast — *"2 paid, 1 failed: Ahmed — <reason>"*.

### On per-seller savepoints specifically
Viable — and **measured to work**: `rollback to savepoint` releases the failed seller's advisory lock (§1). But note what my test also proves: **locks for the *succeeded* sellers are NOT rolled back and are still held to COMMIT**, so **savepoints do NOT eliminate the B2 deadlock exposure** — they only shrink it. Per-seller savepoints inside one call give you an honest result set at the cost of the deadlock class you get for free by *not* batching. **At N=1–3, the client loop already gives per-seller independence with per-seller lock lifetime and zero deadlock risk.** Once (1)-(4) are done, `pay_sellers_bulk` is optional sugar with no correctness content.

---

## 6. VERDICT

**Per-seller independence is the correct semantic. All-or-nothing is wrong for payouts.**

1. **There is no cross-seller invariant.** Not one constraint, trigger, or ticket spans two sellers. Atomicity protects set-spanning invariants; payroll has none. Each seller's payment is an independent economic fact. All-or-nothing manufactures a coupling the domain does not have.
2. **It buys an empty failure class.** Mid-batch per-seller raises require §4.4 (p ≈ 0). The realistic failures are uniform (#1, fires at target 1 — nothing committed either way) or unknown-outcome (#9 — both designs lose).
3. **It costs a real, new one.** N advisory locks held to COMMIT → deadlock vs `close_seller_month`'s unordered N-lock transaction. The draft's `order by 1` defends bulk-vs-bulk only. Today's loop makes this **structurally impossible**.
4. **It concentrates the blast radius of the only failure that happens.** Lost response after COMMIT → *all 5* double-paid instead of at most 1. The review's blocker is not a fixable toast-wording bug; it's atomicity making #9 strictly worse.
5. **It fixes no money bug.** Relays client amounts verbatim into an RPC with no overpay guard.
6. **Scale moots the perf motive.** 21 lifetime txns; a multi-seller bulk settle has never occurred. N+1 over 1–3 rows is not a problem.

### Actions
- **DO NOT apply `docs/parked/PARKED_pay_sellers_bulk.sql`.** Four blockers: B1 false retry-safety (review's), **B2 deadlock vs `close_seller_month` (new)**, **B3 gate ignores `p_business` (new)**, **B4 fixes no money bug (new)**. Keep it parked or delete it.
- **Reclassify the recon.** `docs/d7-recon/02-pages.md` §6b calls this *"the highest value-per-effort item in D7."* **It is not.** It diagnosed the symptom (partial commit) and prescribed a fix that leaves the cause (stale-cache retry into an unguarded RPC) fully intact.
- **The real P1s, in order:** (1) `pay_seller` overpay guard *[owner ruling: are advances legitimate?]*; (2) server-computed `remaining` for settle-in-full → free idempotency; (3) idempotency key for the generate path; (4) `onError` invalidation + per-seller truthful reporting.
- **Ship (4) first.** It's a 3-line FE change, needs no migration, no owner ruling, and removes the live double-pay vector today.

### PROVEN vs INFERRED
- **PROVEN** (live box / HEAD): every function body and constraint quoted; no overpay guard exists; `paid_amount > total_amount` is representable and unrejected; `onError` never invalidates (grep over HEAD); ledger scale (21 txns / 4 sellers / 2 owing); `close_seller_month` closes the prior month and iterates unordered; `pay_sellers_bulk` absent; `current_user_is_business_admin()` takes no business arg; advisory locks survive to COMMIT but are released by subtransaction rollback (measured).
- **INFERRED** (reasoned, not executed): the B2 deadlock cycle is derived from the two lock-acquisition orders — the interleaving is unobserved and, given cron 8's once-a-month 00:05 window, would be rare; likelihood ratings in §4 are judgement from the guard surface + 15 months of history, not measurement; the claim that a cache-invalidating retry would be self-healing follows from the remaining-based amount math (`o.remaining`, `Math.min(v, oweFor(id))`) but was not exercised against a live retry.

### Files
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Salaries.tsx` — settle loop :196-222 (onError :221), generate loop :1128-1189 (seller branch :1136-1149, MB upsert :1167-1174, onError :1188), `invalidateAll` :178 (success-only :217)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/docs/parked/PARKED_pay_sellers_bulk.sql` — do not apply
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/docs/d7-recon/02-pages.md` — §6b, reclassify
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/docs/PAYMENTS_SWEEP.md` — −280 register (no `280` hit on grep; incident fingerprint in the data is the 2026-06-17 `'restore: audit-verified recovery of reversed txns'` pair)