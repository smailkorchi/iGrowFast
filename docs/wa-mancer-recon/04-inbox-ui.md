# WA Mancer Recon 04 — Inbox / Conversations UI (the crown jewel)

Recon date: 2026-07-05. Source: `/Users/ismailelqorchi/Desktop/WhatsApp Mancer` (read-only).
Scope: the conversations inbox UI that will be ported nearly verbatim into iGrowFast.

---

## 1. File inventory (in scope)

| File | Lines | Role |
|---|---|---|
| `src/routes/admin/Conversations.tsx` | 616 | Admin orchestrator page (`/admin/conversations`) |
| `src/routes/user/Whatsapp.tsx` | 568 | End-user (agent) orchestrator page (`/user/whatsapp`) — near-clone of admin with restrictions |
| `src/routes/user/UserLayout.tsx` | 55 | User shell: nav + per-instance channel avatars + notifications |
| `src/routes/admin/conversations/parts.tsx` | 10,459 | ALL presentational building blocks (35+ components) |
| `src/routes/admin/conversations/conversations.css` | 9,041 | Entire inbox stylesheet, scoped under `.wac` |
| `src/routes/admin/conversations/icons.tsx` | 728 | 74 hand-drawn SVG icon components (`IconNewChat` … `IconEyeOff`) |
| `src/routes/admin/conversations/emoji-data.ts` | 7 (66 KB) | AUTO-GENERATED (`scripts/gen-emoji.mjs`, from `unicode-emoji-json`): `EMOJI_DATA` (1,914 emojis / 8 categories) + `EMOJI_KEYWORDS` search index |
| `src/routes/admin/conversations/QuickRepliesPanel.tsx` | 228 | Quick-replies sidebar panel (list/create/edit) |
| `src/routes/admin/conversations/ScheduledMessagesPanel.tsx` | 642 | Scheduled-messages panel + custom calendar/time picker |
| `src/routes/admin/conversations/TagsPanel.tsx` | 470 | Tags panel + custom HSL color picker + recent-colors RPC |
| `src/routes/admin/conversations/TagPicker.tsx` | 87 | Chat-header tag assign/unassign popover |
| `src/routes/admin/conversations/NodeSequenceBuilder.tsx` | 563 | `FlowEditor` serpentine drag-drop sequence canvas + `QuickReplyConfirm` modal (framer-motion) |
| `src/routes/admin/conversations/CreatorBadge.tsx` | 61 | "Created by X" badge (admin-only, avatar + name + Admin chip) |
| `src/routes/admin/conversations/UnassignScheduledModal.tsx` | 68 | Warning modal on unassigning a user with pending scheduled msgs (inline-styled, works outside `.wac`) |
| `src/components/conversations/TypingIndicator.tsx` | 161 | Bouncing-dots / pulsing-mic typing bubble (bubble + inline modes) |
| `src/styles/theme.ts` | 17 | Anthropic-flavored dashboard theme object (ink/canvas, Poppins/Lora). **Imported by NOTHING in src — dead/reference file** |
| `docs/whatsapp-web-tokens.css` | 239 | WhatsApp Web design-token reference (light+dark `--bg-*`/`--bubble-*` vars). **docs-only, NOT imported by the app** |

---

## 2. Architecture

- **Orchestrator/presentational split.** `Conversations.tsx` (admin) and `Whatsapp.tsx` (user) hold ALL page state and data hooks; `parts.tsx` components are pure props-in/handlers-out. The user page imports the admin `parts.tsx`, `conversations.css`, panels — header comment says "DO NOT fork it. User-side restrictions belong in THIS file (the wrapper)".
- **Layout:** one `.wac` container = 3 panes: `ChatList` sidebar ← `ChatPane` ← right pane (`InfoPane` OR `SearchInChatPane`, mutually exclusive, toggled `is-with-info`). Sidebar can be *replaced* by takeover views (`view` state): `new-chat`, `quick-replies`, `tags` / `tags-create`, `scheduled`.
- Both pages call `useSidebarCollapse()` (from `components/AppLayout` SidebarContext) on mount and set `document.documentElement.dataset.route = 'conversations'` (CSS `:root[data-route="conversations"] .layout__main` strips dashboard padding).
- **Connection gate:** when the active instance isn't `connected` (or no instances exist) the entire surface is replaced by `ConnectionGate` (full-screen; admin gets "Gérer les numéros" → `/admin/numbers`; user gets switch-only).

### Admin vs user deltas
| Concern | Admin | User |
|---|---|---|
| Instance selection | local state + `localStorage['wam.cv.active_instance']`, `useInstances()` + `useInstancesUnread` + `useInstancesUnreadRealtime` | `useActiveInstance()` context from `lib/userInbox/activeInstance.tsx` (shared with navbar channel avatars in `UserLayout`) |
| Deep link `?jid=` | opens or **creates** conversation via `ensureConversation` | RLS-scoped; supports `&instance=` switch first; `@lid` resolution via direct `contacts` select; otherwise toast "Cette conversation ne vous est pas assignée." (ensure_conversation is admin-only) |
| `onNavigateToJid` (vCard "Message" button) | creates missing conversation | toast error if not assigned |
| InfoPane | `onAfterDelete` wired, `isAdmin` default true | `isAdmin={false}` (hides assignments + clear/delete; keeps leave-group) |
| `onOpenConversation` after forward | jumps to recipient chat | not passed |
| favorites localStorage | `wam.cv.favs.{instanceId}` | `wam.cv.user.favs.{instanceId}` |

