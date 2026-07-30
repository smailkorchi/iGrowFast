# TICKET EDGE — business owner role: edge-function parity + caller guards

## TASK
In repo `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces), implement the edge-function side of the `business owner` role. READ `.foreman/scratch/tkt10-inventory.md` FIRST — decisions + the exact per-file site list (EDGE FUNCTIONS section). Line numbers are approximate; verify each site by reading the file.

## RULES
1. **Parity**: every caller-authorization check listing `super admin` also accepts `business owner` (includes/equality forms per inventory).
2. **Recipient queries**: `.eq('role','super admin')` recipient/CC lookups become `.in('role', ['super admin','business owner'])` (send-payout-statement, delete-business, business-status-notify).
3. **Labels**: add `"business owner"` entries to every role-label map — French label `Propriétaire d'entreprise` (send-invitation, consume-invitation, account-status-change, manage-users).
4. **NOT invitable**: create-invitation ALLOWED_TARGET_ROLES stays WITHOUT business owner; extend the hierarchy gate so no one can invite/target the role.
5. **New guards (protection, service-role paths)** — the DB trigger cannot see the real caller through service-role writes, so the edge fns enforce it:
   - manage-users: creating a user with role `business owner` → allowed ONLY when the caller's role is `owner` (platform owner; this is the Businesses provisioning path). Editing role/deleting/suspending a user whose role is `business owner` → allowed ONLY when caller is `owner`; peers get 403 with a clear French error (`Le propriétaire de l'entreprise ne peut être modifié que par la plateforme.`).
   - account-status-change: target user role `business owner` → caller must be `owner`, else 403 same message.
6. Match each file's existing style. No refactors. Do NOT run deno check (verifier's job); do not touch deno.lock.

## VERIFY BEFORE REPORTING
- `grep -rn "'super admin'" supabase/functions/ | grep -v node_modules` — list any file:line you did NOT edit with a one-line reason (e.g. display-only, intentionally excluded per rules).
- `git status --porcelain -- supabase/` shows only edge-function files (no migrations — a sibling worker owns those).

## MUST NOT
Touch supabase/migrations/**, src/**, deno.lock. Spawn subagents.

## WRITE SET
`supabase/functions/**/index.ts` (only the files in the inventory's EDGE section + any additional role-check sites your grep finds).

## OUTPUT FORMAT
First line DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED; per-file edits (file:line); the unedited-sites list with reasons; concerns.
