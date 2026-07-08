// Worker entry point.

import { config } from './config.js'
import { log } from './logger.js'
import { closeDb, listenOn, pool } from './db.js'
import { startHeartbeat, stopHeartbeat } from './heartbeat.js'
import { wakeLoop, refreshQueueDepth, startSelfPresenceLoop, stopSelfPresenceLoop } from './dispatcher/loop.js'
import { startInstanceManager, stopInstanceManager } from './dispatcher/instance-manager.js'
import { startMediaIngest, stopMediaIngest, wakeMediaIngest } from './dispatcher/media-ingest.js'
import { startDispatcherSnapshot, stopDispatcherSnapshot } from './dispatcher/snapshot.js'
import { startWebhookServer } from './webhook/server.js'
import { startActivePeerWarmup, stopActivePeerWarmup } from './webhook/handlers.js'

// Observability strip (owner ruling 2026-07-08): logSink (DB persistence of
// worker logs → whatsapp.system_logs) and r2MetricsPull (10min bucket scan →
// whatsapp.r2_metrics) removed with their DB tables — worker logs live in
// journald/docker logs only.

async function main(): Promise<void> {
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
  try { await closeDb() } catch (err) {
    log.error('worker.shutdown.db_close_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  process.exit(0)
}

// Known upstream gap: an unhandled rejection would kill the process silently under some
// Node configs. Log loudly; do NOT exit (dispatch loops are independent + self-healing).
process.on('unhandledRejection', (reason) => {
  log.error('worker.unhandled_rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT',  () => { void shutdown('SIGINT')  })

main().catch((err) => {
  log.error('worker.fatal', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
  process.exit(1)
})
