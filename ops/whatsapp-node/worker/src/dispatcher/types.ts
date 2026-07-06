// Shared type aliases for the dispatcher. Mirror the relevant subset of
// public Database types without dragging the entire app's database.types
// file into the worker bundle.

export type InstanceLifecycleState = 'warming' | 'established' | 'cooling' | 'banned'
export type InstanceStatus = 'pending' | 'connecting' | 'connected' | 'disconnected' | 'error'

export type OutboundActionType =
  | 'send_text'
  | 'send_media'
  | 'send_poll'
  | 'mark_read'
  | 'typing_start'
  | 'typing_stop'
  | 'react'
  | 'edit_message'
  | 'delete_message'
  | 'send_contact'

export type MessageKind =
  | 'text' | 'image' | 'video' | 'audio' | 'document'
  | 'sticker' | 'location' | 'contact' | 'reaction' | 'poll' | 'system'

export type OutboundActionStatus =
  | 'queued' | 'dispatching' | 'sent' | 'failed' | 'dead' | 'cancelled'

/** Where a queued send originated. Drives humanization gating (interactive
 *  sends carry the human's own timing; machine-sourced sends get a typing
 *  pre-roll since no human was at the keyboard). */
export type OutboundOrigin = 'interactive' | 'quick_reply' | 'forward' | 'scheduled' | 'batch' | 'auto'

/** Subset of whatsapp_instances the dispatcher actually needs. */
export interface InstanceConfig {
  id: string
  evolutionInstanceName: string
  apiToken: string                       // decrypted via reveal_instance_token
  lifecycleState: InstanceLifecycleState
  workerPaused: boolean
  businessHours: BusinessHours
  /** When false the dispatcher dispatches 24/7 regardless of business_hours.
   *  When true the business_hours JSONB is enforced. Default false for new
   *  instances; backfilled to true on the migration for existing rows. */
  businessHoursEnabled: boolean
  /** Token-bucket sustained cap. send_rate_per_min = refill rate,
   *  minute_burst_cap = bucket capacity (max instant burst). These are the
   *  ONLY thing that throttles a single agent, and only under sustained load. */
  sendRatePerMin: number
  minuteBurstCap: number
  /** Per-instance typing pre-roll behavior. */
  typingBaseMs: number
  typingPerCharMs: number
  typingCapMs: number
  typingEnabled: boolean
  /** When the dispatcher emits blue-tick read receipts. */
  readReceiptsMode: 'off' | 'on_open' | 'on_dispatch'
  /** Admin-forced presence override (auto = follow defaults). */
  manualPresence: 'auto' | 'online' | 'offline'
  /** ISO timestamp; when set in the future, business_hours gate is bypassed. */
  quietHoursOverrideUntil: string | null
}

export interface BusinessHours {
  tz: string
  open: string                           // "HH:MM" 24h
  close: string                          // "HH:MM" 24h
  days: number[]                         // 0=Sun..6=Sat
}

/** Subset of outbound_queue row the dispatcher consumes. */
export interface QueuedAction {
  id: string
  number_id: string
  conversation_id: string
  agent_id: string
  action_type: OutboundActionType
  origin: OutboundOrigin
  payload: Record<string, unknown>
  attempts: number
  not_before: string
  enqueued_at: string
  seq: number
}

/** Subset of conversation row needed for per-conversation spacing checks. */
export interface ConversationTiming {
  id: string
  remote_jid: string
  is_group: boolean
  last_inbound_at: Date | null
  last_outbound_at: Date | null
}
