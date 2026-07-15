# D7b — pay_sellers_bulk safety mechanisms: idempotency + error discriminator

Everything below is live-verified on the box unless tagged **INFERRED**. Read paths only; no DDL/DML was run.

---

## 0. HEADLINE FINDINGS (read these first — three change the design)

1. **The naive natural key is DISPROVED by live data.** `(seller_id, payout_month, amount)` collides on 2 groups / 5 rows *today*. Seller `6a60ad68-8582-44dd-847d-1b47af677c2f` was legitimately paid **1200 twice** in `2026-06` and **500 three times** in `2026-07`. Partial payouts against a rolling ticket make repeated identical amounts normal. Option (b) is dead.

2. **The review's error discriminator is INCOMPLETE and would itself cause the double-pay it is trying to prevent.** `status===0 && code===''` catches only the *pure transport* case. It misses two UNKNOWN-outcome classes that present with a **non-zero status**: (i) proxy errors (Kong 502 / CF 502/520/524) whose body is not a PostgREST envelope → postgrest-js produces `{message: body}` with `code` **undefined** and a non-zero status; (ii) real SQLSTATEs `08*` / `57P0*` which have a genuine code but an unknown server outcome. The review's predicate classifies both as "server definitively rejected → safe to retry". That is the double-pay.

3. **The idempotency pattern is already shipped in this repo — copy it 1:1.** `whatsapp.send_message(… p_idempotency_key uuid default null …)` + `whatsapp.messages.idempotency_key uuid` + `CREATE UNIQUE INDEX messages_idempotency_key_idx ON whatsapp.messages (idempotency_key) WHERE idempotency_key IS NOT NULL`, replay-check at the top of the function returning the prior result with `duplicate: true`, FE side `src/whatsapp/lib/conversationsApi.ts:48` `const idempotencyKey = args.idempotencyKey ?? crypto.randomUUID()`. This is the precedent per the standing "copy proven impls 1:1" rule. It resolves the design with no invention.

---

## 1. PROVEN — live schema facts

### 1.1 `public.seller_payment_txns` (the money row)
```
attnum | column            | type        | notnull | default
1 | id                | uuid        | t | gen_random_uuid()
2 | seller_payment_id | uuid        | t |
3 | amount            | numeric     | t |
4 | paid_at           | timestamptz | t | now()
5 | note              | text        | f |
6 | created_by        | uuid        | f |
7 | DigiCom Business  | uuid        | f |
8 | created_at        | timestamptz | t | now()
```
**There is no idempotency column and no natural-key constraint.**

Constraints:
```
seller_payment_txns_amount_check      CHECK ((amount > (0)::numeric))
seller_payment_txns_pkey              PRIMARY KEY (id)
seller_payment_txns_seller_payment_id_fkey  FK → seller_payments(id) ON DELETE CASCADE
```
Indexes: `seller_payment_txns_pkey (id)`, `idx_seller_payment_txns_business ("DigiCom Business")`, `idx_seller_payment_txns_payment (seller_payment_id)`. **No unique index other than the PK.**

Trigger: `trg_seller_payment_txns_aiud AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW EXECUTE trg_seller_payment_txns_refresh()` → `refresh_seller_payment_balance(seller_payment_id)`.

RLS: `relrowsecurity=t`, **`relforcerowsecurity=f`**, `relowner=postgres`. → **RLS does not apply inside a SECURITY DEFINER function owned by `postgres`.** Load-bearing for the design (§4).

Grants: `relacl = {postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres, authenticated=arwdDxtm/postgres}` — **table-level, not column-scoped**. `information_schema.column_privileges` only *expands* the table grant per column. **⇒ a new column inherits the grant automatically; there is no column-grant trap here** (contrast the `rls-cross-tenant-sweep` login-only column-grant model, which does not apply to this table).

### 1.2 `public.seller_payments` (the ticket)
Relevant: `seller_payments_uq_seller_month_biz UNIQUE (seller_id, payout_month, "DigiCom Business")`; `seller_payments_total_consistency_chk CHECK (total_amount = carried_in + month_earned)`; `status ∈ {pending,partial,paid}`; `period_state ∈ {open,closed}`.

Live ledger (12 tickets, 21 txns, 2026-04-10 → 2026-07-13):
```
total | paid | carried_in | carried_out | status  | period_state
952   | 800  | 0    | 152  | partial | closed
368   | 264  | 152  | 104  | partial | closed
104   | 104  | 104  | 0    | paid    | closed
4200  | 2100 | 0    | 2100 | partial | closed
8580  | 7600 | 1750 | 980  | partial | closed
3850  | 3358 | 980  | NULL | partial | open
…
```
**Zero tickets have `paid_amount > total_amount`.** Overpayment is not an observed state (relevant to option (d), §3.4).

### 1.3 `public.pay_seller` — live definition (the sanctioned primitive)
```sql
CREATE OR REPLACE FUNCTION public.pay_seller(p_seller_id uuid, p_business_id uuid, p_amount numeric,
                                             p_paid_at timestamptz DEFAULT now(), p_note text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
    v_month date := date_trunc('month', now())::date;
    v_month_txt text := to_char(v_month, 'YYYY-MM-01');
    v_ticket uuid; v_txn uuid; v_carry numeric;
BEGIN
    IF NOT (public.check_user_role(auth.uid(), ARRAY['super admin','admin'])
            AND public.current_user_digicom_business_id() IS NOT NULL
            AND public.current_user_digicom_business_id() = p_business_id) THEN
        RAISE EXCEPTION 'forbidden: admin only';          -- no ERRCODE ⇒ P0001
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount must be > 0';              -- no ERRCODE ⇒ P0001
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text || p_business_id::text, 0));
    SELECT id INTO v_ticket FROM public.seller_payments
     WHERE seller_id=p_seller_id AND "DigiCom Business"=p_business_id AND payout_month=v_month_txt AND period_state='open';
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
$function$
```
Owner `postgres`; ACL `{postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres}`.
**No other DB function references `pay_seller`** (`prosrc ILIKE '%pay_seller%'` excluding itself → 0 rows). `pay_mediabuyer(uuid,uuid,numeric,timestamptz,text)` exists as the symmetric MB primitive.

