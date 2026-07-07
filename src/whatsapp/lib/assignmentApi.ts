// Assignment API — thin wrappers around the conversation_assignments RPCs.
//
// All writes go through SECURITY DEFINER RPCs that gate on is_admin().
// Realtime invalidation is wired in queries/assignments.ts.

import { supabase } from './supabase'
import type { ConversationStatus, MessageDirection, MessageKind } from './database.types'


export type AutoAssignStrategy = 'round_robin'

export interface UnassignedConversation {
  id: string
  instance_id: string
  remote_jid: string
  is_group: boolean
  peer_display_name: string | null
  peer_profile_pic: string | null
  contact_id: string | null
  contact_book_name: string | null
  last_message_at: string | null
  last_message_preview: string | null
  last_message_kind: MessageKind | null
  last_message_direction: MessageDirection | null
  unread_count: number
  status: ConversationStatus
}

export interface AssignmentRow {
  conversation_id: string
  user_id: string
  assigned_by: string
  assigned_at: string
  is_group: boolean
}

// ─── reads ──────────────────────────────────────────────────────────────────

export async function listUnassignedConversations(
  instanceId: string,
  limit = 100,
  offset = 0,
): Promise<UnassignedConversation[]> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_list_unassigned_conversations', {
    p_instance_id: instanceId,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as UnassignedConversation[]
}

export async function listInstanceAssignments(instanceId: string): Promise<AssignmentRow[]> {
  // Pull all assignments for conversations that belong to this instance.
  // Two-step rather than a join because conversation_assignments has no
  // direct instance_id column and supabase-js inner-joins are awkward.
  const { data: convs, error: convErr } = await supabase
    .schema('whatsapp').from('conversations')
    .select('id')
    .eq('instance_id', instanceId)
  if (convErr) throw new Error(convErr.message)
  const ids = (convs ?? []).map((c) => c.id)
  if (ids.length === 0) return []

  // IGF FIX (donor-latent scale bug): the donor sent ONE .in() with every
  // conversation id — at ~600 conversations that's a ~25KB request URL, which
  // the self-host proxy (nginx 8k header buffer) rejects before PostgREST,
  // surfacing as a CORS/ERR_FAILED wall. Chunk to 150 ids (~5.5KB/URL).
  const CHUNK = 150
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .schema('whatsapp').from('conversation_assignments')
        .select('*')
        .in('conversation_id', chunk)
      if (error) throw new Error(error.message)
      return (data ?? []) as AssignmentRow[]
    }),
  )
  return results.flat()
}

// ─── writes — single-conversation (preferred for UI) ────────────────────────

/**
 * Set the complete assignee list for one conversation. DELETE+INSERT diff
 * happens atomically in the RPC. For DMs, pass exactly one user (or zero
 * to unassign). For groups, pass any number.
 */
export async function setConversationAssignees(
  conversationId: string,
  userIds: string[],
): Promise<{ added: string[]; removed: string[] }> {
  const { data, error } = await supabase.schema('whatsapp').rpc('assign_conversation', {
    p_conversation_id: conversationId,
    p_user_ids: userIds,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { added?: string[]; removed?: string[] }
  return { added: r.added ?? [], removed: r.removed ?? [] }
}

export async function unassignConversationUser(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.schema('whatsapp').rpc('unassign_conversation', {
    p_conversation_id: conversationId,
    p_user_id: userId,
  })
  if (error) throw new Error(error.message)
  return Boolean((data as { removed?: boolean })?.removed)
}

// ─── writes — bulk (for multi-select on the assignment page) ────────────────

/**
 * Bulk-assign many conversations to one user. Uses the existing
 * admin_assign_conversations RPC which is ON CONFLICT DO NOTHING — meaning
 * if any of the target DMs already have an owner they are SKIPPED, not
 * reassigned. For DM reassignment, use setConversationAssignees per-row.
 */
export async function bulkAssignConversations(
  userId: string,
  conversationIds: string[],
): Promise<number> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_assign_conversations', {
    p_user_id: userId,
    p_conversation_ids: conversationIds,
  })
  if (error) throw new Error(error.message)
  return (data as number) ?? 0
}

export async function bulkUnassignConversations(
  userId: string,
  conversationIds: string[],
): Promise<number> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_unassign_conversations', {
    p_user_id: userId,
    p_conversation_ids: conversationIds,
  })
  if (error) throw new Error(error.message)
  return (data as number) ?? 0
}

// ─── auto-assign config ─────────────────────────────────────────────────────

export interface AutoAssignConfig {
  enabled: boolean
  strategy: AutoAssignStrategy
  pool: string[]
}

export async function applyAutoAssignBacklog(instanceId: string): Promise<number> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_apply_auto_assign_backlog', {
    p_instance_id: instanceId,
  })
  if (error) throw new Error(error.message)
  return (data as number) ?? 0
}

export async function setAutoAssign(
  instanceId: string,
  cfg: AutoAssignConfig,
): Promise<AutoAssignConfig> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_set_auto_assign', {
    p_instance_id: instanceId,
    p_enabled:     cfg.enabled,
    p_strategy:    cfg.strategy,
    p_pool:        cfg.pool,
  })
  if (error) throw new Error(error.message)
  return data as unknown as AutoAssignConfig
}
