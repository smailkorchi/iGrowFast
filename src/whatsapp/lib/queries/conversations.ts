// Conversations list + search + realtime live-sync hooks.
//
// All queries read from public.conversations_decrypted (RLS-scoped). Live-sync
// subscribes to conversations + conversation_assignments + conversation_tags
// + messages INSERT (latter only to refresh ordering when a new inbound lands).

import { useCallback, useEffect, useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { markConversationRead } from '../conversationsApi'
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
    // Realtime (useConversationsRealtime) keeps this live, so a focus-refetch of
    // every loaded page on every tab-return is pure redundant load at scale.
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
// Returns a Map<instance_id, total_unread> built by summing unread_count
// across all conversations the caller can see. RLS scopes naturally:
//   - admin → sees every conversation in every instance
//   - agent → sees only conversations they're assigned to
// Used by the inbox sidebar switcher to surface unread on inactive instances.

export function useInstancesUnread(instanceIds: string[]) {
  // Stable key so dropping/reordering ids doesn't refire the query.
  const key = [...instanceIds].sort().join(',')
  return useQuery<Map<string, number>>({
    queryKey: ['instances-unread', key],
    enabled: instanceIds.length > 0,
    queryFn: async () => {
      // Read the VIEW (not the raw table) so hidden conversations — merged
      // tombstones AND unresolved @lid threads — don't inflate the navbar/
      // switcher badge. The badge then matches exactly what's visible.
      const { data, error } = await supabase
        .schema('whatsapp').from('conversations_decrypted')
        .select('instance_id, unread_count')
        .in('instance_id', instanceIds)
        .gt('unread_count', 0)
      if (error) throw new Error(error.message)
      const m = new Map<string, number>()
      for (const row of data ?? []) {
        if (!row.instance_id) continue   // view columns are nullable-typed
        const prev = m.get(row.instance_id) ?? 0
        m.set(row.instance_id, prev + (row.unread_count ?? 0))
      }
      return m
    },
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  })
}

// ─── per-instance unread live-sync ─────────────────────────────────────────
// The switcher/navbar unread badge is an aggregate (`instances-unread`) summed
// across ALL the caller's instances — but `useConversationsRealtime` only
// subscribes to the ACTIVE instance, so unread changes on OTHER numbers used to
// surface only on the 5s staleTime / window-focus refetch (the lag). This hook
// subscribes to EVERY conversations row the caller can see (RLS-scoped: admins
// = all, agents = assigned) and refreshes the unread map the moment any
// unread_count changes — badge appears/clears in realtime. Debounced so a burst
// of inbound messages coalesces into one refetch.
export function useInstancesUnreadRealtime(instanceIds: string[]) {
  const qc = useQueryClient()
  // Stable key so re-renders with the same instance set don't re-subscribe.
  const key = [...instanceIds].sort().join(',')
  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (ids.length === 0) return
    let t: ReturnType<typeof setTimeout> | null = null
    const bump = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => { void qc.invalidateQueries({ queryKey: ['instances-unread'] }) }, 150)
    }
    // ENTERPRISE AUDIT: was ONE unfiltered subscription to conversations, so
    // Realtime RLS-checked EVERY conversations change (all tenants) against this
    // subscriber for a badge count — O(all subscribers) per event at scale. Now
    // one server-side-filtered binding per the caller's OWN instances: a change
    // to another tenant's conversation never matches, so it never fires here and
    // never costs an RLS eval for this session.
    let channel = supabase.channel('instances-unread-rt')
    for (const id of ids) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'conversations', filter: `instance_id=eq.${id}` },
        bump,
      )
    }
    channel.subscribe()
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(channel) }
  }, [qc, key])
}

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

    // Optimistic: subtract from the per-instance unread map (powers the switcher badge).
    if (instanceId && unread > 0) {
      const inst = instanceId
      const amt = unread
      qc.setQueriesData<Map<string, number>>({ queryKey: ['instances-unread'] }, (old) => {
        const cur = old?.get(inst) ?? 0
        if (!old || cur === 0) return old
        const next = new Map(old)
        const v = Math.max(0, cur - amt)
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

// ─── realtime live-sync ────────────────────────────────────────────────────
// One channel per instance; invalidates the relevant TanStack caches on every
// conversations/messages/assignments/tags/notes change.

export function useConversationsRealtime(instanceId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!instanceId) return
    // Assignment changes can REVOKE access for a non-admin agent: an agent sees
    // an instance (wi_select) and its conversations (RLS) ONLY while assigned,
    // so losing their last assignment must drop the instance from useInstances()
    // and flip the inbox to the empty state — live. Realtime delivers the agent
    // their OWN assignment DELETE (replica identity = PK incl. user_id; ca_select
    // keys on user_id=auth.uid()), so we invalidate BOTH ['conversations'] and
    // ['instances'] here. Debounced so a bulk (un)assign's per-row event burst
    // coalesces into a single refetch instead of one per row.
    // DEBOUNCE + NARROW (enterprise-audit Stage 0). The two hottest handlers
    // (conversations UPDATE + messages INSERT) fire on essentially every message.
    // Undebounced they refetched the WHOLE ['conversations'] tree — every loaded
    // infinite page AND the expensive single-conv header (#3 statement) — per
    // event. Now they coalesce into ONE trailing refetch of the LIST only
    // (['conversations','list',instanceId] — all filters, NOT the ['one',id]
    // header, which has its own thread realtime). A tenant receiving 10 msg/s
    // dropped from ~60-70 req/s per admin to ~4.
    let listT: ReturnType<typeof setTimeout> | null = null
    const bumpList = () => {
      if (listT) clearTimeout(listT)
      listT = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['conversations', 'list', instanceId] })
      }, 250)
    }
    // Assignment changes also touch instance visibility for agents (revocation →
    // empty state); keep the debounced ['instances'] invalidate here.
    let asgT: ReturnType<typeof setTimeout> | null = null
    const onAssignmentChange = () => {
      if (asgT) clearTimeout(asgT)
      asgT = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['conversations', 'list', instanceId] })
        void qc.invalidateQueries({ queryKey: ['instances'] })
      }, 250)
    }
    const channel = supabase
      .channel(`conv-page-${instanceId}`)
      // conversations UPDATE covers unread_count / last_message_at bumps; the
      // per-instance unread badge is refreshed by the dedicated (debounced)
      // useInstancesUnreadRealtime — no redundant ['instances-unread'] invalidate.
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'conversations', filter: `instance_id=eq.${instanceId}` },
        bumpList,
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'whatsapp', table: 'messages', filter: `instance_id=eq.${instanceId}` },
        bumpList,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'conversation_assignments' },
        onAssignmentChange,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'conversation_tags' },
        bumpList,
      )
      .subscribe()
    return () => { if (listT) clearTimeout(listT); if (asgT) clearTimeout(asgT); void supabase.removeChannel(channel) }
  }, [instanceId, qc])
}

