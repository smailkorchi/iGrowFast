// Conversations page — UI building blocks (chat list rows, chat pane,
// empty state, bubble, composer, info pane). Pure presentational; the
// orchestrator passes data and handlers in.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ConversationDecrypted, MessageDecrypted,
} from '../../../lib/database.types'
import { conversationLabel, formatPhone, formatUnread, parseJid } from '../../../lib/jid'
import {
  formatBubbleTime, formatDayDivider, formatListTime,
} from '../../../lib/relativeTime'
import { normalizeDeliveryStatus } from '../../../lib/messageStatus'
import {
  fetchOgPreview,
  findAllUrls,
  previewFromMediaMeta,
  useComposerLinkPreview,
  type OgPreview,
} from '../../../lib/ogPreview'
import { useResolvedMediaUrl } from '../../../lib/queries/media'
import { isThumbnailable } from '../../../lib/docThumbnail'
import { useContacts, type Contact } from '../../../lib/queries/contacts'
import { buildContactCard, buildContactShare, type ContactCardData } from '../../../lib/vCardBuilder'
import { useWaPeerPresence } from '../../../lib/queries/waPresence'
import { useDraft } from '../../../lib/drafts'
import { TypingIndicator } from '../../../components/conversations/TypingIndicator'
import { supabase, fetchAllWa } from '../../../lib/supabase'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  IconArchive,
  IconArrowBack,
  IconBackspace,
  IconBan,
  IconPencil,
  IconEye,
  IconEyeOff,
  IconBolt,
  IconCalendar,
  IconCamera,
  IconTag,
  IconTagFilled,
  IconCheck,
  IconCheckDouble,
  IconCheckSingle,
  IconChevronDown,
  IconClock,
  IconClose,
  IconDialPad,
  IconDocument,
  IconDownload,
  IconForward,
  IconGhost,
  IconHeadphones,
  IconImage,
  IconLocationPin,
  IconLock,
  IconCart,
  IconHeart,
  IconHeartFilled,
  IconMenuDots,
  IconMic,
  IconMinusCircle,
  IconNewChat,
  IconPause,
  IconPhone,
  IconPlay,
  IconPlus,
  IconScrollDown,
  IconSearch,
  IconSend,
  IconShield,
  IconPhoneOff,
  IconSmiley,
  IconStickerSmiley,
  IconSticker,
  IconStickerPlus,
  IconStar,
  IconWaPin,
  IconWaPinSmall,
  IconWaUnpin,
  IconStarFilled,
  IconTrash,
  IconExit,
  IconUnreadBadge,
  IconUser,
  IconUserPlus,
  IconViewOnce,
  IconUsers,
  IconVideo,
  IconSmileyFace,
  IconForwardAll,
  IconCheckbox,
  IconCopy,
  IconReply,
  IconRetry,
} from './icons'
import { sendReaction, toggleStar, setMessagePin, forwardMessage, sendMessage, cancelOutboundMessage, forceDispatchNow, sendTyping, uploadChatMedia, editMessage, deleteMessageForMe, deleteMessageForEveryone, togglePin, toggleArchive, markAllConversationsRead, markAllConversationsUnread, clearAllConversations, deleteAllConversations } from '../../../lib/conversationsApi'
import { usePendingUploads, enqueuePendingUpload, abortPendingUpload, retryPendingUpload, removePendingUpload, type PendingUpload } from '../../../lib/pendingUploads'
import { toast, normalizeError, mediaSizeError } from '../../../lib/toast/store'
import { EMOJI_DATA, EMOJI_KEYWORDS } from './emoji-data'
import { useUpsertContact } from '../../../lib/queries/contacts'
import { stepsSummary, useQuickReplies, type QuickReply } from '../../../lib/queries/quickReplies'
import { useScheduledMessages, useDeleteScheduledMessage, type ScheduledMessage } from '../../../lib/queries/scheduledMessages'
import { UnassignScheduledModal } from './UnassignScheduledModal'
import { useInstanceCapacityStatus } from '../../../lib/queries/instances'
import { useAuth } from '../../../lib/auth'
import { useAgentTyping } from '../../../lib/presence'
import type { Tag } from '../../../lib/queries/tags'
import {
  useClearConversation,
  useDeleteConversation,
  useMarkConversationRead,
  useMarkConversationUnread,
} from '../../../lib/queries/conversations'
import {
  useConversationAssignees,
  useSetConversationAssignees,
  useUnassignConversationUser,
} from '../../../lib/queries/assignments'
import { useProfiles } from '../../../lib/queries/users'
import UserAvatar from '../../../components/Avatar/Avatar'
import type { AvatarConfig } from '../../../lib/database.types'
import { TagPicker } from './TagPicker'
// IGF ADDITION (order-history seam): chat-header customer order history.
import { CustomerOrdersButton } from './CustomerOrdersButton'
import { checkWhatsApp, createGroup, leaveGroup, updateGroupParticipants, updateGroupSubject, updateGroupPicture } from '../../../lib/instancesApi'

// ──────────────────────────────────────────────────────────────────────────────
// Shared
// ──────────────────────────────────────────────────────────────────────────────

/**
 * WhatsApp Web has 4 standard filters + N user-defined lists.
 * Visible chips depend on context:
 *   - default mode (active in {toutes,unread,favoris})
 *       → [Toutes] [Non lues N] [Favoris] [▾]
 *   - custom mode (active in {groups, archived, list:X})
 *       → [Toutes] [<active>] [▾]
 * The chevron opens a dropdown with everything not already visible
 * (in custom mode it shows the defaults too as quick-access).
 */
export type Filter =
  | { kind: 'toutes' }
  | { kind: 'unread' }
  | { kind: 'favoris' }
  | { kind: 'groups' }
  | { kind: 'archived' }
  | { kind: 'tag'; tagId: string }

/** A tag usable as a chat-list filter (created in the Tags panel). */
export interface TagOption {
  id: string
  name: string
  color: string
}

export interface ListDef {
  id: string
  name: string
  /** Conversation IDs included in this list. */
  members: string[]
}

export const DEFAULT_FILTER: Filter = { kind: 'toutes' }

export function filterEquals(a: Filter, b: Filter): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'tag' && b.kind === 'tag') return a.tagId === b.tagId
  return true
}

/**
 * Allow only http(s) URLs as anchor hrefs. Inbound template/interactive button
 * URLs are untrusted; a `javascript:`/`data:`/`vbscript:` scheme would execute
 * in the dashboard origin when an agent clicks. Returns undefined for anything
 * that isn't http/https so the link does not render as clickable.
 */
function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url
  return undefined
}

/** Stable color index from a stringy seed (sender id). */
function senderColorVar(seed: string | null | undefined): string {
  if (!seed) return 'var(--wa-sender-3)'
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const n = Math.abs(h) % 8 + 1
  return `var(--wa-sender-${n})`
}

function Avatar({
  src, label, size = 49, iconSize,
}: { src?: string | null; label?: string; size?: number; iconSize?: number }) {
  if (src) {
    return (
      <div className="wac__row-avatar" style={{ width: size, height: size }}>
        <img src={src} alt={label ?? ''} draggable={false} />
      </div>
    )
  }
  return (
    <div className="wac__row-avatar" style={{ width: size, height: size }}>
      <IconUser size={iconSize ?? Math.floor(size * 0.6)} />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Chat list (sidebar)
// ──────────────────────────────────────────────────────────────────────────────

export interface ChatListHeaderInstance {
  id?: string
  display_name: string
  wa_profile_name: string | null
  profile_pic_url: string | null
  status?: string | null
}

export interface ChatListProps {
  instance: ChatListHeaderInstance | null
  rows: ConversationDecrypted[]
  activeId: string | null
  onSelect: (c: ConversationDecrypted) => void
  query: string
  onQueryChange: (q: string) => void
  filter: Filter
  onFilterChange: (f: Filter) => void
  unreadTotal: number
  /** COUNT of archived conversations on the active instance (mig 062 RPC,
   *  RLS-scoped per caller). Powers the "Archivées" filter pill badge. */
  archivedTotal?: number
  /** DB-level tags (shared across agents) usable as chat-list filters. */
  tags: TagOption[]
  /** Open the Tags panel (create/manage tags). */
  onManageTags: () => void
  onNewChat: () => void
  loading?: boolean
  onScrollEnd?: () => void
  tagColorMap?: Map<string, string[]>
  ownerJid?: string | null
  favCount?: number
  /** Server aggregate (mig 066): non-archived open/pending group conversations. */
  groupCount?: number
  /** Server aggregate (mig 066): tag_id → conversation count for the filter badges. */
  tagCounts?: Record<string, number>
  /** Full list of instances the caller can choose from. When length > 1 the
   *  sidebar header becomes a switcher; with 0/1 it stays a static label. */
  availableInstances?: ChatListHeaderInstance[]
  /** Fired when the user picks a different instance from the switcher. */
  onSwitchInstance?: (id: string) => void
  /** Unread count per instance id. Powers the header dot showing missed
   *  messages on inactive instances + the per-row badge in the dropdown. */
  unreadByInstance?: Map<string, number>
  /** Admin-only "ghost mode" (invisible viewing). When onToggleGhost is
   *  provided the eye-off toggle renders in the list header; agents never
   *  receive it, so their read-receipt path is untouched. */
  ghostMode?: boolean
  onToggleGhost?: () => void
}

export function ChatList(p: ChatListProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement | null>(null)

  // Subscribe to peer presence for the active instance so list rows can show
  // "écrit…" / "enregistrement…" inline like real WhatsApp. We pass null for
  // `openConvJid` because the list-level subscription isn't tied to any one
  // chat — the ChatPane subscribes separately when a conversation is opened.
  const listPeerPresence = useWaPeerPresence(p.instance?.id ?? null, null)

  // ── Right-click conversation menu (pin / read / clear / delete / leave) ────
  // Pin and read/unread work for everyone (toggle_pin and the mark-read pair
  // are assignment-scoped). Clear/Delete/Leave are admin-only (their edge fns
  // requireAdmin), so agents see only Pin + Marquer lu/non lu.
  const ctxIsAdmin = useAuth().profile?.role === 'admin'
  const ctxQc = useQueryClient()
  const ctxClearMut = useClearConversation()
  const ctxDeleteMut = useDeleteConversation()
  const ctxMarkRead = useMarkConversationRead()
  const ctxMarkUnread = useMarkConversationUnread()
  const [ctxMenu, setCtxMenu] = useState<{ row: ConversationDecrypted; x: number; y: number } | null>(null)
  const [ctxDanger, setCtxDanger] = useState<{ row: ConversationDecrypted; action: 'clear' | 'delete' | 'leave' } | null>(null)
  const [ctxBusy, setCtxBusy] = useState(false)
  const [ctxError, setCtxError] = useState<string | null>(null)

  // ── Header ⋮ bulk menu (instance-wide ops, mig 064) ────────────────────────
  // Mark all read/unread work for everyone (server scopes admin=whole instance,
  // agent=assigned-only). Clear-all/Delete-all are admin-gated server-side
  // (is_wa_admin), so agents only see the two mark items.
  const [bulkOpen, setBulkOpen] = useState(false)
  const bulkRef = useRef<HTMLDivElement | null>(null)
  const [bulkDanger, setBulkDanger] = useState<'clear-all' | 'delete-all' | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  // Pin/unpin: optimistic flip of is_pinned across the list caches (instant
  // indicator), then server toggle + invalidate so the list re-sorts pinned-first.
  function ctxTogglePin(row: ConversationDecrypted) {
    setCtxMenu(null)
    if (!row.id) return
    const next = !row.is_pinned
    ctxQc.setQueriesData<{ pages: { rows: ConversationDecrypted[] }[] }>({ queryKey: ['conversations', 'list'] }, (old) => {
      if (!old?.pages) return old
      return { ...old, pages: old.pages.map((pg) => ({ ...pg, rows: pg.rows.map((r) => (r.id === row.id ? { ...r, is_pinned: next } : r)) })) }
    })
    void togglePin(row.id)
      .catch((e) => toast.error(normalizeError(e)))
      .finally(() => { void ctxQc.invalidateQueries({ queryKey: ['conversations'] }) })
  }

  // Archive/unarchive: optimistic is_archived flip (the wrappers' render filter
  // drops the row from the current tab instantly), then server toggle +
  // invalidate — list, "Archivées" pill badge (mig 062) and unread count
  // (archived rows leave the operational scope, mig 060). toggle_archive gates
  // admin-OR-assigned server-side, and its bump trigger live-syncs every other
  // client (admin + seller) on its own.
  function ctxToggleArchive(row: ConversationDecrypted) {
    setCtxMenu(null)
    if (!row.id) return
    const next = !row.is_archived
    ctxQc.setQueriesData<{ pages: { rows: ConversationDecrypted[] }[] }>({ queryKey: ['conversations', 'list'] }, (old) => {
      if (!old?.pages) return old
      return { ...old, pages: old.pages.map((pg) => ({ ...pg, rows: pg.rows.map((r) => (r.id === row.id ? { ...r, is_archived: next } : r)) })) }
    })
    void toggleArchive(row.id)
      .catch((e) => toast.error(normalizeError(e)))
      .finally(() => {
        void ctxQc.invalidateQueries({ queryKey: ['conversations'] })
        void ctxQc.invalidateQueries({ queryKey: ['instances-archived'] })
        void ctxQc.invalidateQueries({ queryKey: ['instances-unread'] })
      })
  }

  // Read/unread: both hooks patch every cache optimistically (list row badge +
  // per-instance switcher count) then reconcile from the server, so the menu
  // action lands instantly like WhatsApp's "Marquer comme lu/non lu".
  function ctxToggleRead(row: ConversationDecrypted) {
    setCtxMenu(null)
    if (!row.id) return
    if ((row.unread_count ?? 0) > 0) ctxMarkRead(row.id)
    else ctxMarkUnread(row.id)
  }

  async function ctxConfirmDanger() {
    if (!ctxDanger?.row.id) return
    const { row, action } = ctxDanger
    const id = row.id
    if (!id) return
    setCtxBusy(true); setCtxError(null)
    try {
      if (action === 'clear') {
        await ctxClearMut.mutateAsync(id)
      } else if (action === 'leave') {
        if (!row.instance_id || !row.remote_jid) throw new Error('missing group ref')
        await leaveGroup(row.instance_id, row.remote_jid)
        void ctxQc.invalidateQueries({ queryKey: ['conversations'] })
      } else {
        await ctxDeleteMut.mutateAsync(id)
      }
      setCtxDanger(null)
    } catch (e) {
      setCtxError(normalizeError(e))
    } finally {
      setCtxBusy(false)
    }
  }

  // After any bulk op: list rows, unread pill (mig 060) and instance rows all
  // move at once — invalidate the three roots and let the queries reconcile.
  function bulkInvalidate() {
    void ctxQc.invalidateQueries({ queryKey: ['conversations'] })
    void ctxQc.invalidateQueries({ queryKey: ['instances-unread'] })
    void ctxQc.invalidateQueries({ queryKey: ['instances'] })
  }

  // Non-destructive bulk marks fire directly (like the per-row ctx items).
  function bulkMarkAll(read: boolean) {
    setBulkOpen(false)
    const instanceId = p.instance?.id
    if (!instanceId) return
    void (read ? markAllConversationsRead(instanceId) : markAllConversationsUnread(instanceId))
      .catch((e) => toast.error(normalizeError(e)))
      .finally(() => { bulkInvalidate() })
  }

  // Destructive bulk ops go through the same danger-modal flow as the per-row
  // clear/delete; on success also drop message caches + the archived pill
  // (mig 062) since delete-all removes archived rows too.
  async function bulkConfirmDanger() {
    const instanceId = p.instance?.id
    if (!bulkDanger || !instanceId) return
    setBulkBusy(true); setBulkError(null)
    try {
      if (bulkDanger === 'clear-all') await clearAllConversations(instanceId)
      else await deleteAllConversations(instanceId)
      setBulkDanger(null)
      bulkInvalidate()
      void ctxQc.invalidateQueries({ queryKey: ['messages'] })
      void ctxQc.invalidateQueries({ queryKey: ['instances-archived'] })
    } catch (e) {
      setBulkError(normalizeError(e))
    } finally {
      setBulkBusy(false)
    }
  }

  // Close the ⋮ bulk menu on outside-click / Escape (same recipe as the
  // instance switcher below).
  useEffect(() => {
    if (!bulkOpen) return
    const onDoc = (e: MouseEvent) => {
      if (bulkRef.current && !bulkRef.current.contains(e.target as Node)) setBulkOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBulkOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [bulkOpen])

  // Close the instance switcher on outside-click / Escape.
  useEffect(() => {
    if (!switcherOpen) return
    const onDoc = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) setSwitcherOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSwitcherOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [switcherOpen])

  const canSwitch =
    !!p.onSwitchInstance && !!p.availableInstances && p.availableInstances.length > 1

  // Total unread sitting on instances OTHER than the active one. Surfaced
  // beside the chevron so the user doesn't miss messages on inactive numbers.
  const otherUnread = useMemo(() => {
    if (!p.unreadByInstance || !p.availableInstances) return 0
    let total = 0
    for (const ins of p.availableInstances) {
      if (!ins.id || ins.id === p.instance?.id) continue
      total += p.unreadByInstance.get(ins.id) ?? 0
    }
    return total
  }, [p.unreadByInstance, p.availableInstances, p.instance?.id])

  // Search placeholder adapts to the active tag ("Rechercher dans <tag>…").
  const pf = p.filter
  const activeTag = pf.kind === 'tag'
    ? (p.tags.find((t) => t.id === pf.tagId) ?? null)
    : null
  const searchPlaceholder = activeTag
    ? `Rechercher dans ${activeTag.name}…`
    : 'Rechercher ou démarrer une discussion'

  // Infinite scroll
  useEffect(() => {
    const el = listRef.current
    if (!el || !p.onScrollEnd) return
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
        p.onScrollEnd?.()
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [p.onScrollEnd])

  return (
    <div className="wac__sidebar">
      <header className="wac__head wac__head--with-avatar">
        <div
          className={'wac__head-id' + (canSwitch ? ' wac__head-id--switcher' : '')}
          ref={switcherRef}
          role={canSwitch ? 'button' : undefined}
          tabIndex={canSwitch ? 0 : undefined}
          onClick={canSwitch ? () => setSwitcherOpen((v) => !v) : undefined}
          onKeyDown={canSwitch
            ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSwitcherOpen((v) => !v) } }
            : undefined}
          aria-haspopup={canSwitch ? 'listbox' : undefined}
          aria-expanded={canSwitch ? switcherOpen : undefined}
          // position:relative makes this div the positioning context so the
          // absolute-positioned popover anchors here and not to the sidebar
          // (which clips with overflow:hidden).
          style={canSwitch ? { cursor: 'pointer', position: 'relative' } : undefined}
        >
          <div className="wac__head-avatar">
            {p.instance?.profile_pic_url
              ? <img src={p.instance.profile_pic_url} alt="" draggable={false} />
              : <IconUser size={22} />}
          </div>
          <div className="wac__head-meta">
            <span className="wac__head-title" style={canSwitch ? { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 } : undefined}>
              <span className="wac__head-title-name">{p.instance?.display_name ?? 'WhatsApp'}</span>
              {canSwitch && otherUnread > 0 && (
                <span
                  aria-label={`${otherUnread} message(s) non lu(s) sur d'autres numéros`}
                  title={`${otherUnread} non lu sur d'autres numéros`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 18,
                    height: 18,
                    padding: '0 6px',
                    borderRadius: 999,
                    background: 'var(--wa-green, #25d366)',
                    color: '#000',
                    fontSize: 11,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  {otherUnread > 99 ? '99+' : otherUnread}
                </span>
              )}
              {canSwitch && (
                <IconChevronDown
                  size={14}
                  style={{
                    opacity: 0.6,
                    transition: 'transform 0.15s',
                    transform: switcherOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    flexShrink: 0,
                  }}
                />
              )}
            </span>
            {p.instance?.wa_profile_name && (
              <span className="wac__head-subtitle">{p.instance.wa_profile_name}</span>
            )}
          </div>
          {canSwitch && switcherOpen && (
            <InstanceSwitcherMenu
              instances={p.availableInstances ?? []}
              activeId={p.instance?.id ?? null}
              unreadByInstance={p.unreadByInstance}
              onPick={(id) => { setSwitcherOpen(false); p.onSwitchInstance?.(id) }}
            />
          )}
        </div>
        <div className="wac__head-actions">
          {/* Admin-only ghost mode: view conversations without sending a read
              receipt or clearing the unread badge. Renders only when the admin
              route wires onToggleGhost. */}
          {p.onToggleGhost && (
            <button
              className={'wac__icon-btn wac__ghost-btn' + (p.ghostMode ? ' is-ghost' : '')}
              aria-label={p.ghostMode ? 'Mode fantôme actif' : 'Mode fantôme'}
              aria-pressed={!!p.ghostMode}
              title={p.ghostMode ? 'Mode fantôme actif — aucune trace' : 'Mode fantôme'}
              onClick={p.onToggleGhost}
            >
              <IconGhost />
            </button>
          )}
          <button
            className="wac__icon-btn"
            aria-label="Nouvelle discussion"
            title="Nouvelle discussion"
            onClick={p.onNewChat}
          >
            <IconNewChat />
          </button>
          {p.instance?.id && (
            // position:relative wrapper anchors the dropdown to the button
            // (wac__ctx-menu is position:fixed by default, overridden inline).
            <div ref={bulkRef} style={{ position: 'relative' }}>
              <button
                className={'wac__icon-btn' + (bulkOpen ? ' is-active' : '')}
                aria-label="Menu"
                title="Menu"
                aria-haspopup="menu"
                aria-expanded={bulkOpen}
                onClick={() => setBulkOpen((v) => !v)}
              >
                <IconMenuDots />
              </button>
              {bulkOpen && (
                <div
                  className="wac__ctx-menu"
                  role="menu"
                  style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30 }}
                >
                  <button type="button" className="wac__ctx-item" role="menuitem" onClick={() => bulkMarkAll(true)}>
                    <IconCheckDouble size={17} /><span>Tout marquer comme lu</span>
                  </button>
                  <button type="button" className="wac__ctx-item" role="menuitem" onClick={() => bulkMarkAll(false)}>
                    <IconUnreadBadge size={17} /><span>Tout marquer comme non lu</span>
                  </button>
                  {ctxIsAdmin && (
                    <button type="button" className="wac__ctx-item" role="menuitem" onClick={() => { setBulkDanger('clear-all'); setBulkOpen(false) }}>
                      <IconBan size={17} /><span>Vider toutes les discussions</span>
                    </button>
                  )}
                  {ctxIsAdmin && (
                    <button type="button" className="wac__ctx-item wac__ctx-item--danger" role="menuitem" onClick={() => { setBulkDanger('delete-all'); setBulkOpen(false) }}>
                      <IconTrash size={17} /><span>Supprimer toutes les discussions</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="wac__search">
        <div className="wac__search-pill">
          <IconSearch className="wac__search-icon" />
          <input
            className="wac__search-input"
            type="text"
            placeholder={searchPlaceholder}
            value={p.query}
            onChange={(e) => p.onQueryChange(e.target.value)}
            aria-label="Rechercher"
          />
          {p.query && (
            <button
              className="wac__search-clear"
              onClick={() => p.onQueryChange('')}
              aria-label="Effacer la recherche"
            >
              <IconClose size={16} />
            </button>
          )}
        </div>
      </div>

      <FilterChipRow
        filter={p.filter}
        unreadTotal={p.unreadTotal}
        favCount={p.favCount}
        archivedTotal={p.archivedTotal}
        groupCount={p.groupCount}
        tagCounts={p.tagCounts}
        tags={p.tags}
        onChange={p.onFilterChange}
        onManageTags={p.onManageTags}
      />

      <div className="wac__list" ref={listRef}>
        {p.rows.length === 0 && !p.loading && (
          <div className="wac__list-empty">
            {p.query
              ? <>Aucune discussion ne correspond à « {p.query} ».</>
              : <>Aucune discussion.</>}
          </div>
        )}

        {p.rows.map((c) => {
          const presence = listPeerPresence.get(c.remote_jid ?? '')?.presence
          const typingPresence = presence === 'composing' || presence === 'recording'
            ? presence
            : null
          return (
            <ChatRow
              key={c.id ?? c.remote_jid ?? Math.random()}
              row={c}
              isActive={p.activeId === c.id}
              onClick={() => p.onSelect(c)}
              tagColors={c.id ? p.tagColorMap?.get(c.id) : undefined}
              isSelf={!!p.ownerJid && c.remote_jid === p.ownerJid}
              typingPresence={typingPresence}
              onContext={(row, x, y) => setCtxMenu({ row, x, y })}
            />
          )
        })}
      </div>

      {ctxMenu && (
        <ConversationContextMenu
          row={ctxMenu.row}
          x={ctxMenu.x}
          y={ctxMenu.y}
          isAdmin={ctxIsAdmin}
          onClose={() => setCtxMenu(null)}
          onPin={() => ctxTogglePin(ctxMenu.row)}
          onToggleRead={() => ctxToggleRead(ctxMenu.row)}
          onArchive={() => ctxToggleArchive(ctxMenu.row)}
          onClear={() => { setCtxDanger({ row: ctxMenu.row, action: 'clear' }); setCtxMenu(null) }}
          onDelete={() => { setCtxDanger({ row: ctxMenu.row, action: 'delete' }); setCtxMenu(null) }}
          onLeave={() => { setCtxDanger({ row: ctxMenu.row, action: 'leave' }); setCtxMenu(null) }}
        />
      )}

      {ctxDanger && (
        <ConversationDangerModal
          action={ctxDanger.action}
          isGroup={!!ctxDanger.row.is_group}
          busy={ctxBusy}
          error={ctxError}
          onConfirm={() => void ctxConfirmDanger()}
          onClose={() => { if (!ctxBusy) { setCtxDanger(null); setCtxError(null) } }}
        />
      )}

      {bulkDanger && (
        <ConversationDangerModal
          action={bulkDanger}
          isGroup={false}
          busy={bulkBusy}
          error={bulkError}
          onConfirm={() => void bulkConfirmDanger()}
          onClose={() => { if (!bulkBusy) { setBulkDanger(null); setBulkError(null) } }}
        />
      )}
    </div>
  )
}

// Right-click menu for a conversation row. position:fixed at the cursor; a full
// scrim closes it. Mirrors the info-panel actions; pin uses the message glyph.
function ConversationContextMenu({
  row, x, y, isAdmin, onClose, onPin, onToggleRead, onArchive, onClear, onDelete, onLeave,
}: {
  row: ConversationDecrypted
  x: number; y: number
  isAdmin: boolean
  onClose: () => void
  onPin: () => void; onToggleRead: () => void; onArchive: () => void; onClear: () => void; onDelete: () => void; onLeave: () => void
}) {
  const isGroup = !!row.is_group
  const pinned = !!row.is_pinned
  const unread = (row.unread_count ?? 0) > 0
  const archived = !!row.is_archived
  // Already left this group? Hide the Leave action (left_at set by group-leave /
  // a participants.update where the owner was removed).
  const alreadyLeft = !!(row as { left_at?: string | null }).left_at
  const canLeave = isGroup && !alreadyLeft
  // Keep the menu on-screen (flip up/left near edges). Height depends on which
  // items show (agents see Pin + Marquer lu/non lu + Archiver only).
  const itemCount = 3 + (isAdmin ? (1 + (isGroup ? 1 : 1) + (canLeave ? 1 : 0)) : 0)
  const MENU_W = 220, MENU_H = 14 + itemCount * 41
  const left = Math.min(x, window.innerWidth - MENU_W - 8)
  const top = Math.min(y, window.innerHeight - MENU_H - 8)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="wac__ctx-scrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div className="wac__ctx-menu" style={{ left, top }} role="menu">
        <button type="button" className="wac__ctx-item" role="menuitem" onClick={onPin}>
          {pinned ? <IconWaUnpin size={17} /> : <IconWaPin size={17} />}
          <span>{pinned ? 'Détacher du haut' : 'Épingler en haut'}</span>
        </button>
        <button type="button" className="wac__ctx-item" role="menuitem" onClick={onToggleRead}>
          {unread ? <IconCheckDouble size={17} /> : <IconUnreadBadge size={17} />}
          <span>{unread ? 'Marquer comme lu' : 'Marquer comme non lu'}</span>
        </button>
        <button type="button" className="wac__ctx-item" role="menuitem" onClick={onArchive}>
          <IconArchive size={17} />
          <span>{archived ? 'Désarchiver la discussion' : 'Archiver la discussion'}</span>
        </button>
        {isAdmin && (
          <button type="button" className="wac__ctx-item" role="menuitem" onClick={onClear}>
            <IconBan size={17} /><span>Vider la discussion</span>
          </button>
        )}
        {isAdmin && canLeave && (
          <button type="button" className="wac__ctx-item wac__ctx-item--danger" role="menuitem" onClick={onLeave}>
            <IconExit size={17} /><span>Quitter le groupe</span>
          </button>
        )}
        {isAdmin && isGroup && (
          <button type="button" className="wac__ctx-item wac__ctx-item--danger" role="menuitem" onClick={onDelete}>
            <IconTrash size={17} /><span>Supprimer le groupe</span>
          </button>
        )}
        {isAdmin && !isGroup && (
          <button type="button" className="wac__ctx-item wac__ctx-item--danger" role="menuitem" onClick={onDelete}>
            <IconTrash size={17} /><span>Supprimer la discussion</span>
          </button>
        )}
      </div>
    </>
  )
}

// Confirmation for the destructive conversation actions (clear/delete/leave
// per row, clear-all/delete-all instance-wide via the header ⋮ menu).
function ConversationDangerModal({
  action, isGroup, busy, error, onConfirm, onClose,
}: {
  action: 'clear' | 'delete' | 'leave' | 'clear-all' | 'delete-all'
  isGroup: boolean
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const copy =
    action === 'clear'
      ? { title: 'Vider la discussion ?', body: 'Tous les messages de cette discussion seront supprimés. La discussion reste dans la liste.', cta: 'Vider' }
    : action === 'clear-all'
      ? { title: 'Vider toutes les discussions ?', body: 'Tous les messages de toutes les discussions de ce numéro seront supprimés. Les discussions restent dans la liste.', cta: 'Tout vider' }
    : action === 'delete-all'
      ? { title: 'Supprimer toutes les discussions ?', body: 'Toutes les discussions de ce numéro et tout leur historique seront définitivement supprimés.', cta: 'Tout supprimer' }
    : action === 'leave'
      ? { title: 'Quitter le groupe ?', body: 'Vous quitterez ce groupe. La discussion reste visible mais vous ne recevrez plus ses messages.', cta: 'Quitter' }
    : { title: isGroup ? 'Supprimer le groupe ?' : 'Supprimer la discussion ?', body: 'La discussion et tout son historique seront définitivement supprimés.', cta: 'Supprimer' }
  return (
    <div className="wac__modal-overlay" onClick={onClose}>
      <div className="wac__modal" onClick={(e) => e.stopPropagation()}>
        <div className="wac__modal-head"><span>{copy.title}</span></div>
        <div className="wac__modal-body">
          <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: 'rgba(250,249,245,0.7)' }}>{copy.body}</p>
          {error && <p style={{ margin: '10px 0 0', fontSize: '0.82rem', color: '#f15c6d' }}>{error}</p>}
        </div>
        <div className="wac__modal-footer">
          <button className="wac__modal-btn wac__modal-btn--cancel" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="wac__modal-btn wac__modal-btn--save" onClick={onConfirm} disabled={busy}
            style={{ background: '#b23b2e', borderColor: '#b23b2e' }}>
            {busy ? '…' : copy.cta}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatRow({
  row, isActive, onClick, tagColors, isSelf, typingPresence, onContext,
}: { row: ConversationDecrypted; isActive: boolean; onClick: () => void; tagColors?: string[]; isSelf?: boolean; typingPresence?: 'composing' | 'recording' | null; onContext?: (row: ConversationDecrypted, x: number, y: number) => void }) {
  const name = conversationLabel(row.remote_jid ?? '', row.peer_display_name, row.contact_book_name)
  const unread = formatUnread(row.unread_count)
  const isUnread = (row.unread_count ?? 0) > 0
  const isPinned = !!row.is_pinned
  const time = formatListTime(row.last_message_at)
  const rawPreview = row.last_message_preview?.trim() || ''
  const kind = row.last_message_kind
  const dir = row.last_message_direction
  const meta = (row.last_message_media_meta ?? {}) as Record<string, unknown>
  const senderName = row.last_message_sender_name
  const isGroup = !!row.is_group
  const isOut = dir === 'outbound'
  // Real delivery status of the latest outbound message (from conversations
  // .last_outbound_status, maintained by the trigger). Drives the preview tick.
  const lastOutStatus = normalizeDeliveryStatus(
    (row as unknown as { last_outbound_status?: string | null }).last_outbound_status,
  )
  const bodyPreview = isGroup ? rawPreview.replace(/@\d{10,20}/g, '@mention') : rawPreview
  // Unsent composer draft — previewed only on inactive rows (the active one
  // shows the composer itself) and never over a live typing indicator.
  const draft = useDraft(row.id)
  const draftPreview = !isActive && !typingPresence && draft ? draft : null

  // Tick icon for the preview — only for outbound non-reaction last messages.
  const previewTick = (() => {
    if (meta.revoked === true) return null   // no tick on a deleted-message preview
    if (kind === 'system') return null       // group-event/system pills carry no tick
    if (!isOut || kind === 'reaction') return null
    switch (lastOutStatus) {
      case 'read':      return <span className="wac__row-preview-ticks is-read"><IconCheckDouble size={16} /></span>
      case 'delivered': return <span className="wac__row-preview-ticks"><IconCheckDouble size={16} /></span>
      case 'sent':      return <span className="wac__row-preview-ticks"><IconCheckSingle size={16} /></span>
      case 'failed':    return <span className="wac__row-preview-ticks" style={{ color: '#f15c6d' }}><IconClock size={14} /></span>
      default:          return <span className="wac__row-preview-ticks"><IconClock size={14} /></span> // pending
    }
  })()

  const previewContent = (() => {
    // Latest message was deleted (delete-for-everyone or inbound revoke) →
    // show the deleted tombstone, not the stale original text.
    if (meta.revoked === true) {
      return (
        <span className="wac__preview-revoked">
          <IconBan size={13} /> {meta.revoked_by === 'us' ? 'Vous avez supprimé ce message' : 'Ce message a été supprimé'}
        </span>
      )
    }
    if (!kind) return bodyPreview || <span style={{ opacity: 0.6 }}>—</span>
    switch (kind) {
      case 'image': return <><IconCamera size={14} /> {bodyPreview || 'Photo'}</>
      case 'video':
        return (meta.gifPlayback === true || meta.isGif === true || meta.gif === true)
          ? <><span className="wac__preview-gif-tag">GIF</span> {bodyPreview || 'GIF'}</>
          : <><IconVideo size={14} /> {bodyPreview || 'Vidéo'}</>
      case 'audio': return (meta.ptt === false || (meta.ptt !== true && !!meta.fileName))
        ? <><IconHeadphones size={14} /> {bodyPreview || 'Audio'}</>
        : <><IconMic size={14} /> {bodyPreview || 'Message vocal'}</>
      case 'document': return <><IconDocument size={14} /> {(meta.fileName as string) || 'Document'}</>
      case 'sticker': return <><IconSticker size={14} /> Sticker</>
      case 'contact': return <><IconUser size={14} /> Contact</>
      case 'location':
        return meta.subtype === 'live_location'
          ? <><IconLocationPin size={14} /> Localisation en direct</>
          : <><IconLocationPin size={14} /> Localisation</>
      case 'reaction': {
        const emoji = meta.emoji as string || ''
        if (isOut) return <>Vous avez réagi par {emoji}</>
        if (isGroup && senderName) return <>{senderName} a réagi par {emoji}</>
        return <>A réagi par {emoji}</>
      }
      case 'system': return meta.subtype === 'view_once'
        ? <><IconViewOnce size={14} /> Message à vue unique</>
        : bodyPreview || <span style={{ opacity: 0.6 }}>—</span>
      default: return bodyPreview || <span style={{ opacity: 0.6 }}>—</span>
    }
  })()

  return (
    <div
      className={
        'wac__row'
        + (isActive ? ' is-active' : '')
        + (isUnread ? ' is-unread' : '')
      }
      onClick={onClick}
      onContextMenu={onContext ? (e) => { e.preventDefault(); onContext(row, e.clientX, e.clientY) } : undefined}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      <Avatar src={row.peer_profile_pic} label={name} />
      <div className="wac__row-body">
        <div className="wac__row-top">
          <span className="wac__row-name-group">
            <span className="wac__row-name">{name}{isSelf && <span className="wac__nc-tag"> (vous)</span>}</span>
            {tagColors && tagColors.length > 0 && (
              <span className="wac__row-tag-icons">
                {tagColors.slice(0, 3).map((c, i) => (
                  <IconTagFilled key={i} size={15} style={{ color: c }} />
                ))}
              </span>
            )}
          </span>
          {time && <span className="wac__row-time">{time}</span>}
        </div>
        <div className="wac__row-bottom">
          <span
            className="wac__row-preview"
            style={typingPresence ? { color: 'var(--wa-green, #25d366)' } : undefined}
          >
            {typingPresence
              ? (typingPresence === 'recording'
                  ? "enregistrement d’un audio…"
                  : 'écrit…')
              : draftPreview
                ? (
                  <>
                    <span style={{ color: 'var(--wa-green, #25d366)' }}>Brouillon{' '}:</span> {draftPreview}
                  </>
                )
                : (
                  <>
                    {previewTick}
                    {isGroup && senderName && kind !== 'reaction' && kind !== 'system' && <span className="wac__row-preview-sender">{senderName}:{' '}</span>}
                    {previewContent}
                  </>
                )}
          </span>
          <span className="wac__row-meta">
            {isPinned && <IconWaPin className="wac__row-meta-icon" size={15} aria-hidden />}
            {row.status === 'snoozed' && <IconClock className="wac__row-meta-icon" />}
            {!isUnread && row.is_archived && <IconMinusCircle className="wac__row-meta-icon" />}
            {unread && <span className="wac__row-badge">{unread}</span>}
          </span>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Instance switcher menu (popover under the sidebar header)
// ──────────────────────────────────────────────────────────────────────────────

function InstanceSwitcherMenu({
  instances, activeId, unreadByInstance, onPick,
}: {
  instances: ChatListHeaderInstance[]
  activeId: string | null
  unreadByInstance?: Map<string, number>
  onPick: (id: string) => void
}) {
  return (
    <div
      role="listbox"
      className="wac__instance-switch"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 12,
        right: 12,
        zIndex: 20,
        background: '#1A1A1A',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: 6,
        boxShadow: '0 24px 48px -16px rgba(0,0,0,0.7)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        maxHeight: 360,
        overflowY: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {instances.map((ins) => {
        if (!ins.id) return null
        const isActive = ins.id === activeId
        const isConnected = ins.status === 'connected'
        return (
          <button
            type="button"
            key={ins.id}
            role="option"
            aria-selected={isActive}
            onClick={() => onPick(ins.id!)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              borderRadius: 8,
              border: 'none',
              background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
            }}
            onMouseLeave={(e) => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            <span
              style={{
                width: 32, height: 32, borderRadius: '50%',
                display: 'grid', placeItems: 'center',
                background: 'rgba(255,255,255,0.06)',
                overflow: 'hidden', flexShrink: 0,
              }}
            >
              {ins.profile_pic_url
                ? <img src={ins.profile_pic_url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <IconUser size={18} />}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: '0.92rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ins.display_name}
              </span>
              {ins.wa_profile_name && (
                <span style={{ fontSize: '0.74rem', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ins.wa_profile_name}
                </span>
              )}
            </span>
            {(() => {
              const unread = unreadByInstance?.get(ins.id!) ?? 0
              return unread > 0 ? (
                <span
                  aria-label={`${unread} non lu`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 22,
                    height: 22,
                    padding: '0 7px',
                    borderRadius: 999,
                    background: 'var(--wa-green, #25d366)',
                    color: '#000',
                    fontSize: 12,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null
            })()}
            <span
              aria-hidden
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: isConnected ? 'var(--color-accent-natural)' : 'rgba(255,255,255,0.25)',
                boxShadow: isConnected ? '0 0 0 3px rgba(120,140,93,0.18)' : 'none',
                flexShrink: 0,
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Filter chip row + chevron dropdown
// ──────────────────────────────────────────────────────────────────────────────

interface FilterChipRowProps {
  filter: Filter
  unreadTotal: number
  favCount?: number
  archivedTotal?: number
  groupCount?: number
  tagCounts?: Record<string, number>
  tags: TagOption[]
  onChange: (f: Filter) => void
  onManageTags: () => void
}

function FilterChipRow({
  filter, unreadTotal, favCount, archivedTotal, groupCount, tagCounts, tags, onChange, onManageTags,
}: FilterChipRowProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const isDefault = filter.kind === 'toutes' || filter.kind === 'unread' || filter.kind === 'favoris'
  const activeTag = filter.kind === 'tag'
    ? tags.find((t) => t.id === filter.tagId) ?? null
    : null

  // Visible chips depend on whether active filter is "default" or "custom".
  return (
    <div className="wac__filters" role="tablist" ref={wrapRef}>
      <Chip
        label="Toutes"
        active={filter.kind === 'toutes'}
        onClick={() => onChange({ kind: 'toutes' })}
      />

      {isDefault ? (
        <>
          <Chip
            label="Non lues"
            count={unreadTotal > 0 ? unreadTotal : undefined}
            active={filter.kind === 'unread'}
            onClick={() => onChange({ kind: 'unread' })}
          />
          <Chip
            label="Favoris"
            count={favCount && favCount > 0 ? favCount : undefined}
            active={filter.kind === 'favoris'}
            onClick={() => onChange({ kind: 'favoris' })}
          />
        </>
      ) : filter.kind === 'groups' ? (
        <Chip
          label="Groupes"
          count={groupCount && groupCount > 0 ? groupCount : undefined}
          active
          onClick={() => { /* already active */ }}
        />
      ) : filter.kind === 'archived' ? (
        <Chip
          label="Archivées"
          count={archivedTotal && archivedTotal > 0 ? archivedTotal : undefined}
          active
          onClick={() => { /* already active */ }}
        />
      ) : filter.kind === 'tag' && activeTag ? (
        <Chip
          label={activeTag.name}
          dotColor={activeTag.color}
          count={(tagCounts?.[activeTag.id] ?? 0) > 0 ? tagCounts![activeTag.id] : undefined}
          active
          onClick={() => { /* already active */ }}
        />
      ) : null}

      <button
        type="button"
        className={'wac__chip wac__chip--icon' + (open ? ' is-open' : '')}
        aria-label="Plus de filtres"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevronDown size={14} />
      </button>

      {open && (
        <FilterDropdown
          filter={filter}
          unreadTotal={unreadTotal}
          archivedTotal={archivedTotal}
          favCount={favCount}
          groupCount={groupCount}
          tagCounts={tagCounts}
          tags={tags}
          showDefaults={!isDefault}
          onSelect={(f) => { setOpen(false); onChange(f) }}
          onManageTags={() => { setOpen(false); onManageTags() }}
        />
      )}
    </div>
  )
}

function Chip({
  label, count, active, onClick, dotColor,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
  dotColor?: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={'wac__chip' + (active ? ' is-active' : '')}
      onClick={onClick}
    >
      {dotColor && <span className="wac__chip-dot" style={{ background: dotColor }} aria-hidden />}
      <span>{label}</span>
      {count != null && <span className="wac__chip-count">{count}</span>}
    </button>
  )
}

interface FilterDropdownProps {
  filter: Filter
  unreadTotal: number
  archivedTotal?: number
  /** Favorites set size (client-side, complete). */
  favCount?: number
  /** Server aggregate (mig 066): non-archived open/pending group conversations. */
  groupCount?: number
  /** Server aggregate (mig 066): tag_id → count, matches the tag filter's result. */
  tagCounts?: Record<string, number>
  tags: TagOption[]
  /** When true, include the default filters (Toutes/Non lues/Favoris) too. */
  showDefaults: boolean
  onSelect: (f: Filter) => void
  onManageTags: () => void
}

function FilterDropdown({
  filter, unreadTotal, archivedTotal, favCount, groupCount, tagCounts, tags, showDefaults, onSelect, onManageTags,
}: FilterDropdownProps) {
  return (
    <div className="wac__chip-dropdown" role="menu">
      {showDefaults && (
        <>
          <DropdownItem
            label="Toutes"
            checked={filter.kind === 'toutes'}
            onClick={() => onSelect({ kind: 'toutes' })}
          />
          <DropdownItem
            label="Non lues"
            count={unreadTotal > 0 ? unreadTotal : undefined}
            checked={filter.kind === 'unread'}
            onClick={() => onSelect({ kind: 'unread' })}
          />
          <DropdownItem
            label="Favoris"
            count={favCount && favCount > 0 ? favCount : undefined}
            checked={filter.kind === 'favoris'}
            onClick={() => onSelect({ kind: 'favoris' })}
          />
        </>
      )}

      {/* "Groupes" is in the dropdown unless already the active visible chip */}
      {filter.kind !== 'groups' && (
        <DropdownItem
          label="Groupes"
          count={groupCount && groupCount > 0 ? groupCount : undefined}
          checked={false}
          onClick={() => onSelect({ kind: 'groups' })}
        />
      )}

      {/* "Archivées" likewise — count badge from the mig 062 server aggregate */}
      {filter.kind !== 'archived' && (
        <DropdownItem
          label="Archivées"
          count={archivedTotal && archivedTotal > 0 ? archivedTotal : undefined}
          checked={false}
          onClick={() => onSelect({ kind: 'archived' })}
        />
      )}

      {tags.map((t) => {
        // Skip the active tag when it's already the visible chip.
        if (filter.kind === 'tag' && filter.tagId === t.id && !showDefaults) return null
        const isActive = filter.kind === 'tag' && filter.tagId === t.id
        const tc = tagCounts?.[t.id] ?? 0
        return (
          <DropdownItem
            key={t.id}
            label={t.name}
            dot={t.color}
            count={tc > 0 ? tc : undefined}
            checked={isActive}
            onClick={() => onSelect({ kind: 'tag', tagId: t.id })}
          />
        )
      })}

      <div className="wac__chip-dropdown-sep" role="separator" />
      <button
        type="button"
        className="wac__chip-dropdown-item wac__chip-dropdown-item--cta"
        onClick={onManageTags}
      >
        <IconPlus size={18} />
        <span>Gérer les étiquettes</span>
      </button>
    </div>
  )
}

function DropdownItem({
  label, count, checked, onClick, dot,
}: {
  label: string
  count?: number
  checked: boolean
  onClick: () => void
  dot?: string
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className="wac__chip-dropdown-item"
      onClick={onClick}
    >
      <span className="wac__chip-dropdown-check" aria-hidden>
        {checked ? <IconCheck size={16} /> : null}
      </span>
      {dot && <span className="wac__chip-dot" style={{ background: dot }} aria-hidden />}
      <span className="wac__chip-dropdown-label">{label}</span>
      {count != null && <span className="wac__chip-dropdown-count">{count}</span>}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Create-list view (sidebar takeover)
// ──────────────────────────────────────────────────────────────────────────────

export interface CreateListViewProps {
  candidates: ConversationDecrypted[]
  instanceId: string | null
  selfJid: string | null
  onCancel: () => void
  onCreate: (def: Omit<ListDef, 'id'>) => void
}

export function CreateListView({ candidates, instanceId, selfJid, onCancel, onCreate }: CreateListViewProps) {
  const [name, setName] = useState('')
  const [picker, setPicker] = useState(false)
  const [members, setMembers] = useState<string[]>([])

  const trimmed = name.trim()
  const canCreate = trimmed.length > 0 && members.length > 0

  const memberRows = useMemo(
    () => members
      .map((id) => candidates.find((c) => c.id === id))
      .filter((c): c is ConversationDecrypted => !!c),
    [members, candidates],
  )

  return (
    <div className="wac__sidebar wac__sidebar--create-list">
      <header className="wac__head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="wac__icon-btn" onClick={onCancel} aria-label="Annuler">
            <IconArrowBack />
          </button>
          <span className="wac__head-title">Créer une nouvelle liste</span>
        </div>
      </header>

      <div className="wac__cl">
        <div className="wac__cl-field">
          <label className="wac__cl-field-label" htmlFor="list-name">Nom de la liste</label>
          <div className="wac__cl-field-row">
            <input
              id="list-name"
              type="text"
              className="wac__cl-input"
              placeholder="Nom de la liste"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <span className="wac__cl-field-icon" aria-hidden>
              <IconSmiley size={18} />
            </span>
          </div>
        </div>

        <div className="wac__cl-section-label">Inclus</div>

        <button
          type="button"
          className="wac__cl-add"
          onClick={() => setPicker(true)}
        >
          <span className="wac__cl-add-circle"><IconPlus /></span>
          <span>Ajouter des personnes ou des groupes</span>
        </button>

        <div className="wac__cl-members">
          {memberRows.map((c) => {
            const label = conversationLabel(c.remote_jid ?? '', c.peer_display_name, c.contact_book_name)
            const preview = c.last_message_preview?.trim() ?? ''
            return (
              <div key={c.id ?? Math.random()} className="wac__cl-member">
                <div className="wac__row-avatar" style={{ width: 40, height: 40 }}>
                  {c.peer_profile_pic
                    ? <img src={c.peer_profile_pic} alt="" draggable={false} />
                    : <IconUser size={22} />}
                </div>
                <div className="wac__cl-member-body">
                  <div className="wac__cl-member-name">{label}</div>
                  {preview && (
                    <div className="wac__cl-member-preview">
                      <IconCheckDouble size={14} className="wac__cl-member-tick" />
                      <span>{preview}</span>
                    </div>
                  )}
                </div>
                <button
                  className="wac__icon-btn"
                  aria-label={`Retirer ${label}`}
                  onClick={() => setMembers((xs) => xs.filter((x) => x !== c.id))}
                >
                  <IconTrash size={18} />
                </button>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          className={'wac__cl-cta' + (canCreate ? ' is-enabled' : '')}
          disabled={!canCreate}
          onClick={() => {
            if (!canCreate) return
            onCreate({ name: trimmed, members })
          }}
        >
          Créer une liste
        </button>
      </div>

      {picker && (
        <AddPeoplePicker
          candidates={candidates}
          instanceId={instanceId}
          selfJid={selfJid}
          selected={members}
          onCancel={() => setPicker(false)}
          onConfirm={(ids) => { setMembers(ids); setPicker(false) }}
        />
      )}
    </div>
  )
}

function AddPeoplePicker({
  candidates, instanceId, selfJid, selected, onCancel, onConfirm,
}: {
  candidates: ConversationDecrypted[]
  instanceId: string | null
  selfJid: string | null
  selected: string[]
  onCancel: () => void
  onConfirm: (ids: string[]) => void
}) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set(selected))
  const [busy, setBusy] = useState(false)
  const { data: bookContacts } = useContacts(instanceId)

  interface PickerEntry {
    key: string
    name: string
    pic: string | null
    preview: string | null
    convId: string | null
    jid: string
  }

  const entries = useMemo(() => {
    const result: PickerEntry[] = []
    const seenJids = new Set<string>()

    for (const c of candidates) {
      const jid = c.remote_jid ?? ''
      if (!jid || !c.id) continue
      seenJids.add(jid)
      result.push({
        key: c.id,
        name: conversationLabel(jid, c.peer_display_name, c.contact_book_name),
        pic: c.peer_profile_pic ?? null,
        preview: c.last_message_preview ?? null,
        convId: c.id,
        jid,
      })
    }

    for (const ct of bookContacts ?? []) {
      if (!ct.phone_jid) continue
      if (ct.phone_jid === selfJid) continue
      if (seenJids.has(ct.phone_jid)) continue
      seenJids.add(ct.phone_jid)
      result.push({
        key: 'contact-' + ct.id,
        name: ct.book_name || ct.push_name || (ct.phone_number ? formatPhone(ct.phone_number) : null) || '—',
        pic: ct.profile_pic,
        preview: null,
        convId: null,
        jid: ct.phone_jid,
      })
    }

    return result
  }, [candidates, bookContacts, selfJid])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((e) => e.name.toLowerCase().includes(needle) || e.jid.includes(needle))
  }, [entries, q])

  const handleConfirm = async () => {
    setBusy(true)
    try {
      const ids: string[] = []
      for (const key of picked) {
        const entry = entries.find(e => e.key === key)
        if (!entry) continue
        if (entry.convId) {
          ids.push(entry.convId)
        } else if (instanceId) {
          const { ensureConversation } = await import('../../../lib/conversationCreate')
          const id = await ensureConversation({ instanceId, remoteJid: entry.jid })
          ids.push(id)
        }
      }
      onConfirm(ids)
    } catch (e) {
      console.error('Failed to resolve contacts:', e)
      toast.error(normalizeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wac__picker">
      <header className="wac__head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="wac__icon-btn" onClick={onCancel} aria-label="Annuler">
            <IconArrowBack />
          </button>
          <span className="wac__head-title">Ajouter à la liste</span>
        </div>
      </header>

      <div className="wac__search">
        <div className="wac__search-pill">
          <IconSearch className="wac__search-icon" />
          <input
            className="wac__search-input"
            type="text"
            placeholder="Rechercher un nom ou un numéro"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="wac__picker-section-label">Contacts</div>

      <div className="wac__picker-list">
        {filtered.map((e) => {
          const isOn = picked.has(e.key)
          return (
            <button
              key={e.key}
              type="button"
              className="wac__picker-row"
              onClick={() => {
                setPicked((prev) => {
                  const next = new Set(prev)
                  if (next.has(e.key)) next.delete(e.key); else next.add(e.key)
                  return next
                })
              }}
            >
              <span className={'wac__picker-check' + (isOn ? ' is-on' : '')} aria-hidden>
                {isOn && <IconCheck size={14} />}
              </span>
              <div className="wac__row-avatar" style={{ width: 40, height: 40 }}>
                {e.pic
                  ? <img src={e.pic} alt="" draggable={false} />
                  : <IconUser size={22} />}
              </div>
              <div className="wac__picker-row-body">
                <div className="wac__picker-row-name">{e.name}</div>
                {e.preview && (
                  <div className="wac__picker-row-preview">{e.preview}</div>
                )}
              </div>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="wac__list-empty">Aucun résultat.</div>
        )}
      </div>

      <button
        type="button"
        className={'wac__cl-cta is-enabled wac__picker-cta'}
        disabled={busy}
        onClick={handleConfirm}
      >
        {busy ? 'Préparation...' : `Terminer (${picked.size})`}
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// New-chat view (sidebar takeover)
//
// Evolution-API surface — what we expose here is strictly what v2.3.7 supports:
//   ✓ Open existing conversation (matches a row in `conversations`)
//   ✓ "Vous" (envoyez-vous un message) — send to own JID
//   ✓ Start a chat by entering a phone number (dial-pad sub-view); if a
//     conversation already exists for that JID it opens directly, otherwise
//     a placeholder hint is shown (first message creates the row via the
//     dispatch pipeline).
//
// Intentionally NOT shown — Evolution doesn't expose these:
//   ✗ "Nouveau contact" — Baileys has no add-contact API (contacts are
//     local-only on the phone).
//   ✗ "Nouvelle communauté" — communities aren't surfaced in v2.3.7.
//   ✗ "Nouveau groupe" — Evolution has /group/create but the worker
//     endpoint + flow aren't shipped yet. Will land in a follow-up.
// ──────────────────────────────────────────────────────────────────────────────

export interface NewChatViewProps {
  rows: ConversationDecrypted[]
  instanceId: string | null
  ownerJid: string | null
  ownerName: string | null
  ownerPic: string | null
  onCancel: () => void
  onPickConversation: (c: ConversationDecrypted) => void
  /** Called when we created a new conversation row server-side — orchestrator
   *  navigates the chat list to the new id once it lands. */
  onCreatedConversation: (conversationId: string) => void
}

interface ContactEntry {
  key: string
  name: string
  phone: string | null
  pic: string | null
  convId: string | null
  conv: ConversationDecrypted | null
  jid: string
}

export function NewChatView({
  rows, instanceId, ownerJid, ownerName, ownerPic,
  onCancel, onPickConversation, onCreatedConversation,
}: NewChatViewProps) {
  const [q, setQ] = useState('')
  const [subview, setSubview] = useState<'main' | 'dialpad' | 'new-contact' | 'new-group'>('main')
  const [creating, setCreating] = useState<string | null>(null)

  const { data: bookContacts } = useContacts(instanceId)

  const entries = useMemo(() => {
    const result: ContactEntry[] = []
    const seenJids = new Set<string>()

    // Existing DM conversations (non-group, non-self)
    for (const c of rows) {
      if (c.is_group || c.remote_jid === ownerJid) continue
      const jid = c.remote_jid ?? ''
      if (!jid) continue
      seenJids.add(jid)
      const name = conversationLabel(jid, c.peer_display_name, c.contact_book_name)
      const phone = jid.endsWith('@s.whatsapp.net') ? '+' + jid.replace('@s.whatsapp.net', '') : null
      result.push({
        key: c.id ?? jid,
        name,
        phone,
        pic: c.peer_profile_pic ?? null,
        convId: c.id ?? null,
        conv: c,
        jid,
      })
    }

    // Phone-book contacts without an existing conversation
    for (const ct of bookContacts ?? []) {
      if (!ct.phone_jid) continue
      if (ct.phone_jid === ownerJid) continue
      if (seenJids.has(ct.phone_jid)) continue
      seenJids.add(ct.phone_jid)
      const name = ct.book_name || ct.push_name || (ct.phone_number ? formatPhone(ct.phone_number) : null) || '—'
      result.push({
        key: 'contact-' + ct.id,
        name,
        phone: ct.phone_number ? '+' + ct.phone_number : null,
        pic: ct.profile_pic,
        convId: null,
        conv: null,
        jid: ct.phone_jid,
      })
    }

    return result
  }, [rows, bookContacts, ownerJid])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((e) => {
      return e.name.toLowerCase().includes(needle)
        || (e.phone ?? '').includes(needle)
        || e.jid.toLowerCase().includes(needle)
    })
  }, [entries, q])

  const groups = useMemo(() => {
    const map = new Map<string, ContactEntry[]>()
    for (const e of filtered) {
      const first = e.name.replace(/[^\p{L}\d+]/gu, '').slice(0, 1).toUpperCase()
      const key = /[A-ZÀ-Ÿ]/.test(first) ? first : '#'
      const arr = map.get(key) ?? []
      arr.push(e)
      map.set(key, arr)
    }
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name))
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === '#') return 1
      if (b[0] === '#') return -1
      return a[0].localeCompare(b[0])
    })
  }, [filtered])

  const selfConv = useMemo(
    () => ownerJid ? rows.find((c) => c.remote_jid === ownerJid) ?? null : null,
    [rows, ownerJid],
  )

  const [selfBusy, setSelfBusy] = useState(false)
  const [selfError, setSelfError] = useState<string | null>(null)

  if (subview === 'dialpad') {
    return (
      <DialPadView
        instanceId={instanceId}
        ownerJid={ownerJid}
        rows={rows}
        onCancel={() => setSubview('main')}
        onPickConversation={onPickConversation}
        onCreatedConversation={onCreatedConversation}
      />
    )
  }
  if (subview === 'new-contact') {
    return (
      <NewContactView
        instanceId={instanceId}
        onCancel={() => setSubview('main')}
        onCreated={(jid, name) => {
          void (async () => {
            if (!instanceId) return
            const { ensureConversation } = await import('../../../lib/conversationCreate')
            const id = await ensureConversation({ instanceId, remoteJid: jid, peerDisplayName: name })
            onCreatedConversation(id)
          })()
        }}
      />
    )
  }
  if (subview === 'new-group') {
    return (
      <NewGroupView
        instanceId={instanceId}
        entries={entries}
        onCancel={() => setSubview('main')}
        onCreated={(conversationId) => {
          // Server already created+assigned the conversation; just navigate to it
          // (synchronous → the create panel always transitions, never freezes).
          if (conversationId) onCreatedConversation(conversationId)
        }}
      />
    )
  }

  async function openSelfChat() {
    setSelfError(null)
    if (selfConv) { onPickConversation(selfConv); return }
    if (!instanceId || !ownerJid) {
      setSelfError("Aucune instance connectée n'est liée à un numéro WhatsApp.")
      return
    }
    setSelfBusy(true)
    try {
      const { ensureConversation } = await import('../../../lib/conversationCreate')
      const id = await ensureConversation({
        instanceId,
        remoteJid: ownerJid,
        peerDisplayName: ownerName,
        peerProfilePic:  ownerPic,
      })
      onCreatedConversation(id)
    } catch (e) {
      setSelfError(normalizeError(e))
    } finally {
      setSelfBusy(false)
    }
  }

  async function openContact(entry: ContactEntry) {
    if (entry.conv) { onPickConversation(entry.conv); return }
    if (!instanceId) return
    setCreating(entry.key)
    try {
      const { ensureConversation } = await import('../../../lib/conversationCreate')
      const id = await ensureConversation({
        instanceId,
        remoteJid: entry.jid,
        peerDisplayName: entry.name,
        peerProfilePic: entry.pic,
      })
      onCreatedConversation(id)
    } catch (e) { toast.error(normalizeError(e)) } finally {
      setCreating(null)
    }
  }

  return (
    <div className="wac__sidebar wac__sidebar--new-chat">
      <header className="wac__head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
          <button className="wac__icon-btn" onClick={onCancel} aria-label="Annuler">
            <IconArrowBack />
          </button>
          <span className="wac__head-title">Nouvelle discussion</span>
        </div>
        <button
          className="wac__icon-btn"
          onClick={() => setSubview('dialpad')}
          aria-label="Saisir un numéro de téléphone"
          title="Saisir un numéro de téléphone"
        >
          <IconDialPad />
        </button>
      </header>

      <div className="wac__search">
        <div className="wac__search-pill">
          <IconSearch className="wac__search-icon" />
          <input
            className="wac__search-input"
            type="text"
            placeholder="Rechercher un nom ou un numéro"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {q && (
            <button className="wac__search-clear" onClick={() => setQ('')} aria-label="Effacer">
              <IconClose size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="wac__nc-list">
        <button type="button" className="wac__nc-row" onClick={() => setSubview('new-group')}>
          <div className="wac__nc-avatar wac__nc-avatar--action">
            <IconUsers size={22} />
          </div>
          <div className="wac__nc-body">
            <div className="wac__nc-name">Nouveau groupe</div>
          </div>
        </button>
        <button type="button" className="wac__nc-row" onClick={() => setSubview('new-contact')}>
          <div className="wac__nc-avatar wac__nc-avatar--action">
            <IconUserPlus size={22} />
          </div>
          <div className="wac__nc-body">
            <div className="wac__nc-name">Nouveau contact</div>
          </div>
        </button>

        {ownerJid && (
          <button
            type="button"
            className="wac__nc-row wac__nc-row--self"
            onClick={openSelfChat}
            disabled={selfBusy}
          >
            <div className="wac__nc-avatar">
              {ownerPic
                ? <img src={ownerPic} alt="" draggable={false} />
                : <IconUser size={22} />}
            </div>
            <div className="wac__nc-body">
              <div className="wac__nc-name">{ownerName ?? 'Vous'} <span className="wac__nc-tag">(vous)</span></div>
              <div className="wac__nc-sub">
                {selfBusy ? 'Création de la discussion…' : selfError ?? 'Envoyez-vous un message'}
              </div>
            </div>
          </button>
        )}

        {groups.map(([letter, items]) => (
          <div key={letter}>
            <div className="wac__nc-section-label">{letter}</div>
            {items.map((e) => (
              <button
                key={e.key}
                type="button"
                className="wac__nc-row"
                disabled={creating === e.key}
                onClick={() => openContact(e)}
              >
                <div className="wac__nc-avatar">
                  {e.pic
                    ? <img src={e.pic} alt="" draggable={false} />
                    : <IconUser size={22} />}
                </div>
                <div className="wac__nc-body">
                  <div className="wac__nc-name">{e.name}</div>
                  {e.phone && <div className="wac__nc-sub">{e.phone}</div>}
                </div>
              </button>
            ))}
          </div>
        ))}

        {groups.length === 0 && !ownerJid && (
          <div className="wac__list-empty">
            {q
              ? <>Aucun résultat pour « {q} ».</>
              : <>Aucun contact. Importez un répertoire dans la page Contacts.</>}
          </div>
        )}
      </div>
    </div>
  )
}


// ──────────────────────────────────────────────────────────────────────────────
// Dial-pad sub-view
// ──────────────────────────────────────────────────────────────────────────────

interface DialPadViewProps {
  instanceId: string | null
  ownerJid: string | null
  rows: ConversationDecrypted[]
  onCancel: () => void
  onPickConversation: (c: ConversationDecrypted) => void
  onCreatedConversation: (conversationId: string) => void
}

function DialPadView({
  instanceId, ownerJid: _ownerJid, rows, onCancel,
  onPickConversation, onCreatedConversation,
}: DialPadViewProps) {
  const [value, setValue] = useState('+')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const digits = value.replace(/\D/g, '')
  const ready = digits.length >= 6 && digits.length <= 16

  function press(ch: string) {
    setNotice(null)
    if (ch === '<') { setValue((v) => v.slice(0, -1) || '+'); return }
    if (ch === '+') {
      // Toggle leading + (only valid as first char).
      setValue((v) => v.startsWith('+') ? v.slice(1) : `+${v}`)
      return
    }
    setValue((v) => (v + ch).slice(0, 24))
  }

  async function go() {
    if (!ready || busy) return
    // Match by parsed JID user-part so that device-suffixed JIDs
    // ("212…:5@s.whatsapp.net") and the bare form both resolve. Only consider
    // @s.whatsapp.net rows — @lid is a privacy ID, not a phone number, and
    // can't be reached by typing digits.
    const existing = rows.find((c) => {
      const jid = c.remote_jid ?? ''
      const p = parseJid(jid)
      return p.kind === 'phone' && p.user === digits
    })
    if (existing) {
      onPickConversation(existing)
      return
    }
    if (!instanceId) {
      setNotice("Aucune instance connectée. Impossible de créer la discussion.")
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      // IGF FIX (2026-07-07, donor gap): the donor keyed the conversation by
      // the RAW typed digits — a number in local format (e.g. 0762…, no
      // country code) produced a malformed JID that Evolution 400s on every
      // send (dead-lettered queue rows). Validate + CANONICALIZE through the
      // donor's own checkWhatsApp (Evolution onWhatsApp) — the same call
      // NewContactView already makes — and key the conversation by the JID
      // WhatsApp returns.
      const resp = await checkWhatsApp(instanceId, [digits])
      const entry = Array.isArray(resp.result) ? resp.result.find((r) => r.exists && r.jid) : undefined
      if (!entry?.jid) {
        setNotice("Ce numéro n'est pas sur WhatsApp — vérifiez l'indicatif pays (ex. 212 6…).")
        return
      }
      const canonicalJid = entry.jid
      const existingCanonical = rows.find((c) => c.remote_jid === canonicalJid)
      if (existingCanonical) { onPickConversation(existingCanonical); return }
      const { ensureConversation } = await import('../../../lib/conversationCreate')
      const id = await ensureConversation({
        instanceId,
        remoteJid: canonicalJid,
      })
      onCreatedConversation(id)
    } catch (e) {
      setNotice(normalizeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wac__sidebar wac__sidebar--dialpad">
      <header className="wac__head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="wac__icon-btn" onClick={onCancel} aria-label="Retour">
            <IconArrowBack />
          </button>
          <span className="wac__head-title">Numéro de téléphone</span>
        </div>
      </header>

      <div className="wac__dp">
        <div className="wac__dp-input-row">
          <input
            type="tel"
            className="wac__dp-input"
            value={value}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')
              setValue(v || '+')
              setNotice(null)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') go() }}
            autoFocus
            inputMode="tel"
            aria-label="Numéro de téléphone"
          />
        </div>
        <p className="wac__dp-hint">
          Saisissez un numéro de téléphone (format international, ex. +212 6 00 12 34 56)
          pour démarrer une discussion.
        </p>

        <div className="wac__dp-pad">
          {[
            ['1', '']      , ['2', 'ABC']   , ['3', 'DEF'],
            ['4', 'GHI']   , ['5', 'JKL']   , ['6', 'MNO'],
            ['7', 'PQRS']  , ['8', 'TUV']   , ['9', 'WXYZ'],
            ['+', '']      , ['0', '']      , ['<', ''],
          ].map(([key, letters], i) => (
            <button
              key={i}
              type="button"
              className="wac__dp-key"
              onClick={() => press(key!)}
              aria-label={key === '<' ? 'Effacer' : key}
            >
              {key === '<'
                ? <IconBackspace size={22} />
                : <>
                    <span className="wac__dp-key-digit">{key}</span>
                    {letters && <span className="wac__dp-key-letters">{letters}</span>}
                  </>
              }
            </button>
          ))}
        </div>

        {notice && <div className="wac__dp-notice">{notice}</div>}

        <button
          type="button"
          className={'wac__cl-cta wac__dp-cta' + ((ready && !busy) ? ' is-enabled' : '')}
          disabled={!ready || busy}
          onClick={() => { void go() }}
        >
          {busy ? 'Création…' : 'Démarrer la discussion'}
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// New contact sub-view
// ──────────────────────────────────────────────────────────────────────────────

function NewContactView({
  instanceId, onCancel, onCreated,
}: { instanceId: string | null; onCancel: () => void; onCreated: (jid: string, name: string) => void }) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [checking, setChecking] = useState(false)
  const [hasWhatsApp, setHasWhatsApp] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const digits = phone.replace(/\D/g, '')
  const ready = digits.length >= 8 && digits.length <= 16

  useEffect(() => {
    setHasWhatsApp(null)
    setError(null)
    if (!ready || !instanceId) return
    setChecking(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const resp = await checkWhatsApp(instanceId, [digits])
        const result = resp.result
        const found = Array.isArray(result) && result.some((r) => r.exists)
        setHasWhatsApp(found)
      } catch {
        setHasWhatsApp(null)
      } finally {
        setChecking(false)
      }
    }, 600)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [digits, ready, instanceId])

  async function handleSave() {
    if (!instanceId || !hasWhatsApp || !fullName.trim()) return
    setSaving(true)
    setError(null)
    try {
      const jid = `${digits}@s.whatsapp.net`
      await supabase.schema('whatsapp').from('contacts').upsert({
        instance_id: instanceId,
        phone_number: digits,
        phone_jid: jid,
        book_name: fullName.trim(),
        is_resolved: true,
        resolved_at: new Date().toISOString(),
      }, { onConflict: 'instance_id,phone_jid' })
      onCreated(jid, fullName.trim())
    } catch (e) {
      setError(normalizeError(e))
    } finally {
      setSaving(false)
    }
  }

  const canSave = hasWhatsApp === true && fullName.trim().length > 0 && !saving

  return (
    <div className="wac__sidebar wac__sidebar--new-chat">
      <header className="wac__head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
          <button className="wac__icon-btn" onClick={onCancel} aria-label="Retour"><IconArrowBack /></button>
          <span className="wac__head-title">Nouveau contact</span>
        </div>
      </header>

      <div className="wac__ncf">
        <div className="wac__ncf-field">
          <IconUser size={20} />
          <input
            type="text"
            placeholder="Nom complet"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="wac__ncf-field">
          <IconPhone size={20} />
          <input
            type="tel"
            placeholder="Numéro de téléphone (ex: +212...)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        {ready && (
          <div className="wac__ncf-status">
            {checking ? (
              <span className="wac__ncf-status-text">Vérification…</span>
            ) : hasWhatsApp === true ? (
              <span className="wac__ncf-status-text wac__ncf-status-text--ok">Ce numéro utilise WhatsApp</span>
            ) : hasWhatsApp === false ? (
              <span className="wac__ncf-status-text wac__ncf-status-text--no">Ce numéro n'utilise pas WhatsApp</span>
            ) : null}
          </div>
        )}

        {error && <div className="wac__ncf-status"><span className="wac__ncf-status-text wac__ncf-status-text--no">{error}</span></div>}

        <button
          type="button"
          className="wac__ncf-save"
          disabled={!canSave}
          onClick={() => { void handleSave() }}
        >
          <IconCheck size={24} />
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// New group sub-view (2 steps: pick members → name + create)
// ──────────────────────────────────────────────────────────────────────────────

function NewGroupView({
  instanceId, entries, onCancel, onCreated,
}: {
  instanceId: string | null
  entries: ContactEntry[]
  onCancel: () => void
  onCreated: (groupJid: string) => void
}) {
  const [step, setStep] = useState<'members' | 'details'>('members')
  const [selected, setSelected] = useState<Map<string, ContactEntry>>(new Map())
  const [q, setQ] = useState('')
  const [subject, setSubject] = useState('')
  const [groupImage, setGroupImage] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((e) =>
      e.name.toLowerCase().includes(needle) || (e.phone ?? '').includes(needle),
    )
  }, [entries, q])

  const groups = useMemo(() => {
    const map = new Map<string, ContactEntry[]>()
    for (const e of filtered) {
      const first = e.name.replace(/[^\p{L}\d+]/gu, '').slice(0, 1).toUpperCase()
      const key = /[A-ZÀ-Ÿ]/.test(first) ? first : '#'
      const arr = map.get(key) ?? []
      arr.push(e)
      map.set(key, arr)
    }
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name))
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === '#') return 1
      if (b[0] === '#') return -1
      return a[0].localeCompare(b[0])
    })
  }, [filtered])

  function toggleMember(e: ContactEntry) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(e.jid)) next.delete(e.jid)
      else next.set(e.jid, e)
      return next
    })
  }

  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.includes(',') ? result.split(',')[1] : result
      setGroupImage(base64)
    }
    reader.readAsDataURL(file)
  }

  async function handleCreate() {
    if (!instanceId || !subject.trim() || selected.size === 0) return
    setCreating(true)
    setError(null)
    try {
      const participants = [...selected.keys()].map((jid) => jid.replace('@s.whatsapp.net', '').replace('@lid', ''))
      const resp = await createGroup(instanceId, subject.trim(), participants, groupImage ?? undefined)
      // The edge fn already created the conversation row + assigned the creator
      // (server-side, service role) and returns its id — navigate straight to it.
      const convId = (resp as { conversation_id?: string }).conversation_id ?? null
      onCreated(convId ?? '')
    } catch (e) {
      setError((e as Error).message || 'Échec de la création du groupe.')
    } finally {
      setCreating(false)
    }
  }

  if (step === 'details') {
    return (
      <div className="wac__sidebar wac__sidebar--new-chat">
        <header className="wac__head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
            <button className="wac__icon-btn" onClick={() => setStep('members')} aria-label="Retour"><IconArrowBack /></button>
            <span className="wac__head-title">Nouveau groupe</span>
          </div>
        </header>

        <div className="wac__ngf">
          <div className="wac__ngf-top-row">
            <button
              type="button"
              className="wac__ngf-image-picker"
              onClick={() => imageInputRef.current?.click()}
              aria-label="Ajouter une icône au groupe"
            >
              {groupImage
                ? <img src={`data:image/jpeg;base64,${groupImage}`} alt="" draggable={false} />
                : <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              }
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={handleImagePick}
            />
            <input
              type="text"
              className="wac__ngf-name"
              placeholder="Sujet du groupe"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
              maxLength={100}
            />
          </div>

          <div className="wac__ngf-members-label">
            Participants : {selected.size}
          </div>

          <div className="wac__ngf-members-list">
            {[...selected.values()].map((e) => (
              <div key={e.jid} className="wac__ngf-member-chip">
                <div className="wac__ngf-member-pic">
                  {e.pic ? <img src={e.pic} alt="" draggable={false} /> : <IconUser size={16} />}
                </div>
                <span>{e.name}</span>
              </div>
            ))}
          </div>

          {error && <div className="wac__ncf-status"><span className="wac__ncf-status-text wac__ncf-status-text--no">{error}</span></div>}

          <button
            type="button"
            className="wac__ncf-save"
            disabled={!subject.trim() || creating}
            onClick={() => { void handleCreate() }}
          >
            <IconCheck size={24} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="wac__sidebar wac__sidebar--new-chat wac__sidebar--group-add">
      <header className="wac__head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
          <button className="wac__icon-btn" onClick={onCancel} aria-label="Retour"><IconArrowBack /></button>
          <span className="wac__head-title">Ajouter des membres au groupe</span>
        </div>
      </header>

      {selected.size > 0 && (
        <div className="wac__ng-selected">
          {[...selected.values()].map((e) => (
            <div key={e.jid} className="wac__ng-chip" onClick={() => toggleMember(e)}>
              <div className="wac__ng-chip-pic">
                {e.pic ? <img src={e.pic} alt="" draggable={false} /> : <IconUser size={14} />}
              </div>
              <span>{e.name}</span>
              <IconClose size={14} />
            </div>
          ))}
        </div>
      )}

      <div className="wac__search">
        <div className="wac__search-pill">
          <IconSearch className="wac__search-icon" />
          <input
            className="wac__search-input"
            type="text"
            placeholder="Rechercher un nom ou un numéro"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="wac__search-clear" onClick={() => setQ('')} aria-label="Effacer">
              <IconClose size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="wac__nc-list">
        {groups.map(([letter, items]) => (
          <div key={letter}>
            <div className="wac__nc-section-label">{letter}</div>
            {items.map((e) => (
              <button
                key={e.key}
                type="button"
                className={'wac__nc-row' + (selected.has(e.jid) ? ' is-selected' : '')}
                onClick={() => toggleMember(e)}
              >
                <div className="wac__nc-avatar">
                  {e.pic
                    ? <img src={e.pic} alt="" draggable={false} />
                    : <IconUser size={22} />}
                </div>
                <div className="wac__nc-body">
                  <div className="wac__nc-name">{e.name}</div>
                  {e.phone && <div className="wac__nc-sub">{e.phone}</div>}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="wac__ng-next">
          <button
            type="button"
            className="wac__ncf-save"
            onClick={() => setStep('details')}
          >
            <IconForward size={24} />
          </button>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Chat pane — empty state
// ──────────────────────────────────────────────────────────────────────────────

export function EmptyState() {
  return (
    <div className="wac__empty">
      <div className="wac__empty-illu" aria-hidden>
        <IconUsers size={92} />
      </div>
      <h1 className="wac__empty-title">WhatsApp</h1>
      <p className="wac__empty-sub">
        Sélectionnez une discussion pour afficher l'historique, répondre aux messages et gérer
        l'attribution. Les actions sont enregistrées dans le journal d'audit.
      </p>
      <div className="wac__empty-foot">
        <IconLock />
        <span>Vos messages sont chiffrés de bout en bout.</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Connection gate — full-screen takeover so agents know the silence is a dead
// WhatsApp link, not a broken app. Fires whenever the ACTIVE number isn't
// connected (its conversations are stale and unsendable). Cases:
//   • 'none'        → no numbers configured at all
//   • 'disconnected'→ the active number is offline. If OTHER numbers are online
//                     we offer one-click switch; if none are, it's "all down".
// ──────────────────────────────────────────────────────────────────────────────

const INSTANCE_STATUS_FR: Record<string, string> = {
  pending: "En attente d'appairage",
  connecting: 'Connexion…',
  connected: 'Connecté',
  disconnected: 'Déconnecté',
  error: 'Erreur',
}

export interface ConnectionGateInstance {
  id: string
  display_name: string | null
  wa_profile_name: string | null
  profile_pic_url?: string | null
  status: string | null
  status_detail?: string | null
}

const gateName = (i: ConnectionGateInstance) => i.display_name || i.wa_profile_name || 'Numéro'

function GateInstanceAvatar({ ins, size = 30 }: { ins: ConnectionGateInstance; size?: number }) {
  return (
    <span className="wac__gate-av" style={{ width: size, height: size }}>
      {ins.profile_pic_url
        ? <img src={ins.profile_pic_url} alt="" draggable={false} />
        : <IconUser size={Math.round(size * 0.56)} />}
    </span>
  )
}

// Smart "switch to a connected number" control. One connected alt → a single
// pill. Many → a pill for the first plus a chevron that drops the rest, so it
// stays compact no matter how many numbers are online.
function GateSwitchPill({ // (export reverted 2026-07-08 — the SyncingGate that imported it was removed)
  alternatives, onSwitch,
}: {
  alternatives: ConnectionGateInstance[]
  onSwitch: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const primary = alternatives[0]
  const rest = alternatives.slice(1)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!primary) return null

  return (
    <div className="wac__gate-switch" ref={wrapRef}>
      <div className="wac__gate-pill-group">
        <button
          type="button"
          className="wac__gate-pill"
          onClick={() => onSwitch(primary.id)}
          title={`Passer à ${gateName(primary)}`}
        >
          <GateInstanceAvatar ins={primary} />
          <span className="wac__gate-pill-name">{gateName(primary)}</span>
        </button>
        {rest.length > 0 && (
          <button
            type="button"
            className={'wac__gate-chev' + (open ? ' is-open' : '')}
            aria-label="Autres numéros connectés"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <IconChevronDown size={16} />
          </button>
        )}
      </div>

      {open && rest.length > 0 && (
        <div role="listbox" className="wac__gate-menu">
          {rest.map((alt) => (
            <button
              key={alt.id}
              type="button"
              role="option"
              className="wac__gate-menu-item"
              onClick={() => { onSwitch(alt.id); setOpen(false) }}
            >
              <GateInstanceAvatar ins={alt} size={28} />
              <span className="wac__gate-pill-name">{gateName(alt)}</span>
              <span className="wac__gate-dot" data-status="connected" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ConnectionGate({
  kind,
  active,
  alternatives,
  onSwitchInstance,
  onManageNumbers,
}: {
  kind: 'none' | 'disconnected'
  /** The disconnected number being viewed (null for kind === 'none'). */
  active: ConnectionGateInstance | null
  /** Other numbers that ARE connected — offered as one-click switch targets. */
  alternatives: ConnectionGateInstance[]
  onSwitchInstance?: (id: string) => void
  /** Admin-only. When omitted (end-user view), no manage button is shown. */
  onManageNumbers?: () => void
}) {
  const canManage = !!onManageNumbers
  const hasAlts = alternatives.length > 0
  const activeName = active ? gateName(active) : ''
  const activeLabel = active
    ? active.status_detail || INSTANCE_STATUS_FR[active.status ?? ''] || (active.status ?? 'Déconnecté')
    : ''

  let title: string
  let sub: string
  if (kind === 'none') {
    title = 'Aucun numéro WhatsApp'
    sub = canManage
      ? "Aucun numéro WhatsApp n'est appairé. Ajoutez et connectez un numéro pour commencer à recevoir et envoyer des messages."
      : "Aucun numéro WhatsApp n'est appairé. Contactez un administrateur pour connecter un numéro."
  } else if (hasAlts) {
    title = `${activeName} est déconnecté`
    sub = `Le numéro « ${activeName} » n'est pas connecté à WhatsApp — ses conversations sont masquées et aucun message ne peut être envoyé. Passez à un numéro connecté ci-dessous${canManage ? ', ou reconnectez-le' : ''}.`
  } else {
    title = 'Tous les numéros sont déconnectés'
    sub = canManage
      ? "Aucun numéro n'est connecté à WhatsApp en ce moment. Les conversations sont masquées tant qu'aucun numéro n'est en ligne. Reconnectez un numéro (scannez le QR si nécessaire) pour reprendre."
      : "Aucun numéro n'est connecté à WhatsApp en ce moment. Les conversations sont masquées tant qu'aucun numéro n'est en ligne. Un administrateur doit reconnecter un numéro. Le système n'est pas en panne."
  }

  return (
    <div className="wac__empty wac__gate" role="status">
      <div className="wac__empty-illu wac__gate-illu" aria-hidden>
        <IconPhoneOff size={84} />
      </div>
      <h1 className="wac__empty-title">{title}</h1>
      <p className="wac__empty-sub">{sub}</p>

      {kind === 'disconnected' && active && (
        <ul className="wac__gate-list">
          <li className="wac__gate-item">
            <span className="wac__gate-dot" data-status={active.status ?? 'disconnected'} aria-hidden />
            <span className="wac__gate-name">{activeName}</span>
            <span className="wac__gate-status">{activeLabel}</span>
          </li>
        </ul>
      )}

      {kind === 'disconnected' && hasAlts && onSwitchInstance && (
        <div className="wac__gate-alts">
          <span className="wac__gate-alts-label">
            {alternatives.length > 1 ? 'Passer à un numéro connecté' : 'Passer au numéro connecté'}
          </span>
          <GateSwitchPill alternatives={alternatives} onSwitch={onSwitchInstance} />
        </div>
      )}

      {canManage && (
        <button type="button" className="wac__gate-btn wac__gate-btn--ghost" onClick={onManageNumbers}>
          {kind === 'none' ? 'Ajouter un numéro' : 'Gérer les numéros'}
        </button>
      )}

      <div className="wac__empty-foot">
        <IconLock />
        <span>Vos messages sont chiffrés de bout en bout.</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Chat pane — open conversation
// ──────────────────────────────────────────────────────────────────────────────

export interface ChatPaneProps {
  conv: ConversationDecrypted
  messages: MessageDecrypted[]
  onOpenInfo: () => void
  onOpenSearch: () => void
  onLoadOlder?: () => void
  hasMoreOlder?: boolean
  isFetchingOlder?: boolean
  composer: ComposerState
  setComposer: (s: ComposerState) => void
  onSend: () => void
  selfJid: string | null
  ownerPic?: string | null
  // Chat header menu actions (Evolution-API-feasible only)
  isFavorite: boolean
  onToggleFavorite: () => void
  onOpenMedia?: (msg: MessageDecrypted) => void
  allConversations?: ConversationDecrypted[]
  onNavigateToJid?: (jid: string, name?: string) => void
  /** Open a conversation by id (used to jump to the recipient after a forward). */
  onOpenConversation?: (convId: string) => void
  onOpenQuickReplies?: () => void
  onOpenTags?: () => void
  onOpenTagsCreate?: () => void
  onOpenScheduled?: (editId?: string) => void
  /** Smart quick-reply handler for the inline "/" picker (single text → inline,
   *  multi-node → dispatch sequence). Same handler used by the QR panel. */
  onSelectQuickReply?: (qr: QuickReply) => void
  instanceId?: string | null
  conversationTagIds?: string[]
  tags?: Tag[]
  /** IGF ADDITION (e-commerce seam): chat-header cart → create-order dialog.
   *  Button renders only when the handler is provided; cartBadge shows the
   *  in-progress-draft dot. */
  onOpenCart?: () => void
  cartBadge?: boolean
  /** IGF ADDITION (order-history seam): chat-header orders button → the
   *  role-scoped order view dialog. The button renders only when this handler
   *  is provided AND the jid is a real phone (groups/@lid/non-phone: never). */
  onViewOrder?: (orderId: string) => void
  /** Seller inbox: only history rows whose seller_id equals this id are
   *  clickable (null = restricted, id not loaded yet → nothing clickable).
   *  Leave undefined in the admin inbox — every row is clickable. */
  ordersSellerId?: string | null
  /** Admin-only ghost-mode toggle mirrored into the chat header so it can be
   *  flipped mid-conversation. Renders (button + under-header strip) only when
   *  onToggleGhost is provided. */
  ghostMode?: boolean
  onToggleGhost?: () => void
}

export interface ComposerState {
  text: string
  replyTo: MessageDecrypted | null
  mentionedJids?: string[]
  mentionAll?: boolean
}

// ── Media staging (WhatsApp-style pre-send preview) ─────────────────────────
// A batch of files the agent has picked but not yet sent. The staging overlay
// lets them preview each one, caption it (per-item), reorder via the strip,
// add more, or drop individual items before sending. Sending mechanics are
// wired separately — this models the UI state only.
export type StagedKind = 'image' | 'video' | 'document' | 'audio'

export interface StagedItem {
  id: string
  /** Local bytes to upload. Null for remote GIFs (only `remoteUrl` is set). */
  file: File | null
  kind: StagedKind
  name: string
  mime: string
  /** Object URL (local files) or remote URL (GIF) used for preview + thumb. */
  previewUrl: string
  /** Set for GIPHY picks — the source URL; future send fetches bytes from it. */
  remoteUrl?: string
  isGif?: boolean
  /** Audio staged as a voice note (recording) rather than an audio file →
   *  sent with ptt:true (dispatcher routes via sendWhatsAppAudio) and previewed
   *  in the recording style. */
  ptt?: boolean
  /** Per-item caption. Always '' for audio (no caption input is shown). */
  caption: string
}

// Formats that report image/* but that NEITHER browsers can paint NOR WhatsApp
// can render as a photo (Photoshop, TIFF, RAW). They must be staged + sent as
// documents (file card + document message), not images.
const IMAGE_AS_DOC_MIMES = new Set([
  'image/vnd.adobe.photoshop', 'image/x-photoshop', 'image/photoshop',
  'image/tiff', 'image/x-tiff',
])
const IMAGE_AS_DOC_EXTS = new Set(['psd', 'psb', 'tif', 'tiff', 'ai', 'eps'])

function inferStagedKind(mime: string, name = ''): StagedKind {
  const m = mime.toLowerCase()
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (IMAGE_AS_DOC_MIMES.has(m) || IMAGE_AS_DOC_EXTS.has(ext)) return 'document'
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'document'
}

function humanFileSize(bytes: number): string {
  if (!bytes) return ''
  const u = ['o', 'Ko', 'Mo', 'Go']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}

export function ChatPane(p: ChatPaneProps) {
  const name = conversationLabel(p.conv.remote_jid ?? '', p.conv.peer_display_name, p.conv.contact_book_name)
  const isSelf = !!p.selfJid && p.conv.remote_jid === p.selfJid
  const parsed = parseJid(p.conv.remote_jid ?? '')
  const isGroup = !!p.conv.is_group || parsed.kind === 'group'

  // Capacity snapshot for this conversation's instance. Drives both the
  // composer banner (already wired) and the per-bubble blocked-state UI
  // (red ! marker + WhatsApp-style modal).
  const { data: instanceCapacity } = useInstanceCapacityStatus(p.conv.instance_id ?? null)
  const qc = useQueryClient()

  // Optimistically drop a message bubble from the open thread cache (used after
  // cancel/delete of a never-sent message so it disappears instantly).
  const dropMessageFromThread = useCallback((convId: string, msgId: string) => {
    qc.setQueryData<{ pages: { rows: { id?: string }[] }[]; pageParams: unknown[] } | undefined>(
      ['messages', 'thread', convId],
      (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          pages: prev.pages.map((pg) => ({ ...pg, rows: pg.rows.filter((r) => r.id !== msgId) })),
        }
      },
    )
  }, [qc])

  // Modal state for the bubble error/blocked WhatsApp-style dialog
  const [bubbleModal, setBubbleModal] = useState<{
    state: 'failed' | 'blocked-window' | 'blocked-paused' | 'blocked-cap'
    msg: MessageDecrypted
  } | null>(null)

  // Fetch contacts for group sender avatars + names. Paginated (PGRST 1000-row
  // cap): instances already exceed 1000 contacts, so an unpaginated read would
  // drop sender names/avatars for members beyond the first 1000.
  const contactsQ = useQuery({
    queryKey: ['contacts-map', p.conv.instance_id],
    enabled: isGroup && !!p.conv.instance_id,
    queryFn: async () => {
      return await fetchAllWa<{ phone_jid: string | null; lid: string | null; push_name: string | null; profile_pic: string | null; book_name: string | null }>(
        (s) => s.schema('whatsapp').from('contacts')
          .select('id, phone_jid, lid, push_name, profile_pic, book_name')
          .eq('instance_id', p.conv.instance_id!),
      )
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  })
  // Find owner's LID in group_participants so we can display "Vous" for self-mentions
  const ownerLidQ = useQuery({
    queryKey: ['owner-lid', p.conv.instance_id, p.conv.remote_jid],
    enabled: isGroup && !!p.conv.instance_id && !!p.selfJid,
    queryFn: async () => {
      const { data } = await (supabase.schema('whatsapp').from as Function)('group_participants')
        .select('participant_jid')
        .eq('instance_id', p.conv.instance_id!)
        .eq('group_jid', p.conv.remote_jid!)
        .eq('phone_jid', p.selfJid!)
        .maybeSingle() as { data: { participant_jid: string } | null }
      return data?.participant_jid ?? null
    },
    staleTime: 10 * 60 * 1000,
  })

  // Group-scoped participants bridge: LID → phone_jid. Group messages carry
  // the sender as an @lid identifier, but contacts.lid is often empty when
  // the contact row was created via phone-JID (DM) path. Without this bridge
  // the sender label falls back to the raw LID digits.
  const participantsQ = useQuery({
    queryKey: ['chat-group-participants', p.conv.instance_id, p.conv.remote_jid],
    enabled: isGroup && !!p.conv.instance_id && !!p.conv.remote_jid,
    queryFn: async () => {
      const { data } = await (supabase.schema('whatsapp').from as Function)('group_participants')
        .select('participant_jid, phone_jid, push_name, profile_pic')
        .eq('instance_id', p.conv.instance_id!)
        .eq('group_jid', p.conv.remote_jid!) as unknown as {
          data: Array<{
            participant_jid: string
            phone_jid: string | null
            push_name: string | null
            profile_pic: string | null
          }> | null
        }
      return data ?? []
    },
    staleTime: 60 * 1000,
  })

  const contactMap = useMemo(() => {
    const m = new Map<string, { pushName: string | null; pic: string | null; bookName: string | null }>()
    // Pass 1: contacts table — keyed by phone_jid AND lid where available.
    for (const c of contactsQ.data ?? []) {
      const entry = { pushName: c.push_name, pic: c.profile_pic, bookName: c.book_name }
      if (c.phone_jid) m.set(c.phone_jid, entry)
      if (c.lid) m.set(c.lid, entry)
    }
    // Pass 2: group_participants bridge — for each participant LID, attach
    // either (a) its phone-side contact row if known, or (b) its own
    // push_name + pic as a fallback.
    // IGF FIX (2026-07-07, donor-latent): MERGE per-field instead of skipping
    // an already-keyed LID. A frozen-merge split leaves a HOLLOW lid-shell
    // contact (identifier owned, no names) that Pass 1 seeds under the LID;
    // the donor's `continue` let that hollow entry SHADOW the roster bridge,
    // so group senders rendered as raw LID digits — and raced the two queries
    // into a resolve-then-revert flash on reload. (Donor prod carries 14 such
    // shells today — same latent symptom.) Richer existing fields still win.
    for (const pp of participantsQ.data ?? []) {
      const phoneEntry = pp.phone_jid ? m.get(pp.phone_jid) : undefined
      const bridge = phoneEntry ?? {
        pushName: pp.push_name,
        pic: pp.profile_pic,
        bookName: null,
      }
      const existing = m.get(pp.participant_jid)
      if (!existing) { m.set(pp.participant_jid, bridge); continue }
      m.set(pp.participant_jid, {
        pushName: existing.pushName ?? bridge.pushName,
        pic: existing.pic ?? bridge.pic,
        bookName: existing.bookName ?? bridge.bookName,
      })
    }
    // Pass 3: owner LID always renders as "Vous".
    if (ownerLidQ.data) {
      m.set(ownerLidQ.data, { pushName: 'Vous', pic: p.ownerPic ?? null, bookName: null })
    }
    return m
  }, [contactsQ.data, participantsQ.data, ownerLidQ.data, p.ownerPic])

  // Batch-fetch quoted messages for reply bubbles
  const replyIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of p.messages) {
      if (m.reply_to_message_id) ids.add(m.reply_to_message_id)
    }
    return Array.from(ids)
  }, [p.messages])

  const quotedQ = useQuery({
    queryKey: ['quoted-messages', ...replyIds],
    enabled: replyIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .schema('whatsapp').from('messages_decrypted')
        .select('id, body, kind, direction, sender_jid, media_meta, media_mime, media_storage_key, media_pending, whatsapp_timestamp')
        .in('id', replyIds)
      return data ?? []
    },
    staleTime: 30 * 60 * 1000,
  })
  const quotedMap = useMemo(() => {
    const m = new Map<string, { body: string | null; kind: string | null; direction: string | null; senderJid: string | null; mediaMeta: Record<string, unknown> | null; mediaMime: string | null; mediaStorageKey: string | null; mediaPending: boolean | null; whatsappTimestamp: string | null }>()
    for (const q of quotedQ.data ?? []) {
      if (!q.id) continue
      m.set(q.id, {
        body: q.body,
        kind: q.kind,
        direction: q.direction,
        senderJid: q.sender_jid,
        mediaMeta: q.media_meta as Record<string, unknown> | null,
        mediaMime: q.media_mime,
        mediaStorageKey: q.media_storage_key,
        mediaPending: q.media_pending,
        whatsappTimestamp: q.whatsapp_timestamp,
      })
    }
    return m
  }, [quotedQ.data])

  const streamRef = useRef<HTMLDivElement | null>(null)
  const [showFab, setShowFab] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  // Wrapper ref for the chat-header tag button + dropdown. Passed to
  // TagPicker so its outside-click handler treats the trigger as "inside",
  // letting the icon click cleanly toggle the picker open/closed.
  const tagAnchorRef = useRef<HTMLDivElement | null>(null)
  const hasTag = (p.conversationTagIds?.length ?? 0) > 0
  const firstTagColor = hasTag && p.tags?.length
    ? p.tags.find((t) => p.conversationTagIds!.includes(t.id))?.color ?? null
    : null
  const [msgMenuState, setMsgMenuState] = useState<{
    msg: MessageDecrypted
    type: 'context' | 'reaction'
    rect: DOMRect
  } | null>(null)
  const [forwardMode, setForwardMode] = useState(false)
  const [forwardSelected, setForwardSelected] = useState(new Set<string>())
  const [forwardPickerOpen, setForwardPickerOpen] = useState(false)
  const [forwardSending, setForwardSending] = useState(false)
  // Delete select-mode mirrors forward mode; the two are mutually exclusive.
  const [deleteMode, setDeleteMode] = useState(false)
  const [deleteSelected, setDeleteSelected] = useState(new Set<string>())
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<MessageDecrypted | null>(null)
  const [pinTarget, setPinTarget] = useState<MessageDecrypted | null>(null)
  const [contactPickerOpen, setContactPickerOpen] = useState(false)

  // ── Media staging (WhatsApp-style pre-send preview). UI only for now —
  // sending mechanics are wired separately. ─────────────────────────────────
  const [staged, setStaged] = useState<StagedItem[]>([])
  const [activeStageId, setActiveStageId] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const documentInputRef = useRef<HTMLInputElement | null>(null)
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const audioRecInputRef = useRef<HTMLInputElement | null>(null)
  const addMoreInputRef = useRef<HTMLInputElement | null>(null)
  // Keep a live ref to staged items so unmount cleanup can revoke object URLs
  // without re-binding the effect on every change.
  const stagedRef = useRef<StagedItem[]>([])
  stagedRef.current = staged
  useEffect(() => () => {
    for (const it of stagedRef.current) {
      if (!it.remoteUrl) URL.revokeObjectURL(it.previewUrl)
    }
  }, [])

  const addStagedFiles = useCallback((files: FileList | File[], forceKind?: StagedKind, opts?: { ptt?: boolean }) => {
    const arr = Array.from(files)
    if (arr.length === 0) return
    const next: StagedItem[] = arr.map((f) => {
      const mime = f.type || 'application/octet-stream'
      return {
        id: crypto.randomUUID(),
        file: f,
        kind: forceKind ?? inferStagedKind(mime, f.name),
        name: f.name,
        mime,
        previewUrl: URL.createObjectURL(f),
        ...(opts?.ptt ? { ptt: true } : {}),
        caption: '',
      }
    })
    setStaged((prev) => [...prev, ...next])
    setActiveStageId((cur) => cur ?? next[0]!.id)
  }, [])

  // gifUrl = animated .gif used for the staging preview (an <img> shows it
  // looping while choosing); mp4Url = what actually gets sent, as a video
  // (Evolution can't do gifPlayback, so the recipient sees a video — but in
  // OUR thread media_meta.isGif makes GifBody render it as a looping gif).
  const addStagedGif = useCallback((gifUrl: string, mp4Url: string) => {
    const item: StagedItem = {
      id: crypto.randomUUID(),
      file: null,
      kind: 'video',
      name: 'GIF.mp4',
      mime: 'video/mp4',
      previewUrl: gifUrl,
      remoteUrl: mp4Url,
      isGif: true,
      caption: '',
    }
    setStaged((prev) => [...prev, item])
    setActiveStageId((cur) => cur ?? item.id)
  }, [])

  // ── Drag & drop files onto the conversation (WhatsApp Web parity) ──────────
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const onChatDragEnter = (e: React.DragEvent) => {
    if (forwardMode || deleteMode || !isFileDrag(e)) return
    e.preventDefault()
    dragDepthRef.current += 1
    setDragActive(true)
  }
  const onChatDragOver = (e: React.DragEvent) => {
    if (forwardMode || deleteMode || !isFileDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onChatDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }
  const onChatDrop = (e: React.DragEvent) => {
    dragDepthRef.current = 0
    setDragActive(false)
    if (forwardMode || deleteMode || !isFileDrag(e)) return
    e.preventDefault()
    const files = e.dataTransfer.files
    if (files && files.length > 0) addStagedFiles(files)
  }

  // ── Paste image/video from the clipboard → stage like a drop (WhatsApp Web
  //    parity: Ctrl/Cmd+V a copied image and it goes straight to the send tray).
  //    Window-level so it works whether or not the composer is focused; only
  //    acts on media files, so plain-text paste into the composer is untouched.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (forwardMode || deleteMode) return
      const dt = e.clipboardData
      if (!dt) return
      const isMedia = (t: string) => /^(image|video)\//.test(t)
      const picked: File[] = []
      // Files first (most browsers), then items (Safari / older paths).
      if (dt.files && dt.files.length) {
        for (const f of Array.from(dt.files)) if (isMedia(f.type)) picked.push(f)
      }
      if (picked.length === 0 && dt.items) {
        for (const it of Array.from(dt.items)) {
          if (it.kind === 'file' && isMedia(it.type)) {
            const f = it.getAsFile()
            if (f) picked.push(f)
          }
        }
      }
      if (picked.length === 0) return   // no media on the clipboard → default paste
      e.preventDefault()
      // Clipboard blobs are usually nameless — synthesize one so the caption,
      // filename and kind inference all work like a picked file.
      const named = picked.map((f) => {
        if (f.name && f.name.trim()) return f
        const ext = (f.type.split('/')[1] || 'png').split('+')[0]
        return new File([f], `image-collée.${ext}`, { type: f.type })
      })
      addStagedFiles(named)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [forwardMode, deleteMode, addStagedFiles])

  const removeStaged = useCallback((id: string) => {
    setStaged((prev) => {
      const idx = prev.findIndex((i) => i.id === id)
      if (idx < 0) return prev
      const item = prev[idx]!
      if (!item.remoteUrl) URL.revokeObjectURL(item.previewUrl)
      const rest = prev.filter((i) => i.id !== id)
      setActiveStageId((cur) => (cur === id ? (rest[Math.min(idx, rest.length - 1)]?.id ?? null) : cur))
      return rest
    })
  }, [])

  const setStagedCaption = useCallback((id: string, caption: string) => {
    setStaged((prev) => prev.map((i) => (i.id === id ? { ...i, caption } : i)))
  }, [])

  const clearStaging = useCallback(() => {
    setStaged((prev) => {
      for (const it of prev) if (!it.remoteUrl) URL.revokeObjectURL(it.previewUrl)
      return []
    })
    setActiveStageId(null)
  }, [])

  // Reset the file <input> value after a pick so choosing the same file twice
  // still fires onChange.
  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>, forceKind?: StagedKind, opts?: { ptt?: boolean }) => {
    if (e.target.files) addStagedFiles(e.target.files, forceKind, opts)
    e.target.value = ''
  }, [addStagedFiles])

  // Unknown-contact "add to contacts" — a header affordance (was an in-stream
  // banner). Shown only for unknown DM peers; disappears once saved (the
  // conversation's contact_book_name lands on refetch).
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [contactName, setContactName] = useState('')
  const [contactSaving, setContactSaving] = useState(false)
  const upsertContact = useUpsertContact()

  function saveContact() {
    if (!contactName.trim() || !p.conv.instance_id) return
    const phone = parsed.kind === 'phone' ? parsed.user : p.conv.remote_jid?.replace('@s.whatsapp.net', '') ?? ''
    if (!phone) return
    setContactSaving(true)
    upsertContact.mutate(
      { instanceId: p.conv.instance_id, phoneNumber: phone, bookName: contactName.trim() },
      {
        onSuccess: () => {
          setAddContactOpen(false)
          setContactName('')
          setContactSaving(false)
        },
        onError: () => setContactSaving(false),
      },
    )
  }

  const handleBubbleAction = useCallback((action: string, msg: MessageDecrypted, rect: DOMRect) => {
    if (action === 'context' || action === 'reaction') {
      setMsgMenuState({ msg, type: action as 'context' | 'reaction', rect })
      return
    }
    if (action === 'forward') {
      if (msg.id) { setForwardSelected(new Set([msg.id])); setForwardPickerOpen(true) }
      return
    }
    if (action.startsWith('blocked:')) {
      const state = action.slice('blocked:'.length) as 'failed' | 'blocked-window' | 'blocked-paused' | 'blocked-cap'
      setBubbleModal({ state, msg })
      return
    }
  }, [])

  const handleForwardToggle = useCallback((msgId: string) => {
    setForwardSelected(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }, [])

  // Enter forward mode, leaving delete mode (mutually exclusive).
  const enterForwardMode = useCallback((msgId: string) => {
    setDeleteMode(false); setDeleteSelected(new Set()); setDeleteModalOpen(false)
    setForwardMode(true); setForwardSelected(new Set([msgId]))
  }, [])

  // Enter delete select-mode preselecting the clicked message, leaving forward.
  const enterDeleteMode = useCallback((msgId: string) => {
    setForwardMode(false); setForwardSelected(new Set()); setForwardPickerOpen(false)
    setDeleteMode(true); setDeleteSelected(new Set([msgId]))
  }, [])

  const exitDeleteMode = useCallback(() => {
    setDeleteMode(false); setDeleteSelected(new Set()); setDeleteModalOpen(false)
  }, [])

  const handleDeleteToggle = useCallback((msgId: string) => {
    setDeleteSelected(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }, [])

  // --- Initial-scroll machinery ---
  // When switching conversations, messages load asynchronously. The old
  // useEffect fired on an empty DOM and the scroll target was wrong.
  // useLayoutEffect runs before paint, so the user never sees a stale position.
  const needsInitialScroll = useRef(true)

  useLayoutEffect(() => {
    needsInitialScroll.current = true
    prevScrollSnap.current = null
    lastIdRef.current = null
  }, [p.conv.id])

  useLayoutEffect(() => {
    if (!needsInitialScroll.current) return
    if (p.messages.length === 0) return
    const el = streamRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    needsInitialScroll.current = false
  }, [p.messages])

  // Preserve scroll position when older messages are prepended.
  // Before React commits new DOM nodes, snapshot scrollHeight.
  // After commit, adjust scrollTop by the delta so the user stays in place.
  const prevScrollSnap = useRef<{ height: number; topMsgId: string | null } | null>(null)
  const prevMsgCount = useRef(0)

  // Capture snapshot before DOM update (when messages array is about to grow at the top)
  const firstMsgId = p.messages[0]?.id ?? null
  if (
    p.messages.length > prevMsgCount.current &&
    prevScrollSnap.current &&
    prevScrollSnap.current.topMsgId !== firstMsgId
  ) {
    // Messages were prepended — we have a pending snap to restore
  }

  // Take snapshot when a fetch starts (before the new data arrives)
  useEffect(() => {
    if (p.isFetchingOlder) {
      const el = streamRef.current
      if (el) {
        prevScrollSnap.current = { height: el.scrollHeight, topMsgId: firstMsgId }
      }
    }
  }, [p.isFetchingOlder, firstMsgId])

  // After messages change, restore scroll position if older messages were prepended.
  // useLayoutEffect so adjustment happens before paint — no visible jump.
  useLayoutEffect(() => {
    const el = streamRef.current
    if (!el) return
    const snap = prevScrollSnap.current
    if (snap && snap.topMsgId !== firstMsgId) {
      const delta = el.scrollHeight - snap.height
      if (delta > 0) {
        el.scrollTop += delta
      }
      prevScrollSnap.current = null
    }
    prevMsgCount.current = p.messages.length
  }, [p.messages, firstMsgId])

  // FAB visibility + top-load trigger
  useEffect(() => {
    const el = streamRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
      setShowFab(distFromBottom > 200)
      if (el.scrollTop < 240 && p.hasMoreOlder && !p.isFetchingOlder) p.onLoadOlder?.()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [p.hasMoreOlder, p.onLoadOlder, p.isFetchingOlder, p.conv.id])

  // Auto-scroll when a new outbound is appended
  const lastIdRef = useRef<string | null>(null)
  useEffect(() => {
    const last = p.messages[p.messages.length - 1]
    if (!last) return
    if (last.id !== lastIdRef.current) {
      lastIdRef.current = last.id ?? null
      const el = streamRef.current
      if (!el) return
      const dist = el.scrollHeight - el.clientHeight - el.scrollTop
      if (dist < 200) el.scrollTop = el.scrollHeight
    }
  }, [p.messages])

  // Auto-scroll when the peer starts typing/recording — same near-bottom
  // gate as new-message scroll so we never yank the user mid-scroll-back.
  const peerWasTypingRef = useRef(false)

  // Filter out any leftover reaction-kind messages (they're now aggregated on targets)
  const visibleMessages = useMemo(
    () => p.messages.filter((m) => m.kind !== 'reaction'),
    [p.messages],
  )

  const dayed = useDayBuckets(visibleMessages)

  // Optimistic outbound media bubbles (client-only) for files still
  // uploading / awaiting enqueue. Scoped to this conversation; rendered below
  // the loaded thread (always the newest). Kept OUT of the thread cache so the
  // id-keyed realtime patcher never touches them.
  const pendingUploads = usePendingUploads(p.conv.id)
  // Drop an optimistic bubble once its real message row (the id sendMessage
  // returned) lands in the thread — via sendMessage resolve → wa:conv insert,
  // or a reconnect refetch. This is the ONLY removal-on-success path, so there
  // is no double bubble and no flicker.
  useEffect(() => {
    if (pendingUploads.length === 0) return
    const ids = new Set<string>()
    for (const m of visibleMessages) if (m.id) ids.add(m.id)
    for (const pu of pendingUploads) {
      if (pu.sentMessageId && ids.has(pu.sentMessageId)) removePendingUpload(pu.clientId)
    }
  }, [pendingUploads, visibleMessages])
  // Snap to the newest optimistic bubble the moment one is added (the user just
  // hit send). Growth-only so it never yanks the view while scrolled back.
  const pendingCountRef = useRef(0)
  useEffect(() => {
    if (pendingUploads.length > pendingCountRef.current) {
      const el = streamRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
    pendingCountRef.current = pendingUploads.length
  }, [pendingUploads.length])

  // Realtime WhatsApp peer-presence — subscribed once per instance, returns a
  // Map keyed by remote_jid. We pick the entry for this conversation.
  const peerPresence = useWaPeerPresence(p.instanceId ?? null, p.conv.remote_jid ?? null)
  const peerTypingState = peerPresence.get(p.conv.remote_jid ?? '')
  const peerIsTyping = !!peerTypingState && (
    peerTypingState.presence === 'composing' || peerTypingState.presence === 'recording'
  )
  // In groups, surface which participant is typing if we can resolve them.
  const peerTypingName = peerIsTyping && peerTypingState?.participant_jid
    ? (contactMap.get(peerTypingState.participant_jid)?.bookName
       || contactMap.get(peerTypingState.participant_jid)?.pushName
       || null)
    : null

  // When peer typing/recording transitions from false → true, scroll to
  // bottom IF the user was already near the bottom. Mirrors the new-message
  // auto-scroll gate so we don't yank them away from a scroll-back.
  useEffect(() => {
    const wasTyping = peerWasTypingRef.current
    peerWasTypingRef.current = peerIsTyping
    if (!peerIsTyping || wasTyping) return
    const el = streamRef.current
    if (!el) return
    const dist = el.scrollHeight - el.clientHeight - el.scrollTop
    if (dist < 240) {
      // Defer one frame so the typing-bubble DOM is in place before scrolling.
      requestAnimationFrame(() => {
        if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight
      })
    }
  }, [peerIsTyping])

  const status = peerIsTyping
    ? (peerTypingState?.presence === 'recording'
        ? (peerTypingName ? `${peerTypingName} enregistre…` : 'enregistre un message vocal…')
        : (peerTypingName ? `${peerTypingName} écrit…` : "en train d'écrire…"))
    : p.conv.status === 'snoozed'
    ? 'En sommeil'
    : isGroup
      ? 'Discussion de groupe'
      : parsed.kind === 'phone'
        ? formatPhone(parsed.user)
        : 'En ligne récemment'

  return (
    <div
      className="wac__chat"
      onDragEnter={onChatDragEnter}
      onDragOver={onChatDragOver}
      onDragLeave={onChatDragLeave}
      onDrop={onChatDrop}
    >
      {dragActive && (
        <div className="wac__dropzone" aria-hidden="true">
          <div className="wac__dropzone-frame">
            <span className="wac__dropzone-text">Faites glisser le fichier ici</span>
          </div>
        </div>
      )}
      <header className="wac__chathead">
        <div className="wac__chathead-id" onClick={p.onOpenInfo} role="button" tabIndex={0}>
          <div className="wac__chathead-avatar">
            {p.conv.peer_profile_pic
              ? <img src={p.conv.peer_profile_pic} alt="" draggable={false} />
              : isGroup ? <IconUsers size={22} /> : <IconUser size={22} />}
          </div>
          <div className="wac__chathead-meta">
            <span className="wac__chathead-name">{name}{isSelf && <span className="wac__nc-tag"> (vous)</span>}</span>
            <span className="wac__chathead-status">{status}</span>
          </div>
        </div>
        <div className="wac__chathead-actions">
          {/* Admin-only ghost mode, mirrored here so it can be flipped mid-
              conversation (arm on/off without leaving the thread). */}
          {p.onToggleGhost && (
            <button
              className={'wac__icon-btn wac__ghost-btn' + (p.ghostMode ? ' is-ghost' : '')}
              aria-label={p.ghostMode ? 'Mode fantôme actif' : 'Mode fantôme'}
              aria-pressed={!!p.ghostMode}
              title={p.ghostMode ? 'Mode fantôme actif — aucune trace' : 'Mode fantôme'}
              onClick={p.onToggleGhost}
            >
              <IconGhost size={20} />
            </button>
          )}
          {/* IGF ADDITION (order-history seam): customer order history. */}
          {p.onViewOrder && parsed.kind === 'phone' && (
            <CustomerOrdersButton
              phoneDigits={parsed.user}
              onViewOrder={p.onViewOrder}
              restrictToSellerId={p.ordersSellerId}
            />
          )}
          {/* IGF ADDITION (e-commerce seam): cart → create-order dialog. */}
          {p.onOpenCart && (
            <button
              className="wac__icon-btn wac__cart-btn"
              aria-label="Créer une commande"
              title="Créer une commande"
              onClick={p.onOpenCart}
            >
              <IconCart size={20} />
              {p.cartBadge && <span className="wac__cart-dot" aria-hidden />}
            </button>
          )}
          <button
            className="wac__icon-btn"
            aria-label="Rechercher"
            title="Rechercher"
            onClick={p.onOpenSearch}
          >
            <IconSearch />
          </button>
          <div className="wac__chathead-tag-anchor" ref={tagAnchorRef}>
            <button
              className="wac__icon-btn"
              aria-label="Étiquette"
              title="Étiquette"
              onClick={() => setTagPickerOpen((v) => !v)}
              style={firstTagColor ? { color: firstTagColor } : undefined}
            >
              {hasTag ? <IconTagFilled size={20} /> : <IconTag size={20} />}
            </button>
            {tagPickerOpen && p.conv.id && (
              <TagPicker
                instanceId={p.instanceId ?? null}
                conversationId={p.conv.id}
                onClose={() => setTagPickerOpen(false)}
                onCreate={() => {
                  setTagPickerOpen(false)
                  // Prefer the "jump directly to create form" handler when
                  // wired; fall back to opening the tags list panel.
                  if (p.onOpenTagsCreate) p.onOpenTagsCreate()
                  else p.onOpenTags?.()
                }}
                anchorRef={tagAnchorRef}
              />
            )}
          </div>
          {!isGroup && !isSelf && !p.conv.contact_book_name && (
            <button
              className="wac__icon-btn"
              aria-label="Ajouter aux contacts"
              title="Ajouter aux contacts"
              onClick={() => setAddContactOpen(true)}
            >
              <IconUserPlus size={20} />
            </button>
          )}
          <button
            className="wac__icon-btn"
            aria-label={p.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            title={p.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            onClick={p.onToggleFavorite}
          >
            {p.isFavorite ? <IconHeartFilled size={20} /> : <IconHeart size={20} />}
          </button>
        </div>
      </header>

      {p.onToggleGhost && p.ghostMode && (
        <div className="wac__ghost-strip" role="status">
          <IconGhost size={15} />
          <span>Mode fantôme — vos lectures ne sont pas envoyées, le compteur non-lu reste inchangé.</span>
        </div>
      )}

      <PinnedBar conversationId={p.conv.id ?? null} />

      {/* Hidden file inputs that back the composer attach menu + staging "+". */}
      <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => onFileInput(e)} />
      <input ref={documentInputRef} type="file" multiple hidden onChange={(e) => onFileInput(e, 'document')} />
      <input ref={audioInputRef} type="file" accept="audio/*" multiple hidden onChange={(e) => onFileInput(e, 'audio')} />
      <input ref={audioRecInputRef} type="file" accept="audio/*" multiple hidden onChange={(e) => onFileInput(e, 'audio', { ptt: true })} />
      <input ref={addMoreInputRef} type="file" accept="image/*,video/*,audio/*,application/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" multiple hidden onChange={(e) => onFileInput(e)} />

      {staged.length > 0 && (
        <MediaStagingOverlay
          items={staged}
          activeId={activeStageId}
          onSetActive={setActiveStageId}
          onRemove={removeStaged}
          onCaptionChange={setStagedCaption}
          onAddMore={() => addMoreInputRef.current?.click()}
          onClose={clearStaging}
          onSend={() => {
            const convId = p.conv.id
            if (!convId) return
            const items = staged
            clearStaging()
            // Resolve each staged item to bytes + size-check, then hand it to the
            // pending-uploads store. The store drives the R2 PUT (progress /
            // cancel / retry rendered as an optimistic in-thread bubble) and then
            // the NORMAL paced sendMessage — one send per file, no album, no
            // blasting, no bypass of the ban-avoidance chokepoint.
            void (async () => {
              for (const it of items) {
                try {
                  let blob: Blob | null = it.file
                  if (!blob && it.remoteUrl) {
                    const r = await fetch(it.remoteUrl)
                    if (r.ok) blob = await r.blob()
                  }
                  if (!blob) continue
                  // Client-side size pre-check: catch over-limit media instantly with a clear
                  // message instead of a silent failure downstream at WhatsApp (~16MB inline).
                  // No optimistic bubble for these — they can never send.
                  const sizeErr = mediaSizeError(it.kind, blob.size)
                  if (sizeErr) { toast.error(sizeErr, { title: it.name }); continue }
                  // GIFs are sent as a video (Evolution has no gifPlayback);
                  // media_meta.isGif makes our own thread loop it like a real gif.
                  enqueuePendingUpload({
                    conversationId: convId,
                    kind: it.kind,
                    name: it.name,
                    mime: it.mime,
                    blob,
                    caption: it.caption,
                    ptt: it.ptt,
                    isGif: it.isGif,
                  })
                } catch (err) {
                  console.error('staged send failed:', it.name, err)
                  toast.error(normalizeError(err), { title: it.name })
                }
              }
            })()
          }}
        />
      )}

      {addContactOpen && (
        <div className="wac__modal-overlay" onClick={() => setAddContactOpen(false)}>
          <div className="wac__modal" onClick={(e) => e.stopPropagation()}>
            <div className="wac__modal-head">
              <span>Ajouter aux contacts</span>
              <button className="wac__icon-btn" onClick={() => setAddContactOpen(false)}><IconClose size={18} /></button>
            </div>
            <div className="wac__modal-body">
              <label className="wac__modal-label">Nom</label>
              <input
                className="wac__modal-input"
                placeholder="Nom du contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && contactName.trim()) saveContact() }}
              />
              <div className="wac__modal-phone">{parsed.kind === 'phone' ? formatPhone(parsed.user) : p.conv.remote_jid}</div>
            </div>
            <div className="wac__modal-footer">
              <button className="wac__modal-btn wac__modal-btn--cancel" onClick={() => setAddContactOpen(false)}>Annuler</button>
              <button className="wac__modal-btn wac__modal-btn--save" disabled={!contactName.trim() || contactSaving} onClick={saveContact}>
                {contactSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="wac__stream" ref={streamRef}>
        {p.isFetchingOlder && (
          <div className="wac__stream-loader">
            <div className="wac__stream-spinner" />
          </div>
        )}
        {dayed.map((g) => (
          <div key={g.key} style={{ display: 'contents' }}>
            <div className="wac__day">{g.label}</div>
            {(() => {
              const items = groupMediaAlbums(g.messages, isGroup)
              return items.map((item, idx) => {
                const prevItem = items[idx - 1]
                const nextItem = items[idx + 1]
                const firstMsg = item.type === 'single' ? item.msg : item.messages[0]
                const lastMsg = item.type === 'single' ? item.msg : item.messages[item.messages.length - 1]
                const prevMsg = prevItem ? (prevItem.type === 'single' ? prevItem.msg : prevItem.messages[prevItem.messages.length - 1]) : undefined
                const nextMsg = nextItem ? (nextItem.type === 'single' ? nextItem.msg : nextItem.messages[0]) : undefined
                const isOut = firstMsg.direction === 'outbound'
                const sameSenderPrev = prevMsg && prevMsg.direction === firstMsg.direction && isSameSender(prevMsg, firstMsg, isGroup)
                const sameSenderNext = nextMsg && nextMsg.direction === lastMsg.direction && isSameSender(lastMsg, nextMsg, isGroup)

                if (item.type === 'album') {
                  const allIds = item.messages.map(m => m.id!)
                  const allSelected = allIds.every(id => forwardSelected.has(id))
                  const allDeleteSelected = allIds.every(id => deleteSelected.has(id))
                  return (
                    <AlbumBubble
                      key={`album-${firstMsg.id}`}
                      messages={item.messages}
                      isOut={isOut}
                      streakHead={!sameSenderPrev}
                      streakTail={!sameSenderNext}
                      isGroup={isGroup}
                      onOpenMedia={p.onOpenMedia}
                      contactMap={contactMap}
                      forwardMode={forwardMode}
                      forwardSelected={allSelected}
                      onForwardToggle={() => {
                        setForwardSelected(prev => {
                          const next = new Set(prev)
                          if (allSelected) allIds.forEach(id => next.delete(id))
                          else allIds.forEach(id => next.add(id))
                          return next
                        })
                      }}
                      deleteMode={deleteMode}
                      deleteSelected={allDeleteSelected}
                      onDeleteToggle={() => {
                        setDeleteSelected(prev => {
                          const next = new Set(prev)
                          if (allDeleteSelected) allIds.forEach(id => next.delete(id))
                          else allIds.forEach(id => next.add(id))
                          return next
                        })
                      }}
                    />
                  )
                }

                const m = item.msg
                // Consecutive-audio chain (WhatsApp): when this audio ends,
                // the bubble below auto-plays IFF it is also an audio — any
                // other kind (text, image, …) breaks the chain.
                const autoAdvanceToId =
                  m.kind === 'audio' && nextMsg?.kind === 'audio' ? nextMsg.id ?? null : null
                return (
                  <Bubble
                    key={m.id ?? `${m.whatsapp_timestamp}-${idx}`}
                    msg={m}
                    isOut={isOut}
                    streakHead={!sameSenderPrev}
                    streakTail={!sameSenderNext}
                    isGroup={isGroup}
                    selfJid={p.selfJid}
                    peerPic={p.conv.peer_profile_pic}
                    ownerPic={p.ownerPic ?? null}
                    onOpenMedia={p.onOpenMedia}
                    contactMap={contactMap}
                    quotedMap={quotedMap}
                    convName={name}
                    onReply={(m) => p.setComposer({ ...p.composer, replyTo: m })}
                    onAction={handleBubbleAction}
                    forwardMode={forwardMode}
                    forwardSelected={forwardSelected.has(m.id!)}
                    onForwardToggle={handleForwardToggle}
                    deleteMode={deleteMode}
                    deleteSelected={deleteSelected.has(m.id!)}
                    onDeleteToggle={handleDeleteToggle}
                    onNavigateToJid={p.onNavigateToJid}
                    autoAdvanceToId={autoAdvanceToId}
                    instanceCapacity={instanceCapacity ?? null}
                    groupMemberCount={participantsQ.data?.length ?? 0}
                  />
                )
              })
            })()}
          </div>
        ))}
        {dayed.length === 0 && (
          <div className="wac__system">
            <span className="wac__system-row">
              <IconShield />
              Les messages sont chiffrés de bout en bout. Personne en dehors de cette
              discussion ne peut les lire ou les écouter.
            </span>
          </div>
        )}
        {/* Optimistic outbound uploads — always the newest, below the thread.
            Hide any whose real row is already visible (the removal effect runs
            post-commit; filtering here kills the one-frame double bubble when
            the wa:conv insert beats the sendMessage response). */}
        {(() => {
          if (pendingUploads.length === 0) return null
          const visibleIds = new Set<string>()
          for (const m of visibleMessages) if (m.id) visibleIds.add(m.id)
          return pendingUploads
            .filter((pu) => !(pu.sentMessageId && visibleIds.has(pu.sentMessageId)))
            .map((pu) => <PendingUploadBubble key={pu.clientId} pu={pu} />)
        })()}
        {peerIsTyping && (
          // Render through the canonical .wac__bubble-wrap so the typing
          // bubble's left edge lines up pixel-for-pixel with real incoming
          // bubbles — same flex gap, same group-avatar gutter, same is-in
          // justify-content. Marked as streak-head only structurally (no
          // .wac__bubble child means the CSS tail selector won't fire; the
          // tail is owned by <TypingIndicator>).
          <div
            className={
              'wac__bubble-wrap is-in'
              + (isGroup ? ' is-group-in' : '')
            }
            style={{ marginTop: 8, marginBottom: 4 }}
          >
            {isGroup && <div className="wac__group-avatar is-spacer" aria-hidden />}
            <TypingIndicator
              mode="bubble"
              presence={peerTypingState?.presence === 'recording' ? 'recording' : 'composing'}
            />
          </div>
        )}
      </div>

      <button
        className={'wac__fab' + (showFab ? ' is-visible' : '')}
        aria-label="Aller au dernier message"
        title="Aller au dernier message"
        onClick={() => {
          const el = streamRef.current
          if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        }}
      >
        <IconScrollDown />
      </button>

      {msgMenuState && (
        <MessageContextMenu
          msg={msgMenuState.msg}
          rect={msgMenuState.rect}
          type={msgMenuState.type}
          isOut={msgMenuState.msg.direction === 'outbound'}
          onReply={(m) => { p.setComposer({ ...p.composer, replyTo: m }); setMsgMenuState(null) }}
          onClose={() => setMsgMenuState(null)}
          onForward={(m) => { if (m.id) enterForwardMode(m.id) }}
          onEdit={(m) => setEditTarget(m)}
          onDelete={(m) => { if (m.id) enterDeleteMode(m.id) }}
          onPin={(m) => setPinTarget(m)}
        />
      )}
      {pinTarget && (
        <PinDurationModal
          onCancel={() => setPinTarget(null)}
          onConfirm={(expiresAt) => {
            const id = pinTarget.id
            setPinTarget(null)
            if (id) void setMessagePin(id, true, expiresAt).catch((e) => toast.error(normalizeError(e)))
          }}
        />
      )}

      {!forwardMode && !deleteMode && isGroup && p.conv.left_at && (
        <div className="wac__left-group-notice">
          Vous ne pouvez pas envoyer de messages à ce groupe, car vous n’en faites plus partie.
        </div>
      )}

      {!forwardMode && !deleteMode && !(isGroup && p.conv.left_at) && (
        <Composer
          state={p.composer}
          setState={p.setComposer}
          onSend={p.onSend}
          convName={name}
          isGroup={isGroup}
          contactMap={contactMap}
          conv={p.conv}
          selfJid={p.selfJid}
          ownerPic={p.ownerPic}
          onOpenQuickReplies={p.onOpenQuickReplies}
          onOpenTags={p.onOpenTags}
          onOpenScheduled={p.onOpenScheduled}
          onSelectQuickReply={p.onSelectQuickReply}
          instanceId={p.instanceId}
          conversationId={p.conv.id ?? null}
          onPickPhotos={() => photoInputRef.current?.click()}
          onPickDocument={() => documentInputRef.current?.click()}
          onPickAudio={() => audioInputRef.current?.click()}
          onPickAudioRecording={() => audioRecInputRef.current?.click()}
          onSelectGif={addStagedGif}
          onOpenContacts={() => setContactPickerOpen(true)}
        />
      )}

      {contactPickerOpen && (
        <ContactPickerModal
          instanceId={p.instanceId ?? p.conv.instance_id ?? null}
          onClose={() => setContactPickerOpen(false)}
          onSend={async (cards) => {
            const convId = p.conv.id
            const share = buildContactShare(cards)
            if (!convId || !share) { setContactPickerOpen(false); return }
            try {
              await sendMessage({ conversationId: convId, kind: 'contact', body: share.body, mediaMeta: share.mediaMeta })
            } catch (e) {
              console.error('Send contact failed:', e)
              toast.error(normalizeError(e))
            } finally {
              setContactPickerOpen(false)
            }
          }}
        />
      )}

      {forwardMode && (
        <div className="wac__forward-bar">
          <button
            className="wac__forward-bar-close"
            onClick={() => { setForwardMode(false); setForwardSelected(new Set()) }}
          >
            <IconClose size={20} />
          </button>
          <span className="wac__forward-bar-count">
            {forwardSelected.size} sélectionné{forwardSelected.size > 1 ? 's' : ''}
          </span>
          <button
            className="wac__forward-bar-send"
            disabled={forwardSelected.size === 0}
            onClick={() => setForwardPickerOpen(true)}
          >
            <IconForwardAll size={24} />
          </button>
        </div>
      )}

      {deleteMode && (
        <div className="wac__forward-bar">
          <button className="wac__forward-bar-close" onClick={exitDeleteMode}>
            <IconClose size={20} />
          </button>
          <span className="wac__forward-bar-count">
            {deleteSelected.size} sélectionné{deleteSelected.size > 1 ? 's' : ''}
          </span>
          <button
            className="wac__forward-bar-send"
            disabled={deleteSelected.size === 0}
            onClick={() => setDeleteModalOpen(true)}
            aria-label="Supprimer"
          >
            <IconTrash size={22} />
          </button>
        </div>
      )}

      {deleteModalOpen && (
        <DeleteMessageModal
          messages={p.messages.filter((m) => m.id && deleteSelected.has(m.id))}
          onDeleteForMe={async () => {
            const ids = [...deleteSelected]
            try { for (const id of ids) await deleteMessageForMe(id) }
            catch (e) { console.error('Delete for me failed:', e); toast.error(normalizeError(e)) }
            finally { exitDeleteMode() }
          }}
          onDeleteForEveryone={async () => {
            const ids = [...deleteSelected]
            try { for (const id of ids) await deleteMessageForEveryone(id) }
            catch (e) { console.error('Delete for everyone failed:', e); toast.error(normalizeError(e)) }
            finally { exitDeleteMode() }
          }}
          onClose={() => setDeleteModalOpen(false)}
        />
      )}

      {editTarget && (
        <EditMessageModal
          msg={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}

      {forwardPickerOpen && (
        <ForwardPicker
          conversations={p.allConversations ?? []}
          currentConvId={p.conv.id ?? ''}
          instanceId={p.conv.instance_id ?? null}
          selfJid={p.selfJid}
          sending={forwardSending}
          onSend={async (targetIds) => {
            setForwardSending(true)
            try {
              // Forward in chat (chronological) order, not selection-click order,
              // so a mixed bulk selection lands in the target in the same order it
              // appears here — matching WhatsApp. Each forward is one normal queued
              // message; the dispatcher paces them (per-number caps + per-conv floor
              // + jitter), so bulk forwarding is never a blast.
              const order = new Map(p.messages.map((m, i) => [m.id, i]))
              const orderedIds = [...forwardSelected].sort(
                (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
              )
              for (const msgId of orderedIds) {
                await forwardMessage(msgId, targetIds)
              }
              setForwardMode(false)
              setForwardSelected(new Set())
              setForwardPickerOpen(false)
              // WhatsApp jumps you to the recipient's chat after forwarding; with
              // multiple recipients it opens the first one. Both the quick
              // (media-arrow) and multi-select forward paths land here.
              if (targetIds[0]) p.onOpenConversation?.(targetIds[0])
            } catch (e) {
              console.error('Forward failed:', e)
              toast.error(normalizeError(e))
            } finally {
              setForwardSending(false)
            }
          }}
          onClose={() => {
            setForwardPickerOpen(false)
            // A single-message quick-forward selects the bubble without entering
            // multi-select mode; clear it so the bubble doesn't stay highlighted.
            if (!forwardMode) setForwardSelected(new Set())
          }}
        />
      )}

      {bubbleModal && (
        <BubbleStateModal
          state={bubbleModal.state}
          businessHours={instanceCapacity?.business_hours ?? null}
          capacity={instanceCapacity ?? null}
          onResend={async () => {
            const m = bubbleModal.msg
            const body = m.body ?? ''
            const convId = m.conversation_id
            if (!convId || (!body && !m.media_storage_key)) { setBubbleModal(null); return }
            try {
              await sendMessage({
                conversationId: convId,
                body: body || undefined,
                kind: ((m.kind ?? 'text') as unknown) as Parameters<typeof sendMessage>[0]['kind'],
                ...(m.media_storage_key ? {
                  mediaStorageKey: m.media_storage_key,
                  mediaMime: m.media_mime ?? undefined,
                  ...(m.media_size_bytes != null ? { mediaSizeBytes: m.media_size_bytes } : {}),
                } : {}),
              })
              // Retire the original ONLY if it never reached WhatsApp (no
              // evolution_message_id). cancel_outbound_message hard-refuses an
              // already-dispatched message (errcode 22023 → HTTP 400); a
              // delivery_status=ERROR bubble HAS a msg id, so calling it there
              // just logs a 400. Leave the failed original in place beside the
              // new attempt instead.
              if (m.id && !m.evolution_message_id) await cancelOutboundMessage(m.id).catch(() => undefined)
            } catch (err) {
              console.error('resend failed:', err)
              toast.error(normalizeError(err))
            }
            setBubbleModal(null)
          }}
          onForceDispatch={async () => {
            const m = bubbleModal.msg
            try { await forceDispatchNow(m.id!) }
            catch (err) { console.error('force dispatch failed:', err); toast.error(normalizeError(err)) }
            setBubbleModal(null)
          }}
          onDelete={async () => {
            const m = bubbleModal.msg
            // Optimistic: drop the bubble immediately, then hard-delete server-side.
            if (m.id && m.conversation_id) dropMessageFromThread(m.conversation_id, m.id)
            setBubbleModal(null)
            try { await cancelOutboundMessage(m.id!) }
            catch (err) { console.error('cancel failed:', err); toast.error(normalizeError(err)) }
          }}
          onClose={() => setBubbleModal(null)}
        />
      )}

    </div>
  )
}

// WhatsApp Web-style red exclamation circle for failed/blocked outbound
// messages. 16x16 coral-red filled circle with white "!" inside, matching
// real WA Web's failed-message marker. SVG so it scales cleanly with theme.
function IconBubbleFailed({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7.5" fill="#f15c6d" />
      <rect x="7.25" y="3.75" width="1.5" height="5.5" rx="0.75" fill="#ffffff" />
      <circle cx="8" cy="11.5" r="0.95" fill="#ffffff" />
    </svg>
  )
}

function BubbleStateModal({
  state,
  businessHours,
  onResend,
  onForceDispatch,
  onDelete,
  onClose,
  capacity,
}: {
  state: 'failed' | 'blocked-window' | 'blocked-paused' | 'blocked-cap'
  businessHours: { tz: string; days: number[]; open: string; close: string } | null
  onResend: () => void
  onForceDispatch: () => void
  onDelete: () => void
  onClose: () => void
  capacity: import('../../../lib/queries/instances').InstanceCapacityStatus | null | undefined
}) {
  // Live ticker so the blocked-cap countdown updates every second.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (state !== 'blocked-cap') return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [state])

  const cfg = (() => {
    if (state === 'failed') {
      return {
        title: 'Échec d’envoi',
        body: <>Ce message n’a pas pu être envoyé. Vous pouvez le renvoyer maintenant ou le supprimer de cette discussion.</>,
        primary: { label: 'Renvoyer', action: onResend },
      }
    }
    if (state === 'blocked-window') {
      const w = businessHours ? `${businessHours.open}–${businessHours.close}` : 'les heures ouvrables'
      return {
        title: 'En attente — hors heures',
        body: <>Ce message sera envoyé à l’ouverture de la prochaine plage horaire (<strong>{w}</strong>). Vous pouvez forcer l’envoi maintenant.</>,
        primary: { label: 'Envoyer maintenant', action: onForceDispatch },
      }
    }
    if (state === 'blocked-paused') {
      return {
        title: 'Envoi en pause',
        body: <>L’administrateur a coupé l’envoi sur cette instance. Forcer l’envoi va lever la pause pendant 60 secondes.</>,
        primary: { label: 'Forcer l’envoi', action: onForceDispatch },
      }
    }
    // blocked-cap: name the SINGLE active ceiling (hourly beats daily) with its
    // exact used/cap and a live countdown to the reset instant (resume_at).
    const hourlyHit = (capacity?.hourly?.pct ?? 0) >= 100
    const active = hourlyHit ? capacity?.hourly : capacity?.daily
    const scope = hourlyHit ? 'horaire' : 'quotidienne'
    const resumeAt = active?.resume_at ?? null
    const remainMs = resumeAt ? new Date(resumeAt).getTime() - nowMs : NaN
    let when: React.ReactNode
    if (!resumeAt || !Number.isFinite(remainMs)) {
      when = <>L’envoi reprendra automatiquement dès qu’une place se libère.</>
    } else if (remainMs <= 0) {
      when = <>L’envoi reprend dans un instant.</>
    } else {
      const s = Math.ceil(remainMs / 1000)
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      const label = h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min ${sec} s` : `${sec} s`
      when = <>Reprise automatique dans <strong>{label}</strong>.</>
    }
    return {
      title: 'Limite d’envoi atteinte',
      body: (
        <>
          Cette instance a atteint sa limite {scope}
          {active ? <> ({active.used}/{active.cap})</> : null}. {when}
        </>
      ),
      primary: null as { label: string; action: () => void } | null,
    }
  })()

  return (
    <div className="wac__modal-overlay" onClick={onClose}>
      <div
        className="wac__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bubble-state-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wac__modal-head">
          <span id="bubble-state-title">{cfg.title}</span>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            style={{
              appearance: 'none',
              background: 'transparent',
              border: 'none',
              padding: 4,
              borderRadius: 6,
              cursor: 'pointer',
              color: 'var(--wa-text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.background = 'rgba(255, 255, 255, 0.08)'
              el.style.color = 'var(--wa-text-primary)'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement
              el.style.background = 'transparent'
              el.style.color = 'var(--wa-text-secondary)'
            }}
          >
            <IconClose size={18} />
          </button>
        </div>
        <div className="wac__modal-body">
          <p style={{ margin: 0, color: 'var(--wa-text-secondary)', lineHeight: 1.5 }}>
            {cfg.body}
          </p>
        </div>
        <div className="wac__modal-footer">
          <button
            type="button"
            className="wac__modal-btn wac__modal-btn--save"
            onClick={onDelete}
            style={{ background: '#c62828', color: '#fff' }}
          >
            Supprimer
          </button>
          {cfg.primary && (
            <button
              type="button"
              className="wac__modal-btn wac__modal-btn--save"
              onClick={cfg.primary.action}
            >
              {cfg.primary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ForwardPicker({ conversations, currentConvId, instanceId, selfJid, sending, onSend, onClose }: {
  conversations: ConversationDecrypted[]
  currentConvId: string
  instanceId: string | null
  selfJid: string | null
  sending: boolean
  onSend: (targetIds: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(new Set<string>())
  const [creating, setCreating] = useState(false)
  const { data: bookContacts } = useContacts(instanceId)

  interface FwdEntry {
    key: string
    name: string
    pic: string | null
    convId: string | null
    jid: string
  }

  const entries = useMemo(() => {
    const result: FwdEntry[] = []
    const seenJids = new Set<string>()

    for (const c of conversations) {
      if (c.id === currentConvId) continue
      const jid = c.remote_jid ?? ''
      if (!jid) continue
      seenJids.add(jid)
      result.push({
        key: c.id!,
        name: conversationLabel(jid, c.peer_display_name, c.contact_book_name),
        pic: c.peer_profile_pic ?? null,
        convId: c.id!,
        jid,
      })
    }

    for (const ct of bookContacts ?? []) {
      if (!ct.phone_jid) continue
      if (ct.phone_jid === selfJid) continue
      if (seenJids.has(ct.phone_jid)) continue
      seenJids.add(ct.phone_jid)
      result.push({
        key: 'contact-' + ct.id,
        name: ct.book_name || ct.push_name || (ct.phone_number ? formatPhone(ct.phone_number) : null) || '—',
        pic: ct.profile_pic,
        convId: null,
        jid: ct.phone_jid,
      })
    }

    return result
  }, [conversations, currentConvId, bookContacts, selfJid])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e => e.name.toLowerCase().includes(q) || e.jid.includes(q))
  }, [entries, query])

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const handleSend = async () => {
    setCreating(true)
    try {
      const targetIds: string[] = []
      for (const key of selected) {
        const entry = entries.find(e => e.key === key)
        if (!entry) continue
        if (entry.convId) {
          targetIds.push(entry.convId)
        } else if (instanceId) {
          const { ensureConversation } = await import('../../../lib/conversationCreate')
          const id = await ensureConversation({ instanceId, remoteJid: entry.jid })
          targetIds.push(id)
        }
      }
      setCreating(false)
      onSend(targetIds)
    } catch (e) {
      console.error('Forward: failed to resolve targets:', e)
      setCreating(false)
    }
  }

  return (
    <div className="wac__fwd-picker-overlay" onClick={onClose}>
      <div className="wac__fwd-picker" onClick={e => e.stopPropagation()}>
        <div className="wac__fwd-picker-header">
          <button className="wac__fwd-picker-close" onClick={onClose}><IconClose size={20} /></button>
          <span className="wac__fwd-picker-title">Transférer le message</span>
        </div>
        <div className="wac__fwd-picker-search">
          <IconSearch size={16} />
          <input
            placeholder="Rechercher..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="wac__fwd-picker-list">
          {filtered.map(e => {
            const checked = selected.has(e.key)
            return (
              <div
                key={e.key}
                className={'wac__fwd-picker-row' + (checked ? ' is-checked' : '')}
                onClick={() => toggle(e.key)}
              >
                <div className="wac__fwd-picker-avatar">
                  {e.pic
                    ? <img src={e.pic} alt="" draggable={false} />
                    : e.name.charAt(0).toUpperCase()}
                </div>
                <span className="wac__fwd-picker-name">{e.name}</span>
                <IconCheckbox size={20} checked={checked} />
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="wac__fwd-picker-empty">Aucun contact trouvé</div>
          )}
        </div>
        <div className="wac__fwd-picker-footer">
          <button
            className="wac__fwd-picker-send"
            disabled={selected.size === 0 || sending || creating}
            onClick={handleSend}
          >
            {creating ? 'Préparation...' : sending ? 'Envoi...' : <><IconForwardAll size={20} /> Transférer ({selected.size})</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function scrollToMessage(msgId: string) {
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${msgId}"]`)
  if (!el) return
  const wrap = el.closest<HTMLElement>('.wac__bubble-wrap') ?? el
  wrap.scrollIntoView({ behavior: 'smooth', block: 'center' })
  wrap.classList.add('wac__bubble-highlight')
  setTimeout(() => wrap.classList.remove('wac__bubble-highlight'), 1500)
}

function pinnedPreviewText(m: MessageDecrypted): string {
  if (m.body && m.body.trim()) return m.body
  switch (m.kind) {
    case 'image':    return 'Photo'
    case 'video':    return 'Vidéo'
    case 'audio':    return 'Message vocal'
    case 'document': return 'Document'
    case 'sticker':  return 'Sticker'
    case 'contact':  return 'Contact'
    case 'location': return 'Localisation'
    default:         return 'Message'
  }
}

// WhatsApp's pin-duration picker. Returns an ISO expiry (auto-unpin) or null
// (forever) — the "Toujours" option we added on top of WhatsApp's 3.
function PinDurationModal({ onCancel, onConfirm }: {
  onCancel: () => void
  onConfirm: (expiresAt: string | null) => void
}) {
  const OPTIONS: { key: string; label: string; ms: number | null }[] = [
    { key: '24h',     label: '24 heures', ms: 24 * 60 * 60 * 1000 },
    { key: '7d',      label: '7 jours',   ms: 7 * 24 * 60 * 60 * 1000 },
    { key: '30d',     label: '30 jours',  ms: 30 * 24 * 60 * 60 * 1000 },
    { key: 'forever', label: 'Toujours',  ms: null },
  ]
  const [sel, setSel] = useState('7d')
  const confirm = () => {
    const opt = OPTIONS.find((o) => o.key === sel)!
    onConfirm(opt.ms == null ? null : new Date(Date.now() + opt.ms).toISOString())
  }
  return (
    <div className="wac__modal-overlay" onClick={onCancel}>
      <div className="wac__modal" onClick={(e) => e.stopPropagation()}>
        <div className="wac__modal-head"><span>Choisissez la durée d’épinglage</span></div>
        <div className="wac__modal-body">
          <p style={{ margin: '0 0 14px', color: 'var(--wa-text-secondary)', lineHeight: 1.5 }}>
            Vous pouvez à tout moment détacher ce qui a été épinglé.
          </p>
          {OPTIONS.map((o) => (
            <label key={o.key} className="wac__pin-dur-opt">
              <input type="radio" name="pin-duration" checked={sel === o.key} onChange={() => setSel(o.key)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
        <div className="wac__modal-footer">
          <button className="wac__modal-btn wac__modal-btn--cancel" onClick={onCancel}>Annuler</button>
          <button className="wac__modal-btn wac__modal-btn--save" onClick={confirm}>Épingler</button>
        </div>
      </div>
    </div>
  )
}

// Pinned-messages bar under the chat header. App-local, team-shared (queries
// pinned rows directly so out-of-window pins still show). Tap cycles through
// multiple pins, jumping + highlighting each; chevron opens go-to / détacher.
function PinnedBar({ conversationId }: { conversationId: string | null }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const pinsQ = useQuery({
    queryKey: ['pinnedBar', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data } = await supabase
        .schema('whatsapp').from('messages_decrypted')
        .select('*')
        .eq('conversation_id', conversationId!)
        .eq('is_pinned', true)
        // Hide pins past their expiry instantly (cron flips them off within ~1min).
        .or(`pin_expires_at.is.null,pin_expires_at.gt.${new Date().toISOString()}`)
        .order('pinned_at', { ascending: false })
      return (data ?? []) as MessageDecrypted[]
    },
    staleTime: 30_000,
  })
  const pins = pinsQ.data ?? []
  useEffect(() => { setActiveIdx(0); setMenuOpen(false) }, [conversationId])
  useEffect(() => { if (activeIdx >= pins.length && pins.length > 0) setActiveIdx(0) }, [pins.length, activeIdx])
  if (!conversationId || pins.length === 0) return null
  const idx = Math.min(activeIdx, pins.length - 1)
  const active = pins[idx]!
  return (
    <div className={'wac__pinned-bar' + (menuOpen ? ' is-menu-open' : '')}>
      <button
        type="button"
        className="wac__pinned-bar-body"
        onClick={() => { if (active.id) scrollToMessage(active.id); if (pins.length > 1) setActiveIdx((i) => (i + 1) % pins.length) }}
      >
        <IconWaPin size={22} />
        {pins.length > 1 && <span className="wac__pinned-bar-count">{idx + 1}/{pins.length}</span>}
        <span className="wac__pinned-bar-label">{pinnedPreviewText(active)}</span>
      </button>
      <div className="wac__pinned-bar-menu-anchor">
        <button type="button" className="wac__icon-btn wac__pinned-bar-chevron" aria-label="Options du message épinglé" onClick={() => setMenuOpen((o) => !o)}>
          <IconChevronDown size={18} />
        </button>
        {menuOpen && (
          <>
            <div className="wac__member-menu-scrim" onClick={() => setMenuOpen(false)} />
            <div className="wac__pinned-bar-menu">
              <button className="wac__member-menu-item" onClick={() => { if (active.id) scrollToMessage(active.id); setMenuOpen(false) }}>
                <IconForwardAll size={18} /><span>Aller au message</span>
              </button>
              <button className="wac__member-menu-item is-danger" onClick={() => { if (active.id) void setMessagePin(active.id, false).catch((e) => toast.error(normalizeError(e))); setMenuOpen(false) }}>
                <IconWaUnpin size={18} /><span>Détacher</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Compare two messages to see if they're from the same sender (for streak grouping). */
function isSameSender(a: MessageDecrypted, b: MessageDecrypted, isGroup: boolean): boolean {
  // DMs: all inbound are from the same peer, all outbound from us
  if (!isGroup) return true

  // Groups: compare by sender_jid first
  if (a.sender_jid && b.sender_jid) return a.sender_jid === b.sender_jid

  // Fall back to pushName in media_meta
  const nameA = (a.media_meta as Record<string, unknown> | null)?.pushName as string | undefined
  const nameB = (b.media_meta as Record<string, unknown> | null)?.pushName as string | undefined
  if (nameA && nameB) return nameA === nameB

  // If neither has sender identification, treat as different senders
  // (better to show too many names than none)
  if (!a.sender_jid && !nameA && !b.sender_jid && !nameB) return false

  return false
}

// ── Album grouping (4+ consecutive media from same sender → grid) ──────────

function isMediaMsg(m: MessageDecrypted): boolean {
  const kind = m.kind ?? 'text'
  const meta = (m.media_meta ?? {}) as Record<string, unknown>
  return meta.subtype !== 'template' && (kind === 'image' || kind === 'video')
}

// A GIF arrives as a video with a gifPlayback/isGif marker. It renders as its
// own standalone bubble (never grouped into an image album) and auto-loops
// once, matching WhatsApp.
function isGifMsg(m: MessageDecrypted): boolean {
  const meta = (m.media_meta ?? {}) as Record<string, unknown>
  return m.kind === 'video' && (meta.isGif === true || meta.gifPlayback === true || meta.gif === true)
}

// Album-eligible = plain media (image/video) with NO caption and not a GIF.
// A captioned media message renders standalone so its caption stays attached.
function isAlbumEligible(m: MessageDecrypted): boolean {
  return isMediaMsg(m) && !isGifMsg(m) && !(m.body && m.body.trim().length > 0)
}

type RenderItem =
  | { type: 'single'; msg: MessageDecrypted }
  | { type: 'album'; messages: MessageDecrypted[] }

function groupMediaAlbums(messages: MessageDecrypted[], isGroup: boolean): RenderItem[] {
  const items: RenderItem[] = []
  let i = 0
  while (i < messages.length) {
    const m = messages[i]
    if (isAlbumEligible(m)) {
      let j = i + 1
      while (
        j < messages.length
        && isAlbumEligible(messages[j])
        && messages[j].direction === m.direction
        && isSameSender(m, messages[j], isGroup)
      ) {
        j++
      }
      const run = messages.slice(i, j)
      if (run.length >= 4) {
        items.push({ type: 'album', messages: run })
      } else {
        for (const msg of run) items.push({ type: 'single', msg })
      }
      i = j
    } else {
      items.push({ type: 'single', msg: m })
      i++
    }
  }
  return items
}

function useDayBuckets(messages: MessageDecrypted[]) {
  return useMemo(() => {
    const out: { key: string; label: string; messages: MessageDecrypted[] }[] = []
    for (const m of messages) {
      if (!m.whatsapp_timestamp) continue
      const d = new Date(m.whatsapp_timestamp)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const last = out[out.length - 1]
      if (!last || last.key !== key) {
        out.push({ key, label: formatDayDivider(m.whatsapp_timestamp), messages: [m] })
      } else {
        last.messages.push(m)
      }
    }
    return out
  }, [messages])
}

// ──────────────────────────────────────────────────────────────────────────────
// Bubble (message)
// ──────────────────────────────────────────────────────────────────────────────

interface BubbleProps {
  msg: MessageDecrypted
  isOut: boolean
  streakHead: boolean
  streakTail: boolean
  isGroup: boolean
  selfJid: string | null
  peerPic?: string | null
  ownerPic?: string | null
  onOpenMedia?: (msg: MessageDecrypted) => void
  contactMap?: Map<string, { pushName: string | null; pic: string | null; bookName: string | null }>
  quotedMap?: Map<string, { body: string | null; kind: string | null; direction: string | null; senderJid: string | null; mediaMeta: Record<string, unknown> | null; mediaMime: string | null; mediaStorageKey: string | null; mediaPending: boolean | null; whatsappTimestamp: string | null }>
  convName?: string
  onReply?: (msg: MessageDecrypted) => void
  onAction?: (action: string, msg: MessageDecrypted, anchorRect: DOMRect) => void
  forwardMode?: boolean
  forwardSelected?: boolean
  onForwardToggle?: (msgId: string) => void
  deleteMode?: boolean
  deleteSelected?: boolean
  onDeleteToggle?: (msgId: string) => void
  onNavigateToJid?: (jid: string, name?: string) => void
  /** Consecutive-audio chain: id of the audio bubble directly below, when it
   *  should auto-play after this one ends. */
  autoAdvanceToId?: string | null
  /** Capacity snapshot for the instance this conversation belongs to.
   *  Used to decide whether a PENDING bubble is "blocked" by a gate
   *  (business hours, caps, worker_paused) and render the appropriate
   *  red-! marker + WhatsApp-style modal. */
  instanceCapacity?: import('../../../lib/queries/instances').InstanceCapacityStatus | null
  /** Group member count — used by the "Vous avez créé ce groupe" intro card. */
  groupMemberCount?: number
}

// ── Edit/Delete eligibility (mirrors the server-side RPC gates) ──────────────
// WhatsApp edit window: 15 min. Delete-for-everyone window: 60 hours. These are
// the UX gate; the RPCs re-enforce them server-side (defense in depth).
const EDIT_WINDOW_MS = 15 * 60 * 1000
const DELETE_EVERYONE_WINDOW_MS = 60 * 60 * 60 * 1000

interface MsgEligibility {
  canEdit: boolean
  canDeleteForEveryone: boolean
  canDeleteForMe: boolean
}

function computeMsgEligibility(msg: MessageDecrypted, nowMs: number): MsgEligibility {
  const ts = new Date(msg.whatsapp_timestamp ?? msg.created_at ?? 0).getTime()
  const age = Number.isFinite(ts) ? nowMs - ts : Infinity
  const isOut = msg.direction === 'outbound'
  const notRevoked = !msg.revoked_at
  const dispatched = !!msg.evolution_message_id
  return {
    canEdit: isOut && msg.kind === 'text' && notRevoked && dispatched && age < EDIT_WINDOW_MS,
    canDeleteForEveryone: isOut && notRevoked && dispatched && age < DELETE_EVERYONE_WINDOW_MS,
    canDeleteForMe: true,
  }
}

// Compute the effective bubble state for outbound messages, distinguishing
// FAILED (gave up) from BLOCKED (queued, gate is closed) from healthy PENDING.
// Returns 'ok' for inbound or any non-pending non-failed status.
type BubbleBlockedState =
  | 'failed'
  | 'blocked-window'
  | 'blocked-paused'
  | 'blocked-cap'
  | 'pending'
  | 'ok'

function deriveBubbleBlockedState(
  msg: MessageDecrypted,
  capacity: import('../../../lib/queries/instances').InstanceCapacityStatus | null | undefined,
  nowMs: number,
): BubbleBlockedState {
  if (msg.direction !== 'outbound') return 'ok'
  const status = normalizeDeliveryStatus(msg.delivery_status)
  if (status === 'failed') return 'failed'
  if (status !== 'pending') return 'ok'

  // Give the dispatcher 60s before flagging as blocked — fresh messages
  // legitimately sit pending for a brief humanization window.
  const createdMs = new Date(msg.created_at ?? msg.whatsapp_timestamp ?? 0).getTime()
  if (Number.isFinite(createdMs) && nowMs - createdMs < 60_000) return 'pending'

  if (!capacity) return 'pending'
  if (capacity.worker_paused) return 'blocked-paused'
  // Only the HARD budget ceilings (hourly/daily) mean "blocked". The minute
  // figure is now the token-bucket capacity — hitting it just paces the next
  // send out by a few seconds, it is not a block, so it must not flag here.
  if ((capacity.daily?.pct ?? 0) >= 100 || (capacity.hourly?.pct ?? 0) >= 100) {
    return 'blocked-cap'
  }

  // Quiet-hours override punches through the business-hours window
  if (capacity.quiet_hours_override_until) {
    const until = new Date(capacity.quiet_hours_override_until).getTime()
    if (Number.isFinite(until) && until > nowMs) return 'pending'
  }

  // Business hours check — mirrors worker/src/dispatcher/loop.ts withinDispatchWindow.
  // Honor the admin toggle: when business_hours_enabled is false, the
  // dispatcher dispatches 24/7 so the bubble can never be "blocked-window".
  if (!capacity.business_hours_enabled) return 'pending'
  const bh = capacity.business_hours
  if (bh && bh.tz && bh.open && bh.close) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: bh.tz,
        hourCycle: 'h23',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(new Date(nowMs))
      const partMap: Record<string, string> = {}
      for (const p of parts) partMap[p.type] = p.value
      const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
      const dayNum = weekdayMap[partMap['weekday'] ?? ''] ?? -1
      const h = (partMap['hour'] ?? '00').padStart(2, '0')
      const m = (partMap['minute'] ?? '00').padStart(2, '0')
      const hhmm = `${h}:${m}`
      const days = Array.isArray(bh.days) && bh.days.length > 0 ? bh.days : [0, 1, 2, 3, 4, 5, 6]
      if (!days.includes(dayNum)) return 'blocked-window'
      const inside = bh.open <= bh.close
        ? (hhmm >= bh.open && hhmm < bh.close)
        : (hhmm >= bh.open || hhmm < bh.close)
      if (!inside) return 'blocked-window'
    } catch { /* unknown tz — be permissive */ }
  }

  return 'pending'
}

// Composer banner that appears ONLY when sending is genuinely locked, naming
// the single active lock and a live countdown to resume. The per-minute token
// bucket is soft pacing (a few seconds), not a lock, so it never shows here.
function ComposerCapacityBanner({ capacity }: {
  capacity: import('../../../lib/queries/instances').InstanceCapacityStatus | null | undefined
}) {
  const [nowMs, setNowMs] = useState(0)
  useEffect(() => {
    setNowMs(Date.now())
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!capacity) return null

  const countdown = (resumeAt: string | null): string => {
    if (!resumeAt || nowMs === 0) return ''
    const ms = new Date(resumeAt).getTime() - nowMs
    if (!Number.isFinite(ms) || ms <= 0) return ' Reprend dans un instant.'
    const s = Math.ceil(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (h > 0) return ` Reprend dans ${h} h ${m} min.`
    if (m > 0) return ` Reprend dans ${m} min ${s % 60} s.`
    return ` Reprend dans ${s} s.`
  }

  // Outside business hours? Mirrors deriveBubbleBlockedState / worker window.
  const businessClosed = (() => {
    if (!capacity.business_hours_enabled) return false
    if (capacity.quiet_hours_override_until && nowMs !== 0) {
      const until = new Date(capacity.quiet_hours_override_until).getTime()
      if (Number.isFinite(until) && until > nowMs) return false
    }
    const bh = capacity.business_hours
    if (!bh || !bh.tz || !bh.open || !bh.close) return false
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: bh.tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date(nowMs || Date.now()))
      const pm: Record<string, string> = {}
      for (const p of parts) pm[p.type] = p.value
      const wmap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
      const day = wmap[pm['weekday'] ?? ''] ?? -1
      const hhmm = `${(pm['hour'] ?? '00').padStart(2, '0')}:${(pm['minute'] ?? '00').padStart(2, '0')}`
      const days = Array.isArray(bh.days) && bh.days.length ? bh.days : [0, 1, 2, 3, 4, 5, 6]
      if (!days.includes(day)) return true
      return bh.open <= bh.close ? !(hhmm >= bh.open && hhmm < bh.close) : !(hhmm >= bh.open || hhmm < bh.close)
    } catch { return false }
  })()

  let text: string | null = null
  if (capacity.worker_paused) {
    text = 'Envoi en pause — coupé par un administrateur.'
  } else if ((capacity.hourly?.pct ?? 0) >= 100) {
    text = `Plafond horaire atteint — ${capacity.hourly.used}/${capacity.hourly.cap} cette heure.${countdown(capacity.hourly.resume_at)}`
  } else if ((capacity.daily?.pct ?? 0) >= 100) {
    text = `Plafond quotidien atteint — ${capacity.daily.used}/${capacity.daily.cap} aujourd’hui.${countdown(capacity.daily.resume_at)}`
  } else if (businessClosed) {
    const bh = capacity.business_hours!
    text = `Hors plage horaire (${bh.open}–${bh.close}) — envoi suspendu.`
  }
  if (!text) return null

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 12px 0', pointerEvents: 'none' }}>
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '5px 12px 5px 10px', borderRadius: 14,
          background: 'rgba(239, 68, 68, 0.14)', color: '#f87171',
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500,
          lineHeight: 1.35, letterSpacing: '0.01em', maxWidth: '80%', pointerEvents: 'auto',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
          <rect x="7.35" y="4.5" width="1.3" height="4.5" rx="0.65" fill="currentColor" />
          <circle cx="8" cy="11" r="0.85" fill="currentColor" />
        </svg>
        <span>{text}</span>
      </div>
    </div>
  )
}

function Bubble({ msg, isOut, streakHead, streakTail, isGroup, peerPic, ownerPic, onOpenMedia, contactMap, quotedMap, convName, onReply, onAction, forwardMode, forwardSelected, onForwardToggle, deleteMode, deleteSelected, onDeleteToggle, onNavigateToJid, autoAdvanceToId, instanceCapacity, groupMemberCount }: BubbleProps) {
  // Forward and delete share one visual select-mode (checkbox + row shift).
  // Only one is ever active at a time (mutually exclusive at the parent).
  const selectMode = !!forwardMode || !!deleteMode
  const selected = forwardMode ? !!forwardSelected : !!deleteSelected
  const onSelectToggle = forwardMode ? onForwardToggle : onDeleteToggle
  // Peek state for a deleted (revoked) message — local & ephemeral, so it
  // always mounts hidden (resets on refresh). Toggled by the hover eye.
  const [revealed, setRevealed] = useState(false)
  const time = formatBubbleTime(msg.whatsapp_timestamp)
  const status = normalizeDeliveryStatus(msg.delivery_status)
  const senderColor = senderColorVar(msg.sender_jid)
  const kind = msg.kind ?? 'text'

  const blockedState = deriveBubbleBlockedState(msg, instanceCapacity, Date.now())
  const isProblem = blockedState === 'failed' || blockedState.startsWith('blocked-')
  const tickIcon = isProblem ? (
    // Inline button styled to match the dimensions of a normal tick/clock so
    // the meta row stays inside .wac__bubble-text's 56px right padding budget.
    // Use opacity-only hover (no scale) to avoid layout shift.
    <button
      type="button"
      aria-label={blockedState === 'failed' ? 'Message non envoyé · ouvrir les options' : 'Message en attente · ouvrir les options'}
      title={blockedState === 'failed' ? 'Échec d’envoi' : 'En attente'}
      onClick={(e) => {
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        onAction?.('blocked:' + blockedState, msg, rect)
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        padding: 0,
        margin: 0,
        background: 'transparent',
        border: 'none',
        borderRadius: 7,
        cursor: 'pointer',
        outline: 'none',
        opacity: 1,
        transition: 'opacity 0.15s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.78' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
      onFocus={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.78' }}
      onBlur={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
    >
      <IconBubbleFailed size={14} />
    </button>
  )
  : status === 'read'      ? <IconCheckDouble className="wac__tick-read" />
  : status === 'delivered' ? <IconCheckDouble />
  : status === 'sent'    ? <IconCheckSingle />
  :                        <IconClock />   // 'pending'

  const meta = (msg.media_meta ?? {}) as Record<string, unknown>
  const isTemplate = meta.subtype === 'template'
  const isMedia = !isTemplate && (kind === 'image' || kind === 'video')
  const isVoice = kind === 'audio'
  const isDoc   = kind === 'document'
  const isSticker = kind === 'sticker'
  const isContact = kind === 'contact' || meta.subtype === 'contact' || meta.subtype === 'contact_list'
  const isLocation = kind === 'location' || meta.subtype === 'location'
  const isWaitingForMessage = kind === 'system' && meta.subtype === 'waiting_for_message'
  // View-once placeholder (WhatsApp model): a real, visible bubble with time +
  // ticks — never the media (matching WhatsApp: openable only on the phone).
  const isViewOnce = kind === 'system' && meta.subtype === 'view_once'
  const isHiddenSystem = kind === 'system' && !isWaitingForMessage && !isViewOnce && !msg.body
  // Forwarded: dashboard-originated forwards set the `forwarded` column;
  // inbound (and phone-synced) forwards carry it in media_meta (captured from
  // WhatsApp's contextInfo.isForwarded at ingest). Either marks "Transféré".
  const isForwardedMsg = msg.forwarded === true || meta.forwarded === true

  // Deleted message tombstone (kept in the thread, never removed). Set by our
  // own delete-for-everyone (revoked_by='us') or an inbound revoke ('remote').
  // Rendered BEFORE the isHiddenSystem null-return so it always shows; still
  // selectable in delete-mode (you can hide a tombstone "for me").
  if (msg.revoked_at) {
    const revokedByUs = msg.revoked_by === 'us'
    // We keep the original body, so it can be peeked. Offer the eye whenever
    // there's something to reveal (any kind — text shows the body, media shows
    // a label). Hidden by default; the eye toggles `revealed` for this session.
    const revealedText = msg.body
      || (kind === 'image' ? 'Photo' : kind === 'video' ? 'Vidéo' : kind === 'audio' ? 'Message vocal'
        : kind === 'document' ? 'Document' : kind === 'sticker' ? 'Sticker' : 'Message')
    return (
      <div
        data-msg-id={msg.id}
        className={
          'wac__bubble-wrap'
          + (isOut ? ' is-out' : ' is-in')
          + (streakHead ? ' is-streak-head' : '')
          + (streakTail ? ' is-streak-tail' : '')
          + (isGroup && !isOut ? ' is-group-in' : '')
          + (selectMode ? ' is-forward-mode' : '')
          + (selected ? ' is-forward-selected' : '')
        }
        style={{ marginTop: selectMode ? 1 : streakHead ? 8 : 1, marginBottom: selectMode ? 1 : streakTail ? 4 : 1 }}
        onClick={selectMode ? () => onSelectToggle?.(msg.id!) : undefined}
      >
        {selectMode && (
          <div
            className={'wac__forward-check' + (selected ? ' is-checked' : '')}
            onClick={(e) => { e.stopPropagation(); onSelectToggle?.(msg.id!) }}
            role="checkbox"
            aria-checked={selected}
          >
            <IconCheckbox size={22} checked={selected} />
          </div>
        )}
        {isGroup && !isOut && <div className={'wac__group-avatar' + (streakHead ? '' : ' is-spacer')} />}
        <div className="wac__bubble-col">
          <div className={'wac__bubble wac__bubble--revoked' + (revealed ? ' is-revealed' : '')}>
            {revealed ? (
              <div className="wac__bubble-text">
                <BubbleTextBody text={revealedText} isOut={isOut} contactMap={contactMap} readMore />
                <span className="wac__bubble-meta"><span>{time}</span></span>
              </div>
            ) : (
              <span className="wac__bubble-revoked">
                <IconBan size={15} />
                <span className="wac__bubble-revoked-text">
                  {revokedByUs ? 'Vous avez supprimé ce message' : 'Ce message a été supprimé'}
                </span>
                <span className="wac__bubble-meta"><span>{time}</span></span>
              </span>
            )}
          </div>
          {!selectMode && (
            <button
              type="button"
              className="wac__bubble-peek-trigger"
              onClick={(e) => { e.stopPropagation(); setRevealed((v) => !v) }}
              aria-label={revealed ? 'Masquer le message' : 'Afficher le message supprimé'}
              title={revealed ? 'Masquer' : 'Afficher'}
            >
              {revealed ? <IconEyeOff size={18} /> : <IconEye size={18} />}
            </button>
          )}
        </div>
      </div>
    )
  }

  // Group system events ("Vous avez ajouté X", "Y a quitté", subject/icon
  // changes…) render as a centered grey pill — NOT a left/right bubble. A
  // system row carrying a body would otherwise fall through to isTextKind and
  // render as a normal bubble, so this dedicated early-return is mandatory.
  // The body is already French + name-resolved (incl. "Vous") by the writer
  // (worker stub-ingest or the optimistic edge-fn call); render it verbatim.
  const isGroupEvent = kind === 'system' && meta.subtype === 'group_event'
  if (isGroupEvent) {
    if (!msg.body) return null
    // The group-creation event renders as WhatsApp's centered intro card
    // (avatar + title + "N membres · Créé …"), not a plain pill.
    if (meta.event === 'create') {
      const created = msg.whatsapp_timestamp ? new Date(msg.whatsapp_timestamp) : null
      const today = new Date()
      const isToday = created
        && created.getDate() === today.getDate()
        && created.getMonth() === today.getMonth()
        && created.getFullYear() === today.getFullYear()
      const createdLabel = !created ? null
        : isToday ? 'Créé aujourd’hui'
        : `Créé le ${created.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`
      const count = groupMemberCount ?? 0
      return (
        <div className="wac__group-intro" data-msg-id={msg.id}>
          <div className="wac__group-intro-avatar">
            {peerPic ? <img src={peerPic} alt="" draggable={false} /> : <IconUsers size={64} />}
          </div>
          <div className="wac__group-intro-title">{msg.body}</div>
          <div className="wac__group-intro-meta">
            {count > 0 && <>{count} membre{count > 1 ? 's' : ''}{createdLabel ? ' · ' : ''}</>}
            {createdLabel}
          </div>
        </div>
      )
    }
    return (
      <div className="wac__system" data-msg-id={msg.id}>
        <span className="wac__system-row">{msg.body}</span>
      </div>
    )
  }

  // Protocol noise, empty system messages, and standalone reactions — render nothing
  if (isHiddenSystem) return null
  if (kind === 'reaction') return null

  // WhatsApp jumbo: a text message whose body is exactly ONE emoji renders
  // large and bubble-less. 2+ emojis stay in the normal bubble. Only the clean
  // case (no quote/forward) gets the bubble-less treatment.
  const isTextKind = !isMedia && !isVoice && !isWaitingForMessage && !isViewOnce && !isTemplate
    && !isSticker && !isLocation && !isContact
  const jumboEmoji = isTextKind && !msg.reply_to_message_id && !isForwardedMsg
    && isSingleEmoji(msg.body)

  // WhatsApp shows a quick-forward arrow on hover for any non-text, non-voice-
  // note bubble: media, gif, document, sticker, contact, location, audio FILE
  // (ptt === false). Voice recordings and plain text don't get it.
  const isAudioFile = isVoice && (meta.ptt === false || (meta.ptt !== true && !!meta.fileName))
  const showForward = !isWaitingForMessage && kind !== 'system' && !isProblem && !isTemplate
    && (isMedia || isDoc || isSticker || isContact || isLocation || isAudioFile)

  // Group sender: look up contact profile for pic + name
  const contact = isGroup && !isOut && msg.sender_jid ? contactMap?.get(msg.sender_jid) : undefined
  const senderName = isGroup && !isOut
    ? contact?.bookName || contact?.pushName || (meta.pushName as string | undefined) || prettySender(msg.sender_jid)
    : null
  const senderPic = contact?.pic ?? null
  const senderInitials = senderName
    ? senderName.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
    : ''

  return (
    <div
      data-msg-id={msg.id}
      className={
        'wac__bubble-wrap'
        + (isOut ? ' is-out' : ' is-in')
        + (streakHead ? ' is-streak-head' : '')
        + (streakTail ? ' is-streak-tail' : '')
        + (isGroup && !isOut ? ' is-group-in' : '')
        + (selectMode ? ' is-forward-mode' : '')
        + (selected ? ' is-forward-selected' : '')
        + (showForward ? ' is-forwardable' : '')
      }
      style={{
        marginTop:    selectMode ? 1 : streakHead ? 8 : 1,
        marginBottom: selectMode ? 1 : streakTail ? 4 : 1,
      }}
      onClick={selectMode ? () => onSelectToggle?.(msg.id!) : undefined}
      onDoubleClick={selectMode ? undefined : (e) => {
        // A double-click ON the bubble selects its text (native, for copy) — don't
        // reply. Only a double-click in the gutter (same row, outside the bubble)
        // opens the reply box, matching WhatsApp.
        const el = e.target as HTMLElement | null
        if (el?.closest?.('.wac__bubble')) return
        if (!isWaitingForMessage && kind !== 'system') onReply?.(msg)
      }}
    >
      {selectMode && (
        <div
          className={'wac__forward-check' + (selected ? ' is-checked' : '')}
          onClick={(e) => { e.stopPropagation(); onSelectToggle?.(msg.id!) }}
          role="checkbox"
          aria-checked={selected}
        >
          <IconCheckbox size={22} checked={selected} />
        </div>
      )}

      {/* Group sender avatar (inbound only, streak head) */}
      {isGroup && !isOut && (
        <div className={'wac__group-avatar' + (streakHead ? '' : ' is-spacer')}>
          {streakHead && (
            <div className="wac__group-avatar-circle" style={{ background: senderPic ? 'transparent' : senderColor }}>
              {senderPic
                ? <img src={senderPic} alt="" draggable={false} />
                : senderInitials}
            </div>
          )}
        </div>
      )}

      <div className="wac__bubble-col">
      <div
        className={
          'wac__bubble'
          + (isMedia ? ' wac__bubble--media' : '')
          + (isSticker ? ' wac__bubble--sticker' : '')
          + (isLocation ? ' wac__bubble--location' : '')
          + (isWaitingForMessage ? ' wac__bubble--waiting' : '')
          + (jumboEmoji ? ' wac__bubble--jumbo-emoji' : '')
          + ((onReply || onAction) ? ' wac__bubble--has-actions' : '')
        }
        style={{ ['--wa-sender-color' as string]: senderColor }}
      >
        {/* Group sender name */}
        {streakHead && isGroup && !isOut && senderName && (
          <span className="wac__bubble-sender" style={{ color: senderColor }}>
            {senderName}
          </span>
        )}

        {/* Forwarded */}
        {isForwardedMsg && (
          <span className="wac__bubble-forwarded">
            <IconForwardAll />
            Transféré
          </span>
        )}

        {/* Quoted reply */}
        {msg.reply_to_message_id && (() => {
          const q = quotedMap?.get(msg.reply_to_message_id!)
          const qIsOut = q?.direction === 'outbound'
          const qSenderName = qIsOut
            ? 'Vous'
            : (q?.senderJid && contactMap?.get(q.senderJid)?.bookName)
              || (q?.senderJid && contactMap?.get(q.senderJid)?.pushName)
              || (q?.mediaMeta?.pushName as string | undefined)
              || convName
              || 'Contact'
          const qColor = qIsOut ? 'var(--wa-green)' : senderColorVar(q?.senderJid ?? msg.sender_jid)
          const qMeta = q?.mediaMeta as Record<string, unknown> | null
          const qSub = qMeta?.subtype as string | undefined
          const qKind = (q?.kind === 'text' && (qSub === 'contact' || qSub === 'contact_list')) ? 'contact' : (q?.kind ?? 'text')
          const qMediaLabel = qKind === 'image' ? { icon: <IconCamera />, label: 'Photo' }
            : qKind === 'video' ? { icon: <IconVideo />, label: 'Vidéo' }
            : qKind === 'audio' ? { icon: <IconHeadphones />, label: 'Audio' }
            : qKind === 'document' ? { icon: <IconDocument />, label: 'Document' }
            : qKind === 'sticker' ? { icon: <IconImage />, label: 'Sticker' }
            : qKind === 'location' ? { icon: <IconLocationPin />, label: 'Localisation' }
            : qKind === 'contact' ? { icon: <IconUser />, label: q?.body || 'Contact' }
            : null
          const qLocThumb = qKind === 'location' && qMeta?.lat != null && qMeta?.lng != null
          const qContactJid = qKind === 'contact' ? (() => {
            const vc = (qMeta?.vcard as string) ?? (qMeta?.vcards as string[])?.[0]
            if (!vc) return null
            const tel = vc.match(/TEL[^:]*:([^\n\r]+)/)?.[1]?.replace(/[^0-9]/g, '')
            return tel ? `${tel}@s.whatsapp.net` : null
          })() : null
          // Visual media (image/video/sticker): show a thumbnail of the exact
          // quoted item — even one buried in an album — and open it in the
          // full-screen viewer on click, instead of scrolling to the album.
          const qIsVisualMedia = qKind === 'image' || qKind === 'video' || qKind === 'sticker'
          const qStorageKey = q?.mediaStorageKey ?? null
          const qCanOpenInViewer = qIsVisualMedia && !!qStorageKey && !q?.mediaPending && !!onOpenMedia
          const onQuoteClick = () => {
            if (qCanOpenInViewer) {
              onOpenMedia!({
                id: msg.reply_to_message_id!,
                conversation_id: msg.conversation_id,
                instance_id: msg.instance_id,
                kind: qKind,
                direction: q?.direction ?? 'inbound',
                sender_jid: q?.senderJid ?? null,
                body: q?.body ?? null,
                media_storage_key: qStorageKey,
                media_pending: false,
                media_mime: q?.mediaMime ?? null,
                media_meta: qMeta ?? null,
                whatsapp_timestamp: q?.whatsappTimestamp ?? null,
                is_starred: false,
              } as unknown as MessageDecrypted)
            } else {
              scrollToMessage(msg.reply_to_message_id!)
            }
          }
          return (
            <div className="wac__bubble-quote" style={{ ['--wa-sender-color' as string]: qColor, cursor: 'pointer' }} onClick={onQuoteClick}>
              <div className="wac__bubble-quote-body">
                <span className="wac__bubble-quote-author">{qSenderName}</span>
                <span className="wac__bubble-quote-text">
                  {qMediaLabel ? <>{qMediaLabel.icon} {qMediaLabel.label}</> : (q?.body || 'Message')}
                </span>
              </div>
              {qLocThumb && (
                <QuoteLocationThumb lat={qMeta!.lat as number} lng={qMeta!.lng as number} />
              )}
              {qKind === 'contact' && (
                <QuoteContactThumb jid={qContactJid} instanceId={msg.instance_id} />
              )}
              {qIsVisualMedia && qStorageKey && (
                <QuoteMediaThumb storageKey={qStorageKey} pending={!!q?.mediaPending} mime={q?.mediaMime ?? null} isVideo={qKind === 'video'} />
              )}
            </div>
          )
        })()}

        {/* Body */}
        {isTemplate && <TemplateBubbleBody msg={msg} time={time} status={status} tickIcon={tickIcon} isOut={isOut} onOpenMedia={onOpenMedia} />}
        {isWaitingForMessage && <WaitingForMessageBody time={time} />}
        {isViewOnce && <ViewOnceBody isOut={isOut} time={time} status={status} tickIcon={tickIcon} />}
        {isMedia && <MediaBody msg={msg} time={time} status={status} tickIcon={tickIcon} isOut={isOut} onOpenMedia={onOpenMedia} />}
        {isVoice && (
          <VoiceBody
            msg={msg}
            isOut={isOut}
            time={time}
            status={status}
            tickIcon={tickIcon}
            avatarUrl={isOut ? (ownerPic ?? null) : (isGroup && msg.sender_jid ? (contactMap?.get(msg.sender_jid)?.pic ?? null) : (peerPic ?? null))}
            avatarFallback={!isOut && isGroup && !senderPic ? { color: senderColor, initials: senderInitials } : undefined}
            autoAdvanceToId={autoAdvanceToId ?? null}
          />
        )}
        {isDoc   && <DocumentBody msg={msg} />}
        {isSticker && <StickerBody msg={msg} time={time} status={status} tickIcon={tickIcon} isOut={isOut} />}
        {isLocation && <LocationBody msg={msg} time={time} status={status} tickIcon={tickIcon} isOut={isOut} />}
        {isContact && <ContactCardBody msg={msg} time={time} status={status} tickIcon={tickIcon} isOut={isOut} onNavigateToJid={onNavigateToJid} />}

        {isTextKind && jumboEmoji && (
          <div className="wac__jumbo">
            <span className="wac__jumbo-emoji">{msg.body}</span>
            <span className={'wac__jumbo-meta' + (isOut ? ' is-out' : '') + (status === 'read' ? ' is-read' : '')}>
              {msg.is_starred && <IconStar size={12} />}
              {msg.is_pinned && <IconWaPinSmall size={12} />}
              {msg.edited_at && <span className="wac__bubble-edited">Modifié</span>}
              <span>{time}</span>
              {isOut && tickIcon}
            </span>
          </div>
        )}

        {isTextKind && !jumboEmoji && (
          <>
            <BubbleLinkPreview msg={msg} isOut={isOut} />
            <div className={'wac__bubble-text' + (msg.edited_at ? ' is-edited' : '') + (msg.is_pinned ? ' is-pinned' : '')}>
              <BubbleTextBody
                text={msg.body || ''}
                isOut={isOut}
                mentionedJid={(meta.mentionedJid as string[] | undefined)}
                contactMap={contactMap}
                readMore
              />
              <span className={'wac__bubble-meta' + (status === 'read' ? ' is-read' : '')}>
                {msg.is_starred && <IconStar size={12} />}
              {msg.is_pinned && <IconWaPinSmall size={12} />}
                {msg.edited_at && <span className="wac__bubble-edited">Modifié</span>}
                <span>{time}</span>
                {isOut && tickIcon}
              </span>
            </div>
          </>
        )}

        {!isWaitingForMessage && kind !== 'system' && !isProblem && (
          <button
            className="wac__bubble-action"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              onAction?.('context', msg, rect)
            }}
            aria-label="Menu"
          >
            <IconChevronDown size={16} />
          </button>
        )}

      </div>
      {!isWaitingForMessage && kind !== 'system' && !isProblem && (
        <button
          className="wac__bubble-react-trigger"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            onAction?.('reaction', msg, rect)
          }}
          aria-label="Réagir"
        >
          <IconSmileyFace size={20} />
        </button>
      )}
      {showForward && (
        <button
          className="wac__bubble-forward-trigger"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            onAction?.('forward', msg, rect)
          }}
          aria-label="Transférer"
          title="Transférer"
        >
          <IconForwardAll size={19} />
        </button>
      )}
      <ReactionPills reactions={msg.reactions} isOut={isOut} />
      </div>
    </div>
  )
}

// True when `text` is exactly one emoji (emoji-only, single grapheme cluster).
// Handles multi-codepoint emoji (ZWJ sequences, skin tones, variation
// selectors) via Intl.Segmenter, with a regex fallback. Used for WhatsApp's
// jumbo bubble-less rendering of a lone emoji.
function isSingleEmoji(text: string | null | undefined): boolean {
  if (!text) return false
  const t = text.trim()
  if (!t) return false
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const graphemes = Array.from(seg.segment(t), (s) => s.segment)
    if (graphemes.length !== 1) return false
    return /\p{Extended_Pictographic}/u.test(graphemes[0])
  } catch {
    return /^\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u.test(t)
  }
}

function ReactionPills({ reactions, isOut }: { reactions: unknown; isOut: boolean }) {
  const pills = useMemo(() => {
    if (!reactions || !Array.isArray(reactions) || reactions.length === 0) return null
    // Aggregate: group by emoji, count occurrences
    const counts = new Map<string, number>()
    for (const r of reactions) {
      const emoji = (r as { emoji?: string }).emoji
      if (emoji) counts.set(emoji, (counts.get(emoji) ?? 0) + 1)
    }
    if (counts.size === 0) return null
    return Array.from(counts.entries()).map(([emoji, count]) => ({ emoji, count }))
  }, [reactions])

  if (!pills) return null

  const total = pills.reduce((s, p) => s + p.count, 0)

  return (
    <div className={'wac__reactions' + (isOut ? ' is-out' : '')}>
      {pills.map((p, i) => (
        <span key={i} className="wac__reaction-pill">
          <span className="wac__reaction-emoji">{p.emoji}</span>
          {p.count > 1 && <span className="wac__reaction-count">{p.count}</span>}
        </span>
      ))}
      {total > 1 && pills.length > 1 && (
        <span className="wac__reaction-total">{total}</span>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Message context menu (hover actions popup)
// ──────────────────────────────────────────────────────────────────────────────

const QUICK_REACTIONS = ['\u{1F44D}', '\u{2764}️', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}']

// French copy for edit_message RPC error codes.
const EDIT_ERR_FR: Record<string, string> = {
  edit_window_expired: 'Le délai de modification (15 min) est dépassé.',
  can_only_edit_text_kind: 'Seuls les messages texte peuvent être modifiés.',
  can_only_edit_outbound: 'Seuls vos messages peuvent être modifiés.',
  already_revoked: 'Ce message a déjà été supprimé.',
  message_not_yet_dispatched: 'Message pas encore envoyé.',
  text_required: 'Le message ne peut pas être vide.',
}

// Contact picker — select one or many resolved contacts to share. A single
// selection sends one contactMessage; multiple = one contactsArrayMessage
// (one paced send). Only contacts WITH a phone JID (real WhatsApp numbers) are
// offered, so the shared card renders native on the recipient device.
function ContactPickerModal({
  instanceId, onClose, onSend,
}: {
  instanceId: string | null
  onClose: () => void
  onSend: (cards: ContactCardData[]) => void | Promise<void>
}) {
  const { data: contacts } = useContacts(instanceId)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const shareable = useMemo(() => (contacts ?? []).filter((c) => !!c.phone_jid), [contacts])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return shareable
    return shareable.filter((c) =>
      (c.book_name ?? '').toLowerCase().includes(q) ||
      (c.push_name ?? '').toLowerCase().includes(q) ||
      (c.phone_number ?? '').toLowerCase().includes(q) ||
      (c.phone_jid ?? '').toLowerCase().includes(q))
  }, [shareable, query])

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const submit = async () => {
    const cards = [...selected]
      .map((id) => contacts?.find((c) => c.id === id))
      .filter((c): c is Contact => !!c)
      .map(buildContactCard)
      .filter((c): c is ContactCardData => !!c)
    if (cards.length === 0) return
    setBusy(true)
    try { await onSend(cards) } finally { setBusy(false) }
  }

  return (
    <div className="wac__modal-overlay" onClick={onClose}>
      <div className="wac__contactpick" role="dialog" aria-modal="true" aria-labelledby="contactpick-title" onClick={(e) => e.stopPropagation()}>
        <div className="wac__contactpick-head">
          <button type="button" className="wac__editmsg-close" aria-label="Fermer" onClick={onClose}>
            <IconClose size={20} />
          </button>
          <span id="contactpick-title">Envoyer un contact</span>
        </div>
        <div className="wac__contactpick-search">
          <IconSearch size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un contact" autoFocus />
        </div>
        <div className="wac__contactpick-list">
          {filtered.length === 0 && <div className="wac__contactpick-empty">Aucun contact</div>}
          {filtered.map((c) => {
            const name = c.book_name || c.push_name || c.phone_number || 'Contact'
            const checked = selected.has(c.id)
            return (
              <button key={c.id} type="button" className={'wac__contactpick-row' + (checked ? ' is-selected' : '')} onClick={() => toggle(c.id)}>
                <span className="wac__contactpick-avatar">
                  {c.profile_pic ? <img src={c.profile_pic} alt="" draggable={false} /> : <IconUser size={20} />}
                </span>
                <span className="wac__contactpick-info">
                  <span className="wac__contactpick-name">{name}</span>
                  {c.phone_number && <span className="wac__contactpick-phone">{c.phone_number}</span>}
                </span>
                <span className="wac__contactpick-check" aria-hidden>
                  <IconCheckbox size={22} checked={checked} />
                </span>
              </button>
            )
          })}
        </div>
        <div className="wac__contactpick-foot">
          <span className="wac__contactpick-count">
            {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <button type="button" className="wac__contactpick-send" disabled={selected.size === 0 || busy} aria-label="Envoyer" onClick={() => { void submit() }}>
            <IconSend size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}

// "Modifier le message" — outbound text edit within the 15-min window.
function EditMessageModal({ msg, onClose }: { msg: MessageDecrypted; onClose: () => void }) {
  const [text, setText] = useState(msg.body ?? '')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Focus with the caret at the end (plain focus() leaves it at the start in Firefox).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  // Auto-resize (composer mechanic): height follows content; the CSS
  // max-height clamps and overflow-y takes over past it. +2 absorbs the
  // border-bottom under global border-box (scrollHeight is content-only),
  // else a 2px scroll remainder shows a gutter on classic scrollbars.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = (el.scrollHeight + 2) + 'px'
  }, [text])

  const trimmed = text.trim()
  const unchanged = trimmed === (msg.body ?? '').trim()
  const canSubmit = trimmed.length > 0 && !unchanged && !busy

  const submit = async () => {
    if (!canSubmit || !msg.id) return
    setBusy(true); setError(null)
    try {
      await editMessage(msg.id, trimmed)
      onClose()
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e)
      setError(EDIT_ERR_FR[code] ?? 'La modification a échoué.')
      setBusy(false)
    }
  }

  return (
    <div className="wac__modal-overlay" onClick={onClose}>
      <div className="wac__editmsg" role="dialog" aria-modal="true" aria-labelledby="editmsg-title" onClick={(e) => e.stopPropagation()}>
        <div className="wac__editmsg-head">
          <button type="button" className="wac__editmsg-close" aria-label="Fermer" onClick={onClose}>
            <IconClose size={20} />
          </button>
          <span id="editmsg-title">Modifier le message</span>
        </div>
        <div className="wac__editmsg-preview">
          <div className="wac__editmsg-bubble">
            <span className="wac__editmsg-bubble-text">{text || ' '}</span>
            <span className="wac__editmsg-bubble-meta">
              {formatBubbleTime(msg.whatsapp_timestamp)}
              <IconCheckSingle />
            </span>
          </div>
        </div>
        <div className="wac__editmsg-inputrow">
          <textarea
            ref={inputRef}
            className="wac__editmsg-input"
            value={text}
            rows={1}
            onChange={(e) => { setText(e.target.value); if (error) setError(null) }}
            onKeyDown={(e) => {
              // Enter = save, Shift+Enter = newline — same convention as the composer.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (canSubmit) void submit()
              }
            }}
            placeholder="Modifier le message"
          />
          <div className="wac__editmsg-emoji-wrap">
            <button type="button" className="wac__editmsg-emoji" aria-label="Emoji" onClick={() => setEmojiOpen((o) => !o)}>
              <IconSmileyFace size={24} />
            </button>
            {emojiOpen && (
              <div className="wac__editmsg-emoji-pop">
                <ReactionEmojiGrid onSelect={(emoji) => { setText((t) => t + emoji); setEmojiOpen(false); inputRef.current?.focus() }} />
              </div>
            )}
          </div>
          <button type="button" className="wac__editmsg-confirm" aria-label="Enregistrer" disabled={!canSubmit} onClick={() => { void submit() }}>
            <IconCheck size={22} />
          </button>
        </div>
        {error && <div className="wac__editmsg-error">{error}</div>}
      </div>
    </div>
  )
}

// "Supprimer le message(s) ?" — delete-for-everyone offered ONLY for a single
// outbound message still inside the 60h window; otherwise delete-for-me only.
function DeleteMessageModal({
  messages, onDeleteForMe, onDeleteForEveryone, onClose,
}: {
  messages: MessageDecrypted[]
  onDeleteForMe: () => void | Promise<void>
  onDeleteForEveryone: () => void | Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const single = messages.length === 1
  const everyoneOk = single && messages[0]
    ? computeMsgEligibility(messages[0], Date.now()).canDeleteForEveryone
    : false
  const run = (fn: () => void | Promise<void>) => async () => { setBusy(true); try { await fn() } finally { setBusy(false) } }

  return (
    <div className="wac__modal-overlay" onClick={onClose}>
      <div className="wac__modal wac__delmsg" role="dialog" aria-modal="true" aria-labelledby="delmsg-title" onClick={(e) => e.stopPropagation()}>
        <div className="wac__modal-head">
          <span id="delmsg-title">{single ? 'Supprimer le message ?' : 'Supprimer les messages ?'}</span>
        </div>
        <div className="wac__delmsg-actions">
          {everyoneOk && (
            <button type="button" className="wac__delmsg-btn" disabled={busy} onClick={run(onDeleteForEveryone)}>
              Supprimer pour tout le monde
            </button>
          )}
          <button type="button" className="wac__delmsg-btn" disabled={busy} onClick={run(onDeleteForMe)}>
            Supprimer pour moi
          </button>
          <button type="button" className="wac__delmsg-btn wac__delmsg-btn--cancel" disabled={busy} onClick={onClose}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageContextMenu({
  msg, rect, type, isOut, onReply, onClose, onForward, onEdit, onDelete, onPin,
}: {
  msg: MessageDecrypted
  rect: DOMRect
  type: 'context' | 'reaction'
  isOut: boolean
  onReply: (msg: MessageDecrypted) => void
  onClose: () => void
  onForward?: (msg: MessageDecrypted) => void
  onEdit?: (msg: MessageDecrypted) => void
  onDelete?: (msg: MessageDecrypted) => void
  onPin?: (msg: MessageDecrypted) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [showFullPicker, setShowFullPicker] = useState(false)
  // Eligibility is time-sensitive; compute once at open (menu is short-lived).
  const eligibility = useMemo(() => computeMsgEligibility(msg, Date.now()), [msg])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleReaction = async (emoji: string) => {
    try {
      await sendReaction(msg.id!, emoji)
    } catch (e) { toast.error(normalizeError(e)) }
    onClose()
  }

  const handleCopy = () => {
    if (msg.body) navigator.clipboard.writeText(msg.body)
    onClose()
  }

  const handleStar = async () => {
    try {
      await toggleStar(msg.id!)
    } catch (e) { toast.error(normalizeError(e)) }
    onClose()
  }

  const handlePin = () => {
    if (msg.is_pinned) {
      // Unpin is immediate, no dialog.
      void setMessagePin(msg.id!, false).catch((e) => toast.error(normalizeError(e)))
      onClose()
    } else {
      // Pin opens WhatsApp's duration picker (handled by the parent).
      onPin?.(msg)
      onClose()
    }
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
  }
  // Horizontal: align to the bubble's edge.
  if (isOut) {
    style.right = window.innerWidth - rect.right
  } else {
    style.left = rect.left
  }
  // Vertical: prefer opening ABOVE the bubble (WhatsApp style), but if the menu
  // would overflow the top of the viewport, open BELOW instead. Estimated
  // height covers the reaction row + up to ~8 items; a maxHeight + scroll is the
  // final safety net so it can never exceed the screen.
  const EST_MENU_H = type === 'context' ? 410 : 70
  style.maxHeight = window.innerHeight - 16
  style.overflowY = 'auto'
  if (rect.top - 4 >= EST_MENU_H) {
    style.bottom = window.innerHeight - rect.top + 4
  } else {
    style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - EST_MENU_H - 8))
  }

  if (showFullPicker) {
    const pickerStyle: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
    }
    // Clamp within viewport
    const ph = 360, pw = 320
    if (isOut) {
      pickerStyle.right = Math.max(4, window.innerWidth - rect.right)
    } else {
      pickerStyle.left = Math.min(rect.left, window.innerWidth - pw - 4)
    }
    const topCandidate = rect.top - ph - 4
    if (topCandidate >= 4) {
      pickerStyle.top = topCandidate
    } else {
      pickerStyle.top = Math.max(4, Math.min(rect.bottom + 4, window.innerHeight - ph - 4))
    }
    return (
      <div ref={menuRef} className="wac__reaction-picker-full" style={pickerStyle}>
        <ReactionEmojiGrid onSelect={(emoji) => { void handleReaction(emoji) }} />
      </div>
    )
  }

  return (
    <div ref={menuRef} className={'wac__msg-context' + (type === 'context' ? ' wac__msg-context--with-items' : '')} style={style}>
      <div className="wac__msg-context-reactions">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            className="wac__msg-context-reaction-btn"
            onClick={() => { void handleReaction(emoji) }}
          >
            {emoji}
          </button>
        ))}
        <button
          className="wac__msg-context-reaction-btn wac__msg-context-reaction-plus"
          onClick={() => setShowFullPicker(true)}
        >
          +
        </button>
      </div>
      {type === 'context' && (
        <div className="wac__msg-context-items">
          <button className="wac__msg-context-item" onClick={() => { onReply(msg); onClose() }}>
            <IconReply size={18} /> Répondre
          </button>
          {msg.body && (
            <button className="wac__msg-context-item" onClick={handleCopy}>
              <IconCopy size={18} /> Copier
            </button>
          )}
          <button className="wac__msg-context-item" onClick={() => setShowFullPicker(true)}>
            <IconSmileyFace size={18} /> Réagir
          </button>
          <button className="wac__msg-context-item" onClick={() => { onForward?.(msg); onClose() }}>
            <IconForwardAll size={18} /> Transférer
          </button>
          <button className="wac__msg-context-item" onClick={() => { void handleStar() }}>
            <IconStar size={18} /> {msg.is_starred ? 'Retirer des importants' : 'Marquer comme important'}
          </button>
          <button className="wac__msg-context-item" onClick={() => { void handlePin() }}>
            {msg.is_pinned ? <IconWaUnpin size={18} /> : <IconWaPin size={18} />} {msg.is_pinned ? 'Détacher' : 'Épingler'}
          </button>
          {eligibility.canEdit && (
            <button className="wac__msg-context-item" onClick={() => { onEdit?.(msg); onClose() }}>
              <IconPencil size={18} /> Modifier
            </button>
          )}
          <button className="wac__msg-context-item" onClick={() => { onDelete?.(msg); onClose() }}>
            <IconTrash size={18} /> Supprimer
          </button>
        </div>
      )}
    </div>
  )
}

function ReactionEmojiGrid({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const catRefs = useRef<(HTMLDivElement | null)[]>([])

  const recentEmojis = useMemo(() => {
    try {
      const raw = localStorage.getItem('wam.emoji.recent')
      return raw ? (JSON.parse(raw) as string[]).slice(0, 20) : []
    } catch { return [] }
  }, [])

  const allCats = useMemo(() => {
    const c = [...EMOJI_CATEGORIES]
    c[0] = { ...c[0], emojis: recentEmojis }
    return c
  }, [recentEmojis])

  const displayCats = useMemo(() => {
    if (!search) return allCats
    const q = search.toLowerCase()
    const matched = EMOJI_DATA.flatMap(cat => cat.emojis).filter(e => (EMOJI_KEYWORDS[e] ?? '').includes(q))
    return [{ label: 'Résultats', iconKey: 'recent' as const, emojis: [...new Set(matched)] }]
  }, [search, allCats])

  const scrollToCat = (i: number) => {
    setActiveCat(i)
    setSearch('')
    const el = catRefs.current[i]
    if (el && gridRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <>
      <div className="wac__rpf-tabs">
        {EMOJI_CATEGORIES.map((cat, i) => {
          const Icon = EpCatIcons[cat.iconKey]
          return (
            <button
              key={cat.iconKey}
              className={'wac__rpf-tab' + (activeCat === i && !search ? ' is-active' : '')}
              onClick={() => scrollToCat(i)}
              title={cat.label}
            >
              <Icon />
            </button>
          )
        })}
      </div>
      <div className="wac__rpf-search">
        <IconSearch size={16} />
        <input
          type="text"
          placeholder="Rechercher réaction"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="wac__rpf-grid" ref={gridRef}>
        {displayCats.map((cat, ci) => (
          cat.emojis.length > 0 && (
            <div key={cat.label} ref={(el) => { if (!search) catRefs.current[ci] = el }}>
              <div className="wac__rpf-cat-label">{cat.label}</div>
              <div className="wac__rpf-emojis">
                {cat.emojis.map((emoji, i) => (
                  <button key={`${emoji}-${i}`} className="wac__rpf-emoji" onClick={() => onSelect(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )
        ))}
        {displayCats.every(c => c.emojis.length === 0) && (
          <div className="wac__rpf-empty">Aucun emoji trouvé</div>
        )}
      </div>
    </>
  )
}

// GIF bubble (WhatsApp parity): standalone, auto-plays once on mount then
// freezes with a centered "GIF" badge + GIPHY watermark; re-plays once on
// hover over the whole block, then freezes again.
function GifBody(
  { msg, time, status, tickIcon, isOut }:
  { msg: MessageDecrypted; time: string; status: string; tickIcon: ReactNode; isOut: boolean },
) {
  const resolved = useResolvedMediaUrl(msg)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const blockRef = useRef<HTMLDivElement | null>(null)
  const playsRef = useRef(0)
  const [ended, setEnded] = useState(false)
  const [aspect, setAspect] = useState<number | null>(null)

  const MIN_LOOPS = 2

  // Start a fresh play cycle from the top; resets the loop counter.
  const startCycle = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    playsRef.current = 0
    setEnded(false)
    try { v.currentTime = 0 } catch { /* not ready */ }
    void v.play().catch(() => { /* autoplay/seek race */ })
  }, [])

  // Hover anywhere on the full-width message row replays the GIF.
  useEffect(() => {
    const wrap = blockRef.current?.closest('.wac__bubble-wrap')
    if (!wrap) return
    const onEnter = () => startCycle()
    wrap.addEventListener('mouseenter', onEnter)
    return () => wrap.removeEventListener('mouseenter', onEnter)
  }, [startCycle])

  const handleEnded = () => {
    playsRef.current += 1
    if (playsRef.current < MIN_LOOPS) {
      const v = videoRef.current
      if (!v) return
      try { v.currentTime = 0 } catch { /* not ready */ }
      void v.play().catch(() => { /* race */ })
    } else {
      setEnded(true)
    }
  }

  return (
    <>
      <div
        ref={blockRef}
        className="wac__media wac__gif"
        style={{ aspectRatio: aspect ? String(aspect) : '4 / 3' }}
      >
        {resolved.url
          ? <video
              ref={videoRef}
              src={resolved.url}
              muted
              autoPlay
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const w = e.currentTarget.videoWidth
                const h = e.currentTarget.videoHeight
                if (w > 0 && h > 0) setAspect(w / h)
              }}
              onEnded={handleEnded}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          : <MediaPlaceholder kind="video" pending={resolved.pending} expired={resolved.expired} />
        }
        {ended && resolved.url && (
          <div className="wac__gif-badge"><span>GIF</span></div>
        )}
        {resolved.url && <span className="wac__gif-watermark">GIPHY</span>}
        <span className={'wac__media-overlay-meta' + (status === 'read' ? ' is-read' : '')}>
          {msg.is_starred && <IconStar size={12} />}
              {msg.is_pinned && <IconWaPinSmall size={12} />}
          <span>{time}</span>
          {isOut && tickIcon}
        </span>
      </div>
      {msg.body && (
        <div className="wac__bubble-text" style={{ paddingRight: 0 }}>
          {msg.body}
        </div>
      )}
    </>
  )
}

function MediaBody(
  { msg, time, status, tickIcon, isOut, onOpenMedia }:
  { msg: MessageDecrypted; time: string; status: string; tickIcon: ReactNode; isOut: boolean; onOpenMedia?: (msg: MessageDecrypted) => void },
) {
  if (isGifMsg(msg)) return <GifBody msg={msg} time={time} status={status} tickIcon={tickIcon} isOut={isOut} />
  const isVideo = msg.kind === 'video'
  const resolved = useResolvedMediaUrl(msg)
  const vmeta = (msg.media_meta ?? {}) as { seconds?: number; duration_ms?: number }
  // Prefer the server-captured WhatsApp `seconds`; fall back to in-app
  // duration_ms; finally fall back to the actual <video> element's reported
  // duration (loaded via preload="metadata" without needing to play — this
  // covers legacy videos ingested before `seconds` was captured).
  const [loadedSec, setLoadedSec] = useState(0)
  const vSec = typeof vmeta.seconds === 'number' && vmeta.seconds > 0
    ? vmeta.seconds
    : typeof vmeta.duration_ms === 'number' && vmeta.duration_ms > 0
      ? Math.round(vmeta.duration_ms / 1000)
      : loadedSec
  const vDur = vSec > 0
    ? `${Math.floor(vSec / 60)}:${String(Math.floor(vSec % 60)).padStart(2, '0')}`
    : null
  return (
    <>
      <div
        className="wac__media"
        style={{ aspectRatio: '4 / 3', cursor: resolved.url ? 'pointer' : undefined }}
        onClick={() => { if (resolved.url && onOpenMedia) onOpenMedia(msg) }}
      >
        {resolved.url
          ? isVideo
            ? <video
                src={resolved.url}
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d) && d > 0) setLoadedSec(Math.round(d))
                }}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            : <img src={resolved.url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <MediaPlaceholder kind={isVideo ? 'video' : 'image'} pending={resolved.pending} expired={resolved.expired} />
        }
        {isVideo && resolved.url && (
          <div className="wac__media-play">
            <div className="wac__media-play-inner"><IconPlay size={22} /></div>
          </div>
        )}
        {isVideo && resolved.url && (
          <span className="wac__media-meta">
            <IconVideo /> {vDur ?? ''}
          </span>
        )}
        <span className={'wac__media-overlay-meta' + (status === 'read' ? ' is-read' : '')}>
          {msg.is_starred && <IconStar size={12} />}
              {msg.is_pinned && <IconWaPinSmall size={12} />}
          <span>{time}</span>
          {isOut && tickIcon}
        </span>
      </div>
      {msg.body && (
        <div className="wac__bubble-text" style={{ paddingRight: 0 }}>
          {msg.body}
        </div>
      )}
    </>
  )
}

/**
 * Placeholder shown inside a media bubble when the bytes aren't ready or
 * have been lost. Three states:
 *   - pending  → worker is fetching from Evolution; render a spinner.
 *   - expired  → fetch failed permanently (Evolution dropped it after ~14d);
 *                show a muted "Média indisponible" message.
 *   - neither  → fallback default icon (shouldn't normally hit).
 */
function MediaPlaceholder({
  kind, pending, expired,
}: { kind: 'image' | 'video'; pending: boolean; expired: boolean }) {
  if (pending) {
    return (
      <div className="wac__media-placeholder is-pending" aria-live="polite">
        <IconClock />
        <span>Téléchargement…</span>
      </div>
    )
  }
  if (expired) {
    return (
      <div className="wac__media-placeholder is-expired">
        {kind === 'video' ? <IconVideo size={32} /> : <IconImage size={32} />}
        <span>Média indisponible</span>
      </div>
    )
  }
  return kind === 'video' ? <IconVideo size={48} /> : <IconImage size={48} />
}

// ── Optimistic upload bubble (client-only) ──────────────────────────────────
//
// A WhatsApp-style "sending" bubble shown IMMEDIATELY when the staging overlay
// fires, before the real media_pending row exists. Reuses the exact outbound
// media geometry (.wac__bubble--media > .wac__media, 280px 4/3) so the swap to
// the real bubble is seamless. A determinate ring shows upload %; the centre
// button is an X (cancel) while uploading and a retry glyph on failure.

/** Determinate circular progress ring (0..1) with a centred slot. */
function ProgressRing({ fraction, children }: { fraction: number; children?: ReactNode }) {
  const size = 52
  const stroke = 3
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, fraction))
  return (
    <div className="wac__ring" style={{ width: size, height: size }}>
      <svg className="wac__ring-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="wac__ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="wac__ring-value"
          cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - clamped)} strokeLinecap="round"
        />
      </svg>
      <div className="wac__ring-center">{children}</div>
    </div>
  )
}

function PendingUploadBubble({ pu }: { pu: PendingUpload }) {
  const isVisual = pu.kind === 'image' || pu.kind === 'video'
  const isError = pu.status === 'error'
  const isUploading = pu.status === 'uploading'
  const pct = Math.round(pu.progress * 100)
  return (
    <div
      className="wac__bubble-wrap is-out is-streak-head is-streak-tail"
      style={{ marginTop: 8, marginBottom: 4 }}
    >
      <div className="wac__bubble-col">
        <div className="wac__bubble wac__bubble--media">
          <div className="wac__media wac__media--uploading">
            {isVisual ? (
              pu.kind === 'video'
                ? <video src={pu.localBlobUrl} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={pu.localBlobUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div className="wac__upload-fileicon">
                {pu.kind === 'audio' ? <IconHeadphones size={40} /> : <IconDocument size={40} />}
              </div>
            )}

            <div className={'wac__upload-overlay' + (isError ? ' is-error' : '')}>
              {isError ? (
                <button
                  type="button"
                  className="wac__upload-btn"
                  onClick={() => retryPendingUpload(pu.clientId)}
                  aria-label="Réessayer l’envoi"
                  title="Réessayer"
                >
                  <IconRetry size={26} />
                </button>
              ) : (
                <ProgressRing fraction={pu.progress}>
                  {isUploading ? (
                    <button
                      type="button"
                      className="wac__upload-btn"
                      onClick={() => abortPendingUpload(pu.clientId)}
                      aria-label="Annuler l’envoi"
                      title="Annuler"
                    >
                      <IconClose size={22} />
                    </button>
                  ) : (
                    <span className="wac__upload-spin" aria-label="Envoi en cours" />
                  )}
                </ProgressRing>
              )}
            </div>

            {isError && (
              <button
                type="button"
                className="wac__upload-dismiss"
                onClick={() => removePendingUpload(pu.clientId)}
                aria-label="Supprimer"
                title="Supprimer"
              >
                <IconClose size={14} />
              </button>
            )}

            <span className="wac__media-overlay-meta">
              <span>{isError ? (pu.cancelled ? 'Annulé' : 'Échec') : isUploading ? `${pct} %` : 'Envoi…'}</span>
            </span>
          </div>
          {pu.caption.trim() && (
            <div className="wac__bubble-text" style={{ paddingRight: 0 }}>{pu.caption}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Album bubble (multi-media grid) ─────────────────────────────────────────

function AlbumCell({ msg, onClick }: { msg: MessageDecrypted; onClick: () => void }) {
  const resolved = useResolvedMediaUrl(msg)
  const isVideo = msg.kind === 'video'
  return (
    <div className="wac__album-cell" data-msg-id={msg.id} onClick={() => { if (resolved.url) onClick() }}>
      {resolved.url
        ? isVideo
          ? <video src={resolved.url} preload="metadata" />
          : <img src={resolved.url} alt="" draggable={false} />
        : <MediaPlaceholder kind={isVideo ? 'video' : 'image'} pending={resolved.pending} expired={resolved.expired} />
      }
      {isVideo && resolved.url && (
        <div className="wac__album-cell-play"><IconPlay size={16} /></div>
      )}
    </div>
  )
}

function AlbumOverflowCell({ msg, count, onClick, time, status, tickIcon, isOut, isStarred }: {
  msg: MessageDecrypted; count: number; onClick: () => void
  time: string; status: string; tickIcon: ReactNode; isOut: boolean; isStarred?: boolean
}) {
  const resolved = useResolvedMediaUrl(msg)
  const isVideo = msg.kind === 'video'
  return (
    <div className="wac__album-overflow" data-msg-id={msg.id} onClick={onClick}>
      {resolved.url && (
        isVideo
          ? <video src={resolved.url} preload="metadata" className="wac__album-overflow-bg" />
          : <img src={resolved.url} alt="" draggable={false} className="wac__album-overflow-bg" />
      )}
      <span className="wac__album-overflow-count">+{count}</span>
      <span className={'wac__album-meta' + (status === 'read' ? ' is-read' : '')}>
        {isStarred && <IconStar size={12} />}
        <span>{time}</span>
        {isOut && tickIcon}
      </span>
    </div>
  )
}

function AlbumBubble({
  messages, isOut, streakHead, streakTail, isGroup,
  onOpenMedia, contactMap,
  forwardMode, forwardSelected, onForwardToggle,
  deleteMode, deleteSelected, onDeleteToggle,
}: {
  messages: MessageDecrypted[]
  isOut: boolean
  streakHead: boolean
  streakTail: boolean
  isGroup: boolean
  onOpenMedia?: (msg: MessageDecrypted) => void
  contactMap?: Map<string, { pushName: string | null; pic: string | null; bookName: string | null }>
  forwardMode?: boolean
  forwardSelected?: boolean
  onForwardToggle?: () => void
  deleteMode?: boolean
  deleteSelected?: boolean
  onDeleteToggle?: () => void
}) {
  const selectMode = !!forwardMode || !!deleteMode
  const selected = forwardMode ? !!forwardSelected : !!deleteSelected
  const onSelectToggle = forwardMode ? onForwardToggle : onDeleteToggle
  const first = messages[0]
  const last = messages[messages.length - 1]
  const time = formatBubbleTime(last.whatsapp_timestamp)
  const status = normalizeDeliveryStatus(last.delivery_status)
  const senderColor = senderColorVar(first.sender_jid)

  const tickIcon =
    status === 'read'      ? <IconCheckDouble className="wac__tick-read" />
    : status === 'delivered' ? <IconCheckDouble />
    : status === 'sent'    ? <IconCheckSingle />
    :                        <IconClock />

  const contact = isGroup && !isOut && first.sender_jid ? contactMap?.get(first.sender_jid) : undefined
  const meta = (first.media_meta ?? {}) as Record<string, unknown>
  const senderName = isGroup && !isOut
    ? contact?.bookName || contact?.pushName || (meta.pushName as string | undefined) || prettySender(first.sender_jid)
    : null
  const senderPic = contact?.pic ?? null
  const senderInitials = senderName
    ? senderName.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
    : ''

  const visible = messages.slice(0, 3)
  const overflow = messages.length - 3
  const caption = [...messages].reverse().find(m => m.body)?.body

  return (
    <div
      className={
        'wac__bubble-wrap'
        + (isOut ? ' is-out' : ' is-in')
        + (streakHead ? ' is-streak-head' : '')
        + (streakTail ? ' is-streak-tail' : '')
        + (isGroup && !isOut ? ' is-group-in' : '')
        + (selectMode ? ' is-forward-mode' : '')
        + (selected ? ' is-forward-selected' : '')
      }
      style={{
        marginTop: selectMode ? 1 : streakHead ? 8 : 1,
        marginBottom: selectMode ? 1 : streakTail ? 4 : 1,
      }}
      onClick={selectMode ? onSelectToggle : undefined}
    >
      {messages.map(m => <span key={m.id} data-msg-id={m.id} style={{ display: 'none' }} />)}
      {selectMode && (
        <div
          className={'wac__forward-check' + (selected ? ' is-checked' : '')}
          onClick={(e) => { e.stopPropagation(); onSelectToggle?.() }}
          role="checkbox"
          aria-checked={selected}
        >
          <IconCheckbox size={22} checked={selected} />
        </div>
      )}

      {isGroup && !isOut && (
        <div className={'wac__group-avatar' + (streakHead ? '' : ' is-spacer')}>
          {streakHead && (
            <div className="wac__group-avatar-circle" style={{ background: senderPic ? 'transparent' : senderColor }}>
              {senderPic
                ? <img src={senderPic} alt="" draggable={false} />
                : senderInitials}
            </div>
          )}
        </div>
      )}

      <div className="wac__bubble-col">
        <div
          className="wac__bubble wac__bubble--album"
          style={{ ['--wa-sender-color' as string]: senderColor }}
        >
          {streakHead && isGroup && !isOut && senderName && (
            <span className="wac__bubble-sender" style={{ color: senderColor }}>
              {senderName}
            </span>
          )}

          <div className="wac__album-grid">
            {visible.map(m => (
              <AlbumCell key={m.id} msg={m} onClick={() => onOpenMedia?.(m)} />
            ))}
            <AlbumOverflowCell
              msg={messages[3]}
              count={overflow}
              onClick={() => onOpenMedia?.(messages[3])}
              time={time}
              status={status}
              tickIcon={tickIcon}
              isOut={isOut}
              isStarred={last.is_starred ?? undefined}
            />
          </div>

          {caption && (
            <div className="wac__bubble-text" style={{ paddingRight: 6, paddingLeft: 6, paddingBottom: 4 }}>
              {caption}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StickerBody({
  msg, time, status, tickIcon, isOut,
}: { msg: MessageDecrypted; time: string; status: string; tickIcon: ReactNode; isOut: boolean }) {
  const resolved = useResolvedMediaUrl(msg)
  return (
    <div className="wac__sticker">
      {resolved.url ? (
        <img src={resolved.url} alt="" draggable={false} />
      ) : resolved.pending ? (
        <div className="wac__sticker-placeholder">
          <IconClock size={24} />
        </div>
      ) : (
        <div className="wac__sticker-placeholder">
          <IconSticker size={24} />
        </div>
      )}
      <span className={'wac__sticker-meta' + (status === 'read' ? ' is-read' : '')}>
        {msg.is_starred && <IconStar size={12} />}
              {msg.is_pinned && <IconWaPinSmall size={12} />}
        <span>{time}</span>
        {isOut && tickIcon}
      </span>
    </div>
  )
}

function QuoteLocationThumb({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const map = useRef<maplibregl.Map | null>(null)
  useEffect(() => {
    if (!ref.current || map.current) return
    import('maplibre-gl').then((ml) => {
      const m = new ml.default.Map({
        container: ref.current!,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [lng, lat],
        zoom: 14,
        interactive: false,
        attributionControl: false,
      })
      const el = document.createElement('div')
      el.className = 'wac__loc-pin'
      new ml.default.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(m)
      map.current = m
    })
    return () => { map.current?.remove(); map.current = null }
  }, [lat, lng])
  return <div className="wac__quote-loc-thumb" ref={ref} />
}

function useContactPic(instanceId: string | null, jid: string | null) {
  return useQuery({
    queryKey: ['contact-pic', instanceId, jid],
    enabled: !!jid && !!instanceId,
    queryFn: async () => {
      const { data: contact } = await supabase
        .schema('whatsapp').from('contacts')
        .select('profile_pic, lid, phone_jid')
        .eq('instance_id', instanceId!)
        .or(`phone_jid.eq.${jid},lid.eq.${jid}`)
        .limit(1)
      if (contact?.[0]?.profile_pic) return contact[0].profile_pic as string
      const lookups = [jid!]
      const c = contact?.[0]
      if (c?.lid) lookups.push(c.lid as string)
      if (c?.phone_jid && (c.phone_jid as string) !== jid) lookups.push(c.phone_jid as string)
      const { data: conv } = await supabase
        .schema('whatsapp').from('conversations')
        .select('peer_profile_pic')
        .eq('instance_id', instanceId!)
        .or(lookups.map(j => `remote_jid.eq.${j}`).join(','))
        .not('peer_profile_pic', 'is', null)
        .limit(1)
      return (conv?.[0]?.peer_profile_pic as string) ?? null
    },
    staleTime: 5 * 60_000,
  })
}

function QuoteContactThumb({ jid, instanceId }: { jid: string | null; instanceId: string | null }) {
  const picQ = useContactPic(instanceId, jid)
  return (
    <div className="wac__quote-contact-thumb">
      {picQ.data ? <img src={picQ.data} alt="" draggable={false} /> : <IconUser size={24} />}
    </div>
  )
}

// Thumbnail of the exact image/video/sticker a reply quotes — resolves the same
// public R2 URL the bubble uses. Renders nothing while the media is still
// pending/expired (the quote falls back to its icon + label).
function QuoteMediaThumb({ storageKey, pending, mime, isVideo }: { storageKey: string | null; pending: boolean; mime: string | null; isVideo: boolean }) {
  const resolved = useResolvedMediaUrl({ media_storage_key: storageKey, media_pending: pending, media_mime: mime })
  if (!resolved.url) return null
  return (
    <div className="wac__quote-media-thumb">
      {isVideo
        ? <video src={resolved.url} preload="metadata" muted />
        : <img src={resolved.url} alt="" draggable={false} />}
      {isVideo && <span className="wac__quote-media-thumb-play"><IconPlay size={14} /></span>}
    </div>
  )
}

function LocationBody({
  msg, time, status, tickIcon, isOut,
}: { msg: MessageDecrypted; time: string; status: string; tickIcon: ReactNode; isOut: boolean }) {
  const meta = (msg.media_meta ?? {}) as Record<string, unknown>
  const lat = meta.lat as number | undefined
  const lng = meta.lng as number | undefined
  const name = meta.name as string | undefined
  const address = meta.address as string | undefined
  const isLive = meta.subtype === 'live_location'
  const mapRef = useRef<HTMLDivElement | null>(null)
  const mapInstance = useRef<maplibregl.Map | null>(null)
  const hasCoords = lat != null && lng != null

  useEffect(() => {
    if (!hasCoords || !mapRef.current || mapInstance.current) return
    import('maplibre-gl').then((ml) => {
      const map = new ml.default.Map({
        container: mapRef.current!,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [lng!, lat!],
        zoom: 15,
        interactive: false,
        attributionControl: false,
      })
      if (!isLive) {
        const el = document.createElement('div')
        el.className = 'wac__loc-pin'
        new ml.default.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng!, lat!]).addTo(map)
      }
      mapInstance.current = map
    })
    return () => { mapInstance.current?.remove(); mapInstance.current = null }
  }, [hasCoords, lat, lng, isLive])

  const mapsUrl = hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : undefined
  const hasInfo = !!(name || address)

  return (
    <a
      className="wac__loc"
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => { if (!mapsUrl) e.preventDefault() }}
    >
      <div className="wac__loc-map" ref={mapRef} />
      {!isLive && (
        <span className={'wac__media-overlay-meta' + (status === 'read' ? ' is-read' : '')}>
          <span>{time}</span>
          {isOut && tickIcon}
        </span>
      )}
      {isLive && (
        <div className="wac__loc-live-bar">
          <span className="wac__loc-live-text">Localisation en direct indisponible</span>
          <span className={'wac__loc-live-meta' + (status === 'read' ? ' is-read' : '')}>
            {time}
            {isOut && tickIcon}
          </span>
        </div>
      )}
      {hasInfo && (
        <div className="wac__loc-info">
          {name && <span className="wac__loc-name">{name}</span>}
          {address && <span className="wac__loc-addr">{address}</span>}
        </div>
      )}
    </a>
  )
}

// ── Inbox-wide audio playback manager ────────────────────────────────────────
// WhatsApp Web semantics: only ONE audio plays at a time (starting any voice
// note / audio file pauses whatever else was playing), and when one ends the
// registry auto-plays its chain successor — the bubble immediately below, IFF
// the render map declared it is also an audio (any other kind breaks the chain).
const audioRegistry = new Map<string, () => void>()
let exclusiveAudioEl: HTMLAudioElement | null = null
function claimExclusiveAudio(el: HTMLAudioElement): void {
  if (exclusiveAudioEl && exclusiveAudioEl !== el && !exclusiveAudioEl.paused) {
    exclusiveAudioEl.pause()
  }
  exclusiveAudioEl = el
}

function VoiceBody({
  msg, isOut, time, status, tickIcon, avatarUrl, avatarFallback, autoAdvanceToId,
}: {
  msg: MessageDecrypted
  isOut: boolean
  time: string
  status: string
  tickIcon: ReactNode
  avatarUrl: string | null
  avatarFallback?: { color: string; initials: string }
  /** Message id of the audio bubble directly below, when it should auto-play
   *  after this one ends (consecutive-audio chain). */
  autoAdvanceToId?: string | null
}) {
  const meta = (msg.media_meta ?? {}) as {
    duration_ms?: number
    seconds?: number
    waveform?: number[]
    ptt?: boolean
  } & Record<string, unknown>
  // duration_ms = set by our in-app recorder; seconds = WhatsApp's field for
  // received/file audio. Prefer ms, fall back to seconds×1000.
  const metaMs = typeof meta.duration_ms === 'number' && meta.duration_ms > 0
    ? meta.duration_ms
    : typeof meta.seconds === 'number' && meta.seconds > 0
      ? meta.seconds * 1000
      : 0
  // ptt=true → voice recording (avatar + mic). ptt=false → audio FILE
  // (orange headset circle). When ptt is ABSENT (outbound uploaded audio files
  // store no ptt key), fall back to fileName: uploaded files carry one; in-app
  // recordings and inbound voice notes never do. Prevents audio files rendering
  // as recordings.
  const isAudioFile = meta.ptt === false || (meta.ptt !== true && !!meta.fileName)
  const resolved = useResolvedMediaUrl(msg)
  const url = resolved.url

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const waveRef = useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(metaMs / 1000)
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1)

  // Auto-advance registry entry: lets the PREVIOUS audio in the chain start
  // this one when it ends (scrolled into view, WhatsApp-style).
  useEffect(() => {
    const id = msg.id
    if (!id) return
    audioRegistry.set(id, () => {
      const el = audioRef.current
      if (!el) return
      el.currentTime = 0
      void el.play()
      waveRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
    return () => { audioRegistry.delete(id) }
  }, [msg.id])

  // Deterministic pseudo-waveform when metadata doesn't carry one.
  const bars = useMemo(() => {
    if (Array.isArray(meta.waveform) && meta.waveform.length > 0) {
      return meta.waveform.slice(0, 48)
    }
    const seedSrc = msg.id ?? msg.evolution_message_id ?? ''
    let h = 0
    for (let i = 0; i < seedSrc.length; i++) h = ((h * 31) + seedSrc.charCodeAt(i)) | 0
    const out: number[] = []
    for (let i = 0; i < 48; i++) {
      h = (h * 1103515245 + 12345) | 0
      out.push(Math.abs(h) % 100)
    }
    return out
  }, [meta.waveform, msg.id, msg.evolution_message_id])

  function togglePlay() {
    const el = audioRef.current
    if (!el || !url) { setPlaying((v) => !v); return }
    if (el.paused) { el.playbackRate = speed; void el.play() }
    else { el.pause() }
  }
  function cycleSpeed() {
    const next: 1 | 1.5 | 2 = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1
    setSpeed(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  // Click / drag anywhere on the waveform to seek (pointer capture keeps the
  // drag tracking outside the bar). Seeking while paused just moves the
  // playhead; play resumes from there.
  function seekToClientX(clientX: number) {
    const el = audioRef.current
    const wave = waveRef.current
    if (!el || !wave) return
    const total = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : totalSec
    if (!(total > 0)) return
    const rect = wave.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    el.currentTime = frac * total
    setCurrent(frac * total)
  }

  const totalSec   = duration > 0 ? duration : metaMs / 1000
  const elapsed    = current > 0 ? current : 0
  const playedFrac = totalSec > 0 ? Math.min(1, elapsed / totalSec) : 0
  const playedIdx  = Math.floor(playedFrac * bars.length)
  const hasPlayed  = elapsed > 0
  // For inbound unplayed audio WA shows a green dot at start. For outbound
  // (or played inbound) it's a blue dot tracking the playhead.
  const dotFrac = hasPlayed ? playedFrac : 0
  const dotIsBlue = isOut || hasPlayed

  return (
    <div className={'wac__voice' + (isOut ? ' is-out' : ' is-in')}>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={(e) => { claimExclusiveAudio(e.currentTarget); setPlaying(true) }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false); setCurrent(0)
            if (autoAdvanceToId) audioRegistry.get(autoAdvanceToId)?.()
          }}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setDuration(d)
          }}
          style={{ display: 'none' }}
        />
      )}

      {isAudioFile ? (
        // Audio FILE (not a voice recording): WhatsApp shows an orange circle
        // with a headset icon in place of the avatar, always (no avatar, no
        // mic badge). Tapping while playing still cycles speed via the play
        // controls; the leading slot stays the headset identity.
        <div className="wac__voice-avatar wac__voice-fileicon" aria-label="Fichier audio">
          <IconHeadphones />
        </div>
      ) : playing ? (
        <button
          type="button"
          className="wac__voice-speed"
          onClick={cycleSpeed}
          aria-label={`Vitesse de lecture ${speed}×`}
          title={`${speed}×`}
        >
          {speed === 1.5 ? '1.5×' : `${speed}×`}
        </button>
      ) : (
        <div className="wac__voice-avatar" style={!avatarUrl && avatarFallback ? { background: avatarFallback.color } : undefined}>
          {avatarUrl
            ? <img src={avatarUrl} alt="" draggable={false} />
            : avatarFallback ? <span className="wac__voice-avatar-initials">{avatarFallback.initials}</span>
            : <IconUser />}
          <span className="wac__voice-avatar-mic"><IconMic /></span>
        </div>
      )}

      <button
        type="button"
        className="wac__voice-play"
        onClick={togglePlay}
        aria-label={playing ? 'Pause' : 'Lire le message vocal'}
      >
        {playing ? <IconPause /> : <IconPlay />}
      </button>

      <div
        className="wac__voice-wave"
        ref={waveRef}
        role="slider"
        aria-label="Position de lecture"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalSec)}
        aria-valuenow={Math.round(elapsed)}
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          seekToClientX(e.clientX)
        }}
        onPointerMove={(e) => { if (e.buttons & 1) seekToClientX(e.clientX) }}
      >
        {bars.map((amp, i) => {
          const h = 4 + Math.round((amp / 100) * 18)
          const played = i < playedIdx
          return (
            <span
              key={i}
              className={'wac__voice-bar' + (played ? ' is-played' : '')}
              style={{ height: h }}
            />
          )
        })}
        <span
          className={'wac__voice-playhead' + (dotIsBlue ? ' is-blue' : ' is-green')}
          style={{ left: `calc(${dotFrac * 100}% - 5px)` }}
          aria-hidden
        />
      </div>
      <div className={'wac__voice-time' + (status === 'read' ? ' is-read' : '')}>
        {/* WhatsApp shows the TOTAL duration until playback starts, then the
            elapsed counter while playing. */}
        <span>{formatMs(((playing || elapsed > 0) ? elapsed : totalSec) * 1000)}</span>
        <span className="wac__voice-time-right">
          {msg.is_starred && <IconStar size={12} />}
              {msg.is_pinned && <IconWaPinSmall size={12} />}
          <span>{hasPlayed ? formatMs(totalSec * 1000) : time}</span>
          {isOut && tickIcon}
        </span>
      </div>
    </div>
  )
}

/**
 * WhatsApp Business template bubble — matches WhatsApp Web's card layout:
 *   1. Header image (full-width, rounded top) — or placeholder if unavailable
 *   2. Footer text (gray italic, small) — above body per WA Web convention
 *   3. Body text (main content)
 *   4. Timestamp
 *   5. Button row (green text, full-width, divider) — below the bubble
 */
function TemplateBubbleBody({ msg, time, status, tickIcon, isOut, onOpenMedia }: {
  msg: MessageDecrypted; time: string; status: string
  tickIcon: React.ReactNode; isOut: boolean; onOpenMedia?: (msg: MessageDecrypted) => void
}) {
  const meta = (msg.media_meta ?? {}) as Record<string, unknown>
  const footer = meta.footer as string | null | undefined
  const hasImage = meta.hasImage === true || meta.hasImage === 'true'
  const thumbnail = meta.thumbnail as string | null | undefined
  const buttons = (meta.buttons ?? []) as Array<{ text?: string; url?: string; phone?: string }>
  // Use embedded thumbnail (base64) from the template payload. Evolution can't
  // serve template header images via getBase64FromMediaMessage, so R2 won't
  // have them. The thumbnail is the best we get from Baileys.
  const resolved = useResolvedMediaUrl(msg)
  const imgSrc = resolved.url ?? (thumbnail ? `data:image/jpeg;base64,${thumbnail}` : null)

  return (
    <>
      {/* Header image */}
      {hasImage && (
        <div
          className="wac__tpl-image"
          style={{ cursor: imgSrc ? 'pointer' : undefined }}
          onClick={() => { if (imgSrc && onOpenMedia) onOpenMedia(msg) }}
        >
          {imgSrc ? (
            <img
              src={imgSrc}
              alt=""
              draggable={false}
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div className="wac__tpl-image-placeholder">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" opacity="0.4">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
            </div>
          )}
        </div>
      )}

      {/* Footer (shown above body like WA Web) */}
      {footer && (
        <div className="wac__tpl-footer">{footer}</div>
      )}

      {/* Body text */}
      <div className="wac__bubble-text">
        <BubbleTextBody text={msg.body ?? ''} isOut={isOut} />
        <span className={'wac__bubble-meta' + (status === 'read' ? ' is-read' : '')}>
          {msg.is_starred && <IconStar size={12} />}
              {msg.is_pinned && <IconWaPinSmall size={12} />}
          <span>{time}</span>
          {isOut && tickIcon}
        </span>
      </div>

      {/* Buttons */}
      {buttons.length > 0 && (
        <div className="wac__tpl-buttons">
          {buttons.map((btn, i) => {
            const safeUrl = safeHttpUrl(btn.url)
            return (
            <a
              key={i}
              className="wac__tpl-btn"
              href={safeUrl ?? (btn.phone ? `tel:${btn.phone}` : undefined)}
              target={safeUrl ? '_blank' : undefined}
              rel={safeUrl ? 'noreferrer noopener' : undefined}
            >
              {safeUrl && (
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                  <path d="M4.5 2A.5.5 0 015 2.5V3h5.586l-6.293 6.293a.5.5 0 00.708.707L11.293 3.707 11 3.5V9a.5.5 0 001 0V2.5a.5.5 0 00-.5-.5h-7z"/>
                  <path d="M2 7.5A.5.5 0 012.5 7H6v1H3v5h8v-3h1v3.5a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-6z"/>
                </svg>
              )}
              {btn.phone && (
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                  <path d="M3.654 1.328a.678.678 0 00-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.568 17.568 0 004.168 6.608 17.569 17.569 0 006.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 00-.063-1.015l-2.307-1.794a.678.678 0 00-.58-.122l-2.19.547a1.745 1.745 0 01-1.657-.459L5.482 8.062a1.745 1.745 0 01-.46-1.657l.548-2.19a.678.678 0 00-.122-.58L3.654 1.328z"/>
                </svg>
              )}
              <span>{btn.text}</span>
            </a>
            )
          })}
        </div>
      )}
    </>
  )
}

/**
 * WhatsApp Web "waiting for message" pill — identical rendering to the real
 * app when Baileys couldn't decrypt a message (missing sender key, history
 * sync gap, or secret-encrypted message).
 *
 * Visual: lock icon + italic gray text + timestamp. No clickable action
 * since we can't retry decryption from the admin panel.
 */
// View-once placeholder — real-WhatsApp copy, no "En savoir plus" (owner
// ruling). Direction decides the sentence: inbound = "reçu … ouvrir que sur
// votre téléphone", outbound = "envoyé … depuis un autre appareil".
function ViewOnceBody({ isOut, time, status, tickIcon }: { isOut: boolean; time: string; status: string; tickIcon: ReactNode }) {
  return (
    <div className="wac__bubble-text wac__viewonce-body">
      <span className="wac__viewonce-icon" aria-hidden="true">
        <IconViewOnce size={18} />
      </span>
      <span className="wac__viewonce-text">
        {isOut
          ? 'Vous avez envoyé un message à vue unique depuis un autre appareil.'
          : "Vous avez reçu un message à vue unique. Pour plus de confidentialité, vous ne pouvez l'ouvrir que sur votre téléphone."}
      </span>
      <span className={'wac__bubble-meta' + (status === 'read' ? ' is-read' : '')}>
        <span>{time}</span>
        {isOut && tickIcon}
      </span>
    </div>
  )
}

function WaitingForMessageBody({ time }: { time: string }) {
  return (
    <div className="wac__bubble-text wac__waiting-body">
      <span className="wac__waiting-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </span>
      <span className="wac__waiting-text">
        Ce message n'a pas pu être chargé.
      </span>
      <span className="wac__bubble-meta">
        <span>{time}</span>
      </span>
    </div>
  )
}

// Message IDs known to have no extractable preview (e.g. a DOCX/XLSX with no
// embedded thumbnail). Cached for the session so we don't re-fetch + re-unzip
// the file on every thread render — straight to the clean card instead.
const noDocPreview = new Set<string>()

// In-thread document preview thumbnail. Tries the cached R2 preview
// (<media_key>.preview.jpg) first; on a miss it renders the doc to a thumbnail
// ONCE client-side, shows it, and uploads it to R2 so every other agent gets a
// cache hit (no re-render, no VPS load). Renders nothing for non-thumbnailable
// types — the doc card below still shows.
function DocThumb({ msg, filename }: { msg: MessageDecrypted; filename: string }) {
  const resolved = useResolvedMediaUrl(msg)
  const origUrl = resolved.url
  const mime = msg.media_mime ?? ''
  const previewUrl = origUrl ? `${origUrl}.preview.jpg` : null
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'rendering' | 'ready' | 'none'>('idle')
  const triedRef = useRef(false)

  useEffect(() => {
    triedRef.current = false
    if (previewUrl && isThumbnailable(mime, filename) && !(msg.id && noDocPreview.has(msg.id))) {
      setSrc(previewUrl); setState('idle')
    } else {
      setSrc(null); setState('none')
    }
  }, [previewUrl, mime, filename, msg.id])

  const renderAndUpload = useCallback(async () => {
    if (triedRef.current || !origUrl || !msg.id) { setState('none'); return }
    triedRef.current = true
    setState('rendering')
    try {
      const res = await fetch(origUrl)
      if (!res.ok) throw new Error('orig fetch failed')
      const blob = await res.blob()
      const { generateDocThumbnail } = await import('../../../lib/docThumbnail')
      const jpeg = await generateDocThumbnail(blob, mime, filename)
      if (!jpeg) { if (msg.id) noDocPreview.add(msg.id); setState('none'); return }
      setSrc(URL.createObjectURL(jpeg))
      const { uploadDocPreview } = await import('../../../lib/conversationsApi')
      uploadDocPreview(msg.id, jpeg).catch(() => { /* re-render next time */ })
    } catch { setState('none') }
  }, [origUrl, mime, filename, msg.id])

  if (state === 'none' || !src) return null
  return (
    <div className="wac__doc-thumb">
      {state === 'rendering' && <div className="wac__doc-thumb-spin"><div className="wac__staging-pdf-spinner" /></div>}
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={() => setState('ready')}
        onError={() => { if (!triedRef.current) void renderAndUpload(); else setState('none') }}
      />
    </div>
  )
}

// WhatsApp-style file-type glyph: a folded-corner page coloured + labelled by
// type. PDF/Office get their brand colour + letter; everything else is a grey
// page showing the file extension (MD, HTM, ZIP, …).
function fileTypeStyle(ext: string): { color: string; label: string } {
  switch (ext) {
    case 'pdf': return { color: '#E5403A', label: 'PDF' }
    case 'doc': case 'docx': case 'docm': case 'rtf': return { color: '#2B6CC4', label: 'W' }
    case 'xls': case 'xlsx': case 'xlsm': return { color: '#1E7E45', label: 'X' }
    case 'ppt': case 'pptx': case 'ppsx': return { color: '#D24726', label: 'P' }
    default: return { color: '#5E6B73', label: ext ? ext.toUpperCase().slice(0, 4) : 'FILE' }
  }
}

function FileTypeIcon({ name, size = 40 }: { name: string; size?: number }) {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  const { color, label } = fileTypeStyle(ext)
  return (
    <svg className="wac__filetype" viewBox="0 0 36 44" width={size} height={(size * 44) / 36} aria-hidden="true">
      <path d="M4 0 H24 L36 12 V40 A4 4 0 0 1 32 44 H4 A4 4 0 0 1 0 40 V4 A4 4 0 0 1 4 0 Z" fill={color} />
      <path d="M24 0 L36 12 H28 A4 4 0 0 1 24 8 Z" fill="rgba(255,255,255,0.38)" />
      <text
        x="18" y={label.length > 1 ? 31 : 33}
        textAnchor="middle" fill="#fff"
        fontSize={label.length >= 4 ? 7 : label.length > 1 ? 9 : 14}
        fontWeight="700" fontFamily="'Segoe UI', system-ui, sans-serif"
        letterSpacing={label.length > 1 ? '0.2' : '0'}
      >{label}</text>
    </svg>
  )
}

function DocumentBody({ msg }: { msg: MessageDecrypted }) {
  const meta = (msg.media_meta ?? {}) as {
    filename?: string; fileName?: string;
    size_bytes?: number; mime_type?: string; pages?: number
  }
  const filename = meta.filename ?? meta.fileName ?? 'Document'
  const dbSize = msg.media_size_bytes ?? meta.size_bytes ?? null
  const sizeKo = dbSize ? Math.round(dbSize / 1024) : null
  const ext = filename.includes('.')
    ? filename.split('.').pop()?.toUpperCase().slice(0, 5)
    : 'FILE'

  const resolved = useResolvedMediaUrl(msg)

  function onDownload() {
    if (!resolved.url) return
    // Anchor click avoids cross-origin window.open issues for presigned URLs.
    const a = document.createElement('a')
    a.href = resolved.url
    a.download = filename
    a.rel = 'noopener noreferrer'
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const statusLabel =
    resolved.pending ? 'Téléchargement…' :
    resolved.expired ? 'Indisponible' :
    null

  return (
    <>
    <DocThumb msg={msg} filename={filename} />
    <div className={'wac__doc' + (statusLabel ? ' is-' + (resolved.pending ? 'pending' : 'expired') : '')}>
      <div className="wac__doc-icon">
        <FileTypeIcon name={filename} size={32} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="wac__doc-name">{filename}</div>
        <div className="wac__doc-meta">
          {[
            meta.pages ? `${meta.pages} pages` : null,
            ext,
            sizeKo != null ? `${sizeKo} Ko` : null,
            statusLabel,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
      <button
        className="wac__doc-download"
        aria-label="Télécharger"
        title="Télécharger"
        onClick={onDownload}
        disabled={!resolved.url}
      >
        <svg viewBox="0 0 34 34" width="34" height="34" fill="currentColor" aria-hidden="true">
          <path d="M17,2c8.3,0,15,6.7,15,15s-6.7,15-15,15S2,25.3,2,17S8.7,2,17,2 M17,1C8.2,1,1,8.2,1,17 s7.2,16,16,16s16-7.2,16-16S25.8,1,17,1L17,1z" />
          <path d="M22.4,17.5h-3.2v-6.8c0-0.4-0.3-0.7-0.7-0.7h-3.2c-0.4,0-0.7,0.3-0.7,0.7v6.8h-3.2 c-0.6,0-0.8,0.4-0.4,0.8l5,5.3c0.5,0.7,1,0.5,1.5,0l5-5.3C23.2,17.8,23,17.5,22.4,17.5z" />
        </svg>
      </button>
    </div>
    </>
  )
}

// ── Contact card bubble body ─────────────────────────────────────────────────

function ContactCardBody({ msg, time, status, tickIcon, isOut, onNavigateToJid }: {
  msg: MessageDecrypted; time: string; status: string; tickIcon: ReactNode; isOut: boolean; onNavigateToJid?: (jid: string, name?: string) => void
}) {
  const meta = (msg.media_meta ?? {}) as Record<string, unknown>
  const vcard = meta.vcard as string | undefined
  const vcards = meta.vcards as string[] | undefined
  const count = (meta.count as number) ?? 1

  const { phone, jid, vcardName } = useMemo(() => {
    const card = vcard ?? vcards?.[0]
    if (!card) return { phone: null, jid: null, vcardName: null }
    const telMatch = card.match(/TEL[^:]*:([^\n\r]+)/)
    const raw = telMatch?.[1]?.trim() ?? null
    const digits = raw?.replace(/[^0-9]/g, '') ?? null
    const fn = card.match(/FN:([^\n\r]+)/)?.[1]?.trim() ?? null
    return { phone: raw, jid: digits ? `${digits}@s.whatsapp.net` : null, vcardName: fn }
  }, [vcard, vcards])

  const displayName = msg.body || vcardName || '[Contact]'
  const picQ = useContactPic(msg.instance_id, jid)

  return (
    <div className="wac__contact-card">
      <div className="wac__contact-card-body">
        <div className="wac__contact-card-avatar">
          {picQ.data ? <img src={picQ.data} alt="" draggable={false} /> : <IconUser size={24} />}
        </div>
        <div className="wac__contact-card-info">
          <span className="wac__contact-card-name">{displayName}</span>
          {phone && <span className="wac__contact-card-phone">{phone}</span>}
        </div>
        <span className={'wac__bubble-meta wac__contact-card-meta' + (status === 'read' ? ' is-read' : '')}>
          {msg.is_starred && <IconStar size={12} />}
              {msg.is_pinned && <IconWaPinSmall size={12} />}
          {time}
          {isOut && tickIcon}
        </span>
      </div>
      <div className="wac__contact-card-footer">
        {count > 1 && <span className="wac__contact-card-count">+{count - 1} contacts</span>}
        <button className="wac__contact-card-action" onClick={() => { if (jid && onNavigateToJid) onNavigateToJid(jid, displayName !== '[Contact]' ? displayName : undefined) }}>Message</button>
      </div>
    </div>
  )
}

// ── Bubble: link preview card + URL-linkified body ──────────────────────────

function BubbleLinkPreview({ msg }: { msg: MessageDecrypted; isOut: boolean }) {
  // Prefer WhatsApp-attached preview from media_meta (newer messages only —
  // historical messages have media_meta = null). For everything else, lazily
  // og-fetch the first URL when the bubble scrolls into view. The cache +
  // in-flight dedupe in ogPreview.ts keeps repeated views cheap.
  const fromMeta = previewFromMediaMeta(msg.media_meta)
  const [fetched, setFetched] = useState<OgPreview | null>(null)
  const tried = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const firstUrl = useMemo(() => {
    const urls = findAllUrls(msg.body ?? '')
    return urls[0]?.url ?? null
  }, [msg.body])

  useEffect(() => {
    if (fromMeta) return
    if (!firstUrl) return
    if (tried.current) return
    const el = sentinelRef.current
    if (!el) return
    // IntersectionObserver gates the fetch: only fire when this bubble is
    // actually visible. Avoids a burst of N fetches when opening a chat.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          if (tried.current) continue
          tried.current = true
          io.disconnect()
          let alive = true
          void fetchOgPreview(firstUrl).then((og) => {
            if (alive) setFetched(og)
          })
          // Stop iterating after the first intersection.
          return
        }
      },
      { rootMargin: '120px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [firstUrl, fromMeta])

  const og = fromMeta ?? fetched
  if (!og) {
    // Render a 1×1 sentinel so the IntersectionObserver has a node to track.
    // The element is invisible and doesn't take vertical space.
    return firstUrl ? <div ref={sentinelRef} style={{ height: 0, width: 0 }} /> : null
  }
  if (!og.title && !og.description && !og.image) return null

  return (
    <a
      className="wac__lp wac__lp--bubble"
      href={og.canonical ?? og.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {og.image && (
        <div className="wac__lp-image">
          <img
            src={og.image}
            alt=""
            draggable={false}
            loading="lazy"
            onError={(e) => {
              // External CDN URLs (Instagram, Facebook) expire after a few days.
              // Hide the broken image; the title + description + domain still render.
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>
      )}
      <div className="wac__lp-body">
        {og.title && <div className="wac__lp-title">{og.title}</div>}
        {og.description && <div className="wac__lp-desc">{og.description}</div>}
        <div className="wac__lp-domain">{og.domain}</div>
      </div>
    </a>
  )
}

function resolveMentions(
  text: string,
  mentionedJid: string[] | undefined,
  contactMap: Map<string, { pushName: string | null; pic: string | null; bookName: string | null }> | undefined,
): Array<{ type: 'text'; value: string } | { type: 'mention'; name: string }> {
  if (!contactMap) return [{ type: 'text', value: text }]

  const replacements: Array<{ start: number; end: number; name: string }> = []

  if (mentionedJid?.length) {
    for (const jid of mentionedJid) {
      const num = jid.replace(/@.*$/, '')
      const c = contactMap.get(jid) ?? contactMap.get(`${num}@lid`) ?? contactMap.get(`${num}@s.whatsapp.net`)
      const name = c?.bookName ?? c?.pushName ?? num
      for (const pat of [`@${num}`, `${num}@`]) {
        const idx = text.indexOf(pat)
        if (idx >= 0) {
          replacements.push({ start: idx, end: idx + pat.length, name })
          break
        }
      }
    }
  }

  // Heuristic fallback: scan for @DIGITS patterns and resolve via contactMap
  if (replacements.length === 0) {
    const re = /(?:@(\d{10,20})|(\d{10,20})@)/g
    let match
    while ((match = re.exec(text)) !== null) {
      const num = match[1] || match[2]
      const c = contactMap.get(`${num}@lid`) ?? contactMap.get(`${num}@s.whatsapp.net`)
      const name = c?.bookName ?? c?.pushName ?? null
      if (name) {
        replacements.push({ start: match.index, end: match.index + match[0].length, name })
      }
    }
  }

  if (replacements.length === 0) return [{ type: 'text', value: text }]
  replacements.sort((a, b) => a.start - b.start)
  const result: Array<{ type: 'text'; value: string } | { type: 'mention'; name: string }> = []
  let cursor = 0
  for (const r of replacements) {
    if (r.start > cursor) result.push({ type: 'text', value: text.slice(cursor, r.start) })
    result.push({ type: 'mention', name: `@${r.name}` })
    cursor = r.end
  }
  if (cursor < text.length) result.push({ type: 'text', value: text.slice(cursor) })
  return result
}

// WhatsApp "Voir plus": long messages show a capped slice with a Read-more
// button; each click DOUBLES the visible characters until the whole message is
// shown. State is local/ephemeral — leaving and re-opening the conversation
// remounts the bubble and the truncation resets (matching WhatsApp).
const READMORE_LIMIT = 700

function BubbleTextBody({ text, isOut: _isOut, mentionedJid, contactMap, readMore = false }: {
  text: string; isOut: boolean
  mentionedJid?: string[]
  contactMap?: Map<string, { pushName: string | null; pic: string | null; bookName: string | null }>
  readMore?: boolean
}) {
  // Code-point array so a slice never cuts an emoji surrogate pair in half.
  const chars = useMemo(() => Array.from(text), [text])
  const canTruncate = readMore && chars.length > READMORE_LIMIT
  const [shown, setShown] = useState(READMORE_LIMIT)
  const truncated = canTruncate && shown < chars.length
  const displayText = canTruncate ? chars.slice(0, shown).join('') : text

  const segments = useMemo(
    () => resolveMentions(displayText, mentionedJid, contactMap),
    [displayText, mentionedJid, contactMap],
  )
  const parts: React.ReactNode[] = []
  segments.forEach((seg, si) => {
    if (seg.type === 'mention') {
      parts.push(<span key={`m-${si}`} className="wac__mention">{seg.name}</span>)
      return
    }
    const urls = findAllUrls(seg.value)
    if (urls.length === 0) { parts.push(...splitEmojiRuns(seg.value, `t-${si}`)); return }
    let cursor = 0
    urls.forEach((u, ui) => {
      if (u.start > cursor) parts.push(...splitEmojiRuns(seg.value.slice(cursor, u.start), `t-${si}-${ui}`))
      parts.push(
        <a key={`l-${si}-${ui}`} className="wac__link" href={u.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
          {u.url}
        </a>,
      )
      cursor = u.end
    })
    if (cursor < seg.value.length) parts.push(...splitEmojiRuns(seg.value.slice(cursor), `t-${si}-end`))
  })
  return (
    <>
      {parts}
      {truncated && (
        <>
          {'… '}
          <button
            type="button"
            className="wac__readmore"
            onClick={(e) => { e.stopPropagation(); setShown((s) => Math.min(s * 2, chars.length)) }}
          >
            Voir plus
          </button>
        </>
      )}
    </>
  )
}

// Inline emojis inside a normal text bubble render slightly larger than the
// surrounding text (WhatsApp parity). Splits a plain string into emoji and
// non-emoji runs; emoji runs get wrapped in .wac__inline-emoji.
function splitEmojiRuns(str: string, keyPrefix: string): React.ReactNode[] {
  if (!str) return []
  let seg: Intl.Segmenter
  try {
    seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  } catch {
    return [str]
  }
  const out: React.ReactNode[] = []
  let textBuf = ''
  let emojiBuf = ''
  let k = 0
  const flushText = () => { if (textBuf) { out.push(textBuf); textBuf = '' } }
  const flushEmoji = () => {
    if (emojiBuf) {
      out.push(<span key={`${keyPrefix}-e${k++}`} className="wac__inline-emoji">{emojiBuf}</span>)
      emojiBuf = ''
    }
  }
  for (const { segment } of seg.segment(str)) {
    if (/\p{Extended_Pictographic}/u.test(segment)) { flushText(); emojiBuf += segment }
    else { flushEmoji(); textBuf += segment }
  }
  flushText()
  flushEmoji()
  return out
}

function formatMs(ms: number): string {
  if (!ms) return '0:00'
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function prettySender(jid: string | null): string {
  if (!jid) return ''
  const p = parseJid(jid)
  if (p.kind === 'phone') return `+${p.user.slice(0, 3)} ${p.user.slice(3)}`
  return p.user
}

// ──────────────────────────────────────────────────────────────────────────────
// Media viewer (WhatsApp Web-identical full-screen lightbox)
// ──────────────────────────────────────────────────────────────────────────────

export function MediaViewer({
  msg, allMedia, conv, onClose, onNavigate, onReply,
  allConversations, instanceId, selfJid,
}: {
  msg: MessageDecrypted
  allMedia: MessageDecrypted[]
  conv: ConversationDecrypted
  onClose: () => void
  onNavigate: (m: MessageDecrypted) => void
  onReply?: (m: MessageDecrypted) => void
  allConversations?: ConversationDecrypted[]
  instanceId?: string | null
  selfJid?: string | null
}) {
  const currentIdx = allMedia.findIndex((m) => m.id === msg.id)
  const hasPrev = currentIdx > 0
  const hasNext = currentIdx < allMedia.length - 1

  const resolved = useResolvedMediaUrl(msg)
  const isVideo = msg.kind === 'video'
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [muted, setMuted] = useState(false)
  const progressRef = useRef<HTMLDivElement | null>(null)
  const [starred, setStarred] = useState(!!msg.is_starred)
  const [showForwardPicker, setShowForwardPicker] = useState(false)
  const [forwardSending, setForwardSending] = useState(false)

  useEffect(() => { setStarred(!!msg.is_starred) }, [msg.id, msg.is_starred])

  const senderName = msg.direction === 'outbound'
    ? 'Vous'
    : conversationLabel(conv.remote_jid ?? '', conv.peer_display_name, conv.contact_book_name)

  const timestamp = msg.whatsapp_timestamp
    ? new Date(msg.whatsapp_timestamp).toLocaleString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : ''

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowLeft' && hasPrev) { onNavigate(allMedia[currentIdx - 1]); return }
      if (e.key === 'ArrowRight' && hasNext) { onNavigate(allMedia[currentIdx + 1]); return }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [currentIdx, hasPrev, hasNext, allMedia, onClose, onNavigate])

  // Reset video state on navigation
  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setSpeed(1)
  }, [msg.id])

  function togglePlayVideo() {
    const el = videoRef.current
    if (!el) return
    if (el.paused) { el.playbackRate = speed; void el.play() }
    else el.pause()
  }

  function cycleSpeed() {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1
    setSpeed(next)
    if (videoRef.current) videoRef.current.playbackRate = next
  }

  function seekVideo(e: React.MouseEvent<HTMLDivElement>) {
    const el = videoRef.current
    const bar = progressRef.current
    if (!el || !bar || !duration) return
    const rect = bar.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    el.currentTime = frac * duration
  }

  async function onDownload() {
    if (!resolved.url) return
    try {
      const resp = await fetch(resolved.url)
      const blob = await resp.blob()
      const ext = isVideo ? 'mp4' : 'jpg'
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `whatsapp-${msg.id?.slice(0, 8) ?? 'media'}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(blobUrl)
    } catch {
      const w = window.open(resolved.url, '_blank', 'noopener')
      if (!w) toast.error('Téléchargement bloqué — autorisez les pop-ups.')
    }
  }

  async function handleStar() {
    if (!msg.id) return
    setStarred((v) => !v)
    try { await toggleStar(msg.id) } catch (e) { setStarred((v) => !v); toast.error(normalizeError(e)) }
  }

  return (
    <div className="wac__mv" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {/* Top bar */}
      <header className="wac__mv-header">
        <div className="wac__mv-header-left">
          <div className="wac__mv-header-avatar">
            {conv.peer_profile_pic
              ? <img src={conv.peer_profile_pic} alt="" draggable={false} />
              : <IconUser size={36} />}
          </div>
          <div className="wac__mv-header-meta">
            <span className="wac__mv-header-name">{senderName}</span>
            <span className="wac__mv-header-time">{timestamp}</span>
          </div>
        </div>
        <div className="wac__mv-header-actions">
          <button className="wac__mv-btn" aria-label="Répondre" title="Répondre" onClick={() => { onReply?.(msg); onClose() }}>
            <IconReply />
          </button>
          <button className="wac__mv-btn" aria-label="Favori" title={starred ? 'Retirer des importants' : 'Marquer comme important'} onClick={() => void handleStar()}>
            {starred ? <IconStarFilled /> : <IconStar />}
          </button>
          <button className="wac__mv-btn" aria-label="Transférer" title="Transférer" onClick={() => setShowForwardPicker(true)}>
            <IconForwardAll />
          </button>
          <button className="wac__mv-btn" aria-label="Télécharger" title="Télécharger" onClick={() => void onDownload()}>
            <IconDownload />
          </button>
          <button className="wac__mv-btn" aria-label="Fermer" title="Fermer" onClick={onClose}>
            <IconClose />
          </button>
        </div>
      </header>

      {/* Navigation arrows */}
      {hasPrev && (
        <button
          className="wac__mv-nav wac__mv-nav--prev"
          aria-label="Média précédent"
          onClick={() => onNavigate(allMedia[currentIdx - 1])}
        >
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      {hasNext && (
        <button
          className="wac__mv-nav wac__mv-nav--next"
          aria-label="Média suivant"
          onClick={() => onNavigate(allMedia[currentIdx + 1])}
        >
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Center media */}
      <div className="wac__mv-stage">
        {resolved.url ? (
          isVideo ? (
            <div className="wac__mv-video-wrap">
              <video
                ref={videoRef}
                src={resolved.url}
                className="wac__mv-media"
                muted={muted}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => { setPlaying(false); setCurrentTime(0) }}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration
                  if (Number.isFinite(d) && d > 0) setDuration(d)
                }}
                onClick={togglePlayVideo}
              />
              <div className="wac__mv-video-controls">
                <button className="wac__mv-video-play" onClick={togglePlayVideo}>
                  {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
                </button>
                <div
                  className="wac__mv-video-progress"
                  ref={progressRef}
                  onClick={seekVideo}
                >
                  <div
                    className="wac__mv-video-progress-fill"
                    style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
                  />
                </div>
                <button className="wac__mv-video-speed" onClick={cycleSpeed}>
                  {speed === 1.5 ? '1,5' : speed}x
                </button>
                <button className="wac__mv-video-mute" onClick={() => setMuted((v) => !v)}>
                  {muted ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <img
              src={resolved.url}
              className="wac__mv-media"
              alt=""
              draggable={false}
            />
          )
        ) : (
          <div className="wac__mv-loading">
            <IconClock size={40} />
          </div>
        )}
      </div>

      {/* Bottom filmstrip */}
      {allMedia.length > 1 && (
        <div className="wac__mv-strip">
          <div className="wac__mv-strip-scroll">
            {allMedia.map((m) => (
              <MediaViewerThumb
                key={m.id}
                msg={m}
                isActive={m.id === msg.id}
                onClick={() => onNavigate(m)}
              />
            ))}
          </div>
        </div>
      )}

      {showForwardPicker && (
        <ForwardPicker
          conversations={allConversations ?? []}
          currentConvId={conv.id ?? ''}
          instanceId={instanceId ?? null}
          selfJid={selfJid ?? null}
          sending={forwardSending}
          onSend={async (targetIds) => {
            if (!msg.id) return
            setForwardSending(true)
            try {
              await forwardMessage(msg.id, targetIds)
              setShowForwardPicker(false)
              onClose()
            } catch (e) {
              console.error('Forward failed:', e)
              toast.error(normalizeError(e))
            } finally {
              setForwardSending(false)
            }
          }}
          onClose={() => setShowForwardPicker(false)}
        />
      )}
    </div>
  )
}

function MediaViewerThumb({
  msg, isActive, onClick,
}: { msg: MessageDecrypted; isActive: boolean; onClick: () => void }) {
  const resolved = useResolvedMediaUrl(msg)
  const isVideo = msg.kind === 'video'
  const meta = (msg.media_meta ?? {}) as Record<string, unknown>
  const durationMs = typeof meta.duration_ms === 'number' ? meta.duration_ms : 0
  const durationLabel = durationMs > 0
    ? `${Math.floor(durationMs / 60000)}:${String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0')}`
    : null

  return (
    <button
      type="button"
      className={'wac__mv-thumb' + (isActive ? ' is-active' : '')}
      onClick={onClick}
    >
      {resolved.url ? (
        isVideo ? (
          <>
            <video src={resolved.url} preload="metadata" />
            <span className="wac__mv-thumb-badge">
              <IconVideo size={10} />
              {durationLabel && <span>{durationLabel}</span>}
            </span>
          </>
        ) : (
          <img src={resolved.url} alt="" draggable={false} />
        )
      ) : (
        <div className="wac__mv-thumb-empty">
          <IconDownload size={18} />
        </div>
      )}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Voice Recorder
// ──────────────────────────────────────────────────────────────────────────────

interface VoiceRecordingResult {
  blob: Blob
  waveform: number[]
  durationMs: number
}

type RecPhase = 'recording' | 'paused'

function VoiceRecorder({ onDiscard, onDone }: {
  onDiscard: () => void
  onDone: (result: VoiceRecordingResult) => void
}) {
  const [phase, setPhase] = useState<RecPhase>('recording')
  const [elapsed, setElapsed] = useState(0)
  const [liveWaveform, setLiveWaveform] = useState<number[]>([])
  const [playbackPos, setPlaybackPos] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef(0)
  const timerRef = useRef(0)
  const startTimeRef = useRef(0)
  const pausedAtRef = useRef(0)
  const waveformRef = useRef<number[]>([])
  const blobRef = useRef<Blob | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const playRafRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream

        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        sourceRef.current = source
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.4
        source.connect(analyser)
        analyserRef.current = analyser

        const mimeType = MediaRecorder.isTypeSupported('audio/ogg; codecs=opus')
          ? 'audio/ogg; codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
            ? 'audio/webm; codecs=opus'
            : ''
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        recorderRef.current = recorder
        chunksRef.current = []
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        recorder.start(100)

        startTimeRef.current = performance.now()
        startTimer()
        captureWaveform()
      } catch {
        toast.error('Micro indisponible — vérifiez les autorisations du navigateur.')
        onDiscard()
      }
    }

    start()
    return () => { cancelled = true; cleanup() }
  }, [])

  function cleanup() {
    cancelAnimationFrame(rafRef.current)
    clearInterval(timerRef.current)
    cancelAnimationFrame(playRafRef.current)
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (sourceRef.current) { try { sourceRef.current.disconnect() } catch {} }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {})
    }
    if (audioElRef.current) {
      audioElRef.current.pause()
      audioElRef.current.src = ''
    }
  }

  function startTimer() {
    timerRef.current = window.setInterval(() => {
      setElapsed(performance.now() - startTimeRef.current)
    }, 200)
  }

  function captureWaveform() {
    const analyser = analyserRef.current
    if (!analyser) return
    const buf = new Uint8Array(analyser.frequencyBinCount)
    let frameSkip = 0

    function tick() {
      frameSkip++
      if (frameSkip % 3 !== 0) { rafRef.current = requestAnimationFrame(tick); return }

      analyser!.getByteTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) {
        const amp = Math.abs(buf[i] - 128)
        if (amp > peak) peak = amp
      }
      const normalized = Math.round((peak / 128) * 100)
      waveformRef.current = [...waveformRef.current, normalized]
      setLiveWaveform(prev => [...prev, normalized])
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function handlePause() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause()
    }
    cancelAnimationFrame(rafRef.current)
    clearInterval(timerRef.current)
    pausedAtRef.current = performance.now() - startTimeRef.current
    setPhase('paused')

    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || 'audio/ogg; codecs=opus' })
    blobRef.current = blob
    const url = URL.createObjectURL(blob)
    audioElRef.current = new Audio(url)
  }

  function handleResume() {
    if (audioElRef.current) {
      audioElRef.current.pause()
      audioElRef.current.src = ''
      audioElRef.current = null
    }
    cancelAnimationFrame(playRafRef.current)
    setPlaybackPos(0)
    setIsPlaying(false)

    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume()
    }
    startTimeRef.current = performance.now() - pausedAtRef.current
    startTimer()
    captureWaveform()
    setPhase('recording')
  }

  function handlePlayPause() {
    const audio = audioElRef.current
    if (!audio) return
    const knownDurationSec = pausedAtRef.current / 1000

    if (!audio.paused) {
      audio.pause()
      setIsPlaying(false)
      cancelAnimationFrame(playRafRef.current)
      return
    }

    setIsPlaying(true)
    audio.play()

    function trackPos() {
      if (!audioElRef.current || audioElRef.current.paused) {
        setIsPlaying(false)
        cancelAnimationFrame(playRafRef.current)
        return
      }
      setPlaybackPos(audioElRef.current.currentTime / knownDurationSec)
      playRafRef.current = requestAnimationFrame(trackPos)
    }
    playRafRef.current = requestAnimationFrame(trackPos)

    audio.onended = () => {
      setPlaybackPos(0)
      setIsPlaying(false)
      cancelAnimationFrame(playRafRef.current)
    }
  }

  function handleDiscard() {
    cleanup()
    onDiscard()
  }

  function handleSend() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    cancelAnimationFrame(rafRef.current)
    clearInterval(timerRef.current)
    cancelAnimationFrame(playRafRef.current)

    setTimeout(() => {
      const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || 'audio/ogg; codecs=opus' })
      const wf = waveformRef.current
      const sampled: number[] = []
      const step = Math.max(1, Math.floor(wf.length / 64))
      for (let i = 0; i < wf.length; i += step) {
        sampled.push(wf[i])
        if (sampled.length >= 64) break
      }
      const dur = phase === 'paused' ? pausedAtRef.current : performance.now() - startTimeRef.current

      streamRef.current?.getTracks().forEach(t => t.stop())
      if (sourceRef.current) { try { sourceRef.current.disconnect() } catch {} }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }

      onDone({ blob, waveform: sampled, durationMs: dur })
    }, 150)
  }

  const secs = Math.floor(elapsed / 1000)
  const mm = String(Math.floor(secs / 60)).padStart(1, '0')
  const ss = String(secs % 60).padStart(2, '0')

  const [barCount, setBarCount] = useState(120)
  const BAR_W = 2.5
  const BAR_GAP = 1.5
  const roRef = useRef<ResizeObserver | null>(null)
  const waveContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      setBarCount(Math.max(10, Math.floor(w / (BAR_W + BAR_GAP))))
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  function resample(src: number[], target: number): number[] {
    if (src.length === 0) return new Array(target).fill(0)
    if (src.length <= target) {
      const out = [...src]
      while (out.length < target) out.unshift(0)
      return out
    }
    const out: number[] = []
    const step = src.length / target
    for (let i = 0; i < target; i++) {
      const start = Math.floor(i * step)
      const end = Math.floor((i + 1) * step)
      let sum = 0
      for (let j = start; j < end; j++) sum += src[j]
      out.push(Math.round(sum / (end - start)))
    }
    return out
  }

  const liveDisplay = resample(liveWaveform.slice(-barCount), barCount)
  const reviewDisplay = resample(waveformRef.current, barCount)

  const MAX_BAR_H = 28
  function barHeight(v: number, arr: number[]): number {
    let peak = 0
    for (let i = 0; i < arr.length; i++) if (arr[i] > peak) peak = arr[i]
    if (peak === 0) return 3
    return Math.max(3, Math.round((v / peak) * MAX_BAR_H))
  }

  return (
    <div className="wac__composer">
      <div className="wac__composer-pill wac__rec-pill">
        <button className="wac__rec-btn wac__rec-btn--trash" onClick={handleDiscard} aria-label="Supprimer l'enregistrement">
          <IconTrash size={20} />
        </button>

        {phase === 'recording' && (
          <>
            <div className="wac__rec-indicator">
              <span className="wac__rec-dot" />
              <span className="wac__rec-time">{mm}:{ss}</span>
            </div>
            <div className="wac__rec-wave" ref={waveContainerRef}>
              {liveDisplay.map((v, i) => (
                <span key={i} className="wac__rec-bar" style={{ height: `${barHeight(v, liveDisplay)}px` }} />
              ))}
            </div>
            <button className="wac__rec-btn" onClick={handlePause} aria-label="Pause">
              <IconPause size={20} />
            </button>
          </>
        )}

        {phase === 'paused' && (
          <>
            <button className="wac__rec-btn" onClick={handlePlayPause} aria-label={isPlaying ? 'Pause' : 'Lecture'}>
              {isPlaying ? <IconPause size={20} /> : <IconPlay size={20} />}
            </button>
            <div className="wac__rec-wave wac__rec-wave--review" ref={waveContainerRef}>
              {reviewDisplay.map((v, i) => {
                const pct = i / reviewDisplay.length
                return (
                  <span
                    key={i}
                    className={'wac__rec-bar' + (pct <= playbackPos ? ' is-played' : '')}
                    style={{ height: `${barHeight(v, reviewDisplay)}px` }}
                  />
                )
              })}
            </div>
            <span className="wac__rec-time">{mm}:{ss}</span>
            <button className="wac__rec-btn" onClick={handleResume} aria-label="Reprendre l'enregistrement">
              <IconMic size={20} />
            </button>
          </>
        )}

        <button className="wac__rec-btn wac__rec-btn--send" onClick={handleSend} aria-label="Envoyer le message vocal">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" /></svg>
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Composer
// ──────────────────────────────────────────────────────────────────────────────

function Composer({
  state, setState, onSend, convName, isGroup, contactMap, conv, selfJid, ownerPic,
  onOpenQuickReplies, onOpenTags, onOpenScheduled, onSelectQuickReply, instanceId, conversationId,
  onPickPhotos, onPickDocument, onPickAudio, onPickAudioRecording, onSelectGif, onOpenContacts,
}: {
  state: ComposerState; setState: (s: ComposerState) => void; onSend: () => void; convName?: string
  isGroup?: boolean
  contactMap?: Map<string, { pushName: string | null; pic: string | null; bookName: string | null }>
  conv?: ConversationDecrypted
  selfJid?: string | null
  ownerPic?: string | null
  onOpenQuickReplies?: () => void
  onOpenTags?: () => void
  onOpenScheduled?: (editId?: string) => void
  /** Routes a multi-node quick reply selected via the inline "/" picker to the
   *  parent's smart handler (dispatches the full sequence). Single text nodes
   *  are inlined into the composer instead. */
  onSelectQuickReply?: (qr: QuickReply) => void
  instanceId?: string | null
  conversationId?: string | null
  onPickPhotos?: () => void
  onPickDocument?: () => void
  onPickAudio?: () => void
  onPickAudioRecording?: () => void
  onSelectGif?: (gifUrl: string, mp4Url: string) => void
  onOpenContacts?: () => void
}) {
  const [attachOpen, setAttachOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTab, setPickerTab] = useState<'emoji' | 'gif'>('emoji')

  // ── Agent-to-agent collaboration presence (shared inbox) ──────────────────
  // Broadcast OUR typing on the per-conversation channel + read other agents'.
  // Lets us show "X est en train d'écrire" so two agents don't draft the same
  // reply. Frontend-only realtime; auto-clears on idle / unmount / disconnect.
  const { profile } = useAuth()
  const typingSelf = useMemo(
    () => (profile ? { user_id: profile.id, full_name: profile.full_name, avatar_config: profile.avatar_config as never, avatar_url: profile.avatar_url ?? null, email: profile.email } : null),
    [profile],
  )
  const { typers: otherTypingAgents, ping: pingAgentTyping, stop: stopAgentTyping } = useAgentTyping(conversationId ?? null, typingSelf)
  // TYPED-SINCE-OPEN GATE (drafts, T7): restoring a saved draft populates
  // state.text on mere conversation open. Text-presence-driven effects would
  // then broadcast composing to the CUSTOMER (fake typing, 4s worker holds,
  // ban signal) and flash agent-typing to teammates — for an untouched draft.
  // Both presence FIRE paths below require an actual keystroke in THIS
  // conversation (handleTextChange sets the flag; a conversation switch resets
  // it). Stop/clear paths stay unconditional.
  const typedSinceOpenRef = useRef(false)
  useEffect(() => { typedSinceOpenRef.current = false }, [conversationId])
  // Drive the indicator off ACTUAL keystrokes: ping while typing, stop the
  // moment the box is empty (send/clear). No keystroke for ~2s → the receiver's
  // TTL prunes it. So it tracks typing, not mere text presence.
  useEffect(() => {
    if (!conversationId) return
    if (state.text.trim().length === 0) stopAgentTyping()
    else if (typedSinceOpenRef.current) pingAgentTyping()
  }, [state.text, conversationId, pingAgentTyping, stopAgentTyping])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(-1)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [slashStart, setSlashStart] = useState(0)
  const [slashIdx, setSlashIdx] = useState(0)
  // Hash picker is a *read-only* surface: the popup just shows what's
  // scheduled for this conversation. No selection state needed — Escape
  // dismisses it; otherwise it stays open while the user types after '#'.
  const [hashQuery, setHashQuery] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  // Autofocus on conversation open (and on mount — ChatPane isn't keyed, so
  // switching conversations only changes the prop). Pulls focus out of the
  // list row the agent just clicked so they can type immediately; preventScroll
  // keeps the message stream where the scroll-to-bottom logic put it.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [conversationId])

  const { data: allQuickReplies } = useQuickReplies(instanceId ?? null)

  // Capacity status — a banner shows ONLY when sending is genuinely locked
  // (paused / hourly cap / daily cap / outside business hours), naming the
  // single active lock + a live countdown. The per-minute token bucket is soft
  // pacing (a few seconds), never a "lock", so it never shows a banner.
  const { data: capacity } = useInstanceCapacityStatus(instanceId ?? null)
  // ALL matching replies — the picker itself scrolls (max-height 280px). The
  // old .slice(0, 8) silently hid every reply past the 8th, so teams with more
  // quick replies couldn't reach them from "/" at all.
  const slashHits = useMemo(() => {
    if (slashQuery === null || !allQuickReplies) return []
    const q = slashQuery.toLowerCase()
    if (!q) return allQuickReplies
    return allQuickReplies.filter((r) => r.name.toLowerCase().includes(q))
  }, [slashQuery, allQuickReplies])

  useEffect(() => { setSlashIdx(0) }, [slashHits.length])
  // Keep the keyboard-selected item visible now that the list scrolls.
  const slashListRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    slashListRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [slashIdx])

  // '#' hash picker — scheduled messages for the active conversation. Shows
  // ALL items with their status; pending (still actionable) sorted first by
  // fire time, then the rest (most recent first). Each row carries edit
  // (pending only) + delete actions.
  const { data: allScheduled } = useScheduledMessages(conversationId ?? null)
  const deleteScheduled = useDeleteScheduledMessage()
  const hashHits = useMemo(() => {
    if (hashQuery === null || !allScheduled) return []
    const q = hashQuery.toLowerCase()
    const matched = q
      ? allScheduled.filter((r) => r.name.toLowerCase().includes(q))
      : allScheduled
    const rank = (s: string) => (s === 'pending' ? 0 : 1)
    return [...matched]
      .sort((a, b) => {
        const r = rank(a.status) - rank(b.status)
        if (r !== 0) return r
        // pending: soonest first; others: most recent first
        const ta = new Date(a.scheduled_at).getTime()
        const tb = new Date(b.scheduled_at).getTime()
        return a.status === 'pending' ? ta - tb : tb - ta
      })
      .slice(0, 8)
  }, [hashQuery, allScheduled])

  interface GroupParticipantRow {
    participant_jid: string
    phone_jid: string | null
    push_name: string | null
    profile_pic: string | null
    admin_level: string | null
  }

  const participantsQ = useQuery({
    queryKey: ['group-participants', conv?.instance_id, conv?.remote_jid],
    enabled: !!isGroup && !!conv?.instance_id && !!conv?.remote_jid,
    queryFn: async () => {
      const { data } = await supabase
        .schema('whatsapp').from('group_participants' as never)
        .select('participant_jid, phone_jid, push_name, profile_pic, admin_level')
        .eq('instance_id', conv!.instance_id!)
        .eq('group_jid', conv!.remote_jid!) as unknown as { data: GroupParticipantRow[] | null }
      return data ?? []
    },
    staleTime: 60 * 1000,
  })

  const groupMembers = useMemo(() => {
    if (!isGroup) return []
    const rows = participantsQ.data ?? []
    const ownerPhone = selfJid?.replace('@s.whatsapp.net', '') ?? null
    return rows
      .filter((r: GroupParticipantRow) => {
        const isOwner = (r.phone_jid === selfJid)
          || (ownerPhone && r.phone_jid?.startsWith(ownerPhone))
        return !isOwner
      })
      .map((r: GroupParticipantRow) => {
        const cLid = contactMap?.get(r.participant_jid)
        const cPhone = r.phone_jid ? contactMap?.get(r.phone_jid) : undefined
        const name = cLid?.bookName || cPhone?.bookName || r.push_name || cLid?.pushName || cPhone?.pushName || prettySender(r.phone_jid || r.participant_jid)
        const pic = r.profile_pic || cLid?.pic || cPhone?.pic || null
        return { jid: r.participant_jid, name, pic }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [isGroup, participantsQ.data, contactMap, selfJid, ownerPic])

  const mentionHits = useMemo(() => {
    if (mentionQuery === null || !isGroup) return []
    const q = mentionQuery.toLowerCase()
    const members = q.length === 0 ? groupMembers : groupMembers.filter(m => m.name.toLowerCase().includes(q))
    return members
  }, [mentionQuery, groupMembers, isGroup])

  useEffect(() => { setMentionIdx(0) }, [mentionHits.length])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(200, el.scrollHeight) + 'px'
  }, [state.text])

  // "Répondre" sets replyTo from a bubble menu — pull focus to the composer so
  // typing starts immediately (WhatsApp Web behavior), no re-click needed.
  useEffect(() => {
    if (state.replyTo) ref.current?.focus()
  }, [state.replyTo])

  const hasText = state.text.trim().length > 0
  const { preview, loading: previewLoading, dismiss } = useComposerLinkPreview(state.text)

  // Live typing indicator.
  //
  // Evolution v2.3.7's sendPresence: composing is shown for `delay` ms then
  // auto-clears. There's no explicit "stop typing". So the pattern is:
  //   - On first keystroke: fire send_typing('composing') → worker sends
  //     composing with delay=5000 → customer sees typing for 5s.
  //   - While agent keeps typing: re-fire every ~4s to refresh the 5s window
  //     BEFORE it expires (gives the customer continuous "typing...").
  //   - When agent stops typing: just stop re-firing. The last composing
  //     naturally expires after 5s. No explicit 'paused' needed.
  //
  // Trade-off: each composing call blocks the worker queue for ~5s
  // (Evolution holds the HTTP open). Acceptable for MVP at our concurrency.
  const TYPING_REFIRE_MS = 4000

  const typingTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingActiveRef = useRef<'composing' | 'recording' | null>(null)
  const typingConvRef   = useRef<string | null>(null)

  function firePresenceLoop(convId: string, kind: 'composing' | 'recording'): void {
    if (!convId) return
    typingActiveRef.current = kind
    typingConvRef.current   = convId
    sendTyping(convId, kind).catch(() => { /* best-effort */ })
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => {
      if (typingActiveRef.current === kind && typingConvRef.current === convId) {
        firePresenceLoop(convId, kind)
      }
    }, TYPING_REFIRE_MS)
  }

  function stopTyping(): void {
    const conv = typingConvRef.current
    const wasActive = typingActiveRef.current
    typingActiveRef.current = null
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null }
    // Explicitly clear the indicator on the customer's phone NOW (paused),
    // rather than waiting up to 5s for the composing window to expire.
    if (conv && wasActive) {
      sendTyping(conv, 'paused').catch(() => { /* best-effort */ })
    }
  }

  // Conversation change / unmount cleanup — stop the loop and clear the
  // indicator for the previous conversation.
  useEffect(() => {
    return () => { stopTyping() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // SINGLE SOURCE OF TRUTH for the typing indicator. Driven by composer text,
  // not by the onChange handler — because sending a message clears the text
  // via PARENT state (handleSend → setComposer), which never calls
  // handleTextChange. Watching state.text here catches every path: typing,
  // sending (clears → stop), manual clear, quick-reply insert, etc.
  // EXCEPTION (typedSinceOpenRef): a restored draft populates text on mere
  // conversation open — that must NOT show the customer a fake "typing…"
  // (ban signal + a 4s-cadence worker hold while the agent idles). The FIRE
  // path requires a real keystroke in this conversation; the stop path stays
  // unconditional so send/clear always retract the indicator.
  useEffect(() => {
    if (isRecording) return  // recording effect owns presence while recording
    if (state.text.trim().length > 0 && conversationId && typedSinceOpenRef.current) {
      if (typingActiveRef.current !== 'composing' || typingConvRef.current !== conversationId) {
        firePresenceLoop(conversationId, 'composing')
      }
    } else if (typingActiveRef.current === 'composing' && !(state.text.trim().length > 0)) {
      stopTyping()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.text, conversationId, isRecording])

  function handleTextChange(newText: string) {
    typedSinceOpenRef.current = true   // real user input → presence may fire
    setState({ ...state, text: newText })

    // "/" quick-reply trigger: fires whenever "/" begins the current token
    // (start of message OR after whitespace/newline), filtering by what follows;
    // a space after the command dismisses it — same rule as the "@" picker, and
    // matches WhatsApp. (Was start-of-message-only, so it only worked from an
    // empty composer.)
    const el = ref.current
    const pos = el?.selectionStart ?? newText.length
    const before = newText.slice(0, pos)
    const sAt = before.lastIndexOf('/')
    if (sAt >= 0 && (sAt === 0 || /\s/.test(before[sAt - 1]!)) && !/\s/.test(before.slice(sAt + 1))) {
      setSlashQuery(before.slice(sAt + 1))
      setSlashStart(sAt)
    } else if (slashQuery !== null) {
      setSlashQuery(null)
    }

    // "#" trigger — scheduled messages, same gating as "/"
    if (before.startsWith('#') && !before.includes(' ')) {
      setHashQuery(before.slice(1))
    } else {
      if (hashQuery !== null) setHashQuery(null)
    }

    // "@" mention trigger (groups only)
    if (!isGroup) { setMentionQuery(null); return }
    if (!el) return
    const atIdx = before.lastIndexOf('@')
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(before[atIdx - 1]))) {
      const query = before.slice(atIdx + 1)
      if (!/\s/.test(query)) {
        setMentionQuery(query)
        setMentionStart(atIdx)
        return
      }
    }
    setMentionQuery(null)
  }

  function selectSlashItem(qr: QuickReply) {
    const steps = qr.steps ?? []
    setSlashQuery(null)
    // A single text node inlines into the composer, replacing the "/command"
    // token but keeping text typed before the slash ("salut /promo" → "salut
    // <body>"). Any richer sequence can't live in the single text field, so it
    // dispatches in saved order via the parent's smart handler.
    if (steps.length === 1 && steps[0].type === 'text') {
      const prefix = state.text.slice(0, slashStart)
      const nextText = prefix + steps[0].body
      setState({ ...state, text: nextText })
      requestAnimationFrame(() => {
        const el = ref.current
        if (el) { el.focus(); el.setSelectionRange(nextText.length, nextText.length) }
      })
      return
    }
    // Strip the "/command" token, then hand off the full sequence.
    setState({ ...state, text: state.text.slice(0, slashStart) })
    onSelectQuickReply?.(qr)
  }

  function selectMention(member: { jid: string; name: string }) {
    const before = state.text.slice(0, mentionStart)
    const after = state.text.slice(mentionStart + 1 + (mentionQuery?.length ?? 0))
    const insertText = `@${member.name} `
    const next = before + insertText + after
    const jids = [...(state.mentionedJids ?? []), member.jid]
    setState({ ...state, text: next, mentionedJids: jids })
    setMentionQuery(null)
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) {
        el.focus()
        const pos = before.length + insertText.length
        el.setSelectionRange(pos, pos)
      }
    })
  }

  function selectMentionAll() {
    const before = state.text.slice(0, mentionStart)
    const after = state.text.slice(mentionStart + 1 + (mentionQuery?.length ?? 0))
    const insertText = '@tous '
    const next = before + insertText + after
    setState({ ...state, text: next, mentionAll: true })
    setMentionQuery(null)
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) {
        el.focus()
        const pos = before.length + insertText.length
        el.setSelectionRange(pos, pos)
      }
    })
  }

  function insertEmoji(emoji: string) {
    const el = ref.current
    if (el) {
      const start = el.selectionStart ?? state.text.length
      const end = el.selectionEnd ?? start
      const next = state.text.slice(0, start) + emoji + state.text.slice(end)
      setState({ ...state, text: next })
      requestAnimationFrame(() => {
        el.focus()
        const pos = start + emoji.length
        el.setSelectionRange(pos, pos)
      })
    } else {
      setState({ ...state, text: state.text + emoji })
    }
  }

  // Live recording presence: while the agent is recording a voice note,
  // re-fire 'recording' every TYPING_REFIRE_MS so the customer sees "is
  // recording audio..." continuously. Stops when isRecording flips off.
  useEffect(() => {
    if (isRecording && conversationId) {
      firePresenceLoop(conversationId, 'recording')
    } else if (typingActiveRef.current === 'recording') {
      stopTyping()
    }
    // intentional — fire/stop is enough; cleanup handled by the other useEffect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, conversationId])

  if (isRecording) {
    return (
      <div className="wac__composer-stack">
        <VoiceRecorder
          onDiscard={() => setIsRecording(false)}
          onDone={(result) => {
            setIsRecording(false)
            if (!conversationId) return
            // Send as a WhatsApp voice note (ptt). The dispatcher routes ptt
            // audio through sendWhatsAppAudio(encoding:true) which re-encodes to
            // opus/ogg, so the recorder's ogg/webm both work. seconds + waveform
            // ride in media_meta for our own VoiceBody rendering.
            const mime = (result.blob.type.split(';')[0] || 'audio/ogg').trim()
            void (async () => {
              try {
                const up = await uploadChatMedia(conversationId, result.blob, {
                  fileName: `voice-note.${mime.includes('webm') ? 'webm' : 'ogg'}`,
                  contentType: mime,
                })
                await sendMessage({
                  conversationId,
                  kind: 'audio',
                  mediaStorageKey: up.key,
                  mediaStorageBucket: up.bucket,
                  mediaMime: mime,
                  mediaSizeBytes: up.size,
                  ptt: true,
                  mediaMeta: {
                    ptt: true,
                    seconds: Math.round(result.durationMs / 1000),
                    duration_ms: result.durationMs,
                    waveform: result.waveform,
                  },
                })
              } catch (err) {
                console.error('voice note send failed:', err)
                toast.error(normalizeError(err))
              }
            })()
          }}
        />
      </div>
    )
  }

  return (
    <div className="wac__composer-stack">
      {otherTypingAgents.length > 0 && (
        <div className="wac__agent-typing">
          {otherTypingAgents.slice(0, 3).map((a) => (
            <UserAvatar
              key={a.user_id}
              config={a.avatar_config ?? null}
              url={a.avatar_url ?? null}
              seed={a.email ?? a.user_id}
              size={24}
              className="wac__agent-typing-avatar"
            />
          ))}
          <span className="wac__agent-typing-text">
            {otherTypingAgents.length === 1
              ? <><strong>{otherTypingAgents[0]!.full_name?.trim() || 'Un agent'}</strong> est en train d’écrire…</>
              : <>{otherTypingAgents.length} agents sont en train d’écrire…</>}
          </span>
        </div>
      )}
      <ComposerCapacityBanner capacity={capacity} />
      {pickerOpen && (
        <EmojiGifPicker
          tab={pickerTab}
          onTabChange={setPickerTab}
          onSelectEmoji={insertEmoji}
          onSelectGif={onSelectGif ? (gifUrl, mp4Url) => { setPickerOpen(false); onSelectGif(gifUrl, mp4Url) } : undefined}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {state.replyTo && (() => {
        const rMeta = (state.replyTo.media_meta ?? {}) as Record<string, unknown>
        const rSub = rMeta?.subtype as string | undefined
        const isReplyContact = state.replyTo.kind === 'contact' || rSub === 'contact' || rSub === 'contact_list'
        const replyContactName = isReplyContact
          ? (state.replyTo.body || ((rMeta?.vcard as string) ?? ((rMeta?.vcards as string[]) ?? [])[0])?.match(/FN:([^\n\r]+)/)?.[1]?.trim() || 'Contact')
          : null
        return (
        <div className="wac__composer-reply">
          <div className="wac__composer-reply-bar" style={{ ['--wa-sender-color' as string]: state.replyTo.direction === 'outbound' ? 'var(--wa-green)' : senderColorVar(state.replyTo.sender_jid) }}>
            <div className="wac__composer-reply-body">
              <span className="wac__composer-reply-author" style={{ color: state.replyTo.direction === 'outbound' ? 'var(--wa-green)' : senderColorVar(state.replyTo.sender_jid) }}>
                {state.replyTo.direction === 'outbound' ? 'Vous' : (contactMap?.get(state.replyTo.sender_jid ?? '')?.bookName || contactMap?.get(state.replyTo.sender_jid ?? '')?.pushName || (rMeta?.pushName as string | undefined) || convName || 'Contact')}
              </span>
              <span className="wac__composer-reply-text">
                {state.replyTo.kind === 'image' ? <><IconCamera /> Photo</> :
                 state.replyTo.kind === 'video' ? <><IconVideo /> Vidéo</> :
                 state.replyTo.kind === 'audio' ? <><IconHeadphones /> Audio</> :
                 state.replyTo.kind === 'document' ? <><IconDocument /> Document</> :
                 state.replyTo.kind === 'sticker' ? <><IconImage /> Sticker</> :
                 state.replyTo.kind === 'location' ? <><IconLocationPin /> Localisation</> :
                 isReplyContact ? <><IconUser /> {replyContactName}</> :
                 (state.replyTo.body || 'Message')}
              </span>
            </div>
            {state.replyTo.kind === 'location' && (() => {
              return rMeta.lat != null && rMeta.lng != null
                ? <QuoteLocationThumb lat={rMeta.lat as number} lng={rMeta.lng as number} />
                : null
            })()}
            {isReplyContact && (() => {
              const vc = (rMeta?.vcard as string) ?? (rMeta?.vcards as string[])?.[0]
              const tel = vc?.match(/TEL[^:]*:([^\n\r]+)/)?.[1]?.replace(/[^0-9]/g, '')
              const cJid = tel ? `${tel}@s.whatsapp.net` : null
              return <QuoteContactThumb jid={cJid} instanceId={state.replyTo.instance_id} />
            })()}
            {(state.replyTo.kind === 'image' || state.replyTo.kind === 'video' || state.replyTo.kind === 'sticker') &&
              state.replyTo.media_storage_key && (
              <QuoteMediaThumb
                storageKey={state.replyTo.media_storage_key}
                pending={!!state.replyTo.media_pending}
                mime={state.replyTo.media_mime ?? null}
                isVideo={state.replyTo.kind === 'video'}
              />
            )}
            <button
              className="wac__icon-btn wac__composer-reply-dismiss"
              onClick={() => setState({ ...state, replyTo: null })}
              aria-label="Annuler la réponse"
            >
              <IconClose size={18} />
            </button>
          </div>
        </div>
        )
      })()}
      {(preview || previewLoading) && (
        <div className="wac__lp wac__lp--composer">
          {preview?.image
            ? <div className="wac__lp-image"><img src={preview.image} alt="" draggable={false} /></div>
            : <div className="wac__lp-image wac__lp-image--placeholder"><IconImage /></div>}
          <div className="wac__lp-body">
            {previewLoading && !preview ? (
              <>
                <div className="wac__lp-title wac__lp-skel" />
                <div className="wac__lp-desc wac__lp-skel" />
                <div className="wac__lp-domain wac__lp-skel" />
              </>
            ) : preview ? (
              <>
                {preview.title && <div className="wac__lp-title">{preview.title}</div>}
                {preview.description && <div className="wac__lp-desc">{preview.description}</div>}
                <div className="wac__lp-domain">{preview.domain}</div>
              </>
            ) : null}
          </div>
          <button
            className="wac__icon-btn wac__lp-dismiss"
            onClick={dismiss}
            aria-label="Ignorer l'aperçu du lien"
            title="Ignorer l'aperçu"
          >
            <IconClose size={18} />
          </button>
        </div>
      )}
      {slashQuery !== null && slashHits.length > 0 && (
        <div className="wac__slash-picker" ref={slashListRef}>
          {slashHits.map((qr, i) => (
            <div
              key={qr.id}
              className={'wac__slash-picker-item' + (i === slashIdx ? ' is-active' : '')}
              onMouseDown={(e) => { e.preventDefault(); selectSlashItem(qr) }}
              onMouseEnter={() => setSlashIdx(i)}
            >
              <div className="wac__slash-picker-icon"><IconBolt size={16} /></div>
              <div className="wac__slash-picker-info">
                <span className="wac__slash-picker-name">/{qr.name}</span>
                <span className="wac__slash-picker-preview">{stepsSummary(qr.steps) || 'Séquence vide'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {hashQuery !== null && hashHits.length > 0 && (
        <div className="wac__hash-picker">
          <div className="wac__hash-picker-header">
            <IconCalendar size={12} />
            <span>Messages programmés ({hashHits.length})</span>
          </div>
          {hashHits.map((sm) => {
            const badge = SCHEDULED_STATUS_BADGE[sm.status]
            return (
              <div key={sm.id} className="wac__hash-picker-item">
                <div className="wac__hash-picker-icon"><IconCalendar size={16} /></div>
                <div className="wac__hash-picker-info">
                  <span className="wac__hash-picker-name">
                    #{sm.name}
                    <span className={'wac__hash-status wac__hash-status--' + sm.status}>{badge}</span>
                  </span>
                  <span className="wac__hash-picker-meta">
                    <IconClock size={11} />
                    <span>{formatScheduledAt(new Date(sm.scheduled_at))}</span>
                  </span>
                  <span className="wac__hash-picker-preview">
                    {stepsSummary(sm.steps) || 'Séquence vide'}
                  </span>
                </div>
                <div className="wac__hash-picker-actions">
                  {sm.status === 'pending' && (
                    <button
                      type="button"
                      className="wac__icon-btn"
                      aria-label="Modifier"
                      title="Modifier"
                      // mousedown-prevent keeps the composer focused so the
                      // popup doesn't blur-close before the click registers.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onOpenScheduled?.(sm.id)}
                    >
                      <IconPencil size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="wac__icon-btn wac__icon-btn--danger"
                    aria-label="Supprimer"
                    title="Supprimer"
                    disabled={deleteScheduled.isPending}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (conversationId) {
                        deleteScheduled.mutate({ id: sm.id, conversationId })
                      }
                    }}
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {mentionQuery !== null && (mentionHits.length > 0 || mentionQuery.length === 0) && (
        <div className="wac__mention-picker">
          <div
            className={'wac__mention-picker-item' + (mentionIdx === 0 ? ' is-active' : '')}
            onMouseDown={(e) => { e.preventDefault(); selectMentionAll() }}
            onMouseEnter={() => setMentionIdx(0)}
          >
            <div className="wac__mention-picker-avatar">
              <IconUser />
            </div>
            <div className="wac__mention-picker-info">
              <span className="wac__mention-picker-name">tous</span>
              <span className="wac__mention-picker-hint">Mentionnez tous les membres de la discussion</span>
            </div>
          </div>
          {mentionHits.map((m, i) => (
            <div
              key={m.jid}
              className={'wac__mention-picker-item' + (i + 1 === mentionIdx ? ' is-active' : '')}
              onMouseDown={(e) => { e.preventDefault(); selectMention(m) }}
              onMouseEnter={() => setMentionIdx(i + 1)}
            >
              <div className="wac__mention-picker-avatar">
                {m.pic
                  ? <img src={m.pic} alt="" draggable={false} />
                  : <span>{m.name[0]?.toUpperCase() ?? '?'}</span>}
              </div>
              <span className="wac__mention-picker-name">{m.name}</span>
            </div>
          ))}
        </div>
      )}
    <div className="wac__composer">
      <div className="wac__composer-pill">
        <div className="wac__attach-wrap">
          <button
            className="wac__pill-btn"
            aria-label="Joindre"
            title="Joindre"
            onClick={() => setAttachOpen((v) => !v)}
          >
            <IconPlus />
          </button>
          {attachOpen && (
            <div
              className="wac__attach-pop"
              onMouseLeave={() => setAttachOpen(false)}
            >
              <AttachItem color="#7F66FF" icon={<IconDocument />} label="Document" onClick={() => { setAttachOpen(false); onPickDocument?.() }} />
              <AttachItem color="#007BFC" icon={<IconImage />}    label="Photos et vidéos" onClick={() => { setAttachOpen(false); onPickPhotos?.() }} />
              <AttachItem color="#FF8A1F" icon={<IconHeadphones />} label="Fichier audio" onClick={() => { setAttachOpen(false); onPickAudio?.() }} />
              <AttachItem color="#25D366" icon={<IconMic />} label="Message vocal" onClick={() => { setAttachOpen(false); onPickAudioRecording?.() }} />
              <AttachItem color="#0095F6" icon={<IconUserPlus />} label="Contact" onClick={() => { setAttachOpen(false); onOpenContacts?.() }} />
              <AttachItem color="#F5C542" icon={<IconBolt />} label="Réponses" onClick={() => { setAttachOpen(false); onOpenQuickReplies?.() }} />
              <AttachItem color="#5CBD6D" icon={<IconCalendar />} label="Programmer" onClick={() => { setAttachOpen(false); onOpenScheduled?.() }} />
              <AttachItem color="#4CAF50" icon={<IconTag />} label="Étiquettes" onClick={() => { setAttachOpen(false); onOpenTags?.() }} />
            </div>
          )}
        </div>
        <button
          className={'wac__pill-btn' + (pickerOpen ? ' is-active' : '')}
          aria-label="Emoji"
          title="Emoji"
          onClick={() => setPickerOpen((v) => !v)}
        >
          <IconStickerSmiley size={24} />
        </button>

        <textarea
          ref={ref}
          className="wac__composer-input"
          placeholder="Entrez un message"
          value={state.text}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (slashQuery !== null && slashHits.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => (i + 1) % slashHits.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => (i - 1 + slashHits.length) % slashHits.length); return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectSlashItem(slashHits[slashIdx]); return }
              if (e.key === 'Escape') { e.preventDefault(); setSlashQuery(null); return }
            }
            // Hash picker is read-only: only Escape closes it; arrow keys
            // and Enter/Tab pass through to the textarea unchanged.
            if (hashQuery !== null && e.key === 'Escape') {
              e.preventDefault(); setHashQuery(null); return
            }
            if (mentionQuery !== null) {
              const total = mentionHits.length + 1
              if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % total); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + total) % total); return }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                if (mentionIdx === 0) selectMentionAll()
                else selectMention(mentionHits[mentionIdx - 1])
                return
              }
            }
            if (e.key === 'Escape' && mentionQuery !== null) { e.preventDefault(); setMentionQuery(null); return }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (hasText) onSend()
            }
          }}
          rows={1}
        />

        <button
          className={'wac__pill-btn wac__pill-btn--send' + (hasText ? ' is-send' : '')}
          aria-label={hasText ? 'Envoyer' : 'Enregistrer un message vocal'}
          title={hasText ? 'Envoyer' : 'Enregistrer un message vocal'}
          onClick={() => {
            if (hasText) { onSend(); return }
            setIsRecording(true)
          }}
        >
          {hasText
            ? <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" /></svg>
            : <IconMic />}
        </button>
      </div>
    </div>
    </div>
  )
}

// ── Emoji & GIF Picker (WhatsApp Web-style) ─────────────────────────────────

// SVG category icons matching WhatsApp Web's outlined icon set
const EpCatIcons = {
  recent: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>,
  smiley: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="10" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="0.8" fill="currentColor" stroke="none"/></svg>,
  animal: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 21c-4 0-7-2-7-5s1-4 3-5c-1-2-.5-4 1-5s3 0 3 0 1.5-1 3 0 2 3 1 5c2 1 3 2 3 5s-3 5-7 5z"/><circle cx="9.5" cy="14" r="0.8" fill="currentColor" stroke="none"/><circle cx="14.5" cy="14" r="0.8" fill="currentColor" stroke="none"/></svg>,
  food: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
  activity: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>,
  travel: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="7" width="20" height="12" rx="2"/><path d="M6 19v2M18 19v2"/><circle cx="7" cy="15" r="2"/><circle cx="17" cy="15" r="2"/><path d="M2 11h20"/></svg>,
  objects: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>,
  symbols: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  flags: () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>,
}

// Labels per category icon key. Emoji sets come from the generated full
// Unicode dataset (emoji-data.ts, 1900+ emojis) — see scripts/gen-emoji.mjs.
const EP_CAT_LABELS: Record<string, string> = {
  smiley:   'Emojis et personnes',
  animal:   'Animaux et nature',
  food:     'Nourriture',
  activity: 'Activités',
  travel:   'Voyage',
  objects:  'Objets',
  symbols:  'Symboles',
  flags:    'Drapeaux',
}

const EMOJI_CATEGORIES: { label: string; iconKey: keyof typeof EpCatIcons; emojis: string[] }[] = [
  { label: 'Récent', iconKey: 'recent', emojis: [] },
  ...EMOJI_DATA.map((c) => ({
    label: EP_CAT_LABELS[c.iconKey] ?? c.iconKey,
    iconKey: c.iconKey as keyof typeof EpCatIcons,
    emojis: c.emojis,
  })),
]

// Stored as localStorage key for recent emojis
const RECENT_KEY = 'wam.emoji.recent'

function loadRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
function saveRecentEmoji(emoji: string) {
  try {
    const prev = loadRecentEmojis()
    const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 32)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* ignore */ }
}

function EmojiGifPicker({
  tab, onTabChange, onSelectEmoji, onSelectGif, onClose,
}: {
  tab: 'emoji' | 'gif'
  onTabChange: (t: 'emoji' | 'gif') => void
  onSelectEmoji: (emoji: string) => void
  onSelectGif?: (gifUrl: string, mp4Url: string) => void
  onClose: () => void
}) {
  const [activeCategory, setActiveCategory] = useState(0)
  const [search, setSearch] = useState('')
  const [recentEmojis, setRecentEmojis] = useState(loadRecentEmojis)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Check if click is on the toggle button (parent manages that)
        const btn = (e.target as HTMLElement).closest('.wac__pill-btn')
        if (!btn) onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  function handleEmojiClick(emoji: string) {
    onSelectEmoji(emoji)
    saveRecentEmoji(emoji)
    setRecentEmojis(loadRecentEmojis())
  }

  // Build categories with recent injected
  const categories = useMemo(() => {
    const cats = [...EMOJI_CATEGORIES]
    cats[0] = { ...cats[0], emojis: recentEmojis }
    return cats
  }, [recentEmojis])

  // Filtered emojis when searching — matches against the emoji name index.
  const filteredEmojis = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const out: string[] = []
    for (const cat of EMOJI_DATA) {
      for (const e of cat.emojis) {
        if ((EMOJI_KEYWORDS[e] ?? '').includes(q)) out.push(e)
      }
    }
    return out
  }, [search])

  return (
    <div className="wac__ep" ref={panelRef}>
      {tab === 'emoji' && (
        <>
          {/* Category icons */}
          <div className="wac__ep-cats">
            {categories.map((cat, i) => {
              const Icon = EpCatIcons[cat.iconKey]
              return (
                <button
                  key={cat.label}
                  className={'wac__ep-cat-btn' + (activeCategory === i ? ' is-active' : '')}
                  onClick={() => { setActiveCategory(i); setSearch('') }}
                  title={cat.label}
                >
                  <Icon />
                </button>
              )
            })}
          </div>

          {/* Search */}
          <div className="wac__ep-search">
            <div className="wac__ep-search-pill">
              <IconSearch size={16} />
              <input
                type="text"
                placeholder="Rechercher un emoji"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Emoji grid */}
          <div className="wac__ep-grid-scroll">
            {filteredEmojis ? (
              <div className="wac__ep-grid">
                {filteredEmojis.map((e, i) => (
                  <button key={`${e}-${i}`} className="wac__ep-emoji" onClick={() => handleEmojiClick(e)}>
                    {e}
                  </button>
                ))}
              </div>
            ) : (
              <>
                {categories[activeCategory].emojis.length === 0 && activeCategory === 0 ? (
                  <div className="wac__ep-empty">Aucun emoji récent</div>
                ) : (
                  <>
                    <div className="wac__ep-cat-label">{categories[activeCategory].label}</div>
                    <div className="wac__ep-grid">
                      {categories[activeCategory].emojis.map((e, i) => (
                        <button key={`${e}-${i}`} className="wac__ep-emoji" onClick={() => handleEmojiClick(e)}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {tab === 'gif' && (
        <GifTab onSelectGif={onSelectGif} onSelectEmoji={onSelectEmoji} />
      )}

      {/* Bottom tab bar */}
      <div className="wac__ep-tabs">
        <button
          className={'wac__ep-tab' + (tab === 'emoji' ? ' is-active' : '')}
          onClick={() => onTabChange('emoji')}
        >
          <IconSmiley size={22} />
        </button>
        <button
          className={'wac__ep-tab' + (tab === 'gif' ? ' is-active' : '')}
          onClick={() => onTabChange('gif')}
        >
          GIF
        </button>
      </div>
    </div>
  )
}

// ── GIPHY GIF tab ───────────────────────────────────────────────────────────

const GIPHY_KEY = import.meta.env.VITE_GIPHY_API_KEY as string | undefined

interface GiphyGif {
  id: string
  images: {
    fixed_height: { url: string; width: string; height: string }
    fixed_height_still: { url: string }
    original: { url: string; mp4?: string }
  }
  title: string
}

function GifTab({ onSelectGif, onSelectEmoji }: { onSelectGif?: (gifUrl: string, mp4Url: string) => void; onSelectEmoji: (text: string) => void }) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GiphyGif[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch trending on mount
  useEffect(() => {
    if (!GIPHY_KEY) return
    setLoading(true)
    fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=30&rating=g`)
      .then((r) => r.json())
      .then((d) => setGifs(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Search with debounce
  useEffect(() => {
    if (!GIPHY_KEY) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) {
      // Back to trending
      setLoading(true)
      fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=30&rating=g`)
        .then((r) => r.json())
        .then((d) => setGifs(d.data ?? []))
        .catch(() => {})
        .finally(() => setLoading(false))
      return
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=30&rating=g`)
        .then((r) => r.json())
        .then((d) => setGifs(d.data ?? []))
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  if (!GIPHY_KEY) {
    return (
      <div className="wac__ep-gif-body">
        <div className="wac__ep-empty">
          Clé GIPHY manquante.<br />
          Ajoutez <code>VITE_GIPHY_API_KEY</code> dans votre fichier <code>.env</code>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="wac__ep-search" style={{ paddingTop: 10 }}>
        <div className="wac__ep-search-pill">
          <IconSearch size={16} />
          <input
            type="text"
            placeholder="Rechercher des GIF via GIPHY"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="wac__ep-gif-body">
        {loading && gifs.length === 0 ? (
          <div className="wac__ep-empty">Chargement...</div>
        ) : gifs.length === 0 ? (
          <div className="wac__ep-empty">Aucun GIF.</div>
        ) : (
          <div className="wac__ep-gif-grid">
            {gifs.map((g) => {
              const w = parseInt(g.images.fixed_height.width, 10) || 200
              const h = parseInt(g.images.fixed_height.height, 10) || 200
              return (
                <button
                  key={g.id}
                  className="wac__ep-gif-cell"
                  style={{ gridRowEnd: `span ${Math.max(1, Math.round((h / w) * 2))}` }}
                  onClick={() => {
                    if (onSelectGif) onSelectGif(g.images.original.url, g.images.original.mp4 ?? g.images.original.url)
                    else onSelectEmoji(`[GIF: ${g.images.original.url}]`)
                  }}
                  title={g.title}
                >
                  <img
                    src={g.images.fixed_height.url}
                    alt={g.title}
                    loading="lazy"
                    draggable={false}
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

function AttachItem({
  color, icon, label, onClick,
}: { color: string; icon: ReactNode; label: string; onClick?: () => void }) {
  return (
    <button className="wac__attach-item" type="button" onClick={onClick}>
      <span className="wac__attach-icon" style={{ color }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

// ── Media staging overlay (WhatsApp Web pre-send preview) ───────────────────
// Full takeover of the thread+composer area. Shows the active item large, a
// per-item caption (hidden for audio), a thumbnail strip to switch/remove, a
// "+" to add more, and a send FAB with the batch count. UI only — `onSend`
// is invoked with the staged list; the actual upload/dispatch is wired later.
// Staging preview for a voice message — renders the SAME recording bubble as the
// thread (mic avatar + waveform + play/duration), wired to the local preview URL.
function StagingVoicePreview({ url, seed }: { url: string; seed: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const bars = useMemo(() => {
    let h = 0
    for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) | 0
    const out: number[] = []
    for (let i = 0; i < 48; i++) { h = (h * 1103515245 + 12345) | 0; out.push(Math.abs(h) % 100) }
    return out
  }, [seed])
  const total = duration
  const frac = total > 0 ? Math.min(1, current / total) : 0
  const playedIdx = Math.floor(frac * bars.length)
  const fmt = (s: number) => { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}` }
  function toggle() {
    const el = audioRef.current; if (!el) return
    if (playing) el.pause(); else void el.play()
  }
  return (
    <div className="wac__voice is-out">
      <audio
        ref={audioRef} src={url} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0) }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDuration(d) }}
        style={{ display: 'none' }}
      />
      <div className="wac__voice-avatar">
        <IconUser />
        <span className="wac__voice-avatar-mic"><IconMic /></span>
      </div>
      <button type="button" className="wac__voice-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Lire le message vocal'}>
        {playing ? <IconPause /> : <IconPlay />}
      </button>
      <div className="wac__voice-wave">
        {bars.map((amp, i) => (
          <span key={i} className={'wac__voice-bar' + (i < playedIdx ? ' is-played' : '')} style={{ height: 4 + Math.round((amp / 100) * 18) }} />
        ))}
        <span className="wac__voice-playhead is-blue" style={{ left: `calc(${frac * 100}% - 5px)` }} aria-hidden />
      </div>
      <div className="wac__voice-time">{fmt(current > 0 ? current : total)}</div>
    </div>
  )
}

function MediaStagingOverlay({
  items, activeId, onSetActive, onRemove, onCaptionChange, onAddMore, onClose, onSend,
}: {
  items: StagedItem[]
  activeId: string | null
  onSetActive: (id: string) => void
  onRemove: (id: string) => void
  onCaptionChange: (id: string, caption: string) => void
  onAddMore: () => void
  onClose: () => void
  onSend: () => void
}) {
  const active = items.find((i) => i.id === activeId) ?? items[0] ?? null
  const captionRef = useRef<HTMLInputElement | null>(null)
  const [docPages, setDocPages] = useState<number | null>(null)

  // Escape closes the whole overlay; refocus caption when switching items.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (active && active.kind !== 'audio') captionRef.current?.focus()
  }, [active?.id, active?.kind])

  // Page count is per-item; reset when the previewed item changes.
  useEffect(() => { setDocPages(null) }, [active?.id])

  if (!active) return null
  const isPdf = active.mime === 'application/pdf'

  return (
    <div className="wac__staging">
      <div className="wac__staging-top">
        <button className="wac__staging-close" onClick={onClose} aria-label="Annuler" title="Annuler">
          <IconClose size={22} />
        </button>
        <div className="wac__staging-titlebox">
          <span className="wac__staging-title">{active.kind === 'audio' && active.ptt ? 'Message vocal' : active.name}</span>
          {isPdf && docPages != null && (
            <span className="wac__staging-subtitle">{docPages} page{docPages > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      <div className="wac__staging-preview">
        {(active.kind === 'image' || active.isGif) && (
          <img className="wac__staging-media" src={active.previewUrl} alt={active.name} draggable={false} />
        )}
        {active.kind === 'video' && !active.isGif && (
          <video
            className="wac__staging-media"
            src={active.previewUrl}
            controls
            playsInline
          />
        )}
        {active.kind === 'audio' && active.ptt && (
          // Voice message: preview with the REAL recording bubble (mic avatar +
          // waveform + play), identical to how it lands in the thread.
          <div className="wac__staging-voice">
            <StagingVoicePreview url={active.previewUrl} seed={active.id} />
          </div>
        )}
        {active.kind === 'audio' && !active.ptt && (
          <div className="wac__staging-audio">
            <span className="wac__staging-audio-icon"><IconHeadphones size={30} /></span>
            <audio src={active.previewUrl} controls />
            <span className="wac__staging-audio-name">{active.name}</span>
          </div>
        )}
        {active.kind === 'document' && (
          <StagedDocPreview key={active.id} item={active} onPageCount={setDocPages} />
        )}
      </div>

      {active.kind !== 'audio' && (
        <div className="wac__staging-caption">
          <div className="wac__staging-caption-field">
            <input
              ref={captionRef}
              className="wac__staging-caption-input"
              placeholder="Ajouter une légende…"
              value={active.caption}
              onChange={(e) => onCaptionChange(active.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSend() } }}
            />
            {active.caption && (
              <button
                className="wac__staging-caption-clear"
                onClick={() => onCaptionChange(active.id, '')}
                aria-label="Effacer la légende"
              >
                <IconClose size={18} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="wac__staging-tray">
        <div className="wac__staging-strip">
          {items.map((it) => (
            <div
              key={it.id}
              className={'wac__staging-thumb' + (it.id === active.id ? ' is-active' : '') + (it.kind === 'audio' ? ' is-audio' : '')}
              onClick={() => onSetActive(it.id)}
              role="button"
              tabIndex={0}
            >
              <StagedThumb item={it} />
              <button
                className="wac__staging-thumb-x"
                onClick={(e) => { e.stopPropagation(); onRemove(it.id) }}
                aria-label="Retirer"
                title="Retirer"
              >
                <IconClose size={13} />
              </button>
            </div>
          ))}
          <button className="wac__staging-add" onClick={onAddMore} aria-label="Ajouter" title="Ajouter">
            <IconPlus size={22} />
          </button>
        </div>

        <button className="wac__staging-send" onClick={onSend} aria-label="Envoyer" title="Envoyer">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
            <path d="M1.101 21.757 23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z" />
          </svg>
          {items.length > 1 && <span className="wac__staging-send-count">{items.length}</span>}
        </button>
      </div>
    </div>
  )
}

function StagedThumb({ item }: { item: StagedItem }) {
  if (item.kind === 'image' || item.isGif) {
    return <img src={item.previewUrl} alt="" draggable={false} />
  }
  if (item.kind === 'video') {
    return <video src={item.previewUrl} muted playsInline />
  }
  if (item.kind === 'audio') {
    return <span className="wac__staging-thumb-glyph wac__staging-thumb-glyph--audio">{item.ptt ? <IconMic size={20} /> : <IconHeadphones size={20} />}</span>
  }
  return <StagedDocThumb item={item} />
}

// Strip thumbnail for a staged document: shows a real preview when one can be
// produced (pdf page 1, or an embedded Office thumbnail), otherwise the colored
// file-type glyph — matching the chat thread.
function StagedDocThumb({ item }: { item: StagedItem }) {
  const [src, setSrc] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!item.file) { setDone(true); return }
    let cancelled = false
    let url: string | null = null
    void (async () => {
      try {
        const { generateDocThumbnail } = await import('../../../lib/docThumbnail')
        const jpeg = await generateDocThumbnail(item.file!, item.mime, item.name)
        if (cancelled) return
        if (jpeg) { url = URL.createObjectURL(jpeg); setSrc(url) }
      } catch { /* fall back to glyph */ }
      if (!cancelled) setDone(true)
    })()
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [item.file, item.mime, item.name])

  if (src) return <img src={src} alt="" className="wac__staging-thumb-pdf" />
  if (!done) return <span className="wac__staging-thumb-glyph"><IconDocument size={20} /></span>
  return <span className="wac__staging-thumb-glyph"><FileTypeIcon name={item.name} size={38} /></span>
}

// Tiny page-1 render for the staging strip thumbnail (cover-cropped to fill
// Renders page 1 of a PDF to a canvas inside a clean white card (WhatsApp
// parity — no browser PDF chrome). pdfjs is lazy-imported so it only loads
// when a PDF is actually staged.
function PdfFirstPage({ src, onPageCount, fileName }: {
  src: string
  onPageCount?: (n: number) => void
  fileName: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')
  const [aspect, setAspect] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    let loadTask: { promise: Promise<unknown>; destroy?: () => void } | null = null
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url' as string) as { default: string }).default
        ;(pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerUrl
        loadTask = (pdfjs as unknown as { getDocument: (s: string) => { promise: Promise<unknown>; destroy?: () => void } }).getDocument(src)
        const doc = await loadTask!.promise as {
          numPages: number
          getPage: (n: number) => Promise<{
            getViewport: (o: { scale: number }) => { width: number; height: number }
            render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
          }>
        }
        if (cancelled) return
        onPageCount?.(doc.numPages)
        const page = await doc.getPage(1)
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const base = page.getViewport({ scale: 1 })
        // Render the page buffer at a generous resolution; CSS scales it down to
        // fit the preview box (max-height/max-width) so it never scrolls.
        const renderWidth = 900
        const viewport = page.getViewport({ scale: (renderWidth / base.width) * dpr })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        setAspect(viewport.width / viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await page.render({ canvasContext: ctx, viewport }).promise
        if (!cancelled) setStatus('done')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true; try { loadTask?.destroy?.() } catch { /* noop */ } }
  }, [src])

  if (status === 'error') {
    return (
      <div className="wac__staging-doc">
        <span className="wac__staging-doc-icon"><IconDocument size={48} /></span>
        <span className="wac__staging-doc-name">{fileName}</span>
        <span className="wac__staging-doc-size">Aperçu indisponible</span>
      </div>
    )
  }
  return (
    <div className="wac__staging-pdf">
      {status === 'loading' && <div className="wac__staging-pdf-spinner" />}
      <canvas
        ref={canvasRef}
        className={'wac__staging-pdf-canvas' + (status === 'done' ? ' is-ready' : '')}
        style={aspect ? { aspectRatio: String(aspect) } : undefined}
      />
    </div>
  )
}

// ── Document preview routing ────────────────────────────────────────────────
// Detects a document's concrete type from mime + extension and dispatches to a
// renderer. All renderers are client-side and lazy-imported; nothing hits the
// server. Anything unrenderable falls back to the icon card.
type DocType = 'pdf' | 'docx' | 'office-thumb' | 'csv' | 'text' | 'svg' | 'image' | 'unknown'

function detectDocType(mime: string, name: string): DocType {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (mime === 'image/svg+xml' || ext === 'svg') return 'svg'
  // image/* that no browser can paint (PSD/TIFF/RAW) → file-icon card, not a
  // broken <img>. Everything else image/* is a renderable raster.
  if (mime.startsWith('image/') && !IMAGE_AS_DOC_MIMES.has(mime.toLowerCase()) && !IMAGE_AS_DOC_EXTS.has(ext)) return 'image'
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  // pptx/xlsx (and other OOXML) carry a baked-in docProps/thumbnail we can pull.
  if (['pptx', 'xlsx', 'ppsx', 'xlsm', 'docm'].includes(ext)
    || mime.includes('presentationml') || mime.includes('spreadsheetml')) return 'office-thumb'
  if (ext === 'csv' || mime === 'text/csv') return 'csv'
  if (mime.startsWith('text/') || ['txt', 'md', 'json', 'log', 'xml', 'yaml', 'yml', 'ts', 'js', 'css', 'html'].includes(ext)) return 'text'
  return 'unknown'
}

function DocIconCard({ name, file, note }: { name: string; file: File | null; note?: string }) {
  return (
    <div className="wac__staging-doc">
      <FileTypeIcon name={name} size={68} />
      <span className="wac__staging-doc-name">{name}</span>
      {note ? <span className="wac__staging-doc-size">{note}</span>
        : file?.size ? <span className="wac__staging-doc-size">{humanFileSize(file.size)}</span> : null}
    </div>
  )
}

// Routes a staged document to the right client-side renderer.
function StagedDocPreview({ item, onPageCount }: { item: StagedItem; onPageCount?: (n: number) => void }) {
  const type = detectDocType(item.mime, item.name)
  if (type === 'pdf') return <PdfFirstPage src={item.previewUrl} onPageCount={onPageCount} fileName={item.name} />
  if (type === 'image' || type === 'svg') {
    return <div className="wac__staging-pdf"><img className="wac__staging-pdf-canvas is-ready" src={item.previewUrl} alt={item.name} /></div>
  }
  if (!item.file) return <DocIconCard name={item.name} file={item.file} />
  if (type === 'docx') return <DocxPreview file={item.file} name={item.name} />
  if (type === 'office-thumb') return <OfficeThumbPreview file={item.file} name={item.name} />
  if (type === 'csv') return <CsvPreview file={item.file} name={item.name} />
  if (type === 'text') return <TextPreview file={item.file} name={item.name} />
  return <DocIconCard name={item.name} file={item.file} />
}

// DOCX → full client-side render via docx-preview into a white page card.
function DocxPreview({ file, name }: { file: File; name: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const host = hostRef.current
        if (!host) return
        const docx = await import('docx-preview')
        if (cancelled) return
        host.innerHTML = ''
        await docx.renderAsync(file, host, undefined, {
          className: 'wac-docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false,
          breakPages: true, useBase64URL: true,
        })
        if (!cancelled) setStatus('done')
      } catch { if (!cancelled) setStatus('error') }
    })()
    return () => { cancelled = true }
  }, [file])
  if (status === 'error') return <DocIconCard name={name} file={file} note="Aperçu indisponible" />
  return (
    <div className="wac__staging-docx">
      {status === 'loading' && <div className="wac__staging-pdf-spinner" />}
      <div ref={hostRef} className="wac__staging-docx-host" />
    </div>
  )
}

// pptx / xlsx / other OOXML → extract the baked-in docProps/thumbnail image.
function OfficeThumbPreview({ file, name }: { file: File; name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')
  useEffect(() => {
    let cancelled = false
    let objUrl: string | null = null
    void (async () => {
      try {
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(file)
        if (cancelled) return
        const entry = zip.file(/docProps\/thumbnail\.(jpe?g|png)$/i)[0]
        if (!entry) { setStatus('error'); return }
        const blob = await entry.async('blob')
        if (cancelled) return
        objUrl = URL.createObjectURL(blob)
        setUrl(objUrl)
        setStatus('done')
      } catch { if (!cancelled) setStatus('error') }
    })()
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [file])
  if (status === 'error') return <DocIconCard name={name} file={file} note="Aperçu indisponible" />
  return (
    <div className="wac__staging-pdf">
      {status === 'loading' && <div className="wac__staging-pdf-spinner" />}
      {url && <img className="wac__staging-pdf-canvas is-ready" src={url} alt={name} />}
    </div>
  )
}

// CSV → parse client-side and render the first rows as a table.
function CsvPreview({ file, name }: { file: File; name: string }) {
  const [rows, setRows] = useState<string[][] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const text = await file.text()
        if (cancelled) return
        const parsed = text.split(/\r?\n/).slice(0, 40).filter((l) => l.length > 0)
          .map((line) => line.split(',').map((c) => c.replace(/^"|"$/g, '')))
        setRows(parsed)
      } catch { if (!cancelled) setError(true) }
    })()
    return () => { cancelled = true }
  }, [file])
  if (error) return <DocIconCard name={name} file={file} note="Aperçu indisponible" />
  if (!rows) return <div className="wac__staging-pdf"><div className="wac__staging-pdf-spinner" /></div>
  return (
    <div className="wac__staging-sheet">
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i === 0 ? 'is-head' : ''}>
              {r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// txt / md / json / code → render the first slice as preformatted text.
function TextPreview({ file, name }: { file: File; name: string }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const t = await file.text()
        if (!cancelled) setText(t.slice(0, 8000))
      } catch { if (!cancelled) setError(true) }
    })()
    return () => { cancelled = true }
  }, [file])
  if (error) return <DocIconCard name={name} file={file} note="Aperçu indisponible" />
  if (text == null) return <div className="wac__staging-pdf"><div className="wac__staging-pdf-spinner" /></div>
  return <div className="wac__staging-text"><pre>{text}</pre></div>
}

// Status badge labels for the '#' picker rows.
const SCHEDULED_STATUS_BADGE: Record<ScheduledMessage['status'], string> = {
  pending:   'Programmé',
  sent:      'Envoyé',
  cancelled: 'Annulé',
  failed:    'Échec',
}

// Compact "scheduled-at" label for the '#' picker. Mirrors the formatting
// used inside ScheduledMessagesPanel so the two surfaces feel consistent.
function formatScheduledAt(d: Date): string {
  const pad2 = (n: number) => (n < 10 ? '0' + n : String(n))
  const time = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  const now = new Date()
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, now))      return `Aujourd'hui à ${time}`
  if (sameDay(d, tomorrow)) return `Demain à ${time}`
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + time
}

// ──────────────────────────────────────────────────────────────────────────────
// Info pane (right)
// ──────────────────────────────────────────────────────────────────────────────

export function InfoPane({
  conv, onClose, onOpenMedia, selfJid, ownerPic, onOpenSearch, tagColors, onAfterDelete, isAdmin = true,
}: { conv: ConversationDecrypted; messages: MessageDecrypted[]; onClose: () => void; onOpenMedia?: (msg: MessageDecrypted) => void; selfJid?: string | null; ownerPic?: string | null; onOpenSearch?: () => void; tagColors?: string[]; onAfterDelete?: () => void; isAdmin?: boolean }) {
  const qc = useQueryClient()
  const name = conversationLabel(conv.remote_jid ?? '', conv.peer_display_name, conv.contact_book_name)
  const isSelf = !!selfJid && conv.remote_jid === selfJid
  const isGroup = !!conv.is_group
  const parsed = parseJid(conv.remote_jid ?? '')
  const phone = parsed.kind === 'phone' ? formatPhone(parsed.user) : null
  const [subview, setSubview] = useState<'main' | 'media-gallery' | 'starred' | 'members' | 'assignees'>('main')
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [addMemberSearch, setAddMemberSearch] = useState('')
  const [assignPickerOpen, setAssignPickerOpen] = useState(false)

  // ── Conversation assignment data ─────────────────────────────────────────
  // Admin-only section: surfaces which agents own this conversation/group and
  // lets admins (un)assign. Hook only fetches when isAdmin so non-admins don't
  // trigger an extra realtime channel + select that they can't act on anyway.
  const assigneesQ = useConversationAssignees(isAdmin ? (conv.id ?? null) : null)
  // assignee realtime rides the unified wa:biz channel (AdminWaRealtime).
  const profilesQ = useProfiles()
  const setAssigneesMut = useSetConversationAssignees()
  const unassignMut = useUnassignConversationUser()
  // Scheduled-message safety on unassign: if the user being removed has pending
  // scheduled messages on this conversation, warn the admin and let them drop or
  // keep those drafts (a kept draft still fires via the cron drain).
  const scheduledForConvQ = useScheduledMessages(isAdmin ? (conv.id ?? null) : null)
  const deleteScheduledMut = useDeleteScheduledMessage()
  const [unassignPending, setUnassignPending] = useState<{ userId: string; name: string; count: number } | null>(null)
  const assigneeIds = useMemo(
    () => new Set((assigneesQ.data ?? []).map((a) => a.user_id)),
    [assigneesQ.data],
  )
  const assignedProfiles = useMemo(() => {
    const byId = new Map((profilesQ.data ?? []).map((p) => [p.id, p]))
    const order = assigneesQ.data ?? []
    return order
      .map((a) => byId.get(a.user_id))
      .filter((p): p is NonNullable<typeof p> => !!p)
  }, [assigneesQ.data, profilesQ.data])
  const availableProfiles = useMemo(
    () => (profilesQ.data ?? []).filter(
      (p) => p.is_active && p.role !== 'admin' && !assigneeIds.has(p.id),
    ),
    [profilesQ.data, assigneeIds],
  )

  // Pin/unpin from the info panel — mirrors the conversation-list context menu
  // (ChatList.ctxTogglePin): optimistic flip of is_pinned across the list caches
  // for an instant indicator, then the server toggle + invalidate so the list
  // re-sorts pinned-first. Available to everyone (pin is not an admin action).
  const pinned = !!conv.is_pinned
  const togglePinInfo = () => {
    if (!conv.id) return
    const next = !conv.is_pinned
    const id = conv.id
    qc.setQueriesData<{ pages: { rows: ConversationDecrypted[] }[] }>({ queryKey: ['conversations', 'list'] }, (old) => {
      if (!old?.pages) return old
      return { ...old, pages: old.pages.map((pg) => ({ ...pg, rows: pg.rows.map((r) => (r.id === id ? { ...r, is_pinned: next } : r)) })) }
    })
    void togglePin(id)
      .catch((e) => toast.error(normalizeError(e)))
      .finally(() => { void qc.invalidateQueries({ queryKey: ['conversations'] }) })
  }

  const handleAssignUser = (userId: string) => {
    if (!conv.id) return
    const nextIds = [...Array.from(assigneeIds), userId]
    setAssigneesMut.mutate({ conversationId: conv.id, userIds: nextIds })
    if (!isGroup) setAssignPickerOpen(false)
  }
  // Group batch-assign: takes the picker's full selection and merges it with
  // existing assignees in one RPC call, so the realtime feed sees a single
  // diff instead of N inserts. Empty selection is a no-op.
  const handleAssignUsersBatch = (userIds: string[]) => {
    if (!conv.id || userIds.length === 0) return
    const merged = new Set([...Array.from(assigneeIds), ...userIds])
    setAssigneesMut.mutate({ conversationId: conv.id, userIds: Array.from(merged) })
    setAssignPickerOpen(false)
  }
  const doUnassignUser = (userId: string) => {
    if (!conv.id) return
    unassignMut.mutate({ conversationId: conv.id, userId })
  }
  const handleUnassignUser = (userId: string) => {
    if (!conv.id) return
    const pending = (scheduledForConvQ.data ?? []).filter(
      (sm) => sm.created_by === userId && sm.status === 'pending',
    )
    if (pending.length > 0) {
      const p = (profilesQ.data ?? []).find((x) => x.id === userId)
      setUnassignPending({ userId, name: p?.full_name || p?.email || 'Cet utilisateur', count: pending.length })
      return
    }
    doUnassignUser(userId)
  }
  const resolveUnassign = (drop: boolean) => {
    const up = unassignPending
    if (!up || !conv.id) { setUnassignPending(null); return }
    if (drop) {
      const pending = (scheduledForConvQ.data ?? []).filter(
        (sm) => sm.created_by === up.userId && sm.status === 'pending',
      )
      for (const sm of pending) deleteScheduledMut.mutate({ id: sm.id, conversationId: conv.id })
    }
    doUnassignUser(up.userId)
    setUnassignPending(null)
  }

  // Danger-zone confirmation: which destructive action is pending, if any.
  // 'clear'  → keeps the conversation, wipes messages + R2 + outbound queue.
  // 'delete' → drops the conversation row (CASCADE wipes all children).
  const [pendingDanger, setPendingDanger] = useState<null | 'clear' | 'delete' | 'leave'>(null)
  const clearMut  = useClearConversation()
  const deleteMut = useDeleteConversation()
  const [leaveBusy, setLeaveBusy] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const dangerBusy = clearMut.isPending || deleteMut.isPending || leaveBusy
  const dangerError = clearMut.error?.message || deleteMut.error?.message || leaveError || null

  function confirmDanger() {
    if (!conv.id || !pendingDanger) return
    if (pendingDanger === 'clear') {
      clearMut.mutate(conv.id, {
        onSuccess: () => { setPendingDanger(null) },
      })
    } else if (pendingDanger === 'leave') {
      // Leaving a group is a one-off control action (like instance disconnect),
      // not a paced message — call the edge fn directly. The conversation stays
      // in the inbox; the participant list refreshes on the next group sync.
      if (!conv.instance_id || !conv.remote_jid) return
      setLeaveBusy(true); setLeaveError(null)
      leaveGroup(conv.instance_id, conv.remote_jid)
        .then(() => {
          setLeaveBusy(false); setPendingDanger(null)
          // Refresh the member list (owner row was removed) + conversation
          // (left_at set) so the panel stops showing us as a member.
          void qc.invalidateQueries({ queryKey: ['info-group-participants', conv.instance_id, conv.remote_jid] })
          void qc.invalidateQueries({ queryKey: ['conversations'] })
        })
        .catch((e) => { setLeaveBusy(false); setLeaveError(normalizeError(e)) })
    } else {
      deleteMut.mutate(conv.id, {
        onSuccess: () => {
          setPendingDanger(null)
          onAfterDelete?.()
        },
      })
    }
  }

  // ── Group-admin controls (gated on ownerIsAdmin) ───────────────────────────
  // Member action menu: rendered position:fixed at a screen point so the
  // overflow-y:auto on .wac__info-body can't clip it.
  const [memberMenu, setMemberMenu] = useState<{ jid: string; x: number; y: number } | null>(null)
  const [memberBusy, setMemberBusy] = useState<string | null>(null)
  // Pending member removal (WhatsApp shows a confirm before removing).
  const [pendingRemove, setPendingRemove] = useState<{ actionJid: string; name: string } | null>(null)
  const [groupActionError, setGroupActionError] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameBusy, setNameBusy] = useState(false)
  const [iconBusy, setIconBusy] = useState(false)
  const iconFileRef = useRef<HTMLInputElement | null>(null)

  async function handleMemberAction(actionJid: string, action: 'remove' | 'promote' | 'demote') {
    if (!conv.instance_id || !conv.remote_jid) return
    const key = ['info-group-participants', conv.instance_id, conv.remote_jid] as const
    setMemberMenu(null); setMemberBusy(actionJid); setGroupActionError(null)
    try {
      await updateGroupParticipants(conv.instance_id, conv.remote_jid, action, [actionJid])
      // Optimistic patch for INSTANT badge/list feedback — the DB's admin_level
      // only updates once the webhook echo is reconciled by the worker, so an
      // immediate refetch would show stale data. Patch the cache now…
      qc.setQueryData(key, (old) => {
        const rows = (old as GroupParticipantRow[] | undefined) ?? []
        const hit = (r: GroupParticipantRow) => r.phone_jid === actionJid || r.participant_jid === actionJid
        if (action === 'remove') return rows.filter((r) => !hit(r))
        const lvl = action === 'promote' ? 'admin' : null
        return rows.map((r) => (hit(r) ? { ...r, admin_level: lvl } : r))
      })
      // …then reconcile with the authoritative roster after the webhook lands.
      window.setTimeout(() => { void qc.invalidateQueries({ queryKey: key }) }, 5000)
    } catch (e) {
      setGroupActionError(normalizeError(e))
    } finally {
      setMemberBusy(null)
    }
  }

  async function handleRenameGroup() {
    const next = nameDraft.trim()
    if (!conv.instance_id || !conv.remote_jid || !next || next === name) { setEditingName(false); return }
    setNameBusy(true); setGroupActionError(null)
    try {
      await updateGroupSubject(conv.instance_id, conv.remote_jid, next)
      setEditingName(false)
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    } catch (e) {
      setGroupActionError(normalizeError(e))
    } finally {
      setNameBusy(false)
    }
  }

  async function handleIconFile(file: File) {
    if (!conv.instance_id || !conv.remote_jid) return
    setIconBusy(true); setGroupActionError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(new Error('read_failed'))
        fr.readAsDataURL(file)
      })
      await updateGroupPicture(conv.instance_id, conv.remote_jid, dataUrl)
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    } catch (e) {
      setGroupActionError(normalizeError(e))
    } finally {
      setIconBusy(false)
    }
  }

  interface GroupParticipantRow {
    participant_jid: string
    phone_jid: string | null
    push_name: string | null
    profile_pic: string | null
    admin_level: string | null
  }

  const participantsQ = useQuery({
    queryKey: ['info-group-participants', conv.instance_id, conv.remote_jid],
    enabled: isGroup && !!conv.instance_id && !!conv.remote_jid,
    queryFn: async () => {
      const { data } = await supabase
        .schema('whatsapp').from('group_participants' as never)
        .select('participant_jid, phone_jid, push_name, profile_pic, admin_level')
        .eq('instance_id', conv.instance_id!)
        .eq('group_jid', conv.remote_jid!) as unknown as { data: GroupParticipantRow[] | null }
      return data ?? []
    },
    staleTime: 60 * 1000,
  })

  const contactsQ = useQuery({
    queryKey: ['info-contacts', conv.instance_id],
    enabled: isGroup && !!conv.instance_id,
    queryFn: async () => {
      const { data } = await supabase
        .schema('whatsapp').from('contacts')
        .select('phone_jid, lid, push_name, profile_pic, book_name')
        .eq('instance_id', conv.instance_id!)
      return data ?? []
    },
    staleTime: 60 * 1000,
  })

  const contactsMap = useMemo(() => {
    const m = new Map<string, { push_name: string | null; profile_pic: string | null; book_name: string | null }>()
    for (const c of contactsQ.data ?? []) {
      const entry = { push_name: c.push_name, profile_pic: c.profile_pic, book_name: c.book_name }
      if (c.phone_jid) m.set(c.phone_jid, entry)
      if (c.lid) m.set(c.lid, entry)
    }
    return m
  }, [contactsQ.data])

  const memberList = useMemo(() => {
    if (!isGroup) return []
    const rows = participantsQ.data ?? []
    const ownerPhone = selfJid?.replace('@s.whatsapp.net', '') ?? null
    return rows.map((r) => {
      const cl = contactsMap.get(r.participant_jid)
      const cp = r.phone_jid ? contactsMap.get(r.phone_jid) : undefined
      const isOwner = (r.phone_jid === selfJid) || !!(ownerPhone && r.phone_jid?.startsWith(ownerPhone))
      const bookName = cl?.book_name ?? cp?.book_name ?? null
      const resolvedName = isOwner ? 'Vous' : (bookName || r.push_name || cl?.push_name || cp?.push_name || prettySender(r.phone_jid || r.participant_jid))
      const pic = isOwner ? (ownerPic || r.profile_pic || cl?.profile_pic || cp?.profile_pic || null) : (r.profile_pic || cl?.profile_pic || cp?.profile_pic || null)
      const phoneDisplay = r.phone_jid ? '+' + r.phone_jid.replace('@s.whatsapp.net', '') : null
      const isSuperAdmin = r.admin_level === 'superadmin'
      const isAdmin = r.admin_level === 'admin' || isSuperAdmin
      // JID to address for admin actions — prefer the phone JID (Evolution
      // strips to digits anyway), fall back to the LID.
      const actionJid = r.phone_jid || r.participant_jid
      return { jid: r.participant_jid, name: resolvedName, pic, phoneDisplay, isAdmin, isSuperAdmin, isOwner, actionJid }
    }).sort((a, b) => {
      if (a.isOwner) return -1
      if (b.isOwner) return 1
      return a.name.localeCompare(b.name)
    })
  }, [isGroup, participantsQ.data, contactsMap, selfJid, ownerPic])

  const memberCount = memberList.length
  // Our number's own admin status gates every group-admin control (WhatsApp:
  // only admins can remove/promote/demote or edit group info).
  const ownerIsAdmin = useMemo(() => memberList.some((m) => m.isOwner && m.isAdmin), [memberList])

  // Shared member row (used by the full members subview AND the main-panel
  // preview) — admin badge flush-right, hover/right-click reveals the action menu.
  const groupMemberRow = (m: (typeof memberList)[number]) => {
    const canAct = ownerIsAdmin && !m.isOwner && !m.isSuperAdmin
    return (
      <div
        key={m.jid}
        className={'wac__members-row' + (canAct ? ' is-actionable' : '') + (memberMenu?.jid === m.jid ? ' is-menu-open' : '')}
        onContextMenu={canAct ? (e) => { e.preventDefault(); setMemberMenu({ jid: m.jid, x: e.clientX, y: e.clientY }) } : undefined}
      >
        <div className="wac__members-avatar">
          {m.pic ? <img src={m.pic} alt="" draggable={false} /> : <span>{m.name[0]?.toUpperCase() ?? '?'}</span>}
        </div>
        <div className="wac__members-info">
          <span className="wac__members-name">{m.name}</span>
        </div>
        {m.isAdmin && <span className="wac__members-badge">Admin du groupe</span>}
        {canAct && (
          <button
            className="wac__icon-btn wac__member-menu-btn"
            aria-label="Actions"
            disabled={memberBusy === m.actionJid}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setMemberMenu(memberMenu?.jid === m.jid ? null : { jid: m.jid, x: r.right, y: r.bottom + 4 })
            }}
          >
            {memberBusy === m.actionJid ? <IconClock size={18} /> : <IconChevronDown size={18} />}
          </button>
        )}
      </div>
    )
  }

  // Fixed-position action menu (escapes the info-body overflow clip). Rendered
  // in whichever panel is showing the member list.
  const memberMenuOverlay = memberMenu && (() => {
    const m = memberList.find((x) => x.jid === memberMenu.jid)
    if (!m) return null
    const MENU_W = 250, MENU_H = 120
    const left = Math.max(8, Math.min(memberMenu.x, window.innerWidth - 8) - MENU_W)
    const top = memberMenu.y + MENU_H > window.innerHeight ? memberMenu.y - MENU_H : memberMenu.y
    return (
      <>
        <div className="wac__member-menu-scrim" onClick={() => setMemberMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMemberMenu(null) }} />
        <div className="wac__member-menu" style={{ position: 'fixed', top, left }}>
          {m.isAdmin
            ? <button className="wac__member-menu-item" onClick={() => handleMemberAction(m.actionJid, 'demote')}><IconShield size={20} /><span>Retirer le statut d’admin</span></button>
            : <button className="wac__member-menu-item" onClick={() => handleMemberAction(m.actionJid, 'promote')}><IconShield size={20} /><span>Nommer admin du groupe</span></button>}
          <button className="wac__member-menu-item is-danger" onClick={() => { setMemberMenu(null); setPendingRemove({ actionJid: m.actionJid, name: m.name }) }}><IconMinusCircle size={20} /><span>Supprimer</span></button>
        </div>
      </>
    )
  })()

  // Confirm dialog before removing a member (WhatsApp parity).
  const removeConfirmModal = pendingRemove && (
    <div className="wac__modal-overlay" onClick={() => { if (memberBusy !== pendingRemove.actionJid) setPendingRemove(null) }}>
      <div className="wac__modal" onClick={(e) => e.stopPropagation()}>
        <div className="wac__modal-head"><span>Retirer ce membre ?</span></div>
        <div className="wac__modal-body">
          <p style={{ margin: 0, color: 'var(--wa-text-secondary)', lineHeight: 1.5 }}>
            <strong>{pendingRemove.name}</strong> sera retiré(e) du groupe. Cette personne ne pourra plus voir les futurs messages, sauf si elle est réajoutée.
          </p>
          {groupActionError && <p style={{ marginTop: 12, color: '#ff6b6b', fontSize: 13 }}>{groupActionError}</p>}
        </div>
        <div className="wac__modal-footer">
          <button className="wac__modal-btn wac__modal-btn--cancel" disabled={memberBusy === pendingRemove.actionJid} onClick={() => setPendingRemove(null)}>Annuler</button>
          <button
            className="wac__modal-btn wac__modal-btn--save"
            style={{ background: '#c62828', color: '#fff' }}
            disabled={memberBusy === pendingRemove.actionJid}
            onClick={async () => { const jid = pendingRemove.actionJid; await handleMemberAction(jid, 'remove'); setPendingRemove(null) }}
          >
            {memberBusy === pendingRemove.actionJid ? 'En cours…' : 'Retirer'}
          </button>
        </div>
      </div>
    </div>
  )

  const [galleryTab, setGalleryTab] = useState<'media' | 'docs' | 'links'>('media')

  // Media/docs/links must reflect the WHOLE conversation history, not just
  // the loaded chat window. Fetching directly from messages_decrypted with
  // server-side filters so the panel is correct the moment a conversation
  // opens, no scroll-back required.
  const mediaQ = useQuery({
    queryKey: ['info-media', conv.id],
    enabled: !!conv.id,
    queryFn: async () => {
      const { data } = await supabase
        .schema('whatsapp').from('messages_decrypted')
        .select('*')
        .eq('conversation_id', conv.id!)
        .in('kind', ['image', 'video', 'document'])
        .order('whatsapp_timestamp', { ascending: true })
      return (data ?? []) as MessageDecrypted[]
    },
    staleTime: 30 * 1000,
  })

  // Text messages that contain URLs — server can't easily classify these so
  // we fetch all text messages and filter client-side. They're typically a
  // small fraction of the corpus and the body column is needed anyway.
  const linksQ = useQuery({
    queryKey: ['info-links', conv.id],
    enabled: !!conv.id,
    queryFn: async () => {
      const { data } = await supabase
        .schema('whatsapp').from('messages_decrypted')
        .select('*')
        .eq('conversation_id', conv.id!)
        .eq('kind', 'text')
        .not('body', 'is', null)
        .order('whatsapp_timestamp', { ascending: true })
      const rows = (data ?? []) as MessageDecrypted[]
      return rows.filter((m) => m.body && findAllUrls(m.body).length > 0)
    },
    staleTime: 30 * 1000,
  })

  const starredQ = useQuery({
    queryKey: ['info-starred', conv.id],
    enabled: !!conv.id,
    queryFn: async () => {
      const { data } = await supabase
        .schema('whatsapp').from('messages_decrypted')
        .select('*')
        .eq('conversation_id', conv.id!)
        .eq('is_starred', true)
        .order('whatsapp_timestamp', { ascending: false })
      return (data ?? []) as MessageDecrypted[]
    },
    staleTime: 30 * 1000,
  })

  const { mediaItems, docItems } = useMemo(() => {
    const media: MessageDecrypted[] = []
    const docs: MessageDecrypted[] = []
    for (const m of mediaQ.data ?? []) {
      const k = m.kind ?? 'text'
      const meta = (m.media_meta ?? {}) as Record<string, unknown>
      if (k === 'image' || k === 'video') {
        media.push(m)
      } else if (meta.subtype === 'template' && (meta.hasImage === true || meta.hasImage === 'true')) {
        media.push(m)
      } else if (k === 'document') {
        docs.push(m)
      }
    }
    return { mediaItems: media, docItems: docs }
  }, [mediaQ.data])

  const linkItems = linksQ.data ?? []
  const totalMediaCount = mediaItems.length + docItems.length + linkItems.length
  const starredMessages = starredQ.data ?? []

  // Reset subview when conversation changes
  useEffect(() => { setSubview('main'); setGalleryTab('media') }, [conv.id])

  if (subview === 'starred') {
    return (
      <aside className="wac__info wac__info--starred">
        <header className="wac__info-head">
          <button className="wac__icon-btn" aria-label="Retour" onClick={() => setSubview('main')}>
            <IconArrowBack />
          </button>
          <h2 className="wac__info-title">Messages importants</h2>
        </header>
        <div className="wac__starred-list">
          {starredMessages.length === 0 ? (
            <div className="wac__starred-empty">
              <IconStar size={48} />
              <p>Aucun message important</p>
              <span>Appuyez longuement sur un message pour le marquer comme important.</span>
            </div>
          ) : (
            starredMessages.map(msg => {
              const msgIsOut = msg.direction === 'outbound'
              const senderContact = msg.sender_jid ? contactsMap.get(msg.sender_jid) : undefined
              const senderLabel = msgIsOut
                ? 'Vous'
                : senderContact?.book_name || senderContact?.push_name || ((msg.media_meta as Record<string, unknown> | null)?.pushName as string) || conversationLabel(msg.sender_jid ?? conv.remote_jid ?? '', conv.peer_display_name, conv.contact_book_name)
              const time = formatBubbleTime(msg.created_at ?? '')
              const kind = msg.kind ?? 'text'
              return (
                <div key={msg.id} className="wac__starred-item" role="button" onClick={() => msg.id && scrollToMessage(msg.id)}>
                  <div className="wac__starred-item-head">
                    <span className="wac__starred-item-sender">{senderLabel}</span>
                    <span className="wac__starred-item-time">{time}</span>
                  </div>
                  <div className="wac__starred-item-body">
                    {kind === 'image' && <><IconImage size={14} /> Photo</>}
                    {kind === 'video' && <><IconVideo size={14} /> Vidéo</>}
                    {kind === 'audio' && <><IconHeadphones size={14} /> Audio</>}
                    {kind === 'document' && <><IconDocument size={14} /> Document</>}
                    {kind === 'sticker' && <><IconStickerPlus size={14} /> Sticker</>}
                    {kind === 'text' && (msg.body || '(vide)')}
                  </div>
                  <button
                    className="wac__starred-item-unstar"
                    aria-label="Retirer des importants"
                    title="Retirer des importants"
                    onClick={(e) => { e.stopPropagation(); if (msg.id) void toggleStar(msg.id).catch((er) => toast.error(normalizeError(er))) }}
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </aside>
    )
  }

  if (subview === 'media-gallery') {
    return (
      <aside className="wac__info wac__info--gallery">
        <header className="wac__info-head">
          <button className="wac__icon-btn" aria-label="Retour" onClick={() => setSubview('main')}>
            <IconArrowBack />
          </button>
          <span className="wac__info-head-title">Médias, liens et documents</span>
        </header>
        <div className="wac__mld-container">
          <div className="wac__mld-tabs">
            <button
              className={'wac__mld-tab' + (galleryTab === 'media' ? ' is-active' : '')}
              onClick={() => setGalleryTab('media')}
            >
              Médias
            </button>
            <button
              className={'wac__mld-tab' + (galleryTab === 'docs' ? ' is-active' : '')}
              onClick={() => setGalleryTab('docs')}
            >
              Documents
            </button>
            <button
              className={'wac__mld-tab' + (galleryTab === 'links' ? ' is-active' : '')}
              onClick={() => setGalleryTab('links')}
            >
              Liens
            </button>
          </div>
          <div className="wac__mld-body">
            {galleryTab === 'media' && <MediaGalleryTab items={mediaItems} onOpenMedia={onOpenMedia} />}
            {galleryTab === 'docs' && <DocsGalleryTab items={docItems} />}
            {galleryTab === 'links' && <LinksGalleryTab items={linkItems} />}
          </div>
        </div>
      </aside>
    )
  }

  if (subview === 'assignees') {
    return (
      <aside className="wac__info wac__info--members">
        <header className="wac__info-head">
          <button className="wac__icon-btn" aria-label="Retour" onClick={() => setSubview('main')}>
            <IconArrowBack />
          </button>
          <span className="wac__info-head-title">Utilisateurs assignés</span>
        </header>
        <div className="wac__info-body">
          <div className="wac__members-actions">
            <div
              className="wac__members-action-row"
              role="button"
              onClick={() => setAssignPickerOpen(true)}
            >
              <div className="wac__members-action-icon is-green"><IconUserPlus size={22} /></div>
              <span>Assigner un utilisateur</span>
            </div>
          </div>
          <div className="wac__members-full-list">
            {assignedProfiles.length === 0 && (
              <div className="wac__assign-empty">Aucun utilisateur assigné.</div>
            )}
            {assignedProfiles.map((p) => (
              <div key={p.id} className="wac__members-row wac__assign-row">
                <UserAvatar
                  config={(p.avatar_config ?? {}) as AvatarConfig}
                  url={p.avatar_url ?? null}
                  seed={p.id}
                  size={48}
                />
                <div className="wac__members-info">
                  <span className="wac__members-name">{p.full_name ?? p.email}</span>
                  {p.full_name && <span className="wac__assign-row-sub">{p.email}</span>}
                </div>
                <button
                  className="wac__icon-btn wac__assign-row-remove"
                  onClick={() => handleUnassignUser(p.id)}
                  title="Retirer l'assignation"
                  aria-label="Retirer l'assignation"
                >
                  <IconClose size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
        {assignPickerOpen && conv.id && (
          <AssignUserPicker
            available={availableProfiles}
            multi={isGroup}
            onPick={(uid) => { handleAssignUser(uid); setAssignPickerOpen(false) }}
            onPickMany={handleAssignUsersBatch}
            onClose={() => setAssignPickerOpen(false)}
          />
        )}
      </aside>
    )
  }

  if (subview === 'members') {
    return (
      <aside className="wac__info wac__info--members">
        <header className="wac__info-head">
          <button className="wac__icon-btn" aria-label="Retour" onClick={() => setSubview('main')}>
            <IconArrowBack />
          </button>
          <span className="wac__info-head-title">Infos du groupe</span>
        </header>
        <div className="wac__info-body">
          {ownerIsAdmin && (
            <div className="wac__members-actions">
              <div className="wac__members-action-row" role="button" onClick={() => setAddMemberOpen(true)}>
                <div className="wac__members-action-icon is-green"><IconUserPlus size={22} /></div>
                <span>Ajouter un membre</span>
              </div>
            </div>
          )}
          {groupActionError && <div className="wac__members-error">{groupActionError}</div>}
          <div className="wac__members-full-list">
            {memberList.map(groupMemberRow)}
          </div>
        </div>
        {memberMenuOverlay}
        {removeConfirmModal}
        {addMemberOpen && (
          <AddMemberDialog
            instanceId={conv.instance_id!}
            groupJid={conv.remote_jid}
            existingJids={new Set(memberList.map(m => m.jid))}
            onClose={() => { setAddMemberOpen(false); setAddMemberSearch('') }}
            search={addMemberSearch}
            onSearchChange={setAddMemberSearch}
          />
        )}
      </aside>
    )
  }

  return (
    <aside className="wac__info">
      <header className="wac__info-head">
        <button className="wac__icon-btn" aria-label="Fermer" onClick={onClose}>
          <IconClose />
        </button>
        <span className="wac__info-head-title">
          {isGroup ? 'Infos du groupe' : 'Infos du contact'}
        </span>
      </header>

      <div className="wac__info-body">
        <div className="wac__info-hero">
          <div className={'wac__info-hero-avatar' + (isGroup && ownerIsAdmin ? ' is-editable' : '')}>
            {conv.peer_profile_pic
              ? <img src={conv.peer_profile_pic} alt="" draggable={false} />
              : isGroup ? <IconUsers size={100} /> : <IconUser size={100} />}
            {isGroup && ownerIsAdmin && (
              <button
                className={'wac__hero-avatar-edit' + (iconBusy ? ' is-busy' : '')}
                aria-label="Changer l’icône du groupe"
                disabled={iconBusy}
                onClick={() => iconFileRef.current?.click()}
              >
                {iconBusy ? <span className="wac__hero-spinner" /> : <IconCamera size={28} />}
              </button>
            )}
            <input
              ref={iconFileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleIconFile(f); e.target.value = '' }}
            />
          </div>
          <div className="wac__info-hero-name">
            {isGroup && ownerIsAdmin && editingName ? (
              <span className="wac__hero-name-edit">
                <input
                  className="wac__hero-name-input"
                  value={nameDraft}
                  autoFocus
                  maxLength={100}
                  disabled={nameBusy}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleRenameGroup(); if (e.key === 'Escape') setEditingName(false) }}
                />
                {nameBusy ? (
                  <span className="wac__hero-spinner wac__hero-spinner--sm" />
                ) : (
                  <>
                    <button className="wac__icon-btn" aria-label="Enregistrer" onClick={() => void handleRenameGroup()}><IconCheck size={18} /></button>
                    <button className="wac__icon-btn" aria-label="Annuler" onClick={() => setEditingName(false)}><IconClose size={18} /></button>
                  </>
                )}
              </span>
            ) : (
              <>
                {name}{isSelf && <span className="wac__nc-tag"> (vous)</span>}
                {isGroup && ownerIsAdmin && (
                  <button
                    className="wac__icon-btn wac__hero-name-pencil"
                    aria-label="Modifier le nom du groupe"
                    onClick={() => { setNameDraft(name); setEditingName(true) }}
                  >
                    <IconPencil size={16} />
                  </button>
                )}
                {tagColors && tagColors.length > 0 && (
                  <span className="wac__row-tag-icons" style={{ marginLeft: 6 }}>
                    {tagColors.slice(0, 3).map((c, i) => (
                      <IconTagFilled key={i} size={16} style={{ color: c }} />
                    ))}
                  </span>
                )}
              </>
            )}
          </div>
          {isGroup && memberCount > 0 && (
            <div className="wac__info-hero-sub">
              Groupe · <span className="wac__info-hero-members" role="button" onClick={() => setSubview('members')}>{memberCount} membres</span>
            </div>
          )}
          {phone && <div className="wac__info-hero-sub">{phone}</div>}
        </div>

        {/* Médias, liens et documents */}
        {totalMediaCount > 0 && (
          <div className="wac__info-section">
            <div
              className="wac__info-row wac__info-row--clickable"
              role="button"
              tabIndex={0}
              onClick={() => { setSubview('media-gallery'); setGalleryTab('media') }}
            >
              <IconImage />
              <div className="wac__info-row-body">Médias, liens et documents</div>
              <span className="wac__info-row-count">{totalMediaCount}</span>
              <IconChevronDown style={{ transform: 'rotate(-90deg)', width: 16, height: 16 }} />
            </div>
            {mediaItems.length > 0 && (
              <div className="wac__mld-preview">
                {mediaItems.slice(-4).reverse().map((m) => (
                  <MldPreviewThumb key={m.id} msg={m} onClick={() => onOpenMedia?.(m)} />
                ))}
              </div>
            )}
          </div>
        )}

        {isGroup && memberCount > 0 && (
          <div className="wac__info-section">
            <div className="wac__members-header">
              <span className="wac__members-count" role="button" onClick={() => setSubview('members')}>{memberCount} membres</span>
              <button className="wac__icon-btn" aria-label="Rechercher" onClick={onOpenSearch}><IconSearch size={18} /></button>
            </div>
            {ownerIsAdmin && (
              <div className="wac__members-action-row" role="button" onClick={() => { setSubview('members'); setAddMemberOpen(true) }}>
                <div className="wac__members-action-icon is-green"><IconUserPlus size={20} /></div>
                <span>Ajouter un membre</span>
              </div>
            )}
            {memberList.slice(0, 5).map(groupMemberRow)}
            {memberCount > 5 && (
              <div className="wac__members-row wac__members-row--more" role="button" onClick={() => setSubview('members')}>
                <span>Voir tous les {memberCount} membres</span>
              </div>
            )}
          </div>
        )}

        <div className="wac__info-section">
          <div
            className="wac__info-row wac__info-row--clickable"
            role="button"
            tabIndex={0}
            onClick={togglePinInfo}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePinInfo() } }}
          >
            {pinned ? <IconWaUnpin size={20} /> : <IconWaPin size={20} />}
            <div className="wac__info-row-body">{pinned ? 'Détacher la discussion' : 'Épingler la discussion'}</div>
          </div>
          <div className="wac__info-row" role="button" onClick={() => setSubview('starred')}>
            <IconStar />
            <div className="wac__info-row-body">Messages importants</div>
          </div>
          <div className="wac__info-row" role="button">
            <IconLock />
            <div className="wac__info-row-body">
              Chiffrement
              <div className="wac__info-row-sub">
                Les messages sont chiffrés de bout en bout.
              </div>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="wac__info-section wac__assign-section">
            <div className="wac__assign-head">
              <span className="wac__assign-title">
                {isGroup ? 'Utilisateurs assignés' : 'Utilisateur assigné'}
              </span>
              <span className="wac__assign-count">
                {assignedProfiles.length}
              </span>
              {/* Plus button: hidden for DMs that already have an assignee
                  (a DM has one owner — admin must unassign first to re-pick).
                  Groups always allow adding more agents. */}
              {(isGroup || assignedProfiles.length === 0) && (
                <button
                  className="wac__icon-btn wac__assign-add"
                  onClick={() => setAssignPickerOpen(true)}
                  aria-label="Assigner un utilisateur"
                  title="Assigner un utilisateur"
                >
                  <IconPlus size={18} />
                </button>
              )}
            </div>

            {assignedProfiles.length === 0 ? (
              <div className="wac__assign-empty-row">
                Aucun utilisateur assigné à {isGroup ? 'ce groupe' : 'cette discussion'}.
              </div>
            ) : (
              <div className="wac__assign-list">
                {(isGroup && assignedProfiles.length > 4
                  ? assignedProfiles.slice(0, 3)
                  : assignedProfiles
                ).map((p) => (
                  <div key={p.id} className="wac__assign-row">
                    <UserAvatar
                      config={(p.avatar_config ?? {}) as AvatarConfig}
                      url={p.avatar_url ?? null}
                      seed={p.id}
                      size={40}
                    />
                    <div className="wac__assign-row-body">
                      <span className="wac__assign-row-name">{p.full_name ?? p.email}</span>
                      {p.full_name && <span className="wac__assign-row-sub">{p.email}</span>}
                    </div>
                    <button
                      className="wac__icon-btn wac__assign-row-remove"
                      onClick={() => handleUnassignUser(p.id)}
                      aria-label="Retirer"
                      title="Retirer l'assignation"
                    >
                      <IconClose size={18} />
                    </button>
                  </div>
                ))}
                {isGroup && assignedProfiles.length > 4 && (
                  <div
                    className="wac__assign-row wac__assign-row--more"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSubview('assignees')}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSubview('assignees') } }}
                  >
                    Voir les {assignedProfiles.length} assignés
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isAdmin && (
          <div className="wac__info-section">
            {isGroup && conv.left_at ? (
              // Already left the group → only "delete" remains (no clear/leave).
              <div
                className="wac__info-row is-danger"
                role="button"
                tabIndex={0}
                onClick={() => setPendingDanger('delete')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPendingDanger('delete') } }}
              >
                <IconTrash />
                <div className="wac__info-row-body">Supprimer la discussion</div>
              </div>
            ) : (
              <>
                <div
                  className="wac__info-row is-danger"
                  role="button"
                  tabIndex={0}
                  onClick={() => setPendingDanger('clear')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPendingDanger('clear') } }}
                >
                  <IconMinusCircle />
                  <div className="wac__info-row-body">Effacer la discussion</div>
                </div>
                {isGroup ? (
                  <div
                    className="wac__info-row is-danger"
                    role="button"
                    tabIndex={0}
                    onClick={() => setPendingDanger('leave')}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPendingDanger('leave') } }}
                  >
                    <IconArrowBack />
                    <div className="wac__info-row-body">Quitter le groupe</div>
                  </div>
                ) : (
                  <div
                    className="wac__info-row is-danger"
                    role="button"
                    tabIndex={0}
                    onClick={() => setPendingDanger('delete')}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPendingDanger('delete') } }}
                  >
                    <IconTrash />
                    <div className="wac__info-row-body">Supprimer la discussion</div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Agents (non-admin) get only "leave group" — clear/delete stay admin-only. */}
        {!isAdmin && isGroup && !conv.left_at && (
          <div className="wac__info-section">
            <div
              className="wac__info-row is-danger"
              role="button"
              tabIndex={0}
              onClick={() => setPendingDanger('leave')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPendingDanger('leave') } }}
            >
              <IconArrowBack />
              <div className="wac__info-row-body">Quitter le groupe</div>
            </div>
          </div>
        )}
      </div>

      {pendingDanger && (
        <DangerConfirmModal
          mode={pendingDanger}
          peerName={name}
          busy={dangerBusy}
          error={dangerError}
          onCancel={() => { if (!dangerBusy) setPendingDanger(null) }}
          onConfirm={confirmDanger}
        />
      )}

      {assignPickerOpen && conv.id && (
        <AssignUserPicker
          available={availableProfiles}
          multi={isGroup}
          onPick={(uid) => { handleAssignUser(uid); setAssignPickerOpen(false) }}
          onPickMany={handleAssignUsersBatch}
          onClose={() => setAssignPickerOpen(false)}
        />
      )}
      {unassignPending && (
        <UnassignScheduledModal
          userName={unassignPending.name}
          count={unassignPending.count}
          onCancel={() => setUnassignPending(null)}
          onKeep={() => resolveUnassign(false)}
          onDrop={() => resolveUnassign(true)}
        />
      )}
      {memberMenuOverlay}
      {removeConfirmModal}
    </aside>
  )
}

// ── Assign-user modal ───────────────────────────────────────────────────────
//
// Two modes:
//   single (DM)   — click a user → onPick fires immediately, parent closes.
//   multi (group) — click toggles selection; "Tout sélectionner" + OK commits
//                   all picks in a single onPickMany call.
//
// Shows only the active users that aren't already assigned to this
// conversation — `available` is filtered upstream by the parent.

function AssignUserPicker({
  available, multi = false, onPick, onPickMany, onClose,
}: {
  available: DirectoryProfileLite[]
  multi?: boolean
  onPick: (userId: string) => void
  onPickMany?: (userIds: string[]) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return available
    return available.filter((p) =>
      (p.full_name ?? '').toLowerCase().includes(q)
      || (p.email ?? '').toLowerCase().includes(q),
    )
  }, [available, search])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Select-all toggles between "everything currently visible" ↔ "nothing".
  // We compare against the *filtered* list so a search-narrowed picker can
  // bulk-select just the search hits.
  const visibleIds = useMemo(() => filtered.map((p) => p.id), [filtered])
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      }
      const next = new Set(prev)
      for (const id of visibleIds) next.add(id)
      return next
    })
  }

  const handleOk = () => {
    if (!onPickMany) return
    onPickMany(Array.from(selected))
  }

  return (
    <div className="wac__modal-overlay" onClick={onClose}>
      <div className="wac__assign-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wac__modal-head">
          <span>
            {multi
              ? `Assigner des utilisateurs${selected.size > 0 ? ` (${selected.size})` : ''}`
              : 'Assigner un utilisateur'}
          </span>
          <button className="wac__icon-btn" onClick={onClose} aria-label="Fermer">
            <IconClose size={18} />
          </button>
        </div>
        <div className="wac__assign-modal-search">
          <IconSearch size={16} />
          <input
            className="wac__qr-search"
            placeholder="Rechercher un utilisateur..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        {multi && visibleIds.length > 0 && (
          <div className="wac__assign-modal-bulk">
            <button
              type="button"
              className="wac__assign-modal-bulk-btn"
              onClick={toggleSelectAll}
            >
              {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          </div>
        )}
        <div className="wac__assign-modal-list">
          {filtered.length === 0 && (
            <div className="wac__assign-empty">
              {available.length === 0
                ? 'Aucun utilisateur disponible.'
                : 'Aucun résultat.'}
            </div>
          )}
          {filtered.map((p) => {
            const isSelected = selected.has(p.id)
            return (
              <button
                key={p.id}
                type="button"
                className={'wac__assign-modal-item' + (multi && isSelected ? ' is-selected' : '')}
                onClick={() => (multi ? toggle(p.id) : onPick(p.id))}
              >
                <UserAvatar
                  config={(p.avatar_config ?? {}) as AvatarConfig}
                  url={p.avatar_url ?? null}
                  seed={p.id}
                  size={40}
                />
                <div className="wac__assign-row-body">
                  <span className="wac__assign-row-name">{p.full_name ?? p.email}</span>
                  {p.full_name && <span className="wac__assign-row-sub">{p.email}</span>}
                </div>
                {multi && (
                  <span className={'wac__assign-modal-check' + (isSelected ? ' is-on' : '')}>
                    {isSelected && <IconCheck size={14} />}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {multi && (
          <div className="wac__assign-modal-footer">
            <button
              type="button"
              className="wac__qr-btn wac__qr-btn--cancel"
              onClick={onClose}
            >
              Annuler
            </button>
            <button
              type="button"
              className="wac__qr-btn wac__qr-btn--save"
              onClick={handleOk}
              disabled={selected.size === 0}
            >
              Assigner {selected.size > 0 && `(${selected.size})`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Minimal subset of DirectoryProfile to avoid pulling the wider type into
// presentational components; mirrors what listProfiles() returns.
interface DirectoryProfileLite {
  id: string
  email: string
  full_name: string | null
  avatar_config: unknown
  avatar_url?: string | null
}

// ── Danger-zone confirm modal (clear/delete conversation) ───────────────────

function DangerConfirmModal({
  mode, peerName, busy, error, onCancel, onConfirm,
}: {
  mode: 'clear' | 'delete' | 'leave'
  peerName: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const title = mode === 'clear' ? 'Effacer la discussion ?'
    : mode === 'leave' ? 'Quitter le groupe ?'
    : 'Supprimer la discussion ?'
  const body = mode === 'clear'
    ? <>Tous les messages échangés avec <strong>{peerName}</strong> seront supprimés (y compris les médias). La discussion restera dans la boîte de réception, vide. Cette action est irréversible.</>
    : mode === 'leave'
    ? <>Vous quitterez le groupe <strong>{peerName}</strong>. Vous ne pourrez plus y envoyer de messages tant que vous n'y êtes pas réajouté. La discussion reste dans la boîte de réception.</>
    : <>La discussion avec <strong>{peerName}</strong> sera entièrement supprimée : messages, médias, étiquettes, notes et attributions. Cette action est irréversible. Le côté WhatsApp du contact n'est pas affecté.</>
  const confirmLabel = mode === 'clear' ? 'Effacer' : mode === 'leave' ? 'Quitter' : 'Supprimer'
  return (
    <div className="wac__modal-overlay" onClick={() => { if (!busy) onCancel() }}>
      <div className="wac__modal" onClick={(e) => e.stopPropagation()}>
        <div className="wac__modal-head">
          <span>{title}</span>
        </div>
        <div className="wac__modal-body">
          <p style={{ margin: 0, color: 'var(--wa-text-secondary)', lineHeight: 1.5 }}>{body}</p>
          {error && (
            <p style={{ marginTop: 12, color: '#ff6b6b', fontSize: 13 }}>{error}</p>
          )}
        </div>
        <div className="wac__modal-footer">
          <button
            className="wac__modal-btn wac__modal-btn--cancel"
            onClick={onCancel}
            disabled={busy}
          >
            Annuler
          </button>
          <button
            className="wac__modal-btn wac__modal-btn--save"
            onClick={onConfirm}
            disabled={busy}
            style={{ background: '#c62828', color: '#fff' }}
          >
            {busy ? 'En cours…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add member dialog ────────────────────────────────────────────────────────

function AddMemberDialog({ instanceId, groupJid, existingJids, onClose, search, onSearchChange }: {
  instanceId: string; groupJid: string | null; existingJids: Set<string>; onClose: () => void; search: string; onSearchChange: (v: string) => void
}) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contactsQ = useQuery({
    queryKey: ['all-contacts', instanceId],
    queryFn: async () => {
      const { data } = await supabase
        .schema('whatsapp').from('contacts')
        .select('phone_jid, lid, push_name, profile_pic, book_name')
        .eq('instance_id', instanceId)
      return data ?? []
    },
    staleTime: 60 * 1000,
  })

  const contacts = useMemo(() => {
    const mapped = (contactsQ.data ?? [])
      // Only RESOLVED contacts (real phone JID) — you add a member by phone
      // number. LID-only/unresolved rows (raw 15-16 digit ids) are excluded.
      .filter(c => {
        if (!c.phone_jid) return false
        if (existingJids.has(c.phone_jid)) return false
        if (c.lid && existingJids.has(c.lid)) return false
        return true
      })
      .map(c => ({
        jid: c.phone_jid!,
        name: c.book_name || c.push_name || prettySender(c.phone_jid!),
        pic: c.profile_pic,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (!search.trim()) return mapped
    const q = search.toLowerCase()
    return mapped.filter(c => c.name.toLowerCase().includes(q) || c.jid.includes(q))
  }, [contactsQ.data, existingJids, search])

  const toggle = (jid: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(jid)) next.delete(jid); else next.add(jid)
    return next
  })

  // Add all selected members in ONE Evolution call (the endpoint takes an array).
  const addSelected = async () => {
    if (!groupJid || busy || selected.size === 0) return
    setBusy(true); setError(null)
    const jids = [...selected]
    try {
      await updateGroupParticipants(instanceId, groupJid, 'add', jids)
      // Optimistic: append the added members to the participant-list cache so
      // they show INSTANTLY (the real group sync reconciles names/pics later).
      const byJid = new Map((contactsQ.data ?? []).map((c) => [c.phone_jid, c]))
      qc.setQueryData(['info-group-participants', instanceId, groupJid], (prev: unknown) => {
        const rows = Array.isArray(prev) ? prev as Array<{ participant_jid: string }> : []
        const existing = new Set(rows.map((r) => r.participant_jid))
        const added = jids.filter((j) => !existing.has(j)).map((j) => {
          const c = byJid.get(j)
          return { participant_jid: j, phone_jid: j, push_name: c?.push_name ?? c?.book_name ?? null, profile_pic: c?.profile_pic ?? null, admin_level: null }
        })
        return [...rows, ...added]
      })
      onClose()
    } catch (e) {
      setError(normalizeError(e))
      setBusy(false)
    }
  }

  return (
    <div className="wac__add-member-overlay">
      <div className="wac__add-member-dialog">
        <header className="wac__add-member-head">
          <button className="wac__icon-btn" aria-label="Fermer" onClick={onClose}><IconClose /></button>
          <span>Ajouter un membre</span>
        </header>
        <div className="wac__add-member-search">
          <div className="wac__add-member-search-pill">
            <IconSearch size={16} />
            <input
              type="text"
              placeholder="Rechercher un nom ou un numéro"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
            />
          </div>
        </div>
        {error && <div className="wac__add-member-empty" style={{ color: '#f15c6d' }}>{error}</div>}
        <div className="wac__add-member-label">Contacts</div>
        <div className="wac__add-member-list">
          {contacts.map(c => {
            const checked = selected.has(c.jid)
            return (
              <div
                key={c.jid}
                className={'wac__add-member-row' + (checked ? ' is-selected' : '')}
                role="button"
                tabIndex={0}
                aria-checked={checked}
                onClick={() => toggle(c.jid)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c.jid) } }}
              >
                <div className="wac__members-avatar">
                  {c.pic ? <img src={c.pic} alt="" draggable={false} /> : <span>{c.name[0]?.toUpperCase() ?? '?'}</span>}
                </div>
                <div className="wac__members-info">
                  <span className="wac__members-name">{c.name}</span>
                </div>
                <span className="wac__add-member-check" aria-hidden>
                  <IconCheckbox size={22} checked={checked} />
                </span>
              </div>
            )
          })}
          {contacts.length === 0 && (
            <div className="wac__add-member-empty">Aucun contact trouvé</div>
          )}
        </div>
        {selected.size > 0 && (
          <div className="wac__add-member-foot">
            <span className="wac__add-member-count">
              {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
            </span>
            <button type="button" className="wac__add-member-confirm" disabled={busy} onClick={() => { void addSelected() }}>
              {busy ? 'Ajout…' : 'Ajouter'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── MLD preview thumbnail (4-item strip in info pane) ──────────────────────

function MldPreviewThumb({ msg, onClick }: { msg: MessageDecrypted; onClick?: () => void }) {
  const resolved = useResolvedMediaUrl(msg)
  const isVideo = msg.kind === 'video'
  const meta = (msg.media_meta ?? {}) as Record<string, unknown>
  const durationMs = typeof meta.duration_ms === 'number' ? meta.duration_ms : 0
  const durationLabel = durationMs > 0
    ? `${Math.floor(durationMs / 60000)}:${String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0')}`
    : null

  return (
    <div className="wac__mld-preview-item" onClick={resolved.url ? onClick : undefined} style={{ cursor: resolved.url ? 'pointer' : undefined }}>
      {resolved.url ? (
        isVideo ? (
          <>
            <video src={resolved.url} preload="metadata" />
            {durationLabel && (
              <span className="wac__mld-preview-badge">
                <IconVideo size={10} />
                <span>{durationLabel}</span>
              </span>
            )}
          </>
        ) : (
          <img src={resolved.url} alt="" draggable={false} />
        )
      ) : (
        <div className="wac__mld-preview-empty">
          {resolved.pending ? <IconClock size={18} /> : <IconImage size={18} />}
        </div>
      )}
    </div>
  )
}

// ── Media gallery tab (grid with month groups) ─────────────────────────────

function MediaGalleryTab({ items, onOpenMedia }: { items: MessageDecrypted[]; onOpenMedia?: (msg: MessageDecrypted) => void }) {
  const groups = useMemo(() => {
    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${now.getMonth()}`
    const map = new Map<string, { label: string; items: MessageDecrypted[] }>()
    // Reverse to show newest first
    const sorted = [...items].reverse()
    for (const m of sorted) {
      const d = m.whatsapp_timestamp ? new Date(m.whatsapp_timestamp) : now
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const label = key === thisMonth
        ? 'CE MOIS-CI'
        : d.toLocaleString('fr-FR', { month: 'long', year: 'numeric' }).toUpperCase()
      if (!map.has(key)) map.set(key, { label, items: [] })
      map.get(key)!.items.push(m)
    }
    return Array.from(map.values())
  }, [items])

  if (items.length === 0) {
    return <div className="wac__mld-empty">Aucun média.</div>
  }

  return (
    <div className="wac__mld-media-scroll">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="wac__mld-month">{g.label}</div>
          <div className="wac__mld-grid">
            {g.items.map((m) => (
              <MediaGalleryThumb key={m.id} msg={m} onClick={() => onOpenMedia?.(m)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MediaGalleryThumb({ msg, onClick }: { msg: MessageDecrypted; onClick?: () => void }) {
  const resolved = useResolvedMediaUrl(msg)
  const isVideo = msg.kind === 'video'
  const meta = (msg.media_meta ?? {}) as Record<string, unknown>
  const durationMs = typeof meta.duration_ms === 'number' ? meta.duration_ms : 0
  const durationLabel = durationMs > 0
    ? `${Math.floor(durationMs / 60000)}:${String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0')}`
    : null

  return (
    <div className="wac__mld-cell" onClick={resolved.url ? onClick : undefined}>
      {resolved.url ? (
        isVideo ? (
          <>
            <video src={resolved.url} preload="metadata" />
            {durationLabel && (
              <span className="wac__mld-cell-badge">
                <IconVideo size={12} />
                <span>{durationLabel}</span>
              </span>
            )}
          </>
        ) : (
          <img src={resolved.url} alt="" draggable={false} loading="lazy" />
        )
      ) : (
        <div
          className={
            'wac__mld-cell-empty'
            + (resolved.pending ? ' is-pending' : '')
            + (resolved.expired ? ' is-expired' : '')
          }
          title={resolved.expired ? 'Média indisponible' : resolved.pending ? 'Téléchargement…' : ''}
        >
          {resolved.pending
            ? <IconClock size={22} />
            : resolved.expired
              ? (isVideo ? <IconVideo size={22} /> : <IconImage size={22} />)
              : <IconDownload size={22} />}
        </div>
      )}
    </div>
  )
}

// ── Documents gallery tab ──────────────────────────────────────────────────

function DocsGalleryTab({ items }: { items: MessageDecrypted[] }) {
  if (items.length === 0) {
    return <div className="wac__mld-empty">Aucun document.</div>
  }
  return (
    <div className="wac__mld-docs-scroll">
      {[...items].reverse().map((m) => (
        <div key={m.id} className="wac__mld-doc-row">
          <DocumentBody msg={m} />
        </div>
      ))}
    </div>
  )
}

// ── Links gallery tab ──────────────────────────────────────────────────────

function LinksGalleryTab({ items }: { items: MessageDecrypted[] }) {
  if (items.length === 0) {
    return <div className="wac__mld-empty">Aucun lien.</div>
  }
  return (
    <div className="wac__mld-links-scroll">
      {[...items].reverse().map((m) => (
        <LinkGalleryItem key={m.id} msg={m} />
      ))}
    </div>
  )
}

function LinkGalleryItem({ msg }: { msg: MessageDecrypted }) {
  const urls = useMemo(() => findAllUrls(msg.body ?? ''), [msg.body])
  const fromMeta = previewFromMediaMeta(msg.media_meta)
  const [fetched, setFetched] = useState<OgPreview | null>(null)
  const tried = useRef(false)

  useEffect(() => {
    if (fromMeta || tried.current || !urls[0]) return
    tried.current = true
    void fetchOgPreview(urls[0].url).then(setFetched)
  }, [urls, fromMeta])

  const og = fromMeta ?? fetched
  const firstUrl = urls[0]?.url

  return (
    <div className="wac__mld-link-row">
      {og ? (
        <a
          className="wac__mld-link-card"
          href={og.canonical ?? og.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {og.image && (
            <div className="wac__mld-link-image">
              <img
                src={og.image}
                alt=""
                draggable={false}
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
          )}
          <div className="wac__mld-link-body">
            {og.title && <div className="wac__mld-link-title">{og.title}</div>}
            {og.description && <div className="wac__mld-link-desc">{og.description}</div>}
            <div className="wac__mld-link-domain">{og.domain}</div>
          </div>
        </a>
      ) : null}
      {firstUrl && (
        <a
          className="wac__mld-link-url"
          href={firstUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          {firstUrl}
        </a>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Search-in-conversation pane (right-side panel, opened from the chat header)
// ──────────────────────────────────────────────────────────────────────────────

export interface SearchInChatPaneProps {
  conv: ConversationDecrypted
  messages: MessageDecrypted[]
  onClose: () => void
}

export function SearchInChatPane({ conv, messages: _messages, onClose }: SearchInChatPaneProps) {
  const [q, setQ] = useState('')
  const name = conversationLabel(conv.remote_jid ?? '', conv.peer_display_name, conv.contact_book_name)

  const trimmed = q.trim()

  // Debounce the query: avoid hammering Supabase on every keystroke.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(trimmed), 200)
    return () => clearTimeout(id)
  }, [trimmed])

  // Server-side search across the WHOLE conversation, not just the loaded
  // window. Hits the decrypted view with an ilike() on body — Postgres
  // evaluates the underlying decrypt function row-by-row, which is fine at
  // single-conversation scale (typical message count is in the thousands).
  const searchQ = useQuery({
    queryKey: ['conv-search', conv.id, debounced],
    enabled: !!conv.id && debounced.length > 0,
    queryFn: async () => {
      const escaped = debounced.replace(/[%_]/g, (c) => `\\${c}`)
      const { data } = await supabase
        .schema('whatsapp').from('messages_decrypted')
        .select('id, whatsapp_timestamp, body, kind, direction, sender_jid')
        .eq('conversation_id', conv.id!)
        .ilike('body', `%${escaped}%`)
        .order('whatsapp_timestamp', { ascending: false })
        .limit(200)
      return (data ?? []) as MessageDecrypted[]
    },
    staleTime: 10 * 1000,
  })

  const hits = searchQ.data ?? []

  return (
    <aside className="wac__info wac__info--search">
      <header className="wac__info-head">
        <button className="wac__icon-btn" aria-label="Fermer" onClick={onClose}>
          <IconClose />
        </button>
        <span className="wac__info-head-title">Rechercher des messages</span>
      </header>

      <div className="wac__sip-search">
        <div className="wac__search-pill" style={{ flex: 1 }}>
          <IconSearch className="wac__search-icon" />
          <input
            className="wac__search-input"
            type="text"
            placeholder="Rechercher"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {q && (
            <button
              className="wac__search-clear"
              onClick={() => setQ('')}
              aria-label="Effacer"
            >
              <IconClose size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="wac__sip-body">
        {debounced.length === 0 ? (
          <div className="wac__sip-empty">
            Recherchez des messages avec {name}.
          </div>
        ) : searchQ.isPending || searchQ.isFetching ? (
          <div className="wac__sip-empty">
            Recherche en cours…
          </div>
        ) : hits.length === 0 ? (
          <div className="wac__sip-empty">
            Aucun message ne correspond à « {q} ».
          </div>
        ) : (
          <div className="wac__sip-hits">
            {hits.map((m) => (
              <div key={m.id ?? Math.random()} className="wac__sip-hit" role="button" onClick={() => m.id && scrollToMessage(m.id)}>
                <div className="wac__sip-hit-time">
                  {m.whatsapp_timestamp ? formatBubbleTime(m.whatsapp_timestamp) : ''}
                </div>
                <div className="wac__sip-hit-body">
                  {highlightTerm(m.body ?? '', debounced.toLowerCase())}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function highlightTerm(text: string, needle: string): React.ReactNode {
  if (!needle) return text
  const idx = text.toLowerCase().indexOf(needle)
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="wac__sip-mark">{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  )
}
