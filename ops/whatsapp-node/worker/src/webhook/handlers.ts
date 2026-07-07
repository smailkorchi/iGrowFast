// Per-event handlers. Each handler is small and side-effects-only — writes
// into Supabase via the pg pool, returns nothing.
//
// Source-of-truth principle: the `messages` table is OWNED by these handlers.
// The dispatcher loop does NOT write to messages; it only marks the queue
// row sent + records `evolution_msg_id`. Reconciliation between an outbound
// queue row and its real WA message happens via `evolution_message_id`
// match when the corresponding messages.upsert webhook arrives.

import { pool, supabase } from '../db.js'
import { config } from '../config.js'
import { log } from '../logger.js'
import { invalidateSecretCache } from './verify.js'
import { EvolutionClient } from '../evolution/client.js'
import { cacheAvatar, isCachedAvatar } from '../r2/avatar.js'

// Message kinds whose payload is a binary blob held by Evolution; we fetch +
// re-host these to R2 so links don't expire after Evolution's ~14d cache.
function isMediaKind(kind: string): boolean {
  return (
    kind === 'image' ||
    kind === 'video' ||
    kind === 'audio' ||
    kind === 'document' ||
    kind === 'sticker'
  )
}
import type {
  ConnectionUpdateData,
  EvolutionWebhookEnvelope,
  PresenceUpdateData,
  QrCodeUpdatedData,
  WAMessageContent,
  WAMessageData,
} from './types.js'

// ---- Owner profile cache (avoids per-message DB lookup) ------------------
const ownerProfileCache = new Map<string, { profileName: string | null; ownerJid: string | null; ts: number }>()

async function getOwnerProfile(instanceId: string): Promise<{ profileName: string | null; ownerJid: string | null }> {
  const cached = ownerProfileCache.get(instanceId)
  if (cached && Date.now() - cached.ts < 3600_000) return cached
  const { rows } = await pool.query<{ wa_profile_name: string | null; wa_owner_jid: string | null }>(
    'SELECT wa_profile_name, wa_owner_jid FROM whatsapp.whatsapp_instances WHERE id = $1',
    [instanceId],
  )
  const r = { profileName: rows[0]?.wa_profile_name ?? null, ownerJid: rows[0]?.wa_owner_jid ?? null }
  ownerProfileCache.set(instanceId, { ...r, ts: Date.now() })
  return r
}

// ---- JID mapping: persist LID↔phone discoveries ----------------------------

