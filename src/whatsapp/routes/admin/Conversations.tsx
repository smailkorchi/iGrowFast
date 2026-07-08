// /admin/conversations
//
// WhatsApp Web pixel-replica in dark/refresh mode. The whole page is rendered
// inside a single rounded container that matches the dashboard sidebar's
// height (calc(100vh - 28px)). Three panes: chat list ← chat pane ← info pane
// (the info pane is toggleable; hidden by default).
//
// Reference: docs/whatsapp-web-style-reference.md (every measurement, color,
// state, and animation in here traces back to a section of that document).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useSidebarCollapse } from '../../components/AppLayout'
import { parseJid } from '../../lib/jid'

// IGF ADDITION (e-commerce seam): chat-header cart → admin create-order
// dialog (mirror of the admin Orders page create flow, incl. exchange split).
// Lazy — loaded on first cart open, then kept MOUNTED so the draft survives.
const AdminChatCartOrderDialog = lazy(() =>
  import('@/components/orders/AdminChatCartOrderDialog').then((m) => ({ default: m.AdminChatCartOrderDialog })),
)
import type { AdminCartOrderDraft } from '@/components/orders/AdminChatCartOrderDialog'
import {
  useFlattenedConversations,
  useConversation,
  useConversationsRealtime,
  useInstancesUnread,
  useInstancesUnreadRealtime,
  useMarkConversationRead,
  type ConversationFilter,
} from '../../lib/queries/conversations'
import {
  useFlattenedThread,
  useThreadMessages,
  useThreadRealtime,
} from '../../lib/queries/messages'
import { useInstances } from '../../lib/queries/instances'
import { useInboxAttendance } from '../../lib/queries/waPresence'
import { toast, normalizeError } from '../../lib/toast/store'
import type { ConversationDecrypted } from '../../lib/database.types'
import type { MessageDecrypted } from '../../lib/database.types'
import {
  ChatList,
  ChatPane,
  ConnectionGate,
  DEFAULT_FILTER,
  EmptyState,
  InfoPane,
  MediaViewer,
  NewChatView,
  SearchInChatPane,
  type ComposerState,
  type Filter,
} from './conversations/parts'
import { QuickRepliesPanel } from './conversations/QuickRepliesPanel'
import { QuickReplyConfirm } from './conversations/NodeSequenceBuilder'
import { TagsPanel } from './conversations/TagsPanel'
import { ScheduledMessagesPanel } from './conversations/ScheduledMessagesPanel'
import { sendMessage, sendReadReceipt, sendStepSequence } from '../../lib/conversationsApi'
import type { QuickReply } from '../../lib/queries/quickReplies'
import { useTags, useAllConversationTags, useConversationTags, useConversationTagsRealtime, useTagsRealtime } from '../../lib/queries/tags'
import './conversations/conversations.css'

// ─── localStorage helpers (per-instance favourites) ─────────────────────────
// NB: filter "lists" used to live here too, but they were per-browser and not
// shared across agents. They've been replaced by DB-level tags (shared, RLS,
// realtime) as the chat-list filter mechanism.

function favoritesKey(instanceId: string) { return `wam.cv.favs.${instanceId}` }

function loadFavorites(instanceId: string | null): Set<string> {
  if (!instanceId) return new Set()
  try {
    const raw = localStorage.getItem(favoritesKey(instanceId))
    return new Set(raw ? JSON.parse(raw) : [])
  } catch { return new Set() }
}
function saveFavorites(instanceId: string, favs: Set<string>) {
  try { localStorage.setItem(favoritesKey(instanceId), JSON.stringify([...favs])) }
  catch { /* quota — ignore */ }
}

// ─── filter → data-layer query filter ───────────────────────────────────────

function dataFilter(f: Filter): ConversationFilter {
  switch (f.kind) {
    case 'toutes':  return 'all'
    case 'unread':  return 'unread'
    case 'favoris': return 'all'   // favoris filtered client-side
    case 'groups':  return 'groups'
    case 'tag':     return 'all'   // tag members filtered client-side
  }
}

