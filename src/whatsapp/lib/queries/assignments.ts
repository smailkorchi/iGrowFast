// Assignment hooks: queries + mutations + realtime live-sync.
//
// All caches are scoped per-instance because assignments are admin-only and
// admin views one instance at a time. Realtime subscribes to
// conversation_assignments (INSERT/DELETE) and whatsapp_instances (auto-assign
// config edits) so a change in any session reflects everywhere.

import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  applyAutoAssignBacklog,
  bulkAssignConversations,
  bulkUnassignConversations,
  listInstanceAssignments,
  listUnassignedConversations,
  setAutoAssign,
  setConversationAssignees,
  unassignConversationUser,
  type AssignmentRow,
  type AutoAssignConfig,
  type UnassignedConversation,
} from '../assignmentApi'
import { supabase } from '../supabase'
import { businessIdOf } from './quickReplies'

export const assignmentKeys = {
  all:           ['assignments'] as const,
  unassigned:    (instanceId: string) => ['assignments', 'unassigned', instanceId] as const,
  byInstance:    (instanceId: string) => ['assignments', 'by-instance', instanceId] as const,
  byConversation:(conversationId: string) => ['assignments', 'by-conv', conversationId] as const,
}

// ─── queries ────────────────────────────────────────────────────────────────

export function useUnassignedConversations(instanceId: string | null) {
  return useQuery<UnassignedConversation[]>({
    queryKey: assignmentKeys.unassigned(instanceId ?? '_'),
    enabled:  !!instanceId,
    queryFn:  () => (instanceId ? listUnassignedConversations(instanceId) : Promise.resolve([])),
  })
}

/**
 * Per-conversation assignees. Used by the chat info pane to surface who is
 * currently handling a conversation/group. Returns ordered by assigned_at so
 * the first-assigned shows first.
 */
export function useConversationAssignees(conversationId: string | null) {
  return useQuery<{ user_id: string; assigned_at: string }[]>({
    queryKey: assignmentKeys.byConversation(conversationId ?? '_'),
    enabled:  !!conversationId,
    queryFn:  async () => {
      const { data, error } = await supabase
        .schema('whatsapp').from('conversation_assignments')
        .select('user_id, assigned_at')
        .eq('conversation_id', conversationId!)
        .order('assigned_at', { ascending: true })
      if (error) throw new Error(error.message)
      return data ?? []
    },
    staleTime: 30_000,
  })
}

/**
 * Live-sync assignees for one conversation. Lighter than the instance-wide
 * realtime sub used on the Assignment page — only subscribes to changes for
 * the conversation currently in the info pane.
 */
