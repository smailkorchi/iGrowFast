# VERIFY — business-owner role: edge functions + frontend

Blind verifier. Assume broken until proven. Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces). Subjects: uncommitted diffs in `supabase/functions/**` (14 files) and `src/**` (7 files). Design contract: `.foreman/scratch/tkt10-inventory.md` (READ FIRST). Migrations are reviewed separately — ignore `supabase/migrations/**` beyond reading for context; also IGNORE `.foreman/**`.

## ACCEPTANCE CRITERIA (cite file:line each)
1. PARITY, edge: every caller-authorization check that accepts 'super admin' also accepts 'business owner' — verify by `grep -rn "super admin" supabase/functions/` and confirming each CODE (non-comment) hit either includes business owner or has a valid exclusion (ALLOWED_TARGET_ROLES not-invitable; hierarchy gate unreachable for the role).
2. GUARDS, edge: manage-users — creating role 'business owner' requires caller role 'owner'; editing/deleting a business-owner user requires 'owner'; promotion of an existing user TO 'business owner' via update path is blocked for non-owner callers (this was an intentional deviation — verify it actually closes the escalation: can a super admin self-promote via any manage-users action?). account-status-change: suspending a business owner requires 'owner'. Trace each guard's placement relative to the action execution (guard BEFORE effect).
3. RECIPIENTS, edge: send-payout-statement CC, delete-business notice, business-status-notify — `.in('role', ['super admin','business owner'])` forms.
4. LABELS: French label `Propriétaire d'entreprise` present in the 4 label maps (send-invitation, consume-invitation, account-status-change, manage-users).
5. PARITY, frontend: `grep -rn "'super admin'" src/` — every privilege/visibility check includes 'business owner'; assignment/invite option lists do NOT (Users.tsx z.enum, InviteUserWizard ROLES, invitations.ts InviteRole). types union + Constants include the new value.
6. BADGE: Users.tsx ROLE_META has a complete 'business owner' entry (label/plural/icon/pill) AND the role routes into its own display bucket (not "Other"); the add/edit dialog can never set or unset the role (trace the gate).
7. ASSIGNMENT: Businesses.tsx createAdminMutation sends role 'business owner'; copy consistent.
8. WA module: src/whatsapp/lib/auth.tsx maps 'business owner' into the same bucket as super admin.
9. GATES: `npx tsc -b` exit 0 (run it, paste tail, then `git restore tsconfig.app.tsbuildinfo`). `deno check` each of the 14 edited edge fns' index.ts (or at minimum manage-users, account-status-change, create-invitation, send-payout-statement) — then `git restore deno.lock`; confirm porcelain clean of it.
10. WRITE SETS: edge diffs only in supabase/functions/**, frontend only in src/** (list any stray).

## MUST NOT
Edit source (lock/tsbuildinfo restores excepted). Spawn subagents.

## OUTPUT FORMAT
First line PASS / FAIL / PASS_WITH_NOTES; numbered verdicts with evidence; gate tails; defects with location + concrete scenario.
