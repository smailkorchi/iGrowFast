// /user/whatsapp
//
// Pixel-replica of /admin/conversations for end-users. The presentation layer
// (parts.tsx, icons.tsx, conversations.css, QuickRepliesPanel, TagsPanel) is
// shared from admin/conversations/ — DO NOT fork it. User-side restrictions
// belong in THIS file (the wrapper), not the shared components.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSidebarCollapse } from '../../components/AppLayout'
import { parseJid, jidUserToLocalPhone } from '../../lib/jid'

// IGF ADDITION (e-commerce seam): chat-header cart → seller create-order
// dialog (mirror of the seller Orders page create flow). Lazy — loaded on
// first cart open, then kept MOUNTED so the draft survives close.
const SellerChatCartOrderDialog = lazy(() =>
  import('@/components/orders/SellerChatCartOrderDialog').then((m) => ({ default: m.SellerChatCartOrderDialog })),
)
import type { SellerCartOrderDraft } from '@/components/orders/SellerChatCartOrderDialog'
// IGF ADDITION (order-history seam): chat-header orders button → the exact
// view modal the seller Orders page shows. Lazy — loaded on first row click.
const SellerOrderViewDialog = lazy(() => import('@/components/orders/SellerOrderViewDialog'))
import { useCurrentUserId } from '@/hooks/useCurrentUserId'
import {
  useFlattenedConversations,
  useConversation,
  useConversationSearch,
  useInstancesArchived,
  useConversationFilterCounts,
  useMarkConversationRead,
  type ConversationFilter,
} from '../../lib/queries/conversations'
import {
  useFlattenedThread,
  useThreadMessages,
  useThreadRealtime,
} from '../../lib/queries/messages'
import { useActiveInstance } from '../../lib/userInbox/activeInstance'
import { useInboxAttendance } from '../../lib/queries/waPresence'
import { activeConversationRef } from '../../lib/messageNotify'
import { toast, normalizeError } from '../../lib/toast/store'
import { getDraft, setDraft, clearDraft } from '../../lib/drafts'
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
} from '../admin/conversations/parts'
import { QuickRepliesPanel } from '../admin/conversations/QuickRepliesPanel'
import { QuickReplyConfirm } from '../admin/conversations/NodeSequenceBuilder'
import { TagsPanel } from '../admin/conversations/TagsPanel'
import { ScheduledMessagesPanel } from '../admin/conversations/ScheduledMessagesPanel'
import { sendMessage, sendReadReceipt, sendStepSequence } from '../../lib/conversationsApi'
import { supabase } from '../../lib/supabase'
import type { QuickReply } from '../../lib/queries/quickReplies'
import { useTags, useAllConversationTags, useConversationTags } from '../../lib/queries/tags'
import { ChatOrdersBridge } from '../../lib/queries/ecomChannels'
import { useEscToCloseConversation } from '../../lib/useEscToClose'
import '../admin/conversations/conversations.css'

// ─── localStorage helpers (per-instance favourites) ─────────────────────────
// Namespaced separately from admin (wam.cv.user.*). Filter "lists" used to live
// here too but were per-browser; they're now DB-level tags (shared across all
// agents) as the chat-list filter mechanism.

function favoritesKey(instanceId: string) { return `wam.cv.user.favs.${instanceId}` }

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

function dataFilter(f: Filter): ConversationFilter {
  switch (f.kind) {
    case 'toutes':   return 'all'
    case 'unread':   return 'unread'
    case 'favoris':  return 'favoris'   // server-side, by id (see useConversations)
    case 'groups':   return 'groups'
    case 'archived': return 'archived'
    // Server-side: the old client-side pass over loaded pages hid tagged
    // conversations the user hadn't scrolled to yet.
    case 'tag':      return `tag:${f.tagId}`
  }
}

