# WA Mancer Recon 06 — App Shell, Auth, Onboarding, User-Facing Inbox

Scope: `/Users/ismailelqorchi/Desktop/WhatsApp Mancer/src` — App.tsx, main.tsx, App.css, index.css, routes/LoginRoute.tsx, routes/onboarding/OnboardingPage.tsx(+css), routes/user/Dashboard.tsx(.css), routes/user/UserLayout.tsx, routes/user/Whatsapp.tsx (routing/guard integration only), components/RouteGuards.tsx, lib/auth.tsx, lib/onboardingApi.ts, lib/usersApi.ts, lib/passwordStrength.ts, plus the shell files these directly depend on (supabase.ts, queryClient.ts, clientLog.ts, lazyWithReload.ts, Splash.tsx, RootErrorBoundary.tsx, AppLayout.tsx, userInbox/activeInstance.tsx, queries/agentDashboard.ts, notifications/*, Avatar/*).

Read-only recon 2026-07-05. No modifications made anywhere.

---

## 1. Entry point and app shell

### `src/main.tsx`
- `installClientLog()` before render — installs `window.onerror` + `unhandledrejection` listeners.
- Render tree: `StrictMode > RootErrorBoundary > QueryClientProvider(queryClient) > App + Toaster`.
- Deploy self-heal: listens for Vite `vite:preloadError` (stale hashed chunk after a deploy), reloads ONCE guarded by sessionStorage flag `wam.chunk-reload` (shared with lazyWithReload). Comment reveals the deploy model: rsync `--delete` of hashed chunks + Caddy SPA fallback serving index.html for missing chunks.

### `src/App.tsx`
- `AuthProvider > BrowserRouter > Suspense(fallback = full-viewport #0b141a div) > Routes`.
- All route components except `LoginRoute` are lazy via `lazyWithReload`.
- Imports `./App.css`.

### `src/lib/lazyWithReload.ts`
- React.lazy wrapper. On import failure matching `STALE_CHUNK_RE` (dynamically imported module / failed to fetch / MIME type / module script), sets sessionStorage `wam.chunk-reload=1` and reloads once, returning a never-resolving promise to keep Suspense pending. Successful import clears the flag. Non-chunk errors rethrow to the error boundary.

### `src/components/RootErrorBoundary.tsx`
- Class error boundary; `componentDidCatch` → `reportClientError('react', …)`. Fallback UI: dark full-viewport French message "Une erreur est survenue. / L'incident a été enregistré." + Recharger button (location.reload).

### `src/lib/clientLog.ts`
- `reportClientError(kind, message, stack)` — kinds: `error | unhandledrejection | react | ratelimited`. Dedup per `${kind}:${message}:${route}` for 60s; max 5/min/tab then a single `ratelimited` beacon; `muted` re-entrancy guard.
- `send()` checks `supabase.auth.getSession()`; drops silently when logged out; posts to edge fn **`client-log`** via `supabase.functions.invoke` (comment: lands in `system_logs` with `source='client'`, JWT-gated server-side).
- `installClientLog()` wires the two window listeners.
- Route sanitizer collapses UUIDs in hash to `:id`, truncates to 200 chars.

### `src/lib/queryClient.ts`
- Global TanStack QueryClient. Defaults: `staleTime 15s`, `gcTime 5min`, `refetchOnWindowFocus true`, `refetchOnReconnect true`, `refetchOnMount true`, `retry 1`.
- Global `MutationCache.onError` → `toast.error(normalizeError(error))` for EVERY mutation unless `meta: { silent: true }`.

### `src/lib/supabase.ts`
- Single `createClient<Database>` from env `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (throws at module load if missing).
- Auth options: `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false`, **`lock: noopLock`** — a pass-through replacing `navigator.locks` because stale locks (crashed tab / SW churn / HMR) hang every getSession/refresh call indefinitely. Explicitly "acceptable for a single-tab admin app".

### `src/components/Splash.tsx`
- Minimal loading card: eyebrow "WhatsApp Mancer", "Loading…". Uses `.splash*` classes from App.css.

### `src/index.css` (87 lines)
- `@import` Google Fonts **Poppins** (headings) + **Lora** (body) — external network dependency.
- Design tokens on `:root`: `--color-ink #141413`, `--color-canvas #faf9f5`, `--color-muted #b0aea5`, `--color-surface #e8e6dc`, `--color-accent-warm #d97757`, `--color-accent-cool #6a9bcc`, `--color-accent-natural #788c5d`; `--font-heading` Poppins, `--font-body` Lora. Base element resets, button baseline (ink bg / canvas text), link color accent-warm.

### `src/App.css` (1458 lines) — the shared shell stylesheet
Sections (top-level selector families):
- `.layout*` — sidebar shell: collapsible (`--sidebar-w`, collapsed 76px), brand row (`/Logo Light.png` + wordmark), nav items with active state, nav divider, **`.layout__chan*`** per-number channel avatar buttons with unread `.layout__chan-badge` (99+ cap) and `.is-active` accent ring, user pill (Avatar + name + role), dev-mode toggle `.layout__dev-toggle`, dev nav entries `.layout__nav-item--dev`, collapse + sign-out `.layout__action-btn`, `prefers-reduced-motion` guard, `.layout__main` scroll container.
- `.page*`, `.page-hero*` — shared page scaffolding and white hero card with decorative accent orbs.
- `.tile*` — dashboard tiles.
- `.btn*` — `btn--primary/ghost/danger/sm`.
- `.form__input`, `.form__error` — shared form styles.
- `.users-section*`, `.users-grid`, `.user-card*` — admin Users directory cards (incl. `--pending`, `.is-inactive`).
- `.badge--active/inactive/pending/admin` — status/role badges.
- `.modal-scrim`, `.invite-modal*`, `.invite-stepper*`, `.invite-presets`, `.role-toggle*`, `.issued*` — the admin invitation-creation modal UI (count stepper, admin/user role toggle, issued-links list with copy buttons, admin=warm / user=cool color rails).
- `.segmented*` — segmented control.
- `.splash*` — splash/notice cards (used by Splash, ProfileMissing, DeactivatedNotice).
- `.login*` — login page (panel, brand `/Logo Dark.png`, wordmark, fields, error, submit).

---

## 2. Routing table (every route and its guard)

| Path | Guard chain | Component | Notes |
|---|---|---|---|
| `/login` | none | `LoginRoute` | eager import; redirects to `state.from ?? '/'` if session exists |
| `/onboard/:token` | none | `OnboardingPage` | public invitation-claim wizard |
| `/` (index) | `ProtectedRoute` | `RoleRedirect` | → `/admin` if role==='admin' else `/user`; → `/login` if no profile |
| `/admin` | `ProtectedRoute > AdminGuard > AdminLayout` | index → `Navigate to="dashboard"` | |
| `/admin/dashboard` | same | `AdminDashboard` (`routes/admin/Dashboard.tsx`) | |
| `/admin/statistics` | same | `AdminStatistics` | |
| `/admin/numbers` | same | `AdminNumbers` | |
| `/admin/numbers/:id` | same | `AdminNumberDetail` | |
| `/admin/conversations` | same | `AdminConversations` | admin inbox |
| `/admin/contacts` | same | `AdminContacts` | |
| `/admin/assignment` | same | `AdminAssignment` | |
| `/admin/users` | same | `AdminUsers` | user directory + invitations UI |
| `/admin/log` | same | `AdminLog` | dev-nav (hidden unless dev mode) |
| `/admin/monitor` | same | `AdminMonitor` | dev-nav (hidden unless dev mode) |
| `/user` | `ProtectedRoute > UserGuard > UserLayout` | index → `Navigate to="dashboard"` | |
| `/user/dashboard` | same | `UserDashboard` (`routes/user/Dashboard.tsx`) | agent command desk |
| `/user/whatsapp` | same | `UserWhatsapp` (`routes/user/Whatsapp.tsx`) | agent inbox; deep-link params `?jid=…&instance=…` |
| `*` | none | `Navigate to="/"` | catch-all |

### `src/components/RouteGuards.tsx`
- **`ProtectedRoute`**: `loading` → `Splash`; no session → `/login` with `state.from = location.pathname`; `profileLoading && !profile` → Splash (kills the "no profile" flash); no profile → inline `ProfileMissing` screen ("No profile on record… Contact an administrator"); `!profile.is_active` → inline `DeactivatedNotice` screen; else `<Outlet/>`.
- **`AdminGuard`**: `profile?.role !== 'admin'` → `/user`. **`UserGuard`**: `profile?.role === 'admin'` → `/admin`. Both splash while profile loads.
- **`RoleRedirect`**: role==='admin' → `/admin`, anything else → `/user`.
- All checks are client-side; real enforcement is RLS + admin-gated edge fns/RPCs.

---

## 3. Role model

- Enum `public.user_role = 'admin' | 'user'` (database.types.ts line 1784). Exactly two roles — no owner/super-admin tier.
- Role lives on **`profiles.role`** (table `profiles`: `id` (= auth.users.id), `email`, `full_name`, `avatar_config Json`, `role user_role`, `is_active boolean`, `last_auto_assigned_at`, `created_at`, `updated_at`). `last_auto_assigned_at` supports admin round-robin auto-assignment (out of this scope's UI).
- Role checks client-side via `profile.role` (guards, `useUserInboxRealtime` gates on `userRole === 'user'`).
- Server-side helpers in DB (from generated types): **`is_admin()`**, **`has_role(...)`**, **`bootstrap_admin(...)`** (first-admin bootstrap; not referenced anywhere in src — server/manual only).
- Role/active mutations via SECURITY-DEFINER RPCs, not direct UPDATE: **`admin_set_user_role(p_user_id, p_role)`** and **`admin_set_user_active(p_user_id, p_active)`** — both return the updated `profiles` row (usersApi.ts).
- User deletion via edge fn **`admin-delete-user`** (`usersApi.adminDeleteUser`).
- Deactivation: `profiles.is_active=false` → `DeactivatedNotice` full-screen block in ProtectedRoute (client-side gate; session/JWT still valid).

---

## 4. Session handling (`src/lib/auth.tsx`)

- `AuthState`: `session`, `profile`, `loading` (cold boot only), `profileLoading`, `revalidating`, `signIn(email,password)`, `signOut()`, `refreshProfile()`.
- **Stale-while-revalidate bootstrap**: initial state read synchronously from localStorage —
  - session from **`sb-${PROJECT_REF}-auth-token`** where `PROJECT_REF = VITE_SUPABASE_URL.match(/https?:\/\/([^.]+)\./)[1]` (first hostname label — see hazards);
  - profile from **`wamancer.profile.v1`** (full Profile JSON incl. role).
  - If both cached: `loading=false`, `revalidating=true`, app renders in one tick; SDK refresh runs in background.
- `onAuthStateChange` handler:
  - sign-out → clear session+profile+cache in one render;
  - user changed OR (no profile && INITIAL_SESSION/SIGNED_IN) → refetch profile from `profiles` (`.select('*').eq('id', uid).maybeSingle()`), write cache;
  - otherwise (TOKEN_REFRESHED, focus-return INITIAL_SESSION with same user) → update session only. Guard exists because Supabase v2 re-fires INITIAL_SESSION on tab-visibility return (`_recoverAndRefresh`), which previously caused profileLoading flap + refetch storms.
  - `INITIAL_SESSION` clears `loading` + `revalidating`.
- `profileRef` mirror lets the effect-mounted closure read the latest profile.
- `signIn` = `supabase.auth.signInWithPassword`; `signOut` clears profile cache then `supabase.auth.signOut()`.
- **Second session-read path** in `usersApi.readJwtSync()`: reads `access_token` straight out of the same localStorage key, deliberately bypassing `supabase.auth.getSession()` (navigator.locks hang). Used for all `authedFetch` edge-fn calls.
- **`src/routes/LoginRoute.tsx`**: invite-only sign-in ("Sur invitation uniquement…"), French error mapper `frenchAuthError` (invalid credentials / email not confirmed / rate limit / network → French strings). `if (loading) return null` (blank screen during cold boot). On session, redirect to `location.state.from ?? '/'`. Brand: `/Logo Dark.png` + "WhatsApp Mancer" wordmark. NOTE: it never reads `location.state.email`, though OnboardingPage passes it (dead prefill, see hazards).

---

## 5. Invitation onboarding — end to end

### Admin side (creation) — `src/lib/usersApi.ts`
- `createInvitations(invites: InviteSpec[])` → POST edge fn **`create-invitations`** with Authorization: Bearer (readJwtSync) + apikey anon. `InviteSpec = { email?, full_name?, target_role, expires_in_days? }`; returns `CreatedInvite[] = { id, link, email, full_name, target_role, expires_at }` — server builds the `/onboard/<token>` link (plaintext token only exists in this response; DB stores `token_hash`).
- `listPendingInvitations()` — direct select on **`invitations`** filtered `consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()` (admin RLS).
- `revokeInvitation(id)` — direct UPDATE `invitations.revoked_at = now()`.
- `listProfiles()` — direct select of the directory columns from `profiles`.
- Admin invite-modal UI lives in `/admin/users` (App.css `.invite-modal*`, `.role-toggle*`, `.issued*` — count stepper, admin/user toggle, issued links with copy buttons).

### `invitations` table (from database.types.ts)
`id`, `token_hash` (no plaintext token stored), `target_role user_role`, `email` (nullable — binds invite to an address when set), `full_name` (nullable prefill), `expires_at` (default; copy says 7 days), `failed_attempts` (server-side rate limiting), `claimed_at` / `consumed_at` / `consumed_by` (two-phase claim→consume), `revoked_at` / `revoked_by`, `created_at`, `created_by`.
Supporting DB RPCs (generated types; called by edge fns, not the client): **`invitation_status(p_token_hash)`**, **`invitation_claim(...)`**, **`invitation_finalize(...)`**, **`invitation_rollback(p_invite_id)`** — a claim/finalize/rollback protocol around auth-user creation.

### Public side — `src/lib/onboardingApi.ts`
- `FN_BASE = ${VITE_SUPABASE_URL}/functions/v1`. Both calls are raw `fetch` with **only the anon `apikey` header — no JWT; the invitation token itself is the bearer of authority.**
- `checkInvitation(token)` → POST **`check-invitation`** `{token}`. Returns 200 `InvitationStatus`: ok → `{ target_role, email|null, full_name|null, expires_at }`; !ok → reason ∈ `not_found | consumed | expired | revoked | invalid_input | server_error`.
- `consumeInvitation({ token, email, password, full_name, avatar_config })` → POST **`consume-invitation`**. Server creates the auth user + profile; returns `{ ok:true, target_role }` or `{ ok:false, reason }` (reasons seen in UI mapper: `invalid_or_used`, `email_mismatch`, `expired`, `rate_limited`, `weak_password`, `invalid_input`).
- `signInAfterOnboarding(email, password)` — deliberate design: server does NOT return session tokens (setSession() can fail silently); the client signs in itself so the SDK owns session creation.

### UI — `src/routes/onboarding/OnboardingPage.tsx` (+ `onboarding.css`)
- Route `/onboard/:token`. Token plausibility gate `isPlausibleToken`: `/^[A-Za-z0-9_-]{20,80}$/` — malformed → `InvitationProblemScreen('malformed')` without any network call.
- On mount, TanStack query `['invitation','status',token]` → `checkInvitation` (staleTime 30s, retry 1). Loading → `InvitationCheckingScreen`; error → problem screen `network`; !ok → problem screen with that reason. `consumed` variant shows an "Aller à la connexion" link.
- 4 steps (`STEPS = Avatar, Identité, Mot de passe, Bienvenue`), framer-motion directional slide, `useReducedMotion` respected everywhere, animated `BackgroundMesh` blobs (warm/cool/natural brand colors).
  1. **Avatar** — `AvatarPicker` seeded by email; initial `genConfig()` random.
  2. **Identité** — full_name (≤80) + email (≤254, regex `\S+@\S+\.\S+`). If invite has bound email (`inviteQ.data.email`), field pre-filled and `readOnly` (locked).
  3. **Mot de passe** — client gate `strength.score >= 3 && length 12–128` with `StrengthBar` + unmet-requirement hints; show/hide toggle. Submit → `consumeInvitation` (email trimmed+lowercased); failure → French `humanReason` inline error.
  4. **Bienvenue** — entered immediately after server OK (before sign-in, so UI can't strand); `WelcomeBurst` (halo + avatar + animated check). Then `signInAfterOnboarding`; success → nav to `/admin` or `/user` per `target_role` after 2200ms; sign-in failure → nav to `/login` with `state:{email}` after 1800ms (account exists; manual sign-in).
- Local components: `StepBlock`, `StepIndicator`, `Check`, `Footer`, `PrimaryBtn`, `GhostBtn`, `StrengthBar`, `WelcomeBurst`, `BackgroundMesh`, `InvitationProblemScreen`, `InvitationCheckingScreen`; helpers `isPlausibleToken`, `firstName`, `humanReason`, `stepVariants`, `PROBLEM_COPY` (8 reason screens: malformed/not_found/consumed/expired/revoked/network/invalid_input/server_error).
- `onboarding.css`: viewport-fixed glass card over animated mesh blobs, step indicator dots, its own local `.btn`/`.form` copies (duplicated from App.css), strength bar color ramp.

### `src/lib/passwordStrength.ts`
- `passwordScore(pw)` heuristic 0–4 (length ≥8/≥14, ≥3 and 4 char classes + length ≥16; penalties for triple repeats and single-class) + French `reasons[]` (min 12 chars, lower, upper, digit, symbol). `STRENGTH_LABELS` = Trop faible…Très fort. Comment: server is the authoritative check (zxcvbn intentionally not shipped).

---

## 6. Profile / avatar model

- Avatar = **`profiles.avatar_config` (jsonb)** holding a **react-nice-avatar** config object. Type alias `AvatarConfig = any` (explicit escape hatch in database.types.ts).
- `src/components/Avatar/Avatar.tsx` — renders `NiceAvatar` from config; if config empty and a `seed` given (email), `genConfig(seed)` yields a deterministic stable identity. Props: size, shape (circle/rounded/square), className/style.
- `src/components/Avatar/AvatarPicker.tsx` — onboarding picker: hero preview (172px), Randomize (`genConfig()`), collapsible Customize panel with 3 tabs (`Style` / `Color` / `Accessories`): sex (man/woman with hair+eyebrow style side-effects), hair, eyebrows (woman), ears, eyes, nose, mouth, shirt, hat, glasses; brand-tuned `PALETTE` (faceColors/hairColors/bgColors/shirtColors/hatColors). Helpers `inferSex`, `isWomanHair`, `Segmented`, `Row`.
- Avatar is set ONLY at onboarding; no self-profile editing surface exists in the user shell (no settings page). Displayed in the sidebar user pill, org presence payload, typing indicators.

---

## 7. User (agent) shell and how it differs from admin

### `src/routes/user/UserLayout.tsx`
- Mounts, at layout level (so they run on every /user/* route): **`useUserInboxRealtime()`** (notifications), `PermissionBanner`, `NotificationStack`, and wraps children in **`ActiveInstanceProvider`**.
- Static nav: only **Dashboard**. Channel entries are dynamic: one avatar button per assigned WhatsApp number (`ChannelNavItem`), label = `display_name || wa_profile_name || 'WhatsApp'`, unread badge per instance, click → `switchInstance(id)` + navigate `/user/whatsapp`. Divider label "Numéros". Zero assignments ⇒ zero channel entries.

### `src/lib/userInbox/activeInstance.tsx`
- `ActiveInstanceProvider` + `useActiveInstance()` — single source of truth for "which assigned number is active", shared by navbar and inbox page. Persisted at localStorage **`wam.cv.user.active_instance`** (namespaced away from admin). Fallback order: picked-if-still-visible → first `connected` → first. `useInstances()` is RLS-scoped (**`wi_select` policy**) to instances the agent has an assigned conversation on. Also wires `useInstancesUnread` + `useInstancesUnreadRealtime` for instant navbar badges.

### `src/components/AppLayout.tsx` (shared shell, both roles)
- Sidebar collapse persisted at **`wam.sidebar.collapsed`** + reflected as `document.documentElement.dataset.sidebar`; dev-mode toggle persisted at **`wam.devmode`** (renders `devNav` — admin only passes it). `useSidebarCollapse()` context lets the inbox auto-collapse.
- **`useOrgPresence`** (lib/presence.ts) publishes `{user_id, full_name, avatar_config, email, role}` for every authenticated session to an org-wide realtime presence channel → powers admin dashboard "agents online". lib/presence.ts also contains `useAgentTyping` (per-conversation broadcast channel `presence:conv:<id>`, events `agent_typing`/`agent_stop`, 2.2s TTL) for agent-collision indication.
- User pill (Avatar, name, role string) + Collapse + Sign out buttons. Brand `/Logo Light.png`.

### `src/routes/admin/AdminLayout.tsx` (contrast)
- 7 nav items (Tableau de bord, Statistiques, Numéros, Messagerie, Contacts, Affectation, Utilisateurs) + `DEV_NAV` (Monitor, Journal) gated by the dev-mode toggle; prefetches users on mount. No channel entries — admin picks instances inside pages.

### `src/routes/user/Dashboard.tsx` (+ Dashboard.css)
- Agent "command desk", entirely scoped to the signed-in agent. Two **un-gated, auth.uid()-scoped RPCs**:
  - **`agent_dashboard_overview(p_since)`** → attention (awaiting_reply, oldest_waiting, scheduled_overdue, scheduled_failed), glance (assigned_total, open, unread_total, awaiting_reply, sent_today, received_today, pending_scheduled), since (new_assigned/new_inbound/sent vs last visit), recent conversations.
  - **`agent_performance(p_days=14)`** → headline sent/received week vs prev, streak_days, response medians, rank {position, team_size, sent} (rank shown only when team_size ≥ 3), daily series.
- `useAgentDashboardRealtime` — one channel `agent-dashboard-realtime` subscribing `postgres_changes` on `messages`, `conversations`, `conversation_assignments`, `scheduled_messages` (schema `public`), debounced 700ms invalidate of `['agent-dashboard']`.
- Last-visit anchor at localStorage **`wam.user-dash.last_visit`** (read+bumped per mount).
- UI: masthead greeting, triage strip (À répondre / Non lues / Assignées / Programmés), 4 perf KPIs with deltas, Recharts activity area chart + response-time line chart, rank card, recent-conversation rows deep-linking `/user/whatsapp?jid=…&instance=…`. `FreshState` empty-state when assigned_total===0. Imports BOTH `../admin/Dashboard.css` and `./Dashboard.css`. anime.js `animate/stagger` reveals, `CountUp`, reduced-motion respected.
- The `rpc` helper wraps `supabase.rpc` with a comment warning: detaching `rpc` from the client breaks `this` binding and fails with zero network calls.

### `src/routes/user/Whatsapp.tsx` — skim (routing/guard integration)
- Header comment: **pixel-replica of /admin/conversations; presentation layer (parts.tsx, icons.tsx, conversations.css, QuickRepliesPanel, TagsPanel) is SHARED from `routes/admin/conversations/` — "DO NOT fork it"; user-side restrictions live in this wrapper only.**
- Differences from admin:
  - Instance selection through `useActiveInstance` (RLS-limited to assigned instances); `ConnectionGate` offers **switch-only** — agents cannot create/pair/manage numbers.
  - Cannot open unassigned conversations: `ensure_conversation` RPC is admin-only, so deep links / jid navigation outside the assigned set toast `"Cette conversation ne vous est pas assignée."` `@lid` deep links are resolved via `contacts` lookup (`instance_id` + `lid`) to the consolidated phone-keyed thread.
  - Deep-link contract `?jid=<jid>&instance=<id>`: switches instance FIRST, lets the effect re-run so the jid resolves against the correct instance; `deepLinkHandled` ref + `setSearchParams({},{replace:true})`.
  - Favourites are per-browser localStorage **`wam.cv.user.favs.<instanceId>`** (admin uses a different namespace); filter lists were migrated to DB-level shared **tags**.
  - `InfoPane` receives `isAdmin={false}`.
  - Mark-read mirrors admin: optimistic `useMarkConversationRead` on open + `sendReadReceipt` (blue ticks), debounced 1200ms re-clear on new inbound while open.
  - `useInboxAttendance` keeps the number ONLINE while inbox open+visible (typing events), ban-safe offline after hide.
  - Sets `document.documentElement.dataset.route = 'conversations'` and auto-collapses the sidebar on mount.
  - Shared components consumed: `ChatList, ChatPane, ConnectionGate, EmptyState, InfoPane, MediaViewer, NewChatView, SearchInChatPane, QuickRepliesPanel, QuickReplyConfirm, TagsPanel, ScheduledMessagesPanel`; APIs `sendMessage, sendReadReceipt, sendStepSequence`; hooks from queries/conversations, queries/messages, queries/tags, queries/quickReplies, queries/waPresence.

### Notifications (mounted by UserLayout)
- `lib/notifications/realtime.ts` — `useUserInboxRealtime()`: gated `userRole === 'user'`; channel `user-inbox-<uid>`; subscribes `postgres_changes` INSERT on **`conversation_assignments`** (`filter: user_id=eq.<uid>`) and on **`messages`** (RLS filters server-side). Emits in-app banners (always) + desktop push only when `userIsAway()` (hidden OR !hasFocus); audible ping via `notify.ts` (`playPing`, `unlockAudioPlayback` on first gesture); reads previews from `conversations_decrypted` view / TanStack cache; invalidates conversations + instance queries. Desktop-push click does `window.location.assign('/user/whatsapp?jid=…')` (full reload).
- `lib/notifications/PermissionBanner.tsx` — dismissible permission toast; dismiss persisted at **`wamancer.notif.dismissed.v2`**; handles Chrome "quieter messaging" suppression.
- `lib/notifications/NotificationStack.tsx` — top-right stack, max 4, 7s auto-dismiss, click navigates to conversation; store in `lib/notifications/store.ts` (`emitAssignment`, `emitMessage`, `useNotifications`, `dismissNotif`).

---

## 8. Edge functions referenced by this scope

`check-invitation`, `consume-invitation` (public, apikey-only), `create-invitations`, `admin-delete-user` (JWT via readJwtSync), `client-log` (JWT via SDK). Full functions dir also contains: `_shared`, `admin-platform-logs`, `check-whatsapp`, `conversation-cleanup`, `group-create`, `group-leave`, `group-update-participants`, `group-update-picture`, `group-update-subject`, `instance-create`, `instance-delete`, `instance-disconnect`, `instance-pair`, `instance-presence`, `instance-restart`, `instance-status`, `instance-wa-profile`, `instance-wa-settings`, `instance-webhook-resync`, `media-sign`, `media-upload`, `og-fetch` (covered by other recon agents).

## 9. Env vars / secrets (names only, values never read)

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — used in supabase.ts, auth.tsx (PROJECT_REF derivation), onboardingApi.ts, usersApi.ts. Live in repo-root `.env` (gitignored; `.env.example` exists; repo has `secrets/` dir + `.sops.yaml` — other agents' scope).
- `VITE_GIPHY_API_KEY` — referenced elsewhere in src (inbox media, out of this scope).

## 10. Browser-storage key inventory (this scope)

| Key | Store | Purpose |
|---|---|---|
| `sb-<PROJECT_REF>-auth-token` | localStorage | Supabase SDK session; ALSO parsed manually by auth.tsx + usersApi.readJwtSync |
| `wamancer.profile.v1` | localStorage | cached Profile JSON (incl. role) for one-tick boot |
| `wam.chunk-reload` | sessionStorage | stale-chunk reload loop guard |
| `wam.sidebar.collapsed` | localStorage | sidebar state |
| `wam.devmode` | localStorage | dev-nav visibility (admin) |
| `wam.cv.user.active_instance` | localStorage | agent's active number |
| `wam.cv.user.favs.<instanceId>` | localStorage | agent per-instance favourites |
| `wam.user-dash.last_visit` | localStorage | "since your last visit" anchor |
| `wamancer.notif.dismissed.v2` | localStorage | permission banner dismissal |

Sign-out clears only the profile cache (SDK clears its own token); all `wam.*` keys persist across users on a shared machine.

## 11. Tables / views / RPCs touched from this scope

Tables: `profiles`, `invitations`, `conversations`, `messages`, `conversation_assignments`, `scheduled_messages`, `whatsapp_instances`, `contacts`, `tags` (+ conversation-tag join), `quick_replies`. Views: `conversations_decrypted`, `messages_decrypted`, `worker_health_status`. RPCs called: `admin_set_user_active`, `admin_set_user_role`, `agent_dashboard_overview`, `agent_performance`, `mark_conversation_read` (via hook). RPCs present in types and relevant to auth/onboarding but server-called: `invitation_status`, `invitation_claim`, `invitation_finalize`, `invitation_rollback`, `is_admin`, `has_role`, `bootstrap_admin`.

---

## 12. Surprises / merge hazards

1. **PROJECT_REF derivation breaks on self-host**: `VITE_SUPABASE_URL.match(/https?:\/\/([^.]+)\./)` takes the FIRST hostname label. Against iGrowFast's `https://api.igrowfast.com`, ref becomes `api` → key `sb-api-auth-token`; against a bare host/IP it becomes `''` and BOTH the SWR fast-boot AND `usersApi.readJwtSync` silently die (`authedFetch` throws 'Not authenticated' → every admin edge-fn call fails). This regex must be replaced with the SDK's real storage key during the merge.
2. **Three parallel session-read paths** (SDK, auth.tsx cache read, usersApi.readJwtSync) all hard-code the same storage-key convention. Any storageKey override must update all three.
3. **`lock: noopLock` disables cross-tab auth coordination** — deliberate for a single-tab app. If the inbox becomes a page inside the iGrowFast SPA sharing one client, this decision needs re-evaluation (iGrowFast's client doesn't do this).
4. **Login-alert collision**: iGrowFast fires a `new_login` email on every `auth.sessions` INSERT (fail-open trigger). Merging WA Mancer users into iGrowFast GoTrue means every agent sign-in and every `signInAfterOnboarding` triggers login-alert email.
5. **Two invitation systems**: WA Mancer's `invitations` (token_hash, claim/finalize/rollback RPCs, `/onboard/:token` wizard) duplicates iGrowFast's `user_invitations` + send-invitation + email-OTP verification pipeline. The merge must pick one lifecycle or agents will have a second, weaker onboarding path (no mailbox verification, no OTP, avatar-first UX).
6. **Role-model collision**: WA `user_role` enum is `admin|user`; iGrowFast `public.user_role` has 6 values (and its 'admin' is a real page-gated role — protected memory rule). Same enum NAME, different values — schema-merge into a `whatsapp` schema must rename or namespace the enum, and the guards' binary `role !== 'admin' → /user` logic needs mapping onto iGrowFast roles.
7. **`schema: 'public'` hard-coded** in every `postgres_changes` subscription (agentDashboard.ts, notifications/realtime.ts, queries/*) and all `.from(...)` calls assume the default exposed schema. Moving tables to a `whatsapp` schema requires client `db.schema` config + PostgREST exposed-schemas + realtime publication changes. Related trap from iGrowFast history: cloning drops the realtime publication — these subscriptions fail silently (no error, just no events).
8. **Client-side-only gates**: role guards, `is_active` deactivation screen, and admin/user split are all client-side; the enforcement layer is RLS (e.g. `wi_select` scoping instances to assigned conversations) + admin-only RPC checks (`ensure_conversation` throws 'forbidden'). Porting the UI without porting every RLS policy silently converts "agent sees only assigned" into "agent sees everything".
9. **Stale-role cache**: `wamancer.profile.v1` caches role in localStorage; a demoted admin keeps admin UI until a profile refetch (guards read cache first). Low risk standalone, worth noting for the merge's stricter tenancy.
10. **Dead prefill**: OnboardingPage's sign-in-failure path navigates to `/login` with `state:{email}` but LoginRoute never reads it — user retypes their email. Trivial fix during port.
11. **`consume-invitation`/`check-invitation` are anon-key, no-JWT endpoints** — the token is the bearer. iGrowFast's hardening plan (migration 000200 anon-revoke, Kong config, CF rate rules) must whitelist these routes or onboarding breaks; conversely they need the same rate limiting Mancer's server gives them (`failed_attempts`, `rate_limited` reason).
12. **Deploy coupling**: chunk self-heal assumes rsync `--delete` + Caddy SPA fallback + no-cache index.html. iGrowFast's frontend deploy pipeline is currently manual/unknown (deploy-pipeline memory: STALE) — porting the inbox into iGrowFast's SPA inherits whatever its chunk lifecycle is; the `wam.chunk-reload` guard should be namespaced or unified.
13. **External font dependency**: index.css `@import` Google Fonts (Poppins/Lora) — a hard runtime dependency on fonts.googleapis.com; iGrowFast brand/typography differs, and self-contained hosting may be wanted.
14. **Org-wide presence broadcasts PII** (email, full name, avatar, role) from EVERY session to a shared realtime presence channel readable by subscribers — fine in a two-role app; in iGrowFast's multi-business tenancy this must be scoped per business.
15. **Desktop-notification click uses `window.location.assign`** (full page reload into `/user/whatsapp?jid=…`) — if the inbox mounts under a different base path in iGrowFast, this hard-coded path 404s.
16. **`AvatarConfig = any`** and avatar configs stored as free-form jsonb (`react-nice-avatar` shape) — iGrowFast profiles use a different avatar model (self-edit avatar in profile system); merging user models means carrying react-nice-avatar or migrating configs.
17. **French-hard-coded UX everywhere** (login, onboarding, dashboard, toasts) with English fallback mapping of Supabase auth errors — matches iGrowFast's FR-first tone, but strings are inline, no i18n layer.
18. **`bootstrap_admin` RPC exists but is unreferenced in the client** — first-admin creation is a server/manual step; the merge design must decide who owns WhatsApp-admin bootstrap inside iGrowFast (owner? super admin?).
19. **Global mutation-error toast** (queryClient MutationCache) — if the ported inbox shares iGrowFast's QueryClient, this behavior either leaks app-wide or is lost; decide explicitly.
20. **localStorage hygiene**: `wam.*` keys (favourites, active instance, last-visit) survive sign-out and user switches on the same browser — acceptable solo, but a merged multi-role machine shares them; keys are at least role-namespaced (`wam.cv.user.*` vs admin).
