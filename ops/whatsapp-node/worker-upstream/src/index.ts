// Worker entry point.

import { config } from './config.js'
import { log } from './logger.js'
import { closeDb, listenOn, pool } from './db.js'
import { startLogSink, stopLogSink } from './logSink.js'
import { startHeartbeat, stopHeartbeat } from './heartbeat.js'
import { wakeLoop, refreshQueueDepth, startSelfPresenceLoop, stopSelfPresenceLoop } from './dispatcher/loop.js'
import { startInstanceManager, stopInstanceManager } from './dispatcher/instance-manager.js'
import { startMediaIngest, stopMediaIngest, wakeMediaIngest } from './dispatcher/media-ingest.js'
import { startDispatcherSnapshot, stopDispatcherSnapshot } from './dispatcher/snapshot.js'
import { startPlatformLogPull, stopPlatformLogPull } from './platformLogPull.js'
import { startR2MetricsPull, stopR2MetricsPull } from './r2MetricsPull.js'
import { startWebhookServer } from './webhook/server.js'
import { startActivePeerWarmup, stopActivePeerWarmup } from './webhook/handlers.js'

async function main(): Promise<void> {
  // Start the DB log sink first so worker.boot itself is captured.
  startLogSink()

  log.info('worker.boot', {
    version: config.workerVersion,
    hostname: config.hostname,
    evolution_url: config.evolutionApiUrl,
    webhook_port: config.webhookPort,
  })

  // Verify DB connectivity (fail fast).
  const { rows } = await pool.query<{ version: string; now: Date }>(
    'SELECT version() AS version, now() AS now',
  )
  log.info('pg.connected', {
    server_version: rows[0]?.version.split(' ').slice(0, 2).join(' '),
    server_now: rows[0]?.now.toISOString(),
  })

  // NOTIFY plumbing — every outbound_enqueued event wakes the matching
  // per-number dispatcher loop.
  await listenOn('outbound_enqueued', (payload) => wakeLoop(payload))
  log.info('listen.ready', { channel: 'outbound_enqueued' })

  // Media ingest: webhook handlers enqueue rows + NOTIFY 'media_fetch_ready';
  // the loop drains them, downloading from Evolution and uploading to R2.
  await listenOn('media_fetch_ready', (payload) => wakeMediaIngest(payload))
  startMediaIngest()
  log.info('listen.ready', { channel: 'media_fetch_ready' })

  // Heartbeat (worker_health table).
  startHeartbeat()

  // Periodic queue-depth refresh so the heartbeat carries fresh numbers.
  const depthTimer = setInterval(() => { void refreshQueueDepth() }, 5_000)
  depthTimer.unref()

  // Throttled per-instance dispatcher snapshot (Realtime-fanned), retires the
  // frontend's 2s dispatcher poll. Decoupled from the dispatch loops.
  startDispatcherSnapshot(3_000)

  // Pull Supabase platform logs into system_logs every 60s (fire-and-forget).
  startPlatformLogPull()

  // Sample R2 storage (ListObjects via worker S3 creds) every 10min into r2_metrics.
  startR2MetricsPull()

  // Instance manager: load existing connected instances, spawn dispatchers,
  // subscribe to Realtime for future changes.
  await startInstanceManager()

  // Webhook HTTP server (internal docker port only).
  const webhook = startWebhookServer()
  webhookCloser = webhook.close

  // Periodic peer-presence warmup so the typing indicator stays live across
  // long quiet periods (and recovers from any Evolution-side subscription
  // expiry not caught by connection.update).
  startActivePeerWarmup()

  // Self-presence driver: keeps a number ONLINE while its inbox is attended
  // (page open+visible) so peer typing always arrives, and reverts to ban-safe
  // offline within the attendance grace once unattended. Independent timer so
  // the offline transition is honored even mid send-burst.
  startSelfPresenceLoop()

  log.info('worker.ready')
}

let shuttingDown = false
let webhookCloser: (() => Promise<void>) | null = null
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log.info('worker.shutdown', { signal })
  stopHeartbeat()
  stopMediaIngest()
  stopActivePeerWarmup()
  stopSelfPresenceLoop()
  stopDispatcherSnapshot()
  stopPlatformLogPull()
  stopR2MetricsPull()
  if (webhookCloser) {
    try { await webhookCloser() } catch (err) {
      log.error('worker.shutdown.webhook_close_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  try { await stopInstanceManager() } catch (err) {
    log.error('worker.shutdown.instance_mgr_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  // Flush any buffered operational logs before the DB connection closes.
  try { await stopLogSink() } catch { /* best effort */ }
  try { await closeDb() } catch (err) {
    log.error('worker.shutdown.db_close_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  process.exit(0)
}

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT',  () => { void shutdown('SIGINT')  })

main().catch((err) => {
  log.error('worker.fatal', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
  process.exit(1)
})
