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

export function useSetConversationAssignees() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, userIds }: { conversationId: string; userIds: string[] }) =>
      setConversationAssignees(conversationId, userIds),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: assignmentKeys.all })
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useUnassignConversationUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, userId }: { conversationId: string; userId: string }) =>
      unassignConversationUser(conversationId, userId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: assignmentKeys.all })
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useBulkAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, conversationIds }: { userId: string; conversationIds: string[] }) =>
      bulkAssignConversations(userId, conversationIds),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: assignmentKeys.all })
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
}

export function useBulkUnassign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, conversationIds }: { userId: string; conversationIds: string[] }) =>
      bulkUnassignConversations(userId, conversationIds),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: assignmentKeys.all })
      void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
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

export function useAssignmentsRealtime(instanceId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!instanceId) return
    const channel = supabase
      .channel(`assignments-page-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'conversation_assignments' },
        () => {
          void qc.invalidateQueries({ queryKey: assignmentKeys.all })
          void qc.invalidateQueries({ queryKey: ['conversations'] })
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'whatsapp', table: 'whatsapp_instances', filter: `id=eq.${instanceId}` },
        () => { void qc.invalidateQueries({ queryKey: ['instances'] }) },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [instanceId, qc])
}
