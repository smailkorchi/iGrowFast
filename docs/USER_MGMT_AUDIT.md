# User Create/Edit Audit — `manage-users`

Date: 2026-06-18. Project: `zjkqprrfbibjoslvlmxf`. Verified against the live DB, the
deployed edge function (v7), and the auth logs. Adversarially re-verified by 4 independent agents.

## TL;DR

Two independent bugs, plus a data-drift that ties them together:

1. **Cross-business create is blocked** by *global* unique constraints `users_username_key`
   (UNIQUE `username`) and `users_email_key` (UNIQUE `email`) on `public.users` — neither is
   scoped to the `DigiCom Business` tenant. Two businesses cannot reuse a username. Proof: `ghita`
   already exists in two businesses only because the index is case-sensitive (`Ghita` vs `ghita`).
2. **Password-only edit fails (HTTP 422)** because the `update` action *always* forwards
   `email` to GoTrue (`if (email) authUpdates.email = email`) and the edit forms always submit the
   email field (seeded from `public.users`). When `public.users.email` ≠ `auth.users.email`,
   GoTrue treats it as an email change → 422 → the function `throw`s before the password is applied.
3. **Email lives in two stores** (`auth.users.email` and `public.users.email`), written by two
   non-transactional statements with no reconciliation → drift. On update, `public.users.email` is
   never written at all (email is excluded from the profile patch), so an auth-email change leaves
   the profile stale. Today: 1 hard divergence + 3 case-only diffs.

## Evidence

- Constraints (pg_constraint on `public.users`): `users_email_key:u`, `users_username_key:u`,
  `users_pkey:p`, `users_DigiCom Business_fkey:f`, `users_owner_no_business_chk:c`
  (`role <> 'owner' OR "DigiCom Business" IS NULL`), `users_commission_basis_check:c`,
  `users_payment_type_check:c`. The two `:u` constraints are plain btree UNIQUE on a single column,
  no tenant column, no `lower()`.
- Auth logs (2026-06-18 ~12:09–12:14 UTC): `PUT /admin/users/44f67d18-e2eb-457c-b146-e5d5900b5326`
  → `422`, repeated (~8 occurrences) — the user retrying.
- That user (`yassine33`, "Ad Solution", business `77f59ea5…`): `public.users.email = yassine@test.com`
  but `auth.users.email = hassanpartner23@gmail.com`. Its single `auth.identities` row (provider
  `email`) holds `hassanpartner23@gmail.com`. No pending email_change.
- Data: 22 users / 6 businesses. `dup_username` (case-insensitive) = 1 (`ghita` across 2 businesses).
  `email != auth email`: 1 case-insensitive, 4 case-sensitive. `within_business_username_collisions`
  if scoped to (business, lower(username)) = **0** → safe to scope.
- Deployed `manage-users` v7 == committed `supabase/functions/manage-users/index.ts` (no drift).

## Write paths (all share the same edge fn except the last)

| Caller | Action | Notes |
|---|---|---|
| `src/pages/admin/Users.tsx` | create/update/delete (all roles) | always sends `email` on update |
| `src/pages/owner/Users.tsx` | create/update/delete owner | always sends `email` on update |
| `src/pages/owner/Businesses.tsx:315` | create super admin per business | — |
| `src/pages/admin/DeliveryServices.tsx:596,679` | create/update/delete courier | always sends `email` |
| `src/pages/mediabuyer/Payments.tsx:639` | direct `users` update (bank fields) | RLS-governed self-update; OK |

No RPC backdoor: a scan of all `pg_proc` bodies found zero functions writing `public.users`.
`auth.users` has no non-internal triggers (no `handle_new_user`); the profile row is created
explicitly by the edge function.

## Secondary defects

- **Non-atomic create saga** (index.ts 67–107): `auth.admin.createUser` then a separate profile
  insert, with manual `deleteUser` compensation on failure. If the compensating delete fails, an
  **orphan `auth.users` row** remains and future creates with that email fail at step 1 with a
  confusing "email already registered".
- **Non-transactional update** (110–144): auth email/password update and profile update are two
  steps; an email change can land in `auth.users` and then fail the profile update → divergence with
  no rollback. This is the mechanism that produced the `yassine33` drift.
- **Raw error leakage**: the catch block returns the raw Postgres message, so users see
  `duplicate key value violates unique constraint "users_username_key"` instead of a human message.
- **Update omits `email_confirm`**: `createUser` passes `email_confirm: true`; `updateUserById`
  does not — a legit email change can land unconfirmed depending on GoTrue config.
- **No normalization**: username/email are not trimmed/lowercased, which is how case-variant
  collisions (`Ghita`/`ghita`) and case-only email drift arise.
- **`trg_reassign_sellers_on_user_update`** (AFTER UPDATE, not exception-guarded) runs 3
  `UPDATE orders` when a commercial's `products` change — a latent edit-failure source (not the
  current bug). `audit_users` swallows its own errors (harmless).