---

## 3. Full component tree

```
AdminConversations / UserWhatsapp (orchestrators)
├── ConnectionGate  (full-screen takeover)
│   ├── GateInstanceAvatar
│   └── GateSwitchPill (primary pill + chevron dropdown of other connected numbers)
├── ChatList (sidebar)
│   ├── header: instance identity + InstanceSwitcherMenu (popover; per-instance unread badge, other-unread badge, status dot)
│   ├── search pill
│   ├── FilterChipRow → Chip / FilterDropdown → DropdownItem  (Toutes/Non lues/Favoris/Groupes/tags + "Gérer les étiquettes")
│   ├── ChatRow ×N  (avatar, name, tag icons, time, preview w/ tick + kind icon + typing override, pinned/snoozed/archived glyphs, unread badge)
│   ├── ConversationContextMenu  (right-click: pin/unpin, clear, leave group, delete — clear/leave/delete admin-only)
│   └── ConversationDangerModal
├── Sidebar takeovers (mutually exclusive with ChatList):
│   ├── NewChatView
│   │   ├── DialPadView  (12-key dial pad, +, backspace, JID resolution, ensureConversation)
│   │   ├── NewContactView  (name+phone; debounced checkWhatsApp existence probe; contacts upsert)
│   │   └── NewGroupView  (2 steps: member picker w/ alphabetical grouping → subject+photo; createGroup edge fn)
│   ├── QuickRepliesPanel → QrListItem (+CreatorBadge) → QrForm → FlowEditor
│   ├── TagsPanel → TagListItem → TagForm → HslColorPicker (custom HSL gradient+hue picker, recent colors via RPC)
│   ├── ScheduledMessagesPanel → SmListItem (+CreatorBadge) → SmForm → FlowEditor + DateTimePicker → CalendarPopover / TimePopover
│   └── (legacy, still exported: CreateListView → AddPeoplePicker — pre-tags "lists", unused by orchestrators)
├── ChatPane
│   ├── header: identity (opens InfoPane), status line (typing/recording, snoozed, group, phone), actions: Search / TagPicker (anchor) / Favorite heart
│   ├── PinnedBar  (queries pinned messages directly; cycles pins; go-to / détacher menu)
│   ├── hidden file inputs ×5 (photos+videos, documents, audio file, audio-as-voice-note, add-more)
│   ├── MediaStagingOverlay (pre-send preview takeover)
│   │   ├── StagedThumb → StagedDocThumb
│   │   ├── StagingVoicePreview (real voice-bubble replica for staged recordings)
│   │   └── StagedDocPreview → PdfFirstPage (pdfjs-dist) / DocxPreview (docx-preview) / OfficeThumbPreview (jszip docProps/thumbnail) / CsvPreview / TextPreview / DocIconCard
│   ├── "unknown contact" banner (+ add-to-contacts modal; dismissed flag in localStorage)
│   ├── message stream (`.wac__stream`)
│   │   ├── day dividers (useDayBuckets)
│   │   ├── groupMediaAlbums(): runs of ≥4 caption-less same-sender media → AlbumBubble (AlbumCell ×3 + AlbumOverflowCell "+N")
│   │   ├── Bubble  (per message; see §7)
│   │   │   ├── quoted-reply block (quotedMap batch fetch) + QuoteLocationThumb / QuoteContactThumb
│   │   │   ├── TemplateBubbleBody / WaitingForMessageBody / MediaBody→GifBody / VoiceBody / DocumentBody(+DocThumb,FileTypeIcon) / StickerBody / LocationBody / ContactCardBody
│   │   │   ├── BubbleLinkPreview (IntersectionObserver-gated og-fetch) + BubbleTextBody (mentions, links, emoji runs, "Voir plus" read-more) + splitEmojiRuns
│   │   │   ├── ReactionPills (aggregated reactions on target message)
│   │   │   ├── hover triggers: context chevron, reaction smiley (wac__bubble-react-trigger), quick-forward arrow
│   │   │   └── IconBubbleFailed (red ! for failed/blocked outbound)
│   │   ├── group intro card (`meta.event === 'create'`) / system pill (group_event)
│   │   └── TypingIndicator (peer composing/recording bubble, group-gutter aligned)
│   ├── scroll-down FAB
│   ├── MessageContextMenu (quick reactions row + Répondre/Copier/Réagir/Transférer/Star/Pin/Modifier/Supprimer) → ReactionEmojiGrid (full picker w/ categories + keyword search + recents)
│   ├── PinDurationModal (24h / 7j / 30j / Toujours)
│   ├── EditMessageModal (15-min window; live bubble preview; emoji pop)
│   ├── DeleteMessageModal (pour moi / pour tout le monde ≤60h single outbound)
│   ├── ForwardPicker (modal; conversations + phone-book contacts; ensureConversation for contact-only targets)
│   ├── BubbleStateModal (failed / blocked-window / blocked-paused / blocked-cap; Renvoyer / Envoyer maintenant / Forcer / Supprimer)
│   ├── ContactPickerModal (share 1..N contacts as vCard(s) via buildContactShare)
│   ├── forward-bar / delete-bar (multi-select bottom bars, mutually exclusive select modes)
│   ├── left-group notice (left_at ⇒ composer replaced by notice)
│   └── Composer
│       ├── agent-typing strip (other agents' avatars + "est en train d'écrire…")
│       ├── ComposerCapacityBanner (paused / hourly cap / daily cap / outside business hours + live countdown)
│       ├── reply preview bar (w/ location & contact thumbs)
│       ├── composer link preview (useComposerLinkPreview, dismissible)
│       ├── "/" slash picker (quick replies; arrows/Enter/Tab/Esc)
│       ├── "#" hash picker (read-only scheduled-message list; edit/delete row actions)
│       ├── "@" mention picker (groups; "@tous" mention-all + members from group_participants)
│       ├── attach "+" popup: Document / Photos-vidéos / Fichier audio / Message vocal / Contact / Réponses / Programmer / Étiquettes (AttachItem)
│       ├── EmojiGifPicker (emoji tab: 8 categories + recents localStorage + search; GIF tab: GifTab → GIPHY trending/search)
│       ├── auto-growing textarea (max 200px)
│       ├── mic/send morph button
│       └── VoiceRecorder (MediaRecorder + AudioContext analyser live waveform, pause/review/resume, resampled 64-bar waveform, ogg/webm opus)
├── InfoPane (right)
│   ├── subviews: main / media-gallery / starred / members / assignees
│   ├── hero (avatar w/ group-icon edit, name w/ group rename inline edit, member count, phone)
│   ├── Médias-liens-docs row + MldPreviewThumb strip → MediaGalleryTab→MediaGalleryThumb / DocsGalleryTab (reuses DocumentBody) / LinksGalleryTab→LinkGalleryItem
│   ├── group members: groupMemberRow, member action menu (promote/demote/remove; fixed-position overlay), removeConfirmModal, AddMemberDialog
│   ├── pin/unpin row, Messages importants (starred list w/ unstar), Chiffrement row
│   ├── Assignments section (admin-only): assigned list, AssignUserPicker (single DM / multi group + select-all), UnassignScheduledModal
│   └── danger zone: Effacer / Quitter le groupe / Supprimer → DangerConfirmModal
├── SearchInChatPane (right; debounced server-side ilike over messages_decrypted, highlightTerm, scrollToMessage)
├── MediaViewer (full-screen lightbox: header actions Reply/Star/Forward/Download/Close; ←/→ keyboard nav; video controls play/seek/speed/mute; MediaViewerThumb filmstrip; ForwardPicker embed)
└── QuickReplyConfirm (sequence-send confirm w/ ordered node track)
```

