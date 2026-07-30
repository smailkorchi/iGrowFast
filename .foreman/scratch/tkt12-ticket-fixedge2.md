# TICKET FX-E2 — archive/delete round-2 hardening (Codex findings)

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), apply the fixes below. The migration `supabase/migrations/20260730100000_user_archive.sql` was REWRITTEN — READ IT FIRST: it now provides `count_user_references` (internal), `user_deletion_profile` (dialog), and two ATOMIC service-role-only RPCs: `hard_delete_user_checked(p_user_id)` (lock+count+delete, RAISEs French on referenced/missing) and `archive_user_checked(p_user_id, p_enforce_last_bo)` (business-row lock + active-non-archived last-BO count + already-archived guard + flip). NOT yet applied to any DB.

## FIXES — `supabase/functions/manage-users/index.ts`
1. **Caller liveness gate**: where the caller row `me` is validated (ADMIN_ROLES check), additionally require `me.active === true` and no `me.archived_at` (add archived_at+active to the caller select) → 403 `Compte désactivé.` An archived/suspended admin's still-valid JWT must be useless here.
2. **Central target-tenant guard**: for EVERY target-bearing action (update, delete, archive, set_password): after fetching the target row, non-`owner` callers require BOTH businesses non-null AND equal (`me["DigiCom Business"]` vs target's) → 403 `Accès refusé — utilisateur d'une autre entreprise.`. Keep the existing role-specific guards after it. (Today only BO targets are tenant-checked — an admin of business X can manage ordinary users of business Y by UUID.)
3. **Delete rewire** (order fixes the no-repair-channel finding): existing guards (owner-target, BO rules — KEEP; the last-BO/demote guard for delete stays edge-side as a fast 403) → then: (a) `auth.admin.deleteUser(userId, true)` SOFT first — kills login/sessions, reversible; failure → 500 abort, nothing else happened; (b) `supabaseClient.rpc('hard_delete_user_checked', { p_user_id: userId })` — on error map: message containing « historique d'activité » → 403 with that message; « introuvable » → 404; else 500. On RPC failure the soft-deleted auth row is the only residue (login-dead, recoverable) — return the error; (c) `auth.admin.deleteUser(userId)` HARD — failure → console.error + 200 `{ success: true, auth_residual: true }` (harmless residue, documented). DELETE the now-unused `countUserReferences` helper entirely (the RPC is the single count implementation).
4. **Archive rewire**: keep edge guards (caller roles, platform-owner target, BO same-biz) but REPLACE the edge's last-BO count AND the already-archived 409 with the RPC: `rpc('archive_user_checked', { p_user_id: userId, p_enforce_last_bo: me.role !== 'owner' })` — map RAISEs: « déjà archivé » → 409, « dernier propriétaire » → 403 (LAST_BIZ_OWNER_MSG), « introuvable » → 404. Then the existing auth soft-delete fail-safe unchanged.
5. **Demote last-BO count fix**: the update-action's last-BO count (when demoting a BO via role change) must filter `.eq('active', true).is('archived_at', null)` — align with the trigger.
6. **System-column strip**: the update action's `rest` must delete `archived_at` and `active` for ALL callers (system-managed; account-status-change owns `active`).
7. **Conditional writes**: the update action's profile UPDATE adds `.is('archived_at', null)` to its WHERE (a race with archive then dies on 0 rows — treat 0-row update as 409 `Utilisateur archivé — aucune modification possible.`).

## FIXES — `supabase/functions/account-status-change/index.ts`
8. Caller liveness gate (same as fix 1). Target update gains `.is('archived_at', null)` on the WHERE + 0-row → 409 archived message (belt to the CHECK constraint's braces).

## FIXES — credential flows
9. `supabase/functions/request-credential-change/index.ts`: after resolving the target user, refuse when target `archived_at` non-null OR `active === false` → 403 `Compte désactivé.` (add columns to its select).
10. `supabase/functions/confirm-credential-change/index.ts`: before applying any credential change, fetch the target user's `active, archived_at`; refuse identically. Outstanding pre-archive links thereby die at confirmation.

## VERIFY BEFORE REPORTING
`deno check` all four fns (then `git restore deno.lock`; note @ts-nocheck limits). `git status --porcelain -- supabase/` = the four files + the migration (untracked, not yours). Re-read every edited block.

## MUST NOT
Touch src/**, the migration, other fns. Spawn subagents. Run db.sh --write.

## WRITE SET
`supabase/functions/manage-users/index.ts`, `supabase/functions/account-status-change/index.ts`, `supabase/functions/request-credential-change/index.ts`, `supabase/functions/confirm-credential-change/index.ts`.

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-fix file:line; gate tails; concerns.
