// Edge function callers for the WhatsApp instance lifecycle.
// Mirrors the usersApi pattern: thin POST wrappers that read the access_token
// from localStorage (bypasses the navigator.locks hang) and surface a
// machine-readable `reason` on failure.

import type { WhatsappInstance } from './database.types'
import { supabase } from './supabase'

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

const PROJECT_REF =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.match(/https?:\/\/([^.]+)\./)?.[1] ?? ''
const SESSION_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

function readJwtSync(): string | null {
  if (!PROJECT_REF || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { access_token?: string }
    return parsed?.access_token ?? null
  } catch { return null }
}

async function call<T = unknown>(path: string, body: unknown, timeoutMs = 25_000): Promise<T> {
  const jwt = readJwtSync()
  if (!jwt) throw new Error('not_authenticated')
  // Hard timeout so a slow/hung edge function (cold start, a disconnected
  // number whose Evolution call never returns) can NEVER leave the UI spinning
  // forever — it rejects, the caller's catch fires, the user sees an error.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${FN_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    throw new Error((e as Error)?.name === 'AbortError' ? 'timeout' : ((e as Error)?.message || 'network_error'))
  } finally {
    clearTimeout(timer)
  }
  const json = await res.json().catch(() => ({} as Record<string, unknown>))
  if (!res.ok || (json as { ok?: boolean }).ok === false) {
    const reason = (json as { reason?: string }).reason ?? `http_${res.status}`
    throw new Error(reason)
  }
  return json as T
}

// ---------- Direct table reads via supabase-js ----------------------------

export async function listInstances(): Promise<WhatsappInstance[]> {
  const { data, error } = await supabase
    .schema('whatsapp').from('whatsapp_instances')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as WhatsappInstance[]
}

export async function getInstance(id: string): Promise<WhatsappInstance | null> {
  const { data, error } = await supabase
    .schema('whatsapp').from('whatsapp_instances')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as WhatsappInstance | null) ?? null
}

// ---------- Edge functions -------------------------------------------------

export interface CreateInstanceResp {
  ok: true
  instance: {
    id: string
    display_name: string
    evolution_instance_name: string
    status: 'pending'
  }
}

export function createInstance(displayName: string): Promise<CreateInstanceResp> {
  return call<CreateInstanceResp>('/instance-create', { display_name: displayName })
}

export interface PairQr {
  base64?: string
  code?: string
  count?: number
  pairingCode?: string
}
export interface PairResp { ok: true; qr: PairQr }

export function pairInstance(id: string): Promise<PairResp> {
  return call<PairResp>('/instance-pair', { instance_id: id })
}

export function disconnectInstance(id: string): Promise<{ ok: true }> {
  return call('/instance-disconnect', { instance_id: id })
}

export function restartInstance(id: string): Promise<{ ok: true }> {
  return call('/instance-restart', { instance_id: id })
}

export type ManualPresence = 'auto' | 'online' | 'offline'

export interface PresenceResp {
  ok: true
  state: ManualPresence
  note?: string
  evolution_status?: number
}

export function setInstancePresence(id: string, state: ManualPresence): Promise<PresenceResp> {
  return call<PresenceResp>('/instance-presence', { instance_id: id, state })
}

/** Push the per-instance WA peer-side flag columns to Evolution /settings/set. */
export function pushWaSettings(id: string): Promise<{ ok: true; evolution_status: number }> {
  return call('/instance-wa-settings', { instance_id: id })
}

export type WaProfileField = 'name' | 'status' | 'picture'
export interface WaProfileResp {
  ok: true
  results: Record<WaProfileField, 'ok' | 'failed' | 'skipped'>
}
export interface PushWaProfileArgs {
  fields?: WaProfileField[]
  /** Optional inline base64 (data URL or plain base64). When provided AND
   *  fields includes 'picture', overrides the stored profile_pic_url. */
  pictureDataUrl?: string
}
export function pushWaProfile(id: string, args?: PushWaProfileArgs): Promise<WaProfileResp> {
  return call<WaProfileResp>('/instance-wa-profile', {
    instance_id: id,
    fields: args?.fields,
    picture_data_url: args?.pictureDataUrl,
  })
}