**Note (not in the parked file):** the ticket month comes from `now()`, **not** from `p_paid_at`. A backdated `p_paid_at` still lands on the current month's ticket. Pre-existing behaviour; unchanged by any option here, but it means `p_paid_at` is pure metadata, never a routing key.

### 1.4 FE call sites (3)
- `src/pages/admin/Salaries.tsx:204` — `settleMutation`, loop over `sellerIds`, skips `remaining <= 0.005`, note `'Settled in full from Salaries bulk action'`.
- `src/pages/admin/Salaries.tsx:1139` — `generateMutation` seller branch, loop over `targets` filtered `amt > 0.005`, note `'Paid from Salaries generate flow'`.
- `src/components/salaries/PayoutPaymentDialogs.tsx:236` — **single-seller pay dialog** (not a loop). Client-side guard at :185: `const overpaying = numericAmount > remaining + 0.0001; const invalid = … || overpaying;`

**The single dialog has the identical lost-response double-pay bug**, blast radius 1 seller. Any idempotency design that only covers the bulk RPC leaves it open. This is a strong argument for putting the key in `pay_seller`, not in the wrapper.

**The client-side `remaining <= 0.005` skip is NOT retry protection**: on a lost response `onSuccess` never fires, the react-query cache is never invalidated, so the retry re-computes the *same* `remaining` and sends the *same* batch.

### 1.5 Timeouts, proxy stack, versions
```
authenticator : statement_timeout=8s, lock_timeout=8s, session_preload_libraries=supautils,safeupdate
authenticated : statement_timeout=8s, idle_in_transaction_session_timeout=60s
anon          : statement_timeout=3s, idle_in_transaction_session_timeout=60s
```
`SET ROLE authenticated; SHOW statement_timeout` in a `postgres` psql session returns `0` — expected: `ALTER ROLE … SET` applies at **login**, and PostgREST logs in as `authenticator` (8s) then `SET LOCAL ROLE authenticated`. **Either way the effective per-request cap is 8 s.**

Stack: `PostgreSQL 17.6` · `postgrest/postgrest:v14.12` · `kong/kong:3.9.1` → Cloudflare Tunnel → `api.igrowfast.com`. Kong route `rest-v1` (`/opt/supabase-project/volumes/api/kong.yml:131-144`) declares **no explicit timeouts** → Kong defaults 60 s connect/read/write. So **PG's 8 s fires first**, and the client normally receives a definitive `57014` rather than a bare proxy timeout. That is good news for the discriminator but does not eliminate proxy 502s (upstream restart/OOM).

**Cost measurement** (`EXPLAIN ANALYZE` of the `refresh_open_seller_ticket` aggregate over the `seller_daily_earnings` view — `relkind='v'`, security_invoker):
```
Execution Time: 17.677 ms   Planning Time: 5.061 ms   Buffers: shared hit=506 (+905 planning)
```
≈ **23 ms per `pay_seller` call as `postgres`**; higher as `authenticated` (the view is security_invoker → RLS predicates added). ⇒ the 8 s budget affords roughly **150–200 targets**, not 500. **The parked file's `max 500` cap exceeds the statement_timeout budget.** Recommend 100.

Scale reality: sellers are `role='commercial'` (**not** `'seller'` — the `user_role` enum is `super admin, admin, commercial, mediabuyer, owner, courier`); **5 exist**, across 2 businesses, 12 tickets total. Batches are tiny today. The cap is a guard, not a throughput constraint.

---

## 2. PROVEN — the error discriminator (`@supabase/postgrest-js` 2.108.2)

Source: `node_modules/@supabase/postgrest-js/dist/index.mjs`.

### 2.1 Transport failure (`then()` catch, ~L325-366)
```js
let code = "";                       // initialised to '' and NEVER set to anything else
…
if (fetchError?.name === "AbortError" || fetchError?.code === "ABORT_ERR") { code = ""; hint = "Request was aborted (timeout or manual cancellation)"; }
else if (cause?.name === "HeadersOverflowError" || cause?.code === "UND_ERR_HEADERS_OVERFLOW") { code = ""; hint = "HTTP headers exceeded server limits (typically 16KB)"; }
return { success:false,
         error: { message:`${fetchError?.name ?? "FetchError"}: ${fetchError?.message}`, details:errorDetails, hint, code },
         data:null, count:null, status:0, statusText:"" };
```
⇒ **transport ⇒ `status === 0` AND `code === ''` (always, both branches).** The review's claim is correct *for this path*.

### 2.2 Server response (`processResponse`, ~L373-440)
```js
} else {                              // !res.ok
    const body = await res.text();
    try {
        error = JSON.parse(body);     // PostgREST envelope: { code, details, hint, message }
        if (Array.isArray(error) && res.status === 404) { data=[]; error=null; status=200; statusText="OK"; }
    } catch (_unused2) {
        if (res.status === 404 && body === "") { status=204; statusText="No Content"; }
        else error = { message: body };          // ←←← code is UNDEFINED, status is NON-ZERO
    }
    …
}
return { success: error===null, error, data, count, status, statusText };
```
⇒ **two distinct server-side shapes**:
- **PostgREST envelope**: `status = HTTP`, `error.code = '<SQLSTATE>' | 'PGRST###'`.
- **Non-PostgREST body** (proxy HTML/plain, or a Kong JSON without a `code` key): `status = 502/504/520/524/…`, **`error.code === undefined`**, `error.message === <raw body>`. Note `retry()` is **not** applied here: `RETRYABLE_METHODS` covers only GET/HEAD/OPTIONS, so an RPC `POST` is **never** auto-retried by the client — good, and it means every retry is an operator action.

### 2.3 The exact predicate

