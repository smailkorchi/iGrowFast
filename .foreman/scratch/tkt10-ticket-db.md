# TICKET DB — business owner role: enum + full DB parity + protection (AUTHOR ONLY, DO NOT APPLY)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), author TWO migration files implementing the DB side of the `business owner` role. READ `.foreman/scratch/tkt10-inventory.md` FIRST — it carries the locked decisions and the full site inventory. You have READ access to the live DB via `printf '%s' "SQL" | ~/.igrowfast/db.sh -t -A` (read-only; use it to dump live policy/function definitions — the LIVE catalog is the source of truth, NOT old migration files). DO NOT use --write; you author files only.

## FILE 1 — `supabase/migrations/20260729140000_business_owner_enum.sql`
Exactly: `ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'business owner';` with a comment explaining it MUST be its own file/transaction (a new enum value cannot be used in the transaction that adds it). NO BEGIN/COMMIT in this file.

## FILE 2 — `supabase/migrations/20260729150000_business_owner_parity.sql`
Wrapped in BEGIN; SET LOCAL lock_timeout='5s'; … COMMIT; containing:
1. **Helper**: CREATE OR REPLACE `current_user_is_business_admin()` with `role IN ('super admin','admin','business owner')` — dump the live def first and change ONLY the array.
2. **Policies**: for EVERY policy from the live catalog matching 'super admin' (~44; query in inventory), regenerate with `'business owner'` added to the role array (handle both `ARRAY['super admin'::text,…]` and any `= 'super admin'` equality forms). Use `ALTER POLICY … USING (…) [WITH CHECK (…)]` with the FULL original expression text edited minimally — dump `qual`/`with_check` live per policy and splice. Storage.objects policies included. Preserve each policy's cmd/roles exactly. Emit them grouped by table with a count comment. IMPORTANT: generate this section by scripting over the live catalog output (write a scratch script if helpful), not by hand-typing 44 expressions — then paste the generated SQL into the migration.
3. **Functions**: for each of the 17 inventoried functions, dump the live def (`pg_get_functiondef`) and CREATE OR REPLACE with 'business owner' added wherever 'super admin' appears in a role check. Keep everything else byte-identical (CREATE OR REPLACE resets security_invoker on VIEWS only — these are functions, but preserve SECURITY DEFINER/search_path clauses exactly as dumped). If any occurrence of 'super admin' in a function is NOT a role check (e.g. a display string), leave it and note it in your report.
4. **One-per-business**: `CREATE UNIQUE INDEX users_one_business_owner_per_biz ON public.users ("DigiCom Business") WHERE role = 'business owner';`
5. **Protection trigger** on public.users: BEFORE UPDATE OF role OR DELETE; SECURITY DEFINER fn (search_path pinned, EXECUTE revoked from PUBLIC/anon/authenticated, TG_RELID check against public.users). Logic: acting user = auth.uid(); IF the OLD row has role='business owner' AND (TG_OP='DELETE' OR NEW.role IS DISTINCT FROM 'business owner') THEN allow ONLY IF auth.uid() IS NULL (service-role/system — edge fns enforce their own caller checks) OR the acting user's role='owner'; otherwise RAISE EXCEPTION with a clear French message ('Le propriétaire de l''entreprise ne peut pas être modifié par un pair.'). Also block INSERT/UPDATE that would create a SECOND business owner for a business? No — the unique index handles it; don't duplicate.
6. **Grants hygiene**: this migration creates one function — REVOKE EXECUTE from PUBLIC/anon/authenticated on it (STANDING RULE: box default ACL grants everything).

## VERIFY BEFORE REPORTING
- Both files parse: run `printf '%s' "BEGIN; <file2 body without COMMIT>; ROLLBACK;"`? NO — do not execute against the box at all. Instead lint statically: balanced quotes/parens, every regenerated policy has table+policyname existing in your live dump, count of policies edited == count matched live.
- Report: policy count edited (must equal live match count), the 17 fns each with a one-line note (edited / not-a-role-check), any 'super admin' DB site you found live that the inventory MISSED.

## MUST NOT
- Apply anything (no --write). Touch any file outside the two migration files (scratch scripts under .foreman/scratch/ are fine). Spawn subagents.

## WRITE SET
`supabase/migrations/20260729140000_business_owner_enum.sql`, `supabase/migrations/20260729150000_business_owner_parity.sql`, scratch under `.foreman/scratch/`.

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; counts (policies matched/edited, fns edited); per-fn notes; misses found; concerns.
