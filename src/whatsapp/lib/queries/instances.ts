// Instance query hooks + Realtime live-sync. The list view subscribes to
// `whatsapp_instances` changes; every INSERT/UPDATE/DELETE patches the
// TanStack cache so the UI is always live without polling.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  createInstance,
  deleteInstance,
  disconnectInstance,
  getInstance,
  getInstanceQr,
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
    // Send-budget gauge changes slowly; 60s poll (was 30s) halves the per-open-
    // conversation request rate at scale. Deduped to one poll per instance.
    staleTime: 45_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
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

// Admin-only live pairing QR poll. The QR is no longer on the instance row
// (revoked from agents), so the PairDialog polls this while the QR is showing.
export function useInstanceQr(instanceId: string | null, enabled: boolean, refetchMs = 2500) {
  return useQuery<string | null>({
    queryKey: ['instance-qr', instanceId ?? '_'],
    enabled:  !!instanceId && enabled,
    queryFn:  () => (instanceId ? getInstanceQr(instanceId) : Promise.resolve(null)),
    refetchInterval: enabled ? refetchMs : false,
    refetchOnWindowFocus: false,
    gcTime: 0,   // never cache a QR beyond the dialog
  })
}

// ---------- Realtime subscription ------------------------------------------
// Mounts a single channel for the whatsapp_instances table that patches the
// React Query cache on every event. Call once from the Numbers list page or
// AdminLayout; useEffect cleanup unsubscribes on unmount.

export function useInstancesRealtime() {
  const qc = useQueryClient()
  // Enterprise Phase 2b: business id for the wa:biz instance feed (mig 049). All
  // of an admin's instances share it (RLS scopes the list to their business).
  const { data: instances } = useInstances()
  const businessId = instances?.[0]?.business_id ?? null
  useEffect(() => {
    // Enterprise Phase 2b: whatsapp_instances left the supabase_realtime publication
    // (mig 050), so the Numbers list is driven SOLELY by the wa:biz:<business_id>
    // 'instance' broadcast (DB trigger _broadcast_instance_control, mig 049).
    // Invalidate the (low-cardinality) list to refetch, plus the changed instance's
    // single-cache so an open NumberDetail refreshes — equivalent coverage to the
    // retired postgres_changes in-place patch, without the whatsapp_instances WAL
    // decode / per-subscriber cost. Event 'instance' is distinct from the
    // conversation-bump 'bump' event on the same wa:biz topic.
    if (!businessId) return
    const bizChannel = supabase
      .channel(`wa:biz:${businessId}`, { config: { private: true } })
      .on('broadcast', { event: 'instance' }, ({ payload }) => {
        void qc.invalidateQueries({ queryKey: instanceKeys.list })
        const id = (payload as { id?: string })?.id
        if (id) void qc.invalidateQueries({ queryKey: instanceKeys.one(id) })
      })
      .subscribe()
    return () => { void supabase.removeChannel(bizChannel) }
  }, [qc, businessId])
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
 * Poll-based live sync metrics for the pair modal's "syncing" phase. Polls every
 * 2 s while enabled. (Phase 2b: the old postgres_changes invalidation bindings on
 * conversations/messages/contacts/jid_mapping were REMOVED — those tables are no
 * longer in the supabase_realtime publication, so the bindings were dead; the 2 s
 * poll fully covers the pairing "syncing" progress.)
 */
export function useInstanceSyncMetrics(id: string | null, enabled: boolean) {

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