```ts
/** PostgREST/PG codes that PROVE the server ran and rolled back with nothing written. */
const DEFINITIVE_ROLLBACK_CODES = new Set([
  // ── raised by the payout path itself ──
  'P0001', // raise_exception — pay_seller 'forbidden: admin only' / 'amount must be > 0'
           //                   refresh_open_seller_ticket 'forbidden: admin only'  (no ERRCODE given)
  '42501', // insufficient_privilege — pay_sellers_bulk's own admin gate
  '22023', // invalid_parameter_value — wrapper validation (null business/targets/empty/too many/malformed/dup)
  '23514', // check_violation — seller_payment_txns_amount_check, seller_payments_total_consistency_chk,
           //                   AND the wrapper's (mis-typed, see §5) internal invariants
  '23505', // unique_violation — the idempotency backstop index, seller_payments_uq_seller_month_biz race
  '23503', // foreign_key_violation — seller_payment_id → seller_payments
  '23502', // not_null_violation
  '22P02', // invalid_text_representation — a bad uuid/numeric in p_targets
  // ── engine-level, all of which abort the transaction definitively ──
  '57014', // query_canceled — statement_timeout=8s. PG cancels then ROLLS BACK. Cannot fire mid-COMMIT.
  '40P01', // deadlock_detected — PG chooses a victim and rolls it back. Definitive.
  '55P03', // lock_not_available — lock_timeout. Nothing acquired ⇒ nothing written.
  '53300', // too_many_connections — never reached the backend
  '42883', // undefined_function     ┐ botched/rolled-back migration —
  '42P01', // undefined_table        ┘ nothing ran
  '42725', // ambiguous_function — the overload hazard (§4.2)
  '25P02', // in_failed_sql_transaction
  // ── PostgREST-level, all pre-execution ──
  'PGRST202', // function not found in the schema cache
  'PGRST203', // ambiguous function (overload)
  'PGRST100', 'PGRST102', 'PGRST116', 'PGRST301', 'PGRST302',
]);

type Outcome = 'DEFINITELY_ROLLED_BACK' | 'UNKNOWN';

function classifyPayoutError(err: any, status: number): Outcome {
  // 1. transport: no response ever arrived → the server may have committed.
  if (status === 0) return 'UNKNOWN';
  // 2. a response arrived but is not a PostgREST envelope (Kong/CF 502/504/520/524,
  //    HTML or a JSON with no `code`). postgrest-js gives {message: body}, code undefined.
  //    The request MAY have reached and committed in Postgres.
  const code = err?.code;
  if (typeof code !== 'string' || code === '') return 'UNKNOWN';
  // 3. a real code, but one whose outcome is genuinely unknown:
  //    08* connection_exception (08007 = transaction_resolution_unknown, literally this case)
  //    57P01/02/03 admin/crash shutdown, cannot_connect_now — may have fired after COMMIT
  if (code.startsWith('08') || code === '57P01' || code === '57P02' || code === '57P03') return 'UNKNOWN';
  // 4. a code we can prove aborted the transaction.
  if (DEFINITIVE_ROLLBACK_CODES.has(code)) return 'DEFINITELY_ROLLED_BACK';
  // 5. anything else: default to UNKNOWN. Money defaults closed.
  return 'UNKNOWN';
}
```

**Design rules embedded above, all load-bearing:**
- **Never key on the HTTP status to decide definitiveness.** PostgREST's SQLSTATE→HTTP table has changed across versions (**INFERRED** for v14.12: `57014→504`, `42501→403`, `23505→409`, `P0001→400`, `08*→503`, `53*→503`, `40P01→500`); `status` is only used to detect `0` (transport). Key on `code`.
- **Allow-list, not deny-list.** Unknown code ⇒ UNKNOWN. A deny-list is how you re-introduce the bug on the next PostgREST upgrade.
- `code === undefined` and `code === ''` must **both** be handled — postgrest-js produces `''` on the transport path and `undefined` on the non-JSON-body path.

**Justification for `57014` being DEFINITIVE (the one non-obvious entry):** `SELECT pay_sellers_bulk(…)` is a single implicit transaction. `statement_timeout` cancels the *statement*; the implicit COMMIT is not a cancellation point once the function has returned. So a `57014` reaching the client proves the function did not complete → rollback. Given the 8 s budget vs ~23 ms/target, **`57014` is the most likely error an oversized batch will produce**, and it is safe.

---

## 3. IDEMPOTENCY — the four options assessed against this schema

### (a) Client-generated request uuid on `seller_payment_txns` + partial unique index — **RECOMMENDED**

**DDL:** one nullable column + one partial unique index. Exact shape in §4.
**Signature impact:** `pay_seller` gains `p_request_id uuid default null` (6th arg). **Must be `DROP` + `CREATE`, not `CREATE OR REPLACE`** — see §4.2.
**Standing law:** *preserved and strengthened*. The key lives **inside** `pay_seller`, the sanctioned primitive. No new write path to `seller_payments` / `seller_payment_txns`. The wrapper composes idempotent calls; idempotency is not bolted onto the wrapper.
**Migration/backfill cost:** **zero backfill.** All 21 existing rows keep `request_id = NULL`; the index is `WHERE request_id IS NOT NULL` so they are not indexed and cannot collide. Table is 21 rows — `CREATE INDEX` (not `CONCURRENTLY`) inside the migration transaction is instant.
**Legitimate repeat payments:** **fully compatible.** Two genuine partial payouts of 500 to the same seller in the same month are two *different operator intents* → two different `request_id`s → both insert. Only a *replay of the same intent* collides. This is the only option that gets this right.
**Precedent:** `whatsapp.messages.idempotency_key uuid` + `CREATE UNIQUE INDEX messages_idempotency_key_idx ON whatsapp.messages USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL)` + `whatsapp.send_message(… p_idempotency_key uuid default null)` with the replay-check-then-return-`duplicate:true` shape. Verbatim-copyable.
**Bonus:** fixes `PayoutPaymentDialogs.tsx:236` (the single-pay dialog) for free, because the key is in `pay_seller`.

### (b) Natural key `(seller_id, payout_month, amount)` [±`paid_at`] — **DISPROVED, DO NOT BUILD**

