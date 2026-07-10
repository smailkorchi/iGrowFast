// Conversations list + search hooks, plus applyBump (the shared list-cache
// patcher the realtime 'bump' event calls).
//
// All queries read from whatsapp.conversations_decrypted (RLS-scoped). Realtime
// live-sync rides the unified wa:biz/wa:user broadcast (see queries/waChannels.ts):
// its 'bump' event calls applyBump here to patch the loaded list caches in place.

import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { markConversationRead, markConversationUnread } from '../conversationsApi'
import type { ConversationDecrypted, ConversationStatus } from '../database.types'

// ─── keys ───────────────────────────────────────────────────────────────────

export const conversationKeys = {
  all:           ['conversations'] as const,
  list:          (instanceId: string, filter: ConversationFilter) =>
                   ['conversations', 'list', instanceId, filter] as const,
  one:           (id: string) => ['conversations', 'one', id] as const,
  search:        (instanceId: string, q: string) =>
                   ['conversations', 'search', instanceId, q] as const,
  assignments:   (id: string) => ['conversations', 'assignments', id] as const,
}

// ─── filter shape ───────────────────────────────────────────────────────────

export type ConversationFilter =
  | 'all'
  | 'unread'
  | 'groups'
  | 'dms'
  | 'assigned_to_me'
  | 'unassigned'
  | 'resolved'
  | 'snoozed'
  | 'archived'

const PAGE_SIZE = 50

// ─── list (infinite scroll) ────────────────────────────────────────────────

export interface ConversationListRow extends ConversationDecrypted {
  assigned_user_ids?: string[]   // populated client-side from assignments cache
  tags?: string[]
}

export function useConversations(instanceId: string | null, filter: ConversationFilter = 'all') {
  return useInfiniteQuery({
    queryKey: conversationKeys.list(instanceId ?? '_', filter),
    enabled:  !!instanceId,
    // Realtime (the wa:biz/wa:user bump broadcast, waChannels.ts) keeps this live,
    // so a focus-refetch of every loaded page on every tab-return is redundant load.
    refetchOnWindowFocus: false,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!instanceId) return { rows: [] as ConversationListRow[], nextOffset: null as number | null }
      let q = supabase
        .schema('whatsapp').from('conversations_decrypted')
        .select('*')
        .eq('instance_id', instanceId)
        // Defensive: never surface WhatsApp pseudo-chats
        .not('remote_jid', 'like', '%@broadcast')
        .not('remote_jid', 'like', '%@newsletter')

      // status / archive filters
      if (filter === 'archived') {
        q = q.eq('is_archived', true)
      } else {
        q = q.eq('is_archived', false)
      }
      if (filter === 'unread') q = q.gt('unread_count', 0)
      if (filter === 'groups') q = q.eq('is_group', true)
      if (filter === 'dms')    q = q.eq('is_group', false)
      if (filter === 'resolved') q = q.eq('status', 'resolved')
      if (filter === 'snoozed')  q = q.eq('status', 'snoozed')
      if (filter !== 'resolved' && filter !== 'snoozed' && filter !== 'archived') {
        // default: hide resolved/snoozed from operational tabs
        q = q.in('status', ['open', 'pending'])
      }

      // IGF FIX 2026-07-08: the assignment filters (assigned_to_me / unassigned)
      // used to fetch the assignment id set to the client and .in()/.not-in() it
      // into this query — which BOTH capped at PGRST 1000 rows (wrong filter) AND
      // put every id in the request URL (nginx 8k limit → the query fails once
      // there are >~200 assignments). Both modes now run the join+filter
      // SERVER-SIDE via admin_list_conversations_by_assignment (offset-paged,
      // same order), so no id list ever crosses the wire.
      if (filter === 'assigned_to_me' || filter === 'unassigned') {
        const from = pageParam as number
        const { data, error } = await supabase.schema('whatsapp').rpc('admin_list_conversations_by_assignment', {
          p_instance_id: instanceId,
          p_mode: filter,
          p_limit: PAGE_SIZE,
          p_offset: from,
        })
        if (error) throw new Error(error.message)
        const rows = (data ?? []) as unknown as ConversationListRow[]
        return { rows, nextOffset: rows.length === PAGE_SIZE ? from + PAGE_SIZE : null }
      }

      const from = pageParam as number
      const to   = from + PAGE_SIZE - 1
      const { data, error } = await q
        .order('is_pinned',      { ascending: false })
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(from, to)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as ConversationListRow[]
      return {
        rows,
        nextOffset: rows.length === PAGE_SIZE ? from + PAGE_SIZE : null,
      }
    },
    getNextPageParam: (last) => last.nextOffset,
  })
}

