# F3 (category-string retirement) — final sync runbook

All readers of `package_statuses.category` / `order_statuses.category` have been migrated to
owner-governable semantic flags (dev-verified: DB-function money parity identical, frontend
`tsc -b` + `vite build` green, grep shows zero functional category reads). What remains is the
**column drop**, which must run AFTER the edge functions are redeployed from disk, because 6
deployed functions still `select(... category ...)` at runtime and would 500 until redeployed.

`provider-integration/index.ts` is 4147 lines — deploy from disk via the Supabase CLI, not MCP inline.

## Order of operations (run on dev branch first, then prod)

### 1. Deploy ALL touched edge functions from disk (category-free code already committed)
```
supabase functions deploy provider-webhook --no-verify-jwt
supabase functions deploy ozon-poll-webhook
supabase functions deploy vitex-poll-webhook
supabase functions deploy quicklivraison-poll-webhook --no-verify-jwt
supabase functions deploy sync-tracking-statuses
supabase functions deploy provider-integration
```
(provider-webhook + quicklivraison are public webhooks → keep verify_jwt=false.)

### 2. Migration: rewrite match_package_status (drop category from return) + drop the columns
match_package_status is the ONLY DB object that blocks the drop (SQL-language fn references the column).
```sql
DROP FUNCTION IF EXISTS public.match_package_status(text);
CREATE FUNCTION public.match_package_status(p_status_value text)
 RETURNS TABLE(id uuid, code text, label text, color text)
 LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
    SELECT ps.id, ps.code, ps.label, ps.color
    FROM public.package_statuses ps
    WHERE ps.delivery_service_statuses @> to_jsonb(ARRAY[p_status_value])
       OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(ps.delivery_service_statuses) AS v(val)
           WHERE LOWER(extensions.unaccent(v.val)) = LOWER(extensions.unaccent(p_status_value))
       )
    ORDER BY
        CASE
            WHEN ps.is_delivered THEN 1
            WHEN ps.is_returned AND ps.is_refused THEN 4
            WHEN ps.is_returned THEN 2
            WHEN ps.is_cancelled THEN 5
            WHEN ps.flow_rank = 4 THEN 6
            WHEN ps.flow_rank = 3 THEN 7
            WHEN ps.flow_rank = 2 THEN 8
            WHEN ps.flow_rank = 1 THEN 9
            WHEN ps.is_postponed THEN 11
            WHEN ps.is_recheck THEN 13
            WHEN ps.is_new OR ps.flow_rank = 0 THEN 16
            ELSE 17
        END,
        ps.code
    LIMIT 1;
$function$;

ALTER TABLE public.order_statuses   DROP COLUMN IF EXISTS category;
ALTER TABLE public.package_statuses DROP COLUMN IF EXISTS category;
```

### 3. Patch database.types.ts — remove `category` from order_statuses + package_statuses (Row/Insert/Update)

### 4. Verify
- `get_advisors` security + performance (no new findings).
- Money parity unchanged: `seller_daily_earnings` 128 rows / 13368 / 1540 delivered; orders delivered-by-flag = 1204.
- `pg_proc.prosrc ILIKE '%category%'` → empty in public schema.

## Already applied on dev (migrations, in order)
add_status_semantic_flags → stageA..stageF1 (parcel/order cache work) →
stageF2_* (parcel cache drop) →
stageF3_s1_add_semantic_flags_flow_rank, stageF3_s2a/s2b/s2c/s2d_*, stageF3_s4a_add_finegrained_flags.

## Flags added (the new governable contract)
- package_statuses: is_new, is_cancelled, is_postponed, is_terminal, is_refused, is_recheck, flow_rank
  (+ pre-existing is_delivered, is_shipped, is_returned, excluded_from_delivery_rate)
- order_statuses: is_return, is_relaunch, is_postponed, deducts_stock, is_fake, is_double, is_blacklisted
  (+ pre-existing is_new, is_confirmed, is_paid, is_unpaid, is_cancelled, is_callback, pending_confirmation, excluded_from_delivery_rate)

## One documented behavior nuance
Webhook terminal-lock now treats returned/refused as one return-class (both is_returned), where
they were distinct categories before. Only affects nonsensical returned↔refused provider transitions.