Live proof:
```
seller_id                            | payout_month | amount | n | paid_ats
6a60ad68-8582-44dd-847d-1b47af677c2f | 2026-06-01   | 1200   | 2 | {2026-06-21 15:35:00+00, 2026-06-27 13:58:00+00}
6a60ad68-8582-44dd-847d-1b47af677c2f | 2026-07-01   | 500    | 3 | {2026-06-30 13:30:00+00, 2026-07-06 16:00:00+00, 2026-07-08 15:33:00+00}
```
2 colliding groups, 5 rows, **on 21 rows total** — a 24% collision rate. A unique constraint on the 3-tuple would have **rejected three legitimate partial payouts**. The rolling-ticket model *guarantees* this: an operator settling a seller in weekly instalments of a round number produces identical `(seller, month, amount)` rows by design.

Adding `paid_at` to make it a 4-tuple: 0 collisions today — but that is **accidental and fragile**, and it *inverts* under the parked design. Reasons it is wrong:
- It only works if the client sends a `paid_at` that is **stable across retries and unique across intents** — i.e. it is a request id wearing a timestamp costume, but a *worse* one: `PayoutPaymentDialogs.tsx` lets the operator **type** `paid_at` (`setPaidAt(format(new Date(), "yyyy-MM-dd'T'HH:mm"))`, minute resolution), so two genuine payments to one seller in the same minute at the same amount would be rejected.
- Parked **deviation (A)** makes `paid_at` one value for the whole batch → the 4-tuple's uniqueness now depends entirely on `seller_id` varying, which the dup-check already enforces. It adds nothing.
- It makes a **money-metadata column load-bearing for correctness**. Any future "correct the payment date" edit becomes an idempotency-breaking operation.

**Verdict: DISPROVED on live data. Not a fallback.**

### (c) Separate idempotency/request table — **REJECTED as redundant**

Shape would be `payout_requests(request_id uuid PK, business_id, created_by, created_at, result jsonb)`, insert-first-then-work.
- **Does not break the standing law** (it writes no money row).
- **But it is strictly worse than (a):** it stores a *copy* of the result (`txn_ids`) alongside the truth, creating a second source of truth for money — exactly the class of drift the `payments-cleanup-register` exists to track. With (a) the result is **reconstructible from the txns themselves** (`SELECT … WHERE request_id = $1`), so no denormalised copy is needed.
- Costs a new table, new RLS policies, new grants, a retention story, and a second write in the money transaction.
- Its only unique capability — recording an attempt that wrote *nothing* — is worthless here: an attempt that wrote nothing is precisely the case where retrying is already safe.
- No in-repo precedent. `public.credential_change_requests` is a token table, not an idempotency ledger. `supabase_migrations.schema_migrations_idempotency_key_key` is the (a)-shape.

### (d) A cap inside `pay_seller` (never pay more than live remaining) — **WORTH HAVING, but as a SEPARATE change with an owner ruling**

**It is a different guarantee, correctly characterised by the task.** It does **not** prevent a duplicate; it **bounds the damage**:
- *settle-in-full* flow: first attempt drives `remaining → 0`; a replay finds `remaining = 0` and **raises** ⇒ damage **zero**. Strong.
- *generate* flow with a partial amount (`amt < remaining`): a replay still succeeds and double-pays **up to `remaining`** ⇒ damage bounded, **not** eliminated.
⇒ **It is not a substitute for (a).** It is a second, independent net.

**Evidence it is consistent with reality:** zero live tickets have `paid_amount > total_amount`, and `PayoutPaymentDialogs.tsx:185` **already forbids overpaying client-side** (`overpaying = numericAmount > remaining + 0.0001` → `invalid`). A server cap would close a client-only invariant — the same class of gap D4 closed.

**Why it needs a ruling and must NOT ride this migration:**
1. **False-positive risk.** `pay_seller` calls `refresh_open_seller_ticket` *before* inserting, which can lower `total_amount` (live earned moved between render and call, e.g. an order flipped out of `livré`). The client's `o.remaining` would then exceed the fresh server `remaining` and a legitimate "settle in full" would be **rejected**. Needs a tolerance and a ruling on which side wins.
2. **Clamping is not an option.** Silently clamping = silently short-paying = a worse money bug than the one being fixed. It must **raise**.
3. It changes `pay_seller`'s contract for *every* caller, including the single-pay dialog and any future ops/manual path. That is a policy decision (can an admin ever advance a seller money?), not a bug fix. The `-280` incident in the cleanup register is **not** precedent here: it lives in the *transactions* aggregate (`docs/d3-recon/02-sections-b.md:84` — "`unpaidAmount = totalValue − totalPaid` (global difference, NO per-row clamp — can go negative on overpayment)"), not in `seller_payment_txns`. Do not cite it to justify a seller-payout cap.

**Recommendation:** ship (a) now; file (d) as a follow-up with the ruling question *"may an admin ever pay a seller more than their live remaining?"* If the answer is no, (d) is a ~6-line addition to `pay_seller` (`RAISE … USING ERRCODE='23514'` when `p_amount > remaining + 0.01`) plus a `p_allow_overpay boolean default false` escape hatch.

---

## 4. RECOMMENDED DESIGN + exact migration shape

**One design: (a) — the idempotency key inside `pay_seller`, mirroring `whatsapp.send_message` 1:1. The wrapper composes it and stays a thin loop.**

Reasoning, in order of weight:
1. It is the **only** option that survives the live-data test (b fails; c is a redundant second truth for money; d is a different guarantee).
2. It puts idempotency **in the sanctioned primitive**, so the standing law "ALWAYS pay via pay_seller" is *strengthened*, not worked around — and it fixes the single-pay dialog's identical bug for free.
3. It has a **shipped in-repo precedent** with an identical shape, satisfying the "copy proven impls 1:1" rule.
4. **Zero backfill, zero data change, fully reversible** (drop the index, drop the column, restore the 5-arg function).
5. It **converts the UNKNOWN class into a safe retry**, which is what makes the honest toast (§5) possible at all. Without a key, the only honest copy for a transport failure is *"go look at the ledger yourself"*.

### 4.1 Migration — `supabase/migrations/20260715xxxxxx_d7b_pay_sellers_bulk_idempotent.sql`