// ─── single conversation (header info etc.) ────────────────────────────────

export function useConversation(id: string | null) {
  return useQuery<ConversationDecrypted | null>({
    queryKey: conversationKeys.one(id ?? '_'),
    enabled:  !!id,
    queryFn:  async () => {
      if (!id) return null
      const { data, error } = await supabase
        .schema('whatsapp').from('conversations_decrypted')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data
    },
  })
}

// ─── trigram search (debounce upstream — pass empty string to clear) ──────

export interface SearchHit {
  id: string
  instance_id: string
  remote_jid: string
  peer_display_name: string | null
  peer_profile_pic: string | null
  is_group: boolean
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number
  status: ConversationStatus
  match_score: number
}

export function useConversationSearch(instanceId: string | null, query: string) {
  const trimmed = query.trim()
  return useQuery<SearchHit[]>({
    queryKey: conversationKeys.search(instanceId ?? '_', trimmed),
    enabled:  !!instanceId && trimmed.length >= 1,
    queryFn:  async () => {
      const { data, error } = await supabase.schema('whatsapp').rpc('search_conversations', {
        p_instance_id: instanceId!,
        p_query: trimmed,
        p_limit: 30,
      })
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as SearchHit[]
    },
    staleTime: 15_000,
  })
}

// ─── per-instance unread aggregate ────────────────────────────────────────
//
// Returns a Map<instance_id, unread_conversation_COUNT> — the number of
// CONVERSATIONS that still have unread messages, NOT the sum of unread messages.
// A thread with 10 unread messages contributes 1 here (its list-row badge shows
// 10; the switcher/pill show unread-thread counts, like WhatsApp/email).
//
// Server-side aggregate (whatsapp.instances_unread_counts, mig 060): counts over
// the operational-list visibility (view + unread>0 + open/pending + not archived)
// so the pill badge equals the number of rows the "Non lues" filter yields.
// SECURITY INVOKER → RLS scopes per caller (admin=all, agent=assigned). Replaces
// the old client select+sum, which summed messages AND was PostgREST-1000-capped.
// Used by the inbox sidebar switcher + the Non lues pill.

export function useInstancesUnread(instanceIds: string[]) {
  // Stable key so dropping/reordering ids doesn't refire the query.
  const key = [...instanceIds].sort().join(',')
  return useQuery<Map<string, number>>({
    queryKey: ['instances-unread', key],
    enabled: instanceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .schema('whatsapp').rpc('instances_unread_counts', { p_instance_ids: instanceIds })
      if (error) throw new Error(error.message)
      const m = new Map<string, number>()
      for (const row of (data ?? []) as { instance_id: string | null; unread_conversations: number | null }[]) {
        if (!row.instance_id) continue
        m.set(row.instance_id, row.unread_conversations ?? 0)
      }
      return m
    },
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  })
}

// ─── per-instance archived aggregate ───────────────────────────────────────
//
// Map<instance_id, archived_conversation_COUNT> — feeds the "Archivées" filter
// pill badge. Server-side aggregate (whatsapp.instances_archived_counts, mig
// 062): mirrors mig 060 but counts over the ARCHIVED-list visibility (view +
// is_archived=true, NO status narrowing) so the badge equals the number of rows
// the 'archived' filter yields. SECURITY INVOKER → RLS scopes per caller
// (admin=all-of-instance, agent=assigned-only). Never tally client-side rows —
// PostgREST caps reads at 1000 (undercount at scale).