---

## 4. State inventory

### Orchestrator local state (both pages)
`pickedInstanceId` (admin only), `favorites: Set<string>`, `filter: Filter`, `query`, `view` (`list|new-chat|quick-replies|tags|tags-create|scheduled`), `scheduledEditId`, `activeId`, `rightPane` (`none|info|search`), `composer: ComposerState {text, replyTo, mentionedJids?, mentionAll?}`, `pendingQr`, `viewerMsg`. Refs: `deepLinkHandled`, `markedReadRef`, `newestSeenRef`, `readDebounceRef`.

### ChatPane local state
`bubbleModal`, `showFab`, `tagPickerOpen`, `msgMenuState`, `forwardMode/forwardSelected/forwardPickerOpen/forwardSending`, `deleteMode/deleteSelected/deleteModalOpen`, `editTarget`, `pinTarget`, `contactPickerOpen`, `staged: StagedItem[]` + `activeStageId`, `dragActive` (+dragDepthRef), `bannerDismissed`, `addContactOpen/contactName/contactSaving`. Scroll refs: `streamRef`, `needsInitialScroll`, `prevScrollSnap`, `prevMsgCount`, `lastIdRef`, `peerWasTypingRef`.

### Composer local state
`attachOpen`, `pickerOpen`, `pickerTab`, `mentionQuery/mentionStart/mentionIdx`, `slashQuery/slashStart/slashIdx`, `hashQuery`, `isRecording`. Typing refs: `typingTimerRef`, `typingActiveRef`, `typingConvRef` (TYPING_REFIRE_MS = 4000).

### React-Query keys used by the inbox surface
`['conversations','list',…]` (infinite), `['conversations', id]`, `['messages','thread',convId]` (infinite), `['instances']`, `['instances-unread', ids]`, `['contacts-map', instanceId]`, `['owner-lid', instanceId, jid]`, `['chat-group-participants', …]`, `['group-participants', …]` (composer), `['info-group-participants', …]`, `['info-contacts', instanceId]`, `['quoted-messages', …ids]`, `['pinnedBar', convId]`, `['info-media', convId]`, `['info-links', convId]`, `['info-starred', convId]`, `['conv-search', convId, q]`, `['contact-pic', instanceId, jid]`, `['recent_tag_colors', instanceId]`, `['all-contacts', instanceId]`, plus lib-layer keys (tags, conversation_tags, quick replies, scheduled, assignments, profiles, capacity).

### localStorage keys
`wam.cv.active_instance`, `wam.cv.favs.{instanceId}`, `wam.cv.user.favs.{instanceId}`, `wam.contact-banner-dismissed.{convId}`, `wam.emoji.recent`, `sb-{projectRef}-auth-token` (read synchronously by `instancesApi.readJwtSync` to bypass navigator.locks hang).

**Favorites are per-browser localStorage, NOT DB** (comment: old filter "lists" were migrated to DB tags; favorites were not).

---

## 5. Realtime subscriptions (channel → events)

