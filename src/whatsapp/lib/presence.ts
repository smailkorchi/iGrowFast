// Agent-to-agent "is typing" on a shared inbox (collision avoidance).
//
// Frontend-only Supabase Realtime BROADCAST on a per-conversation channel.
// Why broadcast + TTL instead of presence metadata: presence metadata updates
// (re-track to flip is_typing) don't reliably re-emit to subscribers, so a
// "stopped typing" could linger until the agent left. Broadcast pings + a local
// TTL prune are bulletproof: the indicator shows only while pings arrive and
// auto-clears ~2s after the last keystroke (or instantly on an explicit stop /
// send / unmount). Never touches WhatsApp.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { AvatarConfig } from './database.types'
import { supabase } from './supabase'

export interface TypingAgent {
  user_id: string
  full_name: string | null
  avatar_config?: AvatarConfig | null
  avatar_url?: string | null
  email?: string | null
}

const TYPER_TTL_MS = 2200   // hide a typer this long after their last ping
const PING_THROTTLE_MS = 800 // don't broadcast more often than this while typing

export function useAgentTyping(
  conversationId: string | null,
  self: TypingAgent | null,
): { typers: TypingAgent[]; ping: () => void; stop: () => void } {
  const [typers, setTypers] = useState<TypingAgent[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const mapRef = useRef<Map<string, { agent: TypingAgent; ts: number }>>(new Map())
  const lastPingRef = useRef(0)
  const selfRef = useRef<TypingAgent | null>(self)
  selfRef.current = self
  const uid = self?.user_id ?? null

  useEffect(() => {
    // The channel is per-conversation, so clear any typers carried over from the
    // PREVIOUS conversation before (re)subscribing. Without this, a teammate who
    // was typing in the chat you just left keeps showing as "…est en train
    // d'écrire" in every chat you open next: the effect cleanup cleared mapRef +
    // the channel but never reset the `typers` STATE, so it lingered until a
    // fresh ping/prune on the new channel happened to re-flush.
    setTypers([])
    mapRef.current.clear()
    if (!conversationId || !uid) return
    const flush = () => setTypers([...mapRef.current.values()].map((v) => v.agent))
    const channel = supabase.channel(`presence:conv:${conversationId}`)
    channelRef.current = channel
    channel
      .on('broadcast', { event: 'agent_typing' }, ({ payload }) => {
        const p = payload as TypingAgent | undefined
        if (!p?.user_id || p.user_id === uid) return
        mapRef.current.set(p.user_id, { agent: p, ts: Date.now() })
        flush()
      })
      .on('broadcast', { event: 'agent_stop' }, ({ payload }) => {
        const id = (payload as { user_id?: string } | undefined)?.user_id
        if (id && mapRef.current.delete(id)) flush()
      })
      .subscribe()

    const prune = window.setInterval(() => {
      const cutoff = Date.now() - TYPER_TTL_MS
      let changed = false
      for (const [k, v] of mapRef.current) if (v.ts < cutoff) { mapRef.current.delete(k); changed = true }
      if (changed) flush()
    }, 600)

    return () => {
      window.clearInterval(prune)
      try { void channel.send({ type: 'broadcast', event: 'agent_stop', payload: { user_id: uid } }) } catch { /* noop */ }
      channelRef.current = null
      mapRef.current.clear()
      void supabase.removeChannel(channel)
    }
  }, [conversationId, uid])

  const ping = useCallback(() => {
    const ch = channelRef.current
    const s = selfRef.current
    if (!ch || !s) return
    const now = Date.now()
    if (now - lastPingRef.current < PING_THROTTLE_MS) return
    lastPingRef.current = now
    void ch.send({
      type: 'broadcast', event: 'agent_typing',
      payload: { user_id: s.user_id, full_name: s.full_name, avatar_config: s.avatar_config ?? null, avatar_url: s.avatar_url ?? null, email: s.email ?? null },
    })
  }, [])

  const stop = useCallback(() => {
    const ch = channelRef.current
    const s = selfRef.current
    lastPingRef.current = 0
    if (!ch || !s) return
    void ch.send({ type: 'broadcast', event: 'agent_stop', payload: { user_id: s.user_id } })
  }, [])

  return { typers, ping, stop }
}

// ── Org-wide presence (who's online right now) ──────────────────────────────
// Every authenticated session track()s itself on the shared `presence:org`
// channel (mounted globally in AppLayout). Keyed by user_id so multiple tabs of
// the same person collapse to one. The admin Dashboard reads the member list.
export interface OnlineAgent { user_id: string; full_name: string | null; avatar_config?: AvatarConfig | null; avatar_url?: string | null; email?: string | null; role?: string | null }
type OrgSelf = TypingAgent & { role?: string | null }

// Single shared `presence:org` channel for the whole tab. Multiple callers
// (AppLayout tracks; Dashboard reads) share ONE channel — creating a second
// channel for the same topic, or calling .on() after subscribe(), throws.
// Created once, lives for the session; listeners are ref-counted.
let orgChannel: RealtimeChannel | null = null
let orgAgents: OnlineAgent[] = []
let orgTrackedUid: string | null = null
const orgListeners = new Set<() => void>()

function trackPayload(self: OrgSelf) {
  return { user_id: self.user_id, full_name: self.full_name, avatar_config: self.avatar_config ?? null, avatar_url: self.avatar_url ?? null, email: self.email ?? null, role: self.role ?? null }
}

function ensureOrgChannel(self: OrgSelf): void {
  if (orgChannel) {
    if (orgTrackedUid !== self.user_id) {
      orgTrackedUid = self.user_id
      void orgChannel.track(trackPayload(self))
    }
    return
  }
  orgTrackedUid = self.user_id
  const ch = supabase.channel('presence:org', { config: { presence: { key: self.user_id } } })
  orgChannel = ch
  ch.on('presence', { event: 'sync' }, () => {
    const state = ch.presenceState<OnlineAgent>()
    orgAgents = Object.values(state).map((arr) => arr[0]).filter(Boolean) as OnlineAgent[]
    orgListeners.forEach((l) => l())
  }).subscribe((status) => {
    if (status === 'SUBSCRIBED') void ch.track(trackPayload(self))
  })
}

export function useOrgPresence(self: OrgSelf | null): { agents: OnlineAgent[]; count: number } {
  const [, force] = useState(0)
  const uid = self?.user_id ?? null
  const selfRef = useRef<OrgSelf | null>(self)
  selfRef.current = self

  useEffect(() => {
    if (!uid || !selfRef.current) return
    ensureOrgChannel(selfRef.current)
    const l = () => force((x) => x + 1)
    orgListeners.add(l)
    l() // pick up current state immediately
    return () => { orgListeners.delete(l) }
  }, [uid])

  return { agents: orgAgents, count: orgAgents.length }
}