/** Push the canonical webhook subscription list to Evolution /webhook/set. */
export function resyncWebhookSubscription(id: string): Promise<{ ok: true; events: string[] }> {
  return call('/instance-webhook-resync', { instance_id: id })
}

export interface InstanceDeletePreflight {
  instance_id: string
  counts: Record<string, number>
  r2_keys: string[]
}
export interface InstanceDeleteSummary {
  counts: Record<string, number>
  r2_objects_deleted: number
  r2_errors: { key: string; code: string }[]
  evolution_status: 'deleted' | 'already_gone' | 'failed'
  evolution_error?: { status: number; body: unknown } | null
}

export async function instanceDeletePreflight(id: string): Promise<InstanceDeletePreflight> {
  const { data, error } = await supabase.schema('whatsapp').rpc('admin_instance_delete_preflight', { p_instance_id: id })
  if (error) throw new Error(error.message)
  return data as unknown as InstanceDeletePreflight
}

export async function deleteInstance(id: string): Promise<{ ok: true; summary: InstanceDeleteSummary }> {
  return call<{ ok: true; summary: InstanceDeleteSummary }>('/instance-delete', { instance_id: id })
}

export interface InstanceStatusResp {
  ok: true
  connection_state: { instance?: { state?: string; instanceName?: string } } | unknown
  detail: unknown
}

export function fetchStatus(id: string): Promise<InstanceStatusResp> {
  return call<InstanceStatusResp>('/instance-status', { instance_id: id })
}

// ─── WhatsApp number check ──────────────────────────────────────────────────

export interface CheckWhatsAppEntry {
  exists: boolean
  jid?: string
  number?: string
}

export interface CheckWhatsAppResp {
  ok: true
  result: CheckWhatsAppEntry[]
}

export function checkWhatsApp(instanceId: string, numbers: string[]): Promise<CheckWhatsAppResp> {
  return call<CheckWhatsAppResp>('/check-whatsapp', { instance_id: instanceId, numbers })
}

// ─── Group creation ─────────────────────────────────────────────────────────

export interface CreateGroupResp {
  ok: true
  result: { id?: string; groupJid?: string; [k: string]: unknown }
}

export function createGroup(instanceId: string, subject: string, participants: string[], image?: string): Promise<CreateGroupResp> {
  return call<CreateGroupResp>('/group-create', { instance_id: instanceId, subject, participants, ...(image ? { image } : {}) })
}

export interface LeaveGroupResp { ok: true; result: unknown }

export function leaveGroup(instanceId: string, groupJid: string): Promise<LeaveGroupResp> {
  return call<LeaveGroupResp>('/group-leave', { instance_id: instanceId, group_jid: groupJid })
}

export interface GroupParticipantsResp { ok: true; result: unknown }

export function updateGroupParticipants(
  instanceId: string,
  groupJid: string,
  action: 'add' | 'remove' | 'promote' | 'demote',
  participants: string[],
): Promise<GroupParticipantsResp> {
  return call<GroupParticipantsResp>('/group-update-participants', {
    instance_id: instanceId, group_jid: groupJid, action, participants,
  })
}

export function updateGroupSubject(
  instanceId: string,
  groupJid: string,
  subject: string,
): Promise<{ ok: true; result: unknown }> {
  return call('/group-update-subject', { instance_id: instanceId, group_jid: groupJid, subject })
}

/** Change the group icon. Omit `image` to attempt removal (may be unsupported). */
export function updateGroupPicture(
  instanceId: string,
  groupJid: string,
  image?: string,
): Promise<{ ok: true; result: unknown }> {
  return call('/group-update-picture', { instance_id: instanceId, group_jid: groupJid, image: image ?? '' })
}