| Hook (lib) | Channel | Events |
|---|---|---|
| `useConversationsRealtime` (queries/conversations) | `conv-page-{instanceId}` | 4× postgres_changes on `conversations` (+related) |
| `useInstancesUnreadRealtime` | `instances-unread-rt` | postgres_changes `*` on `conversations` (all instances) → bump unread map |
| `useThreadRealtime` (queries/messages) | `thread-{conversationId}` | postgres_changes INSERT/UPDATE on `messages` → refetch row from `messages_decrypted`; +1 more listener |
| `useWaPeerPresence` / `useInboxAttendance` (queries/waPresence) | `wa-typing:{instanceId}` (broadcast, self:false) | `broadcast` event `presence` (peer composing/recording, TTL 8s, ref-counted single store per instance; also `sendOpen`/`sendAttend`/`sendLeave` broadcasts — attendance heartbeat keeps the number ONLINE while tab visible, ban-safe offline on hide) |
| `useAgentTyping` (lib/presence) | `presence:conv:{conversationId}` | broadcast agent-typing ping/stop (~2s TTL) — agent-to-agent collision avoidance |
| `useTagsRealtime` | `tags-{instanceId}-{n}` | postgres_changes on `tags` |
| `useConversationTagsRealtime` | `conv-tags-{instanceId}-{n}` | postgres_changes on `conversation_tags` |
| `useQuickRepliesRealtime` | `qr-{instanceId}` | postgres_changes on `quick_replies` |
| `useScheduledMessagesRealtime` | `sm-{conversationId}` | postgres_changes on `scheduled_messages` |
| `useConversationAssigneesRealtime` | `conv-assignees-{conversationId}` | postgres_changes on `conversation_assignments` |

An open conversation therefore holds ~8 concurrent realtime channels.

## 6. RPC / edge-function / API surface invoked from the inbox

### Postgres RPCs (via `supabase.rpc`)
`send_message` (with `p_idempotency_key`, `p_origin`, `p_ptt`, `p_poll_options`, `p_forward_from`), `send_reaction`, `send_typing` (composing|recording|paused), `send_read_receipt`, `mark_conversation_read`, `toggle_pin`, `toggle_archive`, `toggle_star`, `set_message_pin` (with expiry), `forward_message`, `cancel_outbound_message`, `edit_message` (typed error codes: `edit_window_expired`, `can_only_edit_text_kind`, `can_only_edit_outbound`, `already_revoked`, `message_not_yet_dispatched`, `text_required`), `delete_message` (scope me|everyone), `force_dispatch_now`, `ensure_conversation`, `assign_conversation`, `claim_conversation`, `unassign_conversation`, `update_conversation_status`, `search_conversations`, `get_recent_tag_colors`, `update_recent_tag_colors`, `instance_stats`.

### Edge functions (`supabase.functions.invoke`)
`media-upload` (presign R2 PUT; then direct `fetch PUT` to R2 presigned URL), `media-sign` (presigned GET, auto-refresh 30s pre-expiry, 5s retry on pending), `og-fetch` (link preview), `conversation-cleanup` (mode clear|delete).

### Edge functions via raw `fetch` (`{VITE_SUPABASE_URL}/functions/v1{path}`, JWT read sync from localStorage — `instancesApi.call`)
`/check-whatsapp`, `/group-create`, `/group-leave`, `/group-update-participants` (add/remove/promote/demote), `/group-update-subject`, `/group-update-picture` (plus instance lifecycle fns not used by inbox).

### Direct table/view access (RLS-dependent)
Reads: `conversations_decrypted`, `messages_decrypted` (thread, pinned bar, quoted batch, info media/links/starred, conv search ilike), `contacts`, `group_participants`, `conversation_assignments`, `tags`, `conversation_tags`, `quick_replies`, `scheduled_messages`, `profiles` (via useProfiles). Writes: `contacts` upsert (NewContactView, saveContact), `tags`/`conversation_tags`/`quick_replies`/`scheduled_messages` insert/update/delete, `conversation_notes` (API exists in conversationsApi but **no notes UI inside the inbox**).

### Third-party network calls (client-side)
- **GIPHY**: `api.giphy.com/v1/gifs/trending|search` with `VITE_GIPHY_API_KEY` env var (masked). Missing key ⇒ graceful in-picker notice.
- **CARTO basemap**: maplibre style `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json` for location bubbles/quote thumbs.
- **Google Maps** link-out `https://www.google.com/maps?q=lat,lng`.
- `fetch(it.remoteUrl)` of GIPHY mp4 bytes before upload; `fetch(resolved.url)` for downloads and doc-thumbnail rendering.

---

## 7. Message rendering per kind

Source of truth: `msg.kind` + `media_meta` (subtype/flags). `normalizeDeliveryStatus` → pending|sent|delivered|read|failed → tick icons (IconClock/IconCheckSingle/IconCheckDouble/`is-read` blue).

