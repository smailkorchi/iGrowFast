// Realtime supervisor — detects a deaf wa:node websocket via end-to-end
// self-probes and drives a rebuild.
//
// supabase-js does not always rejoin a channel after CHANNEL_ERROR (verified
// incident: 2026-07-17, wa:node never resubscribed for 12 days). We can't
// trust the client's own status callbacks alone, so we close the loop through
// the REAL production path: emit a probe via SQL realtime.send() (same
// mechanism mig 048 control-plane triggers use) and confirm it comes back as
// a broadcast on our own wa:node channel. If probes keep sending successfully
// but nothing arrives for DEAF_AFTER_MS, the socket is wedged — rebuild.
//
// The pg-outage vs. deaf-socket discriminator: a probe EMIT failure means we
// can't reach Postgres, which says nothing about the websocket — never
// triggers a rebuild on its own.

import { pool } from './db.js'
import { log } from './logger.js'
import { config } from './config.js'

const PROBE_INTERVAL_MS = 30_000
const DEAF_AFTER_MS = 90_000
const REBUILD_BACKOFF_MS = [60_000, 120_000, 300_000]

let lastEventAt = Date.now()
let lastProbeSentOkAt = 0
let prevProbeSentOkAt = 0
let rebuildAttempts = 0
let rebuilding = false
let lastRebuildAt = 0
let timer: NodeJS.Timeout | null = null

export function noteRealtimeEvent(): void {
  lastEventAt = Date.now()
  rebuildAttempts = 0
}

export function startRealtimeSupervisor(deps: { rebuild: () => Promise<void> }): void {
  if (timer) return
  timer = setInterval(() => { void tick(deps) }, PROBE_INTERVAL_MS)
  timer.unref()
}

export function stopRealtimeSupervisor(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function tick(deps: { rebuild: () => Promise<void> }): Promise<void> {
  try {
    await pool.query(
      "select realtime.send($1::jsonb, 'probe', $2, true)",
      [JSON.stringify({ w: config.workerId, t: Date.now() }), 'wa:node:' + config.nodeId],
    )
    prevProbeSentOkAt = lastProbeSentOkAt
    lastProbeSentOkAt = Date.now()
  } catch (err) {
    log.warn('realtime.probe.emit_failed', { error: err instanceof Error ? err.message : String(err) })
    return
  }

  // Deaf = a probe successfully handed to Postgres a full interval ago never
  // came back, and overall silence exceeds the threshold. Keying on the
  // PREVIOUS emit (not the one just sent) gives every probe a full interval
  // to arrive — so the first tick after a recovered pg outage can't declare
  // deafness before its own probe has had a chance to land.
  const now = Date.now()
  const deaf = prevProbeSentOkAt > 0
    && lastEventAt < prevProbeSentOkAt
    && (now - lastEventAt) > DEAF_AFTER_MS
  if (!deaf) return

  const backoff = REBUILD_BACKOFF_MS[Math.min(rebuildAttempts, REBUILD_BACKOFF_MS.length - 1)] ?? 300_000
  if (rebuilding || (now - lastRebuildAt) < backoff) return

  rebuilding = true
  lastRebuildAt = now
  log.error('realtime.deaf.detected', { last_event_age_ms: now - lastEventAt, attempt: rebuildAttempts })
  try {
    await deps.rebuild()
  } catch (err) {
    log.error('realtime.rebuild.failed', { error: err instanceof Error ? err.message : String(err) })
  } finally {
    rebuildAttempts++
    rebuilding = false
  }
}