export function useConversationAssigneesRealtime(conversationId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`conv-assignees-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'whatsapp',
          table:  'conversation_assignments',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: assignmentKeys.byConversation(conversationId) })
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [conversationId, qc])
}

export function useInstanceAssignments(instanceId: string | null) {
  return useQuery<AssignmentRow[]>({
    queryKey: assignmentKeys.byInstance(instanceId ?? '_'),
    enabled:  !!instanceId,
    queryFn:  () => (instanceId ? listInstanceAssignments(instanceId) : Promise.resolve([])),
  })
}

/**
 * Per-user open conversation count derived from the assignments cache.
 * "Open" = the assignment exists; status filtering happens at query time.
 * For the agent roster we just count assignments — admin can see breakdown
 * by clicking through.
 */
export function useAssignmentCountsByUser(instanceId: string | null) {
  const q = useInstanceAssignments(instanceId)
  const counts = useMemo(() => {
    const m = new Map<string, { dm: number; group: number; total: number }>()
    for (const r of q.data ?? []) {
      const prev = m.get(r.user_id) ?? { dm: 0, group: 0, total: 0 }
      if (r.is_group) prev.group += 1
      else            prev.dm    += 1
      prev.total += 1
      m.set(r.user_id, prev)
    }
    return m
  }, [q.data])
  return { ...q, counts }
}

// ─── mutations ──────────────────────────────────────────────────────────────
//
// OPTIMISTIC-UPDATE CONTRACT (IGF, assignment-audit fix 2026-07-08).
// The Assignment page renders every pill/chip/count PURELY from the byInstance
// assignments cache, so before this change the screen could not change until a
// full invalidate→refetch cycle completed (multi-second at prod scale, and on
// the inbox filters too). Each mutation now accepts an OPTIONAL `instanceId`:
//   - present (Assignment page) → patch assignmentKeys.byInstance(instanceId)
//     synchronously in onMutate (instant UI), roll back onError, and reconcile
//     with ONE background refetch (the 024 RPC). It does NOT invalidate the
//     ['conversations'] tree — assignments never change conversation rows, and
//     the Assignment list doesn't filter by assignment.
//   - absent (inbox InfoPane) → unchanged donor behavior: invalidate assignment
//     caches + ['conversations'] so the inbox unassigned/assigned filters move.
// `assigned_by`/`assigned_at` in an optimistically-added row are placeholders;
// nothing renders them, and the refetch overwrites them with the true values.

const PLACEHOLDER = '00000000-0000-0000-0000-000000000000'

/** Patch the byInstance cache in place; returns a rollback snapshot. */
function patchByInstance(
  qc: ReturnType<typeof useQueryClient>,
  instanceId: string,
  mutate: (rows: AssignmentRow[]) => AssignmentRow[],
): { key: readonly unknown[]; prev: AssignmentRow[] | undefined } {
  const key = assignmentKeys.byInstance(instanceId)
  const prev = qc.getQueryData<AssignmentRow[]>(key)
  qc.setQueryData<AssignmentRow[]>(key, (old) => mutate(old ?? []))
  return { key, prev }
}

/** Common onError/onSettled wiring for an optionally-optimistic mutation. */
function optimisticHandlers(qc: ReturnType<typeof useQueryClient>) {
  return {
    onError: (_e: unknown, _v: unknown, ctx: { key: readonly unknown[]; prev: AssignmentRow[] | undefined } | undefined) => {
      if (ctx?.prev !== undefined) qc.setQueryData(ctx.key, ctx.prev)
    },
    onSettled: (_d: unknown, _e: unknown, vars: { instanceId?: string }) => {
      if (vars.instanceId) {
        // Reconcile the patched cache from the server; realtime debounce covers
        // cross-session. Do NOT touch ['conversations'] here.
        void qc.invalidateQueries({ queryKey: assignmentKeys.byInstance(vars.instanceId) })
      } else {
        void qc.invalidateQueries({ queryKey: assignmentKeys.all })
        void qc.invalidateQueries({ queryKey: ['conversations'] })
      }
    },
  }
}

export function useSetConversationAssignees() {
  const qc = useQueryClient()
  const h = optimisticHandlers(qc)
  return useMutation({
    mutationFn: ({ conversationId, userIds }: { conversationId: string; userIds: string[]; instanceId?: string; isGroup?: boolean }) =>
      setConversationAssignees(conversationId, userIds),
    onMutate: ({ conversationId, userIds, instanceId, isGroup }) => {
      if (!instanceId) return undefined
      // Replace this conversation's assignees with the new set.
      return patchByInstance(qc, instanceId, (rows) => [
        ...rows.filter((r) => r.conversation_id !== conversationId),
        ...userIds.map((uid) => ({
          conversation_id: conversationId, user_id: uid,
          assigned_by: PLACEHOLDER, assigned_at: new Date().toISOString(), is_group: !!isGroup,
        })),
      ])
    },
    ...h,
  })
}

export function useUnassignConversationUser() {
  const qc = useQueryClient()
  const h = optimisticHandlers(qc)
  return useMutation({
    mutationFn: ({ conversationId, userId }: { conversationId: string; userId: string; instanceId?: string }) =>
      unassignConversationUser(conversationId, userId),
    onMutate: ({ conversationId, userId, instanceId }) => {
      if (!instanceId) return undefined
      return patchByInstance(qc, instanceId, (rows) =>
        rows.filter((r) => !(r.conversation_id === conversationId && r.user_id === userId)))
    },
    ...h,
  })
}

export function useBulkAssign() {
  const qc = useQueryClient()
  const h = optimisticHandlers(qc)
  return useMutation({
    mutationFn: ({ userId, conversationIds }: { userId: string; conversationIds: string[]; instanceId?: string; isGroup?: boolean }) =>
      bulkAssignConversations(userId, conversationIds),
    onMutate: ({ userId, conversationIds, instanceId, isGroup }) => {
      if (!instanceId) return undefined
      const set = new Set(conversationIds)
      // ON CONFLICT DO NOTHING: add userId only where absent (matches server).
      return patchByInstance(qc, instanceId, (rows) => {
        const has = new Set(rows.filter((r) => r.user_id === userId).map((r) => r.conversation_id))
        const additions = conversationIds
          .filter((cid) => !has.has(cid))
          .map((cid) => ({
            conversation_id: cid, user_id: userId,
            assigned_by: PLACEHOLDER, assigned_at: new Date().toISOString(), is_group: isGroup ?? true,
          }))
        void set
        return [...rows, ...additions]
      })
    },
    ...h,
  })
}

export function useBulkUnassign() {
  const qc = useQueryClient()
  const h = optimisticHandlers(qc)
  return useMutation({
    mutationFn: ({ userId, conversationIds }: { userId: string; conversationIds: string[]; instanceId?: string }) =>
      bulkUnassignConversations(userId, conversationIds),
    onMutate: ({ userId, conversationIds, instanceId }) => {
      if (!instanceId) return undefined
      const set = new Set(conversationIds)
      return patchByInstance(qc, instanceId, (rows) =>
        rows.filter((r) => !(r.user_id === userId && set.has(r.conversation_id))))
    },
    ...h,
  })
}

export function useApplyAutoAssignBacklog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (instanceId: string) => applyAutoAssignBacklog(instanceId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: assignmentKeys.all })
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useSetAutoAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ instanceId, cfg }: { instanceId: string; cfg: AutoAssignConfig }) =>
      setAutoAssign(instanceId, cfg),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['instances'] })
    },
  })
}

// ─── realtime ───────────────────────────────────────────────────────────────

/**
 * ALWAYS-ON per-agent assignment sync (IGF 2026-07-08).
 *
 * An agent's instances (wi_select) and conversations (RLS) exist ONLY while
 * they hold an assignment. The per-instance useConversationsRealtime can't
 * cover the transition INTO/OUT OF the empty state: when the agent has zero
 * instances, activeInstanceId is null and that hook doesn't subscribe — so a
 * newly-granted assignment could never arrive live (needed a refresh).
 *
 * This subscription is mounted at the seller-shell provider, keyed on the
 * agent's OWN user_id (server-side filter), so it is live even from the empty
 * state. Realtime delivers the agent their own INSERT/DELETE (replica identity
 * = PK incl. user_id; ca_select keys on user_id=auth.uid()). On any change it
 * invalidates the instance list (→ wi_select re-runs → number appears/vanishes)
 * and conversations. Debounced so a bulk (un)assign's per-row burst coalesces.
 */
export function useMyAssignmentsRealtime(userId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!userId) return
    let t: ReturnType<typeof setTimeout> | null = null
    const reconcile = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['instances'] })
        void qc.invalidateQueries({ queryKey: ['conversations'] })
        void qc.invalidateQueries({ queryKey: ['instances-unread'] })
      }, 200)
    }
    const channel = supabase
      .channel(`my-assignments-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'conversation_assignments', filter: `user_id=eq.${userId}` },
        reconcile,
      )
      .subscribe()
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(channel) }
  }, [userId, qc])
}