- **text** — `BubbleTextBody`: mention resolution (`mentionedJid` list or `@digits` heuristic vs contactMap, LID+phone keyed), URL linkification (`findAllUrls`), inline emoji enlargement (`splitEmojiRuns`, Intl.Segmenter), "Voir plus" read-more (700 code-point cap, doubles each click). `BubbleLinkPreview` above (media_meta preview or lazy IntersectionObserver `og-fetch`).
- **jumbo emoji** — single-grapheme Extended_Pictographic body, no quote/forward → bubble-less large emoji (`isSingleEmoji`).
- **image / video** — `MediaBody`: 4/3 media box, `useResolvedMediaUrl`, video play badge + duration (meta.seconds → duration_ms → loadedmetadata fallback), caption below, overlay meta; click → MediaViewer. `MediaPlaceholder` pending (spinner "Téléchargement…") / expired ("Média indisponible" — Evolution drops media ~14d).
- **GIF** — video + `media_meta.isGif|gifPlayback|gif` → `GifBody`: autoplays 2 loops, freezes with GIF badge + GIPHY watermark, replays on row hover. Never albumed.
- **album** — ≥4 consecutive caption-less same-sender image/video → `AlbumBubble` 2×2 grid with `+N` overflow cell; select-mode toggles whole album; hidden `data-msg-id` spans for scroll-to.
- **audio** — `VoiceBody`: `ptt===false || (!ptt && fileName)` ⇒ audio FILE (orange headset circle) else voice note (sender avatar + mic badge). 48-bar waveform from `media_meta.waveform` or deterministic seeded pseudo-waveform; green (unplayed inbound) / blue playhead dot; speed cycle 1×/1.5×/2× while playing; total-vs-elapsed time WhatsApp behavior.
- **document** — `DocThumb` (tries `{signedUrl}.preview.jpg` in R2; on miss renders client-side via `generateDocThumbnail` and uploads via `uploadDocPreview` so other agents cache-hit; session-level `noDocPreview` set) + `DocumentBody` card (`FileTypeIcon` folded-page glyph w/ brand colors, name, pages/ext/Ko, download anchor).
- **sticker** — `StickerBody` transparent bubble.
- **location** — `LocationBody`: non-interactive maplibre map + pin (lazy import), `live_location` subtype gets "Localisation en direct indisponible" bar, name/address footer, whole card links to Google Maps.
- **contact / contact_list** — `ContactCardBody`: parses vcard TEL/FN, avatar via `useContactPic` (contacts → conversations fallback), "+N contacts", "Message" button → `onNavigateToJid`.
- **template (subtype=template)** — `TemplateBubbleBody`: header image (R2 or base64 `thumbnail`; Evolution can't serve template header media), footer above body, button rows (URL sanitized via `safeHttpUrl` — blocks `javascript:` etc.; `tel:`).
- **system** — `subtype=group_event` → centered pill; `event=create` → group intro card (avatar, title, "N membres · Créé …"); `subtype=waiting_for_message` → `WaitingForMessageBody` (undecryptable msg pill); other body-less system → `null`.
- **reaction** — filtered out of the stream (`kind==='reaction'` renders nothing); aggregated on targets via `msg.reactions` → `ReactionPills` (emoji+count+total).
- **revoked** (`revoked_at`) — tombstone "Vous avez supprimé / Ce message a été supprimé" + **hover eye toggle that reveals the original body** (kept in DB), session-local.
- **failed/blocked outbound** — `deriveBubbleBlockedState`: failed | pending<60s | blocked-paused (worker_paused) | blocked-cap (hourly/daily ≥100%) | blocked-window (client-side business-hours mirror of `worker/src/dispatcher/loop.ts withinDispatchWindow`, incl. quiet-hours override) → red `IconBubbleFailed` button → `BubbleStateModal`.
- **forwarded** — `msg.forwarded === true` (column, dashboard forwards) OR `media_meta.forwarded` (inbound contextInfo) → "Transféré" tag.
- Streak grouping: `isSameSender` (sender_jid, pushName fallback) drives `is-streak-head/tail` margins, group avatar/spacer gutter, sender name + `senderColorVar` (8-color deterministic hash palette).

## 8. Composer features (complete list)

Text autosize; Enter=send/Shift+Enter=newline; attach popup (8 items incl. panel launchers); photo/video/doc/audio/voice-file hidden inputs; **drag & drop files onto chat** (`wac__dropzone` overlay, depth-counted); **media staging overlay** (multi-file, per-item captions except audio, reorder-by-strip, add-more, remove, PDF page count, doc/CSV/text/office previews, client-side `mediaSizeError` pre-check ~16MB, sends sequentially through paced dispatcher — "no album, no blasting"); GIF staging (GIPHY gif preview → mp4 upload, `isGif` meta); voice recorder (live waveform, pause→review playback→resume, sends ptt+seconds+duration_ms+waveform); emoji picker (recents in localStorage, keyword search); "/" quick replies (mid-text token trigger; single-text inlines, multi-node → confirm + `sendStepSequence` with canned-origin humanization); "#" scheduled messages (read-only list, edit/delete); "@" mentions incl. `@tous` (mentionAll → `media_meta.mentionAll`); reply preview bar; link preview w/ dismiss; contact sharing (multi-select vCards, `contactsArrayMessage` as one paced send); outbound typing signal loop (`send_typing` re-fired every 4s, explicit `paused` on stop; recording presence while recorder open); agent-to-agent typing display; capacity banner. **No draft persistence per conversation** — composer resets on conversation switch (a `lib/drafts.ts` exists but is not wired into this composer).

## 9. Scrolling — NO virtualization

The stream renders **all loaded messages** into `.wac__stream` (plain overflow div). Pagination via `useThreadMessages` infinite query: scrollTop<240 → fetch older page. Scroll preservation: snapshot scrollHeight before fetch, `useLayoutEffect` adds delta after prepend. Initial scroll-to-bottom via `useLayoutEffect` (pre-paint). Auto-scroll on new tail message and on peer-typing start only if within 200/240px of bottom. FAB shown when >200px from bottom. ChatList likewise unvirtualized with its own infinite scroll (240px threshold). **Porting into iGrowFast keeps this fine at current scale but it's not windowed.**

## 10. Presence / typing (three separate systems)

1. **Peer→us** (customer typing): worker broadcasts on `wa-typing:{instanceId}`; `useWaPeerPresence` ref-counted single store; shows "écrit…/enregistrement d'un audio…" in list rows, chat header, and a `TypingIndicator` bubble; 8s TTL sweep. `useInboxAttendance` heartbeats attendance (visible tab) so the number stays ONLINE and receives presence events; leaves on hide (ban-safe).
2. **Us→peer** (agent typing to customer): `send_typing` RPC loop (4s refire against Evolution's 5s composing window), explicit `paused`, recording presence during voice recording. Driven by watching `composer.text`, not onChange (catches send-clear).
3. **Agent↔agent**: `useAgentTyping` broadcast on `presence:conv:{id}` with profile payload → avatar strip "X est en train d'écrire…" above composer (collision avoidance in shared inbox).

## 11. Read receipts / unread

On open: `useMarkConversationRead()` (optimistic cache clear) + `sendReadReceipt` RPC (blue ticks to customer), guarded per-conversation. While open: newest inbound change → 1200ms debounce → mark read + receipt again (bypasses business-hours/cap gates server-side, still queued per-number). Ticks: per-bubble from `delivery_status`; list preview tick from `conversations.last_outbound_status` (trigger-maintained). Unread badges: per-conversation `unread_count`, per-instance map + "other numbers" rollup badge in the header switcher.

## 12. Search

- Sidebar: client-side filter over loaded rows (name / jid / preview), tag-aware placeholder.
- In-chat: `SearchInChatPane` — 200ms debounce → server ilike on `messages_decrypted.body` (escaped `%_`), limit 200, newest first, `highlightTerm` + `scrollToMessage` (data-msg-id, smooth center, 1.5s `wac__bubble-highlight`).
- Also exists in lib but unused here: `search_conversations` RPC (`useConversationSearch`).

## 13. Tags / favorites / filters

Tags are DB-level, per-instance, shared, realtime (`tags`, `conversation_tags`), power the chat-list filter chips (dropdown lists all tags w/ colored dots + "Gérer les étiquettes"), row tag icons (≤3), chat-header TagPicker, info-pane hero icons. TagsPanel: create/edit/delete (RLS: admin or creator), 17 preset colors + custom HSL picker + per-instance recent colors via `get_recent_tag_colors`/`update_recent_tag_colors` RPCs, duplicate-name error mapping (`idx_tags_instance_name`). Favorites: localStorage only. Filter model `Filter = toutes|unread|favoris|groups|tag{tagId}`; `unread`/`groups` filter server-side, `favoris`/`tag` client-side. Deleted active tag ⇒ auto-revert to Toutes.

## 14. Assignment surfaces inside the inbox

InfoPane (admin only): assigned-users section (DM=1 owner max, group=many), `AssignUserPicker` (single-pick or multi w/ select-all; excludes admins + already-assigned; batch merge in one `set_conversation_assignees`-style RPC call), unassign w/ pending-scheduled-message check → `UnassignScheduledModal` (keep = still fires via cron / drop = delete). `assignees` subview for >4 group assignees. Hooks: `useConversationAssignees(+Realtime)`, `useSetConversationAssignees`, `useUnassignConversationUser`, `useProfiles`. Agents see none of this (`isAdmin={false}`), only leave-group.

## 15. CSS / theming

- `conversations.css` — 9,041 lines, **everything scoped under `.wac`**; `:root[data-route="conversations"]` hook adjusts dashboard shell. Token block on `.wac`: `--wa-bg-*` (near-black #0A0A0A custom dark theme — NOT WhatsApp's #111B21), `--wa-bubble-out: #264C39` (+`@supports` Display-P3 restatement), `--wa-bubble-in: #1F1F1F`, text/border/green(`#00A884`)/blue-tick/danger tokens, radii (`--wa-r-bubble: 7.5px`), 8 `--wa-sender-*` colors. Sections: SIDEBAR / CREATE-LIST / NEW-CHAT / NEW CONTACT / NEW GROUP / DIAL-PAD / CHAT PANE / LINK PREVIEW / COMPOSER / EMOJI-GIF PICKER / EMPTY STATE / INFO PANE / SEARCH-IN-CONVERSATION / MEDIA VIEWER / QUICK REPLIES / SLASH PICKER / QR ATTACHMENT PILLS / SCHEDULED MESSAGES / HASH PICKER / INFO-PANE ASSIGNMENTS. Exactly ONE media query (`max-width:1400px` stream padding) — **desktop-only, no mobile layout**. 14 keyframes (spin, msgHighlight, skeleton, rec-pulse, pop, mv-in, ctx-in, nb-spin, flow-in/dash/pulse…). Scrollbar styling scoped to `.wac *`.
- `docs/whatsapp-web-tokens.css` — reference-only WA Web light+dark token sheet (`--bg-body`, `--bubble-out #DCF8C6/#005C4B`, sender palette, attach swatches). Not linked anywhere.
- `src/styles/theme.ts` — dashboard palette object (ink #141413, canvas #faf9f5, accents; Poppins/Lora). **Zero importers** — values are duplicated as CSS vars elsewhere (`--color-accent-natural` referenced inline in parts.tsx InstanceSwitcherMenu status dot; `--font-body` in ComposerCapacityBanner).
- Components with heavy inline styles (bypass .wac tokens intentionally): `InstanceSwitcherMenu`, `UnassignScheduledModal`, `CreatorBadge`, `TypingIndicator`, `BubbleStateModal` close-button hover JS.

## 16. Complete import surface (dependency map for the port)

### From `parts.tsx`
- react: `useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,ReactNode`
- `../../../lib/database.types` → `ConversationDecrypted`, `MessageDecrypted`, `AvatarConfig` (generated Supabase types incl. `_decrypted` view rows)
- `../../../lib/jid` → `conversationLabel, formatPhone, formatUnread, parseJid`
- `../../../lib/relativeTime` → `formatBubbleTime, formatDayDivider, formatListTime`
- `../../../lib/messageStatus` → `normalizeDeliveryStatus`
- `../../../lib/ogPreview` → `fetchOgPreview, findAllUrls, previewFromMediaMeta, useComposerLinkPreview, OgPreview`
- `../../../lib/queries/media` → `useResolvedMediaUrl`
- `../../../lib/docThumbnail` → `isThumbnailable` (+lazy `generateDocThumbnail`)
- `../../../lib/queries/contacts` → `useContacts, Contact, useUpsertContact`
- `../../../lib/vCardBuilder` → `buildContactCard, buildContactShare, ContactCardData`
- `../../../lib/queries/waPresence` → `useWaPeerPresence`
- `../../../components/conversations/TypingIndicator`
- `../../../lib/supabase` → `supabase` client
- `@tanstack/react-query` → `useQuery, useQueryClient`
- `maplibre-gl` (type + lazy import) + `maplibre-gl/dist/maplibre-gl.css`
- `./icons` → 63 named icons
- `../../../lib/conversationsApi` → `sendReaction, toggleStar, setMessagePin, forwardMessage, sendMessage, cancelOutboundMessage, forceDispatchNow, sendTyping, uploadChatMedia, editMessage, deleteMessageForMe, deleteMessageForEveryone, togglePin` (+lazy `uploadDocPreview`)
- `../../../lib/toast/store` → `toast, normalizeError, mediaSizeError`
- `./emoji-data` → `EMOJI_DATA, EMOJI_KEYWORDS`
- `../../../lib/queries/quickReplies` → `stepsSummary, useQuickReplies, QuickReply`
- `../../../lib/queries/scheduledMessages` → `useScheduledMessages, useDeleteScheduledMessage, ScheduledMessage`
- `./UnassignScheduledModal`
- `../../../lib/queries/instances` → `useInstanceCapacityStatus` (+type `InstanceCapacityStatus` via import())
- `../../../lib/auth` → `useAuth`
- `../../../lib/presence` → `useAgentTyping`
- `../../../lib/queries/tags` → type `Tag`
- `../../../lib/queries/conversations` → `useClearConversation, useDeleteConversation`
- `../../../lib/queries/assignments` → `useConversationAssignees, useConversationAssigneesRealtime, useSetConversationAssignees, useUnassignConversationUser`
- `../../../lib/queries/users` → `useProfiles`
- `../../../components/Avatar/Avatar` (react-nice-avatar wrapper) as `UserAvatar`
- `./TagPicker`
- `../../../lib/instancesApi` → `checkWhatsApp, createGroup, leaveGroup, updateGroupParticipants, updateGroupSubject, updateGroupPicture`
- lazy: `../../../lib/conversationCreate` (`ensureConversation`), `pdfjs-dist` (+worker url), `docx-preview`, `jszip`
- env: `import.meta.env.VITE_GIPHY_API_KEY`

### From orchestrators (additional)
`react-router-dom` (`useSearchParams, useNavigate`), `components/AppLayout` (`useSidebarCollapse`), `lib/queries/conversations` (`useFlattenedConversations, useConversation, useConversationsRealtime, useInstancesUnread, useInstancesUnreadRealtime, useMarkConversationRead, ConversationFilter`), `lib/queries/messages` (`useFlattenedThread, useThreadMessages, useThreadRealtime`), `lib/queries/instances` (`useInstances` admin) / `lib/userInbox/activeInstance` (`useActiveInstance` user), `lib/queries/waPresence` (`useInboxAttendance`), `lib/conversationsApi` (`sendMessage, sendReadReceipt, sendStepSequence`), `lib/queries/tags` (5 hooks), panels, `NodeSequenceBuilder` (`QuickReplyConfirm`), `conversations.css`.

### Panels / builder (additional)
`framer-motion` (`motion`, FlowNode drag), `lib/queries/quickReplies` (`useQuickRepliesRealtime, useCreateQuickReply, useUpdateQuickReply, useDeleteQuickReply, uploadQuickReplyMedia, decodeAudioDurationSeconds, MessageStep, MediaStep, MediaStepType, StepType`), `lib/queries/scheduledMessages` (create/update/delete/upload), `lib/queries/tags` (create/update/delete/assign/unassign), `CreatorBadge`.

### UserLayout (additional)
`components/AppLayout` (default + `NavItem, ChannelNavItem`), `components/NavIcons` (`IconDashboard`), `lib/notifications/realtime` (`useUserInboxRealtime`), `lib/notifications/NotificationStack`, `lib/notifications/PermissionBanner`, `lib/userInbox/activeInstance` (`ActiveInstanceProvider`).

### npm packages the inbox touches
`react`, `react-dom`, `react-router-dom@7`, `@tanstack/react-query@5`, `@supabase/supabase-js@2`, `maplibre-gl@5`, `framer-motion@12`, `pdfjs-dist@5` (lazy), `docx-preview` (lazy), `jszip` (lazy), `react-nice-avatar` (via Avatar). Browser APIs: MediaRecorder, AudioContext/AnalyserNode, Intl.Segmenter, IntersectionObserver, ResizeObserver, crypto.randomUUID, navigator.clipboard, navigator.mediaDevices.getUserMedia.

---

## 17. Surprises / merge hazards

1. **Everything is French-hardcoded** — every label/aria/toast/date locale (`fr-FR`). No i18n layer.
2. **`parts.tsx` is a 10.5k-line monolith** with 35+ components; the user page imports it from the *admin* path. Port must keep it one unit or split carefully — internal helpers (`scrollToMessage`, `senderColorVar`, `isSameSender`, `groupMediaAlbums`) are shared by many components.
3. **Not WhatsApp's dark theme** — a custom near-black (#0A0A0A / #1F1F1F / #264C39) refresh palette with a Display-P3 `@supports` restatement. `docs/whatsapp-web-tokens.css` (real WA palette + light theme) is dormant reference only. Desktop-only: a single 1400px media query; no responsive/mobile.
4. **Global CSS leak risk into iGrowFast:** `:root[data-route="conversations"]` selector and `document.documentElement.dataset.route` mutation; `useSidebarCollapse` contract with AppLayout; everything else is `.wac`-scoped. iGrowFast's shell must reproduce the `data-route` hook + collapse API or the page won't get full-bleed layout.
5. **`theme.ts` is dead code** but its values live on as CSS vars used inline (`--color-accent-natural`, `--font-body`) — these vars come from iGrowFast-unknown global stylesheets; missing them breaks the instance-switcher status dot and capacity banner font silently.
6. **JWT read straight from localStorage** (`sb-{ref}-auth-token`) in `instancesApi.call` to dodge a navigator.locks hang — storage-key format is Supabase-client-version dependent; a different auth storage (cookies, different key) silently breaks all group ops + checkWhatsApp.
7. **External-network dependencies** in the "self-contained" UI: GIPHY API (`VITE_GIPHY_API_KEY`), CARTO basemap tiles/style for locations, Google Maps link-outs, R2 presigned URLs — CSP and secret provisioning needed on iGrowFast side.
8. **No virtualization** anywhere (thread, chat list, galleries). Fine now; a risk for very long threads.
9. **Client mirrors server dispatcher logic**: `deriveBubbleBlockedState` + `ComposerCapacityBanner` re-implement `worker/src/dispatcher/loop.ts withinDispatchWindow` (business hours, quiet-hours override, caps). Any worker change must be mirrored in the UI or the red-! states lie.
10. **Delete-for-everyone reveal**: revoked messages keep the original body in DB and the UI offers an eye icon to peek — deliberate, but a compliance surprise.
11. **Favorites are localStorage-only** (per-browser, not shared, keyed by instance UUID) — instance IDs change in the migration ⇒ favorites silently reset. Same for `wam.contact-banner-dismissed.*`, `wam.emoji.recent`, `wam.cv.active_instance`.
12. **Hidden album `data-msg-id` spans** + DOM-query-based `scrollToMessage` (`document.querySelector`) — fragile if the port wraps bubbles differently.
13. **`(supabase.from as Function)` / `as never` casts** for `group_participants` and `scheduled_messages` — generated `database.types.ts` is stale; regenerate against the new `whatsapp` schema or these casts hide type drift.
14. **Schema-qualification hazard:** every `.from('...')` / `.rpc('...')` assumes tables/views/RPCs in `public` (client default schema). Moving to a `whatsapp` schema in iGrowFast requires either a schema-configured client (`supabase.schema('whatsapp')`), search_path views, or a full rewrite of ~30 call sites incl. `messages_decrypted`/`conversations_decrypted` views.
15. **Realtime volume**: `useInstancesUnreadRealtime` listens to `event:'*'` on the whole `conversations` table (all instances); postgres_changes on `messages` requires the tables in the publication. iGrowFast's realtime publication (rebuilt after the dev-clone incident) must include all these tables, RLS-filtered.
16. **`send_message` RPC has params newer than generated types** (`p_idempotency_key`, `p_origin`) — casts bypass typecheck; the DB function signature is the real contract.
17. **role model is binary** (`profile.role === 'admin'`) throughout (context menu, panels canManage, CreatorBadge, InfoPane) — iGrowFast has a 6-value `user_role` enum; every gate needs a mapping decision.
18. **DocThumb side-effect writes**: viewing a document can trigger a client-side render + `media-upload` of `<key>.preview.jpg` to R2 — read paths that silently write.
19. **Legacy exports still present**: `CreateListView`/`AddPeoplePicker` (pre-tags lists), `ListDef`, `IconPoll/IconHorn/IconList` etc. unused by the pages; `lib/drafts.ts` exists but composer has no draft persistence; `conversation_notes` API exists with no inbox UI.
20. **Instance-switcher popover is inline-styled** (hardcoded #1A1A1A etc.) — bypasses the token system; restyling for iGrowFast branding means touching TSX, not CSS.
21. **Peer-presence single-store pattern**: two components subscribing to the same Supabase broadcast topic silently drops messages for one of them — the ref-counted store in `waPresence.ts` is load-bearing; don't "simplify" it during the port.
22. **`useInboxAttendance`** flips the WhatsApp number ONLINE while the tab is visible (ban-safety design). Porting into an iGrowFast page that stays mounted in background tabs/routes changes the ban-risk profile.