```sql
begin;

-- ── 1. the idempotency key on the money row (mirrors whatsapp.messages) ──────
alter table public.seller_payment_txns
  add column if not exists request_id uuid;

comment on column public.seller_payment_txns.request_id is
  'Client-generated idempotency key for the payout ATTEMPT that created this txn. '
  'NULL on every row written before this migration and on any path that omits it. '
  'A replayed attempt (lost response + operator retry) reuses the same uuid and '
  'therefore cannot insert a second txn against the same ticket.';

-- Backstop for the replay race (two concurrent retries of the same attempt).
-- Partial ⇒ the 21 pre-existing NULL rows are not indexed and cannot collide.
create unique index if not exists seller_payment_txns_request_ticket_uidx
  on public.seller_payment_txns (request_id, seller_payment_id)
  where request_id is not null;
-- (request_id, …) is a usable prefix for request_id-only lookups — no second index.

-- ── 2. pay_seller gains p_request_id. DROP+CREATE, NOT `create or replace`. ──
--    See §4.2: a defaulted 6th arg creates a SECOND function; PostgREST resolves
--    RPCs by argument-name set and overload resolution across a default is a
--    42725 / PGRST203 hazard on a money path. No DB object depends on pay_seller
--    (verified: 0 rows from `pg_proc.prosrc ilike '%pay_seller%'` excluding itself),
--    and the drop+create is atomic inside this transaction.
drop function if exists public.pay_seller(uuid, uuid, numeric, timestamptz, text);

create function public.pay_seller(
    p_seller_id   uuid,
    p_business_id uuid,
    p_amount      numeric,
    p_paid_at     timestamptz default now(),
    p_note        text        default null,
    p_request_id  uuid        default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
    v_month     date := date_trunc('month', now())::date;
    v_month_txt text := to_char(v_month, 'YYYY-MM-01');
    v_ticket uuid; v_txn uuid; v_carry numeric;
BEGIN
    -- unchanged gate
    IF NOT (public.check_user_role(auth.uid(), ARRAY['super admin','admin'])
            AND public.current_user_digicom_business_id() IS NOT NULL
            AND public.current_user_digicom_business_id() = p_business_id) THEN
        RAISE EXCEPTION 'forbidden: admin only';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount must be > 0';
    END IF;

    -- unchanged lock. It is ALSO what makes the replay guard below race-free:
    -- a concurrent replay for the same (seller,business) waits here, then sees
    -- the committed txn and returns it instead of inserting a second one.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text || p_business_id::text, 0));

    -- ── NEW: replay guard (shape copied from whatsapp.send_message L23-43) ──
    -- SECURITY DEFINER + relowner=postgres + relforcerowsecurity=f ⇒ RLS does not
    -- apply here; the (seller,business) predicate is the tenant scope.
    IF p_request_id IS NOT NULL THEN
        SELECT t.id INTO v_txn
          FROM public.seller_payment_txns t
          JOIN public.seller_payments sp ON sp.id = t.seller_payment_id
         WHERE t.request_id = p_request_id
           AND sp.seller_id = p_seller_id
           AND sp."DigiCom Business" = p_business_id
         LIMIT 1;
        IF v_txn IS NOT NULL THEN
            RETURN v_txn;                      -- already paid by this attempt. No-op.
        END IF;
    END IF;

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

    INSERT INTO public.seller_payment_txns
        (seller_payment_id, amount, paid_at, note, created_by, "DigiCom Business", request_id)
    VALUES (v_ticket, p_amount, p_paid_at, p_note, auth.uid(), p_business_id, p_request_id)
    RETURNING id INTO v_txn;
    RETURN v_txn;
END;
$function$;

-- DROP loses the ACL — reproduce the pre-migration grants exactly
-- (was: {postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres}).
alter function public.pay_seller(uuid,uuid,numeric,timestamptz,text,uuid) owner to postgres;
revoke all on function public.pay_seller(uuid,uuid,numeric,timestamptz,text,uuid) from public, anon;
grant execute on function public.pay_seller(uuid,uuid,numeric,timestamptz,text,uuid) to authenticated, service_role;

-- ── 3. the thin atomic wrapper ───────────────────────────────────────────────
create or replace function public.pay_sellers_bulk(
    p_business   uuid,
    p_targets    jsonb,
    p_request_id uuid,                       -- REQUIRED. No default: a caller that
                                             -- forgets it must fail loudly, not
                                             -- silently lose idempotency.
    p_paid_at    timestamptz default now(),
    p_note       text        default null
) returns jsonb
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
    v_replayed boolean := false;
    v_seller   uuid;
    r          record;
begin
    if not (select public.current_user_is_business_admin()) then
        raise exception 'pay_sellers_bulk: admin only' using errcode = '42501';
    end if;
    if p_business is null then
        raise exception 'pay_sellers_bulk: p_business is required' using errcode = '22023';
    end if;
    if p_request_id is null then
        raise exception 'pay_sellers_bulk: p_request_id is required' using errcode = '22023';
    end if;
    if p_targets is null or jsonb_typeof(p_targets) <> 'array' then
        raise exception 'pay_sellers_bulk: p_targets must be a jsonb array' using errcode = '22023';
    end if;

    v_in_count := jsonb_array_length(p_targets);
    if v_in_count = 0 then
        raise exception 'pay_sellers_bulk: p_targets is empty' using errcode = '22023';
    end if;
    -- 100, not 500: authenticated.statement_timeout = 8s and one pay_seller costs
    -- ~23ms measured (refresh_open_seller_ticket over the seller_daily_earnings
    -- view: 17.7ms exec + 5.1ms plan). 500 targets cannot finish inside 8s.
    if v_in_count > 100 then
        raise exception 'pay_sellers_bulk: too_many_targets (max 100, got %)', v_in_count using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_targets) e
               where nullif(e->>'seller_id','') is null or nullif(e->>'amount','') is null) then
        raise exception 'pay_sellers_bulk: every target needs a seller_id and an amount' using errcode = '22023';
    end if;
    select count(distinct (e->>'seller_id')::uuid) into v_distinct from jsonb_array_elements(p_targets) e;
    if v_distinct <> v_in_count then
        raise exception 'pay_sellers_bulk: duplicate seller_id in p_targets (% targets, % distinct)',
              v_in_count, v_distinct using errcode = '22023';
    end if;

    -- Cosmetic only (drives the toast). The real idempotency is per-call inside
    -- pay_seller; correctness does not depend on this read.
    -- SECURITY INVOKER ⇒ this SELECT runs under RLS as the admin. seller_payment_txns
    -- grants are table-level, so request_id needs no extra grant.
    v_replayed := exists (select 1 from public.seller_payment_txns t
                           where t.request_id = p_request_id
                             and t."DigiCom Business" = p_business);

    -- ONE exception block for the whole loop, NOT one per iteration: `begin…exception`
    -- opens a SUBTRANSACTION, and 100 of them per money txn burns subxids for nothing.
    begin
        -- `order by 1` is LOAD-BEARING: pay_seller takes pg_advisory_xact_lock per
        -- (seller,business) and this ONE transaction now holds every lock to COMMIT.
        -- A stable global order is what stops two concurrent bulk calls deadlocking.
        for r in
            select (e->>'seller_id')::uuid as seller_id,
                   (e->>'amount')::numeric as amount
              from jsonb_array_elements(p_targets) e
             order by 1
        loop
            v_seller := r.seller_id;
            v_txn := public.pay_seller(
                p_seller_id   => r.seller_id,
                p_business_id => p_business,
                p_amount      => r.amount,
                p_paid_at     => v_paid_at,
                p_note        => p_note,
                p_request_id  => p_request_id
            );
            if v_txn is null then
                raise exception 'pay_sellers_bulk: pay_seller returned no txn for seller %', r.seller_id
                      using errcode = 'P0001';
            end if;
            v_txn_ids := v_txn_ids || v_txn;
            v_paid := v_paid + 1;
        end loop;
    exception when others then
        raise exception 'pay_sellers_bulk: seller % (target % of %) failed: % — no payment in this batch was written',
              v_seller, v_paid + 1, v_in_count, sqlerrm using errcode = sqlstate;
    end;

    if v_paid <> v_in_count then
        raise exception 'pay_sellers_bulk: paid % of % targets — aborting', v_paid, v_in_count
              using errcode = 'P0001';
    end if;

    return jsonb_build_object(
        'paid',     v_paid,
        'txn_ids',  to_jsonb(v_txn_ids),
        'paid_at',  v_paid_at,
        'replayed', v_replayed         -- true ⇒ nothing new was written; mirrors send_message's `duplicate`
    );
end;
$$;

revoke all on function public.pay_sellers_bulk(uuid, jsonb, uuid, timestamptz, text) from public, anon;
grant execute on function public.pay_sellers_bulk(uuid, jsonb, uuid, timestamptz, text) to authenticated;
alter function public.pay_sellers_bulk(uuid, jsonb, uuid, timestamptz, text) owner to postgres;

commit;
```

