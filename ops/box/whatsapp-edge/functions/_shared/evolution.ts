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

// Node-aware (fleet sharding): every exported fn takes the target node's Evolution
// base URL as its FIRST arg. Callers resolve it via resolveNodeBaseUrl(node_id)
// (_shared/node-routing.ts) — withInstance exposes it as ctx.evolutionBaseUrl, and
// instance-create resolves it from the node it places on. There is no module-level
// BASE_URL anymore: routing a lifecycle call to the wrong node was the whole bug.
const GLOBAL_KEY = Deno.env.get('EVOLUTION_GLOBAL_API_KEY') ?? ''

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
  baseUrl: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  // Some endpoints (fetchInstances) accept a per-instance apikey to scope
  // results. Most lifecycle ops use the global key.
  apiKeyOverride?: string,
): Promise<EvolutionResult> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`
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

export function createInstance(baseUrl: string, input: CreateInstanceInput): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', '/instance/create', {
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
    // OWNER RULING 2026-07-08 (one-week sync rule): request only WhatsApp's
    // small initial slice, not the multi-month full dump. The worker's sync
    // gates (SYNC_WINDOW_DAYS) enforce the window on whatever arrives; this
    // flag keeps Evolution from even requesting the bulk.
    syncFullHistory: false,
  })
}

export function connectInstance(baseUrl: string, name: string): Promise<EvolutionResult> {
  return call(baseUrl, 'GET', `/instance/connect/${encodeURIComponent(name)}`)
}

export function connectionState(baseUrl: string, name: string): Promise<EvolutionResult> {
  return call(baseUrl, 'GET', `/instance/connectionState/${encodeURIComponent(name)}`)
}

export function restartInstance(baseUrl: string, name: string): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/instance/restart/${encodeURIComponent(name)}`)
}

export function logoutInstance(baseUrl: string, name: string): Promise<EvolutionResult> {
  return call(baseUrl, 'DELETE', `/instance/logout/${encodeURIComponent(name)}`)
}

export function deleteInstance(baseUrl: string, name: string): Promise<EvolutionResult> {
  return call(baseUrl, 'DELETE', `/instance/delete/${encodeURIComponent(name)}`)
}

export function fetchInstanceDetail(baseUrl: string, name: string, instanceApiKey?: string): Promise<EvolutionResult> {
  const url = `/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`
  return call(baseUrl, 'GET', url, undefined, instanceApiKey)
}

// ---- Chat utilities -------------------------------------------------------

export function checkWhatsApp(baseUrl: string, name: string, numbers: string[]): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/chat/whatsappNumbers/${encodeURIComponent(name)}`, { numbers })
}

/**
 * Project our own WhatsApp presence to all peers. Baileys' sendPresenceUpdate
 * without a target JID broadcasts `available` / `unavailable` globally. We
 * still pass `number` (the owner JID) because Evolution requires the field;
 * Baileys treats it as the local instance JID when targeting global presence.
 */
export function setOwnPresence(
  baseUrl: string,
  name: string,
  ownerJid: string,
  presence: 'available' | 'unavailable',
): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/chat/sendPresence/${encodeURIComponent(name)}`, {
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
  baseUrl: string,
  name: string,
  settings: InstanceBehaviorSettings,
): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/settings/set/${encodeURIComponent(name)}`, settings)
}

// ---- Profile push ---------------------------------------------------------

export function updateWaProfileName(baseUrl: string, name: string, newName: string): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/chat/updateProfileName/${encodeURIComponent(name)}`, { name: newName })
}

export function updateWaProfileStatus(baseUrl: string, name: string, status: string): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/chat/updateProfileStatus/${encodeURIComponent(name)}`, { status })
}

export function updateWaProfilePicture(baseUrl: string, name: string, pictureUrl: string): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/chat/updateProfilePicture/${encodeURIComponent(name)}`, { picture: pictureUrl })
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

export function setInstanceWebhook(baseUrl: string, name: string, cfg: WebhookConfig): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/webhook/set/${encodeURIComponent(name)}`, { webhook: cfg })
}

// ---- Group management ----------------------------------------------------

export function createGroup(baseUrl: string, name: string, subject: string, participants: string[]): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/group/create/${encodeURIComponent(name)}`, { subject, participants })
}

export function updateGroupPicture(baseUrl: string, name: string, groupJid: string, imageBase64: string): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/group/updateGroupPicture/${encodeURIComponent(name)}`, { groupJid, image: imageBase64 })
}

export function updateGroupSubject(baseUrl: string, name: string, groupJid: string, subject: string): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/group/updateGroupSubject/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`, { subject })
}

export function leaveGroup(baseUrl: string, name: string, groupJid: string): Promise<EvolutionResult> {
  return call(baseUrl, 'DELETE', `/group/leaveGroup/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`)
}

export function updateGroupParticipants(
  baseUrl: string,
  name: string,
  groupJid: string,
  action: 'add' | 'remove' | 'promote' | 'demote',
  participants: string[],
): Promise<EvolutionResult> {
  return call(baseUrl, 'POST', `/group/updateParticipant/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`, { action, participants })
}
