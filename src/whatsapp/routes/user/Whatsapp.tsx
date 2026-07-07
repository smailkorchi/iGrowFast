// /user/whatsapp
//
// Pixel-replica of /admin/conversations for end-users. The presentation layer
// (parts.tsx, icons.tsx, conversations.css, QuickRepliesPanel, TagsPanel) is
// shared from admin/conversations/ — DO NOT fork it. User-side restrictions
// belong in THIS file (the wrapper), not the shared components.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSidebarCollapse } from '../../components/AppLayout'
import { parseJid } from '../../lib/jid'

// IGF ADDITION (e-commerce seam): chat-header cart → seller create-order
// dialog (mirror of the seller Orders page create flow). Lazy — loaded on
// first cart open, then kept MOUNTED so the draft survives close.
const SellerChatCartOrderDialog = lazy(() =>
  import('@/components/orders/SellerChatCartOrderDialog').then((m) => ({ default: m.SellerChatCartOrderDialog })),
)
import {
  useFlattenedConversations,
  useConversation,
  useConversationsRealtime,
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
} from '../admin/conversations/parts'
import { QuickRepliesPanel } from '../admin/conversations/QuickRepliesPanel'
import { QuickReplyConfirm } from '../admin/conversations/NodeSequenceBuilder'
import { TagsPanel } from '../admin/conversations/TagsPanel'
import { ScheduledMessagesPanel } from '../admin/conversations/ScheduledMessagesPanel'
import { sendMessage, sendReadReceipt, sendStepSequence } from '../../lib/conversationsApi'
import { supabase } from '../../lib/supabase'
import type { QuickReply } from '../../lib/queries/quickReplies'
import { useTags, useAllConversationTags, useConversationTags, useConversationTagsRealtime, useTagsRealtime } from '../../lib/queries/tags'
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
    case 'toutes':  return 'all'
    case 'unread':  return 'unread'
    case 'favoris': return 'all'
    case 'groups':  return 'groups'
    case 'tag':     return 'all'
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

  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites(activeInstanceId))

  useEffect(() => {
    setFavorites(loadFavorites(activeInstanceId))
  }, [activeInstanceId])

  const [filter, setFilter] = useState<Filter>(DEFAULT_FILTER)
  const [query, setQuery] = useState('')
  const [view, setView]   = useState<'list' | 'new-chat' | 'quick-replies' | 'tags' | 'tags-create' | 'scheduled'>('list')
  const [scheduledEditId, setScheduledEditId] = useState<string | null>(null)

  const convs = useFlattenedConversations(activeInstanceId, dataFilter(filter))
  useConversationsRealtime(activeInstanceId)
  // Keep the active number ONLINE while this inbox is open+visible so peer
  // typing always arrives. Reverts to ban-safe offline shortly after hide.
  useInboxAttendance(activeInstance?.status === 'connected' ? activeInstanceId : null)

  const { data: tags } = useTags(activeInstanceId)
  useTagsRealtime(activeInstanceId)
  const { data: allConvTags } = useAllConversationTags(activeInstanceId)
  useConversationTagsRealtime(activeInstanceId)

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

  const [activeId, setActiveId] = useState<string | null>(null)
  useEffect(() => { setActiveId(null) }, [activeInstanceId])
  const { data: activeConvTags } = useConversationTags(activeId)

  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    const jid = searchParams.get('jid')
    if (!jid || deepLinkHandled.current) return
    // A deep link may target a conversation on a NON-active number (the
    // dashboard passes &instance=). Switch to that instance first and bail —
    // the effect re-runs once activeInstanceId catches up and convs reloads,
    // so we resolve the jid against the CORRECT instance (not whichever was
    // active). Without this, ensureConversation would open/create the thread
    // on the wrong number.
    const wantInstance = searchParams.get('instance')
    if (wantInstance && wantInstance !== activeInstanceId && (instances ?? []).some((i) => i.id === wantInstance)) {
      onSwitchInstance(wantInstance)
      return
    }
    if (!activeInstanceId || convs.isLoading) return
    deepLinkHandled.current = true
    setSearchParams({}, { replace: true })
    const existing = convs.rows.find((c) => c.remote_jid === jid)
    if (existing?.id) {
      setActiveId(existing.id)
      return
    }
    // A @lid deep link may no longer string-match: its conversation was
    // canonicalized/consolidated into the phone-keyed thread. Resolve the lid to
    // its contact (RLS-scoped to the agent's assignments) and match by contact_id.
    if (jid.endsWith('@lid') && activeInstanceId) {
      void (async () => {
        try {
          const { data: ct } = await supabase
            .schema('whatsapp')
            .from('contacts').select('id')
            .eq('instance_id', activeInstanceId).eq('lid', jid).maybeSingle()
          const byContact = ct?.id ? convs.rows.find((c) => c.contact_id === ct.id) : null
          if (byContact?.id) { setActiveId(byContact.id); return }
          toast.error('Cette conversation ne vous est pas assignée.')
        } catch { toast.error('Cette conversation ne vous est pas assignée.') }
      })()
      return
    }
    // Agents can only open conversations assigned to them (convs.rows is
    // RLS-scoped). ensure_conversation is admin-only and would throw
    // 'forbidden'; surface a notice instead of an unhandled rejection.
    toast.error('Cette conversation ne vous est pas assignée.')
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

    // Single text node → prefill composer for inline edit; any multi-node /
    // media sequence dispatches in saved order with canned-origin humanization.
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
  // and STAYS mounted (its form instance is the draft store); dot = onDraftChange.
  const [cartOpen, setCartOpen] = useState(false)
  const [cartMounted, setCartMounted] = useState(false)
  const [cartDraft, setCartDraft] = useState(false)
  const cartPrefill = useMemo(() => {
    if (!activeConv) return undefined
    const parsed = parseJid(activeConv.remote_jid ?? '')
    return {
      name: activeConv.contact_book_name ?? activeConv.peer_display_name ?? undefined,
      phone: parsed.kind === 'phone' ? parsed.user : undefined,
    }
  }, [activeConv])

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
          onNavigateToJid={(jid) => {
            const target = convs.rows.find((c) => c.remote_jid === jid)
            if (target?.id) { setActiveId(target.id); return }
            // Not in the agent's assigned set — ensure_conversation is admin-only.
            // Tell the agent instead of silently doing nothing.
            toast.error('Cette conversation ne vous est pas assignée.')
          }}
          onOpenCart={() => { setCartMounted(true); setCartOpen(true) }}
          cartBadge={cartDraft}
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
            onDraftChange={setCartDraft}
            prefill={cartPrefill}
          />
        </Suspense>
      )}
    </div>
  )
}