**Why the wrapper needs no replay logic of its own:** if every `pay_seller` call is individually idempotent on `p_request_id`, the batch is idempotent **by composition**. A replay walks the same targets, each `pay_seller` returns the already-committed txn id without inserting, and the wrapper returns the **same `paid` count and the same `txn_ids`**. That is exactly-once, and it is why `replayed` is cosmetic rather than load-bearing.

**Why the advisory lock makes the replay race-free:** the guard runs *after* `pg_advisory_xact_lock(hash(seller||business))`. Two concurrent retries of the same attempt serialise on that lock; the loser re-reads after the winner commits and returns the winner's txn. The unique index is the belt to that braces — it only fires if the lock is ever removed.

### 4.2 Migration hazards (each one is a real way to break this)

1. **`CREATE OR REPLACE` cannot add the parameter.** In PostgreSQL a different argument list is a **different function**, so `create or replace … (uuid,uuid,numeric,timestamptz,text,uuid)` leaves the 5-arg `pay_seller` **alive alongside it**. PostgREST resolves RPCs by the **argument-name set in the JSON body**; a 5-key body against a 5-arg function *and* a 6-arg function with a default is an overload-resolution hazard (`42725 ambiguous_function` / `PGRST203`). `DROP` + `CREATE` in one transaction removes the question. Verified safe: **no DB object depends on `pay_seller`**.
2. **`DROP FUNCTION` drops the ACL.** Re-`grant execute … to authenticated, service_role` and `alter … owner to postgres` in the same transaction, matching the pre-migration `proacl` exactly. Omitting this = every payout 403s.
3. **Regenerate `src/lib/database.types.ts`** — `pay_seller` is typed at `src/lib/database.types.ts:4963`. All three current call sites already cast through `(supabase as any).rpc(…)`, so they will not break at compile time, but the type will be stale (the `conversationsApi.ts:57-59` comment documents the same debt for `send_message`). Regenerate or add the same explicit comment.
4. **Do not run `CREATE INDEX CONCURRENTLY`** — it cannot run inside the migration transaction, and at 21 rows it is pointless.
5. **`db.sh` write protocol** — wrap in `BEGIN;…COMMIT;` (already shown); `postgres` is not superuser on the box, but it **owns** `seller_payment_txns` and `pay_seller`, so no `supabase_admin` escalation is needed for this migration.

### 4.3 FE contract (the part that actually delivers the guarantee)

**The uuid must be generated at operator-intent time and reused verbatim on every retry.** If it is regenerated inside `mutationFn`, the whole design is decorative.