export function useAssignmentsRealtime(instanceId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!instanceId) return
    // DEBOUNCE (IGF audit fix 2026-07-08): a bulk op emits ONE postgres_changes
    // event per row; undebounced, each cancelled-and-restarted the in-flight
    // roster refetch (v5 cancelRefetch default), so the UI settled only after
    // the whole burst drained. One trailing 200ms timer coalesces a burst into
    // a single reconcile. Narrowed to byInstance (the Assignment page's pills) —
    // the conversation list here doesn't depend on assignments, and any open
    // inbox has its OWN conversation_assignments subscription (conversations.ts).
    let t: ReturnType<typeof setTimeout> | null = null
    const reconcile = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => { void qc.invalidateQueries({ queryKey: assignmentKeys.byInstance(instanceId) }) }, 200)
    }
    // conversation_assignments — STILL on postgres_changes (migrated to wa:biz +
    // wa:user in the Phase 2b agent-facing pass; see the slot lock-list).
    const channel = supabase
      .channel(`assignments-page-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'conversation_assignments' },
        reconcile,
      )
      .subscribe()
    // whatsapp_instances (auto-assign config edits) — its postgres_changes binding
    // went DEAD when whatsapp_instances left the publication (mig 050). Re-homed to
    // the wa:biz:<business_id> 'instance' broadcast (mig 049) so the Assignment
    // page's auto-assign config still refreshes live across sessions.
    let bizChannel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false
    void businessIdOf(instanceId)
      .then((biz) => {
        if (cancelled) return
        bizChannel = supabase
          .channel(`wa:biz:${biz}`, { config: { private: true } })
          .on('broadcast', { event: 'instance' }, () => {
            void qc.invalidateQueries({ queryKey: ['instances'] })
          })
          .subscribe()
      })
      .catch(() => { /* resolver failure surfaces through the instances query */ })
    return () => {
      if (t) clearTimeout(t)
      void supabase.removeChannel(channel)
      cancelled = true
      if (bizChannel) void supabase.removeChannel(bizChannel)
    }
  }, [instanceId, qc])
}