export function useInstancesArchived(instanceIds: string[]) {
  // Stable key so dropping/reordering ids doesn't refire the query.
  const key = [...instanceIds].sort().join(',')
  return useQuery<Map<string, number>>({
    queryKey: ['instances-archived', key],
    enabled: instanceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .schema('whatsapp').rpc('instances_archived_counts', { p_instance_ids: instanceIds })
      if (error) throw new Error(error.message)
      const m = new Map<string, number>()
      for (const row of (data ?? []) as { instance_id: string | null; archived_conversations: number | null }[]) {
        if (!row.instance_id) continue
        m.set(row.instance_id, row.archived_conversations ?? 0)
      }
      return m
    },
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  })
}

// ─── per-instance unread live-sync ─────────────────────────────────────────
// RETIRED at Stage C (2026-07-08). The switcher/navbar unread badge aggregate
// (['instances-unread']) was refreshed by a postgres_changes subscription on
// whatsapp.conversations. That table was dropped from the supabase_realtime
// publication (the ~89% WAL / list_changes choke-point fix), so the badge is now
// driven off the SAME private bump broadcast that drives the list: applyBump
// (called by the unified wa:biz/wa:user channel, waChannels.ts) runs
// scheduleUnreadInvalidate on every bump, and the channel's on-reconnect reconcile
// refetches it. Coverage is equivalent — any unread_count change fires a
// conversation bump — with none of the conversations WAL decode + per-subscriber
// RLS cost.

// ─── mark-read (optimistic) ────────────────────────────────────────────────
// Returns a callback that clears a conversation's unread INSTANTLY across every
// cache it feeds — the per-instance switcher badge (`instances-unread`), the
// chat-list row, and the single-conversation cache — BEFORE the RPC resolves.
// Previously callers fired the raw `markConversationRead` RPC and the switcher
// badge only caught up on the 5s staleTime / window-focus refetch of
// `instances-unread`, so a seen thread's count lingered. We decrement the live
// map immediately, then reconcile from the server once the RPC settles.
type ListInfinite = {
  pages: { rows: ConversationListRow[]; nextOffset: number | null }[]
  pageParams: unknown[]
}
export function useMarkConversationRead() {
  const qc = useQueryClient()
  return useCallback((conversationId: string | null) => {
    if (!conversationId) return

    // Resolve this conversation's current unread + instance from cache so we
    // know how much to subtract from the per-instance total.
    let unread = 0
    let instanceId: string | null = null
    const one = qc.getQueryData<ConversationDecrypted | null>(conversationKeys.one(conversationId))
    if (one) { unread = one.unread_count ?? 0; instanceId = one.instance_id ?? null }
    if (instanceId == null) {
      const lists = qc.getQueriesData<ListInfinite>({ queryKey: ['conversations', 'list'] })
      outer: for (const [, data] of lists) {
        for (const page of data?.pages ?? []) {
          const row = page.rows.find((r) => r.id === conversationId)
          if (row) { unread = row.unread_count ?? 0; instanceId = row.instance_id ?? null; break outer }
        }
      }
    }

    // Optimistic: the map holds a COUNT of unread conversations, so reading a
    // thread that WAS unread removes exactly one from its instance (decrement by
    // 1, never by the message count). Reconciled by the RPC refetch on settle.
    if (instanceId && unread > 0) {
      const inst = instanceId
      qc.setQueriesData<Map<string, number>>({ queryKey: ['instances-unread'] }, (old) => {
        const cur = old?.get(inst) ?? 0
        if (!old || cur === 0) return old
        const next = new Map(old)
        const v = Math.max(0, cur - 1)
        if (v === 0) next.delete(inst); else next.set(inst, v)
        return next
      })
    }

    // Optimistic: zero the row in the chat-list caches.
    qc.setQueriesData<ListInfinite>({ queryKey: ['conversations', 'list'] }, (old) => {
      if (!old?.pages) return old
      let touched = false
      const pages = old.pages.map((p) => {
        const rows = p.rows.map((r) => {
          if (r.id === conversationId && (r.unread_count ?? 0) !== 0) { touched = true; return { ...r, unread_count: 0 } }
          return r
        })
        return touched ? { ...p, rows } : p
      })
      return touched ? { ...old, pages } : old
    })

    // Optimistic: zero the single-conversation cache.
    qc.setQueryData<ConversationDecrypted | null>(conversationKeys.one(conversationId), (old) =>
      old ? { ...old, unread_count: 0 } : old)

    // Fire the RPC; reconcile the per-instance map from the server on settle.
    void markConversationRead(conversationId)
      .catch(() => { /* best-effort */ })
      .finally(() => { void qc.invalidateQueries({ queryKey: ['instances-unread'] }) })
  }, [qc])
}

