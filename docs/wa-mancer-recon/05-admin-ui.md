# WA Mancer Recon — 05: Admin UI (routes/admin + shared components)

Scope: `/Users/ismailelqorchi/Desktop/WhatsApp Mancer/src` — routes/admin/* (except Conversations, covered elsewhere), components/numbers/*, components/contacts/*, components/Avatar/*, components/Gauge/*, AppLayout, NavIcons, Splash, RootErrorBoundary. Every file read in full. Read-only recon for the iGrowFast merge.

---

## 0. Shell / navigation

### `routes/admin/AdminLayout.tsx` (30 lines)
Thin wrapper over `AppLayout`. Two nav sets:
- `ADMIN_NAV` (always visible): `/admin/dashboard` (Tableau de bord), `/admin/statistics` (Statistiques), `/admin/numbers` (Numéros), `/admin/conversations` (Messagerie), `/admin/contacts` (Contacts), `/admin/assignment` (Affectation), `/admin/users` (Utilisateurs).
- `DEV_NAV` (dev-mode only): `/admin/monitor` (Monitor), `/admin/log` (Journal).
On mount prefetches the user directory (`prefetchUsers(qc)` from `lib/queries/users`).

### `components/AppLayout.tsx` (211 lines)
Shared sidebar shell for admin AND agent layouts.
- Props: `nav: NavItem[]`, optional `channels: ChannelNavItem[]` (agent per-number buttons with unread badge, `picUrl`, active state — buttons not NavLinks because several channels share `/user/whatsapp`), `channelsLabel`, `devNav`.
- **Dev-mode toggle**: `localStorage['wam.devmode']`; when on, reveals the `devNav` section ("Développeur" divider). Purely client-side visibility — routes stay mounted/reachable by URL; real gating is the admin-only RPCs behind those pages.
- Sidebar collapse: `localStorage['wam.sidebar.collapsed']`, mirrored to `document.documentElement.dataset.sidebar` for CSS.
- Publishes session to org presence: `useOrgPresence({user_id, full_name, avatar_config, email, role})` — every authenticated session, powers the Dashboard "agents en ligne" widget. No tenant scoping (single-org app).
- Brand: `/Logo Light.png` + "WhatsApp Mancer" wordmark. User pill (Avatar + name + role), dev-toggle switch, collapse + sign-out buttons.
- Exposes `useSidebarCollapse()` via `SidebarContext`.

### `components/NavIcons.tsx` (143 lines)
Icon set: Phosphor outline (`PiSquaresFour` dashboard, `PiChartLineUp` stats, `PiSimCard` numbers, `PiAddressBook` contacts, `PiArrowsSplit` assignment, `PiUsersThree` users, `PiClockCounterClockwise` log, `PiGauge` monitor, `PiGearSix` settings) + `FaWhatsapp` for Inbox. `IconWhatsAppBrand` = official filled WhatsApp glyph (Simple Icons path) used as channel-avatar placeholder and number-health icon. Also `IconDev`, `IconCollapse/Expand`, `IconSignOut`, `IconChat`, `IconProfile`, `IconWhatsApp` (outline).

### `components/Splash.tsx` (10 lines)
Loading card ("WhatsApp Mancer / Loading…") shown during auth bootstrap.

### `components/RootErrorBoundary.tsx` (24 lines)
App-root error boundary. `componentDidCatch` → `reportClientError('react', message, stack)` (lib/clientLog → lands in system logs as source `client`). Renders dark full-screen "Une erreur est survenue" + Recharger button. (Dark palette is a WhatsApp-era leftover; rest of app is warm-paper light.)

### `components/Avatar/Avatar.tsx` (40 lines)
Renders `react-nice-avatar` from a stored `avatar_config` JSON. If config empty and `seed` given → deterministic `genConfig(seed)` so users have a stable identity pre-customization. Used everywhere (sidebar, dashboard team, assignment roster, log actor, stats agents).

### `components/Avatar/AvatarPicker.tsx` (331 lines)
Avatar customization UI (onboarding/profile). Tabs Style/Color/Accessories; segmented pickers for sex, hair (man: normal/thick/mohawk; woman: normal/womanLong/womanShort), eyebrows, ears, eyes, nose, mouth, shirt, hat (none/beanie/turban), glasses; color swatches from a brand palette (terracotta `#d97757`, cool `#6a9bcc`, natural `#788c5d`, ink `#141413`…). Randomize = `genConfig()`. Emits full `AvatarConfig` via `onChange`.

### `components/Gauge/Gauge.tsx` (38 lines)
Reusable 270° SVG arc gauge; threshold coloring green<70 / amber 70–89 / red≥90 (inverted with `goodHigh` for cache-hit). Used by Monitor.

### `components/Gauge/CountUp.tsx` (24 lines)
rAF tween from previous to next value (~600ms ease-out cubic), `fr-FR` locale formatting, honors `prefers-reduced-motion`. (Dashboard.tsx has its own separate anime.js CountUp.)

---

## 1. `/admin/dashboard` — Dashboard.tsx (343) + Dashboard.css (195)

Manager "command desk"; first page after auth. Editorial broadsheet style (Poppins/Lora, terracotta accent, warm paper). Explicitly excludes infra (worker/queue/dead-letter) — that lives in dev-mode Monitor/Log.

**Data sources**
- `useDashboardOverview()` → RPC **`dashboard_overview(p_since)`** returning `DashOverview`: `glance` (received_today, unread_total, open), `attention` (numbers_down[] {id,name,status,needs_repair}, oldest_waiting {wait_sec}, assignment_in_use, unassigned_open, scheduled_failed, snoozed_due, numbers_paused, merge_pending, invites_expired, inactive_users), `live` (total_numbers, connected, fleet[] {id,name,status,paused,last_seen_at}), `team[]` ({user_id, full_name, email, avatar_config, assigned}), `sparkline.inbound_by_hour[24]`, `since` (new_conversations, new_inbound, new_outbound — "since your last visit").
- `useOrgPresence` (Realtime presence channel) → online agent set (`role === 'user'` only).

**UX**
- Masthead: greeting + date + health pill (red/amber/ok) + CTAs (Boîte de réception, Statistiques).
- Fresh state (`total_numbers === 0`): 3 onboarding cards → connect number / invite team / configure routing.
- **Alert band** (`buildAlerts`): tiered red/amber, each links to the fixing page — number down/needs re-pair (→ `/admin/numbers/:id`), customer waiting >1h (red >4h) (→ conversations), unassigned conversations (only when `assignment_in_use`; red >25) (→ assignment), failed scheduled messages (red), snoozed due, paused numbers, pending contact merges (→ contacts), expired invites (→ users). Sorted red first.
- Pulse bento: focal "Reçus aujourd'hui" tile with custom smoothed Catmull-Rom→bezier SVG `AreaChart` of inbound-by-hour up to current hour + peak-hour caption; StatCells: Non lus, Ouvertes, Non assignées (or "À traiter" when assignment off), Agents en ligne (live pulse).
- Ops row: Numéros fleet list (status dot/pill via `numState` mapping incl. `paused` override → "En pause") + Équipe leaderboard (proportional load bars vs max assigned, online ring).
- "Depuis votre dernière visite" brief (3 stats) + Quick actions with badges.
- Motion: anime.js `Reveal` (IntersectionObserver, stagger), local `CountUp`, `useReducedMotion` everywhere; content visible by default (no-JS safe).

CSS: local tokens `--d-card/--d-line/--d-red(#c0492f)/--d-amber(#d97757)/--d-green(#788c5d)`, hairline rules, bento grid.

---

## 2. `/admin/numbers` — Numbers.tsx (80) + Numbers.css (1669)

Fleet listing page.
- Data: `useInstances()` (SELECT `whatsapp_instances`), `useInstancesRealtime()` (channel `numbers-page-instances`, postgres_changes on `whatsapp_instances`), `useWorkerHealth()` (SELECT `worker_health_status` — view/table with health, queue_depth, dispatching_count, drain_rate_1m, active_numbers, worker_id, last_heartbeat_at, last_dispatch_at, hostname, version).
- Layout: hero + `MetricsTiles(worker)` + "Numéros connectés" grid of `InstanceCard`s (skeletons while loading) or `NumbersEmptyState`.
- Flow: "+ Ajouter un numéro" → `CreateInstanceDialog` → on created, opens `PairDialog(pairId)`. `InstanceCard.onResumePair` also opens PairDialog for pending/disconnected/error instances.
- Numbers.css is the biggest stylesheet (1669 lines): instance cards with status beams, pair dialog chrome (`.pair*`), numbers-detail (`.nd-card` aside/body split cards, `.nd-watchdog`), kpi-grid, metric tiles, empty-state orbs.

### components/numbers/*

**`CreateInstanceDialog.tsx` (114)** — single-field modal: display name (1–80 chars, "how agents see this number"). Submits `useCreateInstance()` → edge fn **`instance-create`** `{display_name}` → returns `{instance:{id}}` → `onCreated(id)` chains into PairDialog. Esc closes; error surfaced from mutation. Deliberate note: mutation object excluded from effect deps (identity churn bug).

**`PairDialog.tsx` (1057)** — the pairing + initial-sync wizard. Phases `qr → syncing → ready → import`:
- **QR**: on open (and every Refresh), fires `usePairInstance()` → edge fn **`instance-pair`** `{instance_id}`. QR displayed from `instance.qr_code` (worker persists + auto-rotates it on Evolution `qrcode.updated`, clears on terminal states; delivered via Realtime/2.5s poll `useInstance(id, {refetchMs:2500, untilSynced:true})`) with fallback to the one-shot pair response `pair.data.qr.base64`. 4-step FR instructions (WhatsApp Business → Appareils connectés → Connecter un appareil → stay on window). Refresh button moved off the QR (was covering a finder corner and breaking scans). **Cancel = "Annuler et supprimer"**: deletes the unscanned instance via `useDeleteInstance()` (edge fn `instance-delete`) then closes — no stale leftovers. Auto-recovery: when the finite Baileys QR loop dies (status transitions to disconnected/error while in QR phase), re-fires pair once per transition (guarded on prev !== status).
- Phase derivation: stays on QR through `pending` AND `connecting` (Evolution serves QR + post-scan handshake under 'connecting'); jumps to SYNCING only at `status === 'connected'`.
- **SYNCING**: polls RPC **`admin_instance_sync_metrics(p_instance_id)`** → live counters: messages, conversations (+dms/groups), contacts (+resolved), jid_mapping, media_done/media_pending/media_failed, contact_profiles. Completion signal = `history_synced_at` present AND ≥ `last_connect_at` (worker stamps it on WhatsApp's final history batch, resets per connect — replaced an exploitable message-rate heuristic) AND `media_pending === 0`. Sub-stages: 'messages' → 'media' ("Téléchargement des médias · N restants") → 'complete'. `sync_progress` % shown when reported. Manual "Continuer quand même" unlocks after history sync or 120s safety net (`MAX_SYNCING_SECONDS`); auto-advances 1.2s after genuine completion. **Close button + scrim dismissal disabled during syncing** (sync continues server-side anyway). Message-rate (msg/s) computed client-side from an 8-sample window for display only.
- **READY**: success card (avatar + green ring + "Synchronisé" chip) + **seed phone book offer** → opens `ImportContactsModal` with `lockInstance` on this instance, or skip/close.
- Exports `InstanceSyncMetrics` type.

**`DeleteInstanceModal.tsx` (391) + DeleteInstanceModal.css (221)** — multi-step destructive wipe:
- PREVIEW: RPC **`admin_instance_delete_preflight(p_instance_id)`** → `{counts, r2_keys}`; renders per-entity counts for 15 keys: conversations, messages, r2_media_objects (warn), conversation_assignments, conversation_notes, conversation_tags, outbound_queue, contacts (warn — per-instance phone book, re-import at next pair), jid_mapping (per-WA-account, non-portable), contact_profiles, media_fetch_jobs, group_participants, tags, quick_replies, number_pacing_state. Zero-count rows hidden; total shown.
- CONFIRM: must type **"supprimer"** verbatim to unlock.
- WIPING: `useDeleteInstance()` → edge fn **`instance-delete`** which runs synchronously R2 wipe → Evolution logout/delete → DB deletion; Esc + scrim blocked while in flight; steps listed (R2 bucket / Evolution / DB).
- DONE: actual numbers (`summary.counts` total, `r2_objects_deleted`, `evolution_status`), auto-navigates after 1.6s. ERROR phase is recoverable (retry/close).

**`InstanceCard.tsx` (121)** — fleet card: status beam color per status, `InstanceAvatar`, display name, "en pause" chip when `worker_paused`, `wa_profile_name`, `StatusPill`, `LifecycleBadge`, watchdog chip ("Auto" when `auto_reconnect`; "Réappairer" warning when `status_detail` startsWith `needs_repair`), phone number, Vu/Appairé relative times, pair/reconnect CTA for pending/disconnected/error. `InstanceCardSkeleton` variant.

**`MetricsTiles.tsx` (91)** — worker health strip (6 tiles): Worker health (Sain/Obsolète/Hors service + colored dot), Profondeur de file (+ dispatching), Débit de vidage (drain/min), Numéros actifs (+ worker_id), Dernier battement (+ version), Dernière distribution (+ hostname). Source: `worker_health_status`.

**`EmptyState.tsx` (24)** — `NumbersEmptyState`: orb art + copy + "Ajouter un numéro" CTA + fine print ("appairage par QR; votre téléphone reste l'appareil principal").

**`InstanceAvatar.tsx` (42)** — profile pic (Evolution-fetched `profile_pic_url`) or deterministic initials disc from 3-color brand palette.

**`LifecycleBadge.tsx` (18)** — `lifecycle_state` labels: warming=En chauffe, established=Établi, cooling=En refroidissement, banned=Banni.

**`StatusPill.tsx` (20)** — `status` labels: pending=En attente d'appairage, connecting=Connexion…, connected=En ligne, disconnected=Hors ligne, error=Erreur.

---

## 3. `/admin/numbers/:id` — NumberDetail.tsx (1286)

Per-instance "chokepoint cockpit". Architecture doc in header: each number is a per-instance OUTBOUND CHOKEPOINT — many agents send in parallel, the server serializes into one human-looking stream; this page operates that serializer.

**Data**: `useInstance(id)`, `useInstanceStats(id)` → RPC **`instance_stats(p_instance_id)`** (conversations_total/groups/dms/unread/active_24h, contacts_total, messages_total/inbound_24h/outbound_24h/7d, queue_queued/dispatching/dead_24h, reconnects_7d, last_inbound_at/last_outbound_at), `useDispatcherState(id)` → Realtime subscription on table **`dispatcher_snapshot`** (worker UPSERTs throttled; fields last_dispatched_at, last_completed_at, last_send_at, sends_last_min, queue_queued, queue_dispatching, queue_dead_24h) + 30s fallback fetch, `useInstancesRealtime()`, `useInstanceLiveSync(id)` (postgres_changes on `messages` INSERT, `conversations` INSERT/UPDATE, `audit_log` INSERT filtered by instance → invalidates stats/recent/audit).

**Writes**: all settings via RPC **`set_instance_settings(p_instance_id, p_patch)`** (jsonb patch). Presence via edge fn **`instance-presence`** (persists `manual_presence` AND broadcasts via Evolution). Push-to-WA via edge fns **`instance-wa-settings`** (Evolution /settings/set) and **`instance-wa-profile`** (`{fields:['name','status','picture'], pictureDataUrl?}` — 5MB client cap mirroring the edge fn's MAX_PICTURE_BYTES). Ops: **`instance-webhook-resync`**. Lifecycle: **`instance-disconnect`** (hard unlink → re-pair required; gated behind explanatory confirm modal pointing to Restart for creds-preserving reconnect), **`instance-restart`**, **`instance-delete`** (via DeleteInstanceModal).

**Sections top-to-bottom**
1. **Hero**: avatar, name, StatusPill + LifecycleBadge + phone + wa_profile_name; `WatchdogToggle` (per-instance `auto_reconnect` flag; worker's status poll restarts genuinely-down numbers with backoff/caps/terminal detection; shows "réappairage requis" when `status_detail` = needs_repair*); action buttons: Appairer (pending/disconnected/error → PairDialog), Déconnecter (connected only, confirm), Redémarrer, Supprimer.
2. **Headline KPIs**: Entrants 24h / Sortants 24h / Conversations actives 24h / Non lus.
3. **LiveStateCard** ("État en direct"): `RateMeter` — sends_last_min vs `send_rate_per_min` cap, colored green/amber/red with "sous le plafond / au plafond" copy; tiles Dernière distribution / Dernier achèvement / Dernier envoi / En file / En distribution / Abandonnés 24h; idle line. 1s ticker for relative times.
4. **Contrôles de répartition**: `OperationalCard` — Répartiteur toggle (`worker_paused`) + Palier de cadence segmented (`lifecycle_state`: warming/established/cooling; banned locks the control). `PacingCard` — "Protection d'envoi": `pacing_mode` preset segmented (conservative/balanced/aggressive/custom) + 4 numeric fields `send_rate_per_min`/`minute_burst_cap`/`hourly_send_cap`/`daily_send_cap` (locked with 🔒 under named presets — the server keeps columns in sync with the profile, so columns are truth). `PROTECTION_PRESETS`: conservative 6/4/100/400, balanced 10/5/250/1500, aggressive 15/5/400/2000 — **comment says keep in sync with the CASE in `public.set_instance_settings`**. Copy stresses: single-contact sending never throttled; limits engage only under cross-contact concurrency or sustained volume (token bucket + caps).
5. **Comportement humain**: `PresenceCard` — `manual_presence` auto vs online (auto = offline, briefly online while an agent replies). `HumanizationCard` — `typing_enabled` + `typing_base_ms`(2000)/`typing_per_char_ms`(60)/`typing_cap_ms`(12000) + `read_receipts_mode` segmented off/on_open/on_dispatch. `ScheduleCard` — `business_hours_enabled` toggle (default OFF for new instances; existing backfilled ON), `business_hours` json `{tz, days[0-6], open, close}` with day-chip toggles, `quiet_hours_override_until` one-shot override (+1h/+3h/+8h/+24h presets, clear link) with a 30s staleness ticker.
6. **Compte WhatsApp**: `WaBehaviorCard` — `wa_reject_calls` (+ conditional `wa_call_reply_text`), `wa_auto_read_inbound`, `wa_read_status`, `wa_ignore_groups`, `wa_sync_full_history`; "Appliquer à WhatsApp" pushes to Evolution. `WaProfileCard` — read-only `wa_profile_name`, editable `wa_profile_status` ("À propos"), profile-photo picker (FileReader → dataURL → push `{fields:['picture']}`), "Envoyer le profil à WhatsApp".
7. **`OpsCard`** ("Outils d'exploitation"): Resynchroniser l'abonnement webhook.
8. **Bibliothèque** metric tiles (conversations w/ DM·groupes split, contacts, groupes, messages 7j, messages total, vu dernière fois) + **Fiabilité** (reconnects_7d, paired_at, status_detail).

Notable engineering: the delete-modal overlay is rendered from a single element included in every return path so it survives the moment the instance row vanishes from cache mid-delete (would otherwise unmount and strand the user on "Numéro introuvable"). Premium primitives (Card/Row/Toggle/Segmented/PacingInput) are inline-styled deliberately (no dependence on global CSS deploy lag); PacingInput uses render-time draft sync (React Compiler-friendly, no setState-in-effect). Also `useInstanceCapacityStatus` exists in the data layer (RPC `instance_capacity_status`, 30s poll) though not used on this page.

---

## 4. `/admin/users` — Users.tsx (657)

Team management. Roles are binary: `admin` | `user`.

**Data**: `useProfiles()` (SELECT `profiles`), `usePendingInvitations()` (SELECT `invitations` where `consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`).

**Sections**: Invitations en attente (PendingCards) / Admins / Utilisateurs (UserCards), framer-motion grids.

**UserCard** — Avatar + name/email + badges (Admin / Actif|Inactif / Vous). Expandable "Gérer" panel (blocked for self):
- Activer/Désactiver → RPC **`admin_set_user_active(user_id, is_active)`**
- Passer en admin/utilisateur → RPC **`admin_set_user_role(user_id, role)`**
- Supprimer définitivement → `window.confirm` → edge fn **`admin-delete-user`**.

**PendingCard** — placeholder avatar, name/email ("tout e-mail" when open), Invité badge, target_role badge, expiry countdown; Révoquer = direct client UPDATE `invitations.revoked_at = now()` (window.confirm).

**GenerateInvitesModal** — two phases:
- configure: stepper 1–50 (presets 1/3/5/10), RoleToggle (Utilisateur: "Uniquement les conversations assignées" / Admin: "Accès complet"). Copy: "chaque lien est à usage unique, cryptographiquement aléatoire, expire dans 7 jours".
- issued: `useCreateInvitations()` → edge fn **`create-invitations`** (array of `{target_role}`) → `CreatedInvite[] {id, link, target_role}`; **links displayed exactly once** with per-link Copier and Tout copier; "+ Générer plus" loops back. Invitation is link-only — sharing channel is the admin's choice (no email sending built in).

---

## 5. `/admin/assignment` — Assignment.tsx (1341) + Assignment.css (1257) — **THE routing model (merge redesign target)**

Two-pane routing console. Header comment: "All writes go through the SECURITY DEFINER RPCs in assignmentApi.ts — is_admin() gates inside the function."

### Scoping & data
- **Everything is per-instance.** `InstancePicker` in topbar (defaults to first connected instance, else first; dropdown only when >1; "Select all" multi-instance view explicitly NOT built — noted as requiring schema work to aggregate per-instance pools/configs).
- `useFlattenedConversations(instanceId, 'all')` — same conversation list source as the inbox.
- `useInstanceAssignments(instanceId)` — `listInstanceAssignments`: SELECT conversation ids for instance from `conversations`, then SELECT * FROM **`conversation_assignments`** IN those ids. Rows = `{conversation_id, user_id, ...}`; multi-row per conversation.
- `useProfiles()`; **roster = active non-admin users only** (`is_active && role !== 'admin'`) — admins already see everything via RLS, routing them is meaningless.
- Realtime: `useConversationsRealtime(instanceId)` + `useAssignmentsRealtime(instanceId)` (channel `assignments-page-{instanceId}`) so all admin sessions converge without polling. (Data layer also has `useConversationAssignees`/`useConversationAssigneesRealtime` channel `conv-assignees-{id}`, `useUnassignedConversations` → RPC **`admin_list_unassigned_conversations`**, `useAssignmentCountsByUser`, `useBulkUnassign` → RPC **`admin_unassign_conversations`** — used by the inbox/info-pane.)

### Visibility rules (duplicated verbatim from /admin/conversations)
1. Hide unresolved `@lid` DMs (no `contact_book_name`); phone-JID (`@s.whatsapp.net`) DMs always visible; groups always visible.
2. Dedup `@lid` siblings: when a contact_id also has a phone-JID conversation, hide the @lid one.
3. `openCountsByUser` (per-agent load) is computed from these *visible* rows only — defense-in-depth so a stray assignment on an unresolved conversation can't inflate counts (backend also cleans these).

### Filtering / selection
- Chips with live counts: Non assignées / Assignées à un / Assignées à plusieurs / DM / Groupes / Toutes (default **unassigned**). Search over label (via `conversationLabel(jid, peer_display_name, contact_book_name)`) + jid.
- Multi-select with tri-state select-all. **Selection is mode-locked homogeneous**: all-DM or all-group; clicking the other kind silently resets selection to that single row. Selection resets on instance/chip change (key-reset pattern, no effects).

### Assignment semantics (CRITICAL for merge)
- **DM = singleton assignee.** Assigning selected DMs to an agent iterates each DM through `useSetConversationAssignees` → RPC **`assign_conversation(p_conversation_id, p_user_ids)`** — atomic DELETE+INSERT diff to the exact list, so a DM assignment is a swap, returns `{added, removed}`.
- **Group = many assignees.** Bulk path `useBulkAssign` → RPC **`admin_assign_conversations(p_user_id, p_conversation_ids)`** — ON CONFLICT DO NOTHING (DMs with an existing owner are SKIPPED, not reassigned; that's why DMs use assign_conversation per-row).
- **Multi-agent picker**: whenever selection contains ≥1 group, agent cards grow checkboxes ("Assigner à N" in roster header). `assignSelectedGroupsToAgents` merges picked user ids into each group's current assignee set (union) and writes via `assign_conversation`. DMs in a mixed selection are silently skipped ("assign one DM to many agents" is invalid).
- Assignee pills on conversation rows have per-user ✕ → `removeAssignee`:
  - First checks **`scheduled_messages`** (status='pending', created_by=that user, conversation_id) — table is NOT in generated DB types, accessed via `as never` cast.
  - If pending scheduled messages exist → `UnassignScheduledModal` (from `conversations/UnassignScheduledModal`): **Keep** (cron still fires them) or **Drop** (delete each via `useDeleteScheduledMessage`) — then RPC **`unassign_conversation(p_conversation_id, p_user_id)`**.

### Auto-assign (per instance)
- Config columns on `whatsapp_instances`: **`auto_assign_enabled`** (bool) + **`auto_assign_user_pool`** (user-id array; filtered client-side to still-active non-admin agents). Strategy is hard-coded **`round_robin`** (only option). Applies to **new inbound DMs only**; groups never auto-assigned. When off, "chaque nouveau DM reste non assigné".
- `AutoAssignCard` (topbar hero): status pill (Activée · acheminement vers N agents sur M / warning "aucun agent dans le pool" / Désactivée), instant on/off toggle, Configurer.
- Writes via `useSetAutoAssign` → RPC **`admin_set_auto_assign(instanceId, {enabled, strategy, pool})`**. Two commit paths: toggle commits immediately with the *saved* pool; pool edits are a buffered draft in `AutoAssignModal` committed by Save (dirty tracking, discard-on-close, select-all, empty-pool warning).
- **Smart prompts** after enabling: pool empty → `PromptModal` (warn) "Le pool est vide" → configure. Pool ready + existing unassigned DMs → `PromptModal` (cta) "N DM non assignés" → **Appliquer aux N maintenant** = `useApplyAutoAssignBacklog` → RPC **`admin_apply_auto_assign_backlog(instanceId)`** returns assigned count (0 → "pool vide ou aucun agent éligible" toast); afterwards force-refetches assignment + conversations queries (realtime lags on bulk INSERT). "Nouveaux seulement" declines.
- Same backlog prompt fires after saving a pool while enabled with unassigned DMs present.

### Right pane (roster)
`agentcard` per agent: Avatar, name (+ "· vous"), open-conversation count with proportional context, "Assigner N" CTA (armed when a selection exists), or checkbox mode when the multi-agent picker is active. Empty state "Aucun utilisateur actif."

Misc: local `CheckSquare` tri-state SVG checkbox; `initialsOf`/`initialsColor` deterministic fallback avatars (4-color palette); `relativeTime`. Assignment.css also hosts the shared modal chrome (`.aamodal-scrim`, `.aamodal__btn`, `.instance-modal*`, `.promptmodal*`) reused by Numbers/Contacts/NumberDetail modals — a hidden cross-page CSS dependency (Contacts.tsx and NumberDetail.tsx import `Assignment.css` for it).

---

## 6. `/admin/contacts` — Contacts.tsx (537) + Contacts.css (687)

Per-instance phone book ("Répertoire par numéro").

**Data**: `useInstances` (picker limited to `connected`), `useContacts(instanceId)` (SELECT **`contacts`**: id, instance_id, book_name, push_name, phone_number, phone_jid, lid, profile_pic), `useUnresolvedContacts(instanceId)` (LID-only rows). Display name precedence: book_name → push_name → formatted phone → lid prefix.

**UX**
- `InstancePicker` pills (avatar + name; always visible; empty state points to Numéros). Selected instance scopes EVERYTHING (list, add, import, delete).
- Toolbar: search (book/push/phone), count "N résolus · M en attente".
- `ContactRow`: hover/多-select checkbox, avatar, name + secondary, phone tag or LID tag, actions: **Message** (only when `phone_jid`; navigates `/admin/conversations?jid=…`), edit, delete.
- Bulk bar when selecting: count, Tout sélectionner, Effacer, Supprimer la sélection → `DeleteConfirmModal` → `useDeleteContacts({ids, instanceId})` (DELETE on `contacts`).
- **ContactModal** (add/edit): instance target section (edit = locked "Déplacement impossible"; single instance = locked "Seul numéro"; else card picker), name, phone (min 7 digits after strip). Writes via `useUpsertContact` (upsert on `contacts` / `import_phone_book_entry`).
- Hero actions: **En attente** badge button (count of unresolved) → PendingContactsModal; **Importer le répertoire** → ImportContactsModal; **Ajouter un contact**.

### `components/contacts/ImportContactsModal.tsx` (472) + .css (268)
Phases pick → diff → apply → done (+error). Reused by PairDialog's seed step (`lockInstance`).
- Pick: connected-instance card picker (auto-selects the only one; lockable) + drag-drop/browse `.vcf`/`.csv`.
- Parsing: `parseVcf` (FN/TEL regex per BEGIN:VCARD block), `parseCsv` (header detection for name/nom + phone/tel/number; `,;\t` separators). `normalizePhone`: strip non-digits, `00`→drop, leading `0`→prepend country code. **`deriveCountryCode`**: from instance `phone_number`/`wa_owner_jid` — cc heuristics (1 / a 2-digit allowlist / 3-digit catch-all), **fallback '212' (Morocco)**. Dedup by normalized phone (first name wins).
- Diff (no writes): SELECT `contacts(phone_number, book_name)` for the instance IN(list) → classify new / updated / unchanged; `DiffSummary` tiles.
- Apply: `useUploadPhoneBook(onProgress)` → chunked RPC **`import_phone_book_entry`** calls with a progress bar; modal locked (Esc/scrim blocked). Done: count card, auto-close 1.6s; error phase can retry back to diff.

### `components/contacts/PendingContactsModal.tsx` (269)
Unresolved LID-only contacts for the instance ("WhatsApp n'a pas encore partagé leur numéro — se résolvent automatiquement au prochain message, ou associez manuellement"). Each row: avatar, name, `LID · <id>`, "Associer à…" opens inline `ResolvedPicker` (search over resolved phone-JID contacts, 50 cap). Picking calls `useResolveContact({instanceId, lid, phoneJid, pendingContactId, pushName, profilePic})` → checks/updates **`jid_mapping`** then RPCs **`upsert_jid_mapping`** + **`resolve_contact_from_mapping`** — explicitly the same path the inbound webhook takes when auto-resolving. Per-row error display.

---

## 7. `/admin/log` — Log.tsx (539) + Log.css (293) — dev-mode "Journal"

Unified monitoring console over TWO channels: hash-chained **audit** log (forensic business/security events, table `audit_log`) + **system** logs (operational worker/edge/cron events, table `system_logs`). Wrapped in a page-local `LogBoundary` error boundary.

**Two modes**:
- **Application**: KPI strip (Worker Sain/En retard/Hors ligne from `worker_health_status`, File d'attente + en cours, Débit/min, Erreurs, Avertissements, Événements for range). Filters: range 1h/6h/24h/7j/14j + refresh; debounced free-text search (event/payload/target_id/actor_label); channel chips (Audit/Système with facet counts); level chips (info/warn/error/debug); source chips shown when system channel active — **worker, edge, cron, db, evolution, caddy, redis, client, platform_api, platform_postgres, platform_auth, platform_storage, platform_realtime, platform_edge** (short badge labels); event-type multi-select and actor single-select dropdowns fed by RPC **`admin_log_facets`** (events + actors with counts, by_channel, by_level, by_source, total). Feed: infinite-paged RPC **`admin_query_logs`** (LogRow: channel, row_id, occurred_at, level, source, event, actor_uid/label/avatar, target_type/id, instance_id, conversation_id, payload). **Live tail** toggle: `useLogTail` Realtime channel `log-tail` (INSERTs on `system_logs` + `audit_log`), client-side filter matching, 300-row buffer, dedup by `channel:row_id` against the fetched feed. **Chain button**: RPC **`admin_audit_chain_status`** → "Chaîne vérifiée" or "Rupture #broken_id"; click re-verifies (`useRefreshChain`). **Export** CSV/JSON of currently loaded rows (`exportRowsCsv`/`exportRowsJson` from lib/exportData; columns time/channel/source/level/event/actor/instance_id/conversation_id/target_type/target_id/payload; note when facets.total > loaded). Row click → `LogDrawer` (actor avatar, meta dl with copy buttons on Instance/Conversation/Cible, pretty-printed payload with copy). Row summary line extracts up to 3 scalar payload keys (reason/error/status/state/name/count/attempt/to/from/role/detail).
- **Plateforme** (`PlatformPanel`): Supabase platform logs via edge fn **`admin-platform-logs`** (`usePlatformLogs(service, minutes)`), services API/Postgres/Auth/Storage/Realtime/Fonctions, windows 1h/6h/24h. Explicit notes: "Fenêtre récente uniquement (~24 h), non conservée. Source : API de gestion Supabase" and error mapping — **`not_configured` → "Le secret MGMT_PAT n'est pas configuré."** Expandable rows with copy.

---

## 8. `/admin/monitor` — Monitor.tsx (534) + Monitor.css (183) — dev-mode infra monitor

Live SERVER (app VPS) + DATABASE + R2 + Supabase-DB-host monitoring. All data from admin-gated SECURITY DEFINER RPCs (per header comment). Recharts v2 + custom `Gauge`/`CountUp`. Global "En direct/En pause" poll toggle feeds every hook's `live` flag.

**Data hooks (lib/queries/monitor.ts)**:
- `useHostCurrent` → RPC **`monitor_host_current`** (cpu_pct, cpu_cores, load1, mem_used_mb/total, disk_pct/used_gb/total_gb, containers[] {name, running, restarts, cpu_pct, mem_pct, mem_mb})
- `useHostSeries` → **`monitor_host_series(p_minutes)`** (cpu/mem time series)
- `useDbLive` → **`db_metrics_live`** (db_size_bytes, max_connections, connections {total,active,idle,idle_in_txn}, cache_hit_pct, top_tables[] {name,bytes,dead_pct})
- `useDbSeries` → **`db_metrics_series(p_source, p_hours)`**
- `useR2` → **`monitor_r2(p_hours)`** (latest[] Cloudflare bucket samples {storage_bytes, object_count, class_a_ops, class_b_ops, sample_ok} + `app_derived` {media_bytes, media_objects} fallback + `free_caps`)
- `useMonitorOverview` → **`monitor_overview`** (pg_up, instances_connected/total/error, worker_lag_sec, queue_depth, queue_drain, send_total_1h/send_failed_1h, dead_24h, cpu/mem/disk pct, errors_1h)
- `useMonitorApp` → **`monitor_app(p_hours)`** (queue {depth, by_status, dead_by_action, sent_1h, failed_1h, dead_24h}, workers[] {worker_id, hostname, lag_sec, active_numbers, queue_depth, dispatching, drain}, instances[] {id,name,status,lifecycle,paused,detail,last_seen_at,stale_sec}, errors_by_source_1h, errors_recent[])
- `usePromLatest`/`usePromSeries` → **`monitor_prom_latest(p_names)`** / **`monitor_prom_series(p_names, p_minutes)`** — Prometheus scrape of the Supabase box: node_cpu_seconds_total (by mode), node_disk_read/written_bytes_total, node_network_receive/transmit_bytes_total, node_filesystem_avail/size_bytes, node_load1/5/15, node_cpu_online, pg_stat_database_xact_commit/rollback_total, pg_stat_database_num_backends, pg_stat_database_blks_hit/read_total, replication_slots_max_lag_bytes, pgbouncer_pools_client_waiting_connections, pgbouncer_free_servers, pgrst_db_pool_available/waiting/max, realtime_postgres_changes_total_subscriptions, pg_wal_size_mb, pg_database_size_mb.

**Layout**: `OverviewStrip` alarm tiles (PostgreSQL up, Numéros connectés, Worker lag, File dispatch + drain, Échec envoi 1h % + dead 24h, Saturation hôte DB, Erreurs 1h) → KPI strip (CPU/Mémoire/Disque/BD Go/R2 Go) → Serveur gauges + CPU&Mem area chart → **Conteneurs** cards with hardcoded meta for docker names **`wa-mancer-evolution`** (Moteur WhatsApp), **`wa-mancer-worker`** (Dispatcher), **`wa-mancer-postgres`** (BD Evolution), **`wa-mancer-redis`** (Cache), **`wa-mancer-caddy`** (Reverse proxy) — per-container CPU/RAM bars, restart counts, Arrêté/Actif pill → Base de données (connections stacked bar + series, cache-hit gauge, Plus grandes tables with dead-tuple %) → Stockage R2 (usage gauge vs 10 Go free tier, objets, taille moyenne, egress 0$, Class A/B ops vs free caps, "estimé (app)" badge when no CF sample, "dégradé" when sample_ok=false) → Serveur de base de données (Supabase) node_exporter section (CPU par mode stacked, débit disque, réseau, systèmes de fichiers) → PostgreSQL (transactions, backends, cache hit lifetime, replication lag) → Pooler & API (PgBouncer waiting clients, PostgREST pool, MiniStats) → File & dispatch (queue by status queued/dispatching/sent/failed/dead/cancelled, dead-letter by action) → Workers rows (lag pills) → Numéros WhatsApp rows (status/lifecycle/staleness) → Erreurs & journaux (errors by source 1h + recent log lines).

Helpers: `pivot`/`mergeNamed`/`single`/`filesystems`/`ratioPct` reshape Prometheus points; `StackedArea`/`MultiLine`/`AreaOne`/`MiniStat`/`Kpi` chart atoms.

---

## 9. `/admin/statistics` — Statistics.tsx (393) + Statistics.css (172)

Manager analytics (editorial rebrand matching Dashboard). Dispatch internals intentionally removed (belong to Monitor). Data: admin-gated **`stats_*`** RPCs via lib/queries/stats.ts.

**Controls**: range segmented 24h/7j/30j/90j (bucket hour/day/week) + instance select ("Tous les numéros"). `useStatsRealtime` — Realtime channel `stats-realtime` invalidates on messages/conversations/instances changes.

**Data**: `useStatsOverview` → **`stats_overview`** (inbound/outbound + *_prev, delivered, read, reply_p50_sec/p90, awaiting_reply, unread_total, active_convos); `useStatsMessageSeries` → **`stats_message_series`**; `useStatsBreakdowns` → **`stats_breakdowns`** (kind[], funnel {sent,delivered,read}, origin{}, dm_group); `useStatsHeatmap` → **`stats_heatmap`** (dow×hour inbound/outbound); `useStatsByAgent` → **`stats_by_agent`** (agent_uid, label, avatar, sent, convos, reply_p50_sec, read_cnt); `useStatsFleet` → **`stats_fleet`** (numbers health); `useStatsService` → **`stats_service`** (first-reply SLA: within_5m/within_30m/within_2h/slower/pending, answered, total, p50_sec).

**Sections**: KPI strip with deltas vs previous period (Messages big, Reçus, Envoyés, Taux de livraison + % lus, Délai 1ʳᵉ réponse p50 + p90) → inline facts (numéros connectés, en attente de réponse, non lus, conversations actives, ratio de réponse, DM vs groupes) → hero Recharts volume area chart (Reçus/Envoyés) → custom **heatmap** 7×24 ("fuseau Casablanca" hint) with mouse-follow tooltip → Qualité de service (median delay, answer rate, ≤5min share, stacked SLA bar + legend) → Types de message bar-list (KIND_FR maps text/image/video/audio/ptt/voice/document/sticker/location/contact/reaction/poll/call/system/unknown) → Entonnoir de livraison (Envoyé 100% → Livré → Lu; funnel counts derived cumulatively: sent = sent+delivered+read etc.) → Origine des envois (ORIGIN_FR: interactive/quick_reply/scheduled/forward/batch/auto) → Santé des numéros (fleet rows, same numState as Dashboard) → Performance de l'équipe table (Agent avatar+load bar, Envoyés, Conversations, Délai médian, Taux de lecture).

---

## 10. Data-layer name index (as used by these pages)

**Tables/views read directly**: `whatsapp_instances`, `worker_health_status`, `conversations` / `conversations_decrypted`, `conversation_assignments`, `contacts`, `jid_mapping`, `profiles`, `invitations`, `audit_log`, `system_logs`, `scheduled_messages` (untyped cast), `dispatcher_snapshot` (untyped cast), `messages` (realtime only).

**RPCs**: `dashboard_overview`, `instance_stats`, `instance_capacity_status`, `admin_instance_sync_metrics`, `admin_instance_delete_preflight`, `set_instance_settings`, `assign_conversation`, `unassign_conversation`, `admin_assign_conversations`, `admin_unassign_conversations`, `admin_list_unassigned_conversations`, `admin_set_auto_assign`, `admin_apply_auto_assign_backlog`, `admin_set_user_active`, `admin_set_user_role`, `import_phone_book_entry`, `upsert_jid_mapping`, `resolve_contact_from_mapping`, `admin_query_logs`, `admin_log_facets`, `admin_audit_chain_status`, `monitor_overview`, `monitor_app`, `monitor_host_current`, `monitor_host_series`, `db_metrics_live`, `db_metrics_series`, `monitor_r2`, `monitor_prom_latest`, `monitor_prom_series`, `stats_overview`, `stats_message_series`, `stats_breakdowns`, `stats_heatmap`, `stats_by_agent`, `stats_fleet`, `stats_service`.

**Edge functions**: `instance-create`, `instance-pair`, `instance-disconnect`, `instance-restart`, `instance-presence`, `instance-wa-settings`, `instance-wa-profile`, `instance-webhook-resync`, `instance-delete`, `instance-status`, `check-whatsapp`, `group-create`, `group-leave`, `group-update-participants`, `group-update-subject`, `group-update-picture` (instancesApi), `create-invitations`, `admin-delete-user` (usersApi), `admin-platform-logs` (logs).

**Realtime channels**: `numbers-page-instances`, `numbers-detail-{id}`, `dispatcher-snapshot-{id}`, `assignments-page-{id}`, `conv-assignees-{id}`, `log-tail`, `stats-realtime`, org presence channel (lib/presence).

**Edge-fn transport hazard**: `instancesApi.call()` and usersApi bypass `supabase.functions.invoke` — raw fetch to `${VITE_SUPABASE_URL}/functions/v1/...` reading the JWT synchronously from `localStorage['sb-{PROJECT_REF}-auth-token']` where PROJECT_REF is regex-extracted as the FIRST hostname label of VITE_SUPABASE_URL (workaround for a navigator.locks hang). 25s AbortController timeout; machine-readable `reason` errors.

---

## 11. Surprises / merge hazards

1. **DM-singleton vs group-multi assignment is enforced by RPC semantics, not visible schema**: `assign_conversation` = atomic diff/swap; `admin_assign_conversations` = ON CONFLICT DO NOTHING that *skips* owned DMs. The iGrowFast redesign must preserve both behaviors or re-derive them.
2. **Auto-assign config lives as columns on `whatsapp_instances`** (`auto_assign_enabled`, `auto_assign_user_pool` uuid[]), one pool per instance, strategy locked to round_robin, DMs only. Multi-instance aggregate view explicitly deferred for "schema work".
3. **Unassign interacts with `scheduled_messages`**: pending scheduled messages authored by the unassigned user trigger a keep-or-drop decision (cron fires kept ones even after unassignment). Any iGrowFast assignment redesign must handle this coupling.
4. **Roles are binary admin/user** in `profiles` + invitation `target_role`; iGrowFast has a 6-value `user_role` enum — mapping needed for Users page, RoleToggle, roster filtering (`role !== 'admin'`), presence role filter (`role === 'user'`).
5. **Parallel invitation system** (`invitations` table + `create-invitations` edge fn + one-time links, revoke via direct client UPDATE) duplicates iGrowFast's existing `user_invitations` lifecycle (token rotation, email sending). Two systems will collide.
6. **JWT-from-localStorage transport** (`sb-{first-hostname-label}-auth-token`): for `https://api.igrowfast.com`, PROJECT_REF resolves to `api` → key `sb-api-auth-token`. Must verify the self-hosted storage key or the entire instance lifecycle UI silently breaks with `not_authenticated`.
7. **`audit_log` name adjacency**: WA Mancer has a live hash-chained `audit_log` + chain-verification RPC; iGrowFast RIPPED OUT its audit-log feature in June (register says never reference `audit_logs`). Schema-qualified `whatsapp.audit_log` avoids collision, but the Log page's chain/actor features presuppose the trigger/RPC stack migrates too.
8. **Monitor page is infrastructure-shaped for the OLD stack**: hardcoded container names `wa-mancer-*`, RPCs fed by VPS-side collectors (host sampler, docker stats, Prometheus scrape of the Supabase box, R2 sampler, `dispatcher_snapshot`). Relocating Evolution to the new WhatsApp VPS (213.199.54.67) and the DB into the iGrowFast box invalidates most feeds; every `monitor_*`/`db_metrics_*` RPC needs a re-pointed collector or removal.
9. **Platform-log mode depends on the Supabase Management API** (`admin-platform-logs` edge fn + `MGMT_PAT` secret) — meaningless against iGrowFast's self-hosted box; feature must be cut or re-targeted (box journald/docker logs).
10. **Realtime publication breadth**: postgres_changes subscriptions on `whatsapp_instances`, `messages`, `conversations`, `conversation_assignments`, `audit_log`, `system_logs`, `dispatcher_snapshot` — all these tables must be in the self-hosted `supabase_realtime` publication (iGrowFast has prior incidents of publication loss on clone).
11. **Untyped table casts**: `scheduled_messages` and `dispatcher_snapshot` are absent from generated `database.types.ts` and accessed via `as never`/manual casts — type regeneration in the merged repo won't flag breakage in these paths.
12. **LID/@lid dedup + visibility rules are duplicated** between Assignment.tsx and Conversations.tsx (and the agent counts depend on them). One divergence = phantom/missing conversations per page.
13. **PairDialog "Annuler et supprimer" is destructive** — cancel during QR deletes the instance via `instance-delete` (full wipe path).
14. **Instance delete wipes R2** — the modal's preflight/`instance-delete` reach Cloudflare R2; merged deployment must scope R2 tokens accordingly (iGrowFast keeps scoped tokens in Keychain).
15. **`PROTECTION_PRESETS` numbers are duplicated client/server** — must match a CASE inside `public.set_instance_settings`; changing one side silently desyncs the pacing UI from real behavior.
16. **No tenant/business dimension anywhere**: presence channel, profiles, contacts, instances, stats and dashboard RPCs are single-org. Multi-business iGrowFast integration needs a scoping layer added to essentially every RPC listed above.
17. **Country-code fallback '212'** hardcoded in import normalization (fine for Morocco-only, but a silent data-mangler otherwise).
18. **Dev-mode is cosmetic**: Monitor/Log hiding is a localStorage flag; security relies wholly on the admin gates inside the RPCs.
19. **Users hard-delete + invitation revoke use `window.confirm`** (inconsistent with the branded confirm patterns; delete is irreversible via `admin-delete-user`).
20. **Assignment.css is a shared dependency**: `.aamodal-*`, `.instance-modal*`, `.impmodal*` chrome consumed by Contacts, NumberDetail, ImportContactsModal, PendingContactsModal, DeleteInstanceModal — porting pages piecemeal will break modal styling.
21. **Statistics heatmap timezone** is baked server-side ("fuseau Casablanca" is only a UI hint) — verify `stats_heatmap` TZ handling when porting.
22. Branding artifacts to replace: `/Logo Light.png`, "WhatsApp Mancer" wordmark, `wam.*` localStorage keys.
