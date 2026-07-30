# TKT-10 inventory — every 'super admin' site (scout + live-DB sweep, 2026-07-29)

## Decisions (LOCKED by owner + lead)
- New enum value: `business owner` (matches 'super admin' spacing style).
- FULL privilege parity with super admin everywhere; extra privileges come later.
- Assignment: ONLY at business creation (owner's Businesses flow) — the first super admin becomes `business owner`. NOT invitable, NOT assignable via user-edit forms.
- Structural rule: max ONE business owner per business (partial unique index).
- Protection: business owner cannot be demoted/deleted/suspended by peers; only the platform owner can. DB trigger blocks authenticated non-owner actors; edge fns enforce for service-role paths (they know the real caller).
- Labels: EN `Business owner`, FR `Propriétaire d'entreprise`.

## LIVE DB (queried on box)
- 44 policies match 'super admin' literal — pattern: `check_user_role(auth.uid(), ARRAY['super admin'::text, 'admin'::text])` (array lives IN the policy qual/with_check). List obtainable live: `SELECT schemaname, tablename, policyname, cmd, roles, qual::text, with_check::text FROM pg_policies WHERE qual::text ILIKE '%super admin%' OR with_check::text ILIKE '%super admin%'`. Includes 3 on storage.objects (demand_media_*) and public.users trio.
- `current_user_is_business_admin()` helper: `role IN ('super admin','admin')` — 6 policies route through it (edit fn once → 6 covered).
- 17 public functions with 'super admin' in prosrc: admin_analytics_stats, approve_sheet_order, chat_customer_orders_count, chat_customer_orders_page, current_user_is_business_admin, close_mediabuyer_month, close_seller_month, mediabuyer_month_orders, pay_mediabuyer, pay_seller, refresh_all_open_seller_tickets, refresh_open_mediabuyer_ticket, refresh_open_seller_ticket, seller_month_orders, seller_roster_stats, sync_imported_orders, update_business_profile_fields.

## EDGE FUNCTIONS (supabase/functions/)
- create-invitation/index.ts:18 ALLOWED_TARGET_ROLES (do NOT add business owner — not invitable); :129 caller authz ["super admin","admin"] → ADD business owner; :152 hierarchy gate (admin can't invite super admin — extend: admin can't invite super admin; nobody invites business owner).
- send-invitation/index.ts:158 authz → add; :28 French label map → add entry.
- manage-users/index.ts:25 ADMIN_ROLES → add business owner; :365 label map → add; PLUS new guards: creating role 'business owner' allowed ONLY when caller is platform owner; edit/delete/suspend of a business-owner user allowed ONLY for platform owner.
- account-status-change/index.ts:36 authz → add; :17 label → add; PLUS suspend-target guard (cannot suspend business owner unless caller is owner).
- send-payout-statement/index.ts:56 authz → add; :70 CC query `.eq('role','super admin')` → `.in('role',['super admin','business owner'])`.
- delete-business/index.ts:39 recipient query .eq → .in (business owner gets the notice).
- business-status-notify/index.ts:43 recipient .eq → .in.
- consume-invitation/index.ts:23 label map → add entry.
- google-analytics-fetch/index.ts:214, meta-ads-fetch/index.ts:294, sheets-sync/index.ts:189, reopen-delivery-note/index.ts:119, request-credential-change/index.ts:48, meta-ads-oauth/index.ts:199 — authz includes/equality → add business owner.

## FRONTEND (src/)
- App.tsx:309 route guard `allowedRoles={['super admin','admin']}` → add (check for OTHER allowedRoles arrays with 'super admin' across App.tsx).
- Users.tsx:304-367 ROLE_META → new entry (label 'Business owner', Crown-family icon, distinct pill); :113 form z.enum — do NOT add (not assignable); :56 EDITABLE_ROLES/hasEditableConfig — business owner has no editable config (like super admin); role-change UI must not offer converting anyone to/from business owner.
- InviteUserWizard.tsx:32-38 ROLES array — do NOT add (not invitable).
- Businesses.tsx:340-361 createAdminMutation — role 'super admin' → 'business owner' (line 345); any UI copy naming the first admin.
- src/lib/invitations.ts:4 InviteRole — unchanged (not invitable).
- src/lib/database.types.ts:5134-5141 user_role union + :5268-5275 constants — ADD 'business owner' (hand-patch; regen later).
- Sweep src/ for remaining `'super admin'` literals: extend privilege checks; leave assignment/display-option lists unless listed above.
