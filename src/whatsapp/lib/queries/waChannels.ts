// Unified WhatsApp realtime channels (enterprise-scale Phase 2b).
//
// ONE wa:biz:<business_id> channel per ADMIN client + ONE wa:user:<user_id>
// channel per AGENT client, each multiplexing EVERY list/config event through
// multiple .on('broadcast') handlers. This REPLACES the former per-hook channels
// (useConversationsBumpRealtime / useConversationsRealtime / useInstancesRealtime /
// useQuickRepliesRealtime / useScheduledMessagesRealtime / useTags* / useAssignments*),
// each of which opened its OWN channel to the same topic — channel proliferation
// that defeated the point of collapsing onto wa:biz. Mounted ONCE at the shell.
//
// Per-thread wa:conv (messages) and presence (wa-typing) stay per-thread — they are
// inherently scoped to the one open conversation, not the whole business.
//
// Event → cache map (all DB triggers land these; see migs 036/040/044/048/049/051/052):
//   bump        → applyBump (patches list caches in place, routes by instance_id)
//   instance    → ['instances'] (+ the changed one)         [wa:biz only]
//   quick_reply → ['quick_replies']                         [wa:biz only]
//   scheduled   → ['scheduled_messages']                    [wa:biz only]
//   assignment  → ['assignments']+['conversations']+['instances']+['instances-unread']
//   conv_tag    → ['conversation_tags']+['conversations','list']
//   tag         → ['tags']                                  [wa:biz only; agents use 60s staleTime]
//
// Broadcast is at-most-once: on reconnect we invalidate every prefix the channel
// feeds so anything missed while the socket was down self-heals.

import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { applyBump } from './conversations'
import { useInstances } from './instances'

// Coalesce bursts (a bulk assign/tag op emits one event per row) into one trailing
// invalidate per key. Per-hook instance so timers don't leak across mounts.
function makeDebouncer() {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  return (qc: QueryClient, key: readonly unknown[], ms = 200) => {
    const k = JSON.stringify(key)
    const prev = timers.get(k)
    if (prev) clearTimeout(prev)
    timers.set(k, setTimeout(() => { timers.delete(k); void qc.invalidateQueries({ queryKey: key }) }, ms))
  }
}

const ADMIN_RECONCILE_KEYS: readonly (readonly unknown[])[] = [
  ['conversations'], ['instances'], ['instances-unread'],
  ['quick_replies'], ['scheduled_messages'], ['tags'], ['conversation_tags'], ['assignments'],
]
const AGENT_RECONCILE_KEYS: readonly (readonly unknown[])[] = [
  ['conversations'], ['instances'], ['instances-unread'], ['conversation_tags'],
]

function reconcile(qc: QueryClient, keys: readonly (readonly unknown[])[]): void {
  for (const key of keys) void qc.invalidateQueries({ queryKey: key })
}

/** Admin: one wa:biz channel carrying every business-scoped event. Mount once. */
export function useWaBizChannel(businessId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!businessId) return
    const inval = makeDebouncer()
    let hadError = false
    const ch = supabase
      .channel(`wa:biz:${businessId}`, { config: { private: true } })
      .on('broadcast', { event: 'bump' }, ({ payload }) => applyBump(qc, payload))
      .on('broadcast', { event: 'instance' }, ({ payload }) => {
        inval(qc, ['instances'])
        const id = (payload as { id?: string })?.id
        if (id) void qc.invalidateQueries({ queryKey: ['instances', 'one', id] })
      })
      .on('broadcast', { event: 'quick_reply' }, () => inval(qc, ['quick_replies']))
      .on('broadcast', { event: 'scheduled' }, () => inval(qc, ['scheduled_messages']))
      .on('broadcast', { event: 'assignment' }, () => {
        inval(qc, ['assignments']); inval(qc, ['conversations'])
        inval(qc, ['instances']); inval(qc, ['instances-unread'])
      })
      .on('broadcast', { event: 'conv_tag' }, () => {
        inval(qc, ['conversation_tags']); inval(qc, ['conversations', 'list'])
      })
      .on('broadcast', { event: 'tag' }, () => inval(qc, ['tags']))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (hadError) { hadError = false; reconcile(qc, ADMIN_RECONCILE_KEYS) }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          hadError = true
          console.warn(`[wa-biz] channel status=${status}`)
        }
      })
    return () => { void supabase.removeChannel(ch) }
  }, [businessId, qc])
}

/**
 * Admin mounter: resolves the business id from the instances cache and opens the
 * single wa:biz channel. Drop <AdminWaRealtime/> into each admin WhatsApp page
 * wrapper (only one admin page is mounted at a time → one channel). Returns null.
 */
export function AdminWaRealtime(): null {
  const { data: instances } = useInstances()
  useWaBizChannel(instances?.[0]?.business_id ?? null)
  return null
}

/** Agent: one wa:user channel. bump + revocation-critical assignment + conv_tag. */
export function useWaUserChannel(userId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!userId) return
    const inval = makeDebouncer()
    let hadError = false
    const ch = supabase
      .channel(`wa:user:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'bump' }, ({ payload }) => applyBump(qc, payload))
      .on('broadcast', { event: 'assignment' }, () => {
        // Revocation-critical: a lost assignment must drop the number + conversation
        // from this agent's inbox (RLS re-scopes on refetch).
        inval(qc, ['instances']); inval(qc, ['conversations']); inval(qc, ['instances-unread'])
      })
      .on('broadcast', { event: 'conv_tag' }, () => {
        inval(qc, ['conversation_tags']); inval(qc, ['conversations', 'list'])
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (hadError) { hadError = false; reconcile(qc, AGENT_RECONCILE_KEYS) }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          hadError = true
          console.warn(`[wa-user] channel status=${status}`)
        }
      })
    return () => { void supabase.removeChannel(ch) }
  }, [userId, qc])
}
