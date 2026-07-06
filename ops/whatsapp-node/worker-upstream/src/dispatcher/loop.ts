// Per-number async dispatcher loop.
//
// Lifecycle (controlled by instance manager — B5):
//   spawnDispatcher(instance)  → starts the loop
//   stopDispatcher(numberId)   → flags loop to exit after in-flight dispatch
//
// Loop body for one iteration:
//   1. claim_next via RPC (atomic queued→dispatching, FOR UPDATE SKIP LOCKED)
//      → returns null if nothing to dispatch
//      → returns null if instance is paused/banned (checked inside RPC)
//   2. Read pacing state (last send time + last contact) + remote_jid
//   3. crossContactGap() + pacing_take_token() → sleep (both 0 under normal use)
//   4. For send actions: send `composing` presence + sleep typing duration
//   5. Call Evolution
//   6. queue_mark_sent / queue_mark_failed / queue_mark_dead
//   7. recordDispatchCompleted() so the local drain-rate window counts it
//   8. Loop again. If queue empty, wait for NOTIFY or 5s timeout.
//
// Wake strategy: a per-number `wake` Promise resolves when the global NOTIFY
// handler signals this number's id was enqueued, OR when a 5s timeout elapses
// (catches not_before being reached, and gives us a heartbeat even when
// NOTIFY traffic is silent).

import { pool } from '../db.js'
import { log } from '../logger.js'
import { markDispatched, recordDispatchCompleted, setDispatchingCount, setQueueDepth } from '../heartbeat.js'
import { EvolutionClient, EvolutionError, type MessageKey, type MediaType, type WAPresence } from '../evolution/client.js'
import { getMediaBytes } from '../r2/client.js'
import { crossContactGap, typingDurationForText } from './pacing.js'
import { varyMediaHash } from './media-variation.js'
import {
  isInstanceAttended,
  attendedViewerCount,
  refreshActiveOpenPeer,
  setOnFirstAttend,
} from '../webhook/handlers.js'
import type {
  InstanceConfig,
  MessageKind,
  QueuedAction,
} from './types.js'

/** The dereferenced messages row the worker pulls before calling Evolution. */
interface OutboundMessage {
  id: string
  conversation_id: string
  instance_id: string
  kind: MessageKind
  body: string | null
  media_storage_bucket: string | null
  media_storage_key:    string | null
  media_mime:           string | null
  media_meta: Record<string, unknown> | null
  reply_to_message_id: string | null
  sent_by_agent_id: string | null
}

const MAX_ATTEMPTS = 4
const BACKOFF_SECONDS = [2, 8, 30, 120]   // attempts 1→2, 2→3, 3→4, 4→dead

// How long a conversation holds the number's single typing slot without a
// refresh before another conversation may take it. Must exceed the frontend
// composing refire cadence (~4s) so a continuously-typing agent keeps the slot,
// while a genuine stop (no refire, missed 'paused') frees it as a backstop.
const TYPING_SLOT_TTL_MS = 8_000

// ---- Canned multi-attachment burst spacing ---------------------------------
// A quick reply / scheduled message can carry several attachments; the client
// enqueues one send_media row per item, all to the SAME contact. sameContact
// zeroes the bucket + cross-gap, so without this they would fire at machine
// cadence. A real human selects/records each item separately, with a beat
// between them and a longer pause when switching modality (photo → video →
// voice → document). These bound that human spacing. Scoped to canned origins,
// so a solo agent rapid-firing typed lines stays instant.
const CANNED_BURST_WINDOW_MS = 60_000   // consecutive canned media within this = one burst
const CANNED_ITEM_MIN_MS = 2_000        // gap between same-modality items
const CANNED_ITEM_MAX_MS = 5_000
const CANNED_MODALITY_MIN_MS = 4_500    // gap when modality switches
const CANNED_MODALITY_MAX_MS = 9_000

// Voice-note `recording` pre-roll window. Real WhatsApp shows "recording
// audio…" for roughly the clip length; we scale to the captured duration but
// clamp so a long canned note never stalls the single per-number loop for
// minutes. Unknown duration → a natural jittered window.
const RECORDING_MIN_MS = 2_500
const RECORDING_MAX_MS = 15_000
const RECORDING_FALLBACK_MIN_MS = 3_000
const RECORDING_FALLBACK_SPAN_MS = 4_000

// Track running loops + their wake signals, keyed by number_id.
interface RunningLoop {
  instance: InstanceConfig
  client: EvolutionClient
  wakeResolvers: Array<() => void>
  shouldExit: boolean
  inflight: boolean
  /** When we last re-broadcast manual_presence to Evolution. We re-fire
   *  periodically so the override survives Baileys reconnects + admin
   *  intent persists across restarts. */
  lastPresenceReconcileAt: number
  /** Self-presence driver state (online-while-attended). lastSelfPresenceSent
   *  is the last value we pushed to Evolution; we only re-send on change or a
   *  periodic re-affirm. onlineSince marks when we went available (0 = offline).
   *  ownerJid is cached after first lookup (stable once paired). */
  lastSelfPresenceSent: WAPresence | null
  lastSelfPresenceSentAt: number
  onlineSince: number
  ownerJid: string | null | undefined
  /** Single typing slot for this number. A real WhatsApp number is one human,
   *  "in" one chat at a time — it must never show "typing…" to two contacts at
   *  once. Only the conversation holding the slot broadcasts composing/recording;
   *  others are suppressed until it sends, stops, or the slot expires. */
  typingHolderConvId: string | null
  typingHolderUntil: number
  /** Last canned (quick_reply/scheduled) media send — drives human burst
   *  spacing across a multi-attachment reply to one contact. */
  lastCannedConvId: string | null
  lastCannedKind: MessageKind | null
  lastCannedAt: number
}
const loops = new Map<string, RunningLoop>()

