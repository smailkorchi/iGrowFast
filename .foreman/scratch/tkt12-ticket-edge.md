# TICKET E6 — manage-users: atomic delete order + archive action + guards

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), fix the user-deletion split and add the archive action in `supabase/functions/manage-users/index.ts` (+ one guard in `account-status-change/index.ts`). Schema/RPC contract: `supabase/migrations/20260730100000_user_archive.sql` — READ IT FIRST.

## CONTEXT (verified)
Current 'delete' (~:404-479): BO/last-BO guards → `auth.admin.deleteUser` FIRST (:430) → public.users delete SECOND (:433-436). A public-side FK block (orders.seller_id NO ACTION etc.) leaves auth deleted + profile orphaned = the reported bug. Worse: seller_payments/mediabuyer_payments FKs are ON DELETE CASCADE — a hard delete of a paid user destroys ledger rows. GoTrue supports soft delete: `auth.admin.deleteUser(userId, true)` (kills sessions+login, keeps the auth row, email stays reserved).

## PART 1 — 'delete' action (hard delete, now guarded + reordered)
1. AFTER the existing BO/last-BO guards, add the eligibility guard: call the RPC as the service client (`supabaseClient.rpc('user_deletion_profile', { p_user_id: userId })` — note SECDEF gates on auth.uid(); as service role auth.uid() is NULL → the RPC will RAISE 'Authentification requise.'. Therefore DO NOT call the RPC; instead inline the SAME total-reference count with direct service-role queries (copy the count set from the migration exactly — 7 categories; a shared helper `countUserReferences(supabaseClient, userId)` returning {counts, total}). If total > 0 → 403 `{ error: "Cet utilisateur a un historique d'activité — archivez-le au lieu de le supprimer.", total, counts }`.
2. Reorder: delete PUBLIC first, then AUTH. If the auth delete fails after public succeeded, console.error loudly and return 500 `{ error: 'Suppression partielle — contactez la plateforme.', partial: true }` (rare; explicit beats silent).

## PART 2 — NEW 'archive' action
Payload `{ action: 'archive', userId }`. Guards (same rigor as delete): caller ADMIN_ROLES; BO-target rules (owner OR same-biz BO); platform-'owner' target refused for non-owner callers; **last-BO rule**: archiving a business owner requires another ACTIVE, NON-ARCHIVED business owner in the same business (else 403 with the existing LAST_BIZ_OWNER_MSG). Then, in this order:
1. public.users UPDATE: `{ active: false, archived_at: new Date().toISOString() }`.
2. `auth.admin.deleteUser(userId, true)` (SOFT delete — second arg true). If it fails after the public update, revert is unnecessary (archived-but-loginable is fail-safe: active=false already blocks the app via existing suspension handling) — console.error + still return success with `{ auth_soft_delete: false }` noted.
Return `{ success: true }`.

## PART 3 — guards on stale flows
- 'update' action: refuse when the TARGET has `archived_at` non-null → 403 `Utilisateur archivé — aucune modification possible.` (read archived_at in the existing target fetch).
- 'set_password': same refusal.
- `supabase/functions/account-status-change/index.ts`: refuse activate/suspend when target `archived_at` non-null (same French message) — fetch includes the column already or extend it.

## VERIFY BEFORE REPORTING
No deno check (verifier's job); no deno.lock changes. Re-read edited blocks; `git status --porcelain -- supabase/` = the two files.

## MUST NOT
Touch src/**, migrations. Spawn subagents. Change the create/invite flows.

## WRITE SET
`supabase/functions/manage-users/index.ts`, `supabase/functions/account-status-change/index.ts`.

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-part file:line; concerns.
