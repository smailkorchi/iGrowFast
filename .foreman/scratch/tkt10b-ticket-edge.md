# TICKET E4 — business-owner management powers, edge side

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), evolve the edge guards for BO multiplicity + add direct password set. LOCKED DECISIONS: multiple business owners per business; a BO manages users (incl. other BOs) WITHIN HIS OWN BUSINESS; platform owner does anything; a business must never lose its LAST business owner (removal/demotion blocked, suspend is allowed — reversible); BO may invite/create business owners.

## PART 1 — `supabase/functions/manage-users/index.ts`
1. Replace the three owner-only BO guards (create ~:222-224, update ~:292-298, delete ~:367-369) with: allowed when caller.role === 'owner' OR (caller.role === 'business owner' AND caller's "DigiCom Business" === target's "DigiCom Business"). For CREATE the business is already force-scoped to the caller's — a BO caller creating role 'business owner' is therefore same-biz structurally; keep the 403 for super admin/admin callers (message: `Le propriétaire de l'entreprise ne peut être géré que par un propriétaire ou la plateforme.`).
2. **Last-BO rule** (service-role writes bypass the DB trigger, so enforce here): before (a) DELETE of a user whose role is 'business owner', or (b) UPDATE that changes a BO's role to something else — count OTHER users with role='business owner' in the SAME business; if zero → 403 `Impossible de retirer le dernier propriétaire de l'entreprise.` Platform-owner callers BYPASS this rule (they may orphan deliberately).
3. **NEW action `set_password`**: payload `{ user_id, new_password }`. Guards: caller.role === 'owner', OR caller is 'business owner' of the target's business. Validate new_password (mirror whatever the create action requires; if none, require ≥8 chars → 400 `Mot de passe trop court (8 caractères minimum).`). Execute `auth.admin.updateUserById(user_id, { password: new_password })`. Return `{ success: true }`. No email sent.
4. Role changes via 'update' by BO callers: ensure a BO can change any same-business user's role to ANY role including 'business owner' (promotion) — the guard in (1) covers targets; verify the update path doesn't independently 403 role changes for BO callers.

## PART 2 — `supabase/functions/create-invitation/index.ts`
- ALLOWED_TARGET_ROLES: add "business owner".
- New gate replacing the flat "business owner cannot be invited" 403: target 'business owner' allowed ONLY when caller me.role is 'business owner' or 'owner' (403 otherwise, same French message as Part 1.1). Existing rule stays: 'admin' callers cannot invite 'super admin'. BO callers may invite any role.

## PART 3 — `supabase/functions/account-status-change/index.ts`
- Suspend guard v2: target BO may be suspended by caller 'owner' OR same-business 'business owner' (replace the owner-only form). No last-BO check (suspension is reversible — deliberate).

## MUST DO
- Match file styles; no refactors. Report file:line per change. Do NOT run deno check (verifier's job); no deno.lock changes.

## MUST NOT
Touch src/**, migrations, other fns. Spawn subagents.

## WRITE SET
`supabase/functions/manage-users/index.ts`, `supabase/functions/create-invitation/index.ts`, `supabase/functions/account-status-change/index.ts`.

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-part changes file:line; concerns.
