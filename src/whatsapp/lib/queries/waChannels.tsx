// Unified WhatsApp realtime channels (enterprise-scale Phase 2b).
//
// ONE wa:biz:<business_id> channel per ADMIN client + ONE wa:user:<user_id>
// channel per AGENT client, each multiplexing EVERY list/config event through
// multiple .on('broadcast') handlers. This REPLACES the former per-hook channels
// (useConversationsBumpRealtime / useConversationsRealtime / useInstancesRealtime /
// useQuickRepliesRealtime / useScheduledMessagesRealtime / useTags* / useAssignments*),
// each of which opened its OWN channel to the same topic — channel proliferation
// that defeated the point of collapsing onto wa:biz.
//
// MOUNT: <AdminWaRealtime/> mounts ONCE in the admin shell (AppLayout, next to
// OrderStatusNotifications) so the wa:biz channel is PERSISTENT — cache sync +
// inbound-message toasts fire on EVERY admin page, not just the WhatsApp ones
// (this replaced the former per-page-wrapper mounts and their re-subscribe on
// sub-navigation). <WaUserRealtime/> is the agent mirror, mounted ONCE in
// SellerLayout (it replaced the ActiveInstanceProvider mount). Both self-wrap
// in QueryClientProvider(waQueryClient): the layouts sit OUTSIDE WaShell, and
// the channels' cache writes must land in the WA module's own singleton client,
// never IGF's global one.
//
// Per-thread wa:conv (messages) and presence (wa-typing) stay per-thread — they are
// inherently scoped to the one open conversation, not the whole business.
//
// Event → cache map (all DB triggers land these; see migs 036/040/044/048/049/051/052):
//   bump        → applyBump (patches list caches in place, routes by instance_id)
//                 + maybeNotifyFromBump (inbound-message toast, lib/messageNotify.ts)
//   instance    → ['instances'] (+ the changed one)         [wa:biz only]
//   quick_reply → ['quick_replies']                         [wa:biz only]
//   scheduled   → ['scheduled_messages']                    [wa:biz only]
//   assignment  → ['assignments']+['conversations']+['instances']+['instances-unread']+['instances-archived']
//   conv_tag    → ['conversation_tags']+['conversations','list']
//   tag         → ['tags']                                  [wa:biz only; agents use 60s staleTime]
//
// Broadcast is at-most-once: on reconnect we invalidate every prefix the channel
// feeds so anything missed while the socket was down self-heals.

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { QueryClientProvider, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { waQueryClient } from '../queryClient'
import { useAuth } from '../auth'
import { applyBump } from './conversations'
import { maybeNotifyFromBump } from '../messageNotify'
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
  ['conversations'], ['instances'], ['instances-unread'], ['instances-archived'],
  ['quick_replies'], ['scheduled_messages'], ['tags'], ['conversation_tags'], ['assignments'],
  ['wa-filter-counts'],
]
const AGENT_RECONCILE_KEYS: readonly (readonly unknown[])[] = [
  ['conversations'], ['instances'], ['instances-unread'], ['instances-archived'], ['conversation_tags'],
  ['wa-filter-counts'],
]

function reconcile(qc: QueryClient, keys: readonly (readonly unknown[])[]): void {
  for (const key of keys) void qc.invalidateQueries({ queryKey: key })
}

