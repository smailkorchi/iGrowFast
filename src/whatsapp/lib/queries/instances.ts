// Instance query hooks + Realtime live-sync. The list view subscribes to
// `whatsapp_instances` changes; every INSERT/UPDATE/DELETE patches the
// TanStack cache so the UI is always live without polling.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  createInstance,
  deleteInstance,
  disconnectInstance,
  fetchStatus,
  getInstance,
  instanceDeletePreflight,
  listInstances,
  pairInstance,
  pushWaProfile,
  pushWaSettings,
  resyncWebhookSubscription,
  restartInstance,
  setInstancePresence,
  type InstanceDeletePreflight,
  type PushWaProfileArgs,
  type WaProfileField,
} from '../instancesApi'
import type { WhatsappInstance, WorkerHealthStatus } from '../database.types'
import { supabase } from '../supabase'

export const instanceKeys = {
  all:    ['instances'] as const,
  list:   ['instances', 'list'] as const,
  one:    (id: string) => ['instances', 'one', id] as const,
  status: (id: string) => ['instances', 'status', id] as const,
  worker: ['worker', 'health'] as const,
}

// ---------- List + single ---------------------------------------------------

export function useInstances() {
  return useQuery<WhatsappInstance[]>({
    queryKey: instanceKeys.list,
    queryFn:  listInstances,
  })
}

export function useInstance(id: string | null, opts?: { refetchMs?: number; untilSynced?: boolean }) {
  return useQuery<WhatsappInstance | null>({
    queryKey: instanceKeys.one(id ?? '_'),
    queryFn:  () => (id ? getInstance(id) : Promise.resolve(null)),
    enabled:  !!id,
    // While pairing, poll so the auto-rotated QR (worker persists every
    // qrcode.updated) shows up here without a manual refresh. Default: stop once
    // the socket is connected. With `untilSynced`, KEEP polling after connect so
    // the pairing modal sees history_synced_at land (the real sync-done signal).
    refetchInterval: opts?.refetchMs
      ? (q) => {
          const d = q.state.data as WhatsappInstance | null
          if (!d) return opts.refetchMs!
          const done = opts.untilSynced
            ? d.status === 'connected' && d.history_synced_at != null
            : d.status === 'connected'
          return done ? false : opts.refetchMs!
        }
      : undefined,
  })
}

// Capacity status for the composer "near cap" banner + kill-switch awareness.
export interface InstanceCapacityStatus {
  instance_id:     string
  lifecycle_state: 'warming' | 'established' | 'cooling' | 'banned'
  worker_paused:   boolean
  business_hours:  { tz: string; days: number[]; open: string; close: string } | null
  business_hours_enabled: boolean
  quiet_hours_override_until: string | null
  daily:  { used: number; cap: number; pct: number; resume_at: string | null }
  hourly: { used: number; cap: number; pct: number; resume_at: string | null }
  minute: { used: number; cap: number; pct: number }
  as_of:  string
}

export function useInstanceCapacityStatus(instanceId: string | null) {
  return useQuery<InstanceCapacityStatus | null>({
    queryKey: ['instance-capacity', instanceId ?? '_'],
    enabled:  !!instanceId,
    staleTime: 20_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!instanceId) return null
      const { data, error } = await (supabase.schema('whatsapp').rpc as unknown as (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)(
        'instance_capacity_status',
        { p_instance_id: instanceId },
      )
      if (error) throw new Error(error.message)
      return data as InstanceCapacityStatus
    },
  })
}