// ─── mark-unread (optimistic) ──────────────────────────────────────────────
// Exact inverse of useMarkConversationRead, backing the ctx-menu "Marquer
// comme non lu". The server (mark_conversation_unread, mig 063) bumps
// unread_count to greatest(unread_count, 1) — a read thread gets a 1-badge, a
// real backlog is untouched — so the optimistic patches mirror that: only a
// 0→1 transition adds a conversation to the per-instance unread COUNT.
export function useMarkConversationUnread() {
  const qc = useQueryClient()
  return useCallback((conversationId: string | null) => {
    if (!conversationId) return

    // Resolve this conversation's current unread + instance from cache so we
    // know whether the instance total gains a conversation (0→1 only).
    let unread = 0
    let instanceId: string | null = null
    const one = qc.getQueryData<ConversationDecrypted | null>(conversationKeys.one(conversationId))
    if (one) { unread = one.unread_count ?? 0; instanceId = one.instance_id ?? null }
    if (instanceId == null) {
      const lists = qc.getQueriesData<ListInfinite>({ queryKey: ['conversations', 'list'] })
      outer: for (const [, data] of lists) {
        for (const page of data?.pages ?? []) {
          const row = page.rows.find((r) => r.id === conversationId)
          if (row) { unread = row.unread_count ?? 0; instanceId = row.instance_id ?? null; break outer }
        }
      }
    }

    // Optimistic: the map holds a COUNT of unread conversations — flagging an
    // already-unread thread changes nothing; a read one adds exactly one.
    if (instanceId && unread === 0) {
      const inst = instanceId
      qc.setQueriesData<Map<string, number>>({ queryKey: ['instances-unread'] }, (old) => {
        if (!old) return old
        const next = new Map(old)
        next.set(inst, (old.get(inst) ?? 0) + 1)
        return next
      })
    }

    // Optimistic: badge the row in the chat-list caches (greatest(cur, 1)).
    qc.setQueriesData<ListInfinite>({ queryKey: ['conversations', 'list'] }, (old) => {
      if (!old?.pages) return old
      let touched = false
      const pages = old.pages.map((p) => {
        const rows = p.rows.map((r) => {
          if (r.id === conversationId && (r.unread_count ?? 0) === 0) { touched = true; return { ...r, unread_count: 1 } }
          return r
        })
        return touched ? { ...p, rows } : p
      })
      return touched ? { ...old, pages } : old
    })

    // Optimistic: badge the single-conversation cache.
    qc.setQueryData<ConversationDecrypted | null>(conversationKeys.one(conversationId), (old) =>
      old && (old.unread_count ?? 0) === 0 ? { ...old, unread_count: 1 } : old)

    // Fire the RPC; reconcile the per-instance map from the server on settle.
    void markConversationUnread(conversationId)
      .catch(() => { /* best-effort */ })
      .finally(() => { void qc.invalidateQueries({ queryKey: ['instances-unread'] }) })
  }, [qc])
}

// ─── assignments per conversation (admin-only mutates; reads broader) ──────

export interface AssignmentRow {
  conversation_id: string
  user_id: string
  assigned_by: string
  assigned_at: string
  is_group: boolean
}

export function useAssignments(conversationId: string | null) {
  return useQuery<AssignmentRow[]>({
    queryKey: conversationKeys.assignments(conversationId ?? '_'),
    enabled:  !!conversationId,
    queryFn:  async () => {
      if (!conversationId) return []
      const { data, error } = await supabase
        .schema('whatsapp').from('conversation_assignments')
        .select('*')
        .eq('conversation_id', conversationId)
      if (error) throw new Error(error.message)
      return (data ?? []) as AssignmentRow[]
    },
  })
}

// (useTagsFor — the v1 text-tag hook — was removed when conversation_tags
// migrated to tag_id FKs. Use useConversationTags from queries/tags.ts.)

