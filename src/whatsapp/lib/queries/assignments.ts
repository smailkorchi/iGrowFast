// Assignment hooks: queries + mutations.
//
// All caches are scoped per-instance because assignments are admin-only and
// admin views one instance at a time. Realtime live-sync rides the unified
// wa:biz/wa:user broadcast (see queries/waChannels.ts).

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  applyAutoAssignBacklog,
  assignByFilter,
  bulkAssignConversations,
  bulkUnassignConversations,
  getAssignmentSummary,
  listAssignmentPage,
  listUnassignedConversations,
  setAutoAssign,
  setConversationAssignees,
  unassignByFilter,
  unassignConversationUser,
  type AssignmentMode,
  type AssignmentPageRow,
  type AssignmentSummary,
  type AutoAssignConfig,
  type UnassignedConversation,
} from '../assignmentApi'
import { supabase } from '../supabase'

const PAGE_SIZE = 50

export const assignmentKeys = {
  all:           ['assignments'] as const,
  unassigned:    (instanceId: string) => ['assignments', 'unassigned', instanceId] as const,
  byConversation:(conversationId: string) => ['assignments', 'by-conv', conversationId] as const,
  summary:       (instanceId: string) => ['assignments', 'summary', instanceId] as const,
  page:          (instanceId: string, mode: AssignmentMode, search: string) =>
                   ['assignments', 'page', instanceId, mode, search] as const,
}

// ─── server-authoritative console queries (kill the client-side 50-row tally) ─

/** Whole-instance chip counts + per-agent open-load, one round trip. */
export function useAssignmentSummary(instanceId: string | null) {
  return useQuery<AssignmentSummary>({
    queryKey: instanceId ? assignmentKeys.summary(instanceId) : ['assignments', 'summary', '_'],
    enabled:  !!instanceId,
    queryFn:  () => getAssignmentSummary(instanceId!),
  })
}

/**
 * Keyset-paginated conversation list for the active chip + search. Cursor is
 * the last row's (last_message_at, id); a short page (< PAGE_SIZE) means the
 * end. Server-side filter + search + seek — the browser never holds more than
 * the pages the admin has scrolled.
 */
export function useAssignmentPage(
  instanceId: string | null,
  mode: AssignmentMode,
  search: string,
) {
  return useInfiniteQuery({
    queryKey: assignmentKeys.page(instanceId ?? '_', mode, search),
    enabled:  !!instanceId,
    initialPageParam: null as { ts: string | null; id: string } | null,
    queryFn: async ({ pageParam }) => {
      if (!instanceId) return [] as AssignmentPageRow[]
      return listAssignmentPage(
        instanceId, mode, search, PAGE_SIZE,
        pageParam?.ts ?? null, pageParam?.id ?? null,
      )
    },
    getNextPageParam: (last) => {
      if (last.length < PAGE_SIZE) return undefined
      const tail = last[last.length - 1]
      return { ts: tail.last_message_at, id: tail.id }
    },
  })
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

// ─── mutations ──────────────────────────────────────────────────────────────
//
// The console reads counts from `summary` and rows from `page` — both bounded,
// ~ms server RPCs (mig 058). A mutation just invalidates and lets the fast
// refetch reconcile; there is no optimistic cache patching. (The old byInstance
// optimism existed only to mask a multi-second refetch of the UNBOUNDED
// per-instance assignments list — that list, its cache, and the lag are gone.)
//   - instanceId present (console) → invalidate the ['assignments'] tree
//     (summary + page + per-conversation assignees). The console doesn't read
//     ['conversations'], so leave it untouched.
//   - absent (inbox InfoPane) → also invalidate ['conversations'] so the inbox
//     unassigned/assigned filters move.
// `instanceId`/`isGroup` stay in the param types for call-site compatibility.
function reconcileHandlers(qc: ReturnType<typeof useQueryClient>) {
  return {
    // vars typed `unknown` so this shared handler doesn't pin react-query's
    // TVariables — each mutationFn's own param shape drives inference.
    onSettled: (_d: unknown, _e: unknown, vars: unknown) => {
      const instanceId = (vars as { instanceId?: string } | undefined)?.instanceId
      void qc.invalidateQueries({ queryKey: assignmentKeys.all })
      if (!instanceId) void qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  }
}

export function useSetConversationAssignees() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, userIds }: { conversationId: string; userIds: string[]; instanceId?: string; isGroup?: boolean }) =>
      setConversationAssignees(conversationId, userIds),
    ...reconcileHandlers(qc),
  })
}

export function useUnassignConversationUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, userId }: { conversationId: string; userId: string; instanceId?: string }) =>
      unassignConversationUser(conversationId, userId),
    ...reconcileHandlers(qc),
  })
}

export function useBulkAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, conversationIds }: { userId: string; conversationIds: string[]; instanceId?: string; isGroup?: boolean }) =>
      bulkAssignConversations(userId, conversationIds),
    ...reconcileHandlers(qc),
  })
}

export function useBulkUnassign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, conversationIds }: { userId: string; conversationIds: string[]; instanceId?: string }) =>
      bulkUnassignConversations(userId, conversationIds),
    ...reconcileHandlers(qc),
  })
}

// ─── bulk BY FILTER (select-all-N-matching path) ─────────────────────────────
//
// These touch an unbounded set of rows server-side, so there is nothing to
// patch optimistically — reconcile the console caches (summary + page +
// byInstance) with a background refetch once the server op returns.
function invalidateConsole(qc: ReturnType<typeof useQueryClient>, instanceId: string) {
  void qc.invalidateQueries({ queryKey: assignmentKeys.summary(instanceId) })
  void qc.invalidateQueries({ queryKey: ['assignments', 'page', instanceId] })
}

export function useAssignByFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ instanceId, mode, search, userId }:
      { instanceId: string; mode: AssignmentMode; search: string; userId: string }) =>
      assignByFilter(instanceId, mode, search, userId),
    onSettled: (_d, _e, vars) => invalidateConsole(qc, vars.instanceId),
  })
}

export function useUnassignByFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ instanceId, mode, search, userId }:
      { instanceId: string; mode: AssignmentMode; search: string; userId?: string | null }) =>
      unassignByFilter(instanceId, mode, search, userId ?? null),
    onSettled: (_d, _e, vars) => invalidateConsole(qc, vars.instanceId),
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