```ts
// Salaries.tsx — settleMutation / generateMutation
// Precedent: src/whatsapp/lib/conversationsApi.ts:48
//   const idempotencyKey = args.idempotencyKey ?? crypto.randomUUID()
// crypto.randomUUID is already used in 5+ places in src/whatsapp/ — no polyfill needed.

const requestIdRef = useRef<string | null>(null);

const settleMutation = useMutation({
  // The key is minted ONCE per operator intent and survives every retry.
  // It is cleared ONLY on a definitive outcome (success, or a
  // DEFINITELY_ROLLED_BACK error where a fresh key is equally safe).
  mutationFn: async (sellerIds: string[]) => {
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    const targets = sellerIds
      .map((sid) => liveOwed.byId(sid))
      .filter((o): o is SellerLiveOwed => !!o && o.remaining > 0.005)
      .map((o) => ({ seller_id: o.id, amount: o.remaining }));
    if (targets.length === 0) return { paid: 0, replayed: false };
    const { data, error, status } = await (supabase as any).rpc('pay_sellers_bulk', {
      p_business:   activeBusinessId,
      p_targets:    targets,
      p_request_id: requestIdRef.current,
      p_paid_at:    new Date().toISOString(),
      p_note:       'Settled in full from Salaries bulk action',
    });
    if (error) throw Object.assign(error, { __outcome: classifyPayoutError(error, status) });
    return data as { paid: number; replayed: boolean; txn_ids: string[] };
  },
  onSuccess: () => { requestIdRef.current = null; /* invalidateAll(); … */ },
  onError: (err: any) => {
    // On UNKNOWN: KEEP requestIdRef so the operator's retry replays the SAME
    // attempt and can only ever be recorded once. This is the whole design.
    if (err.__outcome === 'DEFINITELY_ROLLED_BACK') requestIdRef.current = null;
  },
});
```
- `@tanstack/react-query ^5.83.0` — `useMutation` **does not retry by default** (`retry: 0`). Do not enable it. Every retry must be an operator action so the key lifecycle stays explicit.
- postgrest-js **does not auto-retry POST** (`RETRYABLE_METHODS` = GET/HEAD/OPTIONS only) — verified in `dist/index.mjs`. Confirms the above.
- Apply the identical pattern to `generateMutation` (:1138) and to `PayoutPaymentDialogs.tsx:236` (single `pay_seller`, `p_request_id` minted when the dialog's pay step is confirmed).

---

## 5. THE TOAST COPY

### ⚠️ The task's premise is wrong: **this page is English, not French.**
`src/pages/admin/Salaries.tsx` has 7 `toast({…})` calls, **all English**: `'Settled'` / `${res.inserted} seller(s) paid in full.` (:218), `'Error'` (:221, :680, :1188), `'Settled'` / `payout(s) marked as fully paid.` (:677), `'Sellers paid'` (:1178), `'Payouts generated'` (:1184). The admin surface is mixed overall — `Orders`/`Delivery` pages do use French (`'Colis retiré'`, `'Erreur'`, `'Suppression impossible'`, `'Supprimé'`) — but Salaries is uniformly English and so are its neighbours (`'Fees updated'`, `'Bulk update failed'`, `'Expense deleted'`, `'Exported'`).

**Recommendation: ship English to match the page.** Both are drafted; pick one, do not mix within the page.

### Four classes

**1 — SUCCESS (fresh: `replayed === false`)**
> EN — title: `Sellers paid` · desc: `${paid} seller${paid !== 1 ? 's' : ''} paid. The batch was recorded as one transaction.`
> FR — titre : `Vendeurs payés` · desc : `${paid} vendeur${paid !== 1 ? 's' : ''} payé${paid !== 1 ? 's' : ''}. Le lot a été enregistré en une seule transaction.`

**2 — SUCCESS (replay: `replayed === true`)** — the retry landed on an already-committed attempt. **Never say "paid" here without qualification**; the operator must understand no second disbursement occurred.
> EN — title: `Already recorded` · desc: `This payout was already recorded — ${paid} seller${paid !== 1 ? 's' : ''}, nothing was paid twice.`
> FR — titre : `Déjà enregistré` · desc : `Ce versement était déjà enregistré — ${paid} vendeur${paid !== 1 ? 's' : ''}, aucun double paiement.`
> variant: default (not destructive — this is the mechanism working).

**3 — ERROR, `DEFINITELY_ROLLED_BACK`** — the *only* class where "nothing was paid" may be asserted. This is the review's copy, now correctly scoped.
> EN — title: `Payout rejected` · desc: `No seller was paid — the whole batch was rolled back. ${err.message}` · variant: destructive
> FR — titre : `Versement refusé` · desc : `Aucun vendeur n'a été payé — le lot entier a été annulé. ${err.message}` · variant: destructive
> Sub-case worth splitting out (`code === '57014'`, the likeliest failure on a large batch):
> EN: `The batch took too long (over 8s) and was cancelled. No seller was paid. Select fewer sellers and try again.`
> FR : `Le lot a dépassé le délai (8 s) et a été annulé. Aucun vendeur n'a été payé. Sélectionnez moins de vendeurs et réessayez.`

**4 — ERROR, `UNKNOWN`** — **must never claim nothing was paid.** With the request key in place this is a safe retry, and the copy must say exactly that and nothing more.
> EN — title: `Connection lost — outcome unknown` · desc: `We did not get a reply from the server, so we cannot tell whether this payout was recorded. Press Retry: this attempt can only ever be recorded once, so retrying cannot pay anyone twice.` · variant: destructive, **with an explicit Retry action that reuses the same `requestIdRef`**.
> FR — titre : `Connexion perdue — résultat inconnu` · desc : `Le serveur n'a pas répondu ; impossible de savoir si ce versement a été enregistré. Cliquez sur Réessayer : cette tentative ne peut être enregistrée qu'une seule fois, un nouvel essai ne paiera personne deux fois.` · variant: destructive, action **Réessayer** réutilisant le même `requestIdRef`.

**If (a) is NOT shipped, class 4's only honest copy is:**
> EN: `We cannot tell whether this payout was recorded. Do NOT retry — open the seller's ledger and check before paying again.`
> FR : `Impossible de savoir si ce versement a été enregistré. NE RÉESSAYEZ PAS — ouvrez le grand livre du vendeur et vérifiez avant de payer à nouveau.`
> This is the measure of what (a) buys: it is the difference between a safe button and a manual reconciliation.

---

## 6. CORRECTIONS TO `docs/parked/PARKED_pay_sellers_bulk.sql`

Cited so they are not carried into the migration.

1. **`max 500` exceeds the statement budget.** `authenticated.statement_timeout = 8s`; measured ~23 ms per `pay_seller`. 500 targets ≈ 11.5 s ⇒ guaranteed `57014`. Use **100**.
2. **Deviation (A)'s justification is factually wrong.** The file states *"Nothing reads paid_at for ordering within a batch (attribution is FIFO on the ticket)"*. `paid_at` **is** read for ordering in five places: `refresh_seller_payment_balance` does `SELECT MAX(paid_at) … WHERE seller_payment_id = p_payment_id` (and writes it to `seller_payments.paid_at`), and four client queries `.order('paid_at', { ascending: false })` — `PayoutPaymentDialogs.tsx:195`, `:566`, `MediaBuyerLedgerDialogs.tsx:87`, `SellerLedgerDialogs.tsx:340`. **The conclusion (inert) still holds, but for a different reason**: every one of those readers is scoped to a single `seller_payment_id`, and a batch produces at most one txn per ticket (deviation B raises on duplicates), so there are no intra-ticket ties to break. The correct justification, not the stated one. Deviation (A) still needs the owner ruling.
3. **`23514` is the wrong errcode for the internal invariants** (`pay_seller returned no txn`, `paid % of %`). `23514` is `check_violation` and is *also* what `seller_payment_txns_amount_check` genuinely raises — the two become indistinguishable in logs. Use `P0001`. (No effect on the discriminator; both are in the definitive set.)
4. **The per-iteration `begin…exception when others` opens a subtransaction per target.** 100–500 subxids in a money transaction is gratuitous (and at >64 risks subxid overflow, degrading every other backend's snapshot handling). Hoist to **one** block around the whole loop; track the current seller in a variable for the message (shown in §4.1).
5. **`when others` swallows `57014` and `40P01`.** The re-raise preserves them, so this is currently correct — but it is one edit away from a payout path that silently eats a statement-timeout. Worth a comment.
6. **The file's SQL is otherwise sound**: `security invoker` + `set search_path to ''` + fully-qualified `public.pay_seller` works (`pay_seller` is SECURITY DEFINER and sets its own `search_path`); the `order by 1` deadlock argument is correct and load-bearing; the `current_user_is_business_admin()` gate exists live (`STABLE SECURITY DEFINER`, checks `users.role IN ('super admin','admin')`) — note it is **business-agnostic** and does *not* verify `p_business`, so `pay_seller`'s own `current_user_digicom_business_id() = p_business_id` check remains the real tenant gate. The wrapper's gate is defence-in-depth exactly as the file claims.

---

## 7. INFERRED (flagged — verify before depending on any of these)

- **PostgREST v14.12's SQLSTATE→HTTP map** (`57014→504`, `42501→403`, `23505→409`, `P0001→400`, `08*→503`, `53*→503`, `40P01→500`). The recommended predicate deliberately **does not depend on this** — it keys on `code`, using `status` only to detect `0`.
- **Kong/Cloudflare error-body shape.** Kong 3.9.1 returns JSON `{"message":"..."}` on a 502 (no `code` key) and Cloudflare returns HTML on 520/524. Both land in postgrest-js's `catch (_unused2) → error = { message: body }` with `code === undefined` and a non-zero `status`. Not reproduced live (would require killing `supabase-rest`). The predicate's `typeof code !== 'string' || code === '' → UNKNOWN` rule is safe under **either** shape, so this does not gate the design.
- **`08*` / `57P0*` reaching the client as a PostgREST envelope.** If the PG connection dies, PostgREST may surface the SQLSTATE or may surface a `PGRST` code / bare 500. Classified UNKNOWN in every case by the fall-through rule.
- **PostgREST applying `ALTER ROLE authenticated SET statement_timeout`.** `SET ROLE` in a plain psql session does **not** pick it up (measured: `0`). PostgREST reads role settings from `pg_db_role_setting` and applies them per request. Moot for the design: `authenticator` (the login role) carries `statement_timeout=8s` **and** `lock_timeout=8s` anyway, so 8 s binds under either mechanism.
- **`pay_seller` cost as `authenticated`.** Measured 17.7 ms exec + 5.1 ms plan as `postgres`. `seller_daily_earnings` is `relkind='v'` and security_invoker, so the RLS predicates make it **worse**, not better, under `authenticated`. The 100 cap has headroom against that; 500 does not under any reading.

---

## 8. FILES

- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/docs/parked/PARKED_pay_sellers_bulk.sql` — the draft (226 lines, never applied; §6 corrections)
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/pages/admin/Salaries.tsx` — `settleMutation` :196-222, `generateMutation` :1128-1189
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/components/salaries/PayoutPaymentDialogs.tsx` — single-pay dialog :150-250; overpay guard :185; txn ordering :195
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/whatsapp/lib/conversationsApi.ts` — **the FE idempotency precedent**, :35-73
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/payoutOrderAttribution.ts` — FIFO attribution; sorts **orders** by delivery date, not txns by `paid_at`
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/src/lib/database.types.ts:4963` — `pay_seller` type, goes stale on this migration
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/node_modules/@supabase/postgrest-js/dist/index.mjs` — `then()` transport catch ~L325-366; `processResponse` ~L373-440
- `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/docs/d7-recon/02-pages.md` — §6b, the originating finding
- Box: `/opt/supabase-project/volumes/api/kong.yml:131-144` — `rest-v1` route, no explicit timeouts
- Proposed: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast/supabase/migrations/20260715xxxxxx_d7b_pay_sellers_bulk_idempotent.sql`

## 9. ONE-LINE RECOMMENDATION

Ship **(a)**: `seller_payment_txns.request_id uuid` + `UNIQUE (request_id, seller_payment_id) WHERE request_id IS NOT NULL`, `p_request_id` threaded **into `pay_seller`** (DROP+CREATE, re-grant) with a `whatsapp.send_message`-shaped replay guard placed **after** the existing advisory lock, `pay_sellers_bulk` as a thin composing loop (cap **100**, `order by 1`, one exception block) returning `replayed`, an allow-list error discriminator keyed on `error.code` (never on HTTP status), a `requestIdRef` minted at click and **retained across UNKNOWN errors**, and four-class toast copy in **English** (this page is not French). File **(d)** — the live-remaining cap — as a separate change gated on the owner ruling *"may an admin ever pay a seller more than their live remaining?"*; it bounds damage but does not prevent duplicates, and it carries a real false-positive risk because `refresh_open_seller_ticket` can lower `total_amount` between render and call.