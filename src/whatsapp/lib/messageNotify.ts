// Inbound-message notification engine.
//
// Consumes the SAME 'bump' broadcasts the list caches eat (waChannels →
// applyBump) and decides whether a bump represents a genuinely NEW inbound
// message worth a toast — bumps also fire for archive/pin/read/outbound/tag
// mutations and must stay silent. Opens NO channel of its own (architectural
// LAW: wa:biz / wa:user are the only realtime seams).
//
// FR preview labels mirror ChatRow's previewContent in
// routes/admin/conversations/parts.tsx — keep the two in sync.

import type { QueryClient } from '@tanstack/react-query'
import { conversationLabel } from './jid'
import { instanceKeys } from './queries/instances'
import { showWaMessageToast } from './messageToast'
import type { WhatsappInstance } from './database.types'

/**
 * Conversation currently open in a chat pane (admin inbox OR seller inbox —
 * only one is mounted at a time). Set/cleared by the route components' activeId
 * effects. A bump for this conversation on a FOCUSED tab is suppressed;
 * WhatsApp Web behavior: an unfocused tab still toasts.
 */
export const activeConversationRef: { current: string | null } = { current: null }

// Frozen bump-envelope fields (mig 047) the gate needs. Everything unknown-
// typed: the payload crosses a network boundary.
type BumpRow = {
  id?: unknown
  deleted?: unknown
  instance_id?: unknown
  remote_jid?: unknown
  is_group?: unknown
  peer_display_name?: unknown
  peer_profile_pic?: unknown
  contact_book_name?: unknown
  last_message_direction?: unknown
  last_inbound_at?: unknown
  unread_count?: unknown
  last_message_kind?: unknown
  last_message_preview?: unknown
  last_message_media_meta?: unknown
  last_message_sender_name?: unknown
}

// Per-conversation newest-seen last_inbound_at. A toast requires an ADVANCE
// past this; non-message bumps (archive/pin/read/tag) re-carry the old value
// and stay silent. Module-scoped: survives route changes, resets on page load
// (the cache baseline + freshness window below cover that gap). Bounded: the
// channels are now mounted for the whole session, so a long-lived tab on a
// high-volume business would otherwise grow this forever.
const lastInboundSeen = new Map<string, string>()
const TRACKED_MAX = 4000

// Cross-channel dedupe — a user receiving the same bump on wa:biz AND wa:user
// must toast once. Insertion-ordered Set, pruned at >300 entries.
const seenKeys = new Set<string>()
const SEEN_MAX = 300

// Last resort for a first sighting with NO tracked baseline AND no cached list
// row to compare against: only toast when the inbound is genuinely recent, else
// an archive/pin flip on a conversation whose last message was inbound long ago
// would toast. Kept narrow — the cache baseline handles the common case.
const FRESH_WINDOW_MS = 60_000