// ─── bump broadcast consumer (applyBump) ────────────────────────────────────
// The DB trigger whatsapp._broadcast_conversation_bump publishes
// to_jsonb(conversations_decrypted) as a 'bump' broadcast on PRIVATE topics
// (mig 046 dual-publishes so admins get wa:biz:<business_id> and each assigned
// agent gets wa:user:<user_id>). The unified channel (queries/waChannels.ts)
// calls applyBump on every 'bump' to patch the loaded list caches IN PLACE (no
// PostgREST refetch) — the point of moving the conversation-bump firehose off
// postgres_changes.
//
// Fail-safe: a membership change or a not-yet-loaded conversation falls back to a
// debounced instance-list refetch (scheduleNewConvAdmit), and the channel's
// on-reconnect reconcile catches anything missed while the socket was down
// (broadcast = at-most-once). The overlay is ABSOLUTE (from the payload) with a
// `touched` guard, so double delivery is idempotent.

// Exact parity with the server ORDER BY (useConversations: is_pinned DESC, then
// last_message_at DESC NULLS LAST). A page is re-sorted after a bump changes
// either key; global cross-page order is left to the invalidate backstop.
function cmpConversationRow(a: ConversationListRow, b: ConversationListRow): number {
  const pa = a.is_pinned ? 1 : 0
  const pb = b.is_pinned ? 1 : 0
  if (pa !== pb) return pb - pa
  const ta = a.last_message_at
  const tb = b.last_message_at
  if (ta == null && tb == null) return 0
  if (ta == null) return 1
  if (tb == null) return -1
  return ta < tb ? 1 : ta > tb ? -1 : 0
}

// Debounced per-instance invalidate for a bump whose conversation is NOT in any
// loaded page (a brand-new conversation): a patch can't place it, so admit it via
// a light refetch. Keyed per instance so bursts coalesce.
const _newConvTimers = new Map<string, ReturnType<typeof setTimeout>>()
function scheduleNewConvAdmit(qc: QueryClient, instanceId: string): void {
  const prev = _newConvTimers.get(instanceId)
  if (prev) clearTimeout(prev)
  _newConvTimers.set(instanceId, setTimeout(() => {
    _newConvTimers.delete(instanceId)
    void qc.invalidateQueries({ queryKey: ['conversations', 'list', instanceId] })
  }, 300))
}

// Per-instance unread badge (['instances-unread']) is a COUNT of unread
// conversations the bump payload's per-conversation unread_count can't maintain by
// itself (a new message on an already-unread thread mustn't change the count), so
// drive it by a debounced INVALIDATE (refetch the aggregate) on any bump — same
// effect the retired useInstancesUnreadRealtime had, now sourced from the bump
// instead of a conversations postgres_changes subscription. One global timer.
let _unreadInvalidateTimer: ReturnType<typeof setTimeout> | null = null
function scheduleUnreadInvalidate(qc: QueryClient): void {
  if (_unreadInvalidateTimer) clearTimeout(_unreadInvalidateTimer)
  _unreadInvalidateTimer = setTimeout(() => {
    _unreadInvalidateTimer = null
    void qc.invalidateQueries({ queryKey: ['instances-unread'] })
  }, 150)
}

// Archived pill badge (['instances-archived']) — same debounced-invalidate
// mechanic as scheduleUnreadInvalidate, but NOT fired on every bump: archived
// counts only move when is_archived flips (or an archived row appears/dies), so
// applyBump fires this only on a flip / unknown row / tombstone, sparing a
// count-RPC refetch per ordinary message.
let _archivedInvalidateTimer: ReturnType<typeof setTimeout> | null = null
function scheduleArchivedInvalidate(qc: QueryClient): void {
  if (_archivedInvalidateTimer) clearTimeout(_archivedInvalidateTimer)
  _archivedInvalidateTimer = setTimeout(() => {
    _archivedInvalidateTimer = null
    void qc.invalidateQueries({ queryKey: ['instances-archived'] })
  }, 150)
}

