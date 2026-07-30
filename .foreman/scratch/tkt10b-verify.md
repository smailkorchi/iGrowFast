# VERIFY — BO management powers (migration + edge + frontend)

Blind verifier. Assume broken until proven. Repo: `/Users/ismailelqorchi/Desktop/iGrowFast/New Website/iGrowFast` (quote — spaces). Subjects: uncommitted diffs in supabase/functions/{manage-users,create-invitation,account-status-change}/index.ts, src/pages/admin/Users.tsx, src/components/users/{DirectCreateUserDialog,ChangeRoleDialog,SetPasswordDialog,InviteUserWizard}.tsx, and the untracked migration supabase/migrations/20260729180000_business_owner_multiplicity.sql. IGNORE `.foreman/**`.

## LOCKED MODEL
Multiple business owners per business. BO manages users INCLUDING other BOs within HIS OWN business: create (direct with password, email_confirm — no confirmation email), invite (incl. BO targets), promote/demote (any tenant role), set password, delete, suspend. Platform 'owner' unrestricted. Invariants: (a) a business never loses its LAST BO except by platform owner; (b) NOBODY but platform owner crosses the platform-'owner' role boundary (mint or strip); (c) a BO cannot be moved between businesses except by platform owner; (d) BO must have a business (CHECK).

## CRITERIA (cite file:line each)
1. MIGRATION trigger v3: trace every TG_OP × role-transition combination against invariants a-d — specifically verify the three Codex attack cases are closed: (i) UPDATE role BO→'owner' by same-biz BO actor → platform-boundary exception (not allowed by the demote guard); (ii) UPDATE "DigiCom Business" on a BO row (role unchanged) → biz-move exception for non-platform actors; (iii) concurrent last-BO demotions → businesses-row FOR UPDATE serializes before the EXISTS. Also: fast path skips innocent writes; auth.uid() NULL passes; replay-idempotent (DROP INDEX IF EXISTS + CREATE OR REPLACE + REVOKE).
2. EDGE manage-users: create/update guards — BO caller same-biz management incl. BO targets; destination role 'owner' rejected for non-owner callers in BOTH create and update paths (and update rejects when the TARGET's current role is 'owner'); last-BO rule on demote AND delete paths with platform-owner bypass; `set_password` action — guard (owner OR same-biz BO), ≥8 validation, updateUserById, no email.
3. EDGE create-invitation: 'business owner' invitable ONLY by BO/owner callers; admin-cannot-invite-super-admin preserved.
4. EDGE account-status-change: BO target suspendable by same-biz BO (same-business enforced somewhere in the flow — cite it).
5. FRONTEND: viewer-role query correct + gated; BO-only rendering of the two new row actions and the two-path add chooser; DirectCreateUserDialog posts create with password and surfaces server errors verbatim; ChangeRoleDialog posts update{role}; SetPasswordDialog posts set_password with matching payload keys (cross-check the edge's exact expected shape — top-level vs userData nesting!); InviteUserWizard tile only when allowBusinessOwner; ASSIGNABLE_ROLES excludes platform 'owner'; all dialogs French, states complete, no side-stripes.
6. Payload-shape seam: for EACH of the three new dialogs, diff the exact request body against the edge parser (body.userData vs body top-level, key names) — a mismatch here ships a dead button.
7. GATES: `npx tsc -b` exit 0 (run, tail, restore tsbuildinfo). deno check the three edge fns (restore deno.lock, porcelain clean).
8. Write set: exactly the files listed above (git status; ignore .foreman).

## MUST NOT
Edit source (restores excepted). Spawn subagents. Run db.sh --write.

## OUTPUT FORMAT
First line PASS / FAIL / PASS_WITH_NOTES; numbered verdicts with evidence; the TG_OP×transition trace for criterion 1 in compact table form; defects with location + scenario.
