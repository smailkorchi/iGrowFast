// Postgres + Supabase clients.
//
// Two distinct connection paths:
//
//  1. pg.Pool against Supabase pooler in **session mode** (port 5432 on
//     aws-0-<region>.pooler.supabase.com). Session mode preserves the features
//     the dispatcher needs:
//       - pg_advisory_lock for per-number single-writer coordination
//       - LISTEN/NOTIFY so the worker wakes the instant a new row is enqueued
//       - server-side prepared statements (set by pg auto by default)
//
//     A dedicated `listenClient` is checked out and held for the LISTEN
//     lifetime; ordinary queries use the pool.
//
//  2. @supabase/supabase-js with the service role key. Used for Realtime
//     subscriptions on whatsapp_instances + as a fallback for table access
//     when we want PostgREST shape rather than raw SQL.

import pg from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { log } from './logger.js'

// --------- pg Pool ----------------------------------------------------------

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // Conservative: pooler quotas are project-wide; don't hog them.
  // Dispatcher loops mostly do tiny short transactions (claim, mark sent).
  // 10 is plenty for ~10 numbers × ~3 inflight ops each, with margin.
  max: 10,
  idleTimeoutMillis: 30_000,
  // Pooler doesn't honor `application_name` set by some libs; pass it
  // explicitly so we can grep pg_stat_activity.
  application_name: `igf-wa-worker/${config.workerVersion}`,
  // Our WhatsApp objects (tables, functions, and ENUM TYPES) live in the
  // `whatsapp` schema. Table/fn refs in our SQL are schema-qualified, but bare
  // enum casts (e.g. `$1::instance_status`) resolve via search_path — so set it
  // on the startup packet. NOTE: node-pg only forwards this `options` field
  // (NOT `?options=` in the URL — that's libpq-only); supavisor session mode
  // passes it through. Without it: `type "instance_status" does not exist`.
  options: '-c search_path=whatsapp,public',
})

pool.on('error', (err) => {
  // Idle clients can fail (e.g., pooler restarts). Log and let pg.Pool recycle.
  log.error('pg.pool.idle_error', { error: err.message })
})

// --------- Supabase JS (service-role) ---------------------------------------

export const supabase: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      // Long-lived connection. Reconnect logic is built into the SDK.
      params: { eventsPerSecond: 10 },
    },
  },
)

// --------- LISTEN dedicated connection --------------------------------------
// Holds a single client out of the pool for the worker's lifetime, subscribes
// to LISTEN channels, and re-attaches on disconnect.

type NotifyHandler = (payload: string) => void
const channels = new Map<string, Set<NotifyHandler>>()
let listenClient: pg.PoolClient | null = null

async function attachListenClient(): Promise<void> {
  const client = await pool.connect()
  listenClient = client

  client.on('notification', (msg) => {
    if (!msg.channel) return
    const handlers = channels.get(msg.channel)
    if (!handlers) return
    for (const h of handlers) {
      try {
        h(msg.payload ?? '')
      } catch (err) {
        log.error('listen.handler_threw', {
          channel: msg.channel,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  })

  client.on('error', (err) => {
    log.error('listen.client_error', { error: err.message })
    // Detach so the next reconnectListenClient() call rebuilds it.
    listenClient = null
    client.release(err)
    setTimeout(() => {
      reconnectListenClient().catch((e) =>
        log.error('listen.reconnect_failed', { error: e.message }),
      )
    }, 1_000)
  })

  // Re-issue LISTEN for every channel we had subscribed to.
  for (const channel of channels.keys()) {
    await client.query(`LISTEN ${quoteIdent(channel)}`)
    log.debug('listen.attached', { channel })
  }
}

async function reconnectListenClient(): Promise<void> {
  if (listenClient) return
  log.info('listen.reconnecting')
  await attachListenClient()
}

/**
 * Subscribe to a Postgres NOTIFY channel. Handler fires for every notification
 * payload. Safe to call multiple times for the same channel — handlers stack.
 */
export async function listenOn(channel: string, handler: NotifyHandler): Promise<void> {
  let set = channels.get(channel)
  if (!set) {
    set = new Set()
    channels.set(channel, set)
  }
  set.add(handler)

  if (!listenClient) {
    await attachListenClient()
  } else {
    await listenClient.query(`LISTEN ${quoteIdent(channel)}`)
  }
}

// Postgres identifiers in LISTEN can't be parameterized; whitelist allowed chars.
function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`invalid channel name: ${name}`)
  }
  return `"${name}"`
}

// --------- Graceful close ---------------------------------------------------

export async function closeDb(): Promise<void> {
  if (listenClient) {
    try { listenClient.release() } catch { /* already gone */ }
    listenClient = null
  }
  await pool.end()
  log.info('pg.pool.closed')
}