// Filter-membership signature: the columns that decide which list tab(s) a row
// belongs to (mirrors the useConversations server predicates: is_archived, status
// in open/pending, is_group, unread_count>0). If this differs between the cached
// row and the bump payload, the row may have crossed a filter boundary and needs
// the server predicate (a refetch) rather than an in-place patch.
function membershipSig(r: {
  is_archived?: boolean | null; status?: unknown; is_group?: boolean | null; unread_count?: number | null
}): string {
  return `${r.is_archived ?? false}|${String(r.status ?? '')}|${r.is_group ?? false}|${(r.unread_count ?? 0) > 0}`
}

// Evict a conversation id from every loaded list cache + drop its single-conv
// cache. Used for a delete tombstone (conversations is no longer in the realtime
// publication, so a hard DELETE has no other removal signal).
function removeConversationFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<ListInfinite>({ queryKey: ['conversations', 'list'] }, (old) => {
    if (!old?.pages) return old
    let touched = false
    const pages = old.pages.map((pg) => {
      if (!pg.rows.some((r) => r.id === id)) return pg
      touched = true
      return { ...pg, rows: pg.rows.filter((r) => r.id !== id) }
    })
    return touched ? { ...old, pages } : old
  })
  qc.removeQueries({ queryKey: conversationKeys.one(id) })
}

export function applyBump(qc: QueryClient, rawPayload: unknown): void {
  // Envelope: realtime.send delivers the jsonb directly as `payload`. Tolerate a
  // nested {record} too; no-op if neither carries an id (never throws / breaks).
  const p = rawPayload as { id?: unknown; record?: unknown } | null
  const candidate =
    p && typeof p === 'object' && 'id' in p && p.id
      ? p
      : p && typeof p === 'object' && p.record && typeof p.record === 'object'
        ? (p.record as Record<string, unknown>)
        : null
  const row = candidate as unknown as ConversationListRow | null
  if (!row?.id) return

  // Delete tombstone {id, deleted:true} (whatsapp_037). conversations left the
  // realtime publication, so this is the ONLY removal signal — evict everywhere.
  if ((row as { deleted?: unknown }).deleted === true) {
    removeConversationFromCaches(qc, row.id)
    scheduleUnreadInvalidate(qc)
    scheduleArchivedInvalidate(qc)   // the dropped row may have been archived
    return
  }

  // Pre-scan loaded lists: is this conversation present, is its instance's list
  // loaded, and did its FILTER MEMBERSHIP change vs the cached copy?
  let found = false
  let hasInstanceList = false
  let membershipChanged = false
  let archivedFlipped = false
  const newSig = membershipSig(row)
  const lists = qc.getQueriesData<ListInfinite>({ queryKey: ['conversations', 'list'] })
  for (const [qkey, data] of lists) {
    if (Array.isArray(qkey) && qkey[2] === row.instance_id) hasInstanceList = true
    for (const pg of data?.pages ?? []) {
      const cached = pg.rows.find((r) => r.id === row.id)
      if (cached) {
        found = true
        if (membershipSig(cached) !== newSig) membershipChanged = true
        if ((cached.is_archived ?? false) !== (row.is_archived ?? false)) archivedFlipped = true
      }
    }
  }

  // 1) LIST. A membership change (resolve / archive / snooze / read-flip / group)
  //    or a belongs-but-not-loaded row needs the SERVER predicate to place or drop
  //    it — fall back to a debounced instance-list refetch (exactly what the
  //    retired conversations postgres_changes invalidate did). A same-membership
  //    bump (new message / preview / unread++) is patched IN PLACE (no refetch).
  if ((membershipChanged || !found) && row.instance_id && hasInstanceList) {
    scheduleNewConvAdmit(qc, row.instance_id)
  } else if (found) {
    qc.setQueriesData<ListInfinite>({ queryKey: ['conversations', 'list'] }, (old) => {
      if (!old?.pages) return old
      let touched = false
      const pages = old.pages.map((pg) => {
        let pageTouched = false
        let resort = false
        const rows = pg.rows.map((r) => {
          if (r.id !== row.id) return r
          pageTouched = true
          touched = true
          if ((r.is_pinned ?? false) !== (row.is_pinned ?? false) ||
              (r.last_message_at ?? null) !== (row.last_message_at ?? null)) resort = true
          // spread existing FIRST so client-only assigned_user_ids/tags survive
          return { ...r, ...row }
        })
        if (!pageTouched) return pg
        return { ...pg, rows: resort ? [...rows].sort(cmpConversationRow) : rows }
      })
      return touched ? { ...old, pages } : old
    })
  }

  // 2) Single-conversation cache (open thread header) always reflects freshest row.
  qc.setQueryData<ConversationDecrypted | null>(conversationKeys.one(row.id), (oldOne) =>
    oldOne ? { ...oldOne, ...row } : oldOne)

  // 3) Per-instance unread badge aggregate (debounced refetch).
  scheduleUnreadInvalidate(qc)

  // 4) Archived pill badge — only when the flag flipped on a loaded row, or an
  //    UNLOADED row arrives already-archived (archive-elsewhere / message on an
  //    archived thread). A bare !found is NOT enough: on a multi-instance
  //    business wa:biz delivers bumps for every instance while only the active
  //    one's list is cached, so !found is the COMMON case and would refetch the
  //    archived aggregate at unread-badge cadence. The one miss this accepts —
  //    unarchive-elsewhere with no archived cache loaded — self-heals on the
  //    hook's staleTime; correctness is kept by the tombstone path above.
  if (archivedFlipped || (!found && (row.is_archived ?? false))) scheduleArchivedInvalidate(qc)
}