- `users_commission_basis_check` / `users_payment_type_check` will throw if a form ever submits an
  empty string for those fields.

## Constraint nuance for the fix

- Owners have `NULL` business (`users_owner_no_business_chk`); 2 owners exist. A composite unique on
  `(DigiCom Business, lower(username))` leaves NULL-business rows un-deduped — use a `COALESCE` sentinel
  or `NULLS NOT DISTINCT` so owners are unique among themselves.
- `auth.users` unique is `UNIQUE(email) WHERE is_sso_user=false` (partial). So `public.users.email`
  UNIQUE is **not** strictly redundant; keep a profile-level guarantee.

## Remediation (see chat for the open decision on email)

1. **Username → per-business, case-insensitive.** Drop `users_username_key`; add
   `UNIQUE INDEX ON public.users (COALESCE("DigiCom Business", '00000000-0000-0000-0000-000000000000'::uuid), lower(username))`.
   Safe: 0 existing within-business collisions.
2. **Edge fn `update`: only send `email` to GoTrue when it actually changed** (fetch current auth
   email, compare). Pass `email_confirm: true` when it does change. This fixes the password-only 422.
3. **Single source of truth for email.** On update, also write `public.users.email` so it never
   drifts; or stop storing email in the profile and read from auth. Backfill the existing divergence.
4. **Atomicity + idempotency**: detect/repair orphan auth users on create; map unique violations to
   friendly messages.
5. **Hotfix the blocked user**: set `public.users.email = hassanpartner23@gmail.com` (the real login
   email in auth) so `yassine33` becomes editable again.

## Applied 2026-06-18 (email kept global, username scoped per business)

- Migration `scope_username_unique_per_business`: dropped `users_username_key`; added
  `users_username_per_business_key` UNIQUE on `(COALESCE("DigiCom Business", sentinel), lower(username))`.
  Verified: cross-business username reuse now allowed; same-business (case-insensitive) still blocked.
- Edge fn `manage-users` v8: update path fetches current auth email and only forwards `email` to
  GoTrue when it actually changed (+ `email_confirm`); profile email now mirrors the auth login email
  on every edit (self-heals drift); friendly error messages; create rollback logs orphans.
- Data heal: 4 drifted profile emails reconciled to auth (incl. `yassine33`); remaining drift = 0.
- Advisors: no new findings attributable to this change.
- NOT changed (out of scope): `manage-users` has no caller-role check (service role + verify_jwt off) —
  any authenticated caller can invoke it. Email reuse across businesses remains unsupported by design.

## End-to-end verification (against deployed fn, throwaway users, all cleaned up)

Function now at **v10**. `friendlyError` made context-aware (supabase-js `AuthApiError` can surface an
opaque body whose `.message` is `"{}"` with no `.code`, so the throw sites pass `email`/`password`/`create`
context). Live integration tests:
- create → row consistent across `public.users` + `auth.users` + `auth.identities` (incl. `identity_data.email`).
- password-only edit → HTTP 200; login with new password works; old password rejected (was the 422 bug).
- email change (+ name/commission/active) → HTTP 200; **all three stores updated**; login works with new
  email, old email rejected; no pending `email_change` limbo.
- email → already-used → HTTP 400 "That email can't be used — already registered…".
- weak password → HTTP 400 "Password is too weak…".
- same username, different business → allowed; same username (any case), same business → HTTP 400
  "That username is already taken in this business."
- delete → removed from `public.users` + `auth.users` + `auth.identities`.
Post-test: 0 test residue, 0 email drift across all 22 users.

## Password-change 400 (reported after email worked) — diagnosis + fix

Symptom: changing a user's password returned 400 with the UI showing only "Edge Function
returned a non-2xx status code." Two distinct issues:

1. **Root cause is a GoTrue password policy, not our code.** The project enforces password
   requirements = uppercase + lowercase + digit (min 6). Leaked-password protection is *disabled*
   (advisor confirmed). Matrix on a throwaway user: `abcdefghij` → 400, `monmotdepasse123` → 400,
   `password123` → 400, `AbcDefGhij` (no digit) → 400, `NewPass456A` → 200. The user's chosen
   password lacked a required class, so GoTrue returned 422 → function 400. A strong password (and
   the previously-tested ones) succeed. The fix function/migration is not implicated.
2. **The real product bug: the frontend never showed the reason.** `supabase.functions.invoke`
   surfaces non-2xx as a `FunctionsHttpError` whose `.message` is the generic "non-2xx" string; the
   actual `{ error }` body lives on `error.context` (a Response), not `data`. Fixed with
   `src/lib/edgeError.ts::edgeFnErrorMessage(error, data)` which reads `error.context.json()`, wired
   into every `manage-users` caller (admin/Users, owner/Users, owner/Businesses, admin/DeliveryServices).
   Edge `friendlyError` password message corrected to state the real requirement (was "use 6 chars").

Function now at **v11**. To allow simpler passwords, relax it in Supabase dashboard →
Authentication → Password settings (this is a GoTrue project setting, not changeable via SQL/MCP).