/** Admin: one wa:biz channel carrying every business-scoped event. Mount once. */
export function useWaBizChannel(businessId: string | null) {
  const qc = useQueryClient()
  // navigate identity churns per location — keep it in a ref so the channel
  // effect never re-subscribes because of it.
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  useEffect(() => {
    if (!businessId) return
    const inval = makeDebouncer()
    let hadError = false
    const ch = supabase
      .channel(`wa:biz:${businessId}`, { config: { private: true } })
      .on('broadcast', { event: 'bump' }, ({ payload }) => {
        // Notify FIRST: its untracked-conversation baseline reads the PRE-bump
        // cached row; applyBump would overwrite it with the new value.
        maybeNotifyFromBump(qc, payload, { role: 'admin', navigate: (url) => navigateRef.current(url) })
        applyBump(qc, payload)
        // Keep the Assignment console's server-side counts + list live when a
        // new inbound conversation arrives. Debounced + active-observer-only:
        // a no-op cost unless an admin is actually on /admin/assignment.
        inval(qc, ['assignments', 'summary'])
        inval(qc, ['assignments', 'page'])
        // Filter-dropdown counts (Groupes/tag) move on archive/status/new-conv —
        // longer debounce so a message burst doesn't refetch the aggregate.
        inval(qc, ['wa-filter-counts'], 1500)
      })
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
        inval(qc, ['instances-archived']); inval(qc, ['wa-filter-counts'])
      })
      .on('broadcast', { event: 'conv_tag' }, () => {
        inval(qc, ['conversation_tags']); inval(qc, ['conversations', 'list'])
        inval(qc, ['wa-filter-counts'])
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
 * single wa:biz channel. Mount ONCE in AppLayout — self-wraps in the WA module's
 * QueryClientProvider because the layout sits outside WaShell. No-ops (no
 * channel) when the business has no instances (business_id resolves null).
 */
export function AdminWaRealtime() {
  return (
    <QueryClientProvider client={waQueryClient}>
      <AdminWaRealtimeInner />
    </QueryClientProvider>
  )
}

function AdminWaRealtimeInner(): null {
  const { data: instances } = useInstances()
  useWaBizChannel(instances?.[0]?.business_id ?? null)
  return null
}

/** Agent: one wa:user channel. bump + revocation-critical assignment + conv_tag. */
export function useWaUserChannel(userId: string | null) {
  const qc = useQueryClient()
  // Same ref mechanic as useWaBizChannel: navigate must not re-subscribe.
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  useEffect(() => {
    if (!userId) return
    const inval = makeDebouncer()
    let hadError = false
    const ch = supabase
      .channel(`wa:user:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'bump' }, ({ payload }) => {
        // Same ordering contract as useWaBizChannel: notify before applyBump.
        maybeNotifyFromBump(qc, payload, { role: 'agent', navigate: (url) => navigateRef.current(url) })
        applyBump(qc, payload)
        inval(qc, ['wa-filter-counts'], 1500)
      })
      .on('broadcast', { event: 'assignment' }, () => {
        // Revocation-critical: a lost assignment must drop the number + conversation
        // from this agent's inbox (RLS re-scopes on refetch).
        inval(qc, ['instances']); inval(qc, ['conversations']); inval(qc, ['instances-unread'])
        inval(qc, ['instances-archived']); inval(qc, ['wa-filter-counts'])
      })
      .on('broadcast', { event: 'conv_tag' }, () => {
        inval(qc, ['conversation_tags']); inval(qc, ['conversations', 'list'])
        inval(qc, ['wa-filter-counts'])
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

/**
 * Agent mounter (AdminWaRealtime mirror): resolves the auth user id and opens
 * the single wa:user channel. Mount ONCE in SellerLayout — self-wraps in the WA
 * module's QueryClientProvider (waQueryClient is a singleton, so bumps land in
 * the exact cache the inbox reads). Cheap for unassigned sellers: topic authz
 * is a pure claim compare and the triggers only send to assignees.
 */
export function WaUserRealtime() {
  return (
    <QueryClientProvider client={waQueryClient}>
      <WaUserRealtimeInner />
    </QueryClientProvider>
  )
}

function WaUserRealtimeInner(): null {
  const { session } = useAuth()
  // Keep the (RLS-scoped) instances cache warm app-wide: the toast resolves the
  // instance name + profile picture from it, and without a subscriber the 5min
  // gcTime drops it as soon as the seller leaves the inbox.
  useInstances({ warm: true })
  useWaUserChannel(session?.user.id ?? null)
  return null
}
