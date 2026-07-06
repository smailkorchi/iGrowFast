// Evolution API client for Supabase edge functions (Deno runtime).
//
// Parallel to the Node worker's client but minimal: edge functions only
// orchestrate instance LIFECYCLE (create / connect / disconnect / restart /
// delete / fetch / linked-devices) — never messaging. Messaging always goes
// through the queue-and-worker path.
//
// Auth: uses the GLOBAL api key for instance lifecycle. The per-instance
// token returned by /instance/create is stored in DB and used later by the
// worker for messaging.

const BASE_URL = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/$/, '')
const GLOBAL_KEY = Deno.env.get('EVOLUTION_GLOBAL_API_KEY') ?? ''

if (!BASE_URL) console.warn('EVOLUTION_API_URL not set')
if (!GLOBAL_KEY) console.warn('EVOLUTION_GLOBAL_API_KEY not set')

const DEFAULT_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'MESSAGES_SET',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
  'SEND_MESSAGE',
  // Required so the worker can resolve peer names + avatars for @lid and
  // unknown contacts the moment Evolution learns anything. Without these the
  // conversation list shows "Anonymous · #1234…" forever.
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'CHATS_UPSERT',
  'CHATS_UPDATE',
  // Realtime typing-indicator + online/last-seen events. Without this the
  // frontend can't show "X is typing…" for inbound presence.
  'PRESENCE_UPDATE',
  // Group lifecycle. GROUPS_UPSERT/GROUP_UPDATE carry create/subject/description/
  // icon; GROUP_PARTICIPANTS_UPDATE is the authoritative add/remove/promote/
  // demote/leave roster delta (drives group_participants sync, owner left_at
  // set/clear, and ALL participant-side system-event pills — the optimistic
  // edge-fn path only covers the actor's own number). MUST mirror
  // instance-webhook-resync's CANONICAL_EVENTS; without these here, every
  // instance created or re-paired ships a subscription that silently drops
  // group events for everyone but the action's initiator.
  // NB: Evolution v2.3.7's subscription enum uses GROUP_UPDATE (singular) —
  // GROUPS_UPDATE is rejected (400). The delivered envelope is still
  // `groups.update` / `group-participants.update`, which the worker handles.
  'GROUPS_UPSERT',
  'GROUP_UPDATE',
  'GROUP_PARTICIPANTS_UPDATE',
] as const

export interface CreateInstanceInput {
  instanceName: string
  token: string
  webhookUrl: string
  webhookSecret: string
  events?: readonly string[]
}

export interface EvolutionResult {
  ok: boolean
  status: number
  body: unknown
}

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  // Some endpoints (fetchInstances) accept a per-instance apikey to scope
  // results. Most lifecycle ops use the global key.
  apiKeyOverride?: string,
): Promise<EvolutionResult> {
  const url = `${BASE_URL}${path}`
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(url, {
      method,
      headers: {
        apikey: apiKeyOverride ?? GLOBAL_KEY,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : null,
      signal: controller.signal,
    })
    const text = await res.text()
    let parsed: unknown
    if (text) { try { parsed = JSON.parse(text) } catch { parsed = text } }
    return { ok: res.ok, status: res.status, body: parsed }
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(t)
  }
}

// ---- Instance lifecycle ---------------------------------------------------

export function createInstance(input: CreateInstanceInput): Promise<EvolutionResult> {
  return call('POST', '/instance/create', {
    instanceName: input.instanceName,
    integration: 'WHATSAPP-BAILEYS',
    token: input.token,
    qrcode: false,           // we fetch the QR via /instance/connect separately
    webhook: {
      enabled: true,
      url: input.webhookUrl,
      base64: false,         // keep webhook bodies small; media fetched on demand
      byEvents: false,       // single endpoint receives all event types
      events: input.events ?? [...DEFAULT_EVENTS],
      headers: { 'x-wa-mancer-secret': input.webhookSecret },
    },
    // Conservative defaults — explicit so they're audited in code, not relied
    // on at the Evolution side.
    rejectCall: false,
    groupsIgnore: false,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: true,    // we want the initial history sync to populate
  })
}

export function connectInstance(name: string): Promise<EvolutionResult> {
  return call('GET', `/instance/connect/${encodeURIComponent(name)}`)
}

export function connectionState(name: string): Promise<EvolutionResult> {
  return call('GET', `/instance/connectionState/${encodeURIComponent(name)}`)
}