export default function AdminConversations() {
  const collapseSidebar = useSidebarCollapse()
  useEffect(() => {
    collapseSidebar()
    document.documentElement.dataset['route'] = 'conversations'
    return () => { delete document.documentElement.dataset['route'] }
  }, [])

  const navigate = useNavigate()

  // ─── instance ──────────────────────────────────────────────────────────────
  const { data: instances, isLoading: instancesLoading } = useInstances()
  // User-picked active instance survives a reload. When the stored id no
  // longer maps to a known instance (deleted, deassigned), fall back to the
  // first connected one, then the first available.
  const ACTIVE_INSTANCE_KEY = 'wam.cv.active_instance'
  const [pickedInstanceId, setPickedInstanceId] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_INSTANCE_KEY) } catch { return null }
  })
  const activeInstanceId = useMemo(() => {
    if (!instances || instances.length === 0) return null
    if (pickedInstanceId && instances.some((i) => i.id === pickedInstanceId)) return pickedInstanceId
    const connected = instances.find((i) => i.status === 'connected')
    return (connected ?? instances[0])?.id ?? null
  }, [instances, pickedInstanceId])
  const activeInstance = useMemo(
    () => instances?.find((i) => i.id === activeInstanceId) ?? null,
    [instances, activeInstanceId],
  )
  const onSwitchInstance = useCallback((id: string) => {
    setPickedInstanceId(id)
    try { localStorage.setItem(ACTIVE_INSTANCE_KEY, id) } catch { /* noop */ }
  }, [])

  const instanceIds = useMemo(() => (instances ?? []).map((i) => i.id), [instances])
  const { data: unreadByInstance } = useInstancesUnread(instanceIds)
  // Live-refresh the per-instance unread badge across ALL numbers (not just the
  // active one) so the switcher badge appears/clears instantly, not on staleTime.
  useInstancesUnreadRealtime(instanceIds)

  // ─── lists + favourites (localStorage) ─────────────────────────────────────
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites(activeInstanceId))

  useEffect(() => {
    setFavorites(loadFavorites(activeInstanceId))
  }, [activeInstanceId])

  // ─── sidebar state ─────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<Filter>(DEFAULT_FILTER)
  const [query, setQuery] = useState('')
  const [view, setView]   = useState<'list' | 'new-chat' | 'quick-replies' | 'tags' | 'tags-create' | 'scheduled'>('list')
  // When the composer '#' picker fires "edit", this targets the panel straight
  // into edit mode for that scheduled message.
  const [scheduledEditId, setScheduledEditId] = useState<string | null>(null)

  const convs = useFlattenedConversations(activeInstanceId, dataFilter(filter))
  useConversationsRealtime(activeInstanceId)
  // Keep the active number ONLINE while this inbox is open+visible so peer
  // typing always arrives (only the connected active instance — never the
  // whole fleet). Reverts to ban-safe offline shortly after the page hides.
  useInboxAttendance(activeInstance?.status === 'connected' ? activeInstanceId : null)

  // ─── tags (DB-level, shared — also power the chat-list filters) ─────────────
  const { data: tags } = useTags(activeInstanceId)
  useTagsRealtime(activeInstanceId)
  const { data: allConvTags } = useAllConversationTags(activeInstanceId)
  useConversationTagsRealtime(activeInstanceId)

  // If the tag a filter points at is deleted, revert to Toutes.
  useEffect(() => {
    if (filter.kind === 'tag' && tags && !tags.some((t) => t.id === filter.tagId)) {
      setFilter(DEFAULT_FILTER)
    }
  }, [filter, tags])

  // conversation_id → Set(tag_id), for the active-tag filter.
  const convTagIds = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const ct of allConvTags ?? []) {
      const s = m.get(ct.conversation_id) ?? new Set<string>()
      s.add(ct.tag_id)
      m.set(ct.conversation_id, s)
    }
    return m
  }, [allConvTags])

  const tagColorMap = useMemo(() => {
    const m = new Map<string, string[]>()
    if (!allConvTags?.length || !tags?.length) return m
    const tagById = new Map(tags.map((t) => [t.id, t]))
    for (const ct of allConvTags) {
      const tag = tagById.get(ct.tag_id)
      if (!tag) continue
      const arr = m.get(ct.conversation_id) ?? []
      arr.push(tag.color)
      m.set(ct.conversation_id, arr)
    }
    return m
  }, [allConvTags, tags])

  // Client-side narrowing: dedup, hide unresolved DMs, list members, favourites, search.
  const visibleRows = useMemo(() => {
    let rows = convs.rows

    // 1. Hide unresolved @lid DMs (no book_name). Phone-JID DMs always visible.
    //    Groups always visible.
    rows = rows.filter((c) => {
      if (c.is_group) return true
      const jid = c.remote_jid ?? ''
      if (jid.endsWith('@s.whatsapp.net')) return true
      return !!c.contact_book_name
    })

    // 2. Deduplicate by contact_id: keep phone-JID conversation, hide @lid sibling
    const contactIdToPhone = new Set<string>()
    for (const c of rows) {
      if (c.contact_id && c.remote_jid && !c.remote_jid.endsWith('@lid')) {
        contactIdToPhone.add(c.contact_id)
      }
    }
    rows = rows.filter((c) => {
      if (!c.contact_id) return true
      const jid = c.remote_jid ?? ''
      if (!jid.endsWith('@lid')) return true
      return !contactIdToPhone.has(c.contact_id)
    })

    if (filter.kind === 'tag') {
      const tagId = filter.tagId
      rows = rows.filter((c) => c.id && convTagIds.get(c.id)?.has(tagId))
    } else if (filter.kind === 'favoris') {
      rows = rows.filter((c) => c.id && favorites.has(c.id))
    }
    const q = query.trim().toLowerCase()
    if (q) {
      rows = rows.filter((c) => {
        const n = (c.contact_book_name ?? c.peer_display_name ?? '').toLowerCase()
        const j = (c.remote_jid ?? '').toLowerCase()
        const p = (c.last_message_preview ?? '').toLowerCase()
        return n.includes(q) || j.includes(q) || p.includes(q)
      })
    }
    return rows
  }, [convs.rows, filter, convTagIds, favorites, query])

  const unreadTotal = useMemo(
    () => convs.rows.reduce((s, r) => s + (r.unread_count ?? 0), 0),
    [convs.rows],
  )

  // ─── active conversation ───────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null)
  useEffect(() => { setActiveId(null) }, [activeInstanceId])
  const { data: activeConvTags } = useConversationTags(activeId)

  // Deep-link: ?jid=...@s.whatsapp.net → open or create that conversation
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    const jid = searchParams.get('jid')
    if (!jid || !activeInstanceId || deepLinkHandled.current) return
    if (convs.isLoading) return
    deepLinkHandled.current = true
    setSearchParams({}, { replace: true })
    const existing = convs.rows.find((c) => c.remote_jid === jid)
    if (existing?.id) {
      setActiveId(existing.id)
    } else {
      void (async () => {
        const { ensureConversation } = await import('../../lib/conversationCreate')
        const id = await ensureConversation({ instanceId: activeInstanceId, remoteJid: jid })
        setActiveId(id)
        void convs.refetch?.()
      })()
    }
  }, [searchParams, activeInstanceId, convs.isLoading, convs.rows])

  const activeQ = useConversation(activeId)
  const activeConv: ConversationDecrypted | null = activeQ.data ?? null

  // IGF ADDITION (e-commerce seam): cart state — dialog mounts on first open
  // and STAYS mounted. Drafts are PER CONVERSATION: a Map convId → snapshot,
  // written by the dialog's onSnapshot on close; the dot lights only on the
  // conversation the draft belongs to.
  const [cartOpen, setCartOpen] = useState(false)
  const [cartMounted, setCartMounted] = useState(false)
  const cartDraftsRef = useRef(new Map<string, AdminCartOrderDraft>())
  const [cartDraftIds, setCartDraftIds] = useState<ReadonlySet<string>>(new Set())
  const cartConvIdRef = useRef<string | null>(null)
  const cartPrefill = useMemo(() => {
    if (!activeConv) return undefined
    const parsed = parseJid(activeConv.remote_jid ?? '')
    return {
      name: activeConv.contact_book_name ?? activeConv.peer_display_name ?? undefined,
      phone: parsed.kind === 'phone' ? parsed.user : undefined,
    }
  }, [activeConv])

  // ─── thread ────────────────────────────────────────────────────────────────
  const thread = useFlattenedThread(activeId)
  const threadQ = useThreadMessages(activeId)
  useThreadRealtime(activeId)

  // ─── mark-read on open ───────────────────────────────────────────────────
  // When a conversation is opened: (1) clear the local unread badge via
  // mark_conversation_read, (2) send a read receipt (blue ticks) to the
  // customer's WhatsApp. Both best-effort. Guarded against re-firing for the
  // same conversation id.
  const markRead = useMarkConversationRead()
  const markedReadRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeId) return
    if (markedReadRef.current === activeId) return
    markedReadRef.current = activeId
    markRead(activeId)
    void sendReadReceipt(activeId).catch(() => { /* best-effort */ })
  }, [activeId])

  // Mark-read while the conversation is OPEN: when a new inbound message
  // arrives (the newest message id changes and it's inbound), clear unread +
  // send a read receipt. Debounced so a burst/stream produces a single
  // receipt, not one per message. The mark_read action is enqueued and
  // serialized per-number on the worker (ban-safe), but bypasses the
  // business-hours/cap gates so "seen" works whenever the agent is viewing.
  const newestSeenRef = useRef<string | null>(null)
  const readDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!activeId) { newestSeenRef.current = null; return }
    const msgs = thread.messages
    if (msgs.length === 0) return
    const newest = msgs[msgs.length - 1]
    if (!newest?.id || newest.id === newestSeenRef.current) return
    newestSeenRef.current = newest.id
    if (newest.direction !== 'inbound') return
    if (readDebounceRef.current) clearTimeout(readDebounceRef.current)
    readDebounceRef.current = setTimeout(() => {
      markRead(activeId)
      void sendReadReceipt(activeId).catch(() => { /* best-effort */ })
    }, 1200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.messages, activeId])

  // ─── right pane toggle (mutually exclusive: info OR search-in-chat) ─────
  const [rightPane, setRightPane] = useState<'none' | 'info' | 'search'>('none')
  useEffect(() => { setRightPane('none') }, [activeId])

  // ─── composer ──────────────────────────────────────────────────────────────
  const [composer, setComposer] = useState<ComposerState>({ text: '', replyTo: null, mentionedJids: [] })
  const [pendingQr, setPendingQr] = useState<QuickReply | null>(null)
  useEffect(() => { setComposer({ text: '', replyTo: null, mentionedJids: [] }) }, [activeId])

  function handleSend() {
    if (!activeId) return
    const { text, replyTo, mentionAll } = composer
    if (!text.trim()) return
    setComposer({ text: '', replyTo: null, mentionedJids: [] })

    void (async () => {
      try {
        await sendMessage({
          conversationId: activeId,
          body: text.trim(),
          kind: 'text',
          replyTo: replyTo?.evolution_message_id ?? undefined,
          ...(mentionAll ? { mediaMeta: { mentionAll: true } } : {}),
        })
      } catch (err) {
        console.error('send failed:', err)
        toast.error(normalizeError(err))
      }
    })()
  }

  function handleSelectQuickReply(qr: QuickReply) {
    const steps = qr.steps ?? []
    if (steps.length === 0) { setView('list'); return }

    // Smart trigger: a single text node prefills the composer for inline edit
    // before sending (legacy behaviour). Any multi-node / media sequence can't
    // be represented in the single composer field, so it dispatches in saved
    // order immediately with canned-origin humanization.
    if (steps.length === 1 && steps[0].type === 'text') {
      const body = steps[0].body
      setComposer({ ...composer, text: body })
      setView('list')
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLTextAreaElement>('.wac__composer-input')
        if (el) { el.focus(); el.setSelectionRange(body.length, body.length) }
      })
      return
    }

    // Multi-node / media sequence: confirm before firing (a stray click would
    // otherwise dispatch the whole sequence).
    setView('list')
    setPendingQr(qr)
  }

  function confirmSendSequence() {
    const qr = pendingQr
    const convId = activeId
    setPendingQr(null)
    if (!qr || !convId) return
    void sendStepSequence(convId, qr.steps).catch((err) => {
      console.error('quick reply sequence send failed:', err)
      toast.error(normalizeError(err))
    })
  }

  // ─── media viewer (shared between ChatPane + InfoPane) ────────────────────
  const [viewerMsg, setViewerMsg] = useState<MessageDecrypted | null>(null)
  useEffect(() => { setViewerMsg(null) }, [activeId])
  const mediaMessages = useMemo(
    () => thread.messages.filter((m) => {
      const k = m.kind ?? 'text'
      if (k === 'image' || k === 'video') return !!m.media_storage_key
      const meta = (m.media_meta ?? {}) as Record<string, unknown>
      if (meta.subtype === 'template' && (meta.hasImage === true || meta.hasImage === 'true') && m.media_storage_key) return true
      return false
    }),
    [thread.messages],
  )
  const openMediaViewer = useCallback((msg: MessageDecrypted) => setViewerMsg(msg), [])

  // ─── render ────────────────────────────────────────────────────────────────
  const headerInstance = activeInstance
    ? {
        id: activeInstance.id,
        display_name: activeInstance.display_name,
        wa_profile_name: activeInstance.wa_profile_name,
        profile_pic_url: activeInstance.profile_pic_url,
        status: activeInstance.status,
      }
    : null

  // ─── connection gate ─────────────────────────────────────────────────────
  // Take over the whole surface when the ACTIVE number isn't connected, so the
  // silence reads as "this WhatsApp link is down" — not "the app is broken".
  // Other connected numbers are offered as one-click switch targets. Gate only
  // once instances have loaded (avoid a flash during the initial fetch).
  const connectionGate: 'none' | 'disconnected' | null =
    instancesLoading || !instances
      ? null
      : instances.length === 0
        ? 'none'
        : activeInstance && activeInstance.status !== 'connected'
          ? 'disconnected'
          : null

  if (connectionGate) {
    const gateInstance = (i: typeof activeInstance) =>
      i ? { id: i.id, display_name: i.display_name, wa_profile_name: i.wa_profile_name, profile_pic_url: i.profile_pic_url, status: i.status, status_detail: i.status_detail } : null
    return (
      <div className="wac wac--gate">
        <ConnectionGate
          kind={connectionGate}
          active={gateInstance(activeInstance)}
          alternatives={(instances ?? [])
            .filter((i) => i.status === 'connected')
            .map((i) => gateInstance(i)!)}
          onSwitchInstance={onSwitchInstance}
          onManageNumbers={() => navigate('/whatsapp/numbers')}
        />
      </div>
    )
  }

  return (
    <div className={'wac' + (activeConv && rightPane !== 'none' ? ' is-with-info' : '')}>
      {view === 'list' && (
        <ChatList
          instance={headerInstance}
          rows={visibleRows}
          activeId={activeId}
          onSelect={(c) => c.id && setActiveId(c.id)}
          query={query}
          onQueryChange={setQuery}
          filter={filter}
          onFilterChange={setFilter}
          unreadTotal={unreadTotal}
          tags={(tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color }))}
          onManageTags={() => setView('tags')}
          onNewChat={() => setView('new-chat')}
          loading={convs.isLoading}
          onScrollEnd={() => { if (convs.hasNextPage && !convs.isFetchingNextPage) void convs.fetchNextPage() }}
          tagColorMap={tagColorMap}
          ownerJid={activeInstance?.wa_owner_jid ?? null}
          favCount={favorites.size}
          availableInstances={(instances ?? []).map((i) => ({
            id: i.id,
            display_name: i.display_name,
            wa_profile_name: i.wa_profile_name,
            profile_pic_url: i.profile_pic_url,
            status: i.status,
          }))}
          onSwitchInstance={onSwitchInstance}
          unreadByInstance={unreadByInstance}
        />
      )}
      {view === 'new-chat' && (
        <NewChatView
          rows={visibleRows}
          instanceId={activeInstanceId}
          ownerJid={activeInstance?.wa_owner_jid ?? null}
          ownerName={activeInstance?.wa_profile_name ?? null}
          ownerPic={activeInstance?.profile_pic_url ?? null}
          onCancel={() => setView('list')}
          onPickConversation={(c) => {
            if (c.id) setActiveId(c.id)
            setView('list')
          }}
          onCreatedConversation={(id) => {
            // Realtime will deliver the new row into useFlattenedConversations
            // and useConversation; setActiveId triggers the lookup either way.
            setActiveId(id)
            setView('list')
            void convs.refetch?.()
          }}
        />
      )}
      {view === 'quick-replies' && (
        <QuickRepliesPanel
          instanceId={activeInstanceId}
          onCancel={() => setView('list')}
          onSelect={handleSelectQuickReply}
        />
      )}
      {(view === 'tags' || view === 'tags-create') && (
        <TagsPanel
          instanceId={activeInstanceId}
          initialSubview={view === 'tags-create' ? 'create' : 'list'}
          onCancel={() => setView('list')}
        />
      )}
      {view === 'scheduled' && (
        <ScheduledMessagesPanel
          instanceId={activeInstanceId}
          conversationId={activeId}
          conversationName={
            activeConv
              ? (activeConv.contact_book_name ?? activeConv.peer_display_name ?? activeConv.remote_jid ?? undefined)
              : undefined
          }
          initialEditId={scheduledEditId}
          onCancel={() => { setScheduledEditId(null); setView('list') }}
        />
      )}

      {activeConv ? (
        <ChatPane
          conv={activeConv}
          messages={thread.messages}
          onOpenInfo={() => setRightPane((p) => p === 'info' ? 'none' : 'info')}
          onOpenSearch={() => setRightPane((p) => p === 'search' ? 'none' : 'search')}
          onLoadOlder={() => { if (threadQ.hasNextPage && !threadQ.isFetchingNextPage) void threadQ.fetchNextPage() }}
          hasMoreOlder={!!threadQ.hasNextPage}
          isFetchingOlder={threadQ.isFetchingNextPage}
          composer={composer}
          setComposer={setComposer}
          onSend={handleSend}
          selfJid={activeInstance?.wa_owner_jid ?? null}
          ownerPic={activeInstance?.profile_pic_url ?? null}
          isFavorite={!!activeConv.id && favorites.has(activeConv.id)}
          onToggleFavorite={() => {
            if (!activeConv.id || !activeInstanceId) return
            const next = new Set(favorites)
            if (next.has(activeConv.id)) next.delete(activeConv.id)
            else next.add(activeConv.id)
            setFavorites(next)
            saveFavorites(activeInstanceId, next)
          }}
          onOpenMedia={openMediaViewer}
          onOpenQuickReplies={() => setView('quick-replies')}
          onOpenTags={() => setView('tags')}
          onOpenTagsCreate={() => setView('tags-create')}
          onOpenScheduled={(editId) => { setScheduledEditId(editId ?? null); setView('scheduled') }}
          onSelectQuickReply={handleSelectQuickReply}
          instanceId={activeInstanceId}
          conversationTagIds={activeConvTags?.map((ct) => ct.tag_id)}
          tags={tags}
          allConversations={visibleRows}
          onNavigateToJid={async (jid, name) => {
            const target = convs.rows.find((c) => c.remote_jid === jid)
            if (target?.id) { setActiveId(target.id); return }
            if (!activeInstanceId) return
            try {
              const { ensureConversation } = await import('../../lib/conversationCreate')
              const id = await ensureConversation({ instanceId: activeInstanceId, remoteJid: jid, peerDisplayName: name })
              setActiveId(id)
              void convs.refetch?.()
            } catch { /* no-op */ }
          }}
          onOpenConversation={(id) => { setActiveId(id); void convs.refetch?.() }}
          onOpenCart={() => { cartConvIdRef.current = activeId; setCartMounted(true); setCartOpen(true) }}
          cartBadge={!!activeId && cartDraftIds.has(activeId)}
        />
      ) : (
        <EmptyState />
      )}

      {activeConv && rightPane === 'info' && (
        <InfoPane
          conv={activeConv}
          messages={thread.messages}
          onClose={() => setRightPane('none')}
          onOpenMedia={openMediaViewer}
          selfJid={activeInstance?.wa_owner_jid ?? null}
          ownerPic={activeInstance?.profile_pic_url ?? null}
          onOpenSearch={() => setRightPane('search')}
          tagColors={activeConvTags?.map((ct) => tags?.find((t) => t.id === ct.tag_id)?.color).filter((c): c is string => !!c)}
          onAfterDelete={() => { setActiveId(null); setRightPane('none') }}
        />
      )}
      {activeConv && rightPane === 'search' && (
        <SearchInChatPane
          conv={activeConv}
          messages={thread.messages}
          onClose={() => setRightPane('none')}
        />
      )}

      {viewerMsg && activeConv && (
        <MediaViewer
          msg={viewerMsg}
          allMedia={mediaMessages}
          conv={activeConv}
          onClose={() => setViewerMsg(null)}
          onNavigate={setViewerMsg}
          onReply={(m) => { setComposer({ ...composer, replyTo: m }) }}
          allConversations={visibleRows}
          instanceId={activeInstanceId}
          selfJid={activeInstance?.wa_owner_jid ?? null}
        />
      )}
      {pendingQr && (
        <QuickReplyConfirm
          steps={pendingQr.steps}
          onConfirm={confirmSendSequence}
          onCancel={() => setPendingQr(null)}
        />
      )}
      {/* IGF ADDITION (e-commerce seam): mounted after first open, never
          unmounted — the dialog's form instance IS the draft. Radix portals it
          to document.body, outside .wa-root, so it renders IGF-native. */}
      {cartMounted && (
        <Suspense fallback={null}>
          <AdminChatCartOrderDialog
            open={cartOpen}
            onOpenChange={setCartOpen}
            draft={cartConvIdRef.current ? cartDraftsRef.current.get(cartConvIdRef.current) ?? null : null}
            onSnapshot={(values) => {
              const cid = cartConvIdRef.current
              if (!cid) return
              if (values) cartDraftsRef.current.set(cid, values)
              else cartDraftsRef.current.delete(cid)
              setCartDraftIds(new Set(cartDraftsRef.current.keys()))
            }}
            prefill={cartPrefill}
          />
        </Suspense>
      )}
    </div>
  )
}

// `favorites` is loaded but the toggle UI isn't wired yet — that ships with
// the conversation context-menu. The setter is intentionally exported via
// effect setup above so future code paths can flip favourites without
// reaching into localStorage directly.
void favoritesKey
void loadFavorites