export function useInstanceLiveStatus(id: string | null) {
  return useQuery({
    queryKey: instanceKeys.status(id ?? '_'),
    queryFn:  () => fetchStatus(id!),
    enabled:  !!id,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}

export interface InstanceStats {
  conversations_total: number
  conversations_groups: number
  conversations_dms: number
  conversations_unread: number
  conversations_active_24h: number
  contacts_total: number
  messages_total: number
  messages_inbound_24h: number
  messages_outbound_24h: number
  messages_7d: number
  queue_queued: number
  queue_dispatching: number
  queue_dead_24h: number
  reconnects_7d: number
  last_inbound_at: string | null
  last_outbound_at: string | null
}

export function useInstanceStats(id: string | null) {
  return useQuery<InstanceStats | null>({
    queryKey: ['instances', 'stats', id ?? '_'],
    queryFn: async () => {
      if (!id) return null
      const { data, error } = await supabase.schema('whatsapp').rpc('instance_stats', { p_instance_id: id })
      if (error) throw new Error(error.message)
      return (data as unknown) as InstanceStats
    },
    enabled: !!id,
    // 15s polling is a fallback for Realtime gaps; focus + mount refetch
    // are handled by the global defaults.
    refetchInterval: 15_000,
  })
}

/**
 * Live-sync hook for the detail page. Subscribes to:
 *   - messages INSERT for this instance → invalidate stats + recent conversations
 *   - conversations UPDATE for this instance → patch list + invalidate stats
 *
 * Without this, the UI shows stale numbers between the 15s poll ticks. Pair
 * this with useInstancesRealtime (which keeps the whatsapp_instances row
 * live) for a fully reactive detail page.
 */
export function useInstanceLiveSync(instanceId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!instanceId) return
    const channel = supabase
      .channel(`numbers-detail-${instanceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'whatsapp', table: 'messages', filter: `instance_id=eq.${instanceId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ['instances', 'stats', instanceId] })
          void qc.invalidateQueries({ queryKey: ['instances', 'recent_conversations', instanceId] })
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'whatsapp', table: 'conversations', filter: `instance_id=eq.${instanceId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ['instances', 'stats', instanceId] })
          void qc.invalidateQueries({ queryKey: ['instances', 'recent_conversations', instanceId] })
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'whatsapp', table: 'conversations', filter: `instance_id=eq.${instanceId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ['instances', 'stats', instanceId] })
          void qc.invalidateQueries({ queryKey: ['instances', 'recent_conversations', instanceId] })
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'whatsapp', table: 'audit_log', filter: `target_id=eq.${instanceId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ['instances', 'audit', instanceId] })
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [instanceId, qc])
}

interface RecentConversation {
  id: string
  remote_jid: string
  is_group: boolean
  peer_display_name: string | null
  peer_profile_pic: string | null
  last_message_at: string | null
  unread_count: number
  contact_book_name: string | null
}

export function useRecentConversations(instanceId: string | null, limit = 8) {
  return useQuery<RecentConversation[]>({
    queryKey: ['instances', 'recent_conversations', instanceId ?? '_'],
    queryFn: async () => {
      if (!instanceId) return []
      const { data, error } = await supabase
        .schema('whatsapp').from('conversations_decrypted')
        .select('id, remote_jid, is_group, peer_display_name, peer_profile_pic, last_message_at, unread_count, contact_book_name')
        .eq('instance_id', instanceId)
        .not('remote_jid', 'like', '%@broadcast')
        .not('remote_jid', 'like', '%@newsletter')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(limit)
      if (error) throw new Error(error.message)
      return (data ?? []) as RecentConversation[]
    },
    enabled: !!instanceId,
    refetchInterval: 20_000,
  })
}

interface AuditEvent {
  id: number
  occurred_at: string
  event_type: string
  payload: Record<string, unknown>
}

export function useInstanceAudit(instanceId: string | null, limit = 12) {
  return useQuery<AuditEvent[]>({
    queryKey: ['instances', 'audit', instanceId ?? '_'],
    queryFn: async () => {
      if (!instanceId) return []
      const { data, error } = await supabase
        .schema('whatsapp').from('audit_log')
        .select('id, occurred_at, event_type, payload')
        .eq('target_type', 'instance')
        .eq('target_id', instanceId)
        .order('occurred_at', { ascending: false })
        .limit(limit)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as AuditEvent[]
    },
    enabled: !!instanceId,
    refetchInterval: 30_000,
  })
}

export function useWorkerHealth() {
  return useQuery<WorkerHealthStatus[]>({
    queryKey: instanceKeys.worker,
    queryFn:  async () => {
      const { data, error } = await supabase
        .schema('whatsapp').from('worker_health_status')
        .select('*')
        .order('last_heartbeat_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as WorkerHealthStatus[]
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

// ---------- Realtime subscription ------------------------------------------
// Mounts a single channel for the whatsapp_instances table that patches the
// React Query cache on every event. Call once from the Numbers list page or
// AdminLayout; useEffect cleanup unsubscribes on unmount.

export function useInstancesRealtime() {
  const qc = useQueryClient()
  useEffect(() => {
    const channel = supabase
      .channel('numbers-page-instances')
      .on(
        'postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'whatsapp_instances' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as WhatsappInstance
            qc.setQueryData<WhatsappInstance[]>(instanceKeys.list, (prev) =>
              [row, ...(prev ?? []).filter((x) => x.id !== row.id)],
            )
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as WhatsappInstance
            qc.setQueryData<WhatsappInstance[]>(instanceKeys.list, (prev) =>
              (prev ?? []).map((x) => (x.id === row.id ? row : x)),
            )
            qc.setQueryData<WhatsappInstance | null>(instanceKeys.one(row.id), row)
          } else if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id?: string }
            if (oldRow.id) {
              qc.setQueryData<WhatsappInstance[]>(instanceKeys.list, (prev) =>
                (prev ?? []).filter((x) => x.id !== oldRow.id),
              )
              qc.removeQueries({ queryKey: instanceKeys.one(oldRow.id) })
            }
          }
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [qc])
}

// ---------- Mutations -------------------------------------------------------

export function useCreateInstance() {
  const qc = useQueryClient()
  return useMutation({
    meta: { silent: true }, // CreateInstanceDialog shows its own inline error
    mutationFn: (displayName: string) => createInstance(displayName),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: instanceKeys.list }) },
  })
}

export function usePairInstance() {
  return useMutation({
    meta: { silent: true }, // PairDialog shows its own inline error
    mutationFn: (id: string) => pairInstance(id),
  })
}

export function useDisconnectInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => disconnectInstance(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: instanceKeys.list }) },
  })
}

export function useRestartInstance() {
  return useMutation({
    mutationFn: (id: string) => restartInstance(id),
  })
}

// ─── Per-instance settings (Phase 1 chokepoint controls) ─────────────────
//
// One mutation hook covers the whole settings spec. Pass a partial patch;
// keys not present are untouched. Number-valued nullable columns accept
// `null` to clear the override (worker falls back to the lifecycle preset).

export interface InstanceSettingsPatch {
  worker_paused?:                 boolean
  lifecycle_state?:               'warming' | 'established' | 'cooling' | 'banned'
  // Named preset (conservative|balanced|aggressive): the rate/cap columns are
  // server-derived and locked. 'custom' unlocks them for per-number tuning.
  pacing_mode?:                   'conservative' | 'balanced' | 'aggressive' | 'custom'
  // Token-bucket sustained cap: refill rate/min. Locked under a named preset.
  send_rate_per_min?:             number
  typing_base_ms?:                number
  typing_per_char_ms?:            number
  typing_cap_ms?:                 number
  typing_enabled?:                boolean
  read_receipts_mode?:            'off' | 'on_open' | 'on_dispatch'
  business_hours?:                { tz: string; days: number[]; open: string; close: string }
  business_hours_enabled?:        boolean
  quiet_hours_override_until?:    string | null
  // Phase 2 fields
  wa_reject_calls?:               boolean
  wa_call_reply_text?:            string | null
  wa_always_online?:              boolean
  wa_auto_read_inbound?:          boolean
  wa_read_status?:                boolean
  wa_ignore_groups?:              boolean
  wa_sync_full_history?:          boolean
  wa_profile_status?:             string | null
  daily_send_cap?:                number
  hourly_send_cap?:               number
  minute_burst_cap?:              number
  // Auto-reconnect watchdog (worker restarts a genuinely-down instance).
  auto_reconnect?:                boolean
}

export function useSetInstanceSettings(instanceId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: InstanceSettingsPatch) => {
      if (!instanceId) throw new Error('no_instance')
      const { data, error } = await (supabase.schema('whatsapp').rpc as unknown as (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>)('set_instance_settings', {
        p_instance_id: instanceId,
        p_patch: patch,
      })
      if (error) throw new Error(error.message)
      return data
    },
    onSuccess: () => {
      if (!instanceId) return
      void qc.invalidateQueries({ queryKey: instanceKeys.one(instanceId) })
      void qc.invalidateQueries({ queryKey: instanceKeys.list })
    },
  })
}

// ─── Manual presence override ─────────────────────────────────────────────
//
// Calls the instance-presence edge function which both persists the
// `manual_presence` column AND broadcasts the presence via Evolution.

/** Pushes the WA peer-side flag columns from our DB to Evolution. */
export function usePushWaSettings(instanceId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!instanceId) throw new Error('no_instance')
      return await pushWaSettings(instanceId)
    },
    onSuccess: () => {
      if (!instanceId) return
      void qc.invalidateQueries({ queryKey: instanceKeys.one(instanceId) })
    },
  })
}

/** Pushes the WA peer-visible profile (name/status/picture) to Evolution.
 *  Accepts either a list of fields to push (defaults to all) and/or an
 *  inline picture_data_url to upload as the new avatar. */
export function usePushWaProfile(instanceId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args?: PushWaProfileArgs | WaProfileField[]) => {
      if (!instanceId) throw new Error('no_instance')
      // Back-compat: caller used to pass just the fields array.
      const normalized: PushWaProfileArgs | undefined = Array.isArray(args)
        ? { fields: args }
        : args
      return await pushWaProfile(instanceId, normalized)
    },
    onSuccess: () => {
      if (!instanceId) return
      void qc.invalidateQueries({ queryKey: instanceKeys.one(instanceId) })
    },
  })
}

/** Re-sync the canonical webhook event-list on Evolution for an existing instance. */
export function useResyncWebhookSubscription(instanceId: string | null) {
  return useMutation({
    mutationFn: async () => {
      if (!instanceId) throw new Error('no_instance')
      return await resyncWebhookSubscription(instanceId)
    },
  })
}

export function useSetInstancePresence(instanceId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (state: 'auto' | 'online' | 'offline') => {
      if (!instanceId) throw new Error('no_instance')
      return await setInstancePresence(instanceId, state)
    },
    onSuccess: () => {
      if (!instanceId) return
      void qc.invalidateQueries({ queryKey: instanceKeys.one(instanceId) })
    },
  })
}

// ─── Dispatcher live state (per-number pacing snapshot + queue depth) ────
//
// Polls every 2s while the page is open. Returns: last dispatched/completed
// timestamps from number_pacing_state, plus the queued/dispatching/dead
// counts already computed by instance_stats.

export interface DispatcherState {
  last_dispatched_at: string | null
  last_completed_at:  string | null
  last_send_at:       string | null
  /** Content sends completed in the last rolling 60s — drives the live meter. */
  sends_last_min:     number
  queue_queued:       number
  queue_dispatching:  number
  queue_dead_24h:     number
}

const ZERO_DISPATCH: DispatcherState = {
  last_dispatched_at: null, last_completed_at: null, last_send_at: null,
  sends_last_min: 0, queue_queued: 0, queue_dispatching: 0, queue_dead_24h: 0,
}
const mapSnapshot = (r: Record<string, unknown>): DispatcherState => ({
  last_dispatched_at: (r.last_dispatched_at as string | null) ?? null,
  last_completed_at:  (r.last_completed_at  as string | null) ?? null,
  last_send_at:       (r.last_send_at       as string | null) ?? null,
  sends_last_min:     Number(r.sends_last_min ?? 0),
  queue_queued:       Number(r.queue_queued ?? 0),
  queue_dispatching:  Number(r.queue_dispatching ?? 0),
  queue_dead_24h:     Number(r.queue_dead_24h ?? 0),
})

// Realtime-driven: the worker UPSERTs public.dispatcher_snapshot on a throttled cadence and we
// subscribe per-viewed-instance (mount/unmount) — replaces the old 2s/3-read poll. A slow 30s
// fallback fetch covers first paint and dropped channels. Concurrent channels track active
// viewers, not number count.
export function useDispatcherState(instanceId: string | null) {
  const qc = useQueryClient()
  const SEL = 'last_dispatched_at,last_completed_at,last_send_at,sends_last_min,queue_queued,queue_dispatching,queue_dead_24h'

  useEffect(() => {
    if (!instanceId) return
    const key = ['dispatcher-state', instanceId] as const
    const channel = supabase
      .channel(`dispatcher-snapshot-${instanceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'dispatcher_snapshot', filter: `instance_id=eq.${instanceId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown> | null
          if (row && row.instance_id) qc.setQueryData(key, mapSnapshot(row))
        })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [instanceId, qc])

  return useQuery<DispatcherState | null>({
    queryKey: ['dispatcher-state', instanceId ?? '_'],
    enabled: !!instanceId,
    queryFn: async () => {
      if (!instanceId) return null
      // dispatcher_snapshot isn't in the generated types yet → cast (same pattern as the rpc casts).
      const from = supabase.schema('whatsapp').from as unknown as (t: string) => {
        select: (s: string) => { eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> } } }
      const { data, error } = await from('dispatcher_snapshot').select(SEL).eq('instance_id', instanceId).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? mapSnapshot(data) : ZERO_DISPATCH
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useDeleteInstance() {
  const qc = useQueryClient()
  return useMutation({
    meta: { silent: true }, // DeleteInstanceModal shows its own inline error
    mutationFn: (id: string) => deleteInstance(id),
    onSuccess: (_data, id) => {
      qc.setQueryData<WhatsappInstance[]>(instanceKeys.list, (prev) =>
        (prev ?? []).filter((x) => x.id !== id),
      )
      qc.removeQueries({ queryKey: instanceKeys.one(id) })
    },
  })
}

// ─── Sync metrics (live progress during pairing) ────────────────────────

export interface InstanceSyncMetrics {
  conversations: number
  conversations_dms: number
  conversations_groups: number
  messages: number
  messages_media_pending: number
  contacts: number
  contacts_resolved: number
  contact_profiles: number
  jid_mapping: number
  media_pending: number
  media_done: number
  media_failed: number
  last_message_at: string | null
}

/**
 * Poll-based live sync metrics for the pair modal's "syncing" phase.
 * Polls every 2 s while enabled; realtime invalidation on the relevant
 * tables also kicks a refetch.
 */
export function useInstanceSyncMetrics(id: string | null, enabled: boolean) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!id || !enabled) return
    const key = ['instances', 'sync-metrics', id] as const
    const invalidate = () => { void qc.invalidateQueries({ queryKey: key }) }
    const channel = supabase
      .channel(`sync-metrics-${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'conversations', filter: `instance_id=eq.${id}` },
        invalidate)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'whatsapp', table: 'messages', filter: `instance_id=eq.${id}` },
        invalidate)
      .on('postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'contacts', filter: `instance_id=eq.${id}` },
        invalidate)
      .on('postgres_changes',
        { event: '*', schema: 'whatsapp', table: 'jid_mapping', filter: `instance_id=eq.${id}` },
        invalidate)
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [id, enabled, qc])

  return useQuery<InstanceSyncMetrics | null>({
    queryKey: ['instances', 'sync-metrics', id ?? '_'],
    enabled: !!id && enabled,
    refetchInterval: enabled ? 2_000 : false,
    queryFn: async () => {
      if (!id) return null
      const { data, error } = await supabase.schema('whatsapp').rpc('admin_instance_sync_metrics', { p_instance_id: id })
      if (error) throw new Error(error.message)
      return data as unknown as InstanceSyncMetrics
    },
  })
}

export function useInstanceDeletePreflight(id: string | null, enabled = true) {
  return useQuery<InstanceDeletePreflight | null>({
    queryKey: ['instances', 'delete-preflight', id ?? '_'],
    // Gate by `enabled` (e.g. only while the modal is on the preview step) and
    // never refetch on window focus — once the instance is deleted, a refetch
    // returns instance_not_found and would paint a scary error over a SUCCESSFUL
    // delete. It's a one-shot preview, not live data.
    enabled: !!id && enabled,
    queryFn: () => (id ? instanceDeletePreflight(id) : Promise.resolve(null)),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

// ---------- Prefetch for admin route prefetching ---------------------------

export function prefetchInstances(qc: QueryClient) {
  void qc.prefetchQuery({ queryKey: instanceKeys.list, queryFn: listInstances })
}