export function restartInstance(name: string): Promise<EvolutionResult> {
  return call('POST', `/instance/restart/${encodeURIComponent(name)}`)
}

export function logoutInstance(name: string): Promise<EvolutionResult> {
  return call('DELETE', `/instance/logout/${encodeURIComponent(name)}`)
}

export function deleteInstance(name: string): Promise<EvolutionResult> {
  return call('DELETE', `/instance/delete/${encodeURIComponent(name)}`)
}

export function fetchInstanceDetail(name: string, instanceApiKey?: string): Promise<EvolutionResult> {
  const url = `/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`
  return call('GET', url, undefined, instanceApiKey)
}

// ---- Chat utilities -------------------------------------------------------

export function checkWhatsApp(name: string, numbers: string[]): Promise<EvolutionResult> {
  return call('POST', `/chat/whatsappNumbers/${encodeURIComponent(name)}`, { numbers })
}

/**
 * Project our own WhatsApp presence to all peers. Baileys' sendPresenceUpdate
 * without a target JID broadcasts `available` / `unavailable` globally. We
 * still pass `number` (the owner JID) because Evolution requires the field;
 * Baileys treats it as the local instance JID when targeting global presence.
 */
export function setOwnPresence(
  name: string,
  ownerJid: string,
  presence: 'available' | 'unavailable',
): Promise<EvolutionResult> {
  return call('POST', `/chat/sendPresence/${encodeURIComponent(name)}`, {
    number: ownerJid,
    presence,
    delay: 0,
  })
}

// ---- Settings / behavior --------------------------------------------------

export interface InstanceBehaviorSettings {
  rejectCall?:      boolean
  msgCall?:         string
  alwaysOnline?:    boolean
  readMessages?:    boolean
  readStatus?:      boolean
  groupsIgnore?:    boolean
  syncFullHistory?: boolean
}

/** Pushes behavior flags onto an Evolution instance. Maps directly to the
 *  payload accepted by /settings/set/<name>. */
export function setInstanceBehavior(
  name: string,
  settings: InstanceBehaviorSettings,
): Promise<EvolutionResult> {
  return call('POST', `/settings/set/${encodeURIComponent(name)}`, settings)
}

// ---- Profile push ---------------------------------------------------------

export function updateWaProfileName(name: string, newName: string): Promise<EvolutionResult> {
  return call('POST', `/chat/updateProfileName/${encodeURIComponent(name)}`, { name: newName })
}

export function updateWaProfileStatus(name: string, status: string): Promise<EvolutionResult> {
  return call('POST', `/chat/updateProfileStatus/${encodeURIComponent(name)}`, { status })
}

export function updateWaProfilePicture(name: string, pictureUrl: string): Promise<EvolutionResult> {
  return call('POST', `/chat/updateProfilePicture/${encodeURIComponent(name)}`, { picture: pictureUrl })
}

// ---- Webhook subscription -------------------------------------------------

export interface WebhookConfig {
  enabled: boolean
  url: string
  base64?: boolean
  byEvents?: boolean
  events: readonly string[]
  headers?: Record<string, string>
}

export function setInstanceWebhook(name: string, cfg: WebhookConfig): Promise<EvolutionResult> {
  return call('POST', `/webhook/set/${encodeURIComponent(name)}`, { webhook: cfg })
}

// ---- Group management ----------------------------------------------------

export function createGroup(name: string, subject: string, participants: string[]): Promise<EvolutionResult> {
  return call('POST', `/group/create/${encodeURIComponent(name)}`, { subject, participants })
}

export function updateGroupPicture(name: string, groupJid: string, imageBase64: string): Promise<EvolutionResult> {
  return call('POST', `/group/updateGroupPicture/${encodeURIComponent(name)}`, { groupJid, image: imageBase64 })
}

export function updateGroupSubject(name: string, groupJid: string, subject: string): Promise<EvolutionResult> {
  return call('POST', `/group/updateGroupSubject/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`, { subject })
}

export function leaveGroup(name: string, groupJid: string): Promise<EvolutionResult> {
  return call('DELETE', `/group/leaveGroup/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`)
}

export function updateGroupParticipants(
  name: string,
  groupJid: string,
  action: 'add' | 'remove' | 'promote' | 'demote',
  participants: string[],
): Promise<EvolutionResult> {
  return call('POST', `/group/updateParticipant/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`, { action, participants })
}