/** Called from the global LISTEN handler when outbound_enqueued fires. */
export function wakeLoop(numberId: string): void {
  const r = loops.get(numberId)
  if (!r) return
  const resolvers = r.wakeResolvers
  r.wakeResolvers = []
  for (const fn of resolvers) fn()
}

/** Called by instance manager when a new connected instance appears. */
export function spawnDispatcher(instance: InstanceConfig): void {
  if (loops.has(instance.id)) {
    log.warn('dispatcher.spawn.already_running', { number_id: instance.id })
    return
  }
  const client = new EvolutionClient({
    instance: instance.evolutionInstanceName,
    apiKey: instance.apiToken,
  })
  const r: RunningLoop = {
    instance,
    client,
    wakeResolvers: [],
    shouldExit: false,
    inflight: false,
    lastPresenceReconcileAt: 0,
    lastSelfPresenceSent: null,
    lastSelfPresenceSentAt: 0,
    onlineSince: 0,
    ownerJid: undefined,
    typingHolderConvId: null,
    typingHolderUntil: 0,
    lastCannedConvId: null,
    lastCannedKind: null,
    lastCannedAt: 0,
  }
  loops.set(instance.id, r)
  log.info('dispatcher.spawned', {
    number_id: instance.id,
    name: instance.evolutionInstanceName,
    lifecycle: instance.lifecycleState,
  })
  // Kick off the loop without awaiting — fire and forget.
  runLoop(r).catch((err) =>
    log.error('dispatcher.loop.fatal', {
      number_id: instance.id,
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}

/** Flag the loop to exit cleanly after the current dispatch (if any). */
export async function stopDispatcher(numberId: string): Promise<void> {
  const r = loops.get(numberId)
  if (!r) return
  r.shouldExit = true
  // Wake the loop so it can observe the flag and exit.
  for (const fn of r.wakeResolvers) fn()
  r.wakeResolvers = []
}

export function loopCount(): number { return loops.size }
export function inflightCount(): number {
  let n = 0
  for (const r of loops.values()) if (r.inflight) n++
  return n
}

/** Replace cached instance config (called when Realtime sees a change). */
export function updateInstanceConfig(numberId: string, next: Partial<InstanceConfig>): void {
  const r = loops.get(numberId)
  if (!r) return
  r.instance = { ...r.instance, ...next }
  // Wake so loop re-evaluates with new pacing/pause state.
  for (const fn of r.wakeResolvers) fn()
  r.wakeResolvers = []
}

// ---- Loop body --------------------------------------------------------------

async function runLoop(r: RunningLoop): Promise<void> {
  while (!r.shouldExit) {
    try {
      await iterate(r)
    } catch (err) {
      log.error('dispatcher.iteration.threw', {
        number_id: r.instance.id,
        error: err instanceof Error ? err.message : String(err),
      })
      // back off after unexpected errors to avoid hot-loop on permanent failures
      await waitForWakeOrTimeout(r, 5_000)
    }
  }
  loops.delete(r.instance.id)
  log.info('dispatcher.stopped', { number_id: r.instance.id })
}

async function iterate(r: RunningLoop): Promise<void> {
  // Gates apply ONLY to content sends (text/media/poll/react/edit/delete).
  // Passive actions (mark_read read receipts, typing presence) bypass both
  // the business-hours window and the capacity caps — they are low-risk
  // presence signals and "seen"/"typing" must work whenever an agent is
  // viewing, regardless of the clock or content budget. They still serialize
  // through this single per-number loop.
  const now = new Date()
  let contentAllowed = true
  let contentResumeMs = 5_000   // how long to idle when only content is blocked

  if (!withinDispatchWindow(r.instance, now)) {
    contentAllowed = false
    contentResumeMs = msUntilNextMinute(now)
  } else {
    const gate = await pool.query<{ allowed: boolean; reason: string | null; resume_at: string | null }>(
      'SELECT allowed, reason, resume_at FROM public.dispatch_gate_check($1)',
      [r.instance.id],
    )
    const g = gate.rows[0]
    if (g && !g.allowed) {
      contentAllowed = false
      const wait = g.resume_at ? Math.max(1_000, new Date(g.resume_at).getTime() - Date.now()) : 60_000
      contentResumeMs = Math.min(wait, 5 * 60 * 1000)
      log.debug('dispatcher.content_gated', { number_id: r.instance.id, reason: g.reason, wait_ms: wait })
    }
  }

  // Claim — when content is gated, only passive actions are eligible.
  const claim = await pool.query<QueuedAction & { dispatched_at: string | null; completed_at: string | null }>(
    'SELECT * FROM public.queue_claim_next($1, $2)',
    [r.instance.id, contentAllowed],
  )
  const row = claim.rows[0] ?? null
  if (!row || row.id == null) {
    // Nothing claimable. If content is gated there may be content rows
    // waiting — sleep until the gate reopens, but stay wakeable by NOTIFY so
    // a fresh passive action (read/typing) dispatches immediately.
    await drivePresence(r)
    await waitForWakeOrTimeout(r, contentAllowed ? 5_000 : contentResumeMs)
    return
  }

  r.inflight = true
  setDispatchingCount(inflightCount())
  try {
    await processAction(r, row)
  } finally {
    r.inflight = false
    setDispatchingCount(inflightCount())
  }
}

async function processAction(r: RunningLoop, row: QueuedAction): Promise<void> {
  // 2. Read pacing + conversation context (remote_jid comes from payload if
  // present — RPCs now embed it — but fall back to conversations row).
  const ctx = await pool.query<{
    last_send_at: Date | null
    last_send_conversation_id: string | null
    remote_jid: string
  }>(
    `SELECT p.last_send_at,
            p.last_send_conversation_id,
            c.remote_jid
       FROM public.number_pacing_state p
  LEFT JOIN public.conversations c ON c.id = $2
      WHERE p.number_id = $1`,
    [row.number_id, row.conversation_id],
  )
  const pacing = ctx.rows[0]
  if (!pacing) {
    log.error('dispatcher.missing_pacing_state', { number_id: row.number_id })
    await markFailed(row.id, 'pacing state missing', 30)
    return
  }
  const remoteJid = readStringOpt(row.payload, 'remote_jid') ?? pacing.remote_jid

  // 2b. For send_* actions, dereference the messages row up-front so we know
  // the body length (for typing pre-roll) and can update its delivery_status
  // after dispatch.
  let outboundMsg: OutboundMessage | null = null
  if (isMessageBackedAction(row.action_type)) {
    const messageId = readStringOpt(row.payload, 'message_id')
    if (!messageId) {
      log.error('dispatcher.payload_missing_message_id', { queue_id: row.id, action: row.action_type })
      await markDead(row.id, 'payload missing message_id')
      return
    }
    outboundMsg = await fetchOutboundMessage(messageId)
    if (!outboundMsg) {
      log.error('dispatcher.message_not_found', { queue_id: row.id, message_id: messageId })
      await markDead(row.id, `message ${messageId} not found`)
      return
    }
    // NOTE: we deliberately do NOT write an intermediate 'DISPATCHING' status
    // here. The optimistic bubble already renders a clock from 'PENDING'
    // (messageStatus.ts maps DISPATCHING and PENDING identically), so the
    // extra UPDATE was an invisible WAN round-trip on the critical path of
    // every send. The next status write is the folded SERVER_ACK inside
    // queue_mark_sent. On a send failure we still flip the row to FAILED below.
  }

  // 3. Pacing. Two layers, both invisible under normal solo/single-contact use:
  //   (a) cross-contact micro-gap — only when the number fast-switches between
  //       different contacts (the actual ban bullet). Same-contact rapid-fire
  //       and idle-then-send pass at full speed.
  //   (b) token bucket — the sustained per-number ceiling. Only content sends
  //       spend a token; the bucket is full (0 wait) until sustained
  //       multi-agent pressure drains it.
  // Passive actions (typing presence + read receipts) bypass both — ephemeral
  // signals that must stay real-time. The single per-number loop serializes
  // them; per-peer dedup happens upstream (frontend debounce + Evolution).
  const isPresenceOnly = row.action_type === 'typing_start'
    || row.action_type === 'typing_stop'
    || row.action_type === 'mark_read'
  const isContentSend = isSendType(row.action_type) && !isPresenceOnly

  // Same-contact consecutive send = a human firing several lines into ONE
  // chat. That is never a ban signal and must be INSTANT (the user's rule:
  // "one person, one contact, one after another — like real WhatsApp"). So it
  // bypasses the bucket, the cross-contact gap AND the typing pre-roll. Only
  // the hourly/daily HARD caps (dispatch_gate_check) still bound it. The gate
  // engages exclusively when the number switches to a DIFFERENT contact —
  // i.e. multiple contacts in flight (multi-agent / cross-contact), the real
  // bullet.
  const sameContact = isContentSend
    && pacing.last_send_conversation_id != null
    && pacing.last_send_conversation_id === row.conversation_id

  const cross = crossContactGap({
    now: new Date(),
    numberLastSendAt: pacing.last_send_at,
    numberLastSendConversationId: pacing.last_send_conversation_id,
    thisConversationId: row.conversation_id,
    isContentSend,
  })

  let tokenWaitMs = 0
  if (isContentSend && !sameContact) {
    const tb = await pool.query<{ wait_ms: number }>(
      'SELECT public.pacing_take_token($1, $2, $3) AS wait_ms',
      [row.number_id, r.instance.sendRatePerMin, r.instance.minuteBurstCap],
    )
    tokenWaitMs = tb.rows[0]?.wait_ms ?? 0
  }

  // Canned multi-attachment human spacing. When a quick reply / scheduled
  // message drains several media rows to the SAME contact, the bucket + gap are
  // bypassed (sameContact), so insert a jittered human beat between consecutive
  // items — larger on a modality switch. Only for canned media bursts; typed
  // interactive sends are untouched.
  const isCanned = row.origin === 'quick_reply' || row.origin === 'scheduled'
  let cannedBurstMs = 0
  if (
    isContentSend &&
    isCanned &&
    row.action_type === 'send_media' &&
    outboundMsg &&
    r.lastCannedConvId === row.conversation_id &&
    Date.now() - r.lastCannedAt < CANNED_BURST_WINDOW_MS
  ) {
    const modalitySwitch = r.lastCannedKind !== null && r.lastCannedKind !== outboundMsg.kind
    const [lo, hi] = modalitySwitch
      ? [CANNED_MODALITY_MIN_MS, CANNED_MODALITY_MAX_MS]
      : [CANNED_ITEM_MIN_MS, CANNED_ITEM_MAX_MS]
    cannedBurstMs = Math.round(lo + Math.random() * (hi - lo))
  }

  const waitMs = Math.max(cross.waitMs, tokenWaitMs, cannedBurstMs)
  log.debug('dispatcher.spacing', {
    number_id: row.number_id,
    action: row.action_type,
    origin: row.origin,
    wait_ms: waitMs,
    cross_reason: cross.reason,
    cross_ms: cross.waitMs,
    token_wait_ms: tokenWaitMs,
    canned_burst_ms: cannedBurstMs,
  })
  // Hard sleep (not wake-interruptible): a fresh NOTIFY must not cut a pacing
  // wait short, or the rate ceiling/cross-gap would leak. shouldExit still
  // aborts cleanly after the wait.
  if (waitMs > 0) {
    await sleep(waitMs)
    if (r.shouldExit) return
  }

  // 4. Pre-roll presence — ONLY for canned origins (quick replies + scheduled),
  // which had no live human typing. Typed 'interactive' sends already stream
  // live `composing` from the composer, and forwards relay plain (real WhatsApp
  // shows no typing). Per-instance configurable via typing_* columns.
  //
  // CRITICAL: the presence value must MATCH what a human actually does, or it
  // is a bot tell:
  //   - text                 → composing ("typing…"), scaled to text length
  //   - voice note (ptt)      → recording ("recording audio…"), scaled to clip
  //   - media WITH a caption  → composing (the human typed the caption)
  //   - media WITHOUT caption → NO indicator. Real WhatsApp shows nothing when
  //        you attach a photo/file. The canned-burst gap above is the human
  //        "selection" pause; a "typing…" here before a bare image is a tell.
  if (
    r.instance.typingEnabled &&
    isCanned &&
    outboundMsg &&
    (row.action_type === 'send_text' || row.action_type === 'send_media' || row.action_type === 'send_poll')
  ) {
    const caption = outboundMsg.body ?? readStringOpt(outboundMsg.media_meta ?? {}, 'caption') ?? ''
    const isVoiceNote =
      row.action_type === 'send_media' &&
      (readBool(row.payload, 'ptt') ||
        (outboundMsg.kind === 'audio' && readBool(outboundMsg.media_meta ?? {}, 'ptt')))

    let presence: WAPresence | null = null
    let holdMs = 0
    if (isVoiceNote) {
      presence = 'recording'
      holdMs = recordingDurationMs(outboundMsg.media_meta ?? {})
    } else if (row.action_type === 'send_text' || caption.length > 0) {
      presence = 'composing'
      holdMs = typingDurationForText(caption || outboundMsg.body || '', {
        baseMs:    r.instance.typingBaseMs,
        perCharMs: r.instance.typingPerCharMs,
        capMs:     r.instance.typingCapMs,
      })
    }
    // else: captionless media → presence stays null → no indicator, no sleep.

    if (presence) {
      // Fire DETACHED. Evolution holds the sendPresence HTTP open for `delay`
      // ms and does NOT serialize a number's calls (verified), so awaiting it
      // would double the stall and block the single per-number loop. The sleep
      // below is the intentional pre-send window; the presence hold runs
      // concurrently with it.
      const wa = presence
      void r.client.sendPresence({
        number: remoteJid,
        presence: wa,
        delay: holdMs,
      }).catch((err) =>
        log.warn('dispatcher.presence.failed', {
          number_id: row.number_id,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      await sleep(holdMs)
      if (r.shouldExit) return
    }
  }

  // 5. Dispatch.
  // Live typing presence (typing_start/typing_stop) is dispatched
  // FIRE-AND-FORGET. Evolution holds the sendPresence HTTP open for the
  // composing display window (~5s) and does NOT serialize a number's calls
  // (verified: an 8s-held call ran fully parallel to a 0.6s one). Awaiting it
  // here is the ONLY thing that stalled the single per-number loop and delayed
  // real messages. Detaching it lets content flow immediately while presence
  // runs concurrently; the queue row is marked sent right away (presence is
  // ephemeral / best-effort). Content sends stay fully awaited + ordered.
  //
  // SINGLE TYPING SLOT per number: a real WhatsApp number is one human, "in"
  // one chat at a time, so it must never broadcast "typing…" to two contacts at
  // once (that pattern outs a multi-operator number). At most ONE conversation
  // holds the slot; a second agent's typing is suppressed until the holder
  // sends, stops, or the slot times out. The holder renews on every refire, so
  // a continuously-typing agent keeps it; an explicit stop ('paused') or a sent
  // message releases it immediately for the next conversation.
  const fireDetached = (): void => {
    void dispatch(r.client, row, remoteJid, outboundMsg).catch((err) =>
      log.warn('dispatcher.presence.detached_failed', {
        number_id: row.number_id,
        action: row.action_type,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }
  let evolutionMsgId: string | null = null
  if (row.action_type === 'typing_start') {
    const now = Date.now()
    const slotFree = r.typingHolderConvId === null
      || r.typingHolderConvId === row.conversation_id
      || now > r.typingHolderUntil
    if (slotFree) {
      r.typingHolderConvId = row.conversation_id
      r.typingHolderUntil = now + TYPING_SLOT_TTL_MS
      fireDetached()
    } else {
      log.debug('dispatcher.typing_suppressed', {
        number_id: row.number_id,
        holder_conversation_id: r.typingHolderConvId,
        suppressed_conversation_id: row.conversation_id,
      })
      // not dispatched; row is consumed (marked sent) below.
    }
  } else if (row.action_type === 'typing_stop') {
    // Only the holder can clear the indicator; a stop from a non-holder is a
    // no-op (its composing was never broadcast).
    if (r.typingHolderConvId === row.conversation_id) {
      r.typingHolderConvId = null
      r.typingHolderUntil = 0
      fireDetached()
    }
  } else {
    try {
      evolutionMsgId = await dispatch(r.client, row, remoteJid, outboundMsg)
    } catch (err) {
      if (outboundMsg) {
        // surface failure to the agent UI
        await updateMessageStatus(outboundMsg.id, 'FAILED').catch(() => { /* best-effort */ })
      }
      return handleDispatchError(row, err)
    }
    // Agent sent in this conversation → done typing here; free the slot so
    // another conversation can show "typing…" without waiting out the TTL.
    if (r.typingHolderConvId === row.conversation_id) {
      r.typingHolderConvId = null
      r.typingHolderUntil = 0
    }
    // Remember canned media so the next item in the same reply earns a human
    // burst gap (and a larger one on modality switch).
    if (isCanned && row.action_type === 'send_media' && outboundMsg) {
      r.lastCannedConvId = row.conversation_id
      r.lastCannedKind = outboundMsg.kind
      r.lastCannedAt = Date.now()
    }
  }

  // 6. Mark queue row sent. queue_mark_sent now ALSO folds in the messages
  // SERVER_ACK + evolution_message_id update (for send_text/media/poll with a
  // real evolution id), so we no longer issue a separate UPDATE round-trip
  // here. One post-send WAN call instead of two.
  await pool.query(
    'SELECT public.queue_mark_sent($1, $2)',
    [row.id, evolutionMsgId ?? `local:${row.id}`],
  )
  markDispatched()
  recordDispatchCompleted()
  log.info('dispatcher.sent', {
    number_id: row.number_id,
    action: row.action_type,
    queue_id: row.id,
    msg_id: evolutionMsgId,
  })
}

// ---- Action → Evolution call dispatch table --------------------------------
//
// Payload contract (set by public.send_message / public.send_reaction /
// public.send_typing / public.send_read_receipt):
//
//   send_text / send_media / send_poll
//     {
//       message_id:      uuid,       // pending row in public.messages
//       remote_jid:      string,
//       kind:            MessageKind,
//       reply_to_message_id: uuid|null,
//       ptt:             boolean,    // true → use sendWhatsAppAudio
//       is_forward:      boolean,
//       forward_score:   number,
//       poll_options:    string[]|null
//     }
//
//   react
//     { remote_jid, evolution_message_id, emoji, from_me }
//
//   mark_read
//     { remote_jid, message_ids: string[] }
//
//   typing_start / typing_stop
//     { remote_jid }
//
// The original messages row content (body, media_url, media_meta) is fetched
// from public.messages_decrypted by the worker for send_* actions — payloads
// never carry plaintext bodies.

async function dispatch(
  client: EvolutionClient,
  row: QueuedAction,
  remoteJid: string,
  msg: OutboundMessage | null,
): Promise<string | null> {
  const p = row.payload
  switch (row.action_type) {
    case 'send_text': {
      if (!msg || !msg.body) throw new Error('send_text: message body missing')
      const quoted = await maybeBuildQuoted(msg.reply_to_message_id, remoteJid)
      const meta = (msg.media_meta as Record<string, unknown> | null)
      const mentioned = meta?.mentionedJid as string[] | undefined
      const mentionAll = meta?.mentionAll === true
      const r = await client.sendText({
        number: remoteJid,
        text: msg.body,
        ...(quoted ? { quoted } : {}),
        ...(mentioned?.length ? { mentioned } : {}),
        ...(mentionAll ? { mentionsEveryOne: true } : {}),
      })
      return r.key.id
    }
    case 'send_media': {
      if (!msg || !msg.media_storage_key) {
        throw new Error('send_media: media_storage_key missing')
      }
      const isPtt = readBool(p, 'ptt')

      // Pull bytes from R2. Evolution accepts base64 inline; R2 has zero
      // egress so the round-trip cost is just the worker's bandwidth.
      const dl = await getMediaBytes(msg.media_storage_key)
      const mime =
        msg.media_mime
        ?? dl.mimeType
        ?? readStringOpt(msg.media_meta ?? {}, 'mime_type')
        ?? readStringOpt(msg.media_meta ?? {}, 'mimetype')
        ?? null

      // PTT voice notes go through a dedicated Evolution endpoint. Audio bytes
      // are NOT varied (server re-encode + ogg page surgery is unsafe) — sent
      // as-is.
      if (isPtt || (msg.kind === 'audio' && readBool(msg.media_meta ?? {}, 'ptt'))) {
        const r = await client.sendWhatsAppAudio({
          number: remoteJid,
          audio: dl.body.toString('base64'),
          encoding: true,
        })
        return r.key.id
      }

      // Canned media (quick reply / scheduled) reuses identical R2 bytes for
      // every recipient → identical WhatsApp fileSha256 → a media fingerprint
      // at volume (ban-avoidance rule #9). Vary the bytes per send for the
      // formats where trailing data is safely ignored (jpeg/png/gif/pdf);
      // other types pass through unchanged.
      const isCanned = row.origin === 'quick_reply' || row.origin === 'scheduled'
      const variation = isCanned
        ? varyMediaHash(dl.body, mime)
        : { buffer: dl.body, varied: false }
      if (variation.varied) {
        log.debug('dispatcher.media_hash_varied', {
          number_id: row.number_id, queue_id: row.id, mime,
        })
      }
      const base64 = variation.buffer.toString('base64')

      let mediatype: MediaType = mapKindToMediaType(msg.kind)
      let fileName = readStringOpt(msg.media_meta ?? {}, 'file_name')
        ?? readStringOpt(msg.media_meta ?? {}, 'fileName')
      // ogg/opus audio sent as a FILE (ptt:false — voice notes already returned
      // above via sendWhatsAppAudio) does NOT deliver as mediatype=audio:
      // WhatsApp treats opus as the voice-note codec, the recipient device never
      // ACKs, and it stalls at SERVER_ACK. Send it as a DOCUMENT instead so it
      // delivers as a downloadable file. mp3/m4a/aac/wav keep mediatype=audio.
      if (msg.kind === 'audio' && /ogg|opus/i.test(mime ?? '')) {
        mediatype = 'document'
        if (!fileName) fileName = 'audio.ogg'
      }
      const caption = msg.body ?? readStringOpt(msg.media_meta ?? {}, 'caption')
      const r = await client.sendMedia({
        number: remoteJid,
        mediatype,
        media: base64,
        ...(mime ? { mimetype: mime } : {}),
        ...(fileName ? { fileName } : {}),
        ...(caption ? { caption } : {}),
      })
      return r.key.id
    }
    case 'send_poll': {
      if (!msg) throw new Error('send_poll: message row missing')
      const question = msg.body ?? readStringOpt(msg.media_meta ?? {}, 'question')
      if (!question) throw new Error('send_poll: question missing')
      const raw = p['poll_options']
      if (!Array.isArray(raw) || raw.length < 2) {
        throw new Error('send_poll: poll_options must be string[] of length ≥ 2')
      }
      const values = raw.map(String)
      const selectableCount = readNumber(p, 'selectable_count', 1)
      const r = await client.sendPoll({
        number: remoteJid,
        name: question,
        selectableCount,
        values,
      })
      return r.key.id
    }
    case 'send_contact': {
      // Structured contact cards live on the message row's media_meta.contacts
      // (the picker packs both the structured fields — for Evolution to build
      // the protocol vCard — and the vcard string(s) for our own rendering).
      const meta = (msg?.media_meta as Record<string, unknown> | null)
      const cards = meta?.['contacts'] as Array<{ fullName: string; phoneNumber: string; wuid?: string }> | undefined
      if (!msg || !Array.isArray(cards) || cards.length === 0) {
        throw new Error('send_contact: contacts missing')
      }
      const r = await client.sendContact({ number: remoteJid, contact: cards })
      return r.key.id
    }
    case 'react': {
      const eid = readString(p, 'evolution_message_id')
      const emoji = readString(p, 'emoji')
      const fromMe = readBool(p, 'from_me')
      const key: MessageKey = { id: eid, fromMe, remoteJid }
      const r = await client.sendReaction({ key, reaction: emoji })
      return r.key.id
    }
    case 'mark_read': {
      const ids = p['message_ids']
      if (!Array.isArray(ids)) throw new Error('mark_read: message_ids must be array')
      const keys: MessageKey[] = ids.map((id) => ({
        id: String(id),
        fromMe: false,            // we only ever read-receipt inbound msgs
        remoteJid,
      }))
      await client.markMessageAsRead({ readMessages: keys })
      return null
    }
    case 'typing_start': {
      // Evolution v2.3.7 sendPresence: `delay` = display duration in ms.
      // Evolution sends presence → holds for delay ms → auto-clears.
      // The presence kind comes from the payload — 'composing' for text
      // typing, 'recording' for voice note recording. Frontend re-fires
      // every ~4s while active to refresh the 5s display window.
      const presenceKind = readStringOpt(p, 'presence')
      const wa: WAPresence = (presenceKind === 'recording' ? 'recording' : 'composing')
      await client.sendPresence({
        number: remoteJid,
        presence: wa,
        delay: readNumber(p, 'delay', 5_000),
      })
      return null
    }
    case 'typing_stop': {
      // Evolution v2.3.7's sendPresence accepts only 'composing' and
      // 'recording'. There's no explicit "clear" — the indicator naturally
      // expires when the composing window's delay elapses. So 'typing_stop'
      // is effectively a no-op at the protocol layer; we keep the path for
      // observability (queue row + audit) but Evolution will ignore the
      // 'paused' value or reject it. Customer's indicator clears at the
      // end of the previous composing's delay window (≤5s).
      try {
        await client.sendPresence({ number: remoteJid, presence: 'paused', delay: 0 })
      } catch {
        // Evolution may reject 'paused' as an unsupported presence — ignore.
      }
      return null
    }
    case 'edit_message': {
      const key = readKey(p, 'key')
      const text = readString(p, 'text')
      const r = await client.updateMessage({ number: remoteJid, key, text })
      return r.key.id
    }
    case 'delete_message': {
      const key = readKey(p, 'key')
      await client.deleteMessage({
        id: key.id,
        fromMe: key.fromMe,
        remoteJid: key.remoteJid,
        ...(key.participant ? { participant: key.participant } : {}),
      })
      return null
    }
  }
}

/**
 * How long to hold `recording` presence before a canned voice note. Scaled to
 * the captured clip length (media_meta.seconds), clamped so a long note never
 * stalls the per-number loop for minutes. Unknown duration → jittered window.
 */
function recordingDurationMs(meta: Record<string, unknown>): number {
  const sec = normalizeSeconds(meta['seconds'] ?? meta['duration_seconds'])
  if (sec && sec > 0) {
    return Math.min(RECORDING_MAX_MS, Math.max(RECORDING_MIN_MS, Math.round(sec * 1000)))
  }
  return RECORDING_FALLBACK_MIN_MS + Math.round(Math.random() * RECORDING_FALLBACK_SPAN_MS)
}

/** Normalize a duration-in-seconds that may arrive as number, numeric string,
 *  or a protobuf Long ({ low, high }). Returns undefined if not parseable. */
function normalizeSeconds(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  if (v && typeof v === 'object' && typeof (v as { low?: unknown }).low === 'number') {
    return (v as { low: number }).low
  }
  return undefined
}

function mapKindToMediaType(kind: MessageKind): MediaType {
  switch (kind) {
    case 'image':    return 'image'
    case 'video':    return 'video'
    case 'audio':    return 'audio'
    case 'document': return 'document'
    default:
      throw new Error(`unsupported media kind: ${kind}`)
  }
}

/** True if the action consumes a row in public.messages. */
function isMessageBackedAction(t: QueuedAction['action_type']): boolean {
  return t === 'send_text' || t === 'send_media' || t === 'send_poll'
      || t === 'send_contact'
}

function isSendType(t: QueuedAction['action_type']): boolean {
  return t === 'send_text' || t === 'send_media' || t === 'send_poll'
      || t === 'react' || t === 'edit_message' || t === 'delete_message'
      || t === 'send_contact'
}

// ---- message dereference helpers ------------------------------------------

async function fetchOutboundMessage(id: string): Promise<OutboundMessage | null> {
  const res = await pool.query<OutboundMessage>(
    `SELECT id, conversation_id, instance_id, kind, body,
            media_storage_bucket, media_storage_key, media_mime, media_meta,
            reply_to_message_id, sent_by_agent_id
       FROM public.messages_decrypted
      WHERE id = $1`,
    [id],
  )
  return res.rows[0] ?? null
}

async function updateMessageStatus(id: string, status: string): Promise<void> {
  await pool.query(
    `UPDATE public.messages SET delivery_status = $1 WHERE id = $2`,
    [status, id],
  )
}

/**
 * Best-effort lookup of the original message's WhatsApp key so we can quote
 * it in the outbound payload. Returns undefined if the source is still
 * pending (no evolution_message_id yet).
 */
async function maybeBuildQuoted(
  replyToId: string | null,
  remoteJid: string,
): Promise<{ key: MessageKey; message: unknown } | undefined> {
  if (!replyToId) return undefined
  const res = await pool.query<{ evolution_message_id: string | null; direction: 'inbound' | 'outbound'; sender_jid: string | null }>(
    `SELECT evolution_message_id, direction, sender_jid
       FROM public.messages WHERE id = $1`,
    [replyToId],
  )
  const row = res.rows[0]
  if (!row || !row.evolution_message_id) return undefined
  return {
    key: {
      id: row.evolution_message_id,
      fromMe: row.direction === 'outbound',
      remoteJid,
      ...(row.sender_jid ? { participant: row.sender_jid } : {}),
    },
    message: {},
  }
}

async function markDead(queueId: string, reason: string): Promise<void> {
  await pool.query('SELECT public.queue_mark_dead($1, $2)', [queueId, reason])
}

function readString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key]
  if (typeof v !== 'string') throw new Error(`payload missing string field: ${key}`)
  return v
}

function readStringOpt(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === 'string' ? v : undefined
}

function readBool(obj: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = obj[key]
  return typeof v === 'boolean' ? v : fallback
}

function readNumber(obj: Record<string, unknown>, key: string, fallback: number): number {
  const v = obj[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function readKey(obj: Record<string, unknown>, key: string): MessageKey {
  const v = obj[key]
  if (!v || typeof v !== 'object') throw new Error(`payload missing key object: ${key}`)
  const k = v as Record<string, unknown>
  if (typeof k['id'] !== 'string' || typeof k['fromMe'] !== 'boolean' || typeof k['remoteJid'] !== 'string') {
    throw new Error(`payload.${key} malformed`)
  }
  const out: MessageKey = {
    id: k['id'] as string,
    fromMe: k['fromMe'] as boolean,
    remoteJid: k['remoteJid'] as string,
  }
  if (typeof k['participant'] === 'string') {
    out.participant = k['participant']
  }
  return out
}

// ---- Error handling --------------------------------------------------------

async function handleDispatchError(row: QueuedAction, err: unknown): Promise<void> {
  const isEvolution = err instanceof EvolutionError
  const retryable = isEvolution ? err.isRetryable : true   // network errors → retry
  const nextAttempt = row.attempts                          // already incremented by claim
  const errMsg = err instanceof Error ? err.message : String(err)

  if (!retryable || nextAttempt >= MAX_ATTEMPTS) {
    log.error('dispatcher.dead', {
      number_id: row.number_id,
      queue_id: row.id,
      action: row.action_type,
      attempts: nextAttempt,
      error: errMsg,
    })
    await pool.query('SELECT public.queue_mark_dead($1, $2)', [row.id, errMsg])
    return
  }

  const backoffIndex = Math.min(nextAttempt, BACKOFF_SECONDS.length) - 1
  const backoff = BACKOFF_SECONDS[Math.max(0, backoffIndex)]!
  log.warn('dispatcher.retry', {
    number_id: row.number_id,
    queue_id: row.id,
    action: row.action_type,
    attempts: nextAttempt,
    retry_in_seconds: backoff,
    error: errMsg,
  })
  await markFailed(row.id, errMsg, backoff)
}

async function markFailed(id: string, error: string, retryInSeconds: number): Promise<void> {
  await pool.query(
    'SELECT public.queue_mark_failed($1, $2, $3)',
    [id, error, retryInSeconds],
  )
}

// ---- Wake plumbing ----------------------------------------------------------

function waitForWakeOrTimeout(r: RunningLoop, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (r.shouldExit) { resolve(); return }
    let resolved = false
    const done = () => { if (!resolved) { resolved = true; resolve() } }
    r.wakeResolvers.push(done)
    const t = setTimeout(done, timeoutMs)
    // Make sure clearing happens whichever path wins
    const orig = done
    const wrap = () => { clearTimeout(t); orig() }
    r.wakeResolvers[r.wakeResolvers.length - 1] = wrap
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---- Queue-depth observability ---------------------------------------------
// Called periodically (heartbeat-aligned) to refresh queue_depth used by the
// worker_health row. Light SELECT — cheap with the partial dispatch index.

export async function refreshQueueDepth(): Promise<void> {
  const { rows } = await pool.query<{ depth: string }>(
    `SELECT COUNT(*)::text AS depth FROM public.outbound_queue WHERE status = 'queued'`,
  )
  setQueueDepth(Number(rows[0]?.depth ?? '0'))
}

// ---- Schedule + presence gates ---------------------------------------------

/**
 * Decide whether the dispatcher is allowed to claim work right now, based on:
 *   - business_hours window (timezone-aware)
 *   - quiet_hours_override_until (one-shot punch-through; if in the future,
 *     we dispatch regardless of the schedule)
 *
 * Tolerant of missing/malformed business_hours JSONB — defaults to 24/7
 * rather than blocking the dispatcher entirely.
 */
function withinDispatchWindow(cfg: InstanceConfig, now: Date): boolean {
  // Admin-controlled toggle: when business_hours_enabled is false (default
  // for new instances), dispatcher dispatches 24/7. quiet_hours_override_until
  // remains an admin punch-through for emergency dispatching regardless.
  if (!cfg.businessHoursEnabled) return true

  // Quiet-hours override punches through the schedule until it expires.
  if (cfg.quietHoursOverrideUntil) {
    const until = new Date(cfg.quietHoursOverrideUntil).getTime()
    if (Number.isFinite(until) && until > now.getTime()) return true
  }

  const hours = cfg.businessHours
  if (!hours || typeof hours !== 'object' || !hours.tz || !hours.open || !hours.close) return true

  // Render `now` in the instance's timezone and check (day-of-week + HH:MM).
  let dayNum: number
  let hhmm: string
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: hours.tz,
      hourCycle: 'h23',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(now)
    const partMap: Record<string, string> = {}
    for (const p of parts) partMap[p.type] = p.value
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    dayNum = weekdayMap[partMap['weekday'] ?? ''] ?? -1
    const h = partMap['hour'] ?? '00'
    const m = partMap['minute'] ?? '00'
    hhmm = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
  } catch {
    // Unknown timezone — be permissive rather than block all sends.
    return true
  }

  const days = Array.isArray(hours.days) && hours.days.length > 0 ? hours.days : [0, 1, 2, 3, 4, 5, 6]
  if (!days.includes(dayNum)) return false

  // Overnight windows ("22:00" → "06:00") need split-comparison.
  const o = hours.open, c = hours.close
  if (o <= c) return hhmm >= o && hhmm < c
  return hhmm >= o || hhmm < c
}

function msUntilNextMinute(now: Date): number {
  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setMinutes(now.getMinutes() + 1)
  return Math.max(1_000, next.getTime() - now.getTime())
}

/**
 * Periodically reconcile the number's global online presence.
 *
 * BAN SAFETY: a Baileys number that shows "online" 24/7 is a strong bot
 * signal. Baileys marks the device `available` on connect and the socket
 * stays open for days, so without this reconcile the number is permanently
 * online. We counter that here:
 *
 *   manual_presence = 'online'  → force `available` (admin keeps it online)
 *   manual_presence = 'offline' → force `unavailable`
 *   manual_presence = 'auto'    → DEFAULT `unavailable` (offline). The number
 *                                 only appears online transiently while an
 *                                 agent is actively replying — the per-send
 *                                 `composing` presence makes it look online
 *                                 for the duration of the reply, then it
 *                                 reverts to offline. Human, not 24/7.
 *
 * Runs on the idle path every 60 s (and once shortly after boot), so an idle
 * number settles to offline quickly. While actively replying the loop is busy
 * (not idle), so this doesn't fight the composing presence mid-reply.
 */
// Re-affirm an unchanged 'available' at least this often so the online state
// survives a Baileys reconnect even when nothing else changes.
const SELF_PRESENCE_REAFFIRM_MS = 60_000

async function getOwnerJid(r: RunningLoop): Promise<string | null> {
  if (r.ownerJid) return r.ownerJid              // cached (stable once paired)
  try {
    const { rows } = await pool.query<{ wa_owner_jid: string | null }>(
      `SELECT wa_owner_jid FROM public.whatsapp_instances WHERE id = $1`,
      [r.instance.id],
    )
    const jid = rows[0]?.wa_owner_jid ?? null
    if (jid) r.ownerJid = jid                    // cache only a real value
    return jid
  } catch (err) {
    log.warn('dispatcher.presence_reconcile.owner_lookup_failed', {
      number_id: r.instance.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Self-presence driver. Resolves the desired online state and pushes it to
 * Evolution only on change (or a periodic re-affirm while online). 'auto' is
 * ATTENDANCE-AWARE: online while an agent has the inbox open+visible, offline
 * otherwise — so WhatsApp keeps delivering peer typing the whole attended
 * window. While online it also keeps the focused peer's subscription warm.
 *
 * Runs on an INDEPENDENT timer (drivePresenceAll), NOT only the dispatcher
 * idle path — otherwise a long send burst would pin the number online past the
 * grace period (the ban-safety hole the design review caught).
 */
async function drivePresence(r: RunningLoop): Promise<void> {
  const m = r.instance.manualPresence
  const desired: WAPresence =
    m === 'online' ? 'available'
    : m === 'offline' ? 'unavailable'
    : (isInstanceAttended(r.instance.id) ? 'available' : 'unavailable')

  const now = Date.now()
  // Never stomp an in-flight typing/recording window with 'unavailable' — let
  // the composing presence finish; the next tick will revert if still due.
  if (desired === 'unavailable' && now < r.typingHolderUntil) return

  const changed = desired !== r.lastSelfPresenceSent
  const stale = r.lastSelfPresenceSentAt > 0 && now - r.lastSelfPresenceSentAt > SELF_PRESENCE_REAFFIRM_MS
  if (changed || (desired === 'available' && stale)) {
    const ownerJid = await getOwnerJid(r)
    if (!ownerJid) return
    try {
      await r.client.sendPresence({ number: ownerJid, presence: desired, delay: 0 })
      r.lastSelfPresenceSent = desired
      r.lastSelfPresenceSentAt = now
      r.onlineSince = desired === 'available' ? (r.onlineSince || now) : 0
      log.info('dispatcher.self_presence', {
        number_id: r.instance.id,
        manual_presence: m,
        sent: desired,
        attended: isInstanceAttended(r.instance.id),
        viewer_count: attendedViewerCount(r.instance.id),
      })
    } catch (err) {
      log.warn('dispatcher.presence_reconcile.send_failed', {
        number_id: r.instance.id,
        presence: desired,
        error: err instanceof Error ? err.message : String(err),
      })
      return
    }
  }
  // While online, keep the focused peer subscription warm (sub-50s cadence via
  // the self-presence timer) so WhatsApp keeps pushing its typing events.
  if (desired === 'available') refreshActiveOpenPeer(r.instance.id)
}

// ---- Independent self-presence timer ---------------------------------------
// Decoupled from the dispatcher claim loop so online<->offline transitions
// honor the attendance grace regardless of how busy the send queue is.
const SELF_PRESENCE_TICK_MS = 10_000
let selfPresenceTimer: ReturnType<typeof setInterval> | null = null

export function startSelfPresenceLoop(): void {
  if (selfPresenceTimer) return
  // The FIRST attend flips an offline number online immediately (~1s) instead
  // of waiting up to one tick.
  setOnFirstAttend((instanceId) => {
    const r = loops.get(instanceId)
    if (r) void drivePresence(r)
  })
  selfPresenceTimer = setInterval(() => {
    for (const r of loops.values()) {
      void drivePresence(r).catch(() => undefined)
    }
  }, SELF_PRESENCE_TICK_MS)
  if (typeof selfPresenceTimer.unref === 'function') selfPresenceTimer.unref()
  log.info('dispatcher.self_presence_loop.started', { interval_ms: SELF_PRESENCE_TICK_MS })
}

export function stopSelfPresenceLoop(): void {
  if (selfPresenceTimer) { clearInterval(selfPresenceTimer); selfPresenceTimer = null }
  setOnFirstAttend(() => undefined)
}