// ─── bump broadcast consumer (Stage-2 list-bump cutover) ────────────────────
// The DB trigger whatsapp._broadcast_conversation_bump (migration 036) publishes
// to_jsonb(conversations_decrypted) as a 'bump' broadcast on PRIVATE topics:
//   wa:inst:<instance_id>  → business-admins of that instance
//   wa:user:<user_id>      → each assigned agent
// This consumer patches the loaded list caches IN PLACE (no PostgREST refetch) —
// the point of moving the conversation-bump firehose off postgres_changes.
//
// ADDITIVE + fail-safe: it runs ALONGSIDE useConversationsRealtime's 250ms
// invalidate, which stays the reconciler / global-order + membership + new-conv
// backstop. So an out-of-order edge, a membership change, or even a wrong-shaped
// payload can never break the list — the invalidate refetch converges to truth
// within 250ms. The overlay is ABSOLUTE (from the payload) with a `touched`
// guard, so double delivery is idempotent. The retained invalidate is removed
// only at the gated Stage C, once this path is verified live.

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

function applyBump(qc: QueryClient, rawPayload: unknown): void {
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

  // Pre-scan loaded lists: is this conversation already present, and is its
  // instance's list loaded at all?
  let found = false
  let hasInstanceList = false
  const lists = qc.getQueriesData<ListInfinite>({ queryKey: ['conversations', 'list'] })
  for (const [qkey, data] of lists) {
    if (Array.isArray(qkey) && qkey[2] === row.instance_id) hasInstanceList = true
    for (const pg of data?.pages ?? []) {
      if (pg.rows.some((r) => r.id === row.id)) found = true
    }
  }

  // 1) Patch every loaded LIST cache (all instance/filter variants).
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

  // 2) Patch the single-conversation cache IF it exists (open thread header).
  qc.setQueryData<ConversationDecrypted | null>(conversationKeys.one(row.id), (oldOne) =>
    oldOne ? { ...oldOne, ...row } : oldOne)

  // 3) Brand-new conversation not yet in cache → debounced admit (only if that
  //    instance's list is loaded). Membership/order handled by the refetch.
  if (!found && row.instance_id && hasInstanceList) scheduleNewConvAdmit(qc, row.instance_id)
}

// Subscribe to private bump broadcasts and patch the list caches in place.
// Topic-agnostic: the admin shell passes wa:inst:<id> per in-scope instance; the
// agent shell passes [wa:user:<uid>]. One private channel per topic.
export function useConversationsBumpRealtime(topics: string[]) {
  const qc = useQueryClient()
  // Stable key: element order irrelevant → the same set doesn't re-subscribe.
  const key = [...topics].sort().join('|')
  useEffect(() => {
    const list = key ? key.split('|') : []
    if (list.length === 0) return
    const channels = list.map((topic) =>
      supabase
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: 'bump' }, ({ payload }) => applyBump(qc, payload))
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Private-channel authorization failed or the socket dropped. The
            // retained postgres_changes invalidate keeps the list correct; log
            // for diagnostics (Realtime fails closed, never silently opens).
            console.warn(`[wa-bump] channel ${topic} status=${status}`)
          }
        }),
    )
    return () => { channels.forEach((ch) => { void supabase.removeChannel(ch) }) }
  }, [qc, key])
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