// ─── flatten infinite query for consumers ──────────────────────────────────
//
// Offset pagination + ORDER BY last_message_at DESC means that during active
// sync (history streaming in, messages arriving live) rows can shift between
// page windows. Without dedup, the same conversation surfaces in page 1 AND
// page 2, the inbox shows it 2-3× with identical row.id, and clicking any
// copy highlights them all (same React key). Dedupe by id here so the
// rendered list is always a set, not a multiset.

export function useFlattenedConversations(instanceId: string | null, filter: ConversationFilter = 'all') {
  const q = useConversations(instanceId, filter)
  const rows = useMemo(
    () => {
      const seen = new Set<string>()
      const out: ConversationListRow[] = []
      for (const page of q.data?.pages ?? []) {
        for (const row of page.rows) {
          if (!row?.id || seen.has(row.id)) continue
          seen.add(row.id)
          out.push(row)
        }
      }
      return out
    },
    [q.data?.pages],
  )
  return { ...q, rows }
}

// ─── cleanup (clear / delete) ──────────────────────────────────────────────
//
// Both modes invoke the `conversation-cleanup` edge function. The function:
//   1. preflights with admin RPC (gathers counts + R2 keys)
//   2. wipes R2 media via batch DeleteObjects
//   3. runs the DB op (clear = wipe messages + reset summary; delete = drop row)
//
// On success the inbox + thread + assignments caches are invalidated so the
// UI reflects the new state without a full reload.

export interface CleanupSummary {
  counts: Record<string, number>
  r2_objects_deleted: number
  r2_errors?: { key: string; code: string }[]
  db_result: unknown
}

export interface CleanupResponse {
  ok: boolean
  mode?: 'clear' | 'delete'
  reason?: string
  error?: string
  summary?: CleanupSummary
}

async function invokeConversationCleanup(
  conversationId: string,
  mode: 'clear' | 'delete',
): Promise<CleanupResponse> {
  const { data, error } = await supabase.functions.invoke<CleanupResponse>(
    'conversation-cleanup',
    { body: { conversation_id: conversationId, mode } },
  )
  if (error) {
    throw new Error(`conversation-cleanup ${mode} failed: ${error.message}`)
  }
  if (!data?.ok) {
    throw new Error(data?.reason || data?.error || `conversation-cleanup ${mode} returned not-ok`)
  }
  return data
}

export function useClearConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (conversationId: string) => invokeConversationCleanup(conversationId, 'clear'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] })
      void qc.invalidateQueries({ queryKey: ['messages'] })
    },
  })
}

export function useDeleteConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (conversationId: string) => invokeConversationCleanup(conversationId, 'delete'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] })
      void qc.invalidateQueries({ queryKey: ['messages'] })
    },
  })
}