async function captureJidMapping(
  instanceId: string,
  lid: string,
  phoneJid: string,
  pushName: string | null,
  source: 'same_envelope_alt' | 'group_participants' = 'same_envelope_alt',
): Promise<void> {
  try {
    // jid_mapping: legacy READ-only (lid, phone) store still consulted by
    // resolveLidToPhoneJid / _canonical_remote_jid. Shape unchanged.
    await pool.query(
      `SELECT whatsapp.upsert_jid_mapping($1, $2, $3, $4)`,
      [instanceId, lid, phoneJid, 'message_alt'],
    )
    // IGF HARDENING (2026-07-06): drop the presence resolver's negative-cache
    // entry the moment a pair is learned. Before this, every resolve failure
    // pre-learn cached phoneJid=null for LID_RESOLVE_TTL_MS (10 min) — a fresh
    // contact's typing stayed dark for up to 10 minutes AFTER their first
    // message taught us the mapping. Donor has the same latent blackout.
    lidResolveCache.delete(`${instanceId}:${lid}`)
    // Contact Bible: this is a DETERMINISTIC same-source (lid, phone) pair — the
    // engine itself stated both address ONE contact (same message envelope, or
    // the same group-roster row), NOT a temporal guess (the removed presence
    // guesser is what caused contact fusion). Register the phone and link the lid
    // as its alt through resolve_identity (the single bible writer). With
    // identity_merge_enabled FALSE (default for all instances) link_alt only
    // INSERTs the alt when unowned, else logs a merge_review row — it NEVER fuses
    // two existing contacts. This is what lets @lid presence resolve onto a
    // phone-keyed conversation.
    if (phoneJid.endsWith('@s.whatsapp.net') && lid.endsWith('@lid')) {
      await pool.query(
        `SELECT whatsapp.resolve_identity($1, $2, 'phone', $3::identifier_source, $4, 'lid', $5, NULL)`,
        [instanceId, phoneJid, source, lid, pushName],
      )
      // Now that the bible deterministically links this @lid to a phone, collapse
      // any existing @lid conversation into the phone thread immediately (so a
      // contact's history lands in ONE correctly-ordered thread). Gated server-side
      // to the same single-contact-owns-both signal; never fuses two contacts, never
      // touches an unresolvable @lid. Best-effort — must never block ingest.
      await pool.query(`SELECT whatsapp.consolidate_lid($1, $2)`, [instanceId, lid])
    }
  } catch (err) {
    log.warn('webhook.jid_mapping.capture_failed', {
      instance_id: instanceId, lid, phone_jid: phoneJid,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Record history-sync progress/completion from a messages.set batch so the
// pairing modal can wait for a GENUINE finish (vs. guessing from message rate).
// Evolution v2.3.7+ carries `isLatest`/`progress` on the batch; serialization
// varies, so scan tolerantly: the data may be an array of WAMessage-ish items,
// an object with a `messages` array, or an object carrying the flags directly.
// Best-effort — never blocks ingest.
// ---- History-sync completion: SETTLE-BASED (IGF fix 2026-07-06) ------------
//
// Evolution/Baileys messages.set batches carry {isLatest, progress} PER SLICE:
// WhatsApp uploads the RECENT slice FIRST (isLatest:true, its own progress
// hitting 100) and the older FULL chunks AFTER — so the flags alone fire
// minutes early on real phones. Measured on a live pair: flag-stamp at
// connect+3.8s while 99.8% of the history ingested AFTER it (5.4k messages
// still streaming). The donor has no reference here: its stamp path was dead
// (fe72cad), so these semantics were never exercised.
//
// Completion therefore = flag seen AND no further messages.set batch for
// SYNC_SETTLE_MS. Each batch re-arms the timer; the stamp fires once, after
// the dump goes quiet. If the engine never emits a flag, nothing stamps and
// the PairDialog's MAX_SYNCING_SECONDS degrade covers it (donor behavior).
// 180s: a live rich-phone dump showed a 139s WhatsApp-side pause BETWEEN
// slices (measured via ingest created_at gaps) — any shorter window stamps
// mid-dump. Cost: PRET lands ~3min after the final batch. Refine once
// webhook.sync_batch logs reveal whether progress-only is a trustworthy
// completion flag.
const SYNC_SETTLE_MS = 180_000
const syncFlagSeen = new Set<string>()
const syncSettleTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Called on a genuine (re)connect transition — a new sync cycle begins. */
function resetSyncSettle(instanceId: string): void {
  syncFlagSeen.delete(instanceId)
  const t = syncSettleTimers.get(instanceId)
  if (t) { clearTimeout(t); syncSettleTimers.delete(instanceId) }
}

function armSyncSettle(instanceId: string): void {
  const prev = syncSettleTimers.get(instanceId)
  if (prev) clearTimeout(prev)
  syncSettleTimers.set(instanceId, setTimeout(() => {
    syncSettleTimers.delete(instanceId)
    if (!syncFlagSeen.has(instanceId)) return   // flags never arrived — let the dialog degrade
    syncFlagSeen.delete(instanceId)
    void (async () => {
      try {
        await pool.query(
          `UPDATE whatsapp.whatsapp_instances
              SET history_synced_at = now(),
                  sync_progress = 100
            WHERE id = $1 AND history_synced_at IS NULL`,
          [instanceId],
        )
        log.info('webhook.sync_settled', { instance_id: instanceId, settle_ms: SYNC_SETTLE_MS })
        // Evolution now holds the fullest contact list — backfill at true completion.
        void backfillContactsFromEvolution(instanceId)
      } catch (err) {
        log.warn('webhook.sync_settle.failed', {
          instance_id: instanceId, error: err instanceof Error ? err.message : String(err),
        })
      }
    })()
  }, SYNC_SETTLE_MS))
}

async function recordSyncProgress(instanceId: string, data: unknown): Promise<void> {
  try {
    const items: unknown[] =
      Array.isArray(data) ? data
      : (data && typeof data === 'object' && Array.isArray((data as { messages?: unknown[] }).messages))
        ? (data as { messages: unknown[] }).messages
        : data && typeof data === 'object' ? [data]
        : []
    let progress: number | null = null
    let isLatest = false
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const o = it as { isLatest?: unknown; progress?: unknown }
      if (o.isLatest === true) isLatest = true
      if (typeof o.progress === 'number') progress = Math.max(progress ?? 0, o.progress)
    }
    // EVERY batch (flagged or not) re-arms the settle window — completion is
    // "flag seen + batch silence", so silence must be measured across all
    // batches, not only flagged ones.
    if (isLatest || (typeof progress === 'number' && progress >= 100)) syncFlagSeen.add(instanceId)
    armSyncSettle(instanceId)
    // Flag-semantics telemetry: what does Evolution actually send per batch?
    log.info('webhook.sync_batch', { instance_id: instanceId, is_latest: isLatest, progress, n_items: items.length })
    if (progress === null) return                          // no progress figure to persist
    await pool.query(
      `UPDATE whatsapp.whatsapp_instances
          SET sync_progress = GREATEST(COALESCE(sync_progress, 0), LEAST(COALESCE($2::smallint, 0), 99))
        WHERE id = $1 AND history_synced_at IS NULL`,
      [instanceId, progress],
    )
  } catch (err) {
    log.warn('webhook.sync_progress.record_failed', {
      instance_id: instanceId, error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---- Contact sync: populate contacts table from contacts.upsert events ------

async function upsertContactFromSync(
  instanceId: string,
  jid: string,
  pushName: string | null,
  profilePic: string | null,
): Promise<void> {
  try {
    const isLid = jid.endsWith('@lid')
    const isPhone = jid.endsWith('@s.whatsapp.net')
    if (!isLid && !isPhone) return

    // SINGLE-WRITER rule: whatsapp.contacts AND the contact bible
    // (contact_identifiers) are written ONLY through resolve_identity. The old
    // raw INSERT here was a SECOND contacts writer that bypassed the bible and
    // raced the conversations identity trigger — that is exactly what produced
    // duplicate "shell" contacts (one with the metadata, one in the bible with
    // NULLs). resolve_identity registers the identifier in the bible, creates or
    // dedups the contact, and fills phone_jid/phone_number/lid/push_name/
    // profile_pic under its own anti-fusion guards.
    await pool.query(
      `SELECT whatsapp.resolve_identity($1, $2, $3::identifier_kind, 'contacts_upsert', NULL, NULL, $4, $5)`,
      [instanceId, jid, isPhone ? 'phone' : 'lid', pushName, profilePic],
    )

    if (isPhone) {
      // Architectural rule: 1 contact = 1 conversation. Create the conversation
      // row for the phone JID even if no message has arrived yet, so the inbox
      // shows the contact immediately after history sync. The conversations
      // identity trigger then links contact_id to the SAME bible contact above —
      // no shell, because the identifier is already registered.
      await pool.query(
        `INSERT INTO whatsapp.conversations (instance_id, remote_jid, peer_display_name, peer_profile_pic)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (instance_id, remote_jid) DO UPDATE SET
           peer_display_name = COALESCE(EXCLUDED.peer_display_name, whatsapp.conversations.peer_display_name),
           peer_profile_pic  = COALESCE(EXCLUDED.peer_profile_pic,  whatsapp.conversations.peer_profile_pic)`,
        [instanceId, jid, pushName, profilePic],
      )
    }
    // LID-only: registered in the bible but NO conversation row yet
    // (architectural rule: 1 RESOLVED contact = 1 conversation). When the lid is
    // later linked to a phone via a deterministic same_envelope_alt /
    // group_participants pair, the conversation is created under the canonical
    // phone JID on the next message.
  } catch (err) {
    log.warn('webhook.contact_sync.upsert_failed', {
      instance_id: instanceId, jid,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---- Dispatch by event type -----------------------------------------------

export async function handleEvent(
  instanceId: string,
  envelope: EvolutionWebhookEnvelope,
): Promise<void> {
  switch (envelope.event) {
    case 'messages.upsert':
      return handleMessagesUpsert(instanceId, envelope.data)
    case 'messages.update':
      return handleMessagesUpdate(instanceId, envelope.data)
    case 'messages.delete':
      // Remote party deleted a message (delete-for-everyone). Mark our stored
      // inbound copy as revoked — we keep the row and render a tombstone.
      return handleMessagesDelete(instanceId, envelope.data)
    case 'messages.set':
      // Initial history sync batch — handled the same way as upsert; the
      // server-side trigger on messages will update conversation timestamps.
      // Also record real sync progress/completion so the pairing modal can wait
      // for a GENUINE finish instead of guessing from message rate.
      //
      // FIX over WA Mancer: Evolution's webhook controller spreads the
      // messaging-history batch flags (`extra: {isLatest, progress}`) at the
      // ROOT of the POST body — NOT inside `data` (which is just the message
      // array). Passing only envelope.data meant recordSyncProgress never saw
      // a flag, history_synced_at never stamped, and the pairing modal waited
      // until MAX_SYNCING_SECONDS forever (verified: WA Mancer prod has
      // history_synced_at NULL / sync_progress 0 for the same reason). Pass
      // the whole envelope — recordSyncProgress's tolerant scan reads the
      // root-level flags, and still handles item-level flags if Evolution
      // ever moves them.
      void recordSyncProgress(instanceId, envelope)
      return handleMessagesUpsert(instanceId, envelope.data)
    case 'connection.update':
      return handleConnectionUpdate(instanceId, envelope.data as ConnectionUpdateData)
    case 'qrcode.updated':
      return handleQrCodeUpdated(instanceId, envelope.data as QrCodeUpdatedData)
    case 'contacts.upsert':
      return handleContactsUpsertOrUpdate(instanceId, envelope.data, false)
    case 'contacts.update':
      // Bulk + per-message contact metadata. Evolution emits these during
      // history sync AND on every live inbound. Source of pushName + pic for
      // resolving @lid identifiers. A live contacts.update on a @g.us carrying
      // profilePicUrl is the group ICON change/removal signal.
      return handleContactsUpsertOrUpdate(instanceId, envelope.data, true)
    case 'chats.upsert':
    case 'chats.update':
      // Patches chat name (group subject; for DMs the contact pushName).
      return handleChatsUpsertOrUpdate(instanceId, envelope.data)
    case 'groups.update':
    case 'groups.upsert':
      return handleGroupsUpdate(instanceId, envelope.data)
    case 'group-participants.update':
      // Authoritative roster delta (add/remove/promote/demote). Drives
      // group_participants sync, owner left_at set/clear, and acts as the pill
      // FALLBACK when the messages.upsert stub channel is stripped by Evolution.
      return handleGroupParticipantsUpdate(instanceId, envelope.data)
    case 'presence.update':
      return handlePresenceUpdate(instanceId, envelope.data as PresenceUpdateData)
    default:
      log.debug('webhook.event_ignored', { instance_id: instanceId, event: envelope.event })
      return
  }
}

// ---- messages.upsert -------------------------------------------------------

async function handleMessagesUpsert(instanceId: string, raw: unknown): Promise<void> {
  // Evolution sends either a single object or an array depending on context.
  const items = Array.isArray(raw) ? raw : [raw]
  for (const m of items) {
    if (!isMessageData(m)) continue
    try {
      await ingestMessage(instanceId, m)
    } catch (err) {
      log.error('webhook.messages_upsert.failed', {
        instance_id: instanceId,
        message_id: m.key?.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Reject JIDs that are not real conversations:
 *   - status@broadcast       (WhatsApp Stories/Status feed, pseudo-chat)
 *   - <id>@broadcast         (broadcast lists — not 2-way conversations)
 *   - <id>@newsletter        (WhatsApp Channels — read-only feeds)
 */
function isIngestableJid(jid: string): boolean {
  if (jid === 'status@broadcast') return false
  if (jid.endsWith('@broadcast'))  return false
  if (jid.endsWith('@newsletter')) return false
  return true
}

async function ingestMessage(instanceId: string, m: WAMessageData): Promise<void> {
  const remoteJid = m.key?.remoteJid
  if (!remoteJid) {
    log.warn('webhook.messages_upsert.no_remote_jid', { instance_id: instanceId })
    return
  }
  if (!isIngestableJid(remoteJid)) {
    log.debug('webhook.messages_upsert.skipped_non_chat', { instance_id: instanceId, remote_jid: remoteJid })
    return
  }

  let { kind, body, mediaMeta } = extractContent(m.message)

  // Evolution hoists contextInfo to the envelope level for simple message types
  // (e.g. `conversation` + `messageContextInfo`). Capture mentionedJid from there.
  const topCtx = (m as unknown as Record<string, unknown>).contextInfo as { mentionedJid?: string[] } | undefined
  if (topCtx?.mentionedJid?.length && !(mediaMeta as Record<string, unknown>)?.mentionedJid) {
    if (!mediaMeta) mediaMeta = {}
    mediaMeta.mentionedJid = topCtx.mentionedJid
  }

  // Forwarded-message recognition (any kind): WhatsApp sets contextInfo.isForwarded
  // on forwards of non-own content. Persist it into media_meta so the UI renders
  // the "Transféré" header on inbound (and phone-synced outbound) forwards, the
  // same way dashboard-originated forwards set the `forwarded` column.
  const fwd = extractForwarded(m)
  if (fwd.isForwarded) {
    if (!mediaMeta) mediaMeta = {}
    mediaMeta.forwarded = true
    if (fwd.score > 0) mediaMeta.forwardingScore = fwd.score
  }

  // Protocol messages (disappearing mode, key distribution, edits, revokes…)
  // are control signals invisible in WhatsApp Web — we don't STORE them. But a
  // REVOKE protocol message means the remote party deleted a message they sent
  // us: catch it and tombstone our stored copy before discarding the signal.
  if (kind === 'system' && (mediaMeta as Record<string, unknown>)?.subtype === 'protocol') {
    const proto = m.message?.protocolMessage
    const ptype = proto?.type
    // Log the raw value so the exact REVOKE enum can be confirmed from live
    // logs across Evolution/Baileys versions (reported as 0 / 'REVOKE').
    log.info('webhook.protocol_message', {
      instance_id: instanceId,
      protocol_type: ptype,
      target_id: proto?.key?.id ?? null,
      target_from_me: proto?.key?.fromMe ?? null,
    })
    if (isRevokeProtocol(ptype) && proto?.key?.id && proto.key.fromMe === false) {
      await handleInboundRevoke(instanceId, proto.key.id)
    }
    return
  }

  // Group system events arrive as content-less stub messages on this channel
  // (the only channel carrying the actor + add-vs-invite distinction). A stub
  // would otherwise fall through to a hidden {kind:'system', body:null} row —
  // intercept it and write a renderable centered-pill row instead.
  if (remoteJid.endsWith('@g.us') && m.messageStubType != null) {
    await handleGroupStubEvent(instanceId, remoteJid, m)
    return
  }

  const direction = m.key?.fromMe ? 'outbound' : 'inbound'
  const tsRaw = m.messageTimestamp
  const whatsappTs = normalizeTimestamp(tsRaw)

  // On inbound DM: subscribe to peer presence (typing/recording) so it streams
  // over PRESENCE_UPDATE. WhatsApp gates this on an explicit Baileys subscribe;
  // calling Evolution's sendPresence triggers it as a side-effect. Throttled
  // internally per (instance, peer). (Consent/opt-out trap removed — this is an
  // inbound-first customer-service product, not cold outreach.)
  if (direction === 'inbound' && !remoteJid.endsWith('@g.us')) {
    ensurePeerPresenceSubscribed(instanceId, remoteJid)
  }
  // Group messages: participant is the actual sender JID within the group.
  // DMs: sender is the remoteJid itself. Evolution also sends pushName.
  let senderJid = m.key?.participant ?? (m as unknown as Record<string, unknown>)['participant'] as string | undefined ?? null
  const rawPushName = m.pushName?.trim() || null

  // History-sync recovery: Baileys frequently omits key.participant on the
  // initial messages.set burst, but places the participant's LID identifier
  // into pushName as a digit string. When that pattern is present in a group
  // message, treat the digits as the sender LID and rebuild a proper
  // <digits>@lid JID. Without this, sender_jid stays NULL forever and the
  // bubble label falls back to the raw digits via media_meta.pushName.
  if (!senderJid && remoteJid.endsWith('@g.us') && rawPushName && /^\d+$/.test(rawPushName)) {
    senderJid = `${rawPushName}@lid`
  }

  // Drop digit-only pushNames so they never land in media_meta as a display
  // label. The actual name is resolved via group_participants / contacts at
  // render time; a raw LID digit string is never a useful pushName.
  const pushName = rawPushName && /^\d+$/.test(rawPushName) ? null : rawPushName

  // --- JID mapping: capture LID↔phone from Alt fields on every message ---
  // Baileys gives the two forms of the SAME contact as {jid, jidAlt}. We must
  // capture BOTH addressing directions, else presence (which always arrives
  // @lid) can't resolve to a phone-keyed conversation.
  //
  // IGF HARDENING (2026-07-06, supersedes the WA Mancer mode-keyed branches):
  // capture by pair SHAPE, not by key.addressingMode. Proven on the live wire
  // (tcpdump vs Evolution's own DB): stock Evolution 2.3.7 normalizes
  // lid-addressed envelopes before sendDataWebhook (remoteJid := remoteJidAlt)
  // — pre-patch-002 it DESTROYED the @lid half entirely (remoteJid ===
  // remoteJidAlt === phone, zero learnable pair); with Evolution patch 002 the
  // pair survives as (phone, @lid) while addressingMode still reads 'lid',
  // which the donor's mode-keyed branches never match (mode 'lid' expected
  // remoteJid @lid). Shape-keying handles every orientation; the deterministic
  // same-envelope guarantee is unchanged. WA Mancer prod carries the same
  // latent gap for lid-addressed peers (its live learning only worked for
  // pn-addressed address-book contacts, which the normalization skips).
  {
    const keyAlt = m.key?.remoteJidAlt
    if (keyAlt && keyAlt !== remoteJid) {
      if (remoteJid.endsWith('@lid') && keyAlt.endsWith('@s.whatsapp.net')) {
        void captureJidMapping(instanceId, remoteJid, keyAlt, pushName)
      } else if (remoteJid.endsWith('@s.whatsapp.net') && keyAlt.endsWith('@lid')) {
        void captureJidMapping(instanceId, keyAlt, remoteJid, pushName)
      }
    }
    // Evolution patch 002 parks the pre-normalization @lid here (additive
    // field; stock consumers untouched). This is the ONLY wire carrier of the
    // pair for lid-addressed envelopes — alt arrives as phone===remoteJid.
    const keyLid = (m.key as unknown as Record<string, unknown> | undefined)?.['remoteJidLid'] as string | undefined
    if (keyLid?.endsWith('@lid') && remoteJid.endsWith('@s.whatsapp.net') && keyLid !== remoteJid) {
      void captureJidMapping(instanceId, keyLid, remoteJid, pushName)
    }
    const part = m.key?.participant
    const partAlt = m.key?.participantAlt
    if (part && partAlt && part !== partAlt) {
      if (part.endsWith('@lid') && partAlt.endsWith('@s.whatsapp.net')) {
        void captureJidMapping(instanceId, part, partAlt, pushName)
      } else if (part.endsWith('@s.whatsapp.net') && partAlt.endsWith('@lid')) {
        void captureJidMapping(instanceId, partAlt, part, pushName)
      }
    }
  }

  // Reactions are aggregated on the target message — no separate row.
  if (kind === 'reaction') {
    const targetEvoId = (mediaMeta as Record<string, unknown>)?.target_key as { id?: string } | undefined
    if (targetEvoId?.id) {
      await pool.query(
        `SELECT whatsapp.apply_reaction($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          instanceId,
          remoteJid,
          targetEvoId.id,
          body, // emoji (or empty string to un-react)
          senderJid ?? (targetEvoId as Record<string, unknown>)?.participant ?? 'unknown',
          whatsappTs.toISOString(),
          !!m.key?.fromMe,
          pushName,
        ],
      )
      log.debug('webhook.messages_upsert.reaction_applied', {
        instance_id: instanceId,
        target_evo_id: targetEvoId.id,
        emoji: body,
      })
    }
    return
  }

  const replyTo = extractReplyTo(m)

  // Inject pushName into media_meta for group sender display
  if (pushName && remoteJid.endsWith('@g.us')) {
    if (!mediaMeta) mediaMeta = {}
    mediaMeta.pushName = pushName
  }

  // Persist group sender's pushName into contact_profiles on every group message.
  if (remoteJid.endsWith('@g.us') && senderJid) {
    if (direction === 'inbound' && pushName) {
      pool.query(
        `SELECT whatsapp.upsert_contact_profile($1, $2, $3, $4)`,
        [instanceId, senderJid, pushName, null],
      ).catch((err) => log.warn('webhook.contact_profile.group_sender_upsert_failed', {
        jid: senderJid, error: err instanceof Error ? err.message : String(err),
      }))
      pool.query(
        `UPDATE whatsapp.group_participants
         SET push_name = COALESCE($4, push_name), updated_at = now()
         WHERE instance_id = $1 AND group_jid = $2 AND participant_jid = $3`,
        [instanceId, remoteJid, senderJid, pushName],
      ).catch(() => {})
    }
    // Outbound group messages: senderJid is the owner's LID.
    // Upsert it into contact_profiles so mention resolution works.
    if (direction === 'outbound' && senderJid.endsWith('@lid')) {
      const ownerName = pushName || (await getOwnerProfile(instanceId)).profileName
      if (ownerName) {
        pool.query(
          `SELECT whatsapp.upsert_contact_profile($1, $2, $3, $4)`,
          [instanceId, senderJid, ownerName, null],
        ).catch((err) => log.warn('webhook.contact_profile.owner_lid_upsert_failed', {
          jid: senderJid, error: err instanceof Error ? err.message : String(err),
        }))
        pool.query(
          `UPDATE whatsapp.group_participants
           SET push_name = COALESCE($4, push_name), updated_at = now()
           WHERE instance_id = $1 AND group_jid = $2 AND participant_jid = $3`,
          [instanceId, remoteJid, senderJid, ownerName],
        ).catch(() => {})
      }
    }
  }

  const ingestResult = await pool.query<{ ingest_message: string | null }>(
    `SELECT whatsapp.ingest_message(
       p_instance_id => $1,
       p_remote_jid => $2,
       p_direction => $3,
       p_kind => $4,
       p_body => $5,
       p_media_meta => $6,
       p_evolution_message_id => $7,
       p_sender_jid => $8,
       p_reply_to => $9,
       p_whatsapp_ts => $10,
       p_delivery_status => $11
     ) AS ingest_message`,
    [
      instanceId,
      remoteJid,
      direction,
      kind,
      body,
      mediaMeta ? JSON.stringify(mediaMeta) : null,
      m.key?.id ?? null,
      senderJid,
      replyTo,
      whatsappTs.toISOString(),
      m.status?.toString() ?? null,
    ],
  )

  // For media kinds, enqueue a background fetch so the worker downloads the
  // binary from Evolution (which expires it after ~14 days) and uploads to
  // R2 for long-term storage.
  //
  // Gating is purely on `newMsgId`: ingest_message returns NULL on conflict
  // (the row already exists by evolution_message_id), and non-null only when
  // it actually INSERTed. This correctly distinguishes:
  //   - Inbound:                 always INSERT → fetch
  //   - Outbound from our UI:    frontend row exists, dispatcher attaches
  //                              evolution_message_id; webhook conflicts →
  //                              NULL → skip (R2 already populated by sender)
  //   - Outbound from the user's real WhatsApp app (multi-device sync):
  //                              no prior row → INSERT → fetch. Without this
  //                              path, fromMe audios/photos sent from the
  //                              phone arrive in the DB but never download,
  //                              so the player has no R2 URL to load.
  const newMsgId = ingestResult.rows[0]?.ingest_message ?? null
  const evolutionMsgId = m.key?.id ?? null
  // Templates with header images need media-fetch too. Evolution's getBase64
  // can't serve them, but the worker's media-ingest has a direct-download
  // fallback using the headerMediaKey + headerDirectPath stored in media_meta.
  const hasTemplateMedia = kind === 'text' && mediaMeta?.subtype === 'template' && mediaMeta?.headerDirectPath
  const needsMediaFetch = isMediaKind(kind) || !!hasTemplateMedia
  const mediaFetchKind = hasTemplateMedia ? 'image' : kind

  if (
    newMsgId &&
    evolutionMsgId &&
    needsMediaFetch
  ) {
    await pool.query(
      `SELECT whatsapp.enqueue_media_fetch($1, $2, $3, $4::message_kind)`,
      [newMsgId, instanceId, evolutionMsgId, mediaFetchKind],
    ).catch((err) =>
      log.warn('media.enqueue_failed', {
        message_id: newMsgId,
        kind,
        direction,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  // Patch peer_display_name / peer_profile_pic on the conversation.
  //
  // DMs   → use the inbound message's pushName (the sender's WA display
  //         name). One UPDATE; only writes when value would change.
  // Groups → kick off a one-shot fetch from Evolution's /group/findGroupInfos
  //         IF we don't already have a name. Group subject + picture come
  //         from that endpoint, not from messages.
  if (remoteJid.endsWith('@g.us')) {
    void maybeRefreshGroupInfo(instanceId, remoteJid)
    // If this sender is unknown, fetch their profile pic immediately
    if (senderJid && direction === 'inbound') {
      const senderKey = `${instanceId}:${senderJid}`
      if (!isSenderKnown(senderKey)) {
        markSenderKnown(senderKey)
        void fetchSingleParticipantPic(instanceId, senderJid, pushName)
      }
    }
  } else {
    const pushName = m.pushName?.trim()
    // Don't store the raw phone number / JID user-part as a display name —
    // WhatsApp uses the digits as pushName when the contact has no saved name
    // on the sender's device. Storing that defeats `formatPhone` and the
    // inbox shows raw digits forever. Filter via the same helper as
    // chats.upsert so all three pushName write-paths agree.
    if (pushName && direction === 'inbound' && !looksLikeFallbackName(pushName, remoteJid)) {
      await pool.query(
        `UPDATE whatsapp.conversations
           SET peer_display_name = $2
         WHERE instance_id = $1 AND remote_jid = $3 AND peer_display_name IS DISTINCT FROM $2`,
        [instanceId, pushName, remoteJid],
      ).catch((err) =>
        log.warn('webhook.peer_name.update_failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }
}

// ---- contacts.upsert / contacts.update -----------------------------------
// Evolution emits these whenever it learns or updates a contact's pushName
// or profilePicUrl. We mirror them into conversations.peer_display_name and
// peer_profile_pic — this is the root-level fix for "Anonymous · #1234"
// labels: as soon as WhatsApp tells us anything about the peer, we store it.

interface EvoContact {
  remoteJid?: string
  pushName?: string | null
  profilePicUrl?: string | null
}

async function handleContactsUpsertOrUpdate(instanceId: string, raw: unknown, isLiveUpdate = false): Promise<void> {
  const items: EvoContact[] = Array.isArray(raw)
    ? (raw as EvoContact[])
    : raw && typeof raw === 'object'
      ? [raw as EvoContact]
      : []

  for (const c of items) {
    const jid = c.remoteJid
    if (!jid || !isIngestableJid(jid)) continue

    const isGroup = jid.endsWith('@g.us')
    // Cache the raw (expiring) WA CDN URL into R2 and store the stable URL.
    const pic = await cacheAvatar(instanceId, c.profilePicUrl)
    // Use the same fallback detector as chats.upsert + messages.upsert so all
    // three name-write paths agree. Any digit-only / JID-user-part pushName
    // is rejected; otherwise the raw phone leaks into peer_display_name and
    // bypasses formatPhone formatting in the inbox.
    const trimmed = c.pushName?.trim() ?? null
    const name = trimmed && !looksLikeFallbackName(trimmed, jid) ? trimmed : null

    // Always upsert into contact_profiles cache (used for group sender avatars).
    // Includes both DM contacts and individual participant JIDs (phone + LID).
    if (!isGroup && (name || pic)) {
      pool.query(
        `SELECT whatsapp.upsert_contact_profile($1, $2, $3, $4)`,
        [instanceId, jid, name, pic],
      ).catch((err) => log.warn('webhook.contact_profile.upsert_failed', {
        jid, error: err instanceof Error ? err.message : String(err),
      }))
    }

    // Populate contacts table from contacts.upsert events
    if (!isGroup) {
      void upsertContactFromSync(instanceId, jid, name, pic)
    }

    // For groups, contacts.upsert carries a member's pushName, NOT the group
    // subject. Never overwrite peer_display_name from here — groups get their
    // name from chats.upsert (subject) or maybeRefreshGroupInfo.
    // Only update peer_profile_pic for groups.
    if (isGroup) {
      // Read the stored pic BEFORE touching it — we detect a REAL icon change by
      // comparing the freshly-cached R2 URL to the stored one. cacheAvatar is
      // content-addressed by the WA URL *path* (stable per photo), so an
      // unchanged icon always yields the SAME R2 URL. This is what kills the
      // false "icône modifiée" spam: Evolution sends contacts.update with the
      // group's profilePicUrl routinely (on activity/sync), not only on real
      // changes — but the cached URL only differs when the photo actually
      // changed.
      let oldPic: string | null = null
      try {
        const { rows } = await pool.query<{ peer_profile_pic: string | null }>(
          `SELECT peer_profile_pic FROM whatsapp.conversations WHERE instance_id = $1 AND remote_jid = $2`,
          [instanceId, jid],
        )
        oldPic = rows[0]?.peer_profile_pic ?? null
      } catch { /* treat as unknown */ }

      const isIconSignal = isLiveUpdate && Object.prototype.hasOwnProperty.call(c, 'profilePicUrl')
      const removed = isIconSignal && (c.profilePicUrl == null || c.profilePicUrl === '')

      if (removed) {
        // Explicit removal signal (profilePicUrl=null) — only act if there WAS
        // an icon (else it's noise on an already-iconless group).
        if (oldPic) {
          await pool.query(
            `UPDATE whatsapp.conversations SET peer_profile_pic = NULL
              WHERE instance_id = $1 AND remote_jid = $2`,
            [instanceId, jid],
          ).catch(() => {})
          await pool.query(
            `SELECT whatsapp.append_group_system_event($1, $2, $3, $4)`,
            [instanceId, jid, 'L’icône du groupe a été supprimée',
              JSON.stringify({ subtype: 'group_event', event: 'icon_remove', actor_jid: null, target_jids: [] })],
          ).catch(() => {})
        }
      } else if (pic && pic !== oldPic) {
        // Pic genuinely changed (or first-ever set). Always refresh the stored
        // value; only emit the "icône modifiée" pill when there was a PRIOR icon
        // (first-ever set is silent) AND this is a live change signal.
        await pool.query(
          `UPDATE whatsapp.conversations SET peer_profile_pic = $2
            WHERE instance_id = $1 AND remote_jid = $3`,
          [instanceId, pic, jid],
        ).catch(() => {})
        if (oldPic && isIconSignal) {
          await pool.query(
            `SELECT whatsapp.append_group_system_event($1, $2, $3, $4)`,
            [instanceId, jid, 'L’icône du groupe a été modifiée',
              JSON.stringify({ subtype: 'group_event', event: 'icon', actor_jid: null, target_jids: [] })],
          ).catch(() => {})
        }
      }
      continue
    }

    // DMs: pushName is the contact's WA display name — safe to use.
    try {
      await pool.query(
        `INSERT INTO whatsapp.conversations (instance_id, remote_jid, peer_display_name, peer_profile_pic)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (instance_id, remote_jid) DO UPDATE SET
           peer_display_name = COALESCE($3::text, whatsapp.conversations.peer_display_name),
           peer_profile_pic  = COALESCE($4::text, whatsapp.conversations.peer_profile_pic)`,
        [instanceId, jid, name, pic],
      )
      if (pic) {
        pool.query(
          `UPDATE whatsapp.contacts
             SET profile_pic = $3, updated_at = now()
           WHERE instance_id = $1 AND (phone_jid = $2 OR lid = $2)
             AND profile_pic IS DISTINCT FROM $3`,
          [instanceId, jid, pic],
        ).catch(() => {})
      }
    } catch (err) {
      log.warn('webhook.contacts.update_failed', {
        jid, error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ---- chats.upsert / chats.update -----------------------------------------
// Carries chat name (group subject for groups; pushName for DMs).
//
// GROUPS: Only write if name looks like a real subject (not digits/JID fallback).
//         Never overwrite an existing good name with garbage — use COALESCE
//         so we only fill in when NULL. The authoritative source for group
//         subjects is maybeRefreshGroupInfo (Evolution's findGroupInfos API).
//
// DMs:    Write unconditionally — pushName is the real contact name.

interface EvoChat {
  remoteJid?: string
  name?: string | null
}

/** Returns true if the string looks like a JID fallback (all digits, or digits@...) */
function looksLikeFallbackName(name: string, jid: string): boolean {
  // Exact match to the JID user part
  if (name === jid.split('@')[0]) return true
  // All digits (phone number or LID number)
  if (/^\d+$/.test(name)) return true
  // Looks like a JID itself
  if (name.includes('@')) return true
  return false
}

async function handleChatsUpsertOrUpdate(instanceId: string, raw: unknown): Promise<void> {
  const items: EvoChat[] = Array.isArray(raw) ? (raw as EvoChat[]) : []
  for (const c of items) {
    const jid = c.remoteJid
    if (!jid || !isIngestableJid(jid)) continue

    // Architectural rule: 1 RESOLVED contact = 1 conversation. Only phone
    // JIDs (resolved DMs) and groups become conversations. Skip @lid chats —
    // they wait for the LID↔phone mapping before surfacing.
    const isGroup = jid.endsWith('@g.us')
    const isPhone = jid.endsWith('@s.whatsapp.net')
    if (!isGroup && !isPhone) continue

    const rawName = c.name?.trim() ?? null
    const usableName =
      rawName && !looksLikeFallbackName(rawName, jid) ? rawName : null

    // Architectural rule: 1 chat = 1 conversation. Always create the row
    // even when no usable name is known yet — peer_display_name fills in
    // later from contacts.upsert / maybeRefreshGroupInfo.
    try {
      if (isGroup) {
        // Groups: COALESCE so we never overwrite a known-good subject from
        // the Evolution group API with a stale chats.upsert sample.
        await pool.query(
          `INSERT INTO whatsapp.conversations (instance_id, remote_jid, peer_display_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (instance_id, remote_jid) DO UPDATE SET
             peer_display_name = COALESCE(whatsapp.conversations.peer_display_name, EXCLUDED.peer_display_name)`,
          [instanceId, jid, usableName],
        )
      } else {
        // DMs: pushName is authoritative when present. Insert unconditionally;
        // only overwrite name when we actually have a new better one.
        await pool.query(
          `INSERT INTO whatsapp.conversations (instance_id, remote_jid, peer_display_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (instance_id, remote_jid) DO UPDATE SET
             peer_display_name = COALESCE(EXCLUDED.peer_display_name, whatsapp.conversations.peer_display_name)`,
          [instanceId, jid, usableName],
        )
      }
    } catch (err) {
      log.warn('webhook.chats.update_failed', {
        jid, error: err instanceof Error ? err.message : String(err),
      })
    }

    // chats.update on a group is WhatsApp's "subject changed, refetch" signal
    // (it carries no name). Force a fresh group-info pull so the authoritative
    // subject lands AND maybeRefreshGroupInfo can detect+pill the rename.
    if (isGroup) {
      groupRefreshCache.delete(`${instanceId}:${jid}`)
      void maybeRefreshGroupInfo(instanceId, jid)
    }
  }
}

// ---- Group metadata refresh -----------------------------------------------
// Fetch group subject + picture from Evolution and persist on the
// conversation row. Always fetches from Evolution to ensure the real group
// subject is stored (not a member pushName from contacts.upsert).

// TTL cache: skip re-fetching group info within 1 hour of a successful fetch.
// Prevents hammering Evolution on every group message while ensuring names persist.
const groupRefreshCache = new Map<string, number>()
const GROUP_REFRESH_TTL_MS = 60 * 60 * 1000 // 1 hour

// Per-sender cache: track which sender JIDs we've already fetched a profile pic for.
// Uses a TTL Map so entries expire after 1 hour, allowing pic updates to be re-fetched
// and preventing unbounded memory growth.
const SENDER_CACHE_TTL_MS = 60 * 60 * 1000
const knownSenderCache = new Map<string, number>()

function isSenderKnown(key: string): boolean {
  const ts = knownSenderCache.get(key)
  if (!ts) return false
  if (Date.now() - ts > SENDER_CACHE_TTL_MS) {
    knownSenderCache.delete(key)
    return false
  }
  return true
}

function markSenderKnown(key: string): void {
  knownSenderCache.set(key, Date.now())
  // Evict stale entries periodically (every 500 inserts)
  if (knownSenderCache.size % 500 === 0) {
    const now = Date.now()
    for (const [k, t] of knownSenderCache) {
      if (now - t > SENDER_CACHE_TTL_MS) knownSenderCache.delete(k)
    }
  }
}

async function handleGroupsUpdate(instanceId: string, raw: unknown): Promise<void> {
  const arr = Array.isArray(raw) ? raw : [raw]
  for (const item of arr) {
    const g = item as { id?: string; subject?: string; owner?: string; ownerPn?: string; creation?: number; participants?: Array<{ id?: string; phoneNumber?: string; admin?: string | null; action?: string }> }
    if (!g.id) continue

    // Newly-created group → "Vous avez créé ce groupe" pill. `creation` is a
    // fixed unix-seconds stamp, so "recent" reliably means a fresh group (not a
    // later metadata edit). ownerPn carries the creator's phone directly.
    if (g.creation && Date.now() / 1000 - g.creation < 300) {
      const creatorJid = g.ownerPn
        ?? (g.owner ? await resolveGroupMemberPhone(instanceId, g.id, g.owner) : null)
      void writeGroupSystemEvent(instanceId, g.id, 'create', creatorJid, [], null)
    }

    // If participants array is present, it's a participants-update event.
    // Trigger a full group refresh to get the complete list.
    groupRefreshCache.delete(`${instanceId}:${g.id}`)
    void maybeRefreshGroupInfo(instanceId, g.id)
  }
}

// ---- Group system events (centered "X a quitté" pills) ---------------------

const onlyDigits = (s: string | null | undefined): string =>
  String(s ?? '').replace(/@.*$/, '').replace(/[^0-9]/g, '')

// Baileys WAMessageStubType → our compact event vocabulary. Evolution may
// serialize the stub as an int, a digit-string, or the symbolic enum name; we
// accept all three. ICON is 22 (NOT 23 — 23 is invite-link). The exact live
// value is logged at the call site so a divergent build can be confirmed.
const GROUP_STUB_EVENTS: Record<string, string> = {
  '20': 'create',  GROUP_CREATE: 'create',
  '21': 'subject', GROUP_CHANGE_SUBJECT: 'subject',
  '22': 'icon',    GROUP_CHANGE_ICON: 'icon',
  '23': 'invite_link', GROUP_CHANGE_INVITE_LINK: 'invite_link',
  '24': 'description', GROUP_CHANGE_DESCRIPTION: 'description',
  '27': 'add',     GROUP_PARTICIPANT_ADD: 'add',
  '28': 'remove',  GROUP_PARTICIPANT_REMOVE: 'remove',
  '29': 'promote', GROUP_PARTICIPANT_PROMOTE: 'promote',
  '30': 'demote',  GROUP_PARTICIPANT_DEMOTE: 'demote',
  '31': 'invite',  GROUP_PARTICIPANT_INVITE: 'invite',
  '32': 'leave',   GROUP_PARTICIPANT_LEAVE: 'leave',
  '33': 'change_number', GROUP_PARTICIPANT_CHANGE_NUMBER: 'change_number',
}

function mapGroupStub(t: number | string | undefined): string | null {
  if (t == null) return null
  const key = typeof t === 'string' ? t.trim().toUpperCase() : String(t)
  return GROUP_STUB_EVENTS[key] ?? null
}

// Resolve digits → best display name (book > push > group push). Falls back to
// a +-prefixed phone for the conv-list preview body (frontend re-resolves from
// contactMap, so this is only the list-row fallback).
async function resolveMemberNames(
  instanceId: string,
  groupJid: string,
  jids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = [...new Set(jids.map(onlyDigits).filter((d) => d.length >= 5))]
  if (!wanted.length) return out
  try {
    // Match by BOTH phone digits and LID digits, so an unresolved actor LID
    // (e.g. on a number that was removed and can't fetch the roster) still
    // resolves its display name via contacts.lid / participant_jid.
    const { rows } = await pool.query<{ d: string; name: string | null }>(
      `SELECT s.d, s.name FROM (
         SELECT 1 AS pri,
                regexp_replace(coalesce(phone_jid, ''), '[^0-9]', '', 'g') AS d,
                coalesce(book_name, push_name) AS name
           FROM whatsapp.contacts WHERE instance_id = $1
         UNION ALL
         SELECT 1 AS pri,
                regexp_replace(coalesce(lid, ''), '[^0-9]', '', 'g') AS d,
                coalesce(book_name, push_name) AS name
           FROM whatsapp.contacts WHERE instance_id = $1 AND lid IS NOT NULL
         UNION ALL
         SELECT 2 AS pri,
                regexp_replace(coalesce(phone_jid, ''), '[^0-9]', '', 'g') AS d,
                push_name AS name
           FROM whatsapp.group_participants WHERE instance_id = $1 AND group_jid = $2
         UNION ALL
         SELECT 2 AS pri,
                regexp_replace(coalesce(participant_jid, ''), '[^0-9]', '', 'g') AS d,
                push_name AS name
           FROM whatsapp.group_participants WHERE instance_id = $1 AND group_jid = $2
       ) s
       WHERE s.name IS NOT NULL AND s.d <> '' AND s.d = ANY($3::text[])
       ORDER BY s.pri`,
      [instanceId, groupJid, wanted],
    )
    for (const r of rows) {
      if (r.name && !out.has(r.d)) out.set(r.d, r.name)
    }
  } catch { /* preview-only; ignore */ }
  return out
}

// Build the French conv-list preview body. `actorIsSelf` swaps to "Vous".
function buildGroupEventBody(
  event: string,
  actorName: string | null,
  actorIsSelf: boolean,
  targetNames: string[],
  selfIsTarget: boolean,
  newSubject: string | null,
): string {
  const actor = actorIsSelf ? 'Vous' : (actorName || 'Quelqu’un')
  const targets = targetNames.length ? targetNames.join(', ') : 'un membre'
  const verb = (selfVb: string, otherVb: string) => (actorIsSelf ? selfVb : `${actor} ${otherVb}`)
  switch (event) {
    case 'create':      return verb('Vous avez créé ce groupe', 'a créé ce groupe')
    case 'subject':     return newSubject
      ? verb(`Vous avez changé le sujet en « ${newSubject} »`, `a changé le sujet en « ${newSubject} »`)
      : verb('Vous avez changé le sujet du groupe', 'a changé le sujet du groupe')
    case 'icon':        return verb('Vous avez changé l’icône du groupe', 'a changé l’icône du groupe')
    case 'invite_link': return verb('Vous avez changé le lien d’invitation', 'a changé le lien d’invitation')
    case 'description': return verb('Vous avez changé la description', 'a changé la description')
    case 'add':         return selfIsTarget && !actorIsSelf
      ? `${actor} vous a ajouté`
      : verb(`Vous avez ajouté ${targets}`, `a ajouté ${targets}`)
    case 'remove':      return selfIsTarget && !actorIsSelf
      ? `${actor} vous a retiré`
      : verb(`Vous avez retiré ${targets}`, `a retiré ${targets}`)
    case 'promote':     return selfIsTarget && !actorIsSelf
      ? `${actor} vous a nommé administrateur`
      : verb(`Vous avez nommé ${targets} administrateur`, `a nommé ${targets} administrateur`)
    case 'demote':      return selfIsTarget && !actorIsSelf
      ? `${actor} vous a retiré des administrateurs`
      : verb(`Vous avez retiré ${targets} des administrateurs`, `a retiré ${targets} des administrateurs`)
    case 'invite':      return `${targets} a rejoint via le lien d’invitation`
    case 'leave':       return actorIsSelf ? 'Vous avez quitté le groupe' : `${actor} a quitté`
    case 'change_number': return `${actor} a changé de numéro`
    default:            return verb('a mis à jour le groupe', 'a mis à jour le groupe')
  }
}

// Write a group system-event pill row (via the dedup-safe RPC) plus roster
// side-effects (owner left_at, group refresh). Shared by the stub channel and
// the participants.update fallback.
async function writeGroupSystemEvent(
  instanceId: string,
  groupJid: string,
  event: string,
  actorJid: string | null,
  targetJids: string[],
  newSubject: string | null,
): Promise<void> {
  const owner = await getOwnerProfile(instanceId)
  const ownerDigits = onlyDigits(owner.ownerJid)
  const actorDigits = onlyDigits(actorJid)
  const actorIsSelf = !!ownerDigits && actorDigits === ownerDigits
  const targetDigits = targetJids.map(onlyDigits).filter(Boolean)
  const selfIsTarget = !!ownerDigits && targetDigits.includes(ownerDigits)

  const names = await resolveMemberNames(instanceId, groupJid, [actorJid ?? '', ...targetJids])
  const fmtPhone = (d: string) => (d ? `+${d}` : 'un membre')
  const actorName = actorDigits ? (names.get(actorDigits) ?? fmtPhone(actorDigits)) : null
  const targetNames = targetDigits.map((d) => names.get(d) ?? fmtPhone(d))

  const body = buildGroupEventBody(event, actorName, actorIsSelf, targetNames, selfIsTarget, newSubject)
  const mediaMeta: Record<string, unknown> = {
    subtype: 'group_event',
    event,
    actor_jid: actorJid ?? null,
    target_jids: targetJids,
  }
  if (newSubject) mediaMeta.new_subject = newSubject

  try {
    await pool.query(
      `SELECT whatsapp.append_group_system_event($1, $2, $3, $4)`,
      [instanceId, groupJid, body, JSON.stringify(mediaMeta)],
    )
  } catch (err) {
    log.warn('webhook.group_event.append_failed', {
      instance_id: instanceId, group_jid: groupJid, event,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Owner-membership transitions: keep conversations.left_at in sync so the UI
  // swaps the composer for the "no longer a member" notice (and clears it on
  // re-add — the rejoin path missing until now).
  if (ownerDigits) {
    if ((event === 'leave' && actorIsSelf) || (event === 'remove' && selfIsTarget)) {
      await pool.query(
        `UPDATE whatsapp.conversations SET left_at = now()
          WHERE instance_id = $1 AND remote_jid = $2 AND left_at IS NULL`,
        [instanceId, groupJid],
      ).catch(() => {})
    } else if (event === 'add' && selfIsTarget) {
      await pool.query(
        `UPDATE whatsapp.conversations SET left_at = NULL
          WHERE instance_id = $1 AND remote_jid = $2`,
        [instanceId, groupJid],
      ).catch(() => {})
    }
  }

  // Roster reconcile is owned by the caller (handleGroupParticipantsUpdate
  // awaits maybeRefreshGroupInfo before calling this; handleGroupsUpdate
  // refreshes separately) — no refresh here to avoid a duplicate Evolution call.
}

async function handleGroupStubEvent(
  instanceId: string,
  groupJid: string,
  m: WAMessageData,
): Promise<void> {
  // Step-0 live capture: log the raw stub shape once so the enum
  // numbers/serialization can be field-verified on the test instance.
  log.info('webhook.group_stub', {
    instance_id: instanceId,
    group_jid: groupJid,
    stub_type: m.messageStubType ?? null,
    stub_params: m.messageStubParameters ?? null,
    participant: m.key?.participant ?? null,
  })

  const event = mapGroupStub(m.messageStubType)
  if (!event) {
    log.warn('webhook.group_stub.unmapped', { instance_id: instanceId, stub_type: m.messageStubType })
    return
  }

  const params = Array.isArray(m.messageStubParameters) ? m.messageStubParameters : []
  // Actor = the admin/member who triggered it. participantPn is the phone form
  // under LID migration; prefer it when present.
  const actorJid = m.key?.participantPn ?? m.key?.participant ?? m.key?.participantAlt ?? null

  let targetJids: string[] = []
  let newSubject: string | null = null
  if (event === 'subject') {
    newSubject = params[0]?.trim() || null
  } else if (['add', 'remove', 'promote', 'demote', 'invite'].includes(event)) {
    // Parameters are participant JIDs (sometimes JSON-wrapped). Keep raw JIDs.
    targetJids = params.filter((p) => typeof p === 'string' && p.length > 0)
  } else if (event === 'leave') {
    // The leaver is the actor; no separate target.
    targetJids = actorJid ? [actorJid] : []
  }

  await writeGroupSystemEvent(instanceId, groupJid, event, actorJid, targetJids, newSubject)
}

// Evolution `group-participants.update`: { id, participants[], action,
// author?, participantsData[]? }. The key is `id` (NOT groupJid). Step-0 live
// capture (2026-06-03) proved the messages.upsert stub channel is DEAD in
// Evolution v2.3.7 — this is the ONLY channel that delivers group membership
// events, so it OWNS the pills (no duplicate risk; the stub branch never fires).
async function handleGroupParticipantsUpdate(instanceId: string, raw: unknown): Promise<void> {
  const arr = Array.isArray(raw) ? raw : [raw]
  for (const item of arr) {
    // Evolution v2.3.7 wire shape (verified 2026-06-03):
    //   { id, author:"<lid>@lid", action, participants:[{id:"<lid>@lid",
    //     phoneNumber:"<digits>@s.whatsapp.net", admin}] }
    // participants are OBJECTS (not strings); author is a LID with no phone.
    const g = item as {
      id?: string
      action?: string
      author?: string
      by?: string
      participants?: Array<{ id?: string; phoneNumber?: string } | string>
    }
    const groupJid = g.id
    if (!groupJid || !groupJid.endsWith('@g.us')) continue

    log.info('webhook.group_participants_update', {
      instance_id: instanceId, group_jid: groupJid,
      action: g.action ?? null, count: g.participants?.length ?? 0,
    })

    const action = (g.action || '').toLowerCase()
    let event = ['add', 'remove', 'promote', 'demote'].includes(action) ? action : null

    const rawParts = (g.participants ?? [])
    // Targets: prefer each participant's phone JID (clean digits), fall back to
    // its LID. Handle both object and bare-string forms defensively.
    let targets: string[] = rawParts
      .map((p) => (typeof p === 'string' ? p : (p.phoneNumber || p.id || '')))
      .filter((s) => s.length > 0)

    const authorLid = g.author ?? g.by ?? null

    // SELF-LEAVE detection: WhatsApp represents "X left" as a remove where the
    // author IS the (sole) target. Reclassify to a 'leave' so it renders
    // "Vous avez quitté"/"X a quitté" instead of the nonsensical "X vous a
    // retiré", and so it dedups against the optimistic leave pill (targets=[]).
    let leaverJid: string | null = null
    if (event === 'remove' && authorLid && rawParts.length === 1) {
      const t0 = rawParts[0]
      const targetLid = typeof t0 === 'string' ? t0 : (t0?.id || '')
      const targetPhone = typeof t0 === 'string' ? '' : (t0?.phoneNumber || '')
      if (targetLid && onlyDigits(authorLid) === onlyDigits(targetLid)) {
        event = 'leave'
        // The leaver's phone IS in the payload (unlike the author LID), so the
        // actor resolves to a name / "Vous" cleanly.
        leaverJid = targetPhone || targetLid
        targets = []
      }
    }

    // Roster reconcile FIRST and AWAITED: this populates group_participants and
    // returns the fresh roster, so the actor LID→phone resolution below never
    // races an empty table (the bug that left actor_jid as a raw @lid). Also
    // drives the authoritative left_at in storeGroupParticipants.
    groupRefreshCache.delete(`${instanceId}:${groupJid}`)
    const roster = await maybeRefreshGroupInfo(instanceId, groupJid)

    // Actor: for a leave it's the leaver (phone known); otherwise the author LID
    // resolved to phone via the fresh roster.
    const actorJid = event === 'leave'
      ? leaverJid
      : (authorLid ? await resolveGroupMemberPhone(instanceId, groupJid, authorLid, roster) : null)

    if (event) {
      await writeGroupSystemEvent(instanceId, groupJid, event, actorJid, targets, null)
    }
  }
}

// Resolve a participant LID → its phone JID within a group. Prefers the freshly
// fetched roster (no DB round-trip / no race), falls back to group_participants,
// then to the LID itself. The global jid_mapping is intentionally NOT used — it
// is transposed/unreliable for some LIDs.
async function resolveGroupMemberPhone(
  instanceId: string,
  groupJid: string,
  jid: string,
  roster?: GroupRosterMember[] | null,
): Promise<string> {
  if (jid.endsWith('@s.whatsapp.net')) return jid
  const wantDigits = onlyDigits(jid)
  const fromRoster = (roster ?? []).find((p) => onlyDigits(p.id) === wantDigits)?.phoneNumber
  if (fromRoster?.endsWith('@s.whatsapp.net')) return fromRoster
  try {
    const { rows } = await pool.query<{ phone_jid: string | null }>(
      `SELECT phone_jid FROM whatsapp.group_participants
        WHERE instance_id = $1 AND group_jid = $2 AND participant_jid = $3
          AND phone_jid IS NOT NULL LIMIT 1`,
      [instanceId, groupJid, jid],
    )
    return rows[0]?.phone_jid ?? jid
  } catch {
    return jid
  }
}

type GroupRosterMember = { id?: string; phoneNumber?: string; admin?: string | null }

async function maybeRefreshGroupInfo(
  instanceId: string,
  groupJid: string,
): Promise<GroupRosterMember[] | null> {
  const key = `${instanceId}:${groupJid}`
  const lastFetch = groupRefreshCache.get(key)
  if (lastFetch && Date.now() - lastFetch < GROUP_REFRESH_TTL_MS) return null
  groupRefreshCache.set(key, Date.now()) // Mark as in-progress
  try {
    // Look up instance name to address Evolution.
    const inst = await pool.query<{ name: string }>(
      `SELECT evolution_instance_name AS name FROM whatsapp.whatsapp_instances WHERE id = $1`,
      [instanceId],
    )
    const name = inst.rows[0]?.name
    if (!name) return null

    const url = `${config.evolutionApiUrl.replace(/\/$/, '')}/group/findGroupInfos/${encodeURIComponent(name)}?groupJid=${encodeURIComponent(groupJid)}`
    const res = await fetch(url, { headers: { apikey: config.evolutionGlobalApiKey } })
    if (!res.ok) {
      log.warn('webhook.group_info.http_error', { instance_id: instanceId, group_jid: groupJid, status: res.status })
      return null
    }
    const info = await res.json() as {
      subject?: string
      pictureUrl?: string | null
      participants?: Array<{ id?: string; phoneNumber?: string; admin?: string | null }>
    }
    const subject = info.subject?.trim() || null
    const picture = await cacheAvatar(instanceId, info.pictureUrl)
    if (!subject && !picture) return info.participants ?? null

    // Detect a SUBJECT change: compare the authoritative new subject to the
    // stored name BEFORE overwriting. Only pill when the group already had a
    // name (avoid firing on first-ever sync) and it actually changed. The
    // chats.update channel carries no actor → neutral copy.
    const prior = await pool.query<{ peer_display_name: string | null }>(
      `SELECT peer_display_name FROM whatsapp.conversations
        WHERE instance_id = $1 AND remote_jid = $2`,
      [instanceId, groupJid],
    )
    const oldName = prior.rows[0]?.peer_display_name ?? null
    if (subject && oldName && subject !== oldName) {
      await pool.query(
        `SELECT whatsapp.append_group_system_event($1, $2, $3, $4)`,
        [
          instanceId, groupJid,
          `Le nom du groupe a été modifié en « ${subject} »`,
          JSON.stringify({ subtype: 'group_event', event: 'subject', actor_jid: null, target_jids: [], new_subject: subject }),
        ],
      ).catch(() => {})
    }

    // findGroupInfos is the authoritative source — always overwrite.
    // Use COALESCE for pic to avoid wiping a previously-cached pic when the API returns null.
    await pool.query(
      `UPDATE whatsapp.conversations
         SET peer_display_name = COALESCE($3::text, peer_display_name),
             peer_profile_pic  = COALESCE($4, peer_profile_pic)
       WHERE instance_id = $1 AND remote_jid = $2`,
      [instanceId, groupJid, subject, picture],
    )
    log.info('webhook.group_info.refreshed', {
      instance_id: instanceId, group_jid: groupJid,
      subject: subject?.slice(0, 40), has_pic: !!picture,
      participants: info.participants?.length ?? 0,
    })

    // Store all participants in group_participants table. AWAIT the store so a
    // caller that awaits this fn (group-event actor resolution) sees the fresh
    // roster in group_participants immediately after.
    if (info.participants?.length) {
      await storeGroupParticipants(instanceId, groupJid, info.participants)
      void fetchParticipantPics(instanceId, name, info.participants)
    }
    return info.participants ?? null
  } catch (err) {
    // On failure, clear the cache so next message retries
    groupRefreshCache.delete(key)
    log.warn('webhook.group_info.failed', {
      instance_id: instanceId, group_jid: groupJid,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ---- Store group participants -----------------------------------------------

async function storeGroupParticipants(
  instanceId: string,
  groupJid: string,
  participants: Array<{ id?: string; phoneNumber?: string; admin?: string | null }>,
): Promise<void> {
  try {
    const values: string[] = []
    const params: unknown[] = [instanceId, groupJid]
    let idx = 3
    for (const p of participants) {
      const jid = p.id || p.phoneNumber
      if (!jid) continue
      const phoneJid = p.phoneNumber || null
      const adminLevel = p.admin || null
      values.push(`($1, $2, $${idx}, $${idx + 1}, $${idx + 2})`)
      params.push(jid, phoneJid, adminLevel)
      idx += 3
    }
    if (values.length === 0) return

    // Delete old participants that are no longer in the group, then upsert current ones
    await pool.query(
      `DELETE FROM whatsapp.group_participants WHERE instance_id = $1 AND group_jid = $2`,
      [instanceId, groupJid],
    )
    await pool.query(
      `INSERT INTO whatsapp.group_participants (instance_id, group_jid, participant_jid, phone_jid, admin_level)
       VALUES ${values.join(', ')}
       ON CONFLICT (instance_id, group_jid, participant_jid) DO UPDATE SET
         phone_jid   = EXCLUDED.phone_jid,
         admin_level = EXCLUDED.admin_level,
         updated_at  = now()`,
      params,
    )
    // Propagate the known display name from contacts.push_name back into
    // group_participants.push_name in the same transaction window, so the
    // chat-pane resolver doesn't have to JOIN through contacts for every
    // group it views. Belt-and-braces: even if frontend bridge logic fails
    // (RLS, race, etc.) the participant carries its name directly.
    await pool.query(
      `UPDATE whatsapp.group_participants gp
         SET push_name = c.push_name, updated_at = now()
       FROM whatsapp.contacts c
       WHERE gp.instance_id = $1 AND gp.group_jid = $2
         AND gp.phone_jid = c.phone_jid
         AND gp.instance_id = c.instance_id
         AND c.push_name IS NOT NULL
         AND gp.push_name IS DISTINCT FROM c.push_name`,
      [instanceId, groupJid],
    )
    log.info('webhook.group_participants.stored', {
      instance_id: instanceId, group_jid: groupJid, count: values.length,
    })

    // Feed the bible + jid_mapping from group metadata (deterministic LID → phone
    // pairs straight from the roster). source 'group_participants' outranks
    // 'same_envelope_alt' in identifier_trust.
    for (const p of participants) {
      if (p.id?.endsWith('@lid') && p.phoneNumber?.endsWith('@s.whatsapp.net')) {
        void captureJidMapping(instanceId, p.id, p.phoneNumber, null, 'group_participants')
      }
    }

    // Authoritative conversations.left_at reconcile: the owner's presence in the
    // freshly-synced roster is the source of truth. This catches re-add (clears
    // left_at) and removal (sets it) even when the delta participants.update was
    // not delivered to the affected number — the robust catch-all behind the
    // fast event-path in writeGroupSystemEvent.
    const owner = await getOwnerProfile(instanceId)
    const ownerDigits = onlyDigits(owner.ownerJid)
    if (ownerDigits) {
      const ownerInGroup = participants.some(
        (p) => onlyDigits(p.phoneNumber) === ownerDigits || onlyDigits(p.id) === ownerDigits,
      )
      const res = await pool.query(
        ownerInGroup
          ? `UPDATE whatsapp.conversations SET left_at = NULL
               WHERE instance_id = $1 AND remote_jid = $2 AND left_at IS NOT NULL`
          : `UPDATE whatsapp.conversations SET left_at = now()
               WHERE instance_id = $1 AND remote_jid = $2 AND left_at IS NULL`,
        [instanceId, groupJid],
      ).catch(() => ({ rowCount: 0 }))

      // Re-add pill: when the owner transitions absent→present (rowCount>0 on the
      // clear), WhatsApp delivered this as a groups.upsert (NOT a participant
      // delta), so no event wrote a pill. Synthesize one. The adder isn't in the
      // roster snapshot, so the copy is actor-less ("Vous avez été ajouté…").
      if (ownerInGroup && (res?.rowCount ?? 0) > 0) {
        const ownerJid = owner.ownerJid ?? ''
        await pool.query(
          `SELECT whatsapp.append_group_system_event($1, $2, $3, $4)`,
          [
            instanceId, groupJid,
            'Vous avez été ajouté(e) à ce groupe',
            JSON.stringify({ subtype: 'group_event', event: 'add', actor_jid: null, target_jids: [ownerJid] }),
          ],
        ).catch(() => {})
      }
    }
  } catch (err) {
    log.warn('webhook.group_participants.store_failed', {
      instance_id: instanceId, group_jid: groupJid,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---- Fetch profile pics for group participants ----------------------------
// Uses Evolution's /chat/fetchProfilePictureUrl for each participant.
// Stores into contact_profiles so the frontend can display real avatars.

async function fetchParticipantPics(
  instanceId: string,
  evolutionInstanceName: string,
  participants: Array<{ id?: string; phoneNumber?: string; pushName?: string | null }>,
): Promise<void> {
  const baseUrl = config.evolutionApiUrl.replace(/\/$/, '')
  let successCount = 0
  let failCount = 0
  const CONCURRENCY = 5

  const fetchOne = async (p: { id?: string; phoneNumber?: string; pushName?: string | null }) => {
    const lid = p.id
    const phone = p.phoneNumber
    const pName = p.pushName?.trim() || null
    if (!lid && !phone) return

    markSenderKnown(`${instanceId}:${lid ?? phone!}`)

    try {
      // Prefer phone number for pic lookup (LID-only lookups often fail)
      const lookupJid = phone || lid!
      const lookupNumber = lookupJid.replace('@s.whatsapp.net', '').replace('@lid', '')
      const picUrl = `${baseUrl}/chat/fetchProfilePictureUrl/${encodeURIComponent(evolutionInstanceName)}?number=${encodeURIComponent(lookupNumber)}`
      const picRes = await fetch(picUrl, {
        headers: { apikey: config.evolutionGlobalApiKey },
        signal: AbortSignal.timeout(8000),
      })
      let profilePic: string | null = null
      if (picRes.ok) {
        const picData = await picRes.json() as { profilePictureUrl?: string | null; url?: string | null }
        profilePic = await cacheAvatar(instanceId, picData.profilePictureUrl ?? picData.url)
      }

      if (lid) {
        await pool.query(
          `SELECT whatsapp.upsert_contact_profile($1, $2, $3, $4)`,
          [instanceId, lid, pName, profilePic],
        )
        pool.query(
          `UPDATE whatsapp.group_participants
           SET push_name = COALESCE($3, push_name),
               profile_pic = COALESCE($4, profile_pic),
               updated_at = now()
           WHERE instance_id = $1 AND participant_jid = $2`,
          [instanceId, lid, pName, profilePic],
        ).catch(() => {})
      }
      if (phone && phone !== lid) {
        await pool.query(
          `SELECT whatsapp.upsert_contact_profile($1, $2, $3, $4)`,
          [instanceId, phone, pName, profilePic],
        )
      }
      if (profilePic) {
        const syncJid = lid ?? phone
        if (syncJid) {
          pool.query(
            `UPDATE whatsapp.contacts
               SET profile_pic = $3, updated_at = now()
             WHERE instance_id = $1 AND (phone_jid = $2 OR lid = $2)
               AND profile_pic IS DISTINCT FROM $3`,
            [instanceId, syncJid, profilePic],
          ).catch(() => {})
        }
      }
      successCount++
    } catch (err) {
      failCount++
      log.warn('webhook.group_participant.pic_fetch_failed', {
        instance_id: instanceId,
        jid: lid ?? phone,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Process in batches of CONCURRENCY to avoid hammering Evolution API
  for (let i = 0; i < participants.length; i += CONCURRENCY) {
    const batch = participants.slice(i, i + CONCURRENCY)
    await Promise.allSettled(batch.map(fetchOne))
  }

  log.info('webhook.group_participants.pics_fetched', {
    instance_id: instanceId,
    total: participants.length,
    success: successCount,
    failed: failCount,
  })
}

// Fetch a single participant's profile pic (triggered per-sender on first message)
async function fetchSingleParticipantPic(
  instanceId: string,
  senderJid: string,
  pushName: string | null,
): Promise<void> {
  try {
    // Check if we already have a pic for this sender
    const existing = await pool.query<{ profile_pic: string | null; updated_at: string }>(
      `SELECT profile_pic, updated_at FROM whatsapp.contact_profiles WHERE instance_id = $1 AND jid = $2`,
      [instanceId, senderJid],
    )
    const row = existing.rows[0]
    // Already have a *cached* pic — done. A stale raw WA URL (pre-R2-cache or
    // since-expired) is allowed to fall through so it self-heals — but still
    // honours the recency guard below so we don't re-fetch on every message.
    if (row?.profile_pic && isCachedAvatar(row.profile_pic)) return
    // If row exists (null pic OR stale pic) and was fetched recently (< 1 hour),
    // skip re-fetch to avoid hammering the API for privacy-hidden / unchanged users.
    if (row) {
      const age = Date.now() - new Date(row.updated_at).getTime()
      if (age < SENDER_CACHE_TTL_MS) return
    }

    const inst = await pool.query<{ name: string }>(
      `SELECT evolution_instance_name AS name FROM whatsapp.whatsapp_instances WHERE id = $1`,
      [instanceId],
    )
    const evoName = inst.rows[0]?.name
    if (!evoName) return

    // LID-only JIDs often fail with fetchProfilePictureUrl (expects phone numbers).
    // Still attempt the fetch but don't expect it to work for @lid senders.
    const baseUrl = config.evolutionApiUrl.replace(/\/$/, '')
    const lookupNumber = senderJid.replace('@s.whatsapp.net', '').replace('@lid', '')
    const picUrl = `${baseUrl}/chat/fetchProfilePictureUrl/${encodeURIComponent(evoName)}?number=${encodeURIComponent(lookupNumber)}`
    const picRes = await fetch(picUrl, {
      headers: { apikey: config.evolutionGlobalApiKey },
      signal: AbortSignal.timeout(8000),
    })
    let profilePic: string | null = null
    if (picRes.ok) {
      const picData = await picRes.json() as { profilePictureUrl?: string | null; url?: string | null }
      profilePic = await cacheAvatar(instanceId, picData.profilePictureUrl ?? picData.url)
    }

    // Always upsert: stores pushName even if pic lookup failed, and updates
    // updated_at so the "recently fetched" guard above prevents re-hammering.
    await pool.query(
      `SELECT whatsapp.upsert_contact_profile($1, $2, $3, $4)`,
      [instanceId, senderJid, pushName, profilePic],
    )
    if (profilePic) {
      pool.query(
        `UPDATE whatsapp.contacts
           SET profile_pic = $3, updated_at = now()
         WHERE instance_id = $1 AND (phone_jid = $2 OR lid = $2)
           AND profile_pic IS DISTINCT FROM $3`,
        [instanceId, senderJid, profilePic],
      ).catch(() => {})
    }
    log.debug('webhook.single_participant.pic_fetched', {
      instance_id: instanceId, jid: senderJid, has_pic: !!profilePic,
    })
  } catch (err) {
    log.warn('webhook.single_participant.pic_fetch_failed', {
      instance_id: instanceId, jid: senderJid,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---- inbound revoke (delete-for-everyone by the remote party) -------------

// REVOKE protocol subtype. Baileys WAProto ProtocolMessage.Type.REVOKE = 0.
// Accept the numeric, the digit-string, and the symbolic name to be robust
// across Evolution serializations. The exact live value is logged at the call
// site (webhook.protocol_message) so we can confirm/extend if a build differs.
function isRevokeProtocol(t: number | string | undefined): boolean {
  if (t === 0) return true
  if (typeof t === 'string') {
    const v = t.trim().toUpperCase()
    return v === '0' || v === 'REVOKE'
  }
  return false
}

// Tombstone our stored INBOUND copy of a message the contact deleted. We keep
// the row (and its body) so the thread shows a "deleted" marker; we never wipe
// content here. Outbound rows are untouched (our own delete-for-everyone sets
// revoked_by='us' in the RPC). Idempotent.
async function handleInboundRevoke(instanceId: string, evolutionMessageId: string): Promise<void> {
  try {
    const res = await pool.query(
      `UPDATE whatsapp.messages
          SET revoked_at = now(), revoked_by = 'remote'
        WHERE instance_id = $1
          AND evolution_message_id = $2
          AND direction = 'inbound'
          AND revoked_at IS NULL`,
      [instanceId, evolutionMessageId],
    )
    log.info('webhook.inbound_revoke', {
      instance_id: instanceId, evolution_message_id: evolutionMessageId,
      applied: res.rowCount ?? 0,
    })
  } catch (err) {
    log.error('webhook.inbound_revoke.failed', {
      instance_id: instanceId, evolution_message_id: evolutionMessageId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// Pull message id(s) out of a messages.delete payload. Evolution v2.3.7 may
// send a single key object, an array of them, or a { keys: [...] } wrapper.
function extractDeleteKeyIds(raw: unknown): string[] {
  const out: string[] = []
  const items = Array.isArray(raw) ? raw : [raw]
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    if (typeof o['id'] === 'string') out.push(o['id'])
    const key = o['key'] as Record<string, unknown> | undefined
    if (key && typeof key['id'] === 'string') out.push(key['id'])
    const keys = o['keys'] as Array<Record<string, unknown>> | undefined
    if (Array.isArray(keys)) for (const k of keys) if (k && typeof k['id'] === 'string') out.push(k['id'])
  }
  return [...new Set(out)]
}

async function handleMessagesDelete(instanceId: string, raw: unknown): Promise<void> {
  const ids = extractDeleteKeyIds(raw)
  if (ids.length === 0) {
    log.debug('webhook.messages_delete.no_ids', { instance_id: instanceId })
    return
  }
  for (const id of ids) {
    await handleInboundRevoke(instanceId, id)
  }
}

// ---- messages.update — delivery status patches ----------------------------

// Monotonic rank of delivery statuses. Receipts can arrive out of order
// (a late DELIVERY_ACK after a READ); we only ever advance forward so the
// UI never visibly regresses from "read" back to "delivered".
function deliveryRank(s: string): number {
  switch (s.toUpperCase()) {
    case 'PENDING': case 'PENDING_ACK': case '1': return 1
    case 'SERVER_ACK': case 'SENT': case '2':      return 2
    case 'DELIVERY_ACK': case 'DELIVERED': case '3': return 3
    case 'READ': case '4':                          return 4
    case 'PLAYED': case '5':                        return 5
    case 'ERROR': case 'FAILED': case '0':          return 99   // terminal, always applied
    default:                                        return 0
  }
}

/**
 * Evolution v2.3.7 messages.update payload is FLAT:
 *   { keyId, remoteJid, fromMe, status, instanceId, messageId }
 * (older/nested Baileys shape { key:{id}, update:{status} } is also handled).
 * status arrives as an uppercase string (DELIVERY_ACK / READ / PLAYED / ...).
 *
 * We match our messages row by evolution_message_id = keyId and only advance
 * delivery_status forward (monotonic), so out-of-order receipts can't downgrade.
 */
async function handleMessagesUpdate(instanceId: string, raw: unknown): Promise<void> {
  const items = Array.isArray(raw) ? raw : [raw]
  for (const u of items) {
    if (typeof u !== 'object' || u === null) continue
    const rec = u as Record<string, unknown>

    // Flat (v2.3.7) first, then nested fallback.
    const nestedKey = rec['key'] as { id?: string } | undefined
    const nestedUpdate = (rec['update'] ?? {}) as Record<string, unknown>
    const evoId =
      (typeof rec['keyId'] === 'string' ? rec['keyId'] as string : undefined)
      ?? nestedKey?.id
    const statusRaw =
      rec['status'] ?? nestedUpdate['status']

    if (!evoId || statusRaw === undefined || statusRaw === null) continue
    const status = String(statusRaw)
    const rank = deliveryRank(status)
    if (rank === 0) continue   // unknown status — ignore

    try {
      const res = await pool.query(
        `UPDATE whatsapp.messages
            SET delivery_status = $3
          WHERE instance_id = $1
            AND evolution_message_id = $2
            AND ($4 = 99 OR whatsapp._delivery_rank(delivery_status) < $4)`,
        [instanceId, evoId, status, rank],
      )
      if ((res.rowCount ?? 0) > 0) {
        log.debug('webhook.messages_update.applied', {
          instance_id: instanceId, evolution_msg_id: evoId, status,
        })
      }
    } catch (err) {
      log.error('webhook.messages_update.failed', {
        instance_id: instanceId, msg_id: evoId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ---- connection.update ----------------------------------------------------

async function handleConnectionUpdate(
  instanceId: string,
  data: ConnectionUpdateData,
): Promise<void> {
  const state = data.state
  const newStatus = mapConnectionState(state)
  if (!newStatus) {
    log.debug('webhook.connection.unknown_state', { instance_id: instanceId, state })
    return
  }

  // First time we see 'connected', stamp paired_at and bind phone_number
  // from the wuid (e.g. "212600000000:XX@s.whatsapp.net" → "+212600000000").
  const phoneNumber = extractPhoneFromWuid(data.wuid)
  const { rows: statusRows } = await pool.query<{ old_status: string | null }>(
    `WITH prev AS (
       SELECT status::text AS old_status FROM whatsapp.whatsapp_instances WHERE id = $1
     )
     UPDATE whatsapp.whatsapp_instances
       SET status = $2::instance_status,
           status_detail = $3::text,
           last_seen_at = now(),
           paired_at = COALESCE(paired_at, CASE WHEN $2::instance_status = 'connected' THEN now() END),
           phone_number = COALESCE(phone_number, $4::text),
           -- Stamp THIS connect (not coalesced) + reset the sync markers, so the
           -- pairing modal waits for a genuine history-sync completion of the
           -- CURRENT connect and a stale prior completion can't fast-pass it.
           -- IGF FIX (2026-07-06): TRANSITION-guarded (old status <> connected).
           -- Evolution emits DUPLICATE 'open' connection.updates; the donor's
           -- unguarded reset let a dup arriving AFTER recordSyncProgress's
           -- stamp WIPE history_synced_at — the pairing modal then waited out
           -- MAX_SYNCING_SECONDS every time the race lost. (Latent in WA
           -- Mancer: its stamp path was dead, so the reset never raced.)
           last_connect_at   = CASE WHEN $2::instance_status = 'connected' AND status IS DISTINCT FROM 'connected' THEN now() ELSE last_connect_at END,
           history_synced_at = CASE WHEN $2::instance_status = 'connected' AND status IS DISTINCT FROM 'connected' THEN NULL ELSE history_synced_at END,
           sync_progress     = CASE WHEN $2::instance_status = 'connected' AND status IS DISTINCT FROM 'connected' THEN 0 ELSE sync_progress END,
           -- Clear the QR on any terminal state, not just 'connected'. A dead
           -- QR (loop ended → disconnected/error) must not linger in the DB and
           -- render as if it were still scannable.
           qr_code = CASE WHEN $2::instance_status IN ('connected','disconnected','error') THEN NULL ELSE qr_code END
     WHERE id = $1
     RETURNING (SELECT old_status FROM prev) AS old_status`,
    [instanceId, newStatus, data.statusReason ? String(data.statusReason) : null, phoneNumber],
  )
  const wasConnected = statusRows[0]?.old_status === 'connected'

  // Genuine (re)connect transition → a NEW history-sync cycle begins: clear
  // the settle state so a stale flag from the previous connect can't stamp
  // this one. Dup 'open' events (wasConnected) must NOT touch it — clearing
  // mid-sync would eat the flag and force the dialog's 120s degrade.
  if (newStatus === 'connected' && !wasConnected) resetSyncSettle(instanceId)

  log.info('webhook.connection.updated', {
    instance_id: instanceId, state, mapped: newStatus, phone: phoneNumber,
  })

  // On successful connect, fetch WA-side profile (pic + name + owner jid)
  // from Evolution and persist. Async — webhook response already sent.
  if (newStatus === 'connected') {
    // Baileys' WS just (re)opened: any prior peer presence subscriptions
    // are gone with the old socket. Reset our throttle so the next inbound
    // — or the next warmup tick — re-fires sendPresence to re-subscribe.
    purgePeerSubscriptionsForInstance(instanceId)
    // If an agent is still attending this inbox, re-subscribe the focused peer
    // immediately so typing resumes without waiting for the 20-min warmup.
    // (Self-presence is re-affirmed by the loop.ts self-presence driver.)
    if (isInstanceAttended(instanceId)) refreshActiveOpenPeer(instanceId)

    refreshInstanceProfile(instanceId).catch((err) =>
      log.warn('webhook.connection.profile_refresh_failed', {
        instance_id: instanceId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )

    // Backfill the FULL contact list from Evolution once the initial sync has
    // had a moment to populate (webhooks only deliver a trickle). Delayed so
    // Evolution has ingested the history dump; idempotent if it runs again at
    // sync-completion (recordSyncProgress).
    setTimeout(() => { void backfillContactsFromEvolution(instanceId) }, 12_000)
  }
}

interface EvolutionInstanceSummary {
  name?: string
  ownerJid?: string | null
  profileName?: string | null
  profilePicUrl?: string | null
}

// Delayed re-refresh schedule (seconds) for the WA display name. On a FRESH
// pair Baileys hasn't received the owner's own profileName yet — Evolution
// returns null for a while after connect (the code below tolerates that). The
// one-shot on-connect refresh therefore left wa_profile_name NULL until a
// manual Restart forced a reconnect. These backoff ticks re-probe until the
// name lands, so a fresh pair fills in the name on its own.
const NAME_REFRESH_BACKOFF_S = [8, 20, 45, 90]

async function refreshInstanceProfile(instanceId: string, attempt = 0): Promise<void> {
  const lookup = await pool.query<{ name: string }>(
    'SELECT evolution_instance_name AS name FROM whatsapp.whatsapp_instances WHERE id = $1',
    [instanceId],
  )
  const name = lookup.rows[0]?.name
  if (!name) return

  const base = config.evolutionApiUrl.replace(/\/$/, '')
  const headers = { apikey: config.evolutionGlobalApiKey, 'content-type': 'application/json' }

  // 1. fetchInstances → ownerJid (always set on connected), maybe profileName/PicUrl
  let summary: EvolutionInstanceSummary | null = null
  try {
    const res = await fetch(`${base}/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`, { headers })
    if (res.ok) {
      const body = await res.json() as EvolutionInstanceSummary[]
      summary = Array.isArray(body) ? body[0] ?? null : null
    }
  } catch { /* ignore — fall through to per-endpoint probes */ }

  let ownerJid = summary?.ownerJid ?? null
  let profileName = summary?.profileName ?? null
  let profilePicUrl = summary?.profilePicUrl ?? null

  // 2. For the parts fetchInstances didn't fill, probe the per-chat endpoints
  //    using the own ownerJid. Evolution only populates these reliably after
  //    a brief delay post-connect, so we tolerate nulls.
  if (ownerJid) {
    if (!profilePicUrl) {
      try {
        const r = await fetch(`${base}/chat/fetchProfilePictureUrl/${encodeURIComponent(name)}`, {
          method: 'POST', headers, body: JSON.stringify({ number: ownerJid }),
        })
        if (r.ok) {
          const j = await r.json() as { profilePictureUrl?: string | null }
          profilePicUrl = j.profilePictureUrl ?? null
        }
      } catch { /* ignore */ }
    }
    if (!profileName) {
      try {
        const r = await fetch(`${base}/chat/fetchProfile/${encodeURIComponent(name)}`, {
          method: 'POST', headers, body: JSON.stringify({ number: ownerJid }),
        })
        if (r.ok) {
          const j = await r.json() as { name?: string | null; pushName?: string | null }
          profileName = j.name ?? j.pushName ?? null
        }
      } catch { /* ignore */ }
    }
  }

  // Cache the owner's (expiring) WA CDN avatar into R2 before persisting.
  profilePicUrl = await cacheAvatar(instanceId, profilePicUrl)

  await pool.query(
    `UPDATE whatsapp.whatsapp_instances SET
       profile_pic_url = COALESCE($2::text, profile_pic_url),
       wa_profile_name = COALESCE($3::text, wa_profile_name),
       wa_owner_jid    = COALESCE($4::text, wa_owner_jid)
     WHERE id = $1`,
    [instanceId, profilePicUrl, profileName, ownerJid],
  )
  // Upsert owner into contact_profiles at connection time so contactMap
  // always has the owner's phone JID with a pushName.
  if (ownerJid && profileName) {
    pool.query(
      `SELECT whatsapp.upsert_contact_profile($1, $2, $3, $4)`,
      [instanceId, ownerJid, profileName, profilePicUrl],
    ).catch((err) => log.warn('webhook.profile.owner_contact_upsert_failed', {
      instance_id: instanceId, error: err instanceof Error ? err.message : String(err),
    }))
  }

  // Warm the owner profile cache so the first outbound group message
  // can immediately upsert the owner's LID without a DB roundtrip.
  ownerProfileCache.set(instanceId, { profileName, ownerJid, ts: Date.now() })

  log.info('webhook.profile.refreshed', {
    instance_id: instanceId,
    has_pic:  !!profilePicUrl,
    has_name: !!profileName,
    owner_jid: ownerJid,
    attempt,
  })

  // If the WA display name still hasn't arrived (Baileys populates it late on a
  // fresh pair), re-probe on a backoff instead of waiting for a manual Restart.
  // Guarded: only while connected, only if the DB name is still empty, bounded
  // by the backoff array. profilePicUrl/status land early; the name is the
  // straggler, so this keys on the name alone.
  if (!profileName && attempt < NAME_REFRESH_BACKOFF_S.length) {
    const delayMs = NAME_REFRESH_BACKOFF_S[attempt]! * 1000
    setTimeout(() => {
      void (async () => {
        // Bail if the row was deleted or the name already filled (a later
        // connect/manual push may have won the race).
        const chk = await pool.query<{ status: string; wa_profile_name: string | null }>(
          'SELECT status, wa_profile_name FROM whatsapp.whatsapp_instances WHERE id = $1',
          [instanceId],
        ).catch(() => null)
        const row = chk?.rows[0]
        if (!row || row.status !== 'connected' || row.wa_profile_name) return
        await refreshInstanceProfile(instanceId, attempt + 1).catch((err) =>
          log.warn('webhook.profile.name_retry_failed', {
            instance_id: instanceId, attempt: attempt + 1,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      })()
    }, delayMs)
  }
}

// ---- qrcode.updated -------------------------------------------------------

async function handleQrCodeUpdated(
  instanceId: string,
  data: QrCodeUpdatedData,
): Promise<void> {
  const qr = data.qrcode?.base64 ?? data.qrcode?.code ?? null
  if (!qr) {
    log.debug('webhook.qrcode.empty', { instance_id: instanceId })
    return
  }
  // Idempotency guard: a late qrcode.updated must never downgrade an instance
  // that already completed pairing. Webhooks are dispatched via setImmediate
  // with no per-instance ordering, so a QR event can land after
  // connection.update='open'. The `status <> 'connected'` clause makes that a
  // no-op instead of flipping connected → connecting (which reverted the UI
  // from syncing back to a stale QR after a successful scan).
  await pool.query(
    `UPDATE whatsapp.whatsapp_instances
        SET qr_code = $2, status = 'connecting'
      WHERE id = $1 AND status <> 'connected'`,
    [instanceId, qr],
  )
  log.info('webhook.qrcode.refreshed', { instance_id: instanceId })
  // Frontend gets it via Realtime subscription on whatsapp_instances.
  // Secret cache invalidation isn't needed here, but if we ever rotate
  // secrets on qr refresh we'd call invalidateSecretCache(instanceId).
  void invalidateSecretCache  // referenced to keep the lint happy across versions
}

// ---- Helpers --------------------------------------------------------------

function isMessageData(v: unknown): v is WAMessageData {
  return typeof v === 'object' && v !== null
    && typeof (v as Record<string, unknown>)['key'] === 'object'
}

function normalizeTimestamp(ts: unknown): Date {
  if (typeof ts === 'number') return new Date(ts * (ts < 1e12 ? 1000 : 1))
  if (typeof ts === 'string') {
    const asNum = Number(ts)
    if (Number.isFinite(asNum)) return new Date(asNum * (asNum < 1e12 ? 1000 : 1))
    const d = new Date(ts)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

// Baileys protobuf numeric fields (e.g. audioMessage.seconds) can arrive as a
// JS number, a numeric string, or a Long-like { low, high, unsigned } object.
// Normalize to a finite number, or null if not derivable.
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (v && typeof v === 'object' && 'low' in (v as Record<string, unknown>)) {
    const low = (v as { low?: unknown }).low
    if (typeof low === 'number' && Number.isFinite(low)) return low
  }
  return null
}

function extractContent(message: WAMessageContent | undefined): {
  kind: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'reaction' | 'system'
  body: string | null
  mediaMeta: Record<string, unknown> | null
} {
  if (!message) {
    return { kind: 'system', body: null, mediaMeta: null }
  }
  if (message.conversation) {
    return { kind: 'text', body: message.conversation, mediaMeta: null }
  }
  if (message.extendedTextMessage?.text) {
    const ext = message.extendedTextMessage
    const lp = extractLinkPreview(ext)
    const ctx = ext.contextInfo as { mentionedJid?: string[] } | undefined
    const mentioned = ctx?.mentionedJid?.length ? ctx.mentionedJid : undefined
    const meta: Record<string, unknown> = {}
    if (lp) meta.link_preview = lp
    if (mentioned) meta.mentionedJid = mentioned
    return {
      kind: 'text',
      body: ext.text ?? null,
      mediaMeta: Object.keys(meta).length > 0 ? meta : null,
    }
  }
  // For media kinds the Evolution-provided URL is no longer stored -- the
  // worker downloads via getBase64FromMediaMessage and uploads to R2 in the
  // media-ingest loop. media_meta carries only the durable metadata
  // (mimetype, filename, caption) that survives the rehost.
  if (message.imageMessage) {
    const ctx = (message.imageMessage as Record<string, unknown>).contextInfo as { mentionedJid?: string[] } | undefined
    return {
      kind: 'image',
      body: message.imageMessage.caption ?? null,
      mediaMeta: { mimetype: message.imageMessage.mimetype, fileName: message.imageMessage.fileName, ...(ctx?.mentionedJid?.length ? { mentionedJid: ctx.mentionedJid } : {}) },
    }
  }
  if (message.videoMessage) {
    const ctx = (message.videoMessage as Record<string, unknown>).contextInfo as { mentionedJid?: string[] } | undefined
    const vSeconds = toFiniteNumber((message.videoMessage as Record<string, unknown>).seconds)
    // WhatsApp marks GIFs as videos with gifPlayback=true. Persist the flag so
    // the UI can render them as auto-looping GIFs instead of normal videos.
    const gifPlayback = (message.videoMessage as Record<string, unknown>).gifPlayback === true
    return {
      kind: 'video',
      body: message.videoMessage.caption ?? null,
      mediaMeta: {
        mimetype: message.videoMessage.mimetype,
        ...(vSeconds !== null ? { seconds: vSeconds } : {}),
        ...(gifPlayback ? { gifPlayback: true, isGif: true } : {}),
        ...(ctx?.mentionedJid?.length ? { mentionedJid: ctx.mentionedJid } : {}),
      },
    }
  }
  if (message.audioMessage) {
    const am = message.audioMessage as Record<string, unknown>
    const aSeconds = toFiniteNumber(am.seconds)
    // ptt MUST be an explicit boolean: the frontend renders a voice note vs an
    // audio FILE off `media_meta.ptt === false`, so an absent flag silently
    // falls back to voice-note. Evolution omits ptt for audio files (only sets
    // it true for voice notes), so coerce: explicit ptt OR an opus/ogg codec
    // (WhatsApp voice notes are always opus) → voice note; everything else is a
    // file (ptt=false), always persisted.
    const mimetype = message.audioMessage.mimetype
    const isPtt = message.audioMessage.ptt === true
      || (typeof mimetype === 'string' && /ogg|opus/i.test(mimetype))
    return {
      kind: 'audio', body: null,
      mediaMeta: {
        mimetype,
        ptt: isPtt,
        ...(aSeconds !== null ? { seconds: aSeconds } : {}),
      },
    }
  }
  if (message.documentMessage) {
    return {
      kind: 'document',
      body: message.documentMessage.caption ?? null,
      mediaMeta: { mimetype: message.documentMessage.mimetype, fileName: message.documentMessage.fileName },
    }
  }
  if (message.stickerMessage) {
    return {
      kind: 'sticker', body: null,
      mediaMeta: { mimetype: message.stickerMessage.mimetype },
    }
  }
  if (message.reactionMessage) {
    return {
      kind: 'reaction', body: message.reactionMessage.text ?? null,
      mediaMeta: { target_key: message.reactionMessage.key },
    }
  }

  // ── Template messages (WhatsApp Business API) ──────────────────────────
  // Hydrated templates carry text + optional image header + footer + buttons.
  // Extract the text body; if it has an image header, treat as image kind
  // so the media-ingest pipeline fetches it to R2.
  // ── Template messages (WhatsApp Business API) ──────────────────────────
  // Templates carry text + optional image/video header + footer + buttons.
  // ALWAYS store as kind=text so the body renders even when the header media
  // isn't available (CDN expired, or media-fetch hasn't run). The full
  // template structure (buttons, header image, footer) goes into media_meta
  // for the frontend to render a rich card when possible.
  if (message.templateMessage) {
    const tpl = extractTemplateContent(message.templateMessage)
    return {
      kind: 'text',
      body: tpl.body,
      mediaMeta: {
        subtype: 'template',
        templateId: message.templateMessage.templateId,
        hasImage: tpl.hasImage, hasVideo: tpl.hasVideo, hasDocument: tpl.hasDocument,
        buttons: tpl.buttons.length > 0 ? tpl.buttons : undefined,
        footer: tpl.footer,
        thumbnail: tpl.thumbnail,
        headerMediaKey: tpl.headerMediaKey,
        headerDirectPath: tpl.headerDirectPath,
        headerMimetype: tpl.headerMimetype,
      },
    }
  }

  // ── Associated child messages (album children) ──────────────────────────
  // Albums in WhatsApp group multiple images/videos into a swipeable carousel.
  // Each child wraps a regular imageMessage/videoMessage inside
  // .associatedChildMessage.message. Unwrap and recurse.
  if (message.associatedChildMessage?.message) {
    return extractContent(message.associatedChildMessage.message as WAMessageContent)
  }

  // ── Album container ─────────────────────────────────────────────────────
  // Empty shell saying "expect N images + M videos". The children carry the
  // actual media. Skip ingestion — children are separate webhook events.
  if (message.albumMessage) {
    return { kind: 'system', body: null, mediaMeta: { subtype: 'album_container' } }
  }

  // ── Location / contact / other structured types ─────────────────────────
  if (message.locationMessage) {
    const loc = message.locationMessage
    return { kind: 'location', body: null, mediaMeta: { subtype: 'location', lat: loc.degreesLatitude, lng: loc.degreesLongitude, name: loc.name, address: loc.address } }
  }
  if (message.contactMessage) {
    return { kind: 'contact', body: message.contactMessage.displayName ?? '[Contact]', mediaMeta: { subtype: 'contact', vcard: message.contactMessage.vcard } }
  }
  if (message.contactsArrayMessage) {
    const contacts = message.contactsArrayMessage.contacts ?? []
    const names = contacts.map((c: { displayName?: string }) => c.displayName).filter(Boolean)
    const vcards = contacts.map((c: { vcard?: string }) => c.vcard).filter(Boolean)
    return { kind: 'contact', body: names.join(', ') || '[Contacts]', mediaMeta: { subtype: 'contact_list', vcards, count: contacts.length } }
  }
  if (message.liveLocationMessage) {
    const ll = message.liveLocationMessage
    return { kind: 'location', body: null, mediaMeta: { subtype: 'live_location', lat: ll.degreesLatitude, lng: ll.degreesLongitude } }
  }

  // ── Protocol / placeholder / encrypted (unchanged) ─────────────────────
  if (message.protocolMessage) {
    return { kind: 'system', body: null, mediaMeta: { subtype: 'protocol', protocol_type: message.protocolMessage.type } }
  }
  if (message.placeholderMessage) {
    return { kind: 'system', body: null, mediaMeta: { subtype: 'waiting_for_message' } }
  }
  if (message.secretEncryptedMessage) {
    return { kind: 'system', body: null, mediaMeta: { subtype: 'waiting_for_message' } }
  }
  return { kind: 'system', body: null, mediaMeta: null }
}

/**
 * Translate WhatsApp's link-preview attachment on extendedTextMessage into a
/**
 * Extract content from all WhatsApp Business template variants:
 *   - hydratedTemplate / hydratedFourRowTemplate (older API)
 *   - interactiveMessageTemplate (newer API — used by Samsung, banks, etc.)
 *
 * Returns a normalized shape regardless of which variant is present.
 */
function extractTemplateContent(tplMsg: NonNullable<WAMessageContent['templateMessage']>): {
  body: string | null
  footer: string | null
  buttons: Array<{ text?: string | undefined; url?: string | undefined; phone?: string | undefined }>
  hasImage: boolean
  hasVideo: boolean
  hasDocument: boolean
  thumbnail?: string | undefined
  headerMediaKey?: string | undefined
  headerDirectPath?: string | undefined
  headerMimetype?: string | undefined
} {
  // ── Variant 1: hydratedTemplate / hydratedFourRowTemplate ──
  const hydrated = tplMsg.hydratedTemplate ?? tplMsg.hydratedFourRowTemplate
  if (hydrated) {
    const bodyText = hydrated.hydratedContentText ?? hydrated.imageMessage?.caption ?? null
    const footer = hydrated.hydratedFooterText ?? null
    // Don't concatenate footer into body — frontend renders it separately
    const fullBody = bodyText
    const buttons = (hydrated.hydratedButtons ?? []).map((b) => ({
      text: b.quickReplyButton?.displayText ?? b.urlButton?.displayText ?? b.callButton?.displayText ?? b.buttonText,
      url: b.urlButton?.url,
      phone: b.callButton?.phoneNumber,
    })).filter((b) => b.text)
    return {
      body: fullBody || null,
      footer,
      buttons,
      hasImage: !!hydrated.imageMessage,
      hasVideo: !!hydrated.videoMessage,
      hasDocument: !!hydrated.documentMessage,
    }
  }

  // ── Variant 2: interactiveMessageTemplate (newer WhatsApp Business API) ──
  const interactive = tplMsg.interactiveMessageTemplate
  if (interactive) {
    const bodyText = interactive.body?.text ?? null
    const footer = interactive.footer?.text ?? null
    const fullBody = bodyText

    // Buttons can be in interactive.buttons OR in nativeFlowMessage.buttons.
    // nativeFlowMessage buttons encode their display_text + url inside a JSON
    // string field called buttonParamsJson.
    const buttons: Array<{ text?: string | undefined; url?: string | undefined; phone?: string | undefined }> = []

    // Standard interactive buttons
    for (const b of interactive.buttons ?? []) {
      const inner = b.quickReplyButton ?? b.urlButton ?? b.callButton ?? {}
      buttons.push({
        text: (inner as { displayText?: string }).displayText ?? (inner as { text?: string }).text,
        url: (b.urlButton as { url?: string } | undefined)?.url,
        phone: (b.callButton as { phoneNumber?: string } | undefined)?.phoneNumber,
      })
    }

    // nativeFlowMessage buttons (Samsung, large brands)
    for (const b of interactive.nativeFlowMessage?.buttons ?? []) {
      try {
        const params = JSON.parse(b.buttonParamsJson ?? '{}') as { display_text?: string; url?: string; phone_number?: string }
        buttons.push({
          text: params.display_text,
          url: params.url,
          phone: params.phone_number,
        })
      } catch { /* malformed JSON — skip */ }
    }

    // Store the header image's encryption keys so media-ingest can download
    // directly from WhatsApp CDN (Evolution's getBase64FromMediaMessage can't
    // traverse into template headers).
    const headerImg = interactive.header?.imageMessage as Record<string, unknown> | undefined
    const thumbnail = headerImg?.jpegThumbnail as string | undefined
    const headerMediaKey = headerImg?.mediaKey as string | undefined
    const headerDirectPath = headerImg?.directPath as string | undefined
    const headerMimetype = headerImg?.mimetype as string | undefined

    return {
      body: fullBody || null,
      footer,
      buttons: buttons.filter((b) => b.text),
      hasImage: !!(interactive.header?.imageMessage ?? interactive.header?.hasMediaAttachment),
      hasVideo: !!interactive.header?.videoMessage,
      hasDocument: !!interactive.header?.documentMessage,
      thumbnail: thumbnail ?? undefined,
      headerMediaKey: headerMediaKey ?? undefined,
      headerDirectPath: headerDirectPath ?? undefined,
      headerMimetype: headerMimetype ?? undefined,
    }
  }

  return { body: null, footer: null, buttons: [], hasImage: false, hasVideo: false, hasDocument: false }
}

/**
 * Translate WhatsApp's link-preview attachment on extendedTextMessage into a
 * compact shape the UI can read directly from messages.media_meta.link_preview.
 * Returns null when no usable preview is present (no title, no description,
 * no image — just a bare URL).
 */
function extractLinkPreview(
  ext: NonNullable<WAMessageContent['extendedTextMessage']>,
): Record<string, unknown> | null {
  const title       = trimOrNull(ext.title)
  const description = trimOrNull(ext.description)
  const url         = trimOrNull(ext.canonicalUrl) ?? trimOrNull(ext.matchedText)
  if (!title && !description && !ext.jpegThumbnail) return null
  if (!url) return null
  const image = ext.jpegThumbnail
    ? `data:image/jpeg;base64,${ext.jpegThumbnail}`
    : null
  let domain: string | null = null
  try { domain = new URL(url).hostname.replace(/^www\./, '') } catch { /* ignore */ }
  return {
    url,
    canonical:   trimOrNull(ext.canonicalUrl),
    title,
    description,
    image,
    domain,
    site_name:   null,
  }
}
function trimOrNull(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null
  const t = s.trim()
  return t.length === 0 ? null : t
}

function extractReplyTo(m: WAMessageData): string | null {
  // Evolution puts contextInfo at the envelope level for simple message types
  // (conversation, etc.) and inside the message sub-object for others
  // (extendedTextMessage.contextInfo, imageMessage.contextInfo, etc.)
  const envelope = m as unknown as Record<string, unknown>
  const envCtx = envelope.contextInfo as { stanzaId?: string } | undefined
  if (envCtx?.stanzaId) return envCtx.stanzaId

  if (!m.message) return null
  const msg = m.message as Record<string, unknown>
  for (const key of Object.keys(msg)) {
    const sub = msg[key] as { contextInfo?: { stanzaId?: string } } | undefined
    if (sub?.contextInfo?.stanzaId) return sub.contextInfo.stanzaId
  }
  return null
}

// WhatsApp marks a message forwarded via contextInfo.isForwarded (+ a
// forwardingScore that rises with each hop; >=5 = "frequently forwarded"). The
// flag is set by the sending client ONLY when the content was not composed by
// that sender — so trusting it is correct for inbound forwards AND for the
// user's own phone-synced outbound forwards (WhatsApp omits it when you forward
// your own message). contextInfo sits at the envelope level for simple types
// and inside each message sub-object otherwise — same walk as extractReplyTo.
function extractForwarded(m: WAMessageData): { isForwarded: boolean; score: number } {
  const read = (ctx: unknown): { isForwarded: boolean; score: number } | null => {
    const c = ctx as { isForwarded?: boolean; forwardingScore?: number } | undefined
    if (!c) return null
    const score = typeof c.forwardingScore === 'number' ? c.forwardingScore : 0
    if (c.isForwarded === true || score > 0) return { isForwarded: true, score }
    return null
  }
  const envelope = m as unknown as Record<string, unknown>
  const fromEnv = read(envelope.contextInfo)
  if (fromEnv) return fromEnv
  if (m.message) {
    const msg = m.message as Record<string, unknown>
    for (const key of Object.keys(msg)) {
      const sub = msg[key] as { contextInfo?: unknown } | undefined
      const hit = read(sub?.contextInfo)
      if (hit) return hit
    }
  }
  return { isForwarded: false, score: 0 }
}

function mapConnectionState(state: string | undefined): 'pending' | 'connecting' | 'connected' | 'disconnected' | 'error' | null {
  switch (state) {
    case 'open':       return 'connected'
    case 'close':      return 'disconnected'
    case 'connecting': return 'connecting'
    default:           return null
  }
}

function extractPhoneFromWuid(wuid: string | undefined): string | null {
  if (!wuid) return null
  // "212600000000:1@s.whatsapp.net" → "+212600000000"
  const num = wuid.split('@')[0]?.split(':')[0]
  if (!num) return null
  return `+${num}`
}

// ---- presence.update -----------------------------------------------------
// Baileys forwards peer typing/online state. We broadcast via Supabase
// Realtime on `presence:<instance_id>` so the frontend can render a
// WhatsApp-style typing indicator with sub-second latency.
//
// Wire format per broadcast:
//   { remote_jid, participant_jid|null, presence, at_ms }
//
// The frontend filters per-conversation by matching `remote_jid`. For DMs
// the `id` IS the peer JID; for groups, `id` is the group JID and the
// presences map keys are individual participant JIDs.

const presenceChannels = new Map<string, ReturnType<typeof supabase.channel>>()

// ---- Inbox attendance registry (online-while-attended) --------------------
//
// The frontend broadcasts a per-(tab,instance) "attend" heartbeat on the
// wa-typing channel while the inbox page is mounted AND document-visible, and
// a "leave" when it hides/unmounts. We keep an in-memory TTL registry of live
// viewers per instance. While an instance is attended, the dispatcher self-
// presence driver (loop.ts) keeps the WA number ONLINE so WhatsApp keeps
// delivering peer typing; when the last viewer leaves/expires we revert to
// ban-safe offline. TTL-based (never a latch): a crashed/closed tab ages out.
const VIEWER_TTL_MS = 35_000 // ~3.5 heartbeats (frontend beats every 10s)
const viewerRegistry = new Map<string, Map<string, number>>() // instanceId -> viewerId -> expiresAt
// Per-instance currently-open DM peer (phone JID) — the focused chat. Kept
// warm with a forced re-subscribe so its typing survives the whole session.
const activeOpenPeer = new Map<string, string>()
// loop.ts registers this so the FIRST attend can flip the number online in ~1s
// instead of waiting a self-presence tick. Set via setOnFirstAttend (one-way
// dependency: loop imports from handlers, handlers calls back through this).
let onFirstAttend: ((instanceId: string) => void) | null = null
export function setOnFirstAttend(fn: (instanceId: string) => void): void { onFirstAttend = fn }

function registerViewer(instanceId: string, viewerId: string): void {
  let inner = viewerRegistry.get(instanceId)
  const wasAttended = !!inner && inner.size > 0
  if (!inner) { inner = new Map(); viewerRegistry.set(instanceId, inner) }
  inner.set(viewerId, Date.now() + VIEWER_TTL_MS)
  if (!wasAttended && onFirstAttend) onFirstAttend(instanceId)
}

function dropViewer(instanceId: string, viewerId: string): void {
  const inner = viewerRegistry.get(instanceId)
  if (!inner) return
  inner.delete(viewerId)
  if (inner.size === 0) viewerRegistry.delete(instanceId)
}

/** True if any non-expired viewer has this instance's inbox open + visible.
 *  Prunes expired entries on read — no separate sweep timer needed. */
export function isInstanceAttended(instanceId: string): boolean {
  const inner = viewerRegistry.get(instanceId)
  if (!inner) return false
  const now = Date.now()
  for (const [vid, exp] of inner) if (exp <= now) inner.delete(vid)
  if (inner.size === 0) { viewerRegistry.delete(instanceId); return false }
  return true
}

export function attendedViewerCount(instanceId: string): number {
  return isInstanceAttended(instanceId) ? (viewerRegistry.get(instanceId)?.size ?? 0) : 0
}

/** Force a re-subscribe of the focused peer so WhatsApp keeps delivering its
 *  typing. Driven from loop.ts on a sub-50s cadence while online. force=true
 *  bypasses the 30-min throttle (single peer only — not a fleet-wide storm). */
export function refreshActiveOpenPeer(instanceId: string): void {
  if (!isInstanceAttended(instanceId)) return
  const peerJid = activeOpenPeer.get(instanceId)
  if (peerJid) ensurePeerPresenceSubscribed(instanceId, peerJid, { force: true })
}

function getPresenceChannel(instanceId: string): ReturnType<typeof supabase.channel> {
  let ch = presenceChannels.get(instanceId)
  if (ch) return ch
  // Distinct from the agent-side `presence:conv:<conv_id>` channel.
  // Same channel is also used as the bus for frontend → worker
  // `conversation opened` signals (event: 'open'), so we can subscribe to
  // peer presence the moment an agent focuses a chat without waiting for
  // the next inbound message. And as the bus for edge functions → worker
  // `purge_peer` signals, fired when a conversation is deleted so the next
  // inbound from that peer re-subscribes Baileys cleanly.
  ch = supabase.channel(`wa-typing:${instanceId}`, { config: { broadcast: { self: false, ack: false } } })
  ch.on('broadcast', { event: 'open' }, (msg) => {
    const payload = msg.payload as { remote_jid?: string } | undefined
    const peerJid = payload?.remote_jid
    if (!peerJid) return
    // Track the focused peer so the self-presence driver can keep it warm, and
    // force a re-subscribe NOW: a cold-open after idle has a stale (non-expired)
    // throttle entry but a lapsed WA-side subscription, so the throttled call
    // would no-op and typing would not arrive until the next forced refresh.
    activeOpenPeer.set(instanceId, peerJid)
    ensurePeerPresenceSubscribed(instanceId, peerJid, { force: true })
  })
  ch.on('broadcast', { event: 'attend' }, (msg) => {
    const p = msg.payload as { viewer_id?: string } | undefined
    if (p?.viewer_id) registerViewer(instanceId, p.viewer_id)
  })
  ch.on('broadcast', { event: 'leave' }, (msg) => {
    const p = msg.payload as { viewer_id?: string } | undefined
    if (p?.viewer_id) dropViewer(instanceId, p.viewer_id)
  })
  ch.on('broadcast', { event: 'purge_peer' }, (msg) => {
    const payload = msg.payload as { remote_jid?: string } | undefined
    const peerJid = payload?.remote_jid
    if (!peerJid) return
    purgePeerSubscriptionEntry(instanceId, peerJid)
    if (activeOpenPeer.get(instanceId) === peerJid) activeOpenPeer.delete(instanceId)
  })
  ch.subscribe((status) => {
    log.info('presence.channel.status', { instance_id: instanceId, status })
  })
  presenceChannels.set(instanceId, ch)
  return ch
}

/** Eagerly subscribe presence channels for all known instances on worker
 *  boot, so the first inbound presence event doesn't get dropped while the
 *  channel is still JOINING. */
export async function warmupPresenceChannels(instanceIds: string[]): Promise<void> {
  for (const id of instanceIds) {
    if (!presenceChannels.has(id)) getPresenceChannel(id)
  }
}

// LID → phone-JID cache. Peer presence events arrive keyed by @lid after
// WhatsApp's privacy migration; the frontend keys conversations by phone JID
// (@s.whatsapp.net), so we resolve before broadcasting. 10-minute TTL — the
// mapping is effectively immutable for an active session.
const LID_RESOLVE_TTL_MS = 10 * 60 * 1000
const lidResolveCache = new Map<string, { phoneJid: string | null; expiresAt: number }>()

async function resolveLidToPhoneJid(instanceId: string, lid: string): Promise<string | null> {
  const key = `${instanceId}:${lid}`
  const cached = lidResolveCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.phoneJid
  let phoneJid: string | null = null
  try {
    // Presence-only resolver: prefer this instance's mapping, but fall back to
    // ANY instance's deterministic (Alt-sourced) mapping — a contact's lid↔phone
    // identity is global, so a mapping captured when they messaged number A is
    // valid for showing their typing on number B. (Display-only; a wrong match
    // would just put a typing bubble on the wrong chat, not corrupt identity —
    // unlike group-sender attribution, which stays strictly per-instance.)
    const { rows } = await pool.query<{ phone_jid: string }>(
      `SELECT phone_jid FROM whatsapp.jid_mapping
         WHERE lid = $2
         ORDER BY (instance_id = $1) DESC
         LIMIT 1`,
      [instanceId, lid],
    )
    phoneJid = rows[0]?.phone_jid ?? null

    // Bible fallback (display-only). jid_mapping is sparse — it only learns a
    // pair from a message Alt field, group roster, or a manual pairing. The
    // contact bible (contact_identifiers) now captures every identifier and
    // links lid<->phone, so when jid_mapping misses we resolve via the bible:
    // find ANY non-merged contact that carries this lid AND a phone_jid. This
    // is CROSS-INSTANCE on purpose — a contact's lid<->phone identity is global,
    // and the frozen-merge split frequently leaves the lid and the phone on
    // SEPARATE contacts of the SAME instance (lid-only row has phone_jid NULL),
    // so an instance-scoped lookup would return null. Strictly READ-ONLY: never
    // writes a mapping and never merges (identity_merge_enabled stays off). A
    // wrong match would only misplace a typing bubble, never corrupt identity.
    if (!phoneJid) {
      const { rows: bibleRows } = await pool.query<{ phone_jid: string }>(
        `SELECT c.phone_jid
           FROM whatsapp.contact_identifiers ci
           JOIN whatsapp.contacts c ON c.id = ci.contact_id
          WHERE ci.identifier = $2
            AND c.phone_jid IS NOT NULL
            AND c.merged_into IS NULL
          ORDER BY (ci.instance_id = $1) DESC
          LIMIT 1`,
        [instanceId, lid],
      )
      phoneJid = bibleRows[0]?.phone_jid ?? null
    }
  } catch (err) {
    log.warn('presence.lid_resolve_failed', {
      instance_id: instanceId, lid,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  lidResolveCache.set(key, { phoneJid, expiresAt: Date.now() + LID_RESOLVE_TTL_MS })
  return phoneJid
}

async function handlePresenceUpdate(instanceId: string, data: PresenceUpdateData): Promise<void> {
  const rawRemoteJid = data?.id
  if (!rawRemoteJid || !isIngestableJid(rawRemoteJid)) {
    log.debug('presence.skipped_unsupported_jid', { instance_id: instanceId, remote_jid: rawRemoteJid })
    return
  }
  const presences = data.presences ?? {}
  const at_ms = Date.now()
  const ch = getPresenceChannel(instanceId)

  const entries = Object.entries(presences)
  if (entries.length === 0) {
    log.debug('presence.empty_payload', { instance_id: instanceId, remote_jid: rawRemoteJid })
    return
  }

  // For DMs, resolve the @lid envelope to its phone JID. Groups keep their
  // @g.us id; only their participants need translation.
  const isGroup = rawRemoteJid.endsWith('@g.us')
  let conversationJid = rawRemoteJid
  if (!isGroup && rawRemoteJid.endsWith('@lid')) {
    // Read-only resolution. The presence temporal-correlation guesser that
    // used to fabricate a LID<->phone pair here was removed (Contact Truth
    // Phase 0): it produced TRANSPOSED mappings that fused unrelated contacts.
    // If no deterministic mapping exists yet we broadcast under the raw @lid; a
    // later deterministic signal (message Alt fields / group metadata / manual
    // pairing) resolves it correctly.
    const resolved = await resolveLidToPhoneJid(instanceId, rawRemoteJid)
    if (resolved) conversationJid = resolved
  }

  // Aliases to broadcast under. When the LID-keyed presence resolves to a
  // canonical phone JID, we send under BOTH so the frontend hits regardless
  // of which form the conversation row was created under (LID-only contacts
  // do not get a conversation row, but defensive double-key keeps us robust
  // against any unresolved-LID conv that survived past migrations).
  const broadcastJids = conversationJid === rawRemoteJid
    ? [conversationJid]
    : [conversationJid, rawRemoteJid]

  for (const [participantJid, info] of entries) {
    const presence = info?.lastKnownPresence
    if (!presence) continue

    // Participants inside group presences are individual senders; resolve
    // their @lid → phone JID so the frontend mention matching works.
    let resolvedParticipant: string | null = participantJid === rawRemoteJid ? null : participantJid
    if (resolvedParticipant && resolvedParticipant.endsWith('@lid')) {
      const resolved = await resolveLidToPhoneJid(instanceId, resolvedParticipant)
      if (resolved) resolvedParticipant = resolved
    }

    for (const broadcastJid of broadcastJids) {
      try {
        const result = await ch.send({
          type: 'broadcast',
          event: 'presence',
          payload: {
            remote_jid: broadcastJid,
            participant_jid: resolvedParticipant,
            presence,
            at_ms,
          },
        })
        log.info('presence.broadcast', {
          instance_id: instanceId,
          remote_jid: broadcastJid,
          raw_remote_jid: broadcastJid === rawRemoteJid ? undefined : rawRemoteJid,
          participant_jid: resolvedParticipant,
          presence, result,
        })
      } catch (err) {
        log.warn('presence.broadcast_failed', {
          instance_id: instanceId, remote_jid: broadcastJid,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}

// ---- Peer-presence subscription ------------------------------------------
//
// WhatsApp's server only pushes peer typing/recording presence to sessions
// that have explicitly subscribed via Baileys' `presenceSubscribe(jid)`.
// Evolution v2.3.7 doesn't expose that as a standalone route, but its
// `/chat/sendPresence/<instance>` endpoint calls `presenceSubscribe(jid)`
// internally as a side-effect — verified empirically.
//
// We piggyback on that: every time an inbound DM arrives from a peer we
// haven't subscribed to recently, fire a single `sendPresence` call with
// `presence:available, delay:0`. That triggers the subscription; the peer
// momentarily sees us "online" (which we are anyway, since we're connected),
// and from then on their typing events flow through PRESENCE_UPDATE.

const PEER_SUBSCRIBE_TTL_MS = 30 * 60 * 1000 // re-subscribe at most every 30 min
const peerSubscribeCache = new Map<string, number>() // key: `${instanceId}:${peerJid}` → expiresAt

// (Contact Truth Phase 0) The presence temporal-correlation guesser
// (pendingLidCorrelations + record/consumePendingLidCorrelation) was removed:
// it fabricated TRANSPOSED LID<->phone pairs that fused unrelated contacts.

// Per-instance Evolution client cache. Keyed by instance_id.
const evoClientCache = new Map<string, { client: EvolutionClient; name: string; expiresAt: number }>()
const EVO_CLIENT_TTL_MS = 5 * 60 * 1000

async function getEvolutionClientForInstance(instanceId: string): Promise<EvolutionClient | null> {
  const cached = evoClientCache.get(instanceId)
  if (cached && cached.expiresAt > Date.now()) return cached.client
  const { rows } = await pool.query<{ name: string; token: string | null }>(
    `SELECT i.evolution_instance_name AS name,
            whatsapp.reveal_instance_token(i.id) AS token
       FROM whatsapp.whatsapp_instances i
      WHERE i.id = $1`,
    [instanceId],
  )
  const r = rows[0]
  if (!r || !r.token) return null
  const client = new EvolutionClient({ apiKey: r.token, instance: r.name, timeoutMs: 10_000 })
  evoClientCache.set(instanceId, { client, name: r.name, expiresAt: Date.now() + EVO_CLIENT_TTL_MS })
  return client
}

// Pull the FULL contact list from Evolution and ingest it into our contacts
// table (the bible). The history sync populates Evolution's Contact table in
// bulk but only forwards a trickle of CONTACTS_UPSERT webhooks, so relying on
// webhooks alone leaves us with a fraction of the contacts (observed 4 of 45).
// This closes that gap: every contact Evolution knows lands in our bible.
// Contacts-table only — does NOT create conversations (avoids empty-shell
// inbox clutter). Best-effort, idempotent (resolve_identity upserts).
const backfillInFlight = new Set<string>()
async function backfillContactsFromEvolution(instanceId: string): Promise<void> {
  if (backfillInFlight.has(instanceId)) return
  backfillInFlight.add(instanceId)
  try {
    const client = await getEvolutionClientForInstance(instanceId)
    if (!client) return
    const raw = await client.findContacts()
    const items = Array.isArray(raw) ? (raw as Array<{ remoteJid?: string; pushName?: string; profilePicUrl?: string | null }>) : []
    let ingested = 0
    for (const c of items) {
      const jid = c.remoteJid
      if (!jid || !isIngestableJid(jid) || jid.endsWith('@g.us')) continue   // DMs/LIDs only
      const pic = await cacheAvatar(instanceId, c.profilePicUrl ?? null)
      const trimmed = c.pushName?.trim() ?? null
      const name = trimmed && !looksLikeFallbackName(trimmed, jid) ? trimmed : null
      await upsertContactFromSync(instanceId, jid, name, pic)   // contacts + bible, no conversation
      ingested++
    }
    log.info('contacts.backfill.done', { instance_id: instanceId, evolution_total: items.length, ingested })
  } catch (err) {
    log.warn('contacts.backfill.failed', {
      instance_id: instanceId, error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    backfillInFlight.delete(instanceId)
  }
}

/**
 * Ensure Baileys is subscribed to a peer's presence so their typing events
 * flow over PRESENCE_UPDATE. Fire-and-forget — never blocks message ingest.
 * Throttled per (instance, peer) by PEER_SUBSCRIBE_TTL_MS.
 *
 * Only call for DM peers (@s.whatsapp.net or @lid). Groups have group-level
 * presence and Evolution rejects sendPresence to groups.
 *
 * @param opts.force  bypass the throttle (used by the periodic warmup loop
 *                    and by reconnect recovery, where the Baileys-side
 *                    subscription state may have been wiped).
 */
function ensurePeerPresenceSubscribed(
  instanceId: string,
  peerJid: string,
  opts?: { force?: boolean },
): void {
  if (!peerJid) return
  // Skip non-DM JIDs — groups, broadcast, status, newsletters.
  if (!peerJid.endsWith('@s.whatsapp.net') && !peerJid.endsWith('@lid')) return
  const key = `${instanceId}:${peerJid}`
  const now = Date.now()
  if (!opts?.force) {
    const expiresAt = peerSubscribeCache.get(key)
    if (expiresAt && expiresAt > now) return
  }
  // Reserve the slot immediately so concurrent inbounds collapse to one call.
  peerSubscribeCache.set(key, now + PEER_SUBSCRIBE_TTL_MS)

  void (async () => {
    try {
      const evo = await getEvolutionClientForInstance(instanceId)
      if (!evo) return
      // Evolution's sendPresence accepts a raw phone number ("212694522403")
      // or full JID; the JID variant works for both @s.whatsapp.net and @lid.
      await evo.sendPresence({ number: peerJid, presence: 'available', delay: 0 })
      log.info('presence.peer_subscribed', { instance_id: instanceId, peer_jid: peerJid })
    } catch (err) {
      // Drop the throttle so the next inbound retries.
      peerSubscribeCache.delete(key)
      log.warn('presence.peer_subscribe_failed', {
        instance_id: instanceId, peer_jid: peerJid,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })()
}

/**
 * Drop the worker's throttle record for a single (instance, peer). Called
 * when a conversation is deleted from the admin UI — the next inbound from
 * that peer must re-fire `sendPresence` so Baileys starts fresh, otherwise
 * the peer's typing events stay invisible.
 */
function purgePeerSubscriptionEntry(instanceId: string, peerJid: string): void {
  const key = `${instanceId}:${peerJid}`
  const hadEntry = peerSubscribeCache.delete(key)
  if (hadEntry) {
    log.info('presence.peer_subscription_purged', {
      instance_id: instanceId, peer_jid: peerJid,
    })
  }
}

/**
 * Drop the worker's record of which peers we've subscribed-to on a given
 * instance. Called when Baileys reconnects (Evolution restart, network blip,
 * WA-side session reset) — the new Baileys socket starts with zero peer
 * subscriptions, so we must allow re-subscribe on the next inbound rather
 * than honoring the stale throttle.
 */
function purgePeerSubscriptionsForInstance(instanceId: string): void {
  const prefix = `${instanceId}:`
  let removed = 0
  for (const key of peerSubscribeCache.keys()) {
    if (key.startsWith(prefix)) {
      peerSubscribeCache.delete(key)
      removed++
    }
  }
  // The lid-resolve cache holds (instance, lid) → phone_jid pairs from the
  // jid_mapping table; those mappings are still valid across reconnects, so
  // we leave that cache intact.
  if (removed > 0) {
    log.info('presence.subscriptions_purged_on_reconnect', {
      instance_id: instanceId, removed,
    })
  }
}

// ---- Periodic active-peer warmup -----------------------------------------
//
// Inbound-triggered subscription only kicks in when a peer sends us a
// message. To keep typing-indicator coverage across long quiet periods (peer
// is online and typing but hasn't pressed send yet), we re-issue the
// subscribe periodically for every DM whose last_inbound_at is within the
// last 24 h. This is also the recovery path for an Evolution restart that
// somehow misses the connection.update purge.

const ACTIVE_PEER_WARMUP_INTERVAL_MS = 20 * 60 * 1000 // 20 min
const ACTIVE_PEER_WARMUP_LOOKBACK = '24 hours'
const ACTIVE_PEER_WARMUP_BATCH = 25            // peers per concurrency batch
const ACTIVE_PEER_WARMUP_BATCH_GAP_MS = 500    // gap between batches

let warmupTimer: NodeJS.Timeout | null = null
let warmupRunning = false

async function runActivePeerWarmup(): Promise<void> {
  if (warmupRunning) return
  warmupRunning = true
  try {
    const { rows } = await pool.query<{ instance_id: string; remote_jid: string }>(
      `SELECT c.instance_id, c.remote_jid
         FROM whatsapp.conversations c
         JOIN whatsapp.whatsapp_instances i ON i.id = c.instance_id
        WHERE i.status = 'connected'
          AND COALESCE(i.lifecycle_state, 'warming') <> 'banned'
          AND c.is_group = false
          AND c.last_inbound_at IS NOT NULL
          AND c.last_inbound_at >= now() - $1::interval`,
      [ACTIVE_PEER_WARMUP_LOOKBACK],
    )
    if (rows.length === 0) {
      log.debug('presence.warmup.no_active_peers')
      return
    }

    let scheduled = 0
    for (let i = 0; i < rows.length; i += ACTIVE_PEER_WARMUP_BATCH) {
      const batch = rows.slice(i, i + ACTIVE_PEER_WARMUP_BATCH)
      for (const r of batch) {
        ensurePeerPresenceSubscribed(r.instance_id, r.remote_jid, { force: true })
        scheduled++
      }
      if (i + ACTIVE_PEER_WARMUP_BATCH < rows.length) {
        await new Promise((resolve) => setTimeout(resolve, ACTIVE_PEER_WARMUP_BATCH_GAP_MS))
      }
    }
    log.info('presence.warmup.completed', { active_peers: rows.length, scheduled })
  } catch (err) {
    log.warn('presence.warmup.failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    warmupRunning = false
  }
}

export function startActivePeerWarmup(): void {
  if (warmupTimer) return
  // Stagger the first run so it doesn't collide with worker boot work.
  setTimeout(() => { void runActivePeerWarmup() }, 30_000).unref()
  warmupTimer = setInterval(() => { void runActivePeerWarmup() }, ACTIVE_PEER_WARMUP_INTERVAL_MS)
  warmupTimer.unref()
  log.info('presence.warmup.started', { interval_ms: ACTIVE_PEER_WARMUP_INTERVAL_MS })
}

export function stopActivePeerWarmup(): void {
  if (warmupTimer) {
    clearInterval(warmupTimer)
    warmupTimer = null
  }
}
