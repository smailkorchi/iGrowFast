// Worker heartbeat. UPSERTs worker_health every N seconds with currently-
// known queue depth + drain rate (rate measured locally in a sliding window).
//
// Stale heartbeat alert is handled server-side by the pg_cron job
// `worker_health_stale_alert_minute` set up in migration A8.

import { pool } from './db.js'
import { config } from './config.js'
import { log } from './logger.js'

// Sliding 1-minute window of dispatch completions for drain-rate calculation.
const completionTimestamps: number[] = []

export function recordDispatchCompleted(): void {
  const now = Date.now()
  completionTimestamps.push(now)
  // Trim entries older than 60s. O(n) at worst, but n is small.
  const cutoff = now - 60_000
  while (completionTimestamps.length && completionTimestamps[0]! < cutoff) {
    completionTimestamps.shift()
  }
}

// Live counters the dispatcher updates as it observes work.
let activeNumbers = 0
let queueDepth = 0
let dispatchingCount = 0
let lastDispatchAt: Date | null = null

export function setActiveNumbers(n: number): void { activeNumbers = n }
export function setQueueDepth(n: number): void { queueDepth = n }
export function setDispatchingCount(n: number): void { dispatchingCount = n }
export function markDispatched(): void { lastDispatchAt = new Date() }

async function sendOnce(): Promise<void> {
  const drainRate = completionTimestamps.length // per-minute, since window is 60s

  await pool.query(
    `SELECT public.worker_heartbeat(
       p_worker_id => $1,
       p_hostname => $2,
       p_version => $3,
       p_active_numbers => $4,
       p_queue_depth => $5,
       p_dispatching_count => $6,
       p_drain_rate_1m => $7,
       p_last_dispatch_at => $8,
       p_notes => $9::jsonb
     )`,
    [
      config.workerId,
      config.hostname,
      config.workerVersion,
      activeNumbers,
      queueDepth,
      dispatchingCount,
      drainRate,
      lastDispatchAt,
      '{}',
    ],
  )
}

let timer: NodeJS.Timeout | null = null

export function startHeartbeat(): void {
  // Fire immediately on boot so admin sees the worker online without waiting.
  sendOnce().catch((err) =>
    log.error('heartbeat.first_send_failed', { error: err.message }),
  )
  timer = setInterval(() => {
    sendOnce().catch((err) =>
      log.error('heartbeat.send_failed', { error: err.message }),
    )
  }, config.heartbeatIntervalMs)
  // Don't keep the event loop alive solely for heartbeat — shutdown handler
  // calls stopHeartbeat() before exit anyway.
  timer.unref()
  log.info('heartbeat.started', { interval_ms: config.heartbeatIntervalMs })
}

export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