export default function UserWhatsapp() {
  const collapseSidebar = useSidebarCollapse()
  useEffect(() => {
    collapseSidebar()
    document.documentElement.dataset['route'] = 'conversations'
    return () => { delete document.documentElement.dataset['route'] }
  }, [])

  // Active-instance selection is shared with the navbar (see UserLayout): the
  // navbar highlights the open number + switches it; this page renders it.
  const { instances, instancesLoading, activeInstanceId, switchInstance: onSwitchInstance, unreadByInstance } = useActiveInstance()
  const activeInstance = useMemo(
    () => instances?.find((i) => i.id === activeInstanceId) ?? null,
    [instances, activeInstanceId],
  )
  // Archived counts are inbox-only (unlike unread, which the navbar also needs
  // via useActiveInstance), so the aggregate is queried here directly.
  const instanceIds = useMemo(() => (instances ?? []).map((i) => i.id), [instances])
  const { data: archivedByInstance } = useInstancesArchived(instanceIds)
  // Groupes + per-tag counts for the filter dropdown badges (server aggregate,
  // mig 066 — not derived from the loaded page window; RLS scopes to assigned).
  const { data: filterCounts } = useConversationFilterCounts(activeInstanceId)

  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites(activeInstanceId))

  useEffect(() => {
    setFavorites(loadFavorites(activeInstanceId))
  }, [activeInstanceId])

  const [filter, setFilter] = useState<Filter>(DEFAULT_FILTER)
  const [query, setQuery] = useState('')
  const [view, setView]   = useState<'list' | 'new-chat' | 'quick-replies' | 'tags' | 'tags-create' | 'scheduled'>('list')
  const [scheduledEditId, setScheduledEditId] = useState<string | null>(null)

  const favoriteIds = useMemo(() => [...favorites], [favorites])
  const convs = useFlattenedConversations(activeInstanceId, dataFilter(filter), favoriteIds)
  // conversations + tags realtime ride the unified wa:user channel
  // (WaUserRealtime, mounted app-wide in SellerLayout) — one channel per agent.
  // Keep the active number ONLINE while this inbox is open+visible so peer
  // typing always arrives. Reverts to ban-safe offline shortly after hide.
  useInboxAttendance(activeInstance?.status === 'connected' ? activeInstanceId : null)

  const { data: tags } = useTags(activeInstanceId)
  const { data: allConvTags } = useAllConversationTags(activeInstanceId)
  // tag/conv_tag realtime: tag library via 60s staleTime; conv_tag via wa:user.

  // Revert to Toutes if the active tag filter's tag is deleted.
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

  const visibleRows = useMemo(() => {
    let rows = convs.rows

    rows = rows.filter((c) => {
      if (c.is_group) return true
      const jid = c.remote_jid ?? ''
      if (jid.endsWith('@s.whatsapp.net')) return true
      return !!c.contact_book_name
    })

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
    } else if (filter.kind === 'unread') {
      // Drop a conversation the instant it's read. mark-read optimistically zeroes
      // unread_count in the list cache, but the server 'unread' query keeps the
      // (now-zeroed) row until it re-prunes, and switching tabs re-serves that
      // cache — so the read thread lingered. Filtering at render clears it
      // immediately and keeps it cleared across tab switches.
      rows = rows.filter((c) => (c.unread_count ?? 0) > 0)
    }
    // Same mechanic for archive: the ctx-menu toggle optimistically flips
    // is_archived in the list caches, so filtering at render moves the row
    // between the operational tabs and "Archivées" instantly, without waiting
    // for the server refetch.
    if (filter.kind === 'archived') {
      rows = rows.filter((c) => !!c.is_archived)
    } else {
      rows = rows.filter((c) => !c.is_archived)
    }
    // Search is server-side now (searchRows below), not a client filter over the
    // loaded pages. The RPC is scope-gated, so an agent's search only ever returns
    // conversations ASSIGNED to them — name, normalised number, or message keyword.
    return rows
  }, [convs.rows, filter, convTagIds, favorites])

  // ─── server-side search (agent-scoped: assigned conversations only) ────────
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const q = query.trim()
    const t = setTimeout(() => setDebouncedQuery(q), 250)
    return () => clearTimeout(t)
  }, [query])
  const isSearching = query.trim().length >= 3
  const search = useConversationSearch(activeInstanceId, debouncedQuery)
  const searchRows = useMemo(
    () => (search.data ?? []) as unknown as typeof visibleRows,
    [search.data],
  )
  const listRows = isSearching ? searchRows : visibleRows
  const listLoading = isSearching
    ? (search.isFetching || debouncedQuery !== query.trim())
    : convs.isLoading

  // "Non lues" pill badge = COUNT of unread conversations on the active instance
  // (server-authoritative, from the instances-unread map), NOT the sum of unread
  // messages over the loaded rows. Equals the number of rows the filter yields.
  const unreadTotal = useMemo(
    () => (activeInstanceId ? unreadByInstance?.get(activeInstanceId) ?? 0 : 0),
    [unreadByInstance, activeInstanceId],
  )

  // "Archivées" pill badge — same server-authoritative shape (mig 062 aggregate,
  // RLS-scoped: a seller counts only conversations assigned to them).
  const archivedTotal = useMemo(
    () => (activeInstanceId ? archivedByInstance?.get(activeInstanceId) ?? 0 : 0),
    [archivedByInstance, activeInstanceId],
  )

  const [activeId, setActiveIdState] = useState<string | null>(null)
  // Synchronous ref write: a bump can land on the websocket BEFORE the
  // [activeId] effect below commits — the thread being opened must already be
  // suppressed by then.
  const setActiveId = useCallback((id: string | null) => {
    activeConversationRef.current = id
    setActiveIdState(id)
  }, [])
  useEffect(() => { setActiveId(null) }, [activeInstanceId, setActiveId])
  const { data: activeConvTags } = useConversationTags(activeId)

  // Toast suppression: the notify engine skips the open conversation while the
  // tab is focused (WhatsApp Web behavior — an unfocused tab still toasts).
  useEffect(() => {
    activeConversationRef.current = activeId
    return () => { activeConversationRef.current = null }
  }, [activeId])

  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    const jid = searchParams.get('jid')
    // Re-arm once the params clear so the NEXT toast click deep-links too.
    if (!jid) { deepLinkHandled.current = false; return }
    if (deepLinkHandled.current) return
    // A deep link may target a conversation on a NON-active number (the
    // dashboard passes &instance=). Switch to that instance first and bail —
    // the effect re-runs once activeInstanceId catches up and convs reloads,
    // so we resolve the jid against the CORRECT instance (not whichever was
    // active). Without this, ensureConversation would open/create the thread
    // on the wrong number.
    const wantInstance = searchParams.get('instance')
    if (wantInstance) {
      if (!instances) return   // wait for the list before deciding anything
      if (!instances.some((i) => i.id === wantInstance)) {
        // The agent lost (or never had) this number — do NOT fall through to
        // resolving the jid against whichever instance happens to be active.
        deepLinkHandled.current = true
        setSearchParams({}, { replace: true })
        toast.error('Ce numéro ne vous est pas assigné.')
        return
      }
      if (wantInstance !== activeInstanceId) {
        onSwitchInstance(wantInstance)
        return
      }
    }
    if (!activeInstanceId || convs.isLoading) return
    deepLinkHandled.current = true
    setSearchParams({}, { replace: true })
    const existing = convs.rows.find((c) => c.remote_jid === jid)
    if (existing?.id) {
      setActiveId(existing.id)
      return
    }
    // A list miss is NOT "not assigned": the row may be archived, resolved,
    // hidden by the active filter or beyond the loaded pages. Resolve directly
    // against the RLS-scoped view (a real non-assignment yields no row), then
    // try the @lid → contact consolidation match (the lid conversation may have
    // been merged into the phone-keyed thread). Only then declare not-assigned.
    // ensure_conversation is admin-only and would throw 'forbidden'.
    const instanceId = activeInstanceId
    void (async () => {
      try {
        const { data: conv } = await supabase
          .schema('whatsapp')
          .from('conversations_decrypted').select('id')
          .eq('instance_id', instanceId).eq('remote_jid', jid)
          .order('created_at', { ascending: false })
          .limit(1).maybeSingle()
        if (conv?.id) { setActiveId(conv.id); return }
        if (jid.endsWith('@lid')) {
          const { data: ct } = await supabase
            .schema('whatsapp')
            .from('contacts').select('id')
            .eq('instance_id', instanceId).eq('lid', jid).maybeSingle()
          const byContact = ct?.id ? convs.rows.find((c) => c.contact_id === ct.id) : null
          if (byContact?.id) { setActiveId(byContact.id); return }
        }
        toast.error('Cette conversation ne vous est pas assignée.')
      } catch { toast.error('Cette conversation ne vous est pas assignée.') }
    })()
  }, [searchParams, instances, activeInstanceId, convs.isLoading, convs.rows, onSwitchInstance, setSearchParams])

  const activeQ = useConversation(activeId)
  const activeConv: ConversationDecrypted | null = activeQ.data ?? null

  const thread = useFlattenedThread(activeId)
  const threadQ = useThreadMessages(activeId)
  useThreadRealtime(activeId)

  // ─── mark-read (agent inbox) ─────────────────────────────────────────────
  // The agent view never cleared unread or sent blue ticks — opening a thread
  // left the count standing (and the customer never saw "seen"). Mirror the
  // admin behavior: clear on open (optimistic via useMarkConversationRead so
  // the navbar/switcher badge drops instantly) + a debounced re-clear when a
  // new inbound lands while the thread is open. Both best-effort.
  const markRead = useMarkConversationRead()
  const markedReadRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeId) return
    if (markedReadRef.current === activeId) return
    markedReadRef.current = activeId
    markRead(activeId)
    void sendReadReceipt(activeId).catch(() => { /* best-effort */ })
  }, [activeId, markRead])

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

  const [rightPane, setRightPane] = useState<'none' | 'info' | 'search'>('none')
  useEffect(() => { setRightPane('none') }, [activeId])

  const [composer, setComposer] = useState<ComposerState>({ text: '', replyTo: null, mentionedJids: [] })
  const [pendingQr, setPendingQr] = useState<QuickReply | null>(null)
  // Switching conversations restores that conversation's unsent draft.
  useEffect(() => { setComposer({ text: activeId ? getDraft(activeId) : '', replyTo: null, mentionedJids: [] }) }, [activeId])
  // Composer changes coming from the pane write through to the draft store;
  // the plain setComposer above stays draft-silent (restore / send reset).
  const setComposerDraft = useCallback((s: ComposerState) => {
    setComposer(s)
    if (activeId) setDraft(activeId, s.text)
  }, [activeId])

  // Esc closes the open conversation → empty state (WhatsApp Web). Only when the
  // chat is the top thing: no side pane, sidebar on the list, no overlay/dialog.
  useEscToCloseConversation({
    active: !!activeConv && view === 'list' && rightPane === 'none',
    replyActive: !!composer.replyTo,
    onCancelReply: () => setComposerDraft({ ...composer, replyTo: null }),
    onClose: () => setActiveId(null),
  })

  function handleSend() {
    if (!activeId) return
    const { text, replyTo, mentionAll } = composer
    if (!text.trim()) return
    setComposer({ text: '', replyTo: null, mentionedJids: [] })
    clearDraft(activeId)

    void (async () => {
      try {
        await sendMessage({
          conversationId: activeId,
          body: text.trim(),
          kind: 'text',
          // send_message takes the quoted row's UUID (p_reply_to uuid →
          // reply_to_message_id FK); the dispatcher resolves the Evolution
          // quoted key itself. Passing evolution_message_id (donor bug,
          // transplanted) 22P02-failed EVERY quoted reply.
          replyTo: replyTo?.id ?? undefined,
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

    // Single text node → prefill composer for inline edit; any multi-node /
    // media sequence dispatches in saved order with canned-origin humanization.
    if (steps.length === 1 && steps[0].type === 'text') {
      const body = steps[0].body
      setComposerDraft({ ...composer, text: body })
      setView('list')
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLTextAreaElement>('.wac__composer-input')
        if (el) { el.focus(); el.setSelectionRange(body.length, body.length) }
      })
      return
    }

    // Multi-node / media sequence: confirm before firing.
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

  // IGF ADDITION (e-commerce seam): cart state — dialog mounts on first open
  // and STAYS mounted. Drafts are PER CONVERSATION: a Map convId → snapshot,
  // written by the dialog's onSnapshot on close; the dot lights only on the
  // conversation the draft belongs to.
  const [cartOpen, setCartOpen] = useState(false)
  const [cartMounted, setCartMounted] = useState(false)
  const cartDraftsRef = useRef(new Map<string, SellerCartOrderDraft>())
  const [cartDraftIds, setCartDraftIds] = useState<ReadonlySet<string>>(new Set())
  const cartConvIdRef = useRef<string | null>(null)
  const cartPrefill = useMemo(() => {
    if (!activeConv) return undefined
    const parsed = parseJid(activeConv.remote_jid ?? '')
    return {
      name: activeConv.contact_book_name ?? activeConv.peer_display_name ?? undefined,
      // Orders store the local "06…" form, not the JID's "212…" digits.
      phone: parsed.kind === 'phone' ? jidUserToLocalPhone(parsed.user) : undefined,
    }
  }, [activeConv])

  // IGF ADDITION (order-history seam): order view dialog state. Mounted on
  // first row click, then kept mounted (open toggles) so Radix keeps its exit
  // animation; orderId persists for the fade-out frame. Rows belonging to
  // OTHER sellers are non-clickable in the dropdown (gated on this user id).
  const currentUserId = useCurrentUserId()
  const [viewOrderId, setViewOrderId] = useState<string | null>(null)
  const [viewOrderOpen, setViewOrderOpen] = useState(false)
  // IGF ADDITION (order-edit seam): the row being edited IN chat. Set from the
  // view dialog's "Modifier" action (own orders only), cleared on close.
  const [editOrder, setEditOrder] = useState<any | null>(null)

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
  // Same gate as admin, but end-users can't manage numbers — switch only.
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
        />
      </div>
    )
  }

  return (
    <div className={'wac' + (activeConv && rightPane !== 'none' ? ' is-with-info' : '')}>
      {/* E-commerce realtime seam (W7): keeps the chat order-history button live
          on order create/change for the business. One private channel. */}
      <ChatOrdersBridge />
      {view === 'list' && (
        <ChatList
          instance={headerInstance}
          rows={listRows}
          activeId={activeId}
          onSelect={(c) => c.id && setActiveId(c.id)}
          query={query}
          onQueryChange={setQuery}
          searching={isSearching}
          filter={filter}
          onFilterChange={setFilter}
          unreadTotal={unreadTotal}
          archivedTotal={archivedTotal}
          tags={(tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color }))}
          onManageTags={() => setView('tags')}
          onNewChat={() => setView('new-chat')}
          loading={listLoading}
          onScrollEnd={() => { if (!isSearching && convs.hasNextPage && !convs.isFetchingNextPage) void convs.fetchNextPage() }}
          tagColorMap={tagColorMap}
          ownerJid={activeInstance?.wa_owner_jid ?? null}
          favCount={favorites.size}
          groupCount={filterCounts?.groups}
          tagCounts={filterCounts?.tags}
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
          setComposer={setComposerDraft}
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
          onNavigateToJid={(jid) => {
            const target = convs.rows.find((c) => c.remote_jid === jid)
            if (target?.id) { setActiveId(target.id); return }
            // Not in the agent's assigned set — ensure_conversation is admin-only.
            // Tell the agent instead of silently doing nothing.
            toast.error('Cette conversation ne vous est pas assignée.')
          }}
          onOpenCart={() => { cartConvIdRef.current = activeId; setCartMounted(true); setCartOpen(true) }}
          cartBadge={!!activeId && cartDraftIds.has(activeId)}
          onViewOrder={(orderId) => { setViewOrderId(orderId); setViewOrderOpen(true) }}
          ordersSellerId={currentUserId}
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
          isAdmin={false}
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
          <SellerChatCartOrderDialog
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
            editOrderId={editOrder?.id ?? null}
            editOrder={editOrder}
            onEditClose={() => setEditOrder(null)}
          />
        </Suspense>
      )}
      {/* IGF ADDITION (order-history seam): self-contained view modal —
          fetches its own order row + enrichment by orderId. */}
      {viewOrderId !== null && (
        // Veil while the lazy chunk downloads on the very first open — a null
        // fallback made the first click read as dead on slow connections.
        <Suspense fallback={<div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(11,20,26,.35)', cursor: 'wait' }} />}>
          <SellerOrderViewDialog
            orderId={viewOrderId}
            open={viewOrderOpen}
            onOpenChange={setViewOrderOpen}
            ownSellerId={currentUserId}
            onEdit={(order) => {
              // SELLER GATE (fail-closed): only ever edit OWN orders, and never
              // while the id is still resolving. RLS already scopes the fetch;
              // this is belt-and-suspenders.
              if (!currentUserId || order?.seller_id !== currentUserId) return
              // Mirror the Orders page guard: paid/unpaid (delivered/closed) orders
              // are locked and cannot be edited (isOrderLocked).
              if (order?.status?.is_paid || order?.status?.is_unpaid) {
                toast.error('Commande verrouillée — livrée et clôturée, modification impossible.')
                return
              }
              setViewOrderOpen(false)
              cartConvIdRef.current = activeId
              setEditOrder(order)
              setCartMounted(true)
              setCartOpen(true)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
