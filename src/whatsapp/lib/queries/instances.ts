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
  restartInstance,
  type InstanceDeletePreflight,
  type PushWaProfileArgs,
  type WaProfileField,
} from '../instancesApi'
import type { WhatsappInstance } from '../database.types'
import { supabase } from '../supabase'

export const instanceKeys = {
  all:    ['instances'] as const,
  list:   ['instances', 'list'] as const,
  one:    (id: string) => ['instances', 'one', id] as const,
  status: (id: string) => ['instances', 'status', id] as const,
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
