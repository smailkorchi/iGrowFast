// WhatsApp peer-side typing presence — subscribes to the worker's broadcast
// channel `wa-typing:<instance_id>` and exposes a per-conversation typing
// snapshot keyed by remote_jid.
//
// Wire format (from worker):
//   { remote_jid, participant_jid|null, presence, at_ms }
//
// Presence values from Baileys:
//   'available' | 'unavailable' | 'composing' | 'recording' | 'paused'
//
// Freshness rule: WhatsApp's typing pings stop after ~6 s; we treat a peer
// as "still typing" for 8 s after the last `composing` event, then auto-
// expire. A `paused` event collapses the state immediately.
//
// The same channel is reused as the upstream bus for `open` events: when
// the agent focuses a conversation, the hook broadcasts {remote_jid}; the
// worker listens and calls Evolution's sendPresence so Baileys subscribes
// to that peer's typing. Closes the cold-open gap where opening an old
// chat would otherwise show no typing until the peer sent a new message.

import { useEffect, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase'

export type WaPresence =
  | 'available' | 'unavailable' | 'composing' | 'recording' | 'paused'

export interface PeerTypingState {
  presence: WaPresence
  at_ms: number
  participant_jid: string | null
}

const TYPING_TTL_MS = 8_000
// Min interval between 'open' re-announcements for the SAME focused peer. An
// 'open' makes the worker force-subscribe to that peer's presence (a WhatsApp
// presenceSubscribe = 'available' toward the peer, which stomps outbound typing
// and, at volume, is a bot fingerprint). Re-emitting on every Realtime
// resubscribe caused a peer-subscribe storm (audit 2026-07-08). One 'open' per
// real focus change; re-prime the same peer at most this often across reconnects.
const OPEN_MIN_INTERVAL_MS = 30_000
const EMPTY_MAP: Map<string, PeerTypingState> = new Map()

// ─── Shared per-instance presence store ─────────────────────────────────────
//
// Multiple components (conversation list rows, the open ChatPane header/
// thread) need the same peer presence. Each calling `supabase.channel(topic)`
// independently would create competing subscriptions to the SAME realtime
// topic — Supabase then routes a broadcast to only one of them, so whichever
// mounted last "wins" and the others go dark (the bug: typing showed in the
// open chat but not the list preview).
//
// Fix: ONE channel per instanceId, ref-counted, with a shared presenceMap and
// a fan-out listener set. Every consumer reads the same store.

interface InstanceStore {
  channel: RealtimeChannel
  presenceMap: Map<string, PeerTypingState>
  listeners: Set<() => void>
  refcount: number
  sweep: ReturnType<typeof setInterval>
  isSubscribed: boolean
  lastOpenSent: string | null
  lastOpenSentAt: number
  sendOpen: (jid: string | null | undefined) => void
  // Inbox-attendance heartbeat (online-while-attended). viewerId is unique per
  // (tab, instance) so the worker refcounts viewers correctly across multi-tab
  // and instance-switch. `viewing` is set while a useInboxAttendance hook is
  // mounted for this instance so we re-announce on Realtime resubscribe.
  viewerId: string
  viewing: boolean
  sendAttend: () => void
  sendLeave: () => void
}

const stores = new Map<string, InstanceStore>()

function notify(store: InstanceStore): void {
  for (const fn of store.listeners) fn()
}

function acquireStore(instanceId: string): InstanceStore {
  const existing = stores.get(instanceId)
  if (existing) { existing.refcount++; return existing }

  // WA-RT-2 (ban-safety): PRIVATE channel — realtime.messages RLS (mig
  // 20260717050000, whatsapp.can_use_typing_topic → can_use_instance) gates who may
  // receive OR publish attend/open, closing the cross-tenant vector where any seller
  // with the anon key + an instance UUID could pin a number online / storm presence.
  // MUST stay in lockstep with the worker's wa-typing channel (handlers.ts) — mixed
  // public/private on one topic is undefined; deploy client + worker together.
  const channel: RealtimeChannel = supabase.channel(`wa-typing:${instanceId}`, {
    config: { private: true, broadcast: { self: false, ack: false } },
  })

  const store: InstanceStore = {
    channel,
    presenceMap: EMPTY_MAP,
    listeners: new Set(),
    refcount: 1,
    isSubscribed: false,
    lastOpenSent: null,
    lastOpenSentAt: 0,
    sweep: setInterval(() => {
      if (store.presenceMap.size === 0) return
      const now = Date.now()
      let mutated = false
      const next = new Map(store.presenceMap)
      for (const [jid, st] of next.entries()) {
        if (now - st.at_ms > TYPING_TTL_MS) { next.delete(jid); mutated = true }
      }
      if (mutated) { store.presenceMap = next; notify(store) }
    }, 1_000),
    sendOpen: (jid) => {
      if (!jid || !store.isSubscribed) return
      // Rate-limit per focused peer: a real focus change (new jid) sends
      // immediately; the SAME peer re-announces at most once per
      // OPEN_MIN_INTERVAL_MS — so a burst of Realtime resubscribes can't re-flood
      // the worker's peer-subscribe (which stomps outbound typing / floods WA).
      const now = Date.now()
      if (jid === store.lastOpenSent && now - store.lastOpenSentAt < OPEN_MIN_INTERVAL_MS) return
      store.lastOpenSent = jid
      store.lastOpenSentAt = now
      void channel.send({ type: 'broadcast', event: 'open', payload: { remote_jid: jid } })
    },
    viewerId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    viewing: false,
    sendAttend: () => {
      if (!store.isSubscribed) return
      void channel.send({
        type: 'broadcast', event: 'attend',
        payload: { instance_id: instanceId, viewer_id: store.viewerId, at_ms: Date.now() },
      })
    },
    sendLeave: () => {
      void channel.send({
        type: 'broadcast', event: 'leave',
        payload: { instance_id: instanceId, viewer_id: store.viewerId },
      })
    },
  }

  channel.on('broadcast', { event: 'purge_peer' }, (msg) => {
    const peerJid = (msg.payload as { remote_jid?: string } | undefined)?.remote_jid
    if (!peerJid || !store.presenceMap.has(peerJid)) return
    const next = new Map(store.presenceMap)
    next.delete(peerJid)
    store.presenceMap = next
    notify(store)
  })

  channel.on('broadcast', { event: 'presence' }, (msg) => {
    const p = msg.payload as {
      remote_jid?: string
      participant_jid?: string | null
      presence?: WaPresence
      at_ms?: number
    }
    if (!p?.remote_jid || !p.presence) return
    const isTypingLike = p.presence === 'composing' || p.presence === 'recording'
    if (isTypingLike) {
      const next = new Map(store.presenceMap)
      next.set(p.remote_jid, {
        presence: p.presence,
        at_ms: typeof p.at_ms === 'number' ? p.at_ms : Date.now(),
        participant_jid: p.participant_jid ?? null,
      })
      store.presenceMap = next
      notify(store)
    } else if (store.presenceMap.has(p.remote_jid)) {
      const next = new Map(store.presenceMap)
      next.delete(p.remote_jid)
      store.presenceMap = next
      notify(store)
    }
  })

  channel.subscribe((status) => {
    store.isSubscribed = status === 'SUBSCRIBED'
    if (store.isSubscribed && store.lastOpenSent) {
      // Re-announce the focused conv after a (re)subscribe, but do NOT reset the
      // dedupe — sendOpen's per-peer rate limit collapses reconnect bursts to at
      // most one 'open' per OPEN_MIN_INTERVAL_MS (fixes the peer-subscribe storm),
      // while still re-priming after a genuinely long gap.
      store.sendOpen(store.lastOpenSent)
    }
    // Re-register attendance after a Realtime (re)subscribe so a dropped/
    // reconnected socket doesn't let the worker age out our viewer.
    if (store.isSubscribed && store.viewing) store.sendAttend()
  })

  stores.set(instanceId, store)
  return store
}

function releaseStore(instanceId: string): void {
  const store = stores.get(instanceId)
  if (!store) return
  store.refcount--
  if (store.refcount > 0) return
  clearInterval(store.sweep)
  void supabase.removeChannel(store.channel)
  stores.delete(instanceId)
}

/**
 * Subscribe to peer typing/presence for one instance.
 *
 * @param instanceId  WhatsApp instance to listen on (null = no subscription).
 * @param openConvJid Currently focused conversation's `remote_jid`. When it
 *                    changes, the hook tells the worker so it can subscribe
 *                    to the peer's presence ahead of any new inbound.
 *
 * Returns a Map keyed by `remote_jid`. The map identity changes only when
 * its contents change, so React.memo'd consumers won't re-render when
 * unrelated peers update.
 */
export function useWaPeerPresence(
  instanceId: string | null,
  openConvJid?: string | null,
): Map<string, PeerTypingState> {
  const [presenceMap, setPresenceMap] = useState<Map<string, PeerTypingState>>(EMPTY_MAP)

  // Subscribe to the shared per-instance store (ref-counted single channel).
  useEffect(() => {
    if (!instanceId) { setPresenceMap(EMPTY_MAP); return }
    const store = acquireStore(instanceId)
    const listener = () => setPresenceMap(store.presenceMap)
    store.listeners.add(listener)
    setPresenceMap(store.presenceMap)   // initial snapshot
    return () => {
      store.listeners.delete(listener)
      releaseStore(instanceId)
    }
  }, [instanceId])

  // Announce the focused conversation so the worker subscribes that peer's
  // Baileys presence. No-op for list-level consumers that pass null.
  useEffect(() => {
    if (!instanceId || !openConvJid) return
    stores.get(instanceId)?.sendOpen(openConvJid)
  }, [instanceId, openConvJid])

  return presenceMap
}

/**
 * Keep the WA number ONLINE while this inbox page is mounted AND the tab is
 * visible, so WhatsApp keeps delivering peer typing/recording the whole time
 * an agent is attending (not just the ~50s burst after opening a chat). The
 * worker flips `manual_presence='auto'` numbers online while attended and back
 * to ban-safe offline within a short grace once the last viewer leaves/hides.
 *
 * Heartbeat: an `attend` broadcast every 10s WHILE document.visibilityState===
 * 'visible'; a `leave` on hide/unmount. The 35s worker TTL absorbs one missed
 * beat without flapping. Pass null (e.g. disconnected/empty inbox) to no-op.
 *
 * Decoupled from the composer and from any single open chat — it is tied to the
 * page being open and visible, exactly as the product requires.
 */
const ATTEND_HEARTBEAT_MS = 10_000
// Grace window after the tab is hidden before we mark the number unattended.
// A hidden tab throttles the heartbeat (~1/min), so we do NOT rely on beats
// here — we simply hold "attended" for this long (the worker's 80s VIEWER_TTL_MS
// covers the beat-less window) and only send 'leave' if still hidden at the end.
// This keeps outbound typing/recording working while the agent briefly switches
// windows (DevTools, another app) instead of the number flapping offline the
// instant the tab loses focus. Genuine unmount (leaving the inbox) still leaves
// immediately.
const HIDE_GRACE_MS = 60_000

export function useInboxAttendance(instanceId: string | null): void {
  useEffect(() => {
    if (!instanceId) return
    const store = acquireStore(instanceId)
    store.viewing = true
    let timer: ReturnType<typeof setInterval> | null = null
    let graceTimer: ReturnType<typeof setTimeout> | null = null

    const clearGrace = () => { if (graceTimer) { clearTimeout(graceTimer); graceTimer = null } }
    const beat = () => { if (document.visibilityState === 'visible') store.sendAttend() }
    const start = () => { if (timer) return; beat(); timer = setInterval(beat, ATTEND_HEARTBEAT_MS) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        clearGrace()   // returned within the grace window → stay online, no leave
        start()        // immediate beat renews the viewer TTL
      } else {
        // Hidden: hold "attended" for HIDE_GRACE_MS, then leave. Stop beating
        // (throttled anyway); the worker TTL keeps the viewer alive meanwhile.
        stop()
        clearGrace()
        graceTimer = setTimeout(() => { graceTimer = null; store.sendLeave() }, HIDE_GRACE_MS)
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState === 'visible') start()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
      clearGrace()
      store.viewing = false
      store.sendLeave()   // unmount = genuinely leaving the inbox → leave now
      releaseStore(instanceId)
    }
  }, [instanceId])
}
