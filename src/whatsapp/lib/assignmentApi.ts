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

// Chip identity is shared with the Assignment page's FilterChip.
export type AssignmentMode = 'all' | 'unassigned' | 'one' | 'many' | 'dms' | 'groups'

// Server-authoritative counts for the whole instance — every chip badge and
// every agent's open-load in ONE round trip. Replaces the old client-side
// tally over the first loaded page (which capped at PAGE_SIZE=50 and reported
// 0 for agents whose conversations sat outside that page).
export interface AssignmentSummary {
  all: number
  unassigned: number
  one: number
  many: number
  dms: number
  groups: number
  unassigned_dms: number
  agents: Record<string, number>   // user_id → open (visible, assigned) count
}

// One keyset-paginated conversation row + its assignees, straight from
// admin_assignment_page. Superset of what the row renderer needs.
export interface AssignmentPageRow {
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
  assigned_user_ids: string[]
}

// ─── reads ──────────────────────────────────────────────────────────────────

/** Whole-instance counts (chips + per-agent open-load), computed server-side. */
export async function getAssignmentSummary(instanceId: string): Promise<AssignmentSummary> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_assignment_summary', {
    p_instance_id: instanceId,
  })
  if (error) throw new Error(error.message)
  const s = (data ?? {}) as Partial<AssignmentSummary>
  return {
    all: s.all ?? 0, unassigned: s.unassigned ?? 0, one: s.one ?? 0, many: s.many ?? 0,
    dms: s.dms ?? 0, groups: s.groups ?? 0, unassigned_dms: s.unassigned_dms ?? 0,
    agents: s.agents ?? {},
  }
}

/**
 * One keyset page of conversations for a chip + search. The cursor is the last
 * row's (last_message_at, id); pass both to fetch the next (strictly older)
 * page. Seek method — page N costs the same as page 1, no OFFSET blow-up.
 */
export async function listAssignmentPage(
  instanceId: string,
  mode: AssignmentMode,
  search: string | null,
  limit = 50,
  beforeTs: string | null = null,
  beforeId: string | null = null,
): Promise<AssignmentPageRow[]> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_assignment_page', {
    p_instance_id: instanceId,
    p_mode:        mode,
    p_search:      search && search.trim() ? search.trim() : null,
    p_limit:       limit,
    p_before_ts:   beforeTs,
    p_before_id:   beforeId,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as AssignmentPageRow[]
}

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

// ─── writes — bulk BY FILTER (scale path for "select all N matching") ────────
//
// Assigns/unassigns EVERY conversation matching (mode, search) server-side, so
// selecting "all 1,076" ships zero ids over the wire and never hits the proxy
// URL cap. DM singleton + already-owned rows are skipped (ON CONFLICT DO
// NOTHING) exactly like the id-list bulk RPC.

export async function assignByFilter(
  instanceId: string,
  mode: AssignmentMode,
  search: string | null,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_assign_by_filter', {
    p_instance_id: instanceId,
    p_mode:        mode,
    p_search:      search && search.trim() ? search.trim() : null,
    p_user_id:     userId,
  })
  if (error) throw new Error(error.message)
  return (data as number) ?? 0
}

/** Clear assignees from every matching conversation. userId null = strip ALL. */
export async function unassignByFilter(
  instanceId: string,
  mode: AssignmentMode,
  search: string | null,
  userId: string | null = null,
): Promise<number> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_unassign_by_filter', {
    p_instance_id: instanceId,
    p_mode:        mode,
    p_search:      search && search.trim() ? search.trim() : null,
    p_user_id:     userId,
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