// Baseline for an untracked conversation: the PRE-bump cached list row (the
// notify call runs BEFORE applyBump patches the caches — ordering contract with
// waChannels). Same last_inbound_at as the bump ⇒ metadata-only change (archive,
// pin, read-flip, profile refresh, receipt) ⇒ silent. Older ⇒ real new inbound.
function cachedLastInboundAt(qc: QueryClient, conversationId: string): string | null | undefined {
  type CachedList = { pages?: Array<{ rows?: Array<{ id?: string; last_inbound_at?: string | null }> }> }
  for (const [, data] of qc.getQueriesData<CachedList>({ queryKey: ['conversations', 'list'] })) {
    for (const pg of data?.pages ?? []) {
      const hit = pg.rows?.find((r) => r.id === conversationId)
      if (hit) return hit.last_inbound_at ?? null
    }
  }
  return undefined   // conversation not in any loaded list
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/** Pure-string version of ChatRow's previewContent (parts.tsx) — same FR labels. */
export function waMessagePreviewLabel(row: {
  kind: string | null
  preview: string | null
  mediaMeta: unknown
  direction: string | null
  senderName: string | null
  isGroup: boolean
}): string {
  const { kind, direction, senderName, isGroup } = row
  const meta = (row.mediaMeta && typeof row.mediaMeta === 'object' ? row.mediaMeta : {}) as Record<string, unknown>
  const raw = (row.preview ?? '').trim()
  const body = isGroup ? raw.replace(/@\d{10,20}/g, '@mention') : raw

  let label: string
  if (meta.revoked === true) {
    label = meta.revoked_by === 'us' ? 'Vous avez supprimé ce message' : 'Ce message a été supprimé'
  } else {
    switch (kind) {
      case 'image':    label = body || 'Photo'; break
      case 'video':
        label = body || ((meta.gifPlayback === true || meta.isGif === true || meta.gif === true) ? 'GIF' : 'Vidéo')
        break
      case 'audio':
        label = body || ((meta.ptt === false || (meta.ptt !== true && !!meta.fileName)) ? 'Audio' : 'Message vocal')
        break
      case 'document': label = (typeof meta.fileName === 'string' && meta.fileName) || 'Document'; break
      case 'sticker':  label = 'Sticker'; break
      case 'contact':  label = 'Contact'; break
      case 'location': label = meta.subtype === 'live_location' ? 'Localisation en direct' : 'Localisation'; break
      case 'reaction': {
        const emoji = typeof meta.emoji === 'string' ? meta.emoji : ''
        label = direction === 'outbound'
          ? `Vous avez réagi par ${emoji}`
          : (isGroup && senderName ? `${senderName} a réagi par ${emoji}` : `A réagi par ${emoji}`)
        break
      }
      case 'system':   label = meta.subtype === 'view_once' ? 'Message à vue unique' : (body || '—'); break
      default:         label = body || '—'
    }
  }
  // Group sender prefix — same exclusions as the list row (reaction/system
  // carry the sender inside the label already).
  if (isGroup && senderName && kind !== 'reaction' && kind !== 'system') {
    return `${senderName}: ${label}`
  }
  return label
}

/**
 * Called from the wa:biz / wa:user bump handlers BEFORE applyBump — the
 * untracked-conversation baseline reads the PRE-bump cached row; after
 * applyBump the cache already carries the new last_inbound_at and every
 * metadata bump would look like a new message. Decides whether the bump is a
 * new inbound message and toasts it. NEVER throws — a notify failure must not
 * break the cache patching that shares the handler.
 */
export function maybeNotifyFromBump(
  qc: QueryClient,
  payload: unknown,
  opts: { role: 'admin' | 'agent'; navigate: (url: string) => void },
): void {
  try {
    const row = (payload && typeof payload === 'object' ? payload : null) as BumpRow | null
    if (!row || row.deleted === true) return
    const id = str(row.id)
    const instanceId = str(row.instance_id)
    if (!id || !instanceId) return
    if (row.last_message_direction !== 'inbound') return
    const lastInboundAt = str(row.last_inbound_at)
    if (!lastInboundAt) return
    // A genuine new inbound always arrives unread (mark-read is a LATER bump
    // with unread_count=0) — blocks the trailing read-flip after the thread
    // closes, which re-carries direction='inbound' + the same last_inbound_at.
    if (!(typeof row.unread_count === 'number' && row.unread_count > 0)) return

    // ADVANCE gate. The tracked value updates even when the toast is
    // suppressed below, so later non-message bumps never toast.
    const t = Date.parse(lastInboundAt)
    const tracked = lastInboundSeen.get(id)
    if (tracked === undefined) {
      lastInboundSeen.set(id, lastInboundAt)
      if (lastInboundSeen.size > TRACKED_MAX) {
        for (const k of lastInboundSeen.keys()) {
          lastInboundSeen.delete(k)
          if (lastInboundSeen.size <= TRACKED_MAX) break
        }
      }
      // No in-session baseline (fresh page load / evicted): compare against the
      // PRE-bump cached list row; only when the row isn't cached anywhere fall
      // back to the wall-clock freshness window.
      const cached = cachedLastInboundAt(qc, id)
      if (cached !== undefined) {
        if (cached === lastInboundAt) return               // metadata-only bump
        if (cached && !(t > Date.parse(cached))) return    // not an advance
      } else if (!(Date.now() - t < FRESH_WINDOW_MS)) {
        return                                             // stale first sighting
      }
    } else {
      if (!(t > Date.parse(tracked))) return
      lastInboundSeen.set(id, lastInboundAt)
    }

    // Cross-channel dedupe (dual wa:biz + wa:user delivery).
    const key = `${id}:${lastInboundAt}`
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    if (seenKeys.size > SEEN_MAX) {
      for (const k of seenKeys) {
        seenKeys.delete(k)
        if (seenKeys.size <= SEEN_MAX) break
      }
    }

    // Open + focused → the chat pane is already showing the message.
    if (activeConversationRef.current === id && document.hasFocus()) return

    const remoteJid = str(row.remote_jid)
    if (!remoteJid) return

    const instances = qc.getQueryData<WhatsappInstance[]>(instanceKeys.list)
    const inst = instances?.find((i) => i.id === instanceId)
    const instanceName = inst?.display_name || inst?.wa_profile_name || inst?.phone_number || 'WhatsApp'

    const isGroup = row.is_group === true
    const preview = waMessagePreviewLabel({
      kind: str(row.last_message_kind),
      preview: str(row.last_message_preview),
      mediaMeta: row.last_message_media_meta,
      direction: 'inbound',
      senderName: str(row.last_message_sender_name),
      isGroup,
    })

    // Deep-link carries BOTH params: the inbox switches to &instance before
    // resolving the jid, so the thread opens on the right number.
    const base = opts.role === 'admin' ? '/whatsapp/conversations' : '/seller/whatsapp'
    const url = `${base}?jid=${encodeURIComponent(remoteJid)}&instance=${encodeURIComponent(instanceId)}`
    showWaMessageToast(
      {
        conversationId: id,
        name: conversationLabel(remoteJid, str(row.peer_display_name), str(row.contact_book_name)),
        preview,
        // Owner ruling: the avatar identifies the RECEIVING NUMBER (instance
        // profile picture), not the customer.
        avatarUrl: inst?.profile_pic_url ?? null,
        instanceName,
      },
      () => opts.navigate(url),
    )
  } catch {
    /* never throw into the channel handler */
  }
}
